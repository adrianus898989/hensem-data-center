-- Keep recent AR workorder pages eligible for index-only reconciliation.
-- Table-local maintenance: around 10,000 inserts, or 2% dead tuples, trigger
-- normal autovacuum. No global settings, access rules, or query timeouts change.
begin;
set local lock_timeout='1s';
set local statement_timeout='10s';
do $maintenance$
declare target oid:=to_regclass('public.ar_workorder_issue_details');before_security jsonb;
begin
 if target is null then raise exception 'WORKORDER_MAINTENANCE_TABLE_MISSING';end if;
 if exists(select 1 from pg_class c cross join lateral pg_options_to_table(c.reloptions) o
  where c.oid=target and (o.option_name in ('autovacuum_vacuum_scale_factor','autovacuum_vacuum_insert_scale_factor') and o.option_value::numeric<>0.02
   or o.option_name='autovacuum_vacuum_insert_threshold' and o.option_value::numeric<>1000))
 then raise exception 'WORKORDER_MAINTENANCE_SETTINGS_CHANGED';end if;
 select jsonb_build_array(relowner,relacl,relrowsecurity,relforcerowsecurity,relkind,relpersistence) into before_security from pg_class where oid=target;
 alter table public.ar_workorder_issue_details set (
  autovacuum_vacuum_scale_factor=0.02,
  autovacuum_vacuum_insert_scale_factor=0.02,
  autovacuum_vacuum_insert_threshold=1000
 );
 if before_security is distinct from (select jsonb_build_array(relowner,relacl,relrowsecurity,relforcerowsecurity,relkind,relpersistence) from pg_class where oid=target)
  or (select count(*) from pg_class c cross join lateral pg_options_to_table(c.reloptions) o
   where c.oid=target and (o.option_name in ('autovacuum_vacuum_scale_factor','autovacuum_vacuum_insert_scale_factor') and o.option_value::numeric=0.02
    or o.option_name='autovacuum_vacuum_insert_threshold' and o.option_value::numeric=1000))<>3
 then raise exception 'WORKORDER_MAINTENANCE_VERIFICATION_FAILED';end if;
end;$maintenance$;
commit;
