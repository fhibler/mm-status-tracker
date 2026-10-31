/* State, persistence (localStorage autosave + .json save/load) and demo data. */
(function () {
  const S = (MM.store = {});
  const E = MM.engine;
  const LS_KEY = 'mm-status-tracker:v1';   // not the file format version: renaming it would lose the data saved in browsers
  const FORMAT = 'mm-status-tracker';
  const VERSION = 2;   // file format; older data (version 1) is refused by S.parse
  const clone = (o) => JSON.parse(JSON.stringify(o));

  S.uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  S.empty = () => ({
    format: FORMAT, version: VERSION,
    settings: { rules: clone(MM.DEFAULT_RULES), currency: 'EUR', startStatus: { status: 'NONE', year: null }, memberNumber: '', aerodataboxKey: '', aerodataboxVia: 'rapidapi', aerodataboxLimits: {} },
    flights: [],
    bookings: {},      // booking code -> { fare }: one fare per booking, counted once on one of its segments (E.fareHolders)
    adjustments: [],   // manual point corrections from the account statement
    stays: [],         // Marriott Bonvoy hotel stays (Points only, capped per year)
    plans: {},         // planner scenarios per calendar year: { "2026": { co2: { flightId: { level, cost } }, upgrade: { flightId: { cls, cost } }, mix: [row] } }
    apiCache: {},
  });

  S.newFlight = (date) => ({
    id: S.uid(), bookingCode: '', date: date || E.todayISO(), transport: 'flight',   // 'flight' | 'rail' | 'bus'
    flightNo: '', operatingFlightNo: '',
    earningGroup: 'auto', bookedClass: 'Economy', upgradeClass: 'Economy', upgradeType: '',   // see MM.UPGRADE_TYPES
    flightCost: 0, upgradeCost: 0, co2Level: 'none', co2Cost: 0,
    earnClassOverride: 'auto', haulOverride: 'auto', route: null, routeLookup: null, times: null, includeInPlan: true, notes: '',
  });

  /** Manual correction as shown on the Miles & More account statement (values may be negative). */
  S.newAdjustment = (date) => ({ id: S.uid(), date: date || E.todayISO(), p: 0, qp: 0, hon: 0, remark: '' });

  /** One row of a planned mix of extra segments (see MM.engine.planScenario); cost = estimated cost per segment. */
  S.newMixRow = (o) => ({ id: S.uid(), count: 2, kind: 'LHG', haul: 'continental', cls: 'Business', co2Level: 'none', cost: 0, ...o });
  /**
   * Makes a row of the mix valid: trains are continental, in a train class, without booster; Lufthansa Group continental
   * flights in Economy or Business (see E.cabins; First becomes Business, Premium Economy Economy). Changes the row and returns it.
   */
  S.fitMixRow = (row) => {
    if (row.kind === 'RAIL') {
      row.haul = 'continental'; row.co2Level = 'none';
      if (!(row.cls in MM.RAIL_CLASSES)) row.cls = 'Business';
    } else {
      row.cls = E.fitCabin(row.haul, row.kind, row.cls);
    }
    return row;
  };

  /** Marriott Bonvoy stay; date = check-out date (the stay is credited when it is completed). */
  S.newStay = (date) => ({ id: S.uid(), date: date || E.todayISO(), hotel: '', nights: 2, remark: '' });

  /** Miles & More number: digits only (cards show it in groups, e.g. "992 000 123 456 789"). */
  S.memberNumber = (v) => String(v || '').replace(/\D/g, '').slice(0, 20);
  /** An API key as typed, without spaces and other characters keys don't have (AeroDataBox, API.Market and RapidAPI keys are hex-like); '' when unset. */
  S.apiKey = (v) => String(v || '').replace(/[^\w-]/g, '').slice(0, 200);

  /** "miles-and-more-992000123456789.json" with a Miles & More number, else "miles-and-more-status-2026-10-16.json". */
  S.fileName = (state) => {
    const n = S.memberNumber(state.settings.memberNumber);
    return n ? `miles-and-more-${n}.json` : `miles-and-more-status-${E.todayISO()}.json`;
  };

  /**
   * Adds or replaces a flight. `fare` is the whole booking's fare when the flight has a booking code (shared by all
   * segments with that code), else the flight's own fare.
   */
  S.saveFlight = (state, flight, fare) => {
    const k = E.bookingKey(flight.bookingCode);
    const f = { ...flight, bookingCode: k, flightCost: k ? 0 : fare };
    if (k) state.bookings[k] = { fare };
    const i = state.flights.findIndex(x => x.id === f.id);
    i >= 0 ? (state.flights[i] = f) : state.flights.push(f);
    prune(state);
    return f;
  };
  S.deleteFlight = (state, id) => {
    state.flights = state.flights.filter(f => f.id !== id);
    prune(state);
  };
  /** Removes the CO₂ compensation (booster and its cost) from a flight, which unlocks it in the planner. */
  S.removeBooster = (state, id) => {
    const f = state.flights.find(x => x.id === id);
    if (f) { f.co2Level = 'none'; f.co2Cost = 0; }
    prune(state);
    return f;
  };

  /** An empty planner scenario for one calendar year (see MM.engine.planScenario). */
  S.newPlan = () => ({ co2: {}, upgrade: {}, mix: [] });

  /**
   * Drops bookings without segments, CO₂ what-ifs for flights that no longer exist, moved to another year, no
   * longer take a booster (see E.canBoost) or have one (locked), and upgrade what-ifs for flights that no longer exist,
   * moved, can't take one (see E.canUpgrade: e.g. upgraded, which locks them) or whose cabin isn't above the booked
   * one any more, since the planner neither shows nor resets those.
   */
  const prune = (state) => {
    const used = new Set(state.flights.map(f => E.bookingKey(f.bookingCode)).filter(Boolean));
    for (const k of Object.keys(state.bookings)) if (!used.has(k)) delete state.bookings[k];
    const yearOf = new Map(state.flights.filter(f => E.canBoost(f) && !E.hasBooster(f)).map(f => [f.id, f.date.slice(0, 4)]));
    for (const [y, p] of Object.entries(state.plans)) for (const id of Object.keys(p.co2)) if (yearOf.get(id) !== y) delete p.co2[id];
    const upgradable = new Map(state.flights.filter(E.canUpgrade).map(f => [f.id, f]));
    for (const [y, p] of Object.entries(state.plans)) {
      for (const [id, o] of Object.entries(p.upgrade)) {
        const f = upgradable.get(id);
        if (!f || f.date.slice(0, 4) !== y || !E.upgradeClasses(f).includes(o.cls)) delete p.upgrade[id];
      }
    }
    return state;
  };

  /* ---------- normalize: fills missing fields with defaults and drops invalid entries ---------- */
  const isObj = (x) => !!x && typeof x === 'object';
  /** IDs end up in HTML attributes and CSS selectors, so only simple ones are kept; a repeated one gets a new ID. */
  const safeIds = () => {
    const seen = new Set();
    return (id) => {
      const ok = typeof id === 'string' && /^[\w-]{1,40}$/.test(id) && !seen.has(id) ? id : S.uid();
      seen.add(ok);
      return ok;
    };
  };
  const list = (xs, make) => {
    const safeId = safeIds();
    return (Array.isArray(xs) ? xs : []).filter(x => isObj(x) && E.parseDate(x.date) === x.date)   // a real ISO date
      .map(x => ({ ...make(x.date), ...x, id: safeId(x.id) }));
  };

  /** Allowed values of a flight's choice fields; others get a new flight's default (upgradeClass: the booked class). */
  const FLIGHT_CHOICES = {
    transport: ['flight', 'rail', 'bus'],
    earningGroup: ['auto', ...Object.keys(MM.GROUP_LABEL)],
    haulOverride: ['auto', 'continental', 'intercontinental'],
    bookedClass: MM.CLASSES,
    upgradeClass: MM.CLASSES,
    earnClassOverride: ['auto', ...MM.CLASSES],
    upgradeType: ['', ...Object.keys(MM.UPGRADE_TYPES)],
    co2Level: MM.CO2_LEVELS,
  };
  const str = (x, max) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : null);
  const time = (t) => (isObj(t) && MM.api.isoTime(t.utc) && MM.api.isoTime(t.local) ? { utc: MM.api.isoTime(t.utc), local: MM.api.isoTime(t.local) } : null);
  const movement = (m) => {
    if (!isObj(m) || !time(m.scheduled)) return null;
    const out = { scheduled: time(m.scheduled) };
    if (time(m.revised)) out.revised = time(m.revised);
    const term = typeof m.terminal === 'number' ? String(m.terminal) : str(m.terminal, 10);
    if (term) out.terminal = term;
    return out;
  };
  /** Looked-up times of a flight (MM.api.timesFromCache) with valid times, or null. */
  S.normalizeTimes = (t) => {
    if (!isObj(t) || !E.parseFlightNo(t.flightNo) || E.parseDate(t.date) !== t.date || !movement(t.dep)) return null;
    return { flightNo: t.flightNo, date: t.date, via: str(t.via, 8) || undefined, provider: str(t.provider, 20), fetchedAt: str(t.fetchedAt, 30),
      dep: movement(t.dep), arr: movement(t.arr), aircraft: str(t.aircraft, 60), reg: str(t.reg, 12) };
  };
  /** A route with both airports (as looked up, or typed in), or null. */
  const route = (r) => (isObj(r) && isObj(r.origin) && isObj(r.destination) ? r : null);
  /** What a flight remembers about its lookup (MM.api.lookupInfo: strings and flags only), or null. */
  const routeLookup = (lk) => (isObj(lk) && Object.values(lk).every(v => v == null || ['string', 'boolean'].includes(typeof v)) ? lk : null);
  /** A cached lookup for the date of its key, with what reading it relies on: its time, status and routes (MM.api.legs). */
  const cacheEntry = (k, c) => MM.api.isCacheKey(k) && isObj(c) && c.date === k.slice(-10) && typeof c.fetchedAt === 'string'
    && ['ok', 'notfound', 'error'].includes(c.status) && MM.api.legs(c).every(route);
  const normalizeFlight = (f) => {
    const d = S.newFlight(f.date);
    f.route = route(f.route);
    f.routeLookup = routeLookup(f.routeLookup);
    f.times = S.normalizeTimes(f.times);
    if (f.upgradeType === 'voucher') f.upgradeType = 'miles';   // older versions had them apart (MM.UPGRADE_TYPES)
    for (const [k, ok] of Object.entries(FLIGHT_CHOICES)) if (!ok.includes(f[k])) f[k] = k === 'upgradeClass' ? f.bookedClass : d[k];
    // as the dialog saves them: trains in 2nd or 1st class; trains and buses without the flight-only fields
    if (f.transport === 'rail' && !(f.bookedClass in MM.RAIL_CLASSES)) f.bookedClass = 'Economy';
    if (f.transport !== 'flight') {
      Object.assign(f, { operatingFlightNo: '', upgradeClass: f.bookedClass, upgradeType: '', upgradeCost: 0,
        earnClassOverride: 'auto', haulOverride: 'auto', co2Level: 'none' });
    }
    for (const k of ['flightCost', 'upgradeCost', 'co2Cost']) f[k] = Math.max(0, +f[k] || 0);   // like the fares of bookings
    if (!E.hasBooster(f)) f.co2Cost = 0;   // a CO₂ cost only with a booster
    return f;
  };

  /** Calendar years the app accepts, e.g. for the starting status. */
  S.validYear = (y) => Number.isInteger(y) && y >= 2000 && y <= 2100;

  /** Saved rules over the defaults, value by value: only numbers are taken (no NaN from partial files), unknown keys are dropped. */
  const mergeRules = (d, r) => Object.fromEntries(Object.entries(d).map(([k, v]) => {
    const x = isObj(r) ? r[k] : undefined;
    if (Array.isArray(v)) return [k, Array.isArray(x) ? MM.CLASSES.filter(c => x.includes(c)) : v];   // honClasses
    if (isObj(v)) return [k, mergeRules(v, x)];
    return [k, x !== null && x !== '' && Number.isFinite(+x) ? +x : v];
  }));

  const normalizePlans = (raw) => {
    const out = {};
    for (const [y, p] of Object.entries(isObj(raw) ? raw : {})) {
      if (!/^\d{4}$/.test(y) || !isObj(p)) continue;
      // what-ifs per flight ID (prune drops those for flights that can't take them); fromEntries keeps a "__proto__" ID a plain key
      const whatIfs = (x, ok, field) => Object.fromEntries(Object.entries(isObj(x) ? x : {})
        .filter(([, o]) => isObj(o) && ok.includes(o[field]))
        .map(([id, o]) => [id, { [field]: o[field], cost: Math.max(0, +o.cost || 0) }]));
      const co2 = whatIfs(p.co2, MM.CO2_LEVELS.filter(l => l !== 'none'), 'level');
      const upgrade = whatIfs(p.upgrade, MM.CLASSES, 'cls');
      const safeId = safeIds();
      const mix = (Array.isArray(p.mix) ? p.mix : []).filter(isObj).map(r => S.fitMixRow(S.newMixRow({
        id: safeId(r.id), count: Math.max(0, Math.round(+r.count || 0)),
        kind: Object.keys(MM.MIX_KIND).includes(r.kind) ? r.kind : 'LHG',
        haul: r.haul === 'intercontinental' ? 'intercontinental' : 'continental',
        cls: MM.CLASSES.includes(r.cls) ? r.cls : 'Economy',
        co2Level: MM.CO2_LEVELS.includes(r.co2Level) ? r.co2Level : 'none',
        cost: Math.max(0, +r.cost || 0),
      })));
      out[y] = { co2, upgrade, mix };
    }
    return out;
  };

  S.normalize = (raw) => {
    const s = S.empty();
    if (!isObj(raw)) return s;
    const set = isObj(raw.settings) ? raw.settings : {};
    s.settings.rules = mergeRules(MM.DEFAULT_RULES, set.rules);
    if (MM.CURRENCIES.includes(set.currency)) s.settings.currency = set.currency;
    s.settings.memberNumber = S.memberNumber(set.memberNumber);
    s.settings.aerodataboxKey = S.apiKey(set.aerodataboxKey);
    s.settings.aerodataboxVia = MM.api.adbVia(set.aerodataboxVia);
    // the date range of the plan per way of calling AeroDataBox, learned from its answers (MM.api.outsidePlan)
    for (const [via, l] of Object.entries(isObj(set.aerodataboxLimits) ? set.aerodataboxLimits : {})) {
      if (MM.api.adbVia(via) !== via || !isObj(l)) continue;
      const lim = Object.fromEntries(['pastDays', 'futureDays'].map(k => [k, l[k]]).filter(([, d]) => Number.isInteger(d) && d > 0 && d <= 5000));
      if (Object.keys(lim).length) s.settings.aerodataboxLimits[via] = lim;
    }
    if (isObj(set.startStatus) && MM.STATUS_ORDER.includes(set.startStatus.status)) {
      const y = +set.startStatus.year;
      s.settings.startStatus = { status: set.startStatus.status, year: S.validYear(y) ? y : null };
    }
    s.apiCache = Object.fromEntries(Object.entries(isObj(raw.apiCache) ? raw.apiCache : {}).filter(([k, c]) => cacheEntry(k, c)));
    s.flights = list(raw.flights, S.newFlight).map(normalizeFlight);
    s.adjustments = list(raw.adjustments, S.newAdjustment);
    s.stays = list(raw.stays, S.newStay);
    for (const [k, b] of Object.entries(isObj(raw.bookings) ? raw.bookings : {})) {
      if (E.bookingKey(k)) s.bookings[E.bookingKey(k)] = { fare: Math.max(0, +(isObj(b) && b.fare) || 0) };
    }
    s.plans = normalizePlans(raw.plans);
    return prune(s);
  };

  /** Parses saved data (a .json file or localStorage). Throws for other files and for the old format (version 1). */
  S.parse = (text) => {
    const raw = JSON.parse(text);
    if (!isObj(raw) || raw.format !== FORMAT) throw new Error('Not a Miles & More Status Tracker file.');
    if (!(+raw.version >= VERSION)) throw new Error('This data was saved by an older version of the tracker and can no longer be loaded.');
    return S.normalize(raw);
  };

  /** Data saved in this browser, or null. Throws like S.parse for old or broken data. */
  S.load = () => {
    let txt = null;
    try { txt = localStorage.getItem(LS_KEY); } catch { /* storage blocked */ }
    return txt ? S.parse(txt) : null;
  };
  /** Saves to localStorage; false when that isn't possible (storage full, or blocked in private mode). */
  S.persist = (state) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); return true; } catch { return false; }
  };

  S.exportJSON = (state) => {
    const data = { ...state, format: FORMAT, version: VERSION, savedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = S.fileName(state);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  };

  S.importFile = (file) => file.text().then(S.parse);

  /* ---------- demo data (routes pre-cached, so no API calls are needed) ---------- */
  const AP = {
    FRA: ['Frankfurt am Main Airport', 'Frankfurt am Main', 'DE', 'Germany', 50.03333, 8.57056, 'EDDF'],
    MUC: ['Munich Airport', 'Munich', 'DE', 'Germany', 48.35378, 11.7861, 'EDDM'],
    JFK: ['John F Kennedy International Airport', 'New York', 'US', 'United States', 40.6398, -73.7789, 'KJFK'],
    ZRH: ['Zurich Airport', 'Zurich', 'CH', 'Switzerland', 47.4647, 8.54917, 'LSZH'],
    VIE: ['Vienna International Airport', 'Vienna', 'AT', 'Austria', 48.1103, 16.5697, 'LOWW'],
    BKK: ['Suvarnabhumi Airport', 'Bangkok', 'TH', 'Thailand', 13.6811, 100.747, 'VTBS'],
    LHR: ['London Heathrow Airport', 'London', 'GB', 'United Kingdom', 51.4706, -0.461941, 'EGLL'],
    BRU: ['Brussels Airport', 'Brussels', 'BE', 'Belgium', 50.9014, 4.48444, 'EBBR'],
    SFO: ['San Francisco International Airport', 'San Francisco', 'US', 'United States', 37.619, -122.375, 'KSFO'],
    SIN: ['Singapore Changi Airport', 'Singapore', 'SG', 'Singapore', 1.35019, 103.994, 'WSSS'],
  };
  const apResp = (k) => {
    const a = AP[k];
    return { iata_code: k, icao_code: a[6], name: a[0], municipality: a[1], country_iso_name: a[2], country_name: a[3], latitude: a[4], longitude: a[5], elevation: 0 };
  };

  S.demo = () => {
    const s = S.empty();
    const today = E.todayISO();
    const plan = [
      // [monthOffsetFromToday, flightNo, from, to, booked, upgrade, bid (else miles / eVoucher), fare (added to the booking), upgradeCost, co2, co2Cost (≈ lufthansa.com price), pnr]
      [-14, 'LH400', 'FRA', 'JFK', 'Economy', 'Business', true, 780, 650, 'medium', 108, 'K7XQ2P'],
      [-14, 'LH401', 'JFK', 'FRA', 'Economy', 'Economy', false, 0, 0, 'none', 0, 'K7XQ2P'],
      [-9, 'LX318', 'ZRH', 'LHR', 'Economy', 'Economy', false, 189, 0, 'none', 0, 'R2MM8D'],
      [-9, 'LX325', 'LHR', 'ZRH', 'Economy', 'Business', false, 0, 0, 'none', 0, 'R2MM8D'],
      [-7, 'LH2032', 'MUC', 'FRA', 'Economy', 'Economy', false, 99, 0, 'small', 2.4, 'P9TT4A'],
      [-6, 'OS101', 'VIE', 'FRA', 'Business', 'Business', false, 420, 0, 'large', 21.4, 'B44XKL'],
      [-5, 'SN2903', 'BRU', 'FRA', 'Economy', 'Economy', false, 130, 0, 'none', 0, 'HM2K1Q'],
      [-4, 'LH772', 'FRA', 'BKK', 'Premium Economy', 'Premium Economy', false, 1350, 0, 'xlarge', 290, 'ZZ81PL'],
      [-3, 'TG920', 'BKK', 'FRA', 'Economy', 'Economy', false, 0, 0, 'none', 0, 'ZZ81PL'],
      [-1, 'LH454', 'FRA', 'SFO', 'Business', 'Business', false, 2890, 0, 'medium', 159, 'Q1W2E3'],
      [-1, 'LH455', 'SFO', 'FRA', 'Business', 'First', true, 0, 1200, 'medium', 209, 'Q1W2E3'],
      [1, 'LH778', 'FRA', 'SIN', 'Business', 'Business', false, 3100, 0, 'large', 366, 'PLAN01'],
      [1, 'LH779', 'SIN', 'FRA', 'Business', 'Business', false, 0, 0, 'large', 366, 'PLAN01'],
      [2, 'LH400', 'FRA', 'JFK', 'Business', 'Business', false, 2450, 0, 'xlarge', 333, 'PLAN02'],
      [2, 'LX38', 'ZRH', 'SFO', 'Business', 'Business', false, 2200, 0, 'medium', 163, 'PLAN03'],
    ];
    // Dates in UTC, so the month offset and the ISO date don't depend on the time zone.
    const isoUTC = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
    const [ty, tm] = today.split('-').map(Number);
    plan.forEach(([mo, no, from, to, bc, uc, bid, fc, uco, co2, co2c, pnr], i) => {
      const date = isoUTC(ty, tm - 1 + mo, Math.min(27, 3 + (i * 5) % 25));
      const p = E.parseFlightNo(no);
      const resp = { flightroute: { callsign: no, callsign_iata: no, airline: { name: p.airline.name, iata: p.code, icao: p.airline.icao }, origin: apResp(from), destination: apResp(to) } };
      const key = MM.api.cacheKey(no, date);
      // as if looked up on the flight date, so no route shows as provisional (A.otherSeason)
      s.apiCache[key] = { date, fetchedAt: `${date}T12:00:00.000Z`, status: 'ok', response: resp };
      const f = { ...S.newFlight(date), flightNo: no, bookingCode: pnr,
        bookedClass: bc, upgradeClass: uc, upgradeType: uc === bc ? '' : bid ? 'bid' : 'miles',
        upgradeCost: uco, co2Level: co2, co2Cost: co2c };
      s.bookings[pnr] = { fare: ((s.bookings[pnr] || {}).fare || 0) + fc };
      f.route = MM.api.routeFromCache(s.apiCache[key]);
      f.routeLookup = MM.api.lookupInfo({ ...s.apiCache[key], fromCache: true }, no);
      s.flights.push(f);
    });
    // One statement correction, 10 days after the LX318 segment.
    const lx = s.flights.find(f => f.flightNo === 'LX318');
    const [ly, lm, ld] = lx.date.split('-').map(Number);
    s.adjustments.push({ ...S.newAdjustment(isoUTC(ly, lm - 1, ld + 10)), p: 20, qp: 20, hon: 0, remark: 'Statement: retro credit for missing LX segment' });
    return s;
  };
})();
