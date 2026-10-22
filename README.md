# Haven Road crossing watch

A small Vercel dashboard for the Haven Road creek crossing at **27.490805° S, 152.888338° E**. It uses the BOM Upper Brookfield TM reference gauge (station `040813`) and an owner-supplied unsafe-crossing threshold of **1.49 m**.

## What the dashboard shows

- Latest BOM public-FTP water-level observations, plotted against the 1.49 m threshold.
- A 48-hour historical window from Queensland Water Monitoring station `143032A`, merged with the faster BOM observations at matching timestamps.
- A high-visibility red flood state whenever the latest live BOM observation is at or above the threshold.
- An explicit freshness warning when the latest reading is old. A lower height does not declare the road open; local conditions and closures still need checking.
- Open-Meteo hourly precipitation and probability at the crossing coordinates, plus a link to the BOM Brisbane radar loop.

## Run locally

```sh
npm install
vercel dev --listen 8173
```

Then open `http://localhost:8173`.

## Validate and deploy

```sh
npm run check
vercel deploy --prod
```

The serverless gauge endpoint downloads the current `IDQ65910` and `IDQ65911` BOM files from the public anonymous FTP service. If that service cannot be reached, it returns the checked-in snapshot as an explicitly stale, unconfirmed state.

## Sources

- [BOM gauge page](https://www.bom.gov.au/fwo/IDQ65389/IDQ65389.040813.plt.shtml)
- [BOM Brisbane radar loop](https://reg.bom.gov.au/products/IDR663.loop.shtml)
- [Queensland Water Monitoring Information Portal API](https://water-monitoring.information.qld.gov.au/wini/Documents/WMIP_API_2025.pdf)
- [Open-Meteo Forecast API](https://open-meteo.com/en/docs)

`brief.md` records the product and interface brief; `data-source.md` records the data interpretation and fallback behaviour.
