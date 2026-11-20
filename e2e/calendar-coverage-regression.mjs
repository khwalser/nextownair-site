import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../itinerary.js',import.meta.url),'utf8');
const begin=source.indexOf('  function scheduleState(');
const end=source.indexOf('  function firstLeg(',begin);
assert(begin>=0&&end>begin,'Could not find the production schedule-state function');
const dates=new Map([['DTW|ROC|2026-11',{days:{},checkedDates:['2026-11-25']} ]]);
const context={
  scheduleMonthData:dates,
  scheduleMonthKey:(a,b,m)=>a+'|'+b+'|'+m,
  monthKeyFromDate:d=>d.slice(0,7),
  publishedServicePattern:()=>null,
  parseYmd:()=>null,
  isScheduleFallbackCode:()=>false
};
vm.createContext(context);
vm.runInContext(source.slice(begin,end)+'\nthis.scheduleState=scheduleState;',context);
const result=context.scheduleState('DTW','ROC','2026-11-25');
assert.equal(result.status,'fallback','Missing published date must offer a live fare check, not falsely assert no service');
assert.notEqual(result.status,'yes','A live fare check must not invent verified service');
assert.equal(context.scheduleState('DTW','ROC','2026-11-26').status,'checking','Unqueried dates stay unverified');
console.log('PASS: Empty schedule coverage offers a live fare check without inventing service');
