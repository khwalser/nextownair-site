import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=(process.env.E2E_BASE_URL||'https://nextownair.com').replace(/\/$/,'');
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome'});
try{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.route('**/api/flights?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({sourceProvider:'duffel',liveMode:true,offers:[],checkedAt:new Date().toISOString()})}));
  async function navigate(url,selector){
    let last;
    for(let attempt=1;attempt<=2;attempt++){
      try{
        const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
        assert(response&&response.status()<500,'Server error: '+response?.status());
        await page.locator(selector).waitFor({state:'visible',timeout:15000});
        return {attempt,status:response.status()};
      }catch(e){last=e; console.log('NAVIGATION RETRY '+attempt+' '+e.message);}
    }
    throw last;
  }
  const first=await navigate(base+'/index.html?route=DTW,ROC,DTW&date=2026-12-09','#trip');
  const mapOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert(mapOverflow<=2,'Map mobile overflow '+mapOverflow);
  const second=await navigate(base+'/itinerary.html?route=DTW,ROC,DTW&date=2026-12-09','.nav');
  const itineraryOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert(itineraryOverflow<=2,'Itinerary mobile overflow '+itineraryOverflow);
  assert.deepEqual(errors,[],'No uncaught browser errors');
  console.log('PASS MOBILE PRODUCTION map '+JSON.stringify(first)+' itinerary '+JSON.stringify(second));
} finally{await browser.close();}
