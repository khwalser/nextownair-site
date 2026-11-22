import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../itinerary.js',import.meta.url),'utf8');
const start=source.indexOf('  function renderLeg('),end=source.indexOf('    // A late fare response',start);
assert(start>=0&&end>start);
const ctx={
 F:{hasKnownRoute:()=>true},
 state:{selections:{},autoConnectorIndices:[]},
 liveFareData:new Map(),fareKey:(a,b,date)=>a+'|'+b+'|'+date,
 providerOptions:()=>[],scheduleOptions:()=>[],
 scheduleState:()=>({status:'fallback',sourceConflict:true,label:'Schedule sources disagree'}),
 publishedServicePattern:()=>({days:[0,1,2,3,4,5,6],count:2}),
 patternAppliesOnDate:()=>true,
 prototypeOptions:(a,b,date)=>[{id:'prototype|0|'+a+'|'+b+'|'+date,prototype:true,fareStatus:'prototype',timeStatus:'prototype'}]
};
vm.createContext(ctx);
vm.runInContext(source.slice(start,end)+'\n    return {opts,publishedDate,tentativePattern,selectedAvailability};\n  }\nthis.inspect=renderLeg;',ctx);
let result=ctx.inspect(4,'CMX','ORD','2026-12-13',null,true);
assert.equal(result.tentativePattern,true);
assert.equal(result.publishedDate,false,'Conflicting route date must not be labeled confirmed');
assert.equal(result.opts.length,1,'Source-backed conflicting date can still be planned tentatively');
assert.equal(result.opts[0].fareStatus,'prototype','No fake live fare');
ctx.scheduleState=()=>({status:'fallback'});
result=ctx.inspect(4,'CMX','ORD','2026-12-13',null,true);
assert.equal(result.opts.length,0,'Unknown date without published-pattern conflict cannot invent planning options');
ctx.scheduleState=()=>({status:'none'});
result=ctx.inspect(4,'CMX','ORD','2026-12-13',null,true);
assert.equal(result.opts.length,0,'Explicit published non-service date cannot invent flights');
ctx.scheduleState=()=>({status:'yes'});
result=ctx.inspect(4,'CMX','ORD','2026-12-13',null,true);
assert.equal(result.opts.length,1,'Published service can be planned');
console.log('PASS: conflicting sources allow ONLY clearly tentative planning options, never verified offers or invented no-service dates');
