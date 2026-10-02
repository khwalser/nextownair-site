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
    toolbar:document.getElementById('toolbar')
  };

  function by(code){return window.NTA.byCode(code);}
  const F=window.NTA_FLIGHTS;
  const liveFareCache=new Map();
  const liveFareData=new Map();
  const liveFareByLeg=new Map();
  const scheduleMonthCache=new Map();
  const scheduleMonthData=new Map();
  const fareQueue=[];
  const fareStarts=[];
  const FARE_WINDOW_MS=60000;
  const FARE_MAX_PER_WINDOW=8;
  let farePumpTimer=null;
  let renderVersion=0;
  let calendarMonthDate=null;
  let calendarLoadVersion=0;
  let calendarAutoLoadKey='';
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
    const merged={
      provider:next.provider||base?.provider||'aerodatabox-apimarket',
      sourceType:next.sourceType||base?.sourceType||'published-schedule',
      origin:next.origin||base?.origin,
      destination:next.destination||base?.destination,
      month:next.month||base?.month,
      checkedAt:next.checkedAt||base?.checkedAt,
      days:{...(base?.days||{})},
      checkedDates:[...new Set([...(base?.checkedDates||[]),...(next.checkedDates||[])])],
      unknownDates:[...new Set(next.unknownDates||[])],
      partial:Boolean(next.partial)
    };
    for(const [date,value] of Object.entries(next.days||{}))merged.days[date]=value;
    return merged;
  }
  function fetchScheduleMonth(a,b,month,dates){
    const normalizedDates=Array.isArray(dates)?[...new Set(dates)].sort():[];
    const requestKey=scheduleMonthKey(a,b,month)+'|'+(normalizedDates.length?normalizedDates.join(','):'all');
    if(scheduleMonthCache.has(requestKey))return scheduleMonthCache.get(requestKey);
    const query=new URLSearchParams({origin:a,destination:b,month});
    if(normalizedDates.length)query.set('dates',normalizedDates.join(','));
    const p=fetch(`/api/schedule-calendar?${query}`,{headers:{Accept:'application/json'}})
      .then(async res=>{
        const data=await res.json().catch(()=>({}));
        if(!res.ok){
          const err=new Error(data.message||data.error||'Schedule lookup failed');
          err.status=res.status;err.code=data.error||'';throw err;
        }
        return data;
      })
      .catch(err=>{scheduleMonthCache.delete(requestKey);throw err;});
    scheduleMonthCache.set(requestKey,p);
    return p;
  }
  function scheduleState(a,b,date){
    const month=monthKeyFromDate(date);
    const data=scheduleMonthData.get(scheduleMonthKey(a,b,month));
    if(!data)return {status:'checking',label:'Checking…',detail:''};
    if(data.error){
      if(data.code==='schedule_provider_not_configured')return {status:'unconfigured',label:'Schedule source needed',detail:''};
      return {status:'error',label:'Schedule unavailable',detail:''};
    }
    const day=data.days&&data.days[date];
    if(day&&day.count>0)return {status:'yes',label:'Scheduled',detail:`${day.count} published flight${day.count===1?'':'s'}`};
    if(Array.isArray(data.unknownDates)&&data.unknownDates.includes(date))return {status:'error',label:'Schedule check incomplete',detail:'retry this date'};
    return {status:'none',label:'No scheduled nonstop',detail:'no published nonstop service found'};
  }
  function firstLeg(){
    return state.route.length>=2?{a:state.route[0],b:state.route[1]}:null;
  }
  function calendarAvailability(date){
    const leg=firstLeg();if(!leg)return {status:'none',label:''};
    const stateForDate=scheduleState(leg.a,leg.b,date);
    if(stateForDate.status==='yes')return {status:'available',label:'Scheduled'};
    if(stateForDate.status==='none')return {status:'unavailable',label:'No nonstop'};
    if(stateForDate.status==='unconfigured')return {status:'unconfigured',label:'Schedule source needed'};
    if(stateForDate.status==='error')return {status:'retry',label:'Unavailable'};
    return {status:'checking',label:'Checking'};
  }
  function updateCalendarCell(date){
    const cell=el.calendarGrid.querySelector(`[data-calendar-date="${date}"]`);
    if(!cell)return;
    const av=calendarAvailability(date);
    cell.classList.remove('checking','available','unavailable','retry','unconfigured');
    cell.classList.add(av.status);
    cell.disabled=av.status!=='available'&&av.status!=='unconfigured';
    const fare=cell.querySelector('.calendar-fare');
    if(fare)fare.textContent=av.status==='available'?'scheduled':av.status==='unavailable'?'—':av.status==='unconfigured'?'choose':'…';
    cell.title=av.status==='available'?'Published nonstop service is scheduled for this date':av.status==='unavailable'?'No published nonstop service found for this date':av.status==='unconfigured'?'Schedule source is not configured; you can still choose this date':'Checking published schedule';
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
        btn.disabled=av.status!=='available'&&av.status!=='unconfigured';
      }
      const n=document.createElement('span');n.className='calendar-day-number';n.textContent=String(day);
      const fare=document.createElement('span');fare.className='calendar-fare';
      const av=calendarAvailability(date);
      fare.textContent=date<today?'':av.status==='available'?'scheduled':av.status==='unavailable'?'—':av.status==='unconfigured'?'choose':'…';
      btn.append(n,fare);
      btn.addEventListener('click',()=>{
        if(btn.disabled)return;
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
    const token=++calendarLoadVersion;
    const month=`${calendarMonthDate.getFullYear()}-${String(calendarMonthDate.getMonth()+1).padStart(2,'0')}`;
    const key=scheduleMonthKey(leg.a,leg.b,month);
    let current=scheduleMonthData.get(key);
    if(current&&!current.error&&!current.partial){
      renderStartCalendar();
      el.calendarStatus.textContent='Green dates have published nonstop service for the first leg. Fares are checked with Duffel after you choose a date.';
      return;
    }
    el.calendarStatus.textContent=`Loading published ${leg.a} → ${leg.b} schedule for ${monthTitle(calendarMonthDate)}…`;
    try{
      let remaining=current&&!current.error&&Array.isArray(current.unknownDates)&&current.unknownDates.length?current.unknownDates:null;
      for(let pass=0;pass<3;pass++){
        const data=await fetchScheduleMonth(leg.a,leg.b,month,remaining);
        if(token!==calendarLoadVersion)return;
        current=mergeScheduleData(current&&!current.error?current:null,data);
        scheduleMonthData.set(key,current);
        renderStartCalendar();
        if(!current.partial||!current.unknownDates.length)break;
        remaining=current.unknownDates;
        el.calendarStatus.textContent=`Published schedule is partially loaded. Finishing ${remaining.length} unchecked date${remaining.length===1?'':'s'}…`;
      }
      if(token!==calendarLoadVersion)return;
      el.calendarStatus.textContent=current.partial
        ?'Most published schedule dates are loaded. Amber dates were not confirmed and can be retried; they are not being treated as no-service dates.'
        :'Green dates have published nonstop service for the first leg. Fares are checked with Duffel after you choose a date.';
    }catch(err){
      if(token!==calendarLoadVersion)return;
      const data={error:true,status:err.status||0,code:err.code||'',message:String(err.message||err),days:{}};
      scheduleMonthData.set(key,data);
      renderStartCalendar();
      el.calendarStatus.textContent=err.code==='schedule_provider_not_configured'
        ?'Published-schedule calendar is ready but needs your AeroDataBox API.Market key. You can still choose a date manually.'
        :err.code==='schedule_auth_failed'
          ?'AeroDataBox API.Market rejected the key. Check the Netlify environment variable and subscription.'
          :'Published schedule lookup is temporarily unavailable. You can still choose a date manually.';
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
        carrier:o.operatingCarrier||o.operatingCarrierCode||'Carrier',
        flightNo:o.flightNumber||o.operatingCarrierCode||'Flight',
        sample:false,provider:data.provider||'provider',liveMode:Boolean(data.liveMode&&o.liveMode)
      };
    }).filter(Boolean).sort((x,y)=>x.departMin-y.departMin);
  }
  function fareKey(a,b,date){return `${a}|${b}|${date}`;}
  function lowestOffer(data){
    const offers=(data&&Array.isArray(data.offers))?data.offers:[];
    return offers.reduce((best,o)=>!best||Number(o.amount)<Number(best.amount)?o:best,null);
  }
  function formatMoney(amount,currency){
    try{return new Intl.NumberFormat(undefined,{style:'currency',currency:currency||'USD',maximumFractionDigits:0}).format(amount);}
    catch(_){return `${currency||'USD'} ${Number(amount).toFixed(0)}`;}
  }
  function checkedTime(iso){
    const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';
    return d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
  }
  function stayAvailabilityState(a,b,date){
    const av=scheduleState(a,b,date);
    if(av.status==='yes')return {status:'yes',label:'Scheduled',detail:av.detail};
    if(av.status==='none')return {status:'none',label:'No scheduled nonstop',detail:'published schedule'};
    if(av.status==='unconfigured')return {status:'error',label:'Schedule source needed',detail:''};
    if(av.status==='error')return {status:'error',label:'Schedule unavailable',detail:''};
    return {status:'loading',label:'Checking schedule…',detail:''};
  }
  function pruneFareStarts(){
    const cutoff=Date.now()-FARE_WINDOW_MS;
    while(fareStarts.length&&fareStarts[0]<=cutoff)fareStarts.shift();
  }
  function pumpFareQueue(){
    pruneFareStarts();
    while(fareQueue.length&&fareStarts.length<FARE_MAX_PER_WINDOW){
      const task=fareQueue.shift();
      fareStarts.push(Date.now());
      fetch(`/.netlify/functions/flight-proxy?origin=${encodeURIComponent(task.a)}&destination=${encodeURIComponent(task.b)}&date=${encodeURIComponent(task.date)}`,{headers:{Accept:'application/json'}})
        .then(async res=>{
          const data=await res.json().catch(()=>({}));
          if(!res.ok){const err=new Error(data.message||data.error||'Pricing lookup failed');err.status=res.status;throw err;}
          task.resolve(data);
        })
        .catch(task.reject)
        .finally(()=>{pumpFareQueue();});
    }
    if(fareQueue.length){
      pruneFareStarts();
      const wait=Math.max(500,(fareStarts[0]||Date.now())+FARE_WINDOW_MS-Date.now()+500);
      clearTimeout(farePumpTimer);
      farePumpTimer=setTimeout(()=>{farePumpTimer=null;pumpFareQueue();},wait);
    }
  }
  function fetchFare(a,b,date){
    const key=fareKey(a,b,date);
    if(liveFareCache.has(key))return liveFareCache.get(key);
    const p=new Promise((resolve,reject)=>{
      fareQueue.push({a,b,date,resolve,reject});
      pumpFareQueue();
    }).catch(err=>{
      liveFareCache.delete(key);
      throw err;
    });
    liveFareCache.set(key,p);
    return p;
  }
  function updateLiveTripFare(){
    const node=document.getElementById('liveTripFare');if(!node)return;
    const legs=Math.max(0,state.route.length-1);
    const rows=[...liveFareByLeg.values()];
    const live=rows.filter(x=>x&&x.liveMode&&x.offers&&x.offers.length);
    const test=rows.filter(x=>x&&!x.liveMode&&x.offers&&x.offers.length);
    if(!rows.length){node.innerHTML='<span class="small">Checking live fares…</span>';return;}
    if(!live.length){
      node.innerHTML=test.length?'<strong>Pricing test mode</strong><span>Provider connected, but quotes are not live yet.</span>':'<strong>Live fares unavailable</strong><span>Pricing provider access is not connected yet.</span>';
      return;
    }
    const cheapest=live.map(lowestOffer).filter(Boolean);
    const currency=cheapest[0]&&cheapest[0].currency||'USD';
    const same=cheapest.every(x=>(x.currency||'USD')===currency);
    const total=same?formatMoney(cheapest.reduce((sum,x)=>sum+Number(x.amount||0),0),currency):'Multiple currencies';
    node.innerHTML=`<strong>From ${total}</strong><span>${live.length===legs?'planned-date live fare estimate':`live quotes for ${live.length} of ${legs} legs`} · sum of lowest nonstop one-way fares · updates as trip timing changes</span>`;
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
        const data=await fetchFare(req.a,req.b,req.date);
        if(version!==renderVersion)return;
        liveFareData.set(key,data);
        if(req.leg!=null)liveFareByLeg.set(req.leg,data);
        learnedSomething=true;
      }catch(err){
        if(version!==renderVersion)return;
        const data={error:true,status:err.status||0,offers:[],message:String(err.message||err)};
        liveFareData.set(key,data);
        if(req.leg!=null)liveFareByLeg.set(req.leg,data);
        learnedSomething=true;
      }
    }));
    if(version!==renderVersion)return;
    if(learnedSomething){render();return;}
    updateLiveTripFare();
  }
  async function hydrateScheduleAvailability(version){
    const nodes=[...document.querySelectorAll('.stay-av[data-origin][data-destination][data-date]')];
    const requests=new Map();
    nodes.forEach(node=>{
      const a=node.dataset.origin,b=node.dataset.destination,date=node.dataset.date,month=monthKeyFromDate(date);
      const key=scheduleMonthKey(a,b,month);
      if(!requests.has(key))requests.set(key,{a,b,month,dates:[]});
      requests.get(key).dates.push(date);
    });
    let learnedSomething=false;
    await Promise.all([...requests.entries()].map(async([key,req])=>{
      const existing=scheduleMonthData.get(key);
      const needed=[...new Set(req.dates)].filter(date=>{
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
    const opts=visibleOptions||F.getOptions(a,b,date,legIndex);
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
  function defaultStay(i){return state.stays[String(i)]||{mode:'asap',nights:0,date:null};}
  function save(){state=window.NTA.save(state);syncLinks();}
  function syncLinks(){
    const mapUrl=window.NTA.buildUrl('index.html',state);
    el.mapNav.href=mapUrl;el.editRoute.href=mapUrl;el.footerMap.href=mapUrl;el.brandHome.href=mapUrl;
    window.NTA.updateAddress('itinerary.html',state);
  }
  function clearSelectionsFrom(legIndex){Object.keys(state.selections).forEach(k=>{if(Number(k)>=legIndex)delete state.selections[k];});}
  function chooseFlight(i,id){
    state.selections[String(i)]=id;
    clearSelectionsFrom(i+1);save();render();
  }
  function setStay(i,next){state.stays[String(i)]=next;clearSelectionsFrom(i);save();render();}
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
    if(s.mode==='later')return {date:arrivalDate,notBefore:hasExactArrival?arrivalMin+240:null,mode:s.mode,summary:hasExactArrival?'Leave later today · at least 4 hours after arrival':'Leave later the same day · exact choices update after you pick the previous flight'};
    return {date:arrivalDate,notBefore:hasExactArrival?arrivalMin+60:null,mode:'asap',summary:hasExactArrival?'Continue ASAP · allow at least 60 minutes between flights':'Continue ASAP · exact choices update after you pick the previous flight'};
  }
  function renderRoutebar(){
    el.routebar.innerHTML='';
    state.route.forEach((code,i)=>{
      const a=by(code);if(!a)return;
      if(i){const arrow=document.createElement('span');arrow.className='arrow';arrow.textContent='→';el.routebar.appendChild(arrow);}
      const hubStay=state.stays[String(i)];
      const lingering=a.type!=='eas'&&hubStay&&hubStay.mode!=='asap';
      const chip=document.createElement('span');chip.className=`routechip ${a.type==='eas'?'eas':'connector'}`;chip.textContent=`${a.city} · ${a.code}${a.type==='eas'?'':lingering?' · stay':' · connect'}`;el.routebar.appendChild(chip);
    });
  }
  function appendStayAvailability(section,i,airport,arrivalDate,hasExactArrival,s){
    const nextCode=state.route[i+1];
    const wrap=document.createElement('div');
    wrap.className='stay-availability';
    if(!hasExactArrival||!nextCode){
      wrap.classList.add('pending');
      const strong=document.createElement('strong');strong.textContent='Published outbound schedule';
      const span=document.createElement('span');span.textContent='Select the inbound flight to compare 1–4 night stays.';
      wrap.append(strong,span);
      section.querySelector('.stay-grid').insertAdjacentElement('afterend',wrap);
      return;
    }
    const head=document.createElement('div');head.className='stay-availability-head';
    const title=document.createElement('strong');title.textContent='Published outbound schedule';
    const sub=document.createElement('span');sub.textContent='Compare 1–4 nights from your actual arrival date. Duffel fares load after you choose.';
    head.append(title,sub);wrap.appendChild(head);
    const grid=document.createElement('div');grid.className='stay-availability-grid';
    [1,2,3,4].forEach(n=>{
      const date=window.NTA.addDays(arrivalDate,n);
      const av=stayAvailabilityState(airport.code,nextCode,date);
      const active=(s.mode==='nights'&&s.nights===n)||(s.mode==='date'&&s.date===date);
      const btn=document.createElement('button');btn.type='button';
      btn.className='stay-av '+av.status+(active?' active':'');
      btn.dataset.stayAv=String(n);btn.dataset.origin=airport.code;btn.dataset.destination=nextCode;btn.dataset.date=date;
      const nights=document.createElement('span');nights.className='stay-av-nights';nights.textContent=n+' night'+(n===1?'':'s');
      const value=document.createElement('strong');value.textContent=av.label;
      const meta=document.createElement('span');
      meta.textContent=window.NTA.fmtDate(date,{weekday:'short',month:'short',day:'numeric'})+(av.detail?' · '+av.detail:'');
      btn.append(nights,value,meta);
      btn.disabled=av.status==='none'||av.status==='loading'||(av.status==='error'&&av.label!=='Schedule source needed');
      btn.addEventListener('click',()=>{if(!btn.disabled)setStay(i,{mode:'nights',nights:n,date:null});});
      grid.appendChild(btn);
    });
    wrap.appendChild(grid);
    const note=document.createElement('div');note.className='small';
    note.textContent='Green means published nonstop service is scheduled. “No scheduled nonstop” means the schedule source found none for that date; live fares are checked separately with Duffel after you choose.';
    wrap.appendChild(note);
    section.querySelector('.stay-grid').insertAdjacentElement('afterend',wrap);
  }
  function renderStay(i,airport,arrivalDate,arrivalMin,hasExactArrival){
    const s=defaultStay(i),plan=stayPlan(i,arrivalDate,arrivalMin,hasExactArrival);
    const isHub=airport.type!=='eas';
    const section=document.createElement('section');section.className=`stay${isHub?' connector':''}`;
    const arriveText=hasExactArrival?`${window.NTA.fmtDate(arrivalDate)} · ${F.timeFrom(arrivalMin)}`:`${window.NTA.fmtDate(arrivalDate)} · choose the inbound flight to set the arrival time`;
    section.innerHTML=`
      <div class="eyebrow">At ${airport.city}, ${airport.state} · ${airport.code}${isHub?' · Hub / connector':''}</div>
      <h3>${isHub?'Connect onward, or stay a while?':'Stay a while, or keep going?'}</h3>
      <div class="small">Arrival: ${arriveText}</div>
      <div class="stay-grid">
        <div>
          <div class="choices" role="group" aria-label="Stay duration at ${airport.city}">
            <button type="button" class="choice ${s.mode==='asap'?'active':''}" data-mode="asap" ${hasExactArrival?'':'title="Pick the previous flight to calculate an exact connection"'}>${isHub?'Connect ASAP':'ASAP'}</button>
            <button type="button" class="choice ${s.mode==='later'?'active':''}" data-mode="later" ${hasExactArrival?'':'title="Pick the previous flight to calculate an exact connection"'}>Later today</button>
            ${[1,2,3,4].map(n=>`<button type="button" class="choice ${s.mode==='nights'&&s.nights===n?'active':''}" data-nights="${n}">${n} night${n===1?'':'s'}</button>`).join('')}
          </div>
          <div class="stay-summary">${plan.summary}</div>
        </div>
        <div class="field">
          <label for="departDate-${i}">Or choose departure date</label>
          <input id="departDate-${i}" class="dateinput" type="date" min="${arrivalDate}" value="${plan.date}">
        </div>
      </div>
      ${isHub?`<div class="small" style="margin-top:8px"><strong>Hub stopover:</strong> this airport was inserted as a connector, but you can turn it into a real stop by choosing Later today, a number of nights, or a departure date.</div>`:airport.note?`<div class="small" style="margin-top:8px">Why stop here? ${airport.note}.</div>`:''}
      ${Array.isArray(airport.stay)&&airport.stay.length?`<div class="small" style="margin-top:5px"><strong>Ideas:</strong> ${airport.stay.join(' · ')}</div>`:''}`;
    appendStayAvailability(section,i,airport,arrivalDate,hasExactArrival,s);
    section.querySelector('[data-mode="asap"]').addEventListener('click',()=>setStay(i,{mode:'asap',nights:0,date:null}));
    section.querySelector('[data-mode="later"]').addEventListener('click',()=>setStay(i,{mode:'later',nights:0,date:null}));
    section.querySelectorAll('[data-nights]').forEach(btn=>btn.addEventListener('click',()=>setStay(i,{mode:'nights',nights:Number(btn.dataset.nights),date:null})));
    section.querySelector('.dateinput').addEventListener('change',ev=>setStayByDate(i,arrivalDate,ev.target.value));
    return {section,plan};
  }
  function renderLeg(i,a,b,departDate,plan,priorSelected){
    const knownRoute=F.hasKnownRoute(a,b);
    const locked=i>0&&!priorSelected;
    const key=fareKey(a,b,departDate);
    const fareData=liveFareData.get(key);
    let providerOpts=providerOptions(fareData,a,b,departDate);
    let usingProvider=Array.isArray(providerOpts)&&providerOpts.length>0;
    let opts=usingProvider?providerOpts:F.getOptions(a,b,departDate,i);
    let note=knownRoute?'Choose one flight to continue.':'No routable planning link is available for this pair yet.';

    if(!locked&&i>0&&plan&&plan.notBefore!=null){
      opts=opts.filter(o=>o.departMin>=plan.notBefore);
      if(opts.length===0){
        note=usingProvider
          ?'No provider offer fits this connection window. Change the stay above or choose another departure date.'
          :'No sample flight fits this connection window. Change the stay above to see more choices.';
      }
    }else if(locked){
      note='Choose the inbound flight first. NexTownAir will then show only departures that leave after you arrive and clear the connection buffer.';
    }

    const A=by(a),B=by(b),leg=document.createElement('section');leg.className=`leg${locked?' leg-locked':''}`;
    let fareMarkup='';
    if(knownRoute){
      const previewNote=locked?' · planned-date preview':'';
      if(!fareData){
        fareMarkup=`<div class="live-fare loading" data-leg-index="${i}" data-origin="${a}" data-destination="${b}" data-date="${departDate}"><div class="live-fare-label">Flight offers${previewNote}</div><div class="live-fare-value">Checking provider…</div></div>`;
      }else if(fareData.error){
        fareMarkup=`<div class="live-fare unavailable" data-leg-index="${i}" data-origin="${a}" data-destination="${b}" data-date="${departDate}"><div class="live-fare-label">Flight offers${previewNote}</div><div class="live-fare-value">Provider unavailable</div><div class="small">Pricing can be retried without changing the itinerary.</div></div>`;
      }else if(!fareData.offers||!fareData.offers.length){
        fareMarkup=`<div class="live-fare unavailable" data-leg-index="${i}" data-origin="${a}" data-destination="${b}" data-date="${departDate}"><div class="live-fare-label">Flight offers${previewNote}</div><div class="live-fare-value">No nonstop offer returned</div><div class="small">The route is verified, but Duffel returned no nonstop inventory for this date.</div></div>`;
      }else{
        const best=lowestOffer(fareData),isLive=Boolean(fareData.liveMode&&best&&best.liveMode);
        fareMarkup=`<div class="live-fare ${isLive?'live':'test'}" data-leg-index="${i}" data-origin="${a}" data-destination="${b}" data-date="${departDate}"><div class="live-fare-label">${isLive?(locked?'Live fare preview':'Live flights'):'Duffel test flights'} · nonstop economy${previewNote}</div><div class="live-fare-value">From ${best?formatMoney(best.amount,best.currency):'—'}</div><div class="small">${fareData.offers.length} flight${fareData.offers.length===1?'':'s'} · duplicate fare brands collapsed · checked ${checkedTime(fareData.checkedAt)}${locked?' · exact choices unlock after inbound flight selection':''}</div>${locked?'':`<button class="view-flight-options" type="button" data-view-flight-options>View ${fareData.offers.length} flight option${fareData.offers.length===1?'':'s'} ↓</button>`}</div>`;
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
    if(!fareData){
      box.innerHTML='<div class="pending-flights">Loading flight offers…</div>';
      return {section:leg,chosen:null,departDate,options:[]};
    }
    if(!opts.length){
      box.innerHTML='<div class="no-flights">No flight offers match this timing. Change the stay or departure date to see more choices.</div>';
      return {section:leg,chosen:null,departDate,options:[]};
    }

    const optionHead=document.createElement('div');optionHead.className='flight-options-head';
    optionHead.innerHTML=`<div><strong>Choose a flight</strong><span>${opts.length} nonstop option${opts.length===1?'':'s'} for ${window.NTA.fmtDate(departDate,{weekday:'short',month:'short',day:'numeric'})}</span></div><span>Select one to continue</span>`;
    box.appendChild(optionHead);

    opts.forEach(o=>{
      const selected=state.selections[String(i)]===o.id;
      const arr=F.arrival(o,departDate);
      const bt=document.createElement('button');bt.type='button';bt.className=`flight${selected?' selected':''}`;bt.setAttribute('aria-pressed',String(selected));
      const badge=usingProvider?(o.liveMode?'Live flight':'Duffel test flight'):'Verified route · sample schedule';
      const fareLabel=o.fareCount>1?`From ${formatMoney(o.price,o.currency)}`:formatMoney(o.price,o.currency);
      const price=usingProvider?`<div class="price">${fareLabel}</div>${o.fareCount>1?`<div class="small">${o.fareCount} fare brands for this flight</div>`:''}`:'';
      bt.innerHTML=`<div class="times">${F.timeFrom(o.departMin)} → ${arr.time}${o.arrivalDayOffset?' +1 day':''}</div><div class="small">${o.flightNo} · ${o.carrier}</div><div class="small">${fmtDuration(o.duration)} · nonstop</div>${price}<span class="flight-badge">${badge}</span><div class="selectlabel">${selected?'✓ Selected':'Select this flight'}</div>`;
      bt.addEventListener('click',()=>chooseFlight(i,o.id));box.appendChild(bt);
    });

    const chosen=selectedOption(i,a,b,departDate,opts);
    if(state.selections[String(i)]&&!chosen){delete state.selections[String(i)];save();}
    return {section:leg,chosen,departDate,options:opts};
  }
  function renderTravelChart(timeline){
    if(!timeline.length)return '';
    const maxSegment=Math.max(...timeline.flatMap(x=>[x.flightMin,x.groundMin||0]),1);
    const totalFlight=timeline.reduce((sum,x)=>sum+x.flightMin,0);
    const totalGround=timeline.reduce((sum,x)=>sum+x.groundMin,0);
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
      rows.push(`
        <div class="travel-row flight-row" role="row">
          <div class="travel-leg" role="cell"><strong>${x.fromCity} → ${x.toCity}</strong><span>${x.flightNo}</span></div>
          <div class="travel-time" role="cell"><strong>${x.departTime}</strong><span>${window.NTA.fmtDate(x.departDate,{weekday:'short',month:'short',day:'numeric'})}</span></div>
          <div class="travel-time" role="cell"><strong>${x.arrivalTime}</strong><span>${window.NTA.fmtDate(x.arrivalDate,{weekday:'short',month:'short',day:'numeric'})}</span></div>
          <div class="travel-metric" role="cell">
            <div class="metric-top"><strong>${fmtDuration(x.flightMin)}</strong><span>Flight</span></div>
            <div class="metric-track" aria-hidden="true"><span class="metric-fill flight-fill" style="width:${Math.max(8,Math.round(x.flightMin/maxSegment*100))}%"></span></div>
          </div>
          <div class="travel-running" role="cell"><strong>${fmtDuration(x.elapsedMin)}</strong><span>from first departure</span></div>
        </div>`);
    });
    return `
      <div class="travel-chart">
        <div class="travel-chart-head">
          <div>
            <div class="eyebrow">Travel-time breakdown</div>
            <h3>Your trip as a timeline</h3>
            <p class="small">Flights and time on the ground are shown as separate chronological segments, so each connection or stopover sits between the flights it connects.</p>
          </div>
          <div class="travel-kpis" aria-label="Travel time totals">
            <div class="travel-kpi"><span>Air time</span><strong>${fmtDuration(totalFlight)}</strong></div>
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
  function renderSummary(rows,timeline){
    const legs=Math.max(0,state.route.length-1);const picked=rows.length;const complete=legs>0&&picked===legs;
    el.summary.innerHTML=`<div class="summary-top"><div><div class="eyebrow">Trip summary</div><h3 style="margin:4px 0">${picked} of ${legs} flight leg${legs===1?'':'s'} selected</h3></div><div id="liveTripFare" class="live-trip-fare"><span class="small">Checking live fares…</span></div></div>${complete?'<div class="trip-complete">✓ Itinerary complete — your full travel-time breakdown is ready.</div>':''}${picked?rows.map(r=>`<div class="selectedline">${r}</div>`).join(''):'<div class="muted">Choose a flight tile when you are ready. Your route and stay choices are already saved.</div>'}${complete?renderTravelChart(timeline):''}<div class="btnrow" style="margin-top:12px"><a class="btn secondary" href="${window.NTA.buildUrl('index.html',state)}">Edit route on map</a><button id="summaryPrint" class="btn tertiary" type="button">Print itinerary</button></div>`;
    document.getElementById('summaryPrint').addEventListener('click',()=>window.print());
  }
  function renderEmpty(){
    el.toolbar.hidden=true;el.routebar.innerHTML='';el.summary.innerHTML='';
    el.content.innerHTML=`<div class="empty-card"><h2>No trip yet</h2><p class="muted">Choose at least two airports on the map. Then come back here to pick flight times and decide where to stay.</p><div class="btnrow"><a class="btn" href="index.html">Choose places on the map</a></div></div>`;
  }
  function render(){
    const version=++renderVersion;
    liveFareByLeg.clear();
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
      if(i>0){
        const stayRendered=renderStay(i,by(state.route[i]),previousArrivalDate,previousArrivalMin,Boolean(previousChosen));
        el.content.appendChild(stayRendered.section);plan=stayRendered.plan;departDate=plan.date;
      }
      const legRendered=renderLeg(i,state.route[i],state.route[i+1],departDate,plan,previousChosen);
      const currentFareData=liveFareData.get(fareKey(state.route[i],state.route[i+1],departDate));
      if(currentFareData)liveFareByLeg.set(i,currentFareData);
      el.content.appendChild(legRendered.section);
      previousChosen=legRendered.chosen;
      departDate=legRendered.departDate;
      if(previousChosen){
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
          departDate,
          departTime:F.timeFrom(previousChosen.departMin),
          arrivalDate:arr.date,
          arrivalTime:arr.time,
          flightMin:previousChosen.duration,groundMin,
          groundKind:groundLabel(i,groundMin,inboundArrivalDate,departDate),elapsedMin
        });
        previousArrivalDate=arr.date;previousArrivalMin=arr.min;
        rows.push(`Leg ${i+1} · ${state.route[i]} → ${state.route[i+1]} · ${window.NTA.fmtDate(departDate)} · ${F.timeFrom(previousChosen.departMin)} → ${arr.time} · ${previousChosen.flightNo}`);
      } else {previousArrivalDate=departDate;previousArrivalMin=null;}
    }
    renderSummary(rows,timeline);
    hydrateLivePricing(version);
    hydrateScheduleAvailability(version);
  }

  el.startDateButton.addEventListener('click',()=>{
    calendarMonthDate=monthStart(state.startDate);
    showStartCalendar(true);
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
  el.printTrip.addEventListener('click',()=>window.print());
  render();
})();
