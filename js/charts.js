/* Tiny dependency-free SVG charts with hover tooltips. */
(function () {
  const C = (MM.charts = {});
  const NS = 'http://www.w3.org/2000/svg';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  C.MONTHS = MONTHS;

  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const fmt = (v) => Math.round(v).toLocaleString('en-US');
  /** HTML-escapes text (also used by app.js). */
  const esc = (C.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  /* ---------- tooltip ---------- */
  const tip = () => document.getElementById('tooltip');
  C.showTip = (html, evt) => {
    const t = tip();
    t.innerHTML = html;
    t.hidden = false;
    const pad = 14, w = t.offsetWidth, h = t.offsetHeight;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + w > innerWidth - 8) x = evt.clientX - w - pad;
    if (y + h > innerHeight - 8) y = evt.clientY - h - pad;
    t.style.left = Math.max(8, x) + 'px';
    t.style.top = Math.max(8, y) + 'px';
  };
  C.hideTip = () => { tip().hidden = true; };

  /** Nice tick step for a max value. */
  const ticks = (max, count = 4) => {
    if (max <= 0) return [0];
    const raw = max / count, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
    const out = [];
    for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
    if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
    return out;
  };

  const dayOfYear = (iso, year) => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(year, 0, 1)) / 864e5;
  const isoOfDay = (d, year) => new Date(Date.UTC(year, 0, 1) + Math.round(d) * 864e5).toISOString().slice(0, 10);
  C.fmtDate = (iso) => {
    if (!iso) return '–';
    const [y, m, d] = iso.split('-');
    return `${+d} ${MONTHS[+m - 1]} ${y}`;
  };

  /**
   * Cumulative progress across one calendar year (step line).
   * opts: { year, key: 'p'|'qp'|'hon', color, label, rows (from engine.yearSummary), thresholds:[{v,label}], today }
   */
  C.cumulative = (host, opts) => {
    host.innerHTML = '';
    const W = Math.max(280, Math.round(host.clientWidth || 560)), H = 220, m = { l: 44, r: 12, t: 14, b: 26 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const year = opts.year, days = dayOfYear(`${year}-12-31`, year) + 1;
    const todayD = opts.today.slice(0, 4) == year ? dayOfYear(opts.today, year) : (+opts.today.slice(0, 4) > year ? days : -1);

    // Build actual and forecast step series as [{d, v, rows:[...]}]
    const k = opts.key;
    const act = [{ d: 0, v: 0 }], fc = [];
    let a = 0, f = 0, lastAct = 0;
    for (const r of opts.rows) {
      const d = dayOfYear(r.f.date, year);
      if (!r.planned) { a += r.e[k]; act.push({ d, v: a, r }); lastAct = a; }
      if (r.counts) {
        f += r.e[k];
        if (r.planned) fc.push({ d, v: f, r });
      }
    }
    const endAct = Math.min(Math.max(todayD, 0), days);
    const maxV = Math.max(f, a, ...opts.thresholds.map(t => t.v)) * 1.08 || 10;
    const yt = ticks(maxV);
    const yMax = yt[yt.length - 1];
    const X = d => m.l + (d / days) * iw;
    const Y = v => m.t + ih - (v / yMax) * ih;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${opts.label} cumulative ${year}` }, host);
    for (const v of yt) {
      el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'gridline' }, svg);
      el('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end' }, svg).textContent = fmt(v);
    }
    for (let i = 0; i < 12; i++) {
      const d = dayOfYear(`${year}-${String(i + 1).padStart(2, '0')}-01`, year);
      el('text', { x: X(d + 15), y: H - 8, 'text-anchor': 'middle' }, svg).textContent = iw < 420 ? MONTHS[i][0] : MONTHS[i];
      if (i) el('line', { x1: X(d), x2: X(d), y1: m.t + ih, y2: m.t + ih + 4, class: 'axis' }, svg);
    }
    el('line', { x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih, class: 'axis' }, svg);
    for (const t of opts.thresholds) {
      el('line', { x1: m.l, x2: W - m.r, y1: Y(t.v), y2: Y(t.v), class: 'thr' }, svg);
      el('text', { x: m.l + 4, y: Y(t.v) - 5, 'text-anchor': 'start', class: 'lbl' }, svg).textContent = `${t.label} ${fmt(t.v)}`;
    }
    if (todayD >= 0 && todayD < days) el('line', { x1: X(todayD), x2: X(todayD), y1: m.t, y2: m.t + ih, class: 'today' }, svg);

    // actual path
    let p = `M${X(0)},${Y(0)}`;
    for (const s of act.slice(1)) p += `H${X(s.d)}V${Y(s.v)}`;
    p += `H${X(endAct)}`;
    el('path', { d: p, fill: 'none', stroke: opts.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
    // forecast path (dashed) from today onward
    if (todayD < days) {
      let q = `M${X(endAct)},${Y(lastAct)}`;
      for (const s of fc) { q += `H${X(Math.max(s.d, endAct))}V${Y(s.v)}`; }
      q += `H${X(days)}`;
      el('path', { d: q, fill: 'none', stroke: opts.color, 'stroke-width': 2, 'stroke-dasharray': '5 4', opacity: 0.85 }, svg);
    }
    // markers for flights
    for (const s of act.slice(1)) el('circle', { cx: X(s.d), cy: Y(s.v), r: 3.2, fill: opts.color, stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
    for (const s of fc) el('circle', { cx: X(s.d), cy: Y(s.v), r: 3.2, fill: 'var(--surface)', stroke: opts.color, 'stroke-width': 2 }, svg);

    // hover layer
    const cross = el('line', { y1: m.t, y2: m.t + ih, class: 'cross', visibility: 'hidden' }, svg);
    const dot = el('circle', { r: 4.5, fill: opts.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, svg);
    const hit = el('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' }, svg);
    const valueAt = (d) => {
      let va = 0, vf = 0;
      const on = [];
      for (const r of opts.rows) {
        const rd = dayOfYear(r.f.date, year);
        if (rd > d) break;
        if (!r.planned) va += r.e[k];
        if (r.counts) vf += r.e[k];
        if (rd === d) on.push(r);
      }
      return { va, vf, on };
    };
    const move = (evt) => {
      const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
      const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
      const d = Math.max(0, Math.min(days - 1, Math.round(((loc.x - m.l) / iw) * days)));
      const { va, vf, on } = valueAt(d);
      const future = d > todayD;
      const v = future ? vf : va;
      cross.setAttribute('x1', X(d)); cross.setAttribute('x2', X(d)); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', X(d)); dot.setAttribute('cy', Y(v)); dot.setAttribute('visibility', 'visible');
      let html = `<b>${C.fmtDate(isoOfDay(d, year))}${future ? ' · forecast' : ''}</b>` +
        `<div class="row"><span><i style="--c:${opts.color}"></i>${opts.label}</span><b>${fmt(v)}</b></div>`;
      for (const t of opts.thresholds) html += `<div class="row muted"><span>to ${t.label}</span><span>${v >= t.v ? '✓ reached' : fmt(t.v - v)}</span></div>`;
      for (const r of on) {
        const label = r.adj ? `Correction: ${esc(r.adj.remark)}`
          : r.stay ? `Marriott: ${esc(r.stay.hotel || 'hotel stay')}`
          : `${esc(r.f.flightNo)} ${r.f.route ? esc(r.f.route.origin.iata + '→' + r.f.route.destination.iata) : ''}`;
        html += `<div class="row muted"><span>${label}</span><span>${r.e[k] < 0 ? '' : '+'}${fmt(r.e[k])}</span></div>`;
      }
      C.showTip(html, evt);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); C.hideTip(); });
  };

  /**
   * Stacked vertical bars.
   * opts: { categories:[label], series:[{key,label,color}], data:[{key:value,...}], format(v), note(i) }
   */
  C.stackedBars = (host, opts) => {
    host.innerHTML = '';
    const W = Math.max(280, Math.round(host.clientWidth || 560)), H = 240, m = { l: 58, r: 10, t: 12, b: 26 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const n = opts.categories.length;
    const totals = opts.data.map(d => opts.series.reduce((s, x) => s + (d[x.key] || 0), 0));
    const yt = ticks(Math.max(...totals, 1) * 1.05);
    const yMax = yt[yt.length - 1];
    const Y = v => m.t + ih - (v / yMax) * ih;
    const band = iw / n, bw = Math.min(42, band * 0.62);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.label || 'bar chart' }, host);
    for (const v of yt) {
      el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'gridline' }, svg);
      el('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end' }, svg).textContent = opts.format(v, true);
    }
    el('line', { x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih, class: 'axis' }, svg);
    opts.categories.forEach((c, i) => {
      const cx = m.l + band * i + band / 2;
      el('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }, svg).textContent = c;
      let acc = 0;
      const segs = opts.series.filter(s => (opts.data[i][s.key] || 0) > 0);
      segs.forEach((s, j) => {
        const v = opts.data[i][s.key];
        const y0 = Y(acc), y1 = Y(acc + v);
        const top = j === segs.length - 1;
        const h = Math.max(0, y0 - y1 - (top ? 0 : 2));   // 2px surface gap between segments
        const x = cx - bw / 2, y = y1;
        if (top && h > 4) {
          const r = Math.min(4, bw / 2);
          el('path', { d: `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y + h}Z`, fill: s.color, opacity: opts.dim && opts.dim(i, s) ? 0.45 : 1 }, svg);
        } else {
          el('rect', { x, y: y + (top ? 0 : 2), width: bw, height: Math.max(0.5, h), fill: s.color, opacity: opts.dim && opts.dim(i, s) ? 0.45 : 1 }, svg);
        }
        acc += v;
      });
      const hit = el('rect', { x: m.l + band * i, y: m.t, width: band, height: ih, fill: 'transparent' }, svg);
      hit.addEventListener('pointermove', (evt) => {
        let html = `<b>${opts.tipTitle ? opts.tipTitle(i) : c}</b>`;
        for (const s of opts.series) html += `<div class="row"><span><i style="--c:${s.color}"></i>${s.label}</span><span>${opts.format(opts.data[i][s.key] || 0)}</span></div>`;
        html += `<div class="row"><span>Total</span><b>${opts.format(totals[i])}</b></div>`;
        if (opts.note) html += opts.note(i);
        C.showTip(html, evt);
      });
      hit.addEventListener('pointerleave', C.hideTip);
    });
  };
})();
