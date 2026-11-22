import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=(process.env.E2E_BASE_URL||'https://deploy-preview-8--nextownair-site.netlify.app').replace(/\/$/,'');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome'});
try{
 const page=await browser.newPage({viewport:{width:1350,height:1000}});
 const jsErrors=[];page.on('pageerror',e=>jsErrors.push(String(e)));
 await page.route('**/api/flights?**',route=>{
  const u=new URL(route.request().url());
  const origin=u.searchParams.get('origin'),destination=u.searchParams.get('destination'),date=u.searchParams.get('date');
  const data={contractVersion:'nta-flights-v1',sourceProvider:'duffel',checkedAt:new Date().toISOString(),origin,destination,departureDate:date,offers:[]};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(base+'/itinerary.html?route=LEB%2CBOS&date=2026-12-13',{waitUntil:'domcontentloaded',timeout:60000});
 const evidence=page.locator('.leg .flight-evidence.scheduled').first();
 await evidence.waitFor({state:'visible',timeout:30000});
 assert.match(await evidence.innerText(),/Published flight.*fare not confirmed/);
 const fare=page.locator('.leg .live-fare').first();
 await fare.waitFor({state:'visible',timeout:30000});
 await page.waitForFunction(()=>document.querySelector('.leg .live-fare')?.textContent.includes('No verified fare'),null,{timeout:30000});
 assert.match(await fare.innerText(),/No verified fare/);
 assert.doesNotMatch(await fare.innerText(),/Prototype fare/,'Prototype estimate must not replace confirmed fare field');
 const legend=await page.locator('#calendarKey').innerText();
 assert.match(legend,/Live offer \+ verified fare/);
 assert.match(legend,/Published schedule only/);
 assert.match(legend,/Provider fare unavailable/);
 const cell=page.locator('.calendar-day[data-calendar-date="2026-12-13"]');
 await cell.waitFor({state:'attached',timeout:30000});
 assert.equal(await cell.evaluate(e=>e.classList.contains('scheduled-only')),true,'Published-only date must not use live styling');
 assert.match(await cell.innerText(),/schedule only|no live fare/i);
 assert.match((await cell.getAttribute('aria-label'))||'',/Published flight/);
 assert.deepEqual(jsErrors,[],'No browser JS errors');
 console.log('PASS browser preview: published Cape Air schedule vs mocked no-offer fare, calendar evidence, ARIA and legend');
}finally{await browser.close();}
