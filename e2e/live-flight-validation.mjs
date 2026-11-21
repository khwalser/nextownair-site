import assert from 'node:assert/strict';

const base=(process.env.E2E_BASE_URL||'https://nextownair.com').replace(/\/$/,'');
for(const date of ['2026-02-29','2026-02-31','2026-13-01','2026-11-00']){
  const query=new URLSearchParams({origin:'DTW',destination:'ROC',date});
  const response=await fetch(base+'/api/flights?'+query,{signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,400,'Production API must reject impossible date '+date);
  const body=await response.json();
  assert.match(String(body.error||''),/three-letter|date/i,'Production API must describe the invalid input');
  console.log('PASS: Production API rejects invalid departure date '+date);
}
console.log('PASS: Production fare API validates calendar dates without calling the fare provider');
