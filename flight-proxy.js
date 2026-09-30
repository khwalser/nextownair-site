// netlify/functions/flight-proxy.js

const https = require('https');

// Small helper to do POST/GET with JSON on HTTPS
function httpsRequestJson(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error || parsed.errors) {
            console.error('API error:', parsed.error || parsed.errors);
            reject(parsed.error || parsed.errors);
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

// Get Amadeus OAuth token (client_credentials)
async function getAmadeusToken() {
  const key = process.env.AMADEUS_API_KEY;
  const secret = process.env.AMADEUS_API_SECRET;

  if (!key || !secret) {
    throw new Error('Missing Amadeus API credentials');
  }

  const authBody = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: key,
    client_secret: secret
  }).toString();

  const options = {
    hostname: 'test.api.amadeus.com', // use 'api.amadeus.com' when you go live
    path: '/v1/security/oauth2/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(authBody)
    }
  };

  const response = await httpsRequestJson(options, authBody);
  return response.access_token;
}

// Search for flight offers APN <-> DTW on a given date, using Amadeus
async function searchAmadeusOffers(token, origin, destination, departureDate) {
  const query = new URLSearchParams({
    originLocationCode: origin,
    destinationLocationCode: destination,
    departureDate: departureDate,
    adults: '1',
    currencyCode: 'USD',
    max: '10'
  }).toString();

  const options = {
    hostname: 'test.api.amadeus.com',
    path: `/v2/shopping/flight-offers?${query}`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  };

  const response = await httpsRequestJson(options);
  return response;
}

// Build a simple meta-search/deep link for this route+date
function buildSearchLink(origin, destination, date) {
  if (!origin || !destination || !date) return '';
  // YYYY-MM-DD
  return `https://www.kayak.com/flights/${origin}-${destination}/${date}?sort=bestflight_a`;
}

exports.handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  try {
    const key = process.env.AMADEUS_API_KEY;
    const secret = process.env.AMADEUS_API_SECRET;
    if (!key || !secret) {
      throw new Error('Missing Amadeus API credentials');
    }

    // For now: default origin/dest and date if not passed in
    const params = event.queryStringParameters || {};
    const origin = (params.origin || 'APN').toUpperCase();
    const destination = (params.destination || 'DTW').toUpperCase();

    // Date: either ?date=YYYY-MM-DD or "today" in UTC
    let departureDate = params.date;
    if (!departureDate) {
      const today = new Date();
      const yyyy = today.getUTCFullYear();
      const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(today.getUTCDate()).padStart(2, '0');
      departureDate = `${yyyy}-${mm}-${dd}`;
    }

    const token = await getAmadeusToken();

    // We want both directions: origin->destination and destination->origin
    const directions = [
      { from: origin, to: destination },
      { from: destination, to: origin }
    ];

    const allOptions = [];

    for (const dir of directions) {
      const offersResponse = await searchAmadeusOffers(
        token,
        dir.from,
        dir.to,
        departureDate
      );

      const offers = offersResponse.data || [];

      offers.forEach(offer => {
        const itineraries = offer.itineraries || [];
        if (!itineraries.length) return;

        const firstItin = itineraries[0];
        const segments = firstItin.segments || [];
        if (!segments.length) return;

        const firstSeg = segments[0];
        const lastSeg = segments[segments.length - 1];

        const departureTime = firstSeg.departure && firstSeg.departure.at;
        const arrivalTime = lastSeg.arrival && lastSeg.arrival.at;

        const originCode = firstSeg.departure && firstSeg.departure.iataCode;
        const destCode = lastSeg.arrival && lastSeg.arrival.iataCode;

        const carrierCode = firstSeg.carrierCode || '';
        const flightNumber = firstSeg.number
          ? `${carrierCode}${firstSeg.number}`
          : carrierCode;

        const priceInfo = offer.price || {};
        const totalPrice = priceInfo.total ? parseFloat(priceInfo.total) : null;
        const currency = priceInfo.currency || 'USD';

        const bookUrl = buildSearchLink(
          originCode || dir.from,
          destCode || dir.to,
          departureDate
        );

        allOptions.push({
          flightNumber,
          origin: originCode || dir.from,
          destination: destCode || dir.to,
          departureTime,
          arrivalTime,
          priceFrom: totalPrice,
          currency,
          bookUrl
        });
      });
    }

    // Sort by departure time
    allOptions.sort((a, b) => {
      if (!a.departureTime || !b.departureTime) return 0;
      return new Date(a.departureTime) - new Date(b.departureTime);
    });

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(allOptions)
    };
  } catch (err) {
    console.error('flight-proxy error:', err);

    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        error: 'Failed to fetch live offers',
        details: String(err)
      })
    };
  }
};
