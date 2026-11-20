"""Pipeline dlt: SAP HANA -> BigQuery o PostgreSQL (Railway).

El destino y la entidad por defecto están en .dlt/config.toml ([fronterra] destination y entity); cada entidad
([entities.fasa], [entities.fgi]) define el esquema de HANA que se lee y el dataset donde cae el crudo.

Uso:
    python hana_pipeline.py                          # carga completa (replace) de FASA al destino por defecto
    python hana_pipeline.py --entity fgi             # carga completa de FGI (raw_sap_fgi)
    python hana_pipeline.py --destination postgres   # carga completa a Postgres (Railway)
    python hana_pipeline.py --incremental            # carga incremental (merge) usando las columnas de INCREMENTAL
    python hana_pipeline.py --test                   # solo prueba la conexión a HANA y lista tablas
"""

import argparse

import dlt
import sqlalchemy as sa
from dlt.sources.credentials import ConnectionStringCredentials
from dlt.sources.sql_database import sql_database, sql_table

# Configura aquí las tablas incrementales: tabla -> (columna de cursor, llave primaria)
# Ejemplo: "OINV": ("UpdateDate", ["DocEntry"])
INCREMENTAL: dict[str, tuple[str, list[str]]] = {
    # "MI_TABLA": ("FECHA_MODIFICACION", ["ID"]),
}

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


def run_incremental(entity: str, destination: str) -> None:
    if not INCREMENTAL:
        raise SystemExit("Define al menos una tabla en INCREMENTAL antes de usar --incremental")
    cfg = hana_config(entity)
    creds = hana_credentials(entity)
    resources = []
    for table, (cursor, pk) in INCREMENTAL.items():
        res = sql_table(
            credentials=creds,
            schema=cfg["schema"],
            table=_sa_name(table),
            backend="pyarrow",
            chunk_size=cfg["chunk_size"],
            incremental=dlt.sources.incremental(cursor),
            reflection_level="full_with_precision",
            table_adapter_callback=drop_excluded_columns,
        )
        res.apply_hints(primary_key=pk, write_disposition="merge")
        resources.append(res)
    info = make_pipeline(entity, destination).run(resources, loader_file_format=loader_format(destination))
    print(info)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--test", action="store_true", help="probar conexión a HANA")
    group.add_argument("--incremental", action="store_true", help="carga incremental (merge)")
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
        run_incremental(entity, destination)
    else:
        print(f"Carga completa de {entity.upper()}: HANA {hana_schema(entity)} -> {destination} {dataset_name(entity)}")
        run_full(entity, destination)
