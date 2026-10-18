/* Dependency-free tests for engine, store and API: `node tests/engine.test.js` (CI), or tests/browser.html */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// The app's scripts run in their own context (like a browser page). fetch is stubbed per test via `respond`.
let respond = () => { throw new Error('unexpected fetch'); };
const ctx = { console, fetch: async (url, opts) => respond(url, opts) };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['data.js', 'airports.js', 'engine.js', 'api.js', 'store.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const { MM } = ctx;
const E = MM.engine, S = MM.store, A = MM.api;
// no AeroDataBox key from the browser (tests/browser.html shares localStorage with the app): tests pass one as `key`
A.aerodataboxKey = () => '';
A.adbGap = 0;
const rules = MM.DEFAULT_RULES;
const TODAY = '2026-06-15';   // fixed "today": later items are planned
// Objects and arrays made by the app come from its context; compare their fields (or joined strings), since
// deepStrictEqual also compares prototypes and those differ between contexts.
const ap = (country) => ({ iata: 'X', country, lat: 0, lon: 0 });
const r = (o, d) => ({ origin: ap(o), destination: ap(d) });
const fraJfk = r('DE', 'US'), fraZrh = r('DE', 'CH');
const flight = (o) => ({ ...S.newFlight('2026-03-01'), ...o });
const lhBiz = (o) => flight({ flightNo: 'LH400', route: fraJfk, bookedClass: 'Business', upgradeClass: 'Business', ...o });
const state = (o = {}) => S.normalize(o);   // a state as the app holds it
const pts = (e) => [e.p, e.qp, e.hon].join(',');
const earn = (o) => E.earn(flight(o), rules);

/* ---------- IATA schedule seasons (2026: summer from 29 Mar, winter from 25 Oct) ---------- */
assert.strictEqual(['2026-03-28', '2026-03-29', '2026-10-24', '2026-10-25', '2027-01-10', '2025-12-31'].map(E.iataSeason).join(','), 'W25,S26,S26,W26,W26,W25');
assert.strictEqual(E.iataSeason('2026-11-17T08:00:00.000Z'), 'W26');   // a fetchedAt timestamp works too

/* ---------- flight numbers and airports ---------- */
assert.strictEqual(E.parseFlightNo('lh 400').iata, 'LH400');
assert.strictEqual(E.parseFlightNo('4Y123').code, '4Y');
assert.strictEqual(E.parseFlightNo('DLH400').code, 'LH');       // ICAO form
assert.strictEqual(E.parseFlightNo('LGL4591').code, 'LG');
assert.strictEqual(E.parseFlightNo('12345'), null);
assert.strictEqual(E.parseFlightNo('XYZ123'), null);            // unknown ICAO prefix
// the airline comes from the flight number; adsbdb's name only for airlines not in the list
assert.strictEqual(E.airlineName(flight({ flightNo: 'LH1', route: { ...fraJfk, airlineName: 'Other' } })), 'Lufthansa');
assert.strictEqual(E.airlineName(flight({ flightNo: 'ZZ1', route: { ...fraJfk, airlineName: 'Zed Air' } })), 'Zed Air');
assert.strictEqual(E.airlineName(flight({ flightNo: 'ZZ1', route: { ...fraJfk, airlineName: 'United', via: 'UA1' } })), 'ZZ');   // operator's name
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
  const e = earn({ flightNo: 'LH1', route: null });
  assert.strictEqual(`${e.unknown}:${pts(e)}`, 'true:0,0,0');      // unknown haul earns nothing
}

/* ---------- earning per segment ---------- */
assert.strictEqual(pts(earn({ flightNo: 'LH1', route: fraJfk, bookedClass: 'First', upgradeClass: 'First' })), '400,400,400');
// upgrades: only fixed (online / airport) and bid upgrades earn the upgraded class
{
  const up = (upgradeType) => earn({ flightNo: 'LH1', route: fraJfk, bookedClass: 'Economy', upgradeClass: 'Business', upgradeType }).p;
  assert.strictEqual(['fixed-online', 'fixed-airport', 'bid', 'miles', 'voucher', 'operational', ''].map(up).join(','), '200,200,200,60,60,60,60');
  const e = earn({ flightNo: 'LH1', route: fraJfk, bookedClass: 'Economy', upgradeClass: 'Business', upgradeType: 'bid', earnClassOverride: 'Premium Economy' });
  assert.strictEqual(`${e.cls}:${pts(e)}`, 'Premium Economy:80,80,0');   // cabin override beats the upgrade
}
// earning groups as listed by Miles & More
assert.strictEqual(earn({ flightNo: 'OU1', route: fraZrh }).qp, 20);    // Croatia: Lufthansa Group
assert.strictEqual(earn({ flightNo: 'LO1', route: fraZrh }).qp, 20);    // LOT
assert.strictEqual(pts(earn({ flightNo: 'LG1', route: fraZrh, bookedClass: 'Business', upgradeClass: 'Business' })), '40,40,40');   // Luxair
assert.strictEqual(pts(earn({ flightNo: 'A31', route: fraZrh })), '20,0,0');   // Aegean: Star Alliance, Points only
assert.strictEqual(earn({ flightNo: 'CX1', route: fraJfk }).p, 0);       // Cathay: no status credit
// the three official examples from the "Points system" page
assert.strictEqual(pts(earn({ flightNo: 'LX1', route: r('CH', 'TH'), bookedClass: 'Business', upgradeClass: 'Business' })), '200,200,200');   // ZRH–BKK
assert.strictEqual(pts(earn({ flightNo: 'TG1', route: r('DE', 'TH') })), '60,0,0');                                                          // FRA–BKK Thai
{
  const a = earn({ flightNo: 'LX1', route: r('CH', 'DE'), bookedClass: 'Business', upgradeClass: 'Business' });
  const b = earn({ flightNo: 'LH1', route: r('DE', 'TH'), bookedClass: 'Business', upgradeClass: 'Business' });
  assert.strictEqual(pts({ p: a.p + b.p, qp: a.qp + b.qp, hon: a.hon + b.hon }), '240,240,240');                                              // ZRH–MUC–BKK
}
// codeshares: the operating airline decides
assert.strictEqual(E.earningGroup(flight({ flightNo: 'UA1', operatingFlightNo: 'LH488' })), 'LHG');
assert.strictEqual(E.earningGroup(flight({ flightNo: 'LH9246', operatingFlightNo: 'UA679' })), 'STAR');
assert.strictEqual(E.earningGroup(flight({ flightNo: 'LH1', operatingFlightNo: 'ZZ1' })), 'LHG');   // unknown operator: marketing airline
assert.strictEqual(E.earningGroup(flight({ flightNo: 'LH1', operatingFlightNo: 'UA1', earningGroup: 'NONE' })), 'NONE');   // override
// Edelweiss: only LX8000–8499 operated by Edelweiss earns (like SWISS); WK numbers and other LX numbers on WK don't
assert.strictEqual(E.earningGroup(flight({ flightNo: 'LX8123', operatingFlightNo: 'WK123' })), 'LHG');
assert.strictEqual(E.earningGroup(flight({ flightNo: 'LX1000', operatingFlightNo: 'WK1000' })), 'NONE');
assert.strictEqual(E.earningGroup(flight({ flightNo: 'LX8123', operatingFlightNo: 'UA1' })), 'STAR');
assert.strictEqual(E.earningGroup(flight({ flightNo: 'WK123' })), 'NONE');
// trains earn like flights (continental by default), buses earn nothing
assert.strictEqual(E.earningGroup(flight({ flightNo: 'LH1', transport: 'bus' })), 'NONE');
{
  const e = earn({ flightNo: 'LH1', transport: 'rail', route: null, bookedClass: 'Business', upgradeClass: 'Business' });
  assert.strictEqual(`${pts(e)}:${e.rail}:${e.haul}`, '40,40,40:true:continental');
}
// CO₂ boosters, for flights only
assert.strictEqual(pts(earn({ flightNo: 'LX1', route: fraJfk, bookedClass: 'Business', upgradeClass: 'Business', co2Level: 'large' })), '300,300,240');
assert.strictEqual(pts(earn({ flightNo: 'LH1', route: fraZrh, co2Level: 'small' })), '21,21,0');
{
  const train = flight({ flightNo: 'LH1', transport: 'rail', co2Level: 'large', co2Cost: 9 });
  assert.strictEqual(`${pts(E.earn(train, rules))}:${E.cost(train, 0).co2}`, '20,20,0:0');
}

/* ---------- date field ---------- */
assert.strictEqual(['2026/01/15', '2026-1-15', '2026.1.5', '20260115', '2026/02/30', '2026/13/01', '15.01.2026'].map(E.parseDate).join(','),
  '2026-01-15,2026-01-15,2026-01-05,2026-01-15,,,');

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
  const trains = Array.from({ length: 10 }, (_, i) => flight({ id: 't' + i, date: `2020-03-${String(i + 1).padStart(2, '0')}`, flightNo: 'LH1', transport: 'rail', route: null }));
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
      flight({ id: 'f4', date: '2026-07-01', flightNo: 'LH403', route: fraJfk, bookedClass: 'Economy', upgradeClass: 'Business',
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
  // costs: booking B1 once, on its first segment f1; upgrade cost only when upgraded, CO₂ cost only with a booster; f3 not counted
  assert.strictEqual(Object.values(s.cost.actual).join(','), '1000,0,0,1000');
  assert.strictEqual(Object.values(s.cost.plan).join(','), '100,300,0,400');
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
    flight({ id: 'u1', flightNo: 'LH1' }), flight({ id: 'u2', flightNo: 'CX1' }),
    flight({ id: 'u3', date: '2026-09-01', flightNo: 'LH1', includeInPlan: false }),
  ] });
  assert.strictEqual(E.yearSummary(unknown, 2026, TODAY).unknown, 1);
  // a booking with segments in two years: the whole fare counts once, in the year of its first segment
  const two = state({ flights: [lhBiz({ id: 'y', date: '2027-01-10', bookingCode: 'X' }), lhBiz({ id: 'x', date: '2026-12-20', bookingCode: 'X' })], bookings: { X: { fare: 900 } } });
  assert.strictEqual(`${E.yearSummary(two, 2026, TODAY).cost.plan.flight}:${E.yearSummary(two, 2027, TODAY).cost.plan.flight}`, '900:0');
  // the first segment left out of the forecast: the fare moves to the next segment that counts
  two.flights.find(f => f.id === 'x').includeInPlan = false;
  assert.strictEqual(`${E.yearSummary(two, 2026, TODAY).cost.plan.flight}:${E.yearSummary(two, 2027, TODAY).cost.plan.flight}`, '0:900');
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
  // a deduction below the threshold takes the status away again, and with it the date it was reached
  const down = E.yearSummary(state({ ...st, adjustments: [...st.adjustments, { id: 'a3', date: '2020-08-01', p: -1000, qp: 0, hon: 0, remark: 'r' }] }), 2020, TODAY);
  assert.strictEqual(`${down.statusActual}:${down.reached.actual.FTL}:${down.reached.forecast.FTL}:${down.reached.forecastBy.FTL}`, 'NONE:undefined:undefined:undefined');
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
  assert.strictEqual(`${y(hist, 2027).held}:${y(hist, 2027).carriedByPlan}`, 'FTL:false');   // not requalified in 2026: soft landing
  // planned flights that requalify in 2026 carry Senator into 2027
  const planned = Array.from({ length: 10 }, (_, i) => lhBiz({ id: 'p' + i, date: `2026-09-${String(i + 1).padStart(2, '0')}` }));
  const fc = y(E.history(state({ ...st, flights: [...st.flights, ...planned] }), 2027, TODAY), 2027);
  assert.strictEqual(`${fc.carriedIn}:${fc.held}:${fc.carriedByPlan}:${fc.downgraded}`, 'SEN:SEN:true:false');
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
  // the whole fare sits on the booking's first segment (a, 1 Mar), not split; b (5 Mar) carries none
  assert.strictEqual(`${a.bookingCode}:${a.flightCost}:${st.bookings.ABC123.fare}:${E.segmentFare(st, st.flights[0])}:${E.segmentFare(st, st.flights[1])}`, 'ABC123:0:800:800:0');
  assert.strictEqual(`${E.yearSummary(st, 2026, TODAY).cost.all.flight}`, '800');
  // same date: the lower id carries it
  const same = state({ flights: [flight({ id: 'q', bookingCode: 'S' }), flight({ id: 'p', bookingCode: 'S' })], bookings: { S: { fare: 50 } } });
  assert.strictEqual(E.fareHolders(same, TODAY).S, 'p');
  // moving b to another booking keeps ABC123's fare for a, and b gets the new booking's fare
  S.saveFlight(st, { ...st.flights[1], bookingCode: 'XYZ999' }, 300);
  assert.strictEqual(`${st.bookings.ABC123.fare}:${st.bookings.XYZ999.fare}:${E.segmentFare(st, st.flights[0])}:${E.segmentFare(st, st.flights[1])}`, '800:300:800:300');
  // without a booking code the fare belongs to the flight; the booking left without segments is dropped
  S.saveFlight(st, { ...st.flights[1], bookingCode: '' }, 120);
  assert.strictEqual(`${st.flights[1].flightCost}:${E.segmentFare(st, st.flights[1])}:${'XYZ999' in st.bookings}`, '120:120:false');
  // a booking code without a booking entry (e.g. edited in the .json) falls back to the segment's own fare
  assert.strictEqual(E.segmentFare(state(), flight({ bookingCode: 'NOPE', flightCost: 75 })), 75);
  // upgrade and CO₂ costs stay per segment
  const up = state({ flights: [lhBiz({ id: 'u1', bookingCode: 'U', bookedClass: 'Economy', upgradeCost: 100 }), lhBiz({ id: 'u2', date: '2026-03-02', bookingCode: 'U', bookedClass: 'Economy', upgradeCost: 150 })], bookings: { U: { fare: 400 } } });
  const uc = E.yearSummary(up, 2026, TODAY).rows.map(r => `${r.c.flight}+${r.c.upgrade}`).join(',');
  assert.strictEqual(uc, '400+100,0+150');
  // deleting a flight drops its booking and its planner what-ifs
  st.plans['2026'] = { co2: { a: { level: 'small', cost: 5 } }, mix: [] };
  S.deleteFlight(st, 'a');
  assert.strictEqual(`${'ABC123' in st.bookings}:${'a' in st.plans['2026'].co2}`, 'false:false');
  // a flight that becomes a train loses its what-ifs too: the planner neither shows nor resets them
  st.plans['2026'].co2.b = { level: 'large', cost: 40 };
  S.saveFlight(st, { ...st.flights[0], flightNo: 'LH1' }, 0);
  const kept = 'b' in st.plans['2026'].co2;
  S.saveFlight(st, { ...st.flights[0], transport: 'rail' }, 0);
  assert.strictEqual(`${kept}:${'b' in st.plans['2026'].co2}`, 'true:false');
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

  // price model: estimates within 3 % of prices seen on lufthansa.com (by distance and the cabin flown)
  const ap2 = (o, d) => ({ origin: MM.airport(o), destination: MM.airport(d) });
  const est = (o, d, cls, level, x = {}) => E.co2PriceEstimate(flight({ flightNo: 'LH1', route: ap2(o, d), bookedClass: cls, upgradeClass: cls, ...x }), level);
  for (const [o, d, cls, level, price, quality] of [
    ['ZRH', 'MUC', 'Business', 'medium', 6.85, 'good'], ['FRA', 'MUC', 'Business', 'xlarge', 22.60, 'good'],
    ['MUC', 'AMS', 'Business', 'large', 22.35, 'good'], ['MUC', 'LHR', 'Business', 'large', 26.82, 'good'],
    ['MUC', 'ZRH', 'Economy', 'medium', 4.74, 'good'], ['VIE', 'HAM', 'Economy', 'xlarge', 25.40, 'good'],
    ['MUC', 'SEA', 'Business', 'medium', 146.60, 'good'], ['FRA', 'SFO', 'Business', 'small', 76.19, 'good'],
    ['MUC', 'SFO', 'First', 'xlarge', 670.54, 'rough'],
  ]) {
    const e = est(o, d, cls, level);
    assert.ok(e && Math.abs(e.cost / price - 1) < 0.03 && e.quality === quality, `${o}-${d} ${cls} ${level}: ${JSON.stringify(e)}`);
  }
  assert.strictEqual(est('MUC', 'LIS', 'Business', 'medium').quality, 'rough');           // longer than the samples
  assert.strictEqual(est('MUC', 'SFO', 'Business', 'medium', { upgradeClass: 'First', upgradeType: 'voucher' }).cabin, 'First');   // priced as flown
  {  // booked Business, voucher upgrade to First: Points as Business, CO₂ priced as First (also with earnClassOverride)
    const up = { flightNo: 'LH458', route: ap2('MUC', 'SFO'), bookedClass: 'Business', upgradeClass: 'First', upgradeType: 'voucher', co2Level: 'medium' };
    assert.strictEqual(pts(E.earn(flight(up), rules)), pts(E.earn(flight({ ...up, upgradeClass: 'Business', upgradeType: '' }), rules)));
    assert.strictEqual(E.earn(flight(up), rules).cls, 'Business');
    assert.strictEqual(E.co2PriceEstimate(flight(up), 'medium').cabin, 'First');
    assert.strictEqual(E.co2PriceEstimate(flight({ ...up, earnClassOverride: 'Business' }), 'medium').cabin, 'First');
    // a saved cost that is the Business estimate (saved before the upgrade) counts as an estimate, so it is refreshed
    const bizCost = E.co2PriceEstimate(flight(up), 'medium', 'Business').cost;
    assert.ok(E.co2CostIsEstimate(flight({ ...up, co2Cost: bizCost })));
    assert.ok(E.co2CostIsEstimate(flight({ ...up, co2Cost: E.co2PriceEstimate(flight(up), 'medium').cost })));
    assert.ok(!E.co2CostIsEstimate(flight({ ...up, co2Cost: 123.45 })));   // typed in
    assert.ok(!E.co2CostIsEstimate(flight({ ...up, co2Cost: 0 })));
  }
  assert.strictEqual(est('MUC', 'SFO', 'Economy', 'medium'), null);                       // no long-haul Economy data
  assert.strictEqual(est('MUC', 'ZRH', 'Economy', 'none'), null);
  assert.strictEqual(E.co2PriceEstimate(flight({ flightNo: 'LH1', bookedClass: 'Economy' }), 'medium'), null);   // no route

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
  // IDs end up in HTML and selectors: unsafe and repeated ones are replaced; invalid entries are dropped
  const st = state({
    settings: { currency: 'XYZ', memberNumber: '992 000-123 456 789' },
    flights: [{ id: 'x"><b>', date: '2026-01-01' }, { id: 'ok-1', date: '2026-02-01' }, { id: 'ok-1', date: '2026-03-01' }, { date: 'yesterday' }],
    adjustments: [{ date: '2026-13' }, { date: '2026-04-01', p: 5 }], stays: [{ nights: 2 }],
    apiCache: { 'LH1 2026-01-01': null, 'LH2 2026-01-01': { status: 'notfound' }, LH3: { status: 'ok' } },   // LH3: saved before lookups had a date
    plans: { 2025: { co2: { 'ok-1': { level: 'small', cost: 5 } }, mix: [{ count: '2', kind: 'X' }, { id: 'm', kind: 'RAIL', cls: 'First', co2Level: 'large' }, { id: 'm' }] } },   // what-if for a 2026 flight in 2025
  });
  assert.ok(/^[\w-]+$/.test(st.flights[0].id) && st.flights[0].id !== 'x"><b>');
  assert.ok(st.flights[2].id !== 'ok-1' && st.plans['2025'].mix[2].id !== 'm');
  assert.strictEqual(`${st.flights.length}:${st.flights[1].id}:${st.adjustments.length}:${st.stays.length}:${Object.keys(st.apiCache)}:${st.settings.currency}`, '3:ok-1:1:0:LH2 2026-01-01:EUR');
  const mix = st.plans['2025'].mix;
  assert.strictEqual(`${Object.keys(st.plans['2025'].co2).length}:${mix[0].count}:${mix[0].kind}`, '0:2:LHG');
  assert.strictEqual(`${mix[1].cls}:${mix[1].co2Level}`, 'Business:none');   // trains: 1st class at most, no booster
  // as the dialog saves them: trains in 2nd or 1st class, and a CO₂ cost only with a booster on a flight
  const fx = state({ flights: [{ date: '2026-01-01', transport: 'rail', bookedClass: 'First', co2Level: 'large', co2Cost: 9 },
    { date: '2026-01-01', co2Level: 'none', co2Cost: 9 }, { date: '2026-01-01', co2Level: 'small', co2Cost: 9 }] }).flights;
  assert.strictEqual(`${fx[0].bookedClass}:${fx.map(f => f.co2Cost).join(',')}`, 'Economy:0,0,9');
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
  // parse: other files and the old format (version 1) are refused
  assert.throws(() => S.parse(JSON.stringify({ format: 'mm-status-tracker', version: 1, flights: [] })), /older version/);
  assert.throws(() => S.parse(JSON.stringify({ format: 'other', version: 2 })), /Not a Miles/);
  assert.throws(() => S.parse(JSON.stringify({ version: 2 })), /Not a Miles/);
  // a saved file loads back unchanged: demo data plus stays, a scenario, starting status and number
  const rich = S.demo(), f0 = rich.flights[0];
  Object.assign(rich.settings, { startStatus: { status: 'SEN', year: 2025 }, memberNumber: '992000123456789' });
  rich.stays.push(S.newStay(f0.date));
  rich.plans[f0.date.slice(0, 4)] = { co2: { [f0.id]: { level: 'small', cost: 5 } }, mix: [S.newMixRow()] };
  assert.strictEqual(JSON.stringify(S.parse(JSON.stringify(rich))), JSON.stringify(rich));
}

/* ---------- route lookup (adsbdb, AeroDataBox) with a stubbed fetch ---------- */
async function apiTests() {
  const st = state();
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const route = { flightroute: { origin: { iata_code: 'FRA', country_iso_name: 'DE' }, destination: { iata_code: 'JFK', country_iso_name: 'US' } } };
  const calls = [];
  respond = (url) => { calls.push(url.split('/').pop()); return url.endsWith('/UA9414') ? reply(404, { response: 'unknown callsign' }) : reply(200, { response: route }); };
  let res = await A.lookup(st, 'UA9414');
  assert.strictEqual(`${res.status}:${calls.join(',')}`, 'ok:UA9414,UAL9414');   // ICAO fallback
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
  assert.strictEqual((await A.lookup(st, 'LH400', null, { force: true })).status, 'ok');   // ... until forced
  respond = () => { throw new Error('offline'); };
  res = await A.lookup(st, 'LH400', null, { force: true });
  assert.strictEqual(`${res.status}:${A.cached(st, 'LH400').status}`, 'error:ok');    // a failed forced lookup keeps the answer

  // codeshares: without a route of their own, the operating flight's route (an error there is not final)
  respond = (url) => (url.endsWith('/LH488') ? reply(200, { response: route }) : reply(404, { response: 'unknown callsign' }));
  const op = await A.resolveRoute(st, 'UA1', 'LH488');
  assert.strictEqual(`${op.entry.status}:${op.via}:${op.route.via}:${op.route.origin.iata}`, 'ok:LH488:LH488:FRA');
  respond = (url) => { if (url.endsWith('/LH499')) throw new Error('offline'); return reply(404, { response: 'unknown callsign' }); };
  const failed = await A.resolveRoute(st, 'UA2', 'LH499');
  assert.strictEqual(`${failed.entry.status}:${failed.route}:${(await A.resolveRoute(st, 'UA2')).entry.status}`, 'error:null:notfound');

  // lookups are cached per flight date. adsbdb ignores the date, so an answer from another schedule season is
  // provisional and asked again once the flight's season has started (LH1966: MUC–OLB in summer, MUC–BER in winter).
  const fr = (dest) => ({ flightroute: { origin: { iata_code: 'MUC', country_iso_name: 'DE' }, destination: { iata_code: dest, country_iso_name: dest === 'OLB' ? 'IT' : 'DE' } } });
  const s2 = state();
  let dest = 'OLB';
  calls.length = 0;
  respond = (url) => { calls.push(url); return url.endsWith('/DLH1966') ? reply(200, { response: fr(dest) }) : reply(404, { response: 'unknown callsign' }); };
  const summer = new Date('2026-07-01T10:00:00Z'), october = new Date('2026-10-18T10:00:00Z'), winter = new Date('2026-10-26T10:00:00Z');
  const jul = await A.resolveRoute(s2, 'LH1966', null, '2026-07-10', { now: summer });
  assert.strictEqual(`${jul.route.destination.iata}:${A.otherSeason(jul.entry, '2026-07-10')}`, 'OLB:false');
  const nov = await A.lookup(s2, 'LH1966', '2026-11-17', { now: october });
  assert.strictEqual(`${nov.fromCache}:${calls.length}:${Object.keys(s2.apiCache).join('|')}`, 'false:4:LH1966 2026-07-10|LH1966 2026-11-17');   // its own key
  assert.strictEqual(`${A.otherSeason(nov, '2026-11-17')}:${A.isProvisional(nov, '2026-11-17', '2026-10-18')}`, 'true:false');   // summer answer, winter flight
  assert.strictEqual((await A.lookup(s2, 'LH1966', '2026-11-17', { now: october })).fromCache, true);   // not asked again before winter
  dest = 'BER';
  const info = A.lookupInfo(nov, 'LH1966');
  assert.strictEqual(`${A.isProvisional(info, '2026-11-17', '2026-10-25')}:${info.date}`, 'true:2026-11-17');   // f.routeLookup tells too
  const again = await A.resolveRoute(s2, 'LH1966', null, '2026-11-17', { now: winter });                    // winter has started
  assert.strictEqual(`${again.entry.fromCache}:${again.route.destination.iata}:${A.otherSeason(again.entry, '2026-11-17')}`, 'false:BER:false');
  assert.strictEqual((await A.lookup(s2, 'LH1966', '2026-07-10', { now: winter })).fromCache, true);   // a past summer flight keeps its answer
  assert.strictEqual(A.cacheKey('lh1966', '2026-11-17'), 'LH1966 2026-11-17');
  assert.strictEqual(`${A.isCacheKey('LH1966 2026-11-17')}:${A.isCacheKey('4Y123 2026-01-01')}:${A.isCacheKey('LH1966')}`, 'true:true:false');

  // with an AeroDataBox key: the route on the date first, adsbdb when it knows no such flight or fails
  const adbAp = (iata, city, cc) => ({ iata, name: `${city} Airport`, municipalityName: city, countryCode: cc, location: { lat: 1, lon: 2 } });
  const adbFlight = { number: 'LH 1966', airline: { name: 'Lufthansa' }, departure: { airport: adbAp('MUC', 'Munich', 'DE') }, arrival: { airport: adbAp('BER', 'Berlin', 'DE') } };
  const s3 = state(), heads = [];
  let adb = () => reply(200, [adbFlight]);
  calls.length = 0;
  respond = (url, opts) => {
    calls.push(url.replace(/^https:\/\/([^/]+).*?([^/]+)$/, '$1 $2'));
    if (url.includes('aerodatabox')) { heads.push(opts.headers['X-RapidAPI-Key']); return adb(); }
    return reply(200, { response: fr('OLB') });
  };
  const k = { key: 'secret', now: october };
  const byDate = await A.resolveRoute(s3, 'LH1966', null, '2026-11-17', k);
  assert.strictEqual(`${byDate.route.destination.iata}:${byDate.route.destination.city}:${byDate.route.provider}:${heads}`, 'BER:Berlin:aerodatabox:secret');
  assert.strictEqual(`${calls}:${A.otherSeason(byDate.entry, '2026-11-17')}`, 'aerodatabox.p.rapidapi.com 2026-11-17?dateLocalRole=Departure:false');   // date-exact, no adsbdb
  assert.strictEqual(A.airport(s3, 'BER').city, 'Berlin');                                       // airports from its answers too
  adb = () => reply(204, null);
  const none = await A.lookup(s3, 'LH1967', '2026-11-17', k);                                       // no such flight: adsbdb
  assert.strictEqual(`${none.provider}:${none.adbTried}:${none.response.flightroute.destination.iata_code}`, 'undefined:true:OLB');
  assert.strictEqual(A.isProvisional(none, '2026-11-17', '2026-10-18', 'secret'), false);          // asked once, not again
  adb = () => reply(429, null);
  const quota = await A.lookup(s3, 'LH1968', '2026-11-17', k);                                     // quota: adsbdb, ask again later
  assert.strictEqual(`${quota.status}:${quota.adbError}:${A.isProvisional(quota, '2026-11-17', '2026-10-18', 'secret')}`, 'ok:HTTP 429 – quota or rate limit:true');
  // an adsbdb answer from another season is asked again as soon as a key is set
  adb = () => reply(200, [adbFlight]);
  s2.apiCache['LH1966 2026-11-17'] = nov;                                                            // the summer answer again
  const withKey = await A.lookup(s2, 'LH1966', '2026-11-17', k);
  assert.strictEqual(`${withKey.fromCache}:${withKey.provider}`, 'false:aerodatabox');
}

module.exports = apiTests().then(() => console.log('engine tests passed'));
