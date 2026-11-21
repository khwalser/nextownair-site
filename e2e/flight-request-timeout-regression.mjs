import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../flight-provider.js',import.meta.url),'utf8');
let timeoutCallback=null;
let lastSignal=null;
let mode='stall';
const context={
  window:{NTA_DATA:{routes:[]}},
  URLSearchParams,
  AbortController,
  setTimeout:cb=>{timeoutCallback=cb;return 1;},
  clearTimeout:()=>{},
  fetch:async (_url,options)=>{
    lastSignal=options.signal;
    if(mode==='success')return {ok:true,status:200,json:async()=>({offers:[]})};
    if(mode==='invalid-json')return {ok:true,status:200,json:async()=>{throw new SyntaxError('invalid JSON');}};
    if(mode==='empty-429')return {ok:false,status:429,json:async()=>{throw new SyntaxError('empty body');}};
    if(mode==='stalled-body')return {ok:true,status:200,json:()=>new Promise((resolve,reject)=>{
      options.signal.addEventListener('abort',()=>{
        const e=new Error('Body aborted');e.name='AbortError';reject(e);
      },{once:true});
    })};
    return new Promise((resolve,reject)=>{
      options.signal.addEventListener('abort',()=>{
        const e=new Error('Request aborted');e.name='AbortError';reject(e);
      },{once:true});
    });
  }
};
vm.createContext(context);
vm.runInContext(source,context);
const F=context.window.NTA_FLIGHTS;
for(const stallMode of ['stall','stalled-body']){
  mode=stallMode;
  for(const operation of [
    ()=>F.fetchOffers('DTW','ROC','2026-12-10'),
    ()=>F.fetchScheduleMonth('DTW','ROC','2026-12')
  ]){
    timeoutCallback=null;
    const pending=operation();
    assert.equal(typeof timeoutCallback,'function','Request sets a timeout');
    assert.equal(lastSignal.aborted,false,'Request starts with active signal');
    // Let the mocked fetch resolve headers so the stalled-body test enters JSON parsing.
    if(stallMode==='stalled-body')await new Promise(resolve=>setImmediate(resolve));
    timeoutCallback();
    await assert.rejects(pending,/aborted/,'Stalled '+stallMode+' request is rejected after timeout');
    assert.equal(lastSignal.aborted,true,'Request aborts the in-flight fetch');
  }
}
mode='invalid-json';
await assert.rejects(F.fetchOffers('DTW','ROC','2026-12-10'),/invalid JSON/,'Malformed 200 fare response must not be classified as no offers');
await assert.rejects(F.fetchScheduleMonth('DTW','ROC','2026-12'),/invalid JSON/,'Malformed 200 schedule response must not be classified as empty schedule');
mode='empty-429';
const limited=await F.fetchOffers('DTW','ROC','2026-12-10');
assert.equal(limited.status,429,'Empty rate-limit response preserves HTTP 429');
assert.equal(limited.ok,false,'Empty rate-limit response remains an error for cooldown processing');
mode='success';
assert.equal((await F.fetchOffers('DTW','ROC','2026-12-10')).ok,true,'Normal fare request still succeeds');
assert.equal((await F.fetchScheduleMonth('DTW','ROC','2026-12')).offers.length,0,'Normal schedule response still succeeds');
console.log('PASS: Fare and schedule network requests terminate on timeout without changing successful responses');
