-- Scope edits alone use one service-only authorization and CAS transaction.
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
do $guard$
begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.dashboard_actor_can_manage_account(uuid,uuid,text)')) is distinct from '38b69e2f4cb7dd0df7690e20c38020a5'
  or (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.dashboard_data_scope_valid(jsonb)')) is distinct from 'f4907d924afc6cb9021f5380bfe9df3c'
  or (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.dashboard_data_scope_subset(jsonb,jsonb)')) is distinct from '4a6b295a0b5e8219ca68d367523543a2' then raise exception 'atomic_scope_authority_drift';end if;
 if exists(select 1 from pg_proc where oid=any(array['private.dashboard_actor_can_manage_account(uuid,uuid,text)'::regprocedure,'private.dashboard_actor_data_scope(uuid)'::regprocedure,'private.dashboard_actor_has_permission(uuid,text)'::regprocedure,'private.application_session_allowed(uuid,uuid,text)'::regprocedure]) and (not prosecdef or proowner<>'postgres'::regrole or proconfig is distinct from array['search_path=""']::text[])) then raise exception 'atomic_scope_authority_metadata_drift';end if;
 if to_regprocedure('public.dashboard_update_account_data_scope(uuid,uuid,uuid,text,timestamptz,jsonb)') is not null then raise exception 'atomic_scope_setter_exists';end if;
end $guard$;
create function public.dashboard_update_account_data_scope(p_actor uuid,p_session_id uuid,p_target uuid,p_expected_role text,p_expected_updated_at timestamptz,p_scope jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $setter$
declare actor public.dashboard_profiles%rowtype;target public.dashboard_profiles%rowtype;role_id uuid;updated timestamptz;
begin
 if p_actor is null or p_session_id is null or p_target is null or p_expected_updated_at is null
  or not isfinite(p_expected_updated_at) or p_expected_role is null or p_expected_role not in('admin','viewer')
  or not private.dashboard_data_scope_valid(p_scope) or octet_length(p_scope::text)>131072 then
  raise exception using errcode='22023',message='invalid_account_scope_update';end if;
 -- Hold the original registration and the actor's authority against revocation.
 perform 1 from private.application_sessions where session_id=p_session_id and user_id=p_actor and surface='dashboard' and revoked_at is null for share;
 if not found then raise exception using errcode='42501',message='application_session_denied';end if;
 perform 1 from auth.sessions where id=p_session_id and user_id=p_actor for share;
 if not found then raise exception using errcode='42501',message='application_session_denied';end if;
 select * into actor from public.dashboard_profiles where auth_user_id=p_actor for share;
 if not found or actor.active is not true or actor.role not in('owner','admin','viewer') then raise exception using errcode='42501',message='actor_profile_denied';end if;
 select a.role_id into role_id from private.dashboard_role_assignments a where a.auth_user_id=p_actor for share;
 if found then perform 1 from private.dashboard_roles where id=role_id for share;end if;
 perform 1 from public.dashboard_admin_preview_grants where auth_user_id=p_actor for share;
 if not coalesce(private.application_session_allowed(p_actor,p_session_id,'dashboard'),false) then raise exception using errcode='42501',message='application_session_denied';end if;
 select * into target from public.dashboard_profiles where auth_user_id=p_target for update;
 if not found then raise exception using errcode='42501',message='account_scope_target_denied';end if;
 -- Target assignment and role permissions also remain stable through authorization.
 select a.role_id into role_id from private.dashboard_role_assignments a where a.auth_user_id=p_target for share;
 if found then perform 1 from private.dashboard_roles where id=role_id for share;end if;
 perform 1 from public.dashboard_admin_preview_grants where auth_user_id=p_target for share;
 if target.role is distinct from p_expected_role or target.updated_at is distinct from p_expected_updated_at then
  raise exception using errcode='40001',message='account_scope_version_conflict';end if;
 if not private.dashboard_actor_has_permission(p_actor,'access.view') or not private.dashboard_actor_can_manage_account(p_actor,p_target,'access.edit')
  or not private.dashboard_data_scope_subset(p_scope,private.dashboard_actor_data_scope(p_actor)) then
  raise exception using errcode='42501',message='account_scope_update_denied';end if;
 updated:=clock_timestamp();
 update public.dashboard_profiles set data_scope=p_scope,updated_at=updated where auth_user_id=p_target;
 insert into public.dashboard_audit_log(actor_user_id,actor_username,action,target_username,details)
 values(p_actor,actor.username,'update_account_data_scope',target.username,jsonb_build_object('before_scope',target.data_scope,'data_scope',p_scope));
 return jsonb_build_object('ok',true,'auth_user_id',target.auth_user_id,'username',target.username,'role',target.role,'data_scope',p_scope,'updated_at',updated);
end;
$setter$;
revoke all on function public.dashboard_update_account_data_scope(uuid,uuid,uuid,text,timestamptz,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dashboard_update_account_data_scope(uuid,uuid,uuid,text,timestamptz,jsonb) to service_role;
commit;
