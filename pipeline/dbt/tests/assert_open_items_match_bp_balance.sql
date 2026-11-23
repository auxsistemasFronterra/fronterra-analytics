-- La foto de hoy de CxC/CxP debe sumar, por socio, exactamente su saldo en SAP (OCRD.Balance). Debe devolver cero filas.
-- Si falla, el crudo de JDT1 no está al día con las conciliaciones (ver pipeline/hana_pipeline.py, RECONCILED_OBJECTS).
with today as (
    select * from {{ ref('hist_open_items_daily') }}
    where snapshot_date = (select max(snapshot_date) from {{ ref('hist_open_items_daily') }})
),

open_by_card as (
    select entity, card_code, sum(open_amount_local) as open_amount_local
    from today
    group by 1, 2
),

bp as (
    {% for e in var('entities') %}
    select '{{ e | upper }}' as entity, card_code, balance
    from {{ source('sap_' ~ e, 'ocrd') }}
    {% if not loop.last %}union all{% endif %}
    {% endfor %}
)

select bp.entity, bp.card_code, bp.balance, coalesce(o.open_amount_local, 0) as open_amount_local
from bp
left join open_by_card o using (entity, card_code)
where abs(bp.balance - coalesce(o.open_amount_local, 0)) > 0.01
