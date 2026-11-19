import fs from 'node:fs';

function fail(message){console.error('FAIL:',message);process.exitCode=1;}
function pass(message){console.log('PASS:',message);}

const raw=fs.readFileSync(new URL('../data.js',import.meta.url),'utf8');
const itinerary=fs.readFileSync(new URL('../itinerary.js',import.meta.url),'utf8');
const start=raw.indexOf('='),end=raw.lastIndexOf(';');
if(start<0||end<=start)throw new Error('Unable to parse data.js');
const D=JSON.parse(raw.slice(start+1,end).trim());

const airports=D.airports||[];
const by=new Map(airports.map(a=>[a.code,a]));
const flightEdges=[...(D.routes||[]),...(D.backboneRoutes||[])];
const edgeKeys=new Set(flightEdges.map(([a,b])=>[a,b].sort().join('|')));

const dataPatterns=D.servicePatterns||{};
const patternKeys=new Set(Object.keys(dataPatterns));
for(const match of itinerary.matchAll(/'([A-Z]{3}\|[A-Z]{3})':\{days:/g))patternKeys.add(match[1]);

for(const [key,pattern] of Object.entries(dataPatterns)){
  const [a,b]=key.split('|');
  if(!a||!b||!by.has(a)||!by.has(b))fail('Service pattern references unknown airport '+key);
  if(!edgeKeys.has([a,b].sort().join('|')))fail('Service pattern has no matching flight edge '+key);
  if(!Array.isArray(pattern.days)||!pattern.days.length||pattern.days.some(d=>!Number.isInteger(d)||d<0||d>6))fail('Service pattern has invalid days '+key);
  if(pattern.activeFrom&&pattern.activeThrough&&pattern.activeFrom>pattern.activeThrough)fail('Service pattern has inverted date bounds '+key);
  if(pattern.sourceUrl&&!/^https:\/\//.test(pattern.sourceUrl))fail('Service pattern source URL is not HTTPS '+key);
}
if(!process.exitCode)pass('Source-backed service patterns are structurally valid');

const easAirports=airports.filter(a=>a.type==='eas');
const easPairs=new Map();
for(const airport of easAirports){
  for(const hub of airport.hubs||[])easPairs.set([airport.code,hub].sort().join('|'),[airport.code,hub]);
}
const pairs=[...easPairs.values()];
function covered(a,b){return patternKeys.has(a+'|'+b)||patternKeys.has(b+'|'+a);}
const coveredPairs=pairs.filter(([a,b])=>covered(a,b));
const providerDependent=pairs.filter(([a,b])=>!covered(a,b));
const alaskaPairs=pairs.filter(([a,b])=>by.get(a)?.state==='AK'||by.get(b)?.state==='AK');
const alaskaCovered=alaskaPairs.filter(([a,b])=>covered(a,b));
const lower48Pairs=pairs.filter(([a,b])=>by.get(a)?.state!=='AK'&&by.get(b)?.state!=='AK');
const lower48Covered=lower48Pairs.filter(([a,b])=>covered(a,b));

const pct=(n,d)=>d?Math.round(n/d*1000)/10:0;
console.log('INFO: EAS source-backed schedule fallback coverage '+coveredPairs.length+'/'+pairs.length+' ('+pct(coveredPairs.length,pairs.length)+'%)');
console.log('INFO: Alaska EAS fallback coverage '+alaskaCovered.length+'/'+alaskaPairs.length+' ('+pct(alaskaCovered.length,alaskaPairs.length)+'%)');
console.log('INFO: Lower-48/HI/PR EAS fallback coverage '+lower48Covered.length+'/'+lower48Pairs.length+' ('+pct(lower48Covered.length,lower48Pairs.length)+'%)');

const byHub=new Map();
for(const [community,hub] of providerDependent){
  if(!byHub.has(hub))byHub.set(hub,[]);
  byHub.get(hub).push(community);
}
const top=[...byHub.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0,12);
console.log('INFO: largest provider-dependent hub groups '+top.map(([hub,codes])=>hub+':'+codes.length+' ['+codes.join(',')+']').join(' | '));

const alaskaUncovered=providerDependent.filter(([a,b])=>by.get(a)?.state==='AK'||by.get(b)?.state==='AK');
console.log('INFO: Alaska provider-dependent EAS pairs '+alaskaUncovered.map(x=>x.join('-')).sort().join(','));

if(coveredPairs.length<24)fail('Minimum source-backed EAS fallback coverage regressed below 24 pairs: '+coveredPairs.length);
else pass('Minimum source-backed EAS fallback coverage is at least 24 pairs');
if(coveredPairs.length===0)fail('No EAS source-backed schedule fallbacks remain');
if(process.exitCode)process.exit(process.exitCode);
