'use strict';

const THRESHOLD = 1.49;
const FRESHNESS_MINUTES = 30;
const MINUTE = 60_000;
const $ = (id) => document.getElementById(id);
const fmtTime = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDate = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', day: '2-digit', month: 'short' });
const stamp = (time) => `${fmtDate.format(time)}, ${fmtTime.format(time)}`;
const asAest = (value) => new Date(`${value}+10:00`);
const HISTORY_OPTIONS = [6, 24, 48];
const requestedHistory = Number(new URLSearchParams(window.location.search).get('history'));
let series = [];
let visible = [];
let historyHours = HISTORY_OPTIONS.includes(requestedHistory) ? requestedHistory : 48;
let forecastHours = 6;
let forecast = null;
let forecastPayload = null;
let historyAvailable = false;

function setText(id, value) {
  $(id).textContent = value;
}

function updateHistoryLocation() {
  const url = new URL(window.location.href);
  url.searchParams.set('history', historyHours);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function metres(value) {
  return Number(value).toFixed(2);
}

function ageLabel(time) {
  const minutes = Math.max(0, Math.round((Date.now() - time) / MINUTE));
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ${minutes % 60 ? `${minutes % 60} minutes ` : ''}ago`;
}

function trendFor(readings) {
  const latest = readings.at(-1);
  const target = latest.time - 60 * MINUTE;
  const comparator = readings.reduce((best, reading) => Math.abs(reading.time - target) < Math.abs(best.time - target) ? reading : best, readings[0]);
  if (!comparator || Math.abs(comparator.time - target) > 20 * MINUTE) return null;
  return { delta: latest.value - comparator.value, duration: Math.round((latest.time - comparator.time) / MINUTE) };
}

function applyGauge(payload) {
  historyAvailable = Boolean(payload.historySource && payload.historyWindowHours >= 48);
  series = (payload.observations || [])
    .map((reading) => ({ time: new Date(reading.observedAt).getTime(), value: Number(reading.heightMetres), quality: reading.qualityCode }))
    .filter((reading) => Number.isFinite(reading.time) && Number.isFinite(reading.value))
    .sort((a, b) => a.time - b.time);
  if (!series.length) throw new Error('No valid water-level observations were available.');

  const latest = series.at(-1);
  const live = payload.source === 'bom-ftp' && !payload.stale;
  const fresh = live && Date.now() - latest.time <= FRESHNESS_MINUTES * MINUTE;
  const trend = trendFor(series);
  const near = latest.value < THRESHOLD && trend && trend.delta > 0 && THRESHOLD - latest.value <= 0.2;
  // Keep a reported flood level urgent while making an ageing observation clear
  // in the accompanying copy. Red therefore reflects the latest BOM report,
  // not an assertion that a closure is current.
  const reportedFlood = live && latest.value >= THRESHOLD;
  const tone = reportedFlood ? 'danger' : !fresh ? 'unknown' : near ? 'warning' : 'normal';

  document.body.dataset.tone = tone;
  $('flood-banner').hidden = tone !== 'danger';
  setText('art-status', tone === 'danger' ? 'Do not cross' : tone === 'unknown' ? 'Status unconfirmed' : 'Your crossing');
  setText('art-caption', tone === 'danger' ? 'Flood threshold reached.' : tone === 'unknown' ? 'Awaiting a current observation.' : 'A little closer to the creek.');
  setText('level', metres(latest.value));
  setText('level-label', fresh ? 'Latest gauge height' : 'Last known gauge height');
  setText('observation-time', `${stamp(latest.time)} AEST`);
  setText('freshness', `Latest observation · ${ageLabel(latest.time)}`);
  setText('fetched-at', `Source checked · ${stamp(new Date(payload.fetchedAt))} AEST`);
  setText('page-time', stamp(new Date()));

  if (tone === 'danger') {
    setText('state-icon', '!');
    setText('state-label', fresh ? 'Flood threshold reached · Do not cross' : 'Flood level last reported');
    setText('status-message', fresh ? `${metres(latest.value - THRESHOLD)} m above the flood threshold.` : `${metres(latest.value - THRESHOLD)} m above the flood threshold when last observed.`);
    setText('status-detail', fresh ? 'The level may be falling, but the crossing remains unsafe at or above 1.49 m. Do not cross.' : 'This observation is no longer current. Treat the crossing as unsafe and check local conditions and closures before travelling.');
  } else if (tone === 'unknown') {
    setText('state-icon', '?');
    setText('state-label', 'Current conditions unconfirmed');
    setText('status-message', latest.value >= THRESHOLD ? 'Last known level was at or above the flood threshold.' : 'The last reading is no longer current.');
    setText('status-detail', 'Do not assume the crossing is clear. Check current local conditions and closures.');
  } else if (tone === 'warning') {
    setText('state-icon', '↗');
    setText('state-label', 'Rising toward the threshold');
    setText('status-message', `${metres(THRESHOLD - latest.value)} m below the flood threshold.`);
    setText('status-detail', 'Water is rising. Check the next observation and local conditions before travelling.');
  } else {
    setText('state-icon', '○');
    setText('state-label', 'Below flood threshold');
    setText('status-message', `${metres(THRESHOLD - latest.value)} m below the flood threshold.`);
    setText('status-detail', 'Below the threshold does not confirm the road is open. Check local conditions and closures.');
  }

  if (!fresh || !trend) {
    setText('trend-arrow', '—');
    setText('trend', !fresh ? 'Current trend unavailable' : 'Trend unavailable');
  } else {
    const direction = Math.abs(trend.delta) < 0.01 ? 'Steady' : trend.delta > 0 ? 'Rising' : 'Falling';
    setText('trend-arrow', direction === 'Rising' ? '↗' : direction === 'Falling' ? '↘' : '→');
    setText('trend', `${direction} · ${trend.delta >= 0 ? '+' : ''}${trend.delta.toFixed(2)} m over ${trend.duration} min`);
  }
  setText('source-status', payload.source === 'bom-ftp'
    ? payload.historySource
      ? `Live BOM gauge · ${payload.historyWindowHours || 'recent'}h history via Queensland Water Monitoring`
      : 'Live gauge data from BOM public FTP · Station 040813'
    : 'Gauge source unavailable · Last stored observations are not current');
  renderChart();
  renderEvents(fresh);
}

function renderChart() {
  const last = series.at(-1);
  const end = last.time;
  const start = end - historyHours * 60 * MINUTE;
  visible = series.filter((reading) => reading.time >= start && reading.time <= end);
  const width = Math.max(280, $('chart').getBoundingClientRect().width);
  const left = 38, right = width - 20, top = 24, bottom = 207;
  const high = Math.max(2.2, ...visible.map((reading) => reading.value), THRESHOLD + 0.2);
  const x = (time) => left + ((time - start) / (end - start)) * (right - left);
  const y = (value) => bottom - (value / high) * (bottom - top);
  const points = visible.map((reading) => `${x(reading.time).toFixed(1)},${y(reading.value).toFixed(1)}`);
  const area = `M${x(visible[0].time)},${bottom} L${points.join(' L')} L${x(last.time)},${bottom}Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((part, index) => {
    const time = start + (end - start) * part;
    const anchor = index === 0 ? 'start' : index === 4 ? 'end' : 'middle';
    return `<text x="${x(time)}" y="229" text-anchor="${anchor}">${fmtTime.format(time)}</text><text x="${x(time)}" y="246" text-anchor="${anchor}" style="font-size:9px">${fmtDate.format(time)}</text>`;
  }).join('');
  const lines = [0, 0.5, 1, 1.5, 2].filter((value) => value <= high).map((value) => `<line x1="${left}" y1="${y(value)}" x2="${right}" y2="${y(value)}" stroke="#ebebee"/><text x="${left - 10}" y="${y(value) + 3}" text-anchor="end">${value.toFixed(1)}</text>`).join('');
  $('chart').setAttribute('viewBox', `0 0 ${width} 260`);
  $('chart').innerHTML = `<title id="chart-title">Gauge heights over the last ${historyHours} hours</title><desc id="chart-description">Latest height ${metres(last.value)} metres. Unsafe crossing threshold 1.49 metres.</desc><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="var(--water)" stop-opacity=".20"/><stop offset="1" stop-color="var(--water-tail)" stop-opacity=".025"/></linearGradient></defs><text x="${left - 10}" y="14" text-anchor="end">m</text><rect x="${left}" y="${top}" width="${right - left}" height="${Math.max(0, y(THRESHOLD) - top)}" fill="#fff8f8"/>${lines}<path d="${area}" fill="url(#chart-fill)"/><line x1="${left}" y1="${y(THRESHOLD)}" x2="${right}" y2="${y(THRESHOLD)}" stroke="#c50000" stroke-opacity=".65" stroke-dasharray="5 5"/><text x="${left + 8}" y="${y(THRESHOLD) - 9}" class="threshold-label">1.49 m · do not cross</text><polyline points="${points.join(' ')}" stroke="var(--water)" stroke-width="2.5" fill="none" stroke-linejoin="round"/><circle cx="${x(last.time)}" cy="${y(last.value)}" r="8" fill="var(--water)" opacity=".12"/><circle cx="${x(last.time)}" cy="${y(last.value)}" r="4" fill="var(--water)" stroke="white" stroke-width="2"/>${ticks}<line id="crosshair" y1="${top}" y2="${bottom}" stroke="var(--water)" stroke-opacity=".35" stroke-dasharray="3 4"/><circle id="inspect-dot" r="4" fill="white" stroke="var(--water)" stroke-width="2"/>`;
  $('chart')._coords = { x, y, left, right, width, start, end };
  setText('chart-sub', `${stamp(start)} – ${stamp(end)} · AEST${historyHours > 24 ? payloadHistoryNote() : ''}`);
  $('inspect').max = visible.length - 1;
  $('inspect').value = visible.length - 1;
  inspect(Number($('inspect').value));
  document.querySelectorAll('[data-hours]').forEach((button) => button.setAttribute('aria-pressed', String(Number(button.dataset.hours) === historyHours)));
  setText('table-caption', `Latest available gauge observations · ${historyHours}h window · AEST`);
  $('data-table').innerHTML = visible.slice().reverse().map((reading) => `<tr><td>${stamp(reading.time)}</td><td>${metres(reading.value)} m</td><td>${reading.value >= THRESHOLD ? 'At or above' : 'Below'}</td></tr>`).join('');
}

function payloadHistoryNote() {
  return historyAvailable
    ? ' · historical observations supplied by Queensland Water Monitoring'
    : ' · limited to observations currently available';
}

function inspect(index) {
  const reading = visible[index];
  if (!reading) return;
  const { x, y } = $('chart')._coords;
  $('crosshair').setAttribute('x1', x(reading.time));
  $('crosshair').setAttribute('x2', x(reading.time));
  $('inspect-dot').setAttribute('cx', x(reading.time));
  $('inspect-dot').setAttribute('cy', y(reading.value));
  setText('inspect-value', `${stamp(reading.time)} · ${metres(reading.value)} m`);
  $('inspect').setAttribute('aria-valuetext', `${stamp(reading.time)} AEST, ${metres(reading.value)} metres`);
}

function renderEvents(fresh) {
  const events = [];
  series.forEach((reading, index) => {
    if (!index) return;
    const previous = series[index - 1];
    if (previous.value < THRESHOLD && reading.value >= THRESHOLD) events.push({ time: reading.time, title: 'Threshold reached', detail: `${metres(reading.value)} m · first observed at or above 1.49 m` });
    if (previous.value >= THRESHOLD && reading.value < THRESHOLD) events.push({ time: reading.time, title: 'Back below threshold', detail: `${metres(reading.value)} m · reopening unconfirmed` });
  });
  const peak = series.reduce((highest, reading) => highest.value > reading.value ? highest : reading);
  events.push({ time: peak.time, title: 'Available-history high', detail: `${metres(peak.value)} m at the reference gauge` });
  if (events.length < 3) {
    const latest = series.at(-1);
    events.push({ time: latest.time, title: fresh ? 'Latest observation' : 'Last known observation', detail: `${metres(latest.value)} m · ${fresh ? (latest.value >= THRESHOLD ? 'do not cross' : 'below the threshold') : 'current status unconfirmed'}` });
  }
  const selected = events.sort((a, b) => a.time - b.time).slice(-3);
  setText('events-label', 'Observed events');
  $('event-items').innerHTML = selected.map((event) => `<article class="event"><p class="mono">${stamp(event.time)} AEST</p><h3>${event.title}</h3><p>${event.detail}</p></article>`).join('');
}

function weatherHeadline(hourly) {
  const rain = hourly.reduce((sum, item) => sum + item.amount, 0);
  const maxChance = Math.max(...hourly.map((item) => item.chance));
  if (rain === 0 && maxChance < 20) return 'Little rain expected in this period.';
  if (maxChance >= 70) return 'Rain is likely in the period ahead.';
  return 'Showers are possible in the period ahead.';
}

function renderWeather(payload) {
  if (payload.unavailable || !payload.hourly?.time?.length) throw new Error(payload.message || 'Forecast unavailable');
  forecastPayload = payload;
  forecast = payload.hourly.time.map((time, index) => ({ time: asAest(time).getTime(), amount: Number(payload.hourly.precipitation?.[index] || 0), chance: Number(payload.hourly.precipitation_probability?.[index] || 0) }));
  const visibleForecast = forecast.slice(0, forecastHours);
  const total = visibleForecast.reduce((sum, item) => sum + item.amount, 0);
  const maxAmount = Math.max(1, ...visibleForecast.map((item) => item.amount));
  setText('forecast-source', `${payload.source} forecast · crossing location`);
  setText('rain-headline', weatherHeadline(visibleForecast));
  setText('rain-period', `${stamp(visibleForecast[0].time)} – ${stamp(visibleForecast.at(-1).time + 60 * MINUTE)} AEST`);
  setText('rain-total', total.toFixed(1));
  setText('rain-total-label', `${forecastHours}-hour forecast total`);
  setText('rain-key', 'Bars: forecast precipitation for each hour · Percentages: chance of rain in that hour');
  setText('weather-meta', `Forecast checked · ${stamp(new Date(payload.fetchedAt))} AEST · Source: ${payload.source}`);
  $('rain-columns').style.setProperty('--columns', visibleForecast.length);
  $('rain-columns').innerHTML = visibleForecast.map((item, index) => `<button class="rain-column" data-rain-index="${index}" aria-pressed="false" aria-label="${stamp(item.time)}, ${item.amount.toFixed(1)} millimetres, ${item.chance} percent chance of rain"><span class="amount">${item.amount.toFixed(1)}</span><span class="rain-track"><span class="rain-bar" style="height:${Math.max(3, item.amount / maxAmount * 100)}%"></span></span><span class="rain-time">${fmtTime.format(item.time)}</span><span class="rain-chance">${item.chance}%</span></button>`).join('');
  document.querySelectorAll('[data-rain-index]').forEach((button) => button.addEventListener('click', () => inspectRain(Number(button.dataset.rainIndex))));
  document.querySelectorAll('[data-rain-hours]').forEach((button) => button.setAttribute('aria-pressed', String(Number(button.dataset.rainHours) === forecastHours)));
  inspectRain(visibleForecast.reduce((best, item, index) => item.amount > visibleForecast[best].amount ? index : best, 0));
}

function inspectRain(index) {
  const reading = forecast?.slice(0, forecastHours)[index];
  if (!reading) return;
  setText('rain-inspection', `${stamp(reading.time)}–${fmtTime.format(reading.time + 60 * MINUTE)} AEST · ${reading.amount.toFixed(1)} mm · ${reading.chance}% chance of rain`);
  document.querySelectorAll('[data-rain-index]').forEach((button) => button.setAttribute('aria-pressed', String(Number(button.dataset.rainIndex) === index)));
}

function gaugeError(error) {
  document.body.dataset.tone = 'unknown';
  $('flood-banner').hidden = true;
  setText('source-status', 'Gauge data unavailable · BOM source could not be reached');
  setText('fetched-at', 'Source check failed');
  setText('state-icon', '?');
  setText('state-label', 'Current conditions unavailable');
  setText('level', '—');
  setText('level-label', 'Gauge height unavailable');
  setText('trend-arrow', '—');
  setText('trend', 'Trend unavailable');
  setText('status-message', 'Check local conditions before travelling.');
  setText('status-detail', 'The current gauge reading could not be loaded. Do not infer that the crossing is clear.');
  setText('observation-time', 'No current observation');
  $('chart').innerHTML = `<title id="chart-title">Gauge history unavailable</title><text x="50%" y="130" text-anchor="middle" class="empty-chart">Gauge history is unavailable.</text>`;
  setText('chart-sub', error.message || 'No response from BOM');
  $('event-items').innerHTML = '<article class="event"><h3>Events unavailable</h3><p>No current gauge history was received.</p></article>';
}

function weatherError(error) {
  setText('forecast-source', 'Forecast unavailable');
  setText('rain-headline', 'Rain outlook unavailable.');
  setText('rain-period', 'The forecast source did not respond.');
  setText('rain-total', '—');
  setText('rain-total-label', 'forecast unavailable');
  setText('rain-key', 'No rainfall forecast is available right now.');
  setText('rain-inspection', error.message || 'Try again later.');
  setText('weather-meta', 'Forecast source unavailable');
  $('rain-columns').innerHTML = '';
}

function initializeMap() {
  const map = document.querySelector('.river-art');
  if (!map || map.querySelector('.osm-map')) return;
  map.removeAttribute('aria-hidden');
  map.setAttribute('role', 'region');
  map.setAttribute('aria-label', 'OpenStreetMap view centred on the Haven Road crossing');

  const frame = document.createElement('iframe');
  frame.className = 'osm-map';
  frame.title = 'OpenStreetMap view of Haven Road crossing';
  frame.loading = 'lazy';
  frame.src = 'https://www.openstreetmap.org/export/embed.html?bbox=152.8835%2C-27.4935%2C152.8930%2C-27.4880&layer=mapnik&marker=-27.490805008469277%2C152.88833798916386';

  const wash = document.createElement('div');
  wash.className = 'map-flood-wash';
  wash.setAttribute('aria-hidden', 'true');

  // The embedded OpenStreetMap view includes the required contributor credit.
  map.prepend(frame, wash);
  setText('art-caption', 'Map centred on the crossing.');
}

async function load() {
  const [gauge, weather] = await Promise.allSettled([
    fetch('/api/gauge').then(async (response) => {
      const data = await response.json();
      if (!response.ok && !data.observations) throw new Error(data.sourceError || 'Gauge request failed');
      return data;
    }),
    fetch('/api/weather').then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Forecast request failed');
      return data;
    })
  ]);
  if (gauge.status === 'fulfilled') applyGauge(gauge.value); else gaugeError(gauge.reason);
  if (weather.status === 'fulfilled') renderWeather(weather.value); else weatherError(weather.reason);
}

document.querySelectorAll('[data-hours]').forEach((button) => button.addEventListener('click', () => {
  historyHours = Number(button.dataset.hours);
  updateHistoryLocation();
  if (series.length) renderChart();
}));
$('inspect').addEventListener('input', (event) => inspect(Number(event.target.value)));
$('chart').addEventListener('pointermove', (event) => {
  const coords = $('chart')._coords;
  if (!coords || !visible.length) return;
  const box = $('chart').getBoundingClientRect();
  const sx = (event.clientX - box.left) / box.width * coords.width;
  const target = coords.start + Math.max(0, Math.min(1, (sx - coords.left) / (coords.right - coords.left))) * (coords.end - coords.start);
  const index = visible.reduce((best, reading, current) => Math.abs(reading.time - target) < Math.abs(visible[best].time - target) ? current : best, 0);
  $('inspect').value = index;
  inspect(index);
});
document.querySelectorAll('[data-rain-hours]').forEach((button) => button.addEventListener('click', () => { forecastHours = Number(button.dataset.rainHours); if (forecastPayload) renderWeather(forecastPayload); }));
window.addEventListener('resize', () => { if (series.length) renderChart(); });
initializeMap();
updateHistoryLocation();
load();
setInterval(load, 5 * 60 * 1000);
