# fronterra-analytics

Contexto compartido para las sesiones de Claude que trabajan en este repo. Léelo completo antes de empezar.

```
fronterra-analytics/
├── CLAUDE.md      este archivo (contexto compartido)
├── .mcp.json      registra el servidor MCP "dashboards" (node dashboard/mcp-server.js)
├── pipeline/      Python + dlt (SAP HANA → Postgres) y luego dbt — ver pipeline/CLAUDE.md
└── dashboard/     app de dashboards + servidor MCP (Node 24) — ver dashboard/CLAUDE.md
```

Abre las sesiones de Claude en la raíz del repo para tener el MCP `dashboards` (requiere `npm install` en `dashboard/` y `dashboard/config.json` o `.env` con la conexión, que no van al repo).
Las secciones Arquitectura, Reglas y Decisiones de este archivo también se le pasan al MCP como contexto: mantenlas al día.

## Arquitectura
SAP HANA → dlt (pipeline/) → Postgres en Railway (base hanaDB, esquema sap_hana_raw = datos crudos) → dbt (pipeline/) → esquema analytics (datos curados) → app de dashboards (dashboard/): página web en localhost:3000 + servidor MCP para que Claude consulte y cree gráficas. Los dashboards se guardan en el esquema dashapp.

- Origen: SAP Business One sobre SAP HANA on-premise, esquema `FRONTERRA_PROTO`. HANA solo es accesible desde la red interna (servidor Windows); la PC externa no puede correr el pipeline contra HANA.
- El pipeline hoy hace reemplazo completo de 9 tablas de ventas y se corre a mano (sin tarea programada). Detalle en `pipeline/CLAUDE.md`.
- En Postgres las tablas y columnas están en minúsculas snake_case (`DocEntry` → `doc_entry`). Postgres usa `LIMIT`, no `TOP`.

## Reglas de datos SAP Business One
- oinv/inv1 facturas, orin/rin1 notas de crédito, ordr/rdr1 pedidos, ocrd clientes, oitm artículos. Encabezado y líneas se unen por doc_entry; clientes por card_code; artículos por item_code.
- doc_total y line_total ya están en MXN aunque doc_cur sea USD. Dólares en doc_total_fc / total_frgn.
- Siempre excluir cancelados: canceled = 'N'.
- Excluir facturas de saldo inicial (no son ventas): facturas con alguna línea donde dscription ILIKE '%SALDO% INICIAL%'.
- No hay vendedores asignados (slp_code = -1): no hacer análisis por vendedor.
- Clientes duplicados que difieren en mayúsculas o acentos ("MISSION DE MÉXICO" / "MISSION DE MEXICO", "AGUACATES ORGANICOS DE LA REGIÓN" / "REGION"). Unificarlos.
- FRONTERRA GROUP INC es ~93% de las ventas.
- No existe tabla de entregas (odln). Las líneas de factura con base_type = 15 vienen de una entrega y base_entry es el id de la entrega. Fecha de entrega = ship_date si está a ±60 días de doc_date; si no, doc_date (hay ship_dates erróneos, p. ej. de 2004).
- Calibre = número al inicio del nombre del artículo: substring(coalesce(item_name, dscription) from '^[^0-9]{0,4}([0-9]+) ') (prefijos SL, TN). Calibres 48 y 60 son ~60% de las ventas. Hay ~400 códigos que cambian semana a semana: agrupar por calibre.
- Unidades: casi todo CAJA, algo KG.
- Semanas de lunes a domingo (date_trunc('week')).
- Ignorar tablas _dlt_* (internas de dlt).

## Decisiones
- Crear con dbt un esquema analytics con tablas curadas que ya apliquen las reglas de arriba (ventas por línea, entregas, clientes unificados, artículos con calibre).
- Claude (servidor MCP del dashboard) consultará con un usuario de Postgres de solo lectura, claude_lector, con acceso SOLO a analytics: sin acceso a sap_hana_raw ni dashapp y sin permisos de escritura. Hoy la app usa el superusuario postgres; eso se cambia.
- Destino Postgres en Railway en vez de BigQuery (la organización bloquea llaves de cuenta de servicio de GCP y el proyecto no tenía facturación).

## Cómo trabajamos
Dos sesiones de Claude (servidor windows y PC Windows) clonan este mismo repo completo y pueden trabajar en pipeline/ y dashboard/.
- git pull antes de empezar.
- Al terminar algo: actualizar "Pendientes" y "Decisiones" aquí, commit y push.
- El contexto importante va escrito en este archivo, no solo en la conversación.
- Nunca subir credenciales (secrets.toml, .env, config.json, profiles.yml).

## Pendientes
- [ ] pipeline: proyecto dbt con modelos en analytics.
- [ ] pipeline: script SQL que crea claude_lector (solo lectura, solo analytics, con default privileges para tablas nuevas de dbt). La contraseña la pone el usuario, no va al repo.
- [ ] dashboard: dos conexiones (postgres solo para dashapp, claude_lector para las consultas de Claude).
- [ ] dashboard: reescribir los dashboards existentes para leer de analytics. Hoy hay: "Ventas 2026" (10 gráficas) y 4 dashboards
      "Semana …" (12 oct – 8 nov 2026, 8 gráficas cada uno, fechas fijas). Todos consultan sap_hana_raw.
- [ ] revisar con el negocio la semana 26 oct – 1 nov 2026: ~29.7 mil cajas pero solo $2.8 M MXN (las demás semanas $9–16 M).
      Verificado 11-nov-2026: NO es carga incompleta. Facturas no canceladas por semana coinciden exactas entre HANA (FRONTERRA_PROTO)
      y Postgres (15 facturas, $2,782,262). El dato es así en SAP.
- [ ] confirmar con el negocio si FRONTERRA_PROTO es la base de producción: su última factura es del 7-nov-2026 y FASA_PROD llega
      al 10-nov-2026. Si PROTO es copia/pruebas, cambiar sources.hana.schema en pipeline/.dlt/config.toml antes de construir dbt.
- [ ] dashboard: db.js reintenta sin SSL si falla la conexión y no valida el certificado (rejectUnauthorized: false); exigir SSL con Railway.
- [ ] pipeline: carga incremental por update_date y tarea programada de Windows en el servidor (hoy se corre a mano).
