import { chromium } from 'playwright';
import fs from 'node:fs';

const base=(process.env.E2E_BASE_URL||'https://nextownair.com').replace(/\/$/,'');
const out=process.env.E2E_OUT_DIR||'artifacts';
fs.mkdirSync(out,{recursive:true});
const cases=[
  {name:'Arkansas EAS chain',route:['ELD','DFW','CVN','DFW','HOT'],date:'2026-12-08'},
  {name:'Michigan EAS round trip',route:['DTW','APN','DTW'],date:'2026-12-09'},
  {name:'Upper Peninsula via Chicago',route:['ORD','CMX','ORD'],date:'2026-12-10'},
  {name:'Nebraska and Arkansas EAS',route:['GRI','DFW','HOT','DFW'],date:'2026-12-11'}
];
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome'});
const evidence=[];
let failures=0;
try{
  for(let i=0;i<cases.length;i++){
    const tc=cases[i];
    const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/Detroit'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(String(e)));
    const url=base+'/itinerary.html?route='+encodeURIComponent(tc.route.join(','))+'&date='+tc.date;
    const row={name:tc.name,route:tc.route.join(' → '),startDate:tc.date,errors,checks:[]};
    const check=(ok,label,detail='')=>{
      row.checks.push({ok,label,detail});
      console.log((ok?'PASS':'FAIL')+': '+tc.name+' — '+label+(detail?' — '+detail:''));
      if(!ok){failures++;throw new Error(label+': '+detail);}
    };
    try{
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>document.querySelectorAll('#content .leg').length>=1,null,{timeout:25000});
      const state=await page.evaluate(()=>window.NTA.load());
      check(state.route.join(',')===tc.route.join(','),'Route preserved in planner',state.route.join(' → '));
      check(state.startDate===tc.date,'Trip start date preserved',state.startDate);
      const headings=await page.locator('#content .leg .leghead h2').allTextContents();
      check(headings.length===tc.route.length-1,'Expected flight-leg cards rendered',headings.join(' | '));
      const calendar=page.locator('#startDateCalendar');
      if(await calendar.isHidden())await page.locator('#startDateButton').click();
      await page.locator('.calendar-day[data-calendar-date="'+tc.date+'"]').waitFor({state:'visible',timeout:15000});
      const overview=await page.evaluate(()=>({
        status:document.querySelector('#calendarStatus')?.textContent?.trim()||'',
        dates:[...document.querySelectorAll('.calendar-day[data-calendar-date]:not(.past)')].map(el=>({date:el.dataset.calendarDate,label:el.querySelector('.calendar-fare')?.textContent?.trim()||'',disabled:el.disabled})),
        legText:document.querySelector('#content .leg')?.textContent?.replace(/\s+/g,' ').trim().slice(0,450)||''
      }));
      row.calendar=overview;
      check(overview.dates.length>0,'Calendar rendered dated cells',String(overview.dates.length));
      check(!/fare scan complete: [0-9]+ of [0-9]+ dates checked/i.test(overview.status),'No false complete-scan claim',overview.status);
      check(!/No flight offers match this timing/i.test(overview.legText),'First leg avoids incorrect connection-timing explanation');
      // Try an actual planner interaction: select a first-leg flight where published service exists.
      const first=page.locator('#flight-options-0 .flight');
      // Give asynchronous schedule and fare providers a bounded opportunity
      // to populate the first flight before recording a missing offer.
      try{await first.first().waitFor({state:'visible',timeout:12000});}catch(_){}
      if(await first.count()){
        await first.first().click();
        await page.waitForFunction(()=>Boolean(window.NTA.load().selections?.['0']),null,{timeout:10000});
        row.selection=await page.evaluate(()=>window.NTA.load().selections?.['0']);
        check(Boolean(row.selection),'First flight selection persists',row.selection);
        await page.reload({waitUntil:'domcontentloaded',timeout:60000});
        const restored=await page.evaluate(()=>window.NTA.load().selections?.['0']);
        check(Boolean(restored),'First flight survives reload',restored||'');
      }else{
        row.selection='no selectable first-leg offer; provider or schedule may be unavailable';
        const explore=page.locator('#flight-options-0 [data-open-departure-calendar]');
        check(await explore.count()===1,'Missing first-leg offer provides direct calendar navigation');
        const nextDateAction=page.locator('#flight-options-0 [data-first-next-date]');
        if(await nextDateAction.count()){
          await nextDateAction.click();
          const nextState=await page.evaluate(()=>window.NTA.load());
          check(nextState.startDate>tc.date,'Suggested confirmed departure advances itinerary date',nextState.startDate);
          const nextOptions=page.locator('#flight-options-0 .flight');
          await nextOptions.first().waitFor({state:'visible',timeout:12000});
          await nextOptions.first().click();
          row.selection=await page.evaluate(()=>window.NTA.load().selections?.['0']);
          check(Boolean(row.selection),'Suggested confirmed date offers selectable flight',row.selection||'');
        }else{
          await explore.click();
          check(await page.locator('#startDateCalendar').isVisible(),'Departure calendar opens from missing-flight guidance');
          console.log('INFO: '+tc.name+' — '+row.selection);
        }
      }
      row.totalFlightLegs=tc.route.length-1;
      row.completedFlightLegs=await page.evaluate(()=>Object.keys(window.NTA.load().selections||{}).length);
      // Exercise downstream flight and stay choices on the two shorter round trips.
      if(tc.route.length===3&&row.completedFlightLegs>=1){
        for(let legIndex=1;legIndex<row.totalFlightLegs;legIndex++){
          const selector=page.locator('#flight-options-'+legIndex+' .flight');
          let found=await selector.count()>0;
          if(!found){
            const stay=page.locator('.stay').nth(legIndex-1);
            const input=stay.locator('input.dateinput');
            if(await input.count()){
              const earliest=await input.getAttribute('min');
              if(earliest&&/^\d{4}-\d{2}-\d{2}$/.test(earliest)){
                for(let offset=0;offset<8&&!found;offset++){
                  const candidate=new Date(earliest+'T12:00:00Z');
                  candidate.setUTCDate(candidate.getUTCDate()+offset);
                  await input.fill(candidate.toISOString().slice(0,10));
                  await input.dispatchEvent('change');
                  await page.waitForTimeout(250);
                  found=await selector.count()>0;
                }
              }
            }
          }
          if(!found){
            const nextAction=page.locator('#flight-options-'+legIndex+' [data-next-service-date]');
            if(await nextAction.count()){
              await nextAction.click();
              await page.waitForTimeout(300);
              found=await selector.count()>0;
              check(found,'Next confirmed-service date reveals a selectable onward flight');
            }
          }
          if(found){
            await selector.first().click();
            await page.waitForTimeout(300);
          }
        }
        row.completedFlightLegs=await page.evaluate(()=>Object.keys(window.NTA.load().selections||{}).length);
        row.complete=row.completedFlightLegs===row.totalFlightLegs;
        console.log('INFO: '+tc.name+' — '+row.completedFlightLegs+'/'+row.totalFlightLegs+' flight legs selected');
        if(row.complete){
          await page.reload({waitUntil:'domcontentloaded',timeout:60000});
          const persistedCount=await page.evaluate(()=>Object.keys(window.NTA.load().selections||{}).length);
          check(persistedCount===row.totalFlightLegs,'Completed round-trip flight choices survive reload',String(persistedCount));
        }
      }
      await page.screenshot({path:out+'/itinerary-case-'+(i+1)+'.png',fullPage:true});
      check(errors.length===0,'No uncaught browser errors',errors.join('; '));
      row.ok=true;
    }catch(error){
      row.ok=false;row.failure=String(error);
      console.error('CASE FAILED: '+tc.name+' — '+error);
      try{await page.screenshot({path:out+'/itinerary-case-'+(i+1)+'-failure.png',fullPage:true});}catch{}
    }finally{
      evidence.push(row);
      await context.close();
    }
  }
}finally{
  await browser.close();
  fs.writeFileSync(out+'/multi-itinerary-results.json',JSON.stringify({base,cases:evidence},null,2));
}
console.log('SUMMARY: '+evidence.filter(r=>r.ok).length+'/'+evidence.length+' itinerary cases passed');
if(failures||evidence.some(r=>!r.ok))process.exitCode=1;
