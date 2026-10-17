# Miles & More Status Tracker – notes for Claude

A dependency-free web app (plain HTML/CSS/JS, no build step) that tracks and forecasts Miles & More status.
It is deployed to GitHub Pages by `.github/workflows/deploy.yml`.

## Layout

- `js/data.js`: airlines and earning groups, zones, default rules (`MM.DEFAULT_RULES`)
- `js/engine.js`: pure calculation logic (earning, haul, status, history, rail caps, soft landing, fares per booking, planner scenarios). Functions that depend on the date take `today` as a parameter
- `js/store.js`: state (`flights`, `bookings`, `adjustments`, `stays`, `plans`, `apiCache`), `S.normalize` (fills defaults, resets invalid choice fields, drops invalid entries; no migrations), `S.parse` (refuses other files and older versions), `.json` import/export, `S.saveFlight` / `S.deleteFlight`, demo data
- `js/api.js`: adsbdb.com route lookup with a cache that is saved in the `.json`, and the codeshare fallback to the operating flight (`A.resolveRoute`)
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
