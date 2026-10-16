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
  /** Rail and bus segments are domestic / within Europe: continental unless the airports say otherwise. */
  E.haul = (f) => (f.haulOverride && f.haulOverride !== 'auto' ? f.haulOverride
    : E.autoHaul(f) || (f.transport === 'rail' || f.transport === 'bus' ? 'continental' : null));

  /** Cabin that earns: manual override, else the paid upgrade class, else the booked class. */
  E.earningClass = (f) => {
    if (f.earnClassOverride && f.earnClassOverride !== 'auto') return f.earnClassOverride;
    return f.upgradePaid && f.upgradeClass ? f.upgradeClass : f.bookedClass;
  };

  /**
   * Points earned for one segment, incl. CO2 booster.
   * transport: 'flight' (default), 'rail' (Austrian AIRail, Lufthansa Express Rail, SWISS Air Rail – earns like
   * a flight, but QP/HON count towards a status only up to rules.railCaps), 'bus' (Lufthansa Express Bus – no credit).
   */
  E.earn = (f, rules) => {
    const haul = E.haul(f);
    const bus = f.transport === 'bus';
    const group = bus ? 'NONE' : E.earningGroup(f);
    const cls = E.earningClass(f);
    const rail = f.transport === 'rail';
    const zero = { p: 0, qp: 0, hon: 0, base: { p: 0, qp: 0, hon: 0 }, haul, group, cls, rail, unknown: !haul };
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
      base, haul, group, cls, rail, unknown: false,
    };
  };

  E.isPlanned = (f, today = E.todayISO()) => f.date > today;
  E.cost = (f) => {
    const flight = +f.flightCost || 0;
    const upgrade = f.upgradeClass && f.upgradeClass !== f.bookedClass ? (+f.upgradeCost || 0) : 0;
    const co2 = f.co2Level && f.co2Level !== 'none' ? (+f.co2Cost || 0) : 0;
    return { flight, upgrade, co2, total: flight + upgrade + co2 };
  };

  /**
   * Totals that count towards status `key`: QP (FTL, SEN) or HON Circle Points (HON) from rail segments
   * only count up to rules.railCaps[key]. t = { p, qp, hon, qpRail, honRail }.
   */
  E.effective = (t, key, rules) => {
    const cap = (rules.railCaps || {})[key];
    const qpRail = t.qpRail || 0, honRail = t.honRail || 0;
    if (cap == null) return { p: t.p, qp: t.qp, hon: t.hon };
    return key === 'HON'
      ? { p: t.p, qp: t.qp, hon: t.hon - honRail + Math.min(honRail, cap) }
      : { p: t.p, qp: t.qp - qpRail + Math.min(qpRail, cap), hon: t.hon };
  };

  /** Highest status reached with these totals; `rail` = { qp, hon } earned on rail (part of qp / hon). */
  E.statusFor = (p, qp, hon, rules, rail = {}) => {
    const t = { p, qp, hon, qpRail: rail.qp || 0, honRail: rail.hon || 0 };
    const th = rules.thresholds;
    if (E.effective(t, 'HON', rules).hon >= th.HON.hon) return 'HON';
    if (p >= th.SEN.p && E.effective(t, 'SEN', rules).qp >= th.SEN.qp) return 'SEN';
    if (p >= th.FTL.p && E.effective(t, 'FTL', rules).qp >= th.FTL.qp) return 'FTL';
    return 'NONE';
  };
  const statusOf = (t, rules) => E.statusFor(t.p, t.qp, t.hon, rules, { qp: t.qpRail, hon: t.honRail });
  E.rank = (s) => MM.STATUS_ORDER.indexOf(s);

  /** A status reached in `year` is valid immediately until the end of February of the year after next. */
  E.validUntil = (year) => new Date(Date.UTC(year + 2, 2, 0)).toISOString().slice(0, 10);

  /** Calendar years that have flights or corrections, plus the current year. */
  E.years = (state) => {
    const items = [...(state.flights || []), ...(state.adjustments || []), ...(state.stays || [])];
    const ys = new Set(items.map(x => +x.date.slice(0, 4)));
    ys.add(new Date().getFullYear());
    return [...ys].sort((a, b) => a - b);
  };

  /** Manual correction (from the account statement) as earned values; may be negative. */
  E.adjustmentEarn = (a) => ({ p: Math.round(+a.p || 0), qp: Math.round(+a.qp || 0), hon: Math.round(+a.hon || 0) });

  /**
   * Marriott Bonvoy stay: rules.marriott.pointsPerStay Points (no QP / HON) for a stay of at least minNights,
   * but only until maxPointsPerYear Points from stays are reached in the calendar year (`usedSoFar`).
   * reason: 'ok' | 'short' (too few nights) | 'cap' (yearly maximum reached) | 'partial'.
   */
  E.stayEarn = (stay, rules, usedSoFar = 0) => {
    const m = rules.marriott || { pointsPerStay: 0, minNights: 0, maxPointsPerYear: 0 };
    if ((+stay.nights || 0) < m.minNights) return { p: 0, qp: 0, hon: 0, reason: 'short' };
    const p = Math.max(0, Math.min(m.pointsPerStay, m.maxPointsPerYear - usedSoFar));
    return { p, qp: 0, hon: 0, reason: p === m.pointsPerStay ? 'ok' : p === 0 ? 'cap' : 'partial' };
  };

  /**
   * Walks one calendar year in date order (flights, manual corrections and Marriott stays).
   * rows: flights; adjustments: corrections; stays: hotel stays; events: all of them in date order.
   * Also returns totals (actual vs. incl. plan) and the dates on which each status was
   * (or will be) reached.
   */
  E.yearSummary = (state, year) => {
    const rules = state.settings.rules;
    const today = E.todayISO();
    const inYear = x => +x.date.slice(0, 4) === year;
    const ORDER = { flight: 0, adj: 1, stay: 2 };
    const items = [
      ...state.flights.filter(inYear).map(f => ({ kind: 'flight', f, date: f.date })),
      ...(state.adjustments || []).filter(inYear).map(a => ({ kind: 'adj', a, date: a.date })),
      ...(state.stays || []).filter(inYear).map(s => ({ kind: 'stay', s, date: s.date })),
    ].sort((x, y) => x.date.localeCompare(y.date) || ORDER[x.kind] - ORDER[y.kind]);
    const act = { p: 0, qp: 0, hon: 0, qpRail: 0, honRail: 0 }, all = { p: 0, qp: 0, hon: 0, qpRail: 0, honRail: 0 };
    const cost = { actual: { flight: 0, upgrade: 0, co2: 0, total: 0 }, plan: { flight: 0, upgrade: 0, co2: 0, total: 0 } };
    const reached = { actual: {}, forecast: {} };
    const adjTotal = { p: 0, qp: 0, hon: 0 }, stayTotal = { p: 0, qp: 0, hon: 0 };
    const rows = [], adjustments = [], stays = [], events = [];
    let unknown = 0;
    const NO_COST = { flight: 0, upgrade: 0, co2: 0, total: 0 };
    for (const it of items) {
      const isAdj = it.kind === 'adj', isStay = it.kind === 'stay';
      const date = it.date;
      const planned = date > today;
      const counts = isAdj || isStay || !planned || it.f.includeInPlan !== false;
      const e = isAdj ? E.adjustmentEarn(it.a) : isStay ? E.stayEarn(it.s, rules, stayTotal.p) : E.earn(it.f, rules);
      const c = isAdj || isStay ? NO_COST : E.cost(it.f);
      if (it.kind === 'flight' && e.unknown) unknown++;
      if (counts) {
        all.p += e.p; all.qp += e.qp; all.hon += e.hon;
        if (e.rail) { all.qpRail += e.qp; all.honRail += e.hon; }
        const bucket = planned ? cost.plan : cost.actual;
        for (const k of ['flight', 'upgrade', 'co2', 'total']) bucket[k] += c[k];
        const s = statusOf(all, rules);
        for (const k of ['FTL', 'SEN', 'HON']) if (E.rank(s) >= E.rank(k) && !reached.forecast[k]) reached.forecast[k] = date;
      }
      if (!planned) {
        act.p += e.p; act.qp += e.qp; act.hon += e.hon;
        if (e.rail) { act.qpRail += e.qp; act.honRail += e.hon; }
        const s = statusOf(act, rules);
        for (const k of ['FTL', 'SEN', 'HON']) if (E.rank(s) >= E.rank(k) && !reached.actual[k]) reached.actual[k] = date;
      }
      const base = { e, c, planned, counts, cum: { ...all }, cumActual: { ...act } };
      const row = isAdj ? { ...base, adj: it.a, f: { date, flightNo: 'Correction' } }
        : isStay ? { ...base, stay: it.s, f: { date, flightNo: 'Marriott Bonvoy' } }
        : { ...base, f: it.f };
      if (isAdj) { adjustments.push(row); adjTotal.p += e.p; adjTotal.qp += e.qp; adjTotal.hon += e.hon; }
      else if (isStay) { stays.push(row); stayTotal.p += e.p; }
      else rows.push(row);
      events.push(row);
    }
    return {
      year, rows, adjustments, stays, events, adjTotal, stayTotal, actual: act, forecast: all, cost, reached, unknown,
      statusActual: statusOf(act, rules),
      statusForecast: statusOf(all, rules),
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
    const th = rules.thresholds[key], eff = E.effective(t, key, rules);
    if (key === 'HON') return { hon: Math.max(0, th.hon - eff.hon) };
    return { p: Math.max(0, th.p - eff.p), qp: Math.max(0, th.qp - eff.qp) };
  };

  /** Simple planning helper: how many extra LHG segments of a type would close the gap? */
  E.segmentsNeeded = (t, key, haul, cls, co2Level, rules) => {
    const e = E.earn({ haulOverride: haul, earningGroup: 'LHG', bookedClass: cls, co2Level }, rules);
    const g = E.gap(t, key, rules);
    const need = Object.keys(g).map(k => (g[k] === 0 ? 0 : e[k] ? Math.ceil(g[k] / e[k]) : Infinity));
    return Math.max(0, ...need);
  };
})();
