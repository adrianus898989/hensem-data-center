-- 10_检查_Supabase数据库占用_只读
-- 可随时 Run，不会修改任何数据。

select
  relname as table_name,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size,
  pg_size_pretty(pg_relation_size(relid)) as table_size,
  pg_size_pretty(pg_indexes_size(relid)) as index_size,
  n_live_tup as estimated_rows
from pg_stat_user_tables
where relname in (
  'third_party_volume',
  'third_party_rates',
  'third_party_platform_status',
  'third_party_history_backfill',
  'dashboard_profiles',
  'dashboard_audit_log'
)
order by pg_total_relation_size(relid) desc;

select
  count(*) as volume_rows,
  min(data_date) as first_date,
  max(data_date) as last_date
from public.third_party_volume;
