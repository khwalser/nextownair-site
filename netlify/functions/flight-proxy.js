// netlify/functions/flight-proxy.js

const https = require('https');

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

  const apiKey = process.env.AVIATIONSTACK_API_KEY;

  if (!apiKey) {
    console.error('Missing AVIATIONSTACK_API_KEY env var');
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Server missing AviationStack API key' })
    };
  }

  // For now, hardcode Alpena (APN) departures – you can extend later.
  // AviationStack "flight" endpoint example with dep_iata filter.
  const params = new URLSearchParams({
    access_key: apiKey,
    dep_iata: 'APN',   // Alpena
    limit: '20'
  });

  const url = `https://api.aviationstack.com/v1/flights?${params.toString()}`;

  console.log('Fetching AviationStack URL:', url);

  try {
    const flightsResponse = await fetchJson(url);

    // Normalize the AviationStack data into what your frontend expects
    const flights = (flightsResponse.data || []).map(item => {
      const flight = item.flight || {};
      const departure = item.departure || {};
      const arrival = item.arrival || {};

      return {
        flightNumber: flight.iata || flight.number || '',
        origin: departure.iata || departure.airport || '',
        destination: arrival.iata || arrival.airport || '',
        departureTime: departure.scheduled || departure.estimated || '',
        arrivalTime: arrival.scheduled || arrival.estimated || '',
        days: [] // could derive a human-readable "today" or day-of-week if you want
      };
    });

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(flights)
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
        error: 'Failed to fetch flight data from AviationStack'
      })
    };
  }
};

// Helper: simple HTTPS GET to return parsed JSON
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        let data = '';

        res.on('data', chunk => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              console.error('AviationStack API error:', parsed.error);
              reject(parsed.error);
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', err => {
        reject(err);
      });
  });
}
