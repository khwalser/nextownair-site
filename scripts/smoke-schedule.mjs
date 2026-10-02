import fs from "node:fs";
import handler from "../netlify/functions/schedule-proxy.mjs";

function ymd(d){ return d.toISOString().slice(0,10); }
function addDays(d,n){ const x=new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; }
function esc(s){ return String(s).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch])); }

let result={ok:false,message:"Smoke test did not run"};
try{
  const base=addDays(new Date(),1);
  const dates=[0,1,2,3].map(n=>ymd(addDays(base,n)));
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
    message:res.ok
      ? `HTTP ${res.status}; checked ${checked.size}/${dates.length}; unknown ${unknown.size}; flight-days ${flightDays}; ${elapsed}ms`
      : `HTTP ${res.status}; ${body.error||body.message||"unknown error"}`,
    detail:body.lastUpstreamError? `${body.lastUpstreamError.status||""} ${body.lastUpstreamError.message||""}` : ""
  };
}catch(err){
  result={ok:false,message:String(err?.message||err),detail:""};
}

const indexPath="index.html";
let html=fs.readFileSync(indexPath,"utf8");
const tone=result.ok?"#0b5":"#b44";
const banner=`<div id="schedule-smoke-banner" style="position:relative;z-index:99999;padding:10px 16px;background:${tone};color:white;font:700 14px/1.4 system-ui">Schedule smoke ${result.ok?"PASS":"FAIL"} · ${esc(result.message)}${result.detail?" · "+esc(result.detail):""}</div>`;
html=html.replace("<body>","<body>"+banner);
fs.writeFileSync(indexPath,html);
console.log("SCHEDULE_SMOKE_RESULT",JSON.stringify(result));
