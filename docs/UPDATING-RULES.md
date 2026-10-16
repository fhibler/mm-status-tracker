# Updating airline and points data

Instructions for keeping the Miles & More rules in this app current: where the data comes from, how to
read it, what to compare, and which files to change. **Last full check: 2026-10-16** (see the snapshot at
the end; update it whenever you re-check).

## 1. Sources

Use the official Miles & More pages first. Use third-party blogs (frankfurtflyer.de, travel-dealz.com,
meilenoptimieren.com, reisetopia.de) only to find hints or dates, never as the final word.

| What | Where |
|---|---|
| Earning per airline, points per segment, zones, FAQ | https://www.miles-and-more.com/at/en/program/status-benefits/points-system.html |
| List of airline partners | https://www.miles-and-more.com/at/en/program/partners.html#categoryselected=airlines |
| Status thresholds | https://www.miles-and-more.com/de/en/general-information/help-and-contact/help/how-to-achieve-frequent-flyer-status.html |
| Status validity and downgrade | https://www.miles-and-more.com/de/en/general-information/help-and-contact/help/status-validity-for-frequent-travellers-and-senators.html and `.../status-validity-of-hon-circle-miles.html` |
| Star Alliance members (Points-only group) | https://www.staralliance.com/en/member-airlines |
| CO₂ boosters (Small/Medium/Large/X-Large) | Supplied by the user. Check the Miles & More CO₂ compensation offer if it is reachable. |
| Airport table | OurAirports `airports.csv`, built in CI by `tools/build-airports.ps1` |
| Flight routes | adsbdb.com API (`js/api.js`) |

The `/at/en/`, `/de/en/` and `/row/en/` country versions contain the same rules.

### How to access them

- **WebFetch / curl get HTTP 403.** miles-and-more.com and lufthansa.com are behind Cloudflare.
- **Use the built-in browser.** `navigate` to the page, then read it with `get_page_text`. Sometimes the page loads
  directly; sometimes it shows "Just a moment… / Performing security verification".
- **Never try to get past a bot check.** If one appears, stop, tell the user, and ask them to open the page and paste
  the relevant text. Users have pasted the FAQ before.
- **`fetch()` from inside a loaded page also gets the bot check.** Navigate to each page instead.
- **Collapsed FAQ items aren't in the page text.** Click the heading to open it (e.g. "What counts as a continental
  or intercontinental flight?"), then read the parent element's text with `javascript_tool`.
- **The partner detail pages (`/program/partners/<airline>.html`) are only marketing text.** They still talk about
  "status miles". Don't use them for earning rules.

## 2. What to look for

### Points system page

1. **"You can earn Points with these airlines" + "Airlines at a glance" table.** Rows with all three ticks
   (Points, Qualifying Points, HON Circle Points) belong to group `LHG`. The "Star Alliance airlines" row (Points only)
   is group `STAR`. The page says Points, QP and HON are credited "for flights operated by" these airlines, so
   `E.earningGroup` uses the operating airline of a codeshare ("Operated by"), not the marketing one.
   As of the last check, the full-earning rows are:
   Air Dolomiti, Austrian, Brussels, Croatia, Discover, Eurowings, ITA, LOT, Lufthansa, Lufthansa City, Luxair, SWISS.
2. **"Points, Qualifying Points and HON Circle Points per flight segment" table.** Gives the continental and
   intercontinental values per cabin. Footnote: HON Circle Points only in Business and First.
3. **The three examples** (ZRH–BKK LX Business 200/200/200, FRA–BKK TG Economy 60/0/0, ZRH–MUC–BKK Business 240).
   These are also tests in `tests/engine.test.js`. Update both when the values change.
4. **FAQ "What counts as a continental or intercontinental flight?"** Contains the full country list per zone
   (Europe, North and Central America, South America, Africa, Middle East and Asia, Australia). Watch for edge cases:
   North Africa and Western Sahara are Europe; Israel, Jordan, Lebanon, Palestine and Syria are Asia; Greenland is
   North America; Kazakhstan is Asia.
5. **Other FAQs** (the user pasted these on 2026-10-16):
   - Award Flights and some special fares earn nothing. In the app: Earning "No status credit".
   - Austrian AIRail, Lufthansa Express Rail and SWISS Air Rail earn like flights, but count towards a status only up
     to **160 QP (FTL), 500 QP (Senator), 1,000 HON (HON Circle)** → `railCaps`.
   - Edelweiss earns only on **LX8000–8499** code-shares booked with SWISS under the LX number. WK numbers earn nothing.
   - Lufthansa Express Bus earns nothing → transport "bus".
   - Retro credits count in the **calendar year of the flight**. In the app: point corrections dated on the flight date.
6. **"Earn Points in your sleep with Marriott Bonvoy"** (same page, below the examples): with linked accounts,
   **40 Points per qualifying stay of at least two days**, at most **120 Points per calendar year** towards status,
   and no QP or HON Circle Points → `MM.DEFAULT_RULES.marriott`. Watch for new non-flight partners in this section.

### Partners page

- Read the airline list (35 entries on the last check). Each airline needs an entry in `MM.AIRLINES`:
  - in the "at a glance" table with all three → `LHG`
  - Star Alliance member → `STAR`
  - other partners (award miles only, e.g. Air Astana, Cathay Pacific, LATAM, Olympic Air) → `NONE`
- New partners or airlines removed from the list are the most likely changes.

### Status pages

- Thresholds: FTL 650 P incl. 325 QP, Senator 2,000 P incl. 1,000 QP, HON Circle 6,000 HON, all per calendar year.
- Validity: from the day the status is reached until the end of February of the year after next. If you don't
  requalify, you drop one level (soft landing).

## 3. Where to update

| Change | File / place |
|---|---|
| Airline group, new airline, IATA/ICAO code | `js/data.js` → `MM.AIRLINES` (keep the source comment above it current) |
| Zones | `js/data.js` → `MM.REGIONS` (ISO 3166 alpha-2 codes; also used by `E.autoHaul`) |
| Points per segment, HON cabins, thresholds, rail caps, Marriott stays, CO₂ boosters | `js/data.js` → `MM.DEFAULT_RULES` |
| Hotel stays (Points per stay, minimum nights, yearly cap) | `js/data.js` → `MM.DEFAULT_RULES.marriott`; logic in `js/engine.js` → `E.stayEarn` |
| Validity rule | `js/engine.js` → `E.validUntil` |
| Downgrade rule | `js/engine.js` → `E.softLanding`, `E.history` |
| Special earning cases (rail, bus, codeshare operator) | `js/engine.js` → `E.earn`, `E.earningGroup`, `E.effective` |
| Tests | `tests/engine.test.js` (add a case for every rule you change) |
| User-facing description | `README.md` ("Default rules" tables, "Notes") |
| This guide | snapshot below + "Last full check" date |

### Changing a default in `MM.DEFAULT_RULES`

Users keep their rules in localStorage and in exported `.json` files, and `S.normalize` keeps stored values over
the defaults. A changed default therefore does **not** reach existing users on its own:

1. Increase `rulesVersion` in `S.empty()` (`js/store.js`).
2. In `S.normalize`, add a migration that runs only if `raw.settings.rulesVersion` is older **and** the stored value
   still equals the old default, so values the user changed on purpose are kept. Example: First Class
   intercontinental 300 → 400 (rulesVersion 2).
3. Add a test that an old file is migrated and a current file is kept as it is.
4. New keys (e.g. `railCaps`) need a merge line in `S.normalize` (`{ ...d.key, ...(r.key || {}) }`). A version bump
   isn't needed for those.

## 4. Verify

1. Run the tests:
   - Locally (no Node installed): start `tools/serve.ps1` (launch config "mm-status-tracker") and open
     http://localhost:8765/tests/browser.html. It must show **PASS**.
   - CI runs `node tests/engine.test.js`. Don't compare values from the vm context with `deepStrictEqual`, because
     arrays from another realm always fail. Compare elements, or build the array in the test file.
2. In the app, add one flight per changed rule and check the dialog's earning preview (e.g. LG Business
   continental → 40/40/40, FRA–TLV → Intercontinental).
3. After pushing, check the GitHub Actions run:
   `https://api.github.com/repos/fhibler/mm-status-tracker/actions/runs?per_page=3` (public, no login needed).

## 5. Snapshot of the last check (2026-10-16)

- **Full earners (P/QP/HON):** EN, OS, SN, OU, 4Y, EW, AZ, LO, LH (+ CL), VL, LG, LX
- **Points only (Star Alliance):** A3, AC, CA, AI, NZ, NH, OZ, AV, CM, MS, ET, BR, ZH, SQ, SA, TP, TG, TK, UA
- **No status credit:** KC, CX, LA, OA (award-mile partners), WK (except LX8000–8499 bookings)
- **Points per segment:** continental 20 / 20 / 40 / 40; intercontinental 60 / 80 / 200 / 400 (Y / W / C / F)
- **Thresholds:** FTL 650 P + 325 QP; SEN 2,000 P + 1,000 QP; HON 6,000 HON
- **Rail caps:** FTL 160 QP, SEN 500 QP, HON 1,000 HON
- **Marriott Bonvoy:** 40 Points per stay of 2+ nights, max 120 Points per calendar year, no QP / HON
- **Validity:** until end of February of the year after next; one-level soft landing
- **CO₂ boosters (from the user):** Small 5/5/5 %, Medium 20/20/20 %, Large 50/50/20 %, X-Large 80/80/20 % (P/QP/HON)
