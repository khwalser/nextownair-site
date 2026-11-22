import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../netlify/functions/flights.mjs',import.meta.url),'utf8');
assert.match(src,/supplier_timeout=18000/,'Duffel supplier window is 18 seconds');
assert.match(src,/req\.setTimeout\(23000/,'Upstream transport window is 23 seconds');
const a=src.indexOf('async function searchDuffel('), b=src.indexOf('\nasync function handleRequest(',a);
assert(a>=0&&b>a);
const requests=[];
const samples=[
 {id:'normal',total_amount:'109',live_mode:true,slices:[{segments:[{departing_at:'2026-12-13T09:00:00',arriving_at:'2026-12-13T10:00:00',operating_carrier:{name:'Cape Air',iata_code:'9K'},operating_carrier_flight_number:'123'}]}]},
 {id:'indirect',total_amount:'120',live_mode:true,slices:[{segments:[{},{},]}]},
 {id:'unpriced',total_amount:null,live_mode:true,slices:[{segments:[{departing_at:'2026-12-13T11:00:00',arriving_at:'2026-12-13T12:00:00'}]}]}
];
const ctx={process:{env:{DUFFEL_ACCESS_TOKEN:'mock-token'}},Buffer,Number,Map,Date,String,
 validMoneyAmount:v=>v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(v))&&Number(v)>=0,
 parseIsoDuration:()=>60,
 httpsRequestJson:async(options,body)=>{requests.push({options,body});return {data:{live_mode:true,offers:samples}};}
};
vm.createContext(ctx);
vm.runInContext(src.slice(a,b)+'\nthis.searchDuffel=searchDuffel;',ctx);
const result=await ctx.searchDuffel('LEB','BOS','2026-12-13');
assert.equal(requests.length,1);
assert.match(requests[0].options.path,/supplier_timeout=18000/);
assert.equal(JSON.parse(requests[0].body).data.max_connections,0);
assert.equal(result.offers.length,1);
assert.equal(result.offers[0].fare.amount,109);
assert.equal(result.coverageDiagnostics.upstreamOfferCount,3);
assert.equal(result.coverageDiagnostics.connectingOffersExcluded,1);
assert.equal(result.coverageDiagnostics.missingFareOffersExcluded,1);
assert.equal(result.coverageDiagnostics.directPricedOfferCount,1);
assert.equal(result.coverageDiagnostics.distinctFlightCount,1);
samples.length=0;
const empty=await ctx.searchDuffel('ESC','DTW','2026-12-13');
assert.equal(empty.coverageDiagnostics.upstreamOfferCount,0);
assert.equal(empty.coverageDiagnostics.distinctFlightCount,0);
console.log('PASS: 18s supplier search, 23s transport, nonstop guard, and sanitized coverage diagnostics');
