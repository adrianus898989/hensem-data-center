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
revoke all on function private.dashboard_data_scope_valid(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.dashboard_data_scope_valid(jsonb) to authenticated;
grant execute on function private.dashboard_data_scope_valid(jsonb) to service_role;
CREATE OR REPLACE FUNCTION private.dashboard_data_group(p_country text, p_platform text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_trim text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_country text := upper(btrim(regexp_replace(btrim(coalesce(p_country,''),v_trim), '盘口$', ''),v_trim));
  v_platform text := upper(btrim(coalesce(p_platform,''),v_trim));
  v_group text;
begin
  v_group := case
    when v_country = any(array['BR_PANGHU','BR','IN','PK','ID','VN','PH','MY','MM','NG','CO','MX','CL','SA','BR_NATIVE','USDT','HK_TEAM','RED_CRAB']) then v_country
    when v_country = any(array['香港','HONG KONG','HONG_KONG']) then 'HK_TEAM'
    when v_country = any(array['红膏蟹','紅膏蟹','RED CRAB']) then 'RED_CRAB'
    when v_country = any(array['巴西','BRAZIL']) then 'BR'
    when v_country = any(array['胖虎巴西','PANGHU BRAZIL']) then 'BR_PANGHU'
    when v_country = any(array['印度','印度线下','INDIA']) then 'IN'
    when v_country = any(array['巴基斯坦','PAKISTAN']) then 'PK'
    when v_country = any(array['印尼','印度尼西亚','INDONESIA']) then 'ID'
    when v_country = any(array['越南','VIETNAM']) then 'VN'
    when v_country = any(array['菲律宾','PHILIPPINES']) then 'PH'
    when v_country = any(array['马来','马来西亚','MALAYSIA']) then 'MY'
    when v_country = any(array['缅甸','MYANMAR']) then 'MM'
    when v_country = any(array['尼日利亚','NIGERIA']) then 'NG'
    when v_country = any(array['哥伦比亚','COLOMBIA']) then 'CO'
    when v_country = any(array['墨西哥','MEXICO']) then 'MX'
    when v_country = any(array['智利','CHILE']) then 'CL'
    when v_country = any(array['南美','SOUTH AMERICA']) then 'SA'
    when v_country = '巴西原生' then 'BR_NATIVE'
    when v_country = any(array['USDT通道','USDT 通道']) then 'USDT'
    else '' end;
  if v_group = 'SA' then
    v_group := case v_platform when 'NPG-CHILE' then 'CL' when 'NPG-COLOMBIA' then 'CO'
      when 'NPG-MEXICO' then 'MX' else v_group end;
  end if;
  if v_group in ('BR','BR_PANGHU') then
    v_platform := case v_platform when 'FF55' then 'FF555' when '222VIP.COM' then '222VIP'
      when '222-VIP' then '222VIP' when '67-VIP' then '67VIP' else v_platform end;
    if v_platform = any(array[
      'VIP345','KKVIP','KK345','FF555','TPTP','AA45','F75','25RR','8599BET','9596BET','8566BET',
      '5V555','58EE','27FF','222O','32QQ','67VIP','222VIP','345F','234T','888HH','BET5697',
      '96F','45FF','76PP','56L','559K','2V222','776F','5C555'
    ]) then return 'BR_PANGHU'; end if;
    if v_platform = any(array['POPNOV','POPFEZ','POPCRA']) then return 'BR'; end if;
  end if;
  return v_group;
end;
$function$;
revoke all on function private.dashboard_data_group(text,text) from public,anon,authenticated,service_role;
grant execute on function private.dashboard_data_group(text,text) to authenticated;
grant execute on function private.dashboard_data_group(text,text) to service_role;
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
    select jsonb_agg(value order by value) from (select distinct value from jsonb_array_elements_text(v_scope->'countries')) as keys
  ));
end;
$function$;
revoke all on function private.dashboard_current_data_scope() from public,anon,authenticated,service_role;
grant execute on function private.dashboard_current_data_scope() to authenticated;
grant execute on function private.dashboard_current_data_scope() to service_role;
CREATE OR REPLACE FUNCTION private.dashboard_scope_allows(p_scope jsonb, p_country text, p_platform text DEFAULT ''::text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare v_group text;
begin
  if not private.dashboard_data_scope_valid(p_scope) then return false; end if;
  if p_scope->>'mode' = 'all' then return true; end if;
  v_group := private.dashboard_data_group(p_country,p_platform);
  return v_group <> '' and (p_scope->'countries') ? v_group;
end;
$function$;
revoke all on function private.dashboard_scope_allows(jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function private.dashboard_scope_allows(jsonb,text,text) to authenticated;
grant execute on function private.dashboard_scope_allows(jsonb,text,text) to service_role;
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
end;$function$;
revoke all on function private.dashboard_actor_can_manage_account(uuid,uuid,text) from public,anon,authenticated,service_role;
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
end;$function$;
revoke all on function private.dashboard_role_creation_authorize(uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
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
 if s->>'mode'='selected' and jsonb_typeof(s->'countries')='array' and jsonb_array_length(s->'countries')>0 then return s;end if;
 return null;
end $function$;
revoke all on function private.application_presence_scope(uuid) from public,anon,authenticated,service_role;
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
end $function$;
revoke all on function application_dashboard_presence(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function application_dashboard_presence(uuid,uuid,text,text) to service_role;