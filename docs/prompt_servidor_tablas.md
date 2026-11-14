# Prompt para la sesión del servidor: conexiones y tablas (sección 5 de la guía)

Estado al 14-nov-2026: prompt entregado al usuario; **no hay reporte de la etapa 1 registrado en este repo**.
Solo desde el servidor Windows de la red interna se alcanza HANA.

```text
Baja la rama nueva y trabaja sobre ella:
git fetch
git checkout alinear-con-guia

Lee completos docs/guia_desarrollo.md (guía del director, manda sobre todo lo anterior) y el CLAUDE.md raíz. Vamos a empezar por las conexiones y las tablas (sección 5 de la guía). No toques dbt todavía.

ETAPA 1: solo revisar, no cargar nada. Al terminar, repórtame y espera mi respuesta.

1. Conexiones: corre el --test y dime a qué esquemas de HANA tiene acceso el usuario actual. Confirma si existen FRONTERRA_PROTO, FASA_PROD y alguno de FGI, y si el usuario es de solo lectura.
2. Compara FRONTERRA_PROTO contra FASA_PROD: número de filas y fecha máxima de OINV, OJDT y OIGN en cada uno. Necesito saber cuál es producción.
3. Para cada tabla de la sección 5 de la guía, más OITB (la usa el Anexo A), dame una tabla con: si existe, número de filas, llave primaria y si tiene UpdateDate (y UpdateTS o CreateDate). Las tablas son: OINV, INV1, ORIN, RIN1, ORDR, RDR1, ODLN, DLN1, OPOR, POR1, OPDN, PDN1, OPCH, PCH1, OIGE, IGE1, OIGN, IGN1, OBTN, OITL, ITL1, JDT1, OJDT, OACT, OITM, OITW, OWHS, OCRD, OCRG, NNM1, OPRJ, ORTT, OITB.
4. Confirma que existen los campos de usuario que usa la guía: U_FolioFronterra, U_NumLote, U_Huerta, U_CodSAGARPA, U_Productor (OPOR), U_U_SalidaDocEntry (OIGN), y la vista XBXP_DASHBOARD_EDORESULTADOS.
5. Dime si desde este servidor se alcanza la base MS SQL de costeo de maquila (la guía dice que no) y qué versión de Python y de dlt hay instaladas.

ETAPA 2: solo cuando yo te confirme el esquema de producción.

6. Cambia el destino a un esquema nuevo raw_sap_fasa. No borres sap_hana_raw: los dashboards de prototipo lo siguen usando.
7. Deja el esquema de origen y el nombre de la entidad configurables, para poder agregar FGI después como raw_sap_fgi con su propio usuario.
8. Carga según la columna "Estrategia de carga" de la sección 5:
   - Documentos (OINV/INV1, ORIN/RIN1, ORDR/RDR1, ODLN/DLN1, OPOR/POR1, OPDN/PDN1, OPCH/PCH1, OIGE/IGE1, OIGN/IGN1, OJDT/JDT1, OITL/ITL1): incremental por UpdateDate con una ventana de días hacia atrás y merge por llave primaria. Las líneas no siempre tienen UpdateDate propio: en ese caso recarga las líneas de los documentos cuyo encabezado cambió. Nunca uses DocDate como cursor (regla 17).
   - Catálogos (OBTN, OACT, OITM, OITW, OWHS, OCRD, OCRG, NNM1, OPRJ, ORTT, OITB): recarga completa en cada corrida.
   - JDT1 tiene unos 2 millones de filas: primera carga completa por bloques, y después incremental.
9. Fotos diarias (activarlas ya): una copia con fecha de OITW y de los saldos abiertos de CxP y CxC, que se agregue cada día sin borrar las anteriores.
10. Tarea programada de Windows que corra todo una vez al día, con un archivo de registro y código de salida distinto de cero si falla.
11. Validación: conteo de filas por tabla en HANA contra Postgres después de cargar.
12. Actualiza pipeline/CLAUDE.md y los pendientes del CLAUDE.md raíz, haz commit en la rama alinear-con-guia y push. No subas credenciales y no hagas merge a main.
```
