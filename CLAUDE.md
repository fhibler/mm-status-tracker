# Miles & More Status Tracker – notes for Claude

A dependency-free web app (plain HTML/CSS/JS, no build step) that tracks and forecasts Miles & More status.
It is deployed to GitHub Pages by `.github/workflows/deploy.yml`.

## Layout

- `js/data.js`: airlines and earning groups, zones, default rules (`MM.DEFAULT_RULES`), CO₂ price model (`MM.CO2_PRICE`, see `docs/CO2-PRICE-MODEL.md`)
- `js/engine.js`: pure calculation logic (earning, haul, status, history, rail caps, soft landing, fares per booking, CO₂ price estimate, planner scenarios). Functions that depend on the date take `today` as a parameter
- `js/store.js`: state (`flights`, `bookings`, `adjustments`, `stays`, `plans`, `apiCache`), `S.normalize` (fills defaults, resets invalid choice fields, drops invalid entries; no migrations), `S.parse` (refuses other files and older versions), `.json` import/export, `S.saveFlight` / `S.deleteFlight`, demo data
- `js/api.js`: route lookup via AeroDataBox (by date, with the user's key from `state.settings.aerodataboxKey`, called directly via API.Market or via RapidAPI as `state.settings.aerodataboxVia` says (`A.ADB_VIA`), both saved in the `.json`) and adsbdb.com, with a cache per flight number and date (`A.cacheKey`) that is saved in the `.json`, provisional answers from another IATA season (`A.isProvisional`, `E.iataSeason`), and codeshares, which ask the operating flight first and fall back to the marketing number (`A.resolveRoute`). AeroDataBox answers also carry the departure and arrival times (UTC and local) and the aircraft, which a flight keeps in `f.times` (`A.timesFromCache`, `E.flightTimes`); adsbdb knows neither. AeroDataBox can list several routes for one number on a date (`A.legs`); the flight's airports pick one (`A.legIndex`), and the dialog offers a choice. Flights on the same day are sorted by departure in UTC (`E.byDeparture`)
- `js/app.js`, `js/charts.js`: UI and SVG charts
- `js/airports.js`: generated in CI by `tools/build-airports.ps1` and git-ignored
- `tests/engine.test.js` (Node, run by CI), plus `tests/browser.html` to run the same tests in a browser

## Updating Miles & More rules or airline data

Follow **[docs/UPDATING-RULES.md](docs/UPDATING-RULES.md)**. It covers the sources, how to read them (the
pages are behind a bot check, so use the built-in browser and never bypass it), what to compare, which files
to change, and what to do about saved user data when a default changes.

## Working here

- No Node or Python on the dev machine. Preview with the launch config "mm-status-tracker" in the git-ignored
  `.claude/launch.json` (runs `powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1`, port 8765; create
  it if missing), and run the tests at http://localhost:8765/tests/browser.html.
- Keep it dependency-free: no npm packages, no CDN libraries.
- Commits: use the repo's git identity, and add no AI or Claude attribution lines. Commit and push only when asked.
- To push over HTTPS from a non-interactive shell, set `GCM_GUI_PROMPT=1 GIT_TERMINAL_PROMPT=0`.
