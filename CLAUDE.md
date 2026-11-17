# fronterra-analytics — Fronterra Digital Hub Fase 1

Contexto compartido para las sesiones de Claude que trabajan en este repo. Léelo completo antes de empezar.

## Contexto
Lee `docs/guia_desarrollo.md` antes de escribir o modificar cualquier modelo. Es la guía del director (Omar): qué construir,
en qué orden, con qué tablas de SAP y cómo saber que está bien. **Si algo de este repo contradice la guía, manda la guía.**
Entrega: 8 de enero de 2027.

```
fronterra-analytics/
├── CLAUDE.md               este archivo
├── docs/guia_desarrollo.md guía del Digital Hub Fase 1 (fuente de verdad)
├── docs/notas_prototipo.md hallazgos del prototipo de ventas (NO son reglas)
├── docs/traspaso.md        cómo retomar en otro equipo y dónde quedó todo
├── docs/preguntas_omar.md  preguntas que bloquean (sin respuesta registrada)
├── docs/prompt_servidor_tablas.md  prompt de tablas y conexiones para el servidor
├── .mcp.json               registra el servidor MCP "dashboards" (node dashboard/mcp-server.js)
├── pipeline/               Python + dlt (SAP HANA → BigQuery / Postgres) y dbt — ver pipeline/CLAUDE.md
└── dashboard/              app de dashboards + servidor MCP (Node 24) — ver dashboard/CLAUDE.md
```

Abre las sesiones de Claude en la raíz del repo para tener el MCP `dashboards` (requiere `npm install` en `dashboard/` y
`dashboard/config.json` o `.env` con la conexión, que no van al repo).
Las secciones Arquitectura, Reglas y Decisiones de este archivo también se le pasan al MCP como contexto: mantenlas al día.

## Reglas
- Respeta las convenciones de la sección 4 de la guía (nombres en inglés, capas, columnas).
- Toda la lógica de negocio va en dbt. Nunca en la herramienta de visualización (ni en el SQL de una gráfica).
- Toda llave incluye la entidad (FASA o FGI).
- Cada modelo lleva descripción bilingüe (inglés y español) en su .yml y al menos una prueba.
- SQL portable entre PostgreSQL y BigQuery: usa macros de dbt (dbt.date_trunc, dbt.safe_cast...).
- Nunca escribas credenciales en el código.
- Si un dato contradice una regla de la guía, detente y avisa antes de cambiar la regla.
- Semanas: Semana Fronterra (domingo a sábado, numeración gregoriana) desde `dim_date`. No usar `date_trunc('week')`.
- Tablero en USD con las columnas de moneda de sistema de SAP (`*_sy`, `sys_deb`, `sys_cred`). Todo empieza el 1 de junio de 2026.
- Unir documentos por `doc_entry`, nunca por `doc_num`. Excluir cancelados (`canceled = 'N'`).
- Railway es desarrollo: nadie toma decisiones con esos datos.

## Arquitectura
SAP B1 HANA (FASA y FGI) → dlt (pipeline/) → PostgreSQL en Railway (desarrollo; BigQuery será producción) → dbt Core (pipeline/)
→ `marts` → paneles de Claude (dashboard/: página + servidor MCP) y, después del 8 de enero, Lightdash.

Capas (guía, sección 4): `raw_sap_fasa`, `raw_sap_fgi` (crudo) → `staging` (`stg_sap__*`) → `intermediate` (`int_*`) → `marts`
(`fct_*`, `dim_*`) + `ref` (tablas de Finanzas/Calidad).

- **Desde 17-nov-2026 el pipeline carga por defecto a BigQuery** (commit en `main` desde el servidor): proyecto `bigquery-515016`,
  dataset `sap_hana_raw`, región `northamerica-south1`, las mismas 9 tablas y nombres que en Postgres (conteos idénticos a HANA).
  Postgres (`hanaDB.sap_hana_raw`) sigue disponible con `--destination postgres` y es lo que lee hoy el dashboard, pero ya no se
  actualiza solo. El script se llama ahora `pipeline/hana_pipeline.py`.

Estado real al 12-nov-2026:
- Solo existe el esquema crudo `sap_hana_raw` (se renombrará a `raw_sap_fasa`) con 9 tablas de ventas de FASA: oinv, inv1, orin,
  rin1, ordr, rdr1, ocrd, oitm, oslp. Carga completa a mano, sin tarea programada. Faltan ~30 tablas de la sección 5 de la guía
  (más `OITB`, que usa el Anexo A), todo FGI y la base MS SQL de costeo de maquila.
- Se carga el esquema HANA `FRONTERRA_PROTO`. Existe también `FASA_PROD` (más reciente). **Por confirmar cuál es producción.**
- dbt no existe todavía. No hay `marts`, ni pruebas, ni fotos diarias.
- En Postgres las tablas y columnas están en minúsculas snake_case (`DocEntry` → `doc_entry`). HANA solo es accesible desde el
  servidor Windows de la red interna.
- La app guarda los dashboards en el esquema `dashapp`. Los dashboards actuales son **prototipos** sobre el crudo (MXN, semana de
  lunes, desde enero, solo FASA): no cumplen la guía y no deben presentarse como cifras oficiales.
- FRONTERRA GROUP INC es FGI: ~93% de la venta de FASA es intercompañía (guía, sección 8).

## Decisiones
- La guía `docs/guia_desarrollo.md` reemplaza las reglas del prototipo (movidas a `docs/notas_prototipo.md`).
- El conector de Claude usará un usuario de solo lectura con acceso solo a `marts`. Hoy la app usa el superusuario postgres; eso se cambia.
- 11-nov-2026: destino Postgres en Railway (el primer proyecto de GCP bloqueaba llaves de cuenta de servicio y no tenía facturación).
- 17-nov-2026: el usuario pidió cambiar a BigQuery con un proyecto nuevo (`bigquery-515016`, cuenta de servicio `dlt-bigquery`,
  con facturación). El pipeline carga ahí por defecto; Postgres se conserva como destino opcional.
- Todo cambio entra como rama/propuesta en Git y otra persona lo revisa antes de unirlo a `main`.
- 17-nov-2026: el repositorio de GitHub es **público** y el usuario decidió dejarlo así. Todo lo que se suba lo puede ver
  cualquiera: nunca subir credenciales, datos de clientes ni resultados de consultas.

## Cómo trabajamos
Dos sesiones de Claude (servidor Windows y PC Windows) clonan este mismo repo completo y pueden trabajar en pipeline/ y dashboard/.
- git pull antes de empezar.
- Al terminar algo: actualizar "Pendientes" y "Decisiones" aquí, commit y push de la rama.
- El contexto importante va escrito en este archivo o en docs/, no solo en la conversación.
- Nunca subir credenciales (secrets.toml, .env, config.json, profiles.yml).

## Pendientes
Preguntas para Omar (bloquean):
- [ ] ¿`FRONTERRA_PROTO` o `FASA_PROD` es la base de producción de FASA? (PROTO llega al 7-nov-2026, FASA_PROD al 10-nov-2026.)
- [ ] Usuario de solo lectura para el SAP de FGI.
- [ ] BigQuery ya tiene proyecto con facturación (`bigquery-515016`). Falta decidir: ¿`marts` vive en BigQuery o en Railway, y
      BigQuery ya es producción o sigue siendo prueba? (Ver "Decidir destino" abajo.)
- [ ] ¿"Paneles de Claude" es la app de `dashboard/` o los artefactos de claude.ai? La app hoy corre en localhost.
- [ ] Máquina en sitio para la segunda instancia de dlt (base MS SQL de costeo de maquila).

Decidir destino (afecta dbt y dashboard):
- [ ] ¿dbt/`marts` en BigQuery o en Postgres? El dashboard y su MCP hoy solo hablan Postgres (`pg`). Opciones: (a) todo en BigQuery:
      MCP con cliente BigQuery y cuenta de servicio de solo lectura (BigQuery Data Viewer solo sobre `marts` + Job User); `dashapp`
      puede quedarse en Postgres. (b) BigQuery solo como copia cruda y dbt/`marts` en Postgres. Mientras tanto, para refrescar
      Postgres: `python hana_pipeline.py --destination postgres`.

pipeline (dlt):
- [ ] Renombrar el destino a `raw_sap_fasa` y agregar las tablas de la sección 5 de la guía + `OITB`.
- [ ] Carga incremental por `update_date` con ventana de días y merge por llave (el script ya trae el modo `--incremental`).
- [ ] Tarea programada diaria en el servidor, con registro de errores.
- [ ] **Fotos diarias** de `OITW`, CxP y CxC: activarlas ya (la historia empieza el día que se activan).
- [ ] Verificar que dbt Core funcione con el Python del servidor (3.14); si no, entorno con 3.12.

pipeline (dbt, Fase A de la guía):
- [ ] Proyecto dbt en `pipeline/dbt/` con `dim_date` (Semana Fronterra) y `stg_sap__*`.
- [ ] A5 `fct_sales`, `fct_credit_notes` con cuadre mensual contra contabilidad.
- [ ] A2 `int_pallet_cost` (traducir el Anexo A; prueba: suma repartida = costo de la salida).
- [ ] A3, A4, A6 `fct_sale_margin`, A7 `fct_pnl_monthly`.
- [ ] Usuario de solo lectura sobre `marts` (script SQL sin contraseña en el repo).

dashboard:
- [ ] Dos conexiones: postgres solo para `dashapp`, usuario de solo lectura para las consultas de Claude.
- [ ] Rehacer los dashboards sobre `marts` (USD, Semana Fronterra, desde junio). Los actuales están marcados "[Prototipo]".
- [ ] db.js reintenta sin SSL y no valida el certificado (`rejectUnauthorized: false`); exigir SSL con Railway.
- [ ] Si producción es BigQuery: adaptar el MCP para consultar BigQuery y decidir dónde se guardan los dashboards.
