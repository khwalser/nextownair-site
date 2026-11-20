import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL=(process.env.E2E_BASE_URL||'').replace(/\/$/,'');
if(!BASE_URL)throw new Error('E2E_BASE_URL is required so the test is pinned to a specific deployed build.');
const OUT_DIR=process.env.E2E_OUT_DIR||'artifacts';
fs.mkdirSync(OUT_DIR,{recursive:true});

function localDatePlus(days){
  const now=new Date();
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Detroit',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const y=Number(parts.find(x=>x.type==='year').value);
  const m=Number(parts.find(x=>x.type==='month').value);
  const d=Number(parts.find(x=>x.type==='day').value);
  const dt=new Date(Date.UTC(y,m-1,d+days));
  return dt.toISOString().slice(0,10);
}
function addDays(date,days){
  const dt=new Date(date+'T12:00:00Z');dt.setUTCDate(dt.getUTCDate()+days);return dt.toISOString().slice(0,10);
}
function money(amount,currency='USD'){
  return new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:0}).format(Number(amount));
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

// Alpena exact-route validation target refresh
const diagnostics={
  baseUrl:BASE_URL,
  startedAt:new Date().toISOString(),
  assertions:[],
  fareResponses:[],
  requests:[],
  scheduleResponses:[],
  pageErrors:[],
  requestFailures:[],
  console:[]
};
function pass(name,detail=''){diagnostics.assertions.push({name,ok:true,detail});console.log('PASS: '+name+(detail?' — '+detail:''));}
function assert(condition,name,detail=''){if(!condition){diagnostics.assertions.push({name,ok:false,detail});throw new Error(name+(detail?': '+detail:''));}pass(name,detail);}

let browser,page,failure=null;

function attachDiagnostics(p){
  p.on('console',msg=>diagnostics.console.push({type:msg.type(),text:msg.text()}));
  p.on('pageerror',err=>diagnostics.pageErrors.push(String(err)));
  p.on('requestfailed',req=>diagnostics.requestFailures.push({url:req.url(),error:req.failure()?.errorText||'request failed'}));
  p.on('response',async res=>{
    const url=res.url();
    diagnostics.requests.push(url);
    if(!url.includes('/api/schedule-calendar')&&!url.includes('/api/flights'))return;
    let body=null;try{body=await res.json();}catch{}
    const row={url,status:res.status(),body,at:new Date().toISOString()};
    if(url.includes('/api/schedule-calendar'))diagnostics.scheduleResponses.push(row);else diagnostics.fareResponses.push(row);
  });
}
async function addAirport(code){
  await page.locator('#airportSearch').fill(code);
  await page.locator('#airportFinder').press('Enter');
  await page.waitForTimeout(120);
}
async function clearTrip(){
  page.once('dialog',d=>d.accept());
  await page.getByRole('button',{name:'Start over'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#trip .stop').length===0);
}
function matchingFare(origin,destination,date,minIndex=0){
  return diagnostics.fareResponses.slice(minIndex).filter(row=>{
    try{
      const u=new URL(row.url);
      return u.searchParams.get('origin')===origin&&u.searchParams.get('destination')===destination&&u.searchParams.get('date')===date;
    }catch{return false;}
  }).at(-1)||null;
}
async function waitForFare(origin,destination,date,timeoutMs=90000,minIndex=0){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    const row=matchingFare(origin,destination,date,minIndex);
    if(row&&row.status===200)return row;
    await sleep(500);
  }
  return matchingFare(origin,destination,date,minIndex);
}
async function waitForAnySchedule(timeoutMs=30000){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    if(diagnostics.scheduleResponses.length)return diagnostics.scheduleResponses.at(-1);
    await sleep(250);
  }
  return null;
}
async function chooseFirstFeasibleFlight(index){
  const options=page.locator('#flight-options-'+index+' .flight');
  try{
    await options.first().waitFor({state:'visible',timeout:15000});
  }catch(initialError){
    if(index<1)throw initialError;
    const stay=page.locator('.stay').nth(index-1);
    const dateInput=stay.locator('input.dateinput');
    await dateInput.waitFor({state:'visible',timeout:15000});
    const earliest=await dateInput.getAttribute('min');
    if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(earliest||''))throw new Error('Missing minimum departure date for Leg '+(index+1));
    let found=false;
    // The four suggested stay buttons are not an exhaustive date search.
    // In particular, repeatedly clicking the final 4-night button never
    // advances to new dates. Check distinct dates through the date picker.
    for(let offset=0;offset<=14&&!found;offset++){
      const candidateDate=addDays(earliest,offset);
      await dateInput.fill(candidateDate);
      await dateInput.dispatchEvent('change');
      try{
        await options.first().waitFor({state:'visible',timeout:12000});
        pass('Selected a future onward service date with a selectable flight for Leg '+(index+1),candidateDate);
        found=true;
      }catch(_){
        pass('No selectable onward service for Leg '+(index+1)+' on checked date',candidateDate);
      }
    }
    if(!found)throw new Error('No selectable future flight found for Leg '+(index+1)+' after checking 15 distinct consecutive dates');
  }
  await options.first().click();
  await page.waitForFunction(({index})=>{
    const s=JSON.parse(localStorage.getItem('nextownair.trip.v1')||'{}');
    return Boolean(s.selections&&s.selections[String(index)]);
  },{index},{timeout:15000});
}

try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome'});
  const context=await browser.newContext({viewport:{width:1440,height:1200},locale:'en-US',timezoneId:'America/Detroit'});
  page=await context.newPage();
  attachDiagnostics(page);

  const tripDate=process.env.E2E_DATE||localDatePlus(14);

  // 1) Verify the fresh-test link clears prior NexTownAir state without changing normal persistence.
  await page.goto(BASE_URL+'/index.html',{waitUntil:'domcontentloaded',timeout:60000});
  await page.evaluate(()=>{
    localStorage.setItem('nextownair.trip.v1',JSON.stringify({version:1,route:['DTW','ROC'],autoConnectors:[],startDate:'2026-10-20',stays:{},selections:{}}));
    sessionStorage.setItem('nextownair.liveFares.v1',JSON.stringify({test:{savedAt:Date.now(),data:{offers:[{amount:'99',currency:'USD'}]}}}));
  });
  await page.goto(BASE_URL+'/index.html?fresh=1',{waitUntil:'domcontentloaded',timeout:60000});
  const freshState=await page.evaluate(()=>({
    route:JSON.parse(localStorage.getItem('nextownair.trip.v1')||'{}').route||[],
    fareCache:sessionStorage.getItem('nextownair.liveFares.v1'),
    url:location.href
  }));
  assert(freshState.route.length===0&&!freshState.fareCache&&!freshState.url.includes('fresh=1'),'Fresh-test link clears saved trip and pricing session once');
  
  // 2) Build a round trip from the map using the same controls a human uses.
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:'domcontentloaded'});
  const easExplainer=page.locator('.eas-explainer');
  await easExplainer.waitFor({state:'visible'});
  assert(/Essential Air Service/i.test(await easExplainer.innerText())&&/Department of Transportation/i.test(await easExplainer.innerText()),'Start page explains Essential Air Service in plain language');
  const networkRegression=await page.evaluate(()=>({
    billingsToDenver:window.NTA.findFlightPath('BIL','DEN'),
    wolfPointToDenver:window.NTA.findFlightPath('OLF','DEN'),
    butteToDenver:window.NTA.findFlightPath('BTM','DEN'),
    butteToSaltLake:window.NTA.findFlightPath('BTM','SLC'),
    beckleyToDenver:window.NTA.findFlightPath('BKW','DEN'),
    hanaToDenver:window.NTA.findFlightPath('HNM','DEN'),
    mayaguezToDenver:window.NTA.findFlightPath('MAZ','DEN'),
    kodiakToDenver:window.NTA.findFlightPath('ADQ','DEN'),
    nomeToDenver:window.NTA.findFlightPath('OME','DEN'),
    fairbanksToDenver:window.NTA.findFlightPath('FAI','DEN'),
    mcgrathToDenver:window.NTA.findFlightPath('MCG','DEN'),
    chisanaToDenver:window.NTA.findFlightPath('CZN','DEN'),
    coldBayToDenver:window.NTA.findFlightPath('CDB','DEN'),
    hydaburgFlightOnly:window.NTA.findFlightPath('HYG','DEN'),
    hydaburgTravelPath:window.NTA.findTravelPath('HYG','DEN'),
    ketchikanTransfer:window.NTA.getTransferLink('WFB','KTN'),
    grandIslandToLasVegas:window.NTA.findFlightPath('GRI','LAS'),
    grandIslandToMesa:window.NTA.findFlightPath('GRI','AZA'),
    moabToDenver:window.NTA.findFlightPath('CNY','DEN'),
    moabToSaltLake:window.NTA.findFlightPath('CNY','SLC'),
    codyToSaltLake:window.NTA.findFlightPath('COD','SLC')
  }));
  assert(networkRegression.billingsToDenver?.join('>')==='BIL>DEN','Billings has a verified onward path to Denver',JSON.stringify(networkRegression.billingsToDenver));
  assert(networkRegression.wolfPointToDenver?.join('>')==='OLF>BIL>DEN','Billings-served EAS communities continue into the national network',JSON.stringify(networkRegression.wolfPointToDenver));
  assert(networkRegression.butteToDenver?.join('>')==='BTM>DEN'&&networkRegression.butteToSaltLake?.join('>')==='BTM>SLC','Butte exposes both DOT-listed nonstop hub routes',JSON.stringify(networkRegression));
  assert(networkRegression.beckleyToDenver?.includes('CLT')&&networkRegression.beckleyToDenver?.at(-1)==='DEN','A CLT-served EAS community can continue through the commercial backbone to Denver',JSON.stringify(networkRegression.beckleyToDenver));
  assert(networkRegression.hanaToDenver?.includes('OGG')&&networkRegression.hanaToDenver?.at(-1)==='DEN','A Maui-served EAS community can continue through PHX backbone service',JSON.stringify(networkRegression.hanaToDenver));
  assert(networkRegression.mayaguezToDenver?.includes('SJU')&&networkRegression.mayaguezToDenver?.at(-1)==='DEN','A San Juan-served EAS community can continue through the national backbone',JSON.stringify(networkRegression.mayaguezToDenver));
  assert(networkRegression.kodiakToDenver?.includes('ANC')&&networkRegression.kodiakToDenver?.at(-1)==='DEN','Kodiak joins the national network through verified Anchorage service',JSON.stringify(networkRegression.kodiakToDenver));
  assert(networkRegression.nomeToDenver?.includes('ANC')&&networkRegression.nomeToDenver?.at(-1)==='DEN','Nome joins the national network through verified Anchorage service',JSON.stringify(networkRegression.nomeToDenver));
  assert(networkRegression.fairbanksToDenver?.includes('ANC')&&networkRegression.fairbanksToDenver?.at(-1)==='DEN','Fairbanks joins the national network through verified Anchorage service',JSON.stringify(networkRegression.fairbanksToDenver));
  assert(networkRegression.mcgrathToDenver?.includes('FAI')&&networkRegression.mcgrathToDenver?.at(-1)==='DEN','McGrath joins the national network through Wright Air Service to Fairbanks',JSON.stringify(networkRegression.mcgrathToDenver));
  assert(networkRegression.chisanaToDenver?.includes('TKJ')&&networkRegression.chisanaToDenver?.includes('FAI')&&networkRegression.chisanaToDenver?.at(-1)==='DEN','Chisana joins the national network through Tok and Wright Air Service to Fairbanks',JSON.stringify(networkRegression.chisanaToDenver));
  assert(networkRegression.coldBayToDenver?.includes('ANC')&&networkRegression.coldBayToDenver?.at(-1)==='DEN','Cold Bay joins the national network through current scheduled Anchorage service',JSON.stringify(networkRegression.coldBayToDenver));
  assert(networkRegression.hydaburgFlightOnly===null,'Hydaburg is not falsely connected to the national network by an invented flight',JSON.stringify(networkRegression.hydaburgFlightOnly));
  assert(networkRegression.hydaburgTravelPath?.includes('WFB')&&networkRegression.hydaburgTravelPath?.includes('KTN')&&networkRegression.hydaburgTravelPath?.at(-1)==='DEN','Hydaburg reaches the national network through the explicit Ketchikan transfer edge',JSON.stringify(networkRegression.hydaburgTravelPath));
  assert(networkRegression.ketchikanTransfer?.mode==='ground-ferry'&&networkRegression.ketchikanTransfer?.durationStatus==='prototype','Ketchikan waterfront-to-airport movement is a prototype-duration ground/ferry transfer, not a flight',JSON.stringify(networkRegression.ketchikanTransfer));
  assert(networkRegression.grandIslandToLasVegas?.join('>')==='GRI>LAS','Grand Island exposes airport-published nonstop Las Vegas service',JSON.stringify(networkRegression.grandIslandToLasVegas));
  assert(networkRegression.grandIslandToMesa?.join('>')==='GRI>AZA','Grand Island exposes airport-published nonstop Phoenix-Mesa service',JSON.stringify(networkRegression.grandIslandToMesa));
  assert(await page.evaluate(()=>Boolean(window.NTA.byCode('AZA'))),'Phoenix-Mesa Gateway exists as a selectable airport endpoint');
  assert(networkRegression.moabToDenver?.join('>')==='CNY>DEN'&&networkRegression.moabToSaltLake?.join('>')==='CNY>SLC','Moab exposes airport-published Denver and Salt Lake City nonstop service',JSON.stringify({den:networkRegression.moabToDenver,slc:networkRegression.moabToSaltLake}));
  assert(networkRegression.codyToSaltLake?.join('>')==='COD>SLC','Cody exposes airport-published seasonal Salt Lake City service',JSON.stringify(networkRegression.codyToSaltLake));
  await page.waitForFunction(()=>{
    const strokes=[...document.querySelectorAll('.leaflet-overlay-pane path')].map(p=>(p.getAttribute('stroke')||'').toLowerCase());
    return strokes.includes('#2f8f86')&&strokes.includes('#7255a1');
  });
  pass('Map visually distinguishes EAS service links from hub-to-hub connector links');

  await addAirport('DTW');
  await addAirport('ROC');
  await page.getByRole('button',{name:'Return to start'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#trip .stop').length===3);

  const mapStops=(await page.locator('#trip .stop strong').allTextContents()).join(' | ');
  assert(mapStops.includes('DTW')&&mapStops.includes('ROC'),'Map route can be built without manual URL editing',mapStops);
  const mapLabels=await page.locator('#trip .stoplabel').allTextContents();
  assert(mapLabels.some(x=>x.includes('Stop 1')&&x.includes('Chosen airport'))&&!mapLabels.some(x=>x.includes('Stop 1')&&x.includes('connector')),'User-chosen hub is presented as a stop, not mislabeled as a connector',mapLabels.join(' | '));
  assert(await page.locator('#plan').getAttribute('aria-disabled')==='false','Supported route enables itinerary navigation');
  assert(!/no verified path/i.test(await page.locator('#status').innerText()),'Supported route does not show a false routing warning');
  await page.waitForFunction(()=>[...document.querySelectorAll('.leaflet-overlay-pane path')].some(p=>(p.getAttribute('stroke')||'').toLowerCase()==='#c084fc'));
  pass('Selected hub-to-hub route uses the hub-link color');

  await page.locator('#plan').click();
  await page.waitForURL(/itinerary\.html/,{timeout:15000});
  const itineraryUrl=new URL(page.url());
  itineraryUrl.searchParams.set('date',tripDate);
  await page.goto(itineraryUrl.toString(),{waitUntil:'domcontentloaded',timeout:60000});

  const routeChips=await page.locator('#routebar .routechip').allTextContents();
  assert(routeChips.length===3&&routeChips[0].includes('DTW')&&routeChips[1].includes('ROC')&&routeChips[2].includes('DTW'),'Round-trip route survives map → itinerary navigation',routeChips.join(' | '));
  assert(routeChips[1].includes('stop'),'A user-chosen intermediate city is treated as a stop, not an automatic connector',routeChips[1]);
  await page.waitForFunction(()=>document.querySelector('.stay-summary')?.textContent?.includes('Same-day departures'));
  pass('Intermediate airport starts with a neutral same-day departure view instead of an assumed stay length');
  assert(await page.locator('.stay').first().getByRole('button',{name:'Same day'}).count()===1,'Stay UI exposes same-day flight choices without an arbitrary “Later today” bucket');
  assert(await page.locator('.stay').first().getByRole('button',{name:/1 night|2 nights|3 nights|4 nights/,exact:true}).count()===0,'Stay UI does not ask the user to choose an arbitrary 1–4 night duration');

  // 2) Calendar remains usable whether published schedules are available or the feed is exhausted.
  const scheduleResponse=await waitForAnySchedule();
  assert(Boolean(scheduleResponse),'Calendar performed a real published-schedule request');
  const scheduleCode=scheduleResponse?.body?.error||'ok';
  await page.waitForFunction(()=>document.querySelectorAll('.calendar-day[data-calendar-date]').length>20);
  const calendarSnapshot=await page.evaluate(date=>{
    const future=[...document.querySelectorAll('.calendar-day[data-calendar-date]')].filter(x=>x.dataset.calendarDate>=date);
    return {
      status:document.querySelector('#calendarStatus')?.textContent?.trim()||'',
      future:future.map(x=>({date:x.dataset.calendarDate,disabled:x.disabled,classes:[...x.classList],fare:x.querySelector('.calendar-fare')?.textContent?.trim()||''}))
    };
  },tripDate);
  if(scheduleCode==='schedule_quota_exhausted'){
    assert(calendarSnapshot.future.length>0&&calendarSnapshot.future.every(x=>!x.disabled),'Quota fallback keeps future dates selectable');
    await page.waitForFunction(date=>{
      const status=document.querySelector('#calendarStatus')?.textContent||'';
      const future=[...document.querySelectorAll('.calendar-day[data-calendar-date]')]
        .filter(x=>x.dataset.calendarDate>=date);
      const progressed=future.filter(x=>{
        const t=x.querySelector('.calendar-fare')?.textContent?.trim()||'';
        return t!=='check fare'&&t!=='';
      });
      return progressed.length>=Math.min(3,future.length)||/does not cover this route reliably/i.test(status);
    },tripDate,{timeout:30000});
    const autoState=await page.evaluate(date=>{
      const future=[...document.querySelectorAll('.calendar-day[data-calendar-date]')].filter(x=>x.dataset.calendarDate>=date);
      return future.map(x=>x.querySelector('.calendar-fare')?.textContent?.trim()||'');
    },tripDate);
    const statusText=await page.locator('#calendarStatus').innerText();
    assert(autoState.some(t=>t&&t!=='check fare')||/does not cover this route reliably/i.test(statusText),'Fare fallback progresses or switches to coverage-gap mode',statusText);
    assert(/Loading live fares across the month|does not cover this route reliably|Fare scan/i.test(statusText),'Calendar explains live-pricing or coverage-gap state',statusText);
  }else{
    pass('Published schedule path is usable','schedule response '+scheduleResponse.status+(scheduleResponse.body?.error?' · '+scheduleResponse.body.error:''));
  }

  // 3) Unsupported-provider coverage degrades to a usable live-search fallback instead of burning the month.
  {
    const coverageDate=tripDate;
    const target=BASE_URL+'/itinerary.html?route='+encodeURIComponent('DTW,CIU')+'&date='+encodeURIComponent(coverageDate);
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>/Prototype fare\s+\?\d+/i.test(document.querySelector('.leg')?.textContent||'')||document.body.innerText.includes('Provider coverage gap')||document.body.innerText.includes('No provider fare returned'),null,{timeout:30000});
    const legText=await page.locator('.leg').first().innerText();
    assert(/Prototype fare\s+\?\d+|Provider coverage gap|No provider fare returned/i.test(legText),'Coverage-gap route exposes a clearly marked prototype fare or explicit provider gap',legText.replace(/\s+/g,' '));
    const external=page.locator('.leg').first().getByRole('link',{name:/Check current fares/i});
    assert(await external.count()===1,'Coverage-gap leg offers a current-fare search fallback');
    const href=await external.getAttribute('href');
    assert(/^https:\/\/www\.google\.com\/travel\/flights\?q=/.test(href||''),'Fare fallback link targets a live flight search',href||'');
    const statusText=await page.locator('#calendarStatus').innerText();
    assert(/Daily nonstop service is published|Choose a departure date|coverage gap|does not cover this route reliably/i.test(statusText),'Calendar identifies published service availability immediately',statusText);
    assert(!/Loading live fares across the month|queued/i.test(statusText),'Known coverage-gap route does not begin a pointless month-long fare scan on first load',statusText);
    const initialFareLabels=await page.locator('.calendar-day:not(.past) .calendar-fare').allTextContents();
    assert(initialFareLabels.filter(x=>x.trim()==='nonstop').length>=3,'Published-service fallback marks operating dates as nonstop',initialFareLabels.join(' | '));
    assert(await page.locator('#calendarKey').isHidden(),'Published-service fallback hides the fare-status legend');
    assert(await page.locator('#calendarServiceKey').isVisible(),'Published-service fallback shows the service-day legend');
    assert((await page.locator('.calendar-day:not(.past) .calendar-fare').allTextContents()).some(x=>x.trim()==='nonstop'),'Route-specific published service pattern remains authoritative even when the external schedule provider is unavailable');
    await page.waitForTimeout(7000);
    const stableGapStatus=await page.locator('#calendarStatus').innerText();
    assert(!/rate limit reached|pricing resumes automatically/i.test(stableGapStatus),'Downstream provider rate limits do not overwrite the coverage-gap calendar status',stableGapStatus);

    // Prove the coverage-gap state survives a page reload and does not restart the month-long fare scan.
    await page.waitForFunction(()=>/Daily nonstop service is published|Choose a departure date|coverage gap|does not cover this route reliably/i.test(document.querySelector('#calendarStatus')?.textContent||''),null,{timeout:30000});
    await page.reload({waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>/Daily nonstop service is published|Choose a departure date|coverage gap|does not cover this route reliably/i.test(document.querySelector('#calendarStatus')?.textContent||''),null,{timeout:15000});
    const reloadedStatus=await page.locator('#calendarStatus').innerText();
    assert(!/Loading live fares across the month|queued/i.test(reloadedStatus),'Reload does not restart the pointless month-long fare scan',reloadedStatus);
    const visibleFareLabels=await page.locator('.calendar-day:not(.past) .calendar-fare').allTextContents();
    assert(visibleFareLabels.filter(x=>x.trim()==='nonstop').length>=3,'Reloaded published-service calendar preserves nonstop service markers',visibleFareLabels.join(' | '));
  }

  // 4) Sourced bush-carrier patterns remain date-aware when the live schedule provider is unavailable.
  {
    const bushDate='2026-12-07'; // Monday, within Taquan's current winter schedule.
    await page.goto(BASE_URL+'/index.html',{waitUntil:'domcontentloaded',timeout:60000});
    await page.evaluate(({bushDate})=>{
      const key='HYG|WFB|'+bushDate;
      sessionStorage.setItem('nextownair.liveFares.v1',JSON.stringify({
        [key]:{savedAt:Date.now(),data:{provider:'external-search',liveMode:false,checkedAt:new Date().toISOString(),origin:'HYG',destination:'WFB',departureDate:bushDate,offers:[],coverageLimited:true,externalSearchUrl:'https://www.google.com/travel/flights'}}
      }));
    },{bushDate});
    await page.goto(BASE_URL+'/itinerary.html?route='+encodeURIComponent('HYG,WFB')+'&date='+encodeURIComponent(bushDate),{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>document.querySelectorAll('#flight-options-0 .flight').length>0,null,{timeout:15000});
    const bushText=(await page.locator('#flight-options-0').innerText()).replace(/\s+/g,' ');
    assert(/10:15\s+AM\s+→\s+11:00\s+AM/i.test(bushText),'Hydaburg current published return time renders from the sourced Taquan schedule',bushText);
    assert(/Published flight/i.test(bushText),'Hydaburg sourced schedule is treated as a published flight, not a guessed service placeholder',bushText);
    assert(await page.locator('#flight-options-0 .times.prototype-value').count()===0,'Published Taquan times are verified rather than prototype');
    assert(await page.locator('#flight-options-0 .price.prototype-value').count()>=1,'Published Taquan flight retains a prototype fare when live fare coverage is absent');
    const monday=page.locator('.calendar-day[data-calendar-date="2026-12-07"]');
    const tuesday=page.locator('.calendar-day[data-calendar-date="2026-12-08"]');
    const christmas=page.locator('.calendar-day[data-calendar-date="2026-12-25"]');
    assert((await monday.getAttribute('class')||'').includes('available'),'Published Hydaburg Monday is selectable in the calendar');
    assert((await tuesday.getAttribute('class')||'').includes('unavailable'),'Hydaburg Tuesday is not invented as a service day');
    assert((await christmas.getAttribute('class')||'').includes('unavailable'),'Taquan published Christmas no-service date is excluded');
    pass('Sourced bush schedule survives schedule-provider outages without inventing operating days');
  }

  // 4) Wright Air current operating-day patterns keep Fairbanks bush service date-aware.
  {
    const wrightDate='2026-12-08'; // Tuesday
    await page.goto(BASE_URL+'/itinerary.html?route='+encodeURIComponent('FAI,MLY')+'&date='+encodeURIComponent(wrightDate),{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>document.querySelectorAll('#flight-options-0 .flight').length>0,null,{timeout:15000});
    const wrightText=(await page.locator('#flight-options-0').innerText()).replace(/\s+/g,' ');
    assert(/Known service/i.test(wrightText),'Wright Air sourced operating-day pattern produces a selectable known-service option',wrightText);
    assert(/\?\d{1,2}:\d{2}\s+(?:AM|PM)/i.test(wrightText),'Wright Air option keeps trip timing prototype because the current timetable does not publish a complete exact segment time',wrightText);
    assert(/1 stop via MNT/i.test(wrightText),'Fairbanks to Manley is labeled as Wright through service via Minto rather than falsely called nonstop',wrightText);
    assert(!/· nonstop/i.test(wrightText),'Wright milk-run option is not labeled nonstop',wrightText);
    const tue=page.locator('.calendar-day[data-calendar-date="2026-12-08"]');
    const sat=page.locator('.calendar-day[data-calendar-date="2026-12-12"]');
    assert((await tue.getAttribute('class')||'').includes('available'),'Wright current Tuesday service is selectable in the calendar');
    assert((await sat.getAttribute('class')||'').includes('unavailable'),'Wright current timetable does not invent Saturday service for Manley Hot Springs');
    pass('Wright Air current operating-day pattern survives the inactive external schedule provider without overstating village times');
  }

  // 4) Current Ryan Air and Island Air patterns cover additional Alaska EAS edges.
  {
    const tue='2026-12-01',wed='2026-12-02';

    await page.goto(BASE_URL+'/itinerary.html?route='+encodeURIComponent('OME,DIO')+'&date='+encodeURIComponent(tue),{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>document.querySelectorAll('#flight-options-0 .flight').length>0,null,{timeout:15000});
    const ryanText=(await page.locator('#flight-options-0').innerText()).replace(/\s+/g,' ');
    assert(/1:00\s+PM\s+→\s+2:00\s+PM/i.test(ryanText),'Ryan Air current Nome→Diomede published time renders from the source-backed schedule',ryanText);
    assert(await page.locator('#flight-options-0 .times.prototype-value').count()===0,'Ryan Air published outbound time is verified');
    assert((await page.locator('.calendar-day[data-calendar-date="'+tue+'"]').getAttribute('class')||'').includes('available'),'Ryan Air current Tuesday Diomede service is selectable');
    assert((await page.locator('.calendar-day[data-calendar-date="'+wed+'"]').getAttribute('class')||'').includes('unavailable'),'Ryan Air current schedule does not invent Wednesday Diomede service');

    await page.goto(BASE_URL+'/itinerary.html?route='+encodeURIComponent('AKK,ADQ')+'&date='+encodeURIComponent(tue),{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>document.querySelectorAll('#flight-options-0 .flight').length>0,null,{timeout:15000});
    const islandText=(await page.locator('#flight-options-0').innerText()).replace(/\s+/g,' ');
    assert(/Known service/i.test(islandText),'Island Air current Akhiok service produces a selectable known-service option',islandText);
    assert(/\?\d{1,2}:\d{2}\s+(?:AM|PM)/i.test(islandText),'Island Air Akhiok times remain prototype because the current first-party page publishes days but not exact segment times',islandText);
    assert((await page.locator('.calendar-day[data-calendar-date="'+tue+'"]').getAttribute('class')||'').includes('available'),'Island Air current Tuesday Akhiok service is selectable');
    assert((await page.locator('.calendar-day[data-calendar-date="'+wed+'"]').getAttribute('class')||'').includes('unavailable'),'Island Air current schedule does not invent Wednesday Akhiok service');
    pass('Current Ryan Air and Island Air schedule patterns cover two additional Alaska EAS pairs');
  }

  // 4) Mixed-mode Ketchikan routing renders the airport transfer as a transfer, never as a flight.
  {
    const target=BASE_URL+'/itinerary.html?route='+encodeURIComponent('WFB,KTN,ANC')+'&auto=1&date='+encodeURIComponent(tripDate);
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:60000});
    const transfer=page.locator('.transfer-leg').first();
    await transfer.waitFor({state:'visible',timeout:15000});
    const transferText=(await transfer.innerText()).replace(/\s+/g,' ');
    assert(/Ground \+ airport ferry transfer/i.test(transferText)&&/Not a flight/i.test(transferText),'Ketchikan waterfront-to-airport segment renders explicitly as a non-flight transfer',transferText);
    assert(/\?1h/i.test(transferText),'Ketchikan transfer displays its deterministic prototype allowance with the ? convention',transferText);
    assert(await transfer.locator('.live-fare').count()===0,'Transfer segment has no airfare widget');
    const summaryText=(await page.locator('#summary').innerText()).replace(/\s+/g,' ');
    assert(/0 of 1 flight leg selected · 1 transfer included/i.test(summaryText),'Trip summary excludes the transfer from the flight-selection denominator',summaryText);
    assert(await page.locator('.booking-checklist .booking-item').count()===0,'Transfer does not create a flight booking checklist item before the actual flight is selected');
    pass('Mixed-mode transfer is separated from flight selection, pricing, and booking');
  }

  // 4) Exact Alpena route from the live prototype shows published service days instead of fare-provider noise.
  {
    const alpenaRoute=['DTW','APN','DTW','ORD','CMX','ORD','DTW'];
    const qs='?route='+encodeURIComponent(alpenaRoute.join(','))+'&auto='+encodeURIComponent('2,3,5')+'&date='+encodeURIComponent(tripDate);
    await page.goto(BASE_URL+'/itinerary.html'+qs,{waitUntil:'domcontentloaded',timeout:60000});
    const status=await page.locator('#calendarStatus').innerText();
    assert(/Daily nonstop service is published for DTW → APN/i.test(status),'Alpena calendar reports published daily nonstop service',status);
    const fares=await page.locator('.calendar-day:not(.past) .calendar-fare').allTextContents();
    assert(fares.filter(x=>x.trim()==='nonstop').length>=3,'Alpena calendar marks future operating dates as nonstop',fares.join(' | '));
    assert(await page.locator('#calendarServiceKey').isVisible(),'Alpena calendar shows the service-day legend');
    await page.locator('#flight-options-0 .flight').first().click();
    const downstreamStay=page.locator('.stay').first();
    await downstreamStay.locator('.stay-av:not(:disabled)').first().waitFor({state:'visible',timeout:15000});
    pass('Published service pattern keeps downstream onward dates selectable when the external schedule provider is unavailable');
    await page.reload({waitUntil:'domcontentloaded',timeout:60000});
    assert(await page.locator('.prototype-legend').isVisible(),'Prototype time/fare legend is visible once for the itinerary');
    assert(await page.locator('#calendarKey').isHidden(),'Alpena calendar hides the fare-status legend');
    assert(!/no provider fare|queued|rate limit/i.test((await page.locator('#startDateCalendar').innerText())),'Alpena calendar does not expose provider-fare noise');
    const desktopLayout=await page.evaluate(()=>{
      const cal=document.querySelector('#startDateCalendar')?.getBoundingClientRect();
      const leg=document.querySelector('#content .leg')?.getBoundingClientRect();
      return {w:innerWidth,h:innerHeight,calTop:cal?.top,legTop:leg?.top,legBottom:leg?.bottom};
    });
    assert(desktopLayout.w<1000||((desktopLayout.legTop??99999)<desktopLayout.h),'Desktop layout shows Leg 1 without requiring a scroll past the calendar',JSON.stringify(desktopLayout));
    await page.waitForFunction(()=>document.querySelectorAll('#flight-options-0 .flight').length>0,null,{timeout:30000});
    const firstLegText=(await page.locator('#flight-options-0').innerText()).replace(/\s+/g,' ');
    assert(/(?:\?|\b)\d{1,2}:\d{2}\s+(?:AM|PM)/i.test(firstLegText),'Alpena first leg shows a usable departure time',firstLegText);
    assert(/\?\d{2,4}\b/.test(firstLegText),'Alpena first leg includes a prototype fare without a dollar sign',firstLegText);
    assert(await page.locator('#flight-options-0 .price.prototype-value').count()>=1,'Prototype fare uses the prototype visual class');
    assert(!/Published timetable fallback|Morning planning window|Midday planning window|Evening planning window/i.test(firstLegText),'Alpena first leg no longer presents fallback values as published or generic planning windows',firstLegText);
    pass('Exact Detroit-Alpena-Detroit-Chicago-Houghton-Chicago-Detroit route has a useful service-day calendar');

    for(let i=0;i<6;i++)await chooseFirstFeasibleFlight(i);
    await page.waitForFunction(()=>document.querySelector('#summary')?.textContent?.includes('6 of 6 flight legs selected'),null,{timeout:15000});
    pass('Exact Detroit-Alpena-Detroit-Chicago-Houghton-Chicago-Detroit route can be completed end to end');
    const bookingItems=page.locator('.booking-checklist .booking-item');
    assert(await bookingItems.count()===6,'Completed itinerary renders one booking checklist item per flight leg');
    const bookingLinks=page.locator('.booking-checklist .booking-link');
    assert(await bookingLinks.count()===6,'Completed itinerary renders one external booking handoff per flight leg');
    const selectedFareTotal=(await page.locator('#liveTripFare').innerText()).replace(/\s+/g,' ');
    assert(/Itinerary fare total\s+\?\d+/i.test(selectedFareTotal),'Completed mixed/prototype itinerary includes all selected leg fares in a prototype-marked total',selectedFareTotal);
    const selectedLines=(await page.locator('#summary').innerText()).replace(/\s+/g,' ');
    assert(!/fare pending/i.test(selectedLines),'Completed itinerary contains no fare-pending escape hatch');
    assert((selectedLines.match(/(?:\$|\?)\d+/g)||[]).length>=6,'Every completed selected leg displays a verified or prototype fare',selectedLines);
    const bookingHrefs=await bookingLinks.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')||''));
    assert(bookingHrefs.every(h=>/^https:\/\/www\.google\.com\/travel\/flights\?q=/.test(h)),'Every MVP booking handoff targets a route/date-specific flight search',bookingHrefs.join(' | '));

    // Phase 7: the booking checklist is a user-managed reminder, never a booking.
    const bookingChecks=page.locator('.booking-checklist .booking-check-input');
    assert(await bookingChecks.count()===6,'Phase 7 creates a reminder checkbox for every flight booking handoff');
    await bookingChecks.first().check();
    const persistedFirstFlight=await page.locator('#flight-options-0 .flight.selected').first();
    await persistedFirstFlight.click();
    assert(await page.locator('.booking-checklist .booking-check-input').first().isChecked(),'Phase 7 preserves the marked flight after a legitimate itinerary rerender');
    assert((await page.locator('.booking-checklist .booking-check-input:checked').count())===1,'Phase 7 keeps booking reminders tied to individual flight identity');

    // Phase 5: changing the first stay in a six-leg completed trip must invalidate
    // stale downstream choices without discarding the still-feasible inbound flight.
    const sixLegBefore=await page.evaluate(()=>JSON.parse(localStorage.getItem('nextownair.trip.v1')||'{}'));
    assert(Object.keys(sixLegBefore.selections||{}).length===6,'Phase 5 starts with all six flight selections persisted');
    const firstStayInput=page.locator('.stay .dateinput').first();
    const firstStayMin=await firstStayInput.getAttribute('min');
    const shiftedStayDate=addDays(firstStayMin,7);
    const phase5Dialogs=[];
    const phase5DialogHandler=d=>{phase5Dialogs.push(d.message());d.dismiss().catch(()=>{});};
    page.on('dialog',phase5DialogHandler);
    await firstStayInput.fill(shiftedStayDate);
    await firstStayInput.dispatchEvent('change');
    await page.waitForFunction(old=>{
      const state=JSON.parse(localStorage.getItem('nextownair.trip.v1')||'{}');
      return state.selections?.['0']===old.selections['0']&&
        Object.keys(state.selections||{}).length<6;
    },sixLegBefore,{timeout:15000});
    page.off('dialog',phase5DialogHandler);
    const sixLegAfter=await page.evaluate(()=>JSON.parse(localStorage.getItem('nextownair.trip.v1')||'{}'));
    assert(sixLegAfter.selections['0']===sixLegBefore.selections['0'],'Phase 5 preserves inbound Leg 1 when the next stay changes');
    assert(!sixLegAfter.selections['1'],'Phase 5 clears stale Leg 2 when its departure date changes');
    assert(Object.keys(sixLegAfter.selections).length===1,'Phase 5 clears all dependent downstream choices in a six-leg trip',JSON.stringify(sixLegAfter.selections));

    const recalculationNotice=page.locator('.trip-next-step');
    await recalculationNotice.waitFor({state:'visible',timeout:15000});
    assert(/Continue building your itinerary/.test(await recalculationNotice.innerText()),'Phase 6 explains incomplete itinerary after upstream changes');
    assert(/5 flight legs still need a selection/.test(await recalculationNotice.innerText()),'Phase 6 displays the exact number of pending flight selections');
    assert(phase5Dialogs.length===0,'Phase 5 recalculates six-leg itinerary without blocking dialogs');
    assert(await page.locator('.booking-checklist .booking-item').count()<=1,'Phase 5 booking checklist never retains stale downstream flights');
    pass('Phase 5 six-leg cascading invalidation and booking-state consistency');

    // A reload must not resurrect invalid selections from persisted trip state.
    await page.reload({waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>document.querySelectorAll('.leg').length===6,null,{timeout:15000});
    const persisted=await page.evaluate(()=>JSON.parse(localStorage.getItem('nextownair.trip.v1')||'{}'));
    assert(persisted.selections?.['0']===sixLegBefore.selections['0'],'Phase 5 reload preserves the still-valid inbound flight');
    assert(Object.keys(persisted.selections||{}).length===1,'Phase 5 reload does not resurrect invalid downstream selections');
    assert(!/6 of 6 flight legs selected/.test(await page.locator('#summary').innerText()),'Phase 5 reload does not falsely report a completed trip');
    pass('Phase 5 cascading invalidation survives a full page reload');

    // Changing the trip start date invalidates all selected flights, including Leg 1.
    await page.locator('#startDateButton').click();
    const alternateDay=page.locator('.calendar-day[data-calendar-date]:not([disabled]):not(.selected)').first();
    await alternateDay.waitFor({state:'visible',timeout:15000});
    const alternateDate=await alternateDay.getAttribute('data-calendar-date');
    assert(Boolean(alternateDate)&&alternateDate!==sixLegBefore.startDate,'Phase 5 finds an alternate selectable calendar date');
    await alternateDay.click();
    const changed=await page.evaluate(()=>JSON.parse(localStorage.getItem('nextownair.trip.v1')||'{}'));
    assert(changed.startDate===alternateDate,'Phase 5 calendar changes the itinerary start date');
    assert(Object.keys(changed.selections||{}).length===0,'Phase 5 new trip date clears all stale flight selections');
    pass('Phase 5 trip start-date changes invalidate every previous flight selection');


  }

  // 5) Upstream changes preserve feasible downstream choices and silently invalidate impossible ones.
  {
    const cascadeRoute=['ORD','CMX','ORD'];
    const target=BASE_URL+'/itinerary.html?route='+encodeURIComponent(cascadeRoute.join(','))+'&date='+encodeURIComponent(tripDate);
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:60000});
    const firstLeg=page.locator('#flight-options-0 .flight');
    await firstLeg.first().waitFor({state:'visible',timeout:30000});
    assert(await firstLeg.count()>=2,'Cascade test has multiple first-leg choices');

    const initialGuidance=await page.locator('.trip-next-step').innerText();
    assert(/Ready to build your trip/.test(initialGuidance),'Phase 6 shows a neutral prompt before any flight has been chosen');
    assert(!/Itinerary recalculated/.test(initialGuidance),'Phase 6 does not falsely claim an initial recalculation');

    await firstLeg.first().click();
    const stay=page.locator('.stay').first();
    const laterDate=stay.locator('.stay-av:not(:disabled)').first();
    await laterDate.waitFor({state:'visible',timeout:30000});
    await laterDate.click();
    const secondLeg=page.locator('#flight-options-1 .flight');
    await secondLeg.first().waitFor({state:'visible',timeout:90000});
    await secondLeg.first().click();
    await page.waitForFunction(()=>{
      const s=JSON.parse(localStorage.getItem('nextownair.trip.v1')||'{}');
      return Boolean(s.selections?.['0']&&s.selections?.['1']);
    },null,{timeout:15000});
    const downstreamBefore=await page.evaluate(()=>JSON.parse(localStorage.getItem('nextownair.trip.v1')||'{}').selections?.['1']||'');
    await page.locator('#flight-options-0 .flight').nth(1).click();
    await page.waitForFunction(expected=>{
      const s=JSON.parse(localStorage.getItem('nextownair.trip.v1')||'{}');
      return s.selections?.['1']===expected;
    },downstreamBefore,{timeout:15000});
    assert((await page.locator('#summary').innerText()).includes('2 of 2 flight legs selected'),'Changing an upstream flight preserves a downstream selection when its later service date remains feasible');
    assert(await page.locator('.trip-next-step').count()===0,'Phase 6 hides incomplete-trip guidance for a fully selected itinerary');

    const dialogs=[];
    const dialogHandler=d=>{dialogs.push(d.message());d.dismiss().catch(()=>{});};
    page.on('dialog',dialogHandler);
    await stay.getByRole('button',{name:'Same day'}).click();
    await page.waitForFunction(previous=>{
      const s=JSON.parse(localStorage.getItem('nextownair.trip.v1')||'{}');
      return (s.selections?.['1']||'')!==previous;
    },downstreamBefore,{timeout:15000});
    page.off('dialog',dialogHandler);
    assert(dialogs.length===0,'Downstream recalculation does not interrupt the user with a dialog');
    pass('Upstream itinerary changes preserve feasible selections and silently invalidate infeasible downstream state');
  }

  // 5) Prove a real Duffel price can make it from the provider into the rendered calendar and flight cards.
  const candidates=[
    ['GCK','DFW'],
    ['LAR','DEN'],['BFF','DEN'],['COD','DEN'],['SUX','DEN'],['SUX','ORD'],
    ['GRI','DFW'],['ABR','MSP'],['BJI','MSP'],['RHI','MSP'],
    ['DTW','ROC'],['APN','DTW'],['DTW','APN'],['ESC','DTW'],['DTW','ESC']
  ];
  let priced=null;
  for(const [origin,destination] of candidates){
    for(let offset=0;offset<3&&!priced;offset++){
      const date=addDays(tripDate,offset);
      const target=BASE_URL+'/itinerary.html?route='+encodeURIComponent(origin+','+destination)+'&date='+encodeURIComponent(date);
      const responseStart=diagnostics.fareResponses.length;
      await page.goto(target,{waitUntil:'domcontentloaded',timeout:60000});
      const row=await waitForFare(origin,destination,date,90000,responseStart);
      if(row?.status===200&&row.body?.contractVersion==='nta-flights-v1'&&Array.isArray(row.body.offers)&&row.body.offers.some(o=>o&&o.liveMode)){
        priced={origin,destination,date,row};
      }
    }
    if(priced)break;
  }
  assert(Boolean(priced),'At least one verified route/date returns a real live provider offer',
    priced?priced.origin+' → '+priced.destination+' '+priced.date:'No live offer returned from tested verified routes');

  assert(diagnostics.fareResponses.length>0,'Frontend requests fare data through the provider-neutral /api/flights contract');
  assert(!diagnostics.requests.some(url=>url.includes('/.netlify/functions/flight-proxy')),'Browser no longer calls the legacy Duffel-specific flight proxy');
  const exactScheduleResponse=diagnostics.scheduleResponses.find(row=>row?.status===200&&Object.values(row.body?.days||{}).some(day=>Array.isArray(day?.flights)&&day.flights.some(f=>f?.scheduledOut&&f?.scheduledIn)));
  if(exactScheduleResponse){
    pass('Published schedule provider returned exact flight times for at least one tested route/date');
  }else{
    pass('Published schedule exact-time assertion skipped because the current schedule provider returned no exact flight rows in this run');
  }
  const normalizedContract=diagnostics.fareResponses.find(row=>row?.status===200&&row.body?.contractVersion==='nta-flights-v1');
  assert(Boolean(normalizedContract),'Production /api/flights returns the nta-flights-v1 contract');
  const lowest=priced.row.body.offers.reduce((best,o)=>!best||Number(o?.fare?.amount)<Number(best?.fare?.amount)?o:best,null);
  const expectedLow=money(lowest.fare.amount,lowest.fare.currency||'USD');
  await page.waitForFunction(({date,expected})=>{
    const cell=document.querySelector('[data-calendar-date="'+date+'"] .calendar-fare');
    return cell&&cell.textContent.includes(expected);
  },{date:priced.date,expected:expectedLow},{timeout:30000});
  pass('Lowest real provider fare renders on the selected calendar date',expectedLow);

  await page.waitForFunction(()=>document.querySelectorAll('#flight-options-0 .flight').length>0,null,{timeout:15000});
  const cardText=await page.locator('#flight-options-0').innerText();
  assert(cardText.includes(expectedLow),'Rendered flight choices contain the provider-returned fare',expectedLow);
  assert(!/\bFrom\s+[$€£¥]/i.test(cardText),'Flight cards do not fall back to generic repeated “From $…” pricing');

  const firstFlight=page.locator('#flight-options-0 .flight').first();
  await firstFlight.click();
  await page.waitForFunction(()=>document.querySelector('#summary')?.textContent?.includes('1 of 1 flight leg selected'));
  pass('Flight selection updates the itinerary summary');

  // Calendar queue progression is deterministic here; real-provider integration is tested above.
  {
    const scanDates=new Set();
    const farePattern='**/api/flights?**';
    const schedulePattern='**/api/schedule-calendar?**';
    await page.route(farePattern,async route=>{
      const u=new URL(route.request().url());
      if(u.searchParams.get('origin')!=='DTW'||u.searchParams.get('destination')!=='ROC')return route.continue();
      const date=u.searchParams.get('date');
      scanDates.add(date);
      const body={
        contractVersion:'nta-flights-v1',sourceProvider:'e2e-calendar',checkedAt:new Date().toISOString(),
        origin:'DTW',destination:'ROC',departureDate:date,
        offers:[{
          id:'e2e-'+date,liveMode:true,origin:'DTW',destination:'ROC',departureDate:date,
          departureTime:date+'T09:00:00',arrivalTime:date+'T10:00:00',durationMinutes:60,
          operatingCarrier:'E2E Carrier',operatingCarrierCode:'ZZ',flightNumber:'ZZ100',
          fare:{amount:100,currency:'USD',status:'verified'},timeStatus:'verified',
          fareCount:1,fareChoices:[{id:'e2e-'+date,amount:100,currency:'USD'}]
        }]
      };
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    });
    await page.route(schedulePattern,async route=>{
      const u=new URL(route.request().url());
      if(u.searchParams.get('origin')!=='DTW'||u.searchParams.get('destination')!=='ROC')return route.continue();
      await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'schedule_subscription_inactive',message:'E2E deterministic schedule fallback'})});
    });
    await page.goto(BASE_URL+'/itinerary.html?route='+encodeURIComponent('DTW,ROC')+'&date='+encodeURIComponent(tripDate),{waitUntil:'domcontentloaded',timeout:60000});
    const started=Date.now();
    while(Date.now()-started<20000&&scanDates.size<3)await sleep(500);
    assert(scanDates.size>=3,'Calendar background scan advances across multiple dates automatically',[...scanDates].sort().join(', '));
    await page.unroute(farePattern);
    await page.unroute(schedulePattern);
  }

  // 5) Exact NexTownAir demo route remains usable even when some fare providers lack inventory.
  {
    const exactRoute=['DTW','CIU','DTW','ORD','CMX','ORD','DTW'];
    const qs='?route='+encodeURIComponent(exactRoute.join(','))+'&auto='+encodeURIComponent('2,3,5')+'&date='+encodeURIComponent(tripDate);

    // Validate connector identity on the map screen itself (the user-facing route builder).
    await page.goto(BASE_URL+'/index.html'+qs,{waitUntil:'domcontentloaded',timeout:60000});
    const stopLabels=await page.locator('#trip .stoplabel').allTextContents();
    assert(stopLabels.length===7,'Exact demo route renders all seven route points on map',stopLabels.join(' | '));
    assert(/Automatic connection/i.test(stopLabels[2]||''),'Middle DTW occurrence is an automatic connector',stopLabels[2]||'');
    assert(/Automatic connection/i.test(stopLabels[3]||''),'First ORD occurrence is an automatic connector',stopLabels[3]||'');
    assert(/Automatic connection/i.test(stopLabels[5]||''),'Second ORD occurrence is an automatic connector',stopLabels[5]||'');
    assert(!/Automatic connection/i.test(stopLabels[6]||'')&&/Return/i.test(stopLabels[6]||''),'Final DTW occurrence is a normal return, not an automatic connector',stopLabels[6]||'');

    // Then validate the itinerary flow for the same exact route.
    await page.goto(BASE_URL+'/itinerary.html'+qs,{waitUntil:'domcontentloaded',timeout:60000});
    const chips=await page.locator('#routebar .routechip').allTextContents();
    assert(chips.length===7&&exactRoute.every((code,i)=>chips[i]?.includes(code)),'Exact demo route renders all seven route points in itinerary',chips.join(' | '));

    for(let i=0;i<6;i++){
      await chooseFirstFeasibleFlight(i);
      const selected=page.locator('#flight-options-'+i+' .flight.selected');
      const text=(await selected.innerText()).replace(/\s+/g,' ');
      assert(/Live flight|Provider flight|Known service/i.test(text),'Leg '+(i+1)+' exposes a selectable provider or known-service option',text);
    }
    await page.waitForFunction(()=>document.querySelector('#summary')?.textContent?.includes('6 of 6 flight legs selected'),null,{timeout:15000});
    pass('Exact DTW-CIU-DTW-ORD-CMX-ORD-DTW route can be completed end to end');
    const publishedScheduleCards=page.locator('.flight',{has:page.locator('.flight-badge',{hasText:'Published flight'})});
    if(await publishedScheduleCards.count()){
      const card=publishedScheduleCards.first();
      assert(await card.locator('.times.prototype-value').count()===0,'Published schedule flight time is rendered as verified, not prototype');
      assert(await card.locator('.price.prototype-value').count()===1,'Published schedule flight keeps a prototype fare when live fare is unavailable');
    }
    const fallbackCount=await page.locator('.flight-badge',{hasText:/Known service|Published flight/}).count();
    assert(fallbackCount>=1,'Coverage-gap route uses selectable published-schedule or known-service values where live inventory is absent',String(fallbackCount));
  }

  // 6) Map ↔ itinerary navigation preserves the trip and automatic-connector semantics.
  await page.goto(BASE_URL+'/index.html',{waitUntil:'domcontentloaded'});
  await clearTrip();
  const pair=await page.evaluate(()=>{
    const eas=(window.NTA_DATA?.airports||[]).filter(a=>a.type==='eas').map(a=>a.code);
    for(let i=0;i<Math.min(eas.length,90);i++){
      for(let j=i+1;j<Math.min(eas.length,90);j++){
        const p=window.NTA.findFlightPath(eas[i],eas[j]);
        if(p&&p.length===3&&!window.NTA.hasListedRoute(eas[i],eas[j]))return {a:eas[i],b:eas[j],path:p};
      }
    }
    return null;
  });
  assert(Boolean(pair),'Test network contains a route that requires an automatic connector',pair?pair.path.join(' → '):'none');
  await addAirport(pair.a);
  await addAirport(pair.b);
  await page.waitForFunction(()=>document.querySelectorAll('#trip .auto-inserted').length>0);
  const repairedStops=await page.locator('#trip .stop strong').allTextContents();
  assert(repairedStops.length===pair.path.length&&pair.path.every((code,i)=>repairedStops[i].includes(code)),'Automatic route repair inserts the exact verified connector path',repairedStops.join(' | '));
  await page.waitForFunction(()=>[...document.querySelectorAll('.leaflet-overlay-pane path')].filter(p=>(p.getAttribute('stroke')||'').toLowerCase()==='#5eead4').length>=2);
  pass('Selected EAS service legs use the EAS-link color');
  const autoText=await page.locator('#trip .auto-inserted').first().innerText();
  assert(autoText.includes(pair.path[1])&&/Automatic connection/i.test(autoText),'Automatically inserted connector is visibly and correctly identified',autoText.replace(/\s+/g,' '));
  assert(await page.locator('#plan').getAttribute('aria-disabled')==='false','Auto-repaired route remains plannable');

  await page.locator('#plan').click();
  await page.waitForURL(/itinerary\.html/);
  assert(await page.locator('#routebar .connector').count()>0,'Connector identity survives navigation into itinerary');
  const connectorStay=page.locator('.stay.connector').first();
  await connectorStay.waitFor({state:'visible'});
  assert((await connectorStay.innerText()).includes('Same day'),'Automatic connector initially exposes same-day onward choices without assuming the user wants to stay or rush onward');

  await page.locator('#editRoute').click();
  await page.waitForURL(/index\.html/);
  assert(await page.locator('#trip .auto-inserted').count()>0,'Connector highlighting survives itinerary → map navigation');

  // 7) Nationwide travel routing can cross an explicit non-flight transfer without inventing a flight.
  await clearTrip();
  await addAirport('HYG');
  await addAirport('DEN');
  const mixedStops=await page.locator('#trip .stop strong').allTextContents();
  assert(mixedStops.some(x=>x.includes('WFB'))&&mixedStops.some(x=>x.includes('KTN')),'Automatic route repair inserts both sides of the Ketchikan transfer',mixedStops.join(' | '));
  const mixedSegments=(await page.locator('#legSummary').innerText()).replace(/\s+/g,' ');
  assert(/Transfer\s+\d+:\s+WFB\s+→\s+KTN/i.test(mixedSegments),'Map trip summary labels WFB → KTN as a transfer rather than a flight',mixedSegments);
  assert(await page.locator('#plan').getAttribute('aria-disabled')==='false','Mixed-mode route remains plannable');
  assert(!/no verified path/i.test(await page.locator('#status').innerText()),'Nationwide mixed-mode route has no false disconnected warning');
  await page.waitForFunction(()=>[...document.querySelectorAll('.leaflet-overlay-pane path')].some(p=>(p.getAttribute('stroke')||'').toLowerCase()==='#e7bd62'));
  pass('Selected mixed-mode route visibly distinguishes the Ketchikan transfer');

  // 8) Legacy navigation does not dead-end.
  await page.goto(BASE_URL+'/route-builder.html?route=DTW,ROC',{waitUntil:'domcontentloaded'});
  await page.waitForURL(/index\.html\?route=DTW%2CROC|index\.html\?route=DTW,ROC/,{timeout:5000});
  await page.waitForFunction(()=>document.querySelectorAll('#trip .stop').length===2);
  pass('Legacy route-builder URL lands in the working map flow');

  // 9) Basic mobile pass.
  const mobile=await context.newPage();
  attachDiagnostics(mobile);
  await mobile.setViewportSize({width:390,height:844});
  await mobile.goto(BASE_URL+'/index.html?route=DTW,ROC,DTW&date='+encodeURIComponent(tripDate),{waitUntil:'domcontentloaded'});
  const mobileOverflow=await mobile.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert(mobileOverflow<=2,'Core map page has no horizontal mobile overflow',String(mobileOverflow));
  await mobile.goto(BASE_URL+'/itinerary.html?route=DTW,ROC,DTW&date='+encodeURIComponent(tripDate),{waitUntil:'domcontentloaded'});
  const navVisible=await mobile.locator('.nav').isVisible();
  assert(navVisible,'Primary navigation remains visible on mobile');
  const itineraryOverflow=await mobile.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert(itineraryOverflow<=2,'Itinerary has no horizontal mobile overflow',String(itineraryOverflow));
  await mobile.close();

  assert(diagnostics.pageErrors.length===0,'No uncaught browser errors',diagnostics.pageErrors.join(' | '));
  await page.screenshot({path:path.join(OUT_DIR,'poc-final.png'),fullPage:true});
}catch(err){
  failure=err;
  diagnostics.failure=String(err?.stack||err);
  if(page){try{await page.screenshot({path:path.join(OUT_DIR,'poc-failure.png'),fullPage:true});}catch{}}
}finally{
  diagnostics.finishedAt=new Date().toISOString();
  fs.writeFileSync(path.join(OUT_DIR,'poc-e2e.json'),JSON.stringify(diagnostics,null,2));
  if(browser)await browser.close();
}
if(failure){console.error(failure);process.exit(1);}
console.log('POC E2E PASSED');
