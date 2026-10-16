/* State, persistence (localStorage autosave + .json save/load) and demo data. */
(function () {
  const S = (MM.store = {});
  const LS_KEY = 'mm-status-tracker:v1';
  const FORMAT = 'mm-status-tracker';
  const clone = (o) => JSON.parse(JSON.stringify(o));

  S.uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  S.empty = () => ({
    format: FORMAT, version: 2,   // file format; older files (version 1) are refused by S.importFile
    settings: { rules: clone(MM.DEFAULT_RULES), currency: 'EUR', startStatus: { status: 'NONE', year: null } },
    flights: [],
    bookings: {},      // booking code -> { fare }: one fare per booking, split evenly over its segments
    adjustments: [],   // manual point corrections from the account statement
    stays: [],         // Marriott Bonvoy hotel stays (Points only, capped per year)
    plans: {},         // planner scenarios per calendar year: { "2026": { co2: { flightId: { level, cost } }, mix: [row] } }
    apiCache: {},
  });

  S.newFlight = (date) => ({
    id: S.uid(), bookingCode: '', date: date || MM.engine.todayISO(), transport: 'flight',   // 'flight' | 'rail' | 'bus'
    flightNo: '', airlineCode: '', airlineName: '', operatingFlightNo: '',
    earningGroup: 'auto', bookedClass: 'Economy', upgradeClass: 'Economy', upgradeType: '',   // see MM.UPGRADE_TYPES
    flightCost: 0, upgradeCost: 0, co2Level: 'none', co2Cost: 0,
    earnClassOverride: 'auto', haulOverride: 'auto', route: null, routeLookup: null, includeInPlan: true, notes: '',
  });

  /** Manual correction as shown on the Miles & More account statement (values may be negative). */
  S.newAdjustment = (date) => ({ id: S.uid(), date: date || MM.engine.todayISO(), p: 0, qp: 0, hon: 0, remark: '' });

  /** One row of a planned mix of extra segments (see MM.engine.planScenario); cost = estimated cost per segment. */
  S.newMixRow = (o) => ({ id: S.uid(), count: 2, kind: 'LHG', haul: 'continental', cls: 'Business', co2Level: 'none', cost: 0, ...o });

  /** Marriott Bonvoy stay; date = check-out date (the stay is credited when it is completed). */
  S.newStay = (date) => ({ id: S.uid(), date: date || MM.engine.todayISO(), hotel: '', nights: 2, remark: '' });

  S.bookingKey = (code) => MM.engine.bookingKey(code);

  /**
   * Fares are stored once per booking code (state.bookings); segments without a booking code keep their own
   * fare (flightCost). Bookings without any segment are dropped.
   */
  const normalizeBookings = (raw, flights) => {
    const out = {};
    const src = raw.bookings && typeof raw.bookings === 'object' ? raw.bookings : {};
    for (const [k, b] of Object.entries(src)) if (S.bookingKey(k)) out[S.bookingKey(k)] = { fare: Math.max(0, +(b && b.fare) || 0) };
    return S.pruneBookings({ bookings: out, flights }).bookings;
  };

  /** Planner scenarios: keeps valid rows and drops CO₂ what-ifs for flights that no longer exist. */
  const normalizePlans = (raw, flights) => {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    const ids = new Set(flights.map(f => f.id));
    for (const [y, p] of Object.entries(raw)) {
      if (!/^\d{4}$/.test(y) || !p || typeof p !== 'object') continue;
      const co2 = {};
      for (const [id, o] of Object.entries(p.co2 || {})) {
        if (ids.has(id) && o && MM.CO2_LEVELS.includes(o.level)) co2[id] = { level: o.level, cost: Math.max(0, +o.cost || 0) };
      }
      const mix = (Array.isArray(p.mix) ? p.mix : []).filter(r => r && typeof r === 'object').map(r => S.newMixRow({
        id: r.id || S.uid(), count: Math.max(0, Math.round(+r.count || 0)),
        kind: ['LHG', 'STAR', 'RAIL'].includes(r.kind) ? r.kind : 'LHG',
        haul: r.haul === 'intercontinental' ? 'intercontinental' : 'continental',
        cls: MM.CLASSES.includes(r.cls) ? r.cls : 'Economy',
        co2Level: MM.CO2_LEVELS.includes(r.co2Level) ? r.co2Level : 'none',
        cost: Math.max(0, +r.cost || 0),
      }));
      if (Object.keys(co2).length || mix.length) out[y] = { co2, mix };
    }
    return out;
  };
  S.pruneBookings = (state) => {
    const used = new Set(state.flights.map(f => S.bookingKey(f.bookingCode)).filter(Boolean));
    for (const k of Object.keys(state.bookings || {})) if (!used.has(k)) delete state.bookings[k];
    return state;
  };

  /** Fills missing fields with defaults and drops invalid entries (e.g. in handwritten files). */
  S.normalize = (raw) => {
    const s = S.empty();
    if (!raw || typeof raw !== 'object') return s;
    if (raw.settings && raw.settings.rules) {
      const r = raw.settings.rules, d = s.settings.rules;
      s.settings.rules = {
        points: { ...d.points, ...(r.points || {}) },
        honClasses: Array.isArray(r.honClasses) ? r.honClasses : d.honClasses,
        thresholds: {
          FTL: { ...d.thresholds.FTL, ...((r.thresholds || {}).FTL || {}) },
          SEN: { ...d.thresholds.SEN, ...((r.thresholds || {}).SEN || {}) },
          HON: { ...d.thresholds.HON, ...((r.thresholds || {}).HON || {}) },
        },
        railCaps: { ...d.railCaps, ...(r.railCaps || {}) },
        marriott: { ...d.marriott, ...(r.marriott || {}) },
        co2: { ...d.co2, ...(r.co2 || {}) },
      };
    }
    if (raw.settings && raw.settings.currency) s.settings.currency = raw.settings.currency;
    if (raw.settings && raw.settings.startStatus && MM.STATUS_ORDER.includes(raw.settings.startStatus.status)) {
      s.settings.startStatus = { status: raw.settings.startStatus.status, year: +raw.settings.startStatus.year || null };
    }
    s.apiCache = raw.apiCache && typeof raw.apiCache === 'object' ? raw.apiCache : {};
    s.flights = (Array.isArray(raw.flights) ? raw.flights : [])
      .filter(f => f && /^\d{4}-\d{2}-\d{2}$/.test(f.date))
      .map(f => ({ ...S.newFlight(f.date), ...f, id: f.id || S.uid() }));
    s.adjustments = (Array.isArray(raw.adjustments) ? raw.adjustments : [])
      .filter(a => a && /^\d{4}-\d{2}-\d{2}$/.test(a.date))
      .map(a => ({ ...S.newAdjustment(a.date), ...a, id: a.id || S.uid() }));
    s.stays = (Array.isArray(raw.stays) ? raw.stays : [])
      .filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date))
      .map(x => ({ ...S.newStay(x.date), ...x, id: x.id || S.uid() }));
    s.bookings = normalizeBookings(raw, s.flights);
    s.plans = normalizePlans(raw.plans, s.flights);
    return s;
  };

  S.load = () => {
    try {
      const txt = localStorage.getItem(LS_KEY);
      return txt ? S.normalize(JSON.parse(txt)) : null;
    } catch { return null; }
  };
  S.persist = (state) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* storage unavailable – .json export still works */ }
  };

  S.exportJSON = (state) => {
    const data = { ...state, format: FORMAT, version: 2, savedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `miles-and-more-status-${MM.engine.todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  };

  S.importFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(reader.result);
        if (raw.format && raw.format !== FORMAT) throw new Error('Not a Miles & More Status Tracker file.');
        // Version 1 files (per-segment fares, "upgrade paid") are no longer converted; they would load with wrong values.
        if (!(+raw.version >= 2)) throw new Error('This file was saved by an older version of the tracker and can no longer be loaded.');
        resolve(S.normalize(raw));
      } catch (e) { reject(e); }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

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
    const today = MM.engine.todayISO();
    const plan = [
      // [monthOffsetFromToday, flightNo, from, to, booked, upgrade, paid, fare (added to the booking), upgradeCost, co2, co2Cost, pnr]
      [-14, 'LH400', 'FRA', 'JFK', 'Economy', 'Business', true, 780, 650, 'medium', 18, 'K7XQ2P'],
      [-14, 'LH401', 'JFK', 'FRA', 'Economy', 'Economy', false, 0, 0, 'none', 0, 'K7XQ2P'],
      [-9, 'LX318', 'ZRH', 'LHR', 'Economy', 'Economy', false, 189, 0, 'none', 0, 'R2MM8D'],
      [-9, 'LX325', 'LHR', 'ZRH', 'Economy', 'Business', false, 0, 0, 'none', 0, 'R2MM8D'],
      [-7, 'LH2032', 'MUC', 'FRA', 'Economy', 'Economy', false, 99, 0, 'small', 3, 'P9TT4A'],
      [-6, 'OS101', 'VIE', 'FRA', 'Business', 'Business', false, 420, 0, 'large', 9, 'B44XKL'],
      [-5, 'SN2903', 'BRU', 'FRA', 'Economy', 'Economy', false, 130, 0, 'none', 0, 'HM2K1Q'],
      [-4, 'LH772', 'FRA', 'BKK', 'Premium Economy', 'Premium Economy', false, 1350, 0, 'xlarge', 42, 'ZZ81PL'],
      [-3, 'TG920', 'BKK', 'FRA', 'Economy', 'Economy', false, 0, 0, 'none', 0, 'ZZ81PL'],
      [-1, 'LH454', 'FRA', 'SFO', 'Business', 'Business', false, 2890, 0, 'medium', 35, 'Q1W2E3'],
      [-1, 'LH455', 'SFO', 'FRA', 'Business', 'First', true, 0, 1200, 'medium', 35, 'Q1W2E3'],
      [1, 'LH778', 'FRA', 'SIN', 'Business', 'Business', false, 3100, 0, 'large', 40, 'PLAN01'],
      [1, 'LH779', 'SIN', 'FRA', 'Business', 'Business', false, 0, 0, 'large', 40, 'PLAN01'],
      [2, 'LH400', 'FRA', 'JFK', 'Business', 'Business', false, 2450, 0, 'xlarge', 60, 'PLAN02'],
      [2, 'LX38', 'ZRH', 'SFO', 'Business', 'Business', false, 2200, 0, 'medium', 30, 'PLAN03'],
    ];
    const base = new Date(today + 'T12:00:00');
    plan.forEach(([mo, no, from, to, bc, uc, paid, fc, uco, co2, co2c, pnr], i) => {
      const d = new Date(base); d.setMonth(d.getMonth() + mo); d.setDate(Math.min(27, 3 + (i * 5) % 25));
      const date = d.toISOString().slice(0, 10);
      const p = MM.engine.parseFlightNo(no);
      const resp = { flightroute: { callsign: no, callsign_iata: no, airline: { name: p.airline.name, iata: p.code, icao: p.airline.icao }, origin: apResp(from), destination: apResp(to) } };
      s.apiCache[no] = { queried: true, source: 'adsbdb.com (demo)', fetchedAt: new Date().toISOString(), status: 'ok', response: resp };
      const f = { ...S.newFlight(date), flightNo: no, airlineCode: p.code, airlineName: p.airline.name, bookingCode: pnr,
        bookedClass: bc, upgradeClass: uc, upgradeType: uc === bc ? '' : paid ? 'bid' : 'voucher',
        upgradeCost: uco, co2Level: co2, co2Cost: co2c };
      s.bookings[pnr] = { fare: ((s.bookings[pnr] || {}).fare || 0) + fc };
      f.route = MM.api.routeFromCache(s.apiCache[no]);
      f.routeLookup = { queried: true, status: 'ok', fetchedAt: s.apiCache[no].fetchedAt, source: 'cache' };
      s.flights.push(f);
    });
    // One statement correction, 10 days after the LX318 segment.
    const lx = s.flights.find(f => f.flightNo === 'LX318');
    const cd = new Date(lx.date + 'T12:00:00'); cd.setDate(cd.getDate() + 10);
    s.adjustments.push({ ...S.newAdjustment(cd.toISOString().slice(0, 10)), p: 20, qp: 20, hon: 0, remark: 'Statement: retro credit for missing LX segment' });
    return s;
  };
})();
