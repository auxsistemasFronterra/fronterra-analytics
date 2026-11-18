# pipeline/ — SAP HANA → BigQuery / Postgres (dlt) y después dbt

Lee también el `CLAUDE.md` de la raíz del repo (arquitectura, reglas de datos SAP B1, pendientes).

## Qué hace
`hana_pipeline.py` usa **dlt** (`sql_database`, backend `pyarrow`) para copiar tablas de SAP Business One
desde SAP HANA a **BigQuery** (destino por defecto) o a **PostgreSQL en Railway**.

- **Origen:** SAP HANA 2.0 on-premise (host y puerto en `.dlt/secrets.toml`, base `NDB`), esquema **`FRONTERRA_PROTO`**
  (configurable en `.dlt/config.toml` → `sources.hana.schema`). Solo es accesible desde la red interna
  (el servidor Windows `ftruser16`); desde fuera de la red el pipeline no conecta a HANA.
- **Destino por defecto:** `.dlt/config.toml` → `[fronterra] destination = "bigquery"`. Se fuerza con `--destination bigquery|postgres`.
  - **BigQuery:** proyecto `bigquery-515016`, dataset **`sap_hana_raw`**, región `northamerica-south1`,
    cuenta de servicio `dlt-bigquery@bigquery-515016.iam.gserviceaccount.com` (llave en `secrets.toml`). Pipeline dlt `hana_to_bigquery`.
  - **Postgres (se retira, decisión 18-nov-2026):** Railway, base `hanaDB`, esquema `sap_hana_raw`. Pipeline dlt `hana_to_postgres`.
    Congelado: lo lee todavía el dashboard de prototipo. No usarlo para nada nuevo. Se quita del código cuando el dashboard
    migre a BigQuery (ver "Retirar Railway" en el `CLAUDE.md` raíz).

## Tablas que carga (`sap_hana_raw`, igual en ambos destinos)
Lista en `.dlt/config.toml` → `sources.hana.tables`. Modo actual: **reemplazo completo** (`write_disposition="replace"`)
en cada corrida (~19.6 mil filas; ~30 s en BigQuery, ~15 s en Postgres).

| Tabla | Contenido | Filas aprox. (nov-2026) |
|---|---|---|
| ordr / rdr1 | Pedidos de venta (encabezado / líneas) | 1,655 / 5,732 |
| oinv / inv1 | Facturas de venta | 1,978 / 6,329 |
| orin / rin1 | Notas de crédito | 244 / 748 |
| ocrd | Socios de negocio (clientes y proveedores) | 1,218 |
| oitm | Artículos | 1,862 |
| oslp | Vendedores (no se usan: todo es slp_code = -1) | 3 |

Pendientes de agregar cuando haga falta: OACT, OWHS, OITW, OPCH, PCH1, OJDT, JDT1 (JDT1 ≈ 2 M filas).

- Nombres: tablas y columnas en minúsculas snake_case (`DocEntry` → `doc_entry`, `CardCode` → `card_code`).
  Postgres: importes `numeric`, fechas `timestamp`. BigQuery: importes `NUMERIC`/`BIGNUMERIC`, fechas `TIMESTAMP`.
- dlt agrega `_dlt_load_id` y `_dlt_id` a cada tabla y crea `_dlt_loads`, `_dlt_version`, `_dlt_pipeline_state` (ignorarlas en análisis).

## Instalar
Python **3.14** (probado con 3.14.5 en Windows Server 2022).

```bash
cd pipeline
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .dlt\secrets.toml.example .dlt\secrets.toml   # y llenar credenciales reales
```

## Correr
```bash
.venv\Scripts\python.exe hana_pipeline.py                          # carga completa (replace) al destino por defecto (BigQuery)
.venv\Scripts\python.exe hana_pipeline.py --destination postgres   # solo si hiciera falta refrescar el Postgres congelado
.venv\Scripts\python.exe hana_pipeline.py --test                   # solo prueba conexión a HANA y lista esquemas/tablas
.venv\Scripts\python.exe hana_pipeline.py --incremental            # merge por cursor; requiere llenar el dict INCREMENTAL del script
```

## Dónde y cada cuánto se ejecuta
- **Hoy NO está programado**: no hay tarea de Windows, servicio ni cron. Se corre a mano en el servidor Windows
  (`C:\Users\ftruser16\Documents\Pruebas\fronterra-analytics\pipeline`).
- Siguiente paso previsto: carga incremental por `update_date` (tablas B1 la tienen) y una tarea programada de Windows.

## Secretos
- `.dlt/secrets.toml` (credenciales HANA, cadena de conexión de Railway y llave de la cuenta de servicio de BigQuery) está en
  `.gitignore`. Plantillas sin valores: `.dlt/secrets.toml.example` y `.env.example`
  (dlt también lee variables de entorno tipo `SOURCES__HANA__CREDENTIALS__PASSWORD`).
- El estado local de dlt vive en `%USERPROFILE%\.dlt\pipelines\hana_to_<destino>` (por máquina, no va al repo).

## Detalles técnicos que ya costaron tiempo
- **HANA sin TLS:** con `encrypt=true` falla (`Invalid flags specified` / `No valid certificate`). Usar `encrypt = "false"`.
- **Mayúsculas:** `sqlalchemy-hana` necesita nombres en minúsculas para identificadores HANA en MAYÚSCULAS. El script
  convierte (`_sa_name`), así que en `config.toml` se escriben en mayúsculas como en HANA.
- `TOP` no existe ni en Postgres ni en BigQuery: usar `LIMIT`. Columnas SAP en snake_case.
- BigQuery: la región del dataset no se puede cambiar después de creado (`northamerica-south1`). DML requiere facturación
  (el proyecto `bigquery-515016` la tiene; el primer proyecto de GCP no, por eso se usó Postgres al principio).

## dbt
**Aún no existe.** Pendiente: proyecto dbt en `pipeline/dbt/` siguiendo `docs/guia_desarrollo.md` (secciones 4, 6 y 10):
capas `staging` → `intermediate` → `marts` + `ref`, nombres en inglés, descripciones bilingües, una prueba por modelo.
Adaptador **dbt-bigquery** (decisión 18-nov-2026: todo en BigQuery); seguir usando macros portables (`dbt.date_trunc`, etc.) como pide
la guía. Probado: dbt-core 1.12.7 + dbt-bigquery 1.12.4 funcionan con Python 3.14.5; crear el venv en una ruta corta (Windows sin
rutas largas). `profiles.yml` no va al repo.

## Brecha contra la guía (12-nov-2026)
- El destino se llama `sap_hana_raw`; la guía pide `raw_sap_fasa` y `raw_sap_fgi`.
- Se cargan 9 tablas; la sección 5 de la guía pide ~40 (más `OITB`, que usa el Anexo A) para FASA y FGI.
- Carga `replace` a mano; la guía pide incremental con ventana, recarga completa diaria de catálogos y fotos diarias de `OITW`, CxP y CxC.
- Falta la segunda instancia de dlt para la base MS SQL de costeo de maquila (máquina en sitio).
