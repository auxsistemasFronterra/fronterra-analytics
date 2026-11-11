// Página de dashboards. Las gráficas las crea Claude a través del servidor MCP (mcp-server.js).
const path = require('path');
const crypto = require('crypto');
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {}

const express = require('express');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || '';

const app = express();
app.use(express.json({ limit: '1mb' }));

if (APP_PASSWORD) {
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const pass = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
      const a = Buffer.from(pass), b = Buffer.from(APP_PASSWORD);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Dashboards"').status(401).send('Autenticación requerida');
  });
}
app.use(express.static(path.join(__dirname, 'public')));

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => res.status(err.status || 400).json({ error: err.message }));
const needDb = (req, res, next) => (db.isConnected() ? next() : res.status(409).json({ error: 'No hay conexión a la base de datos' }));

app.get('/api/status', (req, res) => res.json({ connected: db.isConnected(), info: db.info(), fromEnv: !!process.env.DATABASE_URL }));

app.post('/api/connect', wrap(async (req, res) => {
  if (process.env.DATABASE_URL) throw new Error('La conexión está fijada por la variable DATABASE_URL');
  const cs = String(req.body?.connectionString || '').trim();
  if (!/^postgres(ql)?:\/\//.test(cs)) throw new Error('Cadena inválida. Debe empezar con postgresql://');
  await db.connect(cs);
  db.saveConnection(cs);
  res.json({ ok: true, info: db.info() });
}));

app.post('/api/disconnect', wrap(async (req, res) => {
  if (process.env.DATABASE_URL) throw new Error('La conexión está fijada por la variable DATABASE_URL');
  await db.disconnect();
  db.saveConnection(null);
  res.json({ ok: true });
}));

app.post('/api/query', needDb, wrap(async (req, res) => res.json(await db.readOnlyQuery(req.body?.sql))));
app.get('/api/versions', needDb, wrap(async (req, res) => res.json(await db.versions())));
app.post('/api/viewing', needDb, wrap(async (req, res) => {
  await db.setState('viewing', { id: Number(req.body?.id) });
  res.json({ ok: true });
}));

app.get('/api/dashboards', needDb, wrap(async (req, res) => res.json(await db.listDashboards())));
app.post('/api/dashboards', needDb, wrap(async (req, res) => res.json(await db.createDashboard(req.body?.name))));
app.get('/api/dashboards/:id', needDb, wrap(async (req, res) => res.json(await db.getDashboard(req.params.id))));
app.put('/api/dashboards/:id', needDb, wrap(async (req, res) => {
  const { name, widgets } = req.body || {};
  res.json(await db.updateDashboard(req.params.id, { name, widgets }));
}));
app.delete('/api/dashboards/:id', needDb, wrap(async (req, res) => {
  await db.deleteDashboard(req.params.id);
  res.json({ ok: true });
}));

(async () => {
  const cs = db.savedConnection();
  if (cs) {
    try { await db.connect(cs); console.log(`Conectado a ${db.info().host}/${db.info().database}`); }
    catch (err) { console.error('No se pudo conectar:', err.message); }
  }
  app.listen(PORT, () => console.log(`Dashboards en http://localhost:${PORT}`));
})();
