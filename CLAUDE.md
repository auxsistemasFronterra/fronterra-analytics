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
- El almacén es BigQuery: se puede usar SQL de BigQuery; preferir macros de dbt cuando existan (guía v2, sección 0).
- Nunca escribas credenciales en el código.
- Si un dato contradice una regla de la guía, detente y avisa antes de cambiar la regla.
- Semanas: Semana Fronterra (domingo a sábado, numeración gregoriana) desde `dim_date`, nunca de funciones de fecha de la base de datos.
- Tablero en USD con las columnas de moneda de sistema de SAP (`*_sy`, `sys_deb`, `sys_cred`). Todo empieza el 1 de junio de 2026.
- Unir documentos por `doc_entry`, nunca por `doc_num`. Excluir cancelados (`canceled = 'N'`).
- Todo vive en BigQuery, con datasets de desarrollo (`dev`) y producción (`prod`) separados (targets de dbt). Nadie toma decisiones
  con datos de `dev`. Railway se retira: no construir nada nuevo sobre Postgres.
- Todo lo que ven los directores va en **Lightdash** (guía v2, secciones 1 y 16). Las métricas se declaran en el `meta` de los `.yml`.

## Arquitectura
SAP B1 HANA (FASA y FGI) → dlt (pipeline/) → **BigQuery** (proyecto `bigquery-515016`, región `northamerica-south1`) → dbt Core
(pipeline/) → `marts` (dataset de producción) → **Lightdash**: Dashboard de Rentabilidad, Weekly y los cuatro estados financieros
(meta 8 de enero), con su agente de IA; después el Hub operativo. Guía v2 (19-nov-2026), secciones 3 y 16. Polytomic se evalúa
como alternativa a dlt (prueba de 7 días). PostgreSQL en Railway se retira (ver Pendientes).
La app `dashboard/` (página + MCP) queda como herramienta de exploración: la guía v2 descarta tableros directivos fuera de Lightdash.

Capas (guía, sección 4): `raw_sap_fasa`, `raw_sap_fgi` (crudo) → `staging` (`stg_sap__*`) → `intermediate` (`int_*`) → `marts`
(`fct_*`, `dim_*`) + `ref` (tablas de Finanzas/Calidad).

Estado real al 20-nov-2026:
- **Crudo de FASA en BigQuery: dataset `raw_sap_fasa`** con las **40 tablas** de la guía v2 (sección 5, Anexo B y `OITB`), leídas
  del esquema HANA **`FASA_PROD`** (producción). Primera carga completa el 20-nov-2026: 5.47 M filas, 5.55 GB; las 40 tablas cuadran
  con HANA (`pipeline/check_counts.py`). Desde el 23-nov-2026 hay carga incremental (`pipeline/run_daily.ps1`), pero la tarea
  programada aún no está registrada: hoy se corre a mano. Detalle en `pipeline/CLAUDE.md`.
- El dataset viejo `sap_hana_raw` (9 tablas de `FRONTERRA_PROTO`, en BigQuery y en Postgres) ya no se actualiza; se conserva.
  Postgres (`hanaDB`) es lo que lee la app `dashboard/`; **no borrar su conexión** (el usuario la quiere conservar).
- **Crudo de FGI en BigQuery: dataset `raw_sap_fgi`** con las mismas 40 tablas, leídas del esquema HANA **`FGI_PROD`** (mismo
  servidor HANA que FASA). Primera carga completa el 20-nov-2026: 113 mil filas, 131 MB, 2 min; 40/40 conteos y 31/31 revisiones
  de contenido cuadran. Moneda local y de sistema USD. Se lee con el mismo usuario HANA que FASA (falta el usuario propio).
- Falta la base MS SQL de costeo de maquila.
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
- 19-nov-2026: **guía v2** (`docs/guia_desarrollo.md`). Confirma BigQuery como único almacén (ya no es desviación) con datasets
  `dev` y `prod` separados; todo se muestra en Lightdash (se descartan los paneles de Claude para directores); agrega alcance del MVP
  (1.1), los cuatro estados financieros (8.1 y Anexo B), tablas `ORCT`, `RCT2`, `CRD1`, `INV12`, `OOCR`, `OFPR`, `OADM`, la definición
  de AR – % Collected y la corrección de países en el maestro de clientes (14.1).
- 20-nov-2026: **`FASA_PROD` es la base de producción de FASA** (decisión del usuario; `FRONTERRA_PROTO` era la copia de pruebas).
  El crudo de FASA vive en el dataset `raw_sap_fasa`.
- 20-nov-2026: **`FGI_PROD` es la base de producción de FGI** (decisión del usuario; `FGI_TEST` y `FGI` no se cargan). Está en el
  mismo servidor HANA y el usuario HANA actual ya la puede leer, así que se cargó a `raw_sap_fgi` sin esperar el usuario propio.
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
- [x] ~~¿`FRONTERRA_PROTO` o `FASA_PROD`?~~ `FASA_PROD` (decisión del usuario, 20-nov-2026). Conviene que Omar lo ratifique.
- [ ] Usuario de solo lectura **propio** para FGI (guía, sección 5). Ya no bloquea: `raw_sap_fgi` se carga con el usuario de FASA.
      Cuando exista, va en `secrets.toml` como `[sources.hana_fgi.credentials]`.
- [x] ~~Aprobar todo en BigQuery~~: la guía v2 lo confirma, con datasets `dev` y `prod` separados.
- [ ] ¿`bigquery-515016` es el proyecto definitivo? Quién es el dueño del pago y el presupuesto con alertas (guía v2, sección 3).
- [x] ~~"Paneles de Claude"~~: la guía v2 lo resuelve, todo va en Lightdash.
- [ ] ¿Qué se hace con la app `dashboard/` y con la rama `login-entra` (login con Microsoft Entra ID, 19-nov-2026)? La guía v2
      descarta tableros directivos fuera de Lightdash; los permisos por usuario se manejan en Lightdash.
- [ ] Máquina en sitio para la segunda instancia de dlt (base MS SQL de costeo de maquila).

Retirar Railway (en este orden):
- [x] Decidir destino: todo en BigQuery (18-nov-2026).
- [ ] dashboard: migrar a BigQuery (ver sección dashboard). Mientras tanto Postgres queda congelado; si hiciera falta refrescarlo:
      `python hana_pipeline.py --destination postgres`.
- [ ] Copiar los 5 dashboards de `dashapp` de Postgres a BigQuery (son prototipos; se pueden recrear en vez de copiar).
- [ ] Quitar el destino `postgres` del pipeline (código, `requirements.txt`, plantillas de secretos) y la cadena de Railway de `secrets.toml`.
- [ ] Apagar/borrar el servicio Postgres en Railway (lo hace el usuario, después de todo lo anterior).

Lightdash (guía v2, sección 16):
- [ ] Acordar la extensión de la prueba de 21 días **antes** de arrancarla, o arrancarla a más tardar en SEM 49 con los primeros
      modelos listos. Confirmar SSO de Microsoft y uso del agente de IA con la llave propia de la API de Claude.
- [ ] Cuenta de servicio de solo lectura para Lightdash, limitada al dataset de producción.

pipeline (dlt):
- [x] Dataset `raw_sap_fasa` con las 40 tablas de la guía v2 desde `FASA_PROD` (20-nov-2026, conteos cuadrados).
- [x] Dataset `raw_sap_fgi` con las 40 tablas desde `FGI_PROD` (20-nov-2026, conteos y contenido cuadrados).
- [x] Carga incremental con ventana de 7 días (merge delete-insert por documento) y recarga completa de catálogos (23-nov-2026,
      probada en FASA y FGI). `pipeline/run_daily.ps1`: incremental lunes a sábado, completa los domingos.
- [ ] Registrar la tarea programada (`pipeline/register_daily_task.ps1`, la corre el usuario: pide su contraseña de Windows).
- [ ] Borrar el dataset viejo `sap_hana_raw` de BigQuery cuando el usuario lo apruebe.
- [ ] **Fotos diarias** de `OITW`, CxP y CxC: activarlas ya (la historia empieza el día que se activan).
- [x] Verificar que dbt Core funcione con el Python del servidor (3.14): dbt-core 1.12.7 + dbt-bigquery 1.12.4 instalan e importan
      bien (17-nov-2026). Instalar el venv en una ruta corta: Windows no tiene rutas largas activadas y pip falla en rutas profundas.

pipeline (dbt, Fase A de la guía):
- [ ] Proyecto dbt en `pipeline/dbt/` con `dim_date` (Semana Fronterra) y `stg_sap__*`.
- [ ] A5 `fct_sales`, `fct_credit_notes` con cuadre mensual contra contabilidad.
- [ ] A2 `int_pallet_cost` (traducir el Anexo A; prueba: suma repartida = costo de la salida).
- [ ] A3, A4, A6 `fct_sale_margin`, A7 `fct_pnl_monthly`.
- [ ] Targets de dbt `dev` y `prod` en datasets separados.
- [ ] Estados financieros (8.1 y Anexo B): `fct_trial_balance`, `fct_income_statement_monthly`, `fct_balance_sheet_monthly`,
      `fct_equity_changes`, `fct_cash_flow`. Bloqueos de Finanzas: saldos al 31-may-2026, `ref_cashflow_mapping`,
      `ref_equity_mapping`, método de conversión de moneda.
- [ ] Weekly: AR – % Collected con `OINV` por vencimiento y `ORCT`/`RCT2` (definición confirmada en la guía v2).

SAP (lo hace el usuario o Finanzas, guía v2 sección 14.1):
- [ ] Corregir el país (`CRD1.Country`, enviar a y facturar a) de los clientes con `XX` o vacío en FASA y FGI.
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
