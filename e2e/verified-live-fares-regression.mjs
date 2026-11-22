import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../itinerary.js',import.meta.url),'utf8');
const start=source.indexOf('  function lowestOffer(data){'),end=source.indexOf('  function formatMoney(',start);
assert(start>=0&&end>start);
const ctx={};vm.createContext(ctx);
vm.runInContext(source.slice(start,end)+'\nthis.lowestOffer=lowestOffer;this.lowestLiveOffer=lowestLiveOffer;',ctx);
const mixed={liveMode:true,offers:[
 {amount:20,liveMode:false,fareStatus:'prototype',currency:'USD'},
 {amount:29,liveMode:true,fareStatus:'prototype',currency:'USD'},
 {amount:235,liveMode:true,fareStatus:'verified',currency:'USD'},
 {amount:195,liveMode:true,fareStatus:'verified',currency:'USD'},
 {amount:null,liveMode:true,fareStatus:'verified',currency:'USD'}
]};
assert.equal(ctx.lowestOffer(mixed).amount,20,'Planning values may still exist without becoming live prices');
assert.equal(ctx.lowestLiveOffer(mixed).amount,195,'Lowest verified fare selected rather than cheaper test amount');
assert.equal(ctx.lowestLiveOffer({liveMode:false,offers:[{amount:1,liveMode:true,fareStatus:'verified'}]}),null,'Test response cannot masquerade as live');
assert.equal(ctx.lowestLiveOffer({liveMode:true,offers:[{amount:0,liveMode:true,fareStatus:'prototype'}]}),null,'Prototype zero never counts as a free verified fare');
assert.equal(ctx.lowestLiveOffer({liveMode:true,offers:[]}),null);
assert.match(source,/const best=lowestLiveOffer\(fareData\),isLive=Boolean\(best\)/);
assert.match(source,/No verified fare/);
assert.match(source,/provider prices are unverified/);
console.log('PASS: mixed live/test prices cannot mislead calendar or itinerary; only independently verified fares are quoted');
