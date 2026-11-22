import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
const base=(process.env.E2E_BASE_URL||'https://deploy-preview-18--nextownair-site.netlify.app').replace(/\/$/,'');
fs.mkdirSync('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome'});
try{
  for(const width of [390,768,1512]){
    const context=await browser.newContext({viewport:{width,height:1000}});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(String(e)));
    await page.route('**/api/flights?**',route=>route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify({contractVersion:'nta-flights-v1',sourceProvider:'duffel',liveMode:true,offers:[],checkedAt:new Date().toISOString()})
    }));
    const response=await page.goto(base+'/itinerary.html?route=CKB,IAD,RDU,IAD,CKB&date=2026-11-22',{waitUntil:'domcontentloaded',timeout:60000});
    assert(response&&response.status()<400,'Itinerary HTTP error at '+width);
    await page.locator('#content .leg').first().waitFor({state:'visible',timeout:30000});
    await page.waitForTimeout(1000);
    assert(await page.locator('#startDateCalendar').isHidden(),'Calendar must start closed at '+width);
    const initial=await page.evaluate(()=>({
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      firstLegTop:Math.round(document.querySelector('#content .leg').getBoundingClientRect().top),
      firstLegHeight:Math.round(document.querySelector('#content .leg').getBoundingClientRect().height),
      sidebarWidth:Math.round(document.querySelector('.start-date-field').getBoundingClientRect().width),
      noChoices:document.querySelectorAll('.leg-no-options').length,
      route:document.querySelector('#routebar')?.textContent||''
    }));
    assert(initial.overflow<=2,'Horizontal overflow at '+width+'px: '+initial.overflow);
    assert(/Clarksburg|CKB/.test(initial.route)&&/Dulles|IAD/.test(initial.route),'Requested route should render');
    assert(initial.firstLegTop<550,'Traveler should see Leg 1 without scrolling past the calendar at '+width+': '+initial.firstLegTop);
    if(width>860)assert(initial.sidebarWidth<=330,'Desktop sidebar consumes excessive space: '+initial.sidebarWidth);
    await page.locator('#startDateButton').click();
    assert(await page.locator('#startDateCalendar').isVisible(),'Click should open calendar at '+width);
    const expanded=await page.locator('#content .leg').first().evaluate(el=>Math.round(el.getBoundingClientRect().top));
    assert(Math.abs(expanded-initial.firstLegTop)<=4,'Calendar should overlay rather than push itinerary down: '+expanded+' vs '+initial.firstLegTop);
    await page.locator('#calendarClose').click();
    assert(await page.locator('#startDateCalendar').isHidden(),'In-calendar close must work at '+width);
    await page.locator('.trip-actions summary').click();
    assert(await page.locator('#shareTrip').isVisible(),'Share action must be available from menu');
    assert(await page.locator('#printTrip').isVisible(),'Print action must be available from menu');
    await page.locator('.trip-actions summary').click();
    await page.locator('.data-guide summary').click();
    assert(await page.locator('.prototype-legend').isVisible(),'Prototype caveat stays accessible');
    await page.locator('.data-guide summary').click();
    if(initial.noChoices){
      const first=page.locator('.leg-no-options').first();
      const fare=first.locator('.live-fare');
      await fare.waitFor({state:'visible'});
      assert.equal(await fare.locator('.live-fare-value').innerText(),'No verified fare');
      assert.equal(await fare.locator('a').count(),0,'Main fare status must not duplicate booking link');
      const recovery=first.locator('.no-flights');
      await recovery.waitFor({state:'visible'});
      assert.equal(await recovery.locator('a[data-external-first-fares]').count(),1);
      const widths=await first.evaluate(el=>{
        const box=el.querySelector('.options'),notice=el.querySelector('.no-flights');
        return {box:box.getBoundingClientRect().width,notice:notice.getBoundingClientRect().width};
      });
      assert(Math.abs(widths.notice-widths.box)<10,'Recovery actions should use full available card width');
    }
    await page.screenshot({path:'artifacts/itinerary-density-'+width+'.png',fullPage:true});
    assert.deepEqual(errors,[],'Browser errors at '+width);
    console.log('PASS CKB screenshot route '+width+' '+JSON.stringify(initial));
    await context.close();
  }
}finally{await browser.close();}
