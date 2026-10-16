# Miles & More Status Tracker

A no-dependency web app (plain HTML, CSS and JavaScript, no build step) to track and plan your
Miles & More status per calendar year (CY): Points, Qualifying Points (QP) and HON Circle Points.

## Features

- **Flight log per CY**: booking code, flight date, flight number, airline (taken from the flight number),
  booked class, upgrade class (defaults to the booked class), upgrade paid, flight cost, upgrade cost.
- **Route lookup** from the flight number via [adsbdb.com](https://www.adsbdb.com) (free, no API key).
  The origin and destination airports decide whether a flight is **continental** (short-haul) or
  **intercontinental** (long-haul). You can override the haul, or enter the airports manually.
- **Points engine**: earns on the booked class, or on the upgrade class when the upgrade was paid.
  - Lufthansa Group airlines (LH, LX, OS, SN, EW, EN, 4Y, WK, …): Points, QP and HON Circle Points
  - Star Alliance partners: Points only
  - Other airlines: nothing
- **Planning mode**: any flight dated in the future counts as planned. The forecast shows the date you
  reach each status. Each planned flight can be left out of the forecast to try what-if scenarios.
  A planner works out how many more segments you need.
- **Point corrections** (Flights tab): add manual adjustments of Points, QP and HON Circle Points with a
  date and a remark, e.g. a retro credit or a deduction from your account statement. Negative values are
  allowed. Corrections count in all totals, status dates, charts and forecasts, and are saved in the `.json`.
- **CO₂ compensation boosters** per flight (Small / Medium / Large / X-Large), with a CO₂ cost column
  that appears as soon as one flight uses a booster.
- **Dashboard**: KPI tiles, status progress (flown and forecast), cumulative P/QP/HON charts with status
  thresholds, costs per month, a segment breakdown, and a history table by year with each status and
  its validity.
- **Save / Load `.json`**: the file holds your flights, your settings and every route lookup the app
  made so far (`apiCache` with `queried: true` / `status`). When you load a saved file, the app reuses
  those answers and does not call the API again.
- **Light / dark mode** switch in the header (Light · System · Dark). System follows the OS setting.
  Your choice is remembered in this browser and is not saved in the `.json`. The layout is responsive.

## Default rules (editable in Settings)

| Per segment (Lufthansa Group) | Economy | Premium Economy | Business | First |
|---|---:|---:|---:|---:|
| Continental      | 20 | 20 | 40  | 40  |
| Intercontinental | 60 | 80 | 200 | 300 |

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

The tests expect `js/airports.js`, so build it first (see above).

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` downloads the current OurAirports data, builds `js/airports.js`, checks
the JavaScript syntax and runs the engine tests on every push and pull request. On pushes to `main`,
on manual runs and once a week (Monday, 03:17 UTC, to pick up fresh airport data) it also deploys the
site to GitHub Pages.

1. Push this folder to a GitHub repository (`main` branch).
2. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push again, or run the workflow by hand. The URL appears in the workflow's `deploy` job.

## Notes

- **Codeshares**: enter the operating flight in "Operated by" (e.g. UA9414 → `LH488`). If the operating
  airline belongs to the Lufthansa Group, the segment earns Points, QP and HON Circle Points like a
  Lufthansa Group flight. The app checks the operating flight's route and uses it when the marketing number
  has none. Route lookups try the IATA (`UA9414`) and the ICAO (`UAL9414`) form.
- adsbdb returns the route a flight number currently operates. If a flight number changed routes,
  correct the airports or the haul by hand in the dialog.
- Continental means both airports are in the same country or on the same continent (e.g. SEA–SFO,
  FRA–ZRH). For this rule, Europe includes the Mediterranean rim (North Africa, Levant, Turkey, Cyprus).
  Every other flight counts as intercontinental. You can override the haul per flight.
- adsbdb keeps one route per flight number and ignores the date. If an airline reused the number,
  the lookup can show the wrong route (e.g. UA2837 shows NRT–SFO). Type the airports by hand in that case.

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

[MIT](LICENSE)
