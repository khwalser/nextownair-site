(function(){
  'use strict';
  const D=window.NTA_DATA||{airports:[]};
  let state=window.NTA.load();

  const el={
    routebar:document.getElementById('routebar'),
    startDate:document.getElementById('startDate'),
    startDateButton:document.getElementById('startDateButton'),
    startDateButtonText:document.getElementById('startDateButtonText'),
    startDateCalendar:document.getElementById('startDateCalendar'),
    calendarPrev:document.getElementById('calendarPrev'),
    calendarNext:document.getElementById('calendarNext'),
    calendarMonth:document.getElementById('calendarMonth'),
    calendarGrid:document.getElementById('calendarGrid'),
    calendarStatus:document.getElementById('calendarStatus'),
    content:document.getElementById('content'),
    summary:document.getElementById('summary'),
    mapNav:document.getElementById('mapNav'),
    editRoute:document.getElementById('editRoute'),
    footerMap:document.getElementById('footerMap'),
    brandHome:document.getElementById('brandHome'),
    printTrip:document.getElementById('printTrip'),
    toolbar:document.getElementById('toolbar'),
    calendarKey:document.getElementById('calendarKey'),
    calendarServiceKey:document.getElementById('calendarServiceKey')
  };

  function by(code){return window.NTA.byCode(code);}
  const F=window.NTA_FLIGHTS;
  function transferFor(a,b){return window.NTA.getTransferLink?window.NTA.getTransferLink(a,b):null;}
  function isTransferLeg(a,b){return Boolean(transferFor(a,b));}
  function flightLegCount(){let n=0;for(let i=0;i<state.route.length-1;i++)if(!isTransferLeg(state.route[i],state.route[i+1]))n++;return n;}
  function transferLegCount(){let n=0;for(let i=0;i<state.route.length-1;i++)if(isTransferLeg(state.route[i],state.route[i+1]))n++;return n;}
  const liveFareCache=new Map();
  const liveFareData=new Map();
  const liveFareByLeg=new Map();
  const selectedFareByLeg=new Map();
  const scheduleMonthCache=new Map();
  const scheduleMonthData=new Map();
  const calendarFareJobs=new Set();
  const fareQueue=[];
  const fareActiveKeys=new Set();
  const fareNoOfferCounts=new Map();
  const fareCoverageBlockedLegs=new Set();
  const KNOWN_FARE_COVERAGE_GAPS=new Set([
    'DTW|APN','APN|DTW',
    'DTW|CIU','CIU|DTW',
    'ORD|CMX','CMX|ORD'
  ]);
  const PUBLISHED_SERVICE_PATTERNS={
    'DTW|APN':{days:[0,1,2,3,4,5,6],count:1,label:'Daily nonstop service',source:'Alpena County Regional Airport / Delta Connection published service'},
    'APN|DTW':{days:[0,1,2,3,4,5,6],count:1,label:'Daily nonstop service',source:'Alpena County Regional Airport / Delta Connection published service'},
    'DTW|CIU':{days:[0,1,2,3,4,5,6],count:1,label:'Daily nonstop service',source:'Chippewa County International Airport / Delta published schedule'},
    'CIU|DTW':{days:[0,1,2,3,4,5,6],count:1,label:'Daily nonstop service',source:'Chippewa County International Airport / Delta published schedule'},
    'ORD|CMX':{days:[0,1,2,3,4,5,6],count:2,label:'Daily nonstop service',source:'Houghton County Memorial Airport / United published schedule'},
    'CMX|ORD':{days:[0,1,2,3,4,5,6],count:2,label:'Daily nonstop service',source:'Houghton County Memorial Airport / United published schedule'},
    'FAI|MCG':{days:[1,4,6],count:1,label:'Monday, Thursday and Saturday nonstop service',source:'Wright Air Service current timetable, updated October 2026'},
    'MCG|FAI':{days:[1,4,6],count:1,label:'Monday, Thursday and Saturday nonstop service',source:'Wright Air Service current timetable, updated October 2026'},
    'FAI|TKJ':{days:[2,4,6],count:1,label:'Tuesday, Thursday and Saturday nonstop service',source:'Wright Air Service current timetable, updated October 2026'},
    'TKJ|FAI':{days:[2,4,6],count:1,label:'Tuesday, Thursday and Saturday nonstop service',source:'Wright Air Service current timetable, updated October 2026'}
  };
  function isKnownFareCoverageGap(a,b){return KNOWN_FARE_COVERAGE_GAPS.has(fareLegKey(a,b));}
  function publishedServicePattern(a,b){return (D.servicePatterns&&D.servicePatterns[fareLegKey(a,b)])||PUBLISHED_SERVICE_PATTERNS[fareLegKey(a,b)]||null;}
  function patternAppliesOnDate(pattern,date){
    if(!pattern||!date)return false;
    if(pattern.activeFrom&&date<pattern.activeFrom)return false;
    if(pattern.activeThrough&&date>pattern.activeThrough)return false;
    if(Array.isArray(pattern.excludeDates)&&pattern.excludeDates.includes(date))return false;
    const p=parseYmd(date);if(!p)return false;
    const dow=new Date(Date.UTC(p.y,p.m-1,p.d,12)).getUTCDay();
    return Array.isArray(pattern.days)&&pattern.days.includes(dow);
  }
  function patternDeparturesForDate(pattern,date){
    if(!patternAppliesOnDate(pattern,date))return [];
    const p=parseYmd(date),dow=new Date(Date.UTC(p.y,p.m-1,p.d,12)).getUTCDay();
    const rows=(pattern.departuresByDow&&pattern.departuresByDow[String(dow)])||pattern.departures||[];
    return Array.isArray(rows)?rows:[];
  }
  function publishedScheduleMonth(a,b,month){
    const pattern=publishedServicePattern(a,b);if(!pattern)return null;
    const [year,mon]=month.split('-').map(Number);
    const daysInMonth=new Date(year,mon,0,12).getDate();
    const days={},checkedDates=[],unknownDates=[];
    for(let d=1;d<=daysInMonth;d++){
      const date=`${year}-${String(mon).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      if((pattern.activeFrom&&date<pattern.activeFrom)||(pattern.activeThrough&&date>pattern.activeThrough)){unknownDates.push(date);continue;}
      checkedDates.push(date);
      if(!patternAppliesOnDate(pattern,date))continue;
      const departures=patternDeparturesForDate(pattern,date);
      const count=departures.length||Math.max(1,Number(pattern.count)||1);
      const flights=departures.map((row,idx)=>{
        const arriveNext=String(row.arrive||'')<String(row.depart||'');
        const arrivalDate=arriveNext?window.NTA.addDays(date,1):date;
        return {
          ident:row.ident||pattern.ident||`Published ${idx+1}`,
          airline:row.airline||pattern.airline||'Published carrier',
          scheduledOut:`${date}T${row.depart}:00`,
          scheduledIn:`${arrivalDate}T${row.arrive}:00`
        };
      });
      days[date]={count,source:'published-pattern',...(flights.length?{flights}: {})};
    }
    return {provider:'published-pattern',sourceType:'published-schedule',origin:a,destination:b,month,days,checkedDates,unknownDates,patternLabel:pattern.label,sourceLabel:pattern.source||pattern.sourceLabel,publishedPattern:true};
  }
  const FARE_MAX_CONCURRENT=1;
  const FARE_START_GAP_MS=5000;
  const AUTO_PRICE_WINDOW=31; // Price every published service date in the visible month.
  const FARE_SESSION_KEY='nextownair.liveFares.v1';
  const FARE_SESSION_TTL_MS=5*60*1000;
  const SCHEDULE_FALLBACK_SESSION_KEY='nextownair.scheduleFallback.v1';
  const SCHEDULE_FALLBACK_TTL_MS=15*60*1000;
  let fareActive=0;
  let lastFareStartAt=0;
  let fareBlockedUntil=0;
  let farePumpTimer=null;
  let renderVersion=0;
  let calendarMonthDate=null;
  let calendarLoadVersion=0;
  let calendarAutoLoadKey='';
  let calendarScheduleCompleteKey='';
  const scheduleFallbackCodes=new Set(['schedule_provider_not_configured','schedule_subscription_inactive','schedule_auth_failed','schedule_quota_exhausted']);
  let scheduleProviderUnavailableCode='';
  function isScheduleFallbackCode(code){return scheduleFallbackCodes.has(String(code||''));}
  function restoreScheduleFallback(){
    try{
      const saved=JSON.parse(sessionStorage.getItem(SCHEDULE_FALLBACK_SESSION_KEY)||'null');
      if(saved&&isScheduleFallbackCode(saved.code)&&Date.now()-Number(saved.savedAt||0)<=SCHEDULE_FALLBACK_TTL_MS)scheduleProviderUnavailableCode=saved.code;
    }catch(_){/* session storage can be unavailable */}
  }
  function rememberScheduleFallback(code){
    if(!isScheduleFallbackCode(code))return;
    scheduleProviderUnavailableCode=code;
    try{sessionStorage.setItem(SCHEDULE_FALLBACK_SESSION_KEY,JSON.stringify({code,savedAt:Date.now()}));}catch(_){/* session storage can be unavailable */}
  }
  function restoreFareSession(){
    try{
      const now=Date.now(),store=JSON.parse(sessionStorage.getItem(FARE_SESSION_KEY)||'{}');
      const emptyByLeg=new Map();
      Object.entries(store).forEach(([key,entry])=>{
        if(!entry||!entry.data||!Number.isFinite(Number(entry.savedAt))||now-Number(entry.savedAt)>FARE_SESSION_TTL_MS)return;
        liveFareData.set(key,entry.data);liveFareCache.set(key,Promise.resolve(entry.data));
        const [a,b]=key.split('|');
        if(!a||!b)return;
        const lk=fareLegKey(a,b),data=entry.data;
        // Older builds stored synthetic coverage-gap results. They are not evidence
        // of a provider fare check and must not permanently suppress new probes.
        if(isKnownFareCoverageGap(a,b)&&data.coverageLimited&&!lowestOffer(data)){
          liveFareData.delete(key);liveFareCache.delete(key);
          return;
        }
        if(data.coverageLimited){
          fareCoverageBlockedLegs.add(lk);
          return;
        }
        if(!data.error&&Array.isArray(data.offers)&&data.offers.length===0){
          const misses=(emptyByLeg.get(lk)||0)+1;
          emptyByLeg.set(lk,misses);
          if(misses>=3)fareCoverageBlockedLegs.add(lk);
        }
      });
    }catch(_){/* session storage can be unavailable */}
  }
  function rememberFareData(key,data){
    liveFareData.set(key,data);
    if(!data||data.error)return data;
    try{
      const now=Date.now(),store=JSON.parse(sessionStorage.getItem(FARE_SESSION_KEY)||'{}');
      store[key]={savedAt:now,data};
      const fresh=Object.entries(store).filter(([,entry])=>entry&&now-Number(entry.savedAt||0)<=FARE_SESSION_TTL_MS).slice(-50);
      sessionStorage.setItem(FARE_SESSION_KEY,JSON.stringify(Object.fromEntries(fresh)));
    }catch(_){/* session storage can be unavailable */}
    return data;
  }
  restoreFareSession();
  restoreScheduleFallback();
  function isoDate(iso){return String(iso||'').slice(0,10);}
  function isoMinutes(iso){
    const m=String(iso||'').match(/T(\d{2}):(\d{2})/);
    return m?Number(m[1])*60+Number(m[2]):null;
  }
  function parseYmd(date){
    const p=String(date||'').split('-').map(Number);
    return p.length===3&&p.every(Number.isFinite)?{y:p[0],m:p[1],d:p[2]}:null;
  }
  function ymd(y,m,d){
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  function monthStart(date){
    const p=parseYmd(date)||parseYmd(window.NTA.todayLocal());
    return new Date(p.y,p.m-1,1,12,0,0,0);
  }
  function monthDateString(dateObj,day){
    return ymd(dateObj.getFullYear(),dateObj.getMonth()+1,day);
  }
  function monthTitle(dateObj){
    return dateObj.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  }
  function formatStartDate(date){
    const p=parseYmd(date);if(!p)return date;
    return new Date(p.y,p.m-1,p.d,12,0,0,0).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'});
  }
  function monthKeyFromDate(date){return String(date||'').slice(0,7);}
  function scheduleMonthKey(a,b,month){return `${a}|${b}|${month}`;}
  function mergeScheduleData(base,next){
    const nextChecked=new Set(next.checkedDates||[]);
    const checkedDates=[...new Set([...(base?.checkedDates||[]),...(next.checkedDates||[])])];
    const unknownDates=[...new Set([
      ...(base?.unknownDates||[]).filter(d=>!nextChecked.has(d)),
      ...(next.unknownDates||[])
    ])];
    const merged={
      provider:next.provider||base?.provider||'schedule-provider',
      sourceType:next.sourceType||base?.sourceType||'published-schedule',
      origin:next.origin||base?.origin,
      destination:next.destination||base?.destination,
      month:next.month||base?.month,
      checkedAt:next.checkedAt||base?.checkedAt,
      days:{...(base?.days||{})},
      checkedDates,
      unknownDates,
      partial:unknownDates.length>0
    };
    for(const [date,value] of Object.entries(next.days||{}))merged.days[date]=value;
    return merged;
  }
  function fetchScheduleMonth(a,b,month,dates){
    const normalizedDates=Array.isArray(dates)?[...new Set(dates)].sort():[];
    const requestKey=scheduleMonthKey(a,b,month)+'|'+(normalizedDates.length?normalizedDates.join(','):'all');
    if(scheduleMonthCache.has(requestKey))return scheduleMonthCache.get(requestKey);
    const p=F.fetchScheduleMonth(a,b,month,normalizedDates)
      .then(data=>{
        if(data&&data.partial)scheduleMonthCache.delete(requestKey);
        return data;
      })
      .catch(err=>{scheduleMonthCache.delete(requestKey);throw err;});
    scheduleMonthCache.set(requestKey,p);
    return p;
  }
  function scheduleState(a,b,date){
    const month=monthKeyFromDate(date);
    const data=scheduleMonthData.get(scheduleMonthKey(a,b,month));
    if(data&&!data.error){
      const day=data.days&&data.days[date];
      if(day&&day.count>0)return {status:'yes',label:'Scheduled',detail:`${day.count} published flight${day.count===1?'':'s'}`};
      if(Array.isArray(data.unknownDates)&&data.unknownDates.includes(date))return {status:'fallback',label:'Schedule unverified',detail:'Published schedule lookup incomplete; live fare may be checked separately'};
      if(Array.isArray(data.checkedDates)&&data.checkedDates.includes(date))return publishedServicePattern(a,b)?{status:'none',label:'No scheduled service',detail:'No service on this date in published operating pattern'}:{status:'fallback',label:'Check live fare',detail:'No date-specific service confirmed by schedule source; check live offers'};
    }
    const pattern=publishedServicePattern(a,b);
    if(pattern){
      const p=parseYmd(date);
      if(p){
        const dow=new Date(Date.UTC(p.y,p.m-1,p.d,12)).getUTCDay();
        const operating=pattern.days.includes(dow);
        return operating
          ?{status:'yes',label:'Scheduled',detail:`${Math.max(1,Number(pattern.count)||1)} published flight${Number(pattern.count)===1?'':'s'}`}
          :{status:'none',label:'No scheduled service',detail:'published service pattern'};
      }
    }
    if(!data)return {status:'checking',label:'Checking…',detail:''};
    if(data.error){
      if(isScheduleFallbackCode(data.code)){
        return {status:'fallback',label:'Live fare check',detail:data.code};
      }
      return {status:'fallback',label:'Schedule unverified',detail:'Published schedule source unavailable'};
    }
    return {status:'checking',label:'Checking…',detail:''};
  }
  function firstLeg(){
    let leg=null;
    for(let i=0;i<state.route.length-1;i++){
      const a=state.route[i],b=state.route[i+1];if(isTransferLeg(a,b))continue;
      leg={a,b,index:i};break;
    }
    return leg;
  }
  function calendarAvailability(date){
    const leg=firstLeg();if(!leg)return {status:'none',label:''};
    const fareData=liveFareData.get(fareKey(leg.a,leg.b,date));
    if(lowestOffer(fareData))return {status:'available',label:'Live fare'};
    const stateForDate=scheduleState(leg.a,leg.b,date);
    if(stateForDate.status==='yes')return {status:'available',label:'Scheduled'};
    if(stateForDate.status==='none')return {status:'unavailable',label:'No published flight'};
    if(stateForDate.status==='fallback')return {status:'fallback',label:'Flight unverified'};
    if(stateForDate.status==='error')return {status:'retry',label:'Retry'};
    return {status:'checking',label:'Checking'};
  }
  function calendarFareText(a,b,date,av){
    const key=fareKey(a,b,date),data=liveFareData.get(key);
    if(data){
      if(data.error)return 'fare unavailable';
      const best=lowestOffer(data);
      if(best)return formatMoney(best.amount,best.currency);
      if(data.coverageLimited&&av.status!=='unavailable')return av.status==='available'?'flight ✓':'unverified';
      if(av.status!=='unavailable')return av.status==='available'?'flight ✓':'unverified';
    }
    if(fareActiveKeys.has(key))return av.status==='available'?'flight ✓':'pricing…';
    if(liveFareCache.has(key))return av.status==='available'?'flight ✓':'checking';
    if(av.status==='unavailable')return '—';
    if(av.status==='retry')return 'unverified';
    if(av.status==='checking')return 'checking';
    return av.status==='fallback'?'unverified':'flight ✓';
  }
  function calendarFareTitle(a,b,date,av){
    if(fareCoverageBlockedLegs.has(fareLegKey(a,b))){
      const blockedBest=lowestOffer(liveFareData.get(fareKey(a,b,date)));
      if(blockedBest)return `Lowest live fare ${formatMoney(blockedBest.amount,blockedBest.currency)}`;
      if(av.status==='available')return 'Published nonstop service · live fare provider coverage is limited';
      if(av.status==='unavailable')return 'No published nonstop service found for this date';
    }
    const data=liveFareData.get(fareKey(a,b,date)),best=lowestOffer(data);
    if(av.status==='available'){
      if(best)return `Published nonstop service · lowest live fare ${formatMoney(best.amount,best.currency)}`;
      if(data&&!data.error)return 'Published nonstop service · connected fare provider returned no nonstop price; the airline may still sell this flight';
      if(data?.error)return 'Published nonstop service · live fare lookup unavailable';
      return 'Published nonstop service · live fare is loading';
    }
    if(av.status==='fallback'){
      if(best)return `Schedule provider unavailable · live fare ${formatMoney(best.amount,best.currency)}`;
      if(data&&!data.error)return 'Schedule provider unavailable · connected fare provider returned no nonstop price; the airline may still sell this flight';
      if(data?.error)return 'Schedule provider unavailable · live fare lookup will retry when possible';
      return 'Schedule provider unavailable · checking live fares';
    }
    if(av.status==='unavailable')return 'No published nonstop service found for this date';
    return 'Checking published schedule';
  }
  function scheduledCalendarDates(a,b,month){
    const data=scheduleMonthData.get(scheduleMonthKey(a,b,month));
    if(!data||data.error)return [];
    return Object.entries(data.days||{})
      .filter(([date,day])=>date.startsWith(month+'-')&&day&&day.count>0)
      .map(([date])=>date)
      .sort();
  }
  function calendarMoreFareControl(a,b,month,dates,queued){
    const button=document.getElementById('calendarMoreFares');
    if(!button)return;
    const remaining=dates.filter(date=>{
      const key=fareKey(a,b,date);
      return !liveFareData.has(key)&&!calendarFareJobs.has(key);
    });
    const pending=dates.filter(date=>calendarFareJobs.has(fareKey(a,b,date))).length;
    button.hidden=!remaining.length||fareCoverageBlockedLegs.has(fareLegKey(a,b));
    button.disabled=pending>0;
    const batchLimit=isKnownFareCoverageGap(a,b)?2:5;
    button.textContent=pending>0
      ?`Checking ${pending} queued date${pending===1?'':'s'}…`
      :`Check next ${Math.min(batchLimit,remaining.length)} of ${remaining.length} unchecked date${remaining.length===1?'':'s'}`;
  }
  function updateCalendarFareStatus(){
    const leg=firstLeg();if(!leg||!calendarMonthDate)return;
    const month=`${calendarMonthDate.getFullYear()}-${String(calendarMonthDate.getMonth()+1).padStart(2,'0')}`;
    const key=scheduleMonthKey(leg.a,leg.b,month);
    if(calendarScheduleCompleteKey!==key)return;
    const scheduleData=scheduleMonthData.get(key);
    const moreButton=document.getElementById('calendarMoreFares');
    if(moreButton)moreButton.hidden=true;
    if(fareCoverageBlockedLegs.has(fareLegKey(leg.a,leg.b))){
      const pattern=publishedServicePattern(leg.a,leg.b);
      el.calendarStatus.textContent=pattern
        ?`${pattern.label} is published for ${leg.a} → ${leg.b}. The fare provider has limited coverage on this route; select a date to request another live fare check.`
        :`Choose a departure date. Live fare pricing is not available in-app for this route; use “Check current fares” on the flight leg after selecting a date.`;
      return;
    }
    if(scheduleData&&scheduleData.error&&isScheduleFallbackCode(scheduleData.code)){
      const monthCells=[...el.calendarGrid.querySelectorAll('.calendar-day[data-calendar-date]')].filter(cell=>!cell.classList.contains('past'));
      const priced=monthCells.filter(cell=>Boolean(lowestOffer(liveFareData.get(fareKey(leg.a,leg.b,cell.dataset.calendarDate))))).length;
      const checked=monthCells.filter(cell=>liveFareData.has(fareKey(leg.a,leg.b,cell.dataset.calendarDate))).length;
      const queued=monthCells.filter(cell=>calendarFareJobs.has(fareKey(leg.a,leg.b,cell.dataset.calendarDate))).length;
      const total=monthCells.length;
      calendarMoreFareControl(leg.a,leg.b,month,monthCells.map(cell=>cell.dataset.calendarDate),queued);
      el.calendarStatus.textContent=queued
        ?checked
          ?`${checked} of ${total} dates checked; ${priced} with a live fare and ${queued} checks pending. Other dates remain unchecked until requested.`
          :`Checking ${queued} priority dates out of ${total}; remaining dates can be requested in batches.`
        :priced
          ?`${checked} of ${total} dates checked; ${priced} with a live fare. ${total-checked} date${total-checked===1?' remains':'s remain'} unchecked. Choose another date or use Check next dates to continue.`
          :checked
            ?`${checked} of ${total} dates checked; no live nonstop fares returned. ${total-checked} date${total-checked===1?' remains':'s remain'} unchecked. This does not prove those flights do not operate.`
            :`No live fares checked yet. Selected and nearby dates are prioritized.`;
      return;
    }
    const dates=scheduledCalendarDates(leg.a,leg.b,month);
    const priced=dates.filter(date=>Boolean(lowestOffer(liveFareData.get(fareKey(leg.a,leg.b,date))))).length;
    if(!dates.length){
      const liveDates=[...liveFareData.entries()]
        .filter(([key,data])=>key.startsWith(leg.a+'|'+leg.b+'|'+month+'-')&&Boolean(lowestOffer(data)))
        .map(([key])=>key.slice(-10));
      el.calendarStatus.textContent=liveDates.length
        ?'Live flight offers are available for '+liveDates.length+' date'+(liveDates.length===1?'':'s')+' this month. The separate published schedule feed has incomplete coverage; choose a highlighted fare date or check other dates.'
        :'Published schedule data has no confirmed dates for this month. Live fare checks can identify bookable offers on highlighted dates; other dates remain unverified.';
      return;
    }
    const checked=dates.filter(date=>liveFareData.has(fareKey(leg.a,leg.b,date))).length;
    const queued=dates.filter(date=>calendarFareJobs.has(fareKey(leg.a,leg.b,date))).length;
    calendarMoreFareControl(leg.a,leg.b,month,dates,queued);
    el.calendarStatus.textContent=queued
      ?`Published flights confirmed on ${dates.length} dates. Checking live prices: ${checked} of ${dates.length} checked, ${priced} priced, ${queued} queued or in progress. Selected and nearby dates go first.`
      :`Published flights confirmed on ${dates.length} dates. Live fares found on ${priced}; dates without fares are not necessarily unavailable. Select a date to request its price.`;
  }
  function queueCalendarFarePricing(a,b,dates,token,limit=AUTO_PRICE_WINDOW){
    if(fareCoverageBlockedLegs.has(fareLegKey(a,b))){
      updateCalendarFareStatus();
      return;
    }
    const selected=state.startDate;
    const ordered=[...new Set(dates)].sort((x,y)=>{
      if(x===selected)return -1;
      if(y===selected)return 1;
      const dx=Math.abs(window.NTA.diffDays(selected,x)),dy=Math.abs(window.NTA.diffDays(selected,y));
      return dx-dy||x.localeCompare(y);
    }).slice(0,(function(){
      const month=dates[0]&&monthKeyFromDate(dates[0]);
      const schedule=month&&scheduleMonthData.get(scheduleMonthKey(a,b,month));
      const fallback=Boolean(schedule&&schedule.error&&isScheduleFallbackCode(schedule.code));
      const bounded=fallback?5:isKnownFareCoverageGap(a,b)?2:AUTO_PRICE_WINDOW;
      return Math.min(bounded,Math.max(1,Number(limit)||AUTO_PRICE_WINDOW));
    })());
    ordered.forEach(date=>{
      if(!['yes','fallback'].includes(scheduleState(a,b,date).status))return;
      const key=fareKey(a,b,date);
      if(liveFareData.has(key)||calendarFareJobs.has(key))return;
      calendarFareJobs.add(key);
      const promise=fetchFare(a,b,date,false);
      updateCalendarCell(date);
      const refreshVisibleCalendar=()=>{
        const visible=firstLeg();
        const visibleMonth=calendarMonthDate
          ?`${calendarMonthDate.getFullYear()}-${String(calendarMonthDate.getMonth()+1).padStart(2,'0')}`
          :'';
        if(visible?.a!==a||visible?.b!==b||visibleMonth!==monthKeyFromDate(date))return;
        updateCalendarCell(date);
        updateCalendarFareStatus();
      };
      promise.then(data=>{
        rememberFareData(key,data);
        refreshVisibleCalendar();
      }).catch(err=>{
        rememberFareData(key,{error:true,status:err.status||0,offers:[],message:String(err.message||err)});
        refreshVisibleCalendar();
      }).finally(()=>{
        calendarFareJobs.delete(key);
        refreshVisibleCalendar();
      });
    });
  }
  const calendarMoreFaresButton=document.getElementById('calendarMoreFares');
  if(calendarMoreFaresButton)calendarMoreFaresButton.addEventListener('click',()=>{
    const leg=firstLeg();
    if(!leg||!calendarMonthDate)return;
    const month=`${calendarMonthDate.getFullYear()}-${String(calendarMonthDate.getMonth()+1).padStart(2,'0')}`;
    const schedule=scheduleMonthData.get(scheduleMonthKey(leg.a,leg.b,month));
    const dates=schedule?.error&&isScheduleFallbackCode(schedule.code)
      ?[...el.calendarGrid.querySelectorAll('.calendar-day[data-calendar-date]:not(.past)')].map(cell=>cell.dataset.calendarDate)
      :scheduledCalendarDates(leg.a,leg.b,month);
    const remaining=dates.filter(date=>{
      const key=fareKey(leg.a,leg.b,date);
      return !liveFareData.has(key)&&!calendarFareJobs.has(key);
    });
    if(!remaining.length)return;
    queueCalendarFarePricing(leg.a,leg.b,remaining,calendarLoadVersion,Math.min(isKnownFareCoverageGap(leg.a,leg.b)?2:5,remaining.length));
    updateCalendarFareStatus();
  });
  function updateCalendarCell(date){
    const cell=el.calendarGrid.querySelector(`[data-calendar-date="${date}"]`);
    if(!cell)return;
    const av=calendarAvailability(date);
    cell.classList.remove('checking','available','unavailable','retry','unconfigured');
    cell.classList.add(av.status);
    cell.disabled=av.status==='unavailable';
    const fare=cell.querySelector('.calendar-fare');
    const leg=firstLeg();
    if(fare)fare.textContent=leg?calendarFareText(leg.a,leg.b,date,av):(av.status==='unavailable'?'—':'…');
    cell.title=leg?calendarFareTitle(leg.a,leg.b,date,av):'Choose a route first';
  }
  function renderStartCalendar(){
    if(!calendarMonthDate)calendarMonthDate=monthStart(state.startDate);
    el.calendarMonth.textContent=monthTitle(calendarMonthDate);
    el.calendarGrid.innerHTML='';
    const y=calendarMonthDate.getFullYear(),m=calendarMonthDate.getMonth();
    const firstDow=new Date(y,m,1,12).getDay();
    const days=new Date(y,m+1,0,12).getDate();
    const today=window.NTA.todayLocal();
    for(let i=0;i<firstDow;i++){
      const blank=document.createElement('span');blank.className='calendar-blank';el.calendarGrid.appendChild(blank);
    }
    for(let day=1;day<=days;day++){
      const date=monthDateString(calendarMonthDate,day);
      const btn=document.createElement('button');btn.type='button';btn.className='calendar-day';
      btn.dataset.calendarDate=date;
      if(date===state.startDate)btn.classList.add('selected');
      if(date<today){
        btn.classList.add('past');btn.disabled=true;
      }else{
        const av=calendarAvailability(date);
        btn.classList.add(av.status);
        btn.disabled=av.status==='unavailable';
      }
      const n=document.createElement('span');n.className='calendar-day-number';n.textContent=String(day);
      const fare=document.createElement('span');fare.className='calendar-fare';
      const av=calendarAvailability(date);
      const leg=firstLeg();
      const coverageGap=leg&&fareCoverageBlockedLegs.has(fareLegKey(leg.a,leg.b));
      if(coverageGap&&!lowestOffer(liveFareData.get(fareKey(leg.a,leg.b,date))))btn.classList.add('coverage-gap');
      fare.textContent=date<today?'':leg?calendarFareText(leg.a,leg.b,date,av):(av.status==='unavailable'?'—':'…');
      if(coverageGap&&!lowestOffer(liveFareData.get(fareKey(leg.a,leg.b,date))))fare.setAttribute('aria-hidden','true');
      btn.append(n,fare);
      btn.addEventListener('click',()=>{
        if(btn.disabled)return;
        const leg=firstLeg();
        if(leg)prioritizeFareCheck(leg.a,leg.b,date,{forceIfUnpriced:true});
        state.startDate=date;state.selections={};save();
        calendarMonthDate=monthStart(date);
        el.startDateCalendar.hidden=false;el.startDateButton.setAttribute('aria-expanded','true');
        render();
      });
      el.calendarGrid.appendChild(btn);
    }
    const currentMonth=monthStart(window.NTA.todayLocal());
    el.calendarPrev.disabled=calendarMonthDate.getFullYear()===currentMonth.getFullYear()&&calendarMonthDate.getMonth()===currentMonth.getMonth();
  }
  async function loadStartCalendarMonth(){
    const leg=firstLeg();
    if(!leg){el.calendarStatus.textContent='Choose a route first.';return;}
    const localMonth=`${calendarMonthDate.getFullYear()}-${String(calendarMonthDate.getMonth()+1).padStart(2,'0')}`;
    const localPublished=publishedScheduleMonth(leg.a,leg.b,localMonth);
    if(localPublished){
      const token=++calendarLoadVersion;
      const key=scheduleMonthKey(leg.a,leg.b,localMonth);
      scheduleMonthData.set(key,localPublished);
      calendarScheduleCompleteKey=key;
      renderStartCalendar();
      queueCalendarFarePricing(leg.a,leg.b,scheduledCalendarDates(leg.a,leg.b,localMonth),token);
      updateCalendarFareStatus();
      return;
    }
    const token=++calendarLoadVersion;
    const month=`${calendarMonthDate.getFullYear()}-${String(calendarMonthDate.getMonth()+1).padStart(2,'0')}`;
    const key=scheduleMonthKey(leg.a,leg.b,month);
    let current=scheduleMonthData.get(key);
    const y=calendarMonthDate.getFullYear(),m=calendarMonthDate.getMonth();
    const daysInMonth=new Date(y,m+1,0,12).getDate();
    const today=window.NTA.todayLocal();
    const monthDatesAll=Array.from({length:daysInMonth},(_,idx)=>ymd(y,m+1,idx+1)).filter(d=>d>=today);

    if(scheduleProviderUnavailableCode){
      current={error:true,status:503,code:scheduleProviderUnavailableCode,message:'Published schedule feed unavailable for this session.',days:{}};
      scheduleMonthData.set(key,current);
      renderStartCalendar();calendarScheduleCompleteKey=key;
      queueCalendarFarePricing(leg.a,leg.b,monthDatesAll,token);
      updateCalendarFareStatus();
      return;
    }
    if(current&&current.error&&isScheduleFallbackCode(current.code)){
      renderStartCalendar();calendarScheduleCompleteKey=key;
      queueCalendarFarePricing(leg.a,leg.b,monthDatesAll,token);
      updateCalendarFareStatus();
      return;
    }
    if(current&&current.error)current=null;
    const checked=new Set(current?.checkedDates||[]);
    const unknown=new Set(current?.unknownDates||[]);
    let remaining=monthDatesAll.filter(d=>!checked.has(d)||unknown.has(d));
    if(!remaining.length){
      renderStartCalendar();
      calendarScheduleCompleteKey=key;
      queueCalendarFarePricing(leg.a,leg.b,scheduledCalendarDates(leg.a,leg.b,month).length?scheduledCalendarDates(leg.a,leg.b,month):monthDatesAll,token);
      updateCalendarFareStatus();
      return;
    }

    if(remaining.includes(state.startDate)){
      remaining=[state.startDate,...remaining.filter(d=>d!==state.startDate)];
    }

    const BATCH_SIZE=4;
    let completed=monthDatesAll.length-remaining.length;
    el.calendarStatus.textContent=`Loading published ${leg.a} → ${leg.b} schedule… ${completed} of ${monthDatesAll.length} dates checked.`;

    try{
      for(let offset=0;offset<remaining.length;offset+=BATCH_SIZE){
        const batch=remaining.slice(offset,offset+BATCH_SIZE);
        const data=await fetchScheduleMonth(leg.a,leg.b,month,batch);
        if(token!==calendarLoadVersion)return;
        current=mergeScheduleData(current,data);
        scheduleMonthData.set(key,current);
        completed=new Set(current.checkedDates||[]).size;
        renderStartCalendar();
        el.calendarStatus.textContent=`Loading published ${leg.a} → ${leg.b} schedule… ${Math.min(completed,monthDatesAll.length)} of ${monthDatesAll.length} dates checked.`;
      }

      if(token!==calendarLoadVersion)return;

      // Retry any transiently incomplete dates once, in tiny batches.
      const retryDates=(current?.unknownDates||[]).filter(d=>monthDatesAll.includes(d));
      for(let offset=0;offset<retryDates.length;offset+=2){
        const batch=retryDates.slice(offset,offset+2);
        const data=await fetchScheduleMonth(leg.a,leg.b,month,batch);
        if(token!==calendarLoadVersion)return;
        current=mergeScheduleData(current,data);
        scheduleMonthData.set(key,current);
        renderStartCalendar();
      }

      if(token!==calendarLoadVersion)return;
      const stillUnknown=(current?.unknownDates||[]).filter(d=>monthDatesAll.includes(d));
      calendarScheduleCompleteKey=key;
      queueCalendarFarePricing(leg.a,leg.b,scheduledCalendarDates(leg.a,leg.b,month).length?scheduledCalendarDates(leg.a,leg.b,month):monthDatesAll,token);
      if(stillUnknown.length){
        el.calendarStatus.textContent=`Published schedule loaded for most dates. ${stillUnknown.length} date${stillUnknown.length===1?'':'s'} could not be confirmed; live fares for confirmed service dates load progressively.`;
      }else{
        updateCalendarFareStatus();
      }
    }catch(err){
      if(token!==calendarLoadVersion)return;
      const data={error:true,status:err.status||0,code:err.code||'',message:String(err.message||err),days:{}};
      scheduleMonthData.set(key,data);
      const providerFallback=isScheduleFallbackCode(err.code);
      if(providerFallback)rememberScheduleFallback(err.code);
      renderStartCalendar();
      if(providerFallback){
        calendarScheduleCompleteKey=key;
        queueCalendarFarePricing(leg.a,leg.b,monthDatesAll,token);
        updateCalendarFareStatus();
      }else{
        el.calendarStatus.textContent='Published schedule lookup failed. You can retry the calendar.';
      }
    }
  }
  function openStartCalendar(){
    calendarMonthDate=calendarMonthDate||monthStart(state.startDate);
    renderStartCalendar();
    el.startDateCalendar.hidden=false;
    el.startDateButton.setAttribute('aria-expanded','true');
    loadStartCalendarMonth();
  }
  function closeStartCalendar(){
    el.startDateCalendar.hidden=true;
    el.startDateButton.setAttribute('aria-expanded','false');
  }
  function showStartCalendar(forceReload=false){
    calendarMonthDate=calendarMonthDate||monthStart(state.startDate);
    renderStartCalendar();
    el.startDateCalendar.hidden=false;
    el.startDateButton.setAttribute('aria-expanded','true');
    const leg=firstLeg();
    if(!leg)return;
    const gap=isKnownFareCoverageGap(leg.a,leg.b);
    const sourcedPattern=Boolean(publishedServicePattern(leg.a,leg.b));
    if(el.calendarKey)el.calendarKey.hidden=gap||sourcedPattern;
    if(el.calendarServiceKey)el.calendarServiceKey.hidden=!(gap||sourcedPattern);
    const month=`${calendarMonthDate.getFullYear()}-${String(calendarMonthDate.getMonth()+1).padStart(2,'0')}`;
    const key=scheduleMonthKey(leg.a,leg.b,month);
    if(forceReload||calendarAutoLoadKey!==key){
      calendarAutoLoadKey=key;
      loadStartCalendarMonth();
    }
  }
  function providerOptions(data,a,b,date){
    if(!data||!Array.isArray(data.offers))return null;
    return data.offers.map((o,idx)=>{
      const departMin=isoMinutes(o.departureTime),arrivalMin=isoMinutes(o.arrivalTime);
      if(departMin==null||arrivalMin==null)return null;
      const departDay=isoDate(o.departureTime)||date;
      const arrivalDay=isoDate(o.arrivalTime)||departDay;
      const dayOffset=Math.max(0,window.NTA.diffDays(departDay,arrivalDay));
      const providerDuration=Number(o.durationMinutes);
      const fallbackDuration=Math.max(1,Math.round((new Date(o.arrivalTime)-new Date(o.departureTime))/60000));
      const elapsed=Number.isFinite(providerDuration)&&providerDuration>0?providerDuration:fallbackDuration;
      return {
        id:`provider|${o.offerId||idx}|${a}|${b}|${date}`,
        date,departMin,arrivalMin,arrivalDayOffset:dayOffset,duration:elapsed,
        price:Number(o.amount),currency:o.currency||'USD',
        fareCount:Number(o.fareCount||1),fareChoices:Array.isArray(o.fareChoices)?o.fareChoices:[],
        intermediateStops:[],
        carrier:o.operatingCarrier||o.operatingCarrierCode||'Carrier',
        flightNo:o.flightNumber||o.operatingCarrierCode||'Flight',
        sample:false,provider:data.provider||'provider',liveMode:Boolean(data.liveMode&&o.liveMode),
        timeStatus:o.timeStatus||((data.liveMode&&o.liveMode)?'verified':'prototype'),
        fareStatus:o.fareStatus||((data.liveMode&&o.liveMode)?'verified':'prototype')
      };
    }).filter(Boolean).sort((x,y)=>x.departMin-y.departMin);
  }
  function estimatedFlightMinutes(a,b){
    const A=by(a),B=by(b);
    if(!A||!B||!Number.isFinite(Number(A.lat))||!Number.isFinite(Number(A.lon))||!Number.isFinite(Number(B.lat))||!Number.isFinite(Number(B.lon)))return 90;
    const rad=x=>Number(x)*Math.PI/180;
    const dLat=rad(Number(B.lat)-Number(A.lat)),dLon=rad(Number(B.lon)-Number(A.lon));
    const lat1=rad(A.lat),lat2=rad(B.lat);
    const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    const miles=3958.8*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
    return Math.max(45,Math.min(240,Math.round((miles/430)*60+35)));
  }
  function stableHash(value){
    let h=2166136261;
    for(const ch of String(value||'')){
      h^=ch.charCodeAt(0);
      h=Math.imul(h,16777619);
    }
    return h>>>0;
  }
  function serviceCountForDate(a,b,date){
    const pattern=publishedServicePattern(a,b);
    if(pattern){
      if(!patternAppliesOnDate(pattern,date))return 0;
      const departures=patternDeparturesForDate(pattern,date);
      return Math.max(1,departures.length||Number(pattern.count)||1);
    }
    const data=scheduleMonthData.get(scheduleMonthKey(a,b,monthKeyFromDate(date)));
    const day=data&&data.days&&data.days[date];
    if(day&&Number(day.count)>0)return Math.max(1,Number(day.count));
    return 0;
  }
  function deterministicPrototypeFare(a,b,date,index){
    const raw=92+(stableHash(`${a}|${b}|${date}|${index}|fare`)%227);
    return Math.max(75,Math.round(raw/5)*5);
  }
  function scheduleOptions(a,b,date){
    const data=scheduleMonthData.get(scheduleMonthKey(a,b,monthKeyFromDate(date)));
    const day=data&&data.days&&data.days[date];
    const flights=day&&Array.isArray(day.flights)?day.flights:[];
    return flights.map((f,idx)=>{
      const departMin=isoMinutes(f.scheduledOut),arrivalMin=isoMinutes(f.scheduledIn);
      if(departMin==null||arrivalMin==null)return null;
      const departDay=isoDate(f.scheduledOut)||date;
      const arrivalDay=isoDate(f.scheduledIn)||departDay;
      const dayOffset=Math.max(0,window.NTA.diffDays(departDay,arrivalDay));
      const elapsed=Math.max(1,dayOffset*1440+(arrivalMin-departMin));
      return {
        id:`schedule|${String(f.ident||idx).replace(/\|/g,'-')}|${a}|${b}|${date}`,
        date,
        departMin,
        arrivalMin,
        arrivalDayOffset:dayOffset,
        duration:elapsed,
        price:deterministicPrototypeFare(a,b,date,idx),
        currency:'USD',
        fareCount:0,
        fareChoices:[],
        intermediateStops:servicePatternStops(a,b),
        carrier:f.airline||'Scheduled carrier',
        flightNo:f.ident||`Flight ${idx+1}`,
        sample:false,
        provider:data.provider||'schedule-provider',
        liveMode:false,
        planning:false,
        prototype:false,
        scheduleVerified:true,
        timeStatus:'verified',
        fareStatus:'prototype'
      };
    }).filter(Boolean).sort((x,y)=>x.departMin-y.departMin);
  }
  function prototypeOptions(a,b,date){
    const count=Math.min(4,serviceCountForDate(a,b,date));
    if(!count)return [];
    const duration=estimatedFlightMinutes(a,b);
    const routeSeed=stableHash(`${a}|${b}|time`);
    const windowStart=6*60+30+(routeSeed%91);
    const windowEnd=20*60+30;
    const spacing=count===1?0:Math.floor((windowEnd-windowStart)/Math.max(1,count-1));
    return Array.from({length:count},(_,idx)=>{
      const jitter=count===1?(routeSeed%360):((stableHash(`${a}|${b}|${idx}`)%31)-15);
      const departMin=Math.max(5*60+30,Math.min(22*60,windowStart+idx*spacing+jitter));
      const total=departMin+duration;
      return {
        id:`prototype|${idx}|${a}|${b}|${date}`,
        date,
        departMin,
        arrivalMin:total%1440,
        arrivalDayOffset:Math.floor(total/1440),
        duration,
        price:deterministicPrototypeFare(a,b,date,idx),
        currency:'USD',
        fareCount:0,
        fareChoices:[],
        intermediateStops:servicePatternStops(a,b),
        carrier:'Service confirmed',
        flightNo:`Option ${idx+1}`,
        sample:false,
        provider:'nta-prototype',
        liveMode:false,
        planning:false,
        prototype:true,
        timeStatus:'prototype',
        fareStatus:'prototype'
      };
    }).sort((x,y)=>x.departMin-y.departMin);
  }
  function fareKey(a,b,date){return `${a}|${b}|${date}`;}
  function fareLegKey(a,b){return `${a}|${b}`;}
  function externalFareSearchUrl(a,b,date){return `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${a} to ${b} on ${date}`)}`;}
  function coverageFallbackData(a,b,date){return {provider:'external-search',liveMode:false,checkedAt:new Date().toISOString(),origin:a,destination:b,departureDate:date,offers:[],coverageLimited:true,externalSearchUrl:externalFareSearchUrl(a,b,date)};}
  function lowestOffer(data){
    const offers=(data&&Array.isArray(data.offers))?data.offers:[];
    return offers.reduce((best,o)=>!best||Number(o.amount)<Number(best.amount)?o:best,null);
  }
  function formatMoney(amount,currency){
    try{return new Intl.NumberFormat(undefined,{style:'currency',currency:currency||'USD',maximumFractionDigits:0}).format(amount);}
    catch(_){return `${currency||'USD'} ${Number(amount).toFixed(0)}`;}
  }
  function prototypeFareText(amount){return `?${Math.round(Number(amount)||0)}`;}
  function optionTimeText(option,min){
    const value=F.timeFrom(min);
    return option&&option.timeStatus==='prototype'?`?${value}`:value;
  }
  function optionFareText(option){
    if(!Number.isFinite(Number(option&&option.price)))return '';
    return option.fareStatus==='prototype'?prototypeFareText(option.price):formatMoney(option.price,option.currency);
  }
  function servicePatternStops(a,b){
    const p=publishedServicePattern(a,b);
    return Array.isArray(p&&p.intermediateStops)?p.intermediateStops:[];
  }
  function optionServiceText(option){
    const stops=Array.isArray(option&&option.intermediateStops)?option.intermediateStops:[];
    if(stops.length===1)return `1 stop via ${stops[0]}`;
    if(stops.length>1)return `${stops.length} stops via ${stops.join(' · ')}`;
    return 'nonstop';
  }
  function checkedTime(iso){
    const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';
    return d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
  }
  function stayAvailabilityState(a,b,date){
    const av=scheduleState(a,b,date);
    if(av.status==='yes')return {status:'yes',label:'Scheduled',detail:av.detail};
    if(av.status==='none')return {status:'none',label:'No scheduled service',detail:'published schedule'};
    if(av.status==='fallback')return {status:'fallback',label:'Check live fare',detail:'schedule feed unavailable'};
    if(av.status==='error')return {status:'error',label:'Schedule unavailable',detail:''};
    return {status:'loading',label:'Checking schedule…',detail:''};
  }
  function pumpFareQueue(){
    clearTimeout(farePumpTimer);
    farePumpTimer=null;
    while(fareQueue.length&&fareActive<FARE_MAX_CONCURRENT){
      const now=Date.now();
      const wait=Math.max(0,fareBlockedUntil-now,lastFareStartAt+FARE_START_GAP_MS-now);
      if(wait){
        if(fareBlockedUntil>now){
          const seconds=Math.max(1,Math.ceil((fareBlockedUntil-now)/1000));
          const leg=firstLeg();
          const calendarIsCoverageGap=leg&&fareCoverageBlockedLegs.has(fareLegKey(leg.a,leg.b));
          if(el.calendarStatus&&!calendarIsCoverageGap){
            el.calendarStatus.textContent=`Live fare provider rate limit reached; calendar pricing resumes automatically in about ${seconds}s.`;
          }else if(calendarIsCoverageGap){
            updateCalendarFareStatus();
          }
        }
        farePumpTimer=setTimeout(()=>{farePumpTimer=null;pumpFareQueue();},Math.min(wait,5000));
        return;
      }
      const task=fareQueue.shift();
      fareActive+=1;
      fareActiveKeys.add(task.key);
      updateCalendarCell(task.date);
      lastFareStartAt=Date.now();
      F.fetchOffers(task.a,task.b,task.date)
        .then(({ok,status,data})=>{
          if(!ok){
            if(status===429&&Number(data.retryAfterMs)>0){
              fareBlockedUntil=Math.max(fareBlockedUntil,Date.now()+Number(data.retryAfterMs));
              task.resolve({...coverageFallbackData(task.a,task.b,task.date),temporaryUnavailable:true,message:'Live pricing is temporarily rate-limited; use a prototype value or check current fares externally.'});
              updateCalendarCell(task.date);
              return;
            }
            const err=new Error(data.message||data.error||'Pricing lookup failed');err.status=status;throw err;
          }
          if(!Array.isArray(data.offers)||data.offers.length===0){
            const lk=fareLegKey(task.a,task.b);
            const misses=(fareNoOfferCounts.get(lk)||0)+1;
            fareNoOfferCounts.set(lk,misses);
            if(misses>=3){
              fareCoverageBlockedLegs.add(lk);
              for(let idx=fareQueue.length-1;idx>=0;idx--){
                const pending=fareQueue[idx];
                if(fareLegKey(pending.a,pending.b)!==lk)continue;
                fareQueue.splice(idx,1);
                pending.resolve(coverageFallbackData(pending.a,pending.b,pending.date));
              }
              task.resolve({...data,coverageLimited:true,externalSearchUrl:externalFareSearchUrl(task.a,task.b,task.date)});
              return;
            }
          }else{
            fareNoOfferCounts.set(fareLegKey(task.a,task.b),0);
          }
          task.resolve(data);
        })
        .catch(task.reject)
        .finally(()=>{
          fareActiveKeys.delete(task.key);
          updateCalendarCell(task.date);
          fareActive=Math.max(0,fareActive-1);
          pumpFareQueue();
        });
    }
  }
  function fetchFare(a,b,date,priority=false){
    const key=fareKey(a,b,date);
    if(fareCoverageBlockedLegs.has(fareLegKey(a,b))){
      const data=coverageFallbackData(a,b,date);
      liveFareData.set(key,data);
      const p=Promise.resolve(data);liveFareCache.set(key,p);return p;
    }
    if(liveFareCache.has(key))return liveFareCache.get(key);
    const p=new Promise((resolve,reject)=>{
      const task={a,b,date,key,resolve,reject,priority:Boolean(priority)};
      if(priority)fareQueue.unshift(task);else fareQueue.push(task);
      pumpFareQueue();
    }).catch(err=>{
      liveFareCache.delete(key);
      throw err;
    });
    liveFareCache.set(key,p);
    return p;
  }
  function prioritizeFareCheck(a,b,date,{forceIfUnpriced=false}={}){
    const key=fareKey(a,b,date);
    if(fareActiveKeys.has(key))return liveFareCache.get(key)||null;
    const queuedIndex=fareQueue.findIndex(task=>task.key===key);
    if(queuedIndex>=0){
      const task=fareQueue.splice(queuedIndex,1)[0];
      task.priority=true;
      fareQueue.unshift(task);
      pumpFareQueue();
      return liveFareCache.get(key)||null;
    }
    const existing=liveFareData.get(key);
    if(forceIfUnpriced&&!lowestOffer(existing)){
      liveFareData.delete(key);
      liveFareCache.delete(key);
      try{
        const store=JSON.parse(sessionStorage.getItem(FARE_SESSION_KEY)||'{}');
        if(store&&Object.prototype.hasOwnProperty.call(store,key)){
          delete store[key];
          sessionStorage.setItem(FARE_SESSION_KEY,JSON.stringify(store));
        }
      }catch(_){/* session storage can be unavailable */}
    }
    return fetchFare(a,b,date,true);
  }
  function updateLiveTripFare(){
    const node=document.getElementById('liveTripFare');if(!node)return;
    const legs=Math.max(0,state.route.length-1);
    const selected=[...selectedFareByLeg.values()].filter(x=>x&&Number.isFinite(Number(x.amount)));
    if(selected.length){
      const currency=selected[0].currency||'USD';
      const same=selected.every(x=>(x.currency||'USD')===currency);
      const hasPrototype=selected.some(x=>x.fareStatus==='prototype');
      const sum=selected.reduce((total,x)=>total+Number(x.amount||0),0);
      const total=same?(hasPrototype?prototypeFareText(sum):formatMoney(sum,currency)):'Multiple currencies';
      const label=selected.length===legs?'Itinerary fare total':'Selected fare subtotal';
      const status=hasPrototype?'Includes prototype fare values; the leading ? applies to the total.':'All selected fares are verified provider values.';
      node.innerHTML=`<strong class="${hasPrototype?'prototype-value':''}">${label} ${total}</strong><span>${selected.length} of ${legs} selected fare${selected.length===1?'':'s'} · ${status}</span>`;
      return;
    }
    const rows=[...liveFareByLeg.values()];
    const live=rows.filter(x=>x&&x.liveMode&&x.offers&&x.offers.length);
    const test=rows.filter(x=>x&&!x.liveMode&&x.offers&&x.offers.length);
    if(!rows.length){node.innerHTML='<span class="small">Checking live fares…</span>';return;}
    if(!live.length){
      node.innerHTML=test.length?'<strong>Pricing test mode</strong><span>Provider connected, but quotes are not live yet.</span>':'<strong>No provider fare returned</strong><span>The connected pricing provider returned no bookable offer for these legs. Airline fares may still exist.</span>';
      return;
    }
    const cheapest=live.map(lowestOffer).filter(Boolean);
    const currency=cheapest[0]&&cheapest[0].currency||'USD';
    const same=cheapest.every(x=>(x.currency||'USD')===currency);
    const total=same?formatMoney(cheapest.reduce((sum,x)=>sum+Number(x.amount||0),0),currency):'Multiple currencies';
    node.innerHTML=`<strong>Lowest available total ${total}</strong><span>${live.length===legs?'planned-date live fare estimate':`live quotes for ${live.length} of ${legs} legs`} · sum of the lowest returned nonstop one-way fares · updates as trip timing changes</span>`;
  }
  async function hydrateLivePricing(version){
    const legNodes=[...document.querySelectorAll('.live-fare[data-leg-index]')];
    const requests=new Map();
    legNodes.forEach(node=>{
      const a=node.dataset.origin,b=node.dataset.destination,date=node.dataset.date;
      requests.set(fareKey(a,b,date),{a,b,date,leg:Number(node.dataset.legIndex)});
    });
    let learnedSomething=false;
    await Promise.all([...requests.entries()].map(async([key,req])=>{
      if(liveFareData.has(key)){
        if(req.leg!=null)liveFareByLeg.set(req.leg,liveFareData.get(key));
        return;
      }
      try{
        const data=await fetchFare(req.a,req.b,req.date,true);
        if(version!==renderVersion)return;
        rememberFareData(key,data);
        if(req.leg!=null)liveFareByLeg.set(req.leg,data);
        learnedSomething=true;
      }catch(err){
        if(version!==renderVersion)return;
        const data={error:true,status:err.status||0,offers:[],message:String(err.message||err)};
        rememberFareData(key,data);
        if(req.leg!=null)liveFareByLeg.set(req.leg,data);
        learnedSomething=true;
      }
    }));
    if(version!==renderVersion)return;
    if(learnedSomething){render();return;}
    updateLiveTripFare();
  }
  async function hydrateScheduleAvailability(version){
    const requests=new Map();
    let patternLearned=false;
    const addRequest=(a,b,date)=>{
      if(!a||!b||!date)return;
      const month=monthKeyFromDate(date),key=scheduleMonthKey(a,b,month);
      if(publishedServicePattern(a,b)){
        const existing=scheduleMonthData.get(key);
        if(!existing||!existing.publishedPattern){
          const local=publishedScheduleMonth(a,b,month);
          if(local){scheduleMonthData.set(key,local);patternLearned=true;}
        }
        return;
      }
      if(!requests.has(key))requests.set(key,{a,b,month,dates:[]});
      requests.get(key).dates.push(date);
    };
    [...document.querySelectorAll('.stay-av[data-origin][data-destination][data-date]')].forEach(node=>{
      addRequest(node.dataset.origin,node.dataset.destination,node.dataset.date);
    });
    [...document.querySelectorAll('.leg[data-schedule-origin][data-schedule-destination][data-schedule-date]')].forEach(node=>{
      addRequest(node.dataset.scheduleOrigin,node.dataset.scheduleDestination,node.dataset.scheduleDate);
    });
    if(patternLearned&&version===renderVersion){render();return;}
    if(scheduleProviderUnavailableCode){
      let changed=false;
      requests.forEach((req,key)=>{
        const existing=scheduleMonthData.get(key);
        if(!existing||existing.code!==scheduleProviderUnavailableCode){
          scheduleMonthData.set(key,{error:true,status:503,code:scheduleProviderUnavailableCode,message:'Published schedule feed unavailable for this session.',days:{}});
          changed=true;
        }
      });
      if(changed&&version===renderVersion)render();
      return;
    }
    let learnedSomething=false;
    await Promise.all([...requests.entries()].map(async([key,req])=>{
      const existing=scheduleMonthData.get(key);
      const needed=[...new Set(req.dates)].filter(date=>{
        if(existing&&existing.error&&isScheduleFallbackCode(existing.code))return false;
        if(!existing||existing.error)return true;
        if(existing.days&&existing.days[date])return false;
        if(Array.isArray(existing.checkedDates)&&existing.checkedDates.includes(date))return false;
        return true;
      });
      if(!needed.length)return;
      try{
        const data=await fetchScheduleMonth(req.a,req.b,req.month,needed);
        if(version!==renderVersion)return;
        scheduleMonthData.set(key,mergeScheduleData(existing&&!existing?.error?existing:null,data));
        learnedSomething=true;
      }catch(err){
        if(version!==renderVersion)return;
        if(isScheduleFallbackCode(err.code))rememberScheduleFallback(err.code);
        if(!existing){
          scheduleMonthData.set(key,{error:true,status:err.status||0,code:err.code||'',message:String(err.message||err),days:{}});
        }
        learnedSomething=true;
      }
    }));
    if(version!==renderVersion)return;
    if(learnedSomething)render();
  }
  function selectedOption(legIndex,a,b,date,visibleOptions){
    const id=state.selections[String(legIndex)];
    if(!id)return null;
    const opts=visibleOptions||[];
    return opts.find(o=>o.id===id)||null;
  }
  function minutesBetween(startDate,startMin,endDate,endMin){
    return Math.max(0,window.NTA.diffDays(startDate,endDate)*1440+(endMin-startMin));
  }
  function fmtDuration(min){
    const total=Math.max(0,Math.round(Number(min)||0));
    const days=Math.floor(total/1440),hours=Math.floor((total%1440)/60),mins=total%60;
    if(days)return `${days}d ${hours}h${mins?` ${mins}m`:''}`;
    if(hours)return `${hours}h${mins?` ${mins}m`:''}`;
    return `${mins}m`;
  }
  function groundLabel(i,minutes,arrivalDate,departureDate){
    if(i===0||minutes<=0)return '—';
    const s=defaultStay(i);
    if(s.mode==='nights'||(s.mode==='date'&&window.NTA.diffDays(arrivalDate,departureDate)>0))return 'Stopover';
    if(s.mode==='later'||minutes>=240)return 'Long layover';
    return 'Connection';
  }
  function defaultStay(i){
    const stored=state.stays[String(i)];if(stored)return stored;
    return {mode:'asap',nights:0,date:null};
  }
  function save(){state=window.NTA.save(state);syncLinks();}
  function syncLinks(){
    const mapUrl=window.NTA.buildUrl('index.html',state);
    el.mapNav.href=mapUrl;el.editRoute.href=mapUrl;el.footerMap.href=mapUrl;el.brandHome.href=mapUrl;
    window.NTA.updateAddress('itinerary.html',state);
  }
  function chooseFlight(i,id){
    state.selections[String(i)]=id;
    save();render();
  }
  function setStay(i,next){
    state.stays[String(i)]=next;
    save();render();
  }
  function setStayByDate(i,arrivalDate,chosen){
    if(!window.NTA.validDate(chosen))return;
    let diff=window.NTA.diffDays(arrivalDate,chosen);
    if(diff<0){chosen=arrivalDate;diff=0;}
    if(diff>=1&&diff<=4)setStay(i,{mode:'nights',nights:diff,date:null});
    else setStay(i,{mode:'date',nights:Math.max(0,diff),date:chosen});
  }
  function stayPlan(i,arrivalDate,arrivalMin,hasExactArrival){
    let s=defaultStay(i);
    if(s.mode==='date'&&s.date&&window.NTA.diffDays(arrivalDate,s.date)<0){s={mode:'date',nights:0,date:arrivalDate};state.stays[String(i)]=s;save();}
    if(s.mode==='nights')return {date:window.NTA.addDays(arrivalDate,s.nights||0),notBefore:null,mode:s.mode,summary:`Stay ${s.nights} night${s.nights===1?'':'s'} · depart ${window.NTA.fmtDate(window.NTA.addDays(arrivalDate,s.nights||0))}`};
    if(s.mode==='date'){
      const date=s.date||arrivalDate,diff=Math.max(0,window.NTA.diffDays(arrivalDate,date));
      return {date,notBefore:(diff===0&&hasExactArrival)?arrivalMin+60:null,mode:s.mode,summary:diff===0?`Same-day departure · ${window.NTA.fmtDate(date)}${hasExactArrival?' · after arrival':''}`:`Stay ${diff} night${diff===1?'':'s'} · depart ${window.NTA.fmtDate(date)}`};
    }
    if(s.mode==='later')return {date:arrivalDate,notBefore:hasExactArrival?arrivalMin+240:null,mode:s.mode,summary:hasExactArrival?'Same-day departures · after a 4-hour minimum ground interval':'Same-day departures · exact choices update after you pick the inbound flight'};
    return {date:arrivalDate,notBefore:hasExactArrival?arrivalMin+60:null,mode:'asap',summary:hasExactArrival?`Same-day departures · after ${F.timeFrom((arrivalMin+60)%1440)}`:'Same-day departures · exact choices update after you pick the inbound flight'};
  }
  function renderRoutebar(){
    el.routebar.innerHTML='';
    const autoSet=new Set(state.autoConnectorIndices||[]);
    state.route.forEach((code,i)=>{
      const a=by(code);if(!a)return;
      if(i){const arrow=document.createElement('span');arrow.className='arrow';arrow.textContent='→';el.routebar.appendChild(arrow);}
      const intermediate=i>0&&i<state.route.length-1;
      const autoConnector=intermediate&&autoSet.has(i);
      const s=intermediate?defaultStay(i):null;
      const suffix=autoConnector?(s&&s.mode!=='asap'?' · stay':' · connect'):(intermediate?' · stop':'');
      const chip=document.createElement('span');chip.className=`routechip ${autoConnector?'connector':a.type==='eas'?'eas':'destination'}`;chip.textContent=`${a.city} · ${a.code}${suffix}`;el.routebar.appendChild(chip);
    });
  }
  function appendStayAvailability(section,i,airport,arrivalDate,hasExactArrival,s){
    const nextCode=state.route[i+1];
    const wrap=document.createElement('div');
    wrap.className='stay-availability';
    if(!hasExactArrival||!nextCode){
      wrap.classList.add('pending');
      const strong=document.createElement('strong');strong.textContent='Available onward service dates';
      const span=document.createElement('span');span.textContent='Select the inbound flight first; NexTownAir will then show the next service dates.';
      wrap.append(strong,span);
      section.querySelector('.stay-grid').insertAdjacentElement('afterend',wrap);
      return;
    }
    const head=document.createElement('div');head.className='stay-availability-head';
    const title=document.createElement('strong');title.textContent='Available onward service dates';
    const sub=document.createElement('span');sub.textContent='Choose a service date; the next leg will show the flights that fit your arrival and that date.';
    head.append(title,sub);wrap.appendChild(head);
    const grid=document.createElement('div');grid.className='stay-availability-grid';
    [1,2,3,4].forEach(n=>{
      const date=window.NTA.addDays(arrivalDate,n);
      const av=stayAvailabilityState(airport.code,nextCode,date);
      const active=(s.mode==='date'&&s.date===date)||(s.mode==='nights'&&s.nights===n);
      const btn=document.createElement('button');btn.type='button';
      btn.className='stay-av '+av.status+(active?' active':'');
      btn.dataset.stayAv=String(n);btn.dataset.origin=airport.code;btn.dataset.destination=nextCode;btn.dataset.date=date;
      const nights=document.createElement('span');nights.className='stay-av-nights';nights.textContent=n+' night'+(n===1?'':'s')+' later';
      const value=document.createElement('strong');value.textContent=window.NTA.fmtDate(date,{weekday:'short',month:'short',day:'numeric'});
      const meta=document.createElement('span');
      meta.textContent=av.label+(av.detail?' · '+av.detail:'');
      btn.append(nights,value,meta);
      btn.disabled=av.status==='none'||av.status==='loading'||av.status==='error';
      btn.addEventListener('click',()=>{if(!btn.disabled)setStay(i,{mode:'date',nights:n,date});});
      grid.appendChild(btn);
    });
    wrap.appendChild(grid);
    const note=document.createElement('div');note.className='small';
    note.textContent='Dates with confirmed service can be selected. The number of nights is shown only as the consequence of that departure date; flight choices and fares appear on the next leg.';
    wrap.appendChild(note);
    section.querySelector('.stay-grid').insertAdjacentElement('afterend',wrap);
  }
  function renderStay(i,airport,arrivalDate,arrivalMin,hasExactArrival){
    const s=defaultStay(i),plan=stayPlan(i,arrivalDate,arrivalMin,hasExactArrival);
    const autoConnector=(state.autoConnectorIndices||[]).includes(i);
    const section=document.createElement('section');section.className=`stay${autoConnector?' connector':''}`;
    const arriveText=hasExactArrival?`${window.NTA.fmtDate(arrivalDate)} · ${F.timeFrom(arrivalMin)}`:`${window.NTA.fmtDate(arrivalDate)} · choose the inbound flight to set the arrival time`;
    section.innerHTML=`
      <div class="eyebrow">At ${airport.city}, ${airport.state} · ${airport.code}${autoConnector?' · Automatic connection':''}</div>
      <h3>Choose when to continue from ${airport.city}</h3>
      <div class="small">Arrival: ${arriveText}</div>
      <div class="stay-grid">
        <div>
          <div class="choices" role="group" aria-label="Onward departure timing at ${airport.city}">
            <button type="button" class="choice ${s.mode==='asap'?'active':''}" data-mode="asap" ${hasExactArrival?'':'title="Pick the inbound flight to calculate same-day choices"'}>Same day</button>
          </div>
          <div class="stay-summary">${plan.summary}</div>
        </div>
        <div class="field">
          <label for="departDate-${i}">Choose another departure date</label>
          <input id="departDate-${i}" class="dateinput" type="date" min="${arrivalDate}" value="${plan.date}">
        </div>
      </div>
      ${autoConnector?`<div class="small" style="margin-top:8px"><strong>Automatic connection:</strong> NexTownAir inserted this airport because the selected route requires it. Choose any available onward departure.</div>`:airport.note?`<div class="small" style="margin-top:8px"><strong>About ${airport.city}:</strong> ${airport.note}.</div>`:''}
      ${Array.isArray(airport.stay)&&airport.stay.length?`<div class="small" style="margin-top:5px"><strong>Ideas:</strong> ${airport.stay.join(' · ')}</div>`:''}`;
    appendStayAvailability(section,i,airport,arrivalDate,hasExactArrival,s);
    section.querySelector('[data-mode="asap"]').addEventListener('click',()=>setStay(i,{mode:'asap',nights:0,date:null}));
    section.querySelector('.dateinput').addEventListener('change',ev=>setStayByDate(i,arrivalDate,ev.target.value));
    return {section,plan};
  }
  function renderTransferLeg(i,a,b,departDate,inboundArrivalDate,inboundArrivalMin,priorSelected){
    const transfer=transferFor(a,b),section=document.createElement('section');
    section.className='leg transfer-leg';section.dataset.legIndex=String(i);
    const locked=i>0&&!priorSelected,duration=Math.max(1,Number(transfer&&transfer.durationMinutes)||60);
    if(locked){
      section.innerHTML=`<div class="leghead"><div><div class="eyebrow">Transfer · ${a} → ${b}</div><h2>Ground + airport ferry transfer</h2><p class="small">Select the previous flight to place this transfer on the timeline.</p></div><span class="transfer-badge">Not a flight</span></div>`;
      return {section,chosen:null,departDate,arrivalDate:departDate,arrivalMin:null,transfer};
    }
    const hasInbound=Number.isFinite(Number(inboundArrivalMin)),startMin=hasInbound?Number(inboundArrivalMin):null,total=startMin==null?null:startMin+duration;
    const dayOffset=total==null?0:Math.floor(total/1440),arrivalMin=total==null?null:((total%1440)+1440)%1440;
    const arrivalDate=hasInbound?window.NTA.addDays(inboundArrivalDate,dayOffset):departDate;
    const durationText=duration>=60?`${Math.floor(duration/60)}h${duration%60?` ${duration%60}m`:''}`:`${duration}m`;
    const timeText=hasInbound?`<span class="prototype-value">?${F.timeFrom(startMin)} → ?${F.timeFrom(arrivalMin)}</span>`:'<span class="prototype-value">Timing set around your first onward flight</span>';
    section.innerHTML=`<div class="leghead"><div><div class="eyebrow">Transfer · ${a} → ${b}</div><h2>Ground + airport ferry transfer</h2><p class="small">${transfer&&transfer.label?transfer.label:'Required local transfer between airports.'}</p></div><span class="transfer-badge">Not a flight</span></div><div class="transfer-card"><div><strong>${timeText}</strong><span>Prototype transfer allowance · <span class="prototype-value">?${durationText}</span></span></div><div class="small">No airfare is attached to this segment. NexTownAir uses the transfer allowance only to keep downstream flight timing coherent.</div></div>`;
    return {section,chosen:{transfer:true,duration,departMin:startMin,arrivalMin,arrivalDayOffset:dayOffset,timeStatus:'prototype',fareStatus:'not-applicable',flightNo:'Ground + airport ferry',carrier:'Ketchikan local transfer'},departDate:hasInbound?inboundArrivalDate:departDate,arrivalDate,arrivalMin,transfer};
  }
  function nextConfirmedFlightDate(a,b,afterDate,days=14){
    for(let offset=1;offset<=days;offset++){
      const date=window.NTA.addDays(afterDate,offset);
      const status=scheduleState(a,b,date).status;
      if(status==='yes'||Boolean(lowestOffer(liveFareData.get(fareKey(a,b,date)))))return date;
    }
    return null;
  }
  function renderLeg(i,a,b,departDate,plan,priorSelected){
    const knownRoute=F.hasKnownRoute(a,b);
    const locked=i>0&&!priorSelected;
    const storedSelection=state.selections[String(i)];
    const autoConnector=(state.autoConnectorIndices||[]).includes(i);
    const key=fareKey(a,b,departDate);
    const fareData=liveFareData.get(key);
    let providerOpts=providerOptions(fareData,a,b,departDate);
    let usingProvider=Array.isArray(providerOpts)&&providerOpts.length>0;
    const providerMissing=Boolean(fareData)&&(fareData.error||!fareData.offers||!fareData.offers.length);
    const selectedAvailability=scheduleState(a,b,departDate);
    // Published flight evidence is independent of live fare inventory.
    // Permit explicitly marked planning options while provider pricing is pending.
    const publishedDate=knownRoute&&selectedAvailability.status==='yes';
    let verifiedScheduleOpts=publishedDate?scheduleOptions(a,b,departDate):[];
    let usingVerifiedSchedule=!usingProvider&&verifiedScheduleOpts.length>0;
    let opts=usingProvider?providerOpts:(usingVerifiedSchedule?verifiedScheduleOpts:(publishedDate?prototypeOptions(a,b,departDate):[]));
    // A late fare response must not silently erase a chosen published-service
    // planning option. Retain that option, explicitly marked prototype, alongside
    // the newly available real offers until the traveler changes their choice.
    const pinnedId=state.selections[String(i)];
    if(usingProvider&&publishedDate&&pinnedId){
      const pinnedFallback=(pinnedId.startsWith('prototype|')?prototypeOptions(a,b,departDate):pinnedId.startsWith('schedule|')?scheduleOptions(a,b,departDate):[])
        .find(o=>o.id===pinnedId);
      if(pinnedFallback&&!opts.some(o=>o.id===pinnedId))opts=[...opts,pinnedFallback];
    }
    let usingPrototype=opts.some(o=>o.prototype);
    let hasPrototypeFields=opts.some(o=>o.timeStatus==='prototype'||o.fareStatus==='prototype');
    let note=knownRoute?(usingVerifiedSchedule?'Choose an available published flight. Times are verified; fares beginning with ? are prototype values.':(usingPrototype?'Choose an available service. Values beginning with ? are prototype values used to complete the MVP itinerary.':(usingProvider?'Choose one flight to continue.':selectedAvailability.status==='yes'?'Published flight service is reported for this date, but a selectable flight has not been returned.':'The route is known, but flight operation on this date has not been verified. Check another date or current fares.'))):'No verified route is available for this pair.';

    if(!locked&&i>0&&plan&&plan.notBefore!=null){
      opts=opts.filter(o=>o.departMin>=plan.notBefore);
      if(opts.length===0&&usingPrototype&&autoConnector&&plan.mode==='asap'){
        const nextDate=window.NTA.addDays(departDate,1);
        const nextOpts=scheduleOptions(a,b,nextDate);
        const fallbackNextOpts=nextOpts.length?nextOpts:prototypeOptions(a,b,nextDate);
        if(fallbackNextOpts.length){
          departDate=nextDate;
          opts=fallbackNextOpts;
          note='No same-day service option remains for this automatic connection, so the itinerary continues on the next known service day.';
        }
      }
      if(opts.length===0){
        note=usingProvider
          ?'No provider offer fits this connection window. Change the stay above or choose another departure date.'
          :usingVerifiedSchedule
            ?'No published flight fits this connection window. Change the stay above or choose another departure date.'
            :'No known flight option fits this connection window. Change the stay above or choose another departure date.';
      }
    }else if(locked){
      note='Choose the inbound flight first. NexTownAir will then show only departures that leave after you arrive and clear the connection buffer.';
    }

    // Automatic connectors may advance to a future service date above.
    // Compare saved selections with the final effective departure date, not
    // the provisional date, or valid next-day choices disappear on rerender.
    if(storedSelection&&!String(storedSelection).endsWith(`|${a}|${b}|${departDate}`)){
      delete state.selections[String(i)];
      save();
    }
    const A=by(a),B=by(b),leg=document.createElement('section');leg.className=`leg${locked?' leg-locked':''}`;
    if(knownRoute){
      leg.dataset.scheduleOrigin=a;
      leg.dataset.scheduleDestination=b;
      leg.dataset.scheduleDate=departDate;
    }
    let fareMarkup='';
    if(knownRoute){
      const previewNote=locked?' · planned-date preview':'';
      if(!fareData){
        fareMarkup=`<div class="live-fare loading" data-leg-index="${i}" data-origin="${a}" data-destination="${b}" data-date="${departDate}"><div class="live-fare-label">Flight offers${previewNote}</div><div class="live-fare-value">Checking provider…</div></div>`;
      }else if(fareData.error){
        fareMarkup=`<div class="live-fare unavailable" data-leg-index="${i}" data-origin="${a}" data-destination="${b}" data-date="${departDate}"><div class="live-fare-label">Flight offers${previewNote}</div><div class="live-fare-value">Provider unavailable</div><div class="small">Pricing can be retried without changing the itinerary.</div></div>`;
      }else if(!fareData.offers||!fareData.offers.length){
        const searchUrl=fareData.externalSearchUrl||externalFareSearchUrl(a,b,departDate);
        const limited=fareData.coverageLimited||fareCoverageBlockedLegs.has(fareLegKey(a,b));
        const fallbackForFare=scheduleOptions(a,b,departDate);
        const proto=fallbackForFare.length?fallbackForFare:prototypeOptions(a,b,departDate);
        const protoFare=proto[0]&&optionFareText(proto[0]);
        fareMarkup=`<div class="live-fare prototype" data-leg-index="${i}" data-origin="${a}" data-destination="${b}" data-date="${departDate}"><div class="live-fare-label">Flight offers${previewNote}</div><div class="live-fare-value ${protoFare?'prototype-value':''}">${protoFare?`Prototype fare ${protoFare}`:(limited?'Provider coverage gap':'No provider fare returned')}</div><div class="small">${protoFare?'A real service is known for this date; live fare coverage is unavailable, so the MVP uses a clearly marked prototype fare.':(limited?'The connected fare provider does not reliably cover this route.':'The route is verified, but the connected provider returned no nonstop inventory for this date.')} </div><a class="btn tertiary" href="${searchUrl}" target="_blank" rel="noopener">Check current fares ↗</a></div>`;
      }else{
        const best=lowestOffer(fareData),isLive=Boolean(fareData.liveMode&&best&&best.liveMode);
        fareMarkup=`<div class="live-fare ${isLive?'live':'test'}" data-leg-index="${i}" data-origin="${a}" data-destination="${b}" data-date="${departDate}"><div class="live-fare-label">${isLive?(locked?'Live fare preview':'Live flights') :'Provider test flights'} · nonstop economy${previewNote}</div><div class="live-fare-value">Lowest fare ${best?formatMoney(best.amount,best.currency):'—'}</div><div class="small">${fareData.offers.length} flight${fareData.offers.length===1?'':'s'} · exact returned fare prices shown below · checked ${checkedTime(fareData.checkedAt)}${locked?' · exact choices unlock after inbound flight selection':''}</div>${locked?'':`<button class="view-flight-options" type="button" data-view-flight-options>View ${fareData.offers.length} flight option${fareData.offers.length===1?'':'s'} ↓</button>`}</div>`;
      }
    }

    leg.innerHTML=`<div class="leghead"><div><div class="eyebrow">Leg ${i+1}</div><h2>${A.city} → ${B.city}</h2><div class="muted">${a} → ${b}</div></div><div class="leg-date">${window.NTA.fmtDate(departDate,{weekday:'short',month:'short',day:'numeric'})}</div></div><p class="small">${note}</p>${fareMarkup}<div class="options" id="flight-options-${i}"></div>`;
    const box=leg.querySelector('.options');
    const viewOptions=leg.querySelector('[data-view-flight-options]');
    if(viewOptions)viewOptions.addEventListener('click',()=>box.scrollIntoView({behavior:'smooth',block:'start'}));

    if(locked){
      if(state.selections[String(i)]){delete state.selections[String(i)];save();}
      box.outerHTML=`<div class="pending-flights"><strong>Waiting for your arrival at ${a}.</strong><br>Select Leg ${i} first. Once the inbound flight is chosen, departures from ${a} will be filtered to your actual arrival time and connection plan.</div>`;
      return {section:leg,chosen:null,departDate,options:[]};
    }
    if(!knownRoute){
      box.outerHTML=`<div class="no-flights"><strong>No planning route for ${a} → ${b}.</strong><br>Return to the map and re-add the destination so NexTownAir can insert a connector path. <a href="${window.NTA.buildUrl('index.html',state)}">Edit this route on the map</a>.</div>`;
      if(state.selections[String(i)]){delete state.selections[String(i)];save();}
      return {section:leg,chosen:null,departDate,options:[]};
    }
    if(!opts.length){
      const stillChecking=!fareData;
      if(i===0){
        const next=nextConfirmedFlightDate(a,b,departDate);
        box.innerHTML=`<div class="${stillChecking?'pending-flights':'no-flights'}">${stillChecking?'Checking published service and live offers for this date.':'No selectable offer was returned for this date; this does not prove the flight does not operate.'} ${next?`<button type="button" class="btn tertiary" data-first-next-date>Try confirmed flight date ${window.NTA.fmtDate(next,{weekday:'short',month:'short',day:'numeric'})}</button>`:''} <button type="button" class="btn tertiary" data-open-departure-calendar>Explore other departure dates</button></div>`;
        const nextButton=box.querySelector('[data-first-next-date]');
        if(nextButton)nextButton.addEventListener('click',()=>{
          state.startDate=next;state.selections={};save();
          calendarMonthDate=monthStart(next);render();
        });
        box.querySelector('[data-open-departure-calendar]').addEventListener('click',()=>{
          showStartCalendar(false);
          el.startDateCalendar.scrollIntoView({behavior:'smooth',block:'start'});
        });
      }else if(locked){
        box.innerHTML='<div class="pending-flights">Choose the inbound flight first to unlock onward dates.</div>';
      }else{
        const next=nextConfirmedFlightDate(a,b,departDate);
        const explanation=stillChecking?'Checking onward service and fares.':'No selectable flight fits the selected connection date.';
        box.innerHTML=`<div class="${stillChecking?'pending-flights':'no-flights'}">${explanation} ${next?`<button type="button" class="btn tertiary" data-next-service-date>Try confirmed service on ${window.NTA.fmtDate(next,{weekday:'short',month:'short',day:'numeric'})}</button>`:'Check the stay dates above or look up current fares; no later confirmed service date is available in the next 14 days.'}</div>`;
        const moveButton=box.querySelector('[data-next-service-date]');
        if(moveButton)moveButton.addEventListener('click',()=>{
          setStay(i,{mode:'date',date:next,nights:0});
        });
      }
      return {section:leg,chosen:null,departDate,options:[]};
    }

    const optionHead=document.createElement('div');optionHead.className='flight-options-head';
    optionHead.innerHTML=`<div><strong>Choose a flight</strong><span>${opts.length} flight option${opts.length===1?'':'s'} for ${window.NTA.fmtDate(departDate,{weekday:'short',month:'short',day:'numeric'})}</span></div><span>Select one to continue</span>`;
    box.appendChild(optionHead);

    opts.forEach(o=>{
      const selected=state.selections[String(i)]===o.id;
      const arr=F.arrival(o,departDate);
      const bt=document.createElement('button');bt.type='button';bt.className=`flight${selected?' selected':''}`;bt.setAttribute('aria-pressed',String(selected));
      const badge=o.scheduleVerified?'Published flight':(o.prototype?'Known service':(o.liveMode?'Live flight':'Provider flight'));
      const fareChoices=(o.fareChoices||[]).filter(x=>Number.isFinite(Number(x.amount)));
      const fareLabel=optionFareText(o);
      const timeClass=o.timeStatus==='prototype'?' prototype-value':'';
      const fareClass=o.fareStatus==='prototype'?' prototype-value':'';
      const price=Number.isFinite(Number(o.price))?(
        usingProvider&&fareChoices.length>1&&o.fareStatus==='verified'
          ? `<div class="price${fareClass}">Lowest fare ${fareLabel}</div><div class="fare-choice-list" aria-label="Returned fare prices">${fareChoices.map((f,idx)=>`<span class="fare-choice${idx===0?' lowest':''}">${idx===0?'Lowest · ':''}${formatMoney(f.amount,f.currency||o.currency)}</span>`).join('')}</div><div class="small">${fareChoices.length} live fare prices returned for this flight</div>`
          : `<div class="price${fareClass}">${fareLabel}</div>`
      ):'';
      bt.innerHTML=`<div class="times${timeClass}">${optionTimeText(o,o.departMin)} → ${optionTimeText(o,arr.min)}${o.arrivalDayOffset?' +1 day':''}</div><div class="small">${o.flightNo} · ${o.carrier}</div><div class="small">${fmtDuration(o.duration)} · ${optionServiceText(o)}</div>${price}<span class="flight-badge">${badge}</span><div class="selectlabel">${selected?'✓ Selected':'Select this flight'}</div>`;
      bt.addEventListener('click',()=>chooseFlight(i,o.id));box.appendChild(bt);
    });

    const chosen=selectedOption(i,a,b,departDate,opts);
    if(state.selections[String(i)]&&!chosen){delete state.selections[String(i)];save();}
    return {section:leg,chosen,departDate,options:opts};
  }
  function renderTravelChart(timeline){
    if(!timeline.length)return '';
    const maxSegment=Math.max(...timeline.flatMap(x=>[x.flightMin||0,x.transferMin||0,x.groundMin||0]),1);
    const totalFlight=timeline.reduce((sum,x)=>sum+(x.transfer?0:(x.flightMin||0)),0);
    const totalTransfer=timeline.reduce((sum,x)=>sum+(x.transfer?(x.transferMin||0):0),0);
    const totalGround=timeline.reduce((sum,x)=>sum+(x.groundMin||0),0);
    const totalElapsed=timeline[timeline.length-1].elapsedMin;
    const stopoverGround=timeline.reduce((sum,x)=>sum+(x.groundKind==='Stopover'?x.groundMin:0),0);
    const connectionGround=Math.max(0,totalGround-stopoverGround);
    const rows=[];
    timeline.forEach((x,i)=>{
      if(i>0&&x.groundMin>0){
        const prev=timeline[i-1];
        rows.push(`
          <div class="travel-row ground-row ${x.groundKind==='Stopover'?'stopover-row':''}" role="row">
            <div class="travel-leg" role="cell">
              <strong>${x.fromCity}</strong>
              <span>${x.groundKind}</span>
            </div>
            <div class="travel-time" role="cell">
              <strong>${prev.arrivalTime}</strong>
              <span>${window.NTA.fmtDate(prev.arrivalDate,{weekday:'short',month:'short',day:'numeric'})}</span>
            </div>
            <div class="travel-time" role="cell">
              <strong>${x.departTime}</strong>
              <span>${window.NTA.fmtDate(x.departDate,{weekday:'short',month:'short',day:'numeric'})}</span>
            </div>
            <div class="travel-metric" role="cell">
              <div class="metric-top"><strong>${fmtDuration(x.groundMin)}</strong><span>${x.groundKind}</span></div>
              <div class="metric-track" aria-hidden="true"><span class="metric-fill ground-fill ${x.groundKind==='Stopover'?'stopover-fill':''}" style="width:${Math.max(8,Math.round(x.groundMin/maxSegment*100))}%"></span></div>
            </div>
            <div class="travel-running" role="cell">
              <strong>${fmtDuration(Math.max(0,x.elapsedMin-x.flightMin))}</strong>
              <span>at next departure</span>
            </div>
          </div>`);
      }
      if(x.transfer){
        rows.push(`<div class="travel-row transfer-row" role="row"><div class="travel-leg" role="cell"><strong>${x.fromCity} → ${x.toCity}</strong><span>Ground + airport ferry transfer</span></div><div class="travel-time" role="cell"><strong class="prototype-value">${x.departTime}</strong><span>${window.NTA.fmtDate(x.departDate,{weekday:'short',month:'short',day:'numeric'})}</span></div><div class="travel-time" role="cell"><strong class="prototype-value">${x.arrivalTime}</strong><span>${window.NTA.fmtDate(x.arrivalDate,{weekday:'short',month:'short',day:'numeric'})}</span></div><div class="travel-metric" role="cell"><div class="metric-top"><strong class="prototype-value">?${fmtDuration(x.transferMin)}</strong><span>Transfer</span></div><div class="metric-track" aria-hidden="true"><span class="metric-fill transfer-fill" style="width:${Math.max(8,Math.round(x.transferMin/maxSegment*100))}%"></span></div></div><div class="travel-running" role="cell"><strong>${fmtDuration(x.elapsedMin)}</strong><span>from first departure</span></div></div>`);
      }else{
        rows.push(`<div class="travel-row flight-row" role="row"><div class="travel-leg" role="cell"><strong>${x.fromCity} → ${x.toCity}</strong><span>${x.flightNo}</span></div><div class="travel-time" role="cell"><strong>${x.departTime}</strong><span>${window.NTA.fmtDate(x.departDate,{weekday:'short',month:'short',day:'numeric'})}</span></div><div class="travel-time" role="cell"><strong>${x.arrivalTime}</strong><span>${window.NTA.fmtDate(x.arrivalDate,{weekday:'short',month:'short',day:'numeric'})}</span></div><div class="travel-metric" role="cell"><div class="metric-top"><strong>${fmtDuration(x.flightMin)}</strong><span>Flight</span></div><div class="metric-track" aria-hidden="true"><span class="metric-fill flight-fill" style="width:${Math.max(8,Math.round(x.flightMin/maxSegment*100))}%"></span></div></div><div class="travel-running" role="cell"><strong>${fmtDuration(x.elapsedMin)}</strong><span>from first departure</span></div></div>`);
      }
    });
    return `
      <div class="travel-chart">
        <div class="travel-chart-head">
          <div>
            <div class="eyebrow">Travel-time breakdown</div>
            <h3>Your trip as a timeline</h3>
            <p class="small">Flights, required local transfers, and time on the ground are shown as separate chronological segments.</p>
          </div>
          <div class="travel-kpis" aria-label="Travel time totals">
            <div class="travel-kpi"><span>Air time</span><strong>${fmtDuration(totalFlight)}</strong></div>
            ${totalTransfer?`<div class="travel-kpi"><span>Transfers</span><strong class="prototype-value">?${fmtDuration(totalTransfer)}</strong></div>`:''}
            <div class="travel-kpi"><span>Connections</span><strong>${fmtDuration(connectionGround)}</strong></div>
            ${stopoverGround? `<div class="travel-kpi"><span>Stopovers</span><strong>${fmtDuration(stopoverGround)}</strong></div>`:''}
            <div class="travel-kpi total-kpi"><span>Total elapsed</span><strong>${fmtDuration(totalElapsed)}</strong></div>
          </div>
        </div>
        <div class="travel-table" role="table" aria-label="Chronological flight and ground-time timeline">
          <div class="travel-row travel-header" role="row">
            <div role="columnheader">Segment</div>
            <div role="columnheader">Starts</div>
            <div role="columnheader">Ends</div>
            <div role="columnheader">Duration</div>
            <div role="columnheader">Running elapsed</div>
          </div>
          ${rows.join('')}
        </div>
      </div>`;
  }
  // Booking progress belongs to the selected flight, not its position in a mutable trip.
  // Keep it in this tab only: checking a box is a personal reminder, not a booking.
  const bookedInSession=new Set();
  function bookingProgressKey(flight){
    return [flight.from,flight.to,flight.departDate,flight.flightNo,flight.carrier].join('|');
  }
  function restoreBookingChecks(){
    document.querySelectorAll('.booking-check-input[data-booking-key]').forEach(input=>{
      input.checked=bookedInSession.has(input.dataset.bookingKey);
      input.addEventListener('change',()=>{
        if(input.checked)bookedInSession.add(input.dataset.bookingKey);
        else bookedInSession.delete(input.dataset.bookingKey);
      });
    });
  }
  function renderBookingChecklist(timeline){
    const flights=timeline.filter(x=>!x.transfer);
    if(!flights.length)return '';
    const items=flights.map((x,i)=>{
      const fareClass=x.fareStatus==='prototype'?' prototype-value':'';
      const timeClass=x.timeStatus==='prototype'?' prototype-value':'';
      return `<li class="booking-item">
        <label class="booking-check">
          <input type="checkbox" class="booking-check-input" data-booking-key="${bookingProgressKey(x).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')}" aria-label="Mark leg ${i+1} booked">
          <span>
            <strong>Leg ${i+1} · ${x.from} → ${x.to}</strong>
            <span>${window.NTA.fmtDate(x.departDate,{weekday:'short',month:'short',day:'numeric'})} · <span class="${timeClass.trim()}">${x.departTime} → ${x.arrivalTime}</span></span>
            <span>${x.flightNo} · ${x.carrier}</span>
          </span>
        </label>
        <div class="booking-action">
          <strong class="${fareClass.trim()}">${x.fareText||'Fare pending'}</strong>
          <a class="btn tertiary booking-link" href="${x.bookingUrl}" target="_blank" rel="noopener">Open booking search ↗</a>
        </div>
      </li>`;
    }).join('');
    return `<section class="booking-checklist" aria-labelledby="bookingChecklistTitle">
      <div class="booking-checklist-head">
        <div>
          <div class="eyebrow">Booking checklist</div>
          <h3 id="bookingChecklistTitle">Book each selected flight</h3>
        </div>
        <p class="small">NexTownAir organizes the itinerary; the airline or booking provider completes and services each purchase.</p>
      </div>
      <ol>${items}</ol>
    </section>`;
  }
  function renderSummary(rows,timeline){
    const legs=flightLegCount(),transfers=transferLegCount(),picked=rows.filter(r=>r.type==='flight').length,completedTransfers=rows.filter(r=>r.type==='transfer').length;
    const complete=(legs+transfers)>0&&picked===legs&&completedTransfers===transfers,transferLabel=transfers?` · ${transfers} transfer${transfers===1?'':'s'} included`:'';
    const pending=Math.max(0,legs-picked);
    const nextStep=pending>0
      ? `<div class="trip-next-step" role="status" aria-live="polite"><strong>${picked>0?'Continue building your itinerary':'Ready to build your trip'}.</strong> ${pending} flight leg${pending===1?' still needs':'s still need'} a selection. Changing dates or connections automatically removes flights that no longer fit; choose the next available flight to continue.</div>`
      :'';

    el.summary.innerHTML=`<div class="summary-top"><div><div class="eyebrow">Trip summary</div><h3 style="margin:4px 0">${picked} of ${legs} flight leg${legs===1?'':'s'} selected${transferLabel}</h3></div><div id="liveTripFare" class="live-trip-fare"><span class="small">Checking live fares…</span></div></div>${complete?'<div class="trip-complete">✓ Itinerary complete — your full travel-time breakdown is ready.</div>':''}${nextStep}${rows.length?rows.map(r=>`<div class="selectedline ${r.type==='transfer'?'transfer-line':''}">${r.text}</div>`).join(''):'<div class="muted">Choose a flight tile when you are ready. Your route and stay choices are already saved.</div>'}${complete?renderTravelChart(timeline):''}${complete?renderBookingChecklist(timeline):''}<div class="btnrow" style="margin-top:12px"><a class="btn secondary" href="${window.NTA.buildUrl('index.html',state)}">Edit route on map</a><button id="summaryPrint" class="btn tertiary" type="button">Print itinerary</button></div>`;
    restoreBookingChecks();
    document.getElementById('summaryPrint').addEventListener('click',()=>window.print());
  }
  function renderEmpty(){
    el.toolbar.hidden=true;el.routebar.innerHTML='';el.summary.innerHTML='';
    el.content.innerHTML=`<div class="empty-card"><h2>No trip yet</h2><p class="muted">Choose at least two airports on the map. Then come back here to pick flight times and decide where to stay.</p><div class="btnrow"><a class="btn" href="index.html">Choose places on the map</a></div></div>`;
  }
  function render(){
    const version=++renderVersion;
    liveFareByLeg.clear();
    selectedFareByLeg.clear();
    syncLinks();el.startDate.value=state.startDate;el.startDateButtonText.textContent=formatStartDate(state.startDate);
    if(state.route.length<2){renderEmpty();return;}
    el.toolbar.hidden=false;renderRoutebar();showStartCalendar();el.content.innerHTML='';
    let departDate=state.startDate;
    let previousChosen=null;
    let previousArrivalDate=state.startDate;
    let previousArrivalMin=null;
    let runningElapsed=0;
    const rows=[];const timeline=[];

    for(let i=0;i<state.route.length-1;i++){
      let plan=null;
      const inboundArrivalDate=previousArrivalDate;
      const inboundArrivalMin=previousArrivalMin;
      const a=state.route[i],b=state.route[i+1],transfer=transferFor(a,b);
      if(i>0&&!transfer){
        const stayRendered=renderStay(i,by(a),previousArrivalDate,previousArrivalMin,previousArrivalMin!=null);
        el.content.appendChild(stayRendered.section);plan=stayRendered.plan;departDate=plan.date;
      }
      if(transfer){
        const transferRendered=renderTransferLeg(i,a,b,departDate,inboundArrivalDate,inboundArrivalMin,previousChosen);
        el.content.appendChild(transferRendered.section);previousChosen=transferRendered.chosen;departDate=transferRendered.departDate;
        if(previousChosen){
          runningElapsed+=previousChosen.duration;
          const fromAirport=by(a),toAirport=by(b),startText=previousChosen.departMin==null?'Flexible':`?${F.timeFrom(previousChosen.departMin)}`,endText=previousChosen.arrivalMin==null?'Flexible':`?${F.timeFrom(previousChosen.arrivalMin)}`;
          timeline.push({transfer:true,from:a,to:b,fromCity:fromAirport?fromAirport.city:a,toCity:toAirport?toAirport.city:b,departDate,departTime:startText,arrivalDate:transferRendered.arrivalDate,arrivalTime:endText,transferMin:previousChosen.duration,flightMin:0,groundMin:0,groundKind:'Transfer',elapsedMin:runningElapsed});
          rows.push({type:'transfer',text:`Transfer · ${a} → ${b} · ground + airport ferry · <span class="prototype-value">?${fmtDuration(previousChosen.duration)}</span> · no airfare`});
          previousArrivalDate=transferRendered.arrivalDate;previousArrivalMin=transferRendered.arrivalMin;
        }else{previousArrivalDate=departDate;previousArrivalMin=null;}
        continue;
      }
      const legRendered=renderLeg(i,a,b,departDate,plan,previousChosen);
      const currentFareData=liveFareData.get(fareKey(state.route[i],state.route[i+1],departDate));
      if(currentFareData)liveFareByLeg.set(i,currentFareData);
      el.content.appendChild(legRendered.section);
      previousChosen=legRendered.chosen;
      departDate=legRendered.departDate;
      if(previousChosen){
        if(Number.isFinite(Number(previousChosen.price))){
          selectedFareByLeg.set(i,{
            amount:Number(previousChosen.price),
            currency:previousChosen.currency||'USD',
            fareStatus:previousChosen.fareStatus||'prototype'
          });
        }
        const arr=F.arrival(previousChosen,departDate);
        const groundMin=i>0&&inboundArrivalMin!=null?minutesBetween(inboundArrivalDate,inboundArrivalMin,departDate,previousChosen.departMin):0;
        runningElapsed+=groundMin+previousChosen.duration;
        const elapsedMin=runningElapsed;
        const fromAirport=by(state.route[i]),toAirport=by(state.route[i+1]);
        timeline.push({
          from:state.route[i],to:state.route[i+1],
          fromCity:fromAirport?fromAirport.city:state.route[i],
          toCity:toAirport?toAirport.city:state.route[i+1],
          flightNo:previousChosen.flightNo,
          carrier:previousChosen.carrier,
          departDate,
          departTime:optionTimeText(previousChosen,previousChosen.departMin),
          arrivalDate:arr.date,
          arrivalTime:optionTimeText(previousChosen,arr.min),
          fareText:optionFareText(previousChosen),
          fareStatus:previousChosen.fareStatus||'prototype',
          timeStatus:previousChosen.timeStatus||'prototype',
          bookingUrl:externalFareSearchUrl(state.route[i],state.route[i+1],departDate),
          flightMin:previousChosen.duration,groundMin,
          groundKind:groundLabel(i,groundMin,inboundArrivalDate,departDate),elapsedMin
        });
        previousArrivalDate=arr.date;previousArrivalMin=arr.min;
        rows.push({type:'flight',text:`Flight · ${state.route[i]} → ${state.route[i+1]} · ${window.NTA.fmtDate(departDate)} · ${optionTimeText(previousChosen,previousChosen.departMin)} → ${optionTimeText(previousChosen,arr.min)} · ${previousChosen.flightNo} · ${optionFareText(previousChosen)}`});
      } else {previousArrivalDate=departDate;previousArrivalMin=null;}
    }
    renderSummary(rows,timeline);
    updateLiveTripFare();
    hydrateLivePricing(version);
    hydrateScheduleAvailability(version);
  }

  el.startDateButton.addEventListener('click',()=>{
    if(!el.startDateCalendar.hidden){closeStartCalendar();return;}
    showStartCalendar(false);
  });
  el.calendarPrev.addEventListener('click',()=>{
    if(el.calendarPrev.disabled)return;
    calendarMonthDate=new Date(calendarMonthDate.getFullYear(),calendarMonthDate.getMonth()-1,1,12);
    renderStartCalendar();
    calendarAutoLoadKey='';
    showStartCalendar(true);
  });
  el.calendarNext.addEventListener('click',()=>{
    calendarMonthDate=new Date(calendarMonthDate.getFullYear(),calendarMonthDate.getMonth()+1,1,12);
    renderStartCalendar();
    calendarAutoLoadKey='';
    showStartCalendar(true);
  });
  const savedTripsList=document.getElementById('savedTripsList');
  const savedTripsStatus=document.getElementById('savedTripsStatus');
  const saveTripName=document.getElementById('saveTripName');
  function renderSavedTrips(){
    if(!savedTripsList)return;
    savedTripsList.replaceChildren();
    const entries=window.NTA.listSavedTrips();
    if(!entries.length){const p=document.createElement('p');p.className='small';p.textContent='No saved trips on this browser.';savedTripsList.appendChild(p);return;}
    for(const entry of entries){
      const row=document.createElement('div');row.className='btnrow saved-trip-row';
      const name=document.createElement('span');name.textContent=entry.name+' · '+entry.savedAt.slice(0,10);
      const open=document.createElement('button');open.type='button';open.className='btn tertiary';open.textContent='Open';open.setAttribute('aria-label','Open saved trip '+entry.name);
      open.addEventListener('click',()=>{
        const restored=window.NTA.openSavedTrip(entry.id);
        if(!restored){savedTripsStatus.textContent='Saved trip could not be opened.';return;}
        window.NTA.save(restored);
        location.href='itinerary.html';
      });
      const remove=document.createElement('button');remove.type='button';remove.className='btn tertiary';remove.textContent='Delete';remove.setAttribute('aria-label','Delete saved trip '+entry.name);
      remove.addEventListener('click',()=>{window.NTA.deleteSavedTrip(entry.id);savedTripsStatus.textContent='Saved trip deleted.';renderSavedTrips();});
      row.append(name,open,remove);savedTripsList.appendChild(row);
    }
  }
  const saveTripButton=document.getElementById('saveNamedTrip');
  if(saveTripButton)saveTripButton.addEventListener('click',()=>{
    try{
      window.NTA.saveNamedTrip(saveTripName.value,state);
      saveTripName.value='';
      savedTripsStatus.textContent='Trip saved on this browser. Flight options will be checked when reopened.';
      renderSavedTrips();
    }catch(error){savedTripsStatus.textContent=error.message;}
  });
  renderSavedTrips();
  const shareButton=document.getElementById('shareTrip');
  const shareStatus=document.getElementById('shareTripStatus');
  if(shareButton)shareButton.addEventListener('click',async()=>{
    const url=window.NTA.shareTripUrl('itinerary.html',state);
    try{
      await navigator.clipboard.writeText(url);
      shareStatus.textContent='Link copied. Flights and fares are checked again when reopened.';
    }catch(_){
      shareStatus.textContent='Copy this link: '+url;
    }
  });
  el.printTrip.addEventListener('click',()=>window.print());
  render();
})();
