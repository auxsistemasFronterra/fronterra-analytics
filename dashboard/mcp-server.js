// Servidor MCP: le da a Claude (Claude Code / app de escritorio) acceso a tu Postgres
// y a los dashboards de la página. Se comunica por stdio: nunca escribir a stdout con console.log.
const path = require('path');
const fs = require('fs');
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {}

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const db = require('./db');

console.log = console.error; // stdout es del protocolo MCP

const PAGE_URL = `http://localhost:${process.env.PORT || 3000}`;

// Contexto de los datos: secciones Arquitectura, Reglas y Decisiones del CLAUDE.md de la raíz del repo
// (fuente única que comparten todas las sesiones). Se omiten "Cómo trabajamos" y "Pendientes".
const CONTEXT_SECTIONS = /^## (Arquitectura|Reglas|Decisiones)/;
function readContext() {
  let md;
  try { md = fs.readFileSync(path.join(__dirname, '..', 'CLAUDE.md'), 'utf8'); } catch { return ''; }
  return md.split(/^(?=## )/m).filter((s) => CONTEXT_SECTIONS.test(s)).join('\n').trim();
}

const instructions = `Herramientas para analizar la base PostgreSQL del usuario y construir dashboards que él ve en vivo en ${PAGE_URL} (la página se actualiza sola en ~2 segundos cuando cambias algo).

Cómo trabajar:
- Si el usuario no dice qué dashboard, usa el que tiene abierto en la página (las herramientas lo eligen solas si omites dashboard_id).
- Antes de escribir SQL sobre una tabla que no conoces, revisa sus columnas con describe_table (usa "search" en tablas con muchas columnas). No inventes columnas.
- Verifica con run_query que los números tienen sentido antes de graficar y avisa si ves algo raro en los datos.
- Cuando el usuario pida ver algo, créalo como gráfica con add_chart. Tipos: number (KPI), line/area (series de tiempo), bar, hbar (rankings con nombres largos), pie/doughnut (pocas categorías), table (detalle).
- Para desgloses en el tiempo (p. ej. ventas por producto por semana) devuelve filas (x, categoría, valor) y usa "series" + "stacked".
- Redondea montos en SQL y usa alias claros en español: se muestran como etiquetas.
- El usuario puede borrar o mover gráficas a mano; usa get_dashboard antes de modificar gráficas existentes.

Contexto de los datos (del CLAUDE.md de la raíz del repo):
${readContext() || '(vacío)'}`;

const server = new McpServer({ name: 'dashboards', version: '1.0.0' }, { instructions });

// ---------- Utilidades ----------
let connecting = null;
async function ensureDb() {
  if (db.isConnected()) return;
  const cs = db.savedConnection();
  if (!cs) throw new Error(`No hay conexión configurada. Abre ${PAGE_URL} y conecta tu Postgres primero.`);
  connecting ??= db.connect(cs).finally(() => { connecting = null; });
  await connecting;
}

// Dashboard por defecto: el último que se abrió, ya sea el usuario en la página ('viewing')
// o Claude con create_dashboard / show_dashboard ('focus'). Si no hay, el más reciente.
async function resolveDashboard(id) {
  if (id) return id;
  const [viewing, focus] = await Promise.all([db.getState('viewing'), db.getState('focus')]);
  const latest = [viewing, focus].filter((s) => s?.value?.id)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
  if (latest) {
    try { return (await db.getDashboard(latest.value.id)).id; } catch {}
  }
  const list = await db.listDashboards();
  if (list[0]) return list[0].id;
  return (await db.createDashboard('Mi dashboard')).id;
}

const clip = (v) => (typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v);
const sample = (rows, n) => rows.slice(0, n).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, clip(v)])));

function tool(name, description, inputSchema, handler) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      await ensureDb();
      const out = await handler(args);
      let text = typeof out === 'string' ? out : JSON.stringify(out, null, 1);
      if (text.length > 60000) text = text.slice(0, 60000) + '\n…(recortado)';
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${err.message}` }] };
    }
  });
}

const dashboardId = z.number().int().optional().describe('ID del dashboard. Si se omite, se usa el que el usuario tiene abierto en la página.');
const chartFields = {
  title: z.string().describe('Título de la gráfica'),
  sql: z.string().describe('Consulta SELECT/WITH de PostgreSQL'),
  type: z.enum(db.CHART_TYPES).describe('number = KPI (primera fila); bar; hbar = barras horizontales; line; area; pie; doughnut; table'),
  x: z.string().optional().describe('Columna de etiquetas / eje X (no aplica a number ni table)'),
  y: z.array(z.string()).optional().describe('Columnas numéricas a graficar (para number, la columna del KPI)'),
  series: z.string().optional().describe('Para datos en formato largo (x, categoría, valor): columna cuyos valores se vuelven series, una por valor (p. ej. producto por semana). Usa una sola columna en "y". Agrupa las categorías menores como \'Otros\' en el SQL para no pasar de ~8 series.'),
  stacked: z.boolean().optional().describe('Apila las series (bar, hbar, area). Útil con "series" para ver el total y su composición.'),
  size: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(6)]).optional()
    .describe('Ancho en cuadrícula de 6: 2 = un tercio (KPIs), 3 = mitad, 4 = dos tercios, 6 = completo (tablas)'),
};

// ---------- Herramientas ----------
tool('list_tables', 'Lista las tablas de la base con número de columnas y filas aproximadas.', {},
  () => db.listTables());

tool('describe_table', 'Columnas (nombre: tipo) de una tabla. Usa "search" para filtrar en tablas con cientos de columnas.',
  { table: z.string().describe('Tabla con esquema, p. ej. "sap_hana_raw.oinv"'), search: z.string().optional().describe('Texto que debe contener el nombre de la columna') },
  ({ table, search }) => db.describeTable(table, search));

tool('run_query', 'Ejecuta SQL de solo lectura y devuelve hasta 50 filas. Una sola sentencia; no puede modificar datos.',
  { sql: z.string() },
  async ({ sql }) => {
    const r = await db.readOnlyQuery(sql);
    return { columnas: r.columns, filas_totales: r.rowCount, ms: r.ms, filas: sample(r.rows, 50) };
  });

tool('list_dashboards', 'Lista los dashboards e indica cuál tiene abierto el usuario en la página.', {},
  async () => {
    const [list, current] = await Promise.all([db.listDashboards(), resolveDashboard()]);
    return list.map((d) => ({ ...d, abierto_en_pagina: d.id === current }));
  });

tool('get_dashboard', 'Gráficas de un dashboard (id, título, tipo, tamaño, columnas y SQL).', { dashboard_id: dashboardId },
  async ({ dashboard_id }) => db.getDashboard(await resolveDashboard(dashboard_id)));

tool('create_dashboard', 'Crea un dashboard nuevo y lo abre en la página del usuario.', { name: z.string() },
  async ({ name }) => {
    const d = await db.createDashboard(name);
    await db.setState('focus', { id: d.id, at: Date.now() });
    return { id: d.id, name: d.name, url: PAGE_URL };
  });

tool('show_dashboard', 'Abre un dashboard en la página del usuario.', { dashboard_id: z.number().int() },
  async ({ dashboard_id }) => {
    await db.getDashboard(dashboard_id);
    await db.setState('focus', { id: dashboard_id, at: Date.now() });
    return { ok: true };
  });

tool('rename_dashboard', 'Cambia el nombre de un dashboard.', { dashboard_id: dashboardId, name: z.string() },
  async ({ dashboard_id, name }) => {
    const d = await db.updateDashboard(await resolveDashboard(dashboard_id), { name });
    return { id: d.id, name: d.name };
  });

tool('add_chart', 'Agrega una gráfica a un dashboard. La consulta se ejecuta para validarla; si falla, recibes el error.',
  { dashboard_id: dashboardId, ...chartFields },
  async ({ dashboard_id, ...chart }) => {
    const id = await resolveDashboard(dashboard_id);
    const r = await db.addChart(id, chart);
    return { ok: true, dashboard_id: id, chart_id: r.id, filas: r.result.rowCount, muestra: sample(r.result.rows, 3) };
  });

tool('update_chart', 'Modifica una gráfica. Envía solo los campos a cambiar; "position" la mueve (0 = primera).',
  {
    dashboard_id: dashboardId,
    chart_id: z.string(),
    title: chartFields.title.optional(),
    sql: chartFields.sql.optional(),
    type: chartFields.type.optional(),
    x: chartFields.x,
    y: chartFields.y,
    series: chartFields.series,
    stacked: chartFields.stacked,
    size: chartFields.size,
    position: z.number().int().min(0).optional(),
  },
  async ({ dashboard_id, chart_id, ...changes }) => {
    const id = await resolveDashboard(dashboard_id);
    const r = await db.updateChart(id, chart_id, changes);
    return { ok: true, filas: r.result.rowCount, muestra: sample(r.result.rows, 3) };
  });

tool('remove_chart', 'Elimina una gráfica de un dashboard.', { dashboard_id: dashboardId, chart_id: z.string() },
  async ({ dashboard_id, chart_id }) => {
    await db.removeChart(await resolveDashboard(dashboard_id), chart_id);
    return { ok: true };
  });

(async () => {
  await server.connect(new StdioServerTransport());
  console.error('Servidor MCP de dashboards listo');
})();
