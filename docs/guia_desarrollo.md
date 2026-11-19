# Guía de desarrollo · Fronterra Digital Hub Fase 1

> Para el equipo de desarrollo y para Claude Code.
> Qué construir, en qué orden, con qué tablas de SAP y cómo saber que está bien.
> Las decisiones de negocio ya están tomadas; si un dato contradice una regla de esta guía, **detente y avisa a Omar** antes de cambiar la regla.

---

## 0. Cómo usar esta guía con Claude Code

1. Guárdala en el repositorio como `docs/guia_desarrollo.md`.
2. En la raíz del repositorio, crea `CLAUDE.md` con este contenido:

```markdown
# Contexto
Lee docs/guia_desarrollo.md antes de escribir o modificar cualquier modelo.

# Reglas
- Respeta las convenciones de la sección 4 (nombres en inglés, capas, columnas).
- Toda la lógica de negocio va en dbt. Nunca en la herramienta de visualización.
- Toda llave incluye la entidad (FASA o FGI).
- Cada modelo lleva descripción bilingüe (inglés y español) en su .yml y al menos una prueba.
- El almacén es BigQuery: se puede usar SQL de BigQuery; preferir macros de dbt cuando existan.
- Nunca escribas credenciales en el código.
- Si un dato contradice una regla de la guía, detente y avisa antes de cambiar la regla.
```

3. Todo cambio entra como propuesta en Git y otra persona del equipo lo revisa antes de unirlo.

---

## 1. Qué vamos a construir (en una página)

Un **tablero para los directores** que responda: **¿cuánto ganamos en cada venta, y por qué?**

Para responderlo hay que juntar, para cada venta, cuánto se cobró y cuánto costó todo lo que hizo falta para entregarla: la fruta, cosecharla, transportarla, empacarla y llevarla al cliente. Ese cálculo vive en dbt. **Todo se muestra en Lightdash**: el Dashboard de Rentabilidad, el Weekly y los cuatro estados financieros. No hay tableros directivos fuera de Lightdash.

Además, el tablero incluye el **Weekly Report** (15 indicadores que los directores revisan cada semana), los **cuatro estados financieros** y el **agente de IA de Lightdash**, que responde preguntas en inglés y en español sobre las métricas definidas en dbt.

**Fecha de entrega:** 8 de enero de 2027.

**Cómo se evalúa** (esto define "terminado"):

1. El total de ventas y costos por mes cuadra con la contabilidad de SAP.
2. Cada venta desde junio de 2026 muestra su margen, y el tablero muestra qué porcentaje de ventas tiene su costo completo.
3. El agente de IA de Lightdash contesta bien al menos 18 de 20 preguntas que escribirán los directores, en inglés y en español.
4. Los directores lo usan en su junta semanal al menos dos veces antes del 8 de enero.

---

## 1.1 Alcance del MVP para el 8 de enero

Regla: **supuesto por defecto + marca visible + Fase 2.** Ninguna pregunta abierta detiene la construcción.

**Dentro del MVP:**
- Los cuatro estados financieros de FASA y FGI (con los insumos que entregue Finanzas).
- Margen por venta de FASA; consolidado con reparto del costo de cada tráiler entre sus ventas por cajas, marcado como aproximado, hasta que la automatización FGI → FASA conserve el número de pallet.
- Weekly: los 13 KPIs listos **más AR – % Collected** (no negociable): de lo que vencía en la semana, qué porcentaje se cobró. OTIF fuera.
- Trazabilidad hasta la huerta: prueba de 20 ventas y 5 huertas. Sin pruebas de orgánico ni de elegibilidad por mercado.
- Maquila: **solo desde que existe la app de costeo (octubre 2026)**, por costeo COS. Lo que no se pueda calcular no aparece, y los pallets de maquila sin costo de maquila se marcan como "margen incompleto" para que no parezcan más rentables de lo que son.
- Empaque de San Lorenzo anterior a la corrección de n8n: se muestra como hueco de captura.
- Costos de FGI (fletes y bodegas en EE.UU.): fuera del margen por venta; se ven en el estado de resultados. Se exploran campos de FGI con consultas conforme avance el proyecto.
- **Mercado de destino por país del cliente:** cada venta toma el país de envío **del propio documento** (`INV12.country_s`, la dirección de entrega de la factura) y, si viene vacío, el de la dirección de entrega predeterminada del cliente (`CRD1`). Datos maestros por corregir: en FASA, 8 clientes con país `XX` y 5 vacíos; en FGI, 2 vacíos. Para las ventas de FASA a FGI, el país es el del cliente final de FGI (vía la cadena del pallet o, mientras no exista, el reparto por tráiler). Rastreando hacia atrás (venta → pallet → lote), cada lote queda clasificado por el mercado al que realmente se vendió su fruta, y el costo de la fruta se compara por mercado.

**Cambios de configuración de SAP en curso:** Finanzas prepara mejoras a SAP (cuentas nuevas, costeos, listas de materiales). Regla para el MVP: se construye con la configuración actual y se ajusta cuando lleguen los cambios. Las pruebas que alertan cuentas sin mapear, formatos nuevos y descuadres contra contabilidad son las que detectan el impacto de cada cambio. Pedir a Finanzas que cada cambio tenga fecha de entrada en vigor al inicio de un mes y se avise antes de aplicarse.

**Fuera del MVP (Fase 2):** huertas orgánicas y huertas autorizadas por mercado (Calidad), validación de la prueba de trazabilidad con Calidad, OTIF, licencia de HANA para dlt.

## 2. Glosario: el negocio en palabras de desarrollador

| Término | Qué significa para ti |
|---|---|
| **FASA** | La empresa en México: compra fruta, la empaca y la vende. Tiene su propio SAP |
| **FGI** | La empresa en Estados Unidos: le compra a FASA y vende a clientes allá. Tiene su propio SAP |
| **Entidad** | FASA o FGI. Los dos SAP repiten números de documento, por eso toda llave lleva la entidad |
| **Intercompañía** | Una venta de FASA a FGI. Es dinero que pasa entre empresas del mismo grupo |
| **Consolidado** | Ver FASA y FGI como si fueran una sola empresa |
| **Eliminación (ELIM)** | Filas extra que restan las ventas intercompañía para que el consolidado no cuente dos veces la misma fruta (ver sección 7) |
| **Margen** | Lo que queda de una venta después de restarle sus costos. Margen % = margen ÷ venta |
| **Estado de resultados** | El reporte mensual de "cuánto entró, cuánto costó y cuánto se ganó", armado con las cuentas contables. Sale de las tablas JDT1 y OACT |
| **EBIT** | La ganancia de operación del mes: ingresos − costo de ventas − gastos de operación |
| **Lote** | Un grupo de fruta comprada a una huerta en una fecha. Su número identifica también el sitio de empaque |
| **Corte** | Pagarle a la cuadrilla que cosecha la fruta. Es un servicio que se factura por lote |
| **Acarreo** | El transporte de la huerta al empaque. También se factura por lote |
| **Maquila** | Empacar en una planta de un tercero (San Lorenzo o Tanim) en lugar de la propia (San Tadeo) |
| **Pallet** | La tarima con cajas que sale de empaque. Es la unidad que viaja y se vende |
| **Tráiler** | Envío de FASA a FGI, normalmente con unos 20 pallets |
| **Folio FACL** | El número de una factura de venta de FASA (serie FACL + número de documento) |
| **Pack-out** | Qué porcentaje de la fruta de un lote calificó para exportar |
| **Merma** | Fruta que no sirvió para ningún mercado |
| **CxP / CxC** | Cuentas por pagar (lo que debemos a proveedores) y por cobrar (lo que nos deben los clientes) |
| **Foto diaria** | Guardar cada día el saldo de inventario, CxP y CxC, porque SAP solo guarda el saldo de hoy |
| **Tipo de cambio** | Pesos por dólar de cada día. FASA registra en pesos; el tablero reporta en dólares |

---

## 3. Arquitectura y entornos

```
SAP B1 HANA (FASA y FGI)  +  app de costeo de maquila (MS SQL, en sitio)
   │  dlt (Python): extracción actual, en el escritorio remoto del proveedor de SAP (entorno hub_env)
   │  Polytomic: en evaluación (prueba sin costo de 7 días con el conector SAP B1 HANA que desarrollarán)
   ▼
BigQuery  ← único almacén (Railway queda retirado)
           datasets de desarrollo (dev) y de producción (prod) separados
   │
   ▼
dbt Core (SQL + YAML) en Git  ← aquí vive toda la lógica
   │
   └──► Lightdash: Dashboard de Rentabilidad, Weekly, estados financieros (meta 8 de enero)
        y después el Hub operativo y de planeación
```

Reglas de entorno:

- **Un solo almacén: BigQuery.** Desarrollo y producción viven en datasets separados (dbt targets `dev` y `prod`); nadie toma decisiones con datos de `dev`.
- **Costos de BigQuery:** presupuesto con alertas activas y un dueño claro del pago (si no se paga, se apaga).
- Lightdash se conecta a BigQuery con una **cuenta de servicio de solo lectura**, limitada al dataset de producción. Los permisos por usuario (entidad, área) se manejan en Lightdash con grupos y filtros por fila.
- Toda conexión cifrada; credenciales fuera del código.

---

## 4. Convenciones

### 4.1 Capas y nombres

| Capa | Esquema | Modelos | Ejemplo |
|---|---|---|---|
| Cruda | `raw_sap_fasa`, `raw_sap_fgi` | Tablas tal cual las trae dlt | `oinv`, `inv1` |
| Limpieza | `staging` | `stg_<source>__<concept>` | `stg_sap__sales_invoices` (une FASA y FGI con columna `entity`) |
| Intermedia | `intermediate` | `int_<concept>` | `int_pallet_cost` |
| Final | `marts` | `fct_` (hechos), `dim_` (catálogos) | `fct_sale_margin`, `dim_customer` |
| Referencia | `ref` | Tablas que mantienen Finanzas, Calidad o el equipo | `ref_account_mapping` |

**Patrón:** hechos y dimensiones separados por dentro (staging e intermediate); **tablas anchas** hacia afuera (marts), con todo ya unido, para que los directores y el agente de IA de Lightdash pregunten sin pensar en uniones. Las métricas se declaran en el `meta` de los `.yml` para que Lightdash las lea.

### 4.2 Columnas

- Nombres técnicos **en inglés**, minúsculas con guion bajo.
- Sufijos: `_usd`, `_mxn`, `_boxes`, `_kg`, `_id`, `_date`. Booleanos con `is_`.
- Columna de entidad: `entity` (`FASA`, `FGI`, `ELIM`).
- Valores que ve el usuario, en dos columnas: `category_es`, `category_en`.

### 4.3 Descripciones bilingües (obligatorio)

```yaml
- name: gross_margin_usd
  description: >
    Gross margin in USD: net sales minus all direct costs. Also called gross profit.
    Margen bruto en USD: ventas netas menos todos los costos directos. También llamado utilidad bruta.
```

Las descripciones copian los nombres que usan los directores, con sinónimos. De eso depende que la IA responda bien.

### 4.4 Nombres de columnas de dlt

dlt convierte los nombres de SAP a minúsculas con guion bajo: `DocNum` → `doc_num`, `U_FolioFronterra` → `u_folio_fronterra`. Verifica los nombres reales en BigQuery antes de escribir modelos.

---

## 5. Tablas de SAP a replicar con dlt

Para **FASA y FGI** (cada entidad con su propio usuario de solo lectura):

| Tabla | Contenido | Estrategia de carga |
|---|---|---|
| `OINV`, `INV1` | Facturas de venta (encabezado y líneas) | Incremental con ventana de días |
| `ORIN`, `RIN1` | Notas de crédito | Incremental con ventana |
| `ORDR`, `RDR1` | Órdenes de venta | Incremental con ventana |
| `ODLN`, `DLN1` | Entregas | Incremental con ventana |
| `OPOR`, `POR1` | Pedidos de compra (incluye fruta: huerta, SAGARPA, productor, lote) | Incremental con ventana |
| `OPDN`, `PDN1` | Entradas de mercancía de compra (fruta por categoría y calibre) | Incremental con ventana |
| `OPCH`, `PCH1` | Facturas de proveedor (servicios de corte, flete, aduanas...) | Incremental con ventana |
| `OIGE`, `IGE1` | Salidas de mercancía (consumo de fabricación) | Incremental con ventana |
| `OIGN`, `IGN1` | Entradas de mercancía (producto terminado) | Incremental con ventana |
| `OBTN` | Maestro de lotes (números de pallet) | Recarga completa diaria |
| `OITL`, `ITL1` | Bitácora de movimientos por lote | Incremental |
| `JDT1`, `OJDT` | Asientos contables | Incremental con ventana |
| `OACT` | Catálogo de cuentas | Recarga completa diaria |
| `OITM`, `OITW`, `OWHS` | Artículos, existencias por almacén, almacenes | Recarga completa diaria |
| `OCRD`, `OCRG` | Socios de negocio y sus grupos | Recarga completa diaria |
| `NNM1` | Series de numeración | Recarga completa diaria |
| `OPRJ` | Proyectos | Recarga completa diaria |
| `ORTT` | Tipos de cambio (actualizados por n8n desde Banxico) | Recarga completa diaria |
| `ORCT`, `RCT2` | Cobros de clientes y facturas a las que se aplican | Incremental con ventana |
| `CRD1` | Direcciones de socios de negocio (país de envío) | Recarga completa diaria |
| `INV12` | Direcciones de cada factura de venta (país de envío del documento) | Incremental con ventana |
| Base de datos de la herramienta de costo de maquila (MS SQL, fuera de SAP) | Costo estimado de maquila por pallet embarcado (incluye reempaques), con su orden de venta | Servidor local en sitio: **no es alcanzable desde el escritorio remoto del proveedor de SAP**. Se carga con una segunda instancia de dlt en una máquina de la oficina, que escribe directo a la base de desarrollo o a BigQuery |

**Notas de carga:**

- SAP guarda a veces solo la fecha de actualización (sin hora): recarga los últimos días en cada corrida y fusiona por llave primaria.
- Las cargas incrementales no detectan registros borrados: recarga completa periódica de las tablas donde ocurra.
- **Fotos diarias:** guardar cada día una copia de `OITW` (inventarios) y de los saldos abiertos de CxP y CxC, con su fecha. **Activarlas ya**: la historia empieza el día que se activan.

---

## 6. Reglas de negocio (validadas con datos reales)

Implementar exactamente así. Cada regla con su prueba.

| # | Regla | Detalle técnico |
|---|---|---|
| 1 | Una fabricación = una salida + una entrada | `OIGE` (consumo) y `OIGN` (producto terminado). Cada entrada corresponde a un pallet: 70,394 de 70,407. Las 13 excepciones son errores manuales → `ref_known_exceptions` |
| 2 | Costo por pallet | El costo de la salida se reparte entre los pallets de su entrada **por cajas**. Prueba: suma repartida = costo total de la salida |
| 3 | Unir salida y entrada | Por el **DocEntry** de la salida guardado en un campo de la entrada. Nunca por DocNum (se repite entre series) |
| 4 | Costo de cada línea de la salida | Línea de `JDT1` con `line_id = line_num * 2 + 1` en la cuenta `100-001-007-002`. Prueba: la cuenta y el monto deben cuadrar con la línea de la salida |
| 5 | Qué es producción | `ref2` **numérico** = primera corrida de empaque (fruta → producto terminado). `ref2` con `R` = reempaque final (fruta devuelta → producto terminado nuevo). Ambos son producción. `ref2` con `M` = reversión de reempaque (producto terminado → fruta), no es producción. Excluir correcciones: comentario "ENTRADA POR ERROR DE BOT n8n" (también llevan `ref2` numérico) y documentos sin `ref2` |
| 6 | Sitio del pallet | Prefijo del pallet: `ST` San Tadeo, `SL` San Lorenzo, `TN` Tanim (desde que se implemente). Pallets sin prefijo: por el rango del lote (1–9999 San Tadeo, 10000–29999 San Lorenzo, 30000+ Tanim). Ningún pallet de FASA empieza con `OC` |
| 7 | Llave del lote | Sitio + número (por ejemplo, `TN-30020`). Nunca el número solo |
| 8 | Lote en las salidas | `u_num_lote`; si está vacío, extraer de `comments` con el patrón `Lote: (\d+)` |
| 9 | Corte y acarreo | Artículo `CV-SRV-007`. Lote en `u_num_lote` del **encabezado** de `OPCH`. Tipo por grupo del proveedor: nombre contiene `COSECHA` = corte, `ACARREO` = acarreo |
| 10 | Limpieza del lote capturado a mano | Quitar prefijos `L` y `SL` y ceros a la izquierda. Rechazar valores que empiezan con `O.C.`, `C.C.`, `S.F.`. Si trae dos lotes (`L5560/5569`), separar y repartir el monto |
| 11 | Costo no asignado | Lo que no encuentra su lote o su venta va a una bolsa por mes y tipo, repartida entre las cajas del mes. El total siempre cuadra con contabilidad |
| 12 | Moneda | FASA en pesos. Convertir a dólares con `ORTT` de la fecha del documento. Fines de semana y festivos: último tipo de cambio disponible. Prueba: no debe faltar ningún día |
| 13 | Fecha de corte única | **Todo el Hub empieza el 1 de junio de 2026:** margen por venta, trazabilidad, Weekly y estado de resultados. Antes de esa fecha la contabilidad no cuadra y los flujos de n8n eran distintos; esa historia queda fuera del modelo y se atiende caso por caso fuera del Hub |
| 14 | Devoluciones de fruta a materia prima | Se identifican **solo por patrones conocidos** (lista cerrada), nunca por exclusión: (a) `ref2` `M14_` o comentario "Reversión PT a MP" (flujo anterior, devuelve a `MP-00200`, hasta el 12 oct 2026); (b) comentario "Entrada MP Reempaque N \| Lote ..." y (c) comentario "Reingreso MP - Salida #N", que revierte esa salida específica (flujo nuevo desde el 13 oct 2026, devuelven al artículo original con su lote); (d) comentario "ENTRADA POR ERROR DE BOT n8n": corrige salidas que el bot hizo por error (excepción). Las entradas sin comentario son correcciones manuales: no se clasifican solas, se alertan para revisión. Las primeras corridas de empaque no llevan `M` ni `R` y **no** son devoluciones |
| 15 | Kilos netos | Kilos Run = kilos de fruta consumidos en fabricaciones − kilos devueltos (regla 14). La misma regla funciona antes y después del cambio de flujo. Con "Reingreso MP - Salida #N", la salida referida se marca como revertida y sus pallets como `is_reversed` (se excluyen de inventario y de totales de costo) |
| 16 | Kilos reales, no peso del producto | El peso en la descripción del producto terminado no es confiable (algunos artículos "28 KG" se registran como 1 kg y pueden traer de 2 a 28 kg). Los kilos de un pallet son la fruta consumida en sus fabricaciones. Kilos Sold sigue la cadena pallet → venta |
| 17 | Fechas de contabilización atrasadas | Hay documentos creados después con fecha de contabilización anterior (por ejemplo, entradas con número alto y fecha de días previos). Las cargas incrementales usan la fecha de actualización, nunca la fecha del documento |
| 18 | Granularidad semanal | Todos los tableros funcionan por **semana** y por mes. `dim_date` lleva semana (inicio y fin, número de semana y año de la semana) con la convención **Semana Fronterra: de domingo a sábado** con numeración **gregoriana**: la SEM 1 es la que contiene el 1 de enero, aunque sea parcial (en 2026, del jueves 1 al sábado 3 de enero; la SEM 2 empieza el domingo 4), equivalente a `WEEKNUM(fecha, 1)` de Excel. Se muestra como "SEM 34". Por confirmar con un ejemplo contra el Weekly actual. Las semanas salen siempre de `dim_date`, nunca de funciones de fecha de la base de datos. La semana se calcula con costos operativos (fabricación, servicios, maquila estimada); el cuadre exacto contra contabilidad es mensual, porque contabilidad cierra por mes |
| 19 | Costo de maquila estimado | El costo de maquila se calcula en una herramienta externa a SAP (MS SQL), **por pallet embarcado, incluyendo reempaques**, porque las facturas de maquila (`CV-SRV-005`, `015`, `016`) llegan a destiempo. Se une a SAP por número de pallet y orden de venta. dlt replica esa base de datos. Regla: mientras no llega la factura, se usa el estimado por pallet de la herramienta, con `is_estimated = true`. Cada factura de maquila trae en sus **comentarios del encabezado** (`OPCH.comments`, copiados del pedido) un texto como `Costeo de Maquilas - COS-001033 (OC1070, OC1089) - 05/11/2026`. La llave es el **folio de costeo `COS-######`**, que es el identificador del cálculo en la app de costeo (MS SQL), **con el mismo formato en ambos sistemas** (unión directa); la app sabe qué pallets y órdenes de venta cubre cada costeo. Un costeo puede cubrir más de una orden (por ejemplo, `OC1070, OC1089`). Extraer con `COS-([0-9]+)` y, para las órdenes, todas las coincidencias de `OC\s*([0-9]+)` (o `PO` tras la migración). Conciliación por costeo: costo real de cada pallet = estimado del pallet × (total facturado del costeo ÷ suma de estimados de los pallets del costeo). Se registra la diferencia entre estimado y factura (precisión del estimado por sitio y por mes). **Cobertura medida:** octubre y noviembre 2026, 100% de las facturas de maquila traen folio COS y OC. Junio (5 facturas, 1.98 M MXN) y septiembre (1 factura) no lo traen y no hay facturas en julio ni agosto: la app de costeo empezó a usarse en octubre 2026. **Para junio–septiembre** la maquila se pagaba **por caja empacada**: costo de maquila del pallet = cajas del pallet × tarifa por caja de su maquila, tomada de `ref_copack_rates` (maquila, vigencia desde/hasta, tarifa, moneda; por presentación si aplica; incluye si el reempaque se cobraba). Prueba: la suma mensual del cálculo por tarifa debe cuadrar con el costo contable de maquila del mes; la diferencia se reporta |

---

## 7. Fletes y aduanas: traductor de `u_folio_fronterra`

Artículos: `CV-SRV-001` aduanas, `CV-SRV-002` flete nacional, `CV-SRV-003` flete extranjero. La factura del proveedor (`OPCH`) dice a qué venta pertenece en `u_folio_fronterra`, pero el formato cambió con el tiempo:

| Formato | Ejemplo | Cómo encontrar la venta |
|---|---|---|
| `FACL-` y variantes con errores de dedo (`FACL`, `ACL-`, `FAL-`, `FACÑ-`, `FACLL`, `QFACL-`, `FAC`) | `FACL-1769` | Factura de venta (`OINV`) cuya serie (`NNM1.series_name`) es `FACL` y cuyo `doc_num` es el número capturado. Una factura = una venta |
| `F` + número (enero a mayo) | `F7237` | Mismo valor en `u_folio_fronterra` de la orden, entrega o factura de venta |
| `FR` + número (enero a junio) | `FR6245` | Sistema anterior a SAP: no se resuelve; va a totales del mes |
| `PO` + número | `PO1431` | Orden de compra de FGI con ese `doc_num` (lo graba la automatización FGI → FASA) |
| `OC`, `SO` (mayo) | `OC1321` | Orden de compra de FGI o pedido de venta |
| Cualquier otro | `T`, `G`, `CCE-` | Bolsa de costo no asignado |

Prueba: alertar cuando aparezca un formato nuevo sin regla.

```sql
-- Regla FACL (referencia en SQL de HANA)
LEFT JOIN (SELECT I."DocEntry", TO_VARCHAR(I."DocNum") AS "Num"
           FROM OINV I
           INNER JOIN NNM1 N ON I."Series" = N."Series"
           WHERE N."SeriesName" = 'FACL' AND I."CANCELED" = 'N') V
  ON V."Num" = REPLACE_REGEXPR('[^0-9]' IN T0."U_FolioFronterra" WITH '')
```

---

## 8. FASA + FGI en un solo reporte (consolidado)

**El problema:** FASA le vende fruta a FGI, y FGI se la vende al cliente. Si sumamos FASA + FGI, la misma fruta se cuenta como venta dos veces.

**La solución:** agregar filas con `entity = 'ELIM'` que restan la venta de FASA a FGI (y la compra correspondiente de FGI). Así:

| Vista | Filtro |
|---|---|
| Solo FASA | `entity = 'FASA'` |
| Solo FGI | `entity = 'FGI'` |
| Consolidado | Las tres entidades sumadas |

Ejemplo: FASA vende a FGI en 80; FGI vende al cliente en 100.

| | FASA | FGI | ELIM | Consolidado |
|---|---|---|---|---|
| Ventas | 80 | 100 | −80 | 100 |
| Costos | 60 | 90 | −80 | 70 |
| Margen | 20 | 10 | 0 | 30 |

**Ventas a FGI:** son las de FASA cuyo cliente es "FRONTERRA GROUP INC".

**Catálogos de cuentas:** FASA y FGI tienen catálogos distintos. `ref_account_mapping` (la mantiene Finanzas) lleva cada cuenta a una línea común del estado de resultados. **Bloqueo:** sin esa tabla no se puede armar el consolidado por mes.

---

## 8.1 Los cuatro estados financieros (roca 1)

Objetivo: estado de situación financiera (balance general), estado de resultados, estado de flujos de efectivo y estado de variaciones en el capital contable, por entidad y consolidados.

**Modelo base: la balanza de comprobación** (`fct_trial_balance`): por cuenta, mes y entidad, saldo inicial, cargos, abonos y saldo final, desde `JDT1` + `OACT`. Los cuatro estados salen de ella:

| Estado | Cuentas (`OACT.group_mask`) | Cómo se calcula |
|---|---|---|
| Estado de resultados | 4 a 8 | Movimiento del periodo. Excluir asientos de cierre de ejercicio (`trans_type = -3`). Es la vista del partner `XBXP_DASHBOARD_EDORESULTADOS`, con signos corregidos |
| Balance general | 1 a 3 (activo, pasivo, capital) | **Saldo acumulado** a la fecha, no movimiento del periodo. Incluye asientos de cierre |
| Flujo de efectivo | Todas | Método indirecto: resultado del periodo + partidas que no son efectivo + cambios en capital de trabajo, inversión y financiamiento. Requiere `ref_cashflow_mapping` (Finanzas): cada cuenta → actividad de operación, inversión o financiamiento |
| Variaciones en el capital contable | 3 | Movimientos de las cuentas de capital por concepto (aportaciones, resultado del ejercicio, dividendos, reservas). Requiere `ref_equity_mapping` (Finanzas) |

**Fecha de corte y saldos iniciales:** el balance general necesita saldos acumulados, que incluyen movimientos anteriores a junio de 2026. Regla: tomar como saldo inicial de cada cuenta el saldo al 31 de mayo de 2026 **validado por Finanzas**, y a partir de ahí acumular solo movimientos desde el 1 de junio. Prueba: la balanza de dbt cuadra con la balanza de SAP cada mes.

**FGI y consolidado:** el catálogo de FGI se mapea con `ref_account_mapping` a la misma estructura. **Conversión de moneda (decide Finanzas):** FASA registra en pesos y FGI en dólares. Los estados consolidados suelen convertir el balance al tipo de cambio de cierre, los resultados al tipo de cambio promedio y el capital al histórico, con la diferencia en un efecto por conversión dentro del capital. Las columnas en dólares de SAP (`sys_debit`, `sys_credit`) convierten cada asiento a su tipo de cambio del día, que sirve para resultados pero no necesariamente para el balance consolidado. No implementar la conversión del balance hasta que Finanzas defina el método. El consolidado elimina, además de ventas y compras intercompañía, los **saldos** intercompañía del balance (cuentas por cobrar de FASA contra cuentas por pagar de FGI, y cualquier préstamo o inversión entre ellas).

## 9. Puente FASA → FGI por pallet

FASA manda a FGI tráileres de unos 20 pallets, y FGI los reparte en varias ventas. **La llave entre FASA y FGI es el número de pallet**, no la orden.

```
Lote → pallet → entrega de FASA → entrada (GRPO) de FGI → entrega de FGI al cliente
```

- Desde el arranque de la automatización FGI → FASA, el pallet conserva el mismo número en ambos SAP. Los códigos de artículo son idénticos en FASA y FGI.
- **Antes de esa fecha:** el costo de cada tráiler se reparte entre las ventas de FGI por cajas (aproximación; el tablero lo indica).
- **Fruta de terceros en FGI:** lotes que empiezan con `OC` = fruta comprada a otro proveedor. Columna `fruit_source = 'third_party'`; su costo es el precio de compra de FGI; no genera eliminaciones.
- Edad de la fruta en EE.UU.: columna *Packing Date* en la entrada de FGI.

**Validación del puente:** los números de pallet deben aparecer idénticos en la entrega de FASA, la entrada de FGI y la entrega de FGI al cliente (consultas por `OBTN` + `ITL1` + `OITL` con `doc_type` 15 y 20).

---

## 10. Modelos a construir, en orden

### Fase A: FASA, margen por venta (empezar ya)

| # | Modelo | Grano | Entradas | Prueba clave |
|---|---|---|---|---|
| A1 | `stg_sap__*` | Una fila por línea de documento | Tablas crudas | Llaves únicas con entidad |
| A2 | `int_pallet_cost` | Pallet × categoría de costo (fruta, empaque) | Reglas 1 a 5 | Suma repartida = costo de la salida |
| A3 | `int_service_costs_lot` | Factura de servicio × lote | Reglas 9 y 10 | % del monto asignado a un lote válido |
| A4 | `int_service_costs_sale` | Factura de servicio × venta | Sección 7 | % del monto asignado a una venta |
| A5 | `fct_sales`, `fct_credit_notes` | Línea de factura o de nota de crédito | `OINV`, `INV1`, `ORIN`, `RIN1` | Cuadre mensual contra contabilidad |
| A6 | `fct_sale_margin` (tabla ancha) | Venta | A2 a A5 + bolsa de no asignado | Suma de costos asignados = costo contable del mes |
| A7 | `fct_pnl_monthly` | Cuenta × mes × entidad | `JDT1`, `OACT`, `OJDT` | Cuadra mes por mes con la vista del partner `XBXP_DASHBOARD_EDORESULTADOS` |

Notas para A7, partiendo de la vista del partner:

- Usar un solo signo: crédito − débito (ingresos positivos, costos negativos). La vista mezcla signos entre pesos y dólares.
- Excluir los asientos de cierre de año (`trans_type = -3`).
- Agregar las columnas que unen cada línea con su documento: `trans_type`, `base_ref`, `created_by`, `short_name`, `line_id`.

### Fase B: FGI y consolidado

| # | Modelo | Bloqueo |
|---|---|---|
| B1 | Mismos modelos para FGI | Usuario de solo lectura para FGI |
| B2 | `int_eliminations` | Identificar ventas intercompañía |
| B3 | `fct_pnl_monthly` consolidado | `ref_account_mapping` de Finanzas |
| B4 | Margen consolidado por venta | Puente por pallet (sección 9) |

### Fase C: Weekly Report y trazabilidad

| # | Modelo | Nota |
|---|---|---|
| C1 | Modelos de los 15 indicadores del Weekly | Sección 11 |
| C2 | `fct_traceability` | Sección 12 |

---

## 11. Weekly Report: cómo se calcula cada indicador

| Indicador | Cálculo | Estado |
|---|---|---|
| Sales (USD) | Suma de facturas − notas de crédito, en dólares | Listo |
| Gross Margin | Del estado de resultados; por venta donde esté completo | Listo |
| Kilos Purchased | Kilos en las entradas de compra de fruta (`OPDN`) | Listo |
| Kilos Run | Kilos de fruta consumidos en fabricaciones − kilos devueltos por reversiones (reglas 14 y 15), por sitio | Listo |
| Kilos Run – Co-pack | Lo mismo, solo San Lorenzo y Tanim | Listo |
| Kilos Sold | Kilos de fruta de los pallets vendidos, siguiendo la cadena pallet → venta (regla 16) | Listo con el query del Anexo A |
| Fruit Inventory San Tadeo (Kg) | Existencias de fruta en almacenes de San Tadeo | Requiere foto diaria |
| Fruit Inventory USA (Kg) | Existencias en almacenes Envision y Fresh House del SAP de FGI | Requiere foto diaria |
| Supplies Inventory (USD) | Valor de inventario de materiales de empaque | Requiere foto diaria |
| Pack-out % | Kilos de categorías de exportación ÷ kilos totales del lote (de `OPDN`) | Falta `ref_category_market` |
| Merma real % | Kilos de desecho ÷ kilos totales del lote | Falta `ref_category_market` |
| Total Accounts Payable (USD) | Saldo abierto con proveedores | Requiere foto diaria |
| Accounts Payable – Days | CxP ÷ costo de ventas × días del periodo | Fórmula por confirmar |
| Accounts Receivable – USD | Saldo abierto de clientes | Requiere foto diaria |
| AR – % Collected | De las facturas de clientes cuyo vencimiento cae en la semana: importe cobrado al cierre de la semana ÷ importe que vencía. Facturas (`OINV`) por fecha de vencimiento y cobros aplicados (`ORCT`, `RCT2`) | Definición confirmada |
| OTIF | — | Fuera de la Fase 1 |

**Importante sobre las compras de fruta:** el pedido y la entrada de fruta se crean **después** de la selección, así que ya traen kilos, calibres, categorías y precios reales por lote.

---

## 12. Trazabilidad (roca 3)

Misma cadena que el margen:

```
Pedido de fruta (OPOR: u_huerta, u_cod_sagarpa, u_productor, u_num_lote)
  → lote → fabricación → pallet → entrega FASA → entrada FGI → venta FGI
```

- Calidad medida: 100% de los pedidos de fruta de junio a noviembre traen huerta, SAGARPA y productor, y su lote existe en fabricación.
- Debe responder en ambas direcciones: venta → huerta, y huerta → clientes.
- Prueba de la roca: 20 ventas rastreadas a su huerta en menos de 10 minutos cada una; 5 huertas rastreadas a sus clientes en menos de 15 minutos.
- **Programa de destino de la fruta:** en operación normal, los tres sitios trabajan fruta para Estados Unidos y para Canadá. (En las semanas atípicas de la huelga de productores de octubre–noviembre 2026, San Tadeo y San Lorenzo compraron para Canadá y Tanim solo para Estados Unidos.) El programa es un atributo del lote, no del sitio: las comparaciones de costo se hacen por programa. Por definir de dónde sale el programa de cada lote (campo en la compra o elegibilidad de la huerta). El mercado de cada venta sale de la venta (cliente y producto), nunca del sitio, porque San Tadeo y San Lorenzo también empacan productos para Estados Unidos.
- **Prueba de elegibilidad (por validar con Calidad):** todo pallet vendido a Estados Unidos debe venir de lotes de huertas elegibles para ese mercado. Requiere `ref_orchard_eligibility` (código SAGARPA, mercados autorizados, vigencia), mantenida por Calidad.
- **Orgánico:** hoy solo está en la descripción del producto terminado (regla temporal: deducirlo de la descripción). Se agregará `ref_organic_orchards` (huertas certificadas, de Calidad). Prueba de segregación: todo pallet orgánico viene de lotes de huertas orgánicas.

---

## 13. Pruebas obligatorias

| Prueba | Qué verifica |
|---|---|
| Llaves únicas | Ninguna fila duplicada en hechos y dimensiones |
| Reparto de pallets | Suma repartida = costo total de cada salida |
| Cuadre con contabilidad | Ventas y costos mensuales = cuentas contables del mes |
| Cuadre con la vista del partner | Estado de resultados de dbt = `XBXP_DASHBOARD_EDORESULTADOS` |
| Tipo de cambio | Ningún día sin tipo de cambio |
| Formatos de folio | Ningún formato nuevo sin regla |
| Rangos de lote | Ningún sitio cerca del límite de su rango |
| Excepciones conocidas | No aparecen fabricaciones con varios pallets fuera de la lista |
| Descripciones | Ninguna tabla o columna de `marts` sin descripción bilingüe |

---

## 14. Bloqueos y a quién preguntar

| Pendiente | Quién lo resuelve |
|---|---|
| `ref_account_mapping` (catálogo de cuentas común FASA + FGI) | Finanzas |
| `ref_cashflow_mapping` (cuenta → operación, inversión o financiamiento) y `ref_equity_mapping` (conceptos de capital) | Finanzas |
| Saldos iniciales al 31 de mayo de 2026 validados | Finanzas |
| Método de conversión de moneda para los estados consolidados | Finanzas |
| `ref_category_market` (categorías de fruta por mercado): se deriva de la descripción del artículo de fruta (`EXP` = exportación, `NAL` = nacional, `DESECHO` = merma); solo confirmar la regla una vez | Sourcing o Calidad |
| `ref_organic_orchards` (huertas orgánicas certificadas) | Calidad |
| `ref_orchard_eligibility` (huertas autorizadas por mercado: EE.UU., Canadá) | Calidad |
| Definición de AR – % Collected | Omar con el CEO |
| Prefijo de sitio en pallets | Equipo (implementación en curso) |
| Reintentos, cancelaciones y alertas de la automatización FGI → FASA | Equipo, con Omar |
| Validación de la prueba de trazabilidad | Omar con Calidad e inocuidad |
| Confirmar con un ejemplo que la numeración gregoriana coincide con el Weekly actual | Omar con Finanzas |
| Tarifas por caja de cada maquila de junio a septiembre (`ref_copack_rates`) | Finanzas |
| Máquina en sitio para la segunda instancia de dlt; que la app de costeo guarde el folio COS en un campo estructurado de SAP (hoy viaja en comentarios) | Omar con el equipo |

---

### 14.1 Tarea: corregir el país en el maestro de socios de negocio

**Dónde:** SAP Business One → Socios de negocios → **Datos maestros de socios de negocio** → buscar el cliente → ficha **Direcciones** → sección **Enviar a** (dirección de entrega) → campo **País**. Corregir también **Facturar a** si está vacío o en `XX`. Tabla en SAP: `CRD1`, campo `Country`, con `AdresType = 'S'` (enviar a) y `'B'` (facturar a).

| Entidad | Código | Cliente | País correcto | Nota |
|---|---|---|---|---|
| FASA | CN-00022 | Angel Jesús Pérez Moreno | MX | 108,294 USD desde junio |
| FASA | CN-00024 | Edgar Guillermo Ramírez Vélez | MX | 13,272 USD desde junio |
| FASA | CN-00007 | Público en general | MX | |
| FASA | CN-00027 | A.N.A. Compañía de Seguros | MX | Además, Finanzas decide si sus facturas son ventas o siniestros |
| FGI | CLD-00039 | U.S. Food and Drug Administration | US | Finanzas decide si es venta |
| FGI | CLD-00048 | Sotolongo Farms, LLC. | US | Sin ventas desde junio |

Opcional: los clientes de FASA con `XX` o vacío sin ventas desde junio (CN-00014, CN-00015, CN-00016, CN-00017, CN-00018, CN-00019, CN-00020, CN-00021, PRO-00501).

**Pendiente para Finanzas:** decidir si las facturas a aseguradoras (A.N.A., Qualitas) y a la FDA son ventas o cobros de otro tipo. Si no son ventas, se excluyen del margen por venta y se ven solo en el estado de resultados.

## 15. Lo que NO hay que hacer

- Calcular un indicador dentro del tablero o de Lightdash: va en dbt.
- Unir documentos por `DocNum`: usar `DocEntry`.
- Usar el número de lote sin su sitio.
- Corregir documentos en SAP para que "cuadre" el modelo: se documenta la excepción.
- Tomar decisiones con datos del dataset de desarrollo.
- Escribir credenciales en el código o en Git.
- Cambiar una regla de esta guía sin avisar a Omar.
- En SQL de HANA, agrupar por posición (`GROUP BY 1, 2`): HANA no lo acepta. Agrupar por nombre de columna o desde una subconsulta.

---

## 16. Decisiones de plataforma vigentes

| Pieza | Decisión | Notas |
|---|---|---|
| Extracción | **dlt** (actual, funcionando) | Polytomic se evalúa por facilidad de uso: no tiene conector a SAP B1 HANA y lo desarrollará con Fronterra; prueba sin costo de 7 días |
| Almacén | **BigQuery** (único, ya operando) | Datasets de desarrollo y producción separados |
| Modelo | **dbt** en GitHub | Toda la lógica, métricas y descripciones bilingües |
| Visualización e IA | **Lightdash, todo** | Dashboard de Rentabilidad, Weekly y estados financieros para el 8 de enero; después el Hub. Se descartan los tableros directivos fuera de Lightdash |

**Prueba de Lightdash (21 días, extensible):** la prueba empieza al conectar y compilar el proyecto dbt. Para que cubra la evaluación del 8 de enero, acordar con Lightdash la extensión **antes** de arrancarla, o arrancarla cuando los primeros modelos estén listos (a más tardar en SEM 49) y pedir la extensión por escrito. Confirmar también: inicio de sesión con correo corporativo (SSO de Microsoft es complemento en Pro) y uso del agente de IA con la llave propia de la API de Claude.

**Criterios para la prueba de 7 días de Polytomic** (decidir con evidencia, no por gusto):

| Criterio | Qué comprobar |
|---|---|
| Cobertura | Lee todas las tablas de la guía en FASA y FGI, incluidos los campos de usuario (`U_...`) |
| Incremental correcto | Carga por fecha de actualización y no pierde documentos con fecha de contabilización atrasada (regla 17) |
| Conectividad | Cómo llega a HANA: el proveedor de SAP exige VPN para acceso externo (con costo), probablemente vía el Barracuda |
| Nombres de tablas y columnas | Si difieren de los de dlt, el cambio solo debe tocar la capa de limpieza (staging), nunca los modelos de negocio |
| Costo y soporte | Precio anual y tiempo de respuesta ante fallas |
| Comparación | Mismo resultado que dlt en los cuadres contra contabilidad |

## Anexo A. Query de costo atómico y trazabilidad por pallet (SAP HANA, FASA)

Base de los modelos `int_pallet_cost` y `fct_traceability`. Para cada pallet de producto terminado: qué fruta e insumos consumió, cuánto costaron (repartidos por cajas), de qué lote, huerta, código SAGARPA y productor viene, y en qué sitio se empacó.

**Moneda:** confirmado. En FASA la moneda local es MXP y la de sistema es USD, así que `SYSDeb` y `SYSCred` ya están en dólares, convertidos por SAP con el tipo de cambio de la fecha de cada asiento (el que n8n carga desde Banxico). Regla: para ventas y costos de FASA en dólares, usar siempre las columnas de moneda de sistema de SAP, para que el modelo cuadre con la contabilidad.

**Validación:** por cada salida, la suma de `Costo_Asignado_MXN` debe ser igual a la suma de `Costo_MXN` de esa salida.

**Resultado de la validación, universo completo (29 oct – 11 nov 2026; primeras corridas y reempaques):**
- Fórmula del Line_ID contra el débito total a producción en proceso: 2,248 salidas, diferencia de cero en todas (21,237,509.73 MXN de ambos lados).
- Costo repartido a pallets contra costo de la fórmula: 2,248 salidas, cuadre al centavo en los tres sitios (San Lorenzo 1,105,745.61; San Tadeo 2,582,348.24; Tanim 17,549,415.88 MXN). Ninguna salida falta de un lado ni del otro.
- 1,066 pallets y 141 lotes; sin campos vacíos, sin duplicados, una salida = una entrada = un pallet por fabricación.
- Dos salidas tienen una línea sin asiento contable, sin diferencia de costo: son líneas de valor cero que SAP no contabiliza. No requieren acción.
- El reempaque (`ref2` con `R`) representa el 20% del costo del periodo; las primeras corridas, el 80%.
- Hallazgos abiertos: costo por kilo de la misma fruta muy distinto entre Tanim y los otros sitios: **resuelto**, la diferencia viene del precio de compra (en Tanim la fruta se compra cerca del doble por kilo) y el costo de fabricación coincide con el precio de compra en los tres sitios, así que la valuación del inventario es correcta (explicación: semanas atípicas por la huelga de productores, en las que San Tadeo y San Lorenzo compraron fruta para Canadá, más barata, y Tanim solo para Estados Unidos); material de empaque de San Lorenzo ausente antes de la corrección del flujo de n8n (fecha de corrección por confirmar).

```sql
WITH entradas AS (
    -- Pallets de producto terminado final y sus cajas
    SELECT T1."DocEntry"            AS "Entrada_Entry",
           T1."DocNum"              AS "Entrada_Mercancia",
           T1."DocDate"             AS "Fecha_Empaque",
           T1."U_U_SalidaDocEntry"  AS "Salida_Entry",
           T2."ItemCode"            AS "SKU_PT",
           T2."Dscription"          AS "Descripcion_PT",
           T0."DistNumber"          AS "Pallet_ID",
           TX."Quantity"            AS "Cajas_Pallet"
    FROM OBTN T0
    INNER JOIN ITL1 TX ON T0."AbsEntry" = TX."MdAbsEntry" AND T0."ItemCode" = TX."ItemCode"
    INNER JOIN OITL TY ON TX."LogEntry" = TY."LogEntry" AND TY."DocType" = 59
    INNER JOIN OIGN T1 ON TY."DocEntry" = T1."DocEntry"
    INNER JOIN IGN1 T2 ON T1."DocEntry" = T2."DocEntry" AND TY."DocLine" = T2."LineNum"
    WHERE T1."CANCELED" = 'N'
      AND (T1."Ref2" LIKE 'R%' OR T1."Ref2" LIKE_REGEXPR '^[0-9]')   -- reempaque final o primera corrida
      AND T2."ItemCode" LIKE 'PT-%'
      AND IFNULL(T1."Comments", '') NOT LIKE 'ENTRADA POR ERROR%'
      AND T1."DocDate" >= '2026-06-01'
),
totales AS (
    -- Cajas totales de cada entrada, para repartir el costo
    SELECT "Entrada_Entry", SUM("Cajas_Pallet") AS "Cajas_Entrada"
    FROM entradas
    GROUP BY "Entrada_Entry"
),
consumos AS (
    -- Fruta e insumos consumidos por cada salida, con su costo real del asiento
    SELECT T6."DocEntry"  AS "Salida_Entry",
           T6."DocNum"    AS "Salida_Mercancia",
           LTRIM(COALESCE(NULLIF(T6."U_NumLote", ''),
                 SUBSTR_REGEXPR('Lote: ([0-9]+)' IN T6."Comments" GROUP 1)), '0') AS "Lote",
           T5."LineNum",
           T5."ItemCode"   AS "SKU_Insumo_MP",
           T5."Dscription" AS "Descripcion_Insumo_MP",
           G."ItmsGrpNam"  AS "Grupo_Insumo",
           T5."Quantity"   AS "Cantidad_Consumida",
           T4."Debit"      AS "Costo_MXN",
           T4."SYSDeb"     AS "Costo_USD"
    FROM OIGE T6
    INNER JOIN IGE1 T5 ON T6."DocEntry" = T5."DocEntry"
    INNER JOIN JDT1 T4 ON T6."TransId" = T4."TransId"
                      AND T4."Line_ID" = (T5."LineNum" * 2) + 1
                      AND T4."Account" = '100-001-007-002'
    LEFT JOIN OITM I ON T5."ItemCode" = I."ItemCode"
    LEFT JOIN OITB G ON I."ItmsGrpCod" = G."ItmsGrpCod"
    WHERE T6."CANCELED" = 'N'
      AND (T6."Ref2" LIKE 'R%' OR T6."Ref2" LIKE_REGEXPR '^[0-9]')   -- reempaque final o primera corrida
),
origen AS (
    -- Huerta, SAGARPA y productor del pedido de compra de cada lote
    SELECT * FROM (
        SELECT LTRIM(REPLACE_REGEXPR('[^0-9]' IN "U_NumLote" WITH ''), '0') AS "Lote",
               "DocNum"       AS "Pedido_Compra",
               "U_Huerta"     AS "Huerta",
               "U_CodSAGARPA" AS "Codigo_SAGARPA",
               "U_Productor"  AS "Productor",
               ROW_NUMBER() OVER (PARTITION BY LTRIM(REPLACE_REGEXPR('[^0-9]' IN "U_NumLote" WITH ''), '0')
                                  ORDER BY "DocEntry" DESC) AS "rn"
        FROM OPOR
        WHERE "CANCELED" = 'N' AND IFNULL("U_NumLote", '') <> ''
    ) WHERE "rn" = 1
)
SELECT
    E."Pallet_ID",
    CASE WHEN LEFT(E."Pallet_ID", 2) IN ('ST', 'SL', 'TN') THEN LEFT(E."Pallet_ID", 2)
         WHEN C."Lote" LIKE_REGEXPR '^[0-9]+$' AND TO_INTEGER(C."Lote") < 10000 THEN 'ST'
         WHEN C."Lote" LIKE_REGEXPR '^[0-9]+$' AND TO_INTEGER(C."Lote") < 30000 THEN 'SL'
         WHEN C."Lote" LIKE_REGEXPR '^[0-9]+$' THEN 'TN'
    END                                                    AS "Sitio",
    E."Fecha_Empaque",
    E."SKU_PT",
    E."Descripcion_PT",
    CASE WHEN UPPER(E."Descripcion_PT") LIKE '%ORG%' THEN 'Y' ELSE 'N' END AS "Es_Organico",  -- regla temporal
    E."Cajas_Pallet",
    C."Lote",
    O."Pedido_Compra",
    O."Huerta",
    O."Codigo_SAGARPA",
    O."Productor",
    C."SKU_Insumo_MP",
    C."Descripcion_Insumo_MP",
    C."Grupo_Insumo",
    C."Cantidad_Consumida" * E."Cajas_Pallet" / T."Cajas_Entrada" AS "Cantidad_Asignada",
    C."Costo_MXN"          * E."Cajas_Pallet" / T."Cajas_Entrada" AS "Costo_Asignado_MXN",
    C."Costo_USD"          * E."Cajas_Pallet" / T."Cajas_Entrada" AS "Costo_Asignado_USD",
    C."Salida_Mercancia",
    E."Entrada_Mercancia"
FROM entradas E
INNER JOIN totales  T ON E."Entrada_Entry" = T."Entrada_Entry"
INNER JOIN consumos C ON C."Salida_Entry"  = E."Salida_Entry"
LEFT  JOIN origen   O ON O."Lote"          = C."Lote"
ORDER BY C."Salida_Mercancia", C."LineNum", E."Pallet_ID"
```

**Al traducirlo a dbt:** nombres en inglés (`pallet_id`, `site`, `packing_date`, `lot_id`, `orchard`, `sagarpa_code`, `grower`, `allocated_cost_mxn`...), llave de lote con sitio (`TN-30020`), y la bandera orgánica tomada de `ref_organic_orchards` cuando exista.

---

## Anexo B. Estados financieros con dlt + dbt (sin vistas en SAP)

**Principio:** no se crean vistas en SAP. dlt replica las tablas contables crudas y toda la lógica vive en dbt. La vista del partner `XBXP_DASHBOARD_EDORESULTADOS` solo se usa como referencia de validación del estado de resultados.

### B.1 Tablas a replicar (FASA y FGI)

| Tabla | Contenido | Carga |
|---|---|---|
| `OACT` | Catálogo de cuentas (grupo, nivel, cuenta padre, afectable) | Recarga completa diaria |
| `JDT1` | Líneas de asiento (cuenta, fecha, debe, haber, importes en moneda de sistema, socio, proyecto, centro de costo) | Incremental por fecha de actualización, con ventana |
| `OJDT` | Encabezado de asiento (tipo de transacción, documento base) | Incremental por fecha de actualización, con ventana |
| `OPRJ` | Proyectos | Recarga completa diaria |
| `OOCR` | Centros de costo (si se usan) | Recarga completa diaria |
| `OFPR` | Periodos contables (inicio del ejercicio fiscal) | Recarga completa diaria |
| `OADM` | Moneda local y de sistema | Recarga completa diaria |
| `ORTT` | Tipos de cambio | Recarga completa diaria |

### B.2 Modelos dbt

| Capa | Modelo | Grano | Qué hace |
|---|---|---|---|
| staging | `stg_sap__accounts` | Cuenta × entidad | Une `OACT` de FASA y FGI con columna `entity` |
| staging | `stg_sap__journal_lines` | Línea de asiento × entidad | Une `JDT1` + `OJDT` de ambas entidades; llave `entity-trans_id-line_id` |
| intermediate | `int_account_hierarchy` | Cuenta × entidad | Niveles 1 a 5 del catálogo (misma lógica que la vista del partner) |
| intermediate | `int_general_ledger` | Línea de asiento | Libro mayor: líneas + jerarquía + `is_year_end_closing` + mes |
| marts | `fct_trial_balance` | Cuenta × mes × entidad | Saldo inicial, cargos, abonos y saldo final, desde junio 2026 |
| marts | `fct_income_statement_monthly` | Cuenta × mes × entidad | Estado de resultados (grupos 4 a 8, sin cierres) |
| marts | `fct_balance_sheet_monthly` | Cuenta × mes × entidad | Balance general (grupos 1 a 3, saldo acumulado) + resultado del ejercicio en curso |
| marts | `fct_equity_changes` | Concepto × mes × entidad | Variaciones en el capital (requiere `ref_equity_mapping`) |
| marts | `fct_cash_flow` | Actividad × mes × entidad | Flujo de efectivo indirecto (requiere `ref_cashflow_mapping`) |
| ref | `ref_opening_balances` | Cuenta × entidad | Saldos al 31 de mayo de 2026 validados por Finanzas |

### B.3 Código de referencia (BigQuery)

`models/staging/stg_sap__journal_lines.sql`

```sql
{% set entities = ['fasa', 'fgi'] %}

{% for e in entities %}
select
    '{{ e | upper }}'                                   as entity,
    l.trans_id,
    l.line_id,
    l.account                                           as account_code,
    cast(l.ref_date as date)                            as posting_date,
    h.trans_type,
    h.base_ref,
    l.short_name,
    l.contra_act,
    l.project                                           as project_code,
    l.profit_code                                       as cost_center,
    l.line_memo,
    l.debit,
    l.credit,
    l.debit - l.credit                                  as amount_local,   -- MXN en FASA, USD en FGI
    l.sys_deb - l.sys_cred                              as amount_usd      -- moneda de sistema (USD)
from {{ source('sap_' ~ e, 'jdt1') }} l
join {{ source('sap_' ~ e, 'ojdt') }} h on h.trans_id = l.trans_id
{% if not loop.last %}union all{% endif %}
{% endfor %}
```

`models/intermediate/int_general_ledger.sql`

```sql
select
    j.*,
    a.account_name,
    a.group_mask,
    a.level_1_group,
    a.level_2_title,
    a.level_3_subtitle,
    a.level_4_detail,
    {{ dbt.date_trunc('month', 'j.posting_date') }}     as posting_month,
    (j.trans_type = -3)                                 as is_year_end_closing
from {{ ref('stg_sap__journal_lines') }} j
join {{ ref('int_account_hierarchy') }} a
  on a.entity = j.entity and a.account_code = j.account_code
where a.is_postable
```

`models/marts/fct_income_statement_monthly.sql`

```sql
select
    entity,
    posting_month,
    group_mask,
    level_2_title,
    level_3_subtitle,
    account_code,
    account_name,
    -sum(amount_local)  as amount_local,   -- presentación: ingresos positivos
    -sum(amount_usd)    as amount_usd
from {{ ref('int_general_ledger') }}
where group_mask between 4 and 8
  and not is_year_end_closing
  and posting_date >= '2026-06-01'
group by 1, 2, 3, 4, 5, 6, 7
```

> Nota: en dbt sobre BigQuery, `group by 1, 2...` sí funciona. La restricción de agrupar por nombre aplica solo al SQL que se corre directo en HANA.

`models/marts/fct_trial_balance.sql`

```sql
with months as (
    select distinct month_start as posting_month
    from {{ ref('dim_date') }}
    where month_start between '2026-06-01' and {{ dbt.current_timestamp() }}
),
accounts as (
    select entity, account_code from {{ ref('int_account_hierarchy') }} where is_postable
),
movements as (
    select entity, account_code, posting_month,
           sum(debit) as debit, sum(credit) as credit, sum(amount_local) as net
    from {{ ref('int_general_ledger') }}
    where posting_date >= '2026-06-01'
    group by 1, 2, 3
),
grid as (
    select a.entity, a.account_code, m.posting_month,
           coalesce(mv.debit, 0)  as debit,
           coalesce(mv.credit, 0) as credit,
           coalesce(mv.net, 0)    as net
    from accounts a
    cross join months m
    left join movements mv
      on mv.entity = a.entity and mv.account_code = a.account_code
     and mv.posting_month = m.posting_month
)
select
    g.entity,
    g.account_code,
    g.posting_month,
    coalesce(o.opening_balance, 0)
      + sum(g.net) over (partition by g.entity, g.account_code order by g.posting_month)
      - g.net                                            as opening_balance,
    g.debit,
    g.credit,
    coalesce(o.opening_balance, 0)
      + sum(g.net) over (partition by g.entity, g.account_code order by g.posting_month)
                                                         as closing_balance
from grid g
left join {{ ref('ref_opening_balances') }} o
  on o.entity = g.entity and o.account_code = g.account_code
```

`models/marts/fct_balance_sheet_monthly.sql` (resumen de la lógica)

- Cuentas de grupos 1 a 3: `closing_balance` de `fct_trial_balance` al mes.
- Renglón adicional "Resultado del ejercicio en curso": suma de `amount_local` de grupos 4 a 8 sin cierres, desde el inicio del ejercicio fiscal (de `OFPR`) hasta el mes.

### B.4 Pruebas obligatorias

| Prueba | Regla |
|---|---|
| Cuadre del balance | Por entidad y mes: activo + pasivo + capital + resultado del ejercicio = 0 (signo debe − haber) |
| Balanza contra SAP | `closing_balance` de cada cuenta = saldo de la balanza de SAP al cierre del mes |
| Resultados contra la vista del partner | Estado de resultados de dbt = `XBXP_DASHBOARD_EDORESULTADOS` por mes |
| Niveles del catálogo | Ninguna cuenta con más de 5 niveles (si las hay, extender la jerarquía) |
| Mapeos completos | Toda cuenta de balance tiene actividad en `ref_cashflow_mapping`; toda cuenta de capital tiene concepto en `ref_equity_mapping` |

Ejemplo de prueba singular (`tests/assert_balance_sheet_balances.sql`): debe devolver cero filas.

```sql
select entity, posting_month, sum(amount) as difference
from {{ ref('fct_balance_sheet_monthly') }}
group by 1, 2
having abs(sum(amount)) > 0.01
```

### B.5 Ejemplo de YAML bilingüe

```yaml
models:
  - name: fct_income_statement_monthly
    description: >
      Monthly income statement by entity and account (FASA, FGI). Excludes year-end closing entries.
      Estado de resultados mensual por entidad y cuenta (FASA, FGI). Excluye asientos de cierre de ejercicio.
    columns:
      - name: amount_usd
        description: >
          Amount in USD, presentation sign (revenue positive, costs and expenses negative).
          Importe en USD, con signo de presentación (ingresos positivos, costos y gastos negativos).
```

---

## Anexo C. Dónde vive el proyecto dbt y cómo llega la semántica a cada herramienta

**Fuente única: un repositorio de Git (GitHub) con el proyecto dbt.** Ahí viven todos los `.sql`, `.yml`, pruebas, macros y tablas de referencia pequeñas. Nada se define a mano dentro de Lightdash.

```
fronterra-hub/
├── CLAUDE.md                     ← reglas para Claude Code
├── docs/guia_desarrollo.md       ← esta guía
├── dbt_project.yml               ← persist_docs activado
├── models/
│   ├── staging/      (*.sql + _staging.yml)
│   ├── intermediate/ (*.sql + _intermediate.yml)
│   └── marts/        (*.sql + _marts.yml: descripciones bilingües y métricas)
├── seeds/            (tablas de referencia pequeñas en CSV)
├── tests/            (pruebas singulares: cuadres contra contabilidad)
├── macros/
└── .github/workflows/ (corrida programada después de la carga de dlt)
```

Las credenciales nunca van al repositorio: viven en los secretos de GitHub y en el `profiles.yml` local de cada desarrollador.

**Cómo llega la semántica a cada consumidor:**

| Consumidor | De dónde toma el contexto | Cómo |
|---|---|---|
| **BigQuery** | Las descripciones de los `.yml` | `persist_docs` (`relation: true`, `columns: true`) copia cada descripción a la tabla y columna en BigQuery en cada corrida |
| **Lightdash** | El repositorio + BigQuery | Lee el proyecto dbt (incluidas las métricas declaradas en el `meta` de los `.yml`) y consulta las tablas en BigQuery; se actualiza en cada despliegue |
| **Claude Code** | El repositorio | Lee `CLAUDE.md`, esta guía y los modelos para construir |

**Flujo de trabajo:** cada cambio en una rama → corrida en el dataset de desarrollo → revisión de otra persona → unión a la rama principal → la corrida programada actualiza producción, las descripciones en BigQuery y el despliegue de Lightdash.

**Tablas de referencia que mantienen otras áreas** (mapeos de Finanzas, huertas de Calidad): si cambian seguido, una hoja de Google conectada a BigQuery como tabla externa evita que Finanzas tenga que editar CSV en Git; si casi no cambian, un `seed` en el repositorio.
