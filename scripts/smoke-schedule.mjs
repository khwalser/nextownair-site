import handler from "../netlify/functions/schedule-proxy.mjs";

function ymd(d){
  return d.toISOString().slice(0,10);
}
function addDays(d,n){
  const x=new Date(d);
  x.setUTCDate(x.getUTCDate()+n);
  return x;
}

const base=addDays(new Date(),1);
const dates=[0,1,2,3].map(n=>ymd(addDays(base,n)));
const month=dates[0].slice(0,7);

const req=new Request(`https://smoke.local/api/schedule-calendar?origin=DTW&destination=ORD&month=${month}&dates=${dates.join(",")}`);
const started=Date.now();
const res=await handler(req);
const body=await res.json();
const elapsed=Date.now()-started;

if(!res.ok){
  throw new Error(`schedule smoke failed HTTP ${res.status}: ${body.error||body.message||"unknown"}`);
}
const checked=new Set(body.checkedDates||[]);
const unknown=new Set(body.unknownDates||[]);
const missing=dates.filter(d=>!checked.has(d));
const incomplete=dates.filter(d=>unknown.has(d));

if(missing.length||incomplete.length){
  throw new Error(`schedule smoke incomplete: checked=${[...checked].join(",")} unknown=${[...unknown].join(",")} last=${body.lastUpstreamError?.status||""} ${body.lastUpstreamError?.message||""}`);
}
if(elapsed>25000){
  throw new Error(`schedule smoke too slow: ${elapsed}ms`);
}

const flightDays=Object.values(body.days||{}).filter(x=>x&&x.count>0).length;
console.log(`Schedule smoke passed: ${dates.length} dates checked in ${elapsed}ms; ${flightDays} dates returned DTW→ORD flights.`);
