-- Role listing used aliases r/a that collide with PL/pgSQL row variables.
-- Resolve SQLSTATE 42702 without changing any role-management authorization.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare p record;v_new text;v_after record;
begin
 select f.*,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
 where f.oid=to_regprocedure('public.dashboard_role_manage(jsonb)');
 if not found or p.proowner<>(select oid from pg_roles where rolname=current_user)
  or not p.prosecdef or p.provolatile<>'v' or p.prorettype<>'jsonb'::regtype or p.proretset
  or p.lanname<>'plpgsql' or p.proconfig is distinct from array['search_path=""']::text[]
  or md5(p.prosrc) not in ('f7c1917834e93bfb5e6436496109cb85','3712489a82237d24bf4aa6c8e5c97ef7')
 then raise exception 'dashboard_role_manage_list_fix_drift';end if;
 if md5(p.prosrc)='f7c1917834e93bfb5e6436496109cb85' then
  v_new:=replace(p.prosrc,$before$'role_id',a.role_id,'role_name',r.name,'assignment_version',coalesce(a.version,0),'data_scope',p.data_scope) order by p.username,p.auth_user_id)
    from public.dashboard_profiles p left join private.dashboard_role_assignments a using(auth_user_id) left join private.dashboard_roles r on r.id=a.role_id)$before$,$after$'role_id',assignment_row.role_id,'role_name',role_row.name,'assignment_version',coalesce(assignment_row.version,0),'data_scope',p.data_scope) order by p.username,p.auth_user_id)
    from public.dashboard_profiles p left join private.dashboard_role_assignments assignment_row using(auth_user_id) left join private.dashboard_roles role_row on role_row.id=assignment_row.role_id)$after$);
  if md5(v_new)<>'3712489a82237d24bf4aa6c8e5c97ef7' then raise exception 'dashboard_role_manage_list_fix_anchor';end if;
  execute replace(pg_get_functiondef(p.oid),p.prosrc,v_new);
 end if;
 select proacl,proowner into v_after from pg_proc where oid=p.oid;
 if v_after.proacl is distinct from p.proacl or v_after.proowner<>p.proowner then
  raise exception 'dashboard_role_manage_list_fix_acl_drift';
 end if;
end;$migration$;
commit;
