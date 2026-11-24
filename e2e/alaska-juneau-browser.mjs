import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base='https://deploy-preview-24--nextownair-site.netlify.app';
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome'});
try{
 for(const [route,date,expectedFlight,expectedNoFlight] of [
  ['JNU,AGN','2026-11-25','J5 107',false],
  ['GST,JNU','2026-11-29','J5 304',false],
  ['JNU,PEC','2026-11-29','',true],
  ['JNU,PEC','2026-11-30','',true],
  ['ELV,JNU','2026-12-04','',true]
 ]){
  const p=await browser.newPage({viewport:{width:390,height:840}});
  const errs=[];p.on('pageerror',e=>errs.push(String(e)));
  await p.route('**/api/flights?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({sourceProvider:'duffel',liveMode:true,offers:[],checkedAt:new Date().toISOString()})}));
  const r=await p.goto(base+'/itinerary.html?route='+route+'&date='+date,{waitUntil:'domcontentloaded',timeout:45000});
  assert.equal(r?.status(),200);
  await p.locator('.leg').first().waitFor({state:'visible',timeout:25000});
  if(expectedFlight){
   const opt=p.locator('#flight-options-0 .flight');
   await opt.first().waitFor({state:'visible',timeout:25000});
   const text=await opt.first().innerText();
   assert(text.includes(expectedFlight),'Published flight not rendered for '+route+' '+text);
   assert(/Published flight/.test(text),'Published-only evidence missing');
   assert(!/Live flight and fare available/.test(await p.locator('.leg').first().innerText()),'No invented live price');
  }else{
   await p.waitForTimeout(1100);
   assert.equal(await p.locator('#flight-options-0 .flight').count(),0,'No invented flight on unsupported dates '+route+' '+date);
   const carrier=await p.locator('#flight-options-0 [data-external-first-fares]').innerText();
   assert(carrier.includes('Alaska Seaplanes'),'Route-only carrier booking link absent: '+carrier);
  }
  const overflow=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert(overflow<=2,'Mobile overflow');
  assert.deepEqual(errs,[]);
  console.log('PASS Alaska browser '+route+' '+date);
  await p.close();
 }
}finally{await browser.close();}
