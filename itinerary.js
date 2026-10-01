(function(){
  'use strict';
  const D=window.NTA_DATA||{airports:[]};
  let state=window.NTA.load();

  const el={
    routebar:document.getElementById('routebar'),
    startDate:document.getElementById('startDate'),
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
    if(diff>=1&&diff<=3)setStay(i,{mode:'nights',nights:diff,date:null});
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
            ${[1,2,3].map(n=>`<button type="button" class="choice ${s.mode==='nights'&&s.nights===n?'active':''}" data-nights="${n}">${n} night${n===1?'':'s'}</button>`).join('')}
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
    section.querySelector('[data-mode="asap"]').addEventListener('click',()=>setStay(i,{mode:'asap',nights:0,date:null}));
    section.querySelector('[data-mode="later"]').addEventListener('click',()=>setStay(i,{mode:'later',nights:0,date:null}));
    section.querySelectorAll('[data-nights]').forEach(btn=>btn.addEventListener('click',()=>setStay(i,{mode:'nights',nights:Number(btn.dataset.nights),date:null})));
    section.querySelector('.dateinput').addEventListener('change',ev=>setStayByDate(i,arrivalDate,ev.target.value));
    return {section,plan};
  }
  function renderLeg(i,a,b,departDate,plan,priorSelected){
    const knownRoute=F.hasKnownRoute(a,b);
    let opts=F.getOptions(a,b,departDate,i);
    let note=knownRoute?'Choose one flight to continue.':'No routable planning link is available for this pair yet.';
    const locked=i>0&&!priorSelected;
    if(!locked&&i>0&&plan&&plan.notBefore!=null){
      opts=opts.filter(o=>o.departMin>=plan.notBefore);
      if(plan.mode==='asap'&&opts.length===0){
        departDate=window.NTA.addDays(departDate,1);opts=F.getOptions(a,b,departDate,i);note='No practical same-day connection in this sample schedule, so the next available choices are tomorrow.';
      } else if(plan.mode==='later'&&opts.length===0){note='No later same-day sample flights fit this plan. Choose 1 night, another date, or ASAP.';}
    } else if(locked){
      note='Choose the inbound flight first. NexTownAir will then show only departures that leave after you arrive and clear the connection buffer.';
    }

    const A=by(a),B=by(b),leg=document.createElement('section');leg.className=`leg${locked?' leg-locked':''}`;
    leg.innerHTML=`<div class="leghead"><div><div class="eyebrow">Leg ${i+1}</div><h2>${A.city} → ${B.city}</h2><div class="muted">${a} → ${b}</div></div><div class="leg-date">${window.NTA.fmtDate(departDate,{weekday:'short',month:'short',day:'numeric'})}</div></div><p class="small">${note}</p><div class="options"></div>`;
    const box=leg.querySelector('.options');
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
    if(!opts.length){box.outerHTML='<div class="no-flights">No sample flights match this timing. Change the stay above to see more choices.</div>';return {section:leg,chosen:null,departDate,options:[]};}
    opts.forEach(o=>{
      const selected=state.selections[String(i)]===o.id;
      const arr=F.arrival(o,departDate);
      const bt=document.createElement('button');bt.type='button';bt.className=`flight${selected?' selected':''}`;bt.setAttribute('aria-pressed',String(selected));
      bt.innerHTML=`<div class="times">${F.timeFrom(o.departMin)} → ${arr.time}${o.arrivalDayOffset?' +1 day':''}</div><div class="small">${o.flightNo} · ${o.carrier}</div><div class="small">${o.duration} min · nonstop</div><div class="price">$${o.price}</div><span class="flight-badge">Verified route · sample schedule & fare</span><div class="selectlabel">${selected?'✓ Selected':'Select this flight'}</div>`;
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
  function renderSummary(rows,total,timeline){
    const legs=Math.max(0,state.route.length-1);const picked=rows.length;const complete=legs>0&&picked===legs;
    el.summary.innerHTML=`<div class="summary-top"><div><div class="eyebrow">Trip summary</div><h3 style="margin:4px 0">${picked} of ${legs} flight leg${legs===1?'':'s'} selected</h3></div><div class="total">${picked?`${total}`:'$0'} <span class="small">sample total</span></div></div>${complete?'<div class="trip-complete">✓ Itinerary complete — your full travel-time breakdown is ready.</div>':''}${picked?rows.map(r=>`<div class="selectedline">${r}</div>`).join(''):'<div class="muted">Choose a flight tile when you are ready. Your route and stay choices are already saved.</div>'}${complete?renderTravelChart(timeline):''}<div class="btnrow" style="margin-top:12px"><a class="btn secondary" href="${window.NTA.buildUrl('index.html',state)}">Edit route on map</a><button id="summaryPrint" class="btn tertiary" type="button">Print itinerary</button></div>`;
    document.getElementById('summaryPrint').addEventListener('click',()=>window.print());
  }
  function renderEmpty(){
    el.toolbar.hidden=true;el.routebar.innerHTML='';el.summary.innerHTML='';
    el.content.innerHTML=`<div class="empty-card"><h2>No trip yet</h2><p class="muted">Choose at least two airports on the map. Then come back here to pick flight times and decide where to stay.</p><div class="btnrow"><a class="btn" href="index.html">Choose places on the map</a></div></div>`;
  }
  function render(){
    syncLinks();el.startDate.value=state.startDate;
    if(state.route.length<2){renderEmpty();return;}
    el.toolbar.hidden=false;renderRoutebar();el.content.innerHTML='';
    let departDate=state.startDate;
    let previousChosen=null;
    let previousArrivalDate=state.startDate;
    let previousArrivalMin=null;
    let firstDepartureDate=null;
    let firstDepartureMin=null;
    const rows=[];const timeline=[];let total=0;

    for(let i=0;i<state.route.length-1;i++){
      let plan=null;
      const inboundArrivalDate=previousArrivalDate;
      const inboundArrivalMin=previousArrivalMin;
      if(i>0){
        const stayRendered=renderStay(i,by(state.route[i]),previousArrivalDate,previousArrivalMin,Boolean(previousChosen));
        el.content.appendChild(stayRendered.section);plan=stayRendered.plan;departDate=plan.date;
      }
      const legRendered=renderLeg(i,state.route[i],state.route[i+1],departDate,plan,previousChosen);
      el.content.appendChild(legRendered.section);
      previousChosen=legRendered.chosen;
      departDate=legRendered.departDate;
      if(previousChosen){
        const arr=F.arrival(previousChosen,departDate);
        if(firstDepartureDate===null){firstDepartureDate=departDate;firstDepartureMin=previousChosen.departMin;}
        const groundMin=i>0&&inboundArrivalMin!=null?minutesBetween(inboundArrivalDate,inboundArrivalMin,departDate,previousChosen.departMin):0;
        const elapsedMin=minutesBetween(firstDepartureDate,firstDepartureMin,arr.date,arr.min);
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
        rows.push(`Leg ${i+1} · ${state.route[i]} → ${state.route[i+1]} · ${window.NTA.fmtDate(departDate)} · ${F.timeFrom(previousChosen.departMin)} → ${arr.time} · ${previousChosen.flightNo} · Sample ${previousChosen.price}`);total+=previousChosen.price;
      } else {previousArrivalDate=departDate;previousArrivalMin=null;}
    }
    renderSummary(rows,total,timeline);
  }

  el.startDate.min=window.NTA.todayLocal();
  el.startDate.addEventListener('change',ev=>{
    if(!window.NTA.validDate(ev.target.value))return;
    state.startDate=ev.target.value;state.selections={};save();render();
  });
  el.printTrip.addEventListener('click',()=>window.print());
  render();
})();
