// Página de dashboards. Las gráficas las crea Claude a través del servidor MCP (mcp-server.js).
// Login con Microsoft Entra ID y permisos por grupo (auth.js):
//   Lector  → ver dashboards
//   Editor  → además crear y renombrar dashboards y quitar gráficas
//   Admin   → además borrar dashboards y cambiar la conexión a la base
// El navegador nunca manda SQL: cada gráfica se ejecuta con el SQL guardado en el dashboard.
const path = require('path');
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {}

const express = require('express');
const db = require('./db');

const PORT = Number(process.env.PORT || 8501);
const HOST = process.env.HOST || '127.0.0.1'; // solo local: el túnel de Cloudflare entra por localhost
const auth = require('./auth')({ port: PORT });

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    // Cloudflare guarda .js/.css 4 h por defecto: con "private" no los guarda y el navegador revalida siempre
    'Cache-Control': 'private, no-cache',
  });
  next();
});
app.use(express.json({ limit: '1mb' }));

auth.routes(app);           // /auth/login, /auth/callback, /auth/logout (sin sesión)
app.use(auth.authenticate); // todo lo demás requiere sesión
app.use(express.static(path.join(__dirname, 'public'), { cacheControl: false }));

const reader = auth.requireRole('reader');
const editor = auth.requireRole('editor');
const admin = auth.requireRole('admin');

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => res.status(err.status || 400).json({ error: err.message }));
const needDb = (req, res, next) => (db.isConnected() ? next() : res.status(409).json({ error: 'No hay conexión a la base de datos' }));
const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });

app.get('/api/me', (req, res) => {
  const { name, email, role } = req.user;
  res.json({ name, email, role, authDisabled: auth.disabled });
});

app.get('/api/status', reader, (req, res) => res.json({ connected: db.isConnected(), info: db.info(), fromEnv: !!process.env.DATABASE_URL }));

app.post('/api/connect', admin, wrap(async (req, res) => {
  if (process.env.DATABASE_URL) throw new Error('La conexión está fijada por la variable DATABASE_URL');
  const cs = String(req.body?.connectionString || '').trim();
  if (!/^postgres(ql)?:\/\//.test(cs)) throw new Error('Cadena inválida. Debe empezar con postgresql://');
  await db.connect(cs);
  db.saveConnection(cs);
  res.json({ ok: true, info: db.info() });
}));

app.post('/api/disconnect', admin, wrap(async (req, res) => {
  if (process.env.DATABASE_URL) throw new Error('La conexión está fijada por la variable DATABASE_URL');
  await db.disconnect();
  db.saveConnection(null);
  res.json({ ok: true });
}));

app.get('/api/versions', reader, needDb, wrap(async (req, res) => res.json(await db.versions())));
// Le dice a Claude qué dashboard está abierto; solo quien edita (los lectores no mueven el foco de Claude)
app.post('/api/viewing', editor, needDb, wrap(async (req, res) => {
  await db.setState('viewing', { id: Number(req.body?.id) });
  res.json({ ok: true });
}));

app.get('/api/dashboards', reader, needDb, wrap(async (req, res) => res.json(await db.listDashboards())));
app.post('/api/dashboards', editor, needDb, wrap(async (req, res) => res.json(await db.createDashboard(req.body?.name))));
app.get('/api/dashboards/:id', reader, needDb, wrap(async (req, res) => res.json(await db.getDashboard(req.params.id))));

// Datos de una gráfica: corre el SQL guardado en el dashboard (solo lectura)
app.get('/api/dashboards/:id/charts/:chartId/data', reader, needDb, wrap(async (req, res) => {
  const d = await db.getDashboard(req.params.id);
  const w = d.widgets.find((x) => x.id === req.params.chartId);
  if (!w) throw Object.assign(new Error('Gráfica no encontrada'), { status: 404 });
  res.json(await db.readOnlyQuery(w.sql));
}));

// Renombrar y quitar o reordenar gráficas. Las gráficas nuevas o su SQL solo se crean desde Claude (MCP).
app.put('/api/dashboards/:id', editor, needDb, wrap(async (req, res) => {
  const { name } = req.body || {};
  let { widgets } = req.body || {};
  if (widgets !== undefined) {
    if (!Array.isArray(widgets)) throw badRequest('widgets debe ser una lista');
    const current = new Map((await db.getDashboard(req.params.id)).widgets.map((w) => [w.id, w]));
    widgets = widgets.map((w) => {
      const existing = current.get(w?.id);
      if (!existing) throw badRequest('Las gráficas solo se crean o modifican desde Claude');
      return existing;
    });
  }
  res.json(await db.updateDashboard(req.params.id, { name, widgets }));
}));

app.delete('/api/dashboards/:id', admin, needDb, wrap(async (req, res) => {
  await db.deleteDashboard(req.params.id);
  res.json({ ok: true });
}));

(async () => {
  const cs = db.savedConnection();
  if (cs) {
    try { await db.connect(cs); console.log(`Conectado a ${db.info().host}/${db.info().database}`); }
    catch (err) { console.error('No se pudo conectar:', err.message); }
  }
  app.listen(PORT, HOST, () => console.log(`Dashboards en http://localhost:${PORT} (escuchando en ${HOST})`));
})();
