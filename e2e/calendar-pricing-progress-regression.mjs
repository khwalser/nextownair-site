import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../itinerary.js',import.meta.url),'utf8');
const start=source.indexOf('  function calendarMoreFareControl(');
const end=source.indexOf('  function updateCalendarFareStatus(',start);
assert(start>=0&&end>start,'Calendar pricing control implementation is present');
const button={hidden:true,disabled:false,textContent:''};
const data=new Map();
const jobs=new Set();
const blocked=new Set();
const ctx={
  document:{getElementById:id=>id==='calendarMoreFares'?button:null},
  liveFareData:data,calendarFareJobs:jobs,fareCoverageBlockedLegs:blocked,
  fareKey:(a,b,date)=>a+'|'+b+'|'+date,
  fareLegKey:(a,b)=>a+'|'+b
};
vm.createContext(ctx);
vm.runInContext(source.slice(start,end)+'\nthis.showMore=calendarMoreFareControl',ctx);
const dates=['2026-11-25','2026-11-26','2026-11-27'];
ctx.showMore('DTW','ORD','2026-11',dates,0);
assert.equal(button.hidden,false,'Unpriced confirmed dates have a visible action');
assert.equal(button.disabled,false);
assert.match(button.textContent,/Check next 3 of 3 unchecked dates/);
jobs.add('DTW|ORD|2026-11-25');
ctx.showMore('DTW','ORD','2026-11',dates,1);
assert.equal(button.disabled,true,'Pending checks show an ongoing state');
assert.match(button.textContent,/Checking 1 queued date/);
jobs.clear();data.set('DTW|ORD|2026-11-25',{offers:[{amount:241}]});
ctx.showMore('DTW','ORD','2026-11',dates,0);
assert.equal(button.disabled,false,'The action reactivates after queued prices finish');
assert.match(button.textContent,/Check next 2 of 2 unchecked dates/);
data.set('DTW|ORD|2026-11-26',{offers:[]});data.set('DTW|ORD|2026-11-27',{offers:[]});
ctx.showMore('DTW','ORD','2026-11',dates,0);
assert.equal(button.hidden,true,'No more-price button when all dates have returned');
data.clear();blocked.add('DTW|ORD');
ctx.showMore('DTW','ORD','2026-11',dates,0);
assert.equal(button.hidden,true,'Unsupported fare routes do not offer fake price checks');
assert.match(source,/refreshVisibleCalendar\(\)/,'Completed requests update the current visible calendar after a rerender');
console.log('PASS: Calendar pricing progress, completion, optional additional checks, and unsupported coverage');

const queueStart=source.indexOf('  function queueCalendarFarePricing(');
const queueEnd=source.indexOf('  const calendarMoreFaresButton=',queueStart);
assert(queueStart>=0&&queueEnd>queueStart,'Production calendar fare queue exists');
const queuedDates=[];
const queueCtx={
  window:{NTA:{diffDays:(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/86400000)}},
  state:{startDate:'2026-11-20'},
  AUTO_PRICE_WINDOW:31,
  fareCoverageBlockedLegs:new Set(),
  fareLegKey:(a,b)=>a+'|'+b,
  fareKey:(a,b,d)=>a+'|'+b+'|'+d,
  monthKeyFromDate:d=>d.slice(0,7),
  scheduleMonthKey:(a,b,m)=>a+'|'+b+'|'+m,
  scheduleMonthData:new Map([['DTW|ORD|2026-11',{days:{}}]]),
  isScheduleFallbackCode:code=>code==='schedule_quota_exhausted',
  isKnownFareCoverageGap:(a,b)=>a==='DTW'&&b==='CIU',
  scheduleState:()=>({status:'yes'}),
  liveFareData:new Map(),calendarFareJobs:new Set(),
  fetchFare:(a,b,date)=>{queuedDates.push(date);return new Promise(()=>{});},
  updateCalendarCell:()=>{},
  firstLeg:()=>({a:'DTW',b:'ORD'}),
  calendarMonthDate:new Date(2026,10,1),
  updateCalendarFareStatus:()=>{},
  rememberFareData:()=>{}
};
vm.createContext(queueCtx);
vm.runInContext(source.slice(queueStart,queueEnd)+'\nthis.queueCalendarFarePricing=queueCalendarFarePricing;',queueCtx);
const allDates=Array.from({length:11},(_,i)=>'2026-11-'+String(i+20).padStart(2,'0'));
queueCtx.queueCalendarFarePricing('DTW','ORD',allDates,1);
assert.equal(queuedDates.length,11,'All eleven published flight dates are queued automatically, not only five');
assert.equal(queuedDates[0],'2026-11-20','Selected date is priced first');
queueCtx.calendarFareJobs.clear();
queuedDates.length=0;
queueCtx.scheduleMonthData.set('DTW|ORD|2026-11',{error:true,code:'schedule_quota_exhausted'});
queueCtx.queueCalendarFarePricing('DTW','ORD',allDates,2);
assert.equal(queuedDates.length,5,'Unavailable schedule feed limits speculative automatic fare queries to five');
console.log('PASS: Production fare queue prices all confirmed dates, prioritizes selected date, and bounds fallback checks');

queueCtx.calendarFareJobs.clear();
queuedDates.length=0;
queueCtx.scheduleMonthData.set('DTW|ORD|2026-11',{days:{}});
queueCtx.scheduleMonthData.set('DTW|CIU|2026-11',{days:{}});
queueCtx.queueCalendarFarePricing('DTW','CIU',allDates,3);
assert.equal(queuedDates.length,2,'Known fare coverage gaps get two live fare probes rather than zero or a full-month scan');
assert.equal(queuedDates[0],'2026-11-20','A known coverage gap checks the selected date first');
assert(!source.includes('if(leg&&isKnownFareCoverageGap(leg.a,leg.b))fareCoverageBlockedLegs.add'),'Known gaps must not be unconditionally blocked by firstLeg');
assert(!source.includes('if(isKnownFareCoverageGap(a,b))fareCoverageBlockedLegs.add'),'Known gaps must not suppress live pricing from fetchFare');
console.log('PASS: DTW-CIU calendar attempts bounded real pricing instead of suppressing all fare lookups');

assert(source.includes('calendarMoreFareControl(leg.a,leg.b,month,monthCells.map(cell=>cell.dataset.calendarDate),queued)'),'Schedule-quota fallback exposes manual checks for unchecked calendar days');
assert(source.includes('queueCalendarFarePricing(leg.a,leg.b,remaining,calendarLoadVersion,Math.min(5,remaining.length))'),'Manual checks remain bounded to five dates');
assert(source.includes('dates checked;')&&source.includes('remain\' unchecked')===false,'Partial fallback scan uses checked counts instead of announcing completion');
assert(source.includes('No selectable flight offer was returned for this departure date'),'First-leg missing inventory must not masquerade as a connection timing conflict');
console.log('PASS: Partial scan remains truthful, additional checks are available, and first-leg empty results are explained');

assert(source.includes("const publishedDate=knownRoute&&selectedAvailability.status==='yes'"),'Known service is established separately from a provider quote');
assert(source.includes("publishedDate?prototypeOptions(a,b,departDate):[]"),'Published service offers explicitly marked planning choices while live prices are pending');
assert(source.includes("if(!fareData&&!opts.length)"),'The pending panel is shown only when no published service choice is available');
console.log('PASS: Published-service choices do not depend on slow fare-provider responses');

assert(source.includes("const pinnedFallback=(pinnedId.startsWith('prototype|')"),'Late live pricing preserves previously selected published-service planning choices');
assert(source.includes('opts=[...opts,pinnedFallback]'),'Real fare options remain visible without silently discarding a still-valid prototype choice');
console.log('PASS: Late provider responses retain explicit prototype selections alongside real fares');

const rolloverPosition=source.indexOf('departDate=nextDate;');
const selectionGuardPosition=source.indexOf('if(storedSelection&&!String(storedSelection).endsWith(');
assert(rolloverPosition>=0&&selectionGuardPosition>rolloverPosition,'Selection validity is checked after automatic connector departure-date rollover');
console.log('PASS: Automatic next-service-day connector selections are not cleared on rerender');
