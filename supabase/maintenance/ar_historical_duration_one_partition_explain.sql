-- Planning only; never ANALYZE here. The example matches the maintenance aggregate.
-- Replace the exact native platform/day together with the maintenance script.
begin read only;
set local statement_timeout='3s';
set local lock_timeout='1s';
explain (format json)
select count(*) source_count,count(*) filter(where n.seconds>0) sample_count,
 coalesce(sum(n.seconds) filter(where n.seconds>0),0) total_seconds
from (select case when a.completed_at>a.applied_at then trunc(extract(epoch from a.completed_at-a.applied_at)) end seconds
 from public.ar_collected_orders a
 where a.source_system='AR' and a.country_code='IN' and a.platform='91CLUB' and a.order_kind='withdraw'
  and a.applied_at>=date '2026-10-09'::timestamp and a.applied_at<(date '2026-10-09'+1)::timestamp)n;
rollback;
