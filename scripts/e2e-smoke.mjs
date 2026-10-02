import fs from "node:fs";
import vm from "node:vm";
import {createRequire} from "node:module";
import scheduleHandler from "../netlify/functions/schedule-proxy.mjs";

const require=createRequire(import.meta.url);
const flightProxy=require("../netlify/functions/flight-proxy.js");

const checks=[];
function check(name,condition,detail=""){
  checks.push({name,ok:Boolean(condition),detail:String(detail||"")});
}
function slug(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48);}
function ymd(d){return d.toISOString().slice(0,10);}
function addDays(d,n){const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x;}
function sameMonthDates(count=4,step=1){
  let base=addDays(new Date(),1);
  if(base.getUTCDate()>24)base=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+1,1,12));
  return Array.from({length:count},(_,i)=>ymd(addDays(base,i*step)));
}

// ---------- Static/browser bundle checks ----------
const files={
  data:fs.readFileSync("data.js","utf8"),
  trip:fs.readFileSync("trip-state.js","utf8"),
  flights:fs.readFileSync("flight-provider.js","utf8"),
  map:fs.readFileSync("map.js","utf8"),
  itinerary:fs.readFileSync("itinerary.js","utf8"),
  styles:fs.readFileSync("styles.css","utf8"),
  index:fs.readFileSync("index.html","utf8"),
  itinHtml:fs.readFileSync("itinerary.html","utf8"),
  flightProxy:fs.readFileSync("netlify/functions/flight-proxy.js","utf8"),
  schedule:fs.readFileSync("netlify/functions/schedule-proxy.mjs","utf8"),
  toml:fs.readFileSync("netlify.toml","utf8")
};

for(const [name,src] of Object.entries({data:files.data,trip:files.trip,flights:files.flights,map:files.map,itinerary:files.itinerary,flightProxy:files.flightProxy})){
  try{new Function(src);check("syntax-"+name,true);}catch(err){check("syntax-"+name,false,err.message);}
}
try{
  const schedSrc=files.schedule
    .replace(/export default async\s*\(req\)\s*=>/,"const __handler=async(req)=>")
    .replace(/export const config\s*=/,"const config=");
  new Function(schedSrc);check("syntax-schedule",true);
}catch(err){check("syntax-schedule",false,err.message);}

check("map-scroll-zoom",files.map.includes("scrollWheelZoom:true"));
check("map-auto-repair",files.map.includes("function repairRoute")&&files.map.includes("Auto-inserted connector"));
check("no-needs-connector-copy",!files.map.includes("needs a connector")&&!files.index.includes("needs a connector"));
check("calendar-progressive-batches",files.itinerary.includes("const BATCH_SIZE=4")&&files.itinerary.includes("showStartCalendar()"));
check("calendar-schedule-route",files.schedule.includes('path:"/api/schedule-calendar"'));
check("live-only-itinerary",files.itinerary.includes("let opts=usingProvider?providerOpts:[]")&&!files.itinerary.includes("Verified route · sample schedule"));
check("exact-fare-ui",files.itinerary.includes("fare-choice-list")&&files.itinerary.includes("Lowest fare")&&!files.itinerary.includes("o.fareCount>1?\`From"));
check("required-index-scripts",["data.js","trip-state.js","map.js"].every(x=>files.index.includes(`src="${x}"`)));
check("required-itinerary-scripts",["data.js","trip-state.js","flight-provider.js","itinerary.js"].every(x=>files.itinHtml.includes(`src="${x}"`)));

// ---------- Route/state graph checks ----------
const storage=new Map();
const localStorage={
  getItem:k=>storage.has(k)?storage.get(k):null,
  setItem:(k,v)=>storage.set(k,String(v)),
  removeItem:k=>storage.delete(k),
  clear:()=>storage.clear()
};
const context={
  window:{},
  localStorage,
  location:{search:""},
  history:{replaceState(){}},
  URLSearchParams,
  Date,
  console
};
context.window.window=context.window;
context.window.localStorage=localStorage;
vm.createContext(context);
try{
  vm.runInContext(files.data,context,{filename:"data.js"});
  vm.runInContext(files.trip,context,{filename:"trip-state.js"});
  vm.runInContext(files.flights,context,{filename:"flight-provider.js"});
  check("browser-core-eval",true);
}catch(err){check("browser-core-eval",false,err.message);}

const D=context.window.NTA_DATA;
const N=context.window.NTA;
const F=context.window.NTA_FLIGHTS;
if(D&&N){
  const eas=D.airports.filter(a=>a.type==="eas");
  const codes=new Set(D.airports.map(a=>a.code));
  const routeKeys=new Set();
  let validEndpoints=true,duplicates=0;
  for(const [a,b] of D.routes){
    if(!codes.has(a)||!codes.has(b))validEndpoints=false;
    const key=[a,b].sort().join("|");
    if(routeKeys.has(key))duplicates++;
    routeKeys.add(key);
  }
  check("eas-count-183",eas.length===183,`got ${eas.length}`);
  check("route-count-233",D.routes.length===233,`got ${D.routes.length}`);
  check("route-verification-count",D.routeVerification?.easRoutePairs+D.routeVerification?.connectorRoutePairs===D.routes.length);
  check("unique-airport-codes",codes.size===D.airports.length);
  check("valid-route-endpoints",validEndpoints);
  check("no-duplicate-route-pairs",duplicates===0,`duplicates ${duplicates}`);

  const degree=new Map([...codes].map(c=>[c,0]));
  for(const [a,b] of D.routes){degree.set(a,(degree.get(a)||0)+1);degree.set(b,(degree.get(b)||0)+1);}
  const isolatedEas=eas.filter(a=>(degree.get(a.code)||0)===0).map(a=>a.code);
  check("all-eas-have-route",isolatedEas.length===0,isolatedEas.join(","));

  const path1=N.findFlightPath("DTW","CMX");
  const path2=N.findFlightPath("EAU","DTW");
  const validPath=p=>Array.isArray(p)&&p.length>=2&&p.slice(0,-1).every((c,i)=>N.hasFlightLink(c,p[i+1]));
  check("path-dtw-cmx",validPath(path1),JSON.stringify(path1));
  check("path-eau-dtw",validPath(path2),JSON.stringify(path2));

  const requested=["DTW","CMX","EAU","DTW"];
  const expanded=[requested[0]];
  let repairOk=true;
  for(let i=1;i<requested.length;i++){
    const p=N.findFlightPath(expanded[expanded.length-1],requested[i]);
    if(!p){repairOk=false;break;}
    expanded.push(...p.slice(1));
  }
  check("repair-sample-route",repairOk&&expanded.slice(0,-1).every((c,i)=>N.hasFlightLink(c,expanded[i+1])),expanded.join("→"));

  let state={version:1,route:["DTW","ORD","CMX"],startDate:"2026-10-02",stays:{"1":{mode:"asap"}},selections:{"0":"a","1":"b"}};
  state=N.setRoute(state,["DTW","ORD","EAU"]);
  check("route-change-clears-downstream",state.selections["0"]==="a"&&!state.selections["1"]);
  check("build-url",N.buildUrl("itinerary.html",state).includes("route=DTW%2CORD%2CEAU"));
  check("flight-provider-known-route",F&&F.hasKnownRoute("DTW","ORD")&&!F.hasKnownRoute("DTW","JFK"));
}

// ---------- Real AeroDataBox/API.Market schedule checks ----------
try{
  const dates=sameMonthDates(4,1);
  const month=dates[0].slice(0,7);
  const req=new Request(`https://e2e.local/api/schedule-calendar?origin=DTW&destination=ORD&month=${month}&dates=${dates.join(",")}`);
  const started=Date.now();
  const res=await scheduleHandler(req);
  const body=await res.json();
  const elapsed=Date.now()-started;
  check("schedule-dtw-ord-http",res.ok,`HTTP ${res.status} ${body.error||body.message||""}`);
  check("schedule-dtw-ord-complete",res.ok&&(body.checkedDates||[]).length===dates.length&&(body.unknownDates||[]).length===0,`checked ${(body.checkedDates||[]).length}, unknown ${(body.unknownDates||[]).length}`);
  check("schedule-dtw-ord-data",Object.values(body.days||{}).some(x=>x&&x.count>0),`elapsed ${elapsed}ms`);
}catch(err){check("schedule-dtw-ord-exception",false,err.message);}

try{
  const dates=sameMonthDates(4,2);
  const month=dates[0].slice(0,7);
  const req=new Request(`https://e2e.local/api/schedule-calendar?origin=ORD&destination=CMX&month=${month}&dates=${dates.join(",")}`);
  const res=await scheduleHandler(req);
  const body=await res.json();
  check("schedule-ord-cmx-http",res.ok,`HTTP ${res.status} ${body.error||body.message||""}`);
  check("schedule-ord-cmx-complete",res.ok&&(body.checkedDates||[]).length===dates.length&&(body.unknownDates||[]).length===0,`checked ${(body.checkedDates||[]).length}, unknown ${(body.unknownDates||[]).length}`);
  check("schedule-ord-cmx-data",Object.values(body.days||{}).some(x=>x&&x.count>0));
}catch(err){check("schedule-ord-cmx-exception",false,err.message);}

// ---------- Real Duffel live fare check ----------
try{
  const date=ymd(addDays(new Date(),1));
  const res=await flightProxy.handler({
    httpMethod:"GET",
    queryStringParameters:{origin:"DTW",destination:"ORD",date}
  });
  const body=JSON.parse(res.body||"{}");
  const offers=body.offers||[];
  check("duffel-http",res.statusCode===200,`HTTP ${res.statusCode} ${body.error||body.details||""}`);
  check("duffel-has-live-offers",offers.length>0&&offers.some(o=>o.liveMode===true),`offers ${offers.length}`);
  const physicalKeys=offers.map(o=>[o.flightNumber,o.departureTime,o.arrivalTime].join("|"));
  check("duffel-no-duplicate-physical-flights",new Set(physicalKeys).size===physicalKeys.length);
  const faresOk=offers.length>0&&offers.every(o=>{
    const choices=o.fareChoices||[];
    if(!choices.length)return false;
    const amounts=choices.map(x=>Number(x.amount));
    return amounts.every(Number.isFinite)&&amounts.every((x,i)=>i===0||x>=amounts[i-1])&&Number(o.amount)===amounts[0];
  });
  check("duffel-exact-fare-choices",faresOk);
}catch(err){check("duffel-exception",false,err.message);}

// ---------- Result artifact ----------
const failed=checks.filter(x=>!x.ok);
const passed=checks.length-failed.length;
const summary={passed,failed:failed.length,total:checks.length,failures:failed};
const filename=failed.length
  ? `e2e-fail-${failed.slice(0,4).map(x=>slug(x.name+"-"+x.detail)).join("__")}.html`
  : `e2e-pass-${passed}-of-${checks.length}.html`;
fs.writeFileSync(filename,`<!doctype html><title>NexTownAir E2E</title><pre>${JSON.stringify(summary,null,2).replace(/</g,"&lt;")}</pre>`);
console.log("NEXTOWNAIR_E2E",JSON.stringify(summary));
