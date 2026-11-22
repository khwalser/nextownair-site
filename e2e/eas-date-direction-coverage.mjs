import assert from 'node:assert/strict';
const base=(process.env.E2E_BASE_URL||'https://nextownair.com').replace(/\/$/,'');
const routes=[['LEB','BOS','Cape Air'],['ESC','DTW','Delta Connection']];
const dates=['2026-12-07','2026-12-13','2026-12-18'];
const records=[];
for(const [origin,destination,modeledCarrier] of routes){
 for(const [a,b] of [[origin,destination],[destination,origin]]){
  for(const date of dates){
   const url=base+'/api/flights?'+new URLSearchParams({origin:a,destination:b,date});
   try{
    const response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(25000)});
    const data=await response.json();
    const offers=Array.isArray(data.offers)?data.offers:[];
    const verified=offers.filter(o=>o.liveMode===true&&o.fare?.status==='verified');
    records.push({route:a+'-'+b,modeledCarrier,date,status:response.status,offerCount:offers.length,verifiedFareCount:verified.length,carriers:[...new Set(offers.map(o=>o.operatingCarrier).filter(Boolean))],error:!response.ok?data.error||'HTTP '+response.status:null});
   }catch(error){records.push({route:a+'-'+b,date,error:String(error.message||error)});}
   console.log(JSON.stringify(records.at(-1)));
  }
 }
}
const complete=records.filter(r=>r.status===200);
console.log('SUMMARY '+JSON.stringify({checkedAt:new Date().toISOString(),queries:records.length,successfulQueries:complete.length,queriesWithVerifiedFares:records.filter(r=>r.verifiedFareCount>0).length,errors:records.filter(r=>r.error).length}));
assert(complete.length>=1,'Production API must respond with JSON at least once');
