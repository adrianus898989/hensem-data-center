-- Only this parameter-heavy collected-KYC reader plans using current filter values.
-- No global settings, statement timeout, authorization, classifications or source writes change.
begin;
set local statement_timeout='3s';
set local lock_timeout='1s';
do $patch$
declare target regprocedure:=to_regprocedure('private.dashboard_admin_deposit_collected_statistics(jsonb)');before_meta jsonb;
begin
 if current_user<>'postgres' then raise exception 'deposit_collected_custom_plan_owner_required';end if;
 if target is null or not exists(select 1 from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=target
  and f.proowner='postgres'::regrole and l.lanname='plpgsql' and f.prokind='f' and not f.prosecdef
  and f.provolatile='s' and f.proparallel='u' and not f.proretset and not f.proisstrict and not f.proleakproof
  and f.prorettype='jsonb'::regtype and f.pronargs=1 and f.pronargdefaults=0 and f.provariadic=0
  and f.procost=100 and f.prorows=0 and pg_get_function_arguments(f.oid)='p_request jsonb'
  and (f.proconfig=array['search_path=""']::text[] or f.proconfig=array['search_path=""','plan_cache_mode=force_custom_plan']::text[])
  and f.proacl::text='{postgres=X/postgres}') then raise exception 'deposit_collected_custom_plan_metadata_drift';end if;
 if (select md5(prosrc)from pg_proc where oid=target) is distinct from 'e6f8a15952fc7549654332e401f29500' then raise exception 'deposit_collected_custom_plan_body_drift';end if;
 select to_jsonb(f)-'proconfig' into before_meta from pg_proc f where f.oid=target;
 if (select proconfig from pg_proc where oid=target) is distinct from array['search_path=""','plan_cache_mode=force_custom_plan']::text[] then
  alter function private.dashboard_admin_deposit_collected_statistics(jsonb) set plan_cache_mode='force_custom_plan';
 end if;
 if (select to_jsonb(f)-'proconfig' from pg_proc f where f.oid=target) is distinct from before_meta
  or (select proconfig from pg_proc where oid=target) is distinct from array['search_path=""','plan_cache_mode=force_custom_plan']::text[]
 then raise exception 'deposit_collected_custom_plan_postcondition_drift';end if;
end;$patch$;
commit;
