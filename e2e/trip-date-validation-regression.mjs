import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../trip-state.js',import.meta.url),'utf8');
const data=new Map();
const storage={
  getItem:key=>data.get(key)??null,
  setItem:(key,value)=>data.set(key,String(value)),
  removeItem:key=>data.delete(key),
  key:index=>[...data.keys()][index]??null,
  get length(){return data.size;}
};
const location={search:'',pathname:'/itinerary.html',hash:'',href:'https://nextownair.com/itinerary.html'};
const context={
  window:{NTA_DATA:{airports:[{code:'DTW'},{code:'ROC'}],routes:[['DTW','ROC']]}},
  location,history:{replaceState:()=>{}},localStorage:storage,sessionStorage:storage,
  URLSearchParams,URL,Date,Map,Set,Number,String,Object,Math,JSON,
  btoa:value=>Buffer.from(value,'utf8').toString('base64'),
  atob:value=>Buffer.from(value,'base64').toString('utf8')
};
vm.createContext(context);
vm.runInContext(source,context);
const N=context.window.NTA;
for(const date of ['2026-11-21','2028-02-29','2096-02-29','2030-12-31']){
  assert.equal(N.validDate(date),true,'Valid date rejected: '+date);
}
for(const date of ['2026-02-29','2026-02-31','2026-04-31','2026-13-01','2026-00-12','2026-11-00','0000-01-01',null,20261121]){
  assert.equal(N.validDate(date),false,'Impossible or malformed date accepted: '+date);
}
storage.setItem(N.KEY,JSON.stringify({version:2,route:['DTW','ROC'],startDate:'2026-02-31',stays:{},selections:{}}));
assert.equal(N.load().startDate,N.todayLocal(),'Invalid saved date must reset to a valid local date');
location.search='?date=2099-02-29';
assert.equal(N.load().startDate,N.todayLocal(),'Invalid date query must not overwrite current state');
location.search='?date=2096-02-29';
assert.equal(N.load().startDate,'2096-02-29','Valid leap-year query date must be accepted');
const snapshot=N.encodeTripSnapshot({route:['DTW','ROC'],startDate:'2026-02-31',stays:{},selections:{}});
assert.equal(N.decodeTripSnapshot(snapshot).startDate,N.todayLocal(),'Invalid shared date must not be preserved');
assert.equal(N.addDays('2028-02-28',1),'2028-02-29','Leap-year day arithmetic is preserved');
assert.equal(N.normalizeRoute(['DTW','DTW','ROC','ROC','DTW']).join(','),'DTW,ROC,DTW','Consecutive duplicate stops are removed but legitimate revisits remain');
location.search='?route=DTW,DTW,ROC&date=2096-02-29';
assert.equal(N.load().route.join(','),'DTW,ROC','Imported route cannot create same-airport flight legs');
const sharedRoute=N.encodeTripSnapshot({route:['DTW','DTW','ROC'],startDate:'2096-02-29',stays:{},selections:{}});
assert.equal(N.decodeTripSnapshot(sharedRoute).route.join(','),'DTW,ROC','Shared snapshots also remove adjacent duplicate stops');

console.log('PASS: Shared trip-state date validation rejects impossible calendar dates across storage, links and snapshots');
