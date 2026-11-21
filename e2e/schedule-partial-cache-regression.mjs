import assert from 'node:assert/strict';
import handler from '../netlify/functions/schedule-proxy.mjs';

const previousFetch=globalThis.fetch;
const priorKey=process.env.AERODATABOX_API_MARKET_KEY;
process.env.AERODATABOX_API_MARKET_KEY='test-schedule-key';
const request=new Request('https://nextownair.com/api/schedule-calendar?origin=DTW&destination=ROC&month=2026-12&dates=2026-12-10');
try{
  globalThis.fetch=async()=>({status:503,ok:false,json:async()=>({message:'Upstream outage'})});
  const incomplete=await handler(request);
  const partial=await incomplete.json();
  assert.equal(incomplete.status,200,'Temporary provider outage returns partial schedule result');
  assert.equal(partial.partial,true,'Provider failure marks the date unknown');
  assert(partial.unknownDates.includes('2026-12-10'),'Unknown date is explicitly represented');
  assert.equal(incomplete.headers.get('Cache-Control'),'no-store','Partial schedule cannot be cached across an outage');
  assert.equal(incomplete.headers.get('Netlify-CDN-Cache-Control'),'no-store','CDN cannot retain partial schedule for hours');

  globalThis.fetch=async()=>({status:204,ok:true});
  const complete=await handler(request);
  const result=await complete.json();
  assert.equal(result.partial,false,'Completed upstream checks are not partial');
  assert(result.checkedDates.includes('2026-12-10'),'Successfully checked no-service date is explicitly represented');
  assert.match(complete.headers.get('Cache-Control')||'',/max-age/,'Complete schedules may use response caching');
  // A generic 429 must stop a multi-day request immediately even when the
  // upstream message does not contain a special quota-exhaustion phrase.
  let quotaCalls=0;
  globalThis.fetch=async()=>{
    quotaCalls++;
    return {status:429,ok:false,headers:{get:()=> '3600'},json:async()=>({message:'Too Many Requests'})};
  };
  const multiDay=new Request('https://nextownair.com/api/schedule-calendar?origin=DTW&destination=ROC&month=2026-12&dates=2026-12-10,2026-12-11,2026-12-12');
  const limited=await handler(multiDay);
  const quota=await limited.json();
  assert.equal(limited.status,200,'Rate limit yields a partial response instead of a stuck month');
  assert.equal(quota.partial,true,'Rate-limited dates remain unknown');
  assert.equal(quota.unknownDates.length,3,'All unattempted dates remain unknown');
  assert.equal(quota.checkedDates.length,0,'No rate-limited day is incorrectly marked checked');
  assert.equal(quotaCalls,1,'Generic 429 stops scanning dates instead of hammering the provider');
  assert.equal(limited.headers.get('Cache-Control'),'no-store','Quota failure is never CDN cached');
  console.log('PASS: Schedule failures are uncached and complete date checks remain cacheable');
}finally{
  globalThis.fetch=previousFetch;
  if(priorKey===undefined)delete process.env.AERODATABOX_API_MARKET_KEY;
  else process.env.AERODATABOX_API_MARKET_KEY=priorKey;
}
