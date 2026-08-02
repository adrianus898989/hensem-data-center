-- 09_检查_历史数据补齐进度_只读
-- 可随时 Run，不会修改任何数据。

select
  status,
  count(*) as tasks,
  min(data_date) as first_date,
  max(data_date) as last_date,
  sum(rows_written) as rows_written
from public.third_party_history_backfill
group by status
order by status;

select
  count(*) filter (where status = 'success') as completed,
  count(*) as total,
  round(100.0 * count(*) filter (where status = 'success') / nullif(count(*),0), 2) as completed_pct,
  min(data_date) filter (where status in ('pending','retry')) as next_pending_date,
  max(last_sync_at) as last_history_sync
from public.third_party_history_backfill;

select data_date, direction, status, attempts, rows_written, last_error, last_sync_at
from public.third_party_history_backfill
where status <> 'success'
order by data_date, direction
limit 30;
