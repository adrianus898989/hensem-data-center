-- Use the authorized, enabled, launched NEW_AR registry as the catalog identity.
-- A first order is evidence of activity, not a prerequisite for the backend type.
-- Future/disabled targets retain the existing fallback; no rows or coverage are fabricated.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
do $migration$
declare
 target oid:=to_regprocedure('private.dashboard_admin_live_platforms()');
 before_meta jsonb;after_meta jsonb;body text;definition text;owner_name text;
 old_fragment text;new_fragment text;
 before_hash constant text:='ba28cac731a6e8485667553230ae951a';
 after_hash constant text:='176a2602077e795e327560adba318810';
begin
 select to_jsonb(p)-'prosrc',p.prosrc,r.rolname into before_meta,body,owner_name
 from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid=target;
 if target is null or owner_name is distinct from 'postgres' or (before_meta->>'prosecdef') is distinct from 'true'
  or (before_meta->>'provolatile') is distinct from 's' or (before_meta->>'proretset') is distinct from 'true'
  or (before_meta->>'prokind') is distinct from 'f' or (before_meta->>'proisstrict') is distinct from 'false'
  or (before_meta->>'proleakproof') is distinct from 'false'
  or (before_meta->'proconfig') is distinct from to_jsonb(array['search_path=""']::text[])
  or (select p.proacl::text from pg_proc p where p.oid=target) is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
  or (select p.prolang from pg_proc p where p.oid=target)<>(select oid from pg_language where lanname='plpgsql')
 then raise exception 'configured_newar_catalog_metadata_drift';end if;
 if md5(body) not in(before_hash,after_hash) then raise exception 'configured_newar_catalog_baseline_drift';end if;
 if md5(body)=after_hash then return;end if;
 definition:=pg_get_functiondef(target);
 -- Launched NEW_AR configuration replaces the AR placeholder even before the first order.
 old_fragment:=$old1$          and (n.launch_at is null or n.launch_at<=now())
          and exists(select 1 from public.newar_detail_records r where r.platform=n.platform
            and r.dataset in ('charge','withdraw') and (n.launch_at is null or r.created_at>=n.launch_at) offset 0) offset 0))$old1$;
 new_fragment:=$new1$          and (n.launch_at is null or n.launch_at<=now()) offset 0))$new1$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception 'configured_newar_catalog_patch_1_drift';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 -- A configured target must not reappear as an AR mapped-only row after replacement.
 old_fragment:=$old2$          and upper(btrim(t.platform))=upper(btrim(m.source_platform))
          and not (t.source_system='NEW_AR' and exists(select 1 from public.newar_detail_platforms n
            where n.platform=t.platform and n.country_code=t.country_code and n.enabled
              and (n.launch_at is null or n.launch_at<=now())
              and exists(select 1 from public.newar_detail_records r where r.platform=n.platform
                and r.dataset in ('charge','withdraw') and (n.launch_at is null or r.created_at>=n.launch_at) offset 0) offset 0)))$old2$;
 new_fragment:=$new2$          and upper(btrim(t.platform))=upper(btrim(m.source_platform)))$new2$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception 'configured_newar_catalog_patch_2_drift';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 -- The same native NEW_AR ID is used both before and after collection starts.
 old_fragment:=$old3$    and private.dashboard_scope_allows(v_scope,n.country_code,n.platform)
    and exists(select 1 from public.newar_detail_records r where r.platform=n.platform
      and r.dataset in ('charge','withdraw') and (n.launch_at is null or r.created_at>=n.launch_at) offset 0)$old3$;
 new_fragment:=$new3$    and private.dashboard_scope_allows(v_scope,n.country_code,n.platform)$new3$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception 'configured_newar_catalog_patch_3_drift';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 execute definition;
 select to_jsonb(p)-'prosrc',p.prosrc into after_meta,body from pg_proc p where p.oid=target;
 if after_meta is distinct from before_meta or md5(body)<>after_hash
 then raise exception 'configured_newar_catalog_postcheck_failed';end if;
end;
$migration$;
notify pgrst,'reload schema';
commit;
