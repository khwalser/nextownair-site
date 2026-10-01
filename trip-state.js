(function(){
  'use strict';
  const KEY='nextownair.trip.v1';
  const D=window.NTA_DATA||{airports:[]};
  const airportCodes=new Set((D.airports||[]).map(a=>a.code));
  const listedAdj=new Map((D.airports||[]).map(a=>[a.code,new Set()]));
  const hubCodes=new Set();
  (D.airports||[]).forEach(a=>(a.hubs||[]).forEach(h=>hubCodes.add(h)));
  (D.routes||[]).forEach(([a,b])=>{
    if(!listedAdj.has(a))listedAdj.set(a,new Set());
    if(!listedAdj.has(b))listedAdj.set(b,new Set());
    listedAdj.get(a).add(b);listedAdj.get(b).add(a);
  });

  function todayLocal(){
    const d=new Date();
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,'0');
    const day=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  function validDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(String(s||''));}
  function normalizeRoute(route){
    return Array.isArray(route)?route.map(x=>String(x).trim().toUpperCase()).filter(c=>airportCodes.has(c)):[];
  }
  function hasListedRoute(a,b){return Boolean(listedAdj.get(a)&&listedAdj.get(a).has(b));}
  function isNetworkHub(code){return hubCodes.has(code);}
  function hasFlightLink(a,b){
    if(!airportCodes.has(a)||!airportCodes.has(b)||a===b)return false;
    return hasListedRoute(a,b);
  }
  function flightNeighbors(code){
    return [...(listedAdj.get(code)||[])].filter(c=>airportCodes.has(c));
  }
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
  function baseState(){return {version:1,route:[],startDate:todayLocal(),stays:{},selections:{}};}
  function sanitize(raw){
    const b=baseState();
    if(!raw||typeof raw!=='object')return b;
    b.route=normalizeRoute(raw.route);
    b.startDate=validDate(raw.startDate)?raw.startDate:b.startDate;
    b.stays=(raw.stays&&typeof raw.stays==='object')?raw.stays:{};
    b.selections=(raw.selections&&typeof raw.selections==='object')?raw.selections:{};
    return b;
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
    if(sameRoute(old,next)){state.route=next;return state;}
    const d=firstDiff(old,next);
    const legCut=Math.max(0,d-1);
    Object.keys(state.selections||{}).forEach(k=>{if(Number(k)>=legCut)delete state.selections[k];});
    Object.keys(state.stays||{}).forEach(k=>{if(Number(k)>=Math.max(1,d))delete state.stays[k];});
    state.route=next;
    return state;
  }
  function routeFromQuery(){
    const q=new URLSearchParams(location.search);
    if(!q.has('route'))return null;
    return normalizeRoute((q.get('route')||'').split(','));
  }
  function load(){
    const state=readStored();
    const q=new URLSearchParams(location.search);
    const qr=routeFromQuery();
    if(qr!==null)reconcileRoute(state,qr);
    if(validDate(q.get('date')))state.startDate=q.get('date');
    return save(state);
  }
  function setRoute(state,route){reconcileRoute(state,route);return save(state);}
  function clearTrip(){const s=baseState();return save(s);}
  function buildUrl(page,state){
    const p=new URLSearchParams();
    if(state.route&&state.route.length)p.set('route',state.route.join(','));
    if(validDate(state.startDate))p.set('date',state.startDate);
    const qs=p.toString();
    return page+(qs?`?${qs}`:'');
  }
  function updateAddress(page,state){
    try{history.replaceState(null,'',buildUrl(page,state));}catch(_){/* file previews may block */}
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
  window.NTA={KEY,todayLocal,validDate,normalizeRoute,load,save,setRoute,clearTrip,buildUrl,updateAddress,byCode,addDays,diffDays,fmtDate,hasListedRoute,isNetworkHub,hasFlightLink,findFlightPath};
})();
