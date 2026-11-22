const hosts={preproduction:{auth:'https://auth.pp.travelport.net/oauth/token',api:'https://api.pp.travelport.net'},production:{auth:'https://auth.travelport.net/oauth/token',api:'https://api.travelport.net'}};
let cache={token:null,until:0,key:null};
export function configuration(env=process.env){
 const keys=['TRAVELPORT_USERNAME','TRAVELPORT_PASSWORD','TRAVELPORT_CLIENT_ID','TRAVELPORT_CLIENT_SECRET'];
 const missing=keys.filter(k=>!env[k]);
 const environment=env.TRAVELPORT_ENVIRONMENT||'preproduction';
 if(!hosts[environment])throw new Error('Invalid Travelport environment');
 if(!env.TRAVELPORT_ACCESS_GROUP&&!env.TRAVELPORT_PCC)missing.push('TRAVELPORT_ACCESS_GROUP or TRAVELPORT_PCC');
 return {ready:!missing.length,missing,environment};
}
async function post(url,headers,body,fetchFn){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
 try{
  const res=await fetchFn(url,{method:'POST',headers,body,signal:controller.signal});
  const data=await res.json().catch(()=>null);
  if(!res.ok)throw new Error('Travelport HTTP '+res.status);
  if(!data||typeof data!=='object')throw new Error('Invalid Travelport JSON');
  return data;
 }finally{clearTimeout(timer);}
}
export async function authenticate(env=process.env,fetchFn=fetch){
 const c=configuration(env);
 if(!c.ready)throw new Error('Travelport not configured: '+c.missing.join(', '));
 const key=[c.environment,env.TRAVELPORT_USERNAME,env.TRAVELPORT_PASSWORD,env.TRAVELPORT_CLIENT_ID,env.TRAVELPORT_CLIENT_SECRET].join('\0');
 if(cache.key===key&&cache.token&&Date.now()<cache.until)return cache.token;
 const body=new URLSearchParams({grant_type:'password',username:env.TRAVELPORT_USERNAME,password:env.TRAVELPORT_PASSWORD,client_id:env.TRAVELPORT_CLIENT_ID,client_secret:env.TRAVELPORT_CLIENT_SECRET});
 const data=await post(hosts[c.environment].auth,{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body.toString(),fetchFn);
 if(typeof data.access_token!=='string'||!data.access_token)throw new Error('Travelport token missing');
 cache={key,token:data.access_token,until:Date.now()+(Math.min(Number(data.expires_in)||86400,86400)-300)*1000};
 return cache.token;
}
export function buildSearchRequest(origin,destination,date){
 if(!/^[A-Z]{3}$/.test(origin)||!/^[A-Z]{3}$/.test(destination)||origin===destination)throw new Error('Invalid airport pair');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Invalid date');
 return {CatalogProductOfferingsQueryRequest:{CatalogProductOfferingsRequest:{'@type':'CatalogProductOfferingsRequestAir',offersPerPage:12,contentSourceList:['GDS'],PassengerCriteria:[{'@type':'PassengerCriteria',number:1,passengerTypeCode:'ADT'}],SearchCriteriaFlight:[{departureDate:date,From:{value:origin,cityOrAirport:'Airport Only'},To:{value:destination,cityOrAirport:'Airport Only'}}]}}};
}
export async function searchRaw(origin,destination,date,env=process.env,fetchFn=fetch){
 const c=configuration(env),token=await authenticate(env,fetchFn);
 const headers={Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json','Accept-Encoding':'gzip, deflate','Cache-Control':'no-cache','Accept-Version':'11','Content-Version':'11',TraceId:'NexTownAir_'+Date.now()};
 if(env.TRAVELPORT_ACCESS_GROUP)headers.XAUTH_TRAVELPORT_ACCESSGROUP=env.TRAVELPORT_ACCESS_GROUP;
 else headers['TVP-PCC-Core']=env.TRAVELPORT_PCC;
 // This function is deliberately server-side raw transport only. It is NOT a live fare adapter.
 return post(hosts[c.environment].api+'/11/air/catalog/search/catalogproductofferings',headers,JSON.stringify(buildSearchRequest(origin,destination,date)),fetchFn);
}
