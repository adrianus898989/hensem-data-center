-- Exclude verified pre-launch NEW_AR targets from order receipt expectations.
-- Configured fallback catalog IDs and all order routing/scope checks stay intact.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
do $migration$
declare
 target oid:=to_regprocedure('private.dashboard_admin_live_intake_coverage(jsonb)');
 before_meta jsonb; after_meta jsonb; body text; patched text; owner_name text;
 old_launch text:=$old$  if dataset='orders' and source_system='newar' then select launch_at into v_launch from public.newar_detail_platforms where platform=v_raw_platform and country_code=v_raw_country and enabled;end if;$old$;
 new_launch text:=$new$  if dataset='orders' and source_system in('newar','ar') then
   select n.launch_at into v_launch from public.newar_detail_platforms n
    where n.platform=v_raw_platform and n.country_code=v_raw_country and n.enabled
     and (source_system='newar' or exists(
      select 1 from public.ar_config_targets t where t.country_code=v_raw_country
       and t.platform=v_raw_platform and t.source_system='NEW_AR'));
  end if;$new$;
begin
 select to_jsonb(p)-'prosrc',p.prosrc,r.rolname into before_meta,body,owner_name
 from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid=target;
 if target is null or owner_name is distinct from 'postgres' or (before_meta->>'prosecdef') is distinct from 'true'
  or (before_meta->>'provolatile') is distinct from 's'
  or (before_meta->'proconfig') is distinct from to_jsonb(array['search_path=""','jit=off']::text[])
  or (select p.proacl::text from pg_proc p where p.oid=target) is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
 then raise exception 'configured_newar_launch_metadata_drift';end if;
 if md5(body)<>'30d6ae0bfbb04d0a5ccea48629fa474c'
  or (length(body)-length(replace(body,old_launch,'')))/length(old_launch)<>1
 then raise exception 'configured_newar_launch_baseline_drift';end if;
 select replace(pg_get_functiondef(target),old_launch,new_launch) into patched;
 execute patched;
 select to_jsonb(p)-'prosrc' into after_meta from pg_proc p where p.oid=target;
 if after_meta is distinct from before_meta then raise exception 'configured_newar_launch_metadata_changed';end if;
end;
$migration$;
notify pgrst,'reload schema';
commit;
