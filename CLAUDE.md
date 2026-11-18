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
├── pipeline/               Python + dlt (SAP HANA → BigQuery) y dbt — ver pipeline/CLAUDE.md
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
- Todo vive en BigQuery (decisión 18-nov-2026, ver Decisiones). Railway se retira: no construir nada nuevo sobre Postgres y
  nadie toma decisiones con los datos que quedan ahí.

## Arquitectura
SAP B1 HANA (FASA y FGI) → dlt (pipeline/) → **BigQuery** (proyecto `bigquery-515016`, región `northamerica-south1`) → dbt Core
(pipeline/) → `marts` → paneles de Claude (dashboard/: página + servidor MCP) y, después del 8 de enero, Lightdash.
Los dashboards de la app también se guardarán en BigQuery (dataset `dashapp`). PostgreSQL en Railway se retira (ver Pendientes).
Esto se desvía de la sección 3 de la guía (Railway = desarrollo); pendiente de aprobación de Omar.

Capas (guía, sección 4): `raw_sap_fasa`, `raw_sap_fgi` (crudo) → `staging` (`stg_sap__*`) → `intermediate` (`int_*`) → `marts`
(`fct_*`, `dim_*`) + `ref` (tablas de Finanzas/Calidad).

- **Desde 17-nov-2026 el pipeline carga por defecto a BigQuery** (commit en `main` desde el servidor): proyecto `bigquery-515016`,
  dataset `sap_hana_raw`, región `northamerica-south1`, las mismas 9 tablas y nombres que en Postgres (conteos idénticos a HANA).
  Postgres (`hanaDB.sap_hana_raw`) es lo que lee hoy el dashboard, pero ya no se actualiza: queda congelado hasta que el
  dashboard migre a BigQuery y después se apaga. El script se llama ahora `pipeline/hana_pipeline.py`.

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
- 18-nov-2026: **todo en BigQuery y se elimina Railway** (decisión del usuario). `raw_*`, `staging`, `intermediate`, `marts`, `ref`
  y `dashapp` viven en BigQuery. El conector de Claude usa una **cuenta de servicio de solo lectura** (BigQuery Data Viewer solo
  sobre `marts` + BigQuery Job User en el proyecto), no un usuario de Postgres. Desviación de la guía, sección 3 (Railway =
  desarrollo, BigQuery = producción): queda sin entorno de desarrollo separado. **Pendiente de aprobación de Omar.**
  Railway no se borra hasta que el dashboard lea de BigQuery.
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
- [ ] Aprobar la decisión del 18-nov-2026: todo en BigQuery (`bigquery-515016`) y sin Railway, es decir, sin entorno de desarrollo
      separado (la guía, sección 3, pedía Railway para desarrollo). ¿`bigquery-515016` es el proyecto de producción de la organización?
      Si se quiere un entorno de pruebas, la opción barata es un dataset de desarrollo por persona en el mismo proyecto (target `dev` de dbt).
- [ ] ¿"Paneles de Claude" es la app de `dashboard/` o los artefactos de claude.ai? La app hoy corre en localhost.
- [ ] Máquina en sitio para la segunda instancia de dlt (base MS SQL de costeo de maquila).

Retirar Railway (en este orden):
- [x] Decidir destino: todo en BigQuery (18-nov-2026).
- [ ] dashboard: migrar a BigQuery (ver sección dashboard). Mientras tanto Postgres queda congelado; si hiciera falta refrescarlo:
      `python hana_pipeline.py --destination postgres`.
- [ ] Copiar los 5 dashboards de `dashapp` de Postgres a BigQuery (son prototipos; se pueden recrear en vez de copiar).
- [ ] Quitar el destino `postgres` del pipeline (código, `requirements.txt`, plantillas de secretos) y la cadena de Railway de `secrets.toml`.
- [ ] Apagar/borrar el servicio Postgres en Railway (lo hace el usuario, después de todo lo anterior).

pipeline (dlt):
- [ ] Renombrar el destino a `raw_sap_fasa` y agregar las tablas de la sección 5 de la guía + `OITB`.
- [ ] Carga incremental por `update_date` con ventana de días y merge por llave (el script ya trae el modo `--incremental`).
- [ ] Tarea programada diaria en el servidor, con registro de errores.
- [ ] **Fotos diarias** de `OITW`, CxP y CxC: activarlas ya (la historia empieza el día que se activan).
- [x] Verificar que dbt Core funcione con el Python del servidor (3.14): dbt-core 1.12.7 + dbt-bigquery 1.12.4 instalan e importan
      bien (17-nov-2026). Instalar el venv en una ruta corta: Windows no tiene rutas largas activadas y pip falla en rutas profundas.

pipeline (dbt, Fase A de la guía):
- [ ] Proyecto dbt en `pipeline/dbt/` con `dim_date` (Semana Fronterra) y `stg_sap__*`.
- [ ] A5 `fct_sales`, `fct_credit_notes` con cuadre mensual contra contabilidad.
- [ ] A2 `int_pallet_cost` (traducir el Anexo A; prueba: suma repartida = costo de la salida).
- [ ] A3, A4, A6 `fct_sale_margin`, A7 `fct_pnl_monthly`.
- [ ] Cuenta de servicio de solo lectura para Claude (p. ej. `claude-lector@bigquery-515016.iam.gserviceaccount.com`): rol
      BigQuery Data Viewer solo sobre el dataset `marts` y BigQuery Job User en el proyecto. La crea el usuario en la consola de GCP;
      su llave no va al repo.

dashboard (migrar a BigQuery):
- [ ] Cambiar `pg` por el cliente de BigQuery (`@google-cloud/bigquery`) en `db.js`, `server.js` y `mcp-server.js`.
- [ ] Dos credenciales: una cuenta de servicio con escritura solo sobre el dataset `dashapp` (guardar dashboards) y la de solo
      lectura sobre `marts` para las consultas de Claude. Las llaves fuera del repo (el repo es público).
- [ ] Limitar costo de consultas: `maximumBytesBilled` en cada consulta de Claude y `LIMIT` obligatorio.
- [ ] Rehacer los dashboards sobre `marts` (USD, Semana Fronterra, desde junio). Los actuales están marcados "[Prototipo]".
- [x] ~~db.js reintenta sin SSL con Railway~~: deja de aplicar al retirar Railway.
