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

const diagnostics={
  baseUrl:BASE_URL,
  startedAt:new Date().toISOString(),
  assertions:[],
  fareResponses:[],
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
    if(!url.includes('/api/schedule-calendar')&&!url.includes('/.netlify/functions/flight-proxy'))return;
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
function matchingFare(origin,destination,date){
  return diagnostics.fareResponses.filter(row=>{
    try{
      const u=new URL(row.url);
      return u.searchParams.get('origin')===origin&&u.searchParams.get('destination')===destination&&u.searchParams.get('date')===date;
    }catch{return false;}
  }).at(-1)||null;
}
async function waitForFare(origin,destination,date,timeoutMs=90000){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    const row=matchingFare(origin,destination,date);
    if(row&&row.status===200)return row;
    await sleep(500);
  }
  return matchingFare(origin,destination,date);
}
async function waitForAnySchedule(timeoutMs=30000){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    if(diagnostics.scheduleResponses.length)return diagnostics.scheduleResponses.at(-1);
    await sleep(250);
  }
  return null;
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
  await page.waitForFunction(()=>document.querySelector('.stay-summary')?.textContent?.includes('Stay 2 nights'));
  pass('Journey-first stay default is rendered','ROC defaults to a 2-night stop');
  await page.locator('.stay').first().getByRole('button',{name:'1 night'}).click();
  await page.waitForFunction(()=>document.querySelector('.stay-summary')?.textContent?.includes('Stay 1 night'));
  pass('Stay duration can be changed directly in the itinerary');
  await page.locator('.stay').first().getByRole('button',{name:'2 nights'}).click();
  await page.waitForFunction(()=>document.querySelector('.stay-summary')?.textContent?.includes('Stay 2 nights'));

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
    pass('Published schedule path is usable','schedule response '+scheduleResponse.status);
  }

  // 3) Unsupported-provider coverage degrades to a usable live-search fallback instead of burning the month.
  {
    const coverageDate=tripDate;
    const target=BASE_URL+'/itinerary.html?route='+encodeURIComponent('DTW,CIU')+'&date='+encodeURIComponent(coverageDate);
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>document.body.innerText.includes('Provider coverage gap')||document.body.innerText.includes('No provider fare returned'),null,{timeout:30000});
    const legText=await page.locator('.leg').first().innerText();
    assert(/Provider coverage gap|No provider fare returned/i.test(legText),'Delta-market route exposes provider coverage honestly',legText.replace(/\s+/g,' '));
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

  // 4) Prove a real Duffel price can make it from the provider into the rendered calendar and flight cards.
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
      await page.goto(target,{waitUntil:'domcontentloaded',timeout:60000});
      const row=await waitForFare(origin,destination,date,90000);
      if(row?.status===200&&row.body?.liveMode===true&&Array.isArray(row.body.offers)&&row.body.offers.length){
        priced={origin,destination,date,row};
      }
    }
    if(priced)break;
  }
  assert(Boolean(priced),'At least one verified route/date returns a real Duffel live offer',
    priced?priced.origin+' → '+priced.destination+' '+priced.date:'No live offer returned from tested verified routes');

  const pricedRouteDates=new Set(diagnostics.fareResponses.filter(row=>{
    try{
      const u=new URL(row.url);
      return u.searchParams.get('origin')===priced.origin&&u.searchParams.get('destination')===priced.destination&&row.status===200;
    }catch{return false;}
  }).map(row=>new URL(row.url).searchParams.get('date')));
  if(pricedRouteDates.size<3){
    const started=Date.now();
    while(Date.now()-started<45000&&pricedRouteDates.size<3){
      await sleep(1000);
      diagnostics.fareResponses.filter(row=>{
        try{
          const u=new URL(row.url);
          return u.searchParams.get('origin')===priced.origin&&u.searchParams.get('destination')===priced.destination&&row.status===200;
        }catch{return false;}
      }).forEach(row=>pricedRouteDates.add(new URL(row.url).searchParams.get('date')));
    }
  }
  assert(pricedRouteDates.size>=3,'Calendar background scan advances across multiple dates automatically',[...pricedRouteDates].sort().join(', '));

  const lowest=priced.row.body.offers.reduce((best,o)=>!best||Number(o.amount)<Number(best.amount)?o:best,null);
  const expectedLow=money(lowest.amount,lowest.currency||'USD');
  await page.waitForFunction(({date,expected})=>{
    const cell=document.querySelector('[data-calendar-date="'+date+'"] .calendar-fare');
    return cell&&cell.textContent.includes(expected);
  },{date:priced.date,expected:expectedLow},{timeout:15000});
  pass('Lowest real Duffel fare renders on the selected calendar date',expectedLow);

  await page.waitForFunction(()=>document.querySelectorAll('#flight-options-0 .flight').length>0,null,{timeout:15000});
  const cardText=await page.locator('#flight-options-0').innerText();
  assert(cardText.includes(expectedLow),'Rendered flight choices contain the provider-returned fare',expectedLow);
  assert(!/\bFrom\s+[$€£¥]/i.test(cardText),'Flight cards do not fall back to generic repeated “From $…” pricing');

  const firstFlight=page.locator('#flight-options-0 .flight').first();
  await firstFlight.click();
  await page.waitForFunction(()=>document.querySelector('#summary')?.textContent?.includes('1 of 1 flight leg selected'));
  pass('Flight selection updates the itinerary summary');

  // 5) Exact NexTownAir demo route remains usable even when some fare providers lack inventory.
  {
    const exactRoute=['DTW','CIU','DTW','ORD','CMX','ORD','DTW'];
    const qs='?route='+encodeURIComponent(exactRoute.join(','))+'&auto=5&date='+encodeURIComponent(tripDate);

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
      const options=page.locator('#flight-options-'+i+' .flight');
      await options.first().waitFor({state:'visible',timeout:90000});
      const text=(await options.first().innerText()).replace(/\s+/g,' ');
      assert(/Live flight|Duffel flight|Planning window/i.test(text),'Leg '+(i+1)+' exposes a selectable live or planning option',text);
      await options.first().click();
      await page.waitForFunction(({index})=>{
        const s=JSON.parse(localStorage.getItem('nextownair.trip.v1')||'{}');
        return Boolean(s.selections&&s.selections[String(index)]);
      },{index:i},{timeout:15000});
    }
    await page.waitForFunction(()=>document.querySelector('#summary')?.textContent?.includes('6 of 6 flight legs selected'),null,{timeout:15000});
    pass('Exact DTW-CIU-DTW-ORD-CMX-ORD-DTW route can be completed end to end');
    const planningCount=await page.locator('.flight-badge',{hasText:'Planning window'}).count();
    assert(planningCount>=1,'Coverage-gap route uses clearly labeled planning windows where live inventory is absent',String(planningCount));
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
  assert((await connectorStay.innerText()).includes('Connect ASAP'),'Automatic connector defaults to a quick connection');

  await page.locator('#editRoute').click();
  await page.waitForURL(/index\.html/);
  assert(await page.locator('#trip .auto-inserted').count()>0,'Connector highlighting survives itinerary → map navigation');

  // 7) Unroutable choices fail safely instead of sending the user into a broken itinerary.
  await clearTrip();
  const disconnected=await page.evaluate(()=>{
    const codes=(window.NTA_DATA?.airports||[]).map(a=>a.code);
    for(let i=0;i<codes.length;i+=Math.max(1,Math.floor(codes.length/40))){
      for(let j=codes.length-1;j>=0;j-=Math.max(1,Math.floor(codes.length/40))){
        if(codes[i]!==codes[j]&&!window.NTA.findFlightPath(codes[i],codes[j]))return {a:codes[i],b:codes[j]};
      }
    }
    return null;
  });
  assert(Boolean(disconnected),'Test network exposes a disconnected-pair boundary case');
  await addAirport(disconnected.a);
  await addAirport(disconnected.b);
  assert(await page.locator('#plan').getAttribute('aria-disabled')==='true','Unroutable route cannot continue into itinerary');
  assert(/no verified path/i.test(await page.locator('#status').innerText()),'Unroutable route explains what must change');

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
