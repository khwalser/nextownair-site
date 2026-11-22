import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const data=fs.readFileSync(new URL('../data.js',import.meta.url),'utf8');
const booking=fs.readFileSync(new URL('../carrier-booking.js',import.meta.url),'utf8');
const itinerary=fs.readFileSync(new URL('../itinerary.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../itinerary.html',import.meta.url),'utf8');
const ctx={window:{}};
vm.createContext(ctx);
vm.runInContext(data,ctx);
vm.runInContext(booking,ctx);
const C=ctx.window.NTA_CARRIER_BOOKING;
assert(C&&typeof C.resolve==='function','Carrier booking directory is available to itinerary');
assert(html.indexOf('carrier-booking.js')>html.indexOf('flight-provider.js'),'Booking helper loads after flight provider');
assert(html.indexOf('carrier-booking.js')<html.indexOf('itinerary.js'),'Booking helper loads before itinerary rendering');
const cases=[
  ['Cape Air','cape','capeair.com'],
  ['Southern Airways Express','southern','iflysouthern.com'],
  ['Mokulele Airlines','mokulele','mokuleleairlines.com'],
  ['Denver Air Connection','denver','denverairconnection.com'],
  ['Contour Aviation','contour','contourairlines.com'],
  ['Alaska Seaplanes','alaska-seaplanes','flyalaskaseaplanes.com'],
  ['Wright Air Service','wright','wrightairservice.com'],
  ['Bering Air','bering','beringair.com'],
  ["Warbelow's Air Ventures",'warbelows','warbelows.com'],
  ['United Express','united','united.com'],
  ['American Eagle','american','aa.com'],
  ['Delta Connection','delta','delta.com'],
  ['Alaska Airlines','alaska','alaskaair.com']
];
for(const [name,id,hostname] of cases){
  const result=C.resolve({carrier:name,origin:'DTW',destination:'ROC',date:'2026-12-05'});
  assert(result,'Carrier mapping required: '+name);
  assert.equal(result.id,id,'Correct carrier for '+name);
  assert.equal(new URL(result.url).hostname.replace(/^www\./,''),hostname,'Only carrier-owned booking or contact URL for '+name);
  assert.equal(result.searchPrefilled,false,'Do not claim route/date prefilled');
  assert.equal(result.dateVerified,false,'Do not claim booking inventory verified');
}
assert.equal(C.resolve({origin:'DTW',destination:'ROC',carrier:'Regional airline example',date:'2026-12-05'}),null,'Unknown airline has no fabricated carrier booking link');
assert.equal(C.resolve({origin:'DTW',destination:'DTW',carrier:'United Airlines'}),null,'Same-airport invalid leg is not bookable');
assert.equal(C.resolve({origin:'D1W',destination:'ROC',carrier:'Delta Air Lines'}),null,'Invalid airport codes rejected');
assert.equal(C.resolve({origin:'DTW',destination:'ROC',carrier:'Unverified Alaska seaplanes'}).id,'alaska-seaplanes','Specific Alaska Seaplanes wins over generic Alaska');
assert(itinerary.includes('carrierBookingAction(a,b,departDate,knownCarrier)'),'Every known flight leg offers official airline handoff when mapped');
assert(itinerary.includes('carrierReservation(x.from,x.to,x.departDate,x.carrier)'),'Booking checklist uses carrier actually chosen');
assert(itinerary.includes('Search flight booking options'),'Unmatched carrier retains general search');
assert(!booking.includes('searchParams.set'),'No undocumented carrier deep-link parameters');
console.log('PASS: 13 independently linked carrier booking/contact channels, itinerary leg + checkout handoff, and honest fallback');
