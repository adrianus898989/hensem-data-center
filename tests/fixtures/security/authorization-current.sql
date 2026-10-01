CREATE OR REPLACE FUNCTION public.dashboard_has_permission(permission_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select private.dashboard_role_legacy_allowed() and (select exists (
    select 1
    from public.dashboard_profiles p
    where p.auth_user_id = auth.uid()
      and p.active = true
      and (
        p.role = 'owner'
        or coalesce((p.permissions ->> permission_key)::boolean, false) = true
      )
  ));
$function$;

CREATE OR REPLACE FUNCTION private.dashboard_current_data_scope()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile public.dashboard_profiles%rowtype;
  v_scope jsonb;
begin
  select * into v_profile from public.dashboard_profiles where auth_user_id = (select auth.uid()) and active = true;
  if not found then return '{"mode":"selected","countries":[]}'::jsonb; end if;
  if v_profile.role = 'owner' then return '{"mode":"all","countries":[]}'::jsonb; end if;
  v_scope := v_profile.data_scope;
  if not private.dashboard_data_scope_valid(v_scope) then return '{"mode":"selected","countries":[]}'::jsonb; end if;
  if v_scope->>'mode' = 'all' then return '{"mode":"all","countries":[]}'::jsonb; end if;
  return jsonb_build_object('mode','selected','countries',(
    select jsonb_agg(value order by value) from (select distinct value from jsonb_array_elements_text(v_scope->'countries')) as keys
  ));
end;
$function$;

CREATE OR REPLACE FUNCTION private.dashboard_admin_live_scope()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := (select auth.uid()); v_profile public.dashboard_profiles%rowtype;
begin
  perform private.dashboard_role_require_gateway(); -- assigned-role signed gateway
  if v_user is null then raise exception using errcode='28000',message='login_required'; end if;
  select * into v_profile from public.dashboard_profiles where auth_user_id=v_user;
  if not found or v_profile.active is not true or coalesce(v_profile.role,'') not in ('owner','admin','viewer') then
    raise exception using errcode='42501',message='preview_denied';
  end if;
  if v_profile.role<>'owner' and not exists(select 1 from public.dashboard_admin_preview_grants
      where auth_user_id=v_user and can_view is true) then
    raise exception using errcode='42501',message='preview_denied';
  end if;
  -- Fresh production scope, independent of the old third_party module grant.
  return private.dashboard_current_data_scope();
end;
$function$;
