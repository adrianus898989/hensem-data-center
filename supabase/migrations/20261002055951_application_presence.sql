-- Code-only presence sidecar. No new Auth identities, account grants, or login policy changes.
begin;
do $preflight$
declare r record; p pg_proc%rowtype;
begin
 for r in select * from (values
  ('private.application_session_allowed(uuid,uuid,text)','4e92bdf9dd6365b45f0b4f24814030a4',true,'s'),
  ('private.application_ip_allowed(text,inet,uuid)','c6a2ebc5c0705887a4aa4e0d5c1840bf',true,'s'),
  ('private.dashboard_actor_data_scope(uuid)','6aea54272cce92c636a3561d09ef7eb9',true,'s'),
  ('private.dashboard_actor_has_permission(uuid,text)','521f6ddf83e501aa3bfeb89aa161b605',true,'s'),
  ('private.application_account_exists(uuid,text,boolean)','a4c5e2ee9c8cd661625e10e30ef6b520',true,'s'),
  ('private.application_ip_allowed(text,inet)','19a4d71a64e2e4868a2c417bb4379983',true,'s'),
  ('private.application_network(text)','72874d34b25ca777e6931e2c25d6decc',false,'i')
 ) expected(signature,body_md5,secdef,volatility) loop
  select * into p from pg_proc where oid=to_regprocedure(r.signature);
  if not found or md5(p.prosrc) is distinct from r.body_md5 or p.proowner<>'postgres'::regrole
   or p.prosecdef is distinct from r.secdef or p.provolatile::text is distinct from r.volatility or p.proconfig is distinct from array['search_path=""']
   or p.proacl::text is distinct from '{postgres=X/postgres}' then
   raise exception 'presence_source_contract_drift: %',r.signature;
  end if;
 end loop;
 if to_regclass('private.application_presence_sessions') is not null
  or to_regprocedure('private.application_presence_scope(uuid)') is not null
  or to_regprocedure('public.application_dashboard_presence(uuid,uuid,text,text)') is not null then
  raise exception 'presence_objects_already_exist';
 end if;
end $preflight$;

create table private.application_presence_sessions (
 session_id uuid not null references private.application_sessions(session_id) on delete cascade,
 surface text not null check(surface='dashboard'),
 user_id uuid not null references public.dashboard_profiles(auth_user_id) on delete cascade,
 current_ip inet not null check(masklen(current_ip)=case family(current_ip) when 4 then 32 else 128 end),
 last_seen_at timestamptz not null,
 active boolean not null default true,
 primary key(session_id,surface)
);
create index application_presence_seen_idx on private.application_presence_sessions(last_seen_at);
alter table private.application_presence_sessions enable row level security;
revoke all on private.application_presence_sessions from public,anon,authenticated,service_role;

-- Canonical server scope + live assigned role. Never trust token metadata,
-- cached browser profile, or a base viewer label as the assigned role.
create function private.application_presence_scope(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $scope$
declare p public.dashboard_profiles%rowtype; s jsonb;
begin
 select * into p from public.dashboard_profiles where auth_user_id=p_user;
 if not found or p.active is not true or p.role not in ('owner','admin','viewer') then return null;end if;
 if p.role<>'owner' and exists(select 1 from private.dashboard_role_assignments where auth_user_id=p_user)
  and not exists(select 1 from private.dashboard_role_assignments a join private.dashboard_roles r on r.id=a.role_id
   where a.auth_user_id=p_user and r.active is true) then return null;end if;
 s:=private.dashboard_actor_data_scope(p_user);
 if s->>'mode'='all' and s->'countries'='[]'::jsonb then return s;end if;
 if s->>'mode'='selected' and jsonb_typeof(s->'countries')='array' and jsonb_array_length(s->'countries')>0 then return s;end if;
 return null;
end $scope$;
revoke all on function private.application_presence_scope(uuid) from public,anon,authenticated,service_role;

-- Invoked only by the verified Edge gateway using its service client. Private
-- tables have no service_role ACL; this definer is the single bounded API.
create function public.application_dashboard_presence(p_actor uuid,p_session_id uuid,p_ip text,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $presence$
declare v_now timestamptz:=clock_timestamp(); v_ip inet; v_scope jsonb; v_response jsonb;
 v_count integer; v_accounts jsonb; v_list boolean;
begin
 if p_action is null or p_action not in ('heartbeat','status','leave') or p_actor is null or p_session_id is null then
  raise exception using errcode='22023',message='invalid_presence_request';end if;
 -- Lock the original registration against concurrent logout/revocation. This
 -- never creates an Auth/application session or changes its login address.
 perform 1 from private.application_sessions where session_id=p_session_id and user_id=p_actor
  and surface='dashboard' and revoked_at is null for share;
 if not found or not coalesce(private.application_session_allowed(p_actor,p_session_id,'dashboard'),false) then
  raise exception using errcode='42501',message='application_session_denied';end if;
 begin v_ip:=p_ip::inet;exception when invalid_text_representation then
  raise exception using errcode='22023',message='invalid_presence_request';end;
 if v_ip is null or masklen(v_ip)<>(case family(v_ip) when 4 then 32 else 128 end) then
  raise exception using errcode='22023',message='invalid_presence_request';end if;
 if not coalesce(private.application_ip_allowed('dashboard',v_ip,p_actor),false) then
  raise exception using errcode='42501',message='ip_denied';end if;
 v_scope:=private.application_presence_scope(p_actor);
 if v_scope is null then raise exception using errcode='42501',message='presence_account_denied';end if;

 if p_action='heartbeat' then
  insert into private.application_presence_sessions as old(session_id,surface,user_id,current_ip,last_seen_at,active)
   values(p_session_id,'dashboard',p_actor,v_ip,v_now,true)
  on conflict(session_id,surface) do update set current_ip=excluded.current_ip,
   last_seen_at=greatest(old.last_seen_at,excluded.last_seen_at),active=true
   where old.user_id=excluded.user_id and (old.active is not true or old.current_ip is distinct from excluded.current_ip
    or old.last_seen_at<=excluded.last_seen_at-interval '10 seconds');
  delete from private.application_presence_sessions where last_seen_at<v_now-interval '1 day';
 elsif p_action='leave' then
  update private.application_presence_sessions set active=false where session_id=p_session_id and surface='dashboard' and user_id=p_actor;
 end if;

 -- Recheck original Auth registration, fresh account/role and both canonical
 -- login IP and last observed current IP. Multiple pages/devices count once.
 with recent as materialized (
  select h.user_id,max(h.last_seen_at) last_seen_at from private.application_presence_sessions h
  where h.surface='dashboard' and h.active and h.last_seen_at>v_now-interval '120 seconds' and h.last_seen_at<=v_now
   and private.application_session_allowed(h.user_id,h.session_id,'dashboard')
   and private.application_ip_allowed('dashboard',h.current_ip,h.user_id)
  group by h.user_id
 ), visible as materialized (
  select p.username,h.last_seen_at from recent h join public.dashboard_profiles p on p.auth_user_id=h.user_id
  cross join lateral (select private.application_presence_scope(h.user_id) value) target
  where target.value is not null and (h.user_id=p_actor or v_scope->>'mode'='all'
   or (target.value->>'mode'='selected' and (target.value->'countries') <@ (v_scope->'countries')))
  order by p.username collate "C" limit 501
 ) select count(*)::integer,coalesce(jsonb_agg(jsonb_build_object('username',username,'lastSeenAt',last_seen_at) order by username collate "C"),'[]'::jsonb)
  into v_count,v_accounts from visible;
 if v_count>500 then raise exception using errcode='54000',message='presence_roster_limit';end if;
 v_list:=coalesce(private.dashboard_actor_has_permission(p_actor,'access.view'),false);
 v_response:=jsonb_build_object('ok',true,'onlineCount',v_count,'observedAt',v_now,
  'windowSeconds',120,'heartbeatSeconds',30,'scope','authorized');
 if v_list then v_response:=v_response||jsonb_build_object('accounts',v_accounts);end if;
 return v_response;
end $presence$;
revoke all on function public.application_dashboard_presence(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.application_dashboard_presence(uuid,uuid,text,text) to service_role;
comment on function public.application_dashboard_presence(uuid,uuid,text,text) is 'Service-only dashboard presence; verified actor/session/current IP, server timestamps, distinct account scope, no employee portal mixing.';
notify pgrst,'reload schema';
commit;
