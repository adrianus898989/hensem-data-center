-- Display the native order status without changing normalized qualification.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $migration$
declare p record;updated record;definition text;authenticated_id oid;
 before_hash constant text:='189d9c7ee57ee9cbcad72d29f8b124bc';after_hash constant text:='219db2fb64d519ce975a5a2a907cd6db';
begin
 select oid into authenticated_id from pg_roles where rolname='authenticated';
 select f.*,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
 where f.oid=to_regprocedure('private.dashboard_admin_live_submission_analysis(jsonb)');
 if not found or authenticated_id is null then raise exception 'member_order_native_status_baseline_missing';end if;
 if md5(p.prosrc) not in (before_hash,after_hash) or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s'
  or not p.prosecdef or p.pronargdefaults<>0 or p.lanname<>'plpgsql'
  or p.proconfig is distinct from array['search_path=""','jit=off','enable_nestloop=off'] then raise exception 'member_order_native_status_definition_drift';end if;
 if not exists(select 1 from aclexplode(p.proacl) a where a.grantee=authenticated_id and a.privilege_type='EXECUTE' and not a.is_grantable)
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.privilege_type='EXECUTE' and (a.is_grantable or a.grantee not in (p.proowner,authenticated_id))) then raise exception 'member_order_native_status_acl_drift';end if;
 if md5(p.prosrc)=before_hash then
  definition:=pg_get_functiondef(p.oid);
  if (length(definition)-length(replace(definition,$old_0$n.status_group::text source_status$old_0$,'')))/length($old_0$n.status_group::text source_status$old_0$)<>1 then raise exception 'member_order_native_status_fragment_drift_0';end if;
  definition:=replace(definition,$old_0$n.status_group::text source_status$old_0$,$new_0$n.status_code::text source_status$new_0$);
  if (length(definition)-length(replace(definition,$old_1$l.status_class::text source_status$old_1$,'')))/length($old_1$l.status_class::text source_status$old_1$)<>1 then raise exception 'member_order_native_status_fragment_drift_1';end if;
  definition:=replace(definition,$old_1$l.status_class::text source_status$old_1$,$new_1$coalesce(nullif(l.status_text,''),l.status_code::text) source_status$new_1$);
  execute definition;
 end if;
 select * into updated from pg_proc where oid=p.oid;
 if md5(updated.prosrc)<>after_hash or updated.proacl is distinct from p.proacl or updated.proowner<>p.proowner
  or updated.proconfig is distinct from p.proconfig or updated.prosecdef<>p.prosecdef
  or updated.provolatile<>p.provolatile or updated.prolang<>p.prolang then raise exception 'member_order_native_status_postcondition_failed';end if;
end;
$migration$;
notify pgrst,'reload schema';
commit;
