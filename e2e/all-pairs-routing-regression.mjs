import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const dataSource=fs.readFileSync(new URL('../data.js',import.meta.url),'utf8');
const stateSource=fs.readFileSync(new URL('../trip-state.js',import.meta.url),'utf8');
const context={
  window:{},
  location:{search:'',pathname:'/',hash:'',href:'https://nextownair.com/'},
  history:{replaceState:()=>{}},
  localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},
  sessionStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},
  URL,URLSearchParams,Date,Map,Set,Number,String,Object,JSON,Math
};
vm.createContext(context);
vm.runInContext(dataSource,context);
vm.runInContext(stateSource,context);
const N=context.window.NTA;
const airports=context.window.NTA_DATA.airports.map(x=>x.code);
assert.equal(new Set(airports).size,airports.length,'Unique airport codes');
let verifiedPairs=0;
let mixedModePairs=0;
for(const from of airports){
  for(const to of airports){
    const route=N.findTravelPath(from,to);
    assert(route&&route.length>0,from+' → '+to+' must be routable in modeled graph');
    assert.equal(route[0],from,'Path origin');
    assert.equal(route[route.length-1],to,'Path destination');
    assert(route.length<=airports.length,'No route loops');
    assert.equal(new Set(route).size,route.length,'Shortest path contains no repeated airport');
    for(let i=1;i<route.length;i++){
      const a=route[i-1],b=route[i];
      assert(N.hasTravelLink(a,b),'No invented segment '+a+' → '+b);
      if(N.hasTransferLink(a,b))mixedModePairs++;
    }
    verifiedPairs++;
  }
}
assert.equal(N.findTravelPath('NOT','DTW'),null,'Unknown airport never yields a path');
assert.equal(N.hasFlightLink('DTW','DTW'),false,'Same-airport segment is not a flight');
console.log('PASS: Exhaustive modeled route matrix: '+verifiedPairs+' ordered airport pairs from '+airports.length+' airports');
console.log('PASS: Every proposed path has real model edges, zero loops, and explicit transfers ('+mixedModePairs+' traversals)');
