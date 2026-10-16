/* Static reference data and default rules. Everything here can be overridden in Settings. */
window.MM = window.MM || {};

MM.CLASSES = ['Economy', 'Premium Economy', 'Business', 'First'];
MM.CLASS_SHORT = { 'Economy': 'Y', 'Premium Economy': 'W', 'Business': 'C', 'First': 'F' };

/* Earning groups:
 *  LHG   – Lufthansa Group airlines (and co-issuing partners): Points + Qualifying Points + HON Circle Points
 *  STAR  – Star Alliance partners: Points only
 *  NONE  – no status credit */
MM.AIRLINES = {
  LH: { name: 'Lufthansa', icao: 'DLH', group: 'LHG' },
  LX: { name: 'SWISS', icao: 'SWR', group: 'LHG' },
  OS: { name: 'Austrian Airlines', icao: 'AUA', group: 'LHG' },
  SN: { name: 'Brussels Airlines', icao: 'BEL', group: 'LHG' },
  EW: { name: 'Eurowings', icao: 'EWG', group: 'LHG' },
  EN: { name: 'Air Dolomiti', icao: 'DLA', group: 'LHG' },
  '4Y': { name: 'Discover Airlines', icao: 'OCN', group: 'LHG' },
  WK: { name: 'Edelweiss Air', icao: 'EDW', group: 'LHG' },
  CL: { name: 'Lufthansa CityLine', icao: 'CLH', group: 'LHG' },
  VL: { name: 'Lufthansa City Airlines', icao: 'LHX', group: 'LHG' },
  AZ: { name: 'ITA Airways', icao: 'ITY', group: 'LHG' },
  LO: { name: 'LOT Polish Airlines', icao: 'LOT', group: 'LHG' },
  A3: { name: 'Aegean Airlines', icao: 'AEE', group: 'STAR' },
  AC: { name: 'Air Canada', icao: 'ACA', group: 'STAR' },
  CA: { name: 'Air China', icao: 'CCA', group: 'STAR' },
  AI: { name: 'Air India', icao: 'AIC', group: 'STAR' },
  NZ: { name: 'Air New Zealand', icao: 'ANZ', group: 'STAR' },
  NH: { name: 'ANA', icao: 'ANA', group: 'STAR' },
  OZ: { name: 'Asiana Airlines', icao: 'AAR', group: 'STAR' },
  AV: { name: 'Avianca', icao: 'AVA', group: 'STAR' },
  CM: { name: 'Copa Airlines', icao: 'CMP', group: 'STAR' },
  OU: { name: 'Croatia Airlines', icao: 'CTN', group: 'STAR' },
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

/* Regions (ISO country codes) for the haul rule: a flight within one region – or within one
 * country – is continental, everything else is intercontinental. "EU" is Europe plus the
 * Mediterranean rim, as Miles & More treats e.g. Frankfurt–Cairo or Frankfurt–Tel Aviv as continental. */
MM.REGIONS = {
  EU: 'AL AD AM AT AZ BY BE BA BG HR CY CZ DK EE FO FI FR GE DE GI GR GL HU IS IE IT XK LV LI LT LU ' +
      'MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH TR UA GB VA IM JE GG AX ' +
      'MA DZ TN LY EG IL LB JO PS SY',
  NA: 'US CA MX GT BZ SV HN NI CR PA CU JM HT DO PR BS BB TT AG DM GD KN LC VC AW CW SX BQ KY TC VG VI ' +
      'BM GP MQ BL MF AI MS PM',
  SA: 'CO VE GY SR GF EC PE BO BR PY UY AR CL FK',
  AF: 'MR ML NE TD SD SS ER DJ SO ET KE UG RW BI TZ MZ MW ZM ZW BW NA ZA LS SZ AO CD CG GA GQ CM CF ' +
      'NG BJ TG GH CI LR SL GN GW GM SN CV ST MG MU SC KM RE YT EH',
  AS: 'SA AE QA BH KW OM YE IQ IR AF PK IN LK MV BD NP BT MM TH LA KH VN MY SG ID BN PH TL CN HK MO ' +
      'TW KR KP JP MN KZ UZ TM KG TJ',
  OC: 'AU NZ PG FJ NC PF WS TO VU SB GU MP PW FM MH KI NR TV CK',
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

MM.CO2_LEVELS = ['none', 'small', 'medium', 'large', 'xlarge'];
MM.CO2_LABEL = { none: 'None', small: 'Small', medium: 'Medium', large: 'Large', xlarge: 'X-Large' };

/* Default rules (Miles & More status programme since 2024). Editable in Settings. */
MM.DEFAULT_RULES = {
  points: {
    // Points / Qualifying Points per segment on Lufthansa Group airlines (same value for P and QP).
    continental:      { 'Economy': 20, 'Premium Economy': 20, 'Business': 40,  'First': 40 },
    intercontinental: { 'Economy': 60, 'Premium Economy': 80, 'Business': 200, 'First': 300 },
  },
  honClasses: ['Business', 'First'],            // HON Circle Points only in these cabins (LHG only)
  thresholds: {
    FTL: { label: 'Frequent Traveller', p: 650,  qp: 325 },
    SEN: { label: 'Senator',            p: 2000, qp: 1000 },
    HON: { label: 'HON Circle',         hon: 6000 },
  },
  co2: {
    small:  { p: 5,  qp: 5,  hon: 5 },
    medium: { p: 20, qp: 20, hon: 20 },
    large:  { p: 50, qp: 50, hon: 20 },
    xlarge: { p: 80, qp: 80, hon: 20 },
  },
};

MM.STATUS_ORDER = ['NONE', 'FTL', 'SEN', 'HON'];
MM.STATUS_LABEL = { NONE: 'Base', FTL: 'Frequent Traveller', SEN: 'Senator', HON: 'HON Circle' };
