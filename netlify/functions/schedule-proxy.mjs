function json(data,status=200,cache=true){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "Content-Type":"application/json",
      "Cache-Control":cache?"public, max-age=900":"no-store",
      "Netlify-CDN-Cache-Control":cache?"public, s-maxage=21600, stale-while-revalidate=86400":"no-store"
    }
  });
}

function validCode(v){return /^[A-Z]{3}$/.test(v);}
function validMonth(v){return /^\d{4}-(0[1-9]|1[0-2])$/.test(v);}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v);}
function pad(n){return String(n).padStart(2,"0");}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function addDays(date,days){
  const d=new Date(date+"T12:00:00Z");
  d.setUTCDate(d.getUTCDate()+days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
}
function monthDates(month){
  const [y,m]=month.split("-").map(Number);
  const days=new Date(Date.UTC(y,m,0)).getUTCDate();
  return Array.from({length:days},(_,i)=>`${y}-${pad(m)}-${pad(i+1)}`);
}
function airportIata(movement){return String(movement?.airport?.iata||"").toUpperCase();}
function localTime(movement){return movement?.scheduledTime?.local||movement?.revisedTime?.local||null;}
function normalizeFlight(flight,destination){
  const arrival=flight?.arrival||{};
  if(airportIata(arrival)!==destination)return null;
  const scheduledOut=localTime(flight?.departure);
  if(!scheduledOut)return null;
  return {
    ident:String(flight?.number||"Scheduled flight"),
    scheduledOut,
    scheduledIn:localTime(arrival)||null,
    airline:flight?.airline?.name||null
  };
}

const API_BASE="https://prod.api.market/api/v1/aedbx/aerodatabox";
const MIN_START_GAP_MS=1050;
let lastStartAt=0;

async function rateLimitedFetch(url,apiKey){
  const wait=Math.max(0,lastStartAt+MIN_START_GAP_MS-Date.now());
  if(wait)await sleep(wait);
  lastStartAt=Date.now();
  return fetch(url,{headers:{Accept:"application/json","x-api-market-key":apiKey}});
}

async function fetchHalfDay(apiKey,origin,destination,from,to){
  const params=new URLSearchParams({
    direction:"Departure",
    withLeg:"true",
    withCancelled:"false",
    withCodeshared:"true",
    withCargo:"false",
    withPrivate:"false",
    withLocation:"false"
  });
  const url=`${API_BASE}/flights/airports/iata/${encodeURIComponent(origin)}/${encodeURIComponent(from)}/${encodeURIComponent(to)}?${params}`;
  const res=await rateLimitedFetch(url,apiKey);
  if(res.status===204)return [];
  const body=await res.json().catch(()=>({}));
  if(!res.ok){
    const err=new Error(body?.message||body?.detail||body?.title||body?.errors?.[0]?.message||`API.Market HTTP ${res.status}`);
    err.status=res.status;throw err;
  }
  const departures=Array.isArray(body?.departures)?body.departures:[];
  return departures.map(f=>normalizeFlight(f,destination)).filter(Boolean);
}

async function fetchDate(apiKey,origin,destination,date){
  const next=addDays(date,1);
  const morning=await fetchHalfDay(apiKey,origin,destination,`${date}T00:00`,`${date}T12:00`);
  if(morning.length)return morning;
  return fetchHalfDay(apiKey,origin,destination,`${date}T12:00`,`${next}T00:00`);
}

export default async(req)=>{
  if(req.method!=="GET")return json({error:"Method not allowed"},405,false);
  const url=new URL(req.url);
  const origin=String(url.searchParams.get("origin")||"").toUpperCase();
  const destination=String(url.searchParams.get("destination")||"").toUpperCase();
  const month=String(url.searchParams.get("month")||"");
  const requestedDates=String(url.searchParams.get("dates")||"")
    .split(",").map(x=>x.trim()).filter(Boolean);

  if(!validCode(origin)||!validCode(destination)||!validMonth(month)){
    return json({error:"Use origin=AAA&destination=BBB&month=YYYY-MM"},400,false);
  }

  const apiKey=(globalThis.Netlify?.env?.get?.("AERODATABOX_API_MARKET_KEY"))||process.env.AERODATABOX_API_MARKET_KEY;
  if(!apiKey){
    return json({
      error:"schedule_provider_not_configured",
      message:"AeroDataBox via API.Market is not configured.",
      requiredEnvVar:"AERODATABOX_API_MARKET_KEY"
    },503,false);
  }

  const allDates=monthDates(month);
  const targetDates=requestedDates.length
    ? [...new Set(requestedDates.filter(d=>validDate(d)&&d.startsWith(month+"-")&&allDates.includes(d)))]
    : allDates;
  if(!targetDates.length)return json({error:"No valid dates requested"},400,false);

  const started=Date.now();
  const maxWorkMs=18000;
  const days={};
  const unknownDates=[];
  const checkedDates=[];
  const seen=new Set();
  let lastUpstreamError=null;

  for(let i=0;i<targetDates.length;i++){
    const date=targetDates[i];
    if(Date.now()-started>maxWorkMs){
      unknownDates.push(...targetDates.slice(i));
      break;
    }
    try{
      const flights=await fetchDate(apiKey,origin,destination,date);
      checkedDates.push(date);
      for(const flight of flights){
        const depDate=String(flight.scheduledOut).slice(0,10);
        if(depDate!==date)continue;
        const key=`${flight.ident}|${flight.scheduledOut}|${flight.scheduledIn||""}`;
        if(seen.has(key))continue;
        seen.add(key);
        if(!days[date])days[date]={count:0,flights:[]};
        days[date].count+=1;
        if(days[date].flights.length<12)days[date].flights.push(flight);
      }
    }catch(err){
      const message=String(err?.message||err);
      if(err?.status===401||err?.status===403){
        return json({error:"schedule_auth_failed",message,upstreamStatus:err.status},502,false);
      }
      if(err?.status===400&&/no active subscription/i.test(message)){
        return json({error:"schedule_subscription_inactive",message:"AeroDataBox API.Market subscription is not active.",upstreamStatus:400},503,false);
      }
      lastUpstreamError={status:Number(err?.status||0),message:message.slice(0,300)};
      unknownDates.push(date);
    }
  }

  return json({
    provider:"aerodatabox-apimarket",
    sourceType:"published-schedule",
    origin,destination,month,
    checkedAt:new Date().toISOString(),
    partial:unknownDates.length>0,
    checkedDates,
    unknownDates:[...new Set(unknownDates)],
    days,
    ...(lastUpstreamError?{lastUpstreamError}: {})
  });
};

export const config={path:"/api/schedule-calendar"};
