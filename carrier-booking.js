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
    const match=selected||documented;
    if(!match)return null;
    return {id:match.id,name:match.name,url:match.url,mode:match.mode,
      origin,destination,date:typeof date==='string'?date:'',
      basis:selected?'selected-flight-carrier':'published-route-carrier',
      dateVerified:false,searchPrefilled:false};
  }
  window.NTA_CARRIER_BOOKING={resolve,byName,carriers:directory.map(({id,name,url,mode})=>({id,name,url,mode}))};
})();
