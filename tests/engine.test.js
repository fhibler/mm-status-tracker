/* Dependency-free smoke test for the points engine: `node tests/engine.test.js` */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { window: {}, console, Set, Math, Date, JSON, Object, Array, String, Number };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['data.js', 'airports.js', 'engine.js', 'api.js', 'store.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const { MM } = ctx;
const E = MM.engine;
const rules = MM.DEFAULT_RULES;
const ap = (country) => ({ iata: 'X', country, lat: 0, lon: 0 });
const flight = (o) => ({ ...MM.store.newFlight('2026-03-01'), ...o });

// flight number parsing
assert.strictEqual(E.parseFlightNo('lh 400').iata, 'LH400');
assert.strictEqual(E.parseFlightNo('4Y123').code, '4Y');
assert.strictEqual(E.parseFlightNo('DLH400').code, 'LH');
assert.strictEqual(E.parseFlightNo('12345'), null);

// airport table (manual routes)
assert.strictEqual(MM.airport('aus').country, 'US');
assert.strictEqual(MM.airport('AUS').city, 'Austin');
assert.strictEqual(MM.airport('XXX'), null);

// haul
const fraJfk = { origin: ap('DE'), destination: ap('US') };
const fraZrh = { origin: ap('DE'), destination: ap('CH') };
assert.strictEqual(E.autoHaul(flight({ route: fraJfk })), 'intercontinental');
assert.strictEqual(E.autoHaul(flight({ route: fraZrh })), 'continental');
assert.strictEqual(E.autoHaul(flight({ route: { origin: ap('US'), destination: ap('US') } })), 'continental');   // SEA–SFO
assert.strictEqual(E.autoHaul(flight({ route: { origin: ap('US'), destination: ap('CA') } })), 'continental');
assert.strictEqual(E.autoHaul(flight({ route: { origin: ap('JP'), destination: ap('US') } })), 'intercontinental');
assert.strictEqual(E.autoHaul(flight({ route: { origin: ap('DE'), destination: ap('EG') } })), 'continental');

// LHG earning, upgrade only counts when paid
let e = E.earn(flight({ airlineCode: 'LH', route: fraJfk, bookedClass: 'Economy', upgradeClass: 'Business', upgradeType: 'voucher' }), rules);
assert.deepStrictEqual([e.p, e.qp, e.hon], [60, 60, 0]);
e = E.earn(flight({ airlineCode: 'LH', route: fraJfk, bookedClass: 'Economy', upgradeClass: 'Business', upgradeType: 'fixed-online' }), rules);
assert.deepStrictEqual([e.p, e.qp, e.hon], [200, 200, 200]);

// upgrade types: only fixed (online / airport) and bid earn in the upgraded class
{
  const up = (upgradeType) => E.earn(flight({ airlineCode: 'LH', route: fraJfk, bookedClass: 'Economy', upgradeClass: 'Business', upgradeType }), rules).p;
  const got = ['fixed-online', 'fixed-airport', 'bid', 'miles', 'voucher', 'operational', ''].map(up).join(',');
  assert.strictEqual(got, '200,200,200,60,60,60,60');
}

// cabin override beats booked class and paid upgrade
e = E.earn(flight({ airlineCode: 'LH', route: fraJfk, bookedClass: 'Economy', upgradeClass: 'Business', upgradeType: 'bid', earnClassOverride: 'Premium Economy' }), rules);
assert.deepStrictEqual([e.cls, e.p, e.qp, e.hon], ['Premium Economy', 80, 80, 0]);

// Miles & More zones: North Africa counts as Europe, Israel as Asia, Greenland as North America
assert.strictEqual(E.autoHaul(flight({ route: { origin: ap('DE'), destination: ap('IL') } })), 'intercontinental');
assert.strictEqual(E.autoHaul(flight({ route: { origin: ap('DE'), destination: ap('TN') } })), 'continental');
assert.strictEqual(E.autoHaul(flight({ route: { origin: ap('DK'), destination: ap('GL') } })), 'intercontinental');
assert.strictEqual(E.autoHaul(flight({ route: { origin: ap('CA'), destination: ap('GL') } })), 'continental');

// intercontinental First earns 400
e = E.earn(flight({ airlineCode: 'LH', route: fraJfk, bookedClass: 'First', upgradeClass: 'First' }), rules);
assert.deepStrictEqual([e.p, e.qp, e.hon], [400, 400, 400]);

// earning groups as listed by Miles & More
assert.strictEqual(E.earn(flight({ airlineCode: 'OU', route: fraZrh, bookedClass: 'Economy' }), rules).qp, 20);   // Croatia: full
assert.strictEqual(E.earn(flight({ airlineCode: 'LO', route: fraZrh, bookedClass: 'Economy' }), rules).qp, 20);   // LOT: full
assert.strictEqual(E.earn(flight({ airlineCode: 'A3', route: fraZrh, bookedClass: 'Economy' }), rules).qp, 0);    // Aegean: Points only
assert.strictEqual(E.earn(flight({ airlineCode: 'CX', route: fraJfk, bookedClass: 'Economy' }), rules).p, 0);     // Cathay: no status credit

// The three official examples from the Miles & More "Points system" page
{
  const r = (o, d) => ({ origin: ap(o), destination: ap(d) });
  const ex1 = E.earn(flight({ airlineCode: 'LX', route: r('CH', 'TH'), bookedClass: 'Business', upgradeClass: 'Business' }), rules);
  assert.deepStrictEqual([ex1.p, ex1.qp, ex1.hon], [200, 200, 200]);            // ZRH–BKK Business with SWISS
  const ex2 = E.earn(flight({ airlineCode: 'TG', route: r('DE', 'TH'), bookedClass: 'Economy' }), rules);
  assert.deepStrictEqual([ex2.p, ex2.qp, ex2.hon], [60, 0, 0]);                 // FRA–BKK Economy with Thai
  const ex3a = E.earn(flight({ airlineCode: 'LX', route: r('CH', 'DE'), bookedClass: 'Business', upgradeClass: 'Business' }), rules);
  const ex3b = E.earn(flight({ airlineCode: 'LH', route: r('DE', 'TH'), bookedClass: 'Business', upgradeClass: 'Business' }), rules);
  assert.deepStrictEqual([ex3a.p + ex3b.p, ex3a.qp + ex3b.qp, ex3a.hon + ex3b.hon], [240, 240, 240]);  // ZRH–MUC–BKK Business
}

// Edelweiss: LX8000–8499 code-shares earn like SWISS; WK-numbered bookings earn nothing
assert.strictEqual(E.earn(flight({ airlineCode: 'LX', flightNo: 'LX8123', route: fraJfk, bookedClass: 'Economy' }), rules).qp, 60);
assert.strictEqual(E.earn(flight({ airlineCode: 'WK', flightNo: 'WK123', route: fraJfk, bookedClass: 'Economy' }), rules).p, 0);

// Lufthansa Express Bus: no credit; train: earns like a flight, haul defaults to continental
assert.strictEqual(E.earn(flight({ airlineCode: 'LH', transport: 'bus', route: fraZrh, bookedClass: 'Economy' }), rules).p, 0);
e = E.earn(flight({ airlineCode: 'LH', transport: 'rail', route: null, bookedClass: 'Business', upgradeClass: 'Business' }), rules);
assert.deepStrictEqual([e.p, e.qp, e.hon, e.rail, e.haul], [40, 40, 40, true, 'continental']);

// train QP / HON count towards a status only up to the caps (FTL 160 QP, SEN 500 QP, HON 1,000 HON)
assert.strictEqual(E.statusFor(700, 400, 0, rules, { qp: 300 }), 'NONE');      // 100 + min(300, 160) = 260 < 325
assert.strictEqual(E.statusFor(700, 500, 0, rules, { qp: 300 }), 'FTL');       // 200 + 160 = 360
assert.strictEqual(E.statusFor(2000, 1199, 0, rules, { qp: 700 }), 'FTL');     // SEN: 499 + 500 = 999 < 1,000
assert.strictEqual(E.statusFor(2000, 1200, 0, rules, { qp: 700 }), 'SEN');     // 500 + 500 = 1,000
assert.strictEqual(E.statusFor(0, 0, 6500, rules, { hon: 1500 }), 'HON');      // 5,000 + 1,000
assert.strictEqual(E.statusFor(0, 0, 6500, rules, { hon: 1600 }), 'NONE');     // 4,900 + 1,000 = 5,900
{
  const trains = Array.from({ length: 10 }, (_, i) => flight({ date: `2020-03-${String(i + 1).padStart(2, '0')}`, airlineCode: 'LH', transport: 'rail', route: null, bookedClass: 'Economy' }));
  const s = E.yearSummary({ flights: trains, adjustments: [], settings: { rules } }, 2020);
  assert.deepStrictEqual([s.actual.qp, s.actual.qpRail], [200, 200]);
  assert.strictEqual(E.effective(s.actual, 'FTL', rules).qp, 160);
  assert.strictEqual(E.gap(s.actual, 'FTL', rules).qp, 165);
}

// Marriott Bonvoy: 40 Points per stay of 2+ nights, no QP / HON, max 120 Points per calendar year
{
  const stay = (date, nights) => ({ id: date, date, nights, hotel: 'H', remark: '' });
  const st = { flights: [], adjustments: [], stays: [stay('2020-02-03', 1), stay('2020-03-03', 2), stay('2020-04-03', 3), stay('2020-05-03', 2), stay('2020-06-03', 4), stay('2021-01-10', 2)], settings: { rules } };
  const s = E.yearSummary(st, 2020);
  assert.strictEqual(s.stays.map(r => r.e.p).join(','), '0,40,40,40,0');
  assert.strictEqual(s.stays.map(r => r.e.reason).join(','), 'short,ok,ok,ok,cap');
  assert.deepStrictEqual([s.actual.p, s.actual.qp, s.actual.hon, s.stayTotal.p], [120, 0, 0, 120]);
  assert.strictEqual(E.yearSummary(st, 2021).stayTotal.p, 40);                  // the cap resets each year
  assert.strictEqual(E.years(st)[1], 2021);
  assert.strictEqual(MM.store.normalize(JSON.parse(JSON.stringify(st))).stays.length, 6);
}

// saved rules are kept as they are (no migrations): a stored First of 300 stays 300
assert.strictEqual(MM.store.normalize({ settings: { rules: { points: { intercontinental: { 'Economy': 60, 'Premium Economy': 80, 'Business': 200, 'First': 300 } } } } }).settings.rules.points.intercontinental.First, 300);

// Luxair (co-issuing Miles & More partner) earns like a Lufthansa Group airline
e = E.earn(flight({ airlineCode: 'LG', route: fraZrh, bookedClass: 'Business', upgradeClass: 'Business' }), rules);
assert.deepStrictEqual([e.p, e.qp, e.hon, e.group], [40, 40, 40, 'LHG']);
assert.strictEqual(E.parseFlightNo('LGL4591').code, 'LG');

// Star Alliance: points only
e = E.earn(flight({ airlineCode: 'TG', route: fraJfk, bookedClass: 'Economy' }), rules);
assert.deepStrictEqual([e.p, e.qp, e.hon], [60, 0, 0]);

// codeshare: marketed by a Star partner, operated by Lufthansa Group -> earns as Lufthansa Group
e = E.earn(flight({ airlineCode: 'UA', operatingFlightNo: 'LH488', route: fraJfk, bookedClass: 'Business', upgradeClass: 'Business' }), rules);
assert.deepStrictEqual([e.p, e.qp, e.hon, e.group], [200, 200, 200, 'LHG']);
e = E.earn(flight({ airlineCode: 'LH', flightNo: 'LH9246', operatingFlightNo: 'UA679', route: fraJfk, bookedClass: 'Business', upgradeClass: 'Business' }), rules);
assert.deepStrictEqual([e.p, e.qp, e.hon, e.group], [200, 0, 0, 'STAR']);   // marketed by Lufthansa, operated by United: Points only
e = E.earn(flight({ airlineCode: 'LH', flightNo: 'LH1234', operatingFlightNo: 'ZZ1', route: fraJfk, bookedClass: 'Economy' }), rules);
assert.strictEqual(e.group, 'LHG');   // unknown operator: the marketing airline decides
e = E.earn(flight({ airlineCode: 'LX', flightNo: 'LX8123', operatingFlightNo: 'WK123', route: fraJfk, bookedClass: 'Economy' }), rules);
assert.strictEqual(e.group, 'LHG');   // Edelweiss-operated LX8000–8499 earns like SWISS
assert.strictEqual(E.earningGroup(flight({ airlineCode: 'LX', flightNo: 'LX1000', operatingFlightNo: 'WK1000' })), 'NONE');

// CO2 boosters
e = E.earn(flight({ airlineCode: 'LX', route: fraJfk, bookedClass: 'Business', upgradeClass: 'Business', co2Level: 'large' }), rules);
assert.deepStrictEqual([e.p, e.qp, e.hon], [300, 300, 240]);
e = E.earn(flight({ airlineCode: 'LH', route: fraZrh, bookedClass: 'Economy', co2Level: 'small' }), rules);
assert.deepStrictEqual([e.p, e.qp, e.hon], [21, 21, 0]);

// status
assert.strictEqual(E.statusFor(650, 325, 0, rules), 'FTL');
assert.strictEqual(E.statusFor(2000, 999, 0, rules), 'FTL');
assert.strictEqual(E.statusFor(2000, 1000, 0, rules), 'SEN');
assert.strictEqual(E.statusFor(0, 0, 6000, rules), 'HON');

// status validity: until end of February of the year after next (leap year aware)
assert.strictEqual(E.validUntil(2026), '2028-02-29');
assert.strictEqual(E.validUntil(2025), '2027-02-28');

// soft landing: without requalification the status drops one level from March of the year after next
const segs = (year, n) => Array.from({ length: n }, (_, i) => flight({
  date: `${year}-05-${String(i + 1).padStart(2, '0')}`, airlineCode: 'LH', route: fraJfk, bookedClass: 'Business', upgradeClass: 'Business',
}));
const held = (flights) => {
  const h = E.history({ flights, settings: { rules } });
  return Object.fromEntries(h.map(x => [x.year, [x.carriedIn, x.held, x.downgraded]]));
};
assert.strictEqual(E.softLanding('HON'), 'SEN');
assert.strictEqual(E.softLanding('NONE'), 'NONE');
// Senator in 2020, nothing after: SEN through Feb 2022, FTL from Mar 2022, Base from Mar 2023 (gap years filled in)
let h = held(segs(2020, 10));
assert.deepStrictEqual(h[2020], ['NONE', 'SEN', false]);
assert.deepStrictEqual(h[2021], ['SEN', 'SEN', false]);
assert.deepStrictEqual(h[2022], ['FTL', 'FTL', true]);
assert.deepStrictEqual(h[2023], ['NONE', 'NONE', true]);
assert.deepStrictEqual(h[2024], ['NONE', 'NONE', false]);
// HON Circle in 2020, only FTL earned in 2021: soft landing (SEN) beats the earned FTL
h = held([...segs(2020, 30), ...segs(2021, 4)]);
assert.deepStrictEqual(h[2021], ['HON', 'HON', false]);
assert.deepStrictEqual(h[2022], ['SEN', 'SEN', true]);
assert.deepStrictEqual(h[2023], ['FTL', 'FTL', true]);
// requalified every year: no downgrade
h = held([...segs(2020, 10), ...segs(2021, 10), ...segs(2022, 10)]);
assert.deepStrictEqual(h[2023], ['SEN', 'SEN', false]);
assert.deepStrictEqual(h[2024], ['FTL', 'FTL', true]);
// lands on FTL in March 2022, then earns Senator again in May 2022
h = held([...segs(2020, 10), ...segs(2022, 10)]);
assert.deepStrictEqual(h[2022], ['FTL', 'SEN', false]);
assert.deepStrictEqual(h[2023], ['SEN', 'SEN', false]);

// manual point corrections count in totals and status (also negative)
{
  const st = { flights: segs(2020, 3), adjustments: [
    { id: 'a1', date: '2020-06-01', p: 1400, qp: 400, hon: 0, remark: 'retro credit' },
    { id: 'a2', date: '2020-07-01', p: -10, qp: 0, hon: 0, remark: 'deduction' },
  ], settings: { rules } };
  const s = E.yearSummary(st, 2020);
  assert.deepStrictEqual([s.actual.p, s.actual.qp, s.adjTotal.p], [600 + 1390, 600 + 400, 1390]);
  assert.strictEqual(s.rows.length, 3);
  assert.strictEqual(s.events.length, 5);
  assert.strictEqual(s.statusActual, 'FTL');            // 1,990 P < 2,000 for Senator
  // E.years returns an array from the vm context: compare elements, not with deepStrictEqual
  // (its prototype differs from this file's Array.prototype, so a deep-equal check always fails).
  assert.strictEqual(E.years(st)[0], 2020);
}

// starting status from the statement: counts as earned in that year and carries into the next
{
  const st = { flights: segs(2026, 1), adjustments: [], settings: { rules, startStatus: { status: 'SEN', year: 2025 } } };
  const h = E.history(st);
  const y25 = h.find(x => x.year === 2025), y26 = h.find(x => x.year === 2026), y27 = E.history(st, 2027).find(x => x.year === 2027);
  assert.strictEqual(y25.statusActual, 'SEN');
  assert.strictEqual(y25.fromStatement, true);
  assert.strictEqual(y26.carriedIn, 'SEN');
  assert.strictEqual(y26.held, 'SEN');
  assert.strictEqual(y26.hasPrev, true);
  assert.strictEqual(y27.held, 'FTL');            // not requalified in 2026 -> soft landing
  const none = E.history({ ...st, settings: { rules } }).find(x => x.year === 2026);
  assert.strictEqual(none.carriedIn, 'NONE');
  assert.strictEqual(none.hasPrev, false);
}

// unknown haul earns nothing
e = E.earn(flight({ airlineCode: 'LH', route: null }), rules);
assert.ok(e.unknown && e.p === 0);


// fares per booking code: a booking's fare is split evenly over its segments
{
  const st = MM.store.normalize({ version: 2, bookings: { abc123: { fare: 1000 } }, flights: [
    { date: '2026-03-01', bookingCode: 'abc123', flightNo: 'LH400', flightCost: 0 },
    { date: '2026-03-08', bookingCode: 'ABC123', flightNo: 'LH401', flightCost: 0 },
    { date: '2026-04-01', bookingCode: '', flightNo: 'LH100', flightCost: 150 },
  ] });
  assert.strictEqual(st.bookings.ABC123.fare, 1000);
  assert.strictEqual(E.fareShare(st, st.flights[0]), 500);
  assert.strictEqual(E.fareShare(st, st.flights[2]), 150);   // no booking code: the segment's own fare
  const ys = E.yearSummary(st, 2026);
  assert.strictEqual(ys.cost.actual.flight + ys.cost.plan.flight, 1150);
  // bookings without segments are dropped
  const v2 = MM.store.normalize({ version: 2, bookings: { ABC123: { fare: 700 }, GONE01: { fare: 50 } },
    flights: [{ date: '2026-03-01', bookingCode: 'ABC123', flightNo: 'LH400', flightCost: 0 }] });
  assert.strictEqual(v2.bookings.ABC123.fare, 700);
  assert.strictEqual('GONE01' in v2.bookings, false);
  assert.strictEqual(MM.store.normalize(JSON.parse(JSON.stringify(v2))).bookings.ABC123.fare, 700);
}

// planner scenario: CO₂ what-ifs on existing flights plus a mix of extra segments
{
  const st = MM.store.normalize({ version: 2, flights: [
    { id: 'a', date: '2026-02-01', flightNo: 'LH400', airlineCode: 'LH', route: fraJfk, bookedClass: 'Business', upgradeClass: 'Business', co2Level: 'none' },
  ] });
  const sc0 = E.planScenario(st, 2026, {});
  assert.strictEqual(sc0.total.qp, 200);
  assert.strictEqual(sc0.cost.total, 0);
  const plan = {
    co2: { a: { level: 'large', cost: 40 } },   // +50 % P / QP, +20 % HON
    mix: [
      { count: 2, kind: 'LHG', haul: 'continental', cls: 'Business', co2Level: 'none', cost: 300 },
      { count: 4, kind: 'LHG', haul: 'intercontinental', cls: 'Premium Economy', co2Level: 'medium', cost: 900 },
      { count: 3, kind: 'STAR', haul: 'intercontinental', cls: 'Economy', co2Level: 'none', cost: 0 },
    ],
  };
  const sc = E.planScenario(st, 2026, plan);
  assert.deepStrictEqual([sc.withCo2.forecast.p, sc.withCo2.forecast.qp, sc.withCo2.forecast.hon], [300, 300, 240]);
  // 2 × 40 continental Business (HON too), 4 × 96 Premium Economy intercontinental (80 + 20 %, no HON), 3 × 60 Star Points only
  assert.deepStrictEqual([sc.total.p, sc.total.qp, sc.total.hon], [300 + 80 + 384 + 180, 300 + 80 + 384, 240 + 80]);
  assert.strictEqual(sc.cost.co2Extra, 40);
  assert.strictEqual(sc.cost.mix, 2 * 300 + 4 * 900);
  assert.strictEqual(sc.status.total, 'FTL');
  assert.strictEqual(st.flights[0].co2Level, 'none');   // what-ifs never change the flight itself
  // trains in the mix: QP count towards a status only up to the train limit
  const rail = E.planScenario(st, 2026, { mix: [{ count: 30, kind: 'RAIL', haul: 'intercontinental', cls: 'Business', co2Level: 'xlarge', cost: 0 }] });
  assert.strictEqual(rail.mix[0].e.qp, 40);   // continental, no booster
  assert.strictEqual(E.effective(rail.total, 'SEN', rules).qp, 200 + 500);
  // plans are saved per year; what-ifs for deleted flights are dropped
  const again = MM.store.normalize({ version: 2, flights: st.flights, plans: { 2026: { co2: { a: { level: 'small', cost: 5 }, gone: { level: 'small', cost: 5 } }, mix: [{ count: '2', kind: 'X' }] } } });
  assert.deepStrictEqual(Object.keys(again.plans['2026'].co2).join(','), 'a');
  assert.strictEqual(again.plans['2026'].mix[0].count, 2);
  assert.strictEqual(again.plans['2026'].mix[0].kind, 'LHG');
}
// Miles & More number: digits only, saved in the settings and used in the .json file name (without a date)
{
  const st = MM.store.normalize({ version: 2, settings: { memberNumber: '992 000-123 456 789' } });
  assert.strictEqual(st.settings.memberNumber, '992000123456789');
  assert.strictEqual(MM.store.fileName(st), 'miles-and-more-992000123456789.json');
  assert.ok(/^miles-and-more-status-\d{4}-\d{2}-\d{2}\.json$/.test(MM.store.fileName(MM.store.empty())));
}

// demo data round-trips through normalize
const demo = MM.store.demo();
const again = MM.store.normalize(JSON.parse(JSON.stringify(demo)));
assert.strictEqual(again.flights.length, demo.flights.length);
assert.ok(Object.keys(again.apiCache).length > 0);
assert.strictEqual(again.bookings.K7XQ2P.fare, 780);   // demo fares sit on their bookings

console.log('engine tests passed');
