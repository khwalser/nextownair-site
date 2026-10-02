import fs from "node:fs";
import {createRequire} from "node:module";
import scheduleHandler from "../netlify/functions/schedule-proxy.mjs";
const require=createRequire(import.meta.url);
const flightProxy=require("../netlify/functions/flight-proxy.js");

function ymd(d){return d.toISOString().slice(0,10);}
function addDays(d,n){const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x;}

let base=addDays(new Date(),1);
if(base.getUTCDate()>26)base=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+1,1,12));
const dates=[0,1].map(n=>ymd(addDays(base,n)));
const month=dates[0].slice(0,7);
const failures=[];

const itinerary=fs.readFileSync("itinerary.js","utf8");
try{new Function(itinerary);}catch(e){failures.push("itinerary syntax: "+e.message);}
if(!itinerary.includes("function calendarFareText"))failures.push("calendar fare formatter missing");
if(!itinerary.includes("queueCalendarFarePricing"))failures.push("calendar fare queue missing");
if(!itinerary.includes("fetchFare(req.a,req.b,req.date,true)"))failures.push("itinerary fare priority missing");
if(!itinerary.includes("Lowest live fares:"))failures.push("calendar price progress missing");

let scheduleBody=null;
try{
  const req=new Request(`https://smoke.local/api/schedule-calendar?origin=DTW&destination=ORD&month=${month}&dates=${dates.join(",")}`);
  const res=await scheduleHandler(req);
  scheduleBody=await res.json();
  if(!res.ok)failures.push(`schedule HTTP ${res.status}: ${scheduleBody.error||scheduleBody.message||""}`);
  if((scheduleBody.unknownDates||[]).length)failures.push("schedule dates incomplete");
}catch(e){failures.push("schedule exception: "+e.message);}

const priced=[];
for(const date of dates){
  try{
    const res=await flightProxy.handler({httpMethod:"GET",queryStringParameters:{origin:"DTW",destination:"ORD",date}});
    const body=JSON.parse(res.body||"{}");
    if(res.statusCode!==200){failures.push(`Duffel ${date} HTTP ${res.statusCode}`);continue;}
    const offers=body.offers||[];
    if(!offers.length){failures.push(`Duffel ${date} returned no offers`);continue;}
    const lowest=offers.reduce((best,o)=>!best||Number(o.amount)<Number(best.amount)?o:best,null);
    if(!lowest||!Number.isFinite(Number(lowest.amount)))failures.push(`Duffel ${date} missing lowest amount`);
    else priced.push({date,amount:lowest.amount,currency:lowest.currency,flights:offers.length});
  }catch(e){failures.push(`Duffel ${date}: ${e.message}`);}
}

const ok=failures.length===0;
const result={ok,dates,priced,scheduleChecked:(scheduleBody?.checkedDates||[]).length,failures};
const name=ok?`calendar-price-pass-${priced.length}-dates.html`:`calendar-price-fail-${failures.length}.html`;
fs.writeFileSync(name,`<!doctype html><title>calendar price smoke</title><pre>${JSON.stringify(result,null,2)}</pre>`);
console.log("CALENDAR_PRICE_SMOKE",JSON.stringify(result));
