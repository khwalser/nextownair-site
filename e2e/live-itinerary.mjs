import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = (process.env.E2E_BASE_URL || 'https://6ac02a6f35e24800084bc419--nextownair-site.netlify.app').replace(/\/$/, '');
const ROUTE = process.env.E2E_ROUTE || 'DTW,ROC,DTW';
const DATE = process.env.E2E_DATE || '2026-10-02';
const OUT_DIR = process.env.E2E_OUT_DIR || 'artifacts';
const TARGET = `${BASE_URL}/itinerary.html?route=${encodeURIComponent(ROUTE)}&date=${encodeURIComponent(DATE)}`;

fs.mkdirSync(OUT_DIR, { recursive: true });

const diagnostics = {
  target: TARGET,
  startedAt: new Date().toISOString(),
  route: ROUTE,
  date: DATE,
  console: [],
  pageErrors: [],
  requestFailures: [],
  scheduleResponses: [],
  fareResponses: [],
  assertions: []
};

function pass(name, detail = '') {
  diagnostics.assertions.push({ name, ok: true, detail });
  console.log(`PASS: ${name}${detail ? ` — ${detail}` : ''}`);
}

function assert(condition, name, detail = '') {
  if (!condition) {
    diagnostics.assertions.push({ name, ok: false, detail });
    throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
  }
  pass(name, detail);
}

function money(amount, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0
    }).format(Number(amount));
  } catch {
    return `${currency} ${Math.round(Number(amount))}`;
  }
}

let browser;
let page;
let failure = null;

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1400 },
    locale: 'en-US'
  });
  page = await context.newPage();

  page.on('console', msg => {
    diagnostics.console.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', err => diagnostics.pageErrors.push(String(err)));
  page.on('requestfailed', req => diagnostics.requestFailures.push({
    url: req.url(),
    error: req.failure()?.errorText || 'request failed'
  }));
  page.on('response', async res => {
    const url = res.url();
    if (!url.includes('/api/schedule-calendar') && !url.includes('/.netlify/functions/flight-proxy')) return;
    let body = null;
    try { body = await res.json(); } catch {}
    const row = { url, status: res.status(), body };
    if (url.includes('/api/schedule-calendar')) diagnostics.scheduleResponses.push(row);
    else diagnostics.fareResponses.push(row);
  });

  const quotaResponsePromise = page.waitForResponse(async res => {
    if (!res.url().includes('/api/schedule-calendar')) return false;
    try {
      const body = await res.json();
      return body?.error === 'schedule_quota_exhausted';
    } catch {
      return false;
    }
  }, { timeout: 45000 });

  console.log(`Opening ${TARGET}`);
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });

  await page.locator('#routebar').waitFor({ state: 'visible', timeout: 15000 });
  const routeText = (await page.locator('#routebar').innerText()).replace(/\s+/g, ' ').trim();
  assert(routeText.includes('DTW') && routeText.includes('ROC'), 'Rendered route contains DTW → ROC → DTW', routeText);

  const routeCodes = await page.locator('#routebar .routechip').allTextContents();
  assert(routeCodes.length === 3, 'Rendered itinerary has exactly three route points', routeCodes.join(' | '));
  assert(routeCodes[0].includes('DTW') && routeCodes[1].includes('ROC') && routeCodes[2].includes('DTW'),
    'Rendered route order is DTW, ROC, DTW', routeCodes.join(' | '));

  const quotaResponse = await quotaResponsePromise;
  const quotaBody = await quotaResponse.json().catch(() => ({}));
  assert(quotaResponse.status() === 503, 'Schedule quota is surfaced as a backend failure', `HTTP ${quotaResponse.status()}`);
  assert(quotaBody?.error === 'schedule_quota_exhausted', 'AeroDataBox exhaustion is classified as schedule_quota_exhausted');

  await page.waitForFunction(date => {
    const cells = [...document.querySelectorAll('.calendar-day[data-calendar-date]')]
      .filter(el => el.dataset.calendarDate >= date);
    return cells.length > 0 && cells.every(el => el.classList.contains('fallback') && !el.disabled);
  }, DATE, { timeout: 15000 });

  const calendarState = await page.evaluate(date => {
    const cells = [...document.querySelectorAll('.calendar-day[data-calendar-date]')]
      .filter(el => el.dataset.calendarDate >= date)
      .map(el => ({
        date: el.dataset.calendarDate,
        disabled: el.disabled,
        classes: [...el.classList],
        fare: el.querySelector('.calendar-fare')?.textContent?.trim() || ''
      }));
    return {
      status: document.querySelector('#calendarStatus')?.textContent?.trim() || '',
      selected: cells.find(x => x.date === date) || null,
      cells
    };
  }, DATE);

  assert(calendarState.cells.length >= 20, 'Fallback renders the remaining month, not a frozen partial calendar',
    `${calendarState.cells.length} selectable-date cells inspected`);
  assert(calendarState.cells.every(x => !x.disabled), 'All non-past dates remain selectable during schedule quota exhaustion');
  assert(calendarState.cells.every(x => x.classes.includes('fallback')), 'All non-past dates render in schedule-provider fallback state');
  assert(!/\b0\s+of\s+\d+\b/i.test(calendarState.status), 'Calendar is not frozen at 0 of N schedule checks', calendarState.status || '(blank)');

  // The calendar queue should visibly distinguish waiting work from work in flight.
  await page.waitForTimeout(700);
  const fareLabels = await page.locator('.calendar-day[data-calendar-date] .calendar-fare').allTextContents();
  const normalizedFareLabels = fareLabels.map(x => x.trim()).filter(Boolean);
  assert(normalizedFareLabels.includes('queued'), 'Calendar visibly labels queued Duffel pricing jobs',
    [...new Set(normalizedFareLabels)].join(', '));
  assert(normalizedFareLabels.some(x => x === 'pricing…' || x === 'retry fare' || x === 'no live fare' || /[$€£¥]/.test(x)),
    'Calendar shows an active or resolved Duffel fare state in addition to queued work',
    [...new Set(normalizedFareLabels)].join(', '));

  // Give the selected first leg a chance to resolve. If Duffel returns a 200 with offers,
  // prove the rendered flight cards contain the prices actually returned by Duffel.
  let selectedFare200 = null;
  try {
    const response = await page.waitForResponse(res => {
      const u = new URL(res.url());
      return u.pathname.endsWith('/.netlify/functions/flight-proxy')
        && u.searchParams.get('origin') === 'DTW'
        && u.searchParams.get('destination') === 'ROC'
        && u.searchParams.get('date') === DATE
        && res.status() === 200;
    }, { timeout: 30000 });
    selectedFare200 = await response.json().catch(() => null);
  } catch {}

  if (selectedFare200?.offers?.length) {
    await page.waitForFunction(() => document.querySelectorAll('#flight-options-0 .flight').length > 0, null, { timeout: 15000 });
    const cardText = await page.locator('#flight-options-0').innerText();
    assert(!/\bFrom\s+[$€£¥]/i.test(cardText), 'Flight cards do not use generic repeated “From $…” pricing');

    const expected = new Set();
    for (const offer of selectedFare200.offers) {
      const choices = Array.isArray(offer.fareChoices) && offer.fareChoices.length
        ? offer.fareChoices
        : [{ amount: offer.amount, currency: offer.currency }];
      for (const choice of choices) {
        if (Number.isFinite(Number(choice.amount))) expected.add(money(choice.amount, choice.currency || offer.currency || 'USD'));
      }
    }
    const missing = [...expected].filter(label => !cardText.includes(label));
    assert(missing.length === 0, 'Rendered flight cards show the fare values returned by Duffel',
      missing.length ? `Missing: ${missing.join(', ')}` : `Verified ${expected.size} returned fare value(s)`);
  } else {
    const rateLimited = diagnostics.fareResponses.some(x => x.status === 429 && x.body?.error === 'pricing_rate_limited');
    const noInventory = diagnostics.fareResponses.some(x =>
      x.status === 200
      && x.url.includes('origin=DTW')
      && x.url.includes('destination=ROC')
      && Array.isArray(x.body?.offers)
      && x.body.offers.length === 0
    );
    assert(rateLimited || noInventory, 'Duffel selected-date result is explicitly observable when no priced cards are available',
      rateLimited ? 'provider returned 429 and the browser queue remained active' : 'Duffel returned 200 with no nonstop offers');
  }

  const pageErrors = diagnostics.pageErrors.filter(Boolean);
  assert(pageErrors.length === 0, 'No uncaught browser page errors', pageErrors.join(' | '));

  await page.screenshot({ path: path.join(OUT_DIR, 'dtw-roc-dtw.png'), fullPage: true });
} catch (err) {
  failure = err;
  diagnostics.failure = String(err?.stack || err);
  if (page) {
    try {
      await page.screenshot({ path: path.join(OUT_DIR, 'dtw-roc-dtw-failure.png'), fullPage: true });
    } catch {}
  }
} finally {
  diagnostics.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT_DIR, 'live-e2e.json'), JSON.stringify(diagnostics, null, 2));
  if (browser) await browser.close();
}

if (failure) {
  console.error(failure);
  process.exit(1);
}

console.log('LIVE E2E PASSED');
