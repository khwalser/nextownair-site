import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';

const base=(process.env.E2E_BASE_URL||'https://deploy-preview-16--nextownair-site.netlify.app').replace(/\/$/,'');
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome'});
fs.mkdirSync('artifacts',{recursive:true});
try{
 for(const width of [390,768,1366]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  const mapResp=await page.goto(base+'/index.html',{waitUntil:'domcontentloaded',timeout:60000});
  assert(mapResp&&mapResp.status()<400,'Map response should be available');
  await page.locator('#map').waitFor({state:'visible',timeout:30000});
  const mapLayout=await page.evaluate(()=>({
   overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
   mapHeight:Math.round(document.querySelector('#map').getBoundingClientRect().height),
   titleSize:parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
   selectsVisible:getComputedStyle(document.querySelector('#mapRegionSelect')).display!=='none',
   easCollapsed:!document.querySelector('.eas-explainer').open
  }));
  assert(mapLayout.overflow<=2,'Map has horizontal overflow at '+width+': '+mapLayout.overflow);
  assert(mapLayout.mapHeight<=600,'Map too tall at '+width+': '+mapLayout.mapHeight);
  assert(mapLayout.titleSize<=40,'Oversized headline at '+width+': '+mapLayout.titleSize);
  assert(mapLayout.easCollapsed,'EAS explanatory text should start collapsed');
  if(width<=720){
   assert(mapLayout.selectsVisible,'Mobile map controls should use selects');
   await page.waitForFunction(()=>document.querySelector('#regionStatus')?.textContent?.includes('Showing'),null,{timeout:30000});
   await page.selectOption('#mapFilterSelect','alaska');
   await page.waitForFunction(()=>document.querySelector('#regionStatus')?.textContent?.includes('Alaska'),null,{timeout:10000});
   await page.selectOption('#mapRegionSelect','michigan');
   assert.equal(await page.locator('#mapRegionSelect').inputValue(),'michigan');
   await page.locator('.eas-explainer summary').click();
   assert(await page.locator('.eas-explainer').evaluate(e=>e.open),'EAS details should expand');
  } else {
   assert(!mapLayout.selectsVisible,'Desktop keeps direct map region buttons');
  }
  await page.screenshot({path:'artifacts/compact-map-'+width+'.png',fullPage:true});
  const itinResp=await page.goto(base+'/itinerary.html?route=DTW,APN,DTW&date=2026-12-09',{waitUntil:'domcontentloaded',timeout:60000});
  assert(itinResp&&itinResp.status()<400,'Itinerary response should be available');
  await page.locator('.leg').first().waitFor({state:'visible',timeout:30000});
  if(width<=860){
   assert(await page.locator('#startDateCalendar').isHidden(),'Calendar should start collapsed on phone and tablet');
   await page.locator('#startDateButton').click();
   assert(await page.locator('#startDateCalendar').isVisible(),'Calendar must open on user request');
   await page.locator('#startDateButton').click();
   assert(await page.locator('#startDateCalendar').isHidden(),'Calendar must close on user request');
  }else{
   assert(await page.locator('#startDateCalendar').isVisible(),'Desktop calendar remains available at a glance');
  }
  const itinerary=await page.evaluate(()=>({
   overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
   sidebarWidth:Math.round(document.querySelector('.itinerary-sidebar').getBoundingClientRect().width),
   headingSize:parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
   legCount:document.querySelectorAll('.leg').length,
   mainTop:Math.round(document.querySelector('.itinerary-main').getBoundingClientRect().top),
   savedTop:Math.round(document.querySelector('.itinerary-sidebar>.notice').getBoundingClientRect().top)
  }));
  assert(itinerary.overflow<=2,'Itinerary has horizontal overflow at '+width+': '+itinerary.overflow);
  assert(itinerary.legCount>=2,'Itinerary must show both flight legs');
  if(width>=1051)assert(itinerary.sidebarWidth<=400,'Desktop sidebar should be compact');
  if(width<=860)assert(itinerary.savedTop>itinerary.mainTop,'Saved trips and explanatory notice should follow itinerary cards on narrow screens');
  if(width<=720)assert(itinerary.headingSize<=30,'Mobile heading oversized');
  await page.screenshot({path:'artifacts/compact-itinerary-'+width+'.png',fullPage:true});
  console.log('PASS '+width+' map '+JSON.stringify(mapLayout)+' itinerary '+JSON.stringify(itinerary));
  assert.deepEqual(errors,[],'No JavaScript page errors at '+width);
  await page.close();
 }
}finally{await browser.close();}
