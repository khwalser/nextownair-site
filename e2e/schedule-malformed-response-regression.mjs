import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../netlify/functions/schedule-proxy.mjs',import.meta.url),'utf8');
const start=source.indexOf('async function fetchHalfDay(');
const end=source.indexOf('async function fetchDate(',start);
assert(start>=0&&end>start,'Published schedule parser is present');
let mock;
const context={
  URLSearchParams,encodeURIComponent,
  rateLimitedFetch:async()=>mock,
  normalizeFlight:flight=>flight
};
vm.createContext(context);
vm.runInContext(source.slice(start,end)+'\nthis.fetchHalfDay=fetchHalfDay;',context);
const read=()=>context.fetchHalfDay('key','DTW','ROC','2026-12-10T00:00','2026-12-10T12:00');
mock={status:200,ok:true,json:async()=>{throw new SyntaxError('Invalid JSON');}};
await assert.rejects(read(),/invalid JSON/,'A malformed 200 schedule result must remain unverified');
mock={status:200,ok:true,json:async()=>({})};
await assert.rejects(read(),/invalid departures payload/,'A malformed schedule result cannot invent a no-flight day');
mock={status:200,ok:true,json:async()=>({departures:[]})};
assert.equal((await read()).length,0,'Explicit empty departures array is a valid no-flight result');
mock={status:204,ok:true};
assert.equal((await read()).length,0,'204 explicitly indicates no departures');
mock={status:429,ok:false,json:async()=>{throw new SyntaxError('No JSON body');}};
await assert.rejects(read(),error=>error.status===429,'A header-only rate limit preserves its HTTP status');
console.log('PASS: Calendar schedule parser distinguishes confirmed no-service from unknown provider failures');
