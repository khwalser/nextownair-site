import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const raw=fs.readFileSync(new URL('../data.js',import.meta.url),'utf8');
const itinerary=fs.readFileSync(new URL('../itinerary.js',import.meta.url),'utf8');
const ledger=JSON.parse(fs.readFileSync(new URL('../data/eas-schedule-evidence-gap.json',import.meta.url),'utf8'));
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(raw,ctx);
const D=ctx.window.NTA_DATA;
const key=(a,b)=>[a,b].sort().join('|');
const covered=new Set(Object.keys(D.servicePatterns||{}).map(k=>key(...k.split('|'))));
for(const match of itinerary.matchAll(/'([A-Z]{3}\|[A-Z]{3})':\{days:/g))covered.add(key(...match[1].split('|')));
const pairs=new Map();
for(const a of D.airports.filter(a=>a.type==='eas'))
  for(const hub of a.hubs||[])pairs.set(key(a.code,hub),{code:a.code,hub});
const expected=new Set([...pairs.keys()].filter(k=>!covered.has(k)));
assert.equal(pairs.size,225,'Audited EAS route model has 225 pairs');
assert.equal(ledger.missingDayPatterns,expected.size,'Gap count is reproducible');
assert.equal(ledger.missing.length,expected.size,'Every unverified schedule is listed exactly once');
const seen=new Set();
for(const entry of ledger.missing){
  const pair=key(entry.communityCode,entry.hub);
  assert(expected.has(pair),'Ledger must not include a service-day-verified or non-EAS pair: '+pair);
  assert(!seen.has(pair),'Duplicate ledger entry '+pair);
  seen.add(pair);
  assert.equal(entry.scheduleDayEvidence,'not_verified','Contract route must never masquerade as verified day schedule');
  assert.equal(entry.futureTravelDateConfirmed,false,'No invented date-specific availability');
  assert(/^https:\/\//.test(entry.contractSource),'Each route references a dated public EAS report');
}
assert.equal(seen.size,expected.size);
console.log('PASS: '+ledger.missing.length+' EAS operating-day evidence gaps individually tracked; no fabricated schedule dates');
