# CO₂ compensation price model

How the tracker estimates the price of a CO₂ compensation package (`MM.CO2_PRICE` in `js/data.js`,
`E.co2PriceEstimate` in `js/engine.js`).

Source: 10 screenshots of the Lufthansa CO₂ compensation page (Oct 2026), one-way flights.

## Raw data (EUR; Miles are always exactly 200 × EUR)

| Flight | Cabin | km | Small | Medium | Large | X-Large | Points S/M/L/XL | HON S/M/L/XL |
|---|---|---:|---:|---:|---:|---:|---|---|
| MUC–ZRH | Economy | 261 | 2.26 | 4.74 | 9.71 | 14.68 | 1 / 4 / 10 / 16 | 0 / 0 / 0 / 0 |
| BER–MUC | Economy | 463 | 3.01 | 6.32 | 12.95 | 19.57 | 1 / 4 / 10 / 16 | 0 / 0 / 0 / 0 |
| VIE–HAM | Economy | ~767* | 3.91 | 8.21 | 16.80 | 25.40 | 1 / 4 / 10 / 16 | 0 / 0 / 0 / 0 |
| MUC–BER | Business | 463 | 4.34 | 9.11 | 18.65 | 28.19 | 2 / 8 / 20 / 32 | 2 / 8 / 8 / 8 |
| DUS–MUC | Business | 487 | 4.45 | 9.34 | 19.11 | 28.89 | 2 / 8 / 20 / 32 | 2 / 8 / 8 / 8 |
| MUC–HAM | Business | 600 | 4.91 | 10.32 | 21.12 | 31.92 | 2 / 8 / 20 / 32 | 2 / 8 / 8 / 8 |
| MUC–LHR | Business | 944 | 6.24 | 13.10 | 26.82 | 40.54 | 2 / 8 / 20 / 32 | 2 / 8 / 8 / 8 |
| MUC–SEA | Business | 8503 | 69.84 | 146.60 | 300.11 | 453.63 | 10 / 40 / 100 / 160 | 10 / 40 / 40 / 40 |
| MUC–SFO | Business | 9461 | 78.99 | 165.80 | 339.42 | 513.04 | 10 / 40 / 100 / 160 | 10 / 40 / 40 / 40 |
| MUC–SFO | First (upgr.) | 9461 | 103.23 | 216.70 | 443.62 | 670.54 | 10 / 40 / 100 / 160 | 10 / 40 / 40 / 40 |

\* VIE–HAM distance not shown on the screenshot; great-circle distance computed from airport coordinates.

(Cabin of DUS, LHR, SEA inferred: they earn HON Circle Points, which only Business/First do.)

## Step 1: every package is a fixed multiple of Medium

| Package | × Medium | spread across the 10 flights |
|---|---:|---|
| Small | 0.476 | 0.4758 – 0.4768 |
| Medium | 1.000 | (the recommended "full" compensation) |
| Large | 2.047 | 2.0460 – 2.0491 |
| X-Large | 3.094 | 3.0930 – 3.0970 |

## Step 2: Medium price by distance and cabin

- Continental Business: **Medium ≈ 5.32 € + 0.00825 €/km** (least squares over BER, DUS, HAM, LHR; max error 0.05 €)
- Intercontinental Business: **Medium ≈ 0.0174 €/km** (SEA, SFO; error ≤ 1 %)
- Continental Economy: **Medium ≈ 3.04 € + 0.0068 €/km** (least squares over ZRH, BER, VIE–HAM; max error 0.13 €).
  The earlier 2-point line (2.70 + 0.00782/km) predicted VIE–HAM at 8.70 € vs actual 8.21 € (+6 %).
  Economy is ≈ 65–70 % of Business at the same distance.
- Intercontinental First: **1.307 × Business** (MUC–SFO 216.70 vs 165.80), i.e. ≈ 0.0228 €/km
- Intercontinental Economy / Premium Economy: no data yet

Validation: the first 4-flight model predicted the 3 new flights as DUS 9.32 (actual 9.34), LHR 13.36 (13.10, −2 %),
SEA 148.8 (146.60, +1.5 %). The continental line does not extend to long haul (it would give ~83 € for SFO).

## Example estimates (Business)

| Flight | km | Small | Medium | Large | X-Large |
|---|---:|---:|---:|---:|---:|
| MUC–LIS (cont.) | ~1960 | 10.2 | 21.5 | 44.0 | 66.5 |
| FRA–JFK (interc.) | ~6200 | 51.4 | 107.9 | 220.8 | 333.8 |

## Points: how they scale

Points = Qualifying Points = base segment points × 5 % / 20 % / 50 % / 80 % (S/M/L/XL).
HON Circle Points use the same %, capped at Medium (20 %), and only in Business/First.
MUC–SFO First was a voucher upgrade from Business: booster points follow the booked class (Business, base 200),
while the compensation price follows the flown class (First). The tracker's First base of 400 is fine for booked First.
Bases implied: continental Economy 20, continental Business 40, intercontinental Business 200.
Points do not depend on distance; only the price does.

Cost per Point (X-Large): DUS–MUC Business 0.90 €/pt, MUC–LHR Business 1.27 €/pt, MUC–ZRH Economy 0.92 €/pt,
MUC–SEA Business 2.84 €/pt, MUC–SFO Business 3.21 €/pt.
Best value: the shortest continental flights, X-Large for Points/QP, Medium for HON (more HON is not available).

## In the app

- `MM.CO2_PRICE.factor` holds the package multiples; `MM.CO2_PRICE.medium[haul][cabin]` holds `base`, `perKm` and the
  distance ranges: `good` (covered by samples, slightly widened since the app's great-circle distance differs a little
  from lufthansa.com's) and `rough` (extrapolated). Outside `rough`, or for a cabin without an entry, there is no estimate.
- Distance is the great-circle distance of the flight's route (`E.distanceKm`); the cabin is the one flown
  (`upgradeClass`), since the price follows the flown cabin even when an upgrade earns as booked.
- Only used when the currency setting is EUR. The flight dialog and the planner prefill an empty booster cost with
  the estimate; a typed cost always wins. Without an estimate the planner falls back to the average you paid.
- Long-haul Economy and Premium Economy have no entry yet.

## Updating the model

Collect prices from the compensation step on lufthansa.com (route, distance shown, cabin, the four package prices),
add them to the raw data table above, refit Medium per haul and cabin (least squares over the samples), update
`MM.CO2_PRICE` and the price checks in `tests/engine.test.js`.
