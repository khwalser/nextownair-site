import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const flightProxy=require("../netlify/functions/flight-proxy.js");

function ymd(d){return d.toISOString().slice(0,10);}
function addDays(d,n){const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x;}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

const itinerary=fs.readFileSync("itinerary.js","utf8");
const staticChecks={
  syntax:true,
  cooldown:itinerary.includes("fareBlockedUntil"),
  autoResume:itinerary.includes("pricing resumes automatically"),
  queuedState:itinerary.includes("?'queued':'scheduled'")||itinerary.includes("?\'queued\':\'scheduled\'"),
  sustainablePacing:itinerary.includes("FARE_START_GAP_MS=1250")&&itinerary.includes("FARE_MAX_CONCURRENT=2")
};
try{new Function(itinerary);}catch(_){staticChecks.syntax=false;}

let base=new Date();base.setUTCHours(12,0,0,0);
if(base.getUTCDate()>24)base=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+1,1,12));
const dates=Array.from({length:12},(_,i)=>ymd(addDays(base,i)));

const results=[];
let nextIndex=0,lastStart=0;
async function worker(){
  while(true){
    const idx=nextIndex++;
    if(idx>=dates.length)return;
    const date=dates[idx];
    const gap=Math.max(0,lastStart+1250-Date.now());
    if(gap)await sleep(gap);
    lastStart=Date.now();
    const res=await flightProxy.handler({httpMethod:"GET",queryStringParameters:{origin:"DTW",destination:"ORD",date}});
    let body={};try{body=JSON.parse(res.body||"{}");}catch{}
    results.push({
      date,status:res.statusCode,error:body.error||null,
      retryAfterMs:Number(body.retryAfterMs||0),
      retryAfterHeader:res.headers?.["Retry-After"]||res.headers?.["retry-after"]||null,
      offers:(body.offers||[]).length
    });
  }
}
await Promise.all([worker(),worker()]);
results.sort((a,b)=>a.date.localeCompare(b.date));

const unexpected=results.filter(r=>![200,429].includes(r.status));
const bad429=results.filter(r=>r.status===429&&(r.error!=="pricing_rate_limited"||!(r.retryAfterMs>0)||!r.retryAfterHeader));
const ok=Object.values(staticChecks).every(Boolean)&&unexpected.length===0&&bad429.length===0&&results.some(r=>r.status===200);
const summary={
  ok,staticChecks,total:results.length,
  ok200:results.filter(r=>r.status===200).length,
  rateLimited429:results.filter(r=>r.status===429).length,
  unexpected,bad429,
  sample:results.slice(0,6)
};
const name=ok?`calendar-rate-limit-pass-${summary.ok200}-ok-${summary.rateLimited429}-rate-limited.html`:`calendar-rate-limit-fail-${unexpected.length+bad429.length}.html`;
fs.writeFileSync(name,`<!doctype html><title>calendar rate limit smoke</title><pre>${JSON.stringify(summary,null,2)}</pre>`);
console.log("CALENDAR_RATE_LIMIT_SMOKE",JSON.stringify(summary));
