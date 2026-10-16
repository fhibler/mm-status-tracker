/* Dependency-free smoke test for the points engine: `node tests/engine.test.js` */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { window: {}, console, Set, Math, Date, JSON, Object, Array, String, Number };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['data.js', 'engine.js', 'api.js', 'store.js']) {
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

// unknown haul earns nothing
e = E.earn(flight({ airlineCode: 'LH', route: null }), rules);
assert.ok(e.unknown && e.p === 0);

// demo data round-trips through normalize
const demo = MM.store.demo();
const again = MM.store.normalize(JSON.parse(JSON.stringify(demo)));
assert.strictEqual(again.flights.length, demo.flights.length);
assert.ok(Object.keys(again.apiCache).length > 0);

console.log('engine tests passed');
