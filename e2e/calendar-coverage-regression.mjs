import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../itinerary.js',import.meta.url),'utf8');
const begin=source.indexOf('  function scheduleState(');
const end=source.indexOf('  function firstLeg(',begin);
assert(begin>=0&&end>begin,'Could not find the production schedule-state function');
const dates=new Map([['DTW|ROC|2026-11',{days:{},checkedDates:['2026-11-25']} ]]);
const context={
  scheduleMonthData:dates,
  scheduleMonthKey:(a,b,m)=>a+'|'+b+'|'+m,
  monthKeyFromDate:d=>d.slice(0,7),
  publishedServicePattern:()=>null,
  parseYmd:()=>null,
  isScheduleFallbackCode:()=>false
};
vm.createContext(context);
vm.runInContext(source.slice(begin,end)+'\nthis.scheduleState=scheduleState;',context);
const result=context.scheduleState('DTW','ROC','2026-11-25');
assert.equal(result.status,'fallback','Missing published date must offer a live fare check, not falsely assert no service');
assert.notEqual(result.status,'yes','A live fare check must not invent verified service');
assert.equal(context.scheduleState('DTW','ROC','2026-11-26').status,'checking','Unqueried dates stay unverified');
context.scheduleMonthData.set('DTW|ROC|2026-11',{days:{},unknownDates:['2026-11-27'],checkedDates:['2026-11-25']});
assert.equal(context.scheduleState('DTW','ROC','2026-11-27').status,'fallback','Incomplete schedule dates must not display retry badges');
context.scheduleMonthData.set('DTW|ROC|2026-11',{error:true,code:'schedule_unavailable',days:{}});
assert.equal(context.scheduleState('DTW','ROC','2026-11-27').status,'fallback','Schedule feed errors must not display retry badges');

// The calendar must distinguish evidence of a flight from a priced offer.
const avStart=source.indexOf('  function calendarEvidence(');
const avEnd=source.indexOf('  function calendarFareText(',avStart);
assert(avStart>=0&&avEnd>avStart,'Missing production calendar availability function');
const fares=new Map();
context.firstLeg=()=>({a:'DTW',b:'ROC'});
context.liveFareData=fares;
context.fareKey=(a,b,d)=>a+'|'+b+'|'+d;
context.fareLegKey=(a,b)=>a+'|'+b;
context.fareCoverageBlockedLegs=new Set();
context.lowestOffer=data=>data?.offers?.[0]||null;
context.lowestLiveOffer=data=>data?.liveMode===true?data.offers.find(o=>o.liveMode===true&&o.fareStatus==='verified')||null:null;
vm.runInContext(source.slice(avStart,avEnd)+'\nthis.calendarAvailability=calendarAvailability;',context);
dates.set('DTW|ROC|2026-11',{days:{'2026-11-25':{count:1}},checkedDates:['2026-11-25','2026-11-26']});
assert.equal(context.calendarAvailability('2026-11-25').tier,'scheduled','Published flight must not look like a live-priced flight');
assert.equal(context.calendarAvailability('2026-11-26').status,'fallback','Schedule gap remains unverified, not a confirmed absence');
fares.set('DTW|ROC|2026-11-25',{liveMode:true,offers:[{amount:241,currency:'USD',liveMode:true,fareStatus:'verified'}]});
assert.equal(context.calendarAvailability('2026-11-25').status,'available','Verified offer is an available flight');
fares.set('DTW|ROC|2026-11-26',{liveMode:true,offers:[{amount:260,currency:'USD',liveMode:true,fareStatus:'verified'}]});
assert.equal(context.calendarAvailability('2026-11-26').status,'available','Live fare is sufficient evidence of an available flight');
assert.equal(context.calendarAvailability('2026-11-25').tier,'live','Verified fare is distinctly identified');
context.fareCoverageBlockedLegs.add('DTW|ROC');
fares.delete('DTW|ROC|2026-11-25');
assert.equal(context.calendarAvailability('2026-11-25').tier,'coverage','Known provider gap is distinct from priced flight');
assert(!source.includes("return av.status==='available'?'flight ✓'"),'Published flights must not use misleading confirmation checkmarks');
const dataSource=fs.readFileSync(new URL('../data.js',import.meta.url),'utf8');
const dataContext={window:{}};
vm.createContext(dataContext);
vm.runInContext(dataSource,dataContext);
const dtwOrd=dataContext.window.NTA_DATA?.servicePatterns?.['DTW|ORD'];
assert(dtwOrd&&dtwOrd.activeFrom<='2026-11-20'&&dtwOrd.activeThrough>='2026-11-30','DTW-ORD must have published November schedule coverage');
assert.equal(dtwOrd.days.length,7,'DTW-ORD published flight must operate on all weekdays for November coverage');
assert(/^https:\/\//.test(dtwOrd.sourceUrl),'Schedule pattern must retain a published citation');
console.log('PASS: November DTW–ORD uses sourced operating-day coverage rather than unverified placeholder dates');
assert.match(source,/const AUTO_PRICE_WINDOW=31;/,'Calendar automatically scans all published flight dates in a month');
assert(source.includes('const bounded=fallback?5:isKnownFareCoverageGap(a,b)?2:AUTO_PRICE_WINDOW;'),'Unverified provider fallback limits to five checks and known fare gaps limit to two');
assert.match(source,/Checking live prices: /,'Calendar reports checked, priced, and queued counts during full-month scan');
console.log('PASS: Calendar automatically prices published service dates and bounds unverified schedule fallback');
console.log('PASS: Calendar availability distinguishes confirmed service, priced flight, and unverified dates');
console.log('PASS: Empty schedule coverage offers a live fare check without inventing service');
