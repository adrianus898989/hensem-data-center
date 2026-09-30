-- Restrict collected AR work-order reads to one directory-backed team before
-- candidate records, original-order grouping and pagination. No grants change.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $guard$
declare v_name text;v_proc record;v_authenticated oid;v_hashes text[];
begin
 select oid into v_authenticated from pg_catalog.pg_roles where rolname='authenticated';
 foreach v_name in array array['private.dashboard_admin_live_workorder_records(jsonb)','private.dashboard_admin_live_workorder_analysis(jsonb)'] loop
  select * into v_proc from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(v_name);
  if not found or v_authenticated is null then raise exception 'workorder_team_baseline_missing: %',v_name;end if;
  v_hashes:=case when v_name='private.dashboard_admin_live_workorder_records(jsonb)'
    then array['ab848a368b34a76fcd7acebe44905087','f69e518360dbf021b49c4aa8ba7e6c72']
    else array['e7d9182db042bec4e8575c8ce1787f7f','e0128157a7ec8618c19155a8939833a2'] end;
  if not (md5(v_proc.prosrc)=any(v_hashes)) or v_proc.prorettype<>'jsonb'::regtype
    or v_proc.provolatile<>'s' or v_proc.pronargdefaults<>0 or not v_proc.prosecdef
    or v_proc.proconfig is distinct from array['search_path=""','statement_timeout=20s']
    or v_proc.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql') then
   raise exception 'workorder_team_definition_drift: %',v_name;
  end if;
  if not exists(select 1 from pg_catalog.aclexplode(v_proc.proacl) a where a.grantee=v_authenticated and a.privilege_type='EXECUTE' and not a.is_grantable)
    or exists(select 1 from pg_catalog.aclexplode(coalesce(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a
      where a.privilege_type='EXECUTE' and (a.grantee not in(v_proc.proowner,v_authenticated) or a.grantee=v_authenticated and a.is_grantable)) then
   raise exception 'workorder_team_acl_drift: %',v_name;
  end if;
 end loop;
end;
$guard$;
do $patch$
declare v_name text;definition text;change record;
begin
 foreach v_name in array array['private.dashboard_admin_live_workorder_records(jsonb)','private.dashboard_admin_live_workorder_analysis(jsonb)'] loop
  select pg_get_functiondef(pg_catalog.to_regprocedure(v_name)) into definition;
  if position('workorder_team_scope_v1' in definition)>0 then continue;end if;
  for change in select * from (values
('both',$old$f-array['platform','from','to','dateBasis'$old$,$new$f-array['team','platform','from','to','dateBasis'$new$),
('records',$old$ for k,v in select key,value#>>'{}' from jsonb_each(f) loop$old$,$new$ if f ? 'team' and (v_view<>'records' or action<>'list') then raise exception using errcode='22023',message='invalid_filter';end if;
 for k,v in select key,value#>>'{}' from jsonb_each(f) loop$new$),
('records',$old$ ), platform_totals as materialized ($old$,$new$ ), workorder_team_scope_v1 as materialized (
  -- A blank or conflicting directory assignment is unresolved, never a default team.
  select private.dashboard_admin_live_workorder_platform_key(v_code,p.source_name) platform_key,
   case when bool_and(nullif(btrim(p.team),'') is not null) and count(distinct btrim(p.team))=1
     then min(btrim(p.team)) end team
  from private.dashboard_admin_live_platforms() p
  where p.scope_group=v_code and lower(p.source)='ar' and nullif(btrim(p.source_name),'') is not null
    and coalesce(f->>'team','')<>''
  group by private.dashboard_admin_live_workorder_platform_key(v_code,p.source_name)
 ), platform_totals as materialized ($new$),
('records',$old$  from platform_totals p left join catalog c on c.source_name=p.platform
  where private.dashboard_scope_allows(v_scope,v_code,p.platform)$old$,$new$  from platform_totals p left join catalog c on c.source_name=p.platform
  left join workorder_team_scope_v1 t on t.platform_key=private.dashboard_admin_live_workorder_platform_key(v_code,p.platform)
  where private.dashboard_scope_allows(v_scope,v_code,p.platform)
    and (coalesce(f->>'team','')='' or t.team=f->>'team')$new$),
('analysis',$old$ ), allowed_platforms as materialized ($old$,$new$ ), workorder_team_scope_v1 as materialized (
  -- A blank or conflicting directory assignment is unresolved, never a default team.
  select private.dashboard_admin_live_workorder_platform_key(v_code,p.source_name) platform_key,
   case when bool_and(nullif(btrim(p.team),'') is not null) and count(distinct btrim(p.team))=1
     then min(btrim(p.team)) end team
  from private.dashboard_admin_live_platforms() p
  where p.scope_group=v_code and lower(p.source)='ar' and nullif(btrim(p.source_name),'') is not null
    and coalesce(f->>'team','')<>''
  group by private.dashboard_admin_live_workorder_platform_key(v_code,p.source_name)
 ), allowed_platforms as materialized ($new$),
('analysis',$old$  from native_platforms p where p.platform is not null and private.dashboard_scope_allows(v_scope,v_code,p.platform)$old$,$new$  from native_platforms p
  left join workorder_team_scope_v1 t on t.platform_key=private.dashboard_admin_live_workorder_platform_key(v_code,p.platform)
  where p.platform is not null and private.dashboard_scope_allows(v_scope,v_code,p.platform)
    and (coalesce(f->>'team','')='' or t.team=f->>'team')$new$)
  ) changes(kind,old_text,new_text)
   where kind='both' or v_name='private.dashboard_admin_live_workorder_'||kind||'(jsonb)' loop
   if (length(definition)-length(replace(definition,change.old_text,'')))/length(change.old_text)<>1 then
    raise exception 'workorder_team_fragment_drift: % / %',v_name,left(change.old_text,80);
   end if;
   definition:=replace(definition,change.old_text,change.new_text);
  end loop;
  execute definition;
 end loop;
end;
$patch$;
notify pgrst,'reload schema';
commit;
