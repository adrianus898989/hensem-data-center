-- Live role authorization for account / IP management. No account grants are changed.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create or replace function private.dashboard_actor_data_scope(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.dashboard_profiles%rowtype;
begin
 select * into p from public.dashboard_profiles where auth_user_id=p_actor;
 if not found or p.active is not true or p.role not in ('owner','admin','viewer') then return '{"mode":"selected","countries":[]}'::jsonb;end if;
 if p.role='owner' then return '{"mode":"all","countries":[]}'::jsonb;end if;
 if not coalesce(private.dashboard_data_scope_valid(p.data_scope),false) then return '{"mode":"selected","countries":[]}'::jsonb;end if;
 return p.data_scope;
end;$$;

create or replace function private.dashboard_actor_has_permission(p_actor uuid,p_permission text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare p public.dashboard_profiles%rowtype;a private.dashboard_role_assignments%rowtype;r private.dashboard_roles%rowtype;
begin
 if p_permission is null or not exists(select 1 from jsonb_array_elements(private.dashboard_role_catalog()->'permissions') c where c->>'key'=p_permission) then return false;end if;
 select * into p from public.dashboard_profiles where auth_user_id=p_actor;
 if not found or p.active is not true or p.role not in ('owner','admin','viewer') then return false;end if;
 if p.role='owner' then return true;end if;
 select * into a from private.dashboard_role_assignments where auth_user_id=p_actor;
 if found then
  select * into r from private.dashboard_roles where id=a.role_id;
  return found and r.active is true and p_permission=any(r.permissions)
   and (right(p_permission,5)='.view' or split_part(p_permission,'.',1)||'.view'=any(r.permissions))
   and exists(select 1 from public.dashboard_admin_preview_grants where auth_user_id=p_actor and can_view is true);
 end if;
 -- Legacy management remains bounded to its existing explicitly enabled capability.
 return p.role='admin' and case
  when p_permission like 'access.%' then coalesce((p.management_permissions->>'manage_viewers')::boolean,false)
  when p_permission='operation_logs.view' then coalesce((p.management_permissions->>'view_audit')::boolean,false)
  when p_permission like 'data_health.%' then coalesce((p.management_permissions->>'refresh_data')::boolean,false)
  else false end;
exception when others then return false;
end;$$;

create or replace function private.dashboard_actor_can_manage_account(p_actor uuid,p_target uuid,p_permission text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor public.dashboard_profiles%rowtype;target public.dashboard_profiles%rowtype;s jsonb;t jsonb;target_permissions text[];
begin
 if not private.dashboard_actor_has_permission(p_actor,p_permission) then return false;end if;
 select * into actor from public.dashboard_profiles where auth_user_id=p_actor;
 select * into target from public.dashboard_profiles where auth_user_id=p_target;
 if not found or target.role not in ('admin','viewer') then return false;end if;
 if actor.role='owner' then return true;end if;
 if p_actor=p_target or target.role<>'viewer' then return false;end if;
 s:=private.dashboard_actor_data_scope(p_actor);
 if not coalesce(private.dashboard_data_scope_valid(target.data_scope),false) then return false;end if;
 t:=target.data_scope;
 if s->>'mode'<>'all' and (t->>'mode'<>'selected' or not ((t->'countries') <@ (s->'countries'))) then return false;end if;
 if s->>'mode'='selected' and jsonb_array_length(s->'countries')=0 then return false;end if;
 if p_permission='access.view' then return true;end if;
 if exists(select 1 from private.dashboard_role_assignments where auth_user_id=p_actor) then
  select r.permissions into target_permissions from private.dashboard_role_assignments a join private.dashboard_roles r on r.id=a.role_id where a.auth_user_id=p_target;
  -- A delegated actor may replace an unassigned viewer's role with a bounded role,
  -- but cannot reset / disable / use its independent legacy business access.
  if not found then return p_permission='access.edit';end if;
  if exists(select 1 from unnest(target_permissions) k
    where exists(select 1 from jsonb_array_elements(private.dashboard_role_catalog()->'permissions') c where c->>'key'=k)
    and not private.dashboard_actor_has_permission(p_actor,k)) then return false;end if;
 end if;
 return true;
exception when others then return false;
end;$$;
revoke all on function private.dashboard_actor_data_scope(uuid),private.dashboard_actor_has_permission(uuid,text),private.dashboard_actor_can_manage_account(uuid,uuid,text) from public,anon,authenticated,service_role;

create or replace function public.dashboard_account_action_allowed(p_target uuid,p_permission text)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if not private.application_current_session_allowed('dashboard') then raise exception using errcode='42501',message='application_session_denied';end if;
 return private.dashboard_actor_can_manage_account(auth.uid(),p_target,p_permission);
end;$$;
revoke all on function public.dashboard_account_action_allowed(uuid,text) from public,anon,service_role;
grant execute on function public.dashboard_account_action_allowed(uuid,text) to authenticated;

-- Modify only the audited production functions; retain ownership, ACL and attributes.
do $migration$
declare p record;v_new text;v_after record;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_role_catalog()');
 if not found or p.proowner<>(select oid from pg_roles where rolname=current_user)
  or md5(p.prosrc)<>'aa865d4b6f35a1bec1801643e86b1916' then raise exception 'delegated_role_catalog_drift';end if;
 v_new:=replace(p.prosrc,$old$"id":"ip","moduleId":"system","moduleLabel":"系统管理后台","label":"IP 白名单","actions":[{"id":"view","label":"查看目录与页面"}]$old$,
 $new$"id":"ip","moduleId":"system","moduleLabel":"系统管理后台","label":"IP 白名单","actions":[{"id":"view","label":"查看目录与页面"},{"id":"edit","label":"新增 / 修改 IP 白名单","sensitive":true}]$new$);
 v_new:=replace(v_new,'{"key":"ip.view"}','{"key":"ip.view"},{"key":"ip.edit"}');
 if v_new=p.prosrc then raise exception 'delegated_role_catalog_anchor';end if;
 execute replace(pg_get_functiondef(p.oid),p.prosrc,v_new);
 select proacl,proowner into v_after from pg_proc where oid=p.oid;
 if v_after.proacl is distinct from p.proacl or v_after.proowner<>p.proowner then raise exception 'delegated_role_catalog_acl_drift';end if;
 select * into p from pg_proc where oid=to_regprocedure('public.dashboard_role_manage(jsonb)');
 if not found or p.proowner<>(select oid from pg_roles where rolname=current_user)
  or md5(p.prosrc)<>'3712489a82237d24bf4aa6c8e5c97ef7' then raise exception 'delegated_role_manage_drift';end if;
 v_new:=p.prosrc;
 v_new:=replace(v_new,$old$ if not found or actor.active is not true or actor.role is distinct from 'owner' then raise exception using errcode='42501',message='owner_required';end if;$old$,
 $new$ if not private.application_current_session_allowed('dashboard') then raise exception using errcode='42501',message='application_session_denied';end if;
 if not found or not private.dashboard_actor_has_permission(auth.uid(),'access.view') then raise exception using errcode='42501',message='role_management_denied';end if;$new$);
 v_new:=replace(v_new,$old$ op:=p_request->>'operation';$old$,$new$ op:=p_request->>'operation';
 if op<>'list' and (not private.dashboard_actor_has_permission(auth.uid(),'access.edit')
  or op<>'assign' and actor.role<>'owner') then raise exception using errcode='42501',message='role_management_denied';end if;$new$);
 v_new:=replace(v_new,$old$(select id,name,description,permissions,active,version,created_at,updated_at from private.dashboard_roles) x)$old$,
 $new$(select r0.id,r0.name,r0.description,r0.permissions,r0.active,r0.version,r0.created_at,r0.updated_at from private.dashboard_roles r0
  where actor.role='owner'
   or not exists(select 1 from unnest(r0.permissions) k where exists(select 1 from jsonb_array_elements(private.dashboard_role_catalog()->'permissions') c where c->>'key'=k) and not private.dashboard_actor_has_permission(actor.auth_user_id,k))
   or exists(select 1 from private.dashboard_role_assignments a0 where a0.role_id=r0.id
    and (a0.auth_user_id=actor.auth_user_id or private.dashboard_actor_can_manage_account(actor.auth_user_id,a0.auth_user_id,'access.view')))) x)$new$);
 v_new:=replace(v_new,$old$left join private.dashboard_roles role_row on role_row.id=assignment_row.role_id),'[]'::jsonb));$old$,
 $new$left join private.dashboard_roles role_row on role_row.id=assignment_row.role_id
    where actor.role='owner' or p.auth_user_id=actor.auth_user_id
     or private.dashboard_actor_can_manage_account(actor.auth_user_id,p.auth_user_id,'access.view')),'[]'::jsonb));$new$);
 v_new:=replace(v_new,$old$ if not found or coalesce(target.role,'') not in ('admin','viewer') then raise exception using errcode='42501',message='assignment_target_denied';end if;$old$,
 $new$ if not found or not private.dashboard_actor_can_manage_account(actor.auth_user_id,aid,'access.edit') then raise exception using errcode='42501',message='assignment_target_denied';end if;$new$);
 v_new:=replace(v_new,$old$ if not found or not r.active then raise exception using errcode='22023',message='role_unavailable';end if;$old$,
 $new$ if not found or not r.active then raise exception using errcode='22023',message='role_unavailable';end if;
 if actor.role<>'owner' and exists(select 1 from unnest(r.permissions) k where exists(select 1 from jsonb_array_elements(private.dashboard_role_catalog()->'permissions') c where c->>'key'=k) and not private.dashboard_actor_has_permission(actor.auth_user_id,k))
  then raise exception using errcode='42501',message='role_grant_exceeds_actor';end if;$new$);
 if v_new=p.prosrc or position('role_grant_exceeds_actor' in v_new)=0
  or position('private.dashboard_actor_can_manage_account(actor.auth_user_id,p.auth_user_id' in v_new)=0
 then raise exception 'delegated_role_manage_anchor';end if;
 execute replace(pg_get_functiondef(p.oid),p.prosrc,v_new);
 select proacl,proowner into v_after from pg_proc where oid=p.oid;
 if v_after.proacl is distinct from p.proacl or v_after.proowner<>p.proowner then raise exception 'delegated_role_manage_acl_drift';end if;
end;$migration$;
commit;
