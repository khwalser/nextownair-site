(function(){
  'use strict';
  // These are verified public carrier reservation entry points, not APIs.
  // No undocumented query parameters are added: the visitor enters the route
  // and departure date on the airline's own site or contacts its agent.
  const directory=[
    {id:'cape',name:'Cape Air',url:'https://www.capeair.com/book_flights/search-flights.html',match:/\bcape\s*air\b/i,mode:'online'},
    {id:'southern',name:'Southern Airways Express',url:'https://www.iflysouthern.com/',match:/\bsouthern\s+airways\b/i,mode:'online'},
    {id:'mokulele',name:'Mokulele Airlines',url:'https://www.mokuleleairlines.com/book-a-trip/',match:/\bmokulele\b/i,mode:'online'},
    {id:'denver',name:'Denver Air Connection',url:'https://denverairconnection.com/scheduled-flights/',match:/\bdenver\s+air\s+connection\b|\bkey\s*lime\s*air\b/i,mode:'online'},
    {id:'contour',name:'Contour Airlines',url:'https://www.contourairlines.com/',match:/\bcontour\b/i,mode:'online'},
    {id:'alaska-seaplanes',name:'Alaska Seaplanes',url:'https://www.flyalaskaseaplanes.com/',match:/\balaska\s+seaplanes\b|\bair\s+excursions\b/i,mode:'online'},
    {id:'taquan',name:'Taquan Air',url:'https://taquanair.com/flights/',match:/\btaquan\s+air\b/i,mode:'online'},
    {id:'ryan-alaska',name:'Ryan Air (Alaska)',url:'https://ryanalaska.com/passenger/',match:/\bryan\s+air\b/i,mode:'online'},
    {id:'island-air-service',name:'Island Air Service',url:'https://www.flyadq.com/',match:/\bisland\s+air\s+service\b/i,mode:'online'},
    {id:'wright',name:'Wright Air Service',url:'https://wrightairservice.com/contact-us/',match:/\bwright\s+air\b/i,mode:'contact'},
    {id:'bering',name:'Bering Air',url:'https://www.beringair.com/',match:/\bbering\s+air\b/i,mode:'online'},
    {id:'warbelows',name:"Warbelow's Air Ventures",url:'https://www.warbelows.com/home',match:/\bwarbelow/i,mode:'contact'},
    {id:'united',name:'United Airlines',url:'https://www.united.com/en/us/book-flight/united-one-way',match:/\bunited(?:\s+airlines?|\s+express)?\b/i,mode:'online'},
    {id:'american',name:'American Airlines',url:'https://www.aa.com/booking/search/find-flights',match:/\bamerican(?:\s+airlines?|\s+eagle)?\b/i,mode:'online'},
    {id:'delta',name:'Delta Air Lines',url:'https://www.delta.com/flightsearch/book-a-flight',match:/\bdelta(?:\s+air\s*lines?|\s+connection)?\b/i,mode:'online'},
    {id:'alaska',name:'Alaska Airlines',url:'https://www.alaskaair.com/en/',match:/\balaska\s+airlines\b/i,mode:'online'}
  ];
  function byName(carrier){
    if(typeof carrier!=='string'||!carrier.trim())return null;
    return directory.find(entry=>entry.match.test(carrier))||null;
  }
  function resolve({origin,destination,date,carrier}={}){
    const code=/^[A-Z]{3}$/;
    if(!code.test(origin||'')||!code.test(destination||'')||origin===destination)return null;
    const pattern=window.NTA_DATA?.servicePatterns?.[origin+'|'+destination];
    // Prefer a clearly identified selected flight carrier; use a route's
    // published carrier only as a suggestion, not evidence of date availability.
    const selected=byName(carrier);
    const documented=byName(pattern?.airline);
    // Only recommend a carrier from a documented route, not from the airport
    // state or a generic guess about who might operate the flight.
    const endpoints=[origin,destination];
    const regional=window.NTA_DATA||{};
    const routeListed=[...(regional.routes||[]),...(regional.backboneRoutes||[])]
      .some(pair=>pair.length===2&&pair.includes(origin)&&pair.includes(destination));
    const airlineGatewayEvidence=(regional.routeVerification?.backboneSources||[])
      .some(source=>(source.verifiedPairs||[]).some(pair=>{
        const parts=pair.split('-');
        return parts.length===2&&parts.includes(origin)&&parts.includes(destination);
      })&&/Alaska Airlines/i.test(source.label||''));
    const alaskaGateway=routeListed&&airlineGatewayEvidence&&
      endpoints.some(code=>['SEA','LAX','PDX'].includes(code))&&
      endpoints.some(code=>['ANC','HNL','OGG','KOA'].includes(code));
    const hawaiiPair=routeListed&&endpoints.every(code=>
      (regional.airports||[]).some(a=>a.code===code&&a.state==='HI'))&&
      ((regional.routes||[]).some(pair=>pair.includes(origin)&&pair.includes(destination))||
       ['MKK|HNL','MKK|OGG','OGG|KOA'].some(pair=>{
         const parts=pair.split('|');return parts.includes(origin)&&parts.includes(destination);
       }));
    const documentedInterisland=routeListed&&
      ['HNL|OGG','HNL|KOA'].some(pair=>{
        const parts=pair.split('|');return parts.includes(origin)&&parts.includes(destination);
      });
    const documentedDetroitGateway=routeListed&&endpoints.includes('DTW')&&endpoints.includes('SEA');
    const sourced=alaskaGateway||documentedInterisland
      ?byName('Alaska Airlines')
      :hawaiiPair?byName('Mokulele Airlines')
      :documentedDetroitGateway?byName('Delta Air Lines'):null;
    const match=selected||documented||sourced;
    if(!match)return null;
    return {id:match.id,name:match.name,url:match.url,mode:match.mode,
      origin,destination,date:typeof date==='string'?date:'',
      basis:selected?'selected-flight-carrier':documented?'published-route-carrier':'documented-route-carrier',
      dateVerified:false,searchPrefilled:false};
  }
  window.NTA_CARRIER_BOOKING={resolve,byName,carriers:directory.map(({id,name,url,mode})=>({id,name,url,mode}))};
})();
