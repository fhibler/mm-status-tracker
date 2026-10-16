/* Dependency-free tests for engine, store and API: `node tests/engine.test.js` (CI), or tests/browser.html */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// The app's scripts run in their own context (like a browser page). fetch is stubbed per test via `respond`.
let respond = () => { throw new Error('unexpected fetch'); };
const ctx = { console, fetch: async (url) => respond(url) };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['data.js', 'airports.js', 'engine.js', 'api.js', 'store.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const { MM } = ctx;
const E = MM.engine, S = MM.store, A = MM.api;
const rules = MM.DEFAULT_RULES;
const TODAY = '2026-06-15';   // fixed "today": later items are planned
// Objects and arrays made by the app come from its context; compare their fields (or joined strings), since
// deepStrictEqual also compares prototypes and those differ between contexts.
const ap = (country) => ({ iata: 'X', country, lat: 0, lon: 0 });
const r = (o, d) => ({ origin: ap(o), destination: ap(d) });
const fraJfk = r('DE', 'US'), fraZrh = r('DE', 'CH');
const flight = (o) => ({ ...S.newFlight('2026-03-01'), ...o });
const lhBiz = (o) => flight({ airlineCode: 'LH', flightNo: 'LH400', route: fraJfk, bookedClass: 'Business', upgradeClass: 'Business', ...o });
const state = (o = {}) => S.normalize(o);   // a state as the app holds it
const pts = (e) => [e.p, e.qp, e.hon].join(',');
const earn = (o) => E.earn(flight(o), rules);

/* ---------- flight numbers and airports ---------- */
assert.strictEqual(E.parseFlightNo('lh 400').iata, 'LH400');
assert.strictEqual(E.parseFlightNo('4Y123').code, '4Y');
assert.strictEqual(E.parseFlightNo('DLH400').code, 'LH');       // ICAO form
assert.strictEqual(E.parseFlightNo('LGL4591').code, 'LG');
assert.strictEqual(E.parseFlightNo('12345'), null);
assert.strictEqual(MM.airport('aus').city, 'Austin');
assert.strictEqual(MM.airport('XXX'), null);

/* ---------- haul: same country or same Miles & More zone is continental ---------- */
{
  const haul = (o, d) => E.autoHaul(flight({ route: r(o, d) }));
  assert.strictEqual(haul('DE', 'US'), 'intercontinental');
  assert.strictEqual(haul('DE', 'CH'), 'continental');
  assert.strictEqual(haul('US', 'US'), 'continental');           // SEA–SFO
  assert.strictEqual(haul('US', 'CA'), 'continental');
  assert.strictEqual(haul('JP', 'US'), 'intercontinental');
  assert.strictEqual(haul('DE', 'EG'), 'continental');           // North Africa is Europe
  assert.strictEqual(haul('DE', 'TN'), 'continental');
  assert.strictEqual(haul('DE', 'IL'), 'intercontinental');      // Israel is Asia
  assert.strictEqual(haul('DK', 'GL'), 'intercontinental');      // Greenland is North America
  assert.strictEqual(haul('CA', 'GL'), 'continental');
  assert.strictEqual(E.haul(flight({ route: fraJfk, haulOverride: 'continental' })), 'continental');
  assert.strictEqual(E.haul(flight({ route: null })), null);     // flight without route: unknown
  assert.strictEqual(E.haul(flight({ route: null, transport: 'rail' })), 'continental');
  const e = earn({ airlineCode: 'LH', route: null });
  assert.strictEqual(`${e.unknown}:${pts(e)}`, 'true:0,0,0');      // unknown haul earns nothing
}

/* ---------- earning per segment ---------- */
assert.strictEqual(pts(earn({ airlineCode: 'LH', route: fraJfk, bookedClass: 'First', upgradeClass: 'First' })), '400,400,400');
// upgrades: only fixed (online / airport) and bid upgrades earn the upgraded class
{
  const up = (upgradeType) => earn({ airlineCode: 'LH', route: fraJfk, bookedClass: 'Economy', upgradeClass: 'Business', upgradeType }).p;
  assert.strictEqual(['fixed-online', 'fixed-airport', 'bid', 'miles', 'voucher', 'operational', ''].map(up).join(','), '200,200,200,60,60,60,60');
  const e = earn({ airlineCode: 'LH', route: fraJfk, bookedClass: 'Economy', upgradeClass: 'Business', upgradeType: 'bid', earnClassOverride: 'Premium Economy' });
  assert.strictEqual(`${e.cls}:${pts(e)}`, 'Premium Economy:80,80,0');   // cabin override beats the upgrade
}
// earning groups as listed by Miles & More
assert.strictEqual(earn({ airlineCode: 'OU', route: fraZrh }).qp, 20);    // Croatia: Lufthansa Group
assert.strictEqual(earn({ airlineCode: 'LO', route: fraZrh }).qp, 20);    // LOT
assert.strictEqual(pts(earn({ airlineCode: 'LG', route: fraZrh, bookedClass: 'Business', upgradeClass: 'Business' })), '40,40,40');   // Luxair
assert.strictEqual(pts(earn({ airlineCode: 'A3', route: fraZrh })), '20,0,0');   // Aegean: Star Alliance, Points only
assert.strictEqual(earn({ airlineCode: 'CX', route: fraJfk }).p, 0);       // Cathay: no status credit
// the three official examples from the "Points system" page
assert.strictEqual(pts(earn({ airlineCode: 'LX', route: r('CH', 'TH'), bookedClass: 'Business', upgradeClass: 'Business' })), '200,200,200');   // ZRH–BKK
assert.strictEqual(pts(earn({ airlineCode: 'TG', route: r('DE', 'TH') })), '60,0,0');                                                          // FRA–BKK Thai
{
  const a = earn({ airlineCode: 'LX', route: r('CH', 'DE'), bookedClass: 'Business', upgradeClass: 'Business' });
  const b = earn({ airlineCode: 'LH', route: r('DE', 'TH'), bookedClass: 'Business', upgradeClass: 'Business' });
  assert.strictEqual(pts({ p: a.p + b.p, qp: a.qp + b.qp, hon: a.hon + b.hon }), '240,240,240');                                              // ZRH–MUC–BKK
}
// codeshares: the operating airline decides
assert.strictEqual(E.earningGroup(flight({ airlineCode: 'UA', operatingFlightNo: 'LH488' })), 'LHG');
assert.strictEqual(E.earningGroup(flight({ airlineCode: 'LH', flightNo: 'LH9246', operatingFlightNo: 'UA679' })), 'STAR');
assert.strictEqual(E.earningGroup(flight({ airlineCode: 'LH', operatingFlightNo: 'ZZ1' })), 'LHG');   // unknown operator: marketing airline
assert.strictEqual(E.earningGroup(flight({ airlineCode: 'LH', operatingFlightNo: 'UA1', earningGroup: 'NONE' })), 'NONE');   // override
// Edelweiss: only LX8000–8499 operated by Edelweiss earns (like SWISS); WK numbers and other LX numbers on WK don't
assert.strictEqual(E.earningGroup(flight({ airlineCode: 'LX', flightNo: 'LX8123', operatingFlightNo: 'WK123' })), 'LHG');
assert.strictEqual(E.earningGroup(flight({ airlineCode: 'LX', flightNo: 'LX1000', operatingFlightNo: 'WK1000' })), 'NONE');
assert.strictEqual(E.earningGroup(flight({ airlineCode: 'LX', flightNo: 'LX8123', operatingFlightNo: 'UA1' })), 'STAR');
assert.strictEqual(E.earningGroup(flight({ airlineCode: 'WK', flightNo: 'WK123' })), 'NONE');
// trains earn like flights (continental by default), buses earn nothing
assert.strictEqual(earn({ airlineCode: 'LH', transport: 'bus', route: fraZrh }).p, 0);
{
  const e = earn({ airlineCode: 'LH', transport: 'rail', route: null, bookedClass: 'Business', upgradeClass: 'Business' });
  assert.strictEqual(`${pts(e)}:${e.rail}:${e.haul}`, '40,40,40:true:continental');
}
// CO₂ boosters
assert.strictEqual(pts(earn({ airlineCode: 'LX', route: fraJfk, bookedClass: 'Business', upgradeClass: 'Business', co2Level: 'large' })), '300,300,240');
assert.strictEqual(pts(earn({ airlineCode: 'LH', route: fraZrh, co2Level: 'small' })), '21,21,0');

/* ---------- status ---------- */
{
  const status = (p, qp, hon, qpRail = 0, honRail = 0) => E.status({ p, qp, hon, qpRail, honRail }, rules);
  assert.strictEqual(status(650, 325, 0), 'FTL');
  assert.strictEqual(status(2000, 999, 0), 'FTL');
  assert.strictEqual(status(2000, 1000, 0), 'SEN');
  assert.strictEqual(status(0, 0, 6000), 'HON');
  // train QP / HON count only up to the caps (FTL 160 QP, SEN 500 QP, HON 1,000 HON)
  assert.strictEqual(status(700, 400, 0, 300), 'NONE');           // 100 + min(300, 160) = 260 < 325
  assert.strictEqual(status(700, 500, 0, 300), 'FTL');            // 200 + 160 = 360
  assert.strictEqual(status(2000, 1199, 0, 700), 'FTL');          // SEN: 499 + 500 = 999 < 1,000
  assert.strictEqual(status(2000, 1200, 0, 700), 'SEN');          // 500 + 500 = 1,000
  assert.strictEqual(status(0, 0, 6500, 0, 1500), 'HON');         // 5,000 + 1,000
  assert.strictEqual(status(0, 0, 6500, 0, 1600), 'NONE');        // 4,900 + 1,000 = 5,900
  // a year of trains: the totals keep the rail share, the status uses the capped value
  const trains = Array.from({ length: 10 }, (_, i) => flight({ id: 't' + i, date: `2020-03-${String(i + 1).padStart(2, '0')}`, airlineCode: 'LH', transport: 'rail', route: null }));
  const s = E.yearSummary(state({ flights: trains }), 2020, TODAY);
  assert.strictEqual(`${s.actual.qp}:${s.actual.qpRail}`, '200:200');
  assert.strictEqual(E.effective(s.actual, 'FTL', rules).qp, 160);
  assert.strictEqual(E.gap(s.actual, 'FTL', rules).qp, 165);
}
// validity: until the end of February of the year after next (leap years included)
assert.strictEqual(E.validUntil(2026), '2028-02-29');
assert.strictEqual(E.validUntil(2025), '2027-02-28');

/* ---------- year summary: flown vs planned, forecast, costs ---------- */
{
  const st = state({
    flights: [
      lhBiz({ id: 'f1', date: '2026-03-01', bookingCode: 'B1' }),                                          // flown, 200
      lhBiz({ id: 'f2', date: '2026-09-01', bookingCode: 'B1', flightNo: 'LH401' }),                       // planned, 200
      lhBiz({ id: 'f3', date: '2026-10-01', flightNo: 'LH402', includeInPlan: false, flightCost: 999 }),  // planned, left out
      flight({ id: 'f4', date: '2026-07-01', flightNo: 'LH403', airlineCode: 'LH', route: fraJfk, bookedClass: 'Economy', upgradeClass: 'Business',
        upgradeType: 'fixed-online', upgradeCost: 300, flightCost: 100, co2Level: 'none', co2Cost: 50 }),  // planned, 200; CO₂ cost without booster
    ],
    bookings: { B1: { fare: 1000 } },
    adjustments: [{ id: 'a1', date: '2026-04-01', p: 400, qp: 100, hon: 0, remark: 'retro credit' }],
  });
  const s = E.yearSummary(st, 2026, TODAY);
  assert.strictEqual(s.rows.map(x => `${x.f.id}:${x.planned}:${x.counts}`).join(' '), 'f1:false:true f4:true:true f2:true:true f3:true:false');
  assert.strictEqual(pts(s.actual), '600,300,200');                // f1 + correction
  assert.strictEqual(pts(s.forecast), '1000,700,600');             // + f4 + f2 (f3 left out)
  assert.strictEqual(`${s.statusActual}:${s.statusForecast}`, 'NONE:FTL');
  assert.strictEqual(`${s.reached.actual.FTL}:${s.reached.forecast.FTL}:${s.reached.forecastBy.FTL}`, 'undefined:2026-07-01:LH403');
  // costs: half of booking B1 each; upgrade cost only when upgraded, CO₂ cost only with a booster; f3 not counted
  assert.strictEqual(Object.values(s.cost.actual).join(','), '500,0,0,500');
  assert.strictEqual(Object.values(s.cost.plan).join(','), '600,300,0,900');
  assert.strictEqual(Object.values(s.cost.all).join(','), '1100,300,0,1400');
  // an item dated today is flown; on the same day flights come before corrections, which decides the reached date
  const sameDay = state({
    flights: [lhBiz({ id: 'g1', date: TODAY }), lhBiz({ id: 'g2', date: '2026-06-01' })],
    adjustments: [{ id: 'a', date: TODAY, p: 250, qp: 0, hon: 0, remark: 'r' }],
  });
  const t = E.yearSummary(sameDay, 2026, TODAY);
  assert.strictEqual(`${t.rows[1].planned}:${t.events.map(x => (x.f ? x.f.id : 'adj')).join(',')}`, 'false:g2,g1,adj');
  assert.strictEqual(`${t.reached.actual.FTL}:${t.reached.forecastBy.FTL}`, `${TODAY}:Correction`);   // 400 P after g1, 650 with the correction
  // unknown haul: counted only for flights in the forecast that would earn
  const unknown = state({ flights: [
    flight({ id: 'u1', airlineCode: 'LH' }), flight({ id: 'u2', airlineCode: 'CX' }),
    flight({ id: 'u3', date: '2026-09-01', airlineCode: 'LH', includeInPlan: false }),
  ] });
  assert.strictEqual(E.yearSummary(unknown, 2026, TODAY).unknown, 1);
  // a booking with segments in two years: each year counts its share
  const two = state({ flights: [lhBiz({ id: 'x', date: '2026-12-20', bookingCode: 'X' }), lhBiz({ id: 'y', date: '2027-01-10', bookingCode: 'X' })], bookings: { X: { fare: 900 } } });
  assert.strictEqual(`${E.yearSummary(two, 2026, TODAY).cost.plan.flight}:${E.yearSummary(two, 2027, TODAY).cost.plan.flight}`, '450:450');
}

/* ---------- point corrections and Marriott Bonvoy stays ---------- */
{
  const st = state({ flights: [lhBiz({ id: 'f', date: '2020-05-01' })], adjustments: [
    { id: 'a1', date: '2020-06-01', p: 1400, qp: 400, hon: 0, remark: 'retro credit' },
    { id: 'a2', date: '2020-07-01', p: -10, qp: 0, hon: 0, remark: 'deduction' },
  ] });
  const s = E.yearSummary(st, 2020, TODAY);
  assert.strictEqual(`${s.actual.p}:${s.actual.qp}:${s.adjTotal.p}:${s.events.length}`, '1590:600:1390:3');
  assert.strictEqual(s.statusActual, 'FTL');
}
{
  // 40 Points per stay of 2+ nights, no QP / HON; here capped at 100 per year, so the third stay earns 20
  const stay = (id, date, nights) => ({ id, date, nights, hotel: 'H', remark: '' });
  const st = state({
    settings: { rules: { marriott: { maxPointsPerYear: 100 } } },
    stays: [stay('s1', '2020-02-03', 1), stay('s2', '2020-03-03', 2), stay('s3', '2020-04-03', 3), stay('s4', '2020-05-03', 2), stay('s5', '2020-06-03', 4), stay('s6', '2021-01-10', 2)],
  });
  const s = E.yearSummary(st, 2020, TODAY);
  assert.strictEqual(s.stays.map(x => `${x.e.p}${x.e.reason}`).join(','), '0short,40ok,40ok,20partial,0cap');
  assert.strictEqual(`${pts(s.actual)}:${s.stayTotal.p}`, '100,0,0:100');
  assert.strictEqual(E.yearSummary(st, 2021, TODAY).stayTotal.p, 40);   // the cap resets each year
  assert.strictEqual(E.years(st, TODAY).join(','), '2020,2021,2026');    // years with items, plus the current one
}

/* ---------- history: soft landing and starting status ---------- */
{
  const segs = (year, n) => Array.from({ length: n }, (_, i) => lhBiz({ id: `${year}-${i}`, date: `${year}-05-${String(i + 1).padStart(2, '0')}` }));
  const held = (flights) => Object.fromEntries(E.history(state({ flights }), undefined, TODAY).map(x => [x.year, `${x.carriedIn},${x.held},${x.downgraded}`]));
  assert.strictEqual(E.softLanding('HON'), 'SEN');
  assert.strictEqual(E.softLanding('NONE'), 'NONE');
  // Senator in 2020, nothing after: SEN through Feb 2022, FTL from Mar 2022, Base from Mar 2023 (gap years filled in)
  let h = held(segs(2020, 10));
  assert.strictEqual([2020, 2021, 2022, 2023, 2024].map(y => h[y]).join(' | '), 'NONE,SEN,false | SEN,SEN,false | FTL,FTL,true | NONE,NONE,true | NONE,NONE,false');
  // HON Circle in 2020, only FTL earned in 2021: the soft landing (SEN) beats the earned FTL
  h = held([...segs(2020, 30), ...segs(2021, 4)]);
  assert.strictEqual([2021, 2022, 2023].map(y => h[y]).join(' | '), 'HON,HON,false | SEN,SEN,true | FTL,FTL,true');
  // requalified each year, then not
  h = held([...segs(2020, 10), ...segs(2021, 10), ...segs(2022, 10)]);
  assert.strictEqual(`${h[2023]} | ${h[2024]}`, 'SEN,SEN,false | FTL,FTL,true');
  // lands on FTL in March 2022, then earns Senator again in May 2022
  h = held([...segs(2020, 10), ...segs(2022, 10)]);
  assert.strictEqual(`${h[2022]} | ${h[2023]}`, 'FTL,SEN,false | SEN,SEN,false');

  // starting status from the statement: counts as earned in that year and carries into the next
  const st = state({ flights: segs(2026, 1), settings: { startStatus: { status: 'SEN', year: 2025 } } });
  const y = (hist, year) => hist.find(x => x.year === year);
  const hist = E.history(st, 2027, TODAY);
  assert.strictEqual(`${y(hist, 2025).statusActual}:${y(hist, 2025).fromStatement}`, 'SEN:true');
  assert.strictEqual(`${y(hist, 2026).carriedIn}:${y(hist, 2026).held}:${y(hist, 2026).hasPrev}`, 'SEN:SEN:true');
  assert.strictEqual(y(hist, 2027).held, 'FTL');   // not requalified in 2026: soft landing
  // a statement status below the one earned with tracked flights changes nothing
  const lower = y(E.history(state({ flights: segs(2025, 10), settings: { startStatus: { status: 'FTL', year: 2025 } } }), undefined, TODAY), 2025);
  assert.strictEqual(`${lower.statusActual}:${lower.fromStatement}`, 'SEN:false');
  // the planner counts it in every step: Senator from the statement in 2026 with a single flight
  const sc = E.planScenario(state({ flights: segs(2026, 1), settings: { startStatus: { status: 'SEN', year: 2026 } } }), 2026, { co2: {}, mix: [] }, TODAY);
  assert.strictEqual(`${sc.status.actual}:${sc.status.forecast}:${sc.status.total}:${sc.base.fromStatement}`, 'SEN:SEN:SEN:true');
  const none = y(E.history(state({ flights: segs(2026, 1) }), undefined, TODAY), 2026);
  assert.strictEqual(`${none.carriedIn}:${none.hasPrev}`, 'NONE:false');
}

/* ---------- fares per booking (store) ---------- */
{
  const st = state();
  const a = S.saveFlight(st, flight({ id: 'a', bookingCode: 'abc 123' }), 800);
  S.saveFlight(st, flight({ id: 'b', bookingCode: 'ABC123', date: '2026-03-05' }), 800);
  assert.strictEqual(`${a.bookingCode}:${a.flightCost}:${st.bookings.ABC123.fare}:${E.fareShare(st, st.flights[1])}`, 'ABC123:0:800:400');
  // moving b to another booking keeps ABC123's fare for a, and b gets the new booking's fare
  S.saveFlight(st, { ...st.flights[1], bookingCode: 'XYZ999' }, 300);
  assert.strictEqual(`${st.bookings.ABC123.fare}:${st.bookings.XYZ999.fare}:${E.fareShare(st, st.flights[0])}`, '800:300:800');
  // without a booking code the fare belongs to the flight; the booking left without segments is dropped
  S.saveFlight(st, { ...st.flights[1], bookingCode: '' }, 120);
  assert.strictEqual(`${st.flights[1].flightCost}:${E.fareShare(st, st.flights[1])}:${'XYZ999' in st.bookings}`, '120:120:false');
  // a booking code without a booking entry (e.g. edited in the .json) falls back to the segment's own fare
  assert.strictEqual(E.fareShare(state(), flight({ bookingCode: 'NOPE', flightCost: 75 })), 75);
  // deleting a flight drops its booking and its planner what-ifs
  st.plans['2026'] = { co2: { a: { level: 'small', cost: 5 } }, mix: [] };
  S.deleteFlight(st, 'a');
  assert.strictEqual(`${'ABC123' in st.bookings}:${'a' in st.plans['2026'].co2}`, 'false:false');
}

/* ---------- planner ---------- */
{
  const lh = lhBiz({ id: 'a', date: '2026-02-01', co2Level: 'large', co2Cost: 40 });   // 300 · 300 · 240
  const gain = (level) => pts(E.co2Gain(lh, level, rules));
  assert.strictEqual(gain('xlarge'), '60,60,0');
  assert.strictEqual(gain('none'), '-100,-100,-40');
  const st = state({ flights: [lh, { ...lh, id: 'b', date: '2025-02-01', co2Cost: 60 }] });
  assert.strictEqual(E.co2CostEstimate(st, 'large', 'intercontinental'), 50);   // average paid
  assert.strictEqual(E.co2CostEstimate(st, 'small', 'intercontinental'), null);

  const plan = {
    co2: { a: { level: 'none', cost: 0 } },   // what if flight a had no booster
    mix: [
      { count: 2, kind: 'LHG', haul: 'continental', cls: 'Business', co2Level: 'none', cost: 300 },
      { count: 4, kind: 'LHG', haul: 'intercontinental', cls: 'Premium Economy', co2Level: 'medium', cost: 900 },
      { count: 3, kind: 'STAR', haul: 'intercontinental', cls: 'Economy', co2Level: 'none', cost: 0 },
    ],
  };
  const sc = E.planScenario(st, 2026, plan, TODAY);
  assert.strictEqual(`${pts(sc.base.forecast)}:${pts(sc.withCo2.forecast)}:${sc.cost.co2Extra}`, '300,300,240:200,200,200:-40');
  // + 2 × 40 continental Business, 4 × 96 Premium Economy intercontinental (80 + 20 %, no HON), 3 × 60 Star Alliance (Points only)
  assert.strictEqual(pts(sc.total), `${200 + 80 + 384 + 180},${200 + 80 + 384},${200 + 80}`);
  assert.strictEqual(`${sc.cost.mix}:${sc.status.total}`, '4200:FTL');
  assert.strictEqual(lh.co2Level, 'large');   // what-ifs never change the flight itself
  // trains in the mix: continental, no booster, QP capped
  const rail = E.planScenario(st, 2026, { co2: {}, mix: [{ count: 30, kind: 'RAIL', haul: 'intercontinental', cls: 'Business', co2Level: 'xlarge', cost: 0 }] }, TODAY);
  assert.strictEqual(rail.mix[0].e.qp, 40);
  assert.strictEqual(E.effective(rail.total, 'SEN', rules).qp, 300 + 500);
  // "fill the gap"
  const t0 = { p: 0, qp: 0, hon: 0, qpRail: 0, honRail: 0 };
  const need = (t, key, haul, cls) => E.segmentsNeeded(t, key, { haul, cls, co2Level: 'none' }, rules).n;
  assert.strictEqual(need(t0, 'FTL', 'intercontinental', 'Business'), 4);           // 650 P / 200
  assert.strictEqual(need(t0, 'HON', 'intercontinental', 'Economy'), Infinity);     // no HON in Economy
  assert.strictEqual(need({ ...t0, p: 650, qp: 325 }, 'FTL', 'continental', 'Economy'), 0);
  assert.strictEqual(need({ ...t0, p: 700, qp: 400, qpRail: 300 }, 'FTL', 'continental', 'Economy'), 4);   // 100 + 160 QP count: 65 missing
  assert.strictEqual(pts(E.segmentsNeeded(t0, 'FTL', { haul: 'continental', cls: 'Business', co2Level: 'medium' }, rules).e), '48,48,48');
  assert.strictEqual(Object.values(E.gap({ ...t0, p: 600, qp: 400 }, 'FTL', rules)).join(','), '50,0');
}

/* ---------- store: normalize, parse, file name ---------- */
{
  // saved rules are taken value by value; non-numbers and unknown keys are ignored (no migrations: a stored 300 stays 300)
  const ru = state({ settings: { rules: { co2: { small: { p: 7 } }, points: { intercontinental: { First: '300', Business: 'x' } }, honClasses: ['First', 'Bogus'], extra: 1 } } }).settings.rules;
  assert.strictEqual(`${ru.co2.small.p},${ru.co2.small.qp},${ru.points.intercontinental.First},${ru.points.intercontinental.Business}`, '7,5,300,200');
  assert.strictEqual(`${ru.honClasses.join('+')}:${'extra' in ru}`, 'First:false');
  // IDs end up in HTML and selectors: unsafe ones are replaced; invalid entries are dropped
  const st = state({
    settings: { currency: 'XYZ', memberNumber: '992 000-123 456 789' },
    flights: [{ id: 'x"><b>', date: '2026-01-01' }, { id: 'ok-1', date: '2026-02-01' }, { date: 'yesterday' }],
    plans: { 2025: { co2: { 'ok-1': { level: 'small', cost: 5 } }, mix: [{ count: '2', kind: 'X' }] } },   // what-if for a 2026 flight in 2025
  });
  assert.ok(/^[\w-]+$/.test(st.flights[0].id) && st.flights[0].id !== 'x"><b>');
  assert.strictEqual(`${st.flights.length}:${st.flights[1].id}:${st.settings.currency}`, '2:ok-1:EUR');
  assert.strictEqual(`${Object.keys(st.plans['2025'].co2).length}:${st.plans['2025'].mix[0].count}:${st.plans['2025'].mix[0].kind}`, '0:2:LHG');
  // flight choices outside the allowed values get a new flight's defaults (the upgrade class: the booked class)
  const choices = ['transport', 'bookedClass', 'upgradeClass', 'co2Level', 'haulOverride', 'earningGroup', 'earnClassOverride', 'upgradeType'];
  const bad = state({ flights: [{ date: '2026-01-01', ...Object.fromEntries(choices.map(k => [k, 'x'])), bookedClass: 'Business' }] }).flights[0];
  assert.strictEqual(choices.map(k => bad[k]).join(','), 'flight,Business,Business,none,auto,auto,auto,');
  // booking codes are normalised and fares never negative; an implausible starting status year is dropped
  const bk = state({ flights: [flight({ bookingCode: 'AB1' })], bookings: { 'ab 1': { fare: -5 } }, settings: { startStatus: { status: 'SEN', year: 1 } } });
  assert.strictEqual(`${Object.keys(bk.bookings).join()}:${bk.bookings.AB1.fare}:${bk.settings.startStatus.year}`, 'AB1:0:null');
  // the Miles & More number (digits only) names the .json file
  assert.strictEqual(S.fileName(st), 'miles-and-more-992000123456789.json');
  assert.ok(/^miles-and-more-status-\d{4}-\d{2}-\d{2}\.json$/.test(S.fileName(state())));
  // parse: other files and the old format (version 1) are refused; saved demo data round-trips
  assert.throws(() => S.parse(JSON.stringify({ format: 'mm-status-tracker', version: 1, flights: [] })), /older version/);
  assert.throws(() => S.parse(JSON.stringify({ format: 'other', version: 2 })), /Not a Miles/);
  const demo = S.demo();
  const again = S.parse(JSON.stringify(demo));
  assert.strictEqual(`${again.flights.length}:${again.bookings.K7XQ2P.fare}:${Object.keys(again.apiCache).length > 0}`, `${demo.flights.length}:780:true`);
}

/* ---------- route lookup (adsbdb) with a stubbed fetch ---------- */
async function apiTests() {
  const st = state();
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const route = { flightroute: { origin: { iata_code: 'FRA', country_iso_name: 'DE' }, destination: { iata_code: 'JFK', country_iso_name: 'US' } } };
  const calls = [];
  respond = (url) => { calls.push(url.split('/').pop()); return url.endsWith('/UA9414') ? reply(404, { response: 'unknown callsign' }) : reply(200, { response: route }); };
  let res = await A.lookup(st, 'UA9414');
  assert.strictEqual(`${res.status}:${res.queriedAs}:${calls.join(',')}`, 'ok:UAL9414:UA9414,UAL9414');   // ICAO fallback
  res = await A.lookup(st, 'UA9414');
  assert.strictEqual(`${res.fromCache}:${calls.length}`, 'true:2');               // cached: no new request
  assert.strictEqual(A.airport(st, 'JFK').country, 'US');                         // airports from cached routes ...
  assert.strictEqual(A.airport(st, 'AUS').city, 'Austin');                        // ... or from the airport table
  respond = () => reply(429, null);
  assert.strictEqual((await A.lookup(st, 'LH400')).status, 'error');              // rate limit: not cached as "not found"
  respond = () => reply(404, { response: 'unknown callsign' });
  assert.strictEqual((await A.lookup(st, 'LH400')).status, 'notfound');           // an error is asked again
  respond = () => reply(200, { response: route });
  assert.strictEqual((await A.lookup(st, 'LH400')).fromCache, true);              // "not found" is final ...
  assert.strictEqual((await A.lookup(st, 'LH400', { force: true })).status, 'ok');   // ... until forced
}

module.exports = apiTests().then(() => console.log('engine tests passed'));
