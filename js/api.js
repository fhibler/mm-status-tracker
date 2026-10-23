/* Route lookup: AeroDataBox (by date, with the user's own key, called directly, via API.Market or via RapidAPI) and adsbdb.com (free, no key).
 * Every answer is cached in state.apiCache keyed by IATA flight number and flight date ("LH1966 2026-11-17"), and
 * the cache is part of the exported .json – so an imported file re-queries only errors and provisional answers
 * (below). The AeroDataBox key and how it is called (state.settings.aerodataboxKey, aerodataboxVia: A.ADB_VIA) are
 * settings, saved in the browser and in the .json.
 * AeroDataBox knows the route on the flight date. adsbdb ignores the date: it knows one route per number, the one
 * flown at the moment. So an adsbdb answer for a flight in another IATA schedule season (E.iataSeason) is
 * provisional, and is asked again once that season has started, or when AeroDataBox can be asked. */
(function () {
  const A = (MM.api = {});
  const BASE = 'https://api.adsbdb.com/v0/callsign/';
  /**
   * Ways to call AeroDataBox (state.settings.aerodataboxVia), each with a key from where it was bought: directly (its own
   * gateway, see doc.aerodatabox.com/direct.html), via API.Market or via RapidAPI. All answer the same paths in the same
   * shape; only the host and the key header differ.
   */
  A.ADB_VIA = {
    direct: { label: 'Directly (AeroDataBox)', keyFrom: 'AeroDataBox', base: 'https://api.aerodatabox.com',
      headers: (key) => ({ 'x-api-key': key }) },
    apimarket: { label: 'Via API.Market', keyFrom: 'API.Market', base: 'https://prod.api.market/api/v1/aedbx/aerodatabox',
      headers: (key) => ({ 'x-api-market-key': key }) },
    rapidapi: { label: 'Via RapidAPI', keyFrom: 'RapidAPI', base: 'https://aerodatabox.p.rapidapi.com',
      headers: (key) => ({ 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' }) },
  };
  /** The way to call AeroDataBox of a setting: A.ADB_VIA's 'rapidapi' (keys saved before there was a choice) when unknown. */
  A.adbVia = (v) => Object.keys(A.ADB_VIA).includes(v) ? v : 'rapidapi';
  const E = MM.engine;

  /** Cache key of a flight number on an ISO date. */
  A.cacheKey = (flightNo, date) => `${flightNo.toUpperCase()} ${date}`;
  /** A valid cache key, for S.normalize: entries saved before lookups had a date are dropped. */
  A.isCacheKey = (k) => /^[A-Z0-9]{2,3}\d{1,4}[A-Z]? \d{4}-\d{2}-\d{2}$/.test(k);
  /** The cached lookup of a flight number on a date, or undefined. */
  A.cached = (state, flightNo, date) => state.apiCache[A.cacheKey(flightNo, date)];

  /** adsbdb airport -> the app's airport shape. */
  const mapAirport = (a) => a && { iata: a.iata_code, name: a.name, city: a.municipality, country: a.country_iso_name, lat: a.latitude, lon: a.longitude };

  /**
   * Routes of a cache entry: AeroDataBox can list several for a number on a date (a flight with stops, or two flights
   * with one number; response.legs), adsbdb one (response.flightroute, which is also the first of the legs).
   */
  A.legs = (entry) => {
    const r = entry && entry.status === 'ok' && entry.response;
    return !r || !r.flightroute ? [] : Array.isArray(r.legs) && r.legs.length ? r.legs : [r.flightroute];
  };
  /** Index of the leg of a cache entry with the airports of `route` (a flight's route), else 0. */
  A.legIndex = (entry, route) => Math.max(0, !route || !route.origin || !route.destination ? 0
    : A.legs(entry).findIndex(l => l.origin && l.destination && l.origin.iata_code === route.origin.iata && l.destination.iata_code === route.destination.iata));

  /** Route of leg `leg` of a cache entry (A.legs), or null. */
  A.routeFromCache = (entry, leg = 0) => {
    const fr = A.legs(entry)[leg];
    if (!fr) return null;
    return { origin: mapAirport(fr.origin), destination: mapAirport(fr.destination), airlineName: fr.airline && fr.airline.name,
      source: 'api', provider: entry.provider || 'adsbdb' };
  };

  /**
   * IATA season whose route a lookup (cache entry or f.routeLookup) gave: an AeroDataBox answer is for the date it
   * was asked for, an adsbdb answer is the route flown at lookup time (fetchedAt).
   */
  A.lookupSeason = (lk) => E.iataSeason(lk.provider === 'aerodatabox' ? lk.date : lk.fetchedAt);
  /** Whether a lookup gave the route of another IATA season than the flight's: it may differ on the flight date. */
  A.otherSeason = (lk, date) => !!(lk && lk.fetchedAt && date && A.lookupSeason(lk) !== E.iataSeason(date));
  /**
   * A provisional answer worth asking again: looked up in another season, and either the flight's season has started
   * or AeroDataBox can be asked (a key is set, and AeroDataBox has not answered "no such flight" for this date yet).
   */
  A.isProvisional = (lk, date, today = E.todayISO(), key = '') => A.otherSeason(lk, date)
    && (E.iataSeason(today) === E.iataSeason(date) || (!!key && !lk.adbTried));

  /**
   * What a flight remembers about the lookup of `flightNo` (f.routeLookup); operating: the operating flight asked
   * first (A.resolveRoute), via: set to it when it gave the route.
   */
  A.lookupInfo = (entry, flightNo, via, operating) => ({ status: entry.status, source: entry.fromCache ? 'cache' : 'api', flightNo, operating, via, error: entry.error,
    date: entry.date, fetchedAt: entry.fetchedAt, provider: entry.provider, adbTried: entry.adbTried, adbNote: entry.adbNote, adbError: entry.adbError });

  /** Airport by IATA code: from a cached route lookup, else from the bundled airport table (MM.airport). */
  A.airport = (state, iata) => {
    for (const c of Object.values(state.apiCache)) {
      for (const fr of A.legs(c)) {
        const a = [fr.origin, fr.destination].find(x => x && x.iata_code === iata);
        if (a) return mapAirport(a);
      }
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

  /**
   * AeroDataBox time ("2026-11-17 06:15Z", "2026-11-17 07:15+01:00", seconds optional) -> ISO without seconds
   * ("2026-11-17T06:15Z", "2026-11-17T07:15+01:00"), or null.
   */
  A.isoTime = (t) => {
    const m = typeof t === 'string' && t.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/);
    return m ? `${m[1]}T${m[2]}${m[3] === 'Z' ? 'Z' : m[3].replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2')}` : null;
  };
  /** { utc, local } of an AeroDataBox time object (or of the older scheduledTimeUtc / scheduledTimeLocal fields), or null. */
  const adbTime = (o, utc, local) => {
    const t = { utc: A.isoTime(o && o.utc || utc), local: A.isoTime(o && o.local || local) };
    return t.utc && t.local ? t : null;
  };
  /** Departure or arrival of an AeroDataBox flight: scheduled and revised (estimated or actual) time, terminal. */
  const adbMovement = (m) => {
    const out = { scheduled: adbTime(m.scheduledTime, m.scheduledTimeUtc, m.scheduledTimeLocal) };
    const rev = adbTime(m.revisedTime || m.actualTime || m.runwayTime, m.actualTimeUtc, m.actualTimeLocal);
    if (rev) out.revised = rev;
    if (m.terminal) out.terminal = String(m.terminal);
    return out;
  };

  /** Minimum time between AeroDataBox requests in ms: the free plan allows 1 per second. */
  A.adbGap = 1100;
  let adbLast = 0;

  /**
   * Flight `no` departing on `date` from AeroDataBox, called the way the settings say (A.ADB_VIA): { response }
   * (adsbdb-shaped), or { note } saying why there is no route (204: no such flight; 400: e.g. a date outside the plan's
   * range). Throws for other failures (wrong key 401/403, quota 429, network).
   */
  const askAeroDataBox = async (no, date, settings) => {
    const via = A.ADB_VIA[A.adbVia(settings.aerodataboxVia)];
    const wait = adbLast + A.adbGap - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    adbLast = Date.now();
    const res = await fetch(`${via.base}/flights/number/${encodeURIComponent(no)}/${date}?dateLocalRole=Departure`,
      { headers: { Accept: 'application/json', ...via.headers(settings.aerodataboxKey) } });
    if (res.status === 204 || res.status === 404) return { note: 'no such flight on that date' };
    if (res.status === 400) {
      const body = await res.json().catch(() => null);
      return { note: `date not available${body && body.message ? `: ${body.message}` : ''}` };
    }
    if (!res.ok) {
      const why = res.status === 401 || res.status === 403 ? ' – check the key' : res.status === 429 ? ' – quota or rate limit' : '';
      throw new Error(`HTTP ${res.status}${why}`);
    }
    const list = await res.json().catch(() => null);
    const ok = (m) => m && m.airport && m.airport.iata;
    const seen = new Set();
    const legs = (Array.isArray(list) ? list : []).filter(x => ok(x.departure) && ok(x.arrival)).map((f) => {
      const ac = f.aircraft || {};
      return { callsign_iata: no, airline: f.airline ? { name: f.airline.name } : null,
        origin: adbAirport(f.departure.airport), destination: adbAirport(f.arrival.airport),
        schedule: { departure: adbMovement(f.departure), arrival: adbMovement(f.arrival), aircraft: ac.model || null, reg: ac.reg || null } };
    }).filter((l) => {   // the same leg listed twice (e.g. once per data source) is one route
      const k = `${l.origin.iata_code} ${l.destination.iata_code} ${l.schedule.departure.scheduled ? l.schedule.departure.scheduled.utc : ''}`;
      return !seen.has(k) && seen.add(k);
    });
    if (!legs.length) return { note: 'no route in its answer' };
    return { response: legs.length > 1 ? { flightroute: legs[0], legs } : { flightroute: legs[0] } };
  };

  /**
   * Flight times and aircraft of leg `leg` of a cache entry (A.legs), as a flight keeps them (f.times; see
   * E.flightTimes): for the flight number `flightNo` on `date`, `via` the operating flight that gave them. null when the
   * entry has none (adsbdb knows no times).
   */
  A.timesFromCache = (entry, flightNo, date, via, leg = 0) => {
    const fr = A.legs(entry)[leg], sc = fr && fr.schedule;
    if (!sc || !sc.departure || !sc.departure.scheduled) return null;
    return { flightNo, date, via, provider: entry.provider, fetchedAt: entry.fetchedAt,
      dep: sc.departure, arr: sc.arrival, aircraft: sc.aircraft, reg: sc.reg };
  };
  /**
   * Whether AeroDataBox could add the times to a cache entry: a key is set, the entry is not an AeroDataBox answer that
   * already asked for them (answers saved before times were looked up did not), and AeroDataBox has not answered
   * "no such flight" for it yet.
   */
  A.wantsTimes = (entry, key) => {
    const fr = entry.response && entry.response.flightroute;
    return !!key && !entry.adbTried && !(entry.provider === 'aerodatabox' && fr && 'schedule' in fr);
  };

  /**
   * Returns the cache entry for a flight number on an ISO date. Queries only when no cached answer exists, the
   * cached one is provisional (A.isProvisional), or `force` is set. A cached route without times
   * asks AeroDataBox for them (A.wantsTimes), and keeps its route when AeroDataBox gives none. With an AeroDataBox key (settings), asks
   * AeroDataBox first (provider 'aerodatabox'); when it knows no such flight (adbTried, adbNote says why) or fails
   * (adbError), asks adsbdb. Network and server errors of adsbdb (anything but 200 / 404, e.g. 429 rate limit) are cached as 'error',
   * which is not final: the next lookup asks again. A forced lookup that fails keeps the earlier answer in the cache.
   * `now` (the clock) is for tests.
   */
  A.lookup = async (state, iataFlightNo, date, { force = false, now = new Date() } = {}) => {
    const no = iataFlightNo.toUpperCase(), key = state.settings.aerodataboxKey, ck = A.cacheKey(no, date);
    const cached = state.apiCache[ck];
    if (cached && cached.status !== 'error' && !force && !A.isProvisional(cached, date, E.todayISO(now), key)) {
      if (!(cached.status === 'ok' && A.wantsTimes(cached, key))) return { ...cached, fromCache: true };
      // a route without times: only AeroDataBox can add them, and an answer without them keeps the route
      try {
        const { response, note } = await askAeroDataBox(no, date, state.settings);
        if (response) return { ...(state.apiCache[ck] = { date, fetchedAt: now.toISOString(), provider: 'aerodatabox', status: 'ok', response }), fromCache: false };
        Object.assign(cached, { adbTried: true, adbNote: note });   // not asked again
      } catch { /* e.g. the quota: asked again next time */ }
      return { ...cached, fromCache: true };
    }
    const entry = { date, fetchedAt: now.toISOString() };
    if (key) {
      try {
        const { response, note } = await askAeroDataBox(no, date, state.settings);
        if (response) Object.assign(entry, { provider: 'aerodatabox', status: 'ok', response });
        else Object.assign(entry, { adbTried: true, adbNote: note });
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

  /** Minimum time between two forced refreshes of the times of one flight number and date (A.refreshTimes), in ms. */
  A.refreshGap = 5 * 60 * 1000;
  /** When the times of a cache entry may be refreshed again (ms since the epoch): A.refreshGap after its last request. */
  A.refreshAllowedAt = (entry) => {
    const last = Date.parse(entry && (entry.refreshedAt || entry.fetchedAt));
    return isNaN(last) ? 0 : last + A.refreshGap;
  };
  /**
   * Asks AeroDataBox again for the times (e.g. a delay) of flight `no` on `date`, at most once per A.refreshGap.
   * Only AeroDataBox is asked, since adsbdb knows no times; when it gives no answer, the cached route stays.
   * Returns { entry, note } (note says why nothing changed), or throws when AeroDataBox fails.
   */
  A.refreshTimes = async (state, iataFlightNo, date, { now = new Date() } = {}) => {
    const no = iataFlightNo.toUpperCase(), key = state.settings.aerodataboxKey, ck = A.cacheKey(no, date);
    const cached = state.apiCache[ck];
    if (!key) return { entry: cached, note: 'no AeroDataBox key' };
    if (now.getTime() < A.refreshAllowedAt(cached)) return { entry: cached, note: 'refreshed less than 5 minutes ago' };
    if (cached) cached.refreshedAt = now.toISOString();   // failed requests count too
    const { response, note } = await askAeroDataBox(no, date, state.settings);
    if (!response) return { entry: cached, note };
    const entry = state.apiCache[ck] = { date, fetchedAt: now.toISOString(), provider: 'aerodatabox', status: 'ok', response };
    return { entry, note: '' };
  };

  /**
   * Whether A.resolveRoute (not forced) would ask an API for the times of a flight on `date`: an AeroDataBox key is set
   * and the number it ends with has no final answer in the cache yet (or one that could still get times).
   */
  A.timesPending = (state, flightNo, operatingIata, date, today = E.todayISO()) => {
    const key = state.settings.aerodataboxKey;
    if (!key) return false;
    const asks = (no) => {
      const c = A.cached(state, no, date);
      return !c || c.status === 'error' || A.isProvisional(c, date, today, key) || (c.status === 'ok' && A.wantsTimes(c, key));
    };
    if (!operatingIata) return asks(flightNo);
    if (asks(operatingIata)) return true;
    const op = A.cached(state, operatingIata, date);
    return op.status !== 'ok' && asks(flightNo);   // the flight number is asked only when the operating flight gives no route
  };

  /**
   * Route of a flight number on a date. A codeshare number is often unknown to the APIs, so with an operating flight
   * (`operatingIata`) that is asked first, and the flight number only when it gives no route.
   * Returns { entry, route, via, resolved, leg }: resolved is the number that gave the route (or null); route carries
   * `via` when it came from the operating flight. With several routes for the number (A.legs), `opts.route` (the
   * flight's current route) picks the leg with its airports, else the first; leg is its index. entry is the lookup to remember (see A.lookupInfo): the one that gave the
   * route, else one that failed (an error is not final, so the flight is looked up again later), else the flight number's.
   */
  A.resolveRoute = async (state, flightNo, operatingIata, date, opts) => {
    if (operatingIata) {
      const op = await A.lookup(state, operatingIata, date, opts);
      if (op.status === 'ok') {
        const leg = A.legIndex(op, opts && opts.route);
        return { entry: op, route: { ...A.routeFromCache(op, leg), via: operatingIata }, via: operatingIata, resolved: operatingIata, leg };
      }
      const own = await A.lookup(state, flightNo, date, opts);
      const leg = A.legIndex(own, opts && opts.route);
      if (own.status === 'ok') return { entry: own, route: A.routeFromCache(own, leg), via: undefined, resolved: flightNo, leg };
      return { entry: op.status === 'error' ? op : own, route: null, via: undefined, resolved: null, leg: 0 };
    }
    const entry = await A.lookup(state, flightNo, date, opts);
    const leg = A.legIndex(entry, opts && opts.route);
    return { entry, route: A.routeFromCache(entry, leg), via: undefined, resolved: entry.status === 'ok' ? flightNo : null, leg };
  };
})();
