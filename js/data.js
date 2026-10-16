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

/* "Continental" region for Miles & More purposes: Europe plus the Mediterranean rim.
 * A flight is continental when origin AND destination are inside this region. */
MM.CONTINENTAL_COUNTRIES = new Set((
  'AL AD AM AT AZ BY BE BA BG HR CY CZ DK EE FO FI FR GE DE GI GR GL HU IS IE IT XK LV LI LT LU ' +
  'MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH TR UA GB VA IM JE GG AX ' +
  'MA DZ TN LY EG IL LB JO PS SY'
).split(' '));

/* Small airport table, used only when a route is entered manually (no API response). */
MM.AIRPORTS = {};
(
  'FRA,DE,50.033,8.571;MUC,DE,48.354,11.786;BER,DE,52.366,13.503;HAM,DE,53.630,9.988;DUS,DE,51.289,6.767;' +
  'CGN,DE,50.866,7.143;STR,DE,48.690,9.222;NUE,DE,49.499,11.078;HAJ,DE,52.461,9.685;LEJ,DE,51.432,12.242;' +
  'BRE,DE,53.047,8.787;DRS,DE,51.133,13.767;ZRH,CH,47.465,8.549;GVA,CH,46.238,6.109;BSL,FR,47.590,7.529;' +
  'VIE,AT,48.110,16.570;GRZ,AT,46.991,15.440;SZG,AT,47.793,13.004;INN,AT,47.260,11.344;BRU,BE,50.901,4.484;' +
  'AMS,NL,52.309,4.764;LHR,GB,51.470,-0.454;LCY,GB,51.505,0.055;LGW,GB,51.148,-0.190;MAN,GB,53.354,-2.275;' +
  'EDI,GB,55.950,-3.373;DUB,IE,53.421,-6.270;CDG,FR,49.010,2.548;ORY,FR,48.723,2.379;NCE,FR,43.658,7.216;' +
  'LYS,FR,45.726,5.091;MRS,FR,43.436,5.215;TLS,FR,43.629,1.364;BCN,ES,41.297,2.078;MAD,ES,40.472,-3.561;' +
  'PMI,ES,39.552,2.739;AGP,ES,36.675,-4.499;VLC,ES,39.489,-0.482;LPA,ES,27.932,-15.387;TFS,ES,28.044,-16.573;' +
  'LIS,PT,38.774,-9.134;OPO,PT,41.248,-8.681;FNC,PT,32.698,-16.775;FCO,IT,41.800,12.239;MXP,IT,45.630,8.723;' +
  'LIN,IT,45.445,9.277;VCE,IT,45.505,12.352;NAP,IT,40.886,14.291;BLQ,IT,44.535,11.289;FLR,IT,43.810,11.205;' +
  'CTA,IT,37.467,15.066;PMO,IT,38.176,13.091;CPH,DK,55.618,12.656;ARN,SE,59.652,17.919;GOT,SE,57.663,12.280;' +
  'OSL,NO,60.194,11.100;BGO,NO,60.294,5.218;HEL,FI,60.317,24.963;KEF,IS,63.985,-22.606;WAW,PL,52.166,20.967;' +
  'KRK,PL,50.078,19.785;GDN,PL,54.378,18.466;PRG,CZ,50.101,14.260;BUD,HU,47.437,19.256;OTP,RO,44.571,26.085;' +
  'SOF,BG,42.697,23.411;ATH,GR,37.936,23.947;SKG,GR,40.520,22.971;HER,GR,35.339,25.180;IST,TR,41.275,28.752;' +
  'SAW,TR,40.898,29.309;AYT,TR,36.899,30.801;ESB,TR,40.128,32.995;LCA,CY,34.875,33.625;TLV,IL,32.011,34.887;' +
  'BEY,LB,33.821,35.488;AMM,JO,31.723,35.993;CAI,EG,30.122,31.406;HRG,EG,27.178,33.799;CMN,MA,33.367,-7.590;' +
  'RAK,MA,31.607,-8.036;TUN,TN,36.851,10.227;ALG,DZ,36.691,3.215;BEG,RS,44.818,20.309;ZAG,HR,45.743,16.069;' +
  'SPU,HR,43.539,16.298;DBV,HR,42.561,18.268;LJU,SI,46.224,14.458;RIX,LV,56.924,23.971;TLL,EE,59.413,24.833;' +
  'VNO,LT,54.634,25.286;KBP,UA,50.345,30.895;TBS,GE,41.669,44.955;EVN,AM,40.147,44.396;GYD,AZ,40.468,50.047;' +
  'MLA,MT,35.857,14.477;SVO,RU,55.973,37.415;JFK,US,40.640,-73.779;EWR,US,40.692,-74.169;BOS,US,42.364,-71.005;' +
  'IAD,US,38.944,-77.456;ORD,US,41.979,-87.905;ATL,US,33.637,-84.428;MIA,US,25.793,-80.291;DFW,US,32.897,-97.038;' +
  'IAH,US,29.984,-95.341;DEN,US,39.862,-104.673;LAX,US,33.942,-118.408;SFO,US,37.619,-122.375;SEA,US,47.450,-122.309;' +
  'LAS,US,36.084,-115.154;PHL,US,39.872,-75.241;DTW,US,42.212,-83.353;CLT,US,35.214,-80.943;MSP,US,44.882,-93.222;' +
  'YYZ,CA,43.677,-79.631;YUL,CA,45.471,-73.741;YVR,CA,49.194,-123.184;YYC,CA,51.131,-114.010;MEX,MX,19.436,-99.072;' +
  'CUN,MX,21.037,-86.877;GRU,BR,-23.432,-46.470;GIG,BR,-22.810,-43.251;EZE,AR,-34.822,-58.536;BOG,CO,4.702,-74.147;' +
  'PTY,PA,9.071,-79.383;SCL,CL,-33.393,-70.786;LIM,PE,-12.022,-77.114;DXB,AE,25.253,55.366;AUH,AE,24.433,54.651;' +
  'DOH,QA,25.273,51.608;RUH,SA,24.958,46.699;JED,SA,21.680,39.157;BAH,BH,26.271,50.634;KWI,KW,29.227,47.969;' +
  'MCT,OM,23.593,58.284;TLV,IL,32.011,34.887;DEL,IN,28.556,77.100;BOM,IN,19.089,72.868;BLR,IN,13.199,77.706;' +
  'MAA,IN,12.994,80.171;HYD,IN,17.231,78.430;BKK,TH,13.690,100.750;SIN,SG,1.364,103.991;KUL,MY,2.746,101.710;' +
  'HKG,HK,22.309,113.915;PEK,CN,40.080,116.585;PKX,CN,39.509,116.411;PVG,CN,31.143,121.805;CAN,CN,23.392,113.299;' +
  'SZX,CN,22.639,113.811;ICN,KR,37.469,126.451;NRT,JP,35.765,140.386;HND,JP,35.552,139.780;KIX,JP,34.427,135.244;' +
  'TPE,TW,25.078,121.233;MNL,PH,14.509,121.020;CGK,ID,-6.126,106.656;DPS,ID,-8.748,115.167;SYD,AU,-33.946,151.177;' +
  'MEL,AU,-37.673,144.843;AKL,NZ,-37.008,174.792;JNB,ZA,-26.139,28.246;CPT,ZA,-33.965,18.602;ADD,ET,8.978,38.799;' +
  'NBO,KE,-1.319,36.928;LOS,NG,6.577,3.321;ACC,GH,5.605,-0.167;MRU,MU,-20.430,57.683;SEZ,SC,-4.674,55.522;' +
  'MLE,MV,4.192,73.529;CMB,LK,7.181,79.884;ALA,KZ,43.352,77.040;TAS,UZ,41.258,69.281;PUJ,DO,18.567,-68.363;' +
  'HAV,CU,22.989,-82.409;MBJ,JM,18.504,-77.913;WDH,NA,-22.480,17.471;ZNZ,TZ,-6.222,39.225;JRO,TZ,-3.429,37.074'
).split(';').forEach(s => {
  const [iata, country, lat, lon] = s.split(',');
  MM.AIRPORTS[iata] = { iata, country, lat: +lat, lon: +lon, name: iata, city: '' };
});

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
