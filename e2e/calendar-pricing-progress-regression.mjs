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
  fareLegKey:(a,b)=>a+'|'+b,
  isKnownFareCoverageGap:(a,b)=>a==='DTW'&&b==='CIU'
};
vm.createContext(ctx);
vm.runInContext(source.slice(start,end)+'\nthis.showMore=calendarMoreFareControl',ctx);
const dates=['2026-11-25','2026-11-26','2026-11-27'];
ctx.showMore('DTW','ORD','2026-11',dates,0);
assert.equal(button.hidden,false,'Unpriced confirmed dates have a visible action');
assert.equal(button.disabled,false);
assert.match(button.textContent,/Check next 3 of 3 unchecked dates/);
ctx.showMore('DTW','CIU','2026-11',dates,0);
assert.match(button.textContent,/Check next 2 of 3 unchecked dates/,'Known coverage gap offers only two live fare checks');
ctx.showMore('DTW','ORD','2026-11',dates,0);
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
assert(source.includes('queueCalendarFarePricing(leg.a,leg.b,remaining,calendarLoadVersion,Math.min(isKnownFareCoverageGap(leg.a,leg.b)?2:5,remaining.length))'),'Manual checks are capped at five dates, or two for known coverage gaps');
assert(source.includes('dates checked;')&&source.includes('remain\' unchecked')===false,'Partial fallback scan uses checked counts instead of announcing completion');
assert(source.includes('No selectable offer was returned for this date; this does not prove the flight does not operate.'),'First-leg missing inventory must not masquerade as a connection timing conflict');
console.log('PASS: Partial scan remains truthful, additional checks are available, and first-leg empty results are explained');

assert(source.includes("const publishedDate=knownRoute&&selectedAvailability.status==='yes'"),'Known service is established separately from a provider quote');
assert(source.includes("publishedDate?prototypeOptions(a,b,departDate):[]"),'Published service offers explicitly marked planning choices while live prices are pending');
assert(source.includes("if(!opts.length)")&&source.includes('const stillChecking=!fareData;'),'Missing flight panel distinguishes provider pending from completed lookup');
console.log('PASS: Published-service choices do not depend on slow fare-provider responses');

assert(source.includes("const pinnedFallback=(pinnedId.startsWith('prototype|')"),'Late live pricing preserves previously selected published-service planning choices');
assert(source.includes('opts=[...opts,pinnedFallback]'),'Real fare options remain visible without silently discarding a still-valid prototype choice');
console.log('PASS: Late provider responses retain explicit prototype selections alongside real fares');

const rolloverPosition=source.indexOf('departDate=nextDate;');
const selectionGuardPosition=source.indexOf('if(storedSelection&&!String(storedSelection).endsWith(');
assert(rolloverPosition>=0&&selectionGuardPosition>rolloverPosition,'Selection validity is checked after automatic connector departure-date rollover');
console.log('PASS: Automatic next-service-day connector selections are not cleared on rerender');

assert(source.includes('const batchLimit=isKnownFareCoverageGap(a,b)?2:5;'),'Manual check label and route-specific pricing limits stay aligned');
console.log('PASS: Manual fare-check batch label matches two-date known gap and five-date general provider caps');

assert(source.includes('function nextConfirmedFlightDate(a,b,afterDate,days=14)'),'Onward search uses a bounded 14-day horizon');
assert(source.includes("status==='yes'||Boolean(lowestOffer"),'Onward service dates require published schedule or genuine provider offer evidence');
assert(source.includes('data-open-departure-calendar'),'Missing initial flight has a one-click calendar recovery');
assert(source.includes('data-next-service-date'),'Missing onward flight has a next-confirmed-date action');
console.log('PASS: Missing flight choices provide only verified-date recovery actions');

const nextStart=source.indexOf('  function nextConfirmedFlightDate(');
const nextEnd=source.indexOf('  function renderLeg(',nextStart);
assert(nextStart>=0&&nextEnd>nextStart,'Next confirmed date helper exists');
const dateCtx={
  window:{NTA:{addDays:(date,offset)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}}},
  scheduleState:(a,b,d)=>({status:d==='2026-12-13'?'yes':'fallback'}),
  liveFareData:new Map([['ELD|DFW|2026-12-12',{offers:[{amount:200,currency:'USD'}]}]]),
  fareKey:(a,b,date)=>a+'|'+b+'|'+date,
  lowestOffer:data=>data?.offers?.[0]||null
};
vm.createContext(dateCtx);
vm.runInContext(source.slice(nextStart,nextEnd)+'\nthis.nextConfirmedFlightDate=nextConfirmedFlightDate;',dateCtx);
assert.equal(dateCtx.nextConfirmedFlightDate('ELD','DFW','2026-12-09'),'2026-12-12','Provider-confirmed date is selected before a later published day');
dateCtx.liveFareData.clear();
assert.equal(dateCtx.nextConfirmedFlightDate('ELD','DFW','2026-12-09'),'2026-12-13','Unverified days are skipped until published service date');
dateCtx.scheduleState=()=>({status:'fallback'});
assert.equal(dateCtx.nextConfirmedFlightDate('ELD','DFW','2026-12-09'),null,'No service date is invented when all evidence is unverified');
console.log('PASS: Next-date recovery respects actual flight/schedule evidence and returns no invented date');

const connectorRollover=source.slice(source.indexOf('if(opts.length===0&&knownRoute&&autoConnector'),source.indexOf('// Automatic connectors may advance'));
assert(connectorRollover.includes('const nextFareData=liveFareData.get(fareKey(a,b,nextDate))'),'Next-day connector reads fares using its effective date');
assert(connectorRollover.includes('fareData=nextFareData;'),'Next-day connector price panel is bound to next-day fare data');
assert(connectorRollover.includes('providerOptions(nextFareData,a,b,nextDate)'),'Real next-day offers supersede prototypes when available');
console.log('PASS: Automatic connector rollover cannot display prior-date provider fare as next-day price');

assert(source.includes('liveFareData.get(fareKey(state.route[i],state.route[i+1],legRendered.departDate))'),'Itinerary fare totals use effective connector departure dates, never provisional prior-day dates');
console.log('PASS: Fare summary respects effective next-service-day departure dates');

assert(connectorRollover.includes('nextConfirmedFlightDate(a,b,departDate,14)'),'Automatic connector searches fourteen days of confirmed service rather than tomorrow only');
assert(connectorRollover.includes('if(nextDate){'),'Missing confirmed future service never generates an invented departure date');
assert(connectorRollover.includes("opts.length===0&&knownRoute&&autoConnector&&plan.mode==='asap'"),'Automatic connector recovery also handles dates with no initial options');
console.log('PASS: Automatic connectors advance only to a confirmed operating date within two weeks');

const fareStart=source.indexOf('  function updateLiveTripFare(');
const fareEnd=source.indexOf('  async function hydrateLivePricing(',fareStart);
assert(fareStart>=0&&fareEnd>fareStart,'Fare total renderer exists');
const fareNode={innerHTML:''};
const fareCtx={
  document:{getElementById:id=>id==='liveTripFare'?fareNode:null},
  state:{route:['WFB','KTN','JNU','KTN']},
  isTransferLeg:(a,b)=>a==='WFB'&&b==='KTN',
  selectedFareByLeg:new Map([[1,{amount:160,currency:'USD',fareStatus:'verified'}],[2,{amount:180,currency:'USD',fareStatus:'verified'}]]),
  liveFareByLeg:new Map(),
  prototypeFareText:amount=>'?'+amount,
  formatMoney:amount=>'$'+amount,
  lowestOffer:d=>d?.offers?.[0]||null
};
vm.createContext(fareCtx);
vm.runInContext(source.slice(fareStart,fareEnd)+'\nthis.updateLiveTripFare=updateLiveTripFare;',fareCtx);
fareCtx.updateLiveTripFare();
assert.match(fareNode.innerHTML,/Itinerary fare total \$340/,'Completed mixed-mode trip displays full flight fare total');
assert.match(fareNode.innerHTML,/2 of 2 selected fares/,'Ground transfer is excluded from airfare denominator');
fareCtx.selectedFareByLeg.delete(2);
fareCtx.updateLiveTripFare();
assert.match(fareNode.innerHTML,/Selected fare subtotal \$160/,'Mixed-mode trip missing one flight shows partial subtotal');
assert.match(fareNode.innerHTML,/1 of 2 selected fare/,'Subtotal counts only flight legs');
console.log('PASS: Mixed-mode itineraries exclude ferry transfers from airfare totals and completion counts');

const rateLimitStart=source.indexOf('  function pumpFareQueue()');
const rateLimitEnd=source.indexOf('  function fetchFare(',rateLimitStart);
const rateLimitBlock=source.slice(rateLimitStart,rateLimitEnd);
assert(rateLimitStart>=0&&rateLimitEnd>rateLimitStart,'Live fare queue implementation is present');
assert(rateLimitBlock.includes("if(status===429){"),'Rate-limit logic handles retry instructions with or without Retry-After');
assert(rateLimitBlock.includes('task.rateLimitRetries<=2'),'Rate-limited date receives no more than two automatic retries');
assert(rateLimitBlock.includes('fareQueue.unshift(task)'),'Retry preserves the original date and existing fare promise');
assert(rateLimitBlock.indexOf('fareQueue.unshift(task)')<rateLimitBlock.indexOf('task.resolve({...coverageFallbackData'),'Rate-limit retry happens before recording temporary unavailability');
assert(rateLimitBlock.includes('fareBlockedUntil=Math.max(fareBlockedUntil,Date.now()+retryAfterMs)'),'Retries respect provider cooldown');
console.log('PASS: Rate-limited flight dates requeue twice after provider cooldown without falsely claiming a checked fare');

const fetchStart=source.indexOf('  function fetchFare(');
const fetchEnd=source.indexOf('  function prioritizeFareCheck(',fetchStart);
assert(fetchStart>=0&&fetchEnd>fetchStart,'Fare queue entry point is present');
const fetchCtx={
  fareCoverageBlockedLegs:new Set(['ELD|DFW']),
  fareLegKey:(a,b)=>a+'|'+b,
  fareKey:(a,b,d)=>a+'|'+b+'|'+d,
  coverageFallbackData:()=>({coverageLimited:true,offers:[]}),
  liveFareData:new Map(),
  liveFareCache:new Map(),
  fareQueue:[],
  pumpFareQueue:()=>{}
};
vm.createContext(fetchCtx);
vm.runInContext(source.slice(fetchStart,fetchEnd)+'\nthis.fetchFare=fetchFare;',fetchCtx);
const limitedFare=await fetchCtx.fetchFare('ELD','DFW','2026-12-12',false);
assert.equal(limitedFare.coverageLimited,true,'Automated scan remains limited after route-wide empty provider responses');
const explicit=fetchCtx.fetchFare('ELD','DFW','2026-12-13',true);
assert.equal(fetchCtx.fareQueue.length,1,'Explicitly chosen new date queues a real provider request despite route coverage gap');
assert.equal(fetchCtx.fareQueue[0].date,'2026-12-13','User-selected date is not replaced by a synthetic coverage result');
fetchCtx.fareQueue[0].resolve({offers:[{amount:277,currency:'USD'}]});
const explicitFare=await explicit;
assert.equal(explicitFare.offers[0].amount,277,'Explicit fare query is allowed to return provider pricing');
console.log('PASS: Automatic route-coverage cap does not suppress a traveler-initiated live price lookup');
