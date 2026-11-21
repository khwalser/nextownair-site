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
for(const direction of ['BKW|CLT','CLT|BKW']){
  const p=D.servicePatterns[direction];
  assert(p,'Beckley-Charlotte operating-day source is present in both directions');
  assert.deepEqual([...p.days],[0,1,2,3,4,5,6]);
  assert.equal(p.activeFrom,'2026-11-23');
  assert.equal(p.activeThrough,'2026-11-29','No extrapolation beyond published Thanksgiving week');
  assert(p.sourceUrl.endsWith(direction.replace('|','-')),'Directional evidence source required');
}
assert(!ledger.missing.some(x=>x.pair==='BKW-CLT'));
for(const [community,hub] of [['ALS','DEN'],['MCK','DEN'],['COD','DEN'],['GDV','BIL']]){
  const pair=[community,hub].sort().join('-');
  assert(!ledger.missing.some(e=>e.pair===pair),'Newly source-verified pair is removed from outstanding ledger: '+pair);
  for(const direction of [community+'|'+hub,hub+'|'+community]){
    const p=D.servicePatterns[direction];
    assert(p,'Both published timetable directions are modeled: '+direction);
    assert.deepEqual([...p.days],[0,1,2,3,4,5,6]);
    assert.equal(p.activeFrom,'2026-11-23');
    assert.equal(p.activeThrough,'2026-11-29','Do not project a single timetable week beyond its published dates');
    assert(p.sourceUrl.endsWith(direction.replace('|','-')),'Source URL corresponds to departure direction');
  }
}
for(const [community,hub] of [['FOD','ORD'],['CGI','ORD']]){
  const pair=[community,hub].sort().join('-');
  assert(!ledger.missing.some(e=>e.pair===pair),'Source-backed week is no longer an evidence gap: '+pair);
  for(const [from,to] of [[community,hub],[hub,community]]){
    const p=D.servicePatterns[from+'|'+to];
    assert(p,'Nonstop timetable direction must exist: '+from+' to '+to);
    assert.deepEqual([...p.days],[0,1,2,3,4,5,6]);
    assert.equal(p.activeFrom,'2026-11-23');
    assert.equal(p.activeThrough,'2026-11-29','Source window must not become open-ended availability');
    assert(p.sourceUrl.endsWith(from+'-'+to),'Directional source required');
  }
}
for(const [community,days] of [['LAR',[0,1,2,3,4,5,6]],['PUB',[0,1,2,4,5,6]]]){
  assert(!ledger.missing.some(x=>x.pair===community+'-DEN'),'Published Denver service pair is no longer an evidence gap');
  for(const direction of [community+'|DEN','DEN|'+community]){
    const p=D.servicePatterns[direction];
    assert(p,'Direction is documented: '+direction);
    assert.deepEqual([...p.days],days,'Operating days match the week including Thanksgiving exception');
    assert.equal(p.activeFrom,'2026-11-23');
    assert.equal(p.activeThrough,'2026-11-29');
    assert(p.sourceUrl.endsWith(direction.replace('|','-')),'Per-direction published schedule cited');
  }
}
for(const [community,hub] of [['DVL','DEN'],['DEC','ORD']]){
  assert(!ledger.missing.some(e=>e.pair===community+'-'+hub),'Published weekly schedule no longer listed as missing');
  for(const [from,to] of [[community,hub],[hub,community]]){
    const p=D.servicePatterns[from+'|'+to];
    assert(p,'Both flight directions must be source-backed');
    assert.deepEqual([...p.days],[0,1,2,3,4,5,6]);
    assert.equal(p.activeFrom,'2026-11-23');
    assert.equal(p.activeThrough,'2026-11-29');
    assert(p.sourceUrl.endsWith(from+'-'+to));
  }
}
for(const [community,hub] of [['HYS','DEN'],['GCK','DFW']]){
  assert(!ledger.missing.some(e=>e.pair===community+'-'+hub),'Audited daily nonstop removed from the open evidence register');
  for(const [from,to] of [[community,hub],[hub,community]]){
    const p=D.servicePatterns[from+'|'+to];
    assert(p,'Published holiday week covers route in both directions: '+from+' to '+to);
    assert.deepEqual([...p.days],[0,1,2,3,4,5,6]);
    assert.equal(p.activeFrom,'2026-11-23');
    assert.equal(p.activeThrough,'2026-11-29','No unsupported dates beyond sourced week');
    assert(p.sourceUrl.endsWith(from+'-'+to));
  }
}
for(const [from,to] of [['LWB','CLT'],['CLT','LWB']]){
  const p=D.servicePatterns[from+'|'+to];
  assert(p,'Lewisburg–Charlotte published operating day evidence exists in both directions');
  assert.deepEqual([...p.days],[0,1,2,3,4,5,6]);
  assert.equal(p.activeFrom,'2026-11-23');
  assert.equal(p.activeThrough,'2026-11-29');
  assert(p.sourceUrl.endsWith(from+'-'+to));
}
assert(!ledger.missing.some(x=>x.pair==='LWB-CLT'));
for(const community of ['DIK','ATY']){
  assert(!ledger.missing.some(x=>x.pair===community+'-DEN'),'Daily nonstop date window verified and removed from unknown register');
  for(const [from,to] of [[community,'DEN'],['DEN',community]]){
    const p=D.servicePatterns[from+'|'+to];
    assert(p,'Directional schedule evidence for '+from+' to '+to);
    assert.deepEqual([...p.days],[0,1,2,3,4,5,6]);
    assert.equal(p.activeFrom,'2026-11-23');
    assert.equal(p.activeThrough,'2026-11-29','No fabricated schedule dates after published week');
    assert(p.sourceUrl.endsWith(from+'-'+to));
  }
}
for(const community of ['JMS','LBL']){
  assert(!ledger.missing.some(x=>x.pair===community+'-DEN'),'Date-confirmed published week no longer missing');
  for(const [from,to] of [[community,'DEN'],['DEN',community]]){
    const p=D.servicePatterns[from+'|'+to];
    assert(p,'Week48 directional route evidence is stored');
    assert.deepEqual([...p.days],[0,1,2,3,4,5,6]);
    assert.equal(p.activeFrom,'2026-11-23');
    assert.equal(p.activeThrough,'2026-11-29');
    assert(p.sourceUrl.endsWith(from+'-'+to));
  }
}
for(const [from,to] of [['PIR','DEN'],['DEN','PIR']]){
  const p=D.servicePatterns[from+'|'+to];
  assert(p,'Daily Pierre Denver source pattern must exist in each direction');
  assert.deepEqual([...p.days],[0,1,2,3,4,5,6]);
  assert.equal(p.activeFrom,'2026-11-23');
  assert.equal(p.activeThrough,'2026-11-29','No unsourced continuation');
  assert(p.sourceUrl.endsWith(from+'-'+to),'Directional source URL required');
}
assert(!ledger.missing.some(x=>x.pair==='PIR-DEN'),'Pierre Denver no longer unresolved within published week');
for(const community of ['BFD','DUJ']){
  assert(!ledger.missing.some(x=>x.pair===community+'-PIT'),'Source-backed route removed from unresolved gap register');
  for(const [from,to] of [[community,'PIT'],['PIT',community]]){
    const p=D.servicePatterns[from+'|'+to];
    assert(p,'Published flight days present in both Pittsburgh directions');
    assert.deepEqual([...p.days],[0,1,2,3,4,5,6]);
    assert.equal(p.activeFrom,'2026-11-23');
    assert.equal(p.activeThrough,'2026-11-29','Date-bounded published source only');
    assert(p.sourceUrl.endsWith(from+'-'+to));
  }
}
console.log('PASS: '+ledger.missing.length+' EAS operating-day evidence gaps individually tracked; no fabricated schedule dates');
