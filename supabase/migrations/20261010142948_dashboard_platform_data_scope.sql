-- Platform scope narrows existing country scope; no profiles, policies or data are rewritten.
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
do $preflight$
declare p pg_proc%rowtype;r record;
begin
 select * into strict p from pg_proc where oid=to_regprocedure('private.dashboard_data_scope_valid(jsonb)');
 if md5(p.prosrc)<>'8181a85c7a5cf540e702f0d450be4fec' or pg_get_userbyid(p.proowner)<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' or p.prosecdef is distinct from false or p.provolatile<>'i' or p.proconfig is distinct from ARRAY['search_path=""']::text[] then raise exception 'platform_scope_baseline_drift: private.dashboard_data_scope_valid(jsonb)';end if;
 select * into strict p from pg_proc where oid=to_regprocedure('private.dashboard_scope_allows(jsonb,text,text)');
 if md5(p.prosrc)<>'be926dacfd6e41dafdcbf8bd6b2842c1' or pg_get_userbyid(p.proowner)<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' or p.prosecdef is distinct from false or p.provolatile<>'i' or p.proconfig is distinct from ARRAY['search_path=""']::text[] then raise exception 'platform_scope_baseline_drift: private.dashboard_scope_allows(jsonb,text,text)';end if;
 select * into strict p from pg_proc where oid=to_regprocedure('private.dashboard_current_data_scope()');
 if md5(p.prosrc)<>'6e7f03547873fe748c245625f2a5e50c' or pg_get_userbyid(p.proowner)<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' or p.prosecdef is distinct from true or p.provolatile<>'s' or p.proconfig is distinct from ARRAY['search_path=""']::text[] then raise exception 'platform_scope_baseline_drift: private.dashboard_current_data_scope()';end if;
 select * into strict p from pg_proc where oid=to_regprocedure('private.dashboard_actor_can_manage_account(uuid,uuid,text)');
 if md5(p.prosrc)<>'8de67afc6ae1478c0e8d2928d2cd6eb1' or pg_get_userbyid(p.proowner)<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres}' or p.prosecdef is distinct from true or p.provolatile<>'s' or p.proconfig is distinct from ARRAY['search_path=""']::text[] then raise exception 'platform_scope_baseline_drift: private.dashboard_actor_can_manage_account(uuid,uuid,text)';end if;
 select * into strict p from pg_proc where oid=to_regprocedure('private.dashboard_role_creation_authorize(uuid,uuid,uuid,bigint,jsonb)');
 if md5(p.prosrc)<>'6bdf46c289b2a0b9d243cbb1d2749521' or pg_get_userbyid(p.proowner)<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres}' or p.prosecdef is distinct from true or p.provolatile<>'v' or p.proconfig is distinct from ARRAY['search_path=""']::text[] then raise exception 'platform_scope_baseline_drift: private.dashboard_role_creation_authorize(uuid,uuid,uuid,bigint,jsonb)';end if;
 select * into strict p from pg_proc where oid=to_regprocedure('private.application_presence_scope(uuid)');
 if md5(p.prosrc)<>'eff8aad673ad07298d893efea38dc13f' or pg_get_userbyid(p.proowner)<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres}' or p.prosecdef is distinct from true or p.provolatile<>'s' or p.proconfig is distinct from ARRAY['search_path=""']::text[] then raise exception 'platform_scope_baseline_drift: private.application_presence_scope(uuid)';end if;
 select * into strict p from pg_proc where oid=to_regprocedure('application_dashboard_presence(uuid,uuid,text,text)');
 if md5(p.prosrc)<>'b03d09401d3616b20151bbec93f59a7d' or pg_get_userbyid(p.proowner)<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}' or p.prosecdef is distinct from true or p.provolatile<>'v' or p.proconfig is distinct from ARRAY['search_path=""']::text[] then raise exception 'platform_scope_baseline_drift: application_dashboard_presence(uuid,uuid,text,text)';end if;
 if to_regprocedure('private.dashboard_scope_platform_key(text)') is not null or to_regprocedure('private.dashboard_data_scope_subset(jsonb,jsonb)') is not null or to_regprocedure('public.dashboard_account_data_scope_catalog()') is not null then raise exception 'platform_scope_objects_exist';end if;
end $preflight$;
create temporary table platform_scope_metadata on commit drop as select oid,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid=any(ARRAY['private.dashboard_data_scope_valid(jsonb)'::regprocedure,'private.dashboard_scope_allows(jsonb,text,text)'::regprocedure,'private.dashboard_current_data_scope()'::regprocedure,'private.dashboard_actor_can_manage_account(uuid,uuid,text)'::regprocedure,'private.dashboard_role_creation_authorize(uuid,uuid,uuid,bigint,jsonb)'::regprocedure,'private.application_presence_scope(uuid)'::regprocedure,'application_dashboard_presence(uuid,uuid,text,text)'::regprocedure]);
create function private.dashboard_scope_platform_key(p_platform text)
returns text language sql immutable set search_path='' as $key$
 select nullif(upper(btrim(coalesce(p_platform,''),U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')),'');
$key$;
revoke all on function private.dashboard_scope_platform_key(text) from public,anon;
grant execute on function private.dashboard_scope_platform_key(text) to authenticated,service_role;

CREATE OR REPLACE FUNCTION private.dashboard_data_scope_valid(p_scope jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare groups text[]:=array['BR_PANGHU','BR','IN','PK','ID','VN','PH','MY','MM','NG','CO','MX','CL','SA','BR_NATIVE','USDT','HK_TEAM','RED_CRAB'];
 v_pair jsonb;v_name text;
begin
 if p_scope is null or jsonb_typeof(p_scope) is distinct from 'object' then return false;end if;
 if exists(select 1 from jsonb_object_keys(p_scope) k where k<>all(array['mode','countries','platforms']))
  or jsonb_typeof(p_scope->'countries') is distinct from 'array' then return false;end if;
 if jsonb_array_length(p_scope->'countries')>cardinality(groups) or exists(select 1 from jsonb_array_elements(p_scope->'countries') e where jsonb_typeof(e) is distinct from 'string' or e#>>'{}'<>all(groups)) then return false;end if;
 if p_scope->>'mode'='all' then return jsonb_array_length(p_scope->'countries')=0 and not p_scope ? 'platforms';end if;
 if p_scope->>'mode' is distinct from 'selected' then return false;end if;
 if not p_scope ? 'platforms' then return jsonb_array_length(p_scope->'countries')>0;end if;
 if jsonb_typeof(p_scope->'platforms') is distinct from 'array' then return false;end if;
 if jsonb_array_length(p_scope->'platforms')>500 then return false;end if;
 for v_pair in select value from jsonb_array_elements(p_scope->'platforms') loop
  if jsonb_typeof(v_pair) is distinct from 'object' then return false;end if;
  if (select array_agg(k order by k) from jsonb_object_keys(v_pair) k) is distinct from array['country','platform']::text[]
   or jsonb_typeof(v_pair->'country') is distinct from 'string' or (v_pair->>'country')<>all(groups)
   or jsonb_typeof(v_pair->'platform') is distinct from 'string' then return false;end if;
  v_name:=v_pair->>'platform';
  if char_length(v_name) not between 1 and 200 or v_name ~ U&'[\0001-\001F\007F-\009F]'
   or v_name is distinct from private.dashboard_scope_platform_key(v_name) then return false;end if;
  if jsonb_array_length(p_scope->'countries')>0 and not (p_scope->'countries') ? (v_pair->>'country') then return false;end if;
 end loop;
 return not exists(select 1 from jsonb_array_elements(p_scope->'platforms') e group by e having count(*)>1);
end;
$function$;
CREATE OR REPLACE FUNCTION private.dashboard_scope_allows(p_scope jsonb, p_country text, p_platform text DEFAULT ''::text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare v_group text;v_key text;
begin
 if not private.dashboard_data_scope_valid(p_scope) then return false;end if;
 if p_scope->>'mode'='all' then return true;end if;
 v_group:=private.dashboard_data_group(p_country,p_platform);
 if v_group='' then return false;end if;
 if p_scope ? 'platforms' then
  v_key:=private.dashboard_scope_platform_key(p_platform);
  return v_key is not null and (jsonb_array_length(p_scope->'countries')=0 or (p_scope->'countries') ? v_group)
   and (p_scope->'platforms') @> jsonb_build_array(jsonb_build_object('country',v_group,'platform',v_key));
 end if;
 return (p_scope->'countries') ? v_group;
end;
$function$;
create function private.dashboard_data_scope_subset(p_child jsonb,p_parent jsonb)
returns boolean language plpgsql immutable set search_path='' as $subset$
begin
 if not private.dashboard_data_scope_valid(p_child) or not private.dashboard_data_scope_valid(p_parent) then return false;end if;
 if p_parent->>'mode'='all' then return true;end if;
 if p_child->>'mode'='all' then return false;end if;
 if p_child ? 'platforms' then
  return not exists(select 1 from jsonb_array_elements(p_child->'platforms') e
   where not private.dashboard_scope_allows(p_parent,e->>'country',e->>'platform'));
 end if;
 return not p_parent ? 'platforms' and (p_child->'countries') <@ (p_parent->'countries');
end;
$subset$;
revoke all on function private.dashboard_data_scope_subset(jsonb,jsonb) from public,anon;
grant execute on function private.dashboard_data_scope_subset(jsonb,jsonb) to authenticated,service_role;

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
  if not private.application_current_session_allowed('dashboard') then raise exception using errcode='42501',message='application_session_denied'; end if;
  select * into v_profile from public.dashboard_profiles where auth_user_id = (select auth.uid()) and active = true;
  if not found then return '{"mode":"selected","countries":[]}'::jsonb; end if;
  if v_profile.role = 'owner' then return '{"mode":"all","countries":[]}'::jsonb; end if;
  v_scope := v_profile.data_scope;
  if not private.dashboard_data_scope_valid(v_scope) then return '{"mode":"selected","countries":[]}'::jsonb; end if;
  if v_scope->>'mode' = 'all' then return '{"mode":"all","countries":[]}'::jsonb; end if;
  return jsonb_build_object('mode','selected','countries',(
    select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from (select distinct value from jsonb_array_elements_text(v_scope->'countries')) as keys
  )) || case when v_scope ? 'platforms' then jsonb_build_object('platforms',v_scope->'platforms') else '{}'::jsonb end;
end;
$function$;
CREATE OR REPLACE FUNCTION private.dashboard_actor_can_manage_account(p_actor uuid, p_target uuid, p_permission text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 if not private.dashboard_data_scope_subset(t,s) then return false;end if;
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
end;$function$;
CREATE OR REPLACE FUNCTION private.dashboard_role_creation_authorize(p_actor uuid, p_session uuid, p_role uuid, p_version bigint, p_scope jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   or (select count(*)<>count(distinct value) from jsonb_array_elements_text(p_scope->'countries')) then
  raise exception using errcode='22023',message='invalid_data_scope';end if;
 actor_scope:=private.dashboard_actor_data_scope(p_actor);
 if not private.dashboard_data_scope_subset(p_scope,actor_scope) then
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
end;$function$;
CREATE OR REPLACE FUNCTION private.application_presence_scope(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.dashboard_profiles%rowtype; s jsonb;
begin
 select * into p from public.dashboard_profiles where auth_user_id=p_user;
 if not found or p.active is not true or p.role not in ('owner','admin','viewer') then return null;end if;
 if p.role<>'owner' and exists(select 1 from private.dashboard_role_assignments where auth_user_id=p_user)
  and not exists(select 1 from private.dashboard_role_assignments a join private.dashboard_roles r on r.id=a.role_id
   where a.auth_user_id=p_user and r.active is true) then return null;end if;
 s:=private.dashboard_actor_data_scope(p_user);
 if s->>'mode'='all' and s->'countries'='[]'::jsonb then return s;end if;
 if s->>'mode'='selected' and private.dashboard_data_scope_valid(s) then return s;end if;
 return null;
end $function$;
CREATE OR REPLACE FUNCTION public.application_dashboard_presence(p_actor uuid, p_session_id uuid, p_ip text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  where target.value is not null and (h.user_id=p_actor or private.dashboard_data_scope_subset(target.value,v_scope))
  order by p.username collate "C" limit 501
 ) select count(*)::integer,coalesce(jsonb_agg(jsonb_build_object('username',username,'lastSeenAt',last_seen_at) order by username collate "C"),'[]'::jsonb)
  into v_count,v_accounts from visible;
 if v_count>500 then raise exception using errcode='54000',message='presence_roster_limit';end if;
 v_list:=coalesce(private.dashboard_actor_has_permission(p_actor,'access.view'),false);
 v_response:=jsonb_build_object('ok',true,'onlineCount',v_count,'observedAt',v_now,
  'windowSeconds',120,'heartbeatSeconds',30,'scope','authorized');
 if v_list then v_response:=v_response||jsonb_build_object('accounts',v_accounts);end if;
 return v_response;
end $function$;
create function public.dashboard_account_data_scope_catalog()
returns jsonb language plpgsql stable security definer set search_path='' as $catalog$
declare actor uuid:=(select auth.uid());s jsonb;result jsonb;
begin
 if not private.application_current_session_allowed('dashboard') then raise exception using errcode='42501',message='application_session_denied';end if;
 if actor is null or not private.dashboard_actor_has_permission(actor,'access.view')
  or not (private.dashboard_actor_has_permission(actor,'access.create') or private.dashboard_actor_has_permission(actor,'access.edit')) then
  raise exception using errcode='42501',message='account_scope_catalog_denied';end if;
 s:=private.dashboard_actor_data_scope(actor);
 with native as materialized (
  select m.country_code country,m.source_platform platform,coalesce(nullif(m.platform_name,''),m.source_platform) name,m.source_system source
  from public.dashboard_platform_team_map m where m.active
  union all select t.country_code,t.platform,t.platform,coalesce(t.source_system,'AR') from public.ar_config_targets t
  union all select t.country_code,t.platform,t.platform,'PANDA' from public.panda_config_targets t
  union all select t.country_code,t.platform,t.platform,'WG' from public.wg_config_targets t
  union all select n.country_code,n.platform,n.platform,'NEW_AR' from public.newar_detail_platforms n where n.enabled and (n.launch_at is null or n.launch_at<=now())
  union all select case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,g.platform_name,g.platform_name,'GAME66' from public.game66_platforms g where g.enabled
  union all select a.country,a.platform,a.platform,'REPORT' from public.auto_withdraw_daily a
  union all select a.country,a.platform,a.platform,'REPORT' from public.third_party_platform_status a
  union all select 'IN','YASH.BET','YASH.BET','KB'
 ), canonical as (
  select private.dashboard_data_group(n.country,n.platform) country,private.dashboard_scope_platform_key(n.platform) platform,n.name,n.source from native n
 ), allowed as (
  select c.country,c.platform,min(c.name collate "C") name,case when count(distinct c.source)=1 then min(c.source) end source
  from canonical c where c.country<>'' and c.platform is not null and char_length(c.platform)<=200 and c.platform !~ U&'[\0001-\001F\007F-\009F]'
   and private.dashboard_scope_allows(s,c.country,c.platform)
  group by c.country,c.platform
 ) select jsonb_build_object('version',1,'platforms',coalesce(jsonb_agg(jsonb_build_object('country',a.country,'platform',a.platform,'label',a.name,'name',a.name)
  ||case when a.source is not null then jsonb_build_object('source',a.source) else '{}'::jsonb end order by a.country collate "C",a.platform collate "C"),'[]'::jsonb)) into result from allowed a;
 return result;
end;
$catalog$;
revoke all on function public.dashboard_account_data_scope_catalog() from public,anon,authenticated,service_role;
grant execute on function public.dashboard_account_data_scope_catalog() to authenticated;

do $post$
declare r record;
begin
 if exists(select 1 from platform_scope_metadata m join pg_proc p using(oid) where to_jsonb(p)-'prosrc' is distinct from m.metadata) then raise exception 'platform_scope_metadata_changed';end if;
 if (select md5(prosrc) from pg_proc where oid='private.dashboard_data_scope_valid(jsonb)'::regprocedure)<>'f4907d924afc6cb9021f5380bfe9df3c' then raise exception 'platform_scope_hash_mismatch: private.dashboard_data_scope_valid(jsonb)';end if;
 if (select md5(prosrc) from pg_proc where oid='private.dashboard_scope_allows(jsonb,text,text)'::regprocedure)<>'1142f29305ed59ffc23c53799ef10043' then raise exception 'platform_scope_hash_mismatch: private.dashboard_scope_allows(jsonb,text,text)';end if;
 if (select md5(prosrc) from pg_proc where oid='private.dashboard_current_data_scope()'::regprocedure)<>'9bc39b26c5d9796e35f6122e7d903a59' then raise exception 'platform_scope_hash_mismatch: private.dashboard_current_data_scope()';end if;
 if (select md5(prosrc) from pg_proc where oid='private.dashboard_actor_can_manage_account(uuid,uuid,text)'::regprocedure)<>'38b69e2f4cb7dd0df7690e20c38020a5' then raise exception 'platform_scope_hash_mismatch: private.dashboard_actor_can_manage_account(uuid,uuid,text)';end if;
 if (select md5(prosrc) from pg_proc where oid='private.dashboard_role_creation_authorize(uuid,uuid,uuid,bigint,jsonb)'::regprocedure)<>'c461cdbc069a312326a79ee543d2902d' then raise exception 'platform_scope_hash_mismatch: private.dashboard_role_creation_authorize(uuid,uuid,uuid,bigint,jsonb)';end if;
 if (select md5(prosrc) from pg_proc where oid='private.application_presence_scope(uuid)'::regprocedure)<>'d0d6a885a952b64f04e4efb0a289185a' then raise exception 'platform_scope_hash_mismatch: private.application_presence_scope(uuid)';end if;
 if (select md5(prosrc) from pg_proc where oid='application_dashboard_presence(uuid,uuid,text,text)'::regprocedure)<>'432157c8aa8c26b406b7988db1f883a2' then raise exception 'platform_scope_hash_mismatch: application_dashboard_presence(uuid,uuid,text,text)';end if;
end $post$;
commit;
