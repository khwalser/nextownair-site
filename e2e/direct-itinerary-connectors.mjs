import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base=(process.env.E2E_BASE_URL||'https://nextownair.com').replace(/\/$/,'');
const date=new Date(Date.now()+15*86400000).toISOString().slice(0,10);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome'});
try{
  const context=await browser.newContext({timezoneId:'America/Detroit'});
  await context.addInitScript(()=>{
    localStorage.setItem('nextownair.trip.v1',JSON.stringify({
      version:2,route:['ABR','BJI'],autoConnectorIndices:[],autoConnectors:[],
      startDate:'2026-12-10',stays:{'1':{mode:'nights',nights:3}},selections:{'0':'stale-offer'}
    }));
  });
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(base+'/itinerary.html?route=ABR%2CBJI&date='+date,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.NTA&&window.NTA.load().route.length>=3,null,{timeout:15000});
  const state=await page.evaluate(()=>{
    const s=window.NTA.load();
    return {route:s.route,automatic:s.autoConnectorIndices,stays:s.stays,
      selections:s.selections,expected:window.NTA.findTravelPath('ABR','BJI'),
      allLegsConnected:s.route.slice(1).every((to,i)=>window.NTA.hasTravelLink(s.route[i],to)),
      date:s.startDate};
  });
  assert(state.expected?.length>=3,'Known Aberdeen to Bemidji trip must require a connector');
  assert.equal(state.route.join(','),state.expected.join(','),'Direct itinerary deep link inserts verified connector path');
  assert.equal(state.route[0],'ABR');
  assert.equal(state.route.at(-1),'BJI');
  assert.equal(state.automatic.includes(1),true,'Inserted intermediate stop marked automatic');
  assert.equal(state.allLegsConnected,true,'All constructed flight/transfer legs exist in verified graph');
  assert.equal(state.stays['2']?.nights,3,'User-selected Bemidji stay retains its duration after connector insertion');
  assert.equal(Object.keys(state.selections).length,0,'Rewritten legs invalidate stale selected flight IDs');
  assert.equal(state.date,date,'Route repair preserves start date');
  assert.equal((await page.locator('#content .leg').count()),state.route.length-1,'Rendered itinerary reflects repaired route');
  assert.deepEqual(errors,[],'No uncaught browser errors');
  console.log('PASS: Direct itinerary URL inserts verified connector and preserves traveler intent');
  // MRI and ANC are separate airports: the connection must render as a
  // ground transfer and never become a fabricated scheduled flight.
  const transferPage=await context.newPage();
  const transferErrors=[];
  transferPage.on('pageerror',error=>transferErrors.push(String(error)));
  await transferPage.goto(base+'/itinerary.html?route=MCG%2CMRI%2CANC&date='+date,{waitUntil:'domcontentloaded',timeout:60000});
  await transferPage.waitForFunction(()=>window.NTA&&window.NTA.load().route.join(',')==='MCG,MRI,ANC',null,{timeout:15000});
  const transferEvidence=await transferPage.evaluate(()=>{
    const N=window.NTA,s=N.load();
    const edge=N.getTransferLink('MRI','ANC');
    return {route:s.route,transfer:edge,hasFlight:N.hasFlightLink('MRI','ANC'),
      hasTravelLink:N.hasTravelLink('MRI','ANC'),
      content:document.getElementById('content')?.textContent||''};
  });
  assert.equal(transferEvidence.hasTravelLink,true,'Merrill Field has modeled road access to ANC');
  assert.equal(transferEvidence.hasFlight,false,'MRI–ANC is never counted as a flight');
  assert.equal(transferEvidence.transfer?.mode,'ground','Airport-to-airport transfer retains ground mode');
  assert.match(transferEvidence.content,/transfer/i,'Itinerary visibly distinguishes airport transfer from flight');
  assert.match(transferEvidence.content,/Ground transfer/i,'MRI airport connection uses the road-only transfer heading');
  assert.doesNotMatch(transferEvidence.content,/Ground \+ airport ferry transfer/i,'MRI transfer never incorrectly mentions an airport ferry');
  assert.deepEqual(transferErrors,[],'MRI–ANC transfer itinerary has no uncaught errors');
  console.log('PASS: Merrill Field to Anchorage International renders as a ground transfer, not an invented flight');
  await context.close();
}finally{
  await browser.close();
}
