const ftp = require('basic-ftp');
const { Writable } = require('stream');
const snapshot = require('../gauge-data-snapshot.json');

const STATION_ID = '040813';
const HISTORY_STATION_ID = '143032A';
const HISTORY_WINDOW_HOURS = 48;
const CACHE_MS = 5 * 60 * 1000;
let cached = null;
let cachedAt = 0;

function parseCsv(line) {
  const result = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { result.push(field); field = ''; }
    else field += char;
  }
  result.push(field);
  return result;
}

function parseHcs(body) {
  return body.split(/\r?\n/).flatMap((line) => {
    if (!line || line.startsWith('#')) return [];
    const row = parseCsv(line);
    if (row.length < 12 || row[1] !== 'WL' || row[4] !== STATION_ID || row[7] !== 'metres') return [];
    const heightMetres = Number(row[6]);
    const observedAt = new Date(row[5]);
    if (!Number.isFinite(heightMetres) || Number.isNaN(observedAt.getTime())) return [];
    return [{
      observedAt: observedAt.toISOString(),
      heightMetres,
      qualityCode: row[10],
      sensorParam: row[8] || null
    }];
  });
}

async function download(client, remotePath) {
  const chunks = [];
  const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk); callback(); } });
  await client.downloadTo(sink, remotePath);
  return Buffer.concat(chunks).toString('utf8');
}

async function latestFiles(client, prefix) {
  const list = await client.list('/anon/gen/fwo');
  return list
    .filter((file) => file.name.startsWith(prefix) && file.name.endsWith('.hcs'))
    .sort((a, b) => (b.name > a.name ? 1 : -1))
    .slice(0, 1);
}

async function fromBomFtp() {
  const client = new ftp.Client(12_000);
  client.ftp.verbose = false;
  try {
    await client.access({ host: 'ftp.bom.gov.au', user: 'anonymous', password: 'haven-road-crossing@vercel.app', secure: false });
    const files = [...await latestFiles(client, 'IDQ65910_'), ...await latestFiles(client, 'IDQ65911_')];
    const readings = [];
    for (const file of files) readings.push(...parseHcs(await download(client, `/anon/gen/fwo/${file.name}`)));
    const unique = [...new Map(readings.map((reading) => [reading.observedAt, reading])).values()]
      .sort((a, b) => new Date(a.observedAt) - new Date(b.observedAt));
    if (!unique.length) throw new Error('No water-level observations for station 040813 in current products.');
    return {
      source: 'bom-ftp',
      station: { id: STATION_ID, name: 'Upper Brookfield TM', stream: 'Moggill Creek' },
      fetchedAt: new Date().toISOString(),
      observations: unique.slice(-900)
    };
  } finally { client.close(); }
}

function brisbaneStamp(time) {
  const values = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(time).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
}

function qldTimeToIso(value) {
  const stamp = String(value).padStart(14, '0');
  return new Date(Date.UTC(
    Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1, Number(stamp.slice(6, 8)),
    Number(stamp.slice(8, 10)) - 10, Number(stamp.slice(10, 12)), Number(stamp.slice(12, 14))
  )).toISOString();
}

async function fromQldHistory() {
  const now = new Date();
  const request = {
    function: 'get_ts_traces', version: '2', params: {
      site_list: HISTORY_STATION_ID, datasource: 'AT', varfrom: '100.00', varto: '100.00',
      start_time: brisbaneStamp(new Date(now.getTime() - HISTORY_WINDOW_HOURS * 60 * 60 * 1000)),
      end_time: brisbaneStamp(now), data_type: 'point', interval: 'minute', multiplier: '1'
    }
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://water-monitoring.information.qld.gov.au/cgi/webservice.exe?${encodeURIComponent(JSON.stringify(request))}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Queensland history service returned ${response.status}`);
    const payload = await response.json();
    const trace = payload?.return?.traces?.[0];
    if (payload?.error_num || trace?.error_num || !Array.isArray(trace?.trace)) throw new Error(trace?.error_msg || payload?.error_msg || 'Queensland history service returned no trace');
    return trace.trace.map((reading) => ({
      observedAt: qldTimeToIso(reading.t), heightMetres: Number(reading.v),
      qualityCode: `QLD-${reading.q}`, sensorParam: 'Stage (Queensland WMIP)'
    })).filter((reading) => Number.isFinite(reading.heightMetres));
  } finally { clearTimeout(timeout); }
}

function mergeReadings(history, live) {
  // Values at matching timestamps come from the BOM live feed so the latest
  // safety state always retains its primary source and cadence.
  return [...new Map([...history, ...live].map((reading) => [reading.observedAt, reading])).values()]
    .sort((a, b) => new Date(a.observedAt) - new Date(b.observedAt));
}

function fallback(reason) {
  return {
    source: 'snapshot',
    stale: true,
    sourceError: reason,
    station: { id: STATION_ID, name: 'Upper Brookfield TM', stream: 'Moggill Creek' },
    fetchedAt: new Date().toISOString(),
    observations: snapshot.observations.map(({ observedAt, heightMetres, qualityCode, sensorParam1 }) => ({ observedAt, heightMetres, qualityCode, sensorParam: sensorParam1 || null }))
  };
}

module.exports = async (_request, response) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (cached && Date.now() - cachedAt < CACHE_MS) return response.status(200).json(cached);
  try {
    // Fetch the current BOM feed and the longer WMIP window concurrently so a
    // cold serverless request remains quick enough to return both datasets.
    const bomRequest = fromBomFtp();
    const historyRequest = fromQldHistory().catch((historyError) => ({ error: historyError }));
    cached = await bomRequest;
    const historyResult = await historyRequest;
    try {
      if (historyResult.error) throw historyResult.error;
      cached.observations = mergeReadings(historyResult, cached.observations);
      cached.historySource = 'Queensland Water Monitoring Information Portal · station 143032A';
      cached.historyWindowHours = HISTORY_WINDOW_HOURS;
    } catch (historyError) {
      cached.historySource = 'Recent BOM observations only';
      cached.historyError = historyError instanceof Error ? historyError.message : 'Queensland history service unavailable';
    }
    cachedAt = Date.now();
    return response.status(200).json(cached);
  } catch (error) {
    const degraded = fallback(error instanceof Error ? error.message : 'BOM FTP unavailable');
    return response.status(503).json(degraded);
  }
};
