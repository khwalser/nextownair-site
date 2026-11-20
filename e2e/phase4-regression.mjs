import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../itinerary.js',import.meta.url),'utf8');
function extract(start,next){
  const i=source.indexOf('  function '+start+'(');
  const j=source.indexOf('  function '+next+'(',i+1);
  assert(i>=0&&j>i,'Could not locate production '+start+' function');
  return source.slice(i,j);
}
const snippets=[
  extract('stableHash','serviceCountForDate'),
  extract('deterministicPrototypeFare','scheduleOptions'),
  extract('prototypeOptions','fareKey')
].join('\n');
let count=2;
const context={
  Math,
  serviceCountForDate:()=>count,
  estimatedFlightMinutes:()=>95,
  servicePatternStops:()=>[],
};
vm.createContext(context);
vm.runInContext(snippets+'\nthis.api={stableHash,deterministicPrototypeFare,prototypeOptions};',context);
const {deterministicPrototypeFare,prototypeOptions}=context.api;
const date='2026-12-08';
const first=prototypeOptions('DTW','ROC',date);
assert.equal(first.length,2,'Established service creates the expected number of options');
assert.deepEqual(JSON.parse(JSON.stringify(first)),JSON.parse(JSON.stringify(prototypeOptions('DTW','ROC',date))),'Repeated generation is stable');
assert.deepEqual(JSON.parse(JSON.stringify(first)),JSON.parse(JSON.stringify(vm.runInContext("api.prototypeOptions('DTW','ROC','2026-12-08')",context))),'Independent evaluation is stable');
for(const [i,o] of first.entries()){
  assert.equal(o.prototype,true);
  assert.equal(o.timeStatus,'prototype');
  assert.equal(o.fareStatus,'prototype');
  assert.equal(o.provider,'nta-prototype');
  assert.equal(o.price,deterministicPrototypeFare('DTW','ROC',date,i));
  assert(o.price>=75&&Number.isFinite(o.price));
  assert(o.departMin>=330&&o.departMin<=1320);
  assert(o.arrivalMin>=0&&o.arrivalMin<1440);
  assert(o.duration>0);
}
count=0;
assert.equal(prototypeOptions('DTW','ROC',date).length,0,'No known service must never produce invented flights');
count=2;
assert.notDeepEqual(JSON.parse(JSON.stringify(first.map(o=>o.id))),JSON.parse(JSON.stringify(prototypeOptions('ROC','DTW',date).map(o=>o.id))),'Opposite directions retain distinct service identities');
console.log('PASS: Phase 4 deterministic prototype regression (repeatability, status, bounds, and no invented service)');
