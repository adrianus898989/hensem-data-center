-- Exact deployed platform-scope definitions; no profile/session data.
CREATE OR REPLACE FUNCTION public.dashboard_account_data_scope_catalog()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=(select auth.uid());s jsonb;result jsonb;
begin
 if not private.application_current_session_allowed('dashboard') then raise exception using errcode='42501',message='application_session_denied';end if;
 if actor is null or not private.dashboard_actor_has_permission(actor,'access.view')
  or not (private.dashboard_actor_has_permission(actor,'access.create') or private.dashboard_actor_has_permission(actor,'access.edit')) then
  raise exception using errcode='42501',message='account_scope_catalog_denied';end if;
 s:=private.dashboard_actor_data_scope(actor);
 with native as materialized (
  select m.country_code country,m.source_platform platform,coalesce(nullif(m.platform_name,''),m.source_platform) name,m.source_system source,m.team_name team
  from public.dashboard_platform_team_map m where m.active
  union all select t.country_code,t.platform,t.platform,coalesce(t.source_system,'AR'),null::text from public.ar_config_targets t
  union all select t.country_code,t.platform,t.platform,'PANDA',null::text from public.panda_config_targets t
  union all select t.country_code,t.platform,t.platform,'WG',null::text from public.wg_config_targets t
  union all select n.country_code,n.platform,n.platform,'NEW_AR',null::text from public.newar_detail_platforms n where n.enabled and (n.launch_at is null or n.launch_at<=now())
  union all select case g.team_code when 'hong_kong' then 'HK_TEAM' when 'red_crab' then 'RED_CRAB' else upper(g.team_code) end,g.platform_name,g.platform_name,'GAME66',g.team_name from public.game66_platforms g where g.enabled
  union all select a.country,a.platform,a.platform,'REPORT',null::text from public.auto_withdraw_daily a
  union all select a.country,a.platform,a.platform,'REPORT',null::text from public.third_party_platform_status a
  union all select 'IN','YASH.BET','YASH.BET','KB',null::text
 ), canonical as (
  select private.dashboard_data_group(n.country,n.platform) country,private.dashboard_scope_platform_key(n.platform) platform,n.name,n.source,
   case when char_length(btrim(n.team,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) between 1 and 200
    and btrim(n.team,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') !~ U&'[\0001-\001F\007F-\009F]'
    then btrim(n.team,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') end team
  from native n
 ), allowed as (
  select c.country,c.platform,min(c.name collate "C") name,case when count(distinct c.source)=1 then min(c.source) end source,case when count(distinct c.team)=1 then min(c.team collate "C") end team
  from canonical c where c.country<>'' and c.platform is not null and char_length(c.platform)<=200 and c.platform !~ U&'[\0001-\001F\007F-\009F]'
   and private.dashboard_scope_allows(s,c.country,c.platform)
  group by c.country,c.platform
 ) select jsonb_build_object('version',1,'platforms',coalesce(jsonb_agg(jsonb_build_object('country',a.country,'platform',a.platform,'label',a.name,'name',a.name,'team',a.team)
  ||case when a.source is not null then jsonb_build_object('source',a.source) else '{}'::jsonb end order by a.country collate "C",a.platform collate "C"),'[]'::jsonb)) into result from allowed a;
 return result;
end;
$function$;
revoke all on function public.dashboard_account_data_scope_catalog() from public,anon,authenticated,service_role;
grant execute on function public.dashboard_account_data_scope_catalog() to authenticated;
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
revoke all on function private.dashboard_current_data_scope() from public,anon,authenticated,service_role;
grant execute on function private.dashboard_current_data_scope() to authenticated;
grant execute on function private.dashboard_current_data_scope() to service_role;
CREATE OR REPLACE FUNCTION private.dashboard_data_scope_subset(p_child jsonb, p_parent jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
$function$;
revoke all on function private.dashboard_data_scope_subset(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.dashboard_data_scope_subset(jsonb,jsonb) to authenticated;
grant execute on function private.dashboard_data_scope_subset(jsonb,jsonb) to service_role;
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
revoke all on function private.dashboard_data_scope_valid(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.dashboard_data_scope_valid(jsonb) to authenticated;
grant execute on function private.dashboard_data_scope_valid(jsonb) to service_role;
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
revoke all on function private.dashboard_scope_allows(jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function private.dashboard_scope_allows(jsonb,text,text) to authenticated;
grant execute on function private.dashboard_scope_allows(jsonb,text,text) to service_role;

