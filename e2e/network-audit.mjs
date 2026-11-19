import fs from 'node:fs';

function fail(message){
  console.error('FAIL:',message);
  process.exitCode=1;
}
function pass(message){ console.log('PASS:',message); }

const raw=fs.readFileSync(new URL('../data.js',import.meta.url),'utf8');
const start=raw.indexOf('=');
const end=raw.lastIndexOf(';');
if(start<0||end<=start) throw new Error('Unable to parse data.js');
const D=JSON.parse(raw.slice(start+1,end).trim());

const airports=D.airports||[];
const mapRoutes=D.routes||[];
const backboneRoutes=D.backboneRoutes||[];
const routes=[...mapRoutes,...backboneRoutes];
const by=new Map();
for(const a of airports){
  if(by.has(a.code)) fail('Duplicate airport code '+a.code);
  by.set(a.code,a);
}
if(!process.exitCode) pass('Airport codes are unique');

const adj=new Map(airports.map(a=>[a.code,new Set()]));
const edgeKeys=new Set();
for(const edge of routes){
  if(!Array.isArray(edge)||edge.length!==2){ fail('Malformed route '+JSON.stringify(edge)); continue; }
  const [a,b]=edge;
  if(a===b) fail('Self route '+a);
  if(!by.has(a)||!by.has(b)){ fail('Route references unknown airport '+a+' → '+b); continue; }
  const key=[a,b].sort().join('|');
  if(edgeKeys.has(key)) fail('Duplicate route '+a+' ↔ '+b);
  edgeKeys.add(key);
  adj.get(a).add(b); adj.get(b).add(a);
}
if(!process.exitCode) pass('Route edges are valid and unique');

for(const a of airports.filter(a=>a.type==='eas')){
  if(!(adj.get(a.code)?.size)) fail('EAS airport has no route '+a.code);
  for(const hub of (a.hubs||[])){
    if(!adj.get(a.code)?.has(hub)) fail('Missing DOT/EAS edge '+a.code+' ↔ '+hub);
  }
}
if(!process.exitCode) pass('All DOT/EAS hub relationships exist in the graph');

function path(from,to){
  if(!by.has(from)||!by.has(to)) return null;
  const q=[from],seen=new Set([from]),prev=new Map();
  while(q.length){
    const cur=q.shift();
    if(cur===to) break;
    for(const next of adj.get(cur)||[]){
      if(seen.has(next)) continue;
      seen.add(next); prev.set(next,cur); q.push(next);
    }
  }
  if(!seen.has(to)) return null;
  const out=[to]; let cur=to;
  while(cur!==from){ cur=prev.get(cur); out.push(cur); }
  return out.reverse();
}

for(const hub of D.routeVerification?.continuityChecks||[]){
  const served=airports.filter(a=>a.type==='eas'&&(a.hubs||[]).includes(hub));
  const onward=[...(adj.get(hub)||[])].filter(code=>by.get(code)?.type!=='eas');
  if(!onward.length) fail('Continuity hub '+hub+' has no onward non-EAS route');
  for(const spoke of served){
    const p=path(spoke.code,'DEN')||path(spoke.code,'ORD')||path(spoke.code,'MSP')||path(spoke.code,'DFW');
    if(!p) fail('No onward national-network path found from '+spoke.code+' through '+hub);
  }
}
if(!process.exitCode) pass('Required connector continuity checks pass');

const seen=new Set(),components=[];
for(const code of by.keys()){
  if(seen.has(code)) continue;
  const q=[code],comp=[];seen.add(code);
  while(q.length){
    const cur=q.shift(); comp.push(cur);
    for(const next of adj.get(cur)||[]) if(!seen.has(next)){seen.add(next);q.push(next);}
  }
  components.push(comp);
}
components.sort((a,b)=>b.length-a.length);
console.log('INFO: airports='+airports.length+' mapRoutes='+mapRoutes.length+' backboneRoutes='+backboneRoutes.length+' totalRoutingEdges='+routes.length+' components='+components.length+' largest='+components[0]?.length);
console.log('INFO: component sizes='+components.map(x=>x.length).join(','));

const continuityWarnings=[];
const usedHubs=[...new Set(airports.flatMap(a=>a.hubs||[]))];
for(const hub of usedHubs){
  const outward=[...(adj.get(hub)||[])].filter(code=>by.get(code)?.type!=='eas');
  if(!outward.length) continuityWarnings.push(hub);
}
if(continuityWarnings.length) console.log('WARN: hubs with no modeled non-EAS onward edge: '+continuityWarnings.join(', '));
const remainingComponents=components.slice(1);
if(remainingComponents.length)console.log('WARN: remaining disconnected regional components: '+remainingComponents.map(c=>'['+c.join(',')+']').join(' '));

if((D.routeVerification?.backboneRoutePairs||0)!==backboneRoutes.length)fail('backboneRoutePairs metadata does not match backboneRoutes length');
const declaredAdditional=(D.routeVerification?.additionalSmallAirportSources||[]).flatMap(s=>s.verifiedPairs||[]);
for(const pair of declaredAdditional){
  const [a,b]=String(pair).split('-');
  if(!a||!b||!adj.get(a)?.has(b))fail('Declared additional small-airport route missing from graph: '+pair);
}
if(declaredAdditional.length!==(D.routeVerification?.additionalSmallAirportRoutePairs||0)){
  fail('additionalSmallAirportRoutePairs metadata does not match declared source pairs');
}else if(declaredAdditional.length){
  pass('All source-declared additional small-airport nonstop routes exist in the graph');
}
if(backboneRoutes.length)pass('Commercial backbone edges are tracked separately from the default map layer');
const expectedUnresolved=(D.routeVerification?.unresolvedNetworkComponents||[])
  .map(x=>(x.airports||[]).slice().sort().join('|'))
  .sort();
const actualUnresolved=components.slice(1)
  .map(x=>x.slice().sort().join('|'))
  .sort();
if(JSON.stringify(actualUnresolved)!==JSON.stringify(expectedUnresolved)){
  fail('Disconnected routing components changed. Expected '+JSON.stringify(expectedUnresolved)+' but found '+JSON.stringify(actualUnresolved));
}else{
  pass('Only explicitly documented unresolved regional components remain disconnected');
}
const unresolvedAirportCount=(D.routeVerification?.unresolvedNetworkComponents||[]).reduce((sum,x)=>sum+(x.airports||[]).length,0);
if((components[0]?.length||0)!==airports.length-unresolvedAirportCount){
  fail('Main connected component size does not match documented unresolved airports');
}else{
  pass('Main routing component contains every airport not explicitly documented as unresolved');
}

if(process.exitCode) process.exit(process.exitCode);
