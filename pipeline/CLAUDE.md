# pipeline/ — SAP HANA → BigQuery (dlt) y después dbt

Lee también el `CLAUDE.md` de la raíz del repo (arquitectura, reglas de datos SAP B1, pendientes).

## Qué hace
`hana_pipeline.py` usa **dlt** (`sql_database`, backend `pyarrow`) para copiar tablas de SAP Business One
desde SAP HANA a **BigQuery** (destino por defecto) o, opcionalmente, a **PostgreSQL en Railway**.

- **Entidades** (`--entity fasa|fgi`, por defecto `fasa`; `.dlt/config.toml` → `[entities.<entidad>]`): las dos viven en el
  mismo SAP HANA 2.0 on-premise (host y puerto en `.dlt/secrets.toml`, base `NDB`).
  | Entidad | Esquema HANA | Dataset | Notas |
  |---|---|---|---|
  | FASA | `FASA_PROD` | `raw_sap_fasa` | Moneda local MXN, sistema USD. `FRONTERRA_PROTO` era la copia de pruebas cargada hasta el 19-nov |
  | FGI | `FGI_PROD` | `raw_sap_fgi` | Moneda local y sistema USD. `FGI_TEST` y `FGI` no se cargan |
  Ambas decisiones del usuario, 20-nov-2026. HANA solo es accesible desde la red interna (el servidor Windows `ftruser16`).
- **Credenciales por entidad:** si existe `[sources.hana_<entidad>.credentials]` en `secrets.toml` se usa ese usuario; si no, el
  compartido `[sources.hana.credentials]`. Hoy FGI se lee con el usuario compartido (la guía pide uno propio por entidad).
- **Destino:** `.dlt/config.toml` → `[fronterra] destination = "bigquery"` (guía, sección 4.1). Se fuerza con
  `--destination bigquery|postgres`. Pipeline dlt: `<dataset>_to_<destino>`, p. ej. `raw_sap_fasa_to_bigquery`, `raw_sap_fgi_to_bigquery`.
  - **BigQuery:** proyecto `bigquery-515016`, región `northamerica-south1`, cuenta de servicio
    `dlt-bigquery@bigquery-515016.iam.gserviceaccount.com` (llave en `secrets.toml`). Carga en formato parquet.
  - **Postgres (Railway, base `hanaDB`):** se conserva por decisión del usuario (19-nov-2026), **no borrar** su conexión.
    No construir nada nuevo sobre él. Si se corre con `--destination postgres` escribiría en el esquema `raw_sap_fasa`.
  - **Dataset viejo `sap_hana_raw`** (9 tablas de `FRONTERRA_PROTO`, en BigQuery y en Postgres): ya no se actualiza. Se conserva
    mientras se valida `raw_sap_fasa`; borrarlo solo cuando el usuario lo pida.

## Tablas que carga (`raw_sap_fasa` y `raw_sap_fgi`)
Lista en `.dlt/config.toml` → `sources.hana.tables`, la misma para las dos entidades: las **40 tablas** de la guía v2 (sección 5,
Anexo B y `OITB` del Anexo A).
**FGI**, primera carga completa 20-nov-2026: **113,103 filas, 131 MB, 2 min**; 40/40 conteos y 31/31 revisiones de contenido cuadran.
Las más grandes: `JDT1` 34 mil, `ITL1` 16 mil. Casi sin fabricación (`OIGE` 8, `OIGN` 6 documentos). Facturas desde jun-2026.
**FASA**, primera carga completa 20-nov-2026: **5,469,084 filas, 5.55 GB, 13 min**; las 40 tablas cuadran con HANA (`check_counts.py`)
y las 31 revisiones de contenido también (`check_content.py`: sumas en MXN y USD, cantidades, fechas, largos de texto, llaves).
Ambos scripts salen con código 1 si algo no cuadra. **SAP sigue vivo:** una hora después de la carga ya había 1 asiento nuevo
(2 renglones de `JDT1`) y 2 socios nuevos, y los scripts lo marcan como diferencia. Antes de buscar un error, revisar si son
documentos posteriores a la carga (p. ej. `TransId` o `UpdateDate` mayores a los de BigQuery) o volver a cargar y revisar.

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

## Carga incremental (desde 23-nov-2026)
`--incremental` (y `run_daily.ps1` de lunes a sábado). Ventana **sin estado**: siempre relee los últimos `--days` días (7 por
defecto), así un día que falla se recupera solo al siguiente. Definido en `WINDOW_TABLES` y `CHILD_TABLES` de `hana_pipeline.py`.
- **Encabezados** por fecha: `UpdateDate` en `OINV`, `ORIN`, `ORDR`, `ODLN`, `OPOR`, `OPDN`, `OPCH`, `OIGE`, `OIGN`, `ORCT`, `OJDT`
  (en SAP, `UpdateDate` se llena desde que se crea el documento; ninguno está vacío); `CreateDate` en `OITL` (bitácora, solo agrega).
- **Líneas** por la llave de esos encabezados (subconsulta en HANA): `INV1`/`INV12`→`OINV`, `RIN1`, `RDR1`, `DLN1`, `POR1`, `PDN1`,
  `PCH1`, `IGE1`, `IGN1` por `DocEntry`; `RCT2.DocNum`→`ORCT.DocEntry`; `JDT1`→`OJDT` por `TransId`; `ITL1`→`OITL` por `LogEntry`.
- **Conciliaciones** (`RECONCILED_OBJECTS` y `JDT1`): al aplicar un cobro o pago, SAP cambia saldos de documentos y asientos
  viejos (`PaidToDate`/`DocStatus` de facturas, `BalDueDeb`/`BalDueCred`/`BalSc*` de `JDT1`) **sin tocar su `UpdateDate`**.
  Por eso también se recargan `OINV`, `ORIN`, `OPCH`, `ORCT` y los asientos que aparecen en conciliaciones (`OITR`/`ITR1`, se leen
  en la subconsulta, no se cargan) creadas en la ventana. Encontrado el 23-nov-2026: sin esto, 249 renglones de `JDT1` en FASA y
  3 facturas de FGI quedaban con saldo viejo; con esto cuadran los saldos pendientes y `OCRD.Balance`.
- Escritura **merge `delete-insert`** con `merge_key` = llave del documento: borra en BigQuery todas las filas de esos documentos e
  inserta las de HANA (si a un pedido abierto le quitan una línea, también desaparece).
- **Catálogos y `OBTN`**: `replace` completo en cada corrida (son chicos).
- El merge usa datasets auxiliares de dlt `raw_sap_fasa_staging` y `raw_sap_fgi_staging`: no borrarlos ni usarlos en análisis.
- Requiere que el pipeline ya tenga una carga completa en esa máquina (usa el mismo esquema dlt `sql_database`).
- **Lo que no ve**: documentos borrados en SAP (raro; SAP cancela en vez de borrar). Por eso `run_daily.ps1` hace carga completa
  los domingos.
- Primera prueba (23-nov-2026, ventana 7 días): FGI 1.5 min, FASA 2 min (contra 12 min completa); sin llaves duplicadas, 40/40
  conteos y 31/31 revisiones de contenido cuadran en ambas.

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
.venv\Scripts\python.exe hana_pipeline.py                          # carga completa (replace) de FASA al destino por defecto (BigQuery)
.venv\Scripts\python.exe hana_pipeline.py --entity fgi             # carga completa de FGI (raw_sap_fgi)
.venv\Scripts\python.exe check_counts.py --entity fgi              # los dos scripts de cuadre aceptan --entity (por defecto FASA)
.venv\Scripts\python.exe check_counts.py                           # cuadre de filas HANA vs BigQuery (COUNT(*), todas las tablas)
.venv\Scripts\python.exe check_counts.py OINV JDT1                 # cuadre solo de esas tablas
.venv\Scripts\python.exe check_content.py                          # cuadre de contenido: importes, USD, cantidades, fechas, textos, llaves
.venv\Scripts\python.exe check_content.py JDT1                     # solo esa tabla (las revisiones están en CHECKS del script)
.venv\Scripts\python.exe hana_pipeline.py --destination postgres   # solo si hiciera falta (Postgres se conserva)
.venv\Scripts\python.exe hana_pipeline.py --test                   # solo prueba conexión a HANA y lista esquemas/tablas
.venv\Scripts\python.exe hana_pipeline.py --incremental            # incremental de FASA (últimos 7 días + catálogos)
.venv\Scripts\python.exe hana_pipeline.py --entity fgi --incremental --days 30   # ventana más amplia, p. ej. tras días sin cargar
```

## Dónde y cada cuánto se ejecuta
- **`run_daily.ps1`**: carga FGI y FASA, corre `check_counts.py` de cada una y, si ninguna carga falló, `dbt build --target prod`
  (modelos, fotos diarias y pruebas). Lunes a sábado incremental, domingo completa (`-Full` la fuerza; `-Days N` cambia la
  ventana; `-Entities fgi` solo una; `-SkipDbt` sin dbt). Log en `pipeline\logs\AAAA-MM-DD.log` (fuera de Git, se borran a los
  60 días). Sale con 0 = OK, 1 = falló una carga (dbt no corre), 3 = falló dbt, 2 = todo corrió pero algún cuadre de filas no
  cuadra (durante el día suele ser actividad de SAP entre la carga y el cuadre, no error).
- **Tarea programada**: `register_daily_task.ps1` la registra (diario 05:00, "Fronterra - carga SAP a BigQuery"). La corre el
  usuario a mano, una vez, como administrador: pide la contraseña de Windows en una ventana de Windows (no queda en archivos).
  **Registrada; corre como `ftruser16`.** Primera corrida automática 24-nov-2026 05:00: OK (código 0) en 5 min, cuadres 40/40 en
  ambas entidades, dbt 20/20. Revisar: `Get-ScheduledTaskInfo -TaskName 'Fronterra - carga SAP a BigQuery'` (LastTaskResult)
  y el log del día. Las horas de dbt dentro del log están en UTC.
- Pendiente: aviso (correo o Teams) cuando la tarea falle; cuenta de Windows propia con pocos permisos.

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

## dbt (`pipeline/dbt/`, desde 23-nov-2026)
Sigue `docs/guia_desarrollo.md` (secciones 3, 4, 6 y 10, Anexos B y C). Plan por etapas: 0 proyecto y conexión (hecho),
1 fotos diarias (hecho), 2 `staging`, 3 estados financieros, 4 margen por venta de FASA (Fase A), 5 Lightdash, 6 FGI y consolidado.
- **Instalación:** venv en ruta corta `C:\Users\ftruser16\dbt-venv` (dbt-core 1.12.7 + dbt-bigquery 1.12.4, Python 3.14; Windows
  no tiene rutas largas y pip falla en rutas profundas). Separado del venv de dlt.
- **Correr:** siempre con `run_dbt.py`, que lee la llave de `pipeline/.dlt/secrets.toml` y la pasa por variables de entorno
  (no se copia a ningún archivo); usa `[dbt.credentials]` si existe y si no la cuenta de dlt. Copia `profiles.template.yml` a
  `.profiles/profiles.yml` (fuera de Git, sin secretos).
  ```bash
  C:\Users\ftruser16\dbt-venv\Scripts\python.exe dbt\run_dbt.py debug
  C:\Users\ftruser16\dbt-venv\Scripts\python.exe dbt\run_dbt.py build                  # target dev
  C:\Users\ftruser16\dbt-venv\Scripts\python.exe dbt\run_dbt.py build --target prod    # lo hace run_daily.ps1 cada día
  C:\Users\ftruser16\dbt-venv\Scripts\python.exe dbt\run_dbt.py source freshness        # ¿la carga de dlt está al día?
  ```
- **Datasets** (macro `generate_schema_name`): prod = `staging`, `intermediate`, `marts`, `history`, `ref`; dev = mismos con
  prefijo `dev_`. Todos en `northamerica-south1`.
- **Fuentes** (`models/sources.yml`): `sap_fasa` y `sap_fgi`, las 40 tablas; frescura por `_dlt_loads.inserted_at` (aviso a 26 h).
- **Hoy hay:** `dim_date` (Semana Fronterra, regla 18, con prueba de casos 2026-2027) y las **fotos diarias** en `history`:
  - `hist_stock_daily`: `OITW` con existencia, comprometido o pedido distinto de cero, por artículo y almacén.
  - `hist_open_items_daily`: CxC y CxP por renglón de `JDT1` con saldo pendiente (base del reporte de antigüedad de SAP);
    prueba `assert_open_items_match_bp_balance`: la suma por socio = `OCRD.Balance`.
  - Incrementales `insert_overwrite` por `snapshot_date` (fecha de México): correr varias veces el mismo día reemplaza la foto
    del día, no duplica. `full_refresh: false`: un `--full-refresh` no las borra. **Primera foto en prod: 23-nov-2026.**
    **Nunca borrar `history`**: la historia no se puede reconstruir.
- **Pendiente:** cuenta de servicio propia de dbt (escribe en sus datasets y lee `raw_*`); hoy usa la de dlt.
  Cuando exista: `[dbt.credentials]` en `secrets.toml` con `project_id`, `client_email` y `private_key`.

## Brecha contra la guía (24-nov-2026)
- Hecho: datasets `raw_sap_fasa` (desde `FASA_PROD`) y `raw_sap_fgi` (desde `FGI_PROD`) con las 40 tablas de la guía v2.
- Falta el usuario de solo lectura propio de FGI (hoy usa el de FASA).
- Hecho: incremental con ventana y recarga completa de catálogos (`run_daily.ps1`), con tarea programada diaria a las 05:00.
- Hecho: **fotos diarias** de `OITW`, CxC y CxP (dbt, `history`), desde el 23-nov-2026. Solo se toman los días que corre la
  tarea: si el servidor está apagado a las 05:00, ese día no hay foto (la tarea corre al encender, `StartWhenAvailable`).
- Falta la segunda instancia de dlt para la base MS SQL de costeo de maquila (máquina en sitio).
