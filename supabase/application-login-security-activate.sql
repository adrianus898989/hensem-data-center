-- CUTOVER ONLY: prepare SQL, gateway + Worker, and login clients must already be ready.
-- This intentionally rejects legacy/direct-Auth sessions and requires sign-in.
begin;
-- Fresh production definitions were checked on 2026-09-27. Fail rather than
-- overwriting independently changed authorization logic; preserve existing ACLs.
do $gate$
declare sig text; def text; expected text;
begin
 for sig,expected in select * from (values
 ('public.dashboard_has_permission(text)','6909cdd83ff3fba14c2dc53ebb4bf3bc'),
 ('private.dashboard_current_data_scope()','3478566e3a5323df99aa4068b7383058'),
 ('private.dashboard_admin_live_scope()','8a68658f7b24841e08f73005f78dfa38')) x(s,h) loop
  def:=pg_get_functiondef(sig::regprocedure);
  if position('private.application_current_session_allowed' in def)>0 then continue; end if;
  if md5(def)<>expected then raise exception 'authorization baseline changed: %',sig; end if;
  if sig='public.dashboard_has_permission(text)' then
   def:=replace(def,'select exists (','select private.application_current_session_allowed(''dashboard'') and exists (');
  else
   def:=replace(def,E'begin\n',E'begin\n  if not private.application_current_session_allowed(''dashboard'') then raise exception using errcode=''42501'',message=''application_session_denied''; end if;\n');
  end if;
  execute def;
 end loop;
end $gate$;
-- Do not silently replace an unrelated hook. This project had no hook at audit.
do $hook$
declare old text;
begin
 select split_part(setting,'=',2) into old from pg_db_role_setting s cross join lateral unnest(s.setconfig) setting
 where s.setrole='authenticator'::regrole and setting like 'pgrst.db_pre_request=%' limit 1;
 if old is not null and old not in ('','public.application_pre_request') then raise exception 'Existing db_pre_request must be composed before deployment'; end if;
 execute 'alter role authenticator set pgrst.db_pre_request = ''public.application_pre_request''';
end $hook$;
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;
