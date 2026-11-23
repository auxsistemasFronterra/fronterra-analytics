"""Corre dbt con la llave de BigQuery tomada de pipeline/.dlt/secrets.toml, sin copiarla a ningún archivo.

Uso (desde cualquier carpeta, con el Python del venv de dbt):
    C:\\Users\\ftruser16\\dbt-venv\\Scripts\\python.exe pipeline\\dbt\\run_dbt.py debug
    C:\\Users\\ftruser16\\dbt-venv\\Scripts\\python.exe pipeline\\dbt\\run_dbt.py build                 # target dev
    C:\\Users\\ftruser16\\dbt-venv\\Scripts\\python.exe pipeline\\dbt\\run_dbt.py build --target prod

Credenciales: sección [dbt.credentials] de secrets.toml si existe (cuenta de servicio propia de dbt, la que pide la guía);
si no, [destination.bigquery.credentials] (la de dlt). Mismos tres campos: project_id, client_email, private_key.
"""

import os
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
SECRETS = PROJECT_DIR.parent / ".dlt" / "secrets.toml"


def credentials() -> dict:
    if not SECRETS.exists():
        raise SystemExit(f"No existe {SECRETS}")
    with SECRETS.open("rb") as f:
        secrets = tomllib.load(f)
    creds = secrets.get("dbt", {}).get("credentials") or secrets.get("destination", {}).get("bigquery", {}).get("credentials")
    if not creds or not all(creds.get(k) for k in ("project_id", "client_email", "private_key")):
        raise SystemExit("Faltan project_id, client_email o private_key en [dbt.credentials] o [destination.bigquery.credentials]")
    return creds


def main(args: list[str]) -> int:
    creds = credentials()
    profiles_dir = PROJECT_DIR / ".profiles"   # fuera de Git (.gitignore)
    profiles_dir.mkdir(exist_ok=True)
    shutil.copyfile(PROJECT_DIR / "profiles.template.yml", profiles_dir / "profiles.yml")
    env = dict(os.environ,
               DBT_PROFILES_DIR=str(profiles_dir),
               DBT_BQ_PROJECT=creds["project_id"],
               DBT_BQ_CLIENT_EMAIL=creds["client_email"],
               DBT_BQ_PRIVATE_KEY=creds["private_key"],
               DBT_SEND_ANONYMOUS_USAGE_STATS="false",
               PYTHONIOENCODING="utf-8")
    dbt = Path(sys.executable).parent / "dbt.exe"
    if not dbt.exists():
        dbt = Path(sys.executable).parent / "dbt"
    return subprocess.call([str(dbt), *args], cwd=PROJECT_DIR, env=env)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
