(function(){
  'use strict';
  const KEY='nextownair.trip.v1';
  const D=window.NTA_DATA||{airports:[]};
  const airportCodes=new Set((D.airports||[]).map(a=>a.code));
  const listedAdj=new Map((D.airports||[]).map(a=>[a.code,new Set()]));
  const travelAdj=new Map((D.airports||[]).map(a=>[a.code,new Set()]));
  const transferByPair=new Map();
  const hubCodes=new Set();
  (D.airports||[]).forEach(a=>(a.hubs||[]).forEach(h=>hubCodes.add(h)));
  [...(D.routes||[]),...(D.backboneRoutes||[])].forEach(([a,b])=>{
    if(!listedAdj.has(a))listedAdj.set(a,new Set());
    if(!listedAdj.has(b))listedAdj.set(b,new Set());
    if(!travelAdj.has(a))travelAdj.set(a,new Set());
    if(!travelAdj.has(b))travelAdj.set(b,new Set());
    listedAdj.get(a).add(b);listedAdj.get(b).add(a);
    travelAdj.get(a).add(b);travelAdj.get(b).add(a);
  });
  (D.transferEdges||[]).forEach(edge=>{
    const a=edge&&edge.from,b=edge&&edge.to;if(!a||!b)return;
    if(!travelAdj.has(a))travelAdj.set(a,new Set());
    if(!travelAdj.has(b))travelAdj.set(b,new Set());
    travelAdj.get(a).add(b);travelAdj.get(b).add(a);
    transferByPair.set([a,b].sort().join('|'),edge);
  });

  function todayLocal(){
    const d=new Date();
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,'0');
    const day=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  function validDate(s){
    if(typeof s!=='string')return false;
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if(!match)return false;
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
    if(year<1000||month<1||month>12||day<1)return false;
    return day<=new Date(Date.UTC(year,month,0)).getUTCDate();
  }
  function normalizeRoute(route){
    if(!Array.isArray(route))return [];
    const cleaned=route.map(x=>String(x).trim().toUpperCase()).filter(c=>airportCodes.has(c));
    // Keep revisits (DTW → ROC → DTW), but never create a flight from an
    // airport to itself because an imported URL repeats a stop.
    return cleaned.filter((code,index)=>index===0||code!==cleaned[index-1]);
  }
  function airportByCode(code){return (D.airports||[]).find(a=>a.code===code)||null;}
  function hasListedRoute(a,b){return Boolean(listedAdj.get(a)&&listedAdj.get(a).has(b));}
  function isNetworkHub(code){return hubCodes.has(code);}
  function hasFlightLink(a,b){
    if(!airportCodes.has(a)||!airportCodes.has(b)||a===b)return false;
    return hasListedRoute(a,b);
  }
  function getTransferLink(a,b){return transferByPair.get([a,b].sort().join('|'))||null;}
  function hasTransferLink(a,b){return Boolean(getTransferLink(a,b));}
  function hasTravelLink(a,b){return hasFlightLink(a,b)||hasTransferLink(a,b);}
  function flightNeighbors(code){return [...(listedAdj.get(code)||[])].filter(c=>airportCodes.has(c));}
  function travelNeighbors(code){return [...(travelAdj.get(code)||[])].filter(c=>airportCodes.has(c));}
  function findFlightPath(from,to){
    const a=String(from||'').toUpperCase(),b=String(to||'').toUpperCase();
    if(!airportCodes.has(a)||!airportCodes.has(b))return null;
    if(a===b)return [a];
    const q=[a],seen=new Set([a]),prev=new Map();
    while(q.length){
      const cur=q.shift();
      for(const next of flightNeighbors(cur)){
        if(seen.has(next))continue;
        seen.add(next);prev.set(next,cur);
        if(next===b){
          const path=[b];let p=b;
          while(prev.has(p)){p=prev.get(p);path.push(p);}
          return path.reverse();
        }
        q.push(next);
      }
    }
    return null;
  }
  function findTravelPath(from,to){
    const a=String(from||'').toUpperCase(),b=String(to||'').toUpperCase();
    if(!airportCodes.has(a)||!airportCodes.has(b))return null;
    if(a===b)return [a];
    const q=[a],seen=new Set([a]),prev=new Map();
    while(q.length){
      const cur=q.shift();
      for(const next of travelNeighbors(cur)){
        if(seen.has(next))continue;
        seen.add(next);prev.set(next,cur);
        if(next===b){
          const path=[b];let p=b;
          while(prev.has(p)){p=prev.get(p);path.push(p);}
          return path.reverse();
        }
        q.push(next);
      }
    }
    return null;
  }
  function baseState(){return {version:2,route:[],autoConnectors:[],autoConnectorIndices:[],startDate:todayLocal(),stays:{},selections:{}};}
  function sanitize(raw){
    const b=baseState();
    if(!raw||typeof raw!=='object')return b;
    // Imported URLs and older saved trips can contain duplicate or unknown
    // stops. Preserve stay positions while normalizing their route indices.
    const source=Array.isArray(raw.route)?raw.route:[];
    const positionMap=[];
    const normalized=[];
    source.forEach((value,index)=>{
      const code=String(value).trim().toUpperCase();
      if(!airportCodes.has(code)){positionMap[index]=null;return;}
      if(normalized[normalized.length-1]!==code)normalized.push(code);
      positionMap[index]=normalized.length-1;
    });
    b.route=normalized;
    const changed=source.length!==normalized.length;
    b.autoConnectors=normalizeRoute(raw.autoConnectors).filter(code=>b.route.includes(code));
    const legacyCodes=new Set(b.autoConnectors);
    const rawIndices=Array.isArray(raw.autoConnectorIndices)?raw.autoConnectorIndices.map(Number).filter(Number.isInteger):[];
    b.autoConnectorIndices=[...new Set(rawIndices.map(i=>changed?positionMap[i]:i).filter(i=>Number.isInteger(i)&&i>0&&i<b.route.length-1))];
    if(!b.autoConnectorIndices.length&&legacyCodes.size){
      b.autoConnectorIndices=b.route.map((code,i)=>({code,i})).filter(x=>x.i>0&&x.i<b.route.length-1&&legacyCodes.has(x.code)).map(x=>x.i);
    }
    b.startDate=validDate(raw.startDate)?raw.startDate:b.startDate;
    const stays=(raw.stays&&typeof raw.stays==='object'&&!Array.isArray(raw.stays))?raw.stays:{};
    if(changed){
      b.stays={};
      for(const [index,stay] of Object.entries(stays)){
        const mapped=positionMap[Number(index)];
        if(Number.isInteger(mapped)&&mapped>0&&mapped<b.route.length)b.stays[String(mapped)]=stay;
      }
    }else b.stays=stays;
    // Flight selections are keyed by leg index. After removing a stop,
    // none of the original leg keys are reliable inventory references.
    b.selections=changed?{}:(raw.selections&&typeof raw.selections==='object'&&!Array.isArray(raw.selections)?raw.selections:{});
    return b;
  }
  function clearSavedAppState(){
    try{
      Object.keys(localStorage).filter(k=>k.startsWith('nextownair.')).forEach(k=>localStorage.removeItem(k));
    }catch(_){/* storage can be disabled */}
    try{
      Object.keys(sessionStorage).filter(k=>k.startsWith('nextownair.')).forEach(k=>sessionStorage.removeItem(k));
    }catch(_){/* storage can be disabled */}
  }
  function readStored(){
    try{return sanitize(JSON.parse(localStorage.getItem(KEY)||'null'));}catch(_){return baseState();}
  }
  function save(state){
    const s=sanitize(state);
    try{localStorage.setItem(KEY,JSON.stringify(s));}catch(_){/* storage can be disabled */}
    return s;
  }
  function sameRoute(a,b){return a.length===b.length&&a.every((x,i)=>x===b[i]);}
  function firstDiff(a,b){
    const n=Math.min(a.length,b.length);
    for(let i=0;i<n;i++)if(a[i]!==b[i])return i;
    return a.length===b.length?-1:n;
  }
  function reconcileRoute(state,newRoute){
    const next=normalizeRoute(newRoute);
    const old=state.route||[];
    if(sameRoute(old,next)){state.route=next;state.autoConnectors=(state.autoConnectors||[]).filter(code=>next.includes(code));state.autoConnectorIndices=(state.autoConnectorIndices||[]).filter(i=>i>0&&i<next.length-1);return state;}
    const d=firstDiff(old,next);
    const legCut=Math.max(0,d-1);
    Object.keys(state.selections||{}).forEach(k=>{if(Number(k)>=legCut)delete state.selections[k];});
    Object.keys(state.stays||{}).forEach(k=>{if(Number(k)>=Math.max(1,d))delete state.stays[k];});
    state.route=next;
    state.autoConnectors=(state.autoConnectors||[]).filter(code=>next.includes(code));
    state.autoConnectorIndices=[];
    return state;
  }
  function routeFromQuery(){
    const q=new URLSearchParams(location.search);
    if(!q.has('route'))return null;
    return normalizeRoute((q.get('route')||'').split(','));
  }
  // Share only user choices. Flight offers and selected inventory are deliberately
  // omitted because external availability and prices must be checked again.
  function encodeTripSnapshot(state){
    const clean=sanitize(state);
    const payload=JSON.stringify({v:1,route:clean.route,autoConnectorIndices:clean.autoConnectorIndices,startDate:clean.startDate,stays:clean.stays});
    return btoa(payload).split('+').join('-').split('/').join('_').replace(/=+$/,'');
  }
  function decodeTripSnapshot(value){
    if(typeof value!=='string'||!value||value.length>8000||!/^[A-Za-z0-9_-]+$/.test(value))return null;
    try{
      const payload=JSON.parse(atob(value.replace(/-/g,'+').replace(/_/g,'/')));
      if(!payload||payload.v!==1||!Array.isArray(payload.route)||payload.route.length>40)return null;
      const restored=sanitize(payload);
      restored.selections={};
      return restored;
    }catch(_){return null;}
  }
  function shareTripUrl(page,state){
    const token=encodeTripSnapshot(state);
    return new URL(page+'?snapshot='+encodeURIComponent(token),location.href).href;
  }
  const SAVED_TRIPS_KEY='nextownair.savedTrips.v1';
  function listSavedTrips(){
    try{
      const entries=JSON.parse(localStorage.getItem(SAVED_TRIPS_KEY)||'[]');
      if(!Array.isArray(entries))return [];
      return entries.filter(e=>e&&typeof e.id==='string'&&typeof e.token==='string'&&decodeTripSnapshot(e.token)).slice(0,20);
    }catch(_){return [];}
  }
  function saveNamedTrip(name,state){
    const label=String(name||'').trim().slice(0,60);
    if(!label)throw new Error('Enter a trip name.');
    const snapshot=encodeTripSnapshot(state);
    const entries=listSavedTrips();
    const id='trip-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
    entries.unshift({id,name:label,savedAt:new Date().toISOString(),token:snapshot});
    try{localStorage.setItem(SAVED_TRIPS_KEY,JSON.stringify(entries.slice(0,20)));}catch(_){throw new Error('Browser storage is unavailable.');}
    return id;
  }
  function openSavedTrip(id){
    const entry=listSavedTrips().find(x=>x.id===id);
    return entry?decodeTripSnapshot(entry.token):null;
  }
  function deleteSavedTrip(id){
    const entries=listSavedTrips().filter(x=>x.id!==id);
    try{localStorage.setItem(SAVED_TRIPS_KEY,JSON.stringify(entries));return true;}catch(_){return false;}
  }
  function load(){
    const q=new URLSearchParams(location.search);
    if(q.get('fresh')==='1'){
      clearSavedAppState();
      q.delete('fresh');
      try{
        const clean=location.pathname+(q.toString()?('?'+q.toString()):'')+location.hash;
        history.replaceState(null,'',clean);
      }catch(_){/* file previews may block */}
    }
    const shared=q.has('snapshot')?decodeTripSnapshot(q.get('snapshot')):null;
    const state=shared||readStored();
    const qr=shared?null:routeFromQuery();
    if(qr!==null)reconcileRoute(state,qr);
    if(q.has('auto')){
      const raw=(q.get('auto')||'').split(',').map(x=>x.trim()).filter(Boolean);
      if(raw.every(x=>/^\d+$/.test(x))){
        state.autoConnectorIndices=[...new Set(raw.map(Number).filter(i=>i>0&&i<state.route.length-1))];
      }else{
        state.autoConnectors=normalizeRoute(raw).filter(code=>state.route.includes(code));
        const codes=new Set(state.autoConnectors);
        state.autoConnectorIndices=state.route.map((code,i)=>({code,i})).filter(x=>x.i>0&&x.i<state.route.length-1&&codes.has(x.code)).map(x=>x.i);
      }
      state.autoConnectorIndices=[...new Set(state.autoConnectorIndices)].sort((a,b)=>a-b);
      state.autoConnectors=[...new Set(state.autoConnectorIndices.map(i=>state.route[i]).filter(Boolean))];
    }else if(state.route.length){
      state.autoConnectorIndices=[...new Set(state.autoConnectorIndices||[])].sort((a,b)=>a-b);
      state.autoConnectors=[...new Set(state.autoConnectorIndices.map(i=>state.route[i]).filter(Boolean))];
    }
    if(!shared&&validDate(q.get('date')))state.startDate=q.get('date');
    // A trip from a previous visit must not open on a date already in the past.
    // Keep the route and stays, but invalidate flight selections tied to old dates.
    if(state.startDate<todayLocal()){
      state.startDate=todayLocal();
      state.selections={};
    }
    return save(state);
  }
  function setRoute(state,route){reconcileRoute(state,route);return save(state);}
  function clearTrip(){const s=baseState();return save(s);}
  function buildUrl(page,state){
    // A blank trip has no shareable navigation state; keep homepage links canonical.
    if(page==='index.html'&&!(state.route||[]).length)return '/';
    const p=new URLSearchParams();
    if(state.route&&state.route.length)p.set('route',state.route.join(','));
    if(state.autoConnectorIndices&&state.autoConnectorIndices.length)p.set('auto',state.autoConnectorIndices.join(','));
    if(validDate(state.startDate))p.set('date',state.startDate);
    const qs=p.toString();
    return page+(qs?`?${qs}`:'');
  }
  function updateAddress(page,state){
    // The address bar identifies the page, not the current locally saved trip.
    // Route/date query parameters remain available on explicit navigation links.
    try{
      const clean=page==='index.html'?'/' : page;
      if(location.pathname!==clean||location.search)history.replaceState(null,'',clean+location.hash);
    }catch(_){/* file previews may block */}
  }
  function byCode(code){return (D.airports||[]).find(a=>a.code===code)||null;}
  function parseDate(s){const [y,m,d]=s.split('-').map(Number);return new Date(Date.UTC(y,m-1,d));}
  function iso(d){return d.toISOString().slice(0,10);}
  function addDays(s,n){const d=parseDate(s);d.setUTCDate(d.getUTCDate()+Number(n||0));return iso(d);}
  function diffDays(a,b){return Math.round((parseDate(b)-parseDate(a))/86400000);}
  function fmtDate(s,opts){
    if(!validDate(s))return '';
    return parseDate(s).toLocaleDateString(undefined,Object.assign({month:'short',day:'numeric',timeZone:'UTC'},opts||{}));
  }
  window.NTA={KEY,todayLocal,validDate,normalizeRoute,load,save,listSavedTrips,saveNamedTrip,openSavedTrip,deleteSavedTrip,encodeTripSnapshot,decodeTripSnapshot,shareTripUrl,setRoute,clearTrip,clearSavedAppState,buildUrl,updateAddress,byCode,addDays,diffDays,fmtDate,hasListedRoute,isNetworkHub,hasFlightLink,getTransferLink,hasTransferLink,hasTravelLink,findFlightPath,findTravelPath};
})();
