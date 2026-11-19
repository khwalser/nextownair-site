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
        amount:Number(o.fare&&o.fare.amount),
        currency:o.fare&&o.fare.currency||'USD',
        fareStatus:o.fare&&o.fare.status||'prototype',
        timeStatus:o.timeStatus||'prototype',
        expiresAt:o.expiresAt||null,
        fareCount:Number(o.fareCount||1),
        fareChoices:Array.isArray(o.fareChoices)?o.fareChoices.map(f=>({
          offerId:f.id||null,
          amount:Number(f.amount),
          currency:f.currency||'USD',
          expiresAt:f.expiresAt||null
        })):[]
      }))
    };
  }
  async function fetchOffers(origin,destination,date){
    const query=new URLSearchParams({origin,destination,date});
    const res=await fetch('/api/flights?'+query.toString(),{headers:{Accept:'application/json'}});
    const payload=await res.json().catch(()=>({}));
    const data=normalizeFlightsContract(payload);
    return {ok:res.ok,status:res.status,data};
  }
  async function fetchScheduleMonth(origin,destination,month,dates=[]){
    const normalizedDates=Array.isArray(dates)?[...new Set(dates)].sort():[];
    const query=new URLSearchParams({origin,destination,month});
    if(normalizedDates.length)query.set('dates',normalizedDates.join(','));
    const res=await fetch('/api/schedule-calendar?'+query.toString(),{headers:{Accept:'application/json'}});
    const data=await res.json().catch(()=>({}));
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
