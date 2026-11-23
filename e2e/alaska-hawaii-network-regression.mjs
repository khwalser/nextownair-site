import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../data.js',import.meta.url),'utf8');
const context={window:{}};vm.createContext(context);vm.runInContext(src,context);
const D=context.window.NTA_DATA;
const airports=new Map(D.airports.map(x=>[x.code,x]));
const allEdges=[...D.routes,...D.backboneRoutes];
const graph=new Map(D.airports.map(x=>[x.code,new Set()]));
for(const [a,b] of allEdges){assert(airports.has(a)&&airports.has(b),'Network edge missing endpoint '+a+'-'+b);graph.get(a).add(b);graph.get(b).add(a);}
function path(a,b){const q=[[a]],seen=new Set([a]);while(q.length){const route=q.shift(),cur=route.at(-1);if(cur===b)return route;for(const n of graph.get(cur)||[])if(!seen.has(n)){seen.add(n);q.push([...route,n]);}}return null;}
for(const [a,b] of [['DTW','ANC'],['DTW','FAI'],['DTW','KOA'],['PHX','HNL'],['DEN','ANC'],['OGG','KOA'],['FAI','ANC']]){
 const route=path(a,b);assert(route&&route.length>=2,'No flight path '+a+'-'+b);console.log('PATH '+a+' → '+b+': '+route.join(' → '));
}
assert.equal(airports.get('KOA').type,'hub','Kona is a connector, not a new EAS community');
assert.equal(airports.get('KOA').state,'HI');
for(const key of ['OGG|KOA','KOA|OGG','ANC|FAI','FAI|ANC']){
 const p=D.servicePatterns[key];assert(p,'Published route pattern missing '+key);
 assert(p.sourceUrl?.startsWith('https://'),'Pattern must retain retrievable evidence');
 assert(p.checkedAsOf&&p.activeFrom&&p.activeThrough,'Bound schedule to supported window');
 assert(p.days.length===7,'Only explicitly verified daily patterns may be applied daily');
 assert(p.evidenceScope,'Evidence strength explicitly recorded');
 assert(!p.departures&&!p.departuresByDow,'No fabricated provider flight times');
}
assert(!D.servicePatterns['IAD|ANC'],'Seasonal IAD–Anchorage may not be advertised daily');
assert(!D.servicePatterns['PHX|HNL'],'Weekly aggregate is insufficient to invent a daily timetable');
const map=fs.readFileSync(new URL('../map.js',import.meta.url),'utf8');
assert.match(map,/\.\.\.\(D\.backboneRoutes\|\|\[\]\)/,'Map must use backbone edges shared with route finder');
assert.match(map,/backbone.*\?\(/,'Hub flight links require distinct region visibility handling');
const itinerary=fs.readFileSync(new URL('../itinerary.js',import.meta.url),'utf8');
assert.match(itinerary,/const airlineHandoff=carrierReservation\(a,b,departDate,knownCarrier\)/);
assert.match(itinerary,/This flight route is published, but service on this date is not confirmed/);
assert.match(itinerary,/No verified fare/);
console.log('PASS AK/HI graph, source-bounded daily evidence, and truthful missing-fare handling');
