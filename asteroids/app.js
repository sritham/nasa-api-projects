// Asteroid tracker: pulls a week of near-Earth asteroid passes from NASA NeoWs.
(() => {
  const KEY_STORE = 'neo.apiKey';
  const CACHE_PREFIX = 'neo.feed.';
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // NASA updates this data a few times a day at most
  const $ = (s) => document.querySelector(s);

  const state = {
    start: startOfDay(new Date()),
    rows: [],
    hazOnly: false,
    sortKey: 'missLD',
    sortDir: 1,
    loadId: 0,
  };

  // ---------- small helpers ----------
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const fmtRange = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

  function fmtKm(km) {
    if (km >= 1e6) return `${(km / 1e6).toFixed(1)}M km`;
    if (km >= 1e3) return `${Math.round(km / 1e3).toLocaleString()}k km`;
    return `${Math.round(km).toLocaleString()} km`;
  }
  function fmtLD(ld) { return ld < 10 ? ld.toFixed(2) : ld.toFixed(1); }
  function fmtSize(r) {
    const a = Math.round(r.diaMinM), b = Math.round(r.diaMaxM);
    return b >= 1000 ? `${(r.diaMinM / 1000).toFixed(1)}–${(r.diaMaxM / 1000).toFixed(1)} km` : `${a}–${b} m`;
  }

  function store(fn) { try { return fn(localStorage); } catch (e) { return null; } }

  // ---------- API key ----------
  function getKey() {
    const saved = store((s) => s.getItem(KEY_STORE));
    if (saved) return { key: saved, source: 'your saved key' };
    if (window.NASA_API_KEY) return { key: window.NASA_API_KEY, source: 'the key in config.local.js' };
    return { key: 'DEMO_KEY', source: "NASA's shared demo key" };
  }
  function showKeySource() {
    $('#key-source').textContent = `Currently using ${getKey().source}.`;
  }

  // ---------- data ----------
  function toRow(neo) {
    const ca = (neo.close_approach_data || []).find((c) => c.orbiting_body === 'Earth') || neo.close_approach_data[0];
    const dm = neo.estimated_diameter.meters;
    return {
      id: neo.id,
      name: neo.name.replace(/^\((.*)\)$/, '$1'),
      url: neo.nasa_jpl_url,
      hazardous: neo.is_potentially_hazardous_asteroid,
      time: ca.epoch_date_close_approach,
      missLD: Number(ca.miss_distance.lunar),
      missKm: Number(ca.miss_distance.kilometers),
      speedKms: Number(ca.relative_velocity.kilometers_per_second),
      diaMinM: dm.estimated_diameter_min,
      diaMaxM: dm.estimated_diameter_max,
      diaAvgM: (dm.estimated_diameter_min + dm.estimated_diameter_max) / 2,
    };
  }

  async function fetchWeek(start) {
    const { key } = getKey();
    const url = `https://api.nasa.gov/neo/rest/v1/feed?start_date=${ymd(start)}&end_date=${ymd(addDays(start, 6))}&api_key=${encodeURIComponent(key)}`;
    let res;
    try { res = await fetch(url); } catch (e) { throw new Error("Couldn't reach NASA. Check your connection and try again."); }
    if (res.status === 429) throw new Error("NASA's hourly request limit was reached for this key. Add your own free key under API key settings below, or try again in an hour.");
    if (res.status === 403) throw new Error('NASA did not accept this API key. Check it under API key settings below.');
    if (!res.ok) throw new Error(`NASA returned an error (${res.status}). Try again in a bit.`);
    const data = await res.json();
    return Object.values(data.near_earth_objects).flat().map(toRow);
  }

  function readCache(k) {
    const raw = store((s) => s.getItem(CACHE_PREFIX + k));
    if (!raw) return null;
    try {
      const c = JSON.parse(raw);
      return Date.now() - c.t < CACHE_TTL_MS ? c.rows : null;
    } catch (e) { return null; }
  }
  function writeCache(k, rows) { store((s) => s.setItem(CACHE_PREFIX + k, JSON.stringify({ t: Date.now(), rows }))); }

  async function load() {
    const id = ++state.loadId;
    const start = state.start;
    $('#start').value = ymd(start);
    $('#range-label').textContent = `${fmtRange.format(start)} – ${fmtRange.format(addDays(start, 6))}`;
    let rows = readCache(ymd(start));
    if (!rows) {
      setStatus('Loading asteroid data from NASA…');
      try { rows = await fetchWeek(start); } catch (e) {
        if (id === state.loadId) { setStatus(e.message, true); state.rows = []; render(); }
        return;
      }
      writeCache(ymd(start), rows);
    }
    if (id !== state.loadId) return; // a newer week was requested meanwhile
    setStatus('');
    state.rows = rows;
    render();
  }

  function setStatus(msg, isError) {
    const el = $('#status');
    el.hidden = !msg;
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
  }

  // ---------- render ----------
  function visibleRows() { return state.hazOnly ? state.rows.filter((r) => r.hazardous) : state.rows; }

  function render() {
    const rows = visibleRows();
    renderTiles(state.rows);
    renderChart(rows);
    renderTable(rows);
  }

  function renderTiles(all) {
    const el = $('#tiles');
    if (!all.length) { el.innerHTML = ''; return; }
    const haz = all.filter((r) => r.hazardous).length;
    const closest = all.reduce((a, b) => (b.missLD < a.missLD ? b : a));
    const biggest = all.reduce((a, b) => (b.diaMaxM > a.diaMaxM ? b : a));
    const tile = (label, value, note) => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="note">${note}</div></div>`;
    el.innerHTML = [
      tile('Asteroids this week', all.length, 'close approaches to Earth'),
      tile('Potentially hazardous', haz, haz ? `${Math.round((haz / all.length) * 100)}% of this week's passes` : 'none this week'),
      tile('Closest pass', fmtKm(closest.missKm), `${esc(closest.name)}, ${closest.missLD < 1 ? 'closer than the Moon' : `${fmtLD(closest.missLD)}× the Moon's distance`}`),
      tile('Biggest', fmtSize(biggest), esc(biggest.name)),
    ].join('');
  }

  function renderChart(rows) {
    const wrap = $('#chart');
    hideTip();
    if (!rows.length) { wrap.innerHTML = `<p class="empty">${state.rows.length ? 'No potentially hazardous asteroids this week.' : 'No data to show.'}</p>`; return; }

    const W = Math.max(wrap.clientWidth, 280);
    const H = W < 520 ? 280 : 340;
    const m = { t: 18, r: 12, b: 34, l: 40 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const t0 = state.start.getTime(), t1 = addDays(state.start, 7).getTime();
    const x = (v) => m.l + ((v - t0) / (t1 - t0)) * pw;

    const lds = rows.map((r) => r.missLD);
    const lo = Math.floor(Math.log10(Math.min(...lds, 1)));
    let hi = Math.ceil(Math.log10(Math.max(...lds)));
    if (hi <= lo) hi = lo + 1;
    const y = (v) => m.t + (1 - (Math.log10(v) - lo) / (hi - lo)) * ph;

    const dMax = Math.max(...rows.map((r) => r.diaAvgM));
    const rad = (d) => 4 + 10 * Math.sqrt(d / dMax);

    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter chart of ${rows.length} asteroids by approach time and miss distance. The table below lists the same data.">`;

    // horizontal grid: powers of ten
    s += '<g class="grid axis">';
    for (let k = lo; k <= hi; k++) {
      const v = 10 ** k, yy = y(v);
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
      s += `<text x="${m.l - 6}" y="${yy + 4}" text-anchor="end">${v >= 1 ? v.toLocaleString() : v}</text>`;
    }
    // vertical day lines + labels
    const narrow = pw / 7 < 48;
    for (let i = 0; i <= 7; i++) {
      const xx = x(addDays(state.start, i).getTime());
      s += `<line x1="${xx}" x2="${xx}" y1="${m.t}" y2="${H - m.b}"/>`;
      if (i < 7) {
        const d = addDays(state.start, i);
        const label = narrow ? d.getDate() : fmtDay.format(d).replace(/,.*$/, '') + ' ' + d.getDate();
        s += `<text x="${xx + pw / 14}" y="${H - m.b + 16}" text-anchor="middle">${label}</text>`;
      }
    }
    s += '</g>';

    // Moon reference line at 1 lunar distance
    const ym = y(1);
    s += `<line class="moon" x1="${m.l}" x2="${W - m.r}" y1="${ym}" y2="${ym}"/>`;
    s += `<text class="moon-label" x="${W - m.r - 2}" y="${ym - 5}" text-anchor="end">Moon</text>`;

    // marks: biggest first so small ones stay on top
    const order = rows.map((r, i) => i).sort((a, b) => rows[b].diaAvgM - rows[a].diaAvgM);
    for (const i of order) {
      const r = rows[i];
      const cx = x(r.time), cy = y(r.missLD), rr = rad(r.diaAvgM);
      const shape = r.hazardous
        ? `<path class="mark" d="M${cx} ${cy - rr * 1.25}L${cx + rr * 1.25} ${cy}L${cx} ${cy + rr * 1.25}L${cx - rr * 1.25} ${cy}Z"/>`
        : `<circle class="mark" cx="${cx}" cy="${cy}" r="${rr}"/>`;
      s += `<g class="dot ${r.hazardous ? 'haz' : 'normal'}" data-i="${i}"><circle class="hit" cx="${cx}" cy="${cy}" r="${rr + 8}"/>${shape}</g>`;
    }
    s += '</svg>';
    wrap.innerHTML = s;
    wrap._rows = rows;
  }

  // tooltip
  const tip = () => $('#tooltip');
  function hideTip() {
    tip().hidden = true;
    document.querySelectorAll('.dot.active').forEach((d) => d.classList.remove('active'));
  }
  function showTip(dot, evt) {
    const rows = $('#chart')._rows;
    const r = rows && rows[Number(dot.dataset.i)];
    if (!r) return;
    document.querySelectorAll('.dot.active').forEach((d) => d.classList.remove('active'));
    dot.classList.add('active');
    const t = tip();
    const when = new Date(r.time);
    t.innerHTML = `<strong>${esc(r.name)}</strong>
      ${r.hazardous ? '<div class="row"><span class="badge">Potentially hazardous</span></div>' : ''}
      <div class="row"><span>Closest</span><b>${fmtDay.format(when)}, ${fmtTime.format(when)}</b></div>
      <div class="row"><span>Miss distance</span><b>${fmtLD(r.missLD)}× Moon</b></div>
      <div class="row"><span></span><b>${fmtKm(r.missKm)}</b></div>
      <div class="row"><span>Size</span><b>${fmtSize(r)}</b></div>
      <div class="row"><span>Speed</span><b>${r.speedKms.toFixed(1)} km/s</b></div>`;
    t.hidden = false;
    const card = t.parentElement.getBoundingClientRect();
    const box = dot.getBoundingClientRect();
    const tw = t.offsetWidth, th = t.offsetHeight;
    let left = box.left + box.width / 2 - card.left - tw / 2;
    left = Math.max(8, Math.min(left, card.width - tw - 8));
    let top = box.top - card.top - th - 8;
    if (top < 8) top = box.bottom - card.top + 8;
    t.style.left = `${left}px`;
    t.style.top = `${top}px`;
  }

  function renderTable(rows) {
    const k = state.sortKey, dir = state.sortDir;
    const sorted = [...rows].sort((a, b) => {
      const va = a[k], vb = b[k];
      return (typeof va === 'string' ? va.localeCompare(vb) : (va === vb ? 0 : va < vb ? -1 : 1)) * dir;
    });
    document.querySelectorAll('th button').forEach((b) => {
      if (b.dataset.sort === k) b.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
      else b.removeAttribute('aria-sort');
    });
    $('#table tbody').innerHTML = sorted.map((r) => {
      const when = new Date(r.time);
      return `<tr class="${r.hazardous ? 'haz-row' : ''}">
        <td data-label="Name"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a></td>
        <td data-label="Closest approach"><span>${fmtDay.format(when)}<span class="sec">${fmtTime.format(when)}</span></span></td>
        <td data-label="Miss distance"><span>${fmtLD(r.missLD)}× Moon<span class="sec">${fmtKm(r.missKm)}</span></span></td>
        <td data-label="Size">${fmtSize(r)}</td>
        <td data-label="Speed">${r.speedKms.toFixed(1)} km/s</td>
        <td data-label="Hazard">${r.hazardous ? '<span class="badge">Hazardous</span>' : '<span class="none">No</span>'}</td>
      </tr>`;
    }).join('');
  }

  // ---------- events ----------
  function goTo(d) { state.start = startOfDay(d); load(); }
  $('#prev').addEventListener('click', () => goTo(addDays(state.start, -7)));
  $('#next').addEventListener('click', () => goTo(addDays(state.start, 7)));
  $('#today').addEventListener('click', () => goTo(new Date()));
  $('#start').addEventListener('change', (e) => { if (e.target.value) goTo(parseYmd(e.target.value)); });
  $('#haz-only').addEventListener('change', (e) => { state.hazOnly = e.target.checked; render(); });

  document.querySelectorAll('th button').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.sort;
    if (state.sortKey === k) state.sortDir *= -1;
    else { state.sortKey = k; state.sortDir = k === 'hazardous' ? -1 : 1; }
    renderTable(visibleRows());
  }));

  const chart = $('#chart');
  chart.addEventListener('pointerover', (e) => { const d = e.target.closest('.dot'); if (d) showTip(d, e); });
  chart.addEventListener('pointerdown', (e) => { const d = e.target.closest('.dot'); if (d) showTip(d, e); else hideTip(); });
  chart.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(); });

  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => renderChart(visibleRows()), 150); });

  $('#key-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#key-input').value.trim();
    if (!v) return;
    store((s) => s.setItem(KEY_STORE, v));
    $('#key-input').value = '';
    showKeySource();
    load();
  });
  $('#key-clear').addEventListener('click', () => { store((s) => s.removeItem(KEY_STORE)); showKeySource(); });

  showKeySource();
  load();
})();
