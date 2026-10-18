/* Route lookup: AeroDataBox (by date, with the user's own RapidAPI key) and adsbdb.com (free, no key).
 * Every answer is cached in state.apiCache keyed by IATA flight number and flight date ("LH1966 2026-11-17"), and
 * the cache is part of the exported .json – so an imported file never re-queries. The AeroDataBox key is not: it is
 * kept in this browser only (A.aerodataboxKey).
 * AeroDataBox knows the route on the flight date. adsbdb ignores the date: it knows one route per number, the one
 * flown at the moment. So an adsbdb answer for a flight in another IATA schedule season (E.iataSeason) is
 * provisional, and is asked again once that season has started, or when AeroDataBox can be asked. */
(function () {
  const A = (MM.api = {});
  const BASE = 'https://api.adsbdb.com/v0/callsign/';
  const ADB_HOST = 'aerodatabox.p.rapidapi.com';
  const KEY_STORE = 'mm-status-tracker:aerodatabox-key';   // per browser, never in the .json
  const E = MM.engine;

  /** The user's AeroDataBox key (RapidAPI), or ''. */
  A.aerodataboxKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } };
  /** Saves the key in this browser ('' removes it); false when storage is blocked. */
  A.setAerodataboxKey = (k) => {
    try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); return true; } catch { return false; }
  };

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
    return { origin: mapAirport(fr.origin), destination: mapAirport(fr.destination), airlineName: fr.airline && fr.airline.name,
      source: 'api', provider: entry.provider || 'adsbdb' };
  };

  /**
   * Whether an adsbdb lookup (cache entry or f.routeLookup, with fetchedAt and date) was made in another IATA season
   * than the flight's: its route is the one flown at lookup time and may not be the one on the flight date.
   * AeroDataBox answers are for the date itself.
   */
  A.otherSeason = (lk, date) => !!(lk && lk.provider !== 'aerodatabox' && lk.fetchedAt && date && E.iataSeason(lk.fetchedAt) !== E.iataSeason(date));
  /**
   * A provisional answer worth asking again: looked up in another season, and either the flight's season has started
   * or AeroDataBox can be asked (a key is set, and AeroDataBox has not answered "no such flight" for this date yet).
   */
  A.isProvisional = (lk, date, today = E.todayISO(), key = A.aerodataboxKey()) => A.otherSeason(lk, date)
    && (E.iataSeason(today) === E.iataSeason(date) || (!!key && !lk.adbTried));

  /** What a flight remembers about the lookup of `flightNo` (f.routeLookup); via: the operating flight that gave the route. */
  A.lookupInfo = (entry, flightNo, via) => ({ status: entry.status, source: entry.fromCache ? 'cache' : 'api', flightNo, via, error: entry.error,
    date: entry.date, fetchedAt: entry.fetchedAt, provider: entry.provider, adbTried: entry.adbTried, adbError: entry.adbError });

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

  /** AeroDataBox airport -> the adsbdb shape, so cached answers of both look alike. */
  const adbAirport = (a) => ({ iata_code: a.iata, name: a.name, municipality: a.municipalityName, country_iso_name: a.countryCode,
    latitude: a.location && a.location.lat, longitude: a.location && a.location.lon });

  /** Minimum time between AeroDataBox requests in ms: the free plan allows 1 per second. */
  A.adbGap = 1100;
  let adbLast = 0;

  /**
   * Flight `no` departing on `date` from AeroDataBox: an adsbdb-shaped response, or null when it knows no such flight
   * (204, or 400 for a date outside the plan's range). Throws for other failures (wrong key 401/403, quota 429, network).
   */
  const askAeroDataBox = async (no, date, key) => {
    const wait = adbLast + A.adbGap - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    adbLast = Date.now();
    const res = await fetch(`https://${ADB_HOST}/flights/number/${encodeURIComponent(no)}/${date}?dateLocalRole=Departure`,
      { headers: { Accept: 'application/json', 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': ADB_HOST } });
    if (res.status === 204 || res.status === 404 || res.status === 400) return null;
    if (!res.ok) {
      const why = res.status === 401 || res.status === 403 ? ' – check the key' : res.status === 429 ? ' – quota or rate limit' : '';
      throw new Error(`HTTP ${res.status}${why}`);
    }
    const list = await res.json().catch(() => null);
    const ok = (m) => m && m.airport && m.airport.iata;
    const f = Array.isArray(list) && list.find(x => ok(x.departure) && ok(x.arrival));
    if (!f) return null;
    return { flightroute: { callsign_iata: no, airline: f.airline ? { name: f.airline.name } : null,
      origin: adbAirport(f.departure.airport), destination: adbAirport(f.arrival.airport) } };
  };

  /**
   * Returns the cache entry for a flight number on a date (ISO; today when empty). Queries only when no cached answer
   * exists, the cached one is provisional (A.isProvisional), or `force` is set. With an AeroDataBox key, asks
   * AeroDataBox first (provider 'aerodatabox'); when it knows no such flight (adbTried) or fails (adbError), asks
   * adsbdb. Network and server errors of adsbdb (anything but 200 / 404, e.g. 429 rate limit) are cached as 'error',
   * which is not final: the next lookup asks again. A forced lookup that fails keeps the earlier answer in the cache.
   * `now` (the clock) and `key` are for tests.
   */
  A.lookup = async (state, iataFlightNo, date, { force = false, now = new Date(), key = A.aerodataboxKey() } = {}) => {
    const no = iataFlightNo.toUpperCase(), today = E.todayISO(now), day = date || today, ck = A.cacheKey(no, day);
    const cached = state.apiCache[ck];
    if (cached && cached.status !== 'error' && !force && !A.isProvisional(cached, day, today, key)) return { ...cached, fromCache: true };
    const entry = { date: day, fetchedAt: now.toISOString() };
    if (key) {
      try {
        const response = await askAeroDataBox(no, day, key);
        if (response) Object.assign(entry, { provider: 'aerodatabox', status: 'ok', response });
        else entry.adbTried = true;
      } catch (err) {
        entry.adbError = String(err && err.message || err);
      }
    }
    if (!entry.status) {
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
    }
    if (entry.status !== 'error' || !cached || cached.status === 'error') state.apiCache[ck] = entry;
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
