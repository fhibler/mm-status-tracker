/* UI: views, flight dialog, dashboard rendering. */
(function () {
  const E = MM.engine, S = MM.store, A = MM.api, C = MM.charts;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => Math.round(v).toLocaleString('en-US');
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  let state = S.load() || S.empty();
  let year = new Date().getFullYear();
  let view = 'dashboard';

  const money = (v, compact) => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: state.settings.currency || 'EUR', maximumFractionDigits: compact ? 0 : 2, minimumFractionDigits: compact ? 0 : 2 }).format(v || 0);
    } catch { return (v || 0).toFixed(compact ? 0 : 2); }
  };
  const save = () => S.persist(state);
  const toast = (msg) => {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2600);
  };
  const badge = (s) => `<span class="badge ${s}">${esc(MM.STATUS_LABEL[s])}</span>`;
  /** "Senator → Frequent Traveller (not requalified)" for a soft-landing year, else ''. */
  const downgradeTxt = (h, when = '') => (h.downgraded ? `${esc(MM.STATUS_LABEL[h.prevHeld])} → ${esc(MM.STATUS_LABEL[h.held])}${when} (not requalified)` : '');
  const routeTxt = (f) => (f.route && f.route.origin && f.route.destination ? `${esc(f.route.origin.iata)}→${esc(f.route.destination.iata)}` : '<span class="pill warn">no route</span>');
  const haulTxt = (h) => (h === 'continental' ? 'Continental' : h === 'intercontinental' ? 'Intercont.' : '<span class="pill warn">unknown</span>');

  /* ================= navigation ================= */
  const setView = (v) => {
    view = v;
    $$('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    $$('.view').forEach(s => (s.hidden = s.id !== 'view-' + v));
    render();
    try { localStorage.setItem('mm-status-tracker:view', v); } catch { /* ignore */ }
  };

  const renderYearSelect = () => {
    const ys = new Set(E.years(state.flights));
    ys.add(new Date().getFullYear() + 1);
    ys.add(year);
    const sel = $('#yearSelect');
    sel.innerHTML = [...ys].sort((a, b) => b - a).map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('');
  };

  const render = () => {
    renderYearSelect();
    if (view === 'dashboard') renderDashboard();
    if (view === 'flights') renderFlights();
    if (view === 'settings') renderSettings();
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

  const renderDashboard = () => {
    const host = $('#view-dashboard');
    if (!state.flights.length) { host.innerHTML = emptyState(); return; }
    const rules = state.settings.rules;
    const hist = E.history(state);
    const sum = hist.find(h => h.year === year) || { ...E.yearSummary(state, year), carriedIn: 'NONE', held: 'NONE', prevHeld: 'NONE', downgraded: false };
    const heldMeta = sum.downgraded ? downgradeTxt(sum, ' from March')
      : E.rank(sum.carriedIn) < E.rank(sum.prevHeld) ? `Requalified ${C.fmtDate(sum.reached.actual[sum.held])} after soft landing`
      : sum.carriedIn !== 'NONE' ? `${esc(MM.STATUS_LABEL[sum.carriedIn])} carried in from ${year - 1}` : 'No status carried in';
    const nFlown = sum.rows.filter(r => !r.planned).length;
    const nPlan = sum.rows.filter(r => r.planned && r.counts).length;
    const totalCost = sum.cost.actual.total + sum.cost.plan.total;
    const nextKey = ['FTL', 'SEN', 'HON'].find(k => E.rank(sum.statusActual) < E.rank(k));
    const nextFc = nextKey && sum.reached.forecast[nextKey];

    const kpis = `
      <div class="kpis">
        <div class="card kpi"><div class="label">Status held in ${year}</div>
          <div class="value">${badge(sum.held)}</div>
          <div class="meta">${heldMeta}</div></div>
        <div class="card kpi"><div class="label">Earned in ${year} (flown)</div>
          <div class="value">${badge(sum.statusActual)}</div>
          <div class="meta">${sum.statusActual !== 'NONE' ? `Valid ${C.fmtDate(sum.reached.actual[sum.statusActual])} – ${C.fmtDate(E.validUntil(year))}` : `${nFlown} segment${nFlown === 1 ? '' : 's'} flown`}</div></div>
        <div class="card kpi"><div class="label">Forecast incl. plan</div>
          <div class="value">${badge(sum.statusForecast)}</div>
          <div class="meta">${nextKey ? (nextFc ? `${esc(MM.STATUS_LABEL[nextKey])} on ${C.fmtDate(nextFc)}` : `${esc(MM.STATUS_LABEL[nextKey])} not reached with ${nPlan} planned`) : 'Top tier reached'}</div></div>
        <div class="card kpi"><div class="label">Points · QP · HON</div>
          <div class="value">${num(sum.actual.p)} <span class="muted">·</span> ${num(sum.actual.qp)} <span class="muted">·</span> ${num(sum.actual.hon)}</div>
          <div class="meta">Forecast ${num(sum.forecast.p)} · ${num(sum.forecast.qp)} · ${num(sum.forecast.hon)}</div></div>
        <div class="card kpi"><div class="label">Cost ${year} (flown + plan)</div>
          <div class="value">${money(totalCost, true)}</div>
          <div class="meta">${money(sum.cost.actual.total, true)} spent · ${money(sum.cost.plan.total, true)} planned${sum.forecast.qp ? ` · ${money(totalCost / sum.forecast.qp)}/QP` : ''}</div></div>
      </div>`;

    const warn = sum.unknown ? `<div class="card" style="border-color:var(--danger)"><b>${sum.unknown} segment(s) without haul information</b> earn 0 points until a route or haul is set. <button class="btn small" data-act="goto-flights">Fix in Flights</button></div>` : '';

    host.innerHTML = `
      ${kpis}
      ${warn}
      <div class="cols">
        <div class="card">
          <div class="card-head"><h2>Status progress ${year}</h2><span class="sub">solid = flown · hatched = incl. planned flights</span></div>
          <div class="progress-list" id="progList"></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Planner</h2><span class="sub">extra segments needed on top of your forecast</span></div>
          <div id="planner"></div>
        </div>
      </div>
      <div class="cols-3" id="cumCharts"></div>
      <div class="cols">
        <div class="card">
          <div class="card-head"><h2>Costs per month ${year}</h2><span class="sub">faded = planned</span></div>
          <div class="chart" id="costChart"></div>
          <div class="legend">
            <span><i class="sq" style="--c:var(--c-flight)"></i>Flight</span>
            <span><i class="sq" style="--c:var(--c-upgrade)"></i>Upgrade</span>
            <span><i class="sq" style="--c:var(--c-co2)"></i>CO₂ compensation</span>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Segments ${year}</h2></div>
          <div id="segBreakdown"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>History &amp; forecast by calendar year</h2><span class="sub">a status is valid from the day it is reached until the end of February of the year after next; without requalification it then drops one level</span></div>
        <div class="table-wrap" id="histTable"></div>
        ${hist.length > 1 ? `<div class="chart" id="yearCost" style="margin-top:14px"></div>
          <div class="legend"><span><i class="sq" style="--c:var(--c-flight)"></i>Flight</span><span><i class="sq" style="--c:var(--c-upgrade)"></i>Upgrade</span><span><i class="sq" style="--c:var(--c-co2)"></i>CO₂ compensation</span></div>` : ''}
      </div>`;

    renderProgress(sum, rules);
    renderPlanner(sum, rules);
    renderCumCharts(sum, rules);
    renderCostChart(sum);
    renderSegments(sum);
    renderHistory(hist);
  };

  const renderProgress = (sum, rules) => {
    const t = rules.thresholds;
    const bar = (cur, fc, max, color) => `
      <div class="bar" style="--c:${color}">
        <div class="fc" style="width:${Math.min(100, (fc / max) * 100)}%"></div>
        <div class="ac" style="width:${Math.min(100, (cur / max) * 100)}%"></div>
      </div>`;
    const line = (key) => {
      const a = sum.actual, f = sum.forecast, th = t[key];
      const ra = sum.reached.actual[key], rf = sum.reached.forecast[key];
      let sub;
      if (ra) sub = `✓ Reached on ${C.fmtDate(ra)}`;
      else if (rf) {
        const r = sum.rows.find(x => x.f.date === rf && x.planned);
        sub = `Forecast: reached on ${C.fmtDate(rf)}${r ? ` with ${esc(r.f.flightNo)}` : ''}`;
      } else {
        const g = E.gap(f, key, rules);
        sub = 'Missing after plan: ' + Object.entries(g).filter(([, v]) => v > 0).map(([k, v]) => `${num(v)} ${k === 'p' ? 'Points' : k === 'qp' ? 'QP' : 'HON Points'}`).join(', ');
      }
      const bars = key === 'HON'
        ? `<div class="muted">HON Circle Points ${num(a.hon)} / ${num(th.hon)}</div>${bar(a.hon, f.hon, th.hon, 'var(--s-hon)')}`
        : `<div class="muted">Points ${num(a.p)} / ${num(th.p)}</div>${bar(a.p, f.p, th.p, 'var(--s-p)')}
           <div class="muted">Qualifying Points ${num(a.qp)} / ${num(th.qp)}</div>${bar(a.qp, f.qp, th.qp, 'var(--s-qp)')}`;
      return `<div class="prog-row">
        <div class="prog-top"><span class="name">${badge(key)}</span><span class="vals">${key === 'HON' ? `forecast ${num(f.hon)}` : `forecast ${num(f.p)} P · ${num(f.qp)} QP`}</span></div>
        ${bars}
        <div class="prog-sub">${sub}</div>
      </div>`;
    };
    $('#progList').innerHTML = ['FTL', 'SEN', 'HON'].map(line).join('');
  };

  const plannerPrefs = { target: null, haul: 'intercontinental', cls: 'Business', co2: 'none' };
  const renderPlanner = (sum, rules) => {
    const host = $('#planner');
    const target = plannerPrefs.target || ['FTL', 'SEN', 'HON'].find(k => E.rank(sum.statusForecast) < E.rank(k)) || 'HON';
    plannerPrefs.target = target;
    const n = E.segmentsNeeded(sum.forecast, target, plannerPrefs.haul, plannerPrefs.cls, plannerPrefs.co2, rules);
    const e = E.earn({ haulOverride: plannerPrefs.haul, earningGroup: 'LHG', bookedClass: plannerPrefs.cls, co2Level: plannerPrefs.co2 }, rules);
    const g = E.gap(sum.forecast, target, rules);
    const opt = (arr, cur, lab = x => x) => arr.map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(lab(v))}</option>`).join('');
    host.innerHTML = `
      <div class="grid">
        <label>Target status<select data-pl="target">${opt(['FTL', 'SEN', 'HON'], target, k => MM.STATUS_LABEL[k])}</select></label>
        <label>Haul<select data-pl="haul">${opt(['continental', 'intercontinental'], plannerPrefs.haul, h => h === 'continental' ? 'Continental' : 'Intercontinental')}</select></label>
        <label>Cabin<select data-pl="cls">${opt(MM.CLASSES, plannerPrefs.cls)}</select></label>
        <label>CO₂ booster<select data-pl="co2">${opt(MM.CO2_LEVELS, plannerPrefs.co2, l => MM.CO2_LABEL[l])}</select></label>
      </div>
      <div class="earn-preview" style="margin-top:12px">
        <div><div class="k">Per segment (Lufthansa Group)</div><b>${num(e.p)} P · ${num(e.qp)} QP · ${num(e.hon)} HON</b></div>
        <div><div class="k">Still missing after plan</div><b>${Object.entries(g).map(([k, v]) => `${num(v)} ${k.toUpperCase()}`).join(' · ')}</b></div>
        <div><div class="k">Extra segments needed</div><b style="font-size:20px">${n === Infinity ? 'not reachable' : n === 0 ? '✓ none' : n + '×'}</b></div>
      </div>
      <p class="hint">Example: a round trip counts as 2 segments. HON Circle Points are only earned in ${esc(rules.honClasses.join(' / '))}.</p>`;
    $$('[data-pl]', host).forEach(s => s.addEventListener('change', () => { plannerPrefs[s.dataset.pl] = s.value; renderPlanner(sum, rules); }));
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
        <div class="legend"><span><i style="--c:${d.color}"></i>Flown</span><span><i class="dash" style="--c:${d.color}"></i>Forecast</span><span><i style="--c:var(--accent)"></i>Today</span></div>
      </div>`).join('');
    for (const d of defs) C.cumulative($(`[data-cum="${d.key}"]`, host), { ...d, year, rows: sum.rows, today: E.todayISO() });
  };

  const costSeries = () => [
    { key: 'flight', label: 'Flight', color: cssVar('--c-flight') },
    { key: 'upgrade', label: 'Upgrade', color: cssVar('--c-upgrade') },
    { key: 'co2', label: 'CO₂ compensation', color: cssVar('--c-co2') },
  ];

  const renderCostChart = (sum) => {
    const data = C.MONTHS.map(() => ({ flight: 0, upgrade: 0, co2: 0, planned: 0, n: 0 }));
    for (const r of sum.rows) {
      if (!r.counts) continue;
      const mIdx = +r.f.date.slice(5, 7) - 1;
      const d = data[mIdx];
      d.flight += r.c.flight; d.upgrade += r.c.upgrade; d.co2 += r.c.co2; d.n++;
      if (r.planned) d.planned += r.c.total;
    }
    C.stackedBars($('#costChart'), {
      label: 'Costs per month', categories: C.MONTHS.map(m => m[0] + m.slice(1, 3)), series: costSeries(), data,
      format: (v, axis) => money(v, axis || true),
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
        <tbody>${list.map(g => `<tr style="cursor:default"><td>${esc(g.cls)}</td><td>${haulTxt(g.haul)}</td><td class="num">${g.flown}</td><td class="num">${g.planned}</td>
          <td class="num">${num(g.p)}</td><td class="num">${num(g.qp)}</td><td class="num">${num(g.hon)}</td><td class="num">${money(g.cost, true)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">${lhg} Lufthansa Group segment(s) · ${star} Star Alliance segment(s) (Points only)</p>` : '<p class="muted">No segments in this year.</p>';
  };

  const renderHistory = (hist) => {
    const rows = hist.slice().reverse().map(h => {
      const total = h.cost.actual.total + h.cost.plan.total;
      const hasPlan = h.rows.some(r => r.planned && r.counts);
      return `<tr data-year="${h.year}" ${h.year === year ? 'style="font-weight:600"' : ''}>
        <td>${h.year}</td>
        <td class="num">${h.rows.filter(r => !r.planned).length}${hasPlan ? ` <span class="muted">+${h.rows.filter(r => r.planned && r.counts).length}</span>` : ''}</td>
        <td class="num">${num(h.actual.p)}${hasPlan ? ` <span class="muted">→ ${num(h.forecast.p)}</span>` : ''}</td>
        <td class="num">${num(h.actual.qp)}${hasPlan ? ` <span class="muted">→ ${num(h.forecast.qp)}</span>` : ''}</td>
        <td class="num">${num(h.actual.hon)}${hasPlan ? ` <span class="muted">→ ${num(h.forecast.hon)}</span>` : ''}</td>
        <td>${badge(h.statusActual)}${hasPlan && h.statusForecast !== h.statusActual ? ` <span class="muted">→</span> ${badge(h.statusForecast)}` : ''}</td>
        <td>${h.statusActual !== 'NONE' || h.statusForecast !== 'NONE' ? C.fmtDate(E.validUntil(h.year)) : '–'}</td>
        <td>${badge(h.held)}${h.downgraded ? `<div class="muted">${downgradeTxt(h)}</div>` : ''}</td>
        <td class="num">${money(total, true)}${hasPlan ? ` <span class="muted">(${money(h.cost.plan.total, true)} plan)</span>` : ''}</td>
        <td class="num">${h.forecast.qp ? money(total / h.forecast.qp) : '–'}</td>
      </tr>`;
    }).join('');
    $('#histTable').innerHTML = `<table>
      <thead><tr><th>CY</th><th class="num">Segments</th><th class="num">Points</th><th class="num">QP</th><th class="num">HON</th><th>Status earned</th><th>Valid until</th><th>Status held</th><th class="num">Cost</th><th class="num">Cost / QP</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
    $$('#histTable tr[data-year]').forEach(tr => tr.addEventListener('click', () => { year = +tr.dataset.year; render(); }));
    const yc = $('#yearCost');
    if (yc) {
      const data = hist.map(h => {
        const d = { flight: 0, upgrade: 0, co2: 0 };
        for (const r of h.rows) if (r.counts) { d.flight += r.c.flight; d.upgrade += r.c.upgrade; d.co2 += r.c.co2; }
        return d;
      });
      C.stackedBars(yc, {
        label: 'Costs per year', categories: hist.map(h => String(h.year)), series: costSeries(), data,
        format: (v) => money(v, true),
        note: (i) => `<div class="row muted"><span>Status earned</span><span>${esc(MM.STATUS_LABEL[hist[i].statusForecast])}</span></div>`,
      });
    }
  };

  /* ================= flights view ================= */
  const renderFlights = () => {
    const host = $('#view-flights');
    const sum = E.yearSummary(state, year);
    const showCO2 = sum.rows.some(r => r.f.co2Level && r.f.co2Level !== 'none');
    const flown = sum.rows.filter(r => !r.planned), planned = sum.rows.filter(r => r.planned);
    const missing = sum.rows.filter(r => !r.f.route || r.e.unknown).length;
    const cols = 15 + (showCO2 ? 2 : 0);

    const row = (r) => {
      const f = r.f, up = f.upgradeClass && f.upgradeClass !== f.bookedClass;
      return `<tr data-id="${f.id}" class="${r.planned ? 'planned' : ''} ${r.counts ? '' : 'excluded'}">
        <td class="num" style="text-align:left">${C.fmtDate(f.date)}</td>
        <td><b>${esc(f.flightNo)}</b></td>
        <td>${esc(E.airlineName(f))}<div class="muted">${E.operating(f) ? `op. by ${esc(E.operating(f).name)} · ` : ''}${esc(MM.GROUP_LABEL[r.e.group])}</div></td>
        <td><code>${esc(f.bookingCode || '–')}</code></td>
        <td><span class="route">${routeTxt(f)}</span>${f.route && f.route.source === 'manual' ? '<div class="muted">manual</div>' : ''}</td>
        <td>${haulTxt(r.e.haul)}${f.haulOverride && f.haulOverride !== 'auto' ? '<div class="muted">override</div>' : ''}</td>
        <td class="cls">${esc(f.bookedClass)}</td>
        <td class="cls ${up ? 'up' : ''}">${esc(f.upgradeClass || f.bookedClass)}</td>
        <td>${up ? (f.upgradePaid ? 'Yes' : 'No') : '–'}</td>
        ${showCO2 ? `<td>${f.co2Level && f.co2Level !== 'none' ? esc(MM.CO2_LABEL[f.co2Level]) : '–'}</td>` : ''}
        <td class="num">${num(r.e.p)}</td><td class="num">${num(r.e.qp)}</td><td class="num">${num(r.e.hon)}</td>
        <td class="num">${money(r.c.flight)}</td><td class="num">${up ? money(r.c.upgrade) : '–'}</td>
        ${showCO2 ? `<td class="num">${f.co2Level && f.co2Level !== 'none' ? money(r.c.co2) : '–'}</td>` : ''}
        <td>${r.planned ? `<span class="pill planned">${r.counts ? 'Planned' : 'Excluded'}</span>` : '<span class="pill">Flown</span>'}</td>
      </tr>`;
    };
    const tot = (rs) => rs.reduce((a, r) => {
      if (!r.counts) return a;
      a.p += r.e.p; a.qp += r.e.qp; a.hon += r.e.hon; a.flight += r.c.flight; a.upgrade += r.c.upgrade; a.co2 += r.c.co2;
      return a;
    }, { p: 0, qp: 0, hon: 0, flight: 0, upgrade: 0, co2: 0 });
    const footRow = (label, t) => `<tr><td colspan="${showCO2 ? 10 : 9}">${label}</td>
      <td class="num">${num(t.p)}</td><td class="num">${num(t.qp)}</td><td class="num">${num(t.hon)}</td>
      <td class="num">${money(t.flight)}</td><td class="num">${money(t.upgrade)}</td>${showCO2 ? `<td class="num">${money(t.co2)}</td>` : ''}
      <td class="num">${money(t.flight + t.upgrade + t.co2)}</td></tr>`;

    host.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h2>Flights · CY ${year}</h2>
          <span class="sub">${flown.length} flown · ${planned.length} planned · flights after today are planned automatically · click a row to edit</span>
          <div class="right">
            ${missing ? `<button class="btn small" data-act="lookup-missing">Look up ${missing} missing route(s)</button>` : ''}
            <button class="btn primary" data-act="add">+ Add flight</button>
          </div>
        </div>
        ${sum.rows.length ? `<div class="table-wrap"><table>
          <thead><tr>
            <th>Date</th><th>Flight</th><th>Airline</th><th>Booking</th><th>Route</th><th>Haul</th><th>Booked</th><th>Upgrade</th><th>Upg. paid</th>
            ${showCO2 ? '<th>CO₂</th>' : ''}
            <th class="num">P</th><th class="num">QP</th><th class="num">HON</th><th class="num">Flight cost</th><th class="num">Upgrade cost</th>
            ${showCO2 ? '<th class="num">CO₂ cost</th>' : ''}<th></th>
          </tr></thead>
          <tbody>
            ${flown.length ? `<tr class="sep-row"><td colspan="${cols}">Flown</td></tr>${flown.map(row).join('')}` : ''}
            ${planned.length ? `<tr class="sep-row"><td colspan="${cols}">Planned (forecast)</td></tr>${planned.map(row).join('')}` : ''}
          </tbody>
          <tfoot>
            ${footRow('Flown total', tot(flown))}
            ${planned.length ? footRow('Incl. planned', tot(sum.rows)) : ''}
          </tfoot>
        </table></div>` : `<div class="empty"><h2>No flights in ${year}</h2><p>Add a flown or planned segment to start tracking.</p>
          <div class="btns"><button class="btn primary" data-act="add">Add flight</button>${state.flights.length ? '' : '<button class="btn" data-act="demo">Load demo data</button>'}</div></div>`}
      </div>`;
    $$('tbody tr[data-id]', host).forEach(tr => tr.addEventListener('click', () => openDialog(state.flights.find(f => f.id === tr.dataset.id))));
  };

  /* ================= settings view ================= */
  const renderSettings = () => {
    const r = state.settings.rules;
    const host = $('#view-settings');
    const cacheN = Object.keys(state.apiCache).length;
    const cacheOk = Object.values(state.apiCache).filter(c => c.status === 'ok').length;
    host.innerHTML = `
      <div class="settings-grid">
        <div class="card">
          <div class="card-head"><h2>Points per segment</h2><span class="sub">Lufthansa Group: Points = Qualifying Points</span></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Cabin</th><th class="num">Continental</th><th class="num">Intercontinental</th><th>HON Points</th></tr></thead>
            <tbody>${MM.CLASSES.map(c => `<tr style="cursor:default"><td>${c}</td>
              <td class="num"><input type="number" min="0" data-rule="points.continental.${c}" value="${r.points.continental[c]}"></td>
              <td class="num"><input type="number" min="0" data-rule="points.intercontinental.${c}" value="${r.points.intercontinental[c]}"></td>
              <td><input type="checkbox" data-hon="${c}" ${r.honClasses.includes(c) ? 'checked' : ''} aria-label="HON Circle Points in ${c}"></td></tr>`).join('')}</tbody>
          </table></div>
          <p class="hint">Star Alliance partners earn Points only (no QP / HON). Other airlines earn nothing.</p>
        </div>
        <div class="card">
          <div class="card-head"><h2>Status thresholds</h2><span class="sub">per calendar year</span></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Status</th><th class="num">Points</th><th class="num">QP</th><th class="num">HON Points</th></tr></thead>
            <tbody>
              <tr style="cursor:default"><td>${badge('FTL')}</td><td class="num"><input type="number" min="0" data-rule="thresholds.FTL.p" value="${r.thresholds.FTL.p}"></td><td class="num"><input type="number" min="0" data-rule="thresholds.FTL.qp" value="${r.thresholds.FTL.qp}"></td><td></td></tr>
              <tr style="cursor:default"><td>${badge('SEN')}</td><td class="num"><input type="number" min="0" data-rule="thresholds.SEN.p" value="${r.thresholds.SEN.p}"></td><td class="num"><input type="number" min="0" data-rule="thresholds.SEN.qp" value="${r.thresholds.SEN.qp}"></td><td></td></tr>
              <tr style="cursor:default"><td>${badge('HON')}</td><td></td><td></td><td class="num"><input type="number" min="0" data-rule="thresholds.HON.hon" value="${r.thresholds.HON.hon}"></td></tr>
            </tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>CO₂ compensation boosters</h2><span class="sub">bonus in % of the segment's base value</span></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Level</th><th class="num">Points %</th><th class="num">QP %</th><th class="num">HON %</th></tr></thead>
            <tbody>${MM.CO2_LEVELS.filter(l => l !== 'none').map(l => `<tr style="cursor:default"><td>${MM.CO2_LABEL[l]}</td>
              ${['p', 'qp', 'hon'].map(k => `<td class="num"><input type="number" min="0" data-rule="co2.${l}.${k}" value="${r.co2[l][k]}"></td>`).join('')}</tr>`).join('')}</tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Data</h2></div>
          <div class="grid">
            <label>Currency<select id="currency">${['EUR', 'CHF', 'USD', 'GBP'].map(c => `<option ${c === state.settings.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          </div>
          <p class="hint">Data is kept in this browser (localStorage) and can be saved / loaded as <code>.json</code>.
            The file contains your flights, these settings and the cached route lookups
            (${cacheN} flight number${cacheN === 1 ? '' : 's'}, ${cacheOk} with route) – so loading it never re-queries the API.</p>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
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
  };

  /* ================= flight dialog ================= */
  const dlg = $('#flightDialog'), form = $('#flightForm');
  let draft = null, isNew = false, upgradeTouched = false, lookupSeq = 0;

  const fillSelects = () => {
    const opts = MM.CLASSES.map(c => `<option>${c}</option>`).join('');
    form.bookedClass.innerHTML = opts;
    form.upgradeClass.innerHTML = opts;
    form.co2Level.innerHTML = MM.CO2_LEVELS.map(l => {
      const b = state.settings.rules.co2[l];
      return `<option value="${l}">${MM.CO2_LABEL[l]}${b ? ` (+${b.p}% P, +${b.qp}% QP, +${b.hon}% HON)` : ''}</option>`;
    }).join('');
  };

  /** Known airport details from the API cache or the bundled table. */
  const airportInfo = (iata) => {
    iata = (iata || '').toUpperCase();
    for (const c of Object.values(state.apiCache)) {
      const fr = c.status === 'ok' && c.response && c.response.flightroute;
      if (!fr) continue;
      for (const a of [fr.origin, fr.destination]) if (a && a.iata_code === iata) {
        return { iata, icao: a.icao_code, name: a.name, city: a.municipality, country: a.country_iso_name, countryName: a.country_name, lat: a.latitude, lon: a.longitude };
      }
    }
    return MM.AIRPORTS[iata] ? { ...MM.AIRPORTS[iata] } : { iata, country: null, lat: null, lon: null };
  };

  const routeInfo = () => {
    const info = $('#routeInfo');
    const r = draft.route, lk = draft.routeLookup;
    if (r && r.origin && r.destination) {
      const km = E.distanceKm(r.origin, r.destination);
      const name = a => esc([a.city || a.name, a.country].filter(Boolean).join(', ') || a.iata);
      const src = r.source === 'manual' ? 'entered manually' : `from adsbdb.com${r.via ? ` via ${esc(r.via)}` : ''}${lk && lk.source === 'cache' ? ' (cached)' : ''}`;
      const unknown = !r.origin.country || !r.destination.country;
      info.innerHTML = `${name(r.origin)} → ${name(r.destination)}${km ? ` · ${num(km)} km` : ''} · <span class="muted">${src}</span>` +
        (unknown ? '<br><b style="color:var(--danger)">Airport unknown – please choose the haul manually.</b>' : '');
    } else if (lk && lk.status === 'loading') {
      info.textContent = 'Looking up route…';
    } else if (lk && lk.status === 'notfound') {
      info.innerHTML = '<b>Route not found</b> for this flight number – enter the airports manually and/or choose the haul.';
    } else if (lk && lk.status === 'error') {
      info.innerHTML = `<b style="color:var(--danger)">Lookup failed</b> (${esc(lk.error || 'network error')}). Try again or enter the airports manually.`;
    } else {
      info.textContent = 'Route is looked up automatically from the flight number (adsbdb.com). Results are cached in your .json.';
    }
    info.insertAdjacentHTML('beforeend', operatingInfo());
  };

  /** Second line in the route box for codeshares: operator, its earning group and a route cross-check. */
  const operatingInfo = () => {
    const op = E.operating(draft);
    if (!op) return '';
    const head = `Operated by <b>${esc(op.name)}</b> as ${esc(op.iata)} · ${esc(MM.GROUP_LABEL[op.group])}`;
    const entry = state.apiCache[op.iata];
    const opRoute = A.routeFromCache(entry);
    const r = draft.route;
    let check = '';
    if (entry && entry.status === 'loading') check = ' · checking route…';
    else if (opRoute && r && r.origin && r.destination) {
      const same = opRoute.origin.iata === r.origin.iata && opRoute.destination.iata === r.destination.iata;
      check = same ? ' · <span style="color:var(--s-hon)">✓ same route</span>'
        : ` · <b style="color:var(--danger)">⚠ ${esc(op.iata)} is listed as ${esc(opRoute.origin.iata)}→${esc(opRoute.destination.iata)}</b>`;
    } else if (entry && entry.status === 'notfound') check = ` · route of ${esc(op.iata)} unknown`;
    return `<br>${head}${check}`;
  };

  /** Looks up the operating flight (cached like any other lookup); uses its route when the marketing number has none. */
  const lookupOperating = async () => {
    const op = E.operating(draft);
    if (!op) { updatePreview(); return; }
    const entry = await A.lookup(state, op.iata);
    if (!dlg.open || !E.operating(draft) || E.operating(draft).iata !== op.iata) return;
    const route = A.routeFromCache(entry);
    if (route && !(draft.route && draft.route.origin && draft.route.destination)) {
      draft.route = { ...route, via: op.iata };
      draft.routeLookup = { queried: true, status: 'ok', fetchedAt: entry.fetchedAt, source: entry.fromCache ? 'cache' : 'api', flightNo: draft.flightNo, via: op.iata };
      form.origin.value = route.origin.iata || '';
      form.destination.value = route.destination.iata || '';
    }
    save();
    updatePreview();
  };

  /* Date field shows YYYY/MM/DD; the model stores ISO YYYY-MM-DD. */
  const dateToISO = (txt) => {
    const m = String(txt || '').trim().match(/^(\d{4})[/.\-]?(\d{1,2})[/.\-]?(\d{1,2})$/);
    if (!m) return '';
    const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const d = new Date(iso + 'T00:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === iso ? iso : '';
  };
  const dateToField = (iso) => (iso ? iso.replace(/-/g, '/') : '');

  const readForm = () => {
    const parsed = E.parseFlightNo(form.flightNo.value);
    const opParsed = E.parseFlightNo(form.operatingFlightNo.value);
    Object.assign(draft, {
      operatingFlightNo: opParsed ? opParsed.iata : form.operatingFlightNo.value.toUpperCase().replace(/\s/g, ''),
      date: dateToISO(form.date.value),
      flightNo: parsed ? parsed.iata : form.flightNo.value.toUpperCase().replace(/\s/g, ''),
      airlineCode: parsed ? parsed.code : '',
      airlineName: parsed && parsed.airline ? parsed.airline.name : (draft.route && draft.route.airlineName) || (parsed ? parsed.code : ''),
      bookingCode: form.bookingCode.value.toUpperCase().trim(),
      haulOverride: form.haulOverride.value,
      earningGroup: form.earningGroup.value,
      bookedClass: form.bookedClass.value,
      upgradeClass: form.upgradeClass.value,
      upgradePaid: form.upgradePaid.checked,
      flightCost: +form.flightCost.value || 0,
      upgradeCost: +form.upgradeCost.value || 0,
      co2Level: form.co2Level.value,
      co2Cost: +form.co2Cost.value || 0,
      includeInPlan: form.includeInPlan.checked,
      notes: form.notes.value.trim(),
    });
  };

  const updatePreview = () => {
    readForm();
    form.airlineName.value = draft.flightNo ? (draft.airlineName ? `${draft.airlineName} · earns as ${MM.GROUP_LABEL[E.earningGroup(draft)]}` : 'Unknown airline') : '';
    $('[data-co2-only]', form).hidden = draft.co2Level === 'none';
    const planned = !!draft.date && E.isPlanned(draft);
    $('[data-plan-only]', form).hidden = !planned;
    const st = $('#dateStatus');
    st.className = 'pill' + (draft.date ? (planned ? ' planned' : '') : ' warn');
    st.textContent = draft.date ? (planned ? 'Planned' : 'Flown') : (form.date.value.trim() ? 'Invalid date' : 'Date required');
    const upgraded = draft.upgradeClass !== draft.bookedClass;
    form.upgradeCost.disabled = !upgraded;
    form.upgradePaid.disabled = !upgraded;
    const e = E.earn(draft, state.settings.rules);
    const c = E.cost(draft);
    $('#earnPreview').innerHTML = `
      <div><div class="k">Earning basis</div><b>${esc(e.cls)} · ${e.haul ? (e.haul === 'continental' ? 'Continental' : 'Intercontinental') : 'haul unknown'}</b></div>
      <div><div class="k">Points</div><b>${num(e.p)}</b></div>
      <div><div class="k">Qualifying Points</div><b>${num(e.qp)}</b></div>
      <div><div class="k">HON Circle Points</div><b>${num(e.hon)}</b></div>
      <div><div class="k">Total cost</div><b>${money(c.total)}</b></div>
      <div><div class="k">Type</div><b>${!draft.date ? '–' : planned ? 'Planned (date after today)' : 'Flown'}</b></div>`;
    routeInfo();
  };

  const applyLookup = (entry, flightNo) => {
    draft.routeLookup = { queried: true, status: entry.status, fetchedAt: entry.fetchedAt, source: entry.fromCache ? 'cache' : 'api', flightNo, error: entry.error };
    const route = A.routeFromCache(entry);
    if (route) {
      draft.route = route;
      form.origin.value = route.origin.iata || '';
      form.destination.value = route.destination.iata || '';
      if (!MM.AIRLINES[draft.airlineCode] && route.airlineName) draft.airlineName = route.airlineName;
    }
    save();
    updatePreview();
  };

  const doLookup = async (force) => {
    readForm();
    const parsed = E.parseFlightNo(form.flightNo.value);
    if (!parsed) { toast('Enter a flight number like LH400'); return; }
    const seq = ++lookupSeq;
    draft.routeLookup = { status: 'loading' };
    routeInfo();
    const entry = await A.lookup(state, parsed.iata, { force });
    if (seq !== lookupSeq || !dlg.open) return;
    applyLookup(entry, parsed.iata);
    if (entry.status !== 'ok' && E.operating(draft)) await lookupOperating();
    if (force && !entry.fromCache) toast(draft.route ? 'Route updated from API' : 'No route found');
  };

  const autoLookup = () => {
    const parsed = E.parseFlightNo(form.flightNo.value);
    if (!parsed) return;
    const known = draft.routeLookup && draft.routeLookup.flightNo === parsed.iata && draft.route;
    if (known || (draft.route && draft.route.source === 'manual')) return;
    doLookup(false);
  };

  const manualAirport = () => {
    const o = form.origin.value.trim().toUpperCase(), d = form.destination.value.trim().toUpperCase();
    if (o.length === 3 && d.length === 3) {
      const cur = draft.route;
      if (!cur || cur.origin.iata !== o || cur.destination.iata !== d) {
        draft.route = { origin: airportInfo(o), destination: airportInfo(d), source: 'manual' };
      }
    } else if (!o && !d) {
      draft.route = null;
    }
    updatePreview();
  };

  const openDialog = (flight) => {
    fillSelects();
    isNew = !flight;
    if (flight) draft = JSON.parse(JSON.stringify(flight));
    else {
      let iso = E.todayISO();
      if (+iso.slice(0, 4) !== year) iso = year > +iso.slice(0, 4) ? `${year}-01-15` : `${year}-06-15`;
      draft = S.newFlight(iso);
    }
    upgradeTouched = !!flight && flight.upgradeClass !== flight.bookedClass;
    $('#dlgTitle').textContent = isNew ? 'Add flight' : `Edit ${draft.flightNo}`;
    form.date.value = dateToField(draft.date);
    form.flightNo.value = draft.flightNo;
    form.operatingFlightNo.value = draft.operatingFlightNo || '';
    form.bookingCode.value = draft.bookingCode;
    form.origin.value = draft.route && draft.route.origin ? draft.route.origin.iata : '';
    form.destination.value = draft.route && draft.route.destination ? draft.route.destination.iata : '';
    form.haulOverride.value = draft.haulOverride || 'auto';
    form.earningGroup.value = draft.earningGroup || 'auto';
    form.bookedClass.value = draft.bookedClass;
    form.upgradeClass.value = draft.upgradeClass || draft.bookedClass;
    form.upgradePaid.checked = !!draft.upgradePaid;
    form.flightCost.value = draft.flightCost || '';
    form.upgradeCost.value = draft.upgradeCost || '';
    form.co2Level.value = draft.co2Level || 'none';
    form.co2Cost.value = draft.co2Cost || '';
    form.includeInPlan.checked = draft.includeInPlan !== false;
    form.notes.value = draft.notes || '';
    const del = $('#btnDelete');
    del.hidden = isNew; del.textContent = 'Delete'; del.dataset.armed = '';
    updatePreview();
    dlg.showModal();
    (isNew ? form.date : form.flightNo).focus();
  };

  // Date field: auto-insert slashes while typing, normalise on blur, calendar via a hidden native picker.
  const datePicker = $('#datePicker');
  form.date.addEventListener('input', (e) => {
    if (!e.inputType || !e.inputType.startsWith('insert')) return;
    const digits = form.date.value.replace(/\D/g, '').slice(0, 8);
    form.date.value = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(Boolean).join('/');
  });
  form.date.addEventListener('blur', () => {
    const iso = dateToISO(form.date.value);
    if (iso) form.date.value = dateToField(iso);
  });
  $('#btnDatePick').addEventListener('click', () => {
    datePicker.value = dateToISO(form.date.value) || E.todayISO();
    try { datePicker.showPicker(); } catch { datePicker.focus(); datePicker.click(); }
  });
  datePicker.addEventListener('change', () => {
    if (!datePicker.value) return;
    form.date.value = dateToField(datePicker.value);
    updatePreview();
    form.date.focus();
  });

  form.addEventListener('input', (e) => {
    if (e.target === datePicker) return;
    if (e.target.name === 'upgradeClass') upgradeTouched = form.upgradeClass.value !== form.bookedClass.value;
    if (e.target.name === 'origin' || e.target.name === 'destination') { manualAirport(); return; }
    updatePreview();
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'bookedClass' && !upgradeTouched) { form.upgradeClass.value = form.bookedClass.value; updatePreview(); }
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
      if (draft.route && draft.route.via && (!parsed || parsed.iata !== draft.route.via)) {
        draft.route = null; form.origin.value = ''; form.destination.value = '';
      }
      readForm();
      lookupOperating();
    }
  });
  $('#btnLookup').addEventListener('click', () => {
    draft.route = null;
    doLookup(true);
  });
  $$('[data-close]', dlg).forEach(b => b.addEventListener('click', () => dlg.close()));
  $('#btnDelete').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Click again to delete'; return; }
    state.flights = state.flights.filter(f => f.id !== draft.id);
    save(); dlg.close(); toast('Flight deleted'); render();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    readForm();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) { toast('Please enter the flight date as YYYY/MM/DD'); form.date.focus(); return; }
    if (!E.parseFlightNo(draft.flightNo)) { toast('Please enter a valid flight number, e.g. LH400'); form.flightNo.focus(); return; }
    if (!draft.route && !(draft.routeLookup && draft.routeLookup.queried && draft.routeLookup.flightNo === draft.flightNo)) {
      const entry = await A.lookup(state, draft.flightNo);
      applyLookup(entry, draft.flightNo);
    }
    if (!draft.upgradeClass) draft.upgradeClass = draft.bookedClass;
    const flight = JSON.parse(JSON.stringify(draft));
    if (flight.routeLookup && flight.routeLookup.status === 'loading') flight.routeLookup = null;
    const i = state.flights.findIndex(f => f.id === flight.id);
    i >= 0 ? (state.flights[i] = flight) : state.flights.push(flight);
    year = +flight.date.slice(0, 4);
    save(); dlg.close();
    toast(isNew ? 'Flight added' : 'Flight saved');
    render();
  });

  /* ================= global actions ================= */
  const lookupMissing = async () => {
    const todo = state.flights.filter(f => +f.date.slice(0, 4) === year && !f.route);
    let ok = 0;
    for (const f of todo) {
      const entry = await A.lookup(state, f.flightNo);
      f.routeLookup = { queried: true, status: entry.status, fetchedAt: entry.fetchedAt, source: entry.fromCache ? 'cache' : 'api', flightNo: f.flightNo };
      const r = A.routeFromCache(entry);
      if (r) { f.route = r; ok++; }
    }
    save(); render();
    toast(`${ok} of ${todo.length} route(s) found`);
  };

  const confirmInline = (btn, label, fn) => {
    if (btn.dataset.armed) { fn(); return; }
    btn.dataset.armed = '1';
    const old = btn.textContent;
    btn.textContent = label;
    setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = old; } }, 4000);
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'add') openDialog(null);
    if (act === 'goto-flights') setView('flights');
    if (act === 'load') $('#fileLoad').click();
    if (act === 'lookup-missing') lookupMissing();
    if (act === 'demo') {
      const go = () => { state = S.demo(); year = new Date().getFullYear(); save(); render(); toast('Demo data loaded'); };
      state.flights.length ? confirmInline(b, 'Replace all data? Click again', go) : go();
    }
    if (act === 'reset-rules') { state.settings.rules = JSON.parse(JSON.stringify(MM.DEFAULT_RULES)); save(); render(); toast('Rules reset to defaults'); }
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
      const ys = E.years(state.flights);
      if (!ys.includes(year)) year = ys[ys.length - 1];
      save(); render();
      toast(`Loaded ${state.flights.length} flight(s) · ${Object.keys(state.apiCache).length} cached route lookup(s)`);
    } catch (err) {
      toast('Could not load file: ' + err.message);
    }
  });
  let resizeT;
  window.addEventListener('resize', () => {
    C.hideTip();
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (view === 'dashboard' && !dlg.open) renderDashboard(); }, 150);
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

  let startView = 'dashboard';
  try { startView = localStorage.getItem('mm-status-tracker:view') || 'dashboard'; } catch { /* ignore */ }
  setView(['dashboard', 'flights', 'settings'].includes(startView) ? startView : 'dashboard');
})();
