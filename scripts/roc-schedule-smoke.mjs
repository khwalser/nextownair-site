import fs from "node:fs";
import vm from "node:vm";
import handler from "../netlify/functions/schedule-proxy.mjs";

const files={
  data:fs.readFileSync("data.js","utf8"),
  trip:fs.readFileSync("trip-state.js","utf8"),
  itinerary:fs.readFileSync("itinerary.js","utf8"),
  map:fs.readFileSync("map.js","utf8"),
  css:fs.readFileSync("styles.css","utf8")
};

const failures=[];
function slug(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80);}
function check(name,condition,detail=""){if(!condition)failures.push({name,detail:String(detail)});}

try{new Function(files.itinerary);}catch(e){failures.push({name:"itinerary-syntax",detail:e.message});}
try{new Function(files.map);}catch(e){failures.push({name:"map-syntax",detail:e.message});}

const storage=new Map();
const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k),clear:()=>storage.clear()};
const context={window:{},localStorage,location:{search:""},history:{replaceState(){}},URLSearchParams,Date,console};
context.window.window=context.window;context.window.localStorage=localStorage;
vm.createContext(context);
vm.runInContext(files.data,context,{filename:"data.js"});
vm.runInContext(files.trip,context,{filename:"trip-state.js"});
const D=context.window.NTA_DATA,N=context.window.NTA;

const codes=new Set(D.airports.map(a=>a.code));
const allEdgesValid=D.routes.every(([a,b])=>codes.has(a)&&codes.has(b)&&N.hasFlightLink(a,b));
check("all-233-route-edges-valid",D.routes.length===233&&allEdgesValid,`routes=${D.routes.length}`);

const eas=D.airports.filter(a=>a.type==="eas");
const degree=new Map([...codes].map(c=>[c,0]));
for(const [a,b] of D.routes){degree.set(a,(degree.get(a)||0)+1);degree.set(b,(degree.get(b)||0)+1);}
const isolated=eas.filter(a=>(degree.get(a.code)||0)===0).map(a=>a.code);
check("all-eas-connected",isolated.length===0,isolated.join(","));

check("calendar-fallback-code",files.itinerary.includes("schedule_quota_exhausted")&&files.itinerary.includes("Falling back to Duffel live fares"));
check("calendar-all-dates-selectable-in-fallback",files.itinerary.includes("['available','fallback'].includes(av.status)"));
check("calendar-fallback-prices-all-dates",files.itinerary.includes("queueCalendarFarePricing(leg.a,leg.b,monthDatesAll,token)"));
check("calendar-rate-limit-auto-resume",files.itinerary.includes("fareBlockedUntil")&&files.itinerary.includes("pricing resumes automatically"));
check("fallback-css",files.css.includes(".calendar-day.fallback"));
check("route-auto-repair",files.map.includes("function repairRoute")&&files.map.includes("Auto-inserted connector"));

// Exhausted schedule provider must return an explicit failover code, not 0/N unknown dates.
const samplePairs=[["DTW","ROC"],["ORD","CMX"],["ANC","UNK"],["OGG","HNM"],["SJU","MAZ"]];
const date="2026-10-03",month="2026-10";
const scheduleResults=[];
for(const [origin,destination] of samplePairs){
  try{
    const req=new Request(`https://smoke.local/api/schedule-calendar?origin=${origin}&destination=${destination}&month=${month}&dates=${date}`);
    const res=await handler(req);
    const body=await res.json();
    scheduleResults.push({origin,destination,status:res.status,error:body.error||null});
    check(`schedule-failover-${origin}-${destination}`,
      body.error==="schedule_quota_exhausted" || res.ok,
      `HTTP ${res.status} error=${body.error||""}`);
  }catch(e){
    failures.push({name:`schedule-exception-${origin}-${destination}`,detail:e.message});
  }
}

// Every route pair should have a graph path both directions.
let unreachable=[];
for(const [a,b] of D.routes){
  const p1=N.findFlightPath(a,b),p2=N.findFlightPath(b,a);
  if(!p1||!p2)unreachable.push(`${a}<->${b}`);
}
check("all-edges-routable-both-directions",unreachable.length===0,unreachable.slice(0,20).join(","));

check("all-declared-routes-directly-recognized",D.routes.every(([a,b])=>N.hasFlightLink(a,b)&&N.hasFlightLink(b,a)));

const result={ok:failures.length===0,totalRoutes:D.routes.length,totalEas:eas.length,scheduleResults,failures};
const name=result.ok?`network-fallback-pass-${D.routes.length}-routes.html`:`network-fallback-fail-${failures.length}-${slug(failures[0]?.name)}-${slug(failures[0]?.detail)}.html`;
fs.writeFileSync(name,`<!doctype html><title>NexTownAir network fallback</title><pre>${JSON.stringify(result,null,2)}</pre>`);
console.log("NETWORK_FALLBACK_SMOKE",JSON.stringify(result));
