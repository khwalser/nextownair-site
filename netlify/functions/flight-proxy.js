// netlify/functions/flight-proxy.js

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
    // TODO: replace this with your real flight-fetching code
    const flights = [
      {
        flightNumber: 'DL 1234',
        origin: 'DTW',
        destination: 'APN',
        departureTime: '10:30',
        arrivalTime: '11:25',
        days: ['Mon', 'Wed', 'Fri']
      }
    ];

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
      body: JSON.stringify({ error: 'Failed to fetch flight data' })
    };
  }
};
