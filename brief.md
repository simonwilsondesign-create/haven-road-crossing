# Haven Road crossing — design & build brief

## Purpose

A calm, beautifully legible dashboard for people deciding whether to use the Haven Road crossing. Within five seconds, answer: what is the latest gauge height, is it rising or falling, has it reached the crossing's flood threshold, and has it dropped below that threshold again?

Deliver a responsive public website hosted on **Vercel**. This stage supplies an interactive, self-contained `demo.html` for design review; it uses fictional observations and makes no live requests. The production build and deployment are a subsequent stage.

## Place, source and threshold

- **Crossing:** Haven Road, at **-27.490805008469277, 152.88833798916386**, as supplied by the owner. [View the crossing](https://www.google.com/maps/search/?api=1&query=-27.490805008469277%2C152.88833798916386).
- **Reference gauge:** BOM station **040813**, listed as **Upper Brookfield TM, Moggill Creek**, AWRC 143032 in the [BOM Queensland station index](https://www.bom.gov.au/qld/flood/networks/section3.shtml). The index is dated 2022; confirm current metadata during integration.
- **Requested observation source:** [BOM river-height plot](https://www.bom.gov.au/fwo/IDQ65389/IDQ65389.040813.plt.shtml). Follow-up investigation verified station 040813 readings in BOM's public FTP products **IDQ65910 / IDQ65911**, in BOM-HCS 2.0 format. See `data-source.md` and `gauge-data-snapshot.json`. The plot blocks automated access; use the supported data service. Full product semantics, operational cadence and publication terms still need confirmation.
- **Unsafe threshold: gauge height ≥ 1.49 m**, supplied by the owner. Equality is unsafe. This is a local crossing threshold, not a BOM minor/moderate/major flood category. It is gauge height, not measured water depth over the road. Do not label the difference as road clearance.
- The crossing and reference gauge are separate locations. Confirm the gauge-to-crossing relationship and the threshold before public launch. Preserve the supplied crossing coordinates exactly in map links and configuration.

## Visual direction: a small observatory for the creek

Use `design.md` as the foundation: near-white canvas, ink typography, thin borders, geometric sans, monospaced metadata and generous space. Make it feel like a useful local instrument, with the care of a weather publication.

The main number is the visual anchor. Pair it with a concise condition statement and an abstract creek illustration. The illustration is explicitly schematic, not a map or a representation of road inundation. Use blue and cyan for water, violet for supporting details, amber for approaching the threshold, and red for the unsafe state. Pink appears only as a very faint atmospheric accent. Concentrate gradients in the illustration; keep warnings and text on solid surfaces.

| Element | Direction |
| --- | --- |
| Canvas / ink | `#fafafa` / `#171717` |
| Water | `#0070f3`, `#50e3c2`, pale blue fills |
| Secondary accent | `#7928ca`, faint violet and pink glow |
| Caution | `#ab570a` text, `#ffefcf` background |
| Unsafe | `#c50000` text, soft red background |
| Typography | Geist / system sans, weights 400–600; Geist Mono / system mono for measurements and timestamps |
| Surfaces | 12–16 px corners, 1 px hairlines, almost no shadow |

Avoid a traffic-light “safe” signal, celebratory flood animations, decorative gauges with misleading precision, or countdowns to reopening. The level, direction and state must remain readable without colour.

## Screen structure

1. **Header:** simple waterline mark, Haven Road identity, crossing map link and BOM source link.
2. **Context:** “Haven Road crossing”, Moggill Creek reference gauge and observation freshness. In the demo, a persistent “Demo · sample data” strip and scenario selector remain obvious.
3. **Hero:** status, latest height in metres, signed change over one hour, distance above/below 1.49 m, observation date/time and short action-oriented explanation. The unsafe action appears at the top when the threshold is met.
4. **History:** 6-hour, 24-hour and 72-hour ranges. Blue observation line, labelled dashed 1.49 m threshold, faint unsafe region, units, local dates and times. Show missing intervals as gaps. Hover/touch/keyboard inspection and an accessible data table reveal individual observations.
5. **Crossing details:** exact map location, reference station and a compact explanation of the threshold.
6. **Recent changes:** observed threshold entry, peak and return below threshold, with timestamps. Never manufacture an event before retained history begins.
7. **Source and method:** freshness, gauge versus road distinction, owner-provided threshold and the advice to obey closures and never enter floodwater.

On mobile, place status, level, trend and observation age before the illustration. Stack the history and detail panels, retain comfortable touch targets, and reduce nonessential decoration. No horizontal page scrolling at 360 px.

## State and transition rules

Treat **gauge condition**, **data freshness** and **road reopening** as distinct facts.

| State | Rule / presentation |
| --- | --- |
| Below threshold | Fresh validated height < 1.49 m. “Below flood threshold”, with the difference in metres and trend. Never infer that the road is open. |
| Rising toward threshold | Below 1.49 m with a positive trend; emphasise caution within a proposed 0.20 m watch band. This watch band is a product setting, not an additional official threshold. |
| Flood threshold reached | Fresh validated height ≥ 1.49 m. “Flood threshold reached. Do not cross.” Remains unsafe even if the level is falling. |
| Back below threshold | A fresh below-threshold observation following an above-threshold event. “Back below threshold. Road reopening unconfirmed.” Show the first observed return time. |
| Reopening confirmed | Only if a trusted road-status source or authorised manual confirmation becomes available. Show its source and timestamp; a fresh ≥1.49 m reading or an active closure overrides an old reopening confirmation. This input is outside the initial gauge-only MVP. |
| Stale / unavailable | Current condition is unknown. Retain a clearly labelled last reading and timestamp if available; suppress current trend and all-clear implications. If last known flooded, retain “Last known above threshold; do not assume clear.” Never replace missing data with zero or sample data. |

Proposed production rules: polling every five minutes where the source permits; freshness cutoff initially 30 minutes, reviewed against the verified gauge cadence. Freshness is measured from observation time, not fetch time. Show both. A successful fetch of an old observation must not reset its age. Recompute age in the open browser and on refocus.

Use two distinct fresh observations below the threshold, spanning at least 15 minutes, before marking a flood event's below-threshold recovery as sustained. Immediately show the first return as provisional. This reduces state flicker without delaying unsafe warnings. Neither transition confirms physical road reopening. New ≥1.49 m observations immediately restore the unsafe state.

Trend: difference between the latest valid observation and a valid observation approximately one hour earlier, with a documented tolerance of ±15 minutes; show the actual interval if not exactly an hour. Do not interpolate across missing data for the trend. Use “steady” for absolute changes below a proposed 0.01 m tolerance; use “trend unavailable” if coverage is insufficient. No extrapolated flood or reopening time in the MVP.

Record crossings at the first observation on the new side of the threshold, labelled “first observed”; the physical crossing happened between samples. If history starts above threshold, report “already above at first observation” rather than inventing a start time. Observation revisions should update derived events consistently.

## Production implementation on Vercel

Use Next.js and TypeScript with a small server-side source adapter and a simple responsive interface. Start the integration spike with the verified FTP products documented in `data-source.md`; do not scrape the plot page. Verify station, units, datum, timestamps, quality flags, cadence and publication/reuse requirements. Confirm FTP connectivity from the chosen Vercel runtime or use a separate ingestion worker feeding cached JSON to Vercel. Browsers consume the HTTPS read API.

An authenticated scheduled function fetches observations, validates them, and upserts by station and observation time into managed persistent storage. Keep the source's precision and raw timestamp alongside normalised UTC time. Render in `Australia/Brisbane` (AEST). Reject invalid or future timestamps, wrong station IDs, missing units and non-finite values; do not reject negative gauge heights merely because they are negative. Deduplicate repeated samples and support corrected observations.

The public read-only endpoint serves the most recent validated data, freshness metadata, range history and derived events. Use bounded timeouts, retry/backoff, shared caching and explicit failure states. Avoid a new upstream request for every visitor. Retain at least 90 days of history; define retention and event-storage policy during build. Do not assume a single BOM response provides all requested ranges.

[Vercel Cron](https://vercel.com/docs/cron-jobs) can invoke Vercel Functions. Verify the selected plan's allowed frequency and timing before selecting a five-minute schedule; use an appropriate plan or external scheduler if needed. No free-tier frequency promise is made here. Separate preview data from production data, keep credentials server-side, and monitor ingestion failures and stale gauges.

MVP excludes accounts, subscriptions, push notifications, route recommendations and reopening forecasts. Later alerts may notify on meaningful threshold changes and sustained return below threshold, with explicit user opt-in and no repeated alerts for the same observation.

## Acceptance criteria

- 1.48 m is below threshold; **1.49 m and 1.50 m are unsafe**. Compare original numeric values, not rounded display text; if rounding could mislead at the boundary, display extra precision.
- Falling-but-still-flooded remains unsafe. First recovery and sustained recovery do not say “safe to cross”. Stale readings never produce an all-clear.
- Gauge identity, datum/units, source extraction, timestamp parsing and real update cadence have been verified against BOM before launch.
- History, hero, trend and event timestamps agree; chart ranges affect history, not the latest reading. Missing data and failed fetches remain explicit.
- Freshness updates while the page stays open, even if polling fails. Unknown, no-history, duplicate, corrected, out-of-order and partial responses are handled.
- Keyboard access, visible focus, meaningful status text, chart description/table alternative, reduced-motion support and accessible contrast; responsive checks at 360, 390, 768 and 1440 px.
- Production uses actual observations only. A test suite covers threshold equality, state transitions, stale data and event derivation. Source and threshold provenance are visible.

## Review the supplied demo

Open `demo.html` directly in a browser; it has no build step or external asset dependencies. The scenario selector demonstrates below-threshold, rising, exact-threshold, flooded, recovered and stale states. Range controls, observation inspection, data table and location/source links work. Fictional observations use a fixed demonstration clock of **22 October 2026, 08:30 AEST**. They are design fixtures, not historical records or a report of current conditions.

The demo deliberately shows a gauge-only recovery, with road reopening unconfirmed. The full build should preserve that distinction unless an independently verified road-status input is added.

## Revision 02 — rain outlook and unmistakable flood status

Add a weather section immediately after the gauge history, with two complementary panels:

- **Rain outlook:** upcoming 6-hour and 24-hour periods, forecast rainfall amounts, probability of rain for each period, a concise description of the expected change, and the forecast's issue time and valid period. Use violet to distinguish future weather from observed water levels. Label hourly versus three-hourly totals explicitly. Each period supports keyboard/touch inspection. Forecast amounts and chance of rain are separate quantities; do not add probabilities or imply an hourly maximum is the probability for the entire day.
- **Radar:** link to the owner's [128 km Brisbane / Mt Stapylton radar loop, IDR663](https://reg.bom.gov.au/products/IDR663.loop.shtml). Radar is recent observed weather, not a forecast. The demo contains a decorative radar illustration and a working source link, not an embedded or simulated radar loop. A production embedded radar layer requires a supported/licensed imagery source, geographic registration, visible frame times and independent freshness handling. Retain the source link as a fallback if imagery is unavailable.

The demo forecast values are explicitly fictional and remain independent of the selected river scenario. Six-hour totals cover six hourly periods from 09:00 AEST; the 24-hour view covers eight three-hour periods from the same start. These are design fixtures, not BOM forecasts. Select a permitted forecast provider for the exact crossing location during the build, document the resolution and uncertainty, and show its attribution. Prefer rainfall context for the upstream catchment too, once its boundary is verified; rain at the road alone does not describe the catchment response.

Forecast and radar freshness are independent of the gauge's freshness. Missing weather data should say “Forecast unavailable”; never substitute demo values, zeros or a sunny icon. A weather outage must not hide valid gauge warnings. Lower forecast rain must not clear a flood status or imply a reopening time. No rainfall-to-river-height conversion or reopening prediction is included.

For a fresh gauge reading **at or above 1.49 m**, use a strong red “Flood threshold reached. Do not cross.” banner, a red height and unit, red chart line and fill, and a red creek in the location schematic. Give the schematic pin a “Do not cross” label. Keep the threshold line and numerical axes visible. Red on the creek represents the crossing's gauge-based status, not a surveyed inundation extent; label the graphic accordingly. Do not recolour actual radar reflectivity, whose colours have meteorological meaning.

Use words and iconography alongside colour, without flashing. Falling-but-still-above-threshold stays red. On recovery below threshold, restore the normal water colours while explicitly retaining “Road reopening unconfirmed”. Stale data changes to unknown, preserving the last-known flood warning in text rather than presenting it as a fresh observation.

Check that both 1.49 m and the flooded/falling scenario activate all warning treatments, switching back removes them, forecast range controls do not change the river history, and the weather cards remain usable at mobile widths.
