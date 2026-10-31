/* Static reference data and default rules. Only the rules (MM.DEFAULT_RULES) can be changed in Settings. */
window.MM = window.MM || {};

MM.CLASSES = ['Economy', 'Premium Economy', 'Business', 'First'];
/* Trains offer Economy (2nd class) and Business (1st class) only. */
MM.RAIL_CLASSES = { 'Economy': 'Economy (2nd class)', 'Business': 'Business (1st class)' };
/* Lufthansa Group continental flights have Economy and Business only (no Premium Economy or First). */
MM.CONTINENTAL_CLASSES = ['Economy', 'Business'];
MM.CLASS_SHORT ={ 'Economy': 'Y', 'Premium Economy': 'W', 'Business': 'C', 'First': 'F' };

/* Earning groups (as listed on miles-and-more.com, "Points system" and "Partners", checked 2026-10-16):
 *  LHG   – Lufthansa Group airlines and co-issuing Miles & More partners: Points + Qualifying Points + HON Circle Points
 *  STAR  – Star Alliance airlines: Points only
 *  NONE  – no status credit (other airline partners only earn award miles) */
MM.AIRLINES = {
  // Points, Qualifying Points and HON Circle Points ("Airlines at a glance" on the Points system page)
  EN: { name: 'Air Dolomiti', icao: 'DLA', group: 'LHG' },
  OS: { name: 'Austrian Airlines', icao: 'AUA', group: 'LHG' },
  SN: { name: 'Brussels Airlines', icao: 'BEL', group: 'LHG' },
  OU: { name: 'Croatia Airlines', icao: 'CTN', group: 'LHG' },
  '4Y': { name: 'Discover Airlines', icao: 'OCN', group: 'LHG' },
  EW: { name: 'Eurowings', icao: 'EWG', group: 'LHG' },
  AZ: { name: 'ITA Airways', icao: 'ITY', group: 'LHG' },
  LO: { name: 'LOT Polish Airlines', icao: 'LOT', group: 'LHG' },
  LH: { name: 'Lufthansa', icao: 'DLH', group: 'LHG' },
  CL: { name: 'Lufthansa CityLine', icao: 'CLH', group: 'LHG' },
  VL: { name: 'Lufthansa City Airlines', icao: 'LHX', group: 'LHG' },
  LG: { name: 'Luxair', icao: 'LGL', group: 'LHG' },
  LX: { name: 'SWISS', icao: 'SWR', group: 'LHG' },
  // Edelweiss earns only on LX code-shares LX8000–8499 booked with SWISS under the LX number – enter those
  // as LX flights (optionally "Operated by" the WK number, see E.isEdelweissCodeshare). WK-numbered bookings earn nothing.
  WK: { name: 'Edelweiss Air', icao: 'EDW', group: 'NONE' },
  // Star Alliance: Points only
  A3: { name: 'Aegean Airlines', icao: 'AEE', group: 'STAR' },
  AC: { name: 'Air Canada', icao: 'ACA', group: 'STAR' },
  CA: { name: 'Air China', icao: 'CCA', group: 'STAR' },
  AI: { name: 'Air India', icao: 'AIC', group: 'STAR' },
  NZ: { name: 'Air New Zealand', icao: 'ANZ', group: 'STAR' },
  NH: { name: 'ANA', icao: 'ANA', group: 'STAR' },
  OZ: { name: 'Asiana Airlines', icao: 'AAR', group: 'STAR' },
  AV: { name: 'Avianca', icao: 'AVA', group: 'STAR' },
  CM: { name: 'Copa Airlines', icao: 'CMP', group: 'STAR' },
  MS: { name: 'EgyptAir', icao: 'MSR', group: 'STAR' },
  ET: { name: 'Ethiopian Airlines', icao: 'ETH', group: 'STAR' },
  BR: { name: 'EVA Air', icao: 'EVA', group: 'STAR' },
  ZH: { name: 'Shenzhen Airlines', icao: 'CSZ', group: 'STAR' },
  SQ: { name: 'Singapore Airlines', icao: 'SIA', group: 'STAR' },
  SA: { name: 'South African Airways', icao: 'SAA', group: 'STAR' },
  TP: { name: 'TAP Air Portugal', icao: 'TAP', group: 'STAR' },
  TG: { name: 'Thai Airways', icao: 'THA', group: 'STAR' },
  TK: { name: 'Turkish Airlines', icao: 'THY', group: 'STAR' },
  UA: { name: 'United Airlines', icao: 'UAL', group: 'STAR' },
  // Miles & More airline partners outside Star Alliance: award miles only, no status credit
  KC: { name: 'Air Astana', icao: 'KZR', group: 'NONE' },
  CX: { name: 'Cathay Pacific', icao: 'CPA', group: 'NONE' },
  LA: { name: 'LATAM Airlines', icao: 'LAN', group: 'NONE' },
  OA: { name: 'Olympic Air', icao: 'OAL', group: 'NONE' },
  // Other airlines
  JU: { name: 'Air Serbia', icao: 'ASL', group: 'NONE' },
  EK: { name: 'Emirates', icao: 'UAE', group: 'NONE' },
  QR: { name: 'Qatar Airways', icao: 'QTR', group: 'NONE' },
  BA: { name: 'British Airways', icao: 'BAW', group: 'NONE' },
  AF: { name: 'Air France', icao: 'AFR', group: 'NONE' },
  KL: { name: 'KLM', icao: 'KLM', group: 'NONE' },
  FR: { name: 'Ryanair', icao: 'RYR', group: 'NONE' },
  U2: { name: 'easyJet', icao: 'EZY', group: 'NONE' },
  DL: { name: 'Delta Air Lines', icao: 'DAL', group: 'NONE' },
  AA: { name: 'American Airlines', icao: 'AAL', group: 'NONE' },
};
MM.GROUP_LABEL = { LHG: 'Lufthansa Group', STAR: 'Star Alliance', NONE: 'No status credit' };

/* Zones (ISO country codes) for the haul rule, as defined by Miles & More ("What counts as a continental
 * or intercontinental flight?"): a flight within one zone – or within one country – is continental,
 * everything else is intercontinental. Europe includes Algeria, Egypt, Libya, Morocco, Tunisia and
 * Western Sahara; Israel, Jordan, Lebanon, Palestine and Syria belong to "Middle East and Asia",
 * Greenland to North America. Isle of Man, Jersey, Guernsey and Åland are added to Europe. */
MM.REGIONS = {
  EU: 'AL DZ AD AM AT AZ BY BE BA BG HR CY CZ DK EG EE FO FI FR GE DE GI GR HU IS IE IT LV LY LI LT LU ' +
      'MT MC MA NL MK NO PL PT XK MD ME RS RO RU SM SK SI ES SJ SE CH TN TR UA GB VA EH IM JE GG AX',
  NA: 'AI AG AW BS BB BZ BM BQ VG CA KY CR CU CW DM DO SV GL GD GP GT HT HN JM MQ MX MS AN NI PA PR ' +
      'KN LC MF SX BL PM VC TT TC US VI',
  SA: 'AQ AR BO BV BR CL CO EC FK GF GY PY PE GS SR UY VE',
  AF: 'AO BJ BW BF BI CM CV CF TD KM CG CD DJ GQ ER SZ ET TF GA GM GH GN GW CI KE LS LR MG MW ML MR MU ' +
      'YT MZ NA NE NG RE RW ST SN SC SL SO ZA SS SH SD TZ TG UG ZM ZW',
  AS: 'AF BH BD BT IO BN KH CN KP HK IN ID IQ IR IL JP JO KZ KW KG LA LB MO MY MV MN MM NP PS PK PH ' +
      'QA KR YE SA SG LK OM SY TW TJ TH TL TM AE UZ VN',
  OC: 'AS AU CX CC CK FJ PF GU HM KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV UM VU WF',
};
MM.REGION_OF = {};
for (const [region, list] of Object.entries(MM.REGIONS)) for (const c of list.split(' ')) MM.REGION_OF[c] = region;

/** Airport by IATA code from js/airports.js (parsed on first use), or null. */
MM.airport = (iata) => {
  if (!MM.AIRPORTS) {
    MM.AIRPORTS = {};
    for (const line of (MM.AIRPORT_DATA || '').split('\n')) {
      const [code, country, lat, lon, city] = line.split('|');
      if (code) MM.AIRPORTS[code] = { iata: code, country, lat: +lat, lon: +lon, city: city || '', name: city || code };
    }
  }
  const a = MM.AIRPORTS[String(iata || '').toUpperCase()];
  return a ? { ...a } : null;
};

/* How an upgrade was obtained (required for an upgraded flight). Only upgrades paid for before check-in (a fixed
 * price online, or a winning myOffer bid) are rebooked into the higher class and earn in it; upgrades paid at
 * check-in, the airport or on board, with miles or an eVoucher, and operational ones earn in the booked class.
 * '' = no upgrade (or an upgrade saved without a type by an older version, which also earns in the booked class).
 * 'voucher', saved by older versions, is read as 'miles' (S.normalize). */
MM.UPGRADE_TYPES = {
  'fixed-online':  { label: 'Fixed (Online)',   earnsUpgrade: true },
  'fixed-airport': { label: 'Fixed (Airport)',  earnsUpgrade: false },
  'bid':           { label: 'Bid (Online)',     earnsUpgrade: true },
  'miles':         { label: 'Miles / eVoucher', earnsUpgrade: false },
  'operational':   { label: 'Operational',      earnsUpgrade: false },
};

MM.CO2_LEVELS = ['none', 'small', 'medium', 'large', 'xlarge'];
MM.CO2_LABEL = { none: 'None', small: 'Small', medium: 'Medium', large: 'Large', xlarge: 'X-Large' };

/* Price of a CO₂ compensation package on lufthansa.com in EUR, fitted to the one-way flights (all four packages) seen in
   Oct 2026 and the costs paid in 2026; see docs/CO2-PRICE-MODEL.md. Packages are 5 / 20 / 50 / 80 % SAF, priced as
   Medium × (0.302 + 3.49 × SAF share). Medium for Business: `sqrt` = base + rate × √km, `km` = base + rate × km; other
   cabins as a factor on Business. The aircraft makes no difference. `good`: distances the samples cover; `rough`: extrapolated; outside, no
   estimate. The cabin priced is the one paid for (E.co2Class): an airport, miles / eVoucher or operational upgrade is priced as booked. */
MM.CO2_PRICE = {
  factor: { small: 0.476, medium: 1, large: 2.047, xlarge: 3.094 },
  business: {
    continental:      { form: 'sqrt', base: -0.108, rate: 0.4283,  good: [250, 1000],   rough: [0, 4000] },       // 8 routes, ≤ 0.7 %
    intercontinental: { form: 'km',   base: 0,      rate: 0.01748, good: [8000, 10000], rough: [3000, 13000] },   // 4 routes, ≤ 1.1 % (not MUC→SFO: 1.31 ×)
  },
  cabin: {
    continental:      { 'Economy': { f: 0.695 }, 'Business': { f: 1 } },
    intercontinental: { 'Business': { f: 1 } },
  },
};

/* Default rules (Miles & More status programme since 2024). Editable in Settings. */
MM.DEFAULT_RULES = {
  points: {
    // Points / Qualifying Points per segment on Lufthansa Group airlines (same value for P and QP).
    continental:      { 'Economy': 20, 'Premium Economy': 20, 'Business': 40,  'First': 40 },
    intercontinental: { 'Economy': 60, 'Premium Economy': 80, 'Business': 200, 'First': 400 },
  },
  honClasses: ['Business', 'First'],            // HON Circle Points only in these cabins (LHG only)
  thresholds: {
    FTL: { p: 650,  qp: 325 },
    SEN: { p: 2000, qp: 1000 },
    HON: { hon: 6000 },
  },
  // Rail (Austrian AIRail, Lufthansa Express Rail, SWISS Air Rail): max QP (FTL, SEN) / HON Circle Points (HON)
  // that rail segments may contribute towards each status.
  railCaps: { FTL: 160, SEN: 500, HON: 1000 },
  // Marriott Bonvoy (accounts linked): Points (no QP / HON) per qualifying stay, max per calendar year.
  marriott: { pointsPerStay: 40, minNights: 2, maxPointsPerYear: 120 },
  co2: {
    small:  { p: 5,  qp: 5,  hon: 5 },
    medium: { p: 20, qp: 20, hon: 20 },
    large:  { p: 50, qp: 50, hon: 20 },
    xlarge: { p: 80, qp: 80, hon: 20 },
  },
};

MM.STATUS_ORDER = ['NONE', 'FTL', 'SEN', 'HON'];
MM.STATUSES = MM.STATUS_ORDER.slice(1);   // the statuses that can be reached
MM.STATUS_LABEL = { NONE: 'Base', FTL: 'Frequent Traveller', SEN: 'Senator', HON: 'HON Circle' };

/* Extra Benefits (miles-and-more.com, "Extra Benefits for status customers", last updated there October 2023, checked
   2026-10-31). Each status has its own ladder, counted in the Qualifying Points (FTL, SEN) or HON Circle Points (HON) of
   the calendar year; a milestone is unlocked once it is reached while holding that status, and the ladders of lower
   statuses (incl. Lifetime status) aren't granted on top. */
MM.EXTRA_BENEFITS = {
  FTL: { unit: 'qp', milestones: [
    { at: 700, title: 'One upgrade eVoucher', detail: 'An eVoucher to upgrade one flight to a higher travel class.' },
    { at: 800, title: 'Mileage exchange', detail: 'Exchange up to 20,000 miles for up to 125 Points and 125 Qualifying Points to reach Senator.' },
  ] },
  SEN: { unit: 'qp', milestones: [
    { at: 2200, title: '€50 Worldshop gift card', detail: 'A EUR 50 gift card to redeem for an award from the Worldshop.' },
    { at: 2500, title: 'Two upgrade eVouchers', detail: 'Two eVouchers to upgrade to a higher travel class.' },
    { at: 3500, title: 'Frequent Traveller partner card', detail: 'Give Frequent Traveller status and its benefits to a friend or family member.' },
    { at: 4500, title: '15,000 miles', detail: 'A mileage credit to redeem for extras or a trip.' },
    { at: 5500, title: 'First Class Lounge voucher', detail: 'Lounge access for you or a travel companion on one of your next flights: First Class Lounge Frankfurt or Munich, HON Circle Lounge Vienna or First Lounge Zurich.' },
  ] },
  HON: { unit: 'hon', milestones: [
    { at: 7000, title: 'Two upgrade eVouchers', detail: 'Two eVouchers to upgrade to a higher travel class.' },
    { at: 8500, title: '30,000 miles', detail: 'A mileage credit to redeem for extras or a trip.' },
    { at: 10000, title: 'Two more upgrade eVouchers', detail: 'Two further eVouchers to upgrade to a higher travel class.' },
    { at: 11500, title: 'Frequent Traveller partner card + 35,000 miles', detail: 'Frequent Traveller status for a friend or family member, plus 35,000 miles as a starting credit.' },
    { at: 13000, title: 'Senator partner card + 50,000 miles', detail: 'Senator status for a friend or family member, plus 50,000 miles.' },
  ] },
};

MM.CURRENCIES = ['EUR', 'CHF', 'USD', 'GBP'];
/* Kinds of extra segments in the planner (see MM.engine.mixRowEarn). */
MM.MIX_KIND = { LHG: 'Lufthansa Group', STAR: 'Star Alliance', RAIL: 'Train' };
