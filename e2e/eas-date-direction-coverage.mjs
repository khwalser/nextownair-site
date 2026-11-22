// Read-only sampling of live Duffel offers; 429 means unknown, never "no service".
import assert from 'node:assert/strict';

const base=(process.env.E2E_BASE_URL||'https://nextownair.com').replace(/\/$/,'');
const routes=[['LEB','BOS','Cape Air'],['ESC','DTW','Delta Connection']];
const dates=['2026-12-07','2026-12-13','2026-12-18'];
const maxRequests=Math.min(4,Math.max(1,Number(process.env.E2E_MAX_REQUESTS)||4));
// Interleave carriers so the small request budget checks both airlines.
const candidates=dates.flatMap(date=>routes.flatMap(([a,b,carrier])=>[
 {a,b,carrier,date},{a:b,b:a,carrier,date}
]));
const records=[];
let blocked=null;
for(const {a,b,carrier,date} of candidates.slice(0,maxRequests)){
 const url=base+'/api/flights?'+new URLSearchParams({origin:a,destination:b,date});
 try{
  const response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(25000)});
  const payload=await response.json();
  if(response.status===429){
   blocked={reason:'provider_rate_limit',retryAfterMs:payload.retryAfterMs??null,resetAt:payload.resetAt??null};
   records.push({route:a+'-'+b,date,status:429,result:'not_checked_rate_limited'});
   console.log('BLOCKED '+JSON.stringify(blocked));
   break; // never waste remaining allowance or report false zero offers
  }
  const offers=Array.isArray(payload.offers)?payload.offers:[];
  const live=offers.filter(o=>o.liveMode===true&&o.fare?.status==='verified');
  records.push({route:a+'-'+b,modeledCarrier:carrier,date,status:response.status,
   result:response.ok?(live.length?'verified_offers':'no_offers_returned'):'provider_error',
   offerCount:offers.length,verifiedFareCount:live.length,
   carriers:[...new Set(offers.map(o=>o.operatingCarrier).filter(Boolean))],
   error:!response.ok?payload.error||'HTTP '+response.status:null});
 }catch(e){
  records.push({route:a+'-'+b,date,result:'transport_error',error:String(e.message||e)});
 }
 console.log(JSON.stringify(records.at(-1)));
 // Do not launch a burst of requests against the shared calendar quota.
 if(records.length<maxRequests)await new Promise(resolve=>setTimeout(resolve,3000));
}
const successful=records.filter(r=>r.status===200);
const summary={
 checkedAt:new Date().toISOString(),
 requests:records.length, planned:candidates.length,
 status:blocked?'blocked_rate_limited':successful.length?'partial_evidence':'inconclusive',
 verifiedFareResults:records.filter(r=>r.verifiedFareCount>0).length,
 zeroOfferResults:records.filter(r=>r.result==='no_offers_returned').length,
 blocked,records
};
console.log('SUMMARY '+JSON.stringify(summary));
assert(records.length<=maxRequests,'Audit request budget enforced');
// This is a diagnostic: blocked-rate-limit is not "no inventory" and is NOT
// sufficient evidence to close any provider coverage ticket.
