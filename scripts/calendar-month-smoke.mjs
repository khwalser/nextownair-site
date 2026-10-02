import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const flightProxy=require("../netlify/functions/flight-proxy.js");

function ymd(d){return d.toISOString().slice(0,10);}
function addDays(d,n){const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x;}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

let base=new Date();
base.setUTCHours(12,0,0,0);
if(base.getUTCDate()>26)base=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+1,1,12));
const month=base.getUTCMonth();
const dates=[];
for(let i=0;i<31;i++){
  const d=addDays(base,i);
  if(d.getUTCMonth()!==month)break;
  dates.push(ymd(d));
}

const results=[];
let nextIndex=0;
let lastStart=0;
async function worker(){
  while(true){
    const idx=nextIndex++;
    if(idx>=dates.length)return;
    const date=dates[idx];
    const gap=Math.max(0,lastStart+1250-Date.now());
    if(gap)await sleep(gap);
    lastStart=Date.now();
    const started=Date.now();
    try{
      const res=await flightProxy.handler({httpMethod:"GET",queryStringParameters:{origin:"DTW",destination:"ORD",date}});
      const body=JSON.parse(res.body||"{}");
      const offers=body.offers||[];
      const lowest=offers.reduce((best,o)=>!best||Number(o.amount)<Number(best.amount)?o:best,null);
      results.push({date,status:res.statusCode,offers:offers.length,lowest:lowest?Number(lowest.amount):null,currency:lowest?.currency||null,ms:Date.now()-started,error:body.error||body.details||null});
    }catch(err){
      results.push({date,status:0,offers:0,lowest:null,ms:Date.now()-started,error:String(err?.message||err)});
    }
  }
}
await Promise.all([worker(),worker()]);
results.sort((a,b)=>a.date.localeCompare(b.date));
const hardFailures=results.filter(r=>r.status!==200);
const priced=results.filter(r=>Number.isFinite(r.lowest));
const noOffers=results.filter(r=>r.status===200&&!Number.isFinite(r.lowest));
const result={dates:dates.length,priced:priced.length,noOffers:noOffers.length,hardFailures:hardFailures.length,failures:hardFailures.slice(0,10),sample:results.slice(0,6)};
const ok=hardFailures.length===0&&priced.length>0;
const name=ok?`calendar-month-pass-${priced.length}-of-${dates.length}.html`:`calendar-month-fail-${hardFailures.length}-status-${hardFailures[0]?.status||0}.html`;
fs.writeFileSync(name,`<!doctype html><title>calendar month smoke</title><pre>${JSON.stringify(result,null,2)}</pre>`);
console.log("CALENDAR_MONTH_SMOKE",JSON.stringify(result));
