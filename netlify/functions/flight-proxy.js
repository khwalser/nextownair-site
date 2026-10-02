const https = require('https');

function httpsRequestJson(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = data ? JSON.parse(data) : {}; }
        catch (_) { return reject(new Error(`Invalid JSON from upstream (${res.statusCode})`)); }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const detail = parsed.error_description || parsed.error || JSON.stringify(parsed.errors || parsed);
          const err = new Error(`Upstream HTTP ${res.statusCode}: ${detail}`);
          err.statusCode = res.statusCode;
          return reject(err);
        }
        resolve(parsed);
      });
    });
    req.setTimeout(14000, () => req.destroy(new Error('Upstream request timed out')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function validCode(v){return /^[A-Z]{3}$/.test(v);}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v);}
function parseIsoDuration(v){
  const m=String(v||'').match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if(!m)return null;
  return (Number(m[1]||0)*1440)+(Number(m[2]||0)*60)+Number(m[3]||0)+(Number(m[4]||0)>=30?1:0);
}
function json(statusCode, body, extraHeaders={}){
  return {
    statusCode,
    headers:{
      'Access-Control-Allow-Origin':'*',
      'Access-Control-Allow-Methods':'GET, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type',
      'Content-Type':'application/json',
      'Cache-Control':'no-store',
      ...extraHeaders
    },
    body:JSON.stringify(body)
  };
}

async function searchDuffel(origin,destination,departureDate){
  const token=process.env.DUFFEL_ACCESS_TOKEN;
  if(!token)return null;

  const body=JSON.stringify({
    data:{
      cabin_class:'economy',
      max_connections:0,
      passengers:[{type:'adult'}],
      slices:[{origin,destination,departure_date:departureDate}]
    }
  });

  const response=await httpsRequestJson({
    hostname:'api.duffel.com',
    path:'/air/offer_requests?return_offers=true&supplier_timeout=9000',
    method:'POST',
    headers:{
      'Authorization':`Bearer ${token}`,
      'Duffel-Version':'v2',
      'Accept':'application/json',
      'Content-Type':'application/json',
      'Content-Length':Buffer.byteLength(body)
    }
  }, body);

  const request=response.data||{};
  const rawOffers=(request.offers||[])
    .map(offer=>{
      const slice=(offer.slices||[])[0]||{};
      const segments=slice.segments||[];
      if(segments.length!==1)return null;
      const seg=segments[0]||{};
      const carrier=seg.operating_carrier||{};
      const amount=Number(offer.total_amount);
      if(!Number.isFinite(amount))return null;
      return {
        provider:'duffel',
        liveMode:Boolean(offer.live_mode),
        offerId:offer.id||null,
        origin,
        destination,
        departureDate,
        departureTime:seg.departing_at||null,
        arrivalTime:seg.arriving_at||null,
        durationMinutes:parseIsoDuration(seg.duration),
        operatingCarrier:carrier.name||null,
        operatingCarrierCode:carrier.iata_code||null,
        flightNumber:seg.operating_carrier_flight_number?
          `${carrier.iata_code||''}${seg.operating_carrier_flight_number}`:null,
        amount,
        currency:offer.total_currency||'USD',
        expiresAt:offer.expires_at||null
      };
    })
    .filter(Boolean);

  const grouped=new Map();
  for(const offer of rawOffers){
    const key=[
      offer.operatingCarrierCode||offer.operatingCarrier||'',
      offer.flightNumber||'',
      offer.departureTime||'',
      offer.arrivalTime||''
    ].join('|');
    const existing=grouped.get(key);
    if(!existing){
      grouped.set(key,{...offer,fareCount:1,fareChoices:[{
        offerId:offer.offerId,amount:offer.amount,currency:offer.currency,expiresAt:offer.expiresAt
      }]});
      continue;
    }
    existing.fareCount+=1;
    existing.fareChoices.push({
      offerId:offer.offerId,amount:offer.amount,currency:offer.currency,expiresAt:offer.expiresAt
    });
    if(offer.amount<existing.amount){
      Object.assign(existing,{
        offerId:offer.offerId,amount:offer.amount,currency:offer.currency,expiresAt:offer.expiresAt,
        liveMode:offer.liveMode,durationMinutes:offer.durationMinutes
      });
    }
  }

  const offers=[...grouped.values()]
    .map(offer=>({
      ...offer,
      fareChoices:offer.fareChoices
        .sort((a,b)=>a.amount-b.amount)
        .filter((x,i,arr)=>i===0||x.amount!==arr[i-1].amount||x.currency!==arr[i-1].currency)
    }))
    .sort((a,b)=>String(a.departureTime||'').localeCompare(String(b.departureTime||''))||a.amount-b.amount);

  return {
    provider:'duffel',
    liveMode:Boolean(request.live_mode),
    checkedAt:new Date().toISOString(),
    origin,
    destination,
    departureDate,
    offers:offers.slice(0,12)
  };
}

exports.handler=async event=>{
  if(event.httpMethod==='OPTIONS')return json(204,{});
  if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed'});

  const p=event.queryStringParameters||{};
  const origin=String(p.origin||'').toUpperCase();
  const destination=String(p.destination||'').toUpperCase();
  const departureDate=String(p.date||'');

  if(!validCode(origin)||!validCode(destination)||!validDate(departureDate)){
    return json(400,{error:'Use three-letter origin/destination codes and date=YYYY-MM-DD'});
  }

  try{
    const duffel=await searchDuffel(origin,destination,departureDate);
    if(duffel)return json(200,duffel);

    return json(503,{
      error:'pricing_not_configured',
      message:'Duffel live pricing is not configured.'
    });
  }catch(err){
    console.error('flight-proxy error',err);
    return json(502,{
      error:'pricing_lookup_failed',
      message:'Flight pricing lookup is unavailable.',
      details:String(err.message||err)
    });
  }
};
