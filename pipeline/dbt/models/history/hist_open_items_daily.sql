-- Foto diaria de saldos abiertos de CxC y CxP por partida (guía, sección 5: "activarlas ya"), FASA y FGI.
-- Una fila por renglón de asiento (JDT1) de un socio de negocio con saldo pendiente (BalDue*): facturas, notas de
-- crédito, anticipos y cobros/pagos sin aplicar, igual que el reporte de antigüedad de SAP. La suma por socio cuadra con
-- OCRD.Balance (probado 23-nov-2026 y en tests/assert_open_items_match_bp_balance.sql).
-- Cada corrida reemplaza solo la partición de hoy (hora de México); full_refresh = false no deja borrar la historia.
{{ config(
    incremental_strategy='insert_overwrite',
    partition_by={'field': 'snapshot_date', 'data_type': 'date', 'granularity': 'day'},
    cluster_by=['entity', 'ledger', 'card_code']
) }}

{% for e in var('entities') %}
select
    current_date('{{ var("business_timezone") }}')     as snapshot_date,
    '{{ e | upper }}'                                   as entity,
    case c.card_type when 'C' then 'receivable' when 'S' then 'payable' else 'other' end   as ledger,
    case c.card_type when 'C' then 'CxC' when 'S' then 'CxP' else 'Otro' end               as ledger_es,
    l.short_name                                        as card_code,
    c.card_name,
    l.account                                           as account_code,
    l.trans_id,
    l.line_id,
    l.trans_type,
    l.base_ref,
    l.ref1,
    l.ref2,
    l.line_memo,
    cast(l.ref_date as date)                            as posting_date,
    cast(l.due_date as date)                            as due_date,
    date_diff(current_date('{{ var("business_timezone") }}'), cast(l.due_date as date), day)  as days_past_due,
    l.bal_due_deb - l.bal_due_cred                      as open_amount_local,
    '{{ var("local_currency")[e] }}'                    as local_currency,
    l.bal_sc_deb - l.bal_sc_cred                        as open_amount_usd,
    l.bal_fc_deb - l.bal_fc_cred                        as open_amount_fc,
    l.fc_currency,
    current_timestamp()                                 as captured_at
from {{ source('sap_' ~ e, 'jdt1') }} l
join {{ source('sap_' ~ e, 'ocrd') }} c on c.card_code = l.short_name
where l.bal_due_deb <> 0 or l.bal_due_cred <> 0
{% if not loop.last %}union all{% endif %}
{% endfor %}
