import assert from 'node:assert/strict';

const base=(process.env.E2E_BASE_URL||'https://nextownair.com').replace(/\/$/,'');
async function fetchWithTransportRetry(url,date){
  let error;
  for(let attempt=0;attempt<3;attempt++){
    try{
      // An occasional cold Netlify edge or network timeout should not turn a
      // verified HTTP-400 validation assertion into a false CI failure.
      return await fetch(url,{signal:AbortSignal.timeout(20000),headers:{Accept:'application/json'}});
    }catch(err){
      error=err;
      if(attempt===2)break;
      console.warn('WARN: Transient production transport error for '+date+'; retry '+(attempt+1));
      await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
    }
  }
  throw new Error('Production input validation request failed after three network attempts for '+date,{cause:error});
}
for(const date of ['2026-02-29','2026-02-31','2026-13-01','2026-11-00']){
  const query=new URLSearchParams({origin:'DTW',destination:'ROC',date});
  const response=await fetchWithTransportRetry(base+'/api/flights?'+query,date);
  assert.equal(response.status,400,'Production API must reject impossible date '+date);
  const body=await response.json();
  assert.match(String(body.error||''),/three-letter|date/i,'Production API must describe the invalid input');
  console.log('PASS: Production API rejects invalid departure date '+date);
}
console.log('PASS: Production fare API validates calendar dates without calling the fare provider');
