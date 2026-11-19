// Login con Microsoft Entra ID (solo cuentas del tenant de la empresa) y permisos por grupos de seguridad.
//
// Flujo: /auth/login → login.microsoftonline.com (código + PKCE) → /auth/callback → cookie de sesión firmada.
// El rol se calcula al entrar a partir de los grupos del token: Admin > Editor > Lector. Quien no esté en
// ningún grupo no entra. Un cambio de grupos aplica en el siguiente login (la sesión dura SESSION_HOURS).
const crypto = require('crypto');
const msal = require('@azure/msal-node');

const ROLES = ['reader', 'editor', 'admin'];
const ROLE_LABEL = { reader: 'Lector', editor: 'Editor', admin: 'Admin' };
const SESSION_COOKIE = 'fd_session';
const FLOW_COOKIE = 'fd_auth';
const SCOPES = ['User.Read'];

// ---------- Cookies firmadas (HMAC-SHA256) ----------
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const sign = (secret, body) => crypto.createHmac('sha256', secret).update(body).digest('base64url');

function seal(secret, obj) {
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

function unseal(secret, value, type) {
  if (!value) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(secret, body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(body, 'base64url').toString());
    return obj.t === type && obj.exp > Date.now() ? obj : null;
  } catch { return null; }
}

function setCookie(res, name, value, maxAgeSec, secure) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

// ---------- Páginas simples (login fallido, sin permiso, sesión cerrada) ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(res, status, title, message, link = { href: '/login', text: 'Volver a intentar' }) {
  res.status(status).type('html').send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · Dashboards</title>
<style>
  :root { color-scheme: light dark; --bg:#f4f5f7; --card:#fff; --text:#1d2129; --muted:#5f6673; --accent:#4f6bed; }
  @media (prefers-color-scheme: dark) { :root { --bg:#14161a; --card:#1d2026; --text:#e6e8eb; --muted:#9aa1ad; --accent:#7d93f5; } }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--text);
         font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding:16px; box-sizing:border-box; }
  .card { background:var(--card); max-width:420px; width:100%; padding:28px; border-radius:12px; box-shadow:0 1px 4px #0002; }
  h1 { font-size:20px; margin:0 0 8px; } p { color:var(--muted); margin:0 0 20px; }
  a.btn { display:inline-block; background:var(--accent); color:#fff; text-decoration:none; padding:9px 16px; border-radius:8px; }
</style></head><body><div class="card"><h1>${esc(title)}</h1><p>${message}</p>
${link ? `<a class="btn" href="${esc(link.href)}">${esc(link.text)}</a>` : ''}</div></body></html>`);
}

// Pantalla de inicio: botón "Iniciar sesión con Microsoft" antes de ir a login.microsoftonline.com
const MS_LOGO = `<svg width="20" height="20" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022"/>
<rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
<rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>`;

function loginPage(res, returnTo) {
  const href = `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
  res.status(200).type('html').send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Iniciar sesión · Fronterra Dashboards</title>
<style>
  :root { color-scheme: light dark; --bg:#f4f5f7; --card:#fff; --text:#1d2129; --muted:#5f6673; --border:#d9dce1;
          --btn:#fff; --btn-text:#1d2129; --btn-hover:#f3f4f6; --accent:#4f6bed; }
  @media (prefers-color-scheme: dark) { :root { --bg:#14161a; --card:#1d2026; --text:#e6e8eb; --muted:#9aa1ad; --border:#343841;
          --btn:#2a2e36; --btn-text:#e6e8eb; --btn-hover:#323743; --accent:#7d93f5; } }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:16px; background:var(--bg); color:var(--text);
         font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .card { background:var(--card); width:100%; max-width:400px; padding:36px 32px 28px; border-radius:14px;
          box-shadow:0 1px 3px #0001, 0 8px 24px #0001; text-align:center; }
  .mark { width:52px; height:52px; margin:0 auto 16px; border-radius:12px; background:var(--accent); color:#fff;
          display:grid; place-items:center; font-weight:700; font-size:22px; }
  h1 { font-size:22px; margin:0 0 6px; }
  .sub { color:var(--muted); margin:0 0 28px; }
  a.ms { display:flex; align-items:center; justify-content:center; gap:12px; width:100%; padding:11px 16px;
         background:var(--btn); color:var(--btn-text); border:1px solid var(--border); border-radius:8px;
         text-decoration:none; font-weight:600; transition:background .15s; }
  a.ms:hover { background:var(--btn-hover); }
  a.ms:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .note { color:var(--muted); font-size:13px; margin:22px 0 0; }
</style></head><body>
<main class="card">
  <div class="mark" aria-hidden="true">F</div>
  <h1>Fronterra Dashboards</h1>
  <p class="sub">Entra con tu cuenta de Microsoft 365 de la empresa.</p>
  <a class="ms" href="${esc(href)}">${MS_LOGO}<span>Iniciar sesión con Microsoft</span></a>
  <p class="note">¿No tienes acceso? Pide al administrador que te agregue a un grupo de Dashboards.</p>
</main></body></html>`);
}

// ---------- Configuración ----------
function loadConfig(port) {
  const env = process.env;
  const cfg = {
    disabled: env.AUTH_DISABLED === '1',
    tenantId: (env.AZURE_TENANT_ID || '').trim(),
    clientId: (env.AZURE_CLIENT_ID || '').trim(),
    clientSecret: env.AZURE_CLIENT_SECRET || '',
    sessionSecret: env.SESSION_SECRET || '',
    sessionHours: Number(env.SESSION_HOURS || 8),
    groups: {
      admin: (env.GROUP_ADMINS_ID || '').trim(),
      editor: (env.GROUP_EDITORS_ID || '').trim(),
      reader: (env.GROUP_READERS_ID || '').trim(),
    },
    // Direcciones registradas en Entra ID (URI de redirección = base + /auth/callback)
    bases: [env.BASE_URL, `http://localhost:${port}`].filter(Boolean).map((s) => s.trim().replace(/\/+$/, '')),
  };
  if (cfg.disabled) return cfg;

  const missing = [];
  if (!cfg.tenantId) missing.push('AZURE_TENANT_ID');
  if (!cfg.clientId) missing.push('AZURE_CLIENT_ID');
  if (!cfg.clientSecret) missing.push('AZURE_CLIENT_SECRET');
  if (cfg.sessionSecret.length < 32) missing.push('SESSION_SECRET (mínimo 32 caracteres)');
  if (!cfg.groups.admin && !cfg.groups.editor && !cfg.groups.reader) missing.push('GROUP_ADMINS_ID / GROUP_EDITORS_ID / GROUP_READERS_ID');
  if (missing.length) {
    console.error(`Falta configurar el login con Microsoft en dashboard/.env: ${missing.join(', ')}.\n` +
      'Para probar solo en este equipo sin login: AUTH_DISABLED=1 (nunca con el túnel apuntando aquí).');
    process.exit(1);
  }
  return cfg;
}

function roleFromGroups(cfg, groups) {
  for (const role of ['admin', 'editor', 'reader']) if (cfg.groups[role] && groups.includes(cfg.groups[role])) return role;
  return null;
}

const isLocalRequest = (req) =>
  /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(req.headers.host || '') && !req.headers['cf-connecting-ip'];

// Solo rutas internas como destino después del login (evita redirecciones abiertas)
const safeReturn = (v) => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : '/');

// ---------- Módulo ----------
module.exports = function createAuth({ port }) {
  const cfg = loadConfig(port);

  if (cfg.disabled) {
    console.warn('*** AUTH_DISABLED=1: sin login. Solo responde a peticiones hechas en este equipo (localhost). ***');
    return {
      disabled: true,
      routes() {},
      authenticate(req, res, next) {
        if (!isLocalRequest(req)) return page(res, 403, 'Login desactivado', 'Esta instancia corre sin login y solo acepta peticiones locales.', null);
        req.user = { name: 'Prueba local (sin login)', email: '', role: 'admin' };
        next();
      },
      requireRole,
    };
  }

  const cca = new msal.ConfidentialClientApplication({
    auth: {
      clientId: cfg.clientId,
      authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
      clientSecret: cfg.clientSecret,
    },
    system: { loggerOptions: { logLevel: msal.LogLevel.Error, loggerCallback: (_l, m) => console.error(m), piiLoggingEnabled: false } },
  });
  const pkce = new msal.CryptoProvider();

  // Elige la dirección registrada que corresponde al Host de la petición (localhost o BASE_URL)
  function baseFor(req) {
    const host = String(req.headers.host || '').toLowerCase();
    return cfg.bases.find((b) => new URL(b).host === host) || cfg.bases[0];
  }

  function routes(app) {
    // Pantalla de inicio. Con sesión válida, entra directo.
    app.get('/login', (req, res) => {
      const returnTo = safeReturn(req.query.returnTo);
      const s = unseal(cfg.sessionSecret, parseCookies(req)[SESSION_COOKIE], 's');
      if (s && ROLES.includes(s.role)) return res.redirect(returnTo);
      loginPage(res, returnTo);
    });

    app.get('/auth/login', async (req, res) => {
      try {
        const base = baseFor(req);
        const { verifier, challenge } = await pkce.generatePkceCodes();
        const state = crypto.randomBytes(24).toString('base64url');
        const flow = { t: 'f', state, verifier, base, returnTo: safeReturn(req.query.returnTo), exp: Date.now() + 10 * 60e3 };
        setCookie(res, FLOW_COOKIE, seal(cfg.sessionSecret, flow), 600, base.startsWith('https:'));
        const url = await cca.getAuthCodeUrl({
          scopes: SCOPES, redirectUri: `${base}/auth/callback`, state,
          codeChallenge: challenge, codeChallengeMethod: 'S256', responseMode: 'query',
        });
        res.redirect(url);
      } catch (err) {
        console.error('Error al iniciar login:', err.message);
        page(res, 500, 'No se pudo iniciar sesión', 'Error al contactar a Microsoft. Intenta de nuevo en un momento.');
      }
    });

    app.get('/auth/callback', async (req, res) => {
      const flow = unseal(cfg.sessionSecret, parseCookies(req)[FLOW_COOKIE], 'f');
      setCookie(res, FLOW_COOKIE, '', 0, flow?.base.startsWith('https:'));
      if (req.query.error) {
        return page(res, 401, 'No se pudo iniciar sesión', esc(req.query.error_description || req.query.error));
      }
      if (!flow || !req.query.code || req.query.state !== flow.state) {
        return page(res, 400, 'El inicio de sesión expiró', 'Vuelve a intentarlo.');
      }
      try {
        const result = await cca.acquireTokenByCode({
          code: String(req.query.code), scopes: SCOPES, redirectUri: `${flow.base}/auth/callback`, codeVerifier: flow.verifier,
        });
        if (result.account) await cca.getTokenCache().removeAccount(result.account).catch(() => {});
        const c = result.idTokenClaims || {};
        const email = c.preferred_username || c.email || '';

        if (c.tid !== cfg.tenantId) return page(res, 403, 'Cuenta no permitida', 'Solo se aceptan cuentas de la empresa.', null);
        if (c._claim_names?.groups || c.hasgroups) {
          return page(res, 403, 'Demasiados grupos', `La cuenta ${esc(email)} pertenece a demasiados grupos para leerlos en el login. Avisa al administrador.`, null);
        }
        const role = roleFromGroups(cfg, Array.isArray(c.groups) ? c.groups : []);
        if (!role) {
          console.warn(`Acceso negado (sin grupo): ${email}`);
          return page(res, 403, 'Sin acceso',
            `La cuenta <b>${esc(email)}</b> no está en ningún grupo de Dashboards. Pide al administrador que te agregue a ` +
            '<b>Dashboards-Lectores</b>, <b>Dashboards-Editores</b> o <b>Dashboards-Admin</b>.', { href: '/auth/logout', text: 'Usar otra cuenta' });
        }
        const session = { t: 's', oid: c.oid, name: c.name || email, email, role, exp: Date.now() + cfg.sessionHours * 3600e3 };
        setCookie(res, SESSION_COOKIE, seal(cfg.sessionSecret, session), Math.floor(cfg.sessionHours * 3600), flow.base.startsWith('https:'));
        console.log(`Login: ${email} (${ROLE_LABEL[role]})`);
        res.redirect(flow.returnTo);
      } catch (err) {
        console.error('Error al validar login:', err.errorCode || '', err.message);
        page(res, 401, 'No se pudo iniciar sesión', 'Microsoft no aceptó el inicio de sesión. Intenta de nuevo.');
      }
    });

    // Botón "Salir" y URL de cierre de sesión de canal frontal registrada en Entra ID
    app.get('/auth/logout', (req, res) => {
      const secure = baseFor(req).startsWith('https:');
      setCookie(res, SESSION_COOKIE, '', 0, secure);
      setCookie(res, FLOW_COOKIE, '', 0, secure);
      page(res, 200, 'Sesión cerrada', 'Cerraste sesión en Dashboards.', { href: '/login', text: 'Entrar de nuevo' });
    });
  }

  function authenticate(req, res, next) {
    const s = unseal(cfg.sessionSecret, parseCookies(req)[SESSION_COOKIE], 's');
    if (s && ROLES.includes(s.role)) { req.user = s; return next(); }
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Tu sesión venció. Vuelve a entrar.', login: true });
    if (req.method === 'GET') return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    res.status(401).end();
  }

  return { disabled: false, routes, authenticate, requireRole };
};

function requireRole(min) {
  return (req, res, next) => (ROLES.indexOf(req.user?.role) >= ROLES.indexOf(min)
    ? next()
    : res.status(403).json({ error: `Necesitas permiso de ${ROLE_LABEL[min]} para esto` }));
}

module.exports.ROLE_LABEL = ROLE_LABEL;
