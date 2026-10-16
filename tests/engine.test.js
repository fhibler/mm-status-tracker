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
let e = E.earn(flight({ airlineCode: 'LH', route: fraJfk, bookedClass: 'Economy', upgradeClass: 'Business', upgradePaid: false }), rules);
assert.deepStrictEqual([e.p, e.qp, e.hon], [60, 60, 0]);
e = E.earn(flight({ airlineCode: 'LH', route: fraJfk, bookedClass: 'Economy', upgradeClass: 'Business', upgradePaid: true }), rules);
assert.deepStrictEqual([e.p, e.qp, e.hon], [200, 200, 200]);

// cabin override beats booked class and paid upgrade
e = E.earn(flight({ airlineCode: 'LH', route: fraJfk, bookedClass: 'Economy', upgradeClass: 'Business', upgradePaid: true, earnClassOverride: 'Premium Economy' }), rules);
assert.deepStrictEqual([e.cls, e.p, e.qp, e.hon], ['Premium Economy', 80, 80, 0]);

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
e = E.earn(flight({ airlineCode: 'LH', operatingFlightNo: 'UA123', route: fraJfk, bookedClass: 'Economy' }), rules);
assert.strictEqual(e.group, 'LHG');

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

// demo data round-trips through normalize
const demo = MM.store.demo();
const again = MM.store.normalize(JSON.parse(JSON.stringify(demo)));
assert.strictEqual(again.flights.length, demo.flights.length);
assert.ok(Object.keys(again.apiCache).length > 0);

console.log('engine tests passed');
