# Notas del prototipo de ventas (10–11 nov 2026)

**Esto NO son reglas.** Son hallazgos de una exploración hecha sobre `sap_hana_raw` (solo FASA, esquema HANA `FRONTERRA_PROTO`)
antes de recibir `guia_desarrollo.md`. Donde contradigan a la guía, manda la guía. Se guardan porque algunos datos sirven al
construir los modelos.

## Qué se hizo distinto a la guía
| Prototipo | Guía |
|---|---|
| Semanas de lunes a domingo con `date_trunc('week')` | Semana Fronterra, domingo a sábado, desde `dim_date` (regla 18) |
| Importes en MXN (`doc_total`, `line_total`) | USD con moneda de sistema (`doc_total_sy`, `total_sum_sy`) |
| Datos desde enero 2026 | Desde el 1 de junio de 2026 (regla 13) |
| Ventas de FASA sin separar intercompañía | Consolidado FASA + FGI + ELIM (sección 8) |
| Entregas deducidas de `inv1.base_type = 15` | Tablas `ODLN`/`DLN1` |
| Lógica en el SQL de cada gráfica | Toda la lógica en dbt |

## Hallazgos de los datos (verificados contra Postgres)
- `doc_total` y `line_total` están en MXN aunque `doc_cur` sea USD; moneda extranjera en `doc_total_fc` / `total_frgn`;
  moneda de sistema (USD) en `doc_total_sy` / `total_sum_sy`.
- `oinv` ya trae `u_folio_fronterra`, `u_num_lote`, `series`, `trans_id`, `update_date`, `update_ts`.
- Facturas: del 26-ene-2026 al 7-nov-2026. No canceladas desde el 1-jun-2026: 814, $518.7 M MXN ≈ $29.73 M USD de sistema
  (antes de notas de crédito). 93.5% a FRONTERRA GROUP INC (FGI).
- Facturas de "saldo inicial" (líneas con `dscription ILIKE '%SALDO% INICIAL%'`): ~265, ~$136 M MXN, casi todas de enero 2026.
  Con la fecha de corte de junio quedan fuera solas; revisar que no haya ninguna después de junio.
- Ninguna factura tiene vendedor (`slp_code = -1`).
- Clientes duplicados que difieren en mayúsculas o acentos ("MISSION DE MÉXICO" / "MISSION DE MEXICO", "AGUACATES ORGANICOS DE
  LA REGIÓN" / "REGION"): tenerlo en cuenta en `dim_customer` (unir por `card_code`, no por nombre).
- Hay `ship_date` erróneos en líneas de factura (uno de 2004).
- Calibre: número al inicio de la descripción del artículo, `'^[^0-9]{0,4}([0-9]+) '` (prefijos SL, TN). Calibres 48 y 60 ≈ 60%
  de la venta. ~400 códigos de producto terminado que cambian de semana a semana. No es una regla de la guía; puede ser una
  columna de `dim_item`.
- Unidades en facturas: casi todo CAJA, algo KG.
- Semana 26-oct a 1-nov-2026 (corte de lunes): ~29.7 mil cajas y solo $2.78 M MXN. Verificado contra HANA: el dato es así en
  SAP, no es carga incompleta.
- Tablas `_dlt_*` son internas de dlt.
