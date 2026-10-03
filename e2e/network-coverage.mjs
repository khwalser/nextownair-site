import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL=(process.env.COVERAGE_BASE_URL||'https://6ac043b048b4440008ee5ffd--nextownair-site.netlify.app').replace(/\/$/,'');
const OUT_DIR=process.env.COVERAGE_OUT_DIR||'artifacts';
fs.mkdirSync(OUT_DIR,{recursive:true});

function localDatePlus(days){
  const now=new Date();
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Detroit',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const y=Number(p.find(x=>x.type==='year').value),m=Number(p.find(x=>x.type==='month').value),d=Number(p.find(x=>x.type==='day').value);
  const dt=new Date(Date.UTC(y,m-1,d+days));
  return dt.toISOString().slice(0,10);
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

const cases=[
  // Lower 48 / HI / PR: every major current EAS carrier class represented.
  {group:'EAS lower48',carrier:'SkyWest / Delta-market',route:['CIU','DTW'],note:'Sault Ste. Marie'},
  {group:'EAS lower48',carrier:'SkyWest / United-market',route:['LAR','DEN'],note:'Laramie'},
  {group:'EAS lower48',carrier:'SkyWest / American-market',route:['GRI','DFW'],note:'Grand Island'},
  {group:'EAS lower48',carrier:'Key Lime / Denver Air Connection',route:['ALS','DEN'],note:'Alamosa'},
  {group:'EAS lower48',carrier:'Contour',route:['BRL','ORD'],note:'Burlington'},
  {group:'EAS lower48',carrier:'Cape Air',route:['AUG','BOS'],note:'Augusta'},
  {group:'EAS lower48',carrier:'Southern Airways Express',route:['BFD','IAD'],note:'Bradford'},
  {group:'EAS lower48',carrier:'Advanced Air',route:['SVC','PHX'],note:'Silver City'},
  {group:'EAS lower48',carrier:'American',route:['GCK','DFW'],note:'Garden City'},
  {group:'EAS lower48',carrier:'Boutique Air',route:['MSS','BOS'],note:'Massena'},
  {group:'EAS lower48',carrier:'Breeze',route:['OGS','IAD'],note:'Ogdensburg'},
  {group:'EAS lower48',carrier:'JetBlue',route:['PQI','BOS'],note:'Presque Isle'},

  // Every declared hub-to-hub edge in the current graph.
  {group:'hub-hub',carrier:'mixed',route:['ROC','DTW']},
  {group:'hub-hub',carrier:'mixed',route:['ROC','ORD']},
  {group:'hub-hub',carrier:'mixed',route:['ORD','DEN']},
  {group:'hub-hub',carrier:'mixed',route:['DTW','DEN']},
  {group:'hub-hub',carrier:'mixed',route:['DEN','EGE']},
  {group:'hub-hub',carrier:'mixed',route:['MSP','DEN']},
  {group:'hub-hub',carrier:'mixed',route:['MSP','ORD']},
  {group:'hub-hub',carrier:'mixed',route:['DTW','ORD']},

  // Alaska: major-network and local-air-taxi carrier classes.
  {group:'EAS Alaska',carrier:'Alaska Airlines',route:['ADK','ANC'],note:'Adak'},
  {group:'EAS Alaska',carrier:'Alaska Air Transit',route:['MCG','MRI'],note:'McGrath'},
  {group:'EAS Alaska',carrier:'Sterling',route:['KSM','ANC'],note:"St. Mary's"},
  {group:'EAS Alaska',carrier:'Island Air',route:['AKK','ADQ'],note:'Akhiok'},
  {group:'EAS Alaska',carrier:'Grant Aviation',route:['KCG','AKN'],note:'Chignik'},
  {group:'EAS Alaska',carrier:'Alaska Seaplanes',route:['AGN','JNU'],note:'Angoon'},
  {group:'EAS Alaska',carrier:"Warbelow's",route:['CEM','FAI'],note:'Central'},
  {group:'EAS Alaska',carrier:'40-Mile Air',route:['CZN','TKJ'],note:'Chisana'},
  {group:'EAS Alaska',carrier:'Ward Air',route:['EXI','JNU'],note:'Excursion Inlet'},
  {group:'EAS Alaska',carrier:'Reeve',route:['GKN','ANC'],note:'Gulkana'},
  {group:'EAS Alaska',carrier:'Wright Air',route:['HKB','FAI'],note:'Healy Lake'},
  {group:'EAS Alaska',carrier:'Taquan',route:['HYG','WFB'],note:'Hydaburg'},
  {group:'EAS Alaska',carrier:'Copper Valley',route:['MXY','GKN'],note:'McCarthy'},
  {group:'EAS Alaska',carrier:'Arctic Legacy Aviation',route:['SWD','ANC'],note:'Seward'},
  {group:'EAS Alaska',carrier:'Spernak',route:['SKW','MRI'],note:'Skwentna'},

  // Future regional-airport expansion probes. These are intentionally outside today's graph.
  {group:'future regional',carrier:'mixed',route:['AZO','DTW'],note:'Kalamazoo'},
  {group:'future regional',carrier:'mixed',route:['MBS','DTW'],note:'Saginaw/Bay City/Midland'},
  {group:'future regional',carrier:'mixed',route:['TVC','DTW'],note:'Traverse City'},
  {group:'future regional',carrier:'mixed',route:['GRR','DTW'],note:'Grand Rapids'},
  {group:'future regional',carrier:'mixed',route:['FNT','ORD'],note:'Flint'}
];

const audit={baseUrl:BASE_URL,startedAt:new Date().toISOString(),graph:null,cases:[],summary:{}};
let browser;
try{
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({locale:'en-US',timezoneId:'America/Detroit'});
  const page=await context.newPage();
  await page.goto(BASE_URL+'/index.html?fresh=1',{waitUntil:'domcontentloaded',timeout:60000});

  audit.graph=await page.evaluate(()=>{
    const D=window.NTA_DATA;
    const by=Object.fromEntries(D.airports.map(a=>[a.code,a]));
    const hubHub=D.routes.filter(([a,b])=>by[a]?.type!=='eas'&&by[b]?.type!=='eas');
    const easEdges=D.routes.filter(([a,b])=>by[a]?.type==='eas'||by[b]?.type==='eas');
    const failures=[];
    for(const [a,b] of D.routes){
      const ab=window.NTA.findFlightPath(a,b),ba=window.NTA.findFlightPath(b,a);
      if(!ab||!ba)failures.push({a,b,ab,ba});
    }
    return {airports:D.airports.length,routes:D.routes.length,easEdges:easEdges.length,hubHubEdges:hubHub.length,components:(()=>{const seen=new Set();let n=0;for(const a of D.airports){if(seen.has(a.code))continue;n++;const q=[a.code];seen.add(a.code);while(q.length){const c=q.shift();for(const x of D.routes){const other=x[0]===c?x[1]:x[1]===c?x[0]:null;if(other&&!seen.has(other)){seen.add(other);q.push(other);}}}}return n;})(),declaredEdgeFailures:failures};
  });
  if(audit.graph.declaredEdgeFailures.length)throw new Error('Declared edge regression failed');

  const offsets=[7,8,9,10,11,12,13];
  for(const test of cases){
    const row={...test,dates:[],status:'no-offer'};
    for(const offset of offsets){
      const date=localDatePlus(offset);
      let result;
      try{
        result=await page.evaluate(async ({origin,destination,date})=>{
          const res=await fetch('/.netlify/functions/flight-proxy?origin='+encodeURIComponent(origin)+'&destination='+encodeURIComponent(destination)+'&date='+encodeURIComponent(date),{headers:{Accept:'application/json'}});
          let body={};try{body=await res.json();}catch{}
          return {status:res.status,body};
        },{origin:test.route[0],destination:test.route[1],date});
      }catch(err){
        result={status:0,body:{error:'browser_fetch_failed',message:String(err)}};
      }
      const entry={date,httpStatus:result.status,error:result.body?.error||null,offerCount:Array.isArray(result.body?.offers)?result.body.offers.length:null,liveMode:result.body?.liveMode??null,carriers:Array.isArray(result.body?.offers)?[...new Set(result.body.offers.map(o=>o.operatingCarrier).filter(Boolean))]:[]};
      row.dates.push(entry);
      if(result.status===429){
        const wait=Math.min(65000,Math.max(1000,Number(result.body?.retryAfterMs)||15000));
        await sleep(wait);
        continue;
      }
      if(result.status===200&&entry.offerCount>0){
        row.status='live-offer';
        row.firstLiveDate=date;
        row.firstOfferCount=entry.offerCount;
        row.carriers=entry.carriers;
        break;
      }
      if(result.status>=500)row.status='provider-error';
      await sleep(750);
    }
    audit.cases.push(row);
    console.log('AUDIT',row.group,row.route.join('→'),row.carrier,row.status,row.firstLiveDate||'');
  }

  const grouped={};
  for(const row of audit.cases){
    grouped[row.group]??={total:0,liveOffer:0,noOffer:0,providerError:0};
    grouped[row.group].total++;
    if(row.status==='live-offer')grouped[row.group].liveOffer++;
    else if(row.status==='provider-error')grouped[row.group].providerError++;
    else grouped[row.group].noOffer++;
  }
  audit.summary={groups:grouped,liveOfferCases:audit.cases.filter(x=>x.status==='live-offer').length,totalCases:audit.cases.length};
  console.log('SUMMARY',JSON.stringify(audit.summary));
}finally{
  audit.finishedAt=new Date().toISOString();
  fs.writeFileSync(path.join(OUT_DIR,'network-coverage.json'),JSON.stringify(audit,null,2));
  if(browser)await browser.close();
}
