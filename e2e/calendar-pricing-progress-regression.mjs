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
  liveFareData:data,calendarFareJobs:jobs,fareCoverageBlockedLegs:blocked,manualFareCheckedDates:new Set(),
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
assert.equal(button.hidden,false,'Provider-limited routes still offer explicit date checks');
data.set('DTW|ORD|2026-11-25',{coverageLimited:true,offers:[]});
ctx.showMore('DTW','ORD','2026-11',dates,0);
assert.equal(button.hidden,false,'Synthetic coverage results remain manually checkable');
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
  liveFareData:new Map(),calendarFareJobs:new Set(),manualFareCheckedDates:new Set(),
  prioritizeFareCheck:(a,b,date)=>{queuedDates.push(date);return new Promise(()=>{});},
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
queueCtx.calendarFareJobs.clear();
queuedDates.length=0;
queueCtx.fareCoverageBlockedLegs.add('DTW|CIU');
queueCtx.liveFareData.set('DTW|CIU|2026-11-20',{coverageLimited:true,offers:[]});
queueCtx.queueCalendarFarePricing('DTW','CIU',allDates,4,2,true);
assert.equal(queuedDates.length,2,'Manual action queues at most two dates for a known coverage gap');
assert(queueCtx.manualFareCheckedDates.has('DTW|CIU|2026-11-20'),'Manual recheck marks a synthetic coverage result as attempted');
console.log('PASS: Traveler-selected calendar requests bypass blocked automated fare scanning');


assert(source.includes('calendarMoreFareControl(leg.a,leg.b,month,monthCells.map(cell=>cell.dataset.calendarDate),queued)'),'Schedule-quota fallback exposes manual checks for unchecked calendar days');
assert(source.includes('queueCalendarFarePricing(leg.a,leg.b,remaining,calendarLoadVersion,Math.min(isKnownFareCoverageGap(leg.a,leg.b)?2:5,remaining.length),true)'),'Manual checks stay bounded and intentionally bypass automatic provider limits');
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
fareCtx.selectedFareByLeg.clear();
fareCtx.liveFareByLeg.set(0,{liveMode:true,offers:[{amount:198,currency:'USD'}]});
fareCtx.updateLiveTripFare();
assert.match(fareNode.innerHTML,/Partial live fare subtotal \$198/,'A single provider quote is not misrepresented as a complete trip fare total');
assert.match(fareNode.innerHTML,/1 of 2 flight legs/,'Partial subtotal reports number of priced flight legs');
fareCtx.liveFareByLeg.set(1,{liveMode:true,offers:[{amount:212,currency:'USD'}]});
fareCtx.updateLiveTripFare();
assert.match(fareNode.innerHTML,/Lowest live fare estimate \$410/,'Complete provider quote set can be labeled estimate');
console.log('PASS: Provider pricing labels partial and complete fare totals correctly');


const rateLimitStart=source.indexOf('  function pumpFareQueue()');
const rateLimitEnd=source.indexOf('  function fetchFare(',rateLimitStart);
const rateLimitBlock=source.slice(rateLimitStart,rateLimitEnd);
assert(rateLimitStart>=0&&rateLimitEnd>rateLimitStart,'Live fare queue implementation is present');
assert(rateLimitBlock.includes("if(!ok&&status===429){"),'Rate-limit logic handles bodyless 429 before JSON validation');
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

const lowestStart=source.indexOf('  function lowestOffer(');
const lowestEnd=source.indexOf('  function formatMoney(',lowestStart);
assert(lowestStart>=0&&lowestEnd>lowestStart,'Lowest-offer parser is present');
const amountCtx={};vm.createContext(amountCtx);
vm.runInContext(source.slice(lowestStart,lowestEnd)+'\nthis.lowestOffer=lowestOffer;',amountCtx);
assert.equal(amountCtx.lowestOffer({offers:[{amount:null},{amount:'bad'},{amount:245}]}).amount,245,'Null and malformed prices cannot outrank a valid fare');
assert.equal(amountCtx.lowestOffer({offers:[{amount:null},{amount:''},{amount:'NaN'}]}),null,'All missing provider prices remain unpriced rather than $0');
assert.equal(amountCtx.lowestOffer({offers:[null,{amount:333},{amount:199}]}).amount,199,'Valid offer selection still finds the lowest numeric price');
assert(source.includes('if(!cheapest.length){'),'Trip fare summary does not show zero when all quotes lack valid amounts');
console.log('PASS: Provider fare validation rejects null, malformed and fabricated zero fares');

const pumpStart=source.indexOf('  function pumpFareQueue()');
const pumpEnd=source.indexOf('  function fetchFare(',pumpStart);
assert(pumpStart>=0&&pumpEnd>pumpStart,'Provider queue body exists');
let providerError=null;
const nullProviderQueueCtx={
  clearTimeout:()=>{},
  setTimeout:()=>null,
  farePumpTimer:null, fareQueue:[{a:'ELD',b:'DFW',date:'2026-12-08',key:'ELD|DFW|2026-12-08',resolve:()=>{},reject:e=>{providerError=e;}}],
  fareActive:0,FARE_MAX_CONCURRENT:1,FARE_START_GAP_MS:0,lastFareStartAt:0,fareBlockedUntil:0,
  fareActiveKeys:new Set(),updateCalendarCell:()=>{},
  F:{fetchOffers:async()=>({ok:true,status:200,data:null})},
  fareNoOfferCounts:new Map(),fareCoverageBlockedLegs:new Set(),
  fareLegKey:(a,b)=>a+'|'+b,
  coverageFallbackData:()=>({offers:[],coverageLimited:true}),
  externalFareSearchUrl:()=>'',firstLeg:()=>null,el:{calendarStatus:null},updateCalendarFareStatus:()=>{}
};
vm.createContext(nullProviderQueueCtx);
vm.runInContext(source.slice(pumpStart,pumpEnd)+'\nthis.pumpFareQueue=pumpFareQueue;',nullProviderQueueCtx);
nullProviderQueueCtx.pumpFareQueue();
await new Promise(resolve=>setTimeout(resolve,10));
assert(providerError&&/invalid response body/.test(providerError.message),'Null provider JSON is safely rejected as malformed, not dereferenced');
assert.equal(nullProviderQueueCtx.fareActive,0,'Malformed provider response releases the active request slot');
console.log('PASS: Null provider responses reject cleanly and release the fare queue');

const optionStart=source.indexOf('  function providerOptions(');
const optionEnd=source.indexOf('  function estimatedFlightMinutes(',optionStart);
assert(optionStart>=0&&optionEnd>optionStart,'Flight provider option mapping is present');
const optionCtx={
  isoMinutes:iso=>iso?Number(iso.slice(11,13))*60+Number(iso.slice(14,16)):null,
  isoDate:iso=>iso?iso.slice(0,10):null,
  window:{NTA:{diffDays:(a,b)=>Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000)}}
};
vm.createContext(optionCtx);
vm.runInContext(source.slice(optionStart,optionEnd)+'\nthis.providerOptions=providerOptions;',optionCtx);
const offerBase={departureTime:'2026-12-08T08:00:00',arrivalTime:'2026-12-08T09:00:00',durationMinutes:60,flightNumber:'XY123'};
const mapped=optionCtx.providerOptions({offers:[null,{...offerBase,amount:null},{...offerBase,amount:'invalid'},{...offerBase,amount:213}]},'ELD','DFW','2026-12-08');
assert.equal(mapped.length,3,'Malformed null offer row does not crash option mapping');
assert.equal(mapped[0].price,null,'Missing amount is not converted to free airfare');
assert.equal(mapped[1].price,null,'Nonnumeric amount is not converted to a valid flight fare');
assert.equal(mapped[2].price,213,'Valid provider amount remains usable');
const wrongDay=optionCtx.providerOptions({offers:[{...offerBase,departureTime:'2026-12-09T08:00:00',arrivalTime:'2026-12-09T09:00:00',amount:99},{...offerBase,amount:238}]},'ELD','DFW','2026-12-08');
assert.equal(wrongDay.length,1,'Provider options from other dates are excluded from the requested travel day');
assert.equal(wrongDay[0].price,238,'Only the actual requested-date fare appears in flight choices');
const badDuration=optionCtx.providerOptions({offers:[{...offerBase,arrivalTime:'2026-12-08T08:00:00',durationMinutes:0,amount:70},{...offerBase,arrivalTime:'2026-12-08Tbad',durationMinutes:0,amount:60},{...offerBase,amount:310}]},'ELD','DFW','2026-12-08');
assert.equal(badDuration.length,1,'Zero or nonfinite elapsed durations cannot become bookable flight choices');
assert.equal(badDuration[0].price,310,'Valid timed offer survives duration validation');
assert.equal(optionCtx.providerOptions(null,'ELD','DFW','2026-12-08').length,0,'Absent next-day provider data produces an empty array, not a null crash');
assert.equal(optionCtx.providerOptions({offers:null},'ELD','DFW','2026-12-08').length,0,'Null offers list safely yields zero flight options');
assert(source.includes('previousChosen.price!=null')&&source.includes('o.price!=null')&&source.includes('x.amount!=null'),'Flight cards, selection and subtotal consistently exclude missing price amounts');
console.log('PASS: Null provider rows and missing amounts never become $0 flight selections or fare totals');

assert(source.includes('${checked} of ${dates.length} published-service dates checked for live prices'),'Completed calendar batch reports exact checked count');
assert(source.includes('${Math.max(0,dates.length-checked)} remain unchecked'),'Incomplete monthly fare coverage is never silently portrayed as complete');
console.log('PASS: Calendar completion reports checked, priced and unchecked service dates');

const fareChoicesStart=source.indexOf('  function normalizedFareChoices(');
const fareChoicesEnd=source.indexOf('  function optionFareText(',fareChoicesStart);
assert(fareChoicesStart>=0&&fareChoicesEnd>fareChoicesStart,'Returned fare normalization function is present');
const fareChoiceCtx={};vm.createContext(fareChoiceCtx);
vm.runInContext(source.slice(fareChoicesStart,fareChoicesEnd)+'\nthis.normalizedFareChoices=normalizedFareChoices;',fareChoiceCtx);
const sorted=Array.from(fareChoiceCtx.normalizedFareChoices({currency:'USD',fareChoices:[{amount:340},{amount:180},{amount:260},{amount:null}]})).map(x=>x.amount);
assert.deepEqual(sorted,[180,260,340],'Same-currency fares are sorted from lowest price');
const mixed=Array.from(fareChoiceCtx.normalizedFareChoices({currency:'USD',fareChoices:[{amount:120,currency:'EUR'},{amount:200,currency:'USD'}]})).map(x=>x.currency);
assert.deepEqual(mixed,['EUR','USD'],'Different currencies retain their provider order without false price ranking');
assert(source.includes("comparableFares&&idx===0?' lowest':''"),'Lowest badge only applies to comparable prices');
console.log('PASS: Returned fare prices are ranked only when currencies are comparable');

assert(source.includes('data-external-first-fares href="${externalFareSearchUrl(a,b,departDate)}"'),'An unpriced first flight includes an external search for its exact date');
assert(source.includes('data-external-onward-fares href="${externalFareSearchUrl(a,b,departDate)}"'),'Missing onward flight includes a dated airline-fare search');
console.log('PASS: Unavailable first and onward legs offer dated external fare-search recovery');

const dataSource=fs.readFileSync(new URL('../data.js',import.meta.url),'utf8');
const patternCtx={window:{},parseYmd:value=>{const p=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);return p?{y:Number(p[1]),m:Number(p[2]),d:Number(p[3])}:null;}};
vm.createContext(patternCtx);vm.runInContext(dataSource,patternCtx);
patternCtx.D=patternCtx.window.NTA_DATA;
patternCtx.fareLegKey=(a,b)=>a+'|'+b;
const patternStart=source.indexOf('  function publishedServicePattern(');
const patternEnd=source.indexOf('  function patternDeparturesForDate(',patternStart);
assert(patternStart>=0&&patternEnd>patternStart,'Published route schedule resolver exists');
vm.runInContext(source.slice(patternStart,patternEnd)+'\nthis.publishedServicePattern=publishedServicePattern;this.patternAppliesOnDate=patternAppliesOnDate;',patternCtx);
for(const route of ['ELD|DFW','DFW|ELD','GRI|DFW','DFW|GRI']){
  const [origin,destination]=route.split('|');
  const pattern=patternCtx.publishedServicePattern(origin,destination);
  assert(pattern&&pattern.sourceUrl&&pattern.checkedAsOf==='2026-11-21','Verified airport or carrier source accompanies '+route);
  assert(patternCtx.patternAppliesOnDate(pattern,'2026-12-08'),'Published December schedule supports '+route);
  assert(!patternCtx.patternAppliesOnDate(pattern,'2027-01-05'),'Sourced 2026 schedule does not claim unverified 2027 service on '+route);
  assert.equal(pattern.count,1,'At least one published daily service is supported for '+route);
}
assert(source.includes("'ELD|DFW','DFW|ELD','GRI|DFW','DFW|GRI'"),'Sourced EAS routes retain a two-date automatic fare request cap');
console.log('PASS: El Dorado and Grand Island first legs have bounded, source-attributed daily schedule evidence');
for(const route of ['DFW|CVN','CVN|DFW','DFW|HOT','HOT|DFW']){
  const [origin,destination]=route.split('|');
  const pattern=patternCtx.publishedServicePattern(origin,destination);
  assert(pattern&&pattern.sourceUrl&&pattern.checkedAsOf==='2026-11-21','Published EAS service pattern cites a current source for '+route);
  assert(patternCtx.patternAppliesOnDate(pattern,'2026-12-08'),'Published Tuesday flight supports '+route);
  assert(!patternCtx.patternAppliesOnDate(pattern,'2027-01-05'),'Sourced December schedule does not claim unverified January service for '+route);
}
for(const route of ['DFW|CVN','CVN|DFW']){
  const [origin,destination]=route.split('|');
  const p=patternCtx.publishedServicePattern(origin,destination);
  assert(!patternCtx.patternAppliesOnDate(p,'2026-12-09'),'Clovis route does not invent Wednesday nonstop service on '+route);
  assert(patternCtx.patternAppliesOnDate(p,'2026-12-10'),'Clovis route resumes published Thursday service on '+route);
}
assert(patternCtx.patternAppliesOnDate(patternCtx.publishedServicePattern('HOT','DFW'),'2026-12-09'),'Hot Springs daily service includes Wednesday');
assert(source.includes("'DFW|CVN','CVN|DFW','DFW|HOT','HOT|DFW'"),'Newly sourced legs keep background fare lookups bounded');
console.log('PASS: Clovis six-day and Hot Springs daily December schedules remain source-backed without invented Wednesdays');


const servicePrototypeStart=source.indexOf('  function prototypeOptions(');
const servicePrototypeEnd=source.indexOf('  function fareKey(',servicePrototypeStart);
assert(servicePrototypeStart>=0&&servicePrototypeEnd>servicePrototypeStart,'Service planning option generator is present');
const servicePrototypeContext={
  serviceCountForDate:(a,b,date)=>{
    const p=patternCtx.publishedServicePattern(a,b);
    return patternCtx.patternAppliesOnDate(p,date)?p.count:0;
  },
  estimatedFlightMinutes:()=>90,stableHash:()=>187,
  deterministicPrototypeFare:()=>160,
  servicePatternStops:()=>[],
  publishedServicePattern:patternCtx.publishedServicePattern
};
vm.createContext(servicePrototypeContext);
vm.runInContext(source.slice(servicePrototypeStart,servicePrototypeEnd)+'\nthis.prototypeOptions=prototypeOptions;',servicePrototypeContext);
const eldPrototype=servicePrototypeContext.prototypeOptions('ELD','DFW','2026-12-08')[0];
assert(eldPrototype&&eldPrototype.carrier==='Contour Airlines','Airport-sourced carrier is shown on El Dorado planning flight');
assert.equal(eldPrototype.timeStatus,'prototype','Source-backed flight date never implies prototype departure time is verified');
assert.equal(eldPrototype.fareStatus,'prototype','Planning fare remains explicitly unverified');
assert.equal(servicePrototypeContext.prototypeOptions('CVN','DFW','2026-12-09').length,0,'No prototype Clovis flight is invented on unsupported Wednesday');
console.log('PASS: Published carrier names are useful while estimated fares, times and unsupported dates stay clearly marked');

const scheduleOptionStart=source.indexOf('  function scheduleOptions(');
const scheduleOptionEnd=source.indexOf('  function prototypeOptions(',scheduleOptionStart);
assert(scheduleOptionStart>=0&&scheduleOptionEnd>scheduleOptionStart,'Published schedule option mapper is present');
const scheduleOptionContext={
  scheduleMonthData:new Map([['ELD|DFW|2026-12',{
    provider:'published-schedule',days:{'2026-12-08':{flights:[
      {ident:'WRONG',scheduledOut:'2026-12-09T08:00:00',scheduledIn:'2026-12-09T09:00:00'},
      {ident:'ZERO',scheduledOut:'2026-12-08T08:00:00',scheduledIn:'2026-12-08T08:00:00'},
      {ident:'BACKWARD',scheduledOut:'2026-12-08T09:00:00',scheduledIn:'2026-12-08T08:00:00'},
      {ident:'VALID',scheduledOut:'2026-12-08T08:00:00',scheduledIn:'2026-12-08T09:00:00'}
    ]}}
  }]]),
  scheduleMonthKey:(a,b,m)=>a+'|'+b+'|'+m,
  monthKeyFromDate:d=>d.slice(0,7),
  isoMinutes:iso=>iso?Number(iso.slice(11,13))*60+Number(iso.slice(14,16)):null,
  isoDate:iso=>iso?.slice(0,10)||null,
  window:{NTA:{diffDays:(a,b)=>Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000)}},
  deterministicPrototypeFare:()=>165,
  servicePatternStops:()=>[]
};
vm.createContext(scheduleOptionContext);
vm.runInContext(source.slice(scheduleOptionStart,scheduleOptionEnd)+'\nthis.scheduleOptions=scheduleOptions;',scheduleOptionContext);
const validPublished=Array.from(scheduleOptionContext.scheduleOptions('ELD','DFW','2026-12-08'));
assert.equal(validPublished.length,1,'Wrong-day, zero-minute and backward published flights are discarded');
assert.equal(validPublished[0].flightNo,'VALID','Actual correctly dated published flight remains selectable');
assert.equal(validPublished[0].duration,60,'Published flight duration is not fabricated');
console.log('PASS: Published flight mapper excludes off-date and invalid-duration schedule rows');

const calendarCellStart=source.indexOf('  function updateCalendarCell(');
const calendarCellEnd=source.indexOf('  function renderStartCalendar(',calendarCellStart);
assert(calendarCellStart>=0&&calendarCellEnd>calendarCellStart,'Calendar date refresh function exists');
const classNames=new Set(['past']);
const calendarMockCell={
  disabled:true,title:'',
  classList:{
    remove:(...names)=>names.forEach(n=>classNames.delete(n)),
    add:name=>classNames.add(name),
    toggle:(name,enabled)=>enabled?classNames.add(name):classNames.delete(name)
  },
  querySelector:()=>({textContent:''})
};
const calendarCellContext={
  el:{calendarGrid:{querySelector:()=>calendarMockCell}},
  calendarAvailability:()=>({status:'available'}),
  window:{NTA:{todayLocal:()=> '2026-11-21'}},
  firstLeg:()=>({a:'ELD',b:'DFW'}),
  calendarFareText:()=> '$200',
  calendarFareTitle:()=> 'Live price'
};
vm.createContext(calendarCellContext);
vm.runInContext(source.slice(calendarCellStart,calendarCellEnd)+'\nthis.updateCalendarCell=updateCalendarCell;',calendarCellContext);
calendarCellContext.updateCalendarCell('2026-11-20');
assert.equal(calendarMockCell.disabled,true,'Past departure date remains disabled after fare refresh');
assert(classNames.has('past'),'Past date marker survives fare refresh');
calendarCellContext.updateCalendarCell('2026-11-22');
assert.equal(calendarMockCell.disabled,false,'Future date with service remains selectable');
assert(!classNames.has('past'),'Future date does not inherit stale past marker');
calendarCellContext.calendarAvailability=()=>({status:'unavailable'});
calendarCellContext.updateCalendarCell('2026-11-22');
assert.equal(calendarMockCell.disabled,true,'Future date lacking published service remains disabled');
console.log('PASS: Asynchronous calendar fare updates never enable past or unavailable departure days');

const scheduleStatusStart=source.indexOf('  function scheduleState(');
const scheduleStatusEnd=source.indexOf('  function firstLeg(',scheduleStatusStart);
assert(scheduleStatusStart>=0&&scheduleStatusEnd>scheduleStatusStart,'Calendar schedule status resolver is present');
const verifiedPattern={activeFrom:'2026-11-21',activeThrough:'2026-12-31',days:[0,1,2,4,5,6],count:1,excludeDates:['2026-12-25']};
const statusContext={
  monthKeyFromDate:d=>d.slice(0,7),
  scheduleMonthData:new Map(),
  scheduleMonthKey:(a,b,m)=>a+'|'+b+'|'+m,
  publishedServicePattern:()=>verifiedPattern,
  patternAppliesOnDate:(p,d)=>d>=p.activeFrom&&d<=p.activeThrough&&!p.excludeDates.includes(d)&&p.days.includes(new Date(d+'T12:00:00Z').getUTCDay()),
  isScheduleFallbackCode:()=>false
};
vm.createContext(statusContext);
vm.runInContext(source.slice(scheduleStatusStart,scheduleStatusEnd)+'\nthis.scheduleState=scheduleState;',statusContext);
assert.equal(statusContext.scheduleState('DFW','CVN','2026-12-08').status,'yes','Published operating day is selectable within timetable range');
assert.equal(statusContext.scheduleState('DFW','CVN','2026-12-09').status,'none','Published nonoperating weekday is not presented as a flight');
assert.equal(statusContext.scheduleState('DFW','CVN','2026-12-25').status,'none','Explicitly excluded timetable date is not presented as operating');
assert.equal(statusContext.scheduleState('DFW','CVN','2027-01-05').status,'fallback','Expired published timetable cannot verify flights next year');
assert.equal(statusContext.scheduleState('DFW','CVN','2026-11-20').status,'fallback','Flight before published timetable validity is unverified');
console.log('PASS: Calendar availability respects timetable date windows, exclusions and weekdays');

const empty429QueueStart=source.indexOf('  function pumpFareQueue()');
const empty429QueueEnd=source.indexOf('  function fetchFare(',empty429QueueStart);
assert(empty429QueueStart>=0&&empty429QueueEnd>empty429QueueStart,'Fare provider queue is present for 429 regression');
let empty429Resolved=null,empty429Rejected=null,empty429Requests=0;
const empty429Task={a:'ELD',b:'DFW',date:'2026-12-08',key:'ELD|DFW|2026-12-08',
  resolve:value=>{empty429Resolved=value;},reject:error=>{empty429Rejected=error;}};
const empty429Context={
  clearTimeout:()=>{},setTimeout:()=>null,Date,
  farePumpTimer:null,fareQueue:[empty429Task],fareActive:0,
  FARE_MAX_CONCURRENT:1,FARE_START_GAP_MS:0,lastFareStartAt:0,fareBlockedUntil:0,
  fareActiveKeys:new Set(),updateCalendarCell:()=>{},
  F:{fetchOffers:async()=>{empty429Requests++;return {ok:false,status:429,data:null};}},
  fareNoOfferCounts:new Map(),fareCoverageBlockedLegs:new Set(),
  fareLegKey:(a,b)=>a+'|'+b,
  coverageFallbackData:()=>({coverageLimited:true,offers:[]}),
  externalFareSearchUrl:()=>'',firstLeg:()=>null,el:{calendarStatus:null},
  updateCalendarFareStatus:()=>{}
};
vm.createContext(empty429Context);
vm.runInContext(source.slice(empty429QueueStart,empty429QueueEnd)+'\nthis.pumpFareQueue=pumpFareQueue;',empty429Context);
for(let attempt=1;attempt<=3;attempt++){
  empty429Context.fareBlockedUntil=0;
  empty429Context.pumpFareQueue();
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(empty429Requests,attempt,'Exactly one provider request per permitted attempt');
  assert.equal(empty429Rejected,null,'Empty 429 body never throws a malformed-payload error');
  assert.equal(empty429Task.rateLimitRetries,attempt,'Rate limits increment attempt count');
  if(attempt<3){
    assert.equal(empty429Context.fareQueue.length,1,'First two 429 replies requeue the same date');
    assert.equal(empty429Resolved,null,'Original fare promise remains unresolved before final retry');
  }
}
assert.equal(empty429Context.fareQueue.length,0,'Third 429 does not requeue indefinitely');
assert.equal(empty429Resolved?.temporaryUnavailable,true,'After bounded retries, fallback reports temporary rate-limit unavailability');
assert(empty429Context.fareBlockedUntil>Date.now(),'Empty rate-limit response still schedules provider cooldown');
console.log('PASS: Empty-body HTTP 429 respects cooldown and retries twice without a false malformed-provider error');

const beforeArrival=optionCtx.providerOptions({offers:[
  {...offerBase,departureTime:'2026-12-08T23:30:00',arrivalTime:'2026-12-07T23:00:00',durationMinutes:90,amount:75},
  {...offerBase,amount:215}
]},'ELD','DFW','2026-12-08');
assert.equal(beforeArrival.length,1,'Provider flight arriving on previous day cannot be selected despite a positive duration');
assert.equal(beforeArrival[0].price,215,'Valid flight survives invalid prior-day arrival filtering');

fareCtx.liveFareByLeg.clear();
fareCtx.selectedFareByLeg.set(1,{amount:160,currency:'USD',fareStatus:'unverified'});
fareCtx.selectedFareByLeg.set(2,{amount:180,currency:'USD',fareStatus:'verified'});
fareCtx.updateLiveTripFare();
assert.match(fareNode.innerHTML,/Itinerary fare total \?340/,'Non-prototype unverified fares cannot appear as a confirmed dollar total');
assert.match(fareNode.innerHTML,/Includes unverified or prototype fare values/,'Fare summary explains why estimated totals are not bookable quotes');
assert.doesNotMatch(fareNode.innerHTML,/All selected fares are verified provider values/,'Mixed verification status never claims all fares verified');

const retainedPriorityCalls=[],priorityOutcomes=[];
const priorityQueueCtx={
  clearTimeout:()=>{},setTimeout:()=>null,
  farePumpTimer:null,
  fareQueue:[
    {a:'ELD',b:'DFW',date:'2026-12-08',key:'auto',priority:false,resolve:x=>priorityOutcomes.push(['auto',x]),reject:e=>{throw e;}},
    {a:'ELD',b:'DFW',date:'2026-12-09',key:'manual',priority:true,resolve:x=>priorityOutcomes.push(['manual',x]),reject:e=>{throw e;}},
    {a:'ELD',b:'DFW',date:'2026-12-10',key:'background',priority:false,resolve:x=>priorityOutcomes.push(['background',x]),reject:e=>{throw e;}}
  ],
  fareActive:0,FARE_MAX_CONCURRENT:1,FARE_START_GAP_MS:0,lastFareStartAt:0,fareBlockedUntil:0,
  fareActiveKeys:new Set(),updateCalendarCell:()=>{},
  F:{fetchOffers:async(a,b,date)=>{retainedPriorityCalls.push(date);return {ok:true,status:200,data:{offers:[],liveMode:true}};}},
  fareNoOfferCounts:new Map([['ELD|DFW',2]]),fareCoverageBlockedLegs:new Set(),
  fareLegKey:(a,b)=>a+'|'+b,
  coverageFallbackData:()=>({offers:[],coverageLimited:true}),
  externalFareSearchUrl:()=>'',firstLeg:()=>null,el:{calendarStatus:null},updateCalendarFareStatus:()=>{}
};
vm.createContext(priorityQueueCtx);
vm.runInContext(source.slice(pumpStart,pumpEnd)+'\nthis.pumpFareQueue=pumpFareQueue;',priorityQueueCtx);
priorityQueueCtx.pumpFareQueue();
await new Promise(resolve=>setTimeout(resolve,30));
assert(retainedPriorityCalls.includes('2026-12-09'),'Coverage cap does not prevent explicit traveler-selected date from reaching fare provider');
assert(!retainedPriorityCalls.includes('2026-12-10'),'Automatic background date is capped after repeated misses');
assert(priorityOutcomes.some(([name])=>name==='manual'),'Traveler priority promise resolves after automatic coverage cap');
assert(priorityOutcomes.some(([name,data])=>name==='background'&&data.coverageLimited),'Background date resolves with a truthful coverage gap');
console.log('PASS: Traveler-priority fare checks survive automatic coverage limits, invalid prior-day flights are rejected, and unverified totals are marked');
