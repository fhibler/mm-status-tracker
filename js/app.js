/* UI: views, flight dialog, dashboard rendering. */
(function () {
  const E = MM.engine, S = MM.store, A = MM.api, C = MM.charts;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = C.esc;
  const num = (v) => Math.round(v).toLocaleString('en-US');
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  let state, loadError = '';
  try { state = S.load() || S.empty(); } catch (err) { state = S.empty(); loadError = err.message; }   // old data stays stored until the first change
  let year = new Date().getFullYear();
  let view = 'dashboard';
  let withPlanner = false;   // dashboard incl. the Planner's scenarios (per browser, not part of the .json)
  try { withPlanner = localStorage.getItem('mm-status-tracker:withPlanner') === '1'; } catch { /* ignore */ }

  const money = (v, compact) => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: state.settings.currency, maximumFractionDigits: compact ? 0 : 2, minimumFractionDigits: compact ? 0 : 2,
  }).format(v || 0);
  /** Price model estimate of booster `level` for flight f (E.co2PriceEstimate); only when amounts are in EUR, its currency. */
  const co2Est = (f, level) => (state.settings.currency === 'EUR' ? E.co2PriceEstimate(f, level) : null);
  const co2EstTxt = (est) => `${est.quality === 'rough' ? 'rough estimate' : 'estimate'} ${money(est.cost)} · ${num(est.km)} km ${esc(est.cabin)}`;
  /** Shows msg for ms milliseconds, or with ms 0 until closed (a result worth reading, e.g. of a run over many flights). */
  const toast = (msg, ms = 2600) => {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    if (!ms) {
      const x = document.createElement('button');
      Object.assign(x, { type: 'button', className: 'toast-close', textContent: '✕', title: 'Close' });
      x.addEventListener('click', () => (t.hidden = true));
      t.append(x);
    }
    clearTimeout(toast.h);
    if (ms) toast.h = setTimeout(() => (t.hidden = true), ms);
  };
  let saveFailed = false;
  const save = () => {
    const ok = S.persist(state);
    if (!ok && !saveFailed) toast('This browser can\'t store your data (storage full or blocked). Use Save .json to keep it.', 8000);
    saveFailed = !ok;
  };
  const badge = (s) => `<span class="badge ${s}">${esc(MM.STATUS_LABEL[s])}</span>`;
  /** "Senator → Frequent Traveller (not requalified)" for a soft-landing year, else ''. */
  const downgradeTxt = (h, when = '') => (h.downgraded ? `${esc(MM.STATUS_LABEL[h.prevHeld])} → ${esc(MM.STATUS_LABEL[h.held])}${when} (not requalified)` : '');
  /** A route with both airports (a stored route may lack one). */
  const hasRoute = (r) => !!(r && r.origin && r.destination);
  /** A looked-up route from another IATA season than the flight's (A.otherSeason): it may differ on the flight date. */
  const otherSeason = (f) => hasRoute(f.route) && f.route.source === 'api' && A.otherSeason(f.routeLookup, f.date);
  const routeTxt = (f) => (hasRoute(f.route) ? `${esc(f.route.origin.iata)}→${esc(f.route.destination.iata)}` : '<span class="pill warn">no route</span>');
  const isFlight = (f) => f.transport === 'flight';
  const HAUL_LABEL = { continental: 'Continental', intercontinental: 'Intercontinental' };
  /** Haul in a table cell: short, and a warning when it is unknown. */
  const haulTxt = (h) => (h === 'continental' ? 'Continental' : h === 'intercontinental' ? 'Intercont.' : '<span class="pill warn">unknown</span>');
  const PT_LABEL = { p: 'Points', qp: 'QP', hon: 'HON Points' };
  /** "50 Points, 20 QP" for the non-zero values of a gap (see E.gap). */
  const missingTxt = (g) => Object.entries(g).filter(([, v]) => v > 0).map(([k, v]) => `${num(v)} ${PT_LABEL[k]}`).join(', ');
  const UNIT_LABEL = { p: 'P', qp: 'QP', hon: 'HON' };
  /** "€6.97/QP": cost per point of kind k, or a dash when there are no such points. */
  const perUnit = (cost, pts, k) => (pts > 0 ? `<span class="nw">${money(cost / pts)}</span>/${UNIT_LABEL[k]}` : '–');
  /** Anything that "Load demo data" would replace. */
  const hasData = () => state.flights.length || state.adjustments.length || state.stays.length
    || JSON.stringify(state.settings) !== JSON.stringify(S.empty().settings)   // starting status, rules, number, currency
    || Object.values(state.plans).some(p => p.mix.length || Object.keys(p.co2).length || Object.keys(p.upgrade).length);
  /** Date for a new item in the selected year: today in the current year, else mid-January (future) or mid-June (past). */
  const newItemDate = () => {
    const today = E.todayISO(), y = +today.slice(0, 4);
    return y === year ? today : `${year}-${year > y ? '01' : '06'}-15`;
  };

  /* ================= navigation ================= */
  const setView = (v) => {
    view = v;
    $$('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    $$('.view').forEach(s => (s.hidden = s.id !== 'view-' + v));
    $('#planSwitch').hidden = v !== 'dashboard';
    render();
    try { localStorage.setItem('mm-status-tracker:view', v); } catch { /* ignore */ }
  };

  const renderYearSelect = () => {
    const ys = new Set(E.years(state));
    ys.add(new Date().getFullYear() + 1);
    ys.add(year);
    const ss = state.settings.startStatus;
    if (ss.status !== 'NONE' && ss.year) ys.add(ss.year);
    const sel = $('#yearSelect');
    sel.innerHTML = [...ys].sort((a, b) => b - a).map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('');
  };

  /* Wide tables: wrap each .table-wrap so a fade on the left/right edge shows when more columns are hidden. */
  const updateScrollHint = (wrap) => {
    const box = wrap.parentElement;
    box.classList.toggle('more-left', wrap.scrollLeft > 1);
    box.classList.toggle('more-right', wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 1);
  };
  const enhanceTables = () => {
    for (const wrap of $$('.view:not([hidden]) .table-wrap')) {
      if (!wrap.parentElement.classList.contains('table-scroll')) {
        const box = document.createElement('div');
        box.className = 'table-scroll';
        wrap.replaceWith(box);
        box.appendChild(wrap);
        wrap.addEventListener('scroll', () => updateScrollHint(wrap), { passive: true });
      }
      updateScrollHint(wrap);
    }
  };

  const render = () => {
    renderYearSelect();
    if (view === 'dashboard') renderDashboard();
    if (view === 'flights') renderFlights();
    if (view === 'planner') renderPlanner();
    if (view === 'settings') renderSettings();
    enhanceTables();
  };

  /* ================= dashboard ================= */
  const emptyState = () => `
    <div class="card empty">
      <h2>No flights yet</h2>
      <p>Add the segments you flew this year, then add planned flights to forecast when you reach your next status.</p>
      <div class="btns">
        <button class="btn primary" data-act="add">Add flight</button>
        <button class="btn" data-act="demo">Load demo data</button>
        <button class="btn" data-act="load">Load .json</button>
      </div>
    </div>`;

  /** Shrinks the font of single-line elements until their text fits the element's width (min 11px). */
  const fitText = (els) => {
    for (const el of els) {
      el.style.fontSize = '';
      const range = document.createRange();
      range.selectNodeContents(el);
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (size > 11 && range.getBoundingClientRect().width > el.clientWidth) el.style.fontSize = (size -= 1) + 'px';
    }
  };

  const renderDashboard = () => {
    const host = $('#view-dashboard');
    if (!state.flights.length && !state.adjustments.length && !state.stays.length) { host.innerHTML = emptyState(); return; }
    const rules = state.settings.rules;
    const st = withPlanner ? E.withPlans(state) : state;   // the Planner's scenarios count as planned items
    const hist = E.history(st, year);
    const sum = hist.find(h => h.year === year) || { ...E.yearSummary(st, year), carriedIn: 'NONE', held: 'NONE', prevHeld: 'NONE', downgraded: false };
    const prevYear = hist.find(h => h.year === year - 1);
    const heldMeta = sum.downgraded ? downgradeTxt(sum, ' from March')
      : E.rank(sum.carriedIn) < E.rank(sum.prevHeld) ? `Requalified ${sum.fromStatement ? 'as per your statement' : C.fmtDate(sum.reached.actual[sum.held])} after soft landing`
      : sum.carriedIn !== 'NONE' ? `${esc(MM.STATUS_LABEL[sum.carriedIn])} carried in from ${year - 1}${sum.carriedByPlan ? ' with your planned flights' : prevYear && prevYear.fromStatement ? ' (statement)' : ''}`
      : sum.fromStatement ? `${esc(MM.STATUS_LABEL[sum.statusActual])} earned ${year} as per your statement`
      : !sum.hasPrev ? `No data for ${year - 1} – <a href="#" data-act="goto-settings">set your starting status</a>`
      : `No status carried in from ${year - 1}`;
    const nFlown = sum.rows.filter(r => !r.planned).length;
    const nPlan = sum.rows.filter(r => r.planned && r.counts).length;
    const totalCost = sum.cost.all.total;
    const nextKey = MM.STATUSES.find(k => E.rank(sum.statusActual) < E.rank(k));
    const nextFc = nextKey && sum.reached.forecast[nextKey];

    const kpis = `
      <div class="kpis">
        <div class="card kpi"><div class="label">Status held in ${year}</div>
          <div class="value">${badge(sum.held)}</div>
          <div class="meta">${heldMeta}</div></div>
        <div class="card kpi"><div class="label">Earned in ${year} (flown)</div>
          <div class="value">${badge(sum.statusActual)}</div>
          <div class="meta">${sum.fromStatement ? `From your statement · valid until ${C.fmtDate(E.validUntil(year))}`
            : sum.statusActual !== 'NONE' ? `Valid ${C.fmtDate(sum.reached.actual[sum.statusActual])} – ${C.fmtDate(E.validUntil(year))}` : `${nFlown} segment${nFlown === 1 ? '' : 's'} flown`}</div></div>
        <div class="card kpi"><div class="label">${withPlanner ? 'Forecast with Planner' : 'Forecast'}</div>
          <div class="value">${badge(sum.statusForecast)}</div>
          <div class="meta">${nextKey ? (nextFc ? `${esc(MM.STATUS_LABEL[nextKey])} on ${C.fmtDate(nextFc)}` : `${esc(MM.STATUS_LABEL[nextKey])} not reached with ${nPlan} planned`) : 'Top tier reached'}</div></div>
        <div class="card kpi"><div class="label">Points ${year} · flown</div>
          <div class="kpi-trio">
            ${[['p', 'Points'], ['qp', 'QP'], ['hon', 'HON']].map(([k, label]) => `
              <div>
                <span class="k"><i class="c-${k}"></i>${label}</span>
                <b>${num(sum.actual[k])}</b>
                <span ${sum.forecast[k] === sum.actual[k] ? 'class="fc invisible" aria-hidden="true"' : 'class="fc"'} title="Forecast incl. planned flights">→ ${num(sum.forecast[k])}</span>
                <span class="cpu" title="Cost ${year} (flown + plan) per ${PT_LABEL[k].replace(/s$/, '')} incl. planned flights">${perUnit(totalCost, sum.forecast[k], k)}</span>
              </div>`).join('')}
          </div></div>
        <div class="card kpi"><div class="label">Cost ${year} (flown + plan)</div>
          <div class="value fit">${money(totalCost, true)}</div>
          <div class="meta"><span class="nw">${money(sum.cost.actual.total, true)} spent</span> · <span class="nw">${money(sum.cost.plan.total, true)} planned</span></div></div>
      </div>`;

    const warn = sum.unknown ? `<div class="card warn-card"><b>${sum.unknown} segment(s) without haul information</b> earn 0 points until a route or haul is set. <button class="btn small" data-act="goto-flights">Fix in Activity</button></div>` : '';

    host.innerHTML = `
      ${kpis}
      ${warn}
      <div class="cols">
        <div class="card">
          <div class="card-head"><h2>Status progress ${year}</h2><span class="sub"${withPlanner ? ' title="Planned flights and the Planner scenario; its extra segments count on 31 Dec"' : ''}>solid = flown · hatched = ${withPlanner ? 'forecast with Planner' : 'incl. planned flights'}</span>
            <div class="right"><button class="btn small" data-act="goto-planner">Plan in Planner →</button></div></div>
          <div class="progress-list" id="progList"></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Segments ${year}</h2></div>
          <div id="segBreakdown"></div>
        </div>
      </div>
      <div class="cols-3" id="cumCharts"></div>
      <div class="card">
        <div class="card-head"><h2>Costs per month ${year}</h2><span class="sub">faded = planned</span></div>
        <div class="chart" id="costChart"></div>
        ${costLegend}
      </div>
      <div class="card">
        <div class="card-head"><h2>History &amp; forecast by calendar year</h2><span class="sub">a status is valid from the day it is reached until the end of February of the year after next; without requalification it then drops one level</span></div>
        <div class="table-wrap" id="histTable"></div>
        ${hist.length > 1 ? `<div class="chart mt" id="yearCost"></div>${costLegend}` : ''}
      </div>`;

    fitText($$('.kpi-trio b, .kpi .value.fit', host));   // a large cost total shrinks to fit its card
    renderProgress(sum, rules);
    renderCumCharts(sum, rules);
    renderCostChart(sum);
    renderSegments(sum);
    renderHistory(hist);
  };

  const renderProgress = (sum, rules) => {
    const t = rules.thresholds;
    // the widths are set below, once the bars are in the page (the Content-Security-Policy blocks style attributes)
    const bar = (cur, fc, max, k) => `
      <div class="bar c-${k}">
        <div class="fc" data-width="${Math.min(100, (fc / max) * 100)}"></div>
        <div class="ac" data-width="${Math.min(100, (cur / max) * 100)}"></div>
      </div>`;
    const line = (key) => {
      // values that count towards this status (train QP / HON capped per status)
      const a = E.effective(sum.actual, key, rules), f = E.effective(sum.forecast, key, rules), th = t[key];
      const railCapped = (key === 'HON' ? sum.forecast.honRail : sum.forecast.qpRail) > rules.railCaps[key];
      const ra = sum.reached.actual[key], rf = sum.reached.forecast[key];
      const sub = ra ? `✓ Reached on ${C.fmtDate(ra)}`
        : sum.fromStatement && E.rank(sum.statusActual) >= E.rank(key) ? '✓ Earned as per your statement'
        : rf ? `Forecast: reached on ${C.fmtDate(rf)} with ${esc(sum.reached.forecastBy[key])}`
        : `Missing after plan: ${missingTxt(E.gap(sum.forecast, key, rules))}`;
      const bars = key === 'HON'
        ? `<div class="muted">HON Circle Points ${num(a.hon)} / ${num(th.hon)}</div>${bar(a.hon, f.hon, th.hon, 'hon')}`
        : `<div class="muted">Points ${num(a.p)} / ${num(th.p)}</div>${bar(a.p, f.p, th.p, 'p')}
           <div class="muted">Qualifying Points ${num(a.qp)} / ${num(th.qp)}</div>${bar(a.qp, f.qp, th.qp, 'qp')}`;
      return `<div class="prog-row">
        <div class="prog-top"><span class="name">${badge(key)}</span><span class="vals">${key === 'HON' ? `forecast ${num(f.hon)}` : `forecast ${num(f.p)} P · ${num(f.qp)} QP`}</span></div>
        ${bars}
        <div class="prog-sub">${sub}${railCapped ? ` · train ${key === 'HON' ? 'HON' : 'QP'} capped at ${num(rules.railCaps[key])}` : ''}</div>
      </div>`;
    };
    $('#progList').innerHTML = MM.STATUSES.map(line).join('');
    for (const b of $$('[data-width]', $('#progList'))) b.style.width = `${b.dataset.width}%`;
  };

  const renderCumCharts = (sum, rules) => {
    const host = $('#cumCharts');
    const t = rules.thresholds;
    const defs = [
      { key: 'p', label: 'Points', color: cssVar('--s-p'), thresholds: [{ v: t.FTL.p, label: 'FTL' }, { v: t.SEN.p, label: 'SEN' }] },
      { key: 'qp', label: 'Qualifying Points', color: cssVar('--s-qp'), thresholds: [{ v: t.FTL.qp, label: 'FTL' }, { v: t.SEN.qp, label: 'SEN' }] },
      { key: 'hon', label: 'HON Circle Points', color: cssVar('--s-hon'), thresholds: [{ v: t.HON.hon, label: 'HON' }] },
    ];
    host.innerHTML = defs.map(d => `
      <div class="card">
        <div class="card-head"><h2>${d.label}</h2><span class="sub">${num(sum.actual[d.key])} flown · ${num(sum.forecast[d.key])} forecast</span></div>
        <div class="chart" data-cum="${d.key}"></div>
        <div class="legend"><span><i class="c-${d.key}"></i>Flown</span><span><i class="dash c-${d.key}"></i>Forecast</span><span><i class="c-today"></i>Today</span></div>
      </div>`).join('');
    for (const d of defs) C.cumulative($(`[data-cum="${d.key}"]`, host), { ...d, year, rows: sum.events, today: E.todayISO() });
  };

  const COST_KINDS = [['flight', 'Flight', '--c-flight'], ['upgrade', 'Upgrade', '--c-upgrade'], ['co2', 'CO₂ compensation', '--c-co2']];
  const costSeries = () => COST_KINDS.map(([key, label, color]) => ({ key, label, color: cssVar(color) }));
  const costLegend = `<div class="legend">${COST_KINDS.map(([key, label]) => `<span><i class="sq c-${key}"></i>${label}</span>`).join('')}</div>`;

  const renderCostChart = (sum) => {
    const data = C.MONTHS.map(() => ({ flight: 0, upgrade: 0, co2: 0, planned: 0, n: 0 }));
    for (const r of sum.rows) {
      if (!r.counts) continue;
      const mIdx = +r.date.slice(5, 7) - 1;
      const d = data[mIdx];
      d.flight += r.c.flight; d.upgrade += r.c.upgrade; d.co2 += r.c.co2; d.n++;
      if (r.planned) d.planned += r.c.total;
    }
    C.stackedBars($('#costChart'), {
      label: 'Costs per month', categories: C.MONTHS, series: costSeries(), data,
      format: (v) => money(v, true),
      dim: (i) => data[i].planned > 0 && data[i].planned >= (data[i].flight + data[i].upgrade + data[i].co2) - 0.001,
      tipTitle: (i) => `${C.MONTHS[i]} ${year}`,
      note: (i) => `<div class="row muted"><span>${data[i].n} segment(s)</span><span>${data[i].planned ? money(data[i].planned, true) + ' planned' : ''}</span></div>`,
    });
  };

  const renderSegments = (sum) => {
    const groups = {};
    for (const r of sum.rows) {
      if (!r.counts) continue;
      const k = `${r.e.cls}|${r.e.haul || 'unknown'}`;
      const g = groups[k] || (groups[k] = { cls: r.e.cls, haul: r.e.haul, flown: 0, planned: 0, p: 0, qp: 0, hon: 0, cost: 0 });
      r.planned ? g.planned++ : g.flown++;
      g.p += r.e.p; g.qp += r.e.qp; g.hon += r.e.hon; g.cost += r.c.total;
    }
    const list = Object.values(groups).sort((a, b) => MM.CLASSES.indexOf(b.cls) - MM.CLASSES.indexOf(a.cls) || String(a.haul).localeCompare(String(b.haul)));
    const lhg = sum.rows.filter(r => r.counts && r.e.group === 'LHG').length;
    const star = sum.rows.filter(r => r.counts && r.e.group === 'STAR').length;
    $('#segBreakdown').innerHTML = list.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Earning cabin</th><th>Haul</th><th class="num">Flown</th><th class="num">Planned</th><th class="num">P</th><th class="num">QP</th><th class="num">HON</th><th class="num">Cost</th></tr></thead>
        <tbody>${list.map(g => `<tr class="static"><td>${esc(g.cls)}</td><td>${haulTxt(g.haul)}</td><td class="num">${g.flown}</td><td class="num">${g.planned}</td>
          <td class="num">${num(g.p)}</td><td class="num">${num(g.qp)}</td><td class="num">${num(g.hon)}</td><td class="num">${money(g.cost, true)}</td></tr>`).join('')}
          ${sum.adjustments.length ? `<tr class="static"><td colspan="2"><i>Point corrections</i></td><td class="num" colspan="2">${sum.adjustments.length}×</td>
          <td class="num">${signed(sum.adjTotal.p)}</td><td class="num">${signed(sum.adjTotal.qp)}</td><td class="num">${signed(sum.adjTotal.hon)}</td><td class="num">–</td></tr>` : ''}
          ${sum.stays.length ? `<tr class="static"><td colspan="2"><i>Marriott Bonvoy stays</i></td><td class="num" colspan="2">${sum.stays.length}×</td>
          <td class="num">${num(sum.stayTotal.p)}</td><td class="num">0</td><td class="num">0</td><td class="num">–</td></tr>` : ''}</tbody>
      </table></div>
      <p class="hint">${lhg} Lufthansa Group segment(s) · ${star} Star Alliance segment(s) (Points only)</p>` : '<p class="muted">No segments in this year.</p>';
  };

  const renderHistory = (hist) => {
    const rows = hist.slice().reverse().map(h => {
      const total = h.cost.all.total;
      const hasPlan = h.rows.some(r => r.planned && r.counts);
      return `<tr data-year="${h.year}" ${h.year === year ? 'class="current"' : ''}>
        <td>${h.year}</td>
        <td class="num">${h.rows.filter(r => !r.planned).length}${hasPlan ? ` <span class="muted">+${h.rows.filter(r => r.planned && r.counts).length}</span>` : ''}</td>
        ${['p', 'qp', 'hon'].map(k => `<td class="num">${num(h.actual[k])}${hasPlan ? ` <span class="muted">→ ${num(h.forecast[k])}</span>` : ''}
          <div class="cpu">${perUnit(total, h.forecast[k], k)}</div></td>`).join('')}
        <td>${badge(h.statusActual)}${h.fromStatement ? ' <span class="muted">(statement)</span>' : ''}${hasPlan && h.statusForecast !== h.statusActual ? ` <span class="muted">→</span> ${badge(h.statusForecast)}` : ''}</td>
        <td>${h.statusActual !== 'NONE' || h.statusForecast !== 'NONE' ? C.fmtDate(E.validUntil(h.year)) : '–'}</td>
        <td>${badge(h.held)}${h.downgraded ? `<div class="muted">${downgradeTxt(h)}</div>` : h.carriedByPlan && h.held === h.carriedIn ? '<div class="muted">with planned flights</div>' : ''}</td>
        <td class="num">${money(total, true)}${hasPlan ? ` <span class="muted">(${money(h.cost.plan.total, true)} plan)</span>` : ''}</td>
      </tr>`;
    }).join('');
    $('#histTable').innerHTML = `<table>
      <thead><tr><th>CY</th><th class="num">Segments</th><th class="num">Points</th><th class="num">QP</th><th class="num">HON</th><th>Status earned</th><th>Valid until</th><th>Status held</th><th class="num">Cost</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
    $$('#histTable tr[data-year]').forEach(tr => tr.addEventListener('click', () => { year = +tr.dataset.year; render(); }));
    const yc = $('#yearCost');
    if (yc) {
      C.stackedBars(yc, {
        label: 'Costs per year', categories: hist.map(h => String(h.year)), series: costSeries(), data: hist.map(h => h.cost.all),
        format: (v) => money(v, true),
        note: (i) => `<div class="row muted"><span>Status incl. plan</span><span>${esc(MM.STATUS_LABEL[hist[i].statusForecast])}</span></div>`,
      });
    }
  };

  /* ================= flights view ================= */
  const expanded = new Set();   // flights whose times row is folded out (per page view)
  let timesBusy = false;

  /** "+01:00" -> "UTC+1", "+05:30" -> "UTC+5:30". */
  const utcOffset = (iso) => {
    const m = iso.match(/([+-])(\d{2}):(\d{2})$/);
    return !m ? 'UTC' : `UTC${m[1]}${+m[2]}${m[3] !== '00' ? ':' + m[3] : ''}`;
  };
  /** Clock time of an ISO time, with its date when that is not `day` ("07:15", "00:40 · 18 Nov 2026"). */
  const clock = (iso, day) => `${esc(iso.slice(11, 16))}${iso.slice(0, 10) !== day ? ` <span class="muted">${C.fmtDate(iso.slice(0, 10))}</span>` : ''}`;
  /** Local and UTC time of a departure or arrival, as "07:15 local (UTC+1) · 06:15 UTC". */
  const bothTimes = (t, day) => `<b>${clock(t.local, day)}</b> <span class="muted">local (${utcOffset(t.local)})</span> · ${clock(t.utc, day)} <span class="muted">UTC</span>`;
  const movementTxt = (label, iata, m, day) => {
    const late = m.revised && m.revised.utc !== m.scheduled.utc
      ? ` · <span class="muted">${label === 'Departure' ? 'departed / expected' : 'arrived / expected'}</span> ${bothTimes(m.revised, day)}` : '';
    return `<div><span class="k">${label}</span> <b>${esc(iata || '')}</b> ${bothTimes(m.scheduled, day)}${m.terminal ? ` · <span class="muted">Terminal</span> ${esc(m.terminal)}` : ''}${late}</div>`;
  };
  const durationTxt = (a, b) => {
    const min = Math.round((Date.parse(b) - Date.parse(a)) / 60000);
    return min > 0 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min` : '';
  };
  /** Whether "Refresh flight data" can get a flight's times: from the cache, or by asking AeroDataBox (timesCalls). */
  const timesAvailable = (f) => {
    const p = isFlight(f) && !E.flightTimes(f) && E.parseFlightNo(f.flightNo), op = E.operating(f);
    if (!p) return false;
    return [op && op.iata, p.iata].some(no => no && A.timesFromCache(A.cached(state, no, f.date))) || timesCalls(f) > 0;
  };
  /** At most how many AeroDataBox requests looking up a flight's times makes (A.timesCalls): 0 when the cache answers. */
  const timesCalls = (f) => {
    const p = isFlight(f) && E.parseFlightNo(f.flightNo), op = E.operating(f);
    return p ? A.timesCalls(state, p.iata, op && op.iata, f.date) : 0;
  };
  /** The way AeroDataBox is called (A.ADB_VIA), and what n requests cost: "4 API units (2 per lookup on your RapidAPI plan)". */
  const adbVia = () => A.ADB_VIA[A.adbVia(state.settings.aerodataboxVia)];
  const unitsTxt = (n) => `${n * A.UNITS_PER_CALL} API units (${A.UNITS_PER_CALL} per lookup on your ${adbVia().keyFrom} plan)`;
  /** A failure that repeats for every flight (A.lookup's failure), as a sentence: "AeroDataBox key rejected (HTTP 401) – …?" */
  const failureTxt = (fl) => `${fl.provider} ${fl.message}${/[.?!]$/.test(fl.message) ? '' : '.'}`;
  /**
   * The number whose times a flight shows or would get: the one that gave its times, else the one that gave its route
   * (the operating flight, or the flight number when the operating flight gave none), else the one asked first.
   */
  const timesNo = (f) => {
    const t = E.flightTimes(f), lk = f.routeLookup, op = E.operating(f);
    const own = (E.parseFlightNo(f.flightNo) || { iata: f.flightNo }).iata;   // a number from an edited .json may not parse
    if (t) return t.via || own;
    if (lk && lk.status === 'ok') return lk.via || own;
    return (op && op.iata) || own;
  };
  /** Refresh button of a folded-out flight (A.refreshTimes), disabled for A.refreshGap after the last request. */
  const refreshBtn = (f) => {
    if (!isFlight(f) || !state.settings.aerodataboxKey || !E.parseFlightNo(f.flightNo)) return '';
    const wait = A.refreshAllowedAt(A.cached(state, timesNo(f), f.date)) - Date.now();
    if (wait > 0) scheduleRefreshUnlock(wait);
    return `<button class="btn small refresh-btn" data-act="times-refresh" data-id="${esc(f.id)}" ${wait > 0 ? 'disabled' : ''}
      title="${wait > 0 ? `Refreshed recently – possible again in ${Math.ceil(wait / 60000)} min (saves API calls)` : `Ask AeroDataBox again for the current times, e.g. a delay or a new aircraft: one request, ${esc(unitsTxt(1))}`}">↻ Refresh</button>`;
  };
  /** Re-renders the flights view once the earliest disabled refresh button may be used again. */
  let unlockT = null, unlockAt = Infinity;
  const scheduleRefreshUnlock = (wait) => {
    const at = Date.now() + wait;
    if (at >= unlockAt) return;
    clearTimeout(unlockT);
    unlockAt = at;
    unlockT = setTimeout(() => { unlockAt = Infinity; if (view === 'flights' && !dlg.open) render(); }, wait + 500);
  };
  /** Asks AeroDataBox again for a flight's times (A.refreshTimes) and keeps the leg of its route. */
  const refreshTimes = async (f, b) => {
    b.disabled = true; b.textContent = '↻ Refreshing…';
    const st = state, no = timesNo(f);
    let msg, ms = 2600;
    try {
      const { entry, note } = await A.refreshTimes(st, no, f.date);
      if (!note && entry) {
        const via = no !== E.parseFlightNo(f.flightNo).iata ? no : undefined, leg = A.legIndex(entry, f.route), route = A.routeFromCache(entry, leg);
        A.applyLookup(f, { entry: { ...entry, fromCache: false }, route: route && via ? { ...route, via } : route, via, leg });
      }
      msg = note ? `AeroDataBox: ${note} – nothing changed` : f.times ? 'Times refreshed' : 'AeroDataBox has no times for this flight';
    } catch (err) {   // a key rejected or a blocked request won't work after the wait either: that message stays
      msg = `AeroDataBox ${err.reason ? err.message : `failed (${err.message})`}${err.reason === 'auth' || err.reason === 'network' ? '' : ` – try again in ${A.refreshGap / 60000} minutes`}`;
      ms = A.repeats(err) ? 0 : 6000;
    }
    if (state !== st) return;   // the data was loaded or deleted meanwhile
    save(); render(); toast(msg, ms);
  };
  /** The folded-out row of a flight: departure and arrival (scheduled, local and UTC), flight time and aircraft. */
  const timesDetail = (f) => `<div class="detail">${timesInfo(f)}${E.flightTimes(f) || !timesAvailable(f) ? refreshBtn(f) : ''}</div>`;
  const timesInfo = (f) => {
    const t = E.flightTimes(f);
    if (!t) {
      const why = !isFlight(f) ? 'Times are looked up for flights only.'
        : timesAvailable(f) ? `Not looked up yet. <button class="btn small" data-act="times-one" data-id="${esc(f.id)}"
            title="${timesCalls(f) ? `Asks AeroDataBox: up to ${esc(unitsTxt(timesCalls(f)))}` : 'From the cache: no request'}">Look up times</button>`
        : !state.settings.aerodataboxKey ? 'Departure and arrival times and the aircraft come from AeroDataBox: add your key in <a href="#" data-act="goto-settings">Settings</a>.'
        : `No times: ${esc(noTimesWhy(f))}.`;
      return `<div class="times muted">${why}</div>`;
    }
    const day = f.date, r = hasRoute(f.route) ? f.route : null;   // a later leg of the number can depart the next day
    const dur = t.arr ? durationTxt(t.dep.scheduled.utc, t.arr.scheduled.utc) : '';
    const ac = [t.aircraft && esc(t.aircraft), t.reg && `<span class="muted">${esc(t.reg)}</span>`].filter(Boolean).join(' ');
    const n = A.legs(routeEntry(f)).length;
    return `<div class="times">
      ${movementTxt('Departure', r && r.origin.iata, t.dep, day)}
      ${t.arr ? movementTxt('Arrival', r && r.destination.iata, t.arr, day)   // none e.g. when the flight was diverted
        : `<div><span class="k">Arrival</span> <b>${esc(r ? r.destination.iata : '')}</b> <span class="muted">no arrival time from AeroDataBox (diverted or cancelled?)</span></div>`}
      <div>${dur ? `<span class="k">Flight time</span> ${dur} · ` : ''}<span class="k">Aircraft</span> ${ac || '<span class="muted">not known yet</span>'}
        <span class="muted">· scheduled times${t.via ? ` of ${esc(t.via)}` : ''} from AeroDataBox, looked up ${C.fmtDate((t.fetchedAt || '').slice(0, 10))}${t.fetchedAt ? `, ${esc(t.fetchedAt.slice(11, 16))} UTC` : ''}</span></div>
      ${n > 1 ? `<div class="muted">This number flies ${n} routes on that day: click the row to choose another.</div>` : ''}
    </div>`;
  };
  /**
   * Why a flight without times has none (A.whyNoTimes): what AeroDataBox answered for it, else that its date is
   * outside the plan's range (A.outsidePlan).
   */
  const noTimesWhy = (f) => {
    const c = A.cached(state, timesNo(f), f.date), note = (c && c.adbNote) || (f.routeLookup && f.routeLookup.adbNote) || A.outsidePlan(state.settings, f.date);
    return A.whyNoTimes(note);
  };
  /**
   * Looks up the routes, times and aircraft of these flights (A.resolveRoute: the cache first, AeroDataBox only for
   * those without an answer). A looked-up route is updated with the answer for the date, a route typed in stays.
   * With `btn` (the "Refresh flight data" button), asks first what the AeroDataBox requests cost. Each answer is saved
   * as it arrives (they cost units), and the button and the closing message don't depend on the rest going well. Stops
   * at the first failure that would repeat for every flight (A.lookup's failure); that flight keeps what it had.
   */
  const lookupTimes = async (flights, btn) => {
    if (timesBusy) return;
    const calls = flights.reduce((n, f) => n + timesCalls(f), 0);
    if (btn && calls && !(await ask('Refresh flight data',
      `This asks AeroDataBox up to ${calls} time${calls === 1 ? '' : 's'} and costs up to ${unitsTxt(calls)}. Flights answered from the cache cost nothing. Continue?`))) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Refreshing…'; }
    timesBusy = true;
    const st = state;   // loading or deleting the data meanwhile stops the run: its flights are gone
    let got = 0, failed = 0, done = 0, stop = null;
    const why = {};   // flights without times, per reason (A.whyNoTimes)
    try {
      for (const f of flights) {
        if (state !== st) break;
        try {
          const p = E.parseFlightNo(f.flightNo), op = E.operating(f);
          const res = await A.resolveRoute(st, p.iata, op && op.iata, f.date, { route: f.route });
          if (res.entry.failure) { stop = res.entry.failure; break; }
          A.applyLookup(f, res);
          if (f.times) { got++; expanded.add(f.id); } else if (!A.settled(res.entry, st.settings.aerodataboxKey)) failed++;
          else { const w = A.whyNoTimes(res.entry.adbNote || A.outsidePlan(st.settings, f.date)); why[w] = (why[w] || 0) + 1; }
        } catch (err) {   // a flight that can't be done is counted, the others go on
          console.error(err);
          failed++;
        }
        done++;
        save();
      }
    } finally {
      timesBusy = false;
      save();
      try { render(); } catch (err) { console.error(err); }
      if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = 'Refresh flight data'; }
    }
    if (state !== st) return;
    const reasons = Object.entries(why).map(([w, n]) => `${n} × ${w}.`);
    if (flights.length === 1 && !stop) { toast(got ? 'Times looked up' : failed ? 'The lookup failed – try again later' : `No times: ${Object.keys(why)[0]}`, got ? 2600 : 6000); return; }
    const left = flights.length - done;
    toast([`Found times for ${got} of ${flights.length} flight${flights.length === 1 ? '' : 's'}.`,
      reasons.length && `Without times: ${reasons.join(' ')}`,
      failed && `${failed} failed (asked again next time).`,
      stop && `Stopped: ${failureTxt(stop)}`,
      stop && left > 1 && `${left} not looked up.`].filter(Boolean).join(' '), 0);
  };

  const renderFlights = () => {
    const host = $('#view-flights');
    const sum = E.yearSummary(state, year);
    const showCO2 = sum.rows.some(r => E.hasBooster(r.f));
    const flown = sum.rows.filter(r => !r.planned), planned = sum.rows.filter(r => r.planned);
    // Flown / planned is shown by the section rows, so there is no status column.
    const cols = 13 + (showCO2 ? 1 : 0);
    const missing = sum.rows.filter(r => timesAvailable(r.f)).length;
    const segs = E.bookingSegments(state), holders = E.fareHolders(state);
    /**
     * Fare cell. A booking with several segments shows its whole fare once, on the segment that carries it
     * (E.fareHolders); its other segments point to that one.
     */
    const fareCell = (f, fare) => {
      const k = E.bookingKey(f.bookingCode), b = k && state.bookings[k];
      if (!b || segs[k] < 2) return money(fare);
      if (holders[k] === f.id) return `${money(fare)}<div class="muted" title="Whole fare of booking ${esc(k)}, counted once for its ${segs[k]} segments">booking · ${segs[k]} seg.</div>`;
      const h = state.flights.find(x => x.id === holders[k]);
      return `<span class="muted">–</span><div class="muted" title="Booking ${esc(k)}: the whole fare (${money(b.fare)}) is counted on ${esc(h.flightNo)}, ${esc(C.fmtDate(h.date))}">in ${esc(h.flightNo)}</div>`;
    };

    const row = (r) => {
      const f = r.f, up = E.isUpgraded(f);
      const co2 = E.hasBooster(f);
      const open = expanded.has(f.id);
      return `<tr data-id="${esc(f.id)}" class="${r.planned ? 'planned' : ''} ${r.counts ? '' : 'excluded'}">
        <td class="fold"><button class="fold-btn" data-fold="${esc(f.id)}" aria-expanded="${open}" title="Times and aircraft">▸</button></td>
        <td>${C.fmtDate(f.date)}${r.counts ? '' : '<div class="muted">not in forecast</div>'}</td>
        <td><b>${esc(f.flightNo)}</b>${f.transport === 'rail' ? ' <span class="pill">Train</span>' : f.transport === 'bus' ? ' <span class="pill">Bus</span>' : ''}<div class="muted"><code>${esc(f.bookingCode || '–')}</code></div></td>
        <td>${esc(E.airlineName(f))}<div class="muted">${E.operating(f) ? `op. by ${esc(E.operating(f).name)} · ` : ''}${esc(MM.GROUP_LABEL[r.e.group])}</div></td>
        <td><span class="route">${isFlight(f) || f.route ? routeTxt(f) : '<span class="muted">–</span>'}</span>${f.route && f.route.source === 'manual' ? '<div class="muted">manual</div>' : ''}</td>
        <td>${haulTxt(r.e.haul)}${f.haulOverride && f.haulOverride !== 'auto' ? '<div class="muted">override</div>' : ''}</td>
        <td class="cls">${clsBadge(f.bookedClass)}</td>
        <td class="cls">${up ? `${clsBadge(f.upgradeClass)}<div class="muted">${f.upgradeType ? esc(MM.UPGRADE_TYPES[f.upgradeType].label) : 'type not specified'}</div>` : '<span class="muted">–</span>'}${f.earnClassOverride && f.earnClassOverride !== 'auto' ? `<div class="muted">earns as ${esc(f.earnClassOverride)}</div>` : ''}</td>
        <td class="num">${num(r.e.p)}</td><td class="num">${num(r.e.qp)}</td><td class="num">${num(r.e.hon)}</td>
        <td class="num">${fareCell(f, r.c.flight)}</td><td class="num">${up ? money(r.c.upgrade) : '–'}</td>
        ${showCO2 ? `<td class="num">${co2 ? `${money(r.c.co2)}<div class="muted">${esc(MM.CO2_LABEL[f.co2Level])}</div>` : '–'}</td>` : ''}
      </tr>
      <tr class="detail-row ${r.planned ? 'planned' : ''}" data-detail="${esc(f.id)}" ${open ? '' : 'hidden'}><td></td><td colspan="${cols - 1}">${timesDetail(f)}</td></tr>`;
    };
    const tot = (rs) => rs.reduce((a, r) => {
      if (!r.counts) return a;
      a.p += r.e.p; a.qp += r.e.qp; a.hon += r.e.hon; a.flight += r.c.flight; a.upgrade += r.c.upgrade; a.co2 += r.c.co2;
      return a;
    }, { p: 0, qp: 0, hon: 0, flight: 0, upgrade: 0, co2: 0 });
    const footRow = (label, t) => `<tr><td colspan="8">${label} <span class="muted">· costs ${money(t.flight + t.upgrade + t.co2)}</span></td>
      <td class="num">${num(t.p)}</td><td class="num">${num(t.qp)}</td><td class="num">${num(t.hon)}</td>
      <td class="num">${money(t.flight)}</td><td class="num">${money(t.upgrade)}</td>${showCO2 ? `<td class="num">${money(t.co2)}</td>` : ''}</tr>`;

    host.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h2>Flights &amp; trains · CY ${year}</h2>
          <span class="sub">${flown.length} flown · ${planned.length} planned · flights after today are planned automatically · click a row to edit</span>
          <div class="right">
            ${missing ? `<button class="btn" data-act="times-all" title="Looks up routes, departure and arrival times and the aircraft (AeroDataBox) for the flights of ${year} without them. Asks first what it costs.">Refresh flight data (${missing})</button>` : ''}
            ${sum.rows.length ? `<button class="btn" data-act="fold-all">${sum.rows.every(r => expanded.has(r.f.id)) ? 'Collapse all' : 'Expand all'}</button>` : ''}
            <button class="btn primary" data-act="add">+ Add flight / train</button>
          </div>
        </div>
        ${sum.rows.length ? `<div class="table-wrap"><table>
          <thead><tr>
            <th class="fold"></th><th>Date</th><th>Flight</th><th>Airline</th><th>Route</th><th>Haul</th><th>Booked</th><th>Upgrade</th>
            <th class="num">P</th><th class="num">QP</th><th class="num">HON</th><th class="num">Fare</th><th class="num">Upg. cost</th>
            ${showCO2 ? '<th class="num">CO₂ cost</th>' : ''}
          </tr></thead>
          <tbody>
            ${flown.length ? `<tr class="sep-row"><td colspan="${cols}">Flown</td></tr>${flown.map(row).join('')}` : ''}
            ${planned.length ? `<tr class="sep-row"><td colspan="${cols}">Planned (forecast)</td></tr>${planned.map(row).join('')}` : ''}
          </tbody>
          <tfoot>
            ${footRow('Flown total', tot(flown))}
            ${planned.length ? footRow('Incl. planned', tot(sum.rows)) : ''}
            ${sum.adjustments.length || sum.stays.length ? footRow(`Incl. ${[sum.adjustments.length && 'point corrections', sum.stays.length && 'hotel stays'].filter(Boolean).join(' &amp; ')}`, { ...sum.forecast, ...sum.cost.all }) : ''}
          </tfoot>
        </table></div>` : `<div class="empty"><h2>No flights in ${year}</h2><p>Add a flown or planned segment to start tracking.</p>
          <div class="btns"><button class="btn primary" data-act="add">Add flight</button>${hasData() ? '' : '<button class="btn" data-act="demo">Load demo data</button>'}</div></div>`}
      </div>
      ${renderAdjustmentsCard(sum)}
      ${renderStaysCard(sum)}`;
    $$('tbody tr[data-id]', host).forEach(tr => tr.addEventListener('click', () => openDialog(state.flights.find(f => f.id === tr.dataset.id))));
    $$('[data-fold]', host).forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();   // the row opens the dialog
      const id = b.dataset.fold, open = !expanded.has(id);
      open ? expanded.add(id) : expanded.delete(id);
      b.setAttribute('aria-expanded', open);
      $(`tr[data-detail="${id}"]`, host).hidden = !open;
    }));
    $$('tbody tr[data-adj-id]', host).forEach(tr => tr.addEventListener('click', () => openAdjDialog(state.adjustments.find(a => a.id === tr.dataset.adjId))));
    $$('tbody tr[data-stay-id]', host).forEach(tr => tr.addEventListener('click', () => openStayDialog(state.stays.find(s => s.id === tr.dataset.stayId))));
  };

  /** Cabin class tag in the Lufthansa app colours (Economy / Premium Economy green, Business slate, First red). */
  const clsBadge = (c) => `<span class="cls-badge cls-${MM.CLASS_SHORT[c] || 'Y'}">${esc(c)}</span>`;

  const signed = (v) => (v > 0 ? '+' + num(v) : v < 0 ? '−' + num(-v) : '0');
  const renderAdjustmentsCard = (sum) => {
    const rows = sum.adjustments.map(r => `<tr data-adj-id="${esc(r.adj.id)}" class="${r.planned ? 'planned' : ''}">
        <td>${C.fmtDate(r.adj.date)}</td>
        <td class="num">${signed(r.e.p)}</td><td class="num">${signed(r.e.qp)}</td><td class="num">${signed(r.e.hon)}</td>
        <td class="wrap">${esc(r.adj.remark)}</td>
      </tr>`).join('');
    const t = sum.adjTotal;
    return `<div class="card">
      <div class="card-head">
        <h2>Point corrections · CY ${year}</h2>
        <span class="sub">manual adjustments as per your Miles &amp; More account statement · counted in all totals and forecasts</span>
        <div class="right"><button class="btn" data-act="add-adj">+ Add correction</button></div>
      </div>
      ${rows ? `<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th class="num">P</th><th class="num">QP</th><th class="num">HON</th><th>Remark</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${signed(t.p)}</td><td class="num">${signed(t.qp)}</td><td class="num">${signed(t.hon)}</td><td></td></tr></tfoot>
      </table></div>` : '<p class="muted m0">No corrections in this year. Add one if your statement shows different Points, QP or HON Circle Points than calculated here.</p>'}
    </div>`;
  };

  const renderStaysCard = (sum) => {
    const m = state.settings.rules.marriott;
    const why = { ok: '', short: `under ${m.minNights} nights`, cap: 'yearly maximum reached', partial: 'yearly maximum reached' };
    const rows = sum.stays.map(r => `<tr data-stay-id="${esc(r.stay.id)}" class="${r.planned ? 'planned' : ''}">
        <td>${C.fmtDate(r.stay.date)}</td>
        <td class="wrap">${esc(r.stay.hotel || '–')}${r.stay.remark ? `<div class="muted">${esc(r.stay.remark)}</div>` : ''}</td>
        <td class="num">${num(+r.stay.nights || 0)}</td>
        <td class="num">${num(r.e.p)}${why[r.e.reason] ? `<div class="muted">${why[r.e.reason]}</div>` : ''}</td>
      </tr>`).join('');
    return `<div class="card">
      <div class="card-head">
        <h2>Hotel stays · Marriott Bonvoy · CY ${year}</h2>
        <span class="sub">${num(m.pointsPerStay)} Points per stay of ${num(m.minNights)}+ nights · max ${num(m.maxPointsPerYear)} Points per calendar year · no QP / HON · accounts must be linked</span>
        <div class="right"><button class="btn" data-act="add-stay">+ Add stay</button></div>
      </div>
      ${rows ? `<div class="table-wrap"><table>
        <thead><tr><th>Check-out</th><th>Hotel</th><th class="num">Nights</th><th class="num">Points</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="3">Total <span class="muted">· ${num(Math.max(0, m.maxPointsPerYear - sum.stayTotal.p))} Points left this year</span></td><td class="num">${num(sum.stayTotal.p)}</td></tr></tfoot>
      </table></div>` : '<p class="muted m0">No Marriott Bonvoy stays in this year.</p>'}
    </div>`;
  };

  /** Runs fn on the second click; the first one changes the button's text to `label` for 4 seconds. */
  const confirmInline = (btn, label, fn) => {
    if (btn.dataset.armed) { fn(); return; }
    btn.dataset.armed = '1';
    const old = btn.textContent;
    btn.textContent = label;
    setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = old; } }, 4000);
  };
  /**
   * Asks a question in a dialog (#askDialog); resolves true when the user confirms. Its buttons answer directly, since
   * some browsers deliver the dialog's close event late (e.g. in a hidden pane); closing it otherwise (Esc) is a no.
   */
  let askDone = null;
  const ask = (title, text, okLabel = 'Continue') => new Promise((resolve) => {
    const d = $('#askDialog');
    $('#askTitle').textContent = title; $('#askText').textContent = text; $('#askOk').textContent = okLabel;
    askDone = (ok) => { askDone = null; if (d.open) d.close(); resolve(ok); };
    d.showModal();
  });
  $('#askOk').addEventListener('click', (e) => { e.preventDefault(); if (askDone) askDone(true); });
  $$('[data-close]', $('#askDialog')).forEach(b => b.addEventListener('click', () => (askDone ? askDone(false) : $('#askDialog').close())));
  $('#askDialog').addEventListener('close', () => { if (askDone) askDone(false); });
  /** The Delete button of a dialog: hidden for new items, else unarmed (see confirmInline). */
  const resetDelete = (btn, hidden) => { btn.hidden = hidden; btn.textContent = 'Delete'; btn.dataset.armed = ''; };

  /* ================= Marriott stay dialog (wired up below, after the date helpers) ================= */
  const stayDlg = $('#stayDialog'), stayForm = $('#stayForm');
  let stayDraft = null;
  const openStayDialog = (stay) => {
    const isNewStay = !stay;
    stayDraft = stay ? { ...stay } : S.newStay(newItemDate());
    $('#stayTitle').textContent = isNewStay ? 'Add Marriott Bonvoy stay' : 'Edit Marriott Bonvoy stay';
    const m = state.settings.rules.marriott;
    $('#stayHint').textContent = `With linked Miles & More and Marriott Bonvoy accounts, every qualifying stay of at least ${num(m.minNights)} nights earns ${num(m.pointsPerStay)} Points (no QP / HON Circle Points), up to ${num(m.maxPointsPerYear)} Points per calendar year. The values can be changed in Settings.`;
    stayForm.date.value = dateToField(stayDraft.date);
    stayForm.hotel.value = stayDraft.hotel || '';
    stayForm.nights.value = stayDraft.nights || '';
    stayForm.remark.value = stayDraft.remark || '';
    resetDelete($('#btnStayDelete'), isNewStay);
    stayDlg.showModal();
    (isNewStay ? stayForm.hotel : stayForm.nights).focus();
  };

  /* ================= point correction dialog (wired up below, after the date helpers) ================= */
  const adjDlg = $('#adjDialog'), adjForm = $('#adjForm');
  let adjDraft = null;
  const openAdjDialog = (adj) => {
    const isNewAdj = !adj;
    adjDraft = adj ? { ...adj } : S.newAdjustment(newItemDate());
    $('#adjTitle').textContent = isNewAdj ? 'Add point correction' : 'Edit point correction';
    adjForm.date.value = dateToField(adjDraft.date);
    for (const k of ['p', 'qp', 'hon']) adjForm[k].value = adjDraft[k] || '';
    adjForm.remark.value = adjDraft.remark || '';
    resetDelete($('#btnAdjDelete'), isNewAdj);
    adjDlg.showModal();
    (isNewAdj ? adjForm.p : adjForm.remark).focus();
  };

  /* ================= planner view ================= */
  /* Scenario per calendar year (saved in the .json): upgrade and CO₂ what-ifs for existing and planned flights, plus a
     mix of extra segments. Inputs only update the plan and the computed cells; adding / removing rows re-renders the view. */
  const planFor = (y) => state.plans[y] || (state.plans[y] = S.newPlan());
  const MIX_PRESETS = [
    { count: 2, kind: 'LHG', haul: 'continental', cls: 'Business', co2Level: 'none' },
    { count: 4, kind: 'LHG', haul: 'intercontinental', cls: 'Premium Economy', co2Level: 'medium' },
    { count: 2, kind: 'LHG', haul: 'intercontinental', cls: 'Business', co2Level: 'none' },
    { count: 4, kind: 'LHG', haul: 'continental', cls: 'Economy', co2Level: 'none' },
  ];
  const mixLabel = (r) => `${r.count} × ${r.cls} ${r.kind === 'RAIL' ? 'train' : r.haul === 'continental' ? 'continental' : 'intercont.'}${r.kind === 'STAR' ? ' (Star Alliance)' : ''}${r.co2Level !== 'none' ? ` + ${MM.CO2_LABEL[r.co2Level]}` : ''}`;
  const pts = (e) => `${num(e.p)} · ${num(e.qp)} · ${num(e.hon)}`;
  const plusPts = (e) => [e.p, e.qp, e.hon].map(signed).join(' · ');   // +60 · −40 · 0
  const opts = (list, cur, lab = (x) => x) => list.map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(lab(v))}</option>`).join('');

  /** Cost to suggest for a booster level: the flight's own cost for its own level (so going back to it is no what-if,
      like the bulk buttons), else the price model's estimate, else the average you paid. */
  const co2CostFor = (f, level) => {
    if (level === 'none') return 0;
    if (level === f.co2Level) return +f.co2Cost || 0;
    const est = co2Est(f, level);
    return est ? est.cost : E.co2CostEstimate(state, level, E.haul(f)) || 0;
  };
  let co2OnlyHon = false, co2BulkLevel = 'medium';   // bulk booster controls: only flights that earn HON Circle Points; level
  const co2EstCell = (f, level) => { const est = level !== 'none' && co2Est(f, level); return est ? co2EstTxt(est) : ''; };
  /** Flight f with only the upgrade what-if of the plan: the booster is priced in its cabin. */
  const upgradedFlight = (f, plan) => E.whatIfFlight(f, plan, { upgrade: true });
  /** What the plan's what-ifs for flight f add (P · QP · HON) and cost, and the cost per added QP (HON for HON-only gains). */
  const whatIfAdds = (f, plan) => {
    const rules = state.settings.rules, w = E.whatIfFlight(f, plan), a = E.earn(f, rules), b = E.earn(w, rules);
    const add = { p: b.p - a.p, qp: b.qp - a.qp, hon: b.hon - a.hon };
    const cost = E.cost(w, 0).total - E.cost(f, 0).total;
    return { add, cost, any: w !== f };
  };
  /** What a booked (locked) booster adds, in the cabin of the upgrade what-if. */
  const lockedAdds = (f, plan) => `adds ${plusPts(E.co2Gain({ ...upgradedFlight(f, plan), co2Level: 'none' }, f.co2Level, state.settings.rules))}`;
  const addsCell = (f, plan) => {
    const { add, cost, any } = whatIfAdds(f, plan);
    if (!any) return '<span class="muted">–</span>';
    const k = add.qp > 0 ? 'qp' : 'hon';
    return `${plusPts(add)}<div class="cpu">${money(cost, true)}${cost > 0 ? ` · ${perUnit(cost, add[k], k)}` : ''}</div>`;
  };

  const renderPlanner = () => {
    const host = $('#view-planner');
    const plan = planFor(year);
    const sum = E.yearSummary(state, year);
    const wiRows = sum.rows.filter(r => E.canBoost(r.f));
    const hasAvg = MM.CO2_LEVELS.some(l => l !== 'none' && (E.co2CostEstimate(state, l, 'continental') || E.co2CostEstimate(state, l, 'intercontinental')));
    const eur = state.settings.currency === 'EUR';

    const wiRow = (r) => {
      const f = r.f, o = plan.co2[f.id], u = plan.upgrade[f.id], level = o ? o.level : f.co2Level;
      const locked = E.hasBooster(f), canUp = r.planned && E.canUpgrade(f), upType = MM.UPGRADE_TYPES[f.upgradeType];
      const upCell = canUp
        ? `<td><select data-upg-cls aria-label="Upgrade for ${esc(f.flightNo)}"><option value="">No upgrade</option>${opts(E.upgradeClasses(f), u ? u.cls : '')}</select></td>
        <td class="num"><input inputmode="decimal" autocomplete="off" data-upg-cost value="${u ? u.cost || '' : ''}" placeholder="your price" aria-label="Upgrade cost" class="num-input" ${u ? '' : 'disabled'}></td>`
        : E.isUpgraded(f)
          ? `<td>${esc(E.flownClass(f))}<div class="muted">${upType ? esc(upType.label) + ' · ' : ''}upgraded · locked</div></td><td class="num">${money(f.upgradeCost)}</td>`
          : `<td><span class="muted">${r.planned ? '–' : 'flown · too late'}</span></td><td></td>`;
      const co2Cell = locked
        ? `<td>${esc(MM.CO2_LABEL[f.co2Level])} <button class="icon-btn" data-co2-remove aria-label="Remove CO₂ compensation from ${esc(f.flightNo)}" title="Remove the CO₂ compensation from this flight">✕</button>
          <div class="muted">compensated · locked</div></td>
        <td class="num">${money(f.co2Cost)}<div class="muted" data-cell="co2-locked">${lockedAdds(f, plan)}</div></td>`
        : `<td><select data-co2-level aria-label="CO₂ booster for ${esc(f.flightNo)}">${opts(MM.CO2_LEVELS, level, l => MM.CO2_LABEL[l])}</select></td>
        <td class="num"><input inputmode="decimal" autocomplete="off" data-co2-cost value="${o ? o.cost || '' : ''}" aria-label="Booster cost" class="num-input">
          <div class="muted" data-cell="co2-est">${co2EstCell(upgradedFlight(f, plan), level)}</div></td>`;
      return `<tr data-wi-id="${esc(f.id)}" class="static${r.planned ? ' planned' : ''}">
        <td>${C.fmtDate(f.date)}<div class="muted">${r.planned ? (r.counts ? 'planned' : 'planned · not in forecast') : 'flown'}</div></td>
        <td><b>${esc(f.flightNo)}</b><div class="muted">${routeTxt(f)}</div></td>
        <td>${haulTxt(r.e.haul)}<div class="muted">${esc(f.bookedClass)} · ${esc(MM.GROUP_LABEL[r.e.group])}</div>${E.earningClass(f) !== f.bookedClass ? `<div class="muted">earns ${esc(r.e.cls)}</div>` : ''}</td>
        ${upCell}${co2Cell}
        <td class="num" data-cell="delta">${addsCell(f, plan)}</td>
        <td><button class="btn small" data-wi-apply ${o || u ? '' : 'hidden'} title="Save this upgrade and booster with their costs to the flight">Apply</button></td>
      </tr>`;
    };

    const mixRow = (r) => {
      const rail = r.kind === 'RAIL';
      return `<tr data-mix-id="${esc(r.id)}" class="static">
        <td class="num"><input type="number" min="0" step="1" data-mix="count" value="${r.count}" aria-label="Number of segments" class="num-input narrow"></td>
        <td><select data-mix="kind" aria-label="Type">${opts(Object.keys(MM.MIX_KIND), r.kind, k => MM.MIX_KIND[k])}</select></td>
        <td><select data-mix="haul" aria-label="Haul" ${rail ? 'disabled' : ''}>${opts(['continental', 'intercontinental'], r.haul, h => HAUL_LABEL[h])}</select></td>
        <td><select data-mix="cls" aria-label="Cabin">${opts(rail ? Object.keys(MM.RAIL_CLASSES) : E.cabins(r.haul, r.kind), r.cls)}</select></td>
        <td><select data-mix="co2Level" aria-label="CO₂ booster" ${rail ? 'disabled' : ''}>${opts(MM.CO2_LEVELS, r.co2Level, l => MM.CO2_LABEL[l])}</select></td>
        <td class="num"><input inputmode="decimal" autocomplete="off" data-mix="cost" value="${r.cost || ''}" placeholder="0" aria-label="Cost per segment" class="num-input"></td>
        <td class="num" data-cell="sum"></td>
        <td><button class="icon-btn" data-mix-remove aria-label="Remove row" title="Remove row">✕</button></td>
      </tr>`;
    };

    host.innerHTML = `
      <div class="card" id="planResult"></div>
      <div class="card">
        <div class="card-head">
          <h2>Extra segments · CY ${year}</h2>
          <span class="sub">plan a mix on top of your flights, e.g. 2 × Business continental + 4 × Premium Economy intercontinental with a booster</span>
          <div class="right"><button class="btn primary" data-mix-add>+ Add segments</button></div>
        </div>
        ${plan.mix.length ? `<div class="table-wrap"><table>
          <thead><tr><th class="num">Count</th><th>Type</th><th>Haul</th><th>Cabin</th><th>CO₂ booster</th><th class="num">Cost / segment</th>
            <th class="num">Adds<div class="muted">P · QP · HON</div></th><th></th></tr></thead>
          <tbody>${plan.mix.map(mixRow).join('')}</tbody>
          <tfoot><tr><td colspan="6">Total extra segments <span class="muted" data-cell="mix-n"></span></td><td class="num" data-cell="mix-sum"></td><td></td></tr></tfoot>
        </table></div>` : '<p class="muted m0">No extra segments yet. Start with a preset or add your own rows:</p>'}
        <div class="btn-row">${MIX_PRESETS.map((p, i) => `<button class="btn small" data-mix-preset="${i}">+ ${esc(mixLabel(p))}</button>`).join('')}</div>
        <p class="hint">Continental includes domestic flights (e.g. SEA–SFO); Lufthansa Group flies those in Economy and Business only. Points per segment follow your rules in Settings. Star Alliance flights earn Points only; train QP / HON count only up to the
          train limits. A round trip counts as 2 segments. The cost per segment is your estimate (fare, upgrade and booster).</p>
      </div>
      <div class="card">
        <div class="card-head">
          <h2>Upgrades & CO₂ compensation · existing and planned flights · CY ${year}</h2>
          <span class="sub">try an upgrade and a booster per flight and see what they add · Apply saves them to the flight, which locks it until you change the upgrade in Activity or remove the compensation (✕)</span>
          ${wiRows.length ? `<div class="right">
            <select id="co2Bulk" aria-label="Booster to set">${opts(MM.CO2_LEVELS.filter(l => l !== 'none'), co2BulkLevel, l => MM.CO2_LABEL[l])}</select>
            <button class="btn small" data-co2-bulk="flown">Set for flown</button>
            <button class="btn small" data-co2-bulk="planned">Set for planned</button>
            <button class="btn small" data-co2-bulk="all">Set for all</button>
            <label class="check" title="Set the booster only on flights that earn HON Circle Points"><input type="checkbox" id="co2OnlyHon" ${co2OnlyHon ? 'checked' : ''}> Only HON</label>
            <button class="btn small" data-co2-bulk="reset" title="Clear every upgrade and booster what-if of ${year}">Reset</button>
          </div>` : ''}
        </div>
        ${wiRows.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Flight</th><th>Haul · booked</th><th>Try upgrade</th><th class="num">Upgrade cost</th><th>Try booster</th><th class="num">Booster cost</th>
            <th class="num">Adds<div class="muted">P · QP · HON · cost</div></th><th></th></tr></thead>
          <tbody>${wiRows.map(wiRow).join('')}</tbody>
          <tfoot><tr><td colspan="4">Total of the what-ifs</td><td class="num" data-cell="upg-cost"></td><td></td><td class="num" data-cell="co2-cost"></td><td class="num" data-cell="wi-sum"></td><td></td></tr></tfoot>
        </table></div>
        <p class="hint">Upgrades can only be tried on planned flights; a booster can still be added to a flown one. An upgrade here is a paid upgrade (fixed price or bid), so the flight earns in the upgraded cabin and a booster on it is priced and earns there too.
          Enter the upgrade price you were offered; it is not estimated. Upgrades with miles or vouchers earn as booked, so they add no points.
          ${eur ? 'Booster costs are prefilled with an estimate of the lufthansa.com price by distance and the cabin paid for (continental Economy and Business, long-haul Business), '
          + `${hasAvg ? 'else with the average you paid for that booster and haul' : 'else enter what the booster would cost'}.` : hasAvg ? 'Booster costs are prefilled with the average you paid for that booster and haul.' : 'Enter what the booster would cost.'}
          Boosters are usually booked with the flight – check whether compensation is still possible for a flight you have already flown.</p>`
        : `<p class="muted m0">No flights with Points in ${year}. Add flights in Activity first.</p>`}
      </div>
      <div class="card" id="gapCard"></div>`;

    /* --- upgrade and CO₂ what-ifs --- */
    const refreshRow = (tr, f) => {
      $('[data-cell="delta"]', tr).innerHTML = addsCell(f, plan);
      $('[data-wi-apply]', tr).hidden = !plan.co2[f.id] && !plan.upgrade[f.id];
      const est = $('[data-cell="co2-est"]', tr), sel = $('[data-co2-level]', tr);
      if (est) est.innerHTML = co2EstCell(upgradedFlight(f, plan), sel.value);
      const booked = $('[data-cell="co2-locked"]', tr);
      if (booked) booked.textContent = lockedAdds(f, plan);
    };
    const setCo2 = (f, level, cost) => {
      if (level === f.co2Level && E.parseAmount(cost) === (+f.co2Cost || 0)) delete plan.co2[f.id];
      else plan.co2[f.id] = { level, cost: E.parseAmount(cost) };
    };
    $$('tr[data-wi-id]', host).forEach(tr => {
      const f = state.flights.find(x => x.id === tr.dataset.wiId);
      const remove = $('[data-co2-remove]', tr);
      if (remove) {   // compensated: the booster is locked, the only action on it is removing the compensation (after a second click)
        remove.addEventListener('click', () => confirmInline(remove, 'Remove?', () => {
          const level = f.co2Level;
          S.removeBooster(state, f.id);
          save(); renderPlanner(); toast(`${f.flightNo}: ${MM.CO2_LABEL[level]} removed from the flight`);
        }));
      }
      const sel = $('[data-co2-level]', tr), cost = $('[data-co2-cost]', tr);
      if (sel) {
        sel.addEventListener('change', () => { cost.value = co2CostFor(upgradedFlight(f, plan), sel.value) || ''; setCo2(f, sel.value, cost.value); refreshRow(tr, f); planChanged(); });
        cost.addEventListener('input', () => { setCo2(f, sel.value, cost.value); refreshRow(tr, f); planChanged(); });
      }
      const upSel = $('[data-upg-cls]', tr), upCost = $('[data-upg-cost]', tr);
      if (upSel) {
        const setUpgrade = () => {
          // a booster cost that was the estimate for the old cabin follows the new one
          const before = sel && sel.value !== 'none' && E.parseAmount(cost.value) === co2CostFor(upgradedFlight(f, plan), sel.value);
          if (upSel.value) plan.upgrade[f.id] = { cls: upSel.value, cost: E.parseAmount(upCost.value) };
          else delete plan.upgrade[f.id];
          upCost.disabled = !upSel.value;
          if (before) { cost.value = co2CostFor(upgradedFlight(f, plan), sel.value) || ''; setCo2(f, sel.value, cost.value); }
          refreshRow(tr, f); planChanged();
        };
        upSel.addEventListener('change', () => { setUpgrade(); if (upSel.value && !upCost.value) upCost.focus(); });
        upCost.addEventListener('input', setUpgrade);
      }
      $('[data-wi-apply]', tr).addEventListener('click', () => {
        const o = plan.co2[f.id], u = plan.upgrade[f.id];
        if (!o && !u) return;
        const done = [];
        if (u && E.isPlanned(f) && E.canUpgrade(f)) { f.upgradeClass = u.cls; f.upgradeType = E.WHATIF_UPGRADE; f.upgradeCost = u.cost; done.push(`upgrade to ${u.cls}`); }
        if (o && !E.hasBooster(f)) { f.co2Level = o.level; f.co2Cost = o.level === 'none' ? 0 : o.cost; done.push(`booster ${MM.CO2_LABEL[f.co2Level]}`); }
        delete plan.co2[f.id]; delete plan.upgrade[f.id];
        save(); renderPlanner(); toast(`${f.flightNo}: ${done.join(' and ')} saved to the flight`);
      });
    });
    const onlyHon = $('#co2OnlyHon', host);
    if (onlyHon) onlyHon.addEventListener('change', () => { co2OnlyHon = onlyHon.checked; });
    const bulk = $('#co2Bulk', host);
    if (bulk) bulk.addEventListener('change', () => { co2BulkLevel = bulk.value; });
    $$('[data-co2-bulk]', host).forEach(b => b.addEventListener('click', () => {
      const mode = b.dataset.co2Bulk, level = co2BulkLevel;
      if (mode === 'reset') { plan.co2 = {}; plan.upgrade = {}; }
      for (const r of wiRows) {
        if (E.hasBooster(r.f)) continue;   // compensated flights are locked
        if (mode !== 'all' && !(mode === 'planned' && r.planned) && !(mode === 'flown' && !r.planned)) continue;
        const up = upgradedFlight(r.f, plan);   // with its upgrade what-if: HON Circle Points and the booster's price follow the cabin
        if (co2OnlyHon && !E.earn({ ...up, co2Level: 'none' }, state.settings.rules).hon) continue;
        if (level === r.f.co2Level) delete plan.co2[r.f.id];
        else plan.co2[r.f.id] = { level, cost: co2CostFor(up, level) };
      }
      save(); renderPlanner();
    }));

    /* --- mix of extra segments --- */
    $$('tr[data-mix-id]', host).forEach(tr => {
      const row = plan.mix.find(r => r.id === tr.dataset.mixId);
      $$('[data-mix]', tr).forEach(inp => {
        const k = inp.dataset.mix;
        inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
          row[k] = k === 'count' ? Math.max(0, Math.round(+inp.value || 0)) : k === 'cost' ? E.parseAmount(inp.value) : inp.value;
          if (k === 'kind' || k === 'haul') {   // trains: continental, Economy or Business, no booster; LHG continental: Economy or Business
            S.fitMixRow(row);
            save(); renderPlanner(); return;
          }
          planChanged();
        });
      });
      $('[data-mix-remove]', tr).addEventListener('click', () => { plan.mix = plan.mix.filter(r => r !== row); save(); renderPlanner(); });
    });
    $('[data-mix-add]', host).addEventListener('click', () => { plan.mix.push(S.newMixRow()); save(); renderPlanner(); });
    $$('[data-mix-preset]', host).forEach(b => b.addEventListener('click', () => {
      plan.mix.push(S.newMixRow(MIX_PRESETS[+b.dataset.mixPreset])); save(); renderPlanner();
    }));

    planChanged(false);
  };

  /** Recomputes the scenario and fills every computed cell (keeps the inputs, so typing is not interrupted). */
  const planChanged = (persist = true) => {
    if (persist) save();
    const host = $('#view-planner');
    const plan = planFor(year), rules = state.settings.rules;
    const sc = E.planScenario(state, year, plan);
    const set = (sel, html, root = host) => { const el = $(sel, root); if (el) el.innerHTML = html; };

    // mix rows and totals
    for (const m of sc.mix) {
      set('[data-cell="sum"]', `<b>${pts(m.sum)}</b><div class="muted">${pts(m.e)} each · ${money(m.cost, true)}</div>`, $(`tr[data-mix-id="${m.row.id}"]`, host));
    }
    const mixSum = sc.mix.reduce((a, m) => ({ p: a.p + m.sum.p, qp: a.qp + m.sum.qp, hon: a.hon + m.sum.hon }), { p: 0, qp: 0, hon: 0 });
    const nSeg = sc.mix.reduce((a, m) => a + m.n, 0);
    set('[data-cell="mix-n"]', `· ${nSeg} segment${nSeg === 1 ? '' : 's'}`);
    set('[data-cell="mix-sum"]', `<b>${pts(mixSum)}</b><div class="muted">${money(sc.cost.mix, true)}</div>`);
    // upgrade and CO₂ what-ifs
    const f0 = sc.base.forecast, f1 = sc.withWhatIfs.forecast, diff = (t) => ({ p: t.p - f0.p, qp: t.qp - f0.qp, hon: t.hon - f0.hon });
    const signedCost = (v) => `${v < 0 ? '−' : '+'}${money(Math.abs(v))}`;
    set('[data-cell="wi-sum"]', `${plusPts(diff(f1))}<div class="cpu">${signedCost(sc.cost.upgrades + sc.cost.co2)}</div>`);
    set('[data-cell="upg-cost"]', signedCost(sc.cost.upgrades));
    set('[data-cell="co2-cost"]', signedCost(sc.cost.co2));

    // result card: one step after the other, each adding only its own share, so the steps add up to the total
    const counted = (o) => Object.keys(o).filter(id => sc.base.rows.some(r => r.f.id === id && r.counts));
    const upIds = counted(plan.upgrade).filter(id => { const f = state.flights.find(x => x.id === id); return E.isPlanned(f) && E.canUpgrade(f); });
    const nUpg = upIds.length, nCo2 = counted(plan.co2).length;
    const flightsTxt = (n) => `${n} flight${n === 1 ? '' : 's'}`;
    const noPrice = upIds.filter(id => !plan.upgrade[id].cost).length;
    const cmp = MM.STATUSES.find(k => E.rank(sc.status.forecast) < E.rank(k));   // the next status the steps go for
    const unit = cmp === 'HON' ? 'hon' : 'qp';
    const zero = { p: 0, qp: 0, hon: 0 }, a = sc.adds, onUp = a.co2OnUpgrades;
    const steps = [
      { label: 'Flown so far', t: sc.base.actual, add: sc.base.actual, s: sc.status.actual, cost: sc.base.cost.actual.total, note: '' },
      { label: '+ planned flights', t: f0, add: { p: f0.p - sc.base.actual.p, qp: f0.qp - sc.base.actual.qp, hon: f0.hon - sc.base.actual.hon }, s: sc.status.forecast, cost: sc.base.cost.plan.total, note: '= your forecast', bold: true },
      { label: '+ upgrades', t: sc.withUpgrades.forecast, add: a.upgrades, s: sc.status.withUpgrades, cost: sc.cost.upgrades, what: true,
        note: nUpg ? `${flightsTxt(nUpg)}${noPrice ? ` · <span class="pill warn">${noPrice} without a price</span>` : ''}` : 'none: pick a cabin under Try upgrade (planned flights)' },
      { label: '+ CO₂ boosters', t: sc.withWhatIfs.forecast, add: a.co2, s: sc.status.withWhatIfs, cost: sc.cost.co2, what: true,
        note: nCo2 ? `${flightsTxt(nCo2)}${onUp.p || onUp.hon ? ` · incl. ${plusPts(onUp)} because the flight is upgraded` : ''}` : 'none' },
      { label: '+ extra segments', t: sc.total, add: a.mix, s: sc.status.total, cost: sc.cost.mix, what: true,
        note: plan.mix.length ? plan.mix.map(r => esc(mixLabel(r))).join(', ') : 'none' },
    ];
    const missCell = (t, st) => (!cmp ? '<span class="muted">–</span>' : E.rank(st) >= E.rank(cmp) ? '✓ reached' : esc(missingTxt(E.gap(t, cmp, rules))));
    const ptsCells = (t, add, first) => ['p', 'qp', 'hon'].map(k => `<td class="num">${num(t[k])}${!first && add[k] ? `<div class="muted">${signed(add[k])}</div>` : ''}</td>`).join('');
    const costCells = (cost, add, what) => `<td class="num">${cost ? `${what && cost > 0 ? '+' : cost < 0 ? '−' : ''}${money(Math.abs(cost), true)}` : '<span class="muted">–</span>'}</td>
      <td class="num">${add[unit] > 0 && cost > 0 ? `<span class="cpu">${perUnit(cost, add[unit], unit)}</span>` : '<span class="muted">–</span>'}</td>`;
    const target = (key) => {
      const ok = E.rank(sc.status.total) >= E.rank(key);
      // reached.forecast includes flown segments, so check what was already flown first
      const done = sc.base.reached.actual[key], fc = sc.base.reached.forecast[key], est = sc.reached[key];
      const how = done ? `✓ reached on ${C.fmtDate(done)}`
        : sc.base.fromStatement && E.rank(sc.status.actual) >= E.rank(key) ? '✓ earned as per your statement'
        : fc ? `✓ with your planned flights on ${C.fmtDate(fc)}`
        : est && est.step === 'whatif' ? `✓ with the upgrade / CO₂ what-ifs on ${C.fmtDate(est.date)}`
        : est ? `✓ with the extra segments by ${C.fmtDate(est.date)}` : '✓ reached with this scenario';
      return `<div class="plan-target ${ok ? 'ok' : ''}">${badge(key)}<span>${ok ? how : `missing ${missingTxt(E.gap(sc.total, key, rules))}`}</span></div>`;
    };
    set('#planResult', `
      <div class="card-head"><h2>Scenario · CY ${year}</h2><span class="sub">step by step on top of what you have flown · each step adds only its own share · saved in your .json</span></div>
      <div class="plan-targets">${MM.STATUSES.map(target).join('')}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Step</th><th class="num">Points</th><th class="num">QP</th><th class="num">HON</th><th>Status</th>
          <th>${cmp ? `Missing for ${esc(MM.STATUS_LABEL[cmp])}` : 'Missing'}</th><th class="num">Cost of the step</th><th class="num">Cost per ${UNIT_LABEL[unit]}</th></tr></thead>
        <tbody>${steps.map((x, i) => `<tr class="static">
          <td>${x.bold ? `<b>${x.label}</b>` : x.label}${x.note ? `<div class="muted wrap">${x.note}</div>` : ''}</td>
          ${ptsCells(x.t, x.add, i === 0)}<td>${badge(x.s)}</td><td>${missCell(x.t, x.s)}</td>${costCells(x.cost, x.add, x.what)}</tr>`).join('')}</tbody>
        <tfoot>
          <tr><td>Scenario total<div class="muted">${money(sc.cost.total, true)} in ${year}</div></td>${ptsCells(sc.total, zero, true)}<td>${badge(sc.status.total)}</td>
            <td>${missCell(sc.total, sc.status.total)}</td><td class="num">${money(sc.cost.total, true)}</td>
            <td class="num"><span class="cpu">${perUnit(sc.cost.total, sc.total[unit], unit)}</span></td></tr>
          <tr><td>What-ifs and extra segments<div class="muted">what the planner adds to your forecast</div></td>${ptsCells(a.total, zero, true)}<td></td><td></td>${costCells(sc.cost.extra, a.total, true)}</tr>
        </tfoot>
      </table></div>
      <p class="hint">The grey numbers are what a step adds; the costs of the steps add up to the total. Boosters count on top of the upgrades, so a booster on an upgraded
        flight earns its share of the upgraded cabin. Cost per ${UNIT_LABEL[unit]} is a step's cost divided by the ${PT_LABEL[unit]} it adds${cmp ? `, the points ${esc(MM.STATUS_LABEL[cmp])} needs` : ''}:
        the lower, the cheaper that way to the status. Upgrades without a price count as free here.</p>`);

    renderGap(sc.total, sc.status.total);
    enhanceTables();
  };

  /** "Fill the gap": how many more segments of one type close the remaining gap after the scenario (status st). */
  const gapPrefs = { target: null, haul: 'intercontinental', cls: 'Business', co2Level: 'none' };
  const renderGap = (total, st) => {
    if (!E.cabins(gapPrefs.haul, 'LHG').includes(gapPrefs.cls)) gapPrefs.cls = gapPrefs.cls === 'First' ? 'Business' : 'Economy';   // continental: Economy or Business
    const host = $('#gapCard'), rules = state.settings.rules, { haul, cls, co2Level } = gapPrefs;
    const target = gapPrefs.target || MM.STATUSES.find(k => E.rank(st) < E.rank(k)) || 'HON';
    const reached = E.rank(st) >= E.rank(target);   // also when the status comes from the statement
    const need = E.segmentsNeeded(total, target, { haul, cls, co2Level }, rules), e = need.e;
    const n = reached ? 0 : need.n;
    host.innerHTML = `
      <div class="card-head"><h2>Fill the gap</h2><span class="sub">how many more segments of one type you need on top of the scenario</span></div>
      <div class="grid">
        <label>Target status<select data-gap="target">${opts(MM.STATUSES, target, k => MM.STATUS_LABEL[k])}</select></label>
        <label>Haul<select data-gap="haul">${opts(['continental', 'intercontinental'], haul, h => HAUL_LABEL[h])}</select></label>
        <label>Cabin<select data-gap="cls">${opts(E.cabins(haul, 'LHG'), cls)}</select></label>
        <label>CO₂ booster<select data-gap="co2Level">${opts(MM.CO2_LEVELS, co2Level, l => MM.CO2_LABEL[l])}</select></label>
      </div>
      <div class="earn-preview mt">
        <div><div class="k">Per segment (Lufthansa Group)</div><b>${num(e.p)} P · ${num(e.qp)} QP · ${num(e.hon)} HON</b></div>
        <div><div class="k">Still missing after scenario</div><b>${reached ? '–' : missingTxt(E.gap(total, target, rules))}</b></div>
        <div><div class="k">Extra segments needed</div><b class="big">${n === Infinity ? 'not reachable' : n === 0 ? '✓ none' : n + '×'}</b></div>
      </div>
      ${n > 0 && n !== Infinity ? `<div class="mt"><button class="btn small" data-gap-add>+ Add ${esc(mixLabel({ count: n, kind: 'LHG', haul, cls, co2Level }))} to the extra segments</button></div>` : ''}
      <p class="hint">HON Circle Points are only earned in ${esc(rules.honClasses.join(' / '))}.</p>`;
    $$('[data-gap]', host).forEach(s => s.addEventListener('change', () => { gapPrefs[s.dataset.gap] = s.value; renderGap(total, st); }));
    const add = $('[data-gap-add]', host);
    if (add) add.addEventListener('click', () => {
      planFor(year).mix.push(S.newMixRow({ count: n, kind: 'LHG', haul, cls, co2Level }));
      save(); renderPlanner();
    });
  };

  /* ================= settings view ================= */
  /** "992000123456789" -> "992 000 123 456 789", as printed on the card. */
  const groupDigits = (d) => String(d || '').replace(/(\d{3})(?=\d)/g, '$1 ');
  const memberHint = (d) => (!d ? 'Optional. Becomes part of the .json file name.'
    : d.length === 15 ? `File name: ${S.fileName({ settings: { memberNumber: d } })}`
    : `${d.length} digits – card numbers usually have 15. File name: ${S.fileName({ settings: { memberNumber: d } })}`);

  const renderSettings = () => {
    const r = state.settings.rules;
    const host = $('#view-settings');
    const cacheN = Object.keys(state.apiCache).length;
    const cacheOk = Object.values(state.apiCache).filter(c => c.status === 'ok').length;
    const ss = state.settings.startStatus;
    const ssYear = ss.year || new Date().getFullYear() - 1;
    host.innerHTML = `
      <div class="settings-grid">
        <div class="card">
          <div class="card-head"><h2>Starting status</h2><span class="sub">your status before the first tracked year</span></div>
          <div class="grid">
            <label>Status (as on your statement)
              <select id="startStatus">${MM.STATUS_ORDER.map(s => `<option value="${s}" ${s === ss.status ? 'selected' : ''}>${s === 'NONE' ? 'None / Base' : esc(MM.STATUS_LABEL[s])}</option>`).join('')}</select>
            </label>
            <label>Earned in calendar year<input type="number" id="startYear" min="2000" max="2100" step="1" value="${ssYear}"></label>
          </div>
          <p class="hint">Counts as the status earned in that year: it carries into the next year and is valid until
            ${C.fmtDate(E.validUntil(+ssYear))}. If you don't requalify, the usual one-level downgrade applies.
            Leave on "None" if you track all your flights from the year you earned it.</p>
        </div>
        <div class="card">
          <div class="card-head"><h2>Points per segment</h2><span class="sub">Lufthansa Group: Points = Qualifying Points</span></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Cabin</th><th class="num">Continental</th><th class="num">Intercontinental</th><th>HON Points</th></tr></thead>
            <tbody>${MM.CLASSES.map(c => `<tr class="static"><td>${c}</td>
              <td class="num"><input type="number" min="0" data-rule="points.continental.${c}" value="${r.points.continental[c]}"></td>
              <td class="num"><input type="number" min="0" data-rule="points.intercontinental.${c}" value="${r.points.intercontinental[c]}"></td>
              <td><input type="checkbox" data-hon="${c}" ${r.honClasses.includes(c) ? 'checked' : ''} aria-label="HON Circle Points in ${c}"></td></tr>`).join('')}</tbody>
          </table></div>
          <p class="hint">Star Alliance partners earn Points only (no QP / HON). Other airlines earn nothing.</p>
        </div>
        <div class="card">
          <div class="card-head"><h2>Status thresholds</h2><span class="sub">per calendar year</span></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Status</th><th class="num">Points</th><th class="num">QP</th><th class="num">HON Points</th><th class="num" title="Max QP (FTL, SEN) or HON Circle Points (HON) that train segments may contribute">Max by train</th></tr></thead>
            <tbody>
              <tr class="static"><td>${badge('FTL')}</td><td class="num"><input type="number" min="0" data-rule="thresholds.FTL.p" value="${r.thresholds.FTL.p}"></td><td class="num"><input type="number" min="0" data-rule="thresholds.FTL.qp" value="${r.thresholds.FTL.qp}"></td><td></td><td class="num"><input type="number" min="0" data-rule="railCaps.FTL" value="${r.railCaps.FTL}" title="QP"></td></tr>
              <tr class="static"><td>${badge('SEN')}</td><td class="num"><input type="number" min="0" data-rule="thresholds.SEN.p" value="${r.thresholds.SEN.p}"></td><td class="num"><input type="number" min="0" data-rule="thresholds.SEN.qp" value="${r.thresholds.SEN.qp}"></td><td></td><td class="num"><input type="number" min="0" data-rule="railCaps.SEN" value="${r.railCaps.SEN}" title="QP"></td></tr>
              <tr class="static"><td>${badge('HON')}</td><td></td><td></td><td class="num"><input type="number" min="0" data-rule="thresholds.HON.hon" value="${r.thresholds.HON.hon}"></td><td class="num"><input type="number" min="0" data-rule="railCaps.HON" value="${r.railCaps.HON}" title="HON Circle Points"></td></tr>
            </tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>CO₂ compensation boosters</h2><span class="sub">bonus in % of the segment's base value</span></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Level</th><th class="num">Points %</th><th class="num">QP %</th><th class="num">HON %</th></tr></thead>
            <tbody>${MM.CO2_LEVELS.filter(l => l !== 'none').map(l => `<tr class="static"><td>${MM.CO2_LABEL[l]}</td>
              ${['p', 'qp', 'hon'].map(k => `<td class="num"><input type="number" min="0" data-rule="co2.${l}.${k}" value="${r.co2[l][k]}"></td>`).join('')}</tr>`).join('')}</tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Marriott Bonvoy stays</h2><span class="sub">Points only, accounts linked</span></div>
          <div class="grid">
            <label>Points per stay<input type="number" min="0" data-rule="marriott.pointsPerStay" value="${r.marriott.pointsPerStay}"></label>
            <label>Minimum nights<input type="number" min="0" data-rule="marriott.minNights" value="${r.marriott.minNights}"></label>
            <label>Max Points per year<input type="number" min="0" data-rule="marriott.maxPointsPerYear" value="${r.marriott.maxPointsPerYear}"></label>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Route lookup</h2><span class="sub">your own key, saved with your data</span></div>
          <div class="grid">
            <label>Call AeroDataBox<select id="adbVia">${opts(Object.keys(A.ADB_VIA), state.settings.aerodataboxVia, v => A.ADB_VIA[v].label)}</select>
              ${adbVia() !== A.ADB_VIA.rapidapi && A.isRapidApiKey(state.settings.aerodataboxKey)
                ? `<small class="field-hint danger">This looks like a RapidAPI key – choose Via RapidAPI or enter a key from ${adbVia().keyFrom}.</small>`
                : `<small class="field-hint">With a key from ${adbVia().keyFrom}</small>`}</label>
            <label>AeroDataBox key<input id="adbKey" type="password" autocomplete="off" spellcheck="false" placeholder="not set: adsbdb.com only" value="${esc(state.settings.aerodataboxKey)}">
              <small class="field-hint">${state.settings.aerodataboxKey ? 'Set: routes are looked up for the flight date.' : 'Optional.'}</small></label>
          </div>
          <p class="hint">Without a key, routes come from adsbdb.com, which knows one route per flight number (the one flown
            at the moment) and ignores the date. With your own <a href="https://aerodatabox.com/pricing/" target="_blank" rel="noopener">AeroDataBox</a>
            key, the app asks for the route on the flight date first and falls back to adsbdb. Get the key directly from
            <a href="https://aerodatabox.com/pricing/" target="_blank" rel="noopener">AeroDataBox</a>, from
            <a href="https://api.market/store/aedbx/aerodatabox" target="_blank" rel="noopener">API.Market</a>
            or from <a href="https://rapid.aerodatabox.com/pricing" target="_blank" rel="noopener">RapidAPI</a>, and choose the
            matching way above: route lookups, "Refresh flight data" and "Refresh" all go that way. A key of one doesn't work with the
            others. Each lookup costs ${A.UNITS_PER_CALL} API units on all three; "Refresh flight data" says first how many it may use. On RapidAPI, the
            free Basic plan has 400 units a month, so about ${400 / A.UNITS_PER_CALL} lookups. Answers are cached per flight number and date, so a
            flight is asked again only when its date changes, its lookup failed, its route came from another schedule season or
            has no times yet, or you ask for it ("Look up route", "Refresh").
            The key is saved in this browser and in your <code>.json</code>, so loading the file on another device brings it
            along. Keep the file to yourself.</p>
        </div>
        <div class="card">
          <div class="card-head"><h2>Data</h2></div>
          <div class="grid">
            <label>Miles &amp; More number<input id="memberNumber" inputmode="numeric" autocomplete="off" placeholder="992 000 000 000 000" value="${esc(groupDigits(state.settings.memberNumber))}">
              <small class="field-hint" id="memberHint">${memberHint(state.settings.memberNumber)}</small></label>
            <label>Currency<select id="currency">${MM.CURRENCIES.map(c => `<option ${c === state.settings.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          </div>
          <p class="hint">Data is kept in this browser (localStorage) and can be saved / loaded as <code>.json</code>.
            The file contains your flights and fares, point corrections, hotel stays, planner scenarios, these settings and the cached route lookups
            (${cacheN} lookup${cacheN === 1 ? '' : 's'} by flight number and date, ${cacheOk} with route) – so after loading it, only failed lookups,
            routes from another schedule season and, with an AeroDataBox key, routes without times are asked again.</p>
          <div class="btn-row">
            <button class="btn" data-act="reset-rules">Reset rules to defaults</button>
            <button class="btn" data-act="demo">Load demo data</button>
            <button class="btn" data-act="clear-cache">Clear API cache</button>
            <button class="btn danger" data-act="clear-all">Delete all data</button>
          </div>
        </div>
      </div>`;
    $$('[data-rule]', host).forEach(inp => inp.addEventListener('change', () => {
      const path = inp.dataset.rule.split('.');
      let o = state.settings.rules;
      while (path.length > 1) o = o[path.shift()];
      o[path[0]] = Math.max(0, +inp.value || 0);
      save(); toast('Rules updated');
    }));
    $$('[data-hon]', host).forEach(cb => cb.addEventListener('change', () => {
      const set = new Set(state.settings.rules.honClasses);
      cb.checked ? set.add(cb.dataset.hon) : set.delete(cb.dataset.hon);
      state.settings.rules.honClasses = MM.CLASSES.filter(c => set.has(c));
      save(); toast('Rules updated');
    }));
    $('#currency', host).addEventListener('change', (e) => { state.settings.currency = e.target.value; save(); toast('Currency updated'); });
    $('#adbVia', host).addEventListener('change', (e) => {
      state.settings.aerodataboxVia = A.adbVia(e.target.value);
      A.forgetPlanNotes(state);   // another plan: dates another way couldn't answer may be asked
      save(); render(); toast(`AeroDataBox: ${A.ADB_VIA[state.settings.aerodataboxVia].label}`);
    });
    $('#adbKey', host).addEventListener('change', (e) => {
      state.settings.aerodataboxKey = S.apiKey(e.target.value);
      A.forgetPlanNotes(state, true);   // a new key may be another plan
      save(); render(); toast(state.settings.aerodataboxKey ? 'AeroDataBox key saved' : 'AeroDataBox key removed');
    });
    const member = $('#memberNumber', host);
    member.addEventListener('input', () => { $('#memberHint', host).textContent = memberHint(S.memberNumber(member.value)); });
    member.addEventListener('change', () => {
      state.settings.memberNumber = S.memberNumber(member.value);
      member.value = groupDigits(state.settings.memberNumber);
      save(); toast(state.settings.memberNumber ? 'Miles & More number saved' : 'Miles & More number removed');
    });
    const saveStart = () => {
      const status = $('#startStatus', host).value;
      const y = Math.round(+$('#startYear', host).value);
      const valid = S.validYear(y);
      if (status !== 'NONE' && !valid) { toast('Please enter a valid year'); return; }
      state.settings.startStatus = { status, year: valid ? y : null };   // year is kept even while status is None
      save(); renderSettings(); toast('Starting status updated');
    };
    $('#startStatus', host).addEventListener('change', saveStart);
    $('#startYear', host).addEventListener('change', saveStart);
  };

  /* ================= flight dialog ================= */
  const dlg = $('#flightDialog'), form = $('#flightForm');
  let draft = null, isNew = false, upgradeTouched = false, co2Touched = false, lookupSeq = 0, pendingLookup = null;
  let fareFrom = '';   // booking whose whole fare the fare field shows ('' = the segment's own fare)
  /** True when the dialog was closed or shows another flight since `d` was current: async lookups must not touch it. */
  const stale = (d) => !dlg.open || draft !== d;

  const fillSelects = () => {
    const opts = MM.CLASSES.map(c => `<option>${c}</option>`).join('');
    form.upgradeClass.innerHTML = opts;
    form.earnClassOverride.innerHTML = '<option value="auto">Auto (from classes)</option>' + opts;
    form.upgradeType.innerHTML = '<option value="">– choose –</option>' +
      Object.entries(MM.UPGRADE_TYPES).map(([v, t]) => `<option value="${v}">${esc(t.label)}</option>`).join('');
    form.co2Level.innerHTML = MM.CO2_LEVELS.map(l => {
      const b = state.settings.rules.co2[l];
      return `<option value="${l}">${MM.CO2_LABEL[l]}${b ? ` (+${b.p}% P, +${b.qp}% QP, +${b.hon}% HON)` : ''}</option>`;
    }).join('');
  };

  /* ---------- Flight / Train / Bus: what the dialog asks for ---------- */
  const TRANSPORT = {
    flight: { noun: 'flight', date: 'Flight', number: 'Flight', placeholder: 'LH400', from: 'FRA', to: 'JFK' },
    rail: { noun: 'train', date: 'Travel', number: 'Train', placeholder: 'LH3460', from: 'QKL', to: 'FRA' },
    bus: { noun: 'bus trip', date: 'Travel', number: 'Bus', placeholder: 'LH number', from: '', to: '' },
  };
  /** "Flight", "Train" or "Bus trip" for messages. */
  const nounOf = (f) => { const n = (TRANSPORT[f.transport] || TRANSPORT.flight).noun; return n[0].toUpperCase() + n.slice(1); };
  const fillBookedClass = (t, value) => {
    const list = t === 'rail' ? Object.keys(MM.RAIL_CLASSES) : MM.CLASSES;
    form.bookedClass.innerHTML = list.map(c => `<option value="${c}">${esc(t === 'rail' ? MM.RAIL_CLASSES[c] : c)}</option>`).join('');
    form.bookedClass.value = list.includes(value) ? value : list[0];
    form.bookedClass.dataset.mode = t;
  };
  const transportHint = (t) => {
    const caps = state.settings.rules.railCaps;
    if (t === 'rail') return `Austrian AIRail, Lufthansa Express Rail or SWISS Air Rail, booked with a flight number. Earns like a continental
      flight, but train QP / HON count towards a status only up to ${num(caps.FTL)} QP (Frequent Traveller), ${num(caps.SEN)} QP (Senator)
      and ${num(caps.HON)} HON (HON Circle). No upgrades or CO₂ compensation.`;
    if (t === 'bus') return 'Lufthansa Express Bus: earns no Points, QP or HON Circle Points. Add it to keep track of the trip and its costs.';
    return '';
  };
  /** Shows only the fields that apply to the chosen type (data-for="flight rail" …); the hidden values are kept until saving. */
  const applyTransport = () => {
    const t = TRANSPORT[form.transport.value] ? form.transport.value : 'flight', T = TRANSPORT[t];
    $$('[data-for]', form).forEach(el => (el.hidden = !el.dataset.for.split(' ').includes(t)));
    $('[data-noun]', form).textContent = T.date;
    $$('[data-noun]', form)[1].textContent = T.number;
    $('[data-class-label]', form).textContent = t === 'rail' ? 'Class' : 'Booked class';
    if (form.bookedClass.dataset.mode !== t) fillBookedClass(t, form.bookedClass.value);
    form.flightNo.placeholder = T.placeholder;
    form.origin.placeholder = T.from;
    form.destination.placeholder = T.to;
    const hint = $('#transportHint');
    hint.textContent = transportHint(t);
    hint.hidden = !hint.textContent;
    $('#dlgTitle').textContent = isNew ? `Add ${T.noun}` : `Edit ${draft.flightNo || T.noun}`;
    $('#btnSaveFlight').textContent = `Save ${T.noun}`;
  };

  const routeInfo = () => {
    const info = $('#routeInfo');
    const r = draft.route, lk = draft.routeLookup;
    if (!isFlight(draft) && !hasRoute(r)) {
      info.textContent = draft.transport === 'rail'
        ? 'Optional: the station codes from your ticket, e.g. QKL (Cologne Hbf) → FRA. Trains count as continental.'
        : 'Optional: the codes from your ticket.';
      return;
    }
    if (hasRoute(r)) {
      const km = E.distanceKm(r.origin, r.destination);
      const name = a => esc([a.city || a.name, a.country].filter(Boolean).join(', ') || a.iata);
      const prov = r.provider === 'aerodatabox' ? `AeroDataBox for ${esc(dateToField(lk && lk.date || draft.date))}` : 'adsbdb.com';
      const src = r.source === 'manual' ? 'entered manually' : `from ${prov}${lk && lk.source === 'cache' ? ' (cached)' : ''}`;
      /** Which number gave the route of a codeshare: the operating flight (asked first) or the flight number. */
      const resolved = r.source === 'manual' || !isFlight(draft) ? ''
        : r.via ? `<br>Route resolved for <b>${esc(r.via)}</b>, the operating flight.`
        : lk && lk.operating ? `<br>${esc(lk.operating)} (operating flight) gave no route, so it was resolved for <b>${esc(lk.flightNo)}</b>, your flight number.`
        : '';
      const unknown = !r.origin.country || !r.destination.country;
      const key = state.settings.aerodataboxKey;
      /** What asks for the route of the flight's season (only for a route of another season, so lk is set). */
      const again = () => (A.isProvisional(lk, draft.date, undefined, key) ? 'Click "Look up route" for the route on your date.'
        : !key ? 'Add an AeroDataBox key in Settings to look up routes by date.'
        : lk.fetchedAt < draft.date ? 'Once that season has started, "Look up route" asks again.' : '');
      info.innerHTML = `${name(r.origin)} → ${name(r.destination)}${km ? ` · ${num(km)} km` : ''} · <span class="muted">${src}</span>` + resolved +
        (unknown && isFlight(draft) ? '<br><b class="danger">Airport unknown – please choose the haul manually.</b>' : '') +
        (r.source === 'manual' || !isFlight(draft) ? ''
          : otherSeason(draft) ? `<br><b class="danger">This is the route of schedule season ${esc(A.lookupSeason(lk))}, your flight is in ${esc(E.iataSeason(draft.date))}.</b> Airlines fly some numbers on other routes per season – check your ticket and type the airports above if they differ. ${again()}`
          : r.provider === 'aerodatabox' ? ''
          : '<br><span class="muted">This is the route listed for the flight number at lookup time (adsbdb ignores the date). Airlines reuse numbers – if it differs from your ticket, type the airports above.</span>') +
        (r.source === 'manual' || !lk ? ''
          : lk.adbError ? `<br><span class="muted">AeroDataBox failed: ${esc(lk.adbError)} So adsbdb was asked.</span>`
          : lk.adbNote ? `<br><span class="muted">No times: ${esc(A.whyNoTimes(lk.adbNote))} (${esc(dateToField(lk.date))}), so adsbdb was asked for the route.</span>` : '');
    } else if (lk && lk.status === 'loading') {
      info.textContent = 'Looking up route…';
    } else if (lk && lk.status === 'notfound') {
      info.innerHTML = `<b>Route not found</b> for ${lk.operating ? `${esc(lk.operating)} (operating flight) or ${esc(lk.flightNo)}` : 'this flight number'} – enter the airports manually and/or choose the haul.`;
    } else if (lk && lk.status === 'error') {
      info.innerHTML = `<b class="danger">Lookup failed</b> (${esc(lk.error || 'network error')}). Try again or enter the airports manually.`;
    } else {
      info.textContent = state.settings.aerodataboxKey ? 'Route is looked up automatically for the flight number and date (AeroDataBox, else adsbdb.com). Results are cached in your .json.' : 'Route is looked up automatically from the flight number (adsbdb.com). Results are cached in your .json.';
    }
    info.insertAdjacentHTML('beforeend', operatingInfo());
    legChoice(info);
  };

  /** The cache entry that gave a looked-up route (of the operating flight or the flight number), or undefined. */
  const routeEntry = (f) => {
    const lk = f.routeLookup;
    return lk && lk.date && lk.flightNo && f.route && f.route.source !== 'manual' ? A.cached(state, lk.via || lk.flightNo, lk.date) : undefined;
  };
  /** Days from ISO date a to ISO date b, as " +1" (or '' for the same day). */
  const dayShift = (a, b) => { const n = Math.round((Date.parse(b) - Date.parse(a)) / 864e5); return n ? ` ${n > 0 ? '+' : '−'}${Math.abs(n)}` : ''; };
  /** "FRA→MUC · 07:15–08:20" for a leg of a cache entry looked up for `date` (local times, when known; +1 for a later day). */
  const legLabel = (l, date) => {
    const sc = l.schedule, d = sc && sc.departure && sc.departure.scheduled, a = sc && sc.arrival && sc.arrival.scheduled;
    const t = (x) => `${x.local.slice(11, 16)}${dayShift(date, x.local.slice(0, 10))}`;
    return `${l.origin.iata_code}→${l.destination.iata_code}${d && a ? ` · ${t(d)}–${t(a)}` : ''}`;
  };
  /**
   * When the lookup gave several routes for the number on that date (A.legs: a flight with stops, or two flights with
   * one number), a choice of them below the route; choosing one sets the route and its times.
   */
  const legChoice = (info) => {
    const entry = routeEntry(draft), legs = A.legs(entry);
    if (legs.length < 2) return;
    const cur = A.legIndex(entry, draft.route), lk = draft.routeLookup;
    info.insertAdjacentHTML('beforeend', `<br><label class="leg-choice">${esc(lk.via || lk.flightNo)} flies ${legs.length} routes on ${esc(dateToField(lk.date))}:
      <select id="legSelect">${legs.map((l, i) => `<option value="${i}" ${i === cur ? 'selected' : ''}>${esc(legLabel(l, lk.date))}</option>`).join('')}</select></label>
      <span class="muted">choose the one on your ticket</span>`);
    $('#legSelect', info).addEventListener('change', (e) => {
      const i = +e.target.value;
      draft.route = { ...A.routeFromCache(entry, i), via: lk.via };
      draft.times = A.timesFromCache(entry, draft.flightNo, draft.date, lk.via, i);
      form.origin.value = draft.route.origin.iata || '';
      form.destination.value = draft.route.destination.iata || '';
      updatePreview();
    });
  };

  /** Second line in the route box for codeshares: operator, its earning group and a route cross-check. */
  const operatingInfo = () => {
    const op = E.operating(draft);
    if (!op) return '';
    const decides = !op.airline ? ' · airline not in list, earns as marketing airline'
      : E.isEdelweissCodeshare(draft) ? ' · LX8000–8499 earns like SWISS'
      : ` · operator decides earning: ${esc(MM.GROUP_LABEL[op.airline.group])}`;
    const head = `Operated by <b>${esc(op.name)}</b> as ${esc(op.iata)}${decides}`;
    const entry = A.cached(state, op.iata, draft.date);
    const opRoute = A.routeFromCache(entry, A.legIndex(entry, draft.route));   // of several, the one with the flight's airports
    const r = draft.route;
    let check = '';
    if (r && r.via === op.iata) check = '';   // the route is the operating flight's: nothing to cross-check
    else if (opRoute && hasRoute(r)) {
      const same = opRoute.origin.iata === r.origin.iata && opRoute.destination.iata === r.destination.iata;
      check = same ? ' · <span class="good">✓ same route</span>'
        : ` · <b class="danger">⚠ ${esc(op.iata)} is listed as ${esc(opRoute.origin.iata)}→${esc(opRoute.destination.iata)}</b>`;
    } else if (entry && entry.status === 'notfound') check = ` · route of ${esc(op.iata)} unknown`;
    return `<br>${head}${check}`;
  };

  /**
   * After the operating flight changed: looks up the route when there is none (the change handler drops a looked-up
   * one, as the operating flight is asked first), else (cached) the operating flight for the cross-check above.
   */
  const lookupOperating = async () => {
    const op = E.operating(draft), d = draft;
    if (!hasRoute(draft.route) && E.parseFlightNo(draft.flightNo)) { await doLookup(false); return; }
    if (op && draft.date) await A.lookup(state, op.iata, draft.date);
    if (stale(d)) return;
    save();
    updatePreview();
  };

  /* Date fields show YYYY/MM/DD (read with E.parseDate); the model stores ISO YYYY-MM-DD. */
  const dateToField = (iso) => (iso ? iso.replace(/-/g, '/') : '');

  /** Hidden fields keep their values in the form (switching back restores them); the draft gets neutral ones. */
  const readForm = () => {
    const t = TRANSPORT[form.transport.value] ? form.transport.value : 'flight', fl = t === 'flight';
    const parsed = E.parseFlightNo(form.flightNo.value);
    const opParsed = fl ? E.parseFlightNo(form.operatingFlightNo.value) : null;
    const upgradeClass = fl ? form.upgradeClass.value : form.bookedClass.value;
    const up = upgradeClass !== form.bookedClass.value;   // the upgrade type and cost only count with an upgrade
    Object.assign(draft, {
      transport: t,
      operatingFlightNo: !fl ? '' : opParsed ? opParsed.iata : form.operatingFlightNo.value.toUpperCase().replace(/\s/g, ''),
      date: E.parseDate(form.date.value),
      flightNo: parsed ? parsed.iata : form.flightNo.value.toUpperCase().replace(/\s/g, ''),
      bookingCode: E.bookingKey(form.bookingCode.value),
      haulOverride: fl ? form.haulOverride.value : 'auto',
      earningGroup: t === 'bus' ? 'auto' : form.earningGroup.value,
      earnClassOverride: fl ? form.earnClassOverride.value : 'auto',
      bookedClass: form.bookedClass.value,
      upgradeClass,
      upgradeType: up ? form.upgradeType.value : '',
      upgradeCost: up ? E.parseAmount(form.upgradeCost.value) : 0,
      co2Level: fl ? form.co2Level.value : 'none',
      co2Cost: fl && form.co2Level.value !== 'none' ? E.parseAmount(form.co2Cost.value) : 0,
      includeInPlan: form.includeInPlan.checked,
      notes: form.notes.value.trim(),
    });
  };

  /** The fare field holds the whole booking's fare when there is a booking code, else this segment's fare. */
  const fareInfo = () => {
    const k = E.bookingKey(form.bookingCode.value), fare = E.parseAmount(form.fare.value);
    const others = k ? state.flights.filter(f => f.id !== draft.id && E.bookingKey(f.bookingCode) === k) : [];
    // The booking as it will be once saved, to find the segment that carries its fare (E.fareHolders)
    const self = { ...draft, bookingCode: k, flightCost: k ? 0 : fare };
    const st = { flights: [...others, self], bookings: k ? { [k]: { fare } } : {} };
    const holder = k ? st.flights.find(f => f.id === E.fareHolders(st)[k]) : self;
    return { k, fare, others, n: others.length + 1, holder, segFare: E.segmentFare(st, self) };
  };
  const fareHint = (fi) => {
    if (!fi.k) return 'This segment only. With a booking code, you enter one fare for all segments of the booking.';
    if (!fi.others.length) return `Whole booking ${esc(fi.k)}. Other segments with this code share it.`;
    const list = fi.others.slice(0, 3).map(f => esc(f.flightNo)).join(', ') + (fi.others.length > 3 ? ` +${fi.others.length - 3}` : '');
    const on = fi.holder.id === draft.id ? 'this segment' : `${esc(fi.holder.flightNo)}, ${esc(C.fmtDate(fi.holder.date))}`;
    return `Whole booking ${esc(fi.k)}, ${fi.n} segments · with ${list} · counted once, on ${on}`;
  };

  const updatePreview = () => {
    readForm();
    const fl = isFlight(draft);
    form.airlineName.value = !draft.flightNo ? '' : E.parseFlightNo(draft.flightNo)
      ? `${E.airlineName(draft)} · earns as ${MM.GROUP_LABEL[E.earningGroup(draft)]}` : 'Unknown airline';
    $('[data-co2-only]', form).hidden = draft.co2Level === 'none';
    const planned = !!draft.date && E.isPlanned(draft);
    $('[data-plan-only]', form).hidden = !planned;
    const st = $('#dateStatus');
    st.className = 'pill' + (draft.date ? (planned ? ' planned' : '') : ' warn');
    st.textContent = draft.date ? (planned ? 'Planned' : fl ? 'Flown' : 'Travelled') : (form.date.value.trim() ? 'Invalid date' : 'Date required');
    form.upgradeCost.disabled = form.upgradeType.disabled = !E.isUpgraded(draft);
    const fi = fareInfo();
    $('#fareLabel').textContent = fi.k ? 'Fare (whole booking)' : 'Fare';
    $('#fareHint').innerHTML = fareHint(fi);
    // CO₂ cost: until typed in, it follows the price model's estimate for the chosen booster, route and cabin
    const est = fl && draft.co2Level !== 'none' ? co2Est(draft, draft.co2Level) : null;
    if (!co2Touched && fl && draft.co2Level !== 'none') {
      form.co2Cost.value = est ? est.cost : '';
      draft.co2Cost = est ? est.cost : 0;
    }
    $('#co2Hint').innerHTML = est ? co2EstTxt(est) : draft.co2Level === 'none' || state.settings.currency !== 'EUR' ? '' : 'no estimate for this route or cabin';
    const e = E.earn(draft, state.settings.rules);
    const c = E.cost(draft, fi.segFare);
    $('#earnPreview').innerHTML = `
      <div><div class="k">Earning basis${[draft.earnClassOverride, draft.haulOverride, draft.earningGroup].some(v => v && v !== 'auto') ? ' (override)' : ''}</div><b>${esc(e.cls)} · ${e.haul ? HAUL_LABEL[e.haul] : 'haul unknown'} · ${esc(MM.GROUP_LABEL[e.group])}</b></div>
      <div><div class="k">Points</div><b>${num(e.p)}</b></div>
      <div><div class="k">Qualifying Points</div><b>${num(e.qp)}</b></div>
      <div><div class="k">HON Circle Points</div><b>${num(e.hon)}</b></div>
      <div><div class="k">Cost of this segment</div><b>${money(c.total)}</b></div>
      <div><div class="k">Type</div><b>${!draft.date ? '–' : planned ? 'Planned (date after today)' : fl ? 'Flown' : 'Travelled'}</b></div>`;
    routeInfo();
  };

  /**
   * Looks up the route on the flight date: of the operating flight first, else of the flight number (A.resolveRoute), and
   * shows it. Returns the lookup, which saving waits for (pendingLookup).
   */
  const doLookup = (force) => (pendingLookup = lookupRoute(force));
  const lookupRoute = async (force) => {
    readForm();
    const parsed = E.parseFlightNo(draft.flightNo), op = E.operating(draft);
    if (!parsed) { toast('Enter a flight number like LH400'); return; }
    if (!draft.date) { if (force) toast('Enter the date first: the route is looked up for it'); return; }
    const seq = ++lookupSeq, d = draft, before = draft.routeLookup;
    draft.routeLookup = { status: 'loading' };
    routeInfo();
    const res = await A.resolveRoute(state, parsed.iata, op && op.iata, draft.date, { force, route: draft.route });
    if (seq !== lookupSeq || stale(d)) return;
    const fl = res.entry.failure;   // repeats for every flight (blocked, key rejected, quota): no answer about this one
    draft.routeLookup = fl && !res.route && before && before.status !== 'loading' ? before
      : A.lookupInfo(res.entry, parsed.iata, res.via, op ? op.iata : undefined);
    // a lookup that failed without a route (e.g. offline) keeps the times the flight had
    if (res.route || !(fl || !A.settled(res.entry, state.settings.aerodataboxKey))) {
      draft.times = A.timesFromCache(res.entry, draft.flightNo, draft.date, res.via, res.leg);
    }
    if (res.route) {   // without one, a route typed by hand stays
      draft.route = res.route;
      form.origin.value = res.route.origin.iata || '';
      form.destination.value = res.route.destination.iata || '';
    }
    save();
    updatePreview();
    if (fl) toast(`${failureTxt(fl)}${!res.route ? '' : res.entry.fromCache ? ' The saved route stays.' : ' Route from adsbdb.'}`, 8000);
    else if (res.entry.adbFailed) toast(`AeroDataBox failed (${res.entry.adbFailed}) – the saved route stays`, 6000);
    else if (force && !res.entry.fromCache) {
      const e = res.entry, adb = e.adbError ? `AeroDataBox failed (${e.adbError})` : e.adbNote ? `AeroDataBox: ${e.adbNote}` : '';
      const of = op && res.route ? ` of ${res.resolved}` : '';   // a codeshare: which number gave the route
      toast(!res.route ? (adb ? `${adb} · no route found` : 'No route found')
        : e.provider === 'aerodatabox' ? `Route${of} updated from AeroDataBox for your date` : `${adb ? `${adb} · ` : ''}route${of} from adsbdb`);
    }
  };

  /** Looks up the route unless it was typed in or is known for this flight number and date. */
  const autoLookup = () => {
    if (form.transport.value !== 'flight') return;   // adsbdb only knows flights
    const parsed = E.parseFlightNo(form.flightNo.value), lk = draft.routeLookup, op = E.operating(draft);
    if (!parsed) return;
    const known = lk && lk.flightNo === parsed.iata && lk.date === draft.date && draft.route
      && (lk.operating || lk.via || '') === (op ? op.iata : '');
    if (known || (draft.route && draft.route.source === 'manual')) return;
    doLookup(false);
  };

  const manualAirport = () => {
    const o = form.origin.value.trim().toUpperCase(), d = form.destination.value.trim().toUpperCase();
    const cur = draft.route;
    if (o.length !== 3 || d.length !== 3) draft.route = null;   // incomplete: no route, the haul is unknown
    else if (!(hasRoute(cur) && cur.origin.iata === o && cur.destination.iata === d)) {
      draft.route = { origin: A.airport(state, o), destination: A.airport(state, d), source: 'manual' };
    }
    updatePreview();
  };

  const openDialog = (flight) => {
    fillSelects();
    isNew = !flight;
    draft = flight ? structuredClone(flight) : S.newFlight(newItemDate());
    upgradeTouched = !!flight && E.isUpgraded(flight);
    // a saved cost that is an estimate (also one for the booked or earning cabin) follows the flown cabin's; one typed in stays
    co2Touched = !!flight && +flight.co2Cost > 0 && !(state.settings.currency === 'EUR' && E.co2CostIsEstimate(flight));
    form.date.value = dateToField(draft.date);
    form.flightNo.value = draft.flightNo;
    form.operatingFlightNo.value = draft.operatingFlightNo || '';
    form.bookingCode.value = draft.bookingCode;
    form.origin.value = draft.route && draft.route.origin ? draft.route.origin.iata : '';
    form.destination.value = draft.route && draft.route.destination ? draft.route.destination.iata : '';
    form.haulOverride.value = draft.haulOverride;
    form.earningGroup.value = draft.earningGroup;
    form.transport.value = draft.transport;
    form.earnClassOverride.value = draft.earnClassOverride;
    fillBookedClass(draft.transport, draft.bookedClass);
    form.upgradeClass.value = draft.upgradeClass;
    form.upgradeType.value = draft.upgradeType;
    const booking = state.bookings[E.bookingKey(draft.bookingCode)];
    form.fare.value = (booking ? booking.fare : draft.flightCost) || '';
    fareFrom = booking ? E.bookingKey(draft.bookingCode) : '';
    form.upgradeCost.value = draft.upgradeCost || '';
    form.co2Level.value = draft.co2Level;
    form.co2Cost.value = draft.co2Cost || '';
    form.includeInPlan.checked = draft.includeInPlan !== false;
    form.notes.value = draft.notes || '';
    resetDelete($('#btnDelete'), isNew);
    applyTransport();
    updatePreview();
    dlg.showModal();
    (isNew ? form.date : form.flightNo).focus();
  };

  /**
   * YYYY/MM/DD text field: while typing, a slash goes in after the year and a two-digit month ("20260115" →
   * "2026/01/15"); separators you type are kept, so "2026/1/15" stays 15 January. Normalised on blur; calendar via a
   * hidden native picker.
   */
  const wireDateField = (input, btn, picker, onPick) => {
    input.addEventListener('input', (e) => {
      if (!e.inputType || !e.inputType.startsWith('insert')) return;
      input.value = input.value.replace(/^(\d{4})(\d)/, '$1/$2').replace(/^(\d{4}\/\d{2})(\d)/, '$1/$2');
    });
    input.addEventListener('blur', () => {
      const iso = E.parseDate(input.value);
      if (iso) input.value = dateToField(iso);
    });
    btn.addEventListener('click', () => {
      picker.value = E.parseDate(input.value) || E.todayISO();
      try { picker.showPicker(); } catch { picker.focus(); picker.click(); }
    });
    picker.addEventListener('change', () => {
      if (!picker.value) return;
      input.value = dateToField(picker.value);
      if (onPick) onPick();
      input.focus();
    });
  };
  const datePicker = $('#datePicker');
  wireDateField(form.date, $('#btnDatePick'), datePicker, () => { updatePreview(); autoLookup(); });

  wireDateField(stayForm.date, $('#btnStayDatePick'), $('#stayDatePicker'));
  $$('[data-close]', stayDlg).forEach(b => b.addEventListener('click', () => stayDlg.close()));
  $('#btnStayDelete').addEventListener('click', (e) => confirmInline(e.currentTarget, 'Click again to delete', () => {
    state.stays = state.stays.filter(s => s.id !== stayDraft.id);
    save(); stayDlg.close(); toast('Stay deleted'); render();
  }));
  stayForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const date = E.parseDate(stayForm.date.value);
    if (!date) { toast('Please enter the check-out date as YYYY/MM/DD'); stayForm.date.focus(); return; }
    const nights = Math.round(+stayForm.nights.value || 0);
    if (nights < 1) { toast('Please enter the number of nights'); stayForm.nights.focus(); return; }
    const stay = { ...stayDraft, date, nights, hotel: stayForm.hotel.value.trim(), remark: stayForm.remark.value.trim() };
    const i = state.stays.findIndex(s => s.id === stay.id);
    i >= 0 ? (state.stays[i] = stay) : state.stays.push(stay);
    year = +date.slice(0, 4);
    save(); stayDlg.close();
    toast(i >= 0 ? 'Stay saved' : 'Stay added');
    render();
  });

  wireDateField(adjForm.date, $('#btnAdjDatePick'), $('#adjDatePicker'));
  $$('[data-close]', adjDlg).forEach(b => b.addEventListener('click', () => adjDlg.close()));
  $('#btnAdjDelete').addEventListener('click', (e) => confirmInline(e.currentTarget, 'Click again to delete', () => {
    state.adjustments = state.adjustments.filter(a => a.id !== adjDraft.id);
    save(); adjDlg.close(); toast('Correction deleted'); render();
  }));
  adjForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const date = E.parseDate(adjForm.date.value);
    if (!date) { toast('Please enter the date as YYYY/MM/DD'); adjForm.date.focus(); return; }
    const vals = Object.fromEntries(['p', 'qp', 'hon'].map(k => [k, Math.round(+adjForm[k].value || 0)]));
    if (!vals.p && !vals.qp && !vals.hon) { toast('Enter at least one value (P, QP or HON)'); adjForm.p.focus(); return; }
    const remark = adjForm.remark.value.trim();
    if (!remark) { toast('Please add a remark'); adjForm.remark.focus(); return; }
    const adj = { ...adjDraft, date, ...vals, remark };
    const i = state.adjustments.findIndex(a => a.id === adj.id);
    i >= 0 ? (state.adjustments[i] = adj) : state.adjustments.push(adj);
    year = +date.slice(0, 4);
    save(); adjDlg.close();
    toast(i >= 0 ? 'Correction saved' : 'Correction added');
    render();
  });

  form.addEventListener('input', (e) => {
    if (e.target === datePicker) return;
    if (e.target.name === 'transport') applyTransport();
    if (e.target.name === 'upgradeClass') upgradeTouched = form.upgradeClass.value !== form.bookedClass.value;
    if (e.target.name === 'co2Cost') co2Touched = true;   // emptied: back to the estimate on change, not while typing
    if (e.target.name === 'origin' || e.target.name === 'destination') { manualAirport(); return; }
    updatePreview();
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'bookedClass' && !upgradeTouched) { form.upgradeClass.value = form.bookedClass.value; updatePreview(); }
    if (e.target.name === 'co2Cost' && form.co2Cost.value === '') { co2Touched = false; updatePreview(); }
    if (e.target.name === 'flightNo') {
      const parsed = E.parseFlightNo(form.flightNo.value);
      if (parsed) form.flightNo.value = parsed.iata;
      if (draft.route && draft.route.source !== 'manual' && draft.routeLookup && parsed && draft.routeLookup.flightNo !== parsed.iata) {
        draft.route = null; form.origin.value = ''; form.destination.value = '';
      }
      updatePreview();
      autoLookup();
    }
    if (e.target.name === 'operatingFlightNo') {
      const parsed = E.parseFlightNo(form.operatingFlightNo.value);
      if (parsed) form.operatingFlightNo.value = parsed.iata;
      // A looked-up route depends on the operating flight, which is asked first: look it up again for the new one
      const lk = draft.routeLookup, before = lk ? lk.operating || lk.via || '' : '';
      if (draft.route && draft.route.source !== 'manual' && (parsed ? parsed.iata : '') !== before) {
        draft.route = null; form.origin.value = ''; form.destination.value = '';
      }
      readForm();
      lookupOperating();
    }
    if (e.target.name === 'transport') autoLookup();   // back to Flight: look up the route if there is none yet
    if (e.target.name === 'date') autoLookup();        // routes are looked up per date
    if (e.target.name === 'bookingCode') {
      const k = E.bookingKey(form.bookingCode.value), booking = state.bookings[k];
      form.bookingCode.value = k;
      // An existing booking brings its fare along. A field that showed another booking's fare starts empty, so that
      // fare isn't counted twice.
      if (booking) { form.fare.value = booking.fare || ''; fareFrom = k; } else if (fareFrom) { form.fare.value = ''; fareFrom = ''; }
      updatePreview();
    }
  });
  $('#btnLookup').addEventListener('click', () => doLookup(true));
  $$('[data-close]', dlg).forEach(b => b.addEventListener('click', () => dlg.close()));
  $('#btnDelete').addEventListener('click', (e) => confirmInline(e.currentTarget, 'Click again to delete', () => {
    S.deleteFlight(state, draft.id);
    save(); dlg.close(); toast(`${nounOf(draft)} deleted`); render();
  }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    readForm();
    const T = TRANSPORT[draft.transport];
    if (!draft.date) { toast('Please enter the date as YYYY/MM/DD'); form.date.focus(); return; }
    if (!E.parseFlightNo(draft.flightNo)) { toast(`Please enter a valid ${T.number.toLowerCase()} number, e.g. ${T.placeholder}`); form.flightNo.focus(); return; }
    if (E.isUpgraded(draft)) {   // flights only: readForm gives trains and buses none
      if (MM.CLASSES.indexOf(draft.upgradeClass) < MM.CLASSES.indexOf(draft.bookedClass)) {
        toast('The upgrade class must be above the booked class'); form.upgradeClass.focus(); return;
      }
      if (!MM.UPGRADE_TYPES[draft.upgradeType]) { toast('Please choose how the upgrade was obtained'); form.upgradeType.focus(); return; }
    }
    const d = draft;
    await pendingLookup;   // e.g. started by leaving the flight number field: its answer saves a second request
    if (stale(d)) return;   // cancelled while waiting
    const lk = draft.routeLookup;
    if (isFlight(draft) && !draft.route && !(lk && lk.flightNo === draft.flightNo && lk.date === draft.date)) {
      await doLookup(false);
      if (stale(d)) return;
    }
    const flight = structuredClone(draft);
    if (flight.routeLookup && flight.routeLookup.status === 'loading') flight.routeLookup = null;
    if (!E.flightTimes(flight)) flight.times = null;   // looked up for another number or date
    S.saveFlight(state, flight, fareInfo().fare);
    year = +flight.date.slice(0, 4);
    save(); dlg.close();
    toast(`${nounOf(flight)} ${isNew ? 'added' : 'saved'}`);
    render();
  });

  /* ================= global actions ================= */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'add') openDialog(null);
    if (act === 'add-adj') openAdjDialog(null);
    if (act === 'add-stay') openStayDialog(null);
    if (act === 'goto-flights') setView('flights');
    if (act === 'times-refresh') refreshTimes(state.flights.find(f => f.id === b.dataset.id), b);
    if (act === 'times-one') { lookupTimes([state.flights.find(f => f.id === b.dataset.id)]); }
    if (act === 'times-all') lookupTimes(E.yearSummary(state, year).rows.map(r => r.f).filter(timesAvailable), b);
    if (act === 'fold-all') {
      const ids = E.yearSummary(state, year).rows.map(r => r.f.id), all = ids.every(id => expanded.has(id));
      ids.forEach(id => (all ? expanded.delete(id) : expanded.add(id)));
      render();
    }
    if (act === 'goto-settings') { e.preventDefault(); setView('settings'); }
    if (act === 'goto-planner') setView('planner');
    if (act === 'load') $('#fileLoad').click();
    if (act === 'demo') {
      const go = () => { state = S.demo(); year = new Date().getFullYear(); save(); render(); toast('Demo data loaded'); };
      hasData() ? confirmInline(b, 'Replace all data? Click again', go) : go();
    }
    if (act === 'reset-rules') { state.settings.rules = S.empty().settings.rules; save(); render(); toast('Rules reset to defaults'); }
    if (act === 'clear-cache') confirmInline(b, 'Clear cache? Click again', () => { state.apiCache = {}; save(); render(); toast('API cache cleared'); });
    if (act === 'clear-all') confirmInline(b, 'Delete everything? Click again', () => { state = S.empty(); save(); render(); toast('All data deleted'); });
  });

  $$('.tabs button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#yearSelect').addEventListener('change', (e) => { year = +e.target.value; render(); });
  $('#btnSave').addEventListener('click', () => { S.exportJSON(state); toast('Saved .json'); });
  $('#fileLoad').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      state = await S.importFile(file);
      const ys = E.years(state);
      if (!ys.includes(year)) year = ys[ys.length - 1];
      save(); render();
      toast(`Loaded ${state.settings.memberNumber ? groupDigits(state.settings.memberNumber) + ' · ' : ''}${state.flights.length} flight(s) · ${Object.keys(state.apiCache).length} cached route lookup(s)`);
    } catch (err) {
      toast('Could not load file: ' + err.message);
    }
  });
  let resizeT;
  window.addEventListener('resize', () => {
    C.hideTip();
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (view === 'dashboard' && !dlg.open) renderDashboard(); enhanceTables(); }, 150);
  });
  /* ---------- light / dark / system theme (per browser, not part of the .json) ---------- */
  const THEME_KEY = 'mm-status-tracker:theme';
  const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
  let themePref = 'system';
  try { themePref = localStorage.getItem(THEME_KEY) || 'system'; } catch { /* ignore */ }
  const applyTheme = () => {
    const dark = themePref === 'dark' || (themePref === 'system' && darkMQ.matches);
    const next = dark ? 'dark' : 'light';
    const changed = document.documentElement.getAttribute('data-theme') !== next;
    document.documentElement.setAttribute('data-theme', next);
    $$('[data-theme-pref]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themePref === themePref)));
    if (changed) render();   // charts read their colors from CSS variables at render time
  };
  $$('[data-theme-pref]').forEach(b => b.addEventListener('click', () => {
    themePref = b.dataset.themePref;
    try { localStorage.setItem(THEME_KEY, themePref); } catch { /* ignore */ }
    applyTheme();
  }));
  darkMQ.addEventListener('change', applyTheme);
  applyTheme();

  const planBtn = $('#btnWithPlanner');
  planBtn.setAttribute('aria-pressed', String(withPlanner));
  planBtn.addEventListener('click', () => {
    withPlanner = !withPlanner;
    planBtn.setAttribute('aria-pressed', String(withPlanner));
    try { localStorage.setItem('mm-status-tracker:withPlanner', withPlanner ? '1' : '0'); } catch { /* ignore */ }
    render();
  });

  let startView = 'dashboard';
  try { startView = localStorage.getItem('mm-status-tracker:view') || 'dashboard'; } catch { /* ignore */ }
  setView(['dashboard', 'flights', 'planner', 'settings'].includes(startView) ? startView : 'dashboard');
  if (loadError) toast(`${loadError} Load a saved .json file instead.`, 10000);
})();
