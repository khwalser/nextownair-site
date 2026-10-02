(function(){
  'use strict';
  function timeFrom(min){
    const wrapped=((min%1440)+1440)%1440;
    const h=Math.floor(wrapped/60),m=wrapped%60,ap=h>=12?'PM':'AM';
    return `${h%12||12}:${String(m).padStart(2,'0')} ${ap}`;
  }
  const D=window.NTA_DATA||{routes:[]};
  function hasKnownRoute(a,b){
    return window.NTA&&window.NTA.hasFlightLink
      ? window.NTA.hasFlightLink(a,b)
      : (D.routes||[]).some(r=>(r[0]===a&&r[1]===b)||(r[0]===b&&r[1]===a));
  }
  function arrival(option,departDate){
    const arrDate=option.arrivalDayOffset?window.NTA.addDays(departDate,option.arrivalDayOffset):departDate;
    return {date:arrDate,min:option.arrivalMin,time:timeFrom(option.arrivalMin)};
  }
  window.NTA_FLIGHTS={mode:'live-provider',timeFrom,arrival,hasKnownRoute};
})();
