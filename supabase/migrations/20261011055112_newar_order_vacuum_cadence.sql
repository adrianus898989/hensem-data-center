-- A two-day withdrawal count (49,238 live rows) exceeded the API's 8s limit:
-- 11.54s / 109,204 heap fetches before ordinary VACUUM, 0.35s / 0 afterwards.
-- Repeated collection refreshes create obsolete row versions. At ~2.4M rows,
-- the default 20% vacuum trigger allowed ~480K versions to accumulate.
-- Start table-local cleanup at ~48K instead, retaining PostgreSQL's existing
-- worker/cost limits. This changes no orders, source timestamps, grants or RLS.
-- The initial VACUUM (ANALYZE, TRUNCATE FALSE) was run separately: VACUUM must
-- not be placed inside a transactional schema migration.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
do $migration$
declare current_factor text;
begin
 select option_value into current_factor
 from pg_options_to_table((select reloptions from pg_class
   where oid='public.newar_detail_records'::regclass))
 where option_name='autovacuum_vacuum_scale_factor';
 if current_factor is not null and current_factor::numeric not in (0.2,0.02) then
  raise exception 'newar_order_vacuum_cadence_settings_drift';
 end if;
 alter table public.newar_detail_records set (autovacuum_vacuum_scale_factor=0.02);
end;$migration$;
commit;
