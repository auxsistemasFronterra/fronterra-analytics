"""Pipeline dlt: SAP HANA -> BigQuery o PostgreSQL (Railway).

El destino por defecto está en .dlt/config.toml ([fronterra] destination); se puede forzar con --destination.

Uso:
    python hana_pipeline.py                          # carga completa (replace) al destino por defecto
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
DATASET_NAME = "sap_hana_raw"  # dataset de BigQuery / esquema de Postgres (se crea si no existe)


def make_pipeline(destination: str) -> dlt.Pipeline:
    # Un pipeline (y estado local) por destino: hana_to_bigquery, hana_to_postgres
    return dlt.pipeline(pipeline_name=f"hana_to_{destination}", destination=destination, dataset_name=DATASET_NAME)


def hana_credentials() -> ConnectionStringCredentials:
    return dlt.secrets.get("sources.hana.credentials", ConnectionStringCredentials)


def _sa_name(name: str) -> str:
    # sqlalchemy-hana trata los nombres en minúsculas como identificadores HANA en MAYÚSCULAS
    # (un nombre en mayúsculas se interpretaría como sensible a mayúsculas y no se encuentra)
    return name.lower() if name.isupper() else name


def hana_config() -> dict:
    tables = dlt.config.get("sources.hana.tables") or None
    return {
        "schema": _sa_name(dlt.config["sources.hana.schema"]),
        "tables": [_sa_name(t) for t in tables] if tables else None,
        "chunk_size": dlt.config.get("sources.hana.chunk_size") or 50000,
    }


def test_connection() -> None:
    creds = hana_credentials()
    schema = dlt.config["sources.hana.schema"]
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


def run_full(destination: str) -> None:
    cfg = hana_config()
    source = sql_database(
        credentials=hana_credentials(),
        schema=cfg["schema"],
        table_names=cfg["tables"],
        backend="pyarrow",
        chunk_size=cfg["chunk_size"],
        reflection_level="full_with_precision",
    )
    info = make_pipeline(destination).run(source, write_disposition="replace")
    print(info)


def run_incremental(destination: str) -> None:
    if not INCREMENTAL:
        raise SystemExit("Define al menos una tabla en INCREMENTAL antes de usar --incremental")
    cfg = hana_config()
    creds = hana_credentials()
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
        )
        res.apply_hints(primary_key=pk, write_disposition="merge")
        resources.append(res)
    info = make_pipeline(destination).run(resources)
    print(info)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--test", action="store_true", help="probar conexión a HANA")
    group.add_argument("--incremental", action="store_true", help="carga incremental (merge)")
    parser.add_argument("--destination", choices=DESTINATIONS, default=None,
                        help="destino; por defecto [fronterra] destination de config.toml")
    args = parser.parse_args()
    destination = args.destination or dlt.config.get("fronterra.destination") or "bigquery"

    if args.test:
        test_connection()
    elif args.incremental:
        run_incremental(destination)
    else:
        run_full(destination)
