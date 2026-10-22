const LATITUDE = -27.490805008469277;
const LONGITUDE = 152.88833798916386;

module.exports = async (_request, response) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=900');
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      latitude: String(LATITUDE),
      longitude: String(LONGITUDE),
      hourly: 'precipitation,precipitation_probability,rain',
      forecast_hours: '24',
      timezone: 'Australia/Brisbane'
    }).toString();
    const upstream = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!upstream.ok) throw new Error(`Weather source returned ${upstream.status}`);
    const data = await upstream.json();
    return response.status(200).json({
      source: 'Open-Meteo',
      fetchedAt: new Date().toISOString(),
      latitude: LATITUDE,
      longitude: LONGITUDE,
      hourly: data.hourly,
      hourlyUnits: data.hourly_units
    });
  } catch (error) {
    return response.status(503).json({
      source: 'Open-Meteo',
      unavailable: true,
      fetchedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : 'Weather forecast unavailable'
    });
  }
};
