import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../netlify/functions/flights.mjs',import.meta.url),'utf8');
const from=source.indexOf('async function searchDuffel(');
const to=source.indexOf('\nasync function handleRequest(',from);
assert(from>=0&&to>from,'Found standalone Duffel search implementation');
const offers=Array.from({length:16},(_,i)=>({
 id:'offer-'+i,live_mode:true,total_amount:String(300-i*10),total_currency:'USD',
 expires_at:'2026-12-12T00:00:00Z',
 slices:[{segments:[{
  departing_at:'2026-12-11T'+String(i+5).padStart(2,'0')+':00:00',
  arriving_at:'2026-12-11T'+String(i+6).padStart(2,'0')+':00:00',
  duration:'PT1H',
  operating_carrier:{name:'Contour Airlines',iata_code:'LF'},
  operating_carrier_flight_number:String(i+100)
 }]}]
}));
const ctx={
 process:{env:{DUFFEL_ACCESS_TOKEN:'test-only'}},
 Buffer,Date,Number,String,Map,
 validMoneyAmount:v=>v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(v))&&Number(v)>=0,
 parseIsoDuration:()=>60,
 httpsRequestJson:async()=>({data:{live_mode:true,offers}})
};
vm.createContext(ctx);
vm.runInContext(source.slice(from,to)+'\nthis.searchDuffel=searchDuffel;',ctx);
const result=await ctx.searchDuffel('BKW','CLT','2026-12-11');
assert.equal(result.offers.length,12,'Response stays bounded at 12 distinct flights');
assert.equal(Math.min(...result.offers.map(x=>x.fare.amount)),150,'Lowest priced late flight must survive result cap');
assert(!result.offers.some(x=>x.fare.status!=='verified'),'Only mocked live offers marked verified');
assert.equal(result.offers.find(x=>x.fare.amount===150).flightNumber,'LF115');
assert.equal(result.offers[0].flightNumber,'LF104','Returned flight groups remain chronological');
console.log('PASS: Duffel selection preserves lowest fare across 16 flights while returning 12 chronologically');
