const https = require('https');

function httpsRequestJson(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = data ? JSON.parse(data) : {}; }
        catch (err) { return reject(new Error(`Invalid JSON from upstream (${res.statusCode})`)); }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const detail = parsed.error_description || parsed.error || JSON.stringify(parsed.errors || parsed);
          return reject(new Error(`Upstream HTTP ${res.statusCode}: ${detail}`));
        }
        resolve(parsed);
      });
    });
    req.setTimeout(12000, () => req.destroy(new Error('Upstream request timed out')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getAmadeusToken() {
  const key = process.env.AMADEUS_API_KEY;
  const secret = process.env.AMADEUS_API_SECRET;
  if (!key || !secret) throw new Error('Missing Amadeus API credentials');
  const authBody = new URLSearchParams({grant_type:'client_credentials',client_id:key,client_secret:secret}).toString();
  const response = await httpsRequestJson({
    hostname:'test.api.amadeus.com',path:'/v1/security/oauth2/token',method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(authBody)}
  }, authBody);
  if (!response.access_token) throw new Error('Amadeus token response did not include an access token');
  return response.access_token;
}

async function searchOffers(token, origin, destination, departureDate) {
  const query = new URLSearchParams({originLocationCode:origin,destinationLocationCode:destination,departureDate,adults:'1',currencyCode:'USD',max:'8'}).toString();
  return httpsRequestJson({
    hostname:'test.api.amadeus.com',path:`/v2/shopping/flight-offers?${query}`,method:'GET',
    headers:{Authorization:`Bearer ${token}`}
  });
}

function validCode(v){return /^[A-Z]{3}$/.test(v);}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v);}
function buildSearchLink(origin,destination,date){return `https://www.kayak.com/flights/${origin}-${destination}/${date}?sort=bestflight_a`;}

exports.handler = async event => {
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Content-Type':'application/json'};
  if (event.httpMethod === 'OPTIONS') return {statusCode:204,headers:cors,body:''};
  if (event.httpMethod !== 'GET') return {statusCode:405,headers:cors,body:JSON.stringify({error:'Method not allowed'})};

  try {
    const p=event.queryStringParameters||{};
    const origin=String(p.origin||'APN').toUpperCase();
    const destination=String(p.destination||'DTW').toUpperCase();
    const departureDate=String(p.date||new Date().toISOString().slice(0,10));
    if(!validCode(origin)||!validCode(destination)||!validDate(departureDate)){
      return {statusCode:400,headers:cors,body:JSON.stringify({error:'Use three-letter origin/destination codes and date=YYYY-MM-DD'})};
    }

    const token=await getAmadeusToken();
    const response=await searchOffers(token,origin,destination,departureDate);
    const flights=[];
    for(const offer of response.data||[]){
      const itin=(offer.itineraries||[])[0];const segs=(itin&&itin.segments)||[];if(!segs.length)continue;
      const first=segs[0],last=segs[segs.length-1];const price=offer.price||{};
      flights.push({
        provider:'amadeus-test',sample:false,
        flightNumber:first.number?`${first.carrierCode||''}${first.number}`:(first.carrierCode||''),
        origin:(first.departure&&first.departure.iataCode)||origin,
        destination:(last.arrival&&last.arrival.iataCode)||destination,
        departureTime:first.departure&&first.departure.at,
        arrivalTime:last.arrival&&last.arrival.at,
        stops:Math.max(0,segs.length-1),
        priceFrom:price.total?Number(price.total):null,
        currency:price.currency||'USD',
        bookUrl:buildSearchLink(origin,destination,departureDate)
      });
    }
    flights.sort((a,b)=>String(a.departureTime||'').localeCompare(String(b.departureTime||'')));
    return {statusCode:200,headers:{...cors,'Cache-Control':'public, max-age=300'},body:JSON.stringify(flights)};
  } catch (err) {
    console.error('flight-proxy error',err);
    return {statusCode:502,headers:cors,body:JSON.stringify({error:'Live flight lookup is unavailable',details:String(err.message||err)})};
  }
};
