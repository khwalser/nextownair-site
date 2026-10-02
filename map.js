(function(){
  'use strict';
  const D=window.NTA_DATA||{airports:[]};
  let state=window.NTA.load();
  let map=null;
  let tripLayers=[];
  let networkLines=[];
  let activeFilter='all';
  const markers=new Map();
  let autoConnectorCodes=new Set();

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
    mapTools:[...document.querySelectorAll('[data-region]')],
    filterTools:[...document.querySelectorAll('[data-filter]')],
    filterCounts:[...document.querySelectorAll('[data-filter-count]')],
    regionStatus:document.getElementById('regionStatus')
  };

  function by(code){return window.NTA.byCode(code);}
  function airportRegion(a){
    if(!a)return 'lower48';
    if(a.state==='AK'||a.region==='alaska')return 'alaska';
    if(a.state==='HI')return 'hawaii';
    if(a.state==='PR')return 'puerto-rico';
    return 'lower48';
  }
  function regionName(region){
    return ({all:'All regions',lower48:'Lower 48',alaska:'Alaska',hawaii:'Hawaii','puerto-rico':'Puerto Rico'})[region]||'Lower 48';
  }
  function airportRegionName(a){return regionName(airportRegion(a));}
  function matchesFilter(a){return activeFilter==='all'||airportRegion(a)===activeFilter;}
  function hasKnownRoute(a,b){
    return window.NTA.hasFlightLink?window.NTA.hasFlightLink(a,b):(D.routes||[]).some(r=>(r[0]===a&&r[1]===b)||(r[0]===b&&r[1]===a));
  }
  function routeLabel(i){
    const n=state.route.length;
    if(i===0)return 'Start';
    if(i===n-1 && state.route[i]===state.route[0])return 'Return';
    if(i===n-1)return 'Finish';
    return `Stop ${i}`;
  }
  function repairRoute(route){
    if(!Array.isArray(route)||route.length<2)return {route:(route||[]).slice(),inserted:[],unresolved:[]};
    const repaired=[route[0]],inserted=[],unresolved=[];
    for(let i=1;i<route.length;i++){
      const from=repaired[repaired.length-1],to=route[i];
      if(from===to)continue;
      if(hasKnownRoute(from,to)){repaired.push(to);continue;}
      const path=window.NTA.findFlightPath?window.NTA.findFlightPath(from,to):null;
      if(path&&path.length>1){
        const mids=path.slice(1,-1);
        mids.forEach(code=>inserted.push({code,from,to}));
        repaired.push(...path.slice(1));
      }else{
        unresolved.push({from,to});
        repaired.push(to);
      }
    }
    return {route:repaired,inserted,unresolved};
  }
  function autoConnectorMessage(inserted){
    if(!inserted.length)return '';
    const names=inserted.map(x=>{const a=by(x.code);return a?`${a.city} (${a.code})`:x.code;});
    return `Auto-inserted connector${inserted.length===1?'':'s'}: ${names.join(' → ')}.`;
  }
  function setRoute(next,contextMessage=''){
    const fixed=repairRoute(next);
    autoConnectorCodes=new Set([...autoConnectorCodes,...fixed.inserted.map(x=>x.code)].filter(code=>fixed.route.includes(code)));
    state=window.NTA.setRoute(state,fixed.route);
    render();
    const repairText=autoConnectorMessage(fixed.inserted);
    const unresolved=fixed.unresolved.length?` No verified route found for ${fixed.unresolved.map(x=>`${x.from} → ${x.to}`).join(', ')}.`:'';
    el.finderStatus.textContent=[contextMessage,repairText].filter(Boolean).join(' ')+unresolved;
  }
  function addAirport(code){
    const a=by(code);
    if(!a)return;
    if(state.route.length&&state.route[state.route.length-1]===code){el.finderStatus.textContent=`${a.city} is already your current stop. Choose another airport before returning here.`;return;}
    const next=state.route.concat(code);
    setRoute(next,`Added ${a.city}, ${a.state} (${a.code}).`);
    el.search.value='';
    if(map&&markers.has(code)){
      if(activeFilter!=='all'&&!matchesFilter(a))setRegionFilter(airportRegion(a),false);
      const m=markers.get(code);map.panTo(m.getLatLng());m.openTooltip();
    }
  }
  function move(i,delta){
    const j=i+delta;if(j<0||j>=state.route.length)return;
    const next=state.route.slice();[next[i],next[j]]=[next[j],next[i]];
    setRoute(next,'Route reordered.');
  }
  function removeAt(i){
    const next=state.route.slice();const a=by(next[i]);next.splice(i,1);
    setRoute(next,a?`Removed ${a.city} (${a.code}) from this trip.`:'Stop removed.');
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
    el.tripTitle.textContent=n?`${n} route point${n===1?'':'s'}`:'Start anywhere';
    if(!n){
      el.trip.innerHTML='<div class="empty">Click a pin on the map or use the airport search above.</div>';
    } else {
      state.route.forEach((code,i)=>{
        const a=by(code);if(!a)return;
        const row=document.createElement('div');row.className='stop';
        const autoInserted=autoConnectorCodes.has(code);if(autoInserted)row.classList.add('auto-inserted');
        const num=document.createElement('div');num.className='stopnum';num.textContent=String(i+1);
        const body=document.createElement('div');body.className='stopbody';
        const title=document.createElement('strong');title.textContent=`${a.city}, ${a.state} · ${a.code}`;
        const label=document.createElement('div');label.className='stoplabel';label.textContent=autoInserted?`${routeLabel(i)} · Auto-inserted connector · ${airportRegionName(a)}`:`${routeLabel(i)} · ${a.type==='eas'?'EAS stop':'Hub / connector'} · ${airportRegionName(a)}`;
        const controls=document.createElement('div');controls.className='stopcontrols';
        const up=document.createElement('button');up.type='button';up.className='smallbtn';up.textContent='Move up';up.disabled=i===0||autoInserted;up.setAttribute('aria-label',`Move ${a.city} earlier in trip`);up.addEventListener('click',()=>move(i,-1));
        const down=document.createElement('button');down.type='button';down.className='smallbtn';down.textContent='Move down';down.disabled=i===n-1||autoInserted;down.setAttribute('aria-label',`Move ${a.city} later in trip`);down.addEventListener('click',()=>move(i,1));
        const remove=document.createElement('button');remove.type='button';remove.className='smallbtn remove';remove.textContent='Remove';remove.disabled=autoInserted;remove.setAttribute('aria-label',`Remove ${a.city} from trip`);remove.addEventListener('click',()=>removeAt(i));
        controls.append(up,down,remove);body.append(title,label,controls);row.append(num,body);el.trip.appendChild(row);
      });
    }

    let unsupported=0;
    if(n>1){
      el.legSummary.hidden=false;
      el.legSummary.innerHTML='<b>Flight legs</b>'+state.route.slice(0,-1).map((code,i)=>{const known=hasKnownRoute(code,state.route[i+1]);if(!known)unsupported++;return `<div>Leg ${i+1}: ${code} → ${state.route[i+1]} ${known?'':'<span class="route-warning">· no verified route found</span>'}</div>`;}).join('');
    } else {el.legSummary.hidden=true;el.legSummary.innerHTML='';}

    const ready=n>=2;
    el.plan.classList.toggle('disabled',!ready);
    el.plan.setAttribute('aria-disabled',String(!ready));
    el.returnStart.disabled=n<2 || state.route[n-1]===state.route[0];
    el.returnStart.textContent=(n>1&&state.route[n-1]===state.route[0])?'Round trip complete':'Return to start';
    el.status.textContent=ready?(unsupported?`${n-1} flight legs · ${unsupported} ${unsupported===1?'leg has':'legs have'} no verified route.`:`${n-1} flight leg${n-1===1?'':'s'} ready. Connector hubs are inserted automatically when needed.`):'Choose at least two places to create your first flight leg.';
  }
  function render(){syncLinks();renderTrip();renderRouteLine();}

  function makeIcon(a){
    const eas=a.type==='eas';
    return window.L.divIcon({className:'',html:`<div class="marker-${eas?'eas':'other'}" style="width:${eas?22:16}px;height:${eas?22:16}px"></div>`,iconSize:[24,24],iconAnchor:[12,12]});
  }
  function initLeaflet(){
    if(!window.L)return false;
    try{
      map=window.L.map('map',{scrollWheelZoom:true,minZoom:2}).setView([39.5,-97.5],4);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:12,attribution:'© OpenStreetMap'}).addTo(map);
      (D.routes||[]).forEach(r=>{
        const A=by(r[0]),B=by(r[1]);if(!A||!B)return;
        const layer=window.L.polyline([[A.lat,A.lon],[B.lat,B.lon]],{color:'#3b566b',weight:2,opacity:.48,dashArray:'2 7',interactive:false}).addTo(map);
        networkLines.push({layer,a:A,b:B});
      });
      D.airports.forEach(a=>{
        const m=window.L.marker([a.lat,a.lon],{icon:makeIcon(a),keyboard:true,title:`${a.city}, ${a.state} (${a.code}) — ${airportRegionName(a)}`}).addTo(map);
        m.bindTooltip(`${a.city}, ${a.state} · ${airportRegionName(a)} · ${a.code}${a.dotCode&&a.dotCode!==a.code?` · DOT ${a.dotCode}`:''}${a.type==='eas'&&Array.isArray(a.hubs)&&a.hubs.length?` · via ${a.hubs.join(' / ')}`:''}`,{direction:'top',offset:[0,-10]});
        m.on('click',()=>addAirport(a.code));markers.set(a.code,m);
      });
      updateRegionCounts();
      applyRegionFilter();
      return true;
    }catch(err){console.error('Map initialization failed',err);map=null;return false;}
  }
  function regionBounds(region){
    const boxes={
      lower48:[[24.4,-125.0],[49.5,-66.5]],
      michigan:[[41.6,-90.8],[48.6,-82.0]],
      alaska:[[51.0,-179.5],[72.0,-129.0]],
      hawaii:[[18.7,-161.0],[22.5,-154.5]],
      'puerto-rico':[[17.7,-67.5],[18.6,-65.1]],
      all:[[17.0,-179.5],[72.0,-65.0]]
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
  function regionEasCount(region){
    return D.airports.filter(a=>a.type==='eas'&&(region==='all'||airportRegion(a)===region)).length;
  }
  function updateRegionCounts(){
    el.filterCounts.forEach(node=>{node.textContent=String(regionEasCount(node.dataset.filterCount));});
  }
  function applyRegionFilter(){
    if(!map)return;
    markers.forEach((marker,code)=>{
      const a=by(code),shouldShow=matchesFilter(a)||state.route.includes(code);
      const shown=map.hasLayer(marker);
      if(shouldShow&&!shown)marker.addTo(map);
      if(!shouldShow&&shown)map.removeLayer(marker);
    });
    networkLines.forEach(item=>{
      const shouldShow=activeFilter==='all'||airportRegion(item.a)===activeFilter||airportRegion(item.b)===activeFilter;
      const shown=map.hasLayer(item.layer);
      if(shouldShow&&!shown)item.layer.addTo(map);
      if(!shouldShow&&shown)map.removeLayer(item.layer);
    });
    const count=regionEasCount(activeFilter);
    el.regionStatus.textContent=`Showing ${regionName(activeFilter)} · ${count} EAS communit${count===1?'y':'ies'}`;
    el.filterTools.forEach(btn=>{
      const on=btn.dataset.filter===activeFilter;
      btn.classList.toggle('active',on);btn.setAttribute('aria-pressed',String(on));
    });
  }
  function setRegionFilter(region,jump=true){
    activeFilter=region;
    applyRegionFilter();
    if(jump)jumpRegion(region);
  }
  function initRegionFilters(){
    updateRegionCounts();
    el.filterTools.forEach(btn=>btn.addEventListener('click',()=>setRegionFilter(btn.dataset.filter,true)));
  }

  function initFallback(){
    el.map.innerHTML='';
    const shell=document.createElement('div');shell.className='map-fallback';
    shell.innerHTML='<h3>Map unavailable — you can still build your trip</h3><p class="muted">Use these airport buttons or the search box. Your trip will work normally.</p>';
    const grid=document.createElement('div');grid.className='fallback-grid';
    D.airports.slice().sort((a,b)=>((a.type==='eas'?0:1)-(b.type==='eas'?0:1))||a.city.localeCompare(b.city)).forEach(a=>{
      const b=document.createElement('button');b.type='button';b.className='fallback-airport';b.innerHTML=`<strong>${a.city}, ${a.state} · ${a.code}</strong><br><span class="small">${airportRegionName(a)} · ${a.type==='eas'?'EAS spotlight':'Connector / regional'}</span>`;b.addEventListener('click',()=>addAirport(a.code));grid.appendChild(b);
    });
    shell.appendChild(grid);el.map.appendChild(shell);
  }
  function initFinder(){
    D.airports.slice().sort((a,b)=>a.city.localeCompare(b.city)).forEach(a=>{
      const op=document.createElement('option');op.value=`${a.city}, ${a.state} — ${airportRegionName(a)} (${a.code})`;el.options.appendChild(op);
    });
    el.finder.addEventListener('submit',ev=>{
      ev.preventDefault();
      const raw=el.search.value.trim();if(!raw){el.finderStatus.textContent='Type a city or three-letter airport code.';el.search.focus();return;}
      const codeMatch=raw.toUpperCase().match(/\(([A-Z0-9]{3})\)$/)||raw.toUpperCase().match(/^([A-Z0-9]{3})$/);
      let matches=[];
      if(codeMatch){const key=codeMatch[1];const a=by(key)||D.airports.find(x=>x.dotCode===key||(x.aliases||[]).includes(key));if(a)matches=[a];}
      if(!matches.length){const t=raw.toLowerCase();matches=D.airports.filter(a=>`${a.city} ${a.state} ${a.code} ${a.name} ${airportRegionName(a)} ${a.dotCode||''} ${(a.aliases||[]).join(' ')}`.toLowerCase().includes(t));}
      if(matches.length===1){addAirport(matches[0].code);return;}
      if(matches.length>1){el.finderStatus.textContent='More than one airport matches. Choose a suggestion from the list.';return;}
      el.finderStatus.textContent='No airport in the current NexTownAir network matches that search.';
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
  initRegionFilters();
  if(!initLeaflet())initFallback();
  render();
})();
