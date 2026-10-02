function json(data, status=200, cache=true) {
  const headers={
    "Content-Type":"application/json",
    "Cache-Control":cache?"public, max-age=900":"no-store",
    "Netlify-CDN-Cache-Control":cache?"public, s-maxage=21600, stale-while-revalidate=86400":"no-store"
  };
  return new Response(JSON.stringify(data),{status,headers});
}

function validCode(v){return /^[A-Z]{3}$/.test(v);}
function validMonth(v){return /^\d{4}-(0[1-9]|1[0-2])$/.test(v);}
function pad(n){return String(n).padStart(2,"0");}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

function addDays(date,days){
  const d=new Date(date+"T12:00:00Z");
  d.setUTCDate(d.getUTCDate()+days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
}

function monthDays(month){
  const [year,mon]=month.split("-").map(Number);
  return new Date(Date.UTC(year,mon,0)).getUTCDate();
}

function buildWindows(month){
  const [year,mon]=month.split("-").map(Number);
  const days=monthDays(month);
  const out=[];
  for(let day=1;day<=days;day++){
    const date=`${year}-${pad(mon)}-${pad(day)}`;
    const next=addDays(date,1);
    out.push({date,from:`${date}T00:00`,to:`${date}T12:00`});
    out.push({date,from:`${date}T12:00`,to:`${next}T00:00`});
  }
  return out;
}

function airportIata(movement){
  return String(movement?.airport?.iata||"").toUpperCase();
}

function localTime(movement){
  return movement?.scheduledTime?.local||movement?.revisedTime?.local||null;
}

function flightNumber(flight){
  return String(flight?.number||"Scheduled flight");
}

function normalizeFlight(flight,destination){
  const arrival=flight?.arrival||{};
  if(airportIata(arrival)!==destination)return null;
  const scheduledOut=localTime(flight?.departure);
  if(!scheduledOut)return null;
  const scheduledIn=localTime(arrival);
  return {
    ident:flightNumber(flight),
    scheduledOut,
    scheduledIn:scheduledIn||null,
    airline:flight?.airline?.name||null
  };
}

async function fetchWindow(apiKey,origin,destination,window){
  const params=new URLSearchParams({
    direction:"Departure",
    withLeg:"true",
    withCancelled:"false",
    withCodeshared:"true",
    withCargo:"false",
    withPrivate:"false",
    withLocation:"false"
  });
  const endpoint=`https://api.aerodatabox.com/flights/airports/iata/${encodeURIComponent(origin)}/${encodeURIComponent(window.from)}/${encodeURIComponent(window.to)}?${params}`;
  const res=await fetch(endpoint,{
    headers:{
      Accept:"application/json",
      "X-Api-Key":apiKey
    }
  });
  if(res.status===204)return [];
  const body=await res.json().catch(()=>({}));
  if(!res.ok){
    const msg=body?.message||body?.detail||body?.title||body?.errors?.[0]?.message||`AeroDataBox HTTP ${res.status}`;
    const err=new Error(msg);
    err.status=res.status;
    throw err;
  }
  const departures=Array.isArray(body?.departures)?body.departures:[];
  return departures.map(f=>normalizeFlight(f,destination)).filter(Boolean);
}

async function fetchMonth(apiKey,origin,destination,month){
  const windows=buildWindows(month);
  const results=[];
  const errors=[];
  const batchSize=5;

  for(let i=0;i<windows.length;i+=batchSize){
    const batch=windows.slice(i,i+batchSize);
    const batchResults=await Promise.all(batch.map(async window=>{
      try{
        return {window,flights:await fetchWindow(apiKey,origin,destination,window)};
      }catch(err){
        return {window,error:err};
      }
    }));
    for(const item of batchResults){
      if(item.error)errors.push(item);
      else results.push(item);
    }
    if(i+batchSize<windows.length)await sleep(1050);
  }

  if(errors.length){
    const authError=errors.find(x=>x.error?.status===401||x.error?.status===403);
    if(authError)throw authError.error;
    if(results.length===0)throw errors[0].error;
  }

  const seen=new Set();
  const days={};
  for(const item of results){
    for(const flight of item.flights){
      const date=String(flight.scheduledOut).slice(0,10);
      if(!date.startsWith(month+"-"))continue;
      const dedupeKey=`${date}|${flight.scheduledOut}|${flight.scheduledIn||""}|${destination}`;
      if(seen.has(dedupeKey))continue;
      seen.add(dedupeKey);
      if(!days[date])days[date]={count:0,flights:[]};
      days[date].count+=1;
      if(days[date].flights.length<12)days[date].flights.push(flight);
    }
  }

  return {
    days,
    partial:errors.length>0,
    unknownDates:[...new Set(errors.map(x=>x.window.date))],
    windowsChecked:results.length,
    windowsFailed:errors.length
  };
}

export default async(req)=>{
  if(req.method!=="GET")return json({error:"Method not allowed"},405,false);
  const url=new URL(req.url);
  const origin=String(url.searchParams.get("origin")||"").toUpperCase();
  const destination=String(url.searchParams.get("destination")||"").toUpperCase();
  const month=String(url.searchParams.get("month")||"");

  if(!validCode(origin)||!validCode(destination)||!validMonth(month)){
    return json({error:"Use origin=AAA&destination=BBB&month=YYYY-MM"},400,false);
  }

  const apiKey=Netlify.env.get("AERODATABOX_API_KEY");
  if(!apiKey){
    return json({
      error:"schedule_provider_not_configured",
      message:"AeroDataBox schedule access is not configured.",
      requiredEnvVar:"AERODATABOX_API_KEY"
    },503,false);
  }

  try{
    const result=await fetchMonth(apiKey,origin,destination,month);
    return json({
      provider:"aerodatabox",
      sourceType:"published-schedule",
      origin,
      destination,
      month,
      checkedAt:new Date().toISOString(),
      ...result
    });
  }catch(err){
    return json({
      error:"schedule_lookup_failed",
      message:String(err?.message||err),
      upstreamStatus:Number(err?.status||0)||null
    },502,false);
  }
};

export const config={path:"/api/schedule-calendar"};
