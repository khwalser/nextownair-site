(function(){
  'use strict';
  function hash(text){let n=2166136261;for(const ch of text){n^=ch.charCodeAt(0);n=Math.imul(n,16777619)>>>0;}return n;}
  function timeFrom(min){const wrapped=((min%1440)+1440)%1440;const h=Math.floor(wrapped/60),m=wrapped%60,ap=h>=12?'PM':'AM';return `${h%12||12}:${String(m).padStart(2,'0')} ${ap}`;}
  const D=window.NTA_DATA||{routes:[]};
  function hasKnownRoute(a,b){
    return window.NTA&&window.NTA.hasFlightLink?window.NTA.hasFlightLink(a,b):(D.routes||[]).some(r=>(r[0]===a&&r[1]===b)||(r[0]===b&&r[1]===a));
  }
  function carrierFor(a,b){
    if(a==='DTW'||b==='DTW')return 'Delta Connection';
    if(a==='ORD'||b==='ORD')return 'United Express';
    if(a==='DEN'||b==='DEN'||a==='EGE'||b==='EGE')return 'United';
    if(a==='MSP'||b==='MSP')return 'Delta Connection';
    return 'Regional partner';
  }
  function carrierCode(name){return name.startsWith('Delta')?'DL':name.startsWith('United')?'UA':'NT';}
  function getOptions(a,b,date,legIndex){
    if(!hasKnownRoute(a,b))return [];
    const seed=hash(`${a}|${b}|${date}|${legIndex}`);
    const shift=(seed%55)-25;
    const slots=[410,650,870,1080].map((x,i)=>Math.max(330,Math.min(1210,x+shift+((seed>>(i*3))%35))));
    const carrier=carrierFor(a,b),cc=carrierCode(carrier);
    return slots.map((departMin,i)=>{
      const duration=50+(hash(`${b}${a}${date}${i}`)%105);
      const arrivalAbs=departMin+duration;
      const price=89+(hash(`${a}${date}${b}${i}`)%210);
      const flightNo=`${cc} ${String(3100+(hash(`${a}${b}${i}`)%1600))}`;
      return {id:`${date}|${a}|${b}|${i}`,date,departMin,arrivalAbs,arrivalMin:arrivalAbs%1440,arrivalDayOffset:Math.floor(arrivalAbs/1440),duration,price,carrier,flightNo,sample:true};
    }).sort((x,y)=>x.departMin-y.departMin);
  }
  function arrival(option,departDate){
    const arrDate=option.arrivalDayOffset?window.NTA.addDays(departDate,option.arrivalDayOffset):departDate;
    return {date:arrDate,min:option.arrivalMin,time:timeFrom(option.arrivalMin)};
  }
  window.NTA_FLIGHTS={mode:'sample',timeFrom,getOptions,arrival,hasKnownRoute};
})();
