import fs from 'node:fs';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../netlify/functions/schedule-proxy.mjs',import.meta.url),'utf8');
const {default:handler}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const originalFetch=globalThis.fetch;
const originalNetlify=globalThis.Netlify;
const calls=[];
try{
  globalThis.Netlify={env:{get:()=> 'test-key'}};
  globalThis.fetch=async url=>{
    calls.push(String(url));
    const afternoon=String(url).includes('T12%3A00');
    const local=afternoon?'2026-12-03T15:00:00':'2026-12-03T08:00:00';
    const arrival=afternoon?'2026-12-03T16:05:00':'2026-12-03T09:05:00';
    return new Response(JSON.stringify({departures:[{
      number:afternoon?'AA200':'AA100',
      airline:{name:'Test Airline'},
      departure:{scheduledTime:{local}},
      arrival:{airport:{iata:'ORD'},scheduledTime:{local:arrival}}
    }]}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const response=await handler(new Request('https://nextownair.com/api/schedule-calendar?origin=DTW&destination=ORD&month=2026-12&dates=2026-12-03'));
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(calls.length,2,'Both halves of the calendar date are queried');
  assert.equal(data.days['2026-12-03'].count,2,'AM and PM flights both appear on the service date');
  assert.deepEqual(data.days['2026-12-03'].flights.map(f=>f.ident).sort(),['AA100','AA200']);
  assert.deepEqual(data.checkedDates,['2026-12-03']);
  assert.deepEqual(data.unknownDates,[]);
  console.log('PASS: Published schedule collects AM and PM flights for complete daily coverage');
}finally{
  globalThis.fetch=originalFetch;
  if(originalNetlify===undefined)delete globalThis.Netlify;else globalThis.Netlify=originalNetlify;
}
