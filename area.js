/* Omzet per Area dashboard — auto-updating from server.py, offline fallback. */
(function () {
  'use strict';

  const API = '/api/omzet-area';
  const POLL_MS = 30000;
  const AREA_COLORS = ['#2e9c9c', '#f2654c', '#3d82c4', '#e0a130',
                       '#6a63c9', '#25a879', '#d95e8a', '#7c8fa8'];

  const $ = (id) => document.getElementById(id);
  const el = {
    month: $('month-filter'), brand: $('brand-filter'), area: $('area-filter'),
    chips: $('active-chips'), kpis: $('kpi-grid'), ranking: $('area-ranking'),
    rankingTotal: $('ranking-total'), heatmap: $('heatmap'), trend: $('area-trend'),
    trendSub: $('trend-sub'), brandChart: $('area-brand'), brandSub: $('brand-sub'),
    products: $('area-products'), productTitle: $('product-title'), productSub: $('product-sub'),
    mamis: $('area-mamis'), mamiTitle: $('mami-title'), mamiSub: $('mami-sub'),
    tableBody: $('table-body'), tableCaption: $('table-caption'),
    period: $('period-label'), last: $('last-update'),
    badge: $('sync-badge'), badgeText: $('sync-text'), refresh: $('refresh-btn'),
    footer: $('footer-meta'), tooltip: $('tooltip')
  };

  const state = { month: '', brand: '', area: '' };
  let DATA = null;
  let lastDataSignature = '';

  const nf = new Intl.NumberFormat('id-ID');
  const fmt = (n) => nf.format(Math.round(n));
  const rp = (n) => 'Rp ' + fmt(n);
  const pct = (part, total) => total > 0 ? (part / total * 100).toFixed(1).replace('.', ',') + '%' : '0%';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  function shortRp(n) {
    const v = Math.abs(n);
    if (v >= 1e9) return 'Rp ' + (n / 1e9).toFixed(1).replace('.', ',') + ' M';
    if (v >= 1e6) return 'Rp ' + (n / 1e6).toFixed(1).replace('.', ',') + ' Jt';
    if (v >= 1e3) return 'Rp ' + (n / 1e3).toFixed(0).replace('.', ',') + ' Rb';
    return 'Rp ' + fmt(n);
  }
  function shortProduct(name) {
    const s = name.replace(/^\s*(Hanarose|Lezza)\s+/i, '')
      .replace(/1\s*x\s*/gi, '1x').replace(/\s*-\s*/g, ' – ')
      .replace(/\s*\bgr\b\s*/gi, ' ').replace(/\s+/g, ' ').trim();
    return s.length > 24 ? s.slice(0, 23) + '…' : s;
  }
  function dateLabel(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('id-ID',
      { day: 'numeric', month: 'short', year: '2-digit' });
  }
  function timeLabel(iso) {
    const d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleString('id-ID',
      { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /* ------------------------------------------------------------ tooltip */
  function moveTip(e) {
    const t = el.tooltip, pad = 14;
    let x = e.clientX + pad, y = e.clientY + pad;
    const box = t.getBoundingClientRect();
    if (x + box.width > innerWidth - 8) x = e.clientX - box.width - pad;
    if (y + box.height > innerHeight - 8) y = e.clientY - box.height - pad;
    t.style.left = Math.max(6, x) + 'px';
    t.style.top = Math.max(6, y) + 'px';
  }
  document.addEventListener('mouseover', (e) => {
    const n = e.target.closest && e.target.closest('[data-tip]');
    if (n) { el.tooltip.innerHTML = n.getAttribute('data-tip'); el.tooltip.classList.add('show'); moveTip(e); }
  });
  document.addEventListener('mousemove', (e) => { if (el.tooltip.classList.contains('show')) moveTip(e); });
  document.addEventListener('mouseout', (e) => {
    const n = e.target.closest && e.target.closest('[data-tip]');
    if (n) el.tooltip.classList.remove('show');
  });

  /* --------------------------------------------------------------- data */
  function fallbackFromSheet(D) {
    return {
      meta: D.meta, areas: D.areas, months: D.months, sales: D.sales,
      dateMonths: D.dates.map((d) => D.monthIndex[d.monthKey]),
      productNames: D.products.map((p) => p.name),
      productBrands: D.products.map((p) => p.brand),
      productColors: D.products.map((p) => p.color),
      mamiNames: D.mamis,
      server: { status: 'offline', refreshedAt: D.meta.generatedAt,
                refreshSeconds: 300, nextRefreshAt: Date.now() / 1000 + 30,
                error: 'Server tidak tersedia — memakai snapshot lokal.' }
    };
  }

  async function load(force) {
    try {
      const res = await fetch(API + (force ? '?force=1' : ''), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (!json || !json.sales || !json.dateMonths) throw new Error('Respons API tidak lengkap');
      DATA = json;
      DATA._source = 'api';
    } catch (err) {
      if (!DATA || DATA._source !== 'api') {
        if (typeof DASH_DATA === 'undefined') {
          el.badgeText.textContent = 'Data tidak tersedia';
          return;
        }
        DATA = fallbackFromSheet(DASH_DATA);
        DATA._source = 'snapshot';
      } else {
        DATA.server = Object.assign({}, DATA.server, {
          status: 'stale', error: String(err), nextRefreshAt: Date.now() / 1000 + 30
        });
      }
    }
    syncControls();
    renderMeta();
    const sig = (DATA.server.refreshedAt || '') + '|' + DATA.sales.length;
    if (sig !== lastDataSignature) { lastDataSignature = sig; renderAll(); }
  }

  function filteredRows() {
    return DATA.sales.filter((r) =>
      (!state.month || DATA.dateMonths[r[0]] === +state.month) &&
      (!state.brand || DATA.productBrands[r[2]] === state.brand) &&
      (!state.area || r[1] === +state.area));
  }
  function accumulate() {
    const rows = filteredRows();
    const byArea = new Map(), byAreaMonth = new Map(), byBrand = new Map();
    const byProduct = new Map(), byMami = new Map(), byAreaBrand = new Map();
    let total = 0, qty = 0;
    const bump = (map, key, r) => {
      const acc = map.get(key) || { value: 0, qty: 0, count: 0 };
      acc.value += r[5]; acc.qty += r[4]; acc.count++;
      map.set(key, acc);
    };
    rows.forEach((r) => {
      total += r[5]; qty += r[4];
      bump(byArea, r[1], r);
      bump(byAreaMonth, r[1] + '|' + DATA.dateMonths[r[0]], r);
      bump(byBrand, DATA.productBrands[r[2]], r);
      bump(byProduct, r[2], r);
      bump(byMami, r[3], r);
      bump(byAreaBrand, r[1] + '|' + DATA.productBrands[r[2]], r);
    });
    const sorted = (m) => Array.from(m, ([key, v]) => ({ key, ...v })).sort((a, b) => b.value - a.value);
    return { rows, byArea: sorted(byArea), byAreaMonth, byBrand: sorted(byBrand),
             byProduct: sorted(byProduct), byMami: sorted(byMami),
             byAreaBrand, total, qty };
  }

  /* ------------------------------------------------------------ controls */
  function initControls() {
    DATA.months.forEach((m, i) => el.month.appendChild(new Option(m.label, String(i))));
    DATA.areas.forEach((a, i) => el.area.appendChild(new Option(a, String(i))));

    [['month', el.month], ['brand', el.brand], ['area', el.area]].forEach(([key, node]) => {
      node.addEventListener('change', () => { state[key] = node.value; syncControls(); renderAll(); });
    });
    $('reset-btn').addEventListener('click', () => {
      Object.assign(state, { month: '', brand: '', area: '' });
      syncControls(); renderAll();
    });
    el.refresh.addEventListener('click', async () => {
      el.refresh.disabled = true;
      el.refresh.textContent = '↻ Memperbarui…';
      await load(true);
      el.refresh.disabled = false;
      el.refresh.textContent = '↻ Refresh sekarang';
    });
    $('source-link').href = DATA.meta.source;
  }
  function syncControls() {
    el.month.value = state.month; el.brand.value = state.brand; el.area.value = state.area;
    const chips = [];
    if (state.month) chips.push(['month', 'Bulan: ' + DATA.months[+state.month].label]);
    if (state.brand) chips.push(['brand', 'Brand: ' + state.brand]);
    if (state.area) chips.push(['area', 'Area: ' + DATA.areas[+state.area]]);
    el.chips.innerHTML = chips.map(([k, label]) =>
      '<span class="chip">' + esc(label) + '<button type="button" data-clear="' + k + '">×</button></span>').join('');
    el.chips.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => {
      state[b.dataset.clear] = ''; syncControls(); renderAll();
    }));
  }
  function renderMeta() {
    const s = DATA.server || {};
    el.period.textContent = dateLabel(DATA.meta.dateMin) + ' – ' + dateLabel(DATA.meta.dateMax);
    el.last.textContent = timeLabel(s.refreshedAt || DATA.meta.generatedAt);
    const offline = DATA._source === 'snapshot' || s.status === 'offline';
    const stale = s.status === 'stale' || s.status === 'error';
    el.badge.className = 'sync-badge ' + (offline || stale ? 'warn' : 'ok');
    const secs = s.refreshSeconds || 300;
    const periodText = secs >= 60 ? Math.round(secs / 60) + ' menit' : secs + ' detik';
    el.badgeText.textContent = offline ? 'Mode offline · snapshot'
      : stale ? 'Update gagal · data terakhir'
      : 'Auto-update aktif · tiap ' + periodText;
    el.badge.title = s.error || '';
    el.footer.textContent = fmt(DATA.meta.salesRows) + ' baris penjualan · ' +
      fmt(DATA.meta.sheetRows) + ' baris sumber · ' + (DATA._source === 'api' ? 'live via server' : 'snapshot lokal');
    $('source-link').href = DATA.meta.source;
  }
  /* --------------------------------------------------------------- charts */
  function niceMax(v) {
    if (v <= 0) return 10;
    const exp = Math.pow(10, Math.floor(Math.log10(v))), f = v / exp;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
  }
  function barRow(o) {
    const tip = '<strong>' + esc(o.name) + '</strong><span>' + esc(o.tip || '') + '</span>';
    return '<div class="bar-row' + (o.click ? ' clickable' : '') + '"' + (o.data || '') +
      ' data-tip="' + esc(tip) + '"><div class="bar-name">' + o.label + '</div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + o.width + '%;--bar-color:' + o.color + '"></div></div>' +
      '<div class="bar-value">' + o.value + '<small>' + (o.sub || '') + '</small></div></div>';
  }

  function renderKPIs(agg) {
    const best = agg.byArea[0];
    const avg = agg.byArea.length ? agg.total / agg.byArea.length : 0;
    const cards = [
      { label: 'Total Omzet', value: rp(agg.total), sub: 'dari <strong>' + fmt(agg.rows.length) + '</strong> transaksi',
        tone: '#2e9c9c', soft: '#e8f7f6', icon: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
      { label: 'Area Tertinggi', value: best ? esc(DATA.areas[best.key]) : '—',
        sub: best ? '<strong>' + rp(best.value) + '</strong> · ' + pct(best.value, agg.total) : '—',
        tone: '#f2654c', soft: '#fff0eb', icon: '<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.3"/>' },
      { label: 'Total Qty Terjual', value: fmt(agg.qty) + ' <span style="font-size:14px;font-weight:600">pcs</span>',
        sub: '<strong>' + fmt(agg.byProduct.length) + '</strong> SKU terjual',
        tone: '#3d82c4', soft: '#eaf2fb', icon: '<path d="M3 7h18M3 12h18M3 17h12"/><path d="M19 15l2 2-2 2"/>' },
      { label: 'Rata-rata per Area', value: rp(avg),
        sub: 'dari <strong>' + fmt(agg.byArea.length) + '</strong> area aktif',
        tone: '#e0a130', soft: '#fff7e6', icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' }
    ];
    el.kpis.innerHTML = cards.map((c) =>
      '<article class="kpi-card" style="--tone:' + c.tone + ';--tone-soft:' + c.soft + '">' +
      '<div class="kpi-top"><span class="kpi-label">' + c.label + '</span><span class="kpi-icon"><svg viewBox="0 0 24 24">' + c.icon + '</svg></span></div>' +
      '<div class="kpi-value">' + c.value + '</div><div class="kpi-sub">' + c.sub + '</div></article>').join('');
  }

  function renderRanking(agg) {
    el.rankingTotal.textContent = fmt(agg.byArea.length) + ' area · ' + rp(agg.total);
    if (!agg.byArea.length) { el.ranking.innerHTML = '<p class="empty-pie">Tidak ada data untuk filter ini.</p>'; return; }
    const max = agg.byArea[0].value;
    el.ranking.innerHTML = agg.byArea.map((x, i) =>
      barRow({ name: DATA.areas[x.key], label: esc(DATA.areas[x.key]),
        width: Math.max(2, x.value / max * 100), color: AREA_COLORS[x.key % AREA_COLORS.length],
        value: shortRp(x.value), sub: pct(x.value, agg.total) + ' · ' + fmt(x.qty) + ' pcs',
        tip: rp(x.value) + '<br>' + fmt(x.qty) + ' pcs · ' + fmt(x.count) + ' transaksi',
        click: true, data: ' data-area="' + x.key + '"' })).join('');
    el.ranking.querySelectorAll('[data-area]').forEach((n) => n.addEventListener('click', () => {
      state.area = state.area === n.dataset.area ? '' : n.dataset.area;
      syncControls(); renderAll();
    }));
  }

  function renderHeatmap(agg) {
    if (!agg.rows.length) { el.heatmap.innerHTML = '<p class="empty-pie">Tidak ada data untuk filter ini.</p>'; return; }
    const activeMonths = DATA.months.filter((m, i) =>
      agg.byAreaMonth && Array.from(agg.byAreaMonth.keys()).some((k) => k.split('|')[1] === String(i)));
    const months = state.month ? activeMonths.filter((m) => DATA.months.indexOf(m) === +state.month) : activeMonths;
    let max = 0;
    agg.byAreaMonth.forEach((v) => { if (v.value > max) max = v.value; });
    const areaList = state.area ? agg.byArea : agg.byArea.slice().sort((a, b) => a.key - b.key);
    let html = '<table class="heat-table"><thead><tr><th>Area</th>' +
      months.map((m) => '<th class="num">' + m.label + '</th>').join('') +
      '<th class="num">Total</th></tr></thead><tbody>';
    areaList.forEach((a) => {
      html += '<tr><th>' + esc(DATA.areas[a.key]) + '</th>';
      months.forEach((m) => {
        const entry = agg.byAreaMonth.get(a.key + '|' + DATA.months.indexOf(m));
        const v = entry ? entry.value : 0;
        const alpha = max ? 0.06 + 0.82 * Math.sqrt(v / max) : 0.06;
        const light = alpha > 0.52;
        const tip = '<strong>' + esc(DATA.areas[a.key]) + ' · ' + m.label + '</strong><span>' +
          (v ? rp(v) + '<br>' + fmt(entry.qty) + ' pcs · ' + fmt(entry.count) + ' transaksi' : 'Tidak ada transaksi') + '</span>';
        html += '<td class="num heat-cell" data-tip="' + esc(tip) + '" style="background:rgba(46,156,156,' + alpha.toFixed(2) + ');color:' +
          (light ? '#fff' : '#22304a') + '">' + (v ? shortRp(v) : '–') + '</td>';
      });
      html += '<td class="num heat-total">' + rp(a.value) + '</td></tr>';
    });
    html += '</tbody></table>';
    el.heatmap.innerHTML = html;
  }

  function arcPath(cx, cy, ro, ri, start, end) {
    const large = (end - start) > Math.PI ? 1 : 0;
    const pt = (a, r) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x1, y1] = pt(start, ro), [x2, y2] = pt(end, ro);
    const [x3, y3] = pt(end, ri), [x4, y4] = pt(start, ri);
    return 'M ' + x1 + ' ' + y1 + ' A ' + ro + ' ' + ro + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2 +
      ' L ' + x3 + ' ' + y3 + ' A ' + ri + ' ' + ri + ' 0 ' + large + ' 0 ' + x4 + ' ' + y4 + ' Z';
  }
  function donut(items, size, thickness, center) {
    const total = items.reduce((s, it) => s + it.value, 0);
    const ro = size / 2 - 2, ri = ro - thickness;
    let angle = -Math.PI / 2, paths = '';
    items.forEach((it) => {
      if (!it.value || total <= 0) return;
      const sweep = it.value / total * Math.PI * 2;
      const tip = ' data-tip="' + esc(it.tip || '') + '"';
      if (sweep >= Math.PI * 2 - 1e-6) {
        paths += '<circle class="donut-segment" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' +
          ((ro + ri) / 2) + '" fill="none" stroke="' + it.color + '" stroke-width="' + thickness + '"' + tip + '/>';
      } else {
        paths += '<path class="donut-segment" d="' + arcPath(size / 2, size / 2, ro, ri, angle, angle + sweep) +
          '" fill="' + it.color + '"' + tip + '/>';
      }
      angle += sweep;
    });
    return '<div class="donut-wrap" style="width:' + size + 'px;height:' + size + 'px">' +
      '<svg class="donut-svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' + paths + '</svg>' +
      '<div class="donut-center">' + center + '</div></div>';
  }

  function renderTrend(agg) {
    const series = state.area ? [+state.area] : agg.byArea.slice(0, 4).map((x) => x.key);
    if (!series.length) { el.trend.innerHTML = '<p class="empty-pie">Tidak ada data untuk filter ini.</p>'; return; }
    const activeMonths = DATA.months.filter((m, i) =>
      series.some((a) => Array.from(agg.byAreaMonth.keys()).includes(a + '|' + i)));
    const months = state.month ? activeMonths.filter((m) => DATA.months.indexOf(m) === +state.month) : activeMonths;
    el.trendSub.textContent = state.area ? DATA.areas[+state.area] + ' — klik legenda untuk ganti area.'
      : '4 area dengan omzet terbesar — klik legenda untuk fokus.';
    if (!months.length) { el.trend.innerHTML = '<p class="empty-pie">Tidak ada data untuk filter ini.</p>'; return; }

    const W = 760, H = 260, L = 56, R = 14, T = 18, B = 38;
    const plotW = W - L - R, plotH = H - T - B;
    let maxV = 0;
    series.forEach((a) => months.forEach((m, i) => {
      const v = (agg.byAreaMonth.get(a + '|' + DATA.months.indexOf(m)) || { value: 0 }).value;
      if (v > maxV) maxV = v;
    }));
    const max = niceMax(Math.max(1, maxV));
    let svg = '<div class="trend-wrap"><svg class="trend-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Tren omzet per area">';
    for (let t = 0; t <= 4; t++) {
      const y = T + plotH - plotH * t / 4;
      svg += '<line class="trend-grid" x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '"/>' +
             '<text class="trend-axis" x="' + (L - 8) + '" y="' + (y + 3) + '" text-anchor="end">' + shortRp(max * t / 4) + '</text>';
    }
    const xAt = (i) => months.length === 1 ? L + plotW / 2 : L + plotW * i / (months.length - 1);
    months.forEach((m, i) => {
      svg += '<text class="trend-axis" x="' + xAt(i) + '" y="' + (H - 12) + '" text-anchor="middle">' + m.label + '</text>';
    });
    series.forEach((a) => {
      const color = AREA_COLORS[a % AREA_COLORS.length];
      const pts = months.map((m, i) => {
        const e = agg.byAreaMonth.get(a + '|' + DATA.months.indexOf(m));
        return { x: xAt(i), y: T + plotH - plotH * ((e ? e.value : 0) / max), entry: e, month: m };
      });
      svg += '<path d="' + pts.map((p, i) => (i ? 'L' : 'M') + ' ' + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ') +
             '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round"/>';
      pts.forEach((p) => {
        const tip = '<strong>' + esc(DATA.areas[a]) + ' · ' + p.month.label + '</strong><span>' +
          (p.entry ? rp(p.entry.value) + '<br>' + fmt(p.entry.qty) + ' pcs' : 'Tidak ada transaksi') + '</span>';
        svg += '<circle class="trend-point" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4" fill="' +
          color + '" data-tip="' + esc(tip) + '"/>';
      });
    });
    svg += '</svg></div>';
    svg += '<div class="legend-line">' + series.map((a) =>
      '<span class="legend-click" data-legend-area="' + a + '"><span class="dot" style="background:' +
      AREA_COLORS[a % AREA_COLORS.length] + '"></span>' + esc(DATA.areas[a]) + '</span>').join('') + '</div>';
    el.trend.innerHTML = svg;
    el.trend.querySelectorAll('[data-legend-area]').forEach((n) => n.addEventListener('click', () => {
      state.area = state.area === n.dataset.legendArea ? '' : n.dataset.legendArea;
      syncControls(); renderAll();
    }));
  }

  function renderBrand(agg) {
    const scope = state.area ? DATA.areas[+state.area] : 'Semua Area';
    el.brandSub.textContent = 'Perbandingan Lezza dan Hanarose — ' + scope + '.';
    const vals = { Lezza: { value: 0, qty: 0, count: 0 }, Hanarose: { value: 0, qty: 0, count: 0 } };
    agg.rows.forEach((r) => {
      const acc = vals[DATA.productBrands[r[2]]];
      acc.value += r[5]; acc.qty += r[4]; acc.count++;
    });
    const total = vals.Lezza.value + vals.Hanarose.value;
    if (!total) { el.brandChart.innerHTML = '<p class="empty-pie">Tidak ada data untuk filter ini.</p>'; return; }
    const items = ['Lezza', 'Hanarose'].map((b) => ({
      value: vals[b].value, color: b === 'Lezza' ? '#f2654c' : '#2e9c9c',
      tip: '<strong>' + b + '</strong><span>Omzet: ' + rp(vals[b].value) + '<br>' + pct(vals[b].value, total) + '</span>'
    }));
    const center = '<small>Total omzet</small><strong>' + shortRp(total) + '</strong>';
    const legend = ['Lezza', 'Hanarose'].map((b) =>
      '<div class="brand-legend-row" data-brand="' + b + '"><span class="dot" style="background:' +
      (b === 'Lezza' ? '#f2654c' : '#2e9c9c') + '"></span><span class="brand-legend-name">' + b +
      '<small>' + pct(vals[b].value, total) + ' · ' + fmt(vals[b].qty) + ' pcs</small></span>' +
      '<span class="brand-legend-value">' + shortRp(vals[b].value) + '</span></div>').join('');
    el.brandChart.innerHTML = donut(items, 176, 24, center) + '<div class="brand-legend">' + legend + '</div>';
    el.brandChart.querySelectorAll('[data-brand]').forEach((n) => n.addEventListener('click', () => {
      state.brand = state.brand === n.dataset.brand ? '' : n.dataset.brand;
      syncControls(); renderAll();
    }));
  }

  function renderTopLists(agg) {
    const scope = state.area ? DATA.areas[+state.area] : 'Semua Area';
    el.productTitle.textContent = 'Top Nama Barang';
    el.productSub.textContent = 'Produk dengan omzet tertinggi — ' + scope + '.';
    el.mamiTitle.textContent = 'Top Mami Lezza';
    el.mamiSub.textContent = 'Mami dengan omzet tertinggi — ' + scope + '.';
    const maxP = agg.byProduct.length ? agg.byProduct[0].value : 0;
    el.products.innerHTML = agg.byProduct.length ? agg.byProduct.slice(0, 8).map((x) => {
      const name = DATA.productNames[x.key], brand = DATA.productBrands[x.key];
      const tag = '<span class="brand-tag ' + brand.toLowerCase() + '">' + brand + '</span>';
      return barRow({ name, label: tag + esc(shortProduct(name)),
        width: Math.max(2, x.value / maxP * 100), color: DATA.productColors[x.key],
        value: shortRp(x.value), sub: fmt(x.qty) + ' pcs',
        tip: brand + ' · ' + rp(x.value) + '<br>' + fmt(x.qty) + ' pcs' });
    }).join('') : '<p class="empty-pie">Tidak ada data.</p>';

    const maxM = agg.byMami.length ? agg.byMami[0].value : 0;
    el.mamis.innerHTML = agg.byMami.length ? agg.byMami.slice(0, 8).map((x) =>
      barRow({ name: DATA.mamiNames[x.key], label: esc(DATA.mamiNames[x.key]),
        width: Math.max(2, x.value / maxM * 100), color: '#2e9c9c',
        value: shortRp(x.value), sub: fmt(x.qty) + ' pcs',
        tip: rp(x.value) + '<br>' + fmt(x.qty) + ' pcs · ' + fmt(x.count) + ' transaksi' })
    ).join('') : '<p class="empty-pie">Tidak ada data.</p>';
  }

  function renderTable(agg) {
    const rows = Array.from(agg.byAreaBrand, ([key, v]) => {
      const [a, b] = key.split('|');
      return { area: +a, brand: b, ...v };
    }).sort((x, y) => y.value - x.value);
    el.tableCaption.textContent = fmt(rows.length) + ' kombinasi area × brand · total ' + rp(agg.total);
    el.tableBody.innerHTML = rows.length ? rows.map((x) =>
      '<tr><td>' + esc(DATA.areas[x.area]) + '</td>' +
      '<td><span class="brand-tag ' + x.brand.toLowerCase() + '">' + x.brand + '</span></td>' +
      '<td class="num"><strong>' + rp(x.value) + '</strong></td>' +
      '<td class="num">' + pct(x.value, agg.total) + '</td>' +
      '<td class="num">' + fmt(x.qty) + '</td>' +
      '<td class="num">' + fmt(x.count) + '</td></tr>').join('')
      : '<tr><td colspan="6" class="no-rows">Tidak ada data yang cocok.</td></tr>';
  }

  function renderAll() {
    if (!DATA) return;
    const agg = accumulate();
    renderKPIs(agg); renderRanking(agg); renderHeatmap(agg); renderTrend(agg);
    renderBrand(agg); renderTopLists(agg); renderTable(agg);
  }

  async function init() {
    await load(false);
    initControls();
    renderMeta(); renderAll();
    setInterval(() => load(false), POLL_MS);
  }
  init();
})();
