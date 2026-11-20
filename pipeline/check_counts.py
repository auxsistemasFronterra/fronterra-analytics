"""Compara el número de filas de cada tabla entre SAP HANA y BigQuery.

Uso (desde pipeline/):
    python check_counts.py            # todas las tablas de config.toml
    python check_counts.py OINV JDT1  # solo esas

Cuenta con COUNT(*) en ambos lados (no con estadísticas aproximadas). Sale con código 1 si alguna tabla no cuadra.
"""

import sys

import dlt
import sqlalchemy as sa
from dlt.sources.credentials import ConnectionStringCredentials
from google.cloud import bigquery
from google.oauth2 import service_account


def bigquery_client() -> bigquery.Client:
    c = dlt.secrets["destination.bigquery.credentials"]
    creds = service_account.Credentials.from_service_account_info({
        "type": "service_account",
        "project_id": c["project_id"],
        "client_email": c["client_email"],
        "private_key": c["private_key"],
        "token_uri": "https://oauth2.googleapis.com/token",
    })
    location = dlt.config.get("destination.bigquery.location")
    return bigquery.Client(project=c["project_id"], credentials=creds, location=location)


def main(only: list[str]) -> int:
    schema = dlt.config["sources.hana.schema"]
    dataset = dlt.config.get("fronterra.dataset") or "raw_sap_fasa"
    tables = [t.upper() for t in (only or dlt.config["sources.hana.tables"])]

    engine = sa.create_engine(dlt.secrets.get("sources.hana.credentials", ConnectionStringCredentials).to_url())
    with engine.connect() as conn:
        hana = {t: conn.execute(sa.text(f'SELECT COUNT(*) FROM "{schema}"."{t}"')).scalar() for t in tables}

    bq = bigquery_client()
    union = " UNION ALL ".join(f"SELECT '{t}' AS t, COUNT(*) AS n FROM `{dataset}.{t.lower()}`" for t in tables)
    bqc = {r.t: r.n for r in bq.query(union).result()}

    bad = 0
    print(f"{'tabla':<7} {'HANA ' + schema:>18} {'BigQuery ' + dataset:>24}")
    for t in tables:
        ok = hana[t] == bqc.get(t)
        bad += not ok
        print(f"{t:<7} {hana[t]:>18,} {bqc.get(t, 0):>24,}  {'OK' if ok else 'NO CUADRA'}")
    print(f"\n{len(tables) - bad} de {len(tables)} tablas cuadran.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
