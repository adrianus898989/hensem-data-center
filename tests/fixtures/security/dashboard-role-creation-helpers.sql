-- Read-only production helper definitions captured 2026-10-01; no user or credential rows.
CREATE OR REPLACE FUNCTION private.dashboard_data_scope_valid(p_scope jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
  if p_scope is null or jsonb_typeof(p_scope) is distinct from 'object'
     or jsonb_typeof(p_scope->'countries') is distinct from 'array' then return false; end if;
  if p_scope->>'mode' = 'all' then return jsonb_array_length(p_scope->'countries') = 0; end if;
  if p_scope->>'mode' is distinct from 'selected'
     or jsonb_array_length(p_scope->'countries') = 0 then return false; end if;
  return not exists (
    select 1 from jsonb_array_elements(p_scope->'countries') as entry(value)
    where jsonb_typeof(value) is distinct from 'string'
       or (value #>> '{}') <> all (array[
         'BR_PANGHU','BR','IN','PK','ID','VN','PH','MY','MM','NG','CO','MX','CL','SA','BR_NATIVE','USDT',
         'HK_TEAM','RED_CRAB'
       ]::text[])
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.dashboard_actor_data_scope(p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.dashboard_profiles%rowtype;
begin
 select * into p from public.dashboard_profiles where auth_user_id=p_actor;
 if not found or p.active is not true or p.role not in ('owner','admin','viewer') then return '{"mode":"selected","countries":[]}'::jsonb;end if;
 if p.role='owner' then return '{"mode":"all","countries":[]}'::jsonb;end if;
 if not coalesce(private.dashboard_data_scope_valid(p.data_scope),false) then return '{"mode":"selected","countries":[]}'::jsonb;end if;
 return p.data_scope;
end;$function$;

CREATE OR REPLACE FUNCTION private.dashboard_actor_has_permission(p_actor uuid, p_permission text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end;$function$;

CREATE OR REPLACE FUNCTION private.application_session_allowed(p_user uuid, p_session uuid, p_surface text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select private.application_account_exists(p_user,p_surface,true)
 and not exists(select 1 from private.application_account_security where user_id=p_user and surface=p_surface and locked_at is not null)
 and exists(select 1 from private.application_sessions s join auth.sessions a on a.id=s.session_id and a.user_id=s.user_id
   where s.session_id=p_session and s.user_id=p_user and s.surface=p_surface and s.revoked_at is null
   and (a.not_after is null or a.not_after>now()) and private.application_ip_allowed(p_surface,s.login_ip,p_user));
$function$;

CREATE OR REPLACE FUNCTION private.dashboard_role_permissions_valid(p_permissions jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if jsonb_typeof(p_permissions) is distinct from 'array' then return false;end if;
 return jsonb_array_length(p_permissions)<=500
 and not exists(select 1 from jsonb_array_elements(p_permissions) p where jsonb_typeof(p)<>'string'
   or not exists(select 1 from jsonb_array_elements(private.dashboard_role_catalog()->'permissions') c where c->>'key'=p#>>'{}'))
 and (select count(*)=count(distinct value) from jsonb_array_elements_text(p_permissions))
 and not exists(select 1 from jsonb_array_elements_text(p_permissions) p where right(p,5)<>'.view' and not p_permissions ? (split_part(p,'.',1)||'.view'));
end;$function$;

revoke all on function private.dashboard_actor_data_scope(uuid),private.dashboard_actor_has_permission(uuid,text),private.application_session_allowed(uuid,uuid,text),private.dashboard_role_permissions_valid(jsonb),private.dashboard_data_scope_valid(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.dashboard_data_scope_valid(jsonb) to authenticated,service_role;
