# Dashboards con Claude (MCP)

Una página que muestra dashboards de tu PostgreSQL (Railway) y un **servidor MCP** que le da a Claude
acceso a tus datos y a esos dashboards. Platicas con Claude en la app de Claude (Claude Code o la
pestaña Code de la app de escritorio): él revisa tablas, prueba consultas y crea las gráficas, y la página
se actualiza sola en unos 2 segundos.

No usa la API de Anthropic, así que no hay costo extra: lo cubre tu plan de Claude.

```
Tú ──chat──▶ Claude ──MCP──▶ mcp-server.js ──▶ Postgres (datos + esquema dashapp)
                                                     ▲
                       página (server.js) ──consulta─┘  ← se refresca sola
```

## Puesta en marcha

```bash
npm install
copy .env.example .env    # y llenar los valores de Entra ID (login con Microsoft)
npm start
```

1. Abre http://localhost:8501 (o https://fronterra-portal.vdv.one) y entra con tu cuenta de Microsoft de la empresa.
   Tienes que estar en uno de los grupos `Dashboards-Lectores`, `Dashboards-Editores` o `Dashboards-Admin`.
   Si la página no está conectada, un Admin pega la cadena de conexión de Postgres
   (Railway → servicio Postgres → Variables → `DATABASE_PUBLIC_URL`). Se guarda en `config.json`.
2. Abre una sesión de Claude en la raíz del repo (`fronterra-analytics/`). El `.mcp.json` de ahí registra el
   servidor `dashboards`; Claude te pedirá aprobarlo la primera vez.
3. Pídele algo a Claude: "arma un dashboard de ventas del año", "agrega el top 10 de clientes",
   "cambia la gráfica de ventas a líneas".

Si no dices qué dashboard, Claude usa el que tienes abierto en la página.

## Archivos

| Archivo | Qué es |
|---|---|
| `server.js` | La página web (puerto 8501, solo `127.0.0.1`) |
| `auth.js` | Login con Microsoft Entra ID y roles por grupo |
| `mcp-server.js` | Servidor MCP que usa Claude (lo arranca Claude solo) |
| `db.js` | Conexión y consultas compartidas |
| `../CLAUDE.md` | Reglas de tus datos (secciones Arquitectura, Reglas y Decisiones) que Claude lee al conectarse |
| `../.mcp.json` | Registro del servidor MCP para Claude |

## Herramientas MCP

| Herramienta | Qué hace |
|---|---|
| `list_tables`, `describe_table` | Ver tablas y columnas |
| `run_query` | SQL de **solo lectura** (máx. 50 filas) |
| `list_dashboards`, `get_dashboard` | Ver dashboards y sus gráficas |
| `create_dashboard`, `show_dashboard`, `rename_dashboard` | Crear, abrir en la página o renombrar |
| `add_chart`, `update_chart`, `remove_chart` | Crear, cambiar o quitar gráficas |

Seguridad: las consultas corren en transacciones de solo lectura, una sentencia a la vez y con timeout.
Lo único que se escribe es el esquema `dashapp` (dashboards y estado de la página).

## Notas

- Si cambias las reglas en `../CLAUDE.md`, reinicia el servidor MCP (o la sesión de Claude) para que lo lea.
- La página se publica en https://fronterra-portal.vdv.one con un túnel de Cloudflare que entra por `localhost:8501`.
  El MCP sigue funcionando desde tu computadora porque ambos usan la misma base.
- La página nunca manda SQL: cada gráfica corre el SQL que Claude guardó en el dashboard.
