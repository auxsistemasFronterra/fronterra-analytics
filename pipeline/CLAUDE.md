# pipeline/ — SAP HANA → Postgres (dlt) y después dbt

Lee también el `CLAUDE.md` de la raíz del repo (arquitectura, reglas de datos SAP B1, pendientes).

## Qué hace
`hana_to_postgres.py` usa **dlt** (`sql_database`, backend `pyarrow`) para copiar tablas de SAP Business One
desde SAP HANA a PostgreSQL en Railway.

- **Origen:** SAP HANA 2.0 on-premise (host y puerto en `.dlt/secrets.toml`, base `NDB`), esquema **`FRONTERRA_PROTO`**
  (configurable en `.dlt/config.toml` → `sources.hana.schema`). Solo es accesible desde la red interna
  (el servidor Windows `ftruser16`); desde fuera de la red el pipeline no conecta a HANA.
- **Destino:** Postgres 18 en Railway, base **`hanaDB`**, esquema **`sap_hana_raw`** (datos crudos).
- Nombre del pipeline dlt: `hana_to_postgres`.

## Tablas que carga (esquema `sap_hana_raw`)
Lista en `.dlt/config.toml` → `sources.hana.tables`. Modo actual: **reemplazo completo** (`write_disposition="replace"`)
en cada corrida (~19.6 mil filas, ~15 s de carga).

| Tabla | Contenido | Filas aprox. (nov-2026) |
|---|---|---|
| ordr / rdr1 | Pedidos de venta (encabezado / líneas) | 1,655 / 5,732 |
| oinv / inv1 | Facturas de venta | 1,978 / 6,329 |
| orin / rin1 | Notas de crédito | 244 / 748 |
| ocrd | Socios de negocio (clientes y proveedores) | 1,218 |
| oitm | Artículos | 1,862 |
| oslp | Vendedores (no se usan: todo es slp_code = -1) | 3 |

Pendientes de agregar cuando haga falta: OACT, OWHS, OITW, OPCH, PCH1, OJDT, JDT1 (JDT1 ≈ 2 M filas).

- Nombres en Postgres: tablas y columnas en minúsculas snake_case (`DocEntry` → `doc_entry`, `CardCode` → `card_code`).
  Importes = `numeric`, fechas = `timestamp`.
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
.venv\Scripts\python.exe hana_to_postgres.py            # carga completa (replace)
.venv\Scripts\python.exe hana_to_postgres.py --test     # solo prueba conexión a HANA y lista esquemas/tablas
.venv\Scripts\python.exe hana_to_postgres.py --incremental   # merge por cursor; requiere llenar el dict INCREMENTAL del script
```

## Dónde y cada cuánto se ejecuta
- **Hoy NO está programado**: no hay tarea de Windows, servicio ni cron. Se corre a mano en el servidor Windows
  (`C:\Users\ftruser16\Documents\Pruebas\fronterra-analytics\pipeline`).
- Siguiente paso previsto: carga incremental por `update_date` (tablas B1 la tienen) y una tarea programada de Windows.

## Secretos
- `.dlt/secrets.toml` (credenciales HANA + cadena de conexión de Railway) está en `.gitignore`. Plantillas sin valores:
  `.dlt/secrets.toml.example` y `.env.example` (dlt también lee variables de entorno tipo `SOURCES__HANA__CREDENTIALS__PASSWORD`).
- El estado local de dlt vive en `%USERPROFILE%\.dlt\pipelines\hana_to_postgres` (por máquina, no va al repo).

## Detalles técnicos que ya costaron tiempo
- **HANA sin TLS:** con `encrypt=true` falla (`Invalid flags specified` / `No valid certificate`). Usar `encrypt = "false"`.
- **Mayúsculas:** `sqlalchemy-hana` necesita nombres en minúsculas para identificadores HANA en MAYÚSCULAS. El script
  convierte (`_sa_name`), así que en `config.toml` se escriben en mayúsculas como en HANA.
- `TOP` no existe en Postgres: usar `LIMIT`. Columnas SAP en snake_case.
- Se descartó BigQuery (la organización bloquea llaves de cuenta de servicio y el proyecto no tenía facturación).

## dbt
**Aún no existe.** Pendiente: proyecto dbt en `pipeline/dbt/` (o similar) que lea `sap_hana_raw` y escriba
el esquema `analytics` aplicando las reglas de datos del `CLAUDE.md` raíz. `profiles.yml` no va al repo.
