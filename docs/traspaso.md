# Traspaso: cómo retomar el trabajo en otro equipo (14-nov-2026)

Para la persona y para la sesión de Claude que continúe. Todo el contexto de las sesiones anteriores está en este repo; las
conversaciones de Claude **no** se transfieren entre equipos.

## Dónde quedó todo
- **Rama de trabajo: `alinear-con-guia`** (en GitHub). `main` todavía tiene las reglas viejas del prototipo; no se ha hecho merge.
- 17-nov-2026: la sesión del servidor subió directo a `main` el cambio a BigQuery (`449a8bd`, `pipeline/hana_pipeline.py`).
  Ese commit ya se unió a `alinear-con-guia`, así que la rama tiene todo. Ojo: entró a `main` sin revisión.
- 17-nov-2026: la PC nueva (`C:\Users\FR-LiderSistemas\Documents\DiscoDuro\Experimentos\fronterra-analytics`) quedó clonada y
  conectada a GitHub, con `npm install` hecho, `dashboard/config.json` puesto y el MCP `dashboards` conectado.
- La guía del director: `docs/guia_desarrollo.md`. Manda sobre todo lo demás.
- Estado real, reglas y pendientes: `CLAUDE.md` raíz.
- Preguntas para Omar (sin respuesta registrada): `docs/preguntas_omar.md`.
- Prompt para el servidor, etapas 1 y 2 de tablas y conexiones: `docs/prompt_servidor_tablas.md`. No hay reporte de la etapa 1 registrado.
- Hallazgos del prototipo de ventas: `docs/notas_prototipo.md`.
- Definición del dashboard semanal que se borró (7 gráficas con su SQL): `docs/prototipo/respaldo-ventas-semanales.json`.

## Qué NO está en git (a propósito)
- `dashboard/config.json` o `dashboard/.env`: la cadena de conexión de Postgres. Se vuelve a pegar en el equipo nuevo
  (Railway → servicio Postgres → Variables → `DATABASE_PUBLIC_URL`).
- `pipeline/.dlt/secrets.toml`: credenciales de HANA y de Railway. Solo existe en el servidor Windows.
- `node_modules/` y `.venv/`: se reinstalan.

Los dashboards no se pierden: viven en la base (esquema `dashapp`), no en el equipo. Hay 5, todos marcados "[Prototipo]".

## Pasos en el equipo nuevo
1. Instalar Git y Node.js 24.
2. Clonar y cambiar a la rama (GitHub pedirá iniciar sesión con la cuenta que tiene acceso al repo):
   ```
   git clone https://github.com/auxsistemasFronterra/fronterra-analytics.git
   cd fronterra-analytics
   git checkout alinear-con-guia
   ```
3. Instalar la app: `npm --prefix dashboard install`
4. Arrancar la página: `npm --prefix dashboard start`, abrir http://localhost:3000 y pegar la cadena de conexión.
5. Abrir la sesión de Claude en la **raíz del repo** y aprobar el servidor MCP `dashboards`.
6. Primer mensaje sugerido para Claude: "Lee CLAUDE.md, docs/guia_desarrollo.md y docs/traspaso.md y dime en qué quedamos."

## Siguiente paso del proyecto
1. Llevarle a Omar `docs/preguntas_omar.md` (la 1 y la 2 son las urgentes).
2. En el servidor: correr la etapa 1 de `docs/prompt_servidor_tablas.md` y revisar el reporte antes de autorizar la etapa 2.
3. Después: dbt Fase A (ver pendientes en `CLAUDE.md`).

## Avisos
- Los dashboards actuales no cumplen la guía (MXN, semana de lunes, desde enero, solo FASA): no presentarlos como cifras oficiales.
- La carpeta anterior `E:\Experimentos\Dashboard` del equipo viejo es una copia obsoleta de `dashboard/`; ya no se usa.
- Preferencia del usuario: respuestas muy concretas, sin exagerar el avance; no quiere costos de API (por eso MCP con su plan).
