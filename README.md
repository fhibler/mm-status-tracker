# Miles & More Status Tracker

A no-dependency web app (plain HTML, CSS and JavaScript, no build step) to track and plan your
Miles & More status per calendar year (CY): Points, Qualifying Points (QP) and HON Circle Points.

## Features

- **Activity log per CY** (flights, trains and buses): booking code, date, flight number, airline (taken from the flight number),
  booked class, upgrade class (defaults to the booked class), upgrade type (Fixed online / Fixed airport / Bid / Miles / Voucher / Operational), upgrade cost.
  Choose Flight, Train or Bus first; trains and buses only ask for what applies to them (no upgrades, codeshares or CO₂ compensation).
- **Fares per booking**: with a booking code, you enter the fare once for the whole booking. It is shown and counted once,
  as a single total on the booking's first segment (the first one that counts towards the forecast, if a planned
  segment is left out), so the cost charts, cost per QP and yearly totals put it in that segment's month and year.
  The booking's other segments show where the fare is. Upgrade and CO₂ costs stay per segment.
- **Route lookup** from the flight number via [adsbdb.com](https://www.adsbdb.com) (free, no API key).
  The origin and destination airports decide whether a flight is **continental** (short-haul) or
  **intercontinental** (long-haul). You can override the haul, or enter the airports manually.
- **Points engine**: earns on the booked class, or on the upgrade class for fixed-price (online or airport) and bid upgrades. Upgrades with miles, vouchers or operational upgrades earn on the booked class.
  - Lufthansa Group airlines and co-issuing partners (Air Dolomiti, Austrian, Brussels, Croatia, Discover,
    Eurowings, ITA, LOT, Lufthansa, Lufthansa City, Luxair, SWISS): Points, QP and HON Circle Points
  - Star Alliance airlines: Points only
  - Other airlines: nothing
- **Planning mode**: any flight dated in the future counts as planned. The forecast shows the date you
  reach each status. Each planned flight can be left out of the forecast to try what-if scenarios.
  Planned flights also count when the history decides which status you carry into the next year.
- **Planner tab**: build a what-if scenario per calendar year on top of your forecast, saved in the `.json`:
  - **Extra segments**: a mix of rows like 2 × Business continental + 4 × Premium Economy intercontinental with a
    Medium booster, Star Alliance flights (Points only) or trains, each with an estimated cost per segment.
  - **CO₂ compensation**: try a booster on any existing or planned flight and see the extra Points, or set one for
    all flown, planned or all flights at once (optionally only those that earn HON Circle Points). The cost is
    prefilled with an estimate of the lufthansa.com price (see below), else with the average you paid. "Apply" saves
    the booster to the flight.
  - The result shows Points, QP, HON, status and cost after each step, what is still missing per status, and how many
    more segments of one type would close the gap.
- **CO₂ price estimate** (`MM.CO2_PRICE` in `js/data.js`): when you pick a booster, in the flight dialog or the
  planner, the cost is prefilled with the estimated lufthansa.com price until you type your own. It is fitted
  to 16 flights seen in Oct 2026 (all four packages each). The packages are 5 / 20 / 50 / 80 % SAF and priced as
  fixed multiples of Medium (Small 0.476×, Large 2.047×, X-Large 3.094×). Medium for Business grows with
  √distance on continental flights and per km on long-haul; other cabins are a factor on Business by the cabin flown
  (an upgrade is priced in the upgraded cabin): continental Economy 0.695×, long-haul First 1.307× (one sample, rough).
  It is within about 1 % on all samples; distances outside the samples are rough; long-haul Economy and Premium
  Economy have no estimate yet. Only used when the currency is EUR. Details and the samples:
  [docs/CO2-PRICE-MODEL.md](docs/CO2-PRICE-MODEL.md).
- **Starting status** (Settings): the status you already hold and the year it was earned (from your
  statement), so the first tracked year shows the right "status held", validity and downgrade.
- **Marriott Bonvoy stays** (Activity tab): with linked accounts, each qualifying stay of at least two nights
  earns 40 Points (no QP / HON), up to 120 Points per calendar year. The values are editable in Settings.
- **Point corrections** (Activity tab): add manual adjustments of Points, QP and HON Circle Points with a
  date and a remark, e.g. a retro credit or a deduction from your account statement. Negative values are
  allowed. Corrections count in all totals, status dates, charts and forecasts, and are saved in the `.json`.
- **CO₂ compensation boosters** per flight (Small / Medium / Large / X-Large), with a CO₂ cost column
  that appears as soon as one flight uses a booster.
- **Dashboard**: KPI tiles, status progress (flown and forecast), cumulative P/QP/HON charts with status
  thresholds, costs per month, a segment breakdown, and a history table by year with each status and
  its validity.
- **Save / Load `.json`**: the file holds your flights and fares, point corrections, hotel stays, planner
  scenarios, your settings and every route lookup the app made so far (`apiCache`, with a `status` per flight
  number and date). When you load a saved file, the app reuses those answers and does not call the API again
  (except for a provisional route, see Notes). Lookups saved before 18 Oct 2026 had no date and are dropped on load;
  the routes stored with your flights stay. Files in the old format (version 1, saved
  before the fares-per-booking update of 16 Oct 2026) can no longer be loaded.
  With your Miles & More number set in Settings, the file is named `miles-and-more-<number>.json`.
- **Light / dark mode** switch in the header (Light · System · Dark). System follows the OS setting.
  Your choice is remembered in this browser and is not saved in the `.json`. The layout is responsive.

## Default rules (editable in Settings)

| Per segment (Lufthansa Group) | Economy | Premium Economy | Business | First |
|---|---:|---:|---:|---:|
| Continental      | 20 | 20 | 40  | 40  |
| Intercontinental | 60 | 80 | 200 | 400 |

HON Circle Points are earned only in Business and First.

| Status | Requirement within one calendar year |
|---|---|
| Frequent Traveller | 650 Points, incl. 325 QP |
| Senator | 2,000 Points, incl. 1,000 QP |
| HON Circle | 6,000 HON Circle Points |

A status is valid from the day you reach it until the end of February of the year after next.
For example, a status reached in June 2026 is valid until 28 Feb 2028.
If you don't requalify in the following year, you land one level lower from March
(HON Circle → Senator → Frequent Traveller → Base); this repeats for each further year without requalification.

| CO₂ booster | Points | QP | HON |
|---|---:|---:|---:|
| Small   | +5%  | +5%  | +5%  |
| Medium  | +20% | +20% | +20% |
| Large   | +50% | +50% | +20% |
| X-Large | +80% | +80% | +20% |

The rules are based on the Miles & More programme as of 2024–2026. Check the official terms before you rely on them.

## Run locally

Open `index.html` directly in a browser, or serve the folder:

```bash
powershell -ExecutionPolicy Bypass -File tools/serve.ps1
```

Then open http://localhost:8765. Your data also autosaves to the browser's localStorage.

The airport table `js/airports.js` is generated, not committed. Build it once to resolve airports
you type by hand (without it, only airports from route lookups are known):

```bash
powershell -ExecutionPolicy Bypass -File tools/build-airports.ps1
```

## Tests

```bash
node tests/engine.test.js
```

The tests expect `js/airports.js`, so build it first (see above). Without Node, serve the folder and open
http://localhost:8765/tests/browser.html to run the same tests in the browser.

To update airline or points rules, follow [docs/UPDATING-RULES.md](docs/UPDATING-RULES.md).

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` downloads the current OurAirports data, builds `js/airports.js`, checks
the JavaScript syntax and runs the engine tests on every push and pull request. On pushes to `main`,
on manual runs from `main` and once a week (Monday, 03:17 UTC, to pick up fresh airport data) it also deploys the
site to GitHub Pages.

1. Push this folder to a GitHub repository (`main` branch).
2. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push again, or run the workflow by hand. The URL appears in the workflow's `deploy` job.

## Notes

- **Codeshares**: enter the operating flight in "Operated by" (e.g. UA9414 → `LH488`). Miles & More credits by
  the **operating** airline: UA9414 operated by Lufthansa earns Points, QP and HON Circle Points, while LH9246
  operated by United earns Points only (Star Alliance). Exception: SWISS LX8000–8499 operated by Edelweiss
  earns like SWISS. When the marketing number has no route, the app uses the operating flight's route (in the
  dialog and in "Look up routes"). Route lookups try the IATA (`UA9414`) and the ICAO (`UAL9414`) form.
- adsbdb keeps one route per flight number (the one it currently operates) and ignores the date. The app caches
  each lookup per flight number and date, so an answer for one date is not reused for another. Airlines plan routes
  per IATA schedule season (summer from the last Sunday of March, winter from the last Sunday of October), and some
  fly a number on another route in the other season: LH1966 is MUC–OLB in summer and MUC–BER in winter. A route
  looked up in another season than the flight's is marked **check** in the flights table and explained in the
  dialog. Once the flight's season has started, "Look up routes" on the Flights page and "Look up route" in the
  dialog ask adsbdb again. If an airline reused or changed the number, the lookup can still show the wrong route
  (e.g. UA2837 shows NRT–SFO). Type the
  airports by hand, or set the haul, in the dialog in that case.
- Continental means both airports are in the same country or in the same Miles & More zone (e.g. SEA–SFO,
  FRA–ZRH). The zones follow Miles & More: Europe includes Algeria, Egypt, Libya, Morocco and Tunisia;
  Israel, Jordan and Lebanon belong to "Middle East and Asia" (so FRA–TLV is intercontinental); Greenland
  belongs to North America. Every other flight counts as intercontinental. You can override the haul per flight.
- **Trains** (Austrian AIRail, Lufthansa Express Rail, SWISS Air Rail; choose Train when adding a segment) earn like
  flights, but their QP / HON Circle Points count towards a status only up to 160 QP (Frequent Traveller),
  500 QP (Senator) and 1,000 HON (HON Circle). The limits can be changed in Settings. The **Lufthansa Express
  Bus** earns nothing, and neither do award flights and some special fares (set "Earning" to "No status credit").
- **Edelweiss** earns only on LX8000–8499 code-shares booked with SWISS under the LX number. Enter the LX number,
  with the WK flight under "Operated by" if you like.
- **Retro credits** count in the calendar year of the flight, so date a point correction on the flight date.
- Other Miles & More airline partners (Air Astana, Cathay Pacific, LATAM, Olympic Air) earn award miles
  only, so they count as "No status credit".

## Disclaimer

This is an independent, unofficial tool. It is not affiliated with, endorsed by, or sponsored by
Miles & More GmbH, Deutsche Lufthansa AG, Star Alliance or any airline. "Miles & More", "HON Circle",
"Lufthansa" and all other airline and product names are trademarks of their respective owners. They
are used here only to describe what the tool is compatible with.

Points, status dates and costs are estimates. The official Miles & More terms and your account
statement always apply. Route data comes from [adsbdb.com](https://www.adsbdb.com) and may be
incomplete or out of date. Airport data for routes you type by hand (5,400+ airports with an IATA
code) comes from [OurAirports](https://ourairports.com/data/), which is public domain.

## License

[MIT](LICENSE) © 2026 Florian Hibler · Source: [github.com/fhibler/mm-status-tracker](https://github.com/fhibler/mm-status-tracker)
