/* Route lookup via adsbdb.com (free, no key, CORS enabled).
 * Every answer is cached in state.apiCache keyed by IATA flight number and flight date ("LH1966 2026-11-17"), and
 * the cache is part of the exported .json – so an imported file never re-queries. adsbdb itself ignores the date: it
 * knows one route per number, the one flown at the moment. So an answer for a flight in another IATA schedule season
 * (E.iataSeason) is provisional, and is asked again once that season has started. */
(function () {
  const A = (MM.api = {});
  const BASE = 'https://api.adsbdb.com/v0/callsign/';
  const E = MM.engine;

  /** Cache key of a flight number on a date (ISO; today when empty). */
  A.cacheKey = (flightNo, date) => `${flightNo.toUpperCase()} ${date || E.todayISO()}`;
  /** A valid cache key, for S.normalize: entries saved before lookups had a date are dropped. */
  A.isCacheKey = (k) => /^[A-Z0-9]{2,3}\d{1,4}[A-Z]? \d{4}-\d{2}-\d{2}$/.test(k);
  /** The cached lookup of a flight number on a date, or undefined. */
  A.cached = (state, flightNo, date) => state.apiCache[A.cacheKey(flightNo, date)];

  /** adsbdb airport -> the app's airport shape. */
  const mapAirport = (a) => a && { iata: a.iata_code, name: a.name, city: a.municipality, country: a.country_iso_name, lat: a.latitude, lon: a.longitude };

  A.routeFromCache = (entry) => {
    if (!entry || entry.status !== 'ok') return null;
    const fr = entry.response && entry.response.flightroute;
    if (!fr) return null;
    return { origin: mapAirport(fr.origin), destination: mapAirport(fr.destination), airlineName: fr.airline && fr.airline.name, source: 'api' };
  };

  /**
   * Whether a lookup (cache entry or f.routeLookup, with fetchedAt and date) was made in another IATA season than the
   * flight's: its route is the one flown at lookup time and may not be the one on the flight date.
   */
  A.otherSeason = (lk, date) => !!(lk && lk.fetchedAt && date && E.iataSeason(lk.fetchedAt) !== E.iataSeason(date));
  /** A provisional answer worth asking again: looked up in another season, and the flight's season has started. */
  A.isProvisional = (lk, date, today = E.todayISO()) => A.otherSeason(lk, date) && E.iataSeason(today) === E.iataSeason(date);

  /** What a flight remembers about the lookup of `flightNo` (f.routeLookup); via: the operating flight that gave the route. */
  A.lookupInfo = (entry, flightNo, via) => ({ status: entry.status, source: entry.fromCache ? 'cache' : 'api', flightNo, via, error: entry.error, date: entry.date, fetchedAt: entry.fetchedAt });

  /** Airport by IATA code: from a cached route lookup, else from the bundled airport table (MM.airport). */
  A.airport = (state, iata) => {
    for (const c of Object.values(state.apiCache)) {
      const fr = c.status === 'ok' && c.response && c.response.flightroute;
      const a = fr && [fr.origin, fr.destination].find(x => x && x.iata_code === iata);
      if (a) return mapAirport(a);
    }
    return MM.airport(iata) || { iata, country: null, lat: null, lon: null };
  };

  /** Callsigns to try: adsbdb often knows only the ICAO form (UAL9414) and not the IATA form (UA9414). */
  const callsigns = (no) => {
    const p = E.parseFlightNo(no);
    const out = [no];
    if (p && p.airline && p.airline.icao) out.push(p.airline.icao + p.number);
    return out;
  };

  /**
   * Returns the cache entry for a flight number on a date (ISO; today when empty). Queries the API only when no
   * cached answer exists, the cached one is provisional (A.isProvisional), or `force` is set. Network and server
   * errors (anything but 200 / 404, e.g. 429 rate limit) are cached as 'error', which is not final: the next lookup
   * asks again. A forced lookup that fails keeps the earlier answer in the cache. `now` (the clock) is for tests.
   */
  A.lookup = async (state, iataFlightNo, date, { force = false, now = new Date() } = {}) => {
    const no = iataFlightNo.toUpperCase(), today = E.todayISO(now), day = date || today, key = A.cacheKey(no, day);
    const cached = state.apiCache[key];
    if (cached && cached.status !== 'error' && !force && !A.isProvisional(cached, day, today)) return { ...cached, fromCache: true };
    const entry = { date: day, fetchedAt: now.toISOString() };
    try {
      for (const cs of callsigns(no)) {
        const res = await fetch(BASE + encodeURIComponent(cs), { headers: { Accept: 'application/json' } });
        if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
        const json = await res.json().catch(() => null);
        entry.response = json ? json.response : null;
        entry.status = json && json.response && json.response.flightroute ? 'ok' : 'notfound';
        if (entry.status === 'ok') break;
      }
    } catch (err) {
      entry.status = 'error';
      entry.error = String(err && err.message || err);
    }
    if (entry.status !== 'error' || !cached || cached.status === 'error') state.apiCache[key] = entry;
    return { ...entry, fromCache: false };
  };

  /**
   * Route of a flight number on a date; a codeshare without one falls back to its operating flight (`operatingIata`).
   * Returns { entry, route, via }: route (or null) carries `via` when it came from the operating flight. entry is the
   * lookup to remember (see A.lookupInfo): the operating flight's when that gave the route or failed (an error is not
   * final, so the flight is looked up again later), else the marketing flight's.
   */
  A.resolveRoute = async (state, flightNo, operatingIata, date, opts) => {
    const entry = await A.lookup(state, flightNo, date, opts);
    if (entry.status === 'ok' || !operatingIata) return { entry, route: A.routeFromCache(entry), via: undefined };
    const op = await A.lookup(state, operatingIata, date, opts);
    if (op.status === 'ok') return { entry: op, route: { ...A.routeFromCache(op), via: operatingIata }, via: operatingIata };
    return { entry: op.status === 'error' ? op : entry, route: null, via: undefined };
  };
})();
