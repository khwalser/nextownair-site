import fs from "node:fs";
import handler from "../netlify/functions/schedule-proxy.mjs";

const dates=["2026-10-02","2026-10-03","2026-10-04","2026-10-05"];
const req=new Request("https://smoke.local/api/schedule-calendar?origin=DTW&destination=ROC&month=2026-10&dates="+dates.join(","));
const started=Date.now();
let result={};
try{
  const res=await handler(req);
  const body=await res.json();
  result={
    status:res.status,
    elapsed:Date.now()-started,
    checked:body.checkedDates||[],
    unknown:body.unknownDates||[],
    days:body.days||{},
    error:body.error||null,
    message:body.message||null,
    upstream:body.lastUpstreamError||null,
    partial:body.partial||false
  };
}catch(err){
  result={status:0,elapsed:Date.now()-started,error:String(err?.message||err)};
}
function slug(s){return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,100);}
const ok=result.status===200&&result.checked.length===dates.length&&result.unknown.length===0;
const detail=result.upstream?slug((result.upstream.status||"")+"-"+(result.upstream.message||"")):slug(result.error||result.message||"");
const name=ok
  ? `roc-schedule-pass-checked${result.checked.length}-unknown${result.unknown.length}.html`
  : `roc-schedule-fail-http${result.status}-checked${result.checked?.length||0}-unknown${result.unknown?.length||0}-${detail||"error"}.html`;
fs.writeFileSync(name,`<!doctype html><title>ROC schedule smoke</title><pre>${JSON.stringify(result,null,2)}</pre>`);
console.log("ROC_SCHEDULE_SMOKE",JSON.stringify(result));
