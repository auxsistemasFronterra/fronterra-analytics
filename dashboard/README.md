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
npm start
```

1. Abre http://localhost:3000 y pega la cadena de conexión pública de tu Postgres
   (Railway → servicio Postgres → Variables → `DATABASE_PUBLIC_URL`). Se guarda en `config.json`.
2. Abre una sesión de Claude en la raíz del repo (`fronterra-analytics/`). El `.mcp.json` de ahí registra el
   servidor `dashboards`; Claude te pedirá aprobarlo la primera vez.
3. Pídele algo a Claude: "arma un dashboard de ventas del año", "agrega el top 10 de clientes",
   "cambia la gráfica de ventas a líneas".

Si no dices qué dashboard, Claude usa el que tienes abierto en la página.

## Archivos

| Archivo | Qué es |
|---|---|
| `server.js` | La página web (puerto 3000) |
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
- La página también se puede publicar en Railway (`DATABASE_URL` y `APP_PASSWORD` como variables) para
  que otros vean los dashboards; el MCP sigue funcionando desde tu computadora porque ambos usan la misma base.
