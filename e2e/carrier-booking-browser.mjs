import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const base=(process.env.E2E_BASE_URL||'https://nextownair.com').replace(/\/$/,'');
const date='2026-12-10';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome'});
try{
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  // BKW–CLT is modeled with a published Contour carrier, even when
  // flight inventory is unavailable for the requested date.
  await page.goto(base+'/itinerary.html?route=BKW%2CCLT&date='+date,{waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('.leg .carrier-booking-link').first().waitFor({timeout:20000});
  const carrier=await page.locator('.leg .carrier-booking-link').first().evaluate(node=>({
    label:node.textContent,href:node.href,rel:node.rel,parent:node.parentElement.textContent
  }));
  assert.match(carrier.label,/Contour Airlines/,'Named route carrier is shown on itinerary leg');
  assert.equal(new URL(carrier.href).hostname,'www.contourairlines.com','Booking action leads to official named carrier');
  assert.match(carrier.rel,/noopener/,'External booking link cannot control NexTownAir tab');
  assert.match(carrier.parent,/enter BKW → CLT for 2026-12-10/,'Traveler knows the route/date to enter on carrier site');
  assert.match(carrier.parent,/not prefilled or guaranteed/i,'Flight availability is not claimed');
  const unknown=await page.evaluate(()=>window.NTA_CARRIER_BOOKING.resolve({origin:'DTW',destination:'ROC',date:'2026-12-10',carrier:'Unknown operator'}));
  assert.equal(unknown,null,'Unknown carrier never gets a made-up booking URL');
  assert.deepEqual(errors,[],'No uncaught JavaScript errors in carrier link itinerary');
  console.log('PASS: Production browser offers official Contour carrier booking handoff for existing itinerary leg');
}finally{await browser.close();}
