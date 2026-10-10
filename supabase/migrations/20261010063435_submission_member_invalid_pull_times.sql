-- Add creation-time bounds for the exact invalid orders shown in the member
-- drawer. Preserve whole-platform qualification and legacy full-day time bounds.
-- The reviewed production function already uses native AR monetary normalization.
begin;
do $migration$
declare
 p record;updated record;authenticated_id oid;definition text;
 before_hash constant text:='34fa83e4f1b8c0ea369c51f65cd648c8';
 after_hash constant text:='1ddde0a5c1f7e9c79c9eb212c10e8667';
 old_fragment constant text:=$old$   min(q.first_at) first_at,max(q.last_at) last_at
$old$;
 new_fragment constant text:=$new$   min(q.first_at) first_at,max(q.last_at) last_at,
   min(q.created_at) first_invalid_at,max(q.created_at) last_invalid_at
$new$;
begin
 select oid into authenticated_id from pg_catalog.pg_roles where rolname='authenticated';
 select f.*,l.lanname into p from pg_catalog.pg_proc f join pg_catalog.pg_language l on l.oid=f.prolang
 where f.oid=pg_catalog.to_regprocedure('private.dashboard_admin_live_submission_analysis(jsonb)');
 if not found or authenticated_id is null then raise exception 'submission_invalid_pull_times_baseline_missing';end if;
 if md5(p.prosrc) not in (before_hash,after_hash) or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s'
  or not p.prosecdef or p.pronargdefaults<>0 or p.lanname<>'plpgsql'
  or p.proconfig is distinct from array['search_path=""','jit=off','enable_nestloop=off'] then
  raise exception 'submission_invalid_pull_times_definition_drift';
 end if;
 if not exists(select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee=authenticated_id and a.privilege_type='EXECUTE' and not a.is_grantable)
  or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    where a.privilege_type='EXECUTE' and (a.is_grantable or a.grantee not in (p.proowner,authenticated_id))) then
  raise exception 'submission_invalid_pull_times_acl_drift';
 end if;
 if md5(p.prosrc)=before_hash then
  definition:=pg_catalog.pg_get_functiondef(p.oid);
  if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
   raise exception 'submission_invalid_pull_times_fragment_drift';
  end if;
  execute replace(definition,old_fragment,new_fragment);
 end if;
 select * into updated from pg_catalog.pg_proc where oid=p.oid;
 if md5(updated.prosrc)<>after_hash or updated.proacl is distinct from p.proacl or updated.proowner<>p.proowner
  or updated.proconfig is distinct from p.proconfig or updated.prosecdef<>p.prosecdef
  or updated.provolatile<>p.provolatile or updated.prolang<>p.prolang then
  raise exception 'submission_invalid_pull_times_postcondition_failed';
 end if;
end;
$migration$;
notify pgrst,'reload schema';
commit;
