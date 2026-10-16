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
    return p ? { ...p, name: (p.airline && p.airline.name) || p.code } : null;
  };

  /** SWISS code-share LX8000–8499 operated by Edelweiss (WK): earns like SWISS (Miles & More FAQ). */
  E.isEdelweissCodeshare = (f) => {
    const p = E.parseFlightNo(f.flightNo), op = E.operating(f);
    const n = p ? parseInt(p.number, 10) : NaN;
    return !!p && p.code === 'LX' && n >= 8000 && n <= 8499 && !!op && op.code === 'WK';
  };

  /**
   * Earning group: explicit override, else the operating airline ("Points are credited for flights operated
   * by …"), so LH9246 operated by United earns Points only and UA9414 operated by Lufthansa earns like Lufthansa.
   * Without an operator, or with one that isn't in MM.AIRLINES, the marketing airline decides.
   * Exception: LX8000–8499 operated by Edelweiss earns like SWISS.
   */
  E.earningGroup = (f) => {
    if (f.earningGroup && f.earningGroup !== 'auto') return f.earningGroup;
    const a = MM.AIRLINES[f.airlineCode];
    const mkt = a ? a.group : 'NONE';
    const op = E.operating(f);
    if (!op || !op.airline || E.isEdelweissCodeshare(f)) return mkt;
    return op.airline.group;
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

  /** Cabin that earns: manual override, else the upgrade class (fixed or bid upgrade), else the booked class. */
  E.earningClass = (f) => {
    if (f.earnClassOverride && f.earnClassOverride !== 'auto') return f.earnClassOverride;
    return E.upgradeEarns(f) && f.upgradeClass ? f.upgradeClass : f.bookedClass;
  };

  /** Fixed (online / airport) and bid upgrades earn in the upgraded class; miles, voucher and operational ones don't. */
  E.upgradeEarns = (f) => !!(MM.UPGRADE_TYPES[f.upgradeType] || {}).earnsUpgrade;

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
    const zero = { p: 0, qp: 0, hon: 0, haul, group, cls, rail, unknown: !haul };
    if (!haul || group === 'NONE') return zero;
    const per = rules.points[haul][cls];
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
      haul, group, cls, rail, unknown: false,
    };
  };

  E.isPlanned = (f, today = E.todayISO()) => f.date > today;

  /** Booking codes are compared in upper case without spaces. */
  E.bookingKey = (code) => String(code || '').toUpperCase().replace(/\s/g, '');
  /** Number of segments per booking code. */
  E.bookingSegments = (state) => {
    const n = {};
    for (const f of state.flights) { const k = E.bookingKey(f.bookingCode); if (k) n[k] = (n[k] || 0) + 1; }
    return n;
  };
  /**
   * Fare of one segment: the fare of its booking (state.bookings[code].fare) split evenly over the booking's
   * segments, or the segment's own fare (flightCost) when it has no booking code or no booking entry.
   */
  E.fareShare = (state, f, segs = E.bookingSegments(state)) => {
    const k = E.bookingKey(f.bookingCode);
    const b = k && state.bookings[k];
    return b ? (+b.fare || 0) / (segs[k] || 1) : (+f.flightCost || 0);
  };

  /** Costs of one segment; `fare` is its share of the fare (see E.fareShare). */
  E.cost = (f, fare) => {
    const upgrade = f.upgradeClass !== f.bookedClass ? (+f.upgradeCost || 0) : 0;
    const co2 = f.co2Level !== 'none' ? (+f.co2Cost || 0) : 0;
    return { flight: fare, upgrade, co2, total: fare + upgrade + co2 };
  };

  /**
   * Totals that count towards status `key`: QP (FTL, SEN) or HON Circle Points (HON) from rail segments
   * only count up to rules.railCaps[key]. t = { p, qp, hon, qpRail, honRail }.
   */
  E.effective = (t, key, rules) => {
    const cap = rules.railCaps[key];
    const qpRail = t.qpRail || 0, honRail = t.honRail || 0;
    return key === 'HON'
      ? { p: t.p, qp: t.qp, hon: t.hon - honRail + Math.min(honRail, cap) }
      : { p: t.p, qp: t.qp - qpRail + Math.min(qpRail, cap), hon: t.hon };
  };

  /** Highest status reached with totals t = { p, qp, hon, qpRail, honRail } (rail values are part of qp / hon). */
  E.status = (t, rules) => {
    const th = rules.thresholds;
    if (E.effective(t, 'HON', rules).hon >= th.HON.hon) return 'HON';
    if (t.p >= th.SEN.p && E.effective(t, 'SEN', rules).qp >= th.SEN.qp) return 'SEN';
    if (t.p >= th.FTL.p && E.effective(t, 'FTL', rules).qp >= th.FTL.qp) return 'FTL';
    return 'NONE';
  };
  E.rank = (s) => MM.STATUS_ORDER.indexOf(s);
  const best = (a, b) => (E.rank(a) >= E.rank(b) ? a : b);

  /** A status reached in `year` is valid immediately until the end of February of the year after next. */
  E.validUntil = (year) => new Date(Date.UTC(year + 2, 2, 0)).toISOString().slice(0, 10);

  /** Starting status from the account statement (settings.startStatus) if it was earned in `year`, else 'NONE'. */
  E.statementStatus = (state, year) => {
    const s = state.settings.startStatus;
    return s.year === year ? s.status : 'NONE';
  };

  /** Calendar years that have flights, corrections or stays, plus the current year. */
  E.years = (state, today = E.todayISO()) => {
    const items = [...state.flights, ...state.adjustments, ...state.stays];
    const ys = new Set(items.map(x => +x.date.slice(0, 4)));
    ys.add(+today.slice(0, 4));
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
    const m = rules.marriott;
    if ((+stay.nights || 0) < m.minNights) return { p: 0, qp: 0, hon: 0, reason: 'short' };
    const p = Math.max(0, Math.min(m.pointsPerStay, m.maxPointsPerYear - usedSoFar));
    return { p, qp: 0, hon: 0, reason: p === m.pointsPerStay ? 'ok' : p === 0 ? 'cap' : 'partial' };
  };

  /**
   * Walks one calendar year in date order (flights, manual corrections and Marriott stays; on the same day in
   * that order). rows: flights; adjustments: corrections; stays: hotel stays; events: all of them in date order.
   * Also returns totals (actual vs. incl. plan), costs (actual, plan, all), the dates on which each status was
   * (or will be) reached and, for the forecast, the item that reached it (reached.forecastBy). Items after `today`
   * are planned. A starting status from the statement earned in this year raises statusActual / statusForecast
   * (fromStatement: it is higher than the status earned with the tracked items); it has no date in `reached`.
   * unknown: flights in the forecast that would earn but have no haul.
   */
  E.yearSummary = (state, year, today = E.todayISO()) => {
    const rules = state.settings.rules;
    const inYear = x => +x.date.slice(0, 4) === year;
    const ORDER = { flight: 0, adj: 1, stay: 2 };
    const items = [
      ...state.flights.filter(inYear).map(f => ({ kind: 'flight', f, date: f.date })),
      ...state.adjustments.filter(inYear).map(a => ({ kind: 'adj', a, date: a.date })),
      ...state.stays.filter(inYear).map(s => ({ kind: 'stay', s, date: s.date })),
    ].sort((x, y) => x.date.localeCompare(y.date) || ORDER[x.kind] - ORDER[y.kind]);
    const zero = () => ({ p: 0, qp: 0, hon: 0, qpRail: 0, honRail: 0 });
    const noCost = () => ({ flight: 0, upgrade: 0, co2: 0, total: 0 });
    const act = zero(), all = zero();
    const cost = { actual: noCost(), plan: noCost(), all: noCost() };
    const reached = { actual: {}, forecast: {}, forecastBy: {} };
    const adjTotal = { p: 0, qp: 0, hon: 0 }, stayTotal = { p: 0 };
    const rows = [], adjustments = [], stays = [], events = [];
    let unknown = 0;
    const segs = E.bookingSegments(state);
    const add = (t, e) => { t.p += e.p; t.qp += e.qp; t.hon += e.hon; if (e.rail) { t.qpRail += e.qp; t.honRail += e.hon; } };
    /** Notes the first date on which totals t reach each status and, for the forecast, the item that did it. */
    const markReached = (t, dates, date, by) => {
      const s = E.status(t, rules);
      for (const k of MM.STATUSES) if (E.rank(s) >= E.rank(k) && !dates[k]) { dates[k] = date; if (by) reached.forecastBy[k] = by; }
    };
    for (const it of items) {
      const isAdj = it.kind === 'adj', isStay = it.kind === 'stay';
      const date = it.date;
      const planned = E.isPlanned(it, today);
      const counts = isAdj || isStay || !planned || it.f.includeInPlan !== false;
      const e = isAdj ? E.adjustmentEarn(it.a) : isStay ? E.stayEarn(it.s, rules, stayTotal.p) : E.earn(it.f, rules);
      const c = isAdj || isStay ? noCost() : E.cost(it.f, E.fareShare(state, it.f, segs));
      if (it.kind === 'flight' && counts && e.unknown && e.group !== 'NONE') unknown++;
      if (counts) {
        add(all, e);
        for (const k of Object.keys(c)) { (planned ? cost.plan : cost.actual)[k] += c[k]; cost.all[k] += c[k]; }
        markReached(all, reached.forecast, date, isAdj ? 'Correction' : isStay ? 'Marriott Bonvoy' : it.f.flightNo);
      }
      if (!planned) {
        add(act, e);
        markReached(act, reached.actual, date);
      }
      const base = { date, e, c, planned, counts };
      const row = isAdj ? { ...base, adj: it.a } : isStay ? { ...base, stay: it.s } : { ...base, f: it.f };
      if (isAdj) { adjustments.push(row); adjTotal.p += e.p; adjTotal.qp += e.qp; adjTotal.hon += e.hon; }
      else if (isStay) { stays.push(row); stayTotal.p += e.p; }
      else rows.push(row);
      events.push(row);
    }
    const stmt = E.statementStatus(state, year), earned = E.status(act, rules);
    return {
      year, rows, adjustments, stays, events, adjTotal, stayTotal, actual: act, forecast: all, cost, reached, unknown,
      statusActual: best(earned, stmt),
      statusForecast: best(E.status(all, rules), stmt),
      fromStatement: E.rank(stmt) > E.rank(earned),
    };
  };

  /** Soft landing: one level below `s` (HON -> SEN -> FTL -> NONE). */
  E.softLanding = (s) => MM.STATUS_ORDER[Math.max(0, E.rank(s) - 1)];

  /**
   * Status timeline per calendar year (gap years filled in, so soft landings cascade).
   * carriedIn: status valid from March of `year` = status earned in year-1 or, if year-1 did not
   *   requalify the status held then, the soft landing one level below it.
   * held: best of carriedIn and the status earned so far in `year`.
   * downgraded: held is below the status held in year-1 (prevHeld).
   * A starting status from the account statement (settings.startStatus = { status, year }) counts as
   * earned in that year (see E.yearSummary); the timeline then starts in that year at the latest.
   * hasPrev: the timeline has a year before `year` (otherwise nothing could be carried in).
   */
  E.history = (state, untilYear, today = E.todayISO()) => {
    const ys = E.years(state, today);
    if (untilYear && untilYear > ys[ys.length - 1]) ys.push(untilYear);
    const start = state.settings.startStatus;
    const first = start.status !== 'NONE' && start.year ? Math.min(ys[0], start.year) : ys[0];
    const out = [];
    let prevHeld = 'NONE', prevEarned = 'NONE';
    for (let y = first; y <= ys[ys.length - 1]; y++) {
      const s = E.yearSummary(state, y, today);
      const carriedIn = best(prevEarned, E.softLanding(prevHeld));
      const held = best(carriedIn, s.statusActual);
      out.push({ ...s, carriedIn, held, prevHeld, hasPrev: y > first, downgraded: E.rank(held) < E.rank(prevHeld) });
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

  /* ---------- planner scenarios ---------- */
  /**
   * One row of a planned mix: `count` extra segments of a kind.
   * kind: 'LHG' (Lufthansa Group flight), 'STAR' (Star Alliance flight, Points only) or 'RAIL' (train: continental,
   * no CO₂ booster, QP / HON capped). Returns the earning of one segment.
   */
  E.mixRowEarn = (row, rules) => {
    const rail = row.kind === 'RAIL';
    return E.earn({
      transport: rail ? 'rail' : 'flight', earningGroup: row.kind === 'STAR' ? 'STAR' : 'LHG',
      haulOverride: rail ? 'continental' : row.haul, bookedClass: row.cls, co2Level: rail ? 'none' : row.co2Level,
    }, rules);
  };

  /**
   * "Fill the gap": how many more Lufthansa Group flights of one type (seg = { haul, cls, co2Level }) close the gap
   * to status `key` on top of totals t (Infinity if they can't). e: the earning of one of them.
   */
  E.segmentsNeeded = (t, key, seg, rules) => {
    const e = E.mixRowEarn({ ...seg, kind: 'LHG' }, rules), g = E.gap(t, key, rules);
    const n = Math.max(0, ...Object.keys(g).map(k => (g[k] === 0 ? 0 : e[k] ? Math.ceil(g[k] / e[k]) : Infinity)));
    return { n, e };
  };

  /** Points a flight gains (or loses) with CO₂ booster `level` instead of its own. */
  E.co2Gain = (f, level, rules) => {
    const a = E.earn(f, rules), b = E.earn({ ...f, co2Level: level }, rules);
    return { p: b.p - a.p, qp: b.qp - a.qp, hon: b.hon - a.hon };
  };

  /** Average CO₂ compensation cost the user paid for this booster level and haul, or null without data. */
  E.co2CostEstimate = (state, level, haul) => {
    const xs = state.flights.filter(f => f.co2Level === level && +f.co2Cost > 0 && E.haul(f) === haul).map(f => +f.co2Cost);
    return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 100) / 100 : null;
  };

  /**
   * What-if scenario for a calendar year, on top of the forecast (flown + planned flights, corrections, stays):
   *  1. plan.co2 = { flightId: { level, cost } } – a CO₂ booster per existing or planned flight instead of its own
   *  2. plan.mix = [{ count, kind, haul, cls, co2Level, cost }] – extra segments (cost = per segment, all-in)
   * Returns the totals after each step, the extra cost of each step and the status reached (a starting status
   * from the statement counts in every step, see E.yearSummary).
   */
  E.planScenario = (state, year, plan, today = E.todayISO()) => {
    const rules = state.settings.rules;
    const over = plan.co2;
    const base = E.yearSummary(state, year, today);
    const flights = state.flights.map(f => (over[f.id] ? { ...f, co2Level: over[f.id].level, co2Cost: over[f.id].cost } : f));
    const withCo2 = E.yearSummary({ ...state, flights }, year, today);
    const total = { ...withCo2.forecast };
    let mixCost = 0;
    const mix = plan.mix.map(row => {
      const n = row.count, e = E.mixRowEarn(row, rules), cost = n * row.cost;
      total.p += n * e.p; total.qp += n * e.qp; total.hon += n * e.hon;
      if (e.rail) { total.qpRail += n * e.qp; total.honRail += n * e.hon; }
      mixCost += cost;
      return { row, n, e, sum: { p: n * e.p, qp: n * e.qp, hon: n * e.hon }, cost };
    });
    const costOf = (s) => s.cost.all.total;
    return {
      base, withCo2, mix, total,
      cost: { base: costOf(base), co2Extra: costOf(withCo2) - costOf(base), mix: mixCost, total: costOf(withCo2) + mixCost },
      status: {
        actual: base.statusActual, forecast: base.statusForecast, withCo2: withCo2.statusForecast,
        total: best(E.status(total, rules), E.statementStatus(state, year)),
      },
    };
  };
})();
