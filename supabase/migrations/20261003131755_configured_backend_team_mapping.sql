-- Read the configured backend's mapping for pre-launch catalog targets.
-- Keep catalog IDs, order sources, launch checks and scope predicates unchanged.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
do $migration$
declare
 target oid:=to_regprocedure('private.dashboard_admin_live_platforms()');
 before_meta jsonb; after_meta jsonb; body text; patched text; owner_name text;
 old_join text:=$old$left join public.dashboard_platform_team_map m on m.active and m.source_system='AR'
      and (m.source_country=t.country_name or m.source_country=t.country_code)$old$;
 new_join text:=$new$left join public.dashboard_platform_team_map m on m.active
      and m.source_system=case when t.source_system='NEW_AR' then 'NEW_AR' else 'AR' end
      and (m.source_country=t.country_name or m.source_country=t.country_code)$new$;
begin
 select to_jsonb(p)-'prosrc',p.prosrc,r.rolname into before_meta,body,owner_name
 from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid=target;
 if target is null or owner_name is distinct from 'postgres' or (before_meta->>'prosecdef') is distinct from 'true'
  or (before_meta->>'provolatile') is distinct from 's' or (before_meta->'proconfig') is distinct from to_jsonb(array['search_path=""']::text[])
  or (select p.proacl::text from pg_proc p where p.oid=target) is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
 then raise exception 'configured_backend_team_metadata_drift';end if;
 if md5(body)<>'f230e051dce0f2200f8fa41fb0f65c5b'
  or (length(body)-length(replace(body,old_join,'')))/length(old_join)<>1
 then raise exception 'configured_backend_team_baseline_drift';end if;
 select replace(pg_get_functiondef(target),old_join,new_join) into patched;
 execute patched;
 select to_jsonb(p)-'prosrc' into after_meta from pg_proc p where p.oid=target;
 if after_meta is distinct from before_meta then raise exception 'configured_backend_team_metadata_changed';end if;
end;
$migration$;
notify pgrst,'reload schema';
commit;
