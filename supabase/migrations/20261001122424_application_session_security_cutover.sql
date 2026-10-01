-- Coordinate with the deployed login gateways. Existing direct-Auth sessions must sign in again.
begin;
do $gate$
declare sig text; def text; expected text;
begin
 for sig,expected in select * from (values
 ('public.dashboard_has_permission(text)','ac4d284903b4a0ca5688433f34250c59'),
 ('private.dashboard_current_data_scope()','3478566e3a5323df99aa4068b7383058'),
 ('private.dashboard_admin_live_scope()','bba99e0a5e3e2775b9523ef47bbcbf22')) x(s,h) loop
  def:=pg_get_functiondef(sig::regprocedure);
  if position('private.application_current_session_allowed' in def)>0 then continue; end if;
  if md5(def)<>expected then raise exception 'authorization baseline changed: %',sig; end if;
  if sig='public.dashboard_has_permission(text)' then
   def:=replace(def,'select private.dashboard_role_legacy_allowed() and','select private.application_current_session_allowed(''dashboard'') and private.dashboard_role_legacy_allowed() and');
  else
   def:=replace(def,E'begin\n',E'begin\n  if not private.application_current_session_allowed(''dashboard'') then raise exception using errcode=''42501'',message=''application_session_denied''; end if;\n');
  end if;
  execute def;
 end loop;
end $gate$;
do $hook$
declare old text;
begin
 select split_part(setting,'=',2) into old from pg_db_role_setting s cross join lateral unnest(s.setconfig) setting
 where s.setrole='authenticator'::regrole and setting like 'pgrst.db_pre_request=%' limit 1;
 if old is not null and old not in ('','public.application_pre_request') then raise exception 'Existing db_pre_request must be composed before deployment'; end if;
 execute 'alter role authenticator set pgrst.db_pre_request = ''public.application_pre_request''';
end $hook$;
-- Activation requires an already approved owner login, whose actual address is whitelisted.
do $ready$
begin
 if not exists(select 1 from private.application_sessions s join public.dashboard_profiles p on p.auth_user_id=s.user_id
  where p.active and p.role='owner' and s.surface='dashboard' and s.revoked_at is null
  and private.application_session_allowed(s.user_id,s.session_id,'dashboard')
  and exists(select 1 from public.dashboard_ip_whitelist r where r.active and s.login_ip <<= private.application_network(r.ip))) then
  raise exception 'approved_owner_whitelist_required';
 end if;
end $ready$;
update public.dashboard_security_settings set ip_whitelist_enabled=true,security_version=security_version+1,updated_at=now() where id=1;
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;
