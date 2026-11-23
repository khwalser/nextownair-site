import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
const base=(process.env.E2E_BASE_URL||'https://deploy-preview-21--nextownair-site.netlify.app').replace(/\/$/,'');
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome'});
fs.mkdirSync('artifacts',{recursive:true});
try{
 for(const width of [390,1366]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/api/flights?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({contractVersion:'nta-flights-v1',sourceProvider:'duffel',liveMode:true,offers:[],checkedAt:new Date().toISOString()})}));
  const map=await page.goto(base+'/index.html',{waitUntil:'domcontentloaded',timeout:60000});assert(map&&map.status()<400);
  await page.locator('#map').waitFor({state:'visible',timeout:25000});
  const region=page.locator('#mapRegionSelect');
  if(width<=720){
   await region.selectOption('alaska');
  }else{
   await page.locator('[data-region="alaska"]').click();
  }
  await page.waitForFunction(()=>/hub flight links/.test(document.querySelector('#regionStatus')?.textContent||''),null,{timeout:30000});
  const alaska=await page.locator('#regionStatus').innerText();
  if(width<=720)await region.selectOption('hawaii');
  else await page.locator('[data-region="hawaii"]').click();
  await page.waitForFunction(()=>/hub flight links/.test(document.querySelector('#regionStatus')?.textContent||''),null,{timeout:12000});
  const hawaii=await page.locator('#regionStatus').innerText();
  assert(!/0 hub flight links/.test(alaska+hawaii));
  await page.screenshot({path:'artifacts/ak-hi-map-'+width+'.png',fullPage:false});
  for(const [route,date,expected] of [['OGG,KOA','2026-12-07','Kona'],['ANC,FAI','2026-12-07','Fairbanks']]){
   const response=await page.goto(base+'/itinerary.html?route='+route+'&date='+date,{waitUntil:'domcontentloaded',timeout:60000});assert(response&&response.status()<400);
   await page.locator('#content .leg').first().waitFor({state:'visible',timeout:25000});
   const heading=await page.locator('#content .leg').first().innerText();
   assert(heading.includes(expected),'Expected destination '+expected+' for '+route);
   assert(!heading.includes('No verified route is available'),'Known region route must be present');
   const options=page.locator('#flight-options-0 .flight');
   await options.first().waitFor({state:'visible',timeout:25000});
   const offer=await options.first().innerText();
   assert(/[?]/.test(offer),'Published recurring service must use clearly tentative time/fare when not provider-verified');
   assert(!/Live flight and fare available/.test(heading),'No fabricated live quote');
  }
  const beyond=await page.goto(base+'/itinerary.html?route=OGG,KOA&date=2027-02-01',{waitUntil:'domcontentloaded',timeout:60000});assert(beyond&&beyond.status()<400);
  await page.locator('#content .leg').first().waitFor({state:'visible'});
  assert.equal(await page.locator('#flight-options-0 .flight').count(),0,'Expired recurring pattern cannot create future flights');
  assert.deepEqual(errors,[]);
  console.log('PASS regional map '+width+' Alaska: '+alaska+' Hawaii: '+hawaii+' published routes and expired evidence');
  await page.close();
 }
}finally{await browser.close();}
