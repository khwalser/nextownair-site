(function(){
  'use strict';
  const D=window.NTA_DATA||{airports:[]};
  let state=window.NTA.load();
  let map=null;
  let tripLayers=[];
  let networkLines=[];
  let activeFilter='all';
  let activeViewRegion='lower48';
  let activeGateway=null;
  const markers=new Map();
  let autoConnectorIndices=new Set(state.autoConnectorIndices||[]);

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
    return window.NTA.hasTravelLink?window.NTA.hasTravelLink(a,b):(D.routes||[]).some(r=>(r[0]===a&&r[1]===b)||(r[0]===b&&r[1]===a));
  }
  function linkKind(a,b){
    if(window.NTA.hasTransferLink&&window.NTA.hasTransferLink(a,b))return 'transfer';
    const A=by(a),B=by(b);
    if(!A||!B)return 'unknown';
    return A.type==='eas'||B.type==='eas'?'eas':'hub';
  }
  function linkStyle(a,b,{selected=false,known=true}={}){
    if(!known)return {color:'#e7bd62',weight:selected?5:2,opacity:selected?.95:.5,dashArray:'3 7'};
    const kind=linkKind(a,b);
    if(kind==='transfer')return {color:'#e7bd62',weight:selected?5:2.5,opacity:selected?.96:.7,dashArray:'8 7'};
    if(kind==='eas')return {color:selected?'#5eead4':'#2f8f86',weight:selected?5:2.5,opacity:selected?.96:.62,dashArray:selected?null:'5 6'};
    return {color:selected?'#c084fc':'#7255a1',weight:selected?5:2.5,opacity:selected?.96:.62,dashArray:selected?null:'2 7'};
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
      const path=window.NTA.findTravelPath?window.NTA.findTravelPath(from,to):(window.NTA.findFlightPath?window.NTA.findFlightPath(from,to):null);
      if(path&&path.length>1){
        const mids=path.slice(1,-1);
        mids.forEach((code,offset)=>inserted.push({code,from,to,index:repaired.length+offset}));
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
    const oldRoute=state.route.slice();
    const fixed=repairRoute(next);
    const changed=oldRoute.join(',')!==fixed.route.join(',');
    const insertedIndices=fixed.inserted.map(x=>x.index).filter(Number.isInteger);
    autoConnectorIndices=new Set(insertedIndices);
    state=window.NTA.setRoute(state,fixed.route);
    state.autoConnectorIndices=[...autoConnectorIndices];
    state.autoConnectors=[...new Set(state.autoConnectorIndices.map(i=>state.route[i]).filter(Boolean))];
    state=window.NTA.save(state);
    render();
    const repairText=autoConnectorMessage(fixed.inserted);
    const unresolved=fixed.unresolved.length?` No verified route found for ${fixed.unresolved.map(x=>`${x.from} → ${x.to}`).join(', ')}.`:'';
    const changes=changed&&oldRoute.length>1?` Trip recalculated: ${oldRoute.join(' → ')} became ${fixed.route.join(' → ')}. Recheck affected flight choices and stays.`:'';
    el.finderStatus.textContent=[contextMessage,repairText,changes].filter(Boolean).join(' ')+unresolved;
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
      const m=markers.get(code);m.openTooltip();
    }
  }
  function requestedEntries(){
    return state.route.map((code,index)=>({code,index})).filter(x=>!autoConnectorIndices.has(x.index));
  }
  function move(i,delta){
    if(autoConnectorIndices.has(i))return;
    const requested=requestedEntries();
    const pos=requested.findIndex(x=>x.index===i);
    const j=pos+delta;
    if(pos<0||j<0||j>=requested.length)return;
    const next=requested.map(x=>x.code);
    [next[pos],next[j]]=[next[j],next[pos]];
    autoConnectorIndices.clear();
    setRoute(next,'Route reordered.');
  }
  function removeAt(i){
    const a=by(state.route[i]);
    if(autoConnectorIndices.has(i)){
      el.finderStatus.textContent=a?`${a.city} (${a.code}) is an automatic connection. Change the destinations around it and NexTownAir will recalculate the path.`:'This is an automatic connection. Change the surrounding destinations to recalculate the path.';
      return;
    }
    const next=state.route
      .map((code,index)=>({code,index}))
      .filter(x=>x.index!==i&&!autoConnectorIndices.has(x.index))
      .map(x=>x.code);
    autoConnectorIndices.clear();
    setRoute(next,a?`Removed ${a.city} (${a.code}) from this trip.`:'Stop removed.');
  }
  function syncLinks(){
    el.itinNav.href=window.NTA.buildUrl('itinerary.html',state);
    el.brandHome.href=window.NTA.buildUrl('index.html',state);
    el.plan.href=window.NTA.buildUrl('itinerary.html',state);
    window.NTA.updateAddress('index.html',state);
  }
  function fitEntireTrip(){
    if(!map||state.route.length<2)return;
    const pts=state.route.map(by).filter(Boolean).map(a=>[a.lat,a.lon]);
    if(pts.length>1){try{map.fitBounds(window.L.latLngBounds(pts),{padding:[48,48],maxZoom:6});}catch(_){/* keep map usable */}}
  }
  function renderRouteLine(){
    if(!map)return;
    tripLayers.forEach(layer=>{try{map.removeLayer(layer);}catch(_){/* noop */}});tripLayers=[];
    if(state.route.length>1){
      const pts=state.route.map(by).filter(Boolean).map(a=>[a.lat,a.lon]);
      for(let i=0;i<state.route.length-1;i++){
        const A=by(state.route[i]),B=by(state.route[i+1]);if(!A||!B)continue;
        const known=hasKnownRoute(A.code,B.code);
        const layer=window.L.polyline([[A.lat,A.lon],[B.lat,B.lon]],linkStyle(A.code,B.code,{selected:true,known})).addTo(map);
        tripLayers.push(layer);
      }
      fitEntireTrip();
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
        const autoInserted=autoConnectorIndices.has(i);if(autoInserted)row.classList.add('auto-inserted');
        const num=document.createElement('div');num.className='stopnum';num.textContent=String(i+1);
        const body=document.createElement('div');body.className='stopbody';
        const title=document.createElement('strong');title.textContent=`${a.city}, ${a.state} · ${a.code}`;
        const label=document.createElement('div');label.className='stoplabel';label.textContent=autoInserted?`${routeLabel(i)} · Automatic connection · ${airportRegionName(a)}`:`${routeLabel(i)} · ${a.type==='eas'?'EAS / small-airport stop':'Chosen airport'} · ${airportRegionName(a)}`;
        const controls=document.createElement('div');controls.className='stopcontrols';
        const up=document.createElement('button');up.type='button';up.className='smallbtn';up.textContent='Move up';up.disabled=autoInserted||requestedEntries().findIndex(x=>x.index===i)<=0;up.setAttribute('aria-label',`Move ${a.city} earlier in trip`);up.addEventListener('click',()=>move(i,-1));
        const down=document.createElement('button');down.type='button';down.className='smallbtn';down.textContent='Move down';down.disabled=autoInserted||requestedEntries().findIndex(x=>x.index===i)>=requestedEntries().length-1;down.setAttribute('aria-label',`Move ${a.city} later in trip`);down.addEventListener('click',()=>move(i,1));
        const remove=document.createElement('button');remove.type='button';remove.className='smallbtn remove';remove.textContent=autoInserted?'Automatic':'Remove';remove.setAttribute('aria-label',autoInserted?`${a.city} is an automatic connector`:`Remove ${a.city} from trip`);remove.disabled=autoInserted;if(!autoInserted)remove.addEventListener('click',()=>removeAt(i));
        controls.append(up,down,remove);body.append(title,label,controls);row.append(num,body);el.trip.appendChild(row);
      });
    }

    let unsupported=0;
    if(n>1){
      el.legSummary.hidden=false;
      el.legSummary.innerHTML='<b>Trip segments</b>'+state.route.slice(0,-1).map((code,i)=>{const next=state.route[i+1],known=hasKnownRoute(code,next),transfer=window.NTA.hasTransferLink&&window.NTA.hasTransferLink(code,next);if(!known)unsupported++;return `<div>${transfer?'Transfer':'Flight link'} ${i+1}: ${code} → ${next} ${known?(transfer?'· transfer details checked later':'· flight date / fare not yet checked'):'<span class="route-warning">· no verified route found</span>'}</div>`;}).join('');
    } else {el.legSummary.hidden=true;el.legSummary.innerHTML='';}

    const fullTrip=document.getElementById('showEntireTrip');if(fullTrip)fullTrip.disabled=n<2;
    const ready=n>=2&&unsupported===0;
    el.plan.classList.toggle('disabled',!ready);
    el.plan.setAttribute('aria-disabled',String(!ready));
    // An anchor with pointer-events:none is still keyboard-focusable and activatable.
    // Remove it from tab order until all trip segments have known paths.
    if(ready)el.plan.removeAttribute('tabindex');
    else el.plan.setAttribute('tabindex','-1');
    el.returnStart.disabled=n<2 || state.route[n-1]===state.route[0];
    el.returnStart.textContent=(n>1&&state.route[n-1]===state.route[0])?'Round trip complete':'Return to start';
    const transferCount=state.route.slice(0,-1).filter((code,i)=>window.NTA.hasTransferLink&&window.NTA.hasTransferLink(code,state.route[i+1])).length;
    const flightCount=Math.max(0,n-1-transferCount);
    el.status.textContent=n<2?'Choose at least two places to create your first trip segment.':unsupported?`${unsupported} ${unsupported===1?'segment has':'segments have'} no verified path in the current network. Change that destination before continuing.`:`${flightCount} flight leg${flightCount===1?'':'s'}${transferCount?` · ${transferCount} transfer${transferCount===1?'':'s'}`:''} · network paths identified. Flight dates, schedules, seats and fares still need checking in the itinerary. Required connectors are inserted automatically when needed.`;
  }
  // Block all activation paths, including synthetic clicks and keyboard navigation.
  el.plan.addEventListener('click',event=>{
    if(el.plan.getAttribute('aria-disabled')==='true')event.preventDefault();
  });
  function render(){syncLinks();renderTrip();renderRouteLine();applyRegionFilter();}

  function makeIcon(a){
    const eas=a.type==='eas';
    return window.L.divIcon({className:'',html:`<div class="marker-${eas?'eas':'other'}" style="width:${eas?22:16}px;height:${eas?22:16}px"></div>`,iconSize:[24,24],iconAnchor:[12,12]});
  }
  function initLeaflet(){
    if(!window.L)return false;
    try{
      map=window.L.map('map',{scrollWheelZoom:true,minZoom:2}).setView([39.5,-97.5],4);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:12,attribution:'© OpenStreetMap'}).addTo(map);
      // Route finding already uses both local EAS legs and verified hub
      // backbone links. Draw both sets so Alaska/Hawaii aren't visually isolated.
      // Keep cross-region backbone links hidden until a relevant region is
      // selected, avoiding a web of long lines over the Lower 48.
      const seenNetworkPairs=new Set();
      [...(D.routes||[]),...(D.backboneRoutes||[])].forEach(r=>{
        const A=by(r[0]),B=by(r[1]);if(!A||!B)return;
        const key=[A.code,B.code].sort().join('|');
        if(seenNetworkPairs.has(key))return;
        seenNetworkPairs.add(key);
        const backbone=!(D.routes||[]).some(edge=>[edge[0],edge[1]].sort().join('|')===key);
        const layer=window.L.polyline([[A.lat,A.lon],[B.lat,B.lon]],{
          ...linkStyle(A.code,B.code,{selected:false,known:true}),
          ...(backbone?{color:'#9f84d7',weight:2,opacity:.58,dashArray:'5 7'}:{}),
          interactive:false
        }).addTo(map);
        networkLines.push({layer,a:A,b:B,backbone});
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
    if(activeGateway){activeGateway=null;renderGatewayConnections();}
    activeViewRegion=region;
    if(!map)return;
    const b=regionBounds(region);
    try{map.fitBounds(b,{padding:[24,24]});}catch(_){/* noop */}
    applyRegionFilter();
    el.mapTools.forEach(btn=>btn.classList.toggle('active',btn.dataset.region===region));
    const regionSelect=document.getElementById('mapRegionSelect');
    if(regionSelect)regionSelect.value=region;
  }
  // The default Lower 48 map suppresses hub-to-hub lines to avoid
  // clutter, but that must never make gateways appear disconnected.
  // This evidence panel lists every explicitly documented graph edge,
  // not date-specific service, available seats, or a bookable fare.
  function gatewayRoutes(code){
    const seen=new Set();
    return [...(D.routes||[]).map(pair=>({pair,kind:'eas'})),
            ...(D.backboneRoutes||[]).map(pair=>({pair,kind:'hub'}))]
      .filter(({pair})=>pair.length===2&&pair.includes(code))
      .filter(({pair})=>{const k=pair.slice().sort().join('|');if(seen.has(k))return false;seen.add(k);return true;})
      .map(({pair,kind})=>({code:pair[0]===code?pair[1]:pair[0],kind}))
      .filter(item=>Boolean(by(item.code)))
      .sort((a,b)=>a.code.localeCompare(b.code));
  }
  function renderGatewayConnections(){
    const detail=document.getElementById('gatewayConnectionsDetail');
    document.querySelectorAll('[data-gateway]').forEach(button=>{
      const code=button.dataset.gateway;
      button.classList.toggle('active',code===activeGateway);
      button.setAttribute('aria-pressed',String(code===activeGateway));
      const count=button.querySelector('[data-gateway-count]');
      if(count)count.textContent=String(gatewayRoutes(code).length);
    });
    if(!detail)return;
    detail.replaceChildren();
    detail.hidden=!activeGateway;
    if(!activeGateway)return;
    const origin=by(activeGateway),routes=gatewayRoutes(activeGateway);
    const heading=document.createElement('strong');
    heading.textContent=`${origin.city} (${origin.code}): ${routes.length} listed nonstop routes`;
    const caption=document.createElement('span');caption.className='gateway-caveat';
    caption.textContent='Network links only. A flight on your date and a live fare must be checked separately.';
    const list=document.createElement('div');list.className='gateway-route-list';
    routes.forEach(item=>{
      const target=by(item.code);
      const line=document.createElement('span');line.className='gateway-route-item';
      line.dataset.gatewayRoute=item.code;
      line.textContent=`${target.city} (${target.code}) · ${item.kind==='eas'?'EAS service':'hub flight link'}`;
      list.appendChild(line);
    });
    detail.append(heading,caption,list);
  }
  function focusGateway(code){
    if(activeGateway===code){activeGateway=null;renderGatewayConnections();jumpRegion('lower48');return;}
    activeGateway=code;
    activeFilter='all';activeViewRegion='all';
    renderGatewayConnections();
    applyRegionFilter();
    const a=by(code),others=gatewayRoutes(code).map(item=>by(item.code));
    if(map&&a&&others.length){
      try{map.fitBounds(window.L.latLngBounds([a,...others].map(p=>[p.lat,p.lon])),{padding:[28,28],maxZoom:5});}catch(_){/* preserve page if map bounds fail */}
    }
  }
  function initGatewayConnections(){
    renderGatewayConnections();
    document.querySelectorAll('[data-gateway]').forEach(btn=>
      btn.addEventListener('click',()=>focusGateway(btn.dataset.gateway)));
  }
  function initMapTools(){
    const entire=document.getElementById('showEntireTrip');
    if(entire)entire.addEventListener('click',fitEntireTrip);
    el.mapTools.forEach(btn=>btn.addEventListener('click',()=>jumpRegion(btn.dataset.region)));
    const regionSelect=document.getElementById('mapRegionSelect');
    if(regionSelect)regionSelect.addEventListener('change',()=>jumpRegion(regionSelect.value));
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
      const selectedLink=state.route.slice(0,-1).some((code,i)=>(code===item.a.code&&state.route[i+1]===item.b.code)||(code===item.b.code&&state.route[i+1]===item.a.code));
      const viewedRegion=activeFilter==='all'?activeViewRegion:activeFilter;
      const relatedToRegion=airportRegion(item.a)===viewedRegion||airportRegion(item.b)===viewedRegion;
      const gatewayLink=activeGateway&&(item.a.code===activeGateway||item.b.code===activeGateway);
      const shouldShow=item.backbone
        ?Boolean(gatewayLink)||(viewedRegion!=='all'&&viewedRegion!=='lower48'&&relatedToRegion)||selectedLink
        :Boolean(gatewayLink)||activeFilter==='all'||airportRegion(item.a)===activeFilter||airportRegion(item.b)===activeFilter;
      const shown=map.hasLayer(item.layer);
      if(shouldShow&&!shown)item.layer.addTo(map);
      if(!shouldShow&&shown)map.removeLayer(item.layer);
    });
    const displayedRegion=activeFilter==='all'?activeViewRegion:activeFilter;
    const isViewing=activeFilter==='all'&&activeViewRegion!=='lower48'&&activeViewRegion!=='all';
    const count=regionEasCount(isViewing?displayedRegion:activeFilter);
    const visibleBackbone=networkLines.filter(item=>item.backbone&&map.hasLayer(item.layer)).length;
    el.regionStatus.textContent=activeGateway
      ?`Viewing ${by(activeGateway)?.city||activeGateway} · ${gatewayRoutes(activeGateway).length} listed routes (not live fares)`
      :`${isViewing?'Viewing':'Showing'} ${regionName(isViewing?displayedRegion:activeFilter)} · ${count} EAS communit${count===1?'y':'ies'}${visibleBackbone?` · ${visibleBackbone} hub flight links`:''}`;
    el.filterTools.forEach(btn=>{
      const on=btn.dataset.filter===activeFilter;
      btn.classList.toggle('active',on);btn.setAttribute('aria-pressed',String(on));
    });
    const filterSelect=document.getElementById('mapFilterSelect');
    if(filterSelect)filterSelect.value=activeFilter;
  }
  function setRegionFilter(region,jump=true){
    activeFilter=region;
    applyRegionFilter();
    if(jump)jumpRegion(region);
  }
  function initRegionFilters(){
    updateRegionCounts();
    el.filterTools.forEach(btn=>btn.addEventListener('click',()=>setRegionFilter(btn.dataset.filter,true)));
    const filterSelect=document.getElementById('mapFilterSelect');
    if(filterSelect)filterSelect.addEventListener('change',()=>setRegionFilter(filterSelect.value,true));
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
    state=window.NTA.clearTrip();autoConnectorIndices=new Set();activeGateway=null;el.search.value='';el.finderStatus.textContent='Trip cleared. Choose a new starting point.';renderGatewayConnections();render();
  });
  el.plan.addEventListener('click',ev=>{const supported=state.route.length>=2&&state.route.slice(0,-1).every((code,i)=>hasKnownRoute(code,state.route[i+1]));if(!supported)ev.preventDefault();});

  if(state.route.length>1){
    const fixed=repairRoute(state.route);
    if(fixed.route.join(',')!==state.route.join(',')){
      autoConnectorIndices=new Set(fixed.inserted.map(x=>x.index).filter(Number.isInteger));
      state=window.NTA.setRoute(state,fixed.route);
      state.autoConnectorIndices=[...autoConnectorIndices];
      state.autoConnectors=[...new Set(state.autoConnectorIndices.map(i=>state.route[i]).filter(Boolean))];
      state=window.NTA.save(state);
    }
  }
  initFinder();
  initMapTools();
  initRegionFilters();
  if(!initLeaflet())initFallback();
  initGatewayConnections();
  render();
})();
