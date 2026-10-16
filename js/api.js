/* Route lookup via adsbdb.com (free, no key, CORS enabled).
 * Every answer is cached in state.apiCache keyed by IATA flight number, and the
 * cache is part of the exported .json – so an imported file never re-queries. */
(function () {
  const A = (MM.api = {});
  const BASE = 'https://api.adsbdb.com/v0/callsign/';

  /** adsbdb airport -> the app's airport shape. */
  const mapAirport = (a) => a && {
    iata: a.iata_code, icao: a.icao_code, name: a.name, city: a.municipality,
    country: a.country_iso_name, countryName: a.country_name, lat: a.latitude, lon: a.longitude,
  };

  A.routeFromCache = (entry) => {
    if (!entry || entry.status !== 'ok') return null;
    const fr = entry.response && entry.response.flightroute;
    if (!fr) return null;
    return {
      origin: mapAirport(fr.origin), destination: mapAirport(fr.destination),
      airlineName: fr.airline && fr.airline.name, source: 'api', fetchedAt: entry.fetchedAt,
    };
  };

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
  const callsigns = (key) => {
    const p = MM.engine.parseFlightNo(key);
    const out = [key];
    if (p && p.airline && p.airline.icao) out.push(p.airline.icao + p.number);
    return out;
  };

  /**
   * Returns the cache entry for a flight number. Queries the API only when no
   * cached answer exists (or `force` is set). Network and server errors (anything but 200 / 404,
   * e.g. 429 rate limit) are cached as 'error', which is not final: the next lookup asks again.
   */
  A.lookup = async (state, iataFlightNo, { force = false } = {}) => {
    const key = iataFlightNo.toUpperCase();
    const cached = state.apiCache[key];
    if (cached && cached.status !== 'error' && !force) return { ...cached, fromCache: true };
    const entry = { queried: true, source: 'adsbdb.com', fetchedAt: new Date().toISOString(), tried: [] };
    try {
      for (const cs of callsigns(key)) {
        entry.tried.push(cs);
        const res = await fetch(BASE + encodeURIComponent(cs), { headers: { Accept: 'application/json' } });
        if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
        const json = await res.json().catch(() => null);
        if (json && json.response && json.response.flightroute) {
          entry.status = 'ok';
          entry.queriedAs = cs;
          entry.response = json.response;
          break;
        }
        entry.status = 'notfound';
        entry.response = json ? json.response : null;
      }
    } catch (err) {
      entry.status = 'error';
      entry.error = String(err && err.message || err);
    }
    state.apiCache[key] = entry;
    return { ...entry, fromCache: false };
  };
})();
