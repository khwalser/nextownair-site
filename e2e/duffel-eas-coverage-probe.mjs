// Limited, real production API coverage sample. This is not a carrier-access
// certification; empty offers do not prove a published route has no flights.
import assert from 'node:assert/strict';
const base=(process.env.E2E_BASE_URL||'https://nextownair.com').replace(/\/$/,'');
const date=process.env.E2E_DATE||new Date(Date.now()+21*86400000).toISOString().slice(0,10);
const pairs=[
 {a:'BKW',b:'CLT',carrier:'Contour Airlines'},
 {a:'LEB',b:'BOS',carrier:'Cape Air'},
 {a:'BFD',b:'PIT',carrier:'Southern Airways Express'},
 {a:'ESC',b:'DTW',carrier:'Delta Connection'}
];
const results=[];
for(const {a,b,carrier} of pairs){
 const query=new URLSearchParams({origin:a,destination:b,date});
 try{
  const response=await fetch(base+'/api/flights?'+query,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(28000)});
  const payload=await response.json();
  const offers=Array.isArray(payload?.offers)?payload.offers:[];
  const priced=offers.filter(o=>o?.fare?.status==='verified'&&typeof o.fare.amount==='number'&&Number.isFinite(o.fare.amount));
  const operatingCarriers=[...new Set(offers.map(o=>o.operatingCarrier).filter(Boolean))];
  const row={route:a+'-'+b,modeledCarrier:carrier,date,httpStatus:response.status,
    apiProvider:payload?.sourceProvider||null,offerCount:offers.length,
    verifiedFareCount:priced.length,operatingCarriers,
    lowestVerifiedFare:priced.length?Math.min(...priced.map(o=>o.fare.amount)):null,
    error:!response.ok?(payload?.error||'HTTP '+response.status):null};
  results.push(row);
  assert(!offers.some(o=>o.fare?.status==='verified'&&!o.liveMode),'No prototype offers classified live');
  console.log(JSON.stringify(row));
 }catch(err){
  results.push({route:a+'-'+b,date,transportError:String(err.message||err)});
  console.error('AUDIT: '+a+'-'+b+' transport failure '+String(err.message||err));
 }
}
const summary={checkedAt:new Date().toISOString(),date,pairs:results.length,
 withVerifiedLiveFare:results.filter(r=>r.verifiedFareCount>0).length,
 zeroOffers:results.filter(r=>r.httpStatus===200&&r.offerCount===0).length,
 errors:results.filter(r=>r.error||r.transportError).length};
console.log('SUMMARY '+JSON.stringify(summary));
assert(results.some(r=>r.httpStatus===200),'At least one production API request must complete successfully');
