# CO₂ compensation price model

How the tracker estimates the price of a CO₂ compensation package (`MM.CO2_PRICE` in `js/data.js`,
`E.co2PriceEstimate` in `js/engine.js`).

Source: lufthansa.com compensation step, Oct 2026, one-way flights, all four packages per flight.
Miles are always exactly 200 × EUR.

## Raw data (EUR)

| Flight | Cabin | km | Small | Medium | Large | X-Large |
|---|---|---:|---:|---:|---:|---:|
| ZRH–MUC | Business | 261 | 3.26 | 6.85 | 14.03 | 21.20 |
| FRA–MUC | Business | 300 | 3.48 | 7.30 | 14.95 | 22.60 |
| INN–VIE | Business | 404 | 4.05 | 8.51 | 17.42 | 26.33 |
| MUC–BER | Business | 463 | 4.34 | 9.11 | 18.65 | 28.19 |
| MUC–DUS | Business | 487 | 4.45 | 9.34 | 19.11 | 28.89 |
| MUC–HAM | Business | 600 | 4.91 | 10.32 | 21.12 | 31.92 |
| MUC–AMS | Business | 665 | 5.20 | 10.92 | 22.35 | 33.78 |
| MUC–LHR | Business | 944 | 6.24 | 13.10 | 26.82 | 40.54 |
| MUC–SEA | Business | 8503 | 69.84 | 146.60 | 300.11 | 453.63 |
| FRA–SFO | Business | 9173 | 76.19 | 159.92 | 327.39 | 494.87 |
| SFO–ZRH | Business | 9400 | 78.38 | 164.52 | 336.80 | 509.08 |
| SFO–MUC | Business | 9461 | 78.99 | 165.80 | 339.42 | 513.04 |
| MUC–ZRH | Economy | 261 | 2.26 | 4.74 | 9.71 | 14.68 |
| BER–MUC | Economy | 463 | 3.01 | 6.32 | 12.95 | 19.57 |
| VIE–HAM | Economy | ~767* | 3.91 | 8.21 | 16.80 | 25.40 |
| MUC–SFO | Business, priced as booked (voucher upgrade to First), A380 | 9461 | 103.23 | 216.70 | 443.62 | 670.54 |

\* distance not shown; great-circle distance from airport coordinates.
Same route and cabin has the same price in both directions, except MUC→SFO (below, not modelled).

### Aircraft types (costs paid in 2026, Medium)

The tracker's export has 36 flights with a paid booster, all with the aircraft looked up (AeroDataBox).

| Route | Aircraft | Cabin paid for | Medium € | €/km (app distance) |
|---|---|---|---:|---:|
| MUC→SFO (LH458) | A350 (Feb), A380 (May) | Business: PE→Business fixed online (Feb), Business booked + voucher to First (May) | 216.70 | 0.02296 |
| SFO→MUC (LH459) | A350-900 (Feb), A380-800 (Mar) | Business (PE→Business fixed online) | 165.80 | 0.01757 |
| SFO→ZRH (LX39) | 777-300ER | Business | 164.52 | 0.01755 |
| FRA→SFO (LH454) | 747-8 | Business (PE→Business fixed online) | 159.92 | 0.01748 |
| MUC→SEA (UA9414, LH-operated) | A350 | Business (PE→Business fixed online) | 146.60 | 0.01729 |

- **The aircraft doesn't change the price.** MUC→SFO costs 216.70 € on the A350 and on the A380, SFO→MUC 165.80 € on
  both; A350, A380, 747-8 and 777-300ER all fit the same €/km except MUC→SFO. Continental too: the same route costs the
  same on A319, A320, A321 (ceo / neo) and E195.
- **MUC→SFO is an outlier** (1.31 × the formula, one way only, whatever the aircraft or cabin). The model ignores it
  and estimates it by distance like every route (about 24 % low there). The former "First 1.307×" factor was this
  outlier.
- **The cabin priced is the one paid for:** a fixed-price or bid upgrade is priced in the upgraded cabin (continental
  Economy→Business flights cost the Business price), a voucher upgrade as booked (MUC→SFO in May).

## The model

1. **Packages = SAF share.** Small / Medium / Large / X-Large use 5 / 20 / 50 / 80 % SAF (the rest offsets).
   Price = Medium × (0.302 + 3.49 × SAF share), i.e. Small 0.476×, Large 2.047×, X-Large 3.094× Medium
   (spread across all 16 flights: ±0.001). Implied: SAF costs about 12.6× as much as offsets per unit.
2. **Medium, Business:**
   - continental: **0.4283 × √km − 0.108 €** (8 routes, 261–944 km, max error 0.6 %).
     A straight line in km fits worse (up to 0.26 € off at the short end); the price grows with √distance.
   - intercontinental: **0.01748 € × km** (4 routes, 8478–9437 km by the app's distance, max error 1.1 %;
     MUC→SFO left out of the fit).
3. **Other cabins, as a factor on Business:** continental Economy **0.695** (3 routes, max error 0.6 %).
   Long-haul Economy / Premium Economy / First: no data (the former "First" sample was Business on MUC→SFO).
4. **Cabin = the cabin paid for** (`E.co2Class`): a fixed-price or bid upgrade is priced in the upgraded cabin, a
   voucher, miles or operational upgrade in the booked one. Booster Points follow the earning cabin, which is the
   same except for `earnClassOverride`.
5. **Aircraft: no effect** (see above).

Every package of the 16 flights and all 36 costs paid in 2026 are within 1.1 % of the model, except MUC→SFO
(−24 %).

Ranges in the app: continental good 250–1,000 km, rough up to 4,000 km; intercontinental good 8,000–10,000 km,
rough 3,000–13,000 km.

## Points: how they scale

Points = Qualifying Points = base segment points × 5 / 20 / 50 / 80 % (S/M/L/XL); HON Circle Points the same %,
capped at Medium (20 %), only in Business/First. Points don't depend on distance.
Cheapest Points: the shortest continental Business flights with X-Large (FRA–MUC: 32 points for 22.60 €, 0.71 €/pt).

## In the app

- `MM.CO2_PRICE.factor`: the package multiples. `MM.CO2_PRICE.business[haul]`: the Medium formula for Business
  (`sqrt`: base + rate × √km, `km`: base + rate × km) with its `good` and `rough` distance ranges.
  `MM.CO2_PRICE.cabin[haul][cabin]`: the factor on Business (`rough: true` when based on one flight).
  Outside `rough`, or for a cabin without an entry, there is no estimate.
- Distance is the great-circle distance of the flight's route (`E.distanceKm`), which differs slightly from
  lufthansa.com's; the cabin is the one paid for (`E.co2Class`).
- Only used when the currency setting is EUR. The flight dialog and the planner prefill an empty booster cost with
  the estimate; a typed cost always wins. Without an estimate the planner falls back to the average you paid.

## Updating the model

Collect all four package prices from the compensation step on lufthansa.com (route, distance shown, cabin),
add them to the raw data table above, refit (least squares over the samples), update `MM.CO2_PRICE` and the
price checks in `tests/engine.test.js`.
