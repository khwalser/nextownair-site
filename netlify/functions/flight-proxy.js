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

  // We want BOTH directions:
  // 1) APN -> DTW
  // 2) DTW -> APN
  const routes = [
    { dep: 'APN', arr: 'DTW' },
    { dep: 'DTW', arr: 'APN' }
  ];

  try {
    const allFlights = [];

    // Fetch each route from AviationStack and normalize
    for (const route of routes) {
      const params = new URLSearchParams({
        access_key: apiKey,
        dep_iata: route.dep,
        arr_iata: route.arr,
        limit: '50'
      });

      const url = `https://api.aviationstack.com/v1/flights?${params.toString()}`;
      console.log('Fetching AviationStack URL:', url);

      const flightsResponse = await fetchJson(url);

      const normalized = (flightsResponse.data || [])
        .filter(item => {
          const departure = item.departure || {};
          const arrival = item.arrival || {};
          const depIata = (departure.iata || '').toUpperCase();
          const arrIata = (arrival.iata || '').toUpperCase();
          return depIata === route.dep && arrIata === route.arr;
        })
        .map(item => {
          const flight = item.flight || {};
          const departure = item.departure || {};
          const arrival = item.arrival || {};

          return {
            flightNumber: flight.iata || flight.number || '',
            origin: (departure.iata || departure.airport || '').toUpperCase(),
            destination: (arrival.iata || arrival.airport || '').toUpperCase(),
            departureTime: departure.scheduled || departure.estimated || '',
            arrivalTime: arrival.scheduled || arrival.estimated || '',
            // optional: quick label for direction (not used by your table yet, but handy later)
            direction: `${route.dep}-${route.arr}`,
            days: []
          };
        });

      allFlights.push(...normalized);
    }

    // Optional: sort by departure time if present
    allFlights.sort((a, b) => {
      if (!a.departureTime || !b.departureTime) return 0;
      return new Date(a.departureTime) - new Date(b.departureTime);
    });

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(allFlights)
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
