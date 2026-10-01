function json(data, status=200, extraHeaders={}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=900",
      "Netlify-CDN-Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
      ...extraHeaders
    }
  });
}

function validCode(v) {
  return /^[A-Z]{3}$/.test(v);
}

function validMonth(v) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function monthWindow(month) {
  const [year, mon] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, mon - 1, 1));
  const next = new Date(Date.UTC(year, mon, 1));
  const queryStart = new Date(first.getTime() - 24 * 60 * 60 * 1000);
  const queryEnd = new Date(next.getTime() + 24 * 60 * 60 * 1000);
  return {
    start: queryStart.toISOString().replace(".000Z", "Z"),
    end: queryEnd.toISOString().replace(".000Z", "Z")
  };
}

function localDateFor(iso, timezone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(d);
      const vals = Object.fromEntries(parts.map(p => [p.type, p.value]));
      if (vals.year && vals.month && vals.day) return `${vals.year}-${vals.month}-${vals.day}`;
    } catch (_) {}
  }
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
}

function iataOf(flight, side) {
  const obj = flight && flight[side];
  return String(
    flight?.[`${side}_iata`] ||
    (obj && (obj.code_iata || obj.iata_code || obj.iata)) ||
    ""
  ).toUpperCase();
}

function timezoneOf(flight) {
  const origin = flight && flight.origin;
  return flight?.origin_timezone ||
    flight?.origin_tz ||
    (origin && (origin.timezone || origin.time_zone)) ||
    null;
}

function flightIdent(flight) {
  return flight.actual_ident_iata ||
    flight.actual_ident_icao ||
    flight.actual_ident ||
    flight.ident_iata ||
    flight.ident_icao ||
    flight.ident ||
    "Scheduled flight";
}

export default async (req) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const origin = String(url.searchParams.get("origin") || "").toUpperCase();
  const destination = String(url.searchParams.get("destination") || "").toUpperCase();
  const month = String(url.searchParams.get("month") || "");

  if (!validCode(origin) || !validCode(destination) || !validMonth(month)) {
    return json({ error: "Use origin=AAA&destination=BBB&month=YYYY-MM" }, 400);
  }

  const apiKey = Netlify.env.get("FLIGHTAWARE_AEROAPI_KEY");
  if (!apiKey) {
    return json({
      error: "schedule_provider_not_configured",
      message: "FlightAware AeroAPI is not configured.",
      requiredEnvVar: "FLIGHTAWARE_AEROAPI_KEY"
    }, 503, { "Cache-Control": "no-store", "Netlify-CDN-Cache-Control": "no-store" });
  }

  const { start, end } = monthWindow(month);
  const params = new URLSearchParams({
    origin,
    destination,
    include_codeshares: "false",
    max_pages: "30"
  });
  const endpoint = `https://aeroapi.flightaware.com/aeroapi/schedules/${encodeURIComponent(start)}/${encodeURIComponent(end)}?${params}`;

  let upstream;
  try {
    upstream = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        "x-apikey": apiKey
      }
    });
  } catch (err) {
    return json({
      error: "schedule_lookup_failed",
      message: "Published schedule lookup is unavailable.",
      details: String(err?.message || err)
    }, 502, { "Cache-Control": "no-store", "Netlify-CDN-Cache-Control": "no-store" });
  }

  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return json({
      error: "schedule_lookup_failed",
      message: body.detail || body.title || body.message || `FlightAware HTTP ${upstream.status}`,
      upstreamStatus: upstream.status
    }, upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status, {
      "Cache-Control": "no-store",
      "Netlify-CDN-Cache-Control": "no-store"
    });
  }

  const seen = new Set();
  const days = {};
  const flights = Array.isArray(body.scheduled) ? body.scheduled : [];

  for (const flight of flights) {
    if (iataOf(flight, "origin") !== origin || iataOf(flight, "destination") !== destination) continue;
    const scheduledOut = flight.scheduled_out || flight.scheduled_off;
    if (!scheduledOut) continue;
    const date = localDateFor(scheduledOut, timezoneOf(flight));
    if (!date || !date.startsWith(month + "-")) continue;

    const ident = flightIdent(flight);
    const dedupeKey = `${ident}|${scheduledOut}|${flight.scheduled_in || flight.scheduled_on || ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    if (!days[date]) days[date] = { count: 0, flights: [] };
    days[date].count += 1;
    if (days[date].flights.length < 12) {
      days[date].flights.push({
        ident,
        scheduledOut,
        scheduledIn: flight.scheduled_in || flight.scheduled_on || null
      });
    }
  }

  return json({
    provider: "flightaware-aeroapi",
    sourceType: "published-schedule",
    origin,
    destination,
    month,
    checkedAt: new Date().toISOString(),
    partial: Boolean(body?.links?.next),
    days
  });
};

export const config = {
  path: "/api/schedule-calendar"
};
