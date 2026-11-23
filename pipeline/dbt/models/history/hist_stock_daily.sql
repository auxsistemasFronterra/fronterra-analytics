-- Foto diaria de existencias por artículo y almacén (OITW), FASA y FGI (guía, sección 5: "activarlas ya").
-- Cada corrida reemplaza solo la partición de hoy (hora de México); las anteriores se conservan. full_refresh = false
-- (dbt_project.yml): un --full-refresh no borra la historia. OITW se recarga completa cada día, así que la foto refleja
-- las existencias al momento de la carga de madrugada (= cierre del día anterior).
{{ config(
    incremental_strategy='insert_overwrite',
    partition_by={'field': 'snapshot_date', 'data_type': 'date', 'granularity': 'day'},
    cluster_by=['entity', 'item_code']
) }}

{% for e in var('entities') %}
select
    current_date('{{ var("business_timezone") }}')     as snapshot_date,
    '{{ e | upper }}'                                   as entity,
    w.item_code,
    i.item_name,
    w.whs_code                                          as warehouse_code,
    h.whs_name                                          as warehouse_name,
    w.on_hand                                           as on_hand_qty,
    w.is_commited                                       as committed_qty,
    w.on_order                                          as on_order_qty,
    w.avg_price                                         as avg_price_local,
    w.stock_value                                       as stock_value_local,
    '{{ var("local_currency")[e] }}'                    as local_currency,
    current_timestamp()                                 as captured_at
from {{ source('sap_' ~ e, 'oitw') }} w
left join {{ source('sap_' ~ e, 'oitm') }} i on i.item_code = w.item_code
left join {{ source('sap_' ~ e, 'owhs') }} h on h.whs_code = w.whs_code
where w.on_hand <> 0 or w.is_commited <> 0 or w.on_order <> 0
{% if not loop.last %}union all{% endif %}
{% endfor %}
