"""Compara el contenido de tablas clave entre SAP HANA y BigQuery (importes, cantidades, fechas, textos y llaves).

Complementa a check_counts.py: que cuadren las filas no garantiza que cuadren los valores.

Uso (desde pipeline/):
    python check_content.py            # todas las revisiones
    python check_content.py OINV JDT1  # solo esas tablas
    python check_content.py --entity fgi  # FGI_PROD vs raw_sap_fgi

Sale con código 1 si alguna revisión no cuadra. SAP sigue registrando documentos mientras corre: si hay una diferencia
justo después de una carga, vuelve a cargar y revisar antes de buscar un error.
"""

import sys
from decimal import Decimal

import sqlalchemy as sa

from check_counts import bigquery_client, parse_args
from hana_pipeline import dataset_name, hana_credentials, hana_schema


def _date(hana_col: str, bq_col: str, fn: str) -> tuple[str, str]:
    # Fecha como texto AAAA-MM-DD en ambos lados (detecta corrimientos por zona horaria)
    return f"TO_VARCHAR({fn}(\"{hana_col}\"), 'YYYY-MM-DD')", f'FORMAT_DATE("%F", DATE({fn}({bq_col})))'


def _sum(hana_col: str, bq_col: str) -> tuple[str, str]:
    return f'SUM("{hana_col}")', f"SUM({bq_col})"


def _len(hana_col: str, bq_col: str) -> tuple[str, str]:
    # Suma de largos de texto: detecta textos recortados o caracteres mal convertidos (ñ, acentos)
    return f'SUM(LENGTH("{hana_col}"))', f"SUM(LENGTH({bq_col}))"


def _distinct(hana_col: str, bq_col: str) -> tuple[str, str]:
    return f'COUNT(DISTINCT "{hana_col}")', f"COUNT(DISTINCT {bq_col})"


# tabla HANA: [(etiqueta, (expresión HANA, expresión BigQuery))]. Columnas de BigQuery en snake_case (nombres de dlt).
CHECKS: dict[str, list[tuple[str, tuple[str, str]]]] = {
    "OINV": [
        ("suma DocTotal", _sum("DocTotal", "doc_total")),
        ("suma DocTotalSy (USD)", _sum("DocTotalSy", "doc_total_sy")),
        ("suma VatSum", _sum("VatSum", "vat_sum")),
        ("DocEntry distintos", _distinct("DocEntry", "doc_entry")),
        ("fecha mínima", _date("DocDate", "doc_date", "MIN")),
        ("fecha máxima", _date("DocDate", "doc_date", "MAX")),
        ("largo Comments", _len("Comments", "comments")),
        ("canceladas", ("SUM(CASE WHEN \"CANCELED\" = 'Y' THEN 1 ELSE 0 END)", "COUNTIF(canceled = 'Y')")),
    ],
    "INV1": [
        ("suma LineTotal", _sum("LineTotal", "line_total")),
        ("suma TotalSumSy (USD)", _sum("TotalSumSy", "total_sum_sy")),
        ("suma Quantity", _sum("Quantity", "quantity")),
        ("largo Dscription", _len("Dscription", "dscription")),
        ("largo Text (NCLOB)", _len("Text", "text")),
    ],
    "ORIN": [
        ("suma DocTotal", _sum("DocTotal", "doc_total")),
        ("suma DocTotalSy (USD)", _sum("DocTotalSy", "doc_total_sy")),
    ],
    "OPCH": [
        ("suma DocTotal", _sum("DocTotal", "doc_total")),
        ("largo Comments", _len("Comments", "comments")),
    ],
    "RCT2": [
        ("suma SumApplied", _sum("SumApplied", "sum_applied")),
    ],
    "JDT1": [
        ("suma Debit", _sum("Debit", "debit")),
        ("suma Credit", _sum("Credit", "credit")),
        ("suma SYSDeb (USD)", _sum("SYSDeb", "sys_deb")),
        ("suma SYSCred (USD)", _sum("SYSCred", "sys_cred")),
        ("fecha máxima", _date("RefDate", "ref_date", "MAX")),
    ],
    "IGE1": [
        ("suma Quantity", _sum("Quantity", "quantity")),
        ("suma LineTotal", _sum("LineTotal", "line_total")),
    ],
    "ITL1": [
        ("suma Quantity", _sum("Quantity", "quantity")),
    ],
    "OITW": [
        ("suma OnHand", _sum("OnHand", "on_hand")),
    ],
    "OBTN": [
        ("pallets distintos", _distinct("DistNumber", "dist_number")),
    ],
    "ORTT": [
        ("suma Rate", _sum("Rate", "rate")),
        ("fecha máxima", _date("RateDate", "rate_date", "MAX")),
    ],
    "OCRD": [
        ("largo CardName", _len("CardName", "card_name")),
    ],
}


def same(a, b) -> bool:
    if a is None or b is None:
        return a is b
    if isinstance(a, (int, float, Decimal)) and isinstance(b, (int, float, Decimal)):
        return Decimal(str(a)) == Decimal(str(b))  # importes exactos, sin redondeo de float
    return str(a) == str(b)


def main(only: list[str], entity: str) -> int:
    schema = hana_schema(entity)
    dataset = dataset_name(entity)
    tables = [t.upper() for t in only] if only else list(CHECKS)
    unknown = [t for t in tables if t not in CHECKS]
    if unknown:
        print(f"Sin revisiones definidas para: {', '.join(unknown)}. Disponibles: {', '.join(CHECKS)}")
        return 2

    engine = sa.create_engine(hana_credentials(entity).to_url())
    bq = bigquery_client()
    total = bad = 0
    print(f"HANA {schema} vs BigQuery {dataset}\n")
    with engine.connect() as conn:
        for t in tables:
            checks = CHECKS[t]
            hana = conn.execute(sa.text("SELECT " + ", ".join(h for _, (h, _) in checks) + f' FROM "{schema}"."{t}"')).fetchone()
            big = list(bq.query("SELECT " + ", ".join(b for _, (_, b) in checks) + f" FROM `{dataset}.{t.lower()}`").result())[0]
            for i, (label, _) in enumerate(checks):
                ok = same(hana[i], big[i])
                total += 1
                bad += not ok
                detail = "" if ok else f"  HANA={hana[i]}  BigQuery={big[i]}"
                print(f"{t:<5} {label:<24} {'OK' if ok else 'NO CUADRA'}{detail}")
    print(f"\n{total - bad} de {total} revisiones cuadran.")
    return 1 if bad else 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # acentos en la consola de Windows
    args = parse_args(__doc__)
    sys.exit(main(args.tables, args.entity))
