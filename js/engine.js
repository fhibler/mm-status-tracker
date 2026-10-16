/* Pure calculation logic: airline parsing, haul detection, points, status, forecasts. */
(function () {
  const E = (MM.engine = {});

  E.todayISO = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };

  /** "LH 400", "lh400", "4Y123", "DLH400" -> { code, number, iata, airline } */
  E.parseFlightNo = (raw) => {
    const s = String(raw || '').toUpperCase().replace(/[\s-]/g, '');
    let m = s.match(/^([A-Z]{3})(\d{1,4}[A-Z]?)$/);
    if (m) {
      const iata = Object.keys(MM.AIRLINES).find(k => MM.AIRLINES[k].icao === m[1]);
      if (iata) return { code: iata, number: m[2], iata: iata + m[2], airline: MM.AIRLINES[iata] };
    }
    m = s.match(/^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/);
    if (!m || /^\d\d$/.test(m[1])) return null;
    return { code: m[1], number: m[2], iata: m[1] + m[2], airline: MM.AIRLINES[m[1]] || null };
  };

  E.airlineName = (f) => f.airlineName || (MM.AIRLINES[f.airlineCode] || {}).name || f.airlineCode || '–';

  /** Operating carrier of a codeshare (from f.operatingFlightNo), or null. */
  E.operating = (f) => {
    const p = f.operatingFlightNo ? E.parseFlightNo(f.operatingFlightNo) : null;
    return p ? { ...p, name: (p.airline && p.airline.name) || p.code, group: p.airline ? p.airline.group : 'NONE' } : null;
  };

  /**
   * Earning group: explicit override, else the better of marketing and operating airline
   * (a codeshare operated by a Lufthansa Group airline earns like a Lufthansa Group flight).
   */
  const GROUP_RANK = { NONE: 0, STAR: 1, LHG: 2 };
  E.earningGroup = (f) => {
    if (f.earningGroup && f.earningGroup !== 'auto') return f.earningGroup;
    const a = MM.AIRLINES[f.airlineCode];
    const mkt = a ? a.group : 'NONE';
    const op = E.operating(f);
    return op && GROUP_RANK[op.group] > GROUP_RANK[mkt] ? op.group : mkt;
  };

  E.distanceKm = (a, b) => {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  };

  /** 'continental' | 'intercontinental' | null (unknown) */
  E.autoHaul = (f) => {
    const r = f.route;
    if (!r || !r.origin || !r.destination || !r.origin.country || !r.destination.country) return null;
    const a = r.origin.country, b = r.destination.country;
    if (a === b) return 'continental';                       // domestic, e.g. SEA–SFO
    const ra = MM.REGION_OF[a], rb = MM.REGION_OF[b];
    return ra && ra === rb ? 'continental' : 'intercontinental';
  };
  E.haul = (f) => (f.haulOverride && f.haulOverride !== 'auto' ? f.haulOverride : E.autoHaul(f));

  /** Cabin that earns: manual override, else the paid upgrade class, else the booked class. */
  E.earningClass = (f) => {
    if (f.earnClassOverride && f.earnClassOverride !== 'auto') return f.earnClassOverride;
    return f.upgradePaid && f.upgradeClass ? f.upgradeClass : f.bookedClass;
  };

  /** Points earned for one segment, incl. CO2 booster. */
  E.earn = (f, rules) => {
    const haul = E.haul(f);
    const group = E.earningGroup(f);
    const cls = E.earningClass(f);
    const zero = { p: 0, qp: 0, hon: 0, base: { p: 0, qp: 0, hon: 0 }, haul, group, cls, unknown: !haul };
    if (!haul || group === 'NONE') return zero;
    const per = (rules.points[haul] || {})[cls] || 0;
    const base = {
      p: per,
      qp: group === 'LHG' ? per : 0,
      hon: group === 'LHG' && rules.honClasses.includes(cls) ? per : 0,
    };
    const b = rules.co2[f.co2Level] || { p: 0, qp: 0, hon: 0 };
    return {
      p: Math.round(base.p * (1 + b.p / 100)),
      qp: Math.round(base.qp * (1 + b.qp / 100)),
      hon: Math.round(base.hon * (1 + b.hon / 100)),
      base, haul, group, cls, unknown: false,
    };
  };

  E.isPlanned = (f, today = E.todayISO()) => f.date > today;
  E.cost = (f) => {
    const flight = +f.flightCost || 0;
    const upgrade = f.upgradeClass && f.upgradeClass !== f.bookedClass ? (+f.upgradeCost || 0) : 0;
    const co2 = f.co2Level && f.co2Level !== 'none' ? (+f.co2Cost || 0) : 0;
    return { flight, upgrade, co2, total: flight + upgrade + co2 };
  };

  E.statusFor = (p, qp, hon, rules) => {
    const t = rules.thresholds;
    if (hon >= t.HON.hon) return 'HON';
    if (p >= t.SEN.p && qp >= t.SEN.qp) return 'SEN';
    if (p >= t.FTL.p && qp >= t.FTL.qp) return 'FTL';
    return 'NONE';
  };
  E.rank = (s) => MM.STATUS_ORDER.indexOf(s);

  /** A status reached in `year` is valid immediately until the end of February of the year after next. */
  E.validUntil = (year) => new Date(Date.UTC(year + 2, 2, 0)).toISOString().slice(0, 10);

  /** Calendar years that have flights or corrections, plus the current year. */
  E.years = (state) => {
    const items = [...(state.flights || []), ...(state.adjustments || [])];
    const ys = new Set(items.map(x => +x.date.slice(0, 4)));
    ys.add(new Date().getFullYear());
    return [...ys].sort((a, b) => a - b);
  };

  /** Manual correction (from the account statement) as earned values; may be negative. */
  E.adjustmentEarn = (a) => ({ p: Math.round(+a.p || 0), qp: Math.round(+a.qp || 0), hon: Math.round(+a.hon || 0) });

  /**
   * Walks one calendar year in date order (flights and manual corrections).
   * rows: flights with their earnings; adjustments: corrections; events: both, in date order.
   * Also returns totals (actual vs. incl. plan) and the dates on which each status was
   * (or will be) reached.
   */
  E.yearSummary = (state, year) => {
    const rules = state.settings.rules;
    const today = E.todayISO();
    const inYear = x => +x.date.slice(0, 4) === year;
    const items = [
      ...state.flights.filter(inYear).map(f => ({ kind: 'flight', f })),
      ...(state.adjustments || []).filter(inYear).map(a => ({ kind: 'adj', a })),
    ].sort((x, y) => {
      const dx = (x.f || x.a).date, dy = (y.f || y.a).date;
      return dx.localeCompare(dy) || (x.kind === y.kind ? 0 : x.kind === 'flight' ? -1 : 1);
    });
    const act = { p: 0, qp: 0, hon: 0 }, all = { p: 0, qp: 0, hon: 0 };
    const cost = { actual: { flight: 0, upgrade: 0, co2: 0, total: 0 }, plan: { flight: 0, upgrade: 0, co2: 0, total: 0 } };
    const reached = { actual: {}, forecast: {} };
    const adjTotal = { p: 0, qp: 0, hon: 0 };
    const rows = [], adjustments = [], events = [];
    let unknown = 0;
    const NO_COST = { flight: 0, upgrade: 0, co2: 0, total: 0 };
    for (const it of items) {
      const isAdj = it.kind === 'adj';
      const date = isAdj ? it.a.date : it.f.date;
      const planned = date > today;
      const counts = isAdj || !planned || it.f.includeInPlan !== false;
      const e = isAdj ? E.adjustmentEarn(it.a) : E.earn(it.f, rules);
      const c = isAdj ? NO_COST : E.cost(it.f);
      if (!isAdj && e.unknown) unknown++;
      if (counts) {
        all.p += e.p; all.qp += e.qp; all.hon += e.hon;
        const bucket = planned ? cost.plan : cost.actual;
        for (const k of ['flight', 'upgrade', 'co2', 'total']) bucket[k] += c[k];
        const s = E.statusFor(all.p, all.qp, all.hon, rules);
        for (const k of ['FTL', 'SEN', 'HON']) if (E.rank(s) >= E.rank(k) && !reached.forecast[k]) reached.forecast[k] = date;
      }
      if (!planned) {
        act.p += e.p; act.qp += e.qp; act.hon += e.hon;
        const s = E.statusFor(act.p, act.qp, act.hon, rules);
        for (const k of ['FTL', 'SEN', 'HON']) if (E.rank(s) >= E.rank(k) && !reached.actual[k]) reached.actual[k] = date;
      }
      const row = isAdj
        ? { adj: it.a, f: { date, flightNo: 'Correction' }, e, c, planned, counts, cum: { ...all }, cumActual: { ...act } }
        : { f: it.f, e, c, planned, counts, cum: { ...all }, cumActual: { ...act } };
      if (isAdj) { adjustments.push(row); adjTotal.p += e.p; adjTotal.qp += e.qp; adjTotal.hon += e.hon; }
      else rows.push(row);
      events.push(row);
    }
    return {
      year, rows, adjustments, events, adjTotal, actual: act, forecast: all, cost, reached, unknown,
      statusActual: E.statusFor(act.p, act.qp, act.hon, rules),
      statusForecast: E.statusFor(all.p, all.qp, all.hon, rules),
    };
  };

  /** Soft landing: one level below `s` (HON -> SEN -> FTL -> NONE). */
  E.softLanding = (s) => MM.STATUS_ORDER[Math.max(0, E.rank(s) - 1)];
  const best = (a, b) => (E.rank(a) >= E.rank(b) ? a : b);

  /**
   * Status timeline per calendar year (gap years filled in, so soft landings cascade).
   * carriedIn: status valid from March of `year` = status earned in year-1 or, if year-1 did not
   *   requalify the status held then, the soft landing one level below it.
   * held: best of carriedIn and the status earned so far in `year`.
   * downgraded: held is below the status held in year-1 (prevHeld).
   * A starting status from the account statement (settings.startStatus = { status, year }) counts as
   * earned in that year; the timeline then starts in that year at the latest.
   * hasPrev: the timeline has a year before `year` (otherwise nothing could be carried in).
   */
  E.history = (state, untilYear) => {
    const ys = E.years(state);
    if (untilYear && untilYear > ys[ys.length - 1]) ys.push(untilYear);
    const start = (state.settings && state.settings.startStatus) || {};
    const startYear = start.status && start.status !== 'NONE' && +start.year ? +start.year : null;
    const first = startYear ? Math.min(ys[0], startYear) : ys[0];
    const out = [];
    let prevHeld = 'NONE', prevEarned = 'NONE';
    for (let y = first; y <= ys[ys.length - 1]; y++) {
      const s = E.yearSummary(state, y);
      const fromStatement = y === startYear && E.rank(start.status) > E.rank(s.statusActual);
      if (fromStatement) {
        s.statusActual = start.status;
        s.statusForecast = best(s.statusForecast, start.status);
      }
      const carriedIn = best(prevEarned, E.softLanding(prevHeld));
      const held = best(carriedIn, s.statusActual);
      out.push({ ...s, carriedIn, held, prevHeld, fromStatement, hasPrev: y > first, downgraded: E.rank(held) < E.rank(prevHeld) });
      prevHeld = held;
      prevEarned = s.statusActual;
    }
    return out;
  };

  /** What's still missing to reach a status, based on totals t. */
  E.gap = (t, key, rules) => {
    const th = rules.thresholds[key];
    if (key === 'HON') return { hon: Math.max(0, th.hon - t.hon) };
    return { p: Math.max(0, th.p - t.p), qp: Math.max(0, th.qp - t.qp) };
  };

  /** Simple planning helper: how many extra LHG segments of a type would close the gap? */
  E.segmentsNeeded = (t, key, haul, cls, co2Level, rules) => {
    const e = E.earn({ haulOverride: haul, earningGroup: 'LHG', bookedClass: cls, co2Level }, rules);
    const g = E.gap(t, key, rules);
    const need = Object.keys(g).map(k => (g[k] === 0 ? 0 : e[k] ? Math.ceil(g[k] / e[k]) : Infinity));
    return Math.max(0, ...need);
  };
})();
