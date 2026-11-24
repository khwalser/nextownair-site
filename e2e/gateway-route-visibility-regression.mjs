import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const data=fs.readFileSync(new URL('../data.js',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../map.js',import.meta.url),'utf8');
const ctx={window:{}};
vm.createContext(ctx);vm.runInContext(data,ctx);
const D=ctx.window.NTA_DATA;
const neighbors=code=>{
 const found=new Map();
 for(const [kind,pairs] of [['eas',D.routes],['hub',D.backboneRoutes]]){
  for(const [a,b] of pairs){
   if(a===code||b===code){
    const dest=a===code?b:a;
    if(!found.has(dest))found.set(dest,kind);
   }
  }
 }
 return found;
};
const seattle=neighbors('SEA'),portland=neighbors('PDX');
assert.deepEqual([...seattle.keys()].sort(),['ANC','DTW','HNL','KOA','OGG']);
assert.deepEqual([...portland.keys()].sort(),['ANC','HNL','IAD','PDT','PHX']);
assert.equal([...seattle.values()].filter(x=>x==='eas').length,0);
assert.equal([...portland.values()].filter(x=>x==='eas').length,1);
assert.match(js,/function gatewayRoutes\(code\)/);
assert.match(js,/function focusGateway\(code\)/);
assert.match(js,/gatewayLink=activeGateway/);
assert.match(js,/item\.a\.code===activeGateway\|\|item\.b\.code===activeGateway/);
assert.match(js,/Network links only\. A flight on your date and a live fare must be checked separately/);
assert(!D.servicePatterns['SEA|ANC'],'A route link cannot fabricate schedule evidence');
assert(!D.servicePatterns['PDX|ANC'],'No date-specific timetable fabricated');
console.log('PASS SEA 5 and PDX 5 documented route links; links distinguish EAS vs backbone and not live inventory');
