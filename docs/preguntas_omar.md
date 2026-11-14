# Preguntas para Omar (12-nov-2026)

Estado: redactadas, **sin respuesta registrada**. Anotar aquí la respuesta de cada una.

## Bloquean el trabajo

1. **Base de origen de FASA.** Hoy cargamos el esquema `FRONTERRA_PROTO` de HANA, pero también existe `FASA_PROD`, con facturas más
   recientes (PROTO llega al 7 de noviembre y FASA_PROD al 10). ¿Cuál es la base de producción contra la que debemos cuadrar con
   contabilidad?
2. **Acceso a FGI.** No tenemos usuario ni conexión al SAP de FGI. ¿Quién nos da el usuario de solo lectura y para cuándo? Sin eso
   no se puede empezar la Fase B (consolidado y eliminaciones).
3. **BigQuery.** La guía lo pone como producción a mediados de diciembre, pero la organización bloquea las llaves de cuenta de
   servicio de GCP y el proyecto no tenía facturación activa. ¿Quién resuelve el acceso y la facturación?
4. **"Paneles de Claude".** ¿Se refiere a la app de dashboards que ya tenemos (página web propia conectada a Claude, que hoy solo
   corre en una computadora local) o a otra cosa? Si es la app, hay que definir dónde se publica y cómo entran los directores.
5. **Costeo de maquila.** La guía pide una segunda instancia de dlt en una máquina de la oficina para leer la base MS SQL. ¿Qué
   máquina se usa y quién nos da acceso de lectura a esa base?

## Dudas sobre la guía

6. El query del Anexo A usa la tabla `OITB` (grupos de artículos), pero no aparece en la lista de tablas a replicar de la
   sección 5. ¿La agregamos?
7. **Fotos diarias** de inventario, CxP y CxC. La guía dice "activarlas ya" y todavía no están activas. ¿Las activamos en cuanto
   esté definida la base de la pregunta 1, aunque el resto no esté listo?
8. **Plazo.** Hoy hay cargadas 9 de unas 40 tablas, solo de FASA, y dbt no está iniciado. La Fase A (margen por venta de FASA) es
   alcanzable para el 8 de enero. Las Fases B y C dependen de FGI, de Finanzas (`ref_account_mapping`, `ref_copack_rates`) y de
   Calidad. ¿Cuál es la prioridad si no llegan a tiempo?
