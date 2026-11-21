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
  function normalizeFlightsContract(payload){
    if(!payload||payload.contractVersion!=='nta-flights-v1'||!Array.isArray(payload.offers))return payload||{};
    return {
      provider:payload.sourceProvider||'provider',
      liveMode:payload.offers.some(o=>o&&o.liveMode),
      checkedAt:payload.checkedAt,
      origin:payload.origin,
      destination:payload.destination,
      departureDate:payload.departureDate,
      offers:payload.offers.map(o=>({
        provider:payload.sourceProvider||'provider',
        liveMode:Boolean(o.liveMode),
        offerId:o.id||null,
        origin:o.origin,
        destination:o.destination,
        departureDate:o.departureDate,
        departureTime:o.departureTime,
        arrivalTime:o.arrivalTime,
        durationMinutes:o.durationMinutes,
        operatingCarrier:o.operatingCarrier,
        operatingCarrierCode:o.operatingCarrierCode,
        flightNumber:o.flightNumber,
        amount:o.fare&&o.fare.amount!==null&&o.fare.amount!==undefined&&String(o.fare.amount).trim()!==''&&Number.isFinite(Number(o.fare.amount))?Number(o.fare.amount):null,
        currency:o.fare&&o.fare.currency||'USD',
        fareStatus:o.fare&&o.fare.status||'prototype',
        timeStatus:o.timeStatus||'prototype',
        expiresAt:o.expiresAt||null,
        fareCount:Number(o.fareCount||1),
        fareChoices:Array.isArray(o.fareChoices)?o.fareChoices.map(f=>({
          offerId:f.id||null,
          amount:f.amount!==null&&f.amount!==undefined&&String(f.amount).trim()!==''&&Number.isFinite(Number(f.amount))?Number(f.amount):null,
          currency:f.currency||'USD',
          expiresAt:f.expiresAt||null
        })):[]
      }))
    };
  }
  // Bound the full response, including JSON decoding, so a stalled connection
  // cannot leave the fare queue or schedule calendar pending indefinitely.
  async function fetchJsonWithTimeout(url,timeoutMs=25000){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const res=await fetch(url,{headers:{Accept:'application/json'},signal:controller.signal});
      return {res,data:await res.json().catch(()=>({}))};
    }finally{
      clearTimeout(timer);
    }
  }
  async function fetchOffers(origin,destination,date){
    const query=new URLSearchParams({origin,destination,date});
    const {res,data:payload}=await fetchJsonWithTimeout('/api/flights?'+query.toString());
    const data=normalizeFlightsContract(payload);
    return {ok:res.ok,status:res.status,data};
  }
  async function fetchScheduleMonth(origin,destination,month,dates=[]){
    const normalizedDates=Array.isArray(dates)?[...new Set(dates)].sort():[];
    const query=new URLSearchParams({origin,destination,month});
    if(normalizedDates.length)query.set('dates',normalizedDates.join(','));
    const {res,data}=await fetchJsonWithTimeout('/api/schedule-calendar?'+query.toString());
    if(!res.ok){
      const err=new Error(data.message||data.error||'Schedule lookup failed');
      err.status=res.status;
      err.code=data.error||'';
      throw err;
    }
    return data;
  }
  window.NTA_FLIGHTS={
    mode:'nta-flights-v1',
    timeFrom,
    arrival,
    hasKnownRoute,
    normalizeFlightsContract,
    fetchOffers,
    fetchScheduleMonth
  };
})();
