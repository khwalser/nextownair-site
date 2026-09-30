(function(){
  'use strict';
  const D=window.NTA_DATA||{airports:[]};
  let state=window.NTA.load();
  let map=null;
  let tripLayers=[];
  const markers=new Map();

  const el={
    trip:document.getElementById('trip'),
    tripTitle:document.getElementById('tripTitle'),
    plan:document.getElementById('plan'),
    clear:document.getElementById('clear'),
    returnStart:document.getElementById('returnStart'),
    status:document.getElementById('status'),
    legSummary:document.getElementById('legSummary'),
    itinNav:document.getElementById('itinNav'),
    brandHome:document.getElementById('brandHome'),
    finder:document.getElementById('airportFinder'),
    search:document.getElementById('airportSearch'),
    options:document.getElementById('airportOptions'),
    finderStatus:document.getElementById('finderStatus'),
    map:document.getElementById('map'),
    mapTools:[...document.querySelectorAll('[data-region]')]
  };

  function by(code){return window.NTA.byCode(code);}
  function hasKnownRoute(a,b){return (D.routes||[]).some(r=>(r[0]===a&&r[1]===b)||(r[0]===b&&r[1]===a));}
  function routeLabel(i){
    const n=state.route.length;
    if(i===0)return 'Start';
    if(i===n-1 && state.route[i]===state.route[0])return 'Return';
    if(i===n-1)return 'Finish';
    return `Stop ${i}`;
  }
  function setRoute(next){state=window.NTA.setRoute(state,next);render();}
  function addAirport(code){
    const a=by(code);
    if(!a)return;
    if(state.route.length&&state.route[state.route.length-1]===code){el.finderStatus.textContent=`${a.city} is already your current stop. Choose another airport before returning here.`;return;}
    const next=state.route.slice();next.push(code);setRoute(next);
    el.finderStatus.textContent=`Added ${a.city}, ${a.state} (${a.code}).`;
    el.search.value='';
    if(map&&markers.has(code)){
      const m=markers.get(code);map.panTo(m.getLatLng());m.openTooltip();
    }
  }
  function move(i,delta){
    const j=i+delta;if(j<0||j>=state.route.length)return;
    const next=state.route.slice();[next[i],next[j]]=[next[j],next[i]];setRoute(next);
  }
  function removeAt(i){
    const next=state.route.slice();const a=by(next[i]);next.splice(i,1);setRoute(next);
    el.finderStatus.textContent=a?`Removed ${a.city} (${a.code}) from this trip.`:'Stop removed.';
  }
  function syncLinks(){
    el.itinNav.href=window.NTA.buildUrl('itinerary.html',state);
    el.brandHome.href=window.NTA.buildUrl('index.html',state);
    el.plan.href=window.NTA.buildUrl('itinerary.html',state);
    window.NTA.updateAddress('index.html',state);
  }
  function renderRouteLine(){
    if(!map)return;
    tripLayers.forEach(layer=>{try{map.removeLayer(layer);}catch(_){/* noop */}});tripLayers=[];
    if(state.route.length>1){
      const pts=state.route.map(by).filter(Boolean).map(a=>[a.lat,a.lon]);
      for(let i=0;i<state.route.length-1;i++){
        const A=by(state.route[i]),B=by(state.route[i+1]);if(!A||!B)continue;
        const known=hasKnownRoute(A.code,B.code);
        const layer=window.L.polyline([[A.lat,A.lon],[B.lat,B.lon]],{color:known?'#75d9ff':'#e7bd62',weight:known?4:5,opacity:.9,dashArray:known?'7 6':'3 7'}).addTo(map);
        tripLayers.push(layer);
      }
      if(pts.length>1){try{map.fitBounds(window.L.latLngBounds(pts),{padding:[48,48],maxZoom:6});}catch(_){/* noop */}}
    }
  }
  function renderTrip(){
    el.trip.innerHTML='';
    const n=state.route.length;
    el.tripTitle.textContent=n?`${n} place${n===1?'':'s'} selected`:'Start anywhere';
    if(!n){
      el.trip.innerHTML='<div class="empty">Click a pin on the map or use the airport search above.</div>';
    } else {
      state.route.forEach((code,i)=>{
        const a=by(code);if(!a)return;
        const row=document.createElement('div');row.className='stop';
        const num=document.createElement('div');num.className='stopnum';num.textContent=String(i+1);
        const body=document.createElement('div');body.className='stopbody';
        const title=document.createElement('strong');title.textContent=`${a.city}, ${a.state} · ${a.code}`;
        const label=document.createElement('div');label.className='stoplabel';label.textContent=`${routeLabel(i)}${a.type==='eas'?' · EAS spotlight':''}`;
        const controls=document.createElement('div');controls.className='stopcontrols';
        const up=document.createElement('button');up.type='button';up.className='smallbtn';up.textContent='Move up';up.disabled=i===0;up.setAttribute('aria-label',`Move ${a.city} earlier in trip`);up.addEventListener('click',()=>move(i,-1));
        const down=document.createElement('button');down.type='button';down.className='smallbtn';down.textContent='Move down';down.disabled=i===n-1;down.setAttribute('aria-label',`Move ${a.city} later in trip`);down.addEventListener('click',()=>move(i,1));
        const remove=document.createElement('button');remove.type='button';remove.className='smallbtn remove';remove.textContent='Remove';remove.setAttribute('aria-label',`Remove ${a.city} from trip`);remove.addEventListener('click',()=>removeAt(i));
        controls.append(up,down,remove);body.append(title,label,controls);row.append(num,body);el.trip.appendChild(row);
      });
    }

    let unsupported=0;
    if(n>1){
      el.legSummary.hidden=false;
      el.legSummary.innerHTML='<b>Flight legs</b>'+state.route.slice(0,-1).map((code,i)=>{const known=hasKnownRoute(code,state.route[i+1]);if(!known)unsupported++;return `<div>Leg ${i+1}: ${code} → ${state.route[i+1]} ${known?'':'<span class="route-warning">· needs a connector</span>'}</div>`;}).join('');
    } else {el.legSummary.hidden=true;el.legSummary.innerHTML='';}

    const ready=n>=2;
    el.plan.classList.toggle('disabled',!ready);
    el.plan.setAttribute('aria-disabled',String(!ready));
    el.returnStart.disabled=n<2 || state.route[n-1]===state.route[0];
    el.returnStart.textContent=(n>1&&state.route[n-1]===state.route[0])?'Round trip complete':'Return to start';
    el.status.textContent=ready?(unsupported?`${n-1} flight legs · ${unsupported} ${unsupported===1?'leg needs':'legs need'} a connector before flight choices will appear.`:`${n-1} flight leg${n-1===1?'':'s'} ready. Reorder or add stops any time.`):'Choose at least two places to create your first flight leg.';
  }
  function render(){syncLinks();renderTrip();renderRouteLine();}

  function makeIcon(a){
    const eas=a.type==='eas';
    return window.L.divIcon({className:'',html:`<div class="marker-${eas?'eas':'other'}" style="width:${eas?22:16}px;height:${eas?22:16}px"></div>`,iconSize:[24,24],iconAnchor:[12,12]});
  }
  function initLeaflet(){
    if(!window.L)return false;
    try{
      map=window.L.map('map',{scrollWheelZoom:false,minZoom:2}).setView([39.5,-97.5],4);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:12,attribution:'© OpenStreetMap'}).addTo(map);
      (D.routes||[]).forEach(r=>{const A=by(r[0]),B=by(r[1]);if(A&&B)window.L.polyline([[A.lat,A.lon],[B.lat,B.lon]],{color:'#3b566b',weight:2,opacity:.48,dashArray:'2 7',interactive:false}).addTo(map);});
      D.airports.forEach(a=>{
        const m=window.L.marker([a.lat,a.lon],{icon:makeIcon(a),keyboard:true,title:`${a.city}, ${a.state} (${a.code})`}).addTo(map);
        m.bindTooltip(`${a.city}, ${a.state} · ${a.code}${a.type==='eas'&&Array.isArray(a.hubs)&&a.hubs.length?` · via ${a.hubs.join(' / ')}`:''}`,{direction:'top',offset:[0,-10]});
        m.on('click',()=>addAirport(a.code));markers.set(a.code,m);
      });
      return true;
    }catch(err){console.error('Map initialization failed',err);map=null;return false;}
  }
  function regionBounds(region){
    const boxes={
      lower48:[[24.4,-125.0],[49.5,-66.5]],
      michigan:[[41.6,-90.8],[48.6,-82.0]],
      hawaii:[[18.7,-161.0],[22.5,-154.5]],
      'puerto-rico':[[17.7,-67.5],[18.6,-65.1]],
      all:[[17.0,-161.0],[50.0,-65.0]]
    };
    return boxes[region]||boxes.lower48;
  }
  function jumpRegion(region){
    if(!map)return;
    const b=regionBounds(region);
    try{map.fitBounds(b,{padding:[24,24]});}catch(_){/* noop */}
    el.mapTools.forEach(btn=>btn.classList.toggle('active',btn.dataset.region===region));
  }
  function initMapTools(){
    el.mapTools.forEach(btn=>btn.addEventListener('click',()=>jumpRegion(btn.dataset.region)));
  }

  function initFallback(){
    el.map.innerHTML='';
    const shell=document.createElement('div');shell.className='map-fallback';
    shell.innerHTML='<h3>Map unavailable — you can still build your trip</h3><p class="muted">Use these airport buttons or the search box. Your trip will work normally.</p>';
    const grid=document.createElement('div');grid.className='fallback-grid';
    D.airports.slice().sort((a,b)=>((a.type==='eas'?0:1)-(b.type==='eas'?0:1))||a.city.localeCompare(b.city)).forEach(a=>{
      const b=document.createElement('button');b.type='button';b.className='fallback-airport';b.innerHTML=`<strong>${a.city}, ${a.state} · ${a.code}</strong><br><span class="small">${a.type==='eas'?'EAS spotlight':'Connector / regional'}</span>`;b.addEventListener('click',()=>addAirport(a.code));grid.appendChild(b);
    });
    shell.appendChild(grid);el.map.appendChild(shell);
  }
  function initFinder(){
    D.airports.slice().sort((a,b)=>a.city.localeCompare(b.city)).forEach(a=>{
      const op=document.createElement('option');op.value=`${a.city}, ${a.state} (${a.code})`;el.options.appendChild(op);
    });
    el.finder.addEventListener('submit',ev=>{
      ev.preventDefault();
      const raw=el.search.value.trim();if(!raw){el.finderStatus.textContent='Type a city or three-letter airport code.';el.search.focus();return;}
      const codeMatch=raw.toUpperCase().match(/\(([A-Z]{3})\)$/)||raw.toUpperCase().match(/^([A-Z]{3})$/);
      let matches=[];
      if(codeMatch){const a=by(codeMatch[1]);if(a)matches=[a];}
      if(!matches.length){const t=raw.toLowerCase();matches=D.airports.filter(a=>`${a.city} ${a.state} ${a.code} ${a.name}`.toLowerCase().includes(t));}
      if(matches.length===1){addAirport(matches[0].code);return;}
      if(matches.length>1){el.finderStatus.textContent='More than one airport matches. Choose a suggestion from the list.';return;}
      el.finderStatus.textContent='No airport in this prototype matches that search yet.';
    });
  }

  el.returnStart.addEventListener('click',()=>{if(state.route.length)addAirport(state.route[0]);});
  el.clear.addEventListener('click',()=>{
    if(state.route.length && !window.confirm('Start over and clear this trip?'))return;
    state=window.NTA.clearTrip();el.finderStatus.textContent='Trip cleared. Choose a new starting point.';render();
  });
  el.plan.addEventListener('click',ev=>{if(state.route.length<2)ev.preventDefault();});

  initFinder();
  initMapTools();
  if(!initLeaflet())initFallback();
  render();
})();
