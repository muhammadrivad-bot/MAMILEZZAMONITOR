/* Mami Lezza Dashboard — all logic, zero external dependencies. */
(function () {
  'use strict';

  const D = DASH_DATA;
  const sales = D.sales;
  const dates = D.dates;
  const months = D.months;
  const areas = D.areas;
  const mamis = D.mamis;
  const products = D.products;

  const monthOfRow = new Array(sales.length);
  const brandOfRow = new Array(sales.length);
  const rowIndex = new Map();
  for (let i = 0; i < sales.length; i++) {
    monthOfRow[i] = dates[sales[i][0]].monthKey;
    brandOfRow[i] = products[sales[i][2]].brand;
    rowIndex.set(sales[i], i);
  }

  const state = {
    area: '', month: '', date: '', brand: '', mami: '',
    metric: 'value', search: '', sortDir: -1, limit: 12
  };

  let filtered = [];

  const $ = (id) => document.getElementById(id);
  const el = {
    area: $('area-filter'), month: $('month-filter'), date: $('date-filter'),
    brand: $('brand-filter'), mami: $('mami-filter'), chips: $('active-chips'),
    kpis: $('kpi-grid'), trend: $('trend-chart'), brandChart: $('brand-chart'),
    mamiChart: $('mami-chart'), productChart: $('product-chart'),
    areaChart: $('area-chart'), areaSummary: $('area-summary'),
    pies: $('monthly-pies'), tableBody: $('table-body'), tableCount: $('table-count'),
    loadMore: $('load-more'), search: $('table-search'), tooltip: $('tooltip')
  };

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
    let s = name.replace(/^\s*(Hanarose|Lezza)\s+/i, '')
      .replace(/1\s*x\s*/gi, '1x')
      .replace(/\s*-\s*/g, ' – ')
      .replace(/\s*\bgr\b\s*/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    return s.length > 26 ? s.slice(0, 25) + '…' : s;
  }
  function shortName(name, max) {
    return name.length > max ? name.slice(0, max - 1) + '…' : name;
  }
  function monthShort(key) {
    const m = months.find((x) => x.key === key);
    if (!m) return key;
    const [label, year] = m.label.split(' ');
    return label + ' ' + year.slice(2);
  }
  function monthLong(key) {
    const m = months.find((x) => x.key === key);
    return m ? m.label : key;
  }

  /* ------------------------------------------------------------ tooltip */
  function moveTip(e) {
    const t = el.tooltip;
    const pad = 14;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    const box = t.getBoundingClientRect();
    if (x + box.width > window.innerWidth - 8) x = e.clientX - box.width - pad;
    if (y + box.height > window.innerHeight - 8) y = e.clientY - box.height - pad;
    t.style.left = Math.max(6, x) + 'px';
    t.style.top = Math.max(6, y) + 'px';
  }
  function showTip(html, e) {
    el.tooltip.innerHTML = html;
    el.tooltip.classList.add('show');
    el.tooltip.setAttribute('aria-hidden', 'false');
    moveTip(e);
  }
  function hideTip() {
    el.tooltip.classList.remove('show');
    el.tooltip.setAttribute('aria-hidden', 'true');
  }
  document.addEventListener('mouseover', (e) => {
    const node = e.target.closest && e.target.closest('[data-tip]');
    if (node) showTip(node.getAttribute('data-tip'), e);
  });
  document.addEventListener('mousemove', (e) => {
    if (el.tooltip.classList.contains('show')) moveTip(e);
  });
  document.addEventListener('mouseout', (e) => {
    const node = e.target.closest && e.target.closest('[data-tip]');
    if (node) hideTip();
  });

  /* ----------------------------------------------------------- controls */
  function initControls() {
    areas.forEach((name, i) => el.area.appendChild(new Option(name, String(i))));

    months.slice().reverse().forEach((m) => {
      el.month.appendChild(new Option(m.label, m.key));
    });

    const groups = new Map();
    dates.forEach((d, idx) => {
      if (!groups.has(d.monthKey)) groups.set(d.monthKey, []);
      groups.get(d.monthKey).push({ label: d.label, idx });
    });
    months.slice().reverse().forEach((m) => {
      const list = groups.get(m.key);
      if (!list) return;
      const og = document.createElement('optgroup');
      og.label = m.label;
      list.slice().reverse().forEach((d) => og.appendChild(new Option(d.label, String(d.idx))));
      el.date.appendChild(og);
    });

    mamis.forEach((name, i) => el.mami.appendChild(new Option(name, String(i))));

    [['area', el.area], ['month', el.month], ['date', el.date],
     ['brand', el.brand], ['mami', el.mami]].forEach(([key, node]) => {
      node.addEventListener('change', () => {
        state[key] = node.value;
        if (key === 'month') state.date = '';
        if (key === 'date') state.month = '';
        syncControls();
        run();
      });
    });

    $('reset-btn').addEventListener('click', () => {
      Object.assign(state, { area: '', month: '', date: '', brand: '', mami: '', search: '', limit: 12 });
      el.search.value = '';
      syncControls();
      run();
    });

    document.querySelectorAll('.seg').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.metric = btn.dataset.metric;
        document.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b === btn));
        renderPies();
      });
    });

    el.search.addEventListener('input', () => {
      state.search = el.search.value.trim().toLowerCase();
      state.limit = 12;
      renderTable();
    });
    el.loadMore.addEventListener('click', () => { state.limit += 12; renderTable(); });
    $('export-btn').addEventListener('click', exportCSV);
    document.querySelector('th[data-sort]').addEventListener('click', () => {
      state.sortDir *= -1;
      document.querySelector('th[data-sort]').textContent =
        'Value Terjual ' + (state.sortDir < 0 ? '▾' : '▴');
      renderTable();
    });

    // Data provenance note.
    const note = document.createElement('div');
    note.className = 'note-banner';
    note.innerHTML = '<span>ⓘ</span><span><strong>Catatan data:</strong> ' +
      fmt(D.meta.sheetRows) + ' baris dibaca dari sheet; ' + fmt(D.meta.salesRows) +
      ' baris penjualan dipakai (termasuk ' + fmt(D.meta.statusCounts['(tanpa status / lanjutan penjualan)'] || 0) +
      ' baris dengan kolom status kosong pada akhir tabel). Variasi huruf pada Area, Nama Mami Lezza, dan Nama Barang disatukan.</span>';
    document.querySelector('.filter-panel').after(note);
  }

  function syncControls() {
    el.area.value = state.area;
    el.month.value = state.month;
    el.date.value = state.date;
    el.brand.value = state.brand;
    el.mami.value = state.mami;

    const chips = [];
    if (state.area) chips.push(['area', 'Area: ' + areas[+state.area]]);
    if (state.month) chips.push(['month', 'Bulan: ' + monthLong(state.month)]);
    if (state.date) chips.push(['date', 'Tanggal: ' + dates[+state.date].label]);
    if (state.brand) chips.push(['brand', 'Brand: ' + state.brand]);
    if (state.mami) chips.push(['mami', 'Mami: ' + mamis[+state.mami]]);
    el.chips.innerHTML = chips.map(([k, label]) =>
      '<span class="chip">' + esc(label) + '<button type="button" data-clear="' + k + '" aria-label="Hapus filter">×</button></span>'
    ).join('');
    el.chips.querySelectorAll('[data-clear]').forEach((b) => {
      b.addEventListener('click', () => {
        state[b.dataset.clear] = '';
        syncControls();
        run();
      });
    });
  }

  /* --------------------------------------------------------- aggregation */
  function toList(map) {
    return Array.from(map, ([key, v]) => ({ key, ...v })).sort((a, b) => b.value - a.value);
  }

  function applyFilters() {
    const a = state.area ? +state.area : -1;
    const d = state.date ? +state.date : -1;
    const m = state.mami ? +state.mami : -1;
    filtered = sales.filter((r, i) =>
      (a < 0 || r[1] === a) &&
      (d < 0 || r[0] === d) &&
      (!state.month || monthOfRow[i] === state.month) &&
      (!state.brand || brandOfRow[i] === state.brand) &&
      (m < 0 || r[3] === m)
    );
  }

  function run() {
    applyFilters();
    renderKPIs();
    renderTrend();
    renderBrand();
    renderMami();
    renderProducts();
    renderArea();
    renderPies();
    renderTable();
  }

  /* --------------------------------------------------------------- KPIs */
  function renderKPIs() {
    const totalValue = filtered.reduce((s, r) => s + r[5], 0);
    const totalQty = filtered.reduce((s, r) => s + r[4], 0);
    const mamiSet = new Set(filtered.map((r) => r[3]));
    const productSet = new Set(filtered.map((r) => r[2]));
    const avg = filtered.length ? totalValue / filtered.length : 0;

    const icon = (path) => '<span class="kpi-icon"><svg viewBox="0 0 24 24">' + path + '</svg></span>';
    const cards = [
      { label: 'Value Terjual', value: rp(totalValue), sub: 'dari <strong>' + fmt(filtered.length) + '</strong> baris penjualan',
        tone: '#f2654c', soft: '#fff0eb', icon: icon('<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>') },
      { label: 'Qty Terjual', value: fmt(totalQty) + ' <span style="font-size:14px;font-weight:600">pcs</span>',
        sub: 'rata-rata <strong>' + fmt(filtered.length ? totalQty / filtered.length : 0) + '</strong> pcs / baris',
        tone: '#2e9c9c', soft: '#e8f7f6', icon: icon('<path d="M3 7h18M3 12h18M3 17h12"/><path d="M19 15l2 2-2 2"/>') },
      { label: 'Mami Lezza Aktif', value: fmt(mamiSet.size) + ' <span style="font-size:14px;font-weight:600">orang</span>',
        sub: 'rata-rata <strong>' + rp(mamiSet.size ? totalValue / mamiSet.size : 0) + '</strong> / mami',
        tone: '#e0a130', soft: '#fff7e6', icon: icon('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5"/><path d="M17 11h4M19 9v4"/>') },
      { label: 'Nama Barang Terjual', value: fmt(productSet.size) + ' <span style="font-size:14px;font-weight:600">SKU</span>',
        sub: 'nilai per transaksi <strong>' + rp(avg) + '</strong>',
        tone: '#6a63c9', soft: '#f0efff', icon: icon('<path d="M4 7h16v13H4z"/><path d="M4 7l2-4h12l2 4M9 11h6M9 15h6"/>') }
    ];
    el.kpis.innerHTML = cards.map((c) =>
      '<article class="kpi-card" style="--tone:' + c.tone + ';--tone-soft:' + c.soft + '">' +
      '<div class="kpi-top"><span class="kpi-label">' + c.label + '</span>' + c.icon + '</div>' +
      '<div class="kpi-value">' + c.value + '</div>' +
      '<div class="kpi-sub">' + c.sub + '</div></article>'
    ).join('');
  }

  /* --------------------------------------------------------------- trend */
  function niceMax(v) {
    if (v <= 0) return 10;
    const exp = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / exp;
    const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nice * exp;
  }
  function renderTrend() {
    el.trend.innerHTML = '';
    if (!filtered.length) { el.trend.innerHTML = '<p class="empty-pie">Tidak ada data untuk filter ini.</p>'; return; }

    const monthAgg = new Map();
    filtered.forEach((r) => {
      const k = monthOfRow[rowIndex.get(r)];
      const acc = monthAgg.get(k) || { value: 0, qty: 0 };
      acc.value += r[5]; acc.qty += r[4];
      monthAgg.set(k, acc);
    });

    const present = months.filter((mo) => monthAgg.has(mo.key));
    const W = 760, H = 260, L = 54, R = 14, T = 18, B = 36;
    const plotW = W - L - R, plotH = H - T - B;
    const max = niceMax(Math.max(1, ...present.map((mo) => monthAgg.get(mo.key).value)));
    let svg = '<div class="trend-wrap"><svg class="trend-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Tren value terjual per bulan">';
    svg += '<defs><linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">' +
           '<stop offset="0%" stop-color="#f48064"/><stop offset="100%" stop-color="#f2654c"/></linearGradient></defs>';
    for (let t = 0; t <= 4; t++) {
      const y = T + plotH - (plotH * t / 4);
      svg += '<line class="trend-grid" x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '"/>';
      svg += '<text class="trend-axis" x="' + (L - 8) + '" y="' + (y + 3) + '" text-anchor="end">' + shortRp(max * t / 4) + '</text>';
    }
    const slot = plotW / Math.max(1, present.length);
    const barW = Math.min(38, slot * 0.6);
    present.forEach((mo, i) => {
      const acc = monthAgg.get(mo.key);
      const h = Math.max(2, plotH * acc.value / max);
      const x = L + slot * i + (slot - barW) / 2;
      const y = T + plotH - h;
      const tip = '<strong>' + mo.label + '</strong><span>Value: ' + rp(acc.value) + '<br>Qty: ' + fmt(acc.qty) + ' pcs<br>Klik untuk filter bulan</span>';
      svg += '<g class="trend-bar-wrap" data-month="' + mo.key + '" data-tip="' + esc(tip) + '">';
      svg += '<rect class="trend-bar' + (state.month === mo.key ? ' selected' : '') + '" x="' + x + '" y="' + y +
             '" width="' + barW + '" height="' + h + '" rx="5"/>';
      if (present.length <= 7) svg += '<text class="trend-value" x="' + (x + barW / 2) + '" y="' + (y - 6) + '" text-anchor="middle">' + shortRp(acc.value) + '</text>';
      svg += '<text class="trend-axis" x="' + (x + barW / 2) + '" y="' + (H - 12) + '" text-anchor="middle">' + monthShort(mo.key) + '</text>';
      svg += '</g>';
    });
    svg += '</svg></div>';
    el.trend.innerHTML = svg;
    el.trend.querySelectorAll('[data-month]').forEach((node) => {
      node.addEventListener('click', () => {
        state.month = state.month === node.dataset.month ? '' : node.dataset.month;
        state.date = '';
        syncControls(); run();
      });
    });
  }

  /* --------------------------------------------------------------- donut */
  function arcPath(cx, cy, ro, ri, start, end) {
    const large = (end - start) > Math.PI ? 1 : 0;
    const pt = (a, r) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x1, y1] = pt(start, ro), [x2, y2] = pt(end, ro);
    const [x3, y3] = pt(end, ri), [x4, y4] = pt(start, ri);
    return 'M ' + x1 + ' ' + y1 + ' A ' + ro + ' ' + ro + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2 +
           ' L ' + x3 + ' ' + y3 + ' A ' + ri + ' ' + ri + ' 0 ' + large + ' 0 ' + x4 + ' ' + y4 + ' Z';
  }
  function donut(items, size, thickness, centerHtml) {
    const total = items.reduce((s, it) => s + it.value, 0);
    const ro = size / 2 - 2, ri = ro - thickness;
    let angle = -Math.PI / 2;
    let paths = '';
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
           '<div class="donut-center">' + centerHtml + '</div></div>';
  }

  /* --------------------------------------------------------------- brand */
  function renderBrand() {
    const byBrand = { Lezza: { value: 0, qty: 0, count: 0 }, Hanarose: { value: 0, qty: 0, count: 0 } };
    filtered.forEach((r) => {
      const acc = byBrand[brandOfRow[rowIndex.get(r)]];
      acc.value += r[5]; acc.qty += r[4]; acc.count++;
    });
    const total = byBrand.Lezza.value + byBrand.Hanarose.value;
    if (!total) { el.brandChart.innerHTML = '<p class="empty-pie">Tidak ada data untuk filter ini.</p>'; return; }

    const items = ['Lezza', 'Hanarose'].map((b) => ({
      value: byBrand[b].value,
      color: b === 'Lezza' ? '#f2654c' : '#2e9c9c',
      tip: '<strong>' + b + '</strong><span>Value: ' + rp(byBrand[b].value) + '<br>' +
           fmt(byBrand[b].qty) + ' pcs · ' + fmt(byBrand[b].count) + ' baris<br>' + pct(byBrand[b].value, total) + '</span>'
    }));
    const center = '<small>Total value</small><strong>' + shortRp(total) + '</strong><span>' + fmt(byBrand.Lezza.count + byBrand.Hanarose.count) + ' baris</span>';
    const legend = ['Lezza', 'Hanarose'].map((b) => {
      const acc = byBrand[b];
      return '<div class="brand-legend-row" data-brand="' + b + '" title="Klik untuk filter ' + b + '">' +
             '<span class="dot" style="background:' + (b === 'Lezza' ? '#f2654c' : '#2e9c9c') + '"></span>' +
             '<span class="brand-legend-name">' + b + '<small>' + pct(acc.value, total) + ' · ' + fmt(acc.qty) + ' pcs</small></span>' +
             '<span class="brand-legend-value">' + shortRp(acc.value) + '<small>' + fmt(acc.count) + ' baris</small></span></div>';
    }).join('');
    el.brandChart.innerHTML = donut(items, 176, 24, center) + '<div class="brand-legend">' + legend + '</div>';
    el.brandChart.querySelectorAll('[data-brand]').forEach((node) => {
      node.addEventListener('click', () => {
        state.brand = state.brand === node.dataset.brand ? '' : node.dataset.brand;
        syncControls(); run();
      });
    });
  }

  /* ---------------------------------------------------------- bar lists */
  function barRow(opts) {
    const tip = '<strong>' + esc(opts.name) + '</strong><span>' + esc(opts.tip || '') + '</span>';
    return '<div class="bar-row' + (opts.click ? ' clickable' : '') + '"' +
           (opts.data ? ' ' + opts.data : '') + ' data-tip="' + esc(tip) + '">' +
           '<div class="bar-name">' + opts.label + '</div>' +
           '<div class="bar-track"><div class="bar-fill" style="width:' + opts.width + '%;--bar-color:' + opts.color + '"></div></div>' +
           '<div class="bar-value">' + opts.value + '<small>' + (opts.sub || '') + '</small></div></div>';
  }

  function renderMami() {
    const agg = new Map();
    filtered.forEach((r) => {
      const acc = agg.get(r[3]) || { value: 0, qty: 0, count: 0 };
      acc.value += r[5]; acc.qty += r[4]; acc.count++;
      agg.set(r[3], acc);
    });
    const list = toList(agg).slice(0, 8);
    if (!list.length) { el.mamiChart.innerHTML = '<p class="empty-pie">Tidak ada data untuk filter ini.</p>'; return; }
    const max = list[0].value;
    el.mamiChart.innerHTML = list.map((x, i) =>
      barRow({ name: mamis[x.key], label: esc(shortName(mamis[x.key], 24)),
        width: Math.max(2, x.value / max * 100), color: i === 0 ? '#d94e36' : '#f2654c',
        value: shortRp(x.value), sub: fmt(x.qty) + ' pcs · ' + fmt(x.count) + ' trx',
        tip: rp(x.value) + '<br>' + fmt(x.qty) + ' pcs · ' + fmt(x.count) + ' baris',
        click: true, data: 'data-mami-row="' + x.key + '"' })
    ).join('');
    el.mamiChart.querySelectorAll('[data-mami-row]').forEach((node) => {
      node.addEventListener('click', () => {
        state.mami = String(node.dataset.mamiRow);
        syncControls(); run();
      });
    });
  }

  function renderProducts() {
    const agg = new Map();
    filtered.forEach((r) => {
      const acc = agg.get(r[2]) || { value: 0, qty: 0, count: 0 };
      acc.value += r[5]; acc.qty += r[4]; acc.count++;
      agg.set(r[2], acc);
    });
    const list = toList(agg).slice(0, 10);
    if (!list.length) { el.productChart.innerHTML = '<p class="empty-pie">Tidak ada data untuk filter ini.</p>'; return; }
    const max = list[0].value;
    el.productChart.innerHTML = list.map((x) => {
      const p = products[x.key];
      const tag = '<span class="brand-tag ' + p.brand.toLowerCase() + '">' + p.brand + '</span>';
      return barRow({ name: p.name, label: tag + esc(shortProduct(p.name)),
        width: Math.max(2, x.value / max * 100), color: p.color,
        value: shortRp(x.value), sub: fmt(x.qty) + ' pcs',
        tip: p.brand + ' · ' + rp(x.value) + '<br>' + fmt(x.qty) + ' pcs · ' + fmt(x.count) + ' baris' });
    }).join('');
  }

  function renderArea() {
    const agg = new Map();
    filtered.forEach((r) => {
      const acc = agg.get(r[1]) || { value: 0, qty: 0, count: 0 };
      acc.value += r[5]; acc.qty += r[4]; acc.count++;
      agg.set(r[1], acc);
    });
    const list = toList(agg);
    const total = list.reduce((s, x) => s + x.value, 0);
    el.areaSummary.textContent = total ? fmt(list.length) + ' area aktif · ' + rp(total) : '';
    if (!list.length) { el.areaChart.innerHTML = '<p class="empty-pie">Tidak ada data untuk filter ini.</p>'; return; }
    const max = list[0].value;
    el.areaChart.innerHTML = list.map((x) =>
      barRow({ name: areas[x.key], label: esc(areas[x.key]),
        width: Math.max(2, x.value / max * 100), color: '#3d82c4',
        value: shortRp(x.value), sub: pct(x.value, total) + ' · ' + fmt(x.qty) + ' pcs',
        tip: rp(x.value) + '<br>' + pct(x.value, total) + ' dari total · ' + fmt(x.count) + ' baris',
        click: true, data: 'data-area-row="' + x.key + '"' })
    ).join('');
    el.areaChart.querySelectorAll('[data-area-row]').forEach((node) => {
      node.addEventListener('click', () => {
        state.area = String(node.dataset.areaRow);
        syncControls(); run();
      });
    });
  }

  /* --------------------------------------------------------- monthly pie */
  function renderPies() {
    if (!filtered.length) {
      el.pies.innerHTML = '<p class="empty-pie">Tidak ada data untuk filter ini.</p>';
      return;
    }
    const rowsByMonth = new Map();
    filtered.forEach((r) => {
      const key = monthOfRow[rowIndex.get(r)];
      if (!rowsByMonth.has(key)) rowsByMonth.set(key, []);
      rowsByMonth.get(key).push(r);
    });
    const activeMonths = months.filter((m) => rowsByMonth.has(m.key));
    const shown = state.month ? activeMonths.filter((m) => m.key === state.month) : activeMonths;

    el.pies.innerHTML = shown.map((mo) => {
      const agg = new Map();
      (rowsByMonth.get(mo.key) || []).forEach((r) => {
        const acc = agg.get(r[2]) || { value: 0, qty: 0 };
        acc.value += r[5]; acc.qty += r[4];
        agg.set(r[2], acc);
      });
      const list = toList(agg).sort((a, b) =>
        state.metric === 'qty' ? b.qty - a.qty : b.value - a.value);
      const totalVal = list.reduce((s, x) => s + x.value, 0);
      const totalQty = list.reduce((s, x) => s + x.qty, 0);
      const top = list.slice(0, 6);
      const rest = list.slice(6);
      const items = top.map((x) => {
        const p = products[x.key];
        const mval = state.metric === 'qty' ? x.qty : x.value;
        return { value: mval, color: p.color,
          tip: '<strong>' + esc(p.name) + '</strong><span>' + p.brand + '<br>Value: ' + rp(x.value) +
               '<br>Qty: ' + fmt(x.qty) + ' pcs<br>' + pct(mval, state.metric === 'qty' ? totalQty : totalVal) + '</span>' };
      });
      if (rest.length) {
        const rv = rest.reduce((s, x) => s + x.value, 0);
        const rq = rest.reduce((s, x) => s + x.qty, 0);
        items.push({ value: state.metric === 'qty' ? rq : rv, color: '#c5cedb',
          tip: '<strong>Lainnya (' + rest.length + ' SKU)</strong><span>Value: ' + rp(rv) + '<br>Qty: ' + fmt(rq) + ' pcs</span>' });
      }
      const totalMetric = state.metric === 'qty' ? totalQty : totalVal;
      const center = '<small>Total ' + (state.metric === 'qty' ? 'qty' : 'value') + '</small><strong>' +
        (state.metric === 'qty' ? fmt(totalQty) + ' pcs' : shortRp(totalVal)) + '</strong>';
      const legend = items.map((it, idx) => {
        const isOther = idx === top.length;
        const name = isOther ? 'Lainnya (' + rest.length + ' SKU)' : shortProduct(products[top[idx].key].name);
        const share = pct(it.value, totalMetric);
        const full = isOther ? name : products[top[idx].key].name;
        return '<div class="pie-legend-row' + (isOther ? ' other' : '') + '" title="' + esc(full) + '">' +
               '<span class="dot" style="background:' + it.color + '"></span>' +
               '<span class="pie-legend-name">' + esc(name) + '</span>' +
               '<span class="pie-legend-pct">' + share + '</span></div>';
      }).join('');
      const sub = fmt(list.length) + ' SKU · ' + fmt(totalQty) + ' pcs · ' + shortRp(totalVal);
      return '<article class="pie-card"><div class="pie-card-head"><h3>' + mo.label +
             '</h3><span>' + fmt(list.length) + ' SKU</span></div>' +
             '<div class="pie-card-total">' + sub + '</div>' +
             '<div class="pie-card-body">' + donut(items, 124, 19, center) +
             '<div class="pie-legend">' + legend + '</div></div></article>';
    }).join('');
    if (!el.pies.innerHTML) el.pies.innerHTML = '<p class="empty-pie">Tidak ada data untuk filter ini.</p>';
  }

  /* --------------------------------------------------------------- table */
  let tableData = [];
  function renderTable() {
    const agg = new Map();
    filtered.forEach((r) => {
      const key = r[1] + '|' + r[3] + '|' + r[2];
      const acc = agg.get(key) || { area: r[1], mami: r[3], product: r[2], value: 0, qty: 0, count: 0 };
      acc.value += r[5]; acc.qty += r[4]; acc.count++;
      agg.set(key, acc);
    });
    tableData = Array.from(agg.values());
    if (state.search) {
      const q = state.search;
      tableData = tableData.filter((x) =>
        areas[x.area].toLowerCase().includes(q) ||
        mamis[x.mami].toLowerCase().includes(q) ||
        products[x.product].name.toLowerCase().includes(q) ||
        products[x.product].brand.toLowerCase().includes(q));
    }
    tableData.sort((a, b) => (a.value - b.value) * state.sortDir);
    const grand = tableData.reduce((s, x) => s + x.value, 0);
    const shown = tableData.slice(0, state.limit);

    el.tableBody.innerHTML = shown.map((x) => {
      const p = products[x.product];
      const share = grand ? x.value / grand : 0;
      return '<tr><td>' + esc(areas[x.area]) + '</td>' +
        '<td><span class="status-pill">02. Penjualan</span></td>' +
        '<td>' + esc(mamis[x.mami]) + '</td>' +
        '<td><span class="brand-tag ' + p.brand.toLowerCase() + '">' + p.brand + '</span></td>' +
        '<td class="barang" title="' + esc(p.name) + '">' + esc(p.name) + '</td>' +
        '<td class="num">' + fmt(x.qty) + '</td>' +
        '<td class="num"><strong>' + rp(x.value) + '</strong></td>' +
        '<td class="num"><div class="share-cell"><div class="mini-track"><div class="mini-fill" style="width:' +
        Math.max(1, Math.min(100, share * 100)) + '%"></div></div><span>' + pct(x.value, grand) + '</span></div></td></tr>';
    }).join('');

    if (!shown.length) {
      el.tableBody.innerHTML = '<tr><td colspan="8" class="no-rows">Tidak ada data yang cocok.</td></tr>';
    }
    el.tableCount.textContent = 'Menampilkan ' + fmt(shown.length) + ' dari ' + fmt(tableData.length) +
      ' baris agregat' + (state.search ? ' (pencarian: "' + state.search + '")' : '');
    el.loadMore.style.display = shown.length < tableData.length ? '' : 'none';
    $('table-caption').textContent = 'Agregat per Area · Nama Mami Lezza · Nama Barang — ' +
      fmt(filtered.length) + ' baris sumber';
  }

  /* --------------------------------------------------------------- export */
  function exportCSV() {
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const head = ['tgl-jual', 'mm-jual', 'Area', 'Status', 'Nama Mami Lezza',
                  'Brand', 'Nama Barang', 'Qty Pcs terjual', 'Value Terjual'];
    const lines = [head.map(q).join(',')];
    filtered.forEach((r) => {
      const d = dates[r[0]];
      lines.push([d.label, d.monthKey, areas[r[1]], '02. Penjualan', mamis[r[3]],
        products[r[2]].brand, products[r[2]].name, r[4], r[5]].map(q).join(','));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mami-lezza-penjualan-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------------------------------------------------------------- init */
  function initMeta() {
    $('period-label').textContent = dates[0].label + ' – ' + dates[dates.length - 1].label;
    $('source-link').href = D.meta.source;
    const gen = new Date(D.meta.generatedAt);
    $('generated-label').textContent = gen.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    $('footer-meta').textContent = fmt(D.meta.salesRows) + ' baris penjualan · ' +
      fmt(D.meta.sheetRows) + ' baris sumber · diperbarui ' + gen.toLocaleString('id-ID');
  }

  initControls();
  syncControls();
  initMeta();
  run();
})();
