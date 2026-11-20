import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../itinerary.js',import.meta.url),'utf8');
const start=source.indexOf('  function calendarMoreFareControl(');
const end=source.indexOf('  function updateCalendarFareStatus(',start);
assert(start>=0&&end>start,'Calendar pricing control implementation is present');
const button={hidden:true,disabled:false,textContent:''};
const data=new Map();
const jobs=new Set();
const blocked=new Set();
const ctx={
  document:{getElementById:id=>id==='calendarMoreFares'?button:null},
  liveFareData:data,calendarFareJobs:jobs,fareCoverageBlockedLegs:blocked,
  fareKey:(a,b,date)=>a+'|'+b+'|'+date,
  fareLegKey:(a,b)=>a+'|'+b
};
vm.createContext(ctx);
vm.runInContext(source.slice(start,end)+'\nthis.showMore=calendarMoreFareControl',ctx);
const dates=['2026-11-25','2026-11-26','2026-11-27'];
ctx.showMore('DTW','ORD','2026-11',dates,0);
assert.equal(button.hidden,false,'Unpriced confirmed dates have a visible action');
assert.equal(button.disabled,false);
assert.match(button.textContent,/3 more dates/);
jobs.add('DTW|ORD|2026-11-25');
ctx.showMore('DTW','ORD','2026-11',dates,1);
assert.equal(button.disabled,true,'Pending checks show an ongoing state');
assert.match(button.textContent,/Checking 1 queued date/);
jobs.clear();data.set('DTW|ORD|2026-11-25',{offers:[{amount:241}]});
ctx.showMore('DTW','ORD','2026-11',dates,0);
assert.equal(button.disabled,false,'The action reactivates after queued prices finish');
assert.match(button.textContent,/2 more dates/);
data.set('DTW|ORD|2026-11-26',{offers:[]});data.set('DTW|ORD|2026-11-27',{offers:[]});
ctx.showMore('DTW','ORD','2026-11',dates,0);
assert.equal(button.hidden,true,'No more-price button when all dates have returned');
data.clear();blocked.add('DTW|ORD');
ctx.showMore('DTW','ORD','2026-11',dates,0);
assert.equal(button.hidden,true,'Unsupported fare routes do not offer fake price checks');
assert.match(source,/refreshVisibleCalendar\(\)/,'Completed requests update the current visible calendar after a rerender');
console.log('PASS: Calendar pricing progress, completion, optional additional checks, and unsupported coverage');
