-- Application-only login gate. Apply after deploying gateway/consumers, in a
-- maintenance cutover. This PREPARE file does not activate the global REST gate.
-- Apply application-login-security-activate.sql only after gateways/clients are ready.
-- No credentials, tokens or passwords are persisted by this schema.
begin;
create schema if not exists private;
create table if not exists private.application_security_policies (
 surface text primary key check(surface in ('dashboard','workorder')),
 failure_limit integer not null default 5 check(failure_limit between 1 and 20),
 ip_enabled boolean not null default false,
 version integer not null default 1,
 updated_at timestamptz not null default now()
);
insert into private.application_security_policies(surface) values('dashboard'),('workorder') on conflict do nothing;
-- Dashboard keeps its existing authoritative whitelist and enable flag.
alter table public.dashboard_security_settings add column if not exists security_version integer not null default 1;
alter table public.dashboard_ip_whitelist add column if not exists security_version integer not null default 1;
create table if not exists private.workorder_ip_rules (
 id bigint generated always as identity primary key, network cidr not null unique,
 note text not null default '' check(length(note)<=100), active boolean not null default true,
 version integer not null default 1, updated_at timestamptz not null default now()
);
create table if not exists private.application_account_security (
 user_id uuid not null references auth.users(id) on delete cascade,
 surface text not null references private.application_security_policies(surface),
 failure_limit integer check(failure_limit between 1 and 20),
 failed_count integer not null default 0 check(failed_count>=0),
 locked_at timestamptz, version integer not null default 1, auth_epoch integer not null default 1,
 primary key(user_id,surface)
);
create table if not exists private.application_sessions (
 session_id uuid primary key references auth.sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 surface text not null references private.application_security_policies(surface),
 login_ip inet not null, registered_at timestamptz not null default now(), revoked_at timestamptz
);
create index if not exists application_sessions_account_idx on private.application_sessions(user_id,surface) where revoked_at is null;
create table if not exists private.application_login_attempts (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 surface text not null, client_ip inet not null, created_at timestamptz not null default now(),
 auth_epoch integer not null, finished_at timestamptz, result text check(result in ('valid','invalid','unavailable'))
);
create index if not exists application_attempt_pending_idx on private.application_login_attempts(user_id,surface,created_at) where finished_at is null;
create table if not exists private.application_security_audit (
 id bigint generated always as identity primary key, at timestamptz not null default now(),
 actor_id uuid, surface text not null, action text not null, target_id uuid,
 details jsonb not null default '{}'
);
alter table private.application_security_policies enable row level security;
alter table private.workorder_ip_rules enable row level security;
alter table private.application_account_security enable row level security;
alter table private.application_sessions enable row level security;
alter table private.application_login_attempts enable row level security;
alter table private.application_security_audit enable row level security;
revoke all on private.application_security_policies,private.workorder_ip_rules,private.application_account_security,private.application_sessions,private.application_login_attempts,private.application_security_audit from public,anon,authenticated;

create or replace function private.application_account_exists(p_user uuid,p_surface text,p_active boolean default true)
returns boolean language sql stable security definer set search_path='' as $$
 select case when p_surface='dashboard' then exists(select 1 from public.dashboard_profiles p join auth.users u on u.id=p.auth_user_id
  where p.auth_user_id=p_user and (not p_active or p.active) and p.role in ('owner','admin','viewer')
  and lower(u.email)=lower(p.username)||'@hensem.local'
  and not exists(select 1 from public.workorder_portal_accounts w where w.auth_user_id=p_user))
 when p_surface='workorder' then exists(select 1 from public.workorder_portal_accounts w join auth.users u on u.id=w.auth_user_id
  where w.auth_user_id=p_user and (not p_active or w.active) and w.role in ('supervisor','agent','auditor')
  and lower(u.email)=lower(w.username)||'@workorder.hensem.local'
  and not exists(select 1 from public.dashboard_profiles p where p.auth_user_id=p_user)) else false end;
$$;
create or replace function private.application_network(p_text text) returns cidr language plpgsql immutable set search_path='' as $$
declare n cidr;
begin
 if p_text is null or length(p_text)>80 or p_text<>btrim(p_text) then return null; end if;
 begin n:=network(p_text::inet); exception when invalid_text_representation then return null; end;
 if masklen(n)=0 then return null; end if;
 return n;
end $$;
create or replace function private.application_ip_allowed(p_surface text,p_ip inet)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare enabled boolean;
begin
 if p_ip is null or masklen(p_ip)<>(case family(p_ip) when 4 then 32 else 128 end) then return false; end if;
 if p_surface='dashboard' then
  select ip_whitelist_enabled into enabled from public.dashboard_security_settings where id=1;
  if enabled is null then return false; end if;
  return not enabled or exists(select 1 from public.dashboard_ip_whitelist r where r.active and p_ip <<= private.application_network(r.ip));
 elsif p_surface='workorder' then
  select ip_enabled into enabled from private.application_security_policies where surface=p_surface;
  return not coalesce(enabled,true) or exists(select 1 from private.workorder_ip_rules r where r.active and p_ip <<= r.network);
 end if;
 return false;
end $$;
create or replace function private.application_session_allowed(p_user uuid,p_session uuid,p_surface text)
returns boolean language sql stable security definer set search_path='' as $$
 select private.application_account_exists(p_user,p_surface,true)
 and not exists(select 1 from private.application_account_security where user_id=p_user and surface=p_surface and locked_at is not null)
 and exists(select 1 from private.application_sessions s join auth.sessions a on a.id=s.session_id and a.user_id=s.user_id
   where s.session_id=p_session and s.user_id=p_user and s.surface=p_surface and s.revoked_at is null
   and (a.not_after is null or a.not_after>now()) and private.application_ip_allowed(p_surface,s.login_ip));
$$;
create or replace function public.application_session_check(p_user_id uuid,p_session_id uuid,p_surface text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('allowed',private.application_session_allowed(p_user_id,p_session_id,p_surface),
  'code',case when private.application_session_allowed(p_user_id,p_session_id,p_surface) then 'ok' else 'application_session_denied' end);
$$;
create or replace function private.application_current_session_allowed(p_surface text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare sid uuid;
begin
 begin sid:=(auth.jwt()->>'session_id')::uuid; exception when invalid_text_representation then return false; end;
 return coalesce(private.application_session_allowed(auth.uid(),sid,p_surface),false);
end $$;
-- Authenticated callers may only check themselves; cannot register a session.
create or replace function public.application_session_guard()
returns boolean language sql stable security definer set search_path='' as $$ select private.application_current_session_allowed('dashboard'); $$;

create or replace function public.application_auth_begin(p_surface text,p_username text,p_ip text,p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid; email text; ip inet; st private.application_account_security%rowtype;
begin
 if p_surface not in ('dashboard','workorder') or p_username !~ '^[a-z0-9._-]{3,32}$' or p_attempt_id is null then
  return jsonb_build_object('allowed',false,'code','invalid_credentials'); end if;
 begin ip:=p_ip::inet; exception when invalid_text_representation then return jsonb_build_object('allowed',false,'code','ip_denied'); end;
 if not private.application_ip_allowed(p_surface,ip) then return jsonb_build_object('allowed',false,'code','ip_denied'); end if;
 select u.id,u.email into uid,email from auth.users u where lower(u.email)=p_username||case p_surface when 'dashboard' then '@hensem.local' else '@workorder.hensem.local' end;
 if uid is null or not private.application_account_exists(uid,p_surface,true) then return jsonb_build_object('allowed',false,'code','invalid_credentials'); end if;
 insert into private.application_account_security(user_id,surface) values(uid,p_surface) on conflict do nothing;
 select * into st from private.application_account_security where user_id=uid and surface=p_surface for update;
 if st.locked_at is not null then return jsonb_build_object('allowed',false,'code','account_locked'); end if;
 -- One outstanding password verification per account. It bounds races and
 -- prevents more concurrent attempts than the configured lockout threshold.
 if exists(select 1 from private.application_login_attempts where user_id=uid and surface=p_surface and finished_at is null and created_at>now()-interval '45 seconds') then
  return jsonb_build_object('allowed',false,'code','login_busy'); end if;
 insert into private.application_login_attempts(id,user_id,surface,client_ip,auth_epoch) values(p_attempt_id,uid,p_surface,ip,st.auth_epoch);
 return jsonb_build_object('allowed',true,'user_id',uid,'email',email);
end $$;
create or replace function public.application_auth_finish(p_attempt_id uuid,p_result text,p_session_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare att private.application_login_attempts%rowtype; st private.application_account_security%rowtype; lim integer;
begin
 select * into att from private.application_login_attempts where id=p_attempt_id;
 if not found then return jsonb_build_object('allowed',false,'code','attempt_invalid'); end if;
 select * into st from private.application_account_security where user_id=att.user_id and surface=att.surface for update;
 select * into att from private.application_login_attempts where id=p_attempt_id for update;
 if att.auth_epoch<>st.auth_epoch then update private.application_login_attempts set finished_at=now(),result='unavailable' where id=att.id and finished_at is null; return jsonb_build_object('allowed',false,'code','attempt_invalid'); end if;
 if att.finished_at is not null or att.created_at<now()-interval '45 seconds' or (p_result is null or p_result not in ('valid','invalid','unavailable')) then
  return jsonb_build_object('allowed',false,'code','attempt_invalid'); end if;
 update private.application_login_attempts set finished_at=now(),result=p_result where id=p_attempt_id;
 if p_result='unavailable' then return jsonb_build_object('allowed',false,'code','auth_unavailable'); end if;
 if st.locked_at is not null or not private.application_account_exists(att.user_id,att.surface,true) then return jsonb_build_object('allowed',false,'code','account_locked'); end if;
 select coalesce(st.failure_limit,failure_limit) into lim from private.application_security_policies where surface=att.surface;
 if p_result='invalid' then
  update private.application_account_security set failed_count=failed_count+1,
   locked_at=case when failed_count+1>=lim then now() else null end,version=version+1
   where user_id=att.user_id and surface=att.surface returning * into st;
  if st.locked_at is not null then
   update private.application_sessions set revoked_at=now() where user_id=att.user_id and surface=att.surface and revoked_at is null;
   insert into private.application_security_audit(surface,action,target_id) values(att.surface,'automatic-lock',att.user_id);
  end if;
  return jsonb_build_object('allowed',false,'code',case when st.locked_at is null then 'invalid_credentials' else 'account_locked' end);
 end if;
 if p_session_id is null or not exists(select 1 from auth.sessions where id=p_session_id and user_id=att.user_id and (not_after is null or not_after>now()))
  or not private.application_ip_allowed(att.surface,att.client_ip) then return jsonb_build_object('allowed',false,'code','application_session_denied'); end if;
 insert into private.application_sessions(session_id,user_id,surface,login_ip) values(p_session_id,att.user_id,att.surface,att.client_ip) on conflict do nothing;
 if not private.application_session_allowed(att.user_id,p_session_id,att.surface) then return jsonb_build_object('allowed',false,'code','application_session_denied'); end if;
 update private.application_account_security set failed_count=0,version=version+1 where user_id=att.user_id and surface=att.surface;
 return jsonb_build_object('allowed',true,'code','ok');
end $$;
create or replace function public.application_auth_ip_check(p_surface text,p_ip text)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin return private.application_ip_allowed(p_surface,p_ip::inet); exception when invalid_text_representation then return false; end $$;

create or replace function public.application_revoke_user_sessions(p_user_id uuid,p_surface text)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_surface not in ('dashboard','workorder') then raise exception using errcode='22023',message='invalid_surface'; end if;
 insert into private.application_account_security(user_id,surface) values(p_user_id,p_surface) on conflict do nothing;
 update private.application_account_security set auth_epoch=auth_epoch+1 where user_id=p_user_id and surface=p_surface;
 update private.application_login_attempts set finished_at=now(),result='unavailable' where user_id=p_user_id and surface=p_surface and finished_at is null;
 update private.application_sessions set revoked_at=now() where user_id=p_user_id and surface=p_surface and revoked_at is null;
 get diagnostics n=row_count; return n;
end $$;
create or replace function public.application_revoke_session(p_user_id uuid,p_session_id uuid,p_surface text)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 update private.application_sessions set revoked_at=now() where session_id=p_session_id and user_id=p_user_id and surface=p_surface and revoked_at is null;
 get diagnostics n=row_count; return n;
end $$;
-- Preserve the last manually active owner. Automatic lock state remains separate:
-- the last owner is still subject to the requested failed-password threshold.
create or replace function private.application_account_status_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
declare surface text:=case tg_table_name when 'dashboard_profiles' then 'dashboard' else 'workorder' end;
begin
 if tg_when='BEFORE' and surface='dashboard' and old.role='owner' and old.active and
  (tg_op='DELETE' or new.active is not true or new.role<>'owner') then
  perform pg_advisory_xact_lock(782594810);
  if not exists(select 1 from public.dashboard_profiles where auth_user_id<>old.auth_user_id and role='owner' and active) then
   raise exception using errcode='42501',message='last_owner_required';
  end if;
 elsif tg_when='AFTER' and (tg_op='DELETE' or old.active and new.active is not true) then
  perform public.application_revoke_user_sessions(old.auth_user_id,surface);
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
drop trigger if exists application_last_owner on public.dashboard_profiles;
create trigger application_last_owner before update or delete on public.dashboard_profiles for each row execute function private.application_account_status_trigger();
drop trigger if exists application_dashboard_disable on public.dashboard_profiles;
create trigger application_dashboard_disable after update on public.dashboard_profiles for each row execute function private.application_account_status_trigger();
drop trigger if exists application_workorder_disable on public.workorder_portal_accounts;
create trigger application_workorder_disable after update on public.workorder_portal_accounts for each row execute function private.application_account_status_trigger();
revoke all on function private.application_account_status_trigger() from public,anon,authenticated;
create or replace function private.application_security_state(p_user uuid,p_surface text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('user_id',p_user,'failed_count',coalesce(s.failed_count,0),'failure_limit',s.failure_limit,
  'locked',s.locked_at is not null,'locked_at',s.locked_at,'version',coalesce(s.version,1))
 from (select 1) one left join private.application_account_security s on s.user_id=p_user and s.surface=p_surface;
$$;
create or replace function public.application_security_admin(p_actor uuid,p_session_id uuid,p_ip text,p_surface text,p_action text,p_body jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare pol private.application_security_policies%rowtype; target uuid; st private.application_account_security%rowtype;
 net cidr; ip inet; rid bigint; expected integer; enabled boolean; policy jsonb; rules jsonb; state jsonb; ver integer; count_accounts integer;
begin
 if p_surface not in ('dashboard','workorder') or not private.application_session_allowed(p_actor,p_session_id,'dashboard')
  or not exists(select 1 from public.dashboard_profiles where auth_user_id=p_actor and active and role='owner') then
  raise exception using errcode='42501',message='owner_required'; end if;
 begin ip:=p_ip::inet; exception when invalid_text_representation then raise exception using errcode='22023',message='invalid_ip'; end;
 if not private.application_ip_allowed('dashboard',ip) then raise exception using errcode='42501',message='ip_denied'; end if;
 -- Serialize whitelist changes per surface, including check-current-IP protection.
 select * into pol from private.application_security_policies where surface=p_surface for update;
 if p_surface='dashboard' then
  select ip_whitelist_enabled into enabled from public.dashboard_security_settings where id=1 for update;
 else enabled:=pol.ip_enabled; end if;
 if enabled is null then raise exception 'security_settings_missing'; end if;
 if p_action='policy' and p_body ? 'patch' then
  if jsonb_typeof(p_body->'patch')<>'object' or exists(select 1 from jsonb_object_keys(p_body->'patch') k where k not in ('failure_limit','ip_enabled')) then raise exception using errcode='22023',message='invalid_policy'; end if;
  if (p_body->>'expected_version')::integer is distinct from pol.version then raise exception using errcode='40001',message='version_conflict'; end if;
  if p_body->'patch' ? 'failure_limit' then
   if jsonb_typeof(p_body->'patch'->'failure_limit')<>'number' or (p_body->'patch'->>'failure_limit')::integer not between 1 and 20 then raise exception using errcode='22023',message='invalid_failure_limit'; end if;
   pol.failure_limit:=(p_body->'patch'->>'failure_limit')::integer;
  end if;
  if p_body->'patch' ? 'ip_enabled' then
   if jsonb_typeof(p_body->'patch'->'ip_enabled')<>'boolean' then raise exception using errcode='22023',message='invalid_policy'; end if;
   enabled:=(p_body->'patch'->>'ip_enabled')::boolean;
  end if;
  update private.application_security_policies set failure_limit=pol.failure_limit,ip_enabled=case when p_surface='workorder' then enabled else false end,version=version+1,updated_at=now() where surface=p_surface returning * into pol;
  if p_surface='dashboard' then update public.dashboard_security_settings set ip_whitelist_enabled=enabled,updated_by=p_actor,updated_at=now(),security_version=security_version+1 where id=1; end if;
 elsif p_action in ('upsert-rule','set-rule-active','delete-rule') then
  if p_body ? 'id' then rid:=(p_body->>'id')::bigint; end if;
  if p_action<>'upsert-rule' or rid is not null then
   if p_surface='dashboard' then select security_version into ver from public.dashboard_ip_whitelist where id=rid for update;
   else select version into ver from private.workorder_ip_rules where id=rid for update; end if;
   if ver is null then raise exception using errcode='P0002',message='rule_not_found'; end if;
   if (p_body->>'expected_version')::integer is distinct from ver then raise exception using errcode='40001',message='version_conflict'; end if;
  end if;
  if p_action='upsert-rule' then
   net:=private.application_network(p_body->>'network');
   if net is null or length(coalesce(p_body->>'note',''))>100 then raise exception using errcode='22023',message='invalid_network'; end if;
   if p_surface='dashboard' then
    if exists(select 1 from public.dashboard_ip_whitelist r where private.application_network(r.ip)=net and (rid is null or r.id<>rid)) then raise exception using errcode='23505',message='rule_exists'; end if;
    if rid is null then insert into public.dashboard_ip_whitelist(ip,note,active,created_by) values(net::text,coalesce(p_body->>'note',''),true,p_actor);
    else update public.dashboard_ip_whitelist set ip=net::text,note=coalesce(p_body->>'note',''),security_version=security_version+1,updated_at=now() where id=rid; end if;
   else
    if rid is null then insert into private.workorder_ip_rules(network,note) values(net,coalesce(p_body->>'note',''));
    else update private.workorder_ip_rules set network=net,note=coalesce(p_body->>'note',''),version=version+1,updated_at=now() where id=rid; end if;
   end if;
  elsif p_action='delete-rule' then
   if p_surface='dashboard' then delete from public.dashboard_ip_whitelist where id=rid; else delete from private.workorder_ip_rules where id=rid; end if;
  else
   if jsonb_typeof(p_body->'active')<>'boolean' then raise exception using errcode='22023',message='invalid_active'; end if;
   if p_surface='dashboard' then update public.dashboard_ip_whitelist set active=(p_body->>'active')::boolean,security_version=security_version+1,updated_at=now() where id=rid;
   else update private.workorder_ip_rules set active=(p_body->>'active')::boolean,version=version+1,updated_at=now() where id=rid; end if;
  end if;
 elsif p_action in ('account-security','set-account-policy','unlock-account') then
  target:=(p_body->>'user_id')::uuid;
  if not private.application_account_exists(target,p_surface,false) then raise exception using errcode='P0002',message='account_not_found'; end if;
  if p_action<>'account-security' then
   insert into private.application_account_security(user_id,surface) values(target,p_surface) on conflict do nothing;
   select * into st from private.application_account_security where user_id=target and surface=p_surface for update;
   if (p_body->>'expected_version')::integer is distinct from st.version then raise exception using errcode='40001',message='version_conflict'; end if;
   if p_action='set-account-policy' then
    if not (p_body ? 'failure_limit') or jsonb_typeof(p_body->'failure_limit') not in ('null','number') or (p_body->>'failure_limit')::integer not between 1 and 20 then raise exception using errcode='22023',message='invalid_failure_limit'; end if;
    update private.application_account_security set failure_limit=(p_body->>'failure_limit')::integer,version=version+1 where user_id=target and surface=p_surface;
   else
    update private.application_account_security set failed_count=0,locked_at=null,version=version+1 where user_id=target and surface=p_surface;
    -- Existing sessions stay revoked. Enabling a manually disabled account is a
    -- separate account-management operation, never implied by unlocking.
   end if;
  end if;
  state:=private.application_security_state(target,p_surface)-'user_id';
 elsif p_action='list-account-security' then
  select count(*) into count_accounts from (select auth_user_id from public.dashboard_profiles where p_surface='dashboard' union all select auth_user_id from public.workorder_portal_accounts where p_surface='workorder') a;
  if count_accounts>5000 then raise exception using errcode='22023',message='account_limit_exceeded'; end if;
  select coalesce(jsonb_agg(private.application_security_state(auth_user_id,p_surface) order by auth_user_id),'[]'::jsonb) into state
  from (select auth_user_id from public.dashboard_profiles where p_surface='dashboard' union all select auth_user_id from public.workorder_portal_accounts where p_surface='workorder') a;
 elsif p_action not in ('policy','list-rules') then raise exception using errcode='22023',message='invalid_action'; end if;
 -- Only dashboard administration protects the owner's own current address.
 -- A workorder whitelist may intentionally contain no administrator address.
 if p_surface='dashboard' and not private.application_ip_allowed('dashboard',ip) then raise exception using errcode='22023',message='current_ip_would_be_blocked'; end if;
 if p_action not in ('account-security','list-account-security','list-rules') and (p_action<>'policy' or p_body ? 'patch') then
  insert into private.application_security_audit(actor_id,surface,action,target_id) values(p_actor,p_surface,p_action,target);
 end if;
 if p_action='list-account-security' then return jsonb_build_object('ok',true,'states',state); end if;
 if state is not null then return jsonb_build_object('ok',true,'security',state); end if;
 policy:=jsonb_build_object('failure_limit',pol.failure_limit,'ip_enabled',enabled,'version',pol.version);
 if p_surface='dashboard' then select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'network',r.ip,'note',r.note,'active',r.active,'version',r.security_version) order by r.id),'[]') into rules from public.dashboard_ip_whitelist r;
 else select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'network',r.network::text,'note',r.note,'active',r.active,'version',r.version) order by r.id),'[]') into rules from private.workorder_ip_rules r; end if;
 return jsonb_build_object('ok',true,'policy',policy,'rules',rules,'currentIp',host(ip));
end $$;

-- The pre-request hook covers all application Data API entry points, including
-- SECURITY DEFINER RPCs that do not use the common live-scope function.
create or replace function public.application_pre_request()
returns void language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); surface text;
begin
 if coalesce(auth.jwt()->>'role','')<>'authenticated' or uid is null then return; end if;
 if exists(select 1 from public.dashboard_profiles where auth_user_id=uid) then surface:='dashboard';
 elsif exists(select 1 from public.workorder_portal_accounts where auth_user_id=uid) then surface:='workorder';
 else return; end if;
 if not private.application_current_session_allowed(surface) then raise exception using errcode='42501',message='application_session_denied'; end if;
end $$;
revoke all on function public.application_revoke_user_sessions(uuid,text),public.application_revoke_session(uuid,uuid,text),public.application_session_check(uuid,uuid,text),public.application_auth_begin(text,text,text,uuid),public.application_auth_finish(uuid,text,uuid),public.application_auth_ip_check(text,text),public.application_security_admin(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.application_revoke_user_sessions(uuid,text),public.application_revoke_session(uuid,uuid,text),public.application_session_check(uuid,uuid,text),public.application_auth_begin(text,text,text,uuid),public.application_auth_finish(uuid,text,uuid),public.application_auth_ip_check(text,text),public.application_security_admin(uuid,uuid,text,text,text,jsonb) to service_role;
revoke all on function public.application_session_guard(),public.application_pre_request() from public,anon;
grant execute on function public.application_session_guard(),public.application_pre_request() to authenticated,service_role;
revoke all on function private.application_account_exists(uuid,text,boolean),private.application_network(text),private.application_ip_allowed(text,inet),private.application_session_allowed(uuid,uuid,text),private.application_current_session_allowed(text),private.application_security_state(uuid,text) from public,anon,authenticated;
revoke insert,update,delete on public.dashboard_security_settings,public.dashboard_ip_whitelist from anon,authenticated;
notify pgrst,'reload schema';
commit;
