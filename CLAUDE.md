# Miles & More Status Tracker – notes for Claude

A dependency-free web app (plain HTML/CSS/JS, no build step) that tracks and forecasts Miles & More status.
It is deployed to GitHub Pages by `.github/workflows/deploy.yml`.

## Layout

- `js/data.js`: airlines and earning groups, zones, default rules (`MM.DEFAULT_RULES`), CO₂ price model (`MM.CO2_PRICE`, see `docs/CO2-PRICE-MODEL.md`), Extra Benefits milestones per status (`MM.EXTRA_BENEFITS`, not editable)
- `js/engine.js`: pure calculation logic (earning, haul, status, history, rail caps, soft landing, fares per booking, CO₂ price estimate by distance and the cabin paid for, Extra Benefits unlocked with the status held at the time (`E.extraBenefits`, `E.nextExtraBenefit`), planner scenarios with upgrade and CO₂ what-ifs per flight (`E.upgradeWhatIf`, `E.co2WhatIf`, `E.whatIfFlight`) built as additive steps (`E.planScenario`, `E.withPlans` for the Planner switch of the dashboard and Extra Benefits)). Functions that depend on the date take `today` as a parameter
- `js/store.js`: state (`flights`, `bookings`, `adjustments`, `stays`, `plans` (`S.newPlan`), `apiCache`), `S.normalize` (fills defaults, resets invalid choice fields, drops invalid entries; the only migration: upgrade type `voucher` is read as `miles`), `S.parse` (refuses other files and older versions), `.json` import/export, `S.saveFlight` / `S.deleteFlight`, demo data
- `js/api.js`: route lookup via AeroDataBox (by date, with the user's key from `state.settings.aerodataboxKey`, called directly, via API.Market or via RapidAPI as `state.settings.aerodataboxVia` says (`A.ADB_VIA`), both saved in the `.json`; the direct gateway gets the key as the `apiKey` query parameter, since it blocks the browser's preflight for a key header) and adsbdb.com, with a cache per flight number and date (`A.cacheKey`) that is saved in the `.json`, provisional answers from another IATA season (`A.isProvisional`, `E.iataSeason`), and codeshares, which ask the operating flight first and fall back to the marketing number (`A.resolveRoute`). AeroDataBox answers also carry the departure and arrival times (UTC and local) and the aircraft, which a flight keeps in `f.times` (`A.timesFromCache`, `E.flightTimes`); adsbdb knows neither. AeroDataBox can list several routes for one number on a date (`A.legs`); the flight's airports pick one (`A.legIndex`), and the dialog offers a choice. Flights on the same day are sorted by departure in UTC (`E.byDeparture`). A failure that repeats for every flight (`A.repeats`: blocked or unreachable, key rejected, quota) is returned as `failure` and not cached; an error, or adsbdb's "not found" while AeroDataBox failed, is no final answer (`A.settled`) and is asked again, and a forced lookup while AeroDataBox fails keeps its earlier answer; "Refresh flight data" asks first what it costs (`A.timesCalls` × `A.UNITS_PER_CALL`) and stops at such a failure. A plan's date range, learned from AeroDataBox's 400 answers, is kept per way of calling in `state.settings.aerodataboxLimits` (`A.outsidePlan`, `A.forgetPlanNotes`); dates outside it are not asked
- `js/app.js`, `js/charts.js`: UI and SVG charts; `js/theme.js`: sets light or dark before the page is drawn
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
- `index.html` has a Content-Security-Policy: only the app's own scripts and styles, and connections only to adsbdb and
  `A.ADB_VIA`'s hosts (a test checks both). So no inline scripts, `style` attributes or `on…` handlers: markup built in
  `js/` uses classes, and a value known only at run time is set through the DOM (`el.style.width = …`).
- Code quality: make sure the code is bug-free, well designed and well tested. Neither over-engineer (unneeded
  abstractions, fallbacks) nor under-engineer (hacks, duplication); simplify or refactor over-engineered code wherever it
  makes it more maintainable. Keep the code elegant, follow best practices and integrate cleanly with the rest of the app.
- Tests: every critical behaviour is tested. Tests are clean, test the real production code, stub only the minimum
  that's needed, and don't duplicate each other.
- Documentation: leave no stale documentation; update README, this file and `docs/` with every change they describe.
- Commits: use the repo's git identity, and add no AI or Claude attribution lines. Commit and push only when asked.
- To push over HTTPS from a non-interactive shell, set `GCM_GUI_PROMPT=1 GIT_TERMINAL_PROMPT=0`.
