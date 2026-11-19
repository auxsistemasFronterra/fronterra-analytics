# dashboard/ — página de dashboards + servidor MCP

Lee también el `CLAUDE.md` de la raíz del repo (arquitectura general, reglas de datos SAP, pendientes).

## Qué es
- El usuario conversa con Claude (Claude Code / app de escritorio). Claude usa el servidor MCP `dashboards`
  para consultar Postgres y crear gráficas; la página en http://localhost:8501 las muestra y se actualiza sola.
- No hay chat ni API de Anthropic dentro de la página (se evitó el costo extra de la API).
- Publicada en https://fronterra-portal.vdv.one por un **túnel de Cloudflare** (servicio Windows `Cloudflared` en el servidor,
  configurado con token; la cuenta de Cloudflare es del proveedor, no de Fronterra). El túnel entra por `localhost:8501`.

## Login y permisos (Microsoft Entra ID)
- `auth.js`: login con el tenant de Microsoft 365 (app registrada "Fronterra Dashboards", inquilino único), flujo de código + PKCE
  con `@azure/msal-node`. Sesión en cookie firmada HMAC (`fd_session`, HttpOnly, SameSite=Lax, 8 h). Rutas: `/login` (pantalla
  de inicio con botón "Iniciar sesión con Microsoft"; sin sesión todo redirige aquí), `/auth/login` (va a Microsoft),
  `/auth/callback`, `/auth/logout` (también es la URL de cierre de sesión de canal frontal).
- Todas las respuestas llevan `Cache-Control: private, no-cache`: Cloudflare guardaba `.js`/`.css` 4 h y servía versiones viejas.
  Al cambiar `app.js` o `styles.css`, subir el `?v=` en `index.html`.
- Roles por **grupos de seguridad** (claim `groups`, Id. de grupo; las licencias Business Standard no permiten asignar grupos a la app):
  `Dashboards-Lectores` ver · `Dashboards-Editores` + crear/renombrar dashboards y quitar gráficas · `Dashboards-Admin` + borrar
  dashboards y conectar/desconectar la base. Sin grupo → no entra. El rol se calcula al entrar; un cambio aplica en el siguiente login.
- El servidor valida el rol en cada ruta (`requireRole`); la página solo oculta botones (`.need-editor`, `.need-admin`).
- **El navegador nunca manda SQL.** Se quitó `/api/query`; cada gráfica se ejecuta con `GET /api/dashboards/:id/charts/:chartId/data`
  usando el SQL guardado. `PUT /api/dashboards/:id` solo acepta gráficas que ya existen (quitar/reordenar). El SQL solo lo crea Claude por MCP.
- Escucha en `127.0.0.1` (`HOST`). Sin la config de Entra no arranca. `AUTH_DISABLED=1` es solo para pruebas locales: entra como Admin
  y rechaza peticiones con Host distinto de localhost o con cabecera `cf-connecting-ip` (las que llegan por el túnel).
- Valores en `dashboard/.env` (plantilla `.env.example`): `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (vence;
  renovarlo en Entra), `GROUP_*_ID`, `BASE_URL`, `SESSION_SECRET`. Se quitó `APP_PASSWORD` (Basic auth).

## Stack
- Node.js 24 (CommonJS). `express`, `pg`, `@azure/msal-node`, `@modelcontextprotocol/sdk`, `zod`. Gráficas con Chart.js 4.4.1 (cdnjs). Sin frameworks de frontend.
- `db.js` — lógica compartida: conexión (SSL de Railway con reintento sin SSL; respeta `sslmode`),
  `readOnlyQuery` (transacción `READ ONLY`, una sola sentencia, `statement_timeout`, máx. 5000 filas),
  CRUD de dashboards y gráficas, validación de columnas (`checkChart`).
- `server.js` — Express: login (`auth.js`), estáticos de `public/` y API (`/api/me|status|connect|disconnect|versions|viewing|dashboards`,
  `/api/dashboards/:id/charts/:chartId/data`), con rol mínimo por ruta.
- `mcp-server.js` — servidor MCP stdio. Herramientas: list_tables, describe_table, run_query, list_dashboards, get_dashboard,
  create_dashboard, show_dashboard, rename_dashboard, add_chart, update_chart, remove_chart. Nunca escribir a stdout (es del protocolo).
  Sus `instructions` incluyen las secciones Arquitectura, Reglas y Decisiones del `CLAUDE.md` raíz (fuente única de las reglas de datos;
  edítalas ahí, no aquí). Se registra en `.mcp.json` de la raíz del repo con ruta relativa.
- `public/` — `index.html`, `app.js` (render de gráficas, polling de `/api/versions` cada 2 s), `styles.css`.

## Datos de la app
- Esquema `dashapp` en la misma base: `dashboards (id, name, widgets jsonb, …)` y `app_state (key, value, updated_at)`.
- Cada gráfica guarda `{id, title, type, sql, x, y[], series?, stacked?, size}`; tipos: bar, hbar, line, area, pie, doughnut, number, table.
  `series` = formato largo (x, categoría, valor) pivotado a una serie por categoría.
- `app_state.viewing` lo escribe la página; `app_state.focus` lo escribe Claude (create/show_dashboard). Si se omite `dashboard_id`, se usa el más reciente de los dos.

## Correr
```
npm install
npm start            # http://localhost:8501 (y https://fronterra-portal.vdv.one por el túnel)
```
- Requiere `dashboard/.env` con la config de Entra (ver arriba). Para probar sin login en el servidor: `$env:AUTH_DISABLED="1"; npm start`.
- Conexión: `DATABASE_URL` en `.env` o un Admin la pega en la página (se guarda en `config.json`, **nunca subir a git**).
- Hoy corre a mano en una terminal; pendiente dejarlo como servicio de Windows con un usuario sin privilegios.
- MCP: abrir la sesión de Claude en la **raíz del repo** (el `.mcp.json` de ahí corre `node dashboard/mcp-server.js`) y aprobar el servidor `dashboards`.
  Requiere haber corrido `npm install` en `dashboard/`.

## Pendiente (ver CLAUDE.md raíz)
- Usar dos conexiones: `postgres` solo para `dashapp`, y un usuario de solo lectura (solo esquema `marts` de dbt) para
  `readOnlyQuery`, `listTables` y `describeTable`.
- Los dashboards actuales están marcados "[Prototipo]": leen el crudo, en MXN, con semana de lunes y desde enero. No cumplen
  `docs/guia_desarrollo.md`. Rehacerlos sobre `marts` (USD, Semana Fronterra, desde junio de 2026) sin lógica en el SQL de la gráfica.
- Si producción es BigQuery, el MCP (hoy solo Postgres) debe poder consultar BigQuery.
