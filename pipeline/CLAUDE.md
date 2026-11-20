# pipeline/ — SAP HANA → BigQuery (dlt) y después dbt

Lee también el `CLAUDE.md` de la raíz del repo (arquitectura, reglas de datos SAP B1, pendientes).

## Qué hace
`hana_pipeline.py` usa **dlt** (`sql_database`, backend `pyarrow`) para copiar tablas de SAP Business One
desde SAP HANA a **BigQuery** (destino por defecto) o, opcionalmente, a **PostgreSQL en Railway**.

- **Origen:** SAP HANA 2.0 on-premise (host y puerto en `.dlt/secrets.toml`, base `NDB`), esquema **`FASA_PROD`**
  (producción de FASA, decisión del usuario 20-nov-2026; configurable en `.dlt/config.toml` → `sources.hana.schema`).
  `FRONTERRA_PROTO` era la copia de pruebas que se cargó hasta el 19-nov. HANA solo es accesible desde la red interna
  (el servidor Windows `ftruser16`).
- **Destino y dataset:** `.dlt/config.toml` → `[fronterra] destination = "bigquery"` y `dataset = "raw_sap_fasa"`
  (guía, sección 4.1; FGI usará `raw_sap_fgi`). El destino se fuerza con `--destination bigquery|postgres`.
  Pipeline dlt: `<dataset>_to_<destino>`, p. ej. `raw_sap_fasa_to_bigquery`.
  - **BigQuery:** proyecto `bigquery-515016`, región `northamerica-south1`, cuenta de servicio
    `dlt-bigquery@bigquery-515016.iam.gserviceaccount.com` (llave en `secrets.toml`). Carga en formato parquet.
  - **Postgres (Railway, base `hanaDB`):** se conserva por decisión del usuario (19-nov-2026), **no borrar** su conexión.
    No construir nada nuevo sobre él. Si se corre con `--destination postgres` escribiría en el esquema `raw_sap_fasa`.
  - **Dataset viejo `sap_hana_raw`** (9 tablas de `FRONTERRA_PROTO`, en BigQuery y en Postgres): ya no se actualiza. Se conserva
    mientras se valida `raw_sap_fasa`; borrarlo solo cuando el usuario lo pida.

## Tablas que carga (`raw_sap_fasa`)
Lista en `.dlt/config.toml` → `sources.hana.tables`: las **40 tablas** de la guía v2 (sección 5, Anexo B y `OITB` del Anexo A).
Primera carga completa 20-nov-2026: **5,469,084 filas, 5.55 GB, 13 min**; las 40 tablas cuadran con HANA (`check_counts.py`).

| Grupo | Tablas | Más grandes |
|---|---|---|
| Ventas | ORDR, RDR1, ODLN, DLN1, OINV, INV1, INV12, ORIN, RIN1 | — |
| Cobros | ORCT, RCT2 | — |
| Compras | OPOR, POR1, OPDN, PDN1, OPCH, PCH1 | POR1, PDN1, PCH1 (~65 mil) |
| Inventario / producción / lotes | OIGE, IGE1, OIGN, IGN1, OBTN, OITL, ITL1 | ITL1 892 mil, OITL 861 mil, IGE1 662 mil |
| Contabilidad | OJDT, JDT1, OACT, OOCR, OFPR, OADM | JDT1 2.0 M, OJDT 289 mil |
| Catálogos | OITM, OITB, OITW, OWHS, OCRD, OCRG, CRD1, NNM1, OPRJ, ORTT | OITW 28 mil |

- **Columnas excluidas** (`EXCLUDE_COLUMNS` en el script): `OADM.OauCliSec` y `OADM.OauCliId` (credenciales de una integración de SAP).
- Nombres: tablas y columnas en minúsculas snake_case (`DocEntry` → `doc_entry`, `CardCode` → `card_code`).
  BigQuery: importes `NUMERIC`/`BIGNUMERIC`, fechas `TIMESTAMP`. Muchas tablas traen columnas `NCLOB` (textos largos) → `STRING`.
- dlt agrega `_dlt_load_id` y `_dlt_id` a cada tabla y crea `_dlt_loads`, `_dlt_version`, `_dlt_pipeline_state` (ignorarlas en análisis).
- **Sin `UpdateDate`** (no sirven como cursor incremental propio): las tablas de líneas (`INV1`, `RDR1`, `DLN1`, `RIN1`, `POR1`, `PDN1`,
  `PCH1`, `IGE1`, `IGN1`, `JDT1`, `RCT2`, `INV12`), `OITL`/`ITL1` y los catálogos `OITB`, `OITW`, `OWHS`, `OCRG`, `CRD1`, `OOCR`.
  Para el incremental, las líneas se recargan por los `DocEntry` de los encabezados actualizados en la ventana.

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
.venv\Scripts\python.exe check_counts.py                           # cuadre de filas HANA vs BigQuery (COUNT(*), todas las tablas)
.venv\Scripts\python.exe check_counts.py OINV JDT1                 # cuadre solo de esas tablas
.venv\Scripts\python.exe hana_pipeline.py --destination postgres   # solo si hiciera falta (Postgres se conserva)
.venv\Scripts\python.exe hana_pipeline.py --test                   # solo prueba conexión a HANA y lista esquemas/tablas
.venv\Scripts\python.exe hana_pipeline.py --incremental            # merge por cursor; requiere llenar el dict INCREMENTAL del script
```

## Dónde y cada cuánto se ejecuta
- **Hoy NO está programado**: no hay tarea de Windows, servicio ni cron. Se corre a mano en el servidor Windows
  (`C:\Users\ftruser16\Documents\Pruebas\fronterra-analytics\pipeline`).
- Siguiente paso: carga diaria según la guía (incremental con ventana para documentos, recarga completa de catálogos, fotos
  diarias de `OITW`, CxP y CxC) y una tarea programada de Windows con registro de errores.

## Secretos
- `.dlt/secrets.toml` (credenciales HANA, cadena de conexión de Railway y llave de la cuenta de servicio de BigQuery) está en
  `.gitignore`. Plantillas sin valores: `.dlt/secrets.toml.example` y `.env.example`
  (dlt también lee variables de entorno tipo `SOURCES__HANA__CREDENTIALS__PASSWORD`).
- El estado local de dlt vive en `%USERPROFILE%\.dlt\pipelines\<pipeline>` (por máquina, no va al repo).

## Detalles técnicos que ya costaron tiempo
- **HANA sin TLS:** con `encrypt=true` falla (`Invalid flags specified` / `No valid certificate`). Usar `encrypt = "false"`.
- **Mayúsculas:** `sqlalchemy-hana` necesita nombres en minúsculas para identificadores HANA en MAYÚSCULAS. El script
  convierte (`_sa_name`), así que en `config.toml` se escriben en mayúsculas como en HANA.
- **Windows y `normalize.workers = 2`:** dlt usa procesos; un script pasado por stdin (`python - <<EOF`) truena con
  `BrokenProcessPool`. Correr siempre desde un archivo `.py` con `if __name__ == "__main__":`.
- `TOP` no existe en BigQuery: usar `LIMIT`. Columnas SAP en snake_case.
- BigQuery: la región del dataset no se puede cambiar después de creado (`northamerica-south1`). DML requiere facturación
  (el proyecto `bigquery-515016` la tiene; el primer proyecto de GCP no, por eso se usó Postgres al principio).

## dbt
**Aún no existe.** Pendiente: proyecto dbt en `pipeline/dbt/` siguiendo `docs/guia_desarrollo.md` (secciones 4, 6 y 10, Anexos B y C):
capas `staging` → `intermediate` → `marts` + `ref`, nombres en inglés, descripciones bilingües, una prueba por modelo,
targets `dev` y `prod` en datasets separados. Adaptador **dbt-bigquery**. Probado: dbt-core 1.12.7 + dbt-bigquery 1.12.4 funcionan
con Python 3.14.5; crear el venv en una ruta corta (Windows sin rutas largas). `profiles.yml` no va al repo.

## Brecha contra la guía (20-nov-2026)
- Hecho: dataset `raw_sap_fasa` con las 40 tablas de la guía v2 desde `FASA_PROD`.
- Falta FGI (`raw_sap_fgi`): no hay usuario de solo lectura del SAP de FGI.
- Carga `replace` a mano; la guía pide incremental con ventana, recarga completa diaria de catálogos y **fotos diarias** de `OITW`,
  CxP y CxC (activarlas ya: la historia empieza el día que se activan).
- Falta la segunda instancia de dlt para la base MS SQL de costeo de maquila (máquina en sitio).
