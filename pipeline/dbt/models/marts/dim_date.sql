-- Calendario con la Semana Fronterra (guía, regla 18): domingo a sábado, numeración gregoriana como WEEKNUM(fecha, 1)
-- de Excel. La SEM 1 es la que contiene el 1 de enero aunque sea parcial; las semanas se cortan en el cambio de año
-- (en 2026: SEM 1 = jueves 1 al sábado 3 de enero; SEM 2 empieza el domingo 4). Las semanas salen siempre de aquí.

with days as (
    select d as date_day
    from unnest(generate_date_array('2025-01-01', '2027-12-31')) as d
)

select
    date_day,
    extract(year from date_day)                                                   as year,
    extract(quarter from date_day)                                                as quarter,
    extract(month from date_day)                                                  as month_number,
    date_trunc(date_day, month)                                                   as month_start,
    last_day(date_day, month)                                                     as month_end,
    ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre',
     'diciembre'][offset(extract(month from date_day) - 1)]                       as month_name_es,
    format_date('%B', date_day)                                                   as month_name_en,
    extract(dayofweek from date_day)                                              as day_of_week,  -- 1 = domingo
    ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][offset(extract(dayofweek from date_day) - 1)]
                                                                                  as day_name_es,
    format_date('%A', date_day)                                                   as day_name_en,
    extract(dayofweek from date_day) in (1, 7)                                    as is_weekend,
    -- Semana Fronterra
    div(extract(dayofyear from date_day) - 1 + extract(dayofweek from date_trunc(date_day, year)) - 1, 7) + 1
                                                                                  as week_number,
    extract(year from date_day)                                                   as week_year,
    greatest(date_trunc(date_day, week(sunday)), date_trunc(date_day, year))      as week_start,
    least(date_add(date_trunc(date_day, week(sunday)), interval 6 day), last_day(date_day, year))
                                                                                  as week_end,
    concat('SEM ', cast(div(extract(dayofyear from date_day) - 1
                            + extract(dayofweek from date_trunc(date_day, year)) - 1, 7) + 1 as string))
                                                                                  as week_label_es,
    concat('WK ', cast(div(extract(dayofyear from date_day) - 1
                           + extract(dayofweek from date_trunc(date_day, year)) - 1, 7) + 1 as string))
                                                                                  as week_label_en,
    date_day >= date '{{ var("start_date") }}'                                    as is_hub_period
from days
