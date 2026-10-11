-- AR collection refreshes accumulated ~4.46M obsolete row versions among
-- ~25.5M live orders before the default 20% autovacuum threshold was reached.
-- Even the indexed 91CLUB day scan exceeded 8s, and the full cohort exceeded
-- a separate 30s diagnostic budget. Start ordinary table-local cleanup at
-- ~510K obsolete versions instead; retain existing worker/cost limits.
-- The initial VACUUM (ANALYZE, TRUNCATE FALSE) runs separately, outside this
-- transaction. This setting does not change business rows or access rules.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
do $migration$
declare current_factor text;
begin
 select option_value into current_factor
 from pg_options_to_table((select reloptions from pg_class
   where oid='public.ar_collected_orders'::regclass))
 where option_name='autovacuum_vacuum_scale_factor';
 if current_factor is null and current_setting('autovacuum_vacuum_scale_factor')::numeric<>0.2 then
  raise exception 'ar_order_vacuum_cadence_inherited_settings_drift';
 end if;
 if current_factor is not null and current_factor::numeric not in (0.2,0.02) then
  raise exception 'ar_order_vacuum_cadence_settings_drift';
 end if;
 alter table public.ar_collected_orders set (autovacuum_vacuum_scale_factor=0.02);
end;$migration$;
commit;
