import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base='https://deploy-preview-25--nextownair-site.netlify.app';
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome'});
try{
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const response=await page.goto(base+'/index.html',{waitUntil:'domcontentloaded',timeout:60000});
  assert.equal(response?.status(),200);
  await page.locator('#regionStatus').waitFor({state:'visible',timeout:20000});
  const initial=await page.locator('#gatewayConnectionsDetail').isHidden();
  assert(initial,'Gateway inspector is compact until requested');
  const results=[];
  for(const [code,dests] of [['SEA',['ANC','DTW','HNL','KOA','OGG']],['PDX',['ANC','HNL','IAD','PDT','PHX']]]){
   await page.locator('[data-gateway="'+code+'"]').click();
   const panel=page.locator('#gatewayConnectionsDetail');
   await panel.waitFor({state:'visible'});
   assert.equal(await panel.locator('[data-gateway-route]').count(),5);
   for(const dest of dests)assert.equal(await panel.locator('[data-gateway-route="'+dest+'"]').count(),1,code+' missing '+dest);
   assert.match(await panel.innerText(),/Network links only/);
   assert.match(await page.locator('#regionStatus').innerText(),/5 listed routes/);
   assert.equal(await page.locator('[data-gateway="'+code+'"]').getAttribute('aria-pressed'),'true');
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
   assert(overflow<=2,'Horizontal overflow '+width+': '+overflow);
   results.push(code+':5');
  }
  if(width<=720)await page.locator('#mapRegionSelect').selectOption('lower48');
  else await page.locator('[data-region="lower48"]').first().click();
  assert(await page.locator('#gatewayConnectionsDetail').isHidden(),'Region navigation closes gateway inspector');
  assert.deepEqual(errors,[],'Browser exceptions at '+width);
  console.log('PASS gateway inspector '+width+'px '+results.join(' '));
  await page.close();
 }
}finally{await browser.close();}
