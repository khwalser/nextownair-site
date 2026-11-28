import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base=(process.env.E2E_BASE_URL||'https://nextownair.com').replace(/\/$/,'');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome'});
try {
  for(const width of [390, 768, 1366]) {
    const page=await browser.newPage({viewport:{width,height:900}});
    const errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(base+'/index.html?route=DTW,APN,DTW&auto=1&date=2026-12-09',{waitUntil:'domcontentloaded'});
    await page.locator('#trip .stop').first().waitFor({state:'visible'});
    // An imported route can contain an automatic connector, but Start over
    // must remove all auto-connector indices before a new itinerary is built.
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('#clear').click();
    assert.equal(await page.locator('#trip .stop').count(),0,'Start over clears stops');
    assert(await page.locator('#showEntireTrip').isDisabled(),'Full-trip map control disabled for empty trip');
    await page.locator('#airportSearch').fill('DTW');
    await page.locator('#airportFinder button[type=submit]').click();
    await page.locator('#airportSearch').fill('APN');
    await page.locator('#airportFinder button[type=submit]').click();
    await page.locator('#trip .stop').first().waitFor({state:'visible'});
    const stops=await page.locator('#trip .stop').allTextContents();
    assert(stops.some(t=>/Alpena|APN/.test(t)),'Fresh trip contains selected destination');
    const apn=page.locator('#trip .stop').filter({hasText:'APN'}).last();
    assert(!(await apn.getAttribute('class')).includes('auto-inserted'),'Old auto-connector flag cannot leak into new trip');
    assert(await page.locator('#showEntireTrip').isEnabled(),'Show entire trip becomes available');
    await page.locator('#showEntireTrip').click();
    await page.goto(base+'/itinerary.html?route=DTW,APN,DTW&date=2026-12-09',{waitUntil:'domcontentloaded'});
    if(width<=860)await page.locator('#startDateButton').click();
    await page.locator('#calendarScope').waitFor({state:'visible'});
    const scope=await page.locator('#calendarScope').innerText();
    assert.match(scope,/DTW.*APN.*first flight leg/i,'Calendar labels its exact first leg');
    assert.match(scope,/Later flight legs.*not verified/i,'Calendar cannot imply downstream availability');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    assert(overflow<=2,'No horizontal viewport overflow at '+width+': '+overflow);
    assert.deepEqual(errors,[],'No JS page errors at width '+width);
    await page.close();
  }
  console.log('PASS: trip reset, map framing, first-leg calendar scope and responsive bounds');
} finally { await browser.close(); }
