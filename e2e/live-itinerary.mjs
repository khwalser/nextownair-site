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
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1200},locale:'en-US',timezoneId:'America/Detroit'});
  page=await context.newPage();
  attachDiagnostics(page);

  const tripDate=process.env.E2E_DATE||localDatePlus(14);

  // 1) Build a round trip from the map using the same controls a human uses.
  await page.goto(BASE_URL+'/index.html',{waitUntil:'domcontentloaded',timeout:60000});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:'domcontentloaded'});

  await addAirport('DTW');
  await addAirport('ROC');
  await page.getByRole('button',{name:'Return to start'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#trip .stop').length===3);

  const mapStops=(await page.locator('#trip .stop strong').allTextContents()).join(' | ');
  assert(mapStops.includes('DTW')&&mapStops.includes('ROC'),'Map route can be built without manual URL editing',mapStops);
  assert(await page.locator('#plan').getAttribute('aria-disabled')==='false','Supported route enables itinerary navigation');
  assert(!/no verified path/i.test(await page.locator('#status').innerText()),'Supported route does not show a false routing warning');

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
  assert(!/\b0\s+of\s+\d+\b/i.test(calendarSnapshot.status),'Calendar never freezes at 0 of N',calendarSnapshot.status);
  if(scheduleCode==='schedule_quota_exhausted'){
    assert(calendarSnapshot.future.length>0&&calendarSnapshot.future.every(x=>!x.disabled),'Quota fallback keeps future dates selectable');
  }else{
    pass('Published schedule path is usable','schedule response '+scheduleResponse.status);
  }

  // 3) Prove a real Duffel price can make it from the provider into the rendered calendar and flight cards.
  const candidates=[
    ['DTW','ROC'],
    ['LAR','DEN'],['BFF','DEN'],['COD','DEN'],['SUX','DEN'],['SUX','ORD'],
    ['GCK','DFW'],['GRI','DFW'],['ABR','MSP'],['BJI','MSP'],['RHI','MSP'],
    ['APN','DTW'],['DTW','APN'],['ESC','DTW'],['DTW','ESC']
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

  // 4) Map ↔ itinerary navigation preserves the trip and automatic-connector semantics.
  await page.goto(BASE_URL+'/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:'domcontentloaded'});
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
  const autoText=await page.locator('#trip .auto-inserted').first().innerText();
  assert(/Auto-inserted connector/i.test(autoText),'Automatically inserted connector is visibly identified',autoText.replace(/\s+/g,' '));
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

  // 5) Unroutable choices fail safely instead of sending the user into a broken itinerary.
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

  // 6) Legacy navigation does not dead-end.
  await page.goto(BASE_URL+'/route-builder.html?route=DTW,ROC',{waitUntil:'domcontentloaded'});
  await page.waitForURL(/index\.html\?route=DTW%2CROC|index\.html\?route=DTW,ROC/,{timeout:5000});
  await page.waitForFunction(()=>document.querySelectorAll('#trip .stop').length===2);
  pass('Legacy route-builder URL lands in the working map flow');

  // 7) Basic mobile pass.
  const mobile=await context.newPage();
  attachDiagnostics(mobile);
  await mobile.setViewportSize({width:390,height:844});
  await mobile.goto(BASE_URL+'/index.html?route=DTW,ROC,DTW&date='+encodeURIComponent(tripDate),{waitUntil:'domcontentloaded'});
  const mobileOverflow=await mobile.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert(mobileOverflow<=2,'Core map page has no horizontal mobile overflow',String(mobileOverflow));
  await mobile.goto(BASE_URL+'/itinerary.html?route=DTW,ROC,DTW&date='+encodeURIComponent(tripDate),{waitUntil:'domcontentloaded'});
  const navVisible=await mobile.locator('.nav').isVisible();
  assert(navVisible,'Primary navigation remains visible on mobile');
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
