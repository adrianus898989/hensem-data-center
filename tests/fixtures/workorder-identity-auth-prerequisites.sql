-- Synthetic schema only; exact production policy-function definitions, no claims/JWT fixtures.
create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
create table private.application_account_security(user_id uuid,surface text,locked_at timestamptz,ip_mode text);
create table private.application_sessions(session_id uuid,user_id uuid,surface text,revoked_at timestamptz,login_ip inet);
create table private.application_account_ip_rules(user_id uuid,surface text,active boolean,network cidr);
create table private.application_security_policies(surface text primary key,ip_enabled boolean);
create table private.workorder_ip_rules(active boolean,network cidr);
create table public.dashboard_security_settings(id integer primary key,ip_whitelist_enabled boolean);
create table public.dashboard_ip_whitelist(ip text,active boolean);
CREATE OR REPLACE FUNCTION private.application_account_exists(p_user uuid, p_surface text, p_active boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case when p_surface='dashboard' then exists(select 1 from public.dashboard_profiles p join auth.users u on u.id=p.auth_user_id
  where p.auth_user_id=p_user and (not p_active or p.active) and p.role in ('owner','admin','viewer')
  and lower(u.email)=lower(p.username)||'@hensem.local'
  and not exists(select 1 from public.workorder_portal_accounts w where w.auth_user_id=p_user))
 when p_surface='workorder' then exists(select 1 from public.workorder_portal_accounts w join auth.users u on u.id=w.auth_user_id
  where w.auth_user_id=p_user and (not p_active or w.active) and w.role in ('supervisor','agent','auditor')
  and lower(u.email)=lower(w.username)||'@workorder.hensem.local'
  and not exists(select 1 from public.dashboard_profiles p where p.auth_user_id=p_user)) else false end;
$function$
;
revoke all on function private.application_account_exists(uuid,text,boolean) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.application_ip_allowed(p_surface text, p_ip inet)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;
revoke all on function private.application_ip_allowed(text,inet) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.application_network(p_text text)
 RETURNS cidr
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare n cidr;
begin
 if p_text is null or length(p_text)>80 or p_text<>btrim(p_text) then return null; end if;
 begin n:=network(p_text::inet); exception when invalid_text_representation then return null; end;
 if masklen(n)=0 then return null; end if;
 return n;
end $function$
;
revoke all on function private.application_network(text) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.application_ip_allowed(p_surface text, p_ip inet, p_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare mode text;
begin
 if p_ip is null or masklen(p_ip)<>(case family(p_ip) when 4 then 32 else 128 end)
  or not private.application_account_exists(p_user,p_surface,true) then return false; end if;
 select ip_mode into mode from private.application_account_security where user_id=p_user and surface=p_surface;
 if mode='allowlist' then
  return exists(select 1 from private.application_account_ip_rules r where r.user_id=p_user and r.surface=p_surface and r.active and p_ip <<= r.network);
 end if;
 return private.application_ip_allowed(p_surface,p_ip);
end $function$
;
revoke all on function private.application_ip_allowed(text,inet,uuid) from public,anon,authenticated,service_role;
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
$function$
;
revoke all on function private.application_session_allowed(uuid,uuid,text) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.application_auth_ip_check(p_surface text, p_ip text, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin return private.application_ip_allowed(p_surface,p_ip::inet,p_user_id); exception when invalid_text_representation then return false; end $function$
;
revoke all on function public.application_auth_ip_check(text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.application_auth_ip_check(text,text,uuid) to service_role;
CREATE OR REPLACE FUNCTION public.application_session_check(p_user_id uuid, p_session_id uuid, p_surface text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('allowed',private.application_session_allowed(p_user_id,p_session_id,p_surface),
  'code',case when private.application_session_allowed(p_user_id,p_session_id,p_surface) then 'ok' else 'application_session_denied' end);
$function$
;
revoke all on function public.application_session_check(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.application_session_check(uuid,uuid,text) to service_role;
