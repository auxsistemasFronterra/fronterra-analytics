# dashboard/ — página de dashboards + servidor MCP

Lee también el `CLAUDE.md` de la raíz del repo (arquitectura general, reglas de datos SAP, pendientes).

## Qué es
- El usuario conversa con Claude (Claude Code / app de escritorio). Claude usa el servidor MCP `dashboards`
  para consultar Postgres y crear gráficas; la página en http://localhost:3000 las muestra y se actualiza sola.
- No hay chat ni API de Anthropic dentro de la página (se evitó el costo extra de la API).

## Stack
- Node.js 24 (CommonJS). `express`, `pg`, `@modelcontextprotocol/sdk`, `zod`. Gráficas con Chart.js 4.4.1 (cdnjs). Sin frameworks de frontend.
- `db.js` — lógica compartida: conexión (SSL de Railway con reintento sin SSL; respeta `sslmode`),
  `readOnlyQuery` (transacción `READ ONLY`, una sola sentencia, `statement_timeout`, máx. 5000 filas),
  CRUD de dashboards y gráficas, validación de columnas (`checkChart`).
- `server.js` — Express: estáticos de `public/` y API (`/api/status|connect|disconnect|query|versions|viewing|dashboards`). `APP_PASSWORD` opcional (Basic auth).
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
npm start            # http://localhost:3000
```
- Conexión: `DATABASE_URL` en `.env` o se pega en la página (se guarda en `config.json`, **nunca subir a git**).
- MCP: abrir la sesión de Claude en la **raíz del repo** (el `.mcp.json` de ahí corre `node dashboard/mcp-server.js`) y aprobar el servidor `dashboards`.
  Requiere haber corrido `npm install` en `dashboard/`.

## Pendiente (ver CLAUDE.md raíz)
- Usar dos conexiones: `postgres` solo para `dashapp`, y un usuario de solo lectura (solo esquema `marts` de dbt) para
  `readOnlyQuery`, `listTables` y `describeTable`.
- Los dashboards actuales están marcados "[Prototipo]": leen el crudo, en MXN, con semana de lunes y desde enero. No cumplen
  `docs/guia_desarrollo.md`. Rehacerlos sobre `marts` (USD, Semana Fronterra, desde junio de 2026) sin lógica en el SQL de la gráfica.
- Si producción es BigQuery, el MCP (hoy solo Postgres) debe poder consultar BigQuery.
