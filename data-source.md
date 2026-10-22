# Verified BOM dataset route

Checked 22 October 2026 (Australia/Brisbane). The dashboard now uses the sources below; this document records their roles and limits rather than a statement of current crossing conditions.

## What worked

BOM's website returned an explicit automated-access block for the requested plot page. That response directed automated clients to its anonymous FTP service. The public FTP catalogue was accessible, and the following files were retrieved successfully:

- `ftp://ftp.bom.gov.au/anon/gen/fwo/IDQ65910_20261021215300.hcs`
- `ftp://ftp.bom.gov.au/anon/gen/fwo/IDQ65911_20261021210800.hcs`

Both contain **station 040813**, sensor type `WL`, values in `metres`. The format identifies itself as **BOM-HCS 2.0**: comment headers followed by CSV records. Product IDQ65910 had one record for this station in the inspected file; IDQ65911 had a recent series. These are verified examples, not permanent filenames. Discover current files from the catalogue rather than hardcoding these timestamped names.

The inspected catalogue showed IDQ65910 files at 15-minute generation intervals and IDQ65911 files at hourly generation intervals. This is an observed publication pattern, not a guaranteed update SLA or sensor cadence. Individual observations were irregular. Fetching a new file does not necessarily produce a new gauge observation.

## Local snapshot

`gauge-data-snapshot.json` contains 22 unique station observations, deduplicated by timestamp, from these two files. Coverage is **22 October 2026, 04:10:01–07:00:01 AEST**, with heights from **0.669 m to 0.981 m** over that interval. The newest observation in this retrieved snapshot is **0.981 m at 07:00:01 AEST**. It is not a claim about the level now.

The JSON preserves UTC timestamps, Brisbane timestamps, original units, sensor metadata and the numeric quality code. `sensorParam1` is `LGH` and quality code is `1`; retain these values without assuming their meanings until checked against the product specification. File headers explicitly use UTC timestamps (`Z`). No missing readings have been interpolated into the snapshot.

## Production implications

The deployed Vercel endpoint reads the current BOM public-FTP products server-side and exposes JSON over HTTPS. Browsers do not access FTP directly. The endpoint additionally requests the preceding 48 hours of Stage data from Queensland's Water Monitoring Information Portal (WMIP), site `143032A`, then deduplicates matching timestamps in favour of the BOM reading. This extends the chart while retaining the BOM feed as the source for the current crossing state.

The matching portion of the owner-supplied series confirms the two feeds are compatible for this use: the recorded value at 12:00 AEST on 22 October was 1.81 m, matching the BOM feed. WMIP’s public API documentation describes the source as hourly data that may be transmitted more often during events; chart gaps and differing cadence are shown rather than interpolated. The chart labels all times as AEST.

Verify the HCS product specification, quality flags, datum, sensor selection, historical coverage and current gauge metadata before implementing the production adapter. The gauge-to-crossing threshold of 1.49 m remains owner supplied.

The [BOM FTP catalogue](https://www.bom.gov.au/catalogue/anon-ftp.shtml) describes the service and explicitly directs users who intend to publish Bureau data to Registered User arrangements. Confirm the applicable redistribution terms for a publicly hosted dashboard before deployment. Public download access alone does not establish public redistribution permission.

[BOM's observation notes](https://www.bom.gov.au/australia/flood/additional_notes.shtml) explain that these are operational observations, not fully quality controlled, and may be unavailable outside flood periods. Those limits make observation age and missing-data handling essential.

The static snapshot remains only as a degraded-mode fallback and is clearly identified as stale when used.

## Weather and radar addition

The owner supplied [BOM radar product IDR663](https://reg.bom.gov.au/products/IDR663.loop.shtml), verified as the **128 km Brisbane (Mt Stapylton) Radar Loop**. It is linked from the demo. The radar illustration in the demo is decorative; no actual radar frames have been downloaded, embedded or reprocessed.

The rain outlook is supplied by Open-Meteo at the crossing coordinates, with 6-hour and 24-hour views. Forecast and radar timestamps remain separate from gauge timestamps.
