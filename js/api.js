/* Route lookup via adsbdb.com (free, no key, CORS enabled).
 * Every answer is cached in state.apiCache keyed by IATA flight number, and the
 * cache is part of the exported .json – so an imported file never re-queries. */
(function () {
  const A = (MM.api = {});
  const BASE = 'https://api.adsbdb.com/v0/callsign/';

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

  /**
   * Returns the cache entry for a flight number. Queries the API only when no
   * cached answer exists (or `force` is set). Network errors are not cached as final.
   */
  A.lookup = async (state, iataFlightNo, { force = false } = {}) => {
    const key = iataFlightNo.toUpperCase();
    const cached = state.apiCache[key];
    if (cached && cached.queried && cached.status !== 'error' && !force) return { ...cached, fromCache: true };
    const entry = { queried: true, source: 'adsbdb.com', fetchedAt: new Date().toISOString() };
    try {
      const res = await fetch(BASE + encodeURIComponent(key), { headers: { Accept: 'application/json' } });
      const json = await res.json().catch(() => null);
      if (json && json.response && json.response.flightroute) {
        entry.status = 'ok';
        entry.response = json.response;
      } else {
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
