// ---------- Estado ----------
const state = {
  dashboards: [],
  current: null,      // { id, name, widgets, updated_at }
  charts: new Map(),  // canvas -> Chart
  versions: null,     // última versión conocida (para detectar cambios de Claude)
  focusAt: null,
};

const $ = (s) => document.querySelector(s);
const PALETTE = ['#4f6bed', '#20a37a', '#f2994a', '#d6457a', '#8e6cf0', '#2bb3c9', '#c9a227', '#6b7380'];
const fmt = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });
const POLL_MS = 2000;

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ---------- Utilidades ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNumeric = (v) => v !== null && v !== '' && typeof v !== 'boolean' && !isNaN(Number(v));
const isIdCol = (c) => /(^id$|_id$|^id_|folio|num|code|codigo|entry)/i.test(c);
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function fmtCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return new Date(v).toLocaleString('es-MX');
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v))) return fmt.format(Number(v));
  return String(v);
}

function numericColumns(result) {
  return result.columns.filter((c) => {
    const sample = result.rows.slice(0, 50).map((r) => r[c]).filter((v) => v !== null);
    return sample.length > 0 && sample.every(isNumeric);
  });
}

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2500);
}

// ---------- Gráficas ----------
function destroyChartsIn(el) {
  el.querySelectorAll('canvas').forEach((c) => { state.charts.get(c)?.destroy(); state.charts.delete(c); });
}

function renderResult(el, w, result) {
  destroyChartsIn(el);
  if (!result.rows.length) { el.innerHTML = '<div class="widget-msg">Sin resultados</div>'; return; }

  if (w.type === 'table') {
    const cols = result.columns;
    const cell = (c, v) => (isIdCol(c) && v !== null ? String(v) : fmtCell(v));
    el.innerHTML = `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${result.rows.map((r) => `<tr>${cols.map((c) => `<td class="${isNumeric(r[c]) && !isIdCol(c) ? 'num' : ''}">${esc(cell(c, r[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    return;
  }

  if (w.type === 'number') {
    const col = w.y?.[0] || numericColumns(result)[0] || result.columns[0];
    const v = fmtCell(result.rows[0][col]);
    el.innerHTML = `<div class="kpi-value" title="${esc(v)}">${esc(v)}</div><div class="kpi-label">${esc(col)}</div>`;
    return;
  }

  const x = w.x && result.columns.includes(w.x) ? w.x : result.columns[0];
  let ys = (w.y || []).filter((c) => result.columns.includes(c));
  if (!ys.length) ys = numericColumns(result).filter((c) => c !== x && c !== w.series).slice(0, 1);
  if (!ys.length) { el.innerHTML = '<div class="widget-msg">No hay columnas numéricas para graficar</div>'; return; }

  const type = w.type;
  const isPie = type === 'pie' || type === 'doughnut';
  let labels, series;
  if (w.series && result.columns.includes(w.series) && !isPie) {
    // Formato largo (x, serie, valor): una serie por cada valor de la columna "series",
    // ordenadas de mayor a menor total ("Otros" al final).
    const y = ys[0];
    const xs = [...new Set(result.rows.map((r) => r[x]))];
    const totals = new Map();
    const cells = new Map();
    for (const r of result.rows) {
      const s = String(r[w.series] ?? '—');
      const v = r[y] === null ? 0 : Number(r[y]);
      totals.set(s, (totals.get(s) || 0) + v);
      cells.set(`${s}\u0000${r[x]}`, (cells.get(`${s}\u0000${r[x]}`) || 0) + v);
    }
    const names = [...totals.keys()].sort((a, b) => (a === 'Otros') - (b === 'Otros') || totals.get(b) - totals.get(a));
    labels = xs.map(fmtCell);
    series = names.map((s) => ({ label: s, data: xs.map((xv) => cells.get(`${s}\u0000${xv}`) ?? null) }));
  } else {
    labels = result.rows.map((r) => fmtCell(r[x]));
    series = ys.map((col) => ({ label: col, data: result.rows.map((r) => (r[col] === null ? null : Number(r[col]))) }));
  }
  const datasets = series.map((s, i) => {
    const color = s.label === 'Otros' ? '#9aa1ad' : PALETTE[i % PALETTE.length];
    return {
      label: s.label,
      data: s.data,
      backgroundColor: isPie ? labels.map((_, j) => PALETTE[j % PALETTE.length]) : type === 'area' ? color + '33' : color,
      borderColor: isPie ? cssVar('--panel') : color,
      borderWidth: isPie ? 2 : type === 'line' || type === 'area' ? 2 : 0,
      borderRadius: type === 'bar' || type === 'hbar' ? 4 : 0,
      fill: type === 'area' ? (w.stacked ? (i ? '-1' : 'origin') : 'origin') : false,
      tension: 0.25,
      pointRadius: type === 'area' || labels.length > 60 ? 0 : 3,
    };
  });
  const stacked = !!w.stacked && !isPie;

  el.innerHTML = '<canvas></canvas>';
  const canvas = el.querySelector('canvas');
  const grid = cssVar('--border'), text = cssVar('--muted');
  state.charts.set(canvas, new Chart(canvas, {
    type: { hbar: 'bar', area: 'line' }[type] || type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: type === 'hbar' ? 'y' : 'x',
      animation: { duration: 300 },
      plugins: {
        legend: { display: isPie || datasets.length > 1, position: isPie ? 'right' : 'top', labels: { color: text, boxWidth: 12 } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw === null ? '—' : fmt.format(c.raw)}` } },
      },
      scales: isPie ? {} : {
        x: { stacked, grid: { color: grid, display: type === 'hbar' }, ticks: { color: text, maxRotation: 45, autoSkip: true } },
        y: {
          stacked,
          grid: { color: grid, display: type !== 'hbar' }, beginAtZero: true,
          // En barras horizontales, recorta nombres largos (el tooltip muestra el nombre completo)
          ticks: type !== 'hbar' ? { color: text } : {
            color: text,
            callback(v) {
              const l = String(this.getLabelForValue(v));
              const max = this.chart.width < 450 ? 16 : 24;
              return l.length > max ? l.slice(0, max - 1) + '…' : l;
            },
          },
        },
      },
    },
  }));
}

async function runWidget(el, w) {
  if (!el.children.length) el.innerHTML = '<div class="widget-msg">Cargando…</div>';
  try {
    renderResult(el, w, await api('/query', { method: 'POST', body: { sql: w.sql } }));
  } catch (err) {
    destroyChartsIn(el);
    el.innerHTML = `<div class="widget-msg err">${esc(err.message)}</div>`;
  }
}

// ---------- Dashboard ----------
const widgetKey = (w) => JSON.stringify([w.title, w.sql, w.type, w.x, w.y, w.size, w.series, w.stacked]);

// Re-dibuja el dashboard. Solo vuelve a consultar las gráficas nuevas o modificadas.
function renderDashboard(force = false) {
  const grid = $('#grid');
  const d = state.current;
  $('#no-dash').classList.toggle('hidden', !!d);
  $('.topbar').classList.toggle('hidden', !d);
  if (!d) { destroyChartsIn(grid); grid.innerHTML = ''; $('#empty-state').classList.add('hidden'); return; }

  $('#dash-title').textContent = d.name;
  document.title = `${d.name} · Dashboards`;
  $('#empty-state').classList.toggle('hidden', d.widgets.length > 0);
  document.querySelectorAll('#dashboard-list li').forEach((li) => li.classList.toggle('active', Number(li.dataset.id) === d.id));

  const existing = new Map([...grid.children].map((el) => [el.dataset.id, el]));
  const firstRender = existing.size === 0;
  const keep = new Set();
  d.widgets.forEach((w, i) => {
    let card = existing.get(w.id);
    const changed = !card || card.dataset.key !== widgetKey(w);
    if (!card) {
      card = document.createElement('div');
      card.dataset.id = w.id;
      card.innerHTML = `
        <div class="widget-head"><h3></h3>
          <div class="widget-tools">
            <button data-act="sql" title="Ver SQL">SQL</button>
            <button data-act="del" title="Eliminar">✕</button>
          </div>
        </div>
        <div class="widget-body"></div>`;
      card.querySelector('.widget-tools').addEventListener('click', (e) => {
        const act = e.target.closest('button')?.dataset.act;
        if (act) widgetAction(act, card.dataset.id);
      });
    }
    card.className = 'widget' + (w.type === 'number' ? ' kpi' : '');
    card.style.gridColumn = `span ${w.size || 3}`;
    card.querySelector('h3').textContent = w.title || 'Sin título';
    card.querySelector('h3').title = w.title || '';
    if (grid.children[i] !== card) grid.insertBefore(card, grid.children[i] || null);
    if (changed || force) {
      card.dataset.key = widgetKey(w);
      runWidget(card.querySelector('.widget-body'), w);
      if (!firstRender && !force) {
        card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
      }
    }
    keep.add(w.id);
  });
  for (const [id, el] of existing) if (!keep.has(id)) { destroyChartsIn(el); el.remove(); }
}

async function widgetAction(act, id) {
  const w = state.current.widgets.find((x) => x.id === id);
  if (!w) return;
  if (act === 'sql') {
    $('#sql-title').textContent = w.title;
    $('#sql-code').textContent = w.sql;
    $('#copy-ref').dataset.ref = `la gráfica «${w.title}» (id ${w.id}) del dashboard «${state.current.name}»`;
    $('#sql-dialog').showModal();
  }
  if (act === 'del') {
    if (!confirm(`¿Eliminar "${w.title}"?`)) return;
    state.current = await api(`/dashboards/${state.current.id}`, {
      method: 'PUT', body: { widgets: state.current.widgets.filter((x) => x.id !== id) },
    });
    renderDashboard();
  }
}

function renderList() {
  $('#dashboard-list').innerHTML = state.dashboards.map((d) =>
    `<li data-id="${d.id}" class="${d.id === state.current?.id ? 'active' : ''}" title="${esc(d.name)}">${esc(d.name)}<span class="count">${d.graficas}</span></li>`).join('');
}

async function loadDashboards(selectId) {
  state.dashboards = await api('/dashboards');
  let id = selectId;
  if (id == null) { try { id = Number(localStorage.getItem('dash:last')); } catch {} }
  const target = state.dashboards.find((d) => d.id === id) || state.dashboards[0];
  if (target) await openDashboard(target.id);
  else { state.current = null; renderList(); renderDashboard(); }
}

async function openDashboard(id) {
  state.current = await api(`/dashboards/${id}`);
  try { localStorage.setItem('dash:last', id); } catch {}
  api('/viewing', { method: 'POST', body: { id } }).catch(() => {}); // Claude sabe qué dashboard estás viendo
  $('#sidebar').classList.remove('open');
  destroyChartsIn($('#grid'));
  $('#grid').innerHTML = '';
  renderList();
  renderDashboard();
}

async function createDashboard() {
  const name = prompt('Nombre del dashboard:', 'Nuevo dashboard');
  if (!name) return;
  const d = await api('/dashboards', { method: 'POST', body: { name } });
  await loadDashboards(d.id);
}

// ---------- En vivo: detecta cambios hechos por Claude ----------
async function poll() {
  try {
    const v = await api('/versions');
    const prev = state.versions;
    state.versions = v;
    if (!prev) { state.focusAt = v.focus?.at ?? null; return; }

    // Claude pidió abrir un dashboard
    if (v.focus && v.focus.at !== state.focusAt) {
      state.focusAt = v.focus.at;
      if (v.focus.id !== state.current?.id) {
        state.dashboards = await api('/dashboards');
        await openDashboard(v.focus.id);
        toast('Claude abrió este dashboard');
        return;
      }
    }

    const ids = (o) => Object.keys(o).sort().join(',');
    const listChanged = ids(v.dashboards) !== ids(prev.dashboards)
      || Object.keys(v.dashboards).some((k) => v.dashboards[k] !== prev.dashboards[k]);
    if (listChanged) { state.dashboards = await api('/dashboards'); renderList(); }

    const cur = state.current;
    if (cur && v.dashboards[cur.id] && v.dashboards[cur.id] !== cur.updated_at) {
      state.current = await api(`/dashboards/${cur.id}`);
      renderDashboard();
      $('.live').classList.add('pulse');
      setTimeout(() => $('.live').classList.remove('pulse'), 1200);
    } else if (cur && !v.dashboards[cur.id]) {
      await loadDashboards();
    }
    $('.live').classList.remove('off');
  } catch {
    $('.live')?.classList.add('off');
  }
}

// ---------- Conexión ----------
let pollTimer;
async function showConnected(info) {
  $('#connect-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#conn-info').innerHTML = `<span class="dot"></span>${esc(info.database)} @ ${esc(info.host)}`;
  await loadDashboards();
  if (!state.dashboards.length) {
    const d = await api('/dashboards', { method: 'POST', body: { name: 'Mi dashboard' } });
    await loadDashboards(d.id);
  }
  clearInterval(pollTimer);
  state.versions = null;
  poll();
  pollTimer = setInterval(poll, POLL_MS);
}

function showConnect(fromEnv) {
  clearInterval(pollTimer);
  $('#app-view').classList.add('hidden');
  $('#connect-view').classList.remove('hidden');
  if (fromEnv) $('#connect-error').textContent = 'DATABASE_URL está configurada pero no se pudo conectar. Revisa los logs del servidor.';
}

async function init() {
  const st = await api('/status');
  $('#disconnect').classList.toggle('hidden', st.fromEnv);
  if (st.connected) await showConnected(st.info);
  else showConnect(st.fromEnv);
}

// ---------- Eventos ----------
$('#connect-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true; btn.textContent = 'Conectando…';
  $('#connect-error').textContent = '';
  try {
    await api('/connect', { method: 'POST', body: { connectionString: $('#conn-input').value.trim() } });
    $('#conn-input').value = '';
    await init();
  } catch (err) {
    $('#connect-error').textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Conectar';
  }
});
$('#conn-show').addEventListener('change', (e) => { $('#conn-input').type = e.target.checked ? 'text' : 'password'; });
$('#disconnect').addEventListener('click', async () => {
  if (!confirm('¿Desconectar de esta base de datos? Tus dashboards quedan guardados en ella.')) return;
  await api('/disconnect', { method: 'POST' });
  showConnect(false);
});

$('#new-dashboard').addEventListener('click', createDashboard);
$('#create-first').addEventListener('click', createDashboard);
$('#dashboard-list').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (li) openDashboard(Number(li.dataset.id));
});
$('#toggle-sidebar').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#refresh').addEventListener('click', () => renderDashboard(true));
$('#dash-title').addEventListener('click', async () => {
  const name = prompt('Nuevo nombre:', state.current.name);
  if (!name || name === state.current.name) return;
  state.current = await api(`/dashboards/${state.current.id}`, { method: 'PUT', body: { name } });
  renderDashboard();
});
$('#delete-dashboard').addEventListener('click', async () => {
  if (!confirm(`¿Eliminar el dashboard "${state.current.name}" y todas sus gráficas?`)) return;
  await api(`/dashboards/${state.current.id}`, { method: 'DELETE' });
  await loadDashboards();
});
$('#copy-ref').addEventListener('click', async (e) => {
  try { await navigator.clipboard.writeText(e.target.dataset.ref); toast('Copiado. Pégalo en tu mensaje a Claude.'); }
  catch { toast('No se pudo copiar'); }
});

init().catch((err) => { document.body.innerHTML = `<p class="error" style="padding:20px">${esc(err.message)}</p>`; });
