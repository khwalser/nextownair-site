import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.E2E_BASE_URL||'https://deploy-preview-22--nextownair-site.netlify.app';
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome'});
try{
 const cases=[
  {route:'HNM,OGG',flight:'8:55',name:'Mokulele'},
  {route:'MUE,OGG',flight:'7:17',name:'Mokulele'},
  {route:'OGG,MUE',flight:'6:00',name:'Mokulele'},
  {route:'LNY,HNL',tentative:true,name:'Mokulele'},
  {route:'DTW,SEA,ANC',name:'Delta Air Lines'},
  {route:'HNL,OGG,MUE',name:'Alaska Airlines'}
 ];
 for(const c of cases){
  const context=await browser.newContext({viewport:{width:1280,height:850}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/api/flights?**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    contractVersion:'nta-flights-v1',sourceProvider:'duffel',liveMode:true,offers:[],checkedAt:new Date().toISOString()
  })}));
  const response=await page.goto(base+'/itinerary.html?route='+encodeURIComponent(c.route)+'&date=2026-12-04',{waitUntil:'domcontentloaded',timeout:60000});
  assert.equal(response?.status(),200);
  await page.locator('#content .leg').first().waitFor({state:'visible',timeout:20000});
  const codes=c.route.split(','),routeText=await page.locator('#routebar').innerText();
  assert(routeText.includes(codes[0])&&routeText.includes(codes.at(-1)),'Route not rendered: '+c.route);
  if(c.flight||c.tentative){
    const flight=page.locator('#flight-options-0 .flight').first();
    await flight.waitFor({state:'visible',timeout:25000});
    const info=await flight.innerText();
    if(c.flight){
      assert(info.includes(c.flight),'Published departure missing '+c.route+' '+info);
      assert(/Published flight/i.test(info),'Should identify published schedule '+info);
    }else{
      assert(info.includes('?'),'Sampled service pattern must keep unverified time as estimated');
    }
    assert(!/Live flight and fare available/.test(await page.locator('.leg').first().innerText()),'No invented live fare');
  }else{
    const booking=page.locator('#flight-options-0 [data-external-first-fares]');
    await booking.waitFor({state:'visible',timeout:25000});
    assert((await booking.innerText()).includes(c.name),'Official carrier booking link missing '+c.route);
  }
  assert(await page.locator('#startDateCalendar').isHidden(),'Date calendar should start collapsed');
  assert.deepEqual(errors,[],'Browser errors '+c.route);
  console.log('PASS regional itinerary '+c.route);
  await context.close();
 }
}finally{await browser.close();}
