"""Pipeline dlt: SAP HANA -> BigQuery o PostgreSQL (Railway).

El destino y la entidad por defecto están en .dlt/config.toml ([fronterra] destination y entity); cada entidad
([entities.fasa], [entities.fgi]) define el esquema de HANA que se lee y el dataset donde cae el crudo.

Uso:
    python hana_pipeline.py                          # carga completa (replace) de FASA al destino por defecto
    python hana_pipeline.py --entity fgi             # carga completa de FGI (raw_sap_fgi)
    python hana_pipeline.py --destination postgres   # carga completa a Postgres (Railway)
    python hana_pipeline.py --incremental            # incremental: documentos de los últimos 7 días + catálogos completos
    python hana_pipeline.py --incremental --days 30  # ventana más amplia (p. ej. después de varios días sin cargar)
    python hana_pipeline.py --test                   # solo prueba la conexión a HANA y lista tablas

Incremental (ventana de días, sin estado: siempre recarga los últimos N días, así un día fallido se recupera solo):
- Encabezados (WINDOW_TABLES): filas con UpdateDate (o CreateDate en OITL) dentro de la ventana.
- Líneas (CHILD_TABLES): todas las líneas de esos encabezados, aunque no tengan fecha propia.
- Ambos se escriben con merge "delete-insert" por la llave del documento: en BigQuery se borran las filas de esos
  documentos y se insertan las de HANA (así también desaparecen líneas que se quitaron de un pedido abierto).
- El resto de las tablas (catálogos, OBTN) se recarga completa (replace): son chicas.
SAP no borra documentos contabilizados (los cancela, y eso cambia su UpdateDate); para lo raro, la carga completa semanal.
"""

import argparse
from datetime import date, timedelta

import dlt
import sqlalchemy as sa
from dlt.sources.credentials import ConnectionStringCredentials
from dlt.sources.sql_database import sql_database, sql_table

# Encabezados que se leen por ventana de fechas: tabla -> (columna de fecha, llave del documento)
WINDOW_TABLES: dict[str, tuple[str, str]] = {
    "OINV": ("UpdateDate", "DocEntry"), "ORIN": ("UpdateDate", "DocEntry"),
    "ORDR": ("UpdateDate", "DocEntry"), "ODLN": ("UpdateDate", "DocEntry"),
    "OPOR": ("UpdateDate", "DocEntry"), "OPDN": ("UpdateDate", "DocEntry"), "OPCH": ("UpdateDate", "DocEntry"),
    "OIGE": ("UpdateDate", "DocEntry"), "OIGN": ("UpdateDate", "DocEntry"),
    "ORCT": ("UpdateDate", "DocEntry"),
    "OJDT": ("UpdateDate", "TransId"),
    "OITL": ("CreateDate", "LogEntry"),  # bitácora de lotes: solo se agregan filas, no tiene UpdateDate
}

# Líneas sin fecha propia: tabla -> (encabezado, columna de la línea que apunta a la llave del encabezado)
CHILD_TABLES: dict[str, tuple[str, str]] = {
    "INV1": ("OINV", "DocEntry"), "INV12": ("OINV", "DocEntry"), "RIN1": ("ORIN", "DocEntry"),
    "RDR1": ("ORDR", "DocEntry"), "DLN1": ("ODLN", "DocEntry"),
    "POR1": ("OPOR", "DocEntry"), "PDN1": ("OPDN", "DocEntry"), "PCH1": ("OPCH", "DocEntry"),
    "IGE1": ("OIGE", "DocEntry"), "IGN1": ("OIGN", "DocEntry"),
    "RCT2": ("ORCT", "DocNum"),   # RCT2.DocNum = ORCT.DocEntry
    "JDT1": ("OJDT", "TransId"),
    "ITL1": ("OITL", "LogEntry"),
}

# Encabezados cuyo saldo cambia al conciliar: tabla -> tipo de objeto de SAP en ITR1.SrcObjTyp (SrcObjAbs = DocEntry)
RECONCILED_OBJECTS: dict[str, str] = {"OINV": "13", "ORIN": "14", "OPCH": "18", "ORCT": "24"}

DEFAULT_WINDOW_DAYS = 7

DESTINATIONS = ("bigquery", "postgres")

# Columnas que no se copian (tabla -> columnas, en minúsculas): secretos de integraciones de SAP
EXCLUDE_COLUMNS: dict[str, set[str]] = {
    "oadm": {"oauclisec", "oaucliid"},
}


ENTITIES = ("fasa", "fgi")


def default_entity() -> str:
    return dlt.config.get("fronterra.entity") or "fasa"


def hana_schema(entity: str) -> str:
    # Esquema de HANA en mayúsculas, tal como existe (FASA_PROD, FGI_PROD)
    return dlt.config[f"entities.{entity}.schema"]


def dataset_name(entity: str) -> str:
    # Dataset de BigQuery / esquema de Postgres (se crea si no existe). Guía: raw_sap_fasa, raw_sap_fgi
    return dlt.config[f"entities.{entity}.dataset"]


def make_pipeline(entity: str, destination: str) -> dlt.Pipeline:
    # Un pipeline (y estado local) por dataset y destino, p. ej. raw_sap_fasa_to_bigquery
    ds = dataset_name(entity)
    return dlt.pipeline(pipeline_name=f"{ds}_to_{destination}", destination=destination, dataset_name=ds)


def loader_format(destination: str) -> str | None:
    # BigQuery carga parquet más rápido y conserva tipos; Postgres usa su formato por defecto
    return "parquet" if destination == "bigquery" else None


def drop_excluded_columns(table: sa.Table) -> sa.Table:
    excluded = EXCLUDE_COLUMNS.get(table.name.lower())
    if excluded:
        for col in [c for c in table.columns if c.name.lower() in excluded]:
            table._columns.remove(col)
    return table


def hana_credentials(entity: str) -> ConnectionStringCredentials:
    # Usuario propio de la entidad si existe ([sources.hana_fgi.credentials]); si no, el compartido [sources.hana.credentials]
    for key in (f"sources.hana_{entity}.credentials", "sources.hana.credentials"):
        if dlt.secrets.get(key) is not None:
            return dlt.secrets.get(key, ConnectionStringCredentials)
    raise SystemExit("Faltan las credenciales de HANA en .dlt/secrets.toml ([sources.hana.credentials])")


def _sa_name(name: str) -> str:
    # sqlalchemy-hana trata los nombres en minúsculas como identificadores HANA en MAYÚSCULAS
    # (un nombre en mayúsculas se interpretaría como sensible a mayúsculas y no se encuentra)
    return name.lower() if name.isupper() else name


def hana_config(entity: str) -> dict:
    tables = dlt.config.get("sources.hana.tables") or None
    return {
        "schema": _sa_name(hana_schema(entity)),
        "tables": [_sa_name(t) for t in tables] if tables else None,
        "chunk_size": dlt.config.get("sources.hana.chunk_size") or 50000,
    }


def test_connection(entity: str) -> None:
    creds = hana_credentials(entity)
    schema = hana_schema(entity)
    engine = sa.create_engine(creds.to_url())
    with engine.connect() as conn:
        version = conn.execute(sa.text("SELECT VERSION FROM SYS.M_DATABASE")).scalar()
        print(f"Conectado a SAP HANA, versión {version}")
        schemas = conn.execute(
            sa.text(
                "SELECT SCHEMA_NAME FROM SYS.SCHEMAS WHERE HAS_PRIVILEGES = 'TRUE' "
                "AND SCHEMA_NAME NOT LIKE '\\_SYS%' ESCAPE '\\' AND SCHEMA_NAME NOT IN ('SYS','SYSTEM') "
                "ORDER BY SCHEMA_NAME"
            )
        ).scalars().all()
        print(f"Esquemas accesibles ({len(schemas)}): {', '.join(schemas[:100])}")
        rows = conn.execute(
            sa.text("SELECT TABLE_NAME, RECORD_COUNT FROM SYS.M_TABLES WHERE SCHEMA_NAME = :s ORDER BY TABLE_NAME"),
            {"s": schema},
        ).fetchall()
        print(f"{len(rows)} tablas en el esquema {schema}:")
        for name, count in rows[:50]:
            print(f"  {name:<40} {count:>12}")


def run_full(entity: str, destination: str) -> None:
    cfg = hana_config(entity)
    source = sql_database(
        credentials=hana_credentials(entity),
        schema=cfg["schema"],
        table_names=cfg["tables"],
        backend="pyarrow",
        chunk_size=cfg["chunk_size"],
        reflection_level="full_with_precision",
        table_adapter_callback=drop_excluded_columns,
    )
    pipeline = make_pipeline(entity, destination)
    info = pipeline.run(source, write_disposition="replace", loader_file_format=loader_format(destination))
    print(info)


def _window_filter(schema: str, table: str, since: date):
    """Filtro SQL para la ventana: encabezados por su fecha; líneas por la llave de los encabezados de la ventana."""
    t = table.upper()
    # Al conciliar (aplicar un cobro o pago, o cancelar la conciliación) SAP cambia saldos de documentos y asientos viejos
    # (PaidToDate/DocStatus de facturas, BalDueDeb/BalDueCred de JDT1) sin tocar su UpdateDate. Por eso también se recargan
    # los documentos y asientos que aparecen en conciliaciones (OITR/ITR1) creadas en la ventana. Probado 23-nov-2026:
    # explica el 100% de las diferencias de saldos entre HANA y BigQuery (249 renglones de JDT1 en FASA, 3 facturas en FGI).
    oitr = sa.table("oitr", sa.column("ReconNum"), sa.column("CreateDate"), schema=schema)
    itr1 = sa.table("itr1", sa.column("ReconNum"), sa.column("TransId"), sa.column("SrcObjTyp"), sa.column("SrcObjAbs"),
                    schema=schema)
    recent = sa.select(itr1).join(oitr, oitr.c.ReconNum == itr1.c.ReconNum).where(oitr.c.CreateDate >= since).subquery()

    if t in WINDOW_TABLES:
        date_col, key = WINDOW_TABLES[t]
        if t in RECONCILED_OBJECTS:
            docs = sa.select(recent.c.SrcObjAbs).where(recent.c.SrcObjTyp == RECONCILED_OBJECTS[t])
            return lambda query, tbl: query.where(sa.or_(tbl.c[date_col] >= since, tbl.c[key].in_(docs)))
        return lambda query, tbl: query.where(tbl.c[date_col] >= since)

    parent, fk = CHILD_TABLES[t]
    date_col, key = WINDOW_TABLES[parent]
    # sa.table/sa.column: nombres de tabla y esquema en minúsculas (= MAYÚSCULAS en HANA), columnas con mayúsculas y
    # minúsculas se citan solas ("DocEntry")
    hdr = sa.table(_sa_name(parent), sa.column(key), sa.column(date_col), schema=schema)
    keys = sa.select(hdr.c[key]).where(hdr.c[date_col] >= since)
    if t == "JDT1":
        reconciled = sa.select(recent.c.TransId)
        return lambda query, tbl: query.where(sa.or_(tbl.c[fk].in_(keys), tbl.c[fk].in_(reconciled)))
    return lambda query, tbl: query.where(tbl.c[fk].in_(keys))


def run_incremental(entity: str, destination: str, days: int) -> None:
    cfg = hana_config(entity)
    creds = hana_credentials(entity)
    since = date.today() - timedelta(days=days)
    pipeline = make_pipeline(entity, destination)
    print(f"Carga incremental de {entity.upper()}: HANA {hana_schema(entity)} -> {destination} {dataset_name(entity)}, "
          f"documentos con fecha >= {since} ({days} días); catálogos completos")

    resources = []
    for name in cfg["tables"] or []:
        t = name.upper()
        windowed = t in WINDOW_TABLES or t in CHILD_TABLES
        res = sql_table(
            credentials=creds,
            schema=cfg["schema"],
            table=name,
            backend="pyarrow",
            chunk_size=cfg["chunk_size"],
            reflection_level="full_with_precision",
            table_adapter_callback=drop_excluded_columns,
            query_adapter_callback=_window_filter(cfg["schema"], t, since) if windowed else None,
        )
        if windowed:
            # delete-insert: en el destino se borran las filas cuyos documentos vienen en la carga y se insertan las nuevas.
            # La llave va con el nombre de HANA (DocEntry); dlt la normaliza a doc_entry igual que la columna.
            doc_key = WINDOW_TABLES[t][1] if t in WINDOW_TABLES else CHILD_TABLES[t][1]
            res.apply_hints(write_disposition={"disposition": "merge", "strategy": "delete-insert"}, merge_key=doc_key)
        else:
            res.apply_hints(write_disposition="replace")
        resources.append(res)

    if not pipeline.default_schema_name:
        raise SystemExit(f"{pipeline.pipeline_name} no tiene carga previa en esta máquina: corre primero la carga completa")
    # Mismo esquema dlt que la carga completa (sql_database), para que las tablas y sus tipos sean los mismos
    source = dlt.source(lambda: resources, name=pipeline.default_schema_name)()
    info = pipeline.run(source, loader_file_format=loader_format(destination))
    print(info)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--test", action="store_true", help="probar conexión a HANA")
    group.add_argument("--incremental", action="store_true",
                       help="carga incremental: documentos de los últimos --days días (merge) y catálogos completos")
    parser.add_argument("--days", type=int, default=DEFAULT_WINDOW_DAYS,
                        help=f"días hacia atrás de la ventana incremental (por defecto {DEFAULT_WINDOW_DAYS})")
    parser.add_argument("--destination", choices=DESTINATIONS, default=None,
                        help="destino; por defecto [fronterra] destination de config.toml")
    parser.add_argument("--entity", choices=ENTITIES, default=None,
                        help="entidad (fasa o fgi); por defecto [fronterra] entity de config.toml")
    args = parser.parse_args()
    destination = args.destination or dlt.config.get("fronterra.destination") or "bigquery"
    entity = args.entity or default_entity()

    if args.test:
        test_connection(entity)
    elif args.incremental:
        run_incremental(entity, destination, args.days)
    else:
        print(f"Carga completa de {entity.upper()}: HANA {hana_schema(entity)} -> {destination} {dataset_name(entity)}")
        run_full(entity, destination)
