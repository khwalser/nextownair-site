import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../netlify/functions/schedule-proxy.mjs',import.meta.url),'utf8');
const start=source.indexOf('const API_BASE=');
const end=source.indexOf('async function fetchHalfDay(',start);
assert(start>=0&&end>start,'Schedule provider request boundary exists');
const requests=[];
const sleeps=[];
let responses=[];
const context={
  Date,Number,Math,Promise,String,
  AbortSignal:{timeout:ms=>({timeoutMs:ms})},
  sleep:async ms=>{sleeps.push(ms);},
  fetch:async (url,options)=>{
    requests.push({url,options});
    const next=responses.shift();
    if(next instanceof Error)throw next;
    return {status:next.status,headers:{get:key=>key==='retry-after'?(next.retryAfter||null):null}};
  }
};
vm.createContext(context);
vm.runInContext(source.slice(start,end)+'\nthis.rateLimitedFetch=rateLimitedFetch;this.scheduleRetryDelayMs=scheduleRetryDelayMs;',context);
const F=context.rateLimitedFetch;
assert.equal(context.scheduleRetryDelayMs('3600'),3600000,'Numeric Retry-After is seconds');
assert.equal(context.scheduleRetryDelayMs('1.5'),1500,'Fractional Retry-After is seconds');
assert.equal(context.scheduleRetryDelayMs('bad-header'),1500,'Unparseable Retry-After uses bounded fallback');
responses=[{status:429,retryAfter:'3600'}];requests.length=0;sleeps.length=0;
assert.equal((await F('https://provider.test','key')).status,429);
assert.equal(requests.length,1,'One quota-exhausted 429 must not trigger minutes of sleeping or repeated requests');
assert.equal(sleeps.length,0,'Long Retry-After does not hold the user interface');
assert.equal(requests[0].options.signal.timeoutMs,8000,'Every upstream request has an eight-second timeout');
responses=[{status:429,retryAfter:'1'},{status:200}];requests.length=0;sleeps.length=0;
assert.equal((await F('https://provider.test','key')).status,200,'Short rate-limit cooldown can recover');
assert.equal(requests.length,2,'Short Retry-After retries once then succeeds');
assert(sleeps.some(ms=>ms>=1250&&ms<=5000),'Short retry applies bounded backoff');
responses=[new Error('Upstream request timed out')];requests.length=0;
await assert.rejects(F('https://provider.test','key'),/timed out/,'Upstream timeout propagates to partial schedule fallback');
console.log('PASS: Schedule provider requests use bounded waits, respect retry delays, and propagate timeouts');
