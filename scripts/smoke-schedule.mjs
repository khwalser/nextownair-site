import fs from "node:fs";
import handler from "../netlify/functions/schedule-proxy.mjs";

function ymd(d){ return d.toISOString().slice(0,10); }
function addDays(d,n){ const x=new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; }
function slug(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60); }

let result={ok:false,status:0,checked:0,unknown:0,flightDays:0,elapsed:0,upstreamStatus:0,error:"not-run"};
try{
  const base=addDays(new Date(),1);
  const dates=[0,7,14,21].map(n=>ymd(addDays(base,n)));
  const month=dates[0].slice(0,7);
  const req=new Request(`https://smoke.local/api/schedule-calendar?origin=DTW&destination=ORD&month=${month}&dates=${dates.join(",")}`);
  const started=Date.now();
  const res=await handler(req);
  const body=await res.json();
  const elapsed=Date.now()-started;
  const checked=new Set(body.checkedDates||[]);
  const unknown=new Set(body.unknownDates||[]);
  const missing=dates.filter(d=>!checked.has(d));
  const incomplete=dates.filter(d=>unknown.has(d));
  const flightDays=Object.values(body.days||{}).filter(x=>x&&x.count>0).length;
  result={
    ok:res.ok&&!missing.length&&!incomplete.length,
    status:res.status,
    checked:checked.size,
    unknown:unknown.size,
    flightDays,
    elapsed,
    upstreamStatus:Number(body.lastUpstreamError?.status||0),
    error:body.error||body.message||body.lastUpstreamError?.message||""
  };
}catch(err){
  result.error=String(err?.message||err);
}

const name=result.ok
  ? `smoke-pass-http${result.status}-checked${result.checked}-unknown${result.unknown}-flightdays${result.flightDays}-ms${result.elapsed}.html`
  : `smoke-fail-http${result.status}-checked${result.checked}-unknown${result.unknown}-upstream${result.upstreamStatus}-${slug(result.error)||"error"}.html`;
fs.writeFileSync(name,`<!doctype html><title>schedule smoke</title><pre>${JSON.stringify(result,null,2)}</pre>`);
console.log("SCHEDULE_SMOKE_RESULT",JSON.stringify(result));
