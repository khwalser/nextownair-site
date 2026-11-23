// Source-backed Alaska/Hawaii network and timetable integrity checks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../data.js',import.meta.url),'utf8');
const stateSrc=fs.readFileSync(new URL('../trip-state.js',import.meta.url),'utf8');
const bookingSrc=fs.readFileSync(new URL('../carrier-booking.js',import.meta.url),'utf8');
const context={window:{},Date,URLSearchParams,TextEncoder,TextDecoder};
vm.createContext(context);
vm.runInContext(src,context);
vm.runInContext(stateSrc,context);
vm.runInContext(bookingSrc,context);
const D=context.window.NTA_DATA,N=context.window.NTA,B=context.window.NTA_CARRIER_BOOKING;
assert.equal(D.airports.filter(a=>a.code==='SEA').length,1,'Seattle gateway added exactly once');
assert.equal(D.airports.find(a=>a.code==='SEA').state,'WA');
const pairs=['SEA|ANC','SEA|HNL','SEA|OGG','SEA|KOA','LAX|ANC','LAX|HNL','LAX|OGG','PDX|ANC','PDX|HNL','DTW|SEA','HNL|OGG','HNL|KOA'];
for(const pair of pairs){
 const [a,b]=pair.split('|');
 assert(N.hasFlightLink(a,b)&&N.hasFlightLink(b,a),'Missing sourced direct nonstop route '+pair);
 assert.equal(N.findFlightPath(a,b).length,2,'Nonstop should not require inserted connector: '+pair);
}
for(const [a,b] of [['DTW','UNK'],['DTW','HNM'],['DTW','MUE'],['SEA','LUP'],['LAX','LNY'],['ANC','HNL']]){
 const path=N.findTravelPath(a,b);
 assert(path&&path[0]===a&&path.at(-1)===b,'End-to-end route missing: '+a+'→'+b);
 assert(path.length<10,'Unexpectedly circuitous route '+a+'→'+b+' '+path.join('→'));
 console.log('PATH '+a+'→'+b+': '+path.join('→'));
}
const dated=['HNM|OGG','OGG|HNM','MUE|OGG','OGG|MUE'];
for(const key of dated){
 const p=D.servicePatterns[key];
 assert(p&&p.activeFrom<='2026-12-04'&&p.activeThrough>='2026-12-04','December published pattern absent '+key);
 assert(p.sourceUrl?.startsWith('https://'),'No source for '+key);
 assert.equal(p.departures.length,1,'One sourced daily minimum used for '+key);
 assert.match(p.departures[0].depart,/^\d{2}:\d{2}$/);
 assert.match(p.departures[0].arrive,/^\d{2}:\d{2}$/);
 assert(p.departures[0].ident.startsWith('9X'),'Sourced flight identifier missing');
 assert(p.activeThrough<'2027-02-01','Do not silently extrapolate timetable indefinitely');
}
for(const key of ['HNL|LNY','LNY|HNL']){
 const p=D.servicePatterns[key];
 assert.equal(p.activeThrough,'2026-12-06','Sampled timetable must not extrapolate beyond verified week');
 assert(!p.departures,'No fabricated departure/arrival times for '+key);
}
assert.equal(D.servicePatterns['HNM|OGG'].departures[0].depart,'08:55');
assert.equal(D.servicePatterns['MUE|OGG'].departures[0].depart,'07:17');
assert(!D.servicePatterns['SEA|ANC'],'Gateway is not a verified date schedule');
assert(!D.servicePatterns['HNL|OGG'],'Hawaii hub route is not a verified date schedule');
const bookingTests=[
 ['SEA','ANC','Alaska Airlines'],['HNL','SEA','Alaska Airlines'],
 ['DTW','SEA','Delta Air Lines'],['HNL','OGG','Alaska Airlines'],['HNL','KOA','Alaska Airlines'],
 ['HNM','OGG','Mokulele Airlines'],['MUE','OGG','Mokulele Airlines'],['OGG','HNM','Mokulele Airlines']
];
for(const [a,b,carrier] of bookingTests){
 const link=B.resolve({origin:a,destination:b,date:'2026-12-04'});
 assert(link&&link.name===carrier,'Missing sourced official airline booking handoff '+a+'→'+b);
 assert.equal(link.dateVerified,false,'Airline site link is not a date-valid offer');
 assert.equal(link.searchPrefilled,false,'Booking URL must not pretend to be prefilled');
}
assert.equal(B.resolve({origin:'DTW',destination:'UNK',date:'2026-12-04'}),null,'No unsupported carrier guesses on long, non-direct route');
console.log('PASS: sourced AK/HI gateways, Hawaii published operating times, cross-region graph, and non-fare airline handoffs');
