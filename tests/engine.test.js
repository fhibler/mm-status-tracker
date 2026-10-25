/* Dependency-free tests for engine, store, API and the chart helpers: `node tests/engine.test.js` (CI), or tests/browser.html */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// The app's scripts run in their own context (like a browser page). fetch is stubbed per test via `respond`.
let respond = () => { throw new Error('unexpected fetch'); };
const ctx = { console, fetch: async (url, opts) => respond(url, opts) };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['data.js', 'airports.js', 'engine.js', 'api.js', 'store.js', 'charts.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const { MM } = ctx;
const E = MM.engine, S = MM.store, A = MM.api;
A.adbGap = 0;   // no wait between AeroDataBox requests
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
// dates shown in the page: a real date (or a time stamp starting with one), never other text, since it goes into HTML
assert.strictEqual(['2026-11-17', '2026-11-17T08:00:00.000Z', '<img src=x', '2026-13-01', null].map(MM.charts.fmtDate).join(','), '17 Nov 2026,17 Nov 2026,–,–,–');

/* ---------- money fields: a comma is a decimal separator too; three digits after it group thousands ---------- */
assert.strictEqual(['9,11', '9.11', '146,60', ' 146.6 ', '9,', ',5', '1.234,56', '1,234.56', '1.000.000', '12 345,6', '€ 7,30', "1'200.50", '1,200', '€1.000']
  .map(E.parseAmount).join(' '), '9.11 9.11 146.6 146.6 9 0.5 1234.56 1234.56 1000000 12345.6 7.3 1200.5 1200 1000');
assert.strictEqual(['', null, undefined, 'abc', '-5', '5-3', '.', 0, 12.5].map(E.parseAmount).join(' '), '0 0 0 0 0 0 0 0 12.5');

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
      lhBiz({ id: 'f1', date: '2026-03-01', bookingCode: 'B1', upgradeCost: 50 }),                         // flown, 200; upgrade cost without upgrade
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

  // price model: estimates within 3 % of prices seen on lufthansa.com (by distance and the cabin paid for; not MUC→SFO, which costs 1.31 × the model)
  const ap2 = (o, d) => ({ origin: MM.airport(o), destination: MM.airport(d) });
  const est = (o, d, cls, level, x = {}) => E.co2PriceEstimate(flight({ flightNo: 'LH1', route: ap2(o, d), bookedClass: cls, upgradeClass: cls, ...x }), level);
  for (const [o, d, cls, level, price, quality] of [
    ['ZRH', 'MUC', 'Business', 'medium', 6.85, 'good'], ['FRA', 'MUC', 'Business', 'xlarge', 22.60, 'good'],
    ['MUC', 'AMS', 'Business', 'large', 22.35, 'good'], ['MUC', 'LHR', 'Business', 'large', 26.82, 'good'],
    ['MUC', 'ZRH', 'Economy', 'medium', 4.74, 'good'], ['VIE', 'HAM', 'Economy', 'xlarge', 25.40, 'good'],
    ['MUC', 'SEA', 'Business', 'medium', 146.60, 'good'], ['FRA', 'SFO', 'Business', 'small', 76.19, 'good'],
    ['SFO', 'MUC', 'Business', 'medium', 165.80, 'good'], ['SFO', 'ZRH', 'Business', 'xlarge', 509.08, 'good'],
  ]) {
    const e = est(o, d, cls, level);
    assert.ok(e && Math.abs(e.cost / price - 1) < 0.03 && e.quality === quality, `${o}-${d} ${cls} ${level}: ${JSON.stringify(e)}`);
  }
  assert.strictEqual(est('MUC', 'SFO', 'Business', 'medium').cost, est('SFO', 'MUC', 'Business', 'medium').cost);   // by distance only
  assert.strictEqual(est('MUC', 'LIS', 'Business', 'medium').quality, 'rough');           // longer than the samples
  {  // booked Business, voucher upgrade to First: Points and CO₂ price as Business (also with earnClassOverride)
    const up = { flightNo: 'LH458', route: ap2('MUC', 'SFO'), bookedClass: 'Business', upgradeClass: 'First', upgradeType: 'voucher', co2Level: 'medium' };
    assert.strictEqual(pts(E.earn(flight(up), rules)), pts(E.earn(flight({ ...up, upgradeClass: 'Business', upgradeType: '' }), rules)));
    assert.strictEqual(E.earn(flight(up), rules).cls, 'Business');
    assert.strictEqual(E.co2PriceEstimate(flight(up), 'medium').cabin, 'Business');
    assert.strictEqual(E.co2PriceEstimate(flight({ ...up, earnClassOverride: 'First' }), 'medium').cabin, 'Business');
    assert.strictEqual(E.co2PriceEstimate(flight(up), 'medium', 'First'), null);           // no First data
    // a paid upgrade (fixed price, bid) is priced in the upgraded cabin
    const paid = { ...up, bookedClass: 'Premium Economy', upgradeClass: 'Business', upgradeType: 'fixed-online' };
    assert.strictEqual(E.co2PriceEstimate(flight(paid), 'medium').cabin, 'Business');
    assert.strictEqual(E.co2PriceEstimate(flight({ ...paid, upgradeType: 'bid' }), 'medium').cabin, 'Business');
    assert.strictEqual(E.co2PriceEstimate(flight({ ...paid, upgradeType: 'voucher' }), 'medium'), null);   // no long-haul Premium Economy data
    const contEco = { flightNo: 'LH2066', route: ap2('MUC', 'HAM'), bookedClass: 'Economy', upgradeClass: 'Business', upgradeType: 'fixed-online' };
    assert.strictEqual(E.co2PriceEstimate(flight(contEco), 'medium').cabin, 'Business');
    assert.strictEqual(E.co2PriceEstimate(flight({ ...contEco, upgradeType: 'miles' }), 'medium').cabin, 'Economy');
    // a saved cost that is the estimate in another cabin (e.g. saved before the upgrade) counts as an estimate
    assert.ok(E.co2CostIsEstimate(flight({ ...contEco, co2Cost: E.co2PriceEstimate(flight(contEco), 'medium', 'Economy').cost, co2Level: 'medium' })));
    assert.ok(E.co2CostIsEstimate(flight({ ...up, co2Cost: E.co2PriceEstimate(flight(up), 'medium').cost })));
    assert.ok(!E.co2CostIsEstimate(flight({ ...up, co2Cost: 123.45 })));   // typed in
    assert.ok(!E.co2CostIsEstimate(flight({ ...up, co2Cost: 0 })));
  }
  assert.strictEqual(est('MUC', 'SFO', 'Economy', 'medium'), null);                       // no long-haul Economy data
  assert.strictEqual(est('MUC', 'ZRH', 'Economy', 'none'), null);
  assert.strictEqual(E.co2PriceEstimate(flight({ flightNo: 'LH1', bookedClass: 'Economy' }), 'medium'), null);   // no route

  const plan = {
    co2: { a: { level: 'none', cost: 0 } },   // flight a is compensated, so it is locked: this what-if is ignored
    mix: [
      { count: 2, kind: 'LHG', haul: 'continental', cls: 'Business', co2Level: 'none', cost: 300 },
      { count: 4, kind: 'LHG', haul: 'intercontinental', cls: 'Premium Economy', co2Level: 'medium', cost: 900 },
      { count: 3, kind: 'STAR', haul: 'intercontinental', cls: 'Economy', co2Level: 'none', cost: 0 },
    ],
  };
  const sc = E.planScenario(st, 2026, plan, TODAY);
  assert.strictEqual(`${pts(sc.base.forecast)}:${pts(sc.withCo2.forecast)}:${sc.cost.co2Extra}`, '300,300,240:300,300,240:0');
  // + 2 × 40 continental Business, 4 × 96 Premium Economy intercontinental (80 + 20 %, no HON), 3 × 60 Star Alliance (Points only)
  assert.strictEqual(pts(sc.total), `${300 + 80 + 384 + 180},${300 + 80 + 384},${240 + 80}`);
  assert.strictEqual(`${sc.cost.mix}:${sc.status.total}`, '4200:FTL');
  assert.strictEqual(lh.co2Level, 'large');   // what-ifs never change the flight itself
  // when the status is reached: the extra segments have no dates, so they count on 31 December
  assert.strictEqual(JSON.stringify(sc.reached), '{"FTL":{"date":"2026-12-31","step":"mix"}}');
  {  // the CO₂ what-ifs date it by the flight that carries them
    const three = state({ flights: ['2026-01-10', '2026-02-10', '2026-03-10'].map((date, i) => lhBiz({ id: `t${i}`, date })) });   // 3 × 200 P
    const at = (plan, today = TODAY) => JSON.stringify(E.planScenario(three, 2026, { co2: {}, mix: [], ...plan }, today).reached.FTL);
    assert.strictEqual(at({}), undefined);
    assert.strictEqual(at({ co2: { t1: { level: 'large', cost: 40 } } }), '{"date":"2026-03-10","step":"co2"}');   // 300 + 200 + 200 ≥ 650 with the 3rd
    const oneMore = { mix: [{ count: 1, kind: 'LHG', haul: 'intercontinental', cls: 'Economy', co2Level: 'none', cost: 0 }] };
    assert.strictEqual(at(oneMore), '{"date":"2026-12-31","step":"mix"}');
  }
  {  // a compensated flight is locked: loading drops its what-ifs; removing the compensation unlocks it
    const lk = state({ flights: [lh], plans: { 2026: { co2: { a: { level: 'xlarge', cost: 90 } }, mix: [] } } });
    assert.strictEqual('a' in lk.plans['2026'].co2, false);
    const f = S.removeBooster(lk, 'a');
    assert.strictEqual(`${f.co2Level}:${f.co2Cost}:${E.hasBooster(f)}:${lh.co2Level}`, 'none:0:false:large');
    const un = E.planScenario(lk, 2026, { co2: { a: { level: 'large', cost: 40 } }, mix: [] }, TODAY);
    assert.strictEqual(`${pts(un.base.forecast)}:${pts(un.withCo2.forecast)}:${un.cost.co2Extra}`, '200,200,200:300,300,240:40');
    // saving a booster to the flight (Apply, or the flight dialog) locks it again and drops its what-ifs
    lk.plans['2026'].co2.a = { level: 'small', cost: 10 };
    S.saveFlight(lk, { ...f, co2Level: 'large', co2Cost: 40 }, 0);
    assert.strictEqual('a' in lk.plans['2026'].co2, false);
    assert.strictEqual(S.removeBooster(lk, 'nope'), undefined);
  }
  // the dashboard's "incl. Planner" view: the same totals, cost and status as the scenario, as planned items
  const sp = state({ ...st, plans: { 2026: plan, 2025: { co2: {}, mix: [plan.mix[0]] } } });
  const wp = E.yearSummary(E.withPlans(sp, TODAY), 2026, TODAY);
  assert.strictEqual(`${pts(wp.forecast)}:${pts(wp.actual)}:${wp.cost.all.total}:${wp.statusForecast}`, `${pts(sc.total)}:${pts(sc.withCo2.actual)}:${sc.cost.total}:FTL`);
  assert.strictEqual(`${wp.rows.filter(x => x.planned).length}:${wp.reached.forecastBy.FTL}`, '9:Planner');
  assert.strictEqual(E.yearSummary(E.withPlans(sp, TODAY), 2025, TODAY).rows.length, 1);   // no extra segments in an ended year
  assert.strictEqual(`${sp.flights.length}:${sp.flights.find(f => f.id === 'a').co2Level}`, '2:large');   // the state itself is unchanged
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
    flights: [{ id: 'x"><b>', date: '2026-01-01' }, { id: 'ok-1', date: '2026-02-01' }, { id: 'ok-1', date: '2026-03-01' }, { date: 'yesterday' }, { date: '2026-02-30' }],
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
  // as the dialog saves them: trains in 2nd or 1st class without upgrades or overrides, and a CO₂ cost only with a booster on a flight
  const fx = state({ flights: [{ date: '2026-01-01', transport: 'rail', bookedClass: 'First', upgradeClass: 'First', upgradeType: 'bid', upgradeCost: 50,
    earnClassOverride: 'First', co2Level: 'large', co2Cost: 9 }, { date: '2026-01-01', co2Level: 'none', co2Cost: 9 }, { date: '2026-01-01', co2Level: 'small', co2Cost: 9 }] }).flights;
  assert.strictEqual(`${fx[0].bookedClass}:${fx[0].upgradeClass}:${fx[0].earnClassOverride}:${E.cost(fx[0], 0).total}:${fx.map(f => f.co2Cost).join(',')}`, 'Economy:Economy:auto:0:0,0,9');
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
  // a saved file loads back unchanged: demo data plus stays, a scenario, starting status, number and AeroDataBox key
  const rich = S.demo(), f0 = rich.flights.find(f => E.canBoost(f) && !E.hasBooster(f));   // a what-if needs a flight without a booster
  Object.assign(rich.settings, { startStatus: { status: 'SEN', year: 2025 }, memberNumber: '992000123456789', aerodataboxKey: 'ab12cd34', aerodataboxVia: 'apimarket' });
  rich.stays.push(S.newStay(f0.date));
  rich.plans[f0.date.slice(0, 4)] = { co2: { [f0.id]: { level: 'small', cost: 5 } }, mix: [S.newMixRow()] };
  assert.strictEqual(JSON.stringify(S.parse(JSON.stringify(rich))), JSON.stringify(rich));
}

/* ---------- flight times: kept per flight number and date, flights sorted by departure in UTC ---------- */
{
  const times = (flightNo, date, depUtc) => ({ flightNo, date, provider: 'aerodatabox', aircraft: 'Airbus A350-900', reg: 'D-AIXA',
    dep: { scheduled: { utc: `${date}T${depUtc}Z`, local: `${date}T${depUtc}+00:00` }, terminal: 1 },
    arr: { scheduled: { utc: `${date}T23:00Z`, local: `${date}T18:00-05:00` } } });
  const a = flight({ id: 'a', flightNo: 'LH400', date: '2026-03-01', times: times('LH400', '2026-03-01', '18:00') });
  const b = flight({ id: 'b', flightNo: 'LH401', date: '2026-03-01', times: times('LH401', '2026-03-01', '06:00') });
  const c = flight({ id: 'c', flightNo: 'LH402', date: '2026-03-01' });                                          // no times: last
  const d = flight({ id: 'd', flightNo: 'LH403', date: '2026-02-28', times: times('LH403', '2026-02-28', '23:00') });
  const st = state({ flights: [c, a, b, d] });
  assert.strictEqual(E.yearSummary(st, 2026, TODAY).rows.map(r => r.f.id).join(''), 'dbac');
  assert.strictEqual(`${st.flights[1].times.dep.terminal}:${st.flights[1].times.arr.scheduled.local}`, '1:2026-03-01T18:00-05:00');   // normalized
  assert.strictEqual(E.flightTimes({ ...st.flights[1], date: '2026-03-02' }), null);       // looked up for another date ...
  assert.strictEqual(E.flightTimes({ ...st.flights[1], flightNo: 'LH9' }), null);          // ... or number
  assert.strictEqual(state({ flights: [{ ...a, times: { ...a.times, dep: { scheduled: { utc: 'soon' } } } }] }).flights[0].times, null);   // invalid times are dropped
}

/* ---------- route lookup (adsbdb, AeroDataBox) with a stubbed fetch ---------- */
async function apiTests() {
  const st = state();
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const route = { flightroute: { origin: { iata_code: 'FRA', country_iso_name: 'DE' }, destination: { iata_code: 'JFK', country_iso_name: 'US' } } };
  const calls = [], D = TODAY, at = { now: new Date(`${TODAY}T10:00:00Z`) };   // a flight today, without a key: adsbdb
  respond = (url) => { calls.push(url.split('/').pop()); return url.endsWith('/UA9414') ? reply(404, { response: 'unknown callsign' }) : reply(200, { response: route }); };
  let res = await A.lookup(st, 'UA9414', D, at);
  assert.strictEqual(`${res.status}:${calls.join(',')}`, 'ok:UA9414,UAL9414');   // ICAO fallback
  res = await A.lookup(st, 'UA9414', D, at);
  assert.strictEqual(`${res.fromCache}:${calls.length}`, 'true:2');               // cached: no new request
  assert.strictEqual(A.airport(st, 'JFK').country, 'US');                         // airports from cached routes ...
  assert.strictEqual(A.airport(st, 'AUS').city, 'Austin');                        // ... or from the airport table
  respond = () => reply(429, null);
  assert.strictEqual((await A.lookup(st, 'LH400', D, at)).status, 'error');       // rate limit: not cached as "not found"
  respond = () => reply(404, { response: 'unknown callsign' });
  assert.strictEqual((await A.lookup(st, 'LH400', D, at)).status, 'notfound');    // an error is asked again
  respond = () => reply(200, { response: route });
  assert.strictEqual((await A.lookup(st, 'LH400', D, at)).fromCache, true);       // "not found" is final ...
  assert.strictEqual((await A.lookup(st, 'LH400', D, { ...at, force: true })).status, 'ok');   // ... until forced
  respond = () => { throw new Error('offline'); };
  res = await A.lookup(st, 'LH400', D, { ...at, force: true });
  assert.strictEqual(`${res.status}:${A.cached(st, 'LH400', D).status}`, 'error:ok');   // a failed forced lookup keeps the answer

  // codeshares: the operating flight is asked first (the codeshare number is often unknown), then the flight number;
  // an error is not final
  let asked = [];
  respond = (url) => { asked.push(url.split('/').pop()); return url.endsWith('/LH488') ? reply(200, { response: route }) : reply(404, { response: 'unknown callsign' }); };
  const op = await A.resolveRoute(st, 'UA1', 'LH488', D, at);
  assert.strictEqual(`${op.entry.status}:${op.via}:${op.route.via}:${op.resolved}:${op.route.origin.iata}`, 'ok:LH488:LH488:LH488:FRA');
  assert.strictEqual(asked.join(), 'LH488');                                    // the codeshare number is not asked
  asked = [];
  respond = (url) => { asked.push(url.split('/').pop()); return url.endsWith('/UA3') ? reply(200, { response: route }) : reply(404, { response: 'unknown callsign' }); };
  const own = await A.resolveRoute(st, 'UA3', 'LH477', D, at);                   // the operating flight is unknown
  assert.strictEqual(`${own.entry.status}:${own.via}:${own.route.via}:${own.resolved}`, 'ok:undefined:undefined:UA3');
  assert.strictEqual(asked.join(), 'LH477,DLH477,UA3');
  assert.strictEqual(A.lookupInfo(own.entry, 'UA3', own.via, 'LH477').operating, 'LH477');   // the dialog says it fell back
  respond = (url) => { if (url.endsWith('/LH499')) throw new Error('offline'); return reply(404, { response: 'unknown callsign' }); };
  const failed = await A.resolveRoute(st, 'UA2', 'LH499', D, at);
  assert.strictEqual(`${failed.entry.status}:${failed.route}:${failed.resolved}:${(await A.resolveRoute(st, 'UA2', null, D, at)).entry.status}`, 'error:null:null:notfound');
  respond = (url) => (url.endsWith('/LH4') ? reply(500, null) : reply(429, null));   // a server error, then the quota
  assert.strictEqual((await A.resolveRoute(st, 'UA4', 'LH4', D, at)).entry.failure.reason, 'quota');   // a failure that repeats is told

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
  const s3 = state({ settings: { aerodataboxKey: ' secret ' } }), heads = [];   // the key from the settings (spaces dropped)
  let adb = () => reply(200, [adbFlight]);
  calls.length = 0;
  respond = (url, opts) => {
    calls.push(url.replace(/^https:\/\/([^/]+).*?([^/]+)$/, '$1 $2'));
    if (url.includes('aerodatabox')) { heads.push(opts.headers['X-RapidAPI-Key']); return adb(); }
    return reply(200, { response: fr('OLB') });
  };
  const k = { now: october };
  const byDate = await A.resolveRoute(s3, 'LH1966', null, '2026-11-17', k);
  assert.strictEqual(`${byDate.route.destination.iata}:${byDate.route.destination.city}:${byDate.route.provider}:${heads}`, 'BER:Berlin:aerodatabox:secret');
  assert.strictEqual(`${calls}:${A.otherSeason(byDate.entry, '2026-11-17')}`, 'aerodatabox.p.rapidapi.com 2026-11-17?dateLocalRole=Departure:false');   // date-exact, no adsbdb
  assert.strictEqual(A.airport(s3, 'BER').city, 'Berlin');                                       // airports from its answers too
  // called directly or via API.Market instead of via RapidAPI: same path, their host and key header
  assert.strictEqual(`${s3.settings.aerodataboxVia}:${state({ settings: { aerodataboxVia: 'other' } }).settings.aerodataboxVia}`, 'rapidapi:rapidapi');   // the default, also for older files
  const sd = state({ settings: { aerodataboxKey: 'mkt', aerodataboxVia: 'apimarket' } }), sent = [], viaRapid = respond;
  respond = (url, opts) => { sent.push(`${url} ${JSON.stringify(opts.headers)}`); return adb(); };
  assert.strictEqual((await A.lookup(sd, 'LH1966', '2026-11-17', k)).provider, 'aerodatabox');
  assert.strictEqual(sent.join(), 'https://prod.api.market/api/v1/aedbx/aerodatabox/flights/number/LH1966/2026-11-17?dateLocalRole=Departure {"Accept":"application/json","x-api-market-key":"mkt"}');
  sd.apiCache = {};   // a forced refresh of the times goes the same way
  await A.refreshTimes(sd, 'LH1966', '2026-11-17', k);
  assert.ok(sent[1].startsWith('https://prod.api.market/') && sent[1].includes('x-api-market-key'));
  Object.assign(sd, { apiCache: {} }).settings.aerodataboxVia = 'direct';
  await A.lookup(sd, 'LH1966', '2026-11-17', k);
  assert.strictEqual(sent[2], 'https://api.aerodatabox.com/flights/number/LH1966/2026-11-17?dateLocalRole=Departure&apiKey=mkt {"Accept":"application/json"}');   // no preflight
  // a failure that repeats for every flight says why, and is not cached: blocked (CORS, offline), key rejected, quota
  respond = (url) => { if (url.includes('aerodatabox')) throw new TypeError('Failed to fetch'); return reply(200, { response: fr('OLB') }); };
  sd.apiCache = {};
  const blocked = await A.lookup(sd, 'LH1966', '2026-11-17', k);   // adsbdb still answers
  assert.strictEqual(`${blocked.status}:${blocked.failure.provider}:${blocked.failure.reason}:${/^blocked or unreachable \(network or CORS\)/.test(blocked.adbError)}`, 'ok:AeroDataBox:network:true');
  respond = () => { throw new TypeError('Failed to fetch'); };
  sd.apiCache = {};
  const offline = await A.resolveRoute(sd, 'UA9', 'LH1966', '2026-11-17', k);
  assert.strictEqual(`${offline.entry.status}:${offline.entry.failure.provider}:${offline.entry.failure.reason}:${Object.keys(sd.apiCache).length}`, 'error:adsbdb:network:0');   // not cached, the codeshare number not asked
  respond = (url) => url.includes('aerodatabox') ? reply(401, null) : reply(200, { response: fr('OLB') });
  assert.strictEqual((await A.lookup(sd, 'LH1966', '2026-11-17', k)).failure.message, 'key rejected (HTTP 401) – is it a key from AeroDataBox?');
  assert.strictEqual(`${A.isRapidApiKey('0123456789msh0123456789abcdefp1a2b3cjsn0123456789ab')}:${A.isRapidApiKey('0123456789abcdef')}`, 'true:false');
  respond = () => reply(429, null);
  const s5 = state(), had = { date: D, fetchedAt: '2026-06-01T10:00:00.000Z', status: 'error', error: 'HTTP 500' };
  s5.apiCache[A.cacheKey('LH7', D)] = had;
  assert.strictEqual(`${(await A.lookup(s5, 'LH7', D, at)).failure.reason}:${A.cached(s5, 'LH7', D).error}`, 'quota:HTTP 500');   // the earlier answer stays
  respond = () => reply(500, null);
  assert.strictEqual(`${(await A.lookup(s5, 'LH7', D, at)).failure}:${A.cached(s5, 'LH7', D).error}`, 'undefined:HTTP 500');   // a server error is cached as before
  respond = viaRapid;
  // its route is for the date it was asked for: a flight moved to the summer is flagged and asked again
  assert.strictEqual(`${A.lookupSeason(byDate.entry)}:${A.isProvisional(A.lookupInfo(byDate.entry, 'LH1966'), '2026-07-10', '2026-10-18', 'secret')}`, 'W26:true');
  adb = () => reply(204, null);
  const none = await A.lookup(s3, 'LH1967', '2026-11-17', k);                                       // no such flight: adsbdb
  assert.strictEqual(`${none.provider}:${none.adbTried}:${none.adbNote}:${none.response.flightroute.destination.iata_code}`, 'undefined:true:no such flight on that date:OLB');
  assert.strictEqual(A.isProvisional(none, '2026-11-17', '2026-10-18', 'secret'), false);          // asked once, not again
  assert.strictEqual(A.lookupInfo(none, 'LH1967').adbNote, 'no such flight on that date');           // the dialog says why
  adb = () => reply(400, { message: 'date out of range' });
  assert.strictEqual((await A.lookup(s3, 'LH1969', '2028-01-01', k)).adbNote, 'date not available: date out of range');
  // a plan's date range: learned from its 400 answer, per way of calling; older dates are then not asked (they cost units)
  const s6 = state({ settings: { aerodataboxKey: 'own', aerodataboxVia: 'direct' } });
  let asks6 = 0;
  respond = (url) => {
    if (!url.includes('aerodatabox')) return reply(404, { response: 'unknown callsign' });
    asks6++;
    return reply(400, { message: 'Specified date-time \'01.03.2026 00:00\' must not be earlier than 180 day(s) ago. Please consider upgrading your plan.' });
  };
  const old = await A.lookup(s6, 'LH10', '2026-03-01', k);
  assert.strictEqual(`${old.adbNote}:${old.adbVia}:${s6.settings.aerodataboxLimits.direct.pastDays}:${asks6}`, 'older than your AeroDataBox plan allows (180 days):direct:180:1');
  assert.strictEqual(`${A.outsidePlan(s6.settings, '2026-04-20', '2026-10-18')}|${A.outsidePlan(s6.settings, '2026-04-21', '2026-10-18')}`, 'older than your AeroDataBox plan allows (180 days)|');
  assert.strictEqual((await A.lookup(s6, 'LH11', '2026-02-01', k)).adbNote, 'older than your AeroDataBox plan allows (180 days)');
  assert.strictEqual(`${asks6}:${A.timesCalls(s6, 'LH12', null, '2026-02-01', '2026-10-18')}:${A.timesCalls(s6, 'LH12', null, '2026-10-01', '2026-10-18')}`, '1:0:1');   // not asked, not counted
  const notAsked = await A.refreshTimes(s6, 'LH10', '2026-03-01', { now: new Date(october.getTime() + 6 * 60000) });   // nor refreshed, and no wait starts
  assert.strictEqual(`${notAsked.note}:${asks6}:${A.cached(s6, 'LH10', '2026-03-01').refreshedAt}`, 'older than your AeroDataBox plan allows (180 days):1:undefined');
  assert.strictEqual(JSON.stringify(S.parse(JSON.stringify(s6)).settings.aerodataboxLimits), '{"direct":{"pastDays":180}}');   // saved in the .json
  assert.strictEqual(A.whyNoTimes('date not available: Specified date-time \'01.03.2026 00:00\' must not be earlier than 180 day(s) ago.'), 'older than your AeroDataBox plan allows (180 days)');   // notes saved before
  assert.strictEqual(A.whyNoTimes('no such flight on that date'), 'AeroDataBox doesn\'t know this flight on that date');
  s6.settings.aerodataboxVia = 'rapidapi';   // another way may have another plan: those dates may be asked again
  A.forgetPlanNotes(s6);
  assert.strictEqual(`${A.cached(s6, 'LH10', '2026-03-01').adbTried}:${A.outsidePlan(s6.settings, '2026-02-01', '2026-10-18')}:${A.timesCalls(s6, 'LH10', null, '2026-03-01', '2026-10-18')}`, 'undefined::1');
  s6.settings.aerodataboxVia = 'direct';
  A.forgetPlanNotes(s6, true);   // a new key forgets what the plan allowed
  assert.strictEqual(A.outsidePlan(s6.settings, '2026-02-01', '2026-10-18'), '');
  // a date further ahead than the plan allows is not asked until it moves into the plan's range
  const s8 = state({ settings: { aerodataboxKey: 'own' } }), nov20 = { now: new Date('2026-11-20T10:00:00Z') };
  respond = (url) => url.includes('aerodatabox') ? reply(400, { message: 'Specified date must not be later than 30 day(s) from now.' }) : reply(404, { response: 'unknown callsign' });
  const ahead = await A.lookup(s8, 'LH14', '2026-12-10', { now: winter });   // 45 days after 26 Oct
  assert.strictEqual(`${ahead.adbNote}:${s8.settings.aerodataboxLimits.rapidapi.futureDays}:${A.timesCalls(s8, 'LH14', null, '2026-12-10', '2026-10-26')}:${A.timesCalls(s8, 'LH14', null, '2026-12-10', '2026-11-20')}`,
    'further ahead than your AeroDataBox plan allows (30 days):30:0:1');
  respond = (url) => url.includes('aerodatabox') ? reply(200, [adbFlight]) : reply(404, null);
  assert.strictEqual((await A.lookup(s8, 'LH14', '2026-12-10', nov20)).provider, 'aerodatabox');
  // AeroDataBox is asked at most once per A.adbGap, also by lookups at the same time
  const sentAt = [];
  respond = () => { sentAt.push(Date.now()); return reply(200, [adbFlight]); };
  A.adbGap = 40;
  await Promise.all(['LH15', 'LH16'].map(no => A.lookup(s8, no, '2026-11-01', k)));
  A.adbGap = 0;
  assert.ok(sentAt.length === 2 && sentAt[1] - sentAt[0] >= 30, `${sentAt}`);
  // an answer without an arrival time (e.g. a diverted flight, UA520 SAN–SFO) keeps the departure, with arr null, also in a saved file
  respond = (url) => url.includes('aerodatabox') ? reply(200, [{ ...adbFlight, departure: { ...adbFlight.departure, scheduledTime: { utc: '2026-11-17 06:15Z', local: '2026-11-17 07:15+01:00' } } }]) : reply(404, null);
  const noArr = await A.lookup(s6, 'LH13', '2026-11-17', k), tNoArr = A.timesFromCache(noArr, 'LH13', '2026-11-17');
  assert.strictEqual(`${noArr.provider}:${tNoArr.dep.scheduled.utc}:${tNoArr.arr}:${S.normalizeTimes(tNoArr).arr}`, 'aerodatabox:2026-11-17T06:15Z:null:null');
  assert.strictEqual(S.normalizeTimes({ ...tNoArr, arr: { scheduled: null } }).arr, null);   // as saved before this
  respond = viaRapid;
  adb = () => reply(200, [{ ...adbFlight, arrival: { airport: { name: 'Somewhere' } } }]);
  assert.strictEqual((await A.lookup(s3, 'LH1970', '2026-11-17', k)).adbNote, 'no route in its answer');
  adb = () => reply(429, null);
  const quota = await A.lookup(s3, 'LH1968', '2026-11-17', k);                                     // quota: adsbdb, ask again later
  assert.strictEqual(`${quota.status}:${quota.adbError}:${quota.failure.reason}:${A.isProvisional(quota, '2026-11-17', '2026-10-18', 'secret')}`, 'ok:quota or rate limit reached (HTTP 429):quota:true');
  // AeroDataBox failed and adsbdb doesn't know the flight: no final answer, so it is asked (and counted) again
  respond = (url) => { calls.push(url); return url.includes('aerodatabox') ? reply(429, null) : reply(404, { response: 'unknown callsign' }); };
  const lost = await A.lookup(s3, 'LH1971', '2026-11-17', k);
  assert.strictEqual(`${lost.status}:${lost.failure.reason}:${A.settled(lost, 'secret')}:${A.settled(lost, '')}:${A.timesCalls(s3, 'LH1971', null, '2026-11-17', '2026-10-18')}`, 'notfound:quota:false:true:1');
  respond = viaRapid;
  adb = () => reply(200, [adbFlight]);
  assert.strictEqual((await A.lookup(s3, 'LH1971', '2026-11-17', k)).provider, 'aerodatabox');
  // a forced lookup while AeroDataBox fails keeps its date-exact answer, without asking adsbdb
  respond = (url) => { calls.push(url); return url.includes('aerodatabox') ? reply(429, null) : reply(404, { response: 'unknown callsign' }); };
  calls.length = 0;
  const keptAdb = await A.lookup(s3, 'LH1971', '2026-11-17', { ...k, force: true });
  assert.strictEqual(`${keptAdb.provider}:${keptAdb.fromCache}:${keptAdb.failure.reason}:${keptAdb.adbFailed}:${calls.length}:${A.cached(s3, 'LH1971', '2026-11-17').provider}`,
    'aerodatabox:true:quota:quota or rate limit reached (HTTP 429):1:aerodatabox');
  respond = viaRapid;
  // an adsbdb answer from another season is asked again as soon as a key is set
  adb = () => reply(200, [adbFlight]);
  s2.apiCache['LH1966 2026-11-17'] = nov;                                                            // the summer answer again
  s2.settings.aerodataboxKey = 'secret';
  const withKey = await A.lookup(s2, 'LH1966', '2026-11-17', k);
  assert.strictEqual(`${withKey.fromCache}:${withKey.provider}`, 'false:aerodatabox');
  // so is adsbdb's "not found" of the same season: AeroDataBox may know the flight
  s2.apiCache['LH20 2026-10-20'] = { date: '2026-10-20', fetchedAt: '2026-10-01T10:00:00.000Z', status: 'notfound', response: null };
  assert.strictEqual(`${A.timesCalls(s2, 'LH20', null, '2026-10-20', '2026-10-18')}:${(await A.lookup(s2, 'LH20', '2026-10-20', k)).provider}`, '1:aerodatabox');

  // times and aircraft: AeroDataBox gives them with the route (adsbdb knows none), in UTC and local time
  assert.strictEqual(`${A.isoTime('2026-11-17 06:15Z')}|${A.isoTime('2026-11-17 07:15+0100')}|${A.isoTime('2026-11-17T07:15:00-05:30')}|${A.isoTime('07:15')}`,
    '2026-11-17T06:15Z|2026-11-17T07:15+01:00|2026-11-17T07:15-05:30|null');
  const timed = { ...adbFlight, aircraft: { reg: 'D-AINA', model: 'Airbus A320 NEO' },
    departure: { ...adbFlight.departure, scheduledTime: { utc: '2026-11-17 06:15Z', local: '2026-11-17 07:15+01:00' }, terminal: '2' },
    arrival: { ...adbFlight.arrival, scheduledTime: { utc: '2026-11-17 07:20Z', local: '2026-11-17 08:20+01:00' }, revisedTime: { utc: '2026-11-17 07:31Z', local: '2026-11-17 08:31+01:00' } } };
  const s4 = state({ settings: { aerodataboxKey: 'secret' } });
  adb = () => reply(200, [timed]);
  calls.length = 0;
  const lk = await A.resolveRoute(s4, 'LH1966', null, '2026-11-17', k);
  const t = A.timesFromCache(lk.entry, 'LH1966', '2026-11-17', lk.via);
  assert.strictEqual(`${calls.length}:${t.dep.scheduled.utc}:${t.dep.scheduled.local}:${t.dep.terminal}:${t.arr.revised.utc}:${t.aircraft}:${t.reg}`,
    '1:2026-11-17T06:15Z:2026-11-17T07:15+01:00:2:2026-11-17T07:31Z:Airbus A320 NEO:D-AINA');   // one request for route and times
  assert.strictEqual(A.timesPending(s4, 'LH1966', null, '2026-11-17', '2026-10-18'), false);
  // at most how many requests a flight's times take (what "Refresh flight data" says it costs): a codeshare up to 2
  assert.strictEqual([A.timesCalls(s4, 'LH1966', null, '2026-11-17', '2026-10-18'), A.timesCalls(s4, 'LH8', null, '2026-11-17', '2026-10-18'),
    A.timesCalls(s4, 'UA8', 'LH8', '2026-11-17', '2026-10-18'), A.timesCalls(s4, 'UA8', 'LH1966', '2026-11-17', '2026-10-18')].join(), '0,1,2,0');
  // a cached route without times (adsbdb, or AeroDataBox before times were kept) asks AeroDataBox once more, and only it
  s4.apiCache['LH1966 2026-11-17'] = { ...nov, adbTried: undefined };   // adsbdb, summer route
  s4.apiCache['LH1967 2026-11-17'] = { date: '2026-11-17', fetchedAt: '2026-10-18T10:00:00.000Z', provider: 'aerodatabox', status: 'ok', response: { flightroute: { ...fr('BER').flightroute } } };
  assert.strictEqual(`${A.timesPending(s4, 'LH1967', null, '2026-11-17', '2026-10-18')}:${A.timesPending(state(), 'LH1967', null, '2026-11-17')}`, 'true:false');   // not without a key
  adb = () => reply(429, null);
  calls.length = 0;
  const kept = await A.lookup(s4, 'LH1967', '2026-11-17', k);
  assert.strictEqual(`${calls.length}:${kept.provider}:${kept.response.flightroute.destination.iata_code}:${A.wantsTimes(kept, 'secret')}`, '1:aerodatabox:BER:true');   // the route stays, asked again later
  adb = () => reply(204, null);
  await A.lookup(s4, 'LH1967', '2026-11-17', k);
  assert.strictEqual(`${A.cached(s4, 'LH1967', '2026-11-17').adbTried}:${A.timesPending(s4, 'LH1967', null, '2026-11-17', '2026-10-18')}`, 'true:false');   // no such flight: not again
  adb = () => reply(200, [timed]);
  const added = await A.resolveRoute(s4, 'LH1966', null, '2026-11-17', k);
  assert.strictEqual(`${added.route.destination.iata}:${!!A.timesFromCache(added.entry)}`, 'BER:true');
  // several routes for one number on a date (a flight with a stop): all are kept, the flight's airports pick one
  const leg = (from, to, dep) => ({ ...timed, departure: { airport: adbAp(from, from, 'DE'), scheduledTime: { utc: `2026-11-17 ${dep}Z`, local: `2026-11-17 ${dep}+00:00` } },
    arrival: { airport: adbAp(to, to, 'DE'), scheduledTime: { utc: '2026-11-17 23:00Z', local: '2026-11-17 23:00+00:00' } } });
  adb = () => reply(200, [leg('MUC', 'HAM', '06:00'), leg('HAM', 'SYL', '09:00'), leg('MUC', 'HAM', '06:00')]);   // one listed twice
  const two = await A.resolveRoute(s4, 'LH2', null, '2026-11-17', k);
  assert.strictEqual(`${A.legs(two.entry).map(l => l.origin.iata_code + l.destination.iata_code)}:${two.leg}:${two.route.destination.iata}`, 'MUCHAM,HAMSYL:0:HAM');
  const second = await A.resolveRoute(s4, 'LH2', null, '2026-11-17', { ...k, route: { origin: { iata: 'HAM' }, destination: { iata: 'SYL' } } });
  assert.strictEqual(`${second.entry.fromCache}:${second.leg}:${second.route.origin.iata}:${A.timesFromCache(second.entry, 'LH2', '2026-11-17', undefined, second.leg).dep.scheduled.utc}`,
    'true:1:HAM:2026-11-17T09:00Z');
  assert.strictEqual(A.airport(s4, 'SYL').city, 'SYL');   // airports of every leg

  // a forced refresh of the times: AeroDataBox only, at most once per 5 minutes per number and date
  const t0 = new Date('2026-11-17T05:00:00Z'), later = (min) => ({ now: new Date(t0.getTime() + min * 60000) });
  s4.apiCache['LH5 2026-11-17'] = { date: '2026-11-17', fetchedAt: t0.toISOString(), provider: 'aerodatabox', status: 'ok', response: { flightroute: A.legs(lk.entry)[0] } };
  calls.length = 0;
  assert.strictEqual((await A.refreshTimes(s4, 'LH5', '2026-11-17', later(4))).note, 'refreshed less than 5 minutes ago');
  adb = () => reply(200, [{ ...timed, departure: { ...timed.departure, revisedTime: { utc: '2026-11-17 06:45Z', local: '2026-11-17 07:45+01:00' } } }]);
  const fresh = await A.refreshTimes(s4, 'LH5', '2026-11-17', later(5));
  assert.strictEqual(`${calls.length}:${fresh.note}:${A.timesFromCache(fresh.entry, 'LH5', '2026-11-17').dep.revised.utc}`, '1::2026-11-17T06:45Z');
  adb = () => reply(429, null);
  await assert.rejects(A.refreshTimes(s4, 'LH5', '2026-11-17', later(11)));
  assert.strictEqual(`${(await A.refreshTimes(s4, 'LH5', '2026-11-17', later(12))).note}:${calls.length}:${A.cached(s4, 'LH5', '2026-11-17').provider}`,
    'refreshed less than 5 minutes ago:2:aerodatabox');   // a failed request counts too, and the answer stays
  assert.strictEqual((await A.refreshTimes(state(), 'LH5', '2026-11-17')).note, 'no AeroDataBox key');

  // codeshare: the operating flight's times
  calls.length = 0;
  const cs = await A.resolveRoute(s4, 'UA9', 'LH1966', '2026-11-17', k);
  assert.strictEqual(`${calls.length}:${A.timesFromCache(cs.entry, 'UA9', '2026-11-17', cs.via).via}`, '0:LH1966');
}

module.exports = apiTests().then(() => console.log('engine tests passed'));
