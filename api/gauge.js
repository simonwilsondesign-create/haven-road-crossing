const ftp = require('basic-ftp');
const { Writable } = require('stream');
const snapshot = require('../gauge-data-snapshot.json');

const STATION_ID = '040813';
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
    cached = await fromBomFtp();
    cachedAt = Date.now();
    return response.status(200).json(cached);
  } catch (error) {
    const degraded = fallback(error instanceof Error ? error.message : 'BOM FTP unavailable');
    return response.status(503).json(degraded);
  }
};
