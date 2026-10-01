-- Create a configured backend account from a real live role. Auth provisioning
-- happens at Edge; this private ticket serializes commit versus compensating
-- cleanup. It stores no password, access token, or credential material.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
declare expected record; p pg_proc%rowtype;
begin
 for expected in select * from (values
  ('private.dashboard_data_scope_valid(jsonb)','8181a85c7a5cf540e702f0d450be4fec',false,'i','{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
  ('private.dashboard_actor_data_scope(uuid)','6aea54272cce92c636a3561d09ef7eb9',true,'s','{postgres=X/postgres}'),
  ('private.dashboard_actor_has_permission(uuid,text)','521f6ddf83e501aa3bfeb89aa161b605',true,'s','{postgres=X/postgres}'),
  ('private.dashboard_role_permissions_valid(jsonb)','953c7976534b1936849a40fabf83d75a',false,'s','{postgres=X/postgres}'),
  ('private.application_session_allowed(uuid,uuid,text)','4e92bdf9dd6365b45f0b4f24814030a4',true,'s','{postgres=X/postgres}')
 ) x(signature,body_hash,secdef,volatility,acl) loop
  select * into p from pg_proc where oid=to_regprocedure(expected.signature);
  if not found or md5(p.prosrc)<>expected.body_hash or pg_get_userbyid(p.proowner)<>'postgres'
    or p.prosecdef is distinct from expected.secdef or p.provolatile::text<>expected.volatility or p.proacl::text is distinct from expected.acl or p.proconfig is distinct from array['search_path=""']::text[]
    then raise exception 'role_account_source_contract_drift: %',expected.signature;end if;
 end loop;
 if to_regclass('private.dashboard_account_creation_tickets') is not null
   or to_regprocedure('public.dashboard_create_role_account(uuid,uuid,jsonb)') is not null
   or to_regprocedure('private.dashboard_role_creation_authorize(uuid,uuid,uuid,bigint,jsonb)') is not null
   then raise exception 'role_account_creation_object_exists';end if;
end $preflight$;

create table private.dashboard_account_creation_tickets (
 id uuid primary key, actor_id uuid not null,
 username text not null check(username ~ '^[a-z0-9._-]{3,32}$'),
 role_id uuid not null, role_version bigint not null check(role_version>=1),
 role_permissions text[] not null, data_scope jsonb not null,
 status text not null default 'prepared' check(status in ('prepared','committed','aborted')),
 target_id uuid, result jsonb, created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check((status='prepared' and result is null) or status<>'prepared')
);
alter table private.dashboard_account_creation_tickets enable row level security;
revoke all on private.dashboard_account_creation_tickets from public,anon,authenticated,service_role;

create function private.dashboard_role_creation_authorize(p_actor uuid,p_session uuid,p_role uuid,p_version bigint,p_scope jsonb)
returns void language plpgsql volatile security definer set search_path='' as $$
declare actor public.dashboard_profiles%rowtype; actor_assignment private.dashboard_role_assignments%rowtype;
 r private.dashboard_roles%rowtype; actor_scope jsonb; permission text;
begin
 if not coalesce(private.application_session_allowed(p_actor,p_session,'dashboard'),false) then
  raise exception using errcode='42501',message='application_session_denied';end if;
 select * into actor from public.dashboard_profiles where auth_user_id=p_actor for share;
 if not found or actor.active is not true or actor.role not in ('owner','admin','viewer') then
  raise exception using errcode='42501',message='actor_profile_denied';end if;
 if actor.role<>'owner' then
  select * into actor_assignment from private.dashboard_role_assignments where auth_user_id=p_actor for share;
  if not found then raise exception using errcode='42501',message='assigned_actor_required';end if;
  perform 1 from private.dashboard_roles where id=actor_assignment.role_id for share;
  perform 1 from public.dashboard_admin_preview_grants where auth_user_id=p_actor for share;
  if not private.dashboard_actor_has_permission(p_actor,'access.view')
   or not private.dashboard_actor_has_permission(p_actor,'access.create')
   or not private.dashboard_actor_has_permission(p_actor,'access.edit') then
    raise exception using errcode='42501',message='role_creation_denied';end if;
 end if;
 if not coalesce(private.dashboard_data_scope_valid(p_scope),false)
   or (select array_agg(key order by key) from jsonb_object_keys(p_scope) key) is distinct from array['countries','mode']::text[]
   or (select count(*)<>count(distinct value) from jsonb_array_elements_text(p_scope->'countries')) then
  raise exception using errcode='22023',message='invalid_data_scope';end if;
 actor_scope:=private.dashboard_actor_data_scope(p_actor);
 if actor_scope->>'mode'<>'all' and (p_scope->>'mode'<>'selected' or not ((p_scope->'countries') <@ (actor_scope->'countries'))) then
  raise exception using errcode='42501',message='data_scope_exceeds_actor';end if;
 select * into r from private.dashboard_roles where id=p_role for share;
 if not found or r.active is not true or not private.dashboard_role_permissions_valid(to_jsonb(r.permissions)) then
  raise exception using errcode='22023',message='role_unavailable';end if;
 if r.version is distinct from p_version then raise exception using errcode='40001',message='role_version_conflict';end if;
 if actor.role<>'owner' then
  foreach permission in array r.permissions loop
   if not private.dashboard_actor_has_permission(p_actor,permission) then
    raise exception using errcode='42501',message='role_grant_exceeds_actor';end if;
  end loop;
 end if;
end;$$;
revoke all on function private.dashboard_role_creation_authorize(uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;

create function public.dashboard_create_role_account(p_actor uuid,p_session_id uuid,p_request jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare op text; creation_id uuid; role_id uuid; requested_version bigint; account_id uuid;
 t private.dashboard_account_creation_tickets%rowtype; r private.dashboard_roles%rowtype;
 u auth.users%rowtype; account jsonb; response jsonb;
begin
 if p_actor is null or p_session_id is null or not coalesce(private.application_session_allowed(p_actor,p_session_id,'dashboard'),false) then
  raise exception using errcode='42501',message='application_session_denied';end if;
 if jsonb_typeof(p_request) is distinct from 'object' then raise exception using errcode='22023',message='invalid_creation_request';end if;
 op:=p_request->>'operation';
 if op not in ('prepare','commit','abort') or op is null
  or jsonb_typeof(p_request->'creationId') is distinct from 'string'
  or coalesce(p_request->>'creationId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception using errcode='22023',message='invalid_creation_request';end if;
 creation_id:=(p_request->>'creationId')::uuid;
 if op='prepare' then
  if (select array_agg(key order by key) from jsonb_object_keys(p_request) key) is distinct from
    array['creationId','dataScope','expectedRoleVersion','operation','roleId','username']::text[]
    or jsonb_typeof(p_request->'username') is distinct from 'string' or coalesce(p_request->>'username','') !~ '^[a-z0-9._-]{3,32}$'
    or jsonb_typeof(p_request->'roleId') is distinct from 'string'
    or coalesce(p_request->>'roleId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p_request->'expectedRoleVersion') is distinct from 'number'
    or coalesce(p_request->>'expectedRoleVersion','') !~ '^[1-9][0-9]{0,14}$' then
   raise exception using errcode='22023',message='invalid_creation_request';end if;
  role_id:=(p_request->>'roleId')::uuid;requested_version:=(p_request->>'expectedRoleVersion')::bigint;
  perform private.dashboard_role_creation_authorize(p_actor,p_session_id,role_id,requested_version,p_request->'dataScope');
  if exists(select 1 from public.dashboard_profiles where username=p_request->>'username')
    or exists(select 1 from auth.users where lower(email)=(p_request->>'username')||'@hensem.local') then
   raise exception using errcode='23505',message='account_exists';end if;
  select * into r from private.dashboard_roles where id=role_id;
  insert into private.dashboard_account_creation_tickets(id,actor_id,username,role_id,role_version,role_permissions,data_scope)
   values(creation_id,p_actor,p_request->>'username',role_id,requested_version,r.permissions,p_request->'dataScope');
  return jsonb_build_object('ok',true,'status','prepared','creation_id',creation_id,'username',p_request->>'username',
   'role_id',role_id,'role_version',requested_version,'data_scope',p_request->'dataScope');
 end if;
 if (select array_agg(key order by key) from jsonb_object_keys(p_request) key) is distinct from array['accountId','creationId','operation']::text[]
  or jsonb_typeof(p_request->'accountId') is distinct from 'string'
  or coalesce(p_request->>'accountId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception using errcode='22023',message='invalid_creation_request';end if;
 account_id:=(p_request->>'accountId')::uuid;
 select * into t from private.dashboard_account_creation_tickets where id=creation_id for update;
 if not found or t.actor_id is distinct from p_actor or account_id=p_actor
  or t.target_id is not null and t.target_id is distinct from account_id then
  raise exception using errcode='42501',message='creation_ticket_denied';end if;
 -- Return the original atomic ACK, even if the role later changes. This permits
 -- safe recovery from a lost response without deleting a configured account.
 if t.status='committed' then return t.result;end if;
 if t.status='aborted' then
  if op='abort' then return t.result;end if;
  raise exception using errcode='40001',message='creation_ticket_aborted';end if;
 select * into u from auth.users where id=account_id for update;
 if not found or lower(u.email) is distinct from t.username||'@hensem.local'
  or u.raw_user_meta_data->>'dashboard_creation_id' is distinct from creation_id::text
  or u.raw_user_meta_data->>'username' is distinct from t.username
  or u.raw_user_meta_data->>'dashboard_role' is distinct from 'viewer'
  or u.created_at is null or u.created_at < t.created_at - interval '5 seconds'
  or exists(select 1 from public.dashboard_profiles where auth_user_id=account_id)
  or exists(select 1 from private.dashboard_role_assignments where auth_user_id=account_id)
  or exists(select 1 from public.dashboard_admin_preview_grants where auth_user_id=account_id)
  or exists(select 1 from public.workorder_portal_accounts where auth_user_id=account_id) then
  raise exception using errcode='42501',message='fresh_auth_account_required';end if;
 if op='abort' then
  response:=jsonb_build_object('ok',true,'status','aborted','creation_id',creation_id,'cleanup_user_id',account_id);
  update private.dashboard_account_creation_tickets set status='aborted',target_id=account_id,result=response,updated_at=clock_timestamp() where id=creation_id;
  return response;
 end if;
 if t.created_at < clock_timestamp()-interval '10 minutes' then raise exception using errcode='40001',message='creation_ticket_expired';end if;
 perform private.dashboard_role_creation_authorize(p_actor,p_session_id,t.role_id,t.role_version,t.data_scope);
 select * into r from private.dashboard_roles where id=t.role_id;
 if r.permissions is distinct from t.role_permissions then raise exception using errcode='40001',message='role_permissions_changed';end if;
 insert into public.dashboard_profiles(auth_user_id,username,role,active,permissions,management_permissions,data_scope,created_by)
  values(account_id,t.username,'viewer',true,'{"home":false,"third_party":false,"auto_withdraw":false,"work_orders":false,"customer_service":false}',
   '{"manage_viewers":false,"refresh_data":false,"view_audit":false}',t.data_scope,p_actor);
 insert into private.dashboard_role_assignments(auth_user_id,role_id,version,updated_by) values(account_id,t.role_id,1,p_actor);
 insert into public.dashboard_admin_preview_grants(auth_user_id,can_view,granted_by) values(account_id,true,p_actor);
 account:=jsonb_build_object('auth_user_id',account_id,'username',t.username,'role','viewer','active',true,'role_id',t.role_id,
  'role_name',r.name,'role_version',t.role_version,'assignment_version',1,'data_scope',t.data_scope);
 response:=jsonb_build_object('ok',true,'status','committed','creation_id',creation_id,'account',account);
 insert into private.dashboard_role_audit(actor_id,operation,entity_id,after_value) values(p_actor,'create-account',account_id,account);
 insert into public.dashboard_audit_log(actor_user_id,actor_username,action,target_username,details)
  select p_actor,username,'create_role_account',t.username,jsonb_build_object('role_id',t.role_id,'role_name',r.name,'role_version',t.role_version,'data_scope',t.data_scope)
  from public.dashboard_profiles where auth_user_id=p_actor;
 update private.dashboard_account_creation_tickets set status='committed',target_id=account_id,result=response,updated_at=clock_timestamp() where id=creation_id;
 return response;
end;$$;
revoke all on function public.dashboard_create_role_account(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dashboard_create_role_account(uuid,uuid,jsonb) to service_role;
comment on function public.dashboard_create_role_account(uuid,uuid,jsonb) is 'Service-only live role account creation; prepared/committed/aborted ticket serialization protects Auth cleanup.';
commit;
