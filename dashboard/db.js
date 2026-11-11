// Lógica de base de datos compartida entre la página (server.js) y el servidor MCP (mcp-server.js)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool, types } = require('pg');

types.setTypeParser(1082, (v) => v); // DATE como 'YYYY-MM-DD'

const CONFIG_FILE = path.join(__dirname, 'config.json');
const QUERY_TIMEOUT_MS = Number(process.env.QUERY_TIMEOUT_MS || 20000);
const MAX_ROWS = Number(process.env.MAX_ROWS || 5000);
const CHART_TYPES = ['bar', 'hbar', 'line', 'area', 'pie', 'doughnut', 'number', 'table'];

let pool = null;
let connectionInfo = null;

function savedConnection() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).connectionString || null; } catch { return null; }
}

function saveConnection(cs) {
  if (cs) fs.writeFileSync(CONFIG_FILE, JSON.stringify({ connectionString: cs }, null, 2));
  else try { fs.unlinkSync(CONFIG_FILE); } catch {}
}

function describe(cs) {
  try { const u = new URL(cs); return { host: u.hostname, database: u.pathname.slice(1) }; }
  catch { return { host: '?', database: '?' }; }
}

async function makePool(connectionString) {
  // Railway acepta SSL autofirmado; si el servidor no tiene SSL, reintenta sin él.
  const attempts = /[?&]sslmode=/i.test(connectionString) ? [undefined] : [{ rejectUnauthorized: false }, false];
  let lastErr;
  for (const ssl of attempts) {
    const opts = { connectionString, max: Number(process.env.PG_POOL_MAX || 5), connectionTimeoutMillis: 10000 };
    if (ssl !== undefined) opts.ssl = ssl;
    const p = new Pool(opts);
    p.on('error', (err) => console.error('Conexión de Postgres cerrada:', err.message)); // evita que un corte tumbe el proceso
    try { (await p.connect()).release(); return p; } catch (err) { lastErr = err; await p.end().catch(() => {}); }
  }
  throw lastErr;
}

async function connect(connectionString) {
  const p = await makePool(connectionString);
  await p.query(`
    CREATE SCHEMA IF NOT EXISTS dashapp;
    CREATE TABLE IF NOT EXISTS dashapp.dashboards (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      widgets JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE dashapp.dashboards DROP COLUMN IF EXISTS messages;
    CREATE TABLE IF NOT EXISTS dashapp.app_state (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);
  if (pool) await pool.end().catch(() => {});
  pool = p;
  connectionInfo = describe(connectionString);
}

async function disconnect() {
  if (pool) await pool.end().catch(() => {});
  pool = null;
  connectionInfo = null;
}

const isConnected = () => !!pool;
const info = () => connectionInfo;

function requirePool() {
  if (!pool) throw new Error('No hay conexión a la base de datos. Abre la página y conecta tu Postgres primero.');
  return pool;
}

// Consulta en transacción de SOLO LECTURA, una sola sentencia, con timeout.
async function readOnlyQuery(sql) {
  sql = String(sql || '').trim().replace(/;\s*$/, '');
  if (!sql) throw new Error('La consulta está vacía');
  const client = await requirePool().connect();
  const started = Date.now();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${QUERY_TIMEOUT_MS}`);
    const r = await client.query({ text: sql, queryMode: 'extended' });
    await client.query('ROLLBACK');
    const rows = r.rows || [];
    return {
      columns: (r.fields || []).map((f) => f.name),
      rows: rows.slice(0, MAX_ROWS),
      rowCount: rows.length,
      truncated: rows.length > MAX_ROWS,
      ms: Date.now() - started,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------- Esquema ----------
async function listTables() {
  const { rows } = await requirePool().query(`
    SELECT t.table_schema || '.' || t.table_name AS tabla,
           (SELECT count(*) FROM information_schema.columns c
             WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name)::int AS columnas,
           greatest(coalesce(pc.reltuples, 0), 0)::bigint AS filas_aprox
    FROM information_schema.tables t
    LEFT JOIN pg_namespace pn ON pn.nspname = t.table_schema
    LEFT JOIN pg_class pc ON pc.relnamespace = pn.oid AND pc.relname = t.table_name
    WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema', 'dashapp')
      AND t.table_schema NOT LIKE 'pg_toast%'
    ORDER BY 1`);
  return rows;
}

async function describeTable(table, search) {
  const [schema, name] = table.includes('.') ? table.split('.', 2) : ['public', table];
  const params = [schema.replace(/"/g, ''), name.replace(/"/g, '')];
  let sql = `SELECT column_name AS c, data_type AS t FROM information_schema.columns
             WHERE table_schema = $1 AND table_name = $2`;
  if (search) { params.push(`%${search}%`); sql += ' AND column_name ILIKE $3'; }
  const { rows } = await requirePool().query(sql + ' ORDER BY ordinal_position', params);
  if (!rows.length) throw new Error(search ? `Ninguna columna de ${table} contiene "${search}"` : `No existe la tabla ${table}`);
  return rows.map((r) => `${r.c}: ${r.t}`).join('\n');
}

// ---------- Dashboards ----------
const notFound = () => Object.assign(new Error('Dashboard no encontrado'), { status: 404 });

async function listDashboards() {
  const { rows } = await requirePool().query(
    `SELECT id, name, jsonb_array_length(widgets) AS graficas, updated_at
     FROM dashapp.dashboards ORDER BY updated_at DESC`);
  return rows;
}

async function getDashboard(id) {
  const { rows } = await requirePool().query('SELECT id, name, widgets, updated_at FROM dashapp.dashboards WHERE id = $1', [id]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

async function createDashboard(name) {
  const { rows } = await requirePool().query(
    'INSERT INTO dashapp.dashboards (name) VALUES ($1) RETURNING id, name, widgets, updated_at',
    [String(name || '').trim() || 'Nuevo dashboard']);
  return rows[0];
}

async function updateDashboard(id, { name, widgets }) {
  const { rows } = await requirePool().query(
    `UPDATE dashapp.dashboards SET
       name = COALESCE($2, name),
       widgets = COALESCE($3::jsonb, widgets),
       updated_at = now()
     WHERE id = $1 RETURNING id, name, widgets, updated_at`,
    [id, name ?? null, widgets ? JSON.stringify(widgets) : null]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

async function deleteDashboard(id) {
  await requirePool().query('DELETE FROM dashapp.dashboards WHERE id = $1', [id]);
}

// Versión de los dashboards, para que la página detecte cambios hechos por Claude
async function versions() {
  const p = requirePool();
  const [{ rows: dash }, { rows: state }] = await Promise.all([
    p.query('SELECT id, updated_at FROM dashapp.dashboards'),
    p.query(`SELECT key, value FROM dashapp.app_state WHERE key = 'focus'`),
  ]);
  return {
    dashboards: Object.fromEntries(dash.map((d) => [d.id, d.updated_at])),
    focus: state[0]?.value || null,
  };
}

async function setState(key, value) {
  await requirePool().query(
    `INSERT INTO dashapp.app_state (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]);
}

async function getState(key) {
  const { rows } = await requirePool().query('SELECT value, updated_at FROM dashapp.app_state WHERE key = $1', [key]);
  return rows[0] || null;
}

// ---------- Gráficas ----------
function checkChart(w, result) {
  if (!CHART_TYPES.includes(w.type)) throw new Error(`Tipo inválido "${w.type}". Usa: ${CHART_TYPES.join(', ')}`);
  const cols = result.columns;
  if (!['table', 'number'].includes(w.type) && w.x && !cols.includes(w.x)) throw new Error(`La columna x "${w.x}" no está en el resultado (${cols.join(', ')})`);
  for (const y of w.y || []) if (!cols.includes(y)) throw new Error(`La columna y "${y}" no está en el resultado (${cols.join(', ')})`);
  if (w.series && !cols.includes(w.series)) throw new Error(`La columna series "${w.series}" no está en el resultado (${cols.join(', ')})`);
}

async function addChart(dashboardId, chart) {
  const w = { id: crypto.randomUUID().slice(0, 8), size: chart.type === 'number' ? 2 : 3, y: [], ...chart };
  const result = await readOnlyQuery(w.sql);
  checkChart(w, result);
  const d = await getDashboard(dashboardId);
  await updateDashboard(d.id, { widgets: [...d.widgets, w] });
  return { id: w.id, result };
}

async function updateChart(dashboardId, chartId, changes) {
  const d = await getDashboard(dashboardId);
  const idx = d.widgets.findIndex((w) => w.id === chartId);
  if (idx < 0) throw new Error(`No existe la gráfica ${chartId} en el dashboard ${dashboardId}`);
  const { position, ...rest } = changes;
  const w = { ...d.widgets[idx], ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };
  const result = await readOnlyQuery(w.sql);
  checkChart(w, result);
  const widgets = [...d.widgets];
  widgets.splice(idx, 1);
  widgets.splice(position ?? idx, 0, w);
  await updateDashboard(d.id, { widgets });
  return { result };
}

async function removeChart(dashboardId, chartId) {
  const d = await getDashboard(dashboardId);
  const widgets = d.widgets.filter((w) => w.id !== chartId);
  if (widgets.length === d.widgets.length) throw new Error(`No existe la gráfica ${chartId} en el dashboard ${dashboardId}`);
  await updateDashboard(d.id, { widgets });
}

module.exports = {
  CHART_TYPES, savedConnection, saveConnection, connect, disconnect, isConnected, info,
  readOnlyQuery, listTables, describeTable,
  listDashboards, getDashboard, createDashboard, updateDashboard, deleteDashboard,
  versions, setState, getState, addChart, updateChart, removeChart,
};
