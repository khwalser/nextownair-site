import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../data.js',import.meta.url),'utf8');
const context={window:{}};
vm.createContext(context);
vm.runInContext(source,context);
const D=context.window.NTA_DATA;
const pair=(a,b)=>[a,b].sort().join('|');
const known=new Set([...(D.routes||[]),...(D.backboneRoutes||[])].map(([a,b])=>pair(a,b)));
for(const [a,b] of [['MKK','HNL'],['MKK','OGG'],['HPN','ORD']]){
  assert(known.has(pair(a,b)),a+' → '+b+' must be a documented nonstop link');
  assert(D.routeVerification.backboneSources.some(s=>s.verifiedPairs?.includes(a+'-'+b)&&/^https:\/\//.test(s.url)),a+'-'+b+' needs an explicit evidence URL');
}
assert.equal(D.routeVerification.backboneRoutePairs,D.backboneRoutes.length);
const transfer=D.transferEdges.find(e=>pair(e.from,e.to)===pair('MRI','ANC'));
assert(transfer,'Merrill Field ↔ Anchorage International must be explicitly transferred');
assert.equal(transfer.mode,'ground','MRI ↔ ANC is a road transfer, never a flight');
assert.equal(transfer.durationStatus,'prototype','45 minute allowance is not a sourced guaranteed transfer duration');
assert(/^https:\/\//.test(transfer.sourceUrl),'Ground transfer includes the source URL');
assert(!known.has(pair('MRI','ANC')),'MRI ↔ ANC must not be mislabeled as a nonstop flight');
assert.equal(D.routeVerification.transferEdgePairs,D.transferEdges.length);
for(const hub of ['MKK','HPN','MRI']){
  const outward=[...(D.routes||[]),...(D.backboneRoutes||[]),...(D.transferEdges||[]).map(e=>[e.from,e.to])].filter(pair=>pair.includes(hub)).map(pair=>pair.find(code=>code!==hub));
  assert(outward.some(code=>D.airports.find(a=>a.code===code)?.type!=='eas'),'Hub '+hub+' must have a legitimate non-EAS onward connection');
}
console.log('PASS: All three flagged hubs have evidence-backed onward links, with MRI–ANC identified as a road transfer');
