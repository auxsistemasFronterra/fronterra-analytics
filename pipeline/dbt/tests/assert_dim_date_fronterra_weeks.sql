-- Semana Fronterra (guía, regla 18), casos conocidos. Debe devolver cero filas.
-- 2026: SEM 1 = jueves 1 al sábado 3 de enero; SEM 2 empieza el domingo 4.
with expected as (
    select date '2026-01-01' as date_day, 1 as week_number, date '2026-01-01' as week_start, date '2026-01-03' as week_end union all
    select date '2026-01-03', 1, date '2026-01-01', date '2026-01-03' union all
    select date '2026-01-04', 2, date '2026-01-04', date '2026-01-10' union all
    select date '2026-12-31', 53, date '2026-12-27', date '2026-12-31' union all
    select date '2027-01-01', 1, date '2027-01-01', date '2027-01-02' union all
    select date '2027-01-03', 2, date '2027-01-03', date '2027-01-09'
)

select e.*, d.week_number as actual_week, d.week_start as actual_start, d.week_end as actual_end
from expected e
left join {{ ref('dim_date') }} d using (date_day)
where d.week_number is distinct from e.week_number
   or d.week_start is distinct from e.week_start
   or d.week_end is distinct from e.week_end
