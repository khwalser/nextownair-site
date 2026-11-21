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
const capeOut=D.servicePatterns['LEB|HPN'],capeBack=D.servicePatterns['HPN|LEB'];
assert(capeOut&&capeBack,'Both Lebanon–Westchester directions have documented operating-day patterns');
for(const p of [capeOut,capeBack]){
  assert.deepEqual([...p.days].sort((a,b)=>a-b),[0,1,2,3,4,5,6],'Only explicitly sourced daily operating days are used');
  assert.equal(p.activeFrom,'2026-11-21');
  assert.equal(p.activeThrough,'2026-12-31','Published-day fallback does not continue indefinitely');
  assert(/^https:\/\//.test(p.sourceUrl),'Daily schedule needs direct source');
}
assert(!ledger.missing.some(x=>x.pair==='LEB-HPN'),'Verified timetable no longer incorrectly listed as a coverage gap');

// The newly sourced MSP spoke patterns have a documented operating-day window.
// They must not imply year-round service based on a single observed week.
for(const [community,airline] of [['ABR','Delta Air Lines'],['BJI','Delta Air Lines'],['BRD','Delta Air Lines'],['RHI','Delta Air Lines'],['INL','Delta Air Lines'],['TVF','Denver Air Connection']]){
  const pair=[community,'MSP'].sort().join('-');
  assert(!ledger.missing.some(e=>e.pair===pair),'Documented pair '+pair+' is no longer in unverified register');
  for(const [from,to] of [[community,'MSP'],['MSP',community]]){
    const pattern=D.servicePatterns[from+'|'+to];
    assert(pattern,'Missing direction '+from+' → '+to);
    assert.equal(pattern.activeFrom,'2026-11-23');
    assert.equal(pattern.verifiedWeekEnd,'2026-11-29');
    assert.equal(pattern.airline,airline);
    assert.deepEqual([...pattern.days],[0,1,2,3,4,5,6]);
    assert(/^https:\/\//.test(pattern.sourceUrl),'Source link required for each direction');
    assert.equal(pattern.activeThrough,community==='TVF'?(from==='TVF'?'2027-01-21':'2027-01-30'):'2026-11-29','Do not extrapolate dates beyond sourced period');
  }
}
console.log('PASS: '+ledger.missing.length+' EAS operating-day evidence gaps individually tracked; no fabricated schedule dates');
