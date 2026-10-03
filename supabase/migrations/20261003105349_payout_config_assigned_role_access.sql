-- Use the existing signed page grant for the detailed-backend payout configuration.
-- No account, role, scope, source configuration, or legacy module grant is modified.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

do $preflight$
declare spec jsonb; p record; actual jsonb;
begin
 if to_regprocedure('private.dashboard_payout_config_access_allowed()') is not null then
  raise exception 'payout_config_access_helper_exists';
 end if;
 for spec in select value from jsonb_array_elements($expected$[{"signature":"public.dashboard_has_permission(text)","definitionMd5":"ce04a09f982b3e931b23a6f974c907ec","metadata":{"owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proconfig":["search_path=public, pg_temp"],"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","returns":"boolean","lanname":"sql","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"pronargdefaults":0,"proretset":false}},{"signature":"private.dashboard_role_context_valid()","definitionMd5":"40d55753a710fcc63cf0e94ef7adb8f5","metadata":{"owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","returns":"boolean","lanname":"plpgsql","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"pronargdefaults":0,"proretset":false}},{"signature":"private.dashboard_role_require_gateway()","definitionMd5":"03bc655bf9b7936df7f4b703dcd06df5","metadata":{"owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","returns":"void","lanname":"plpgsql","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"pronargdefaults":0,"proretset":false}},{"signature":"private.dashboard_admin_live_scope()","definitionMd5":"729b11824c0b8f69544cd3583a111c0a","metadata":{"owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres}","returns":"jsonb","lanname":"plpgsql","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"pronargdefaults":0,"proretset":false}},{"signature":"public.dashboard_game66_review_rules()","definitionMd5":"f043a4c74dd2b045cca3a656b47c7f65","metadata":{"owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","returns":"jsonb","lanname":"plpgsql","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"pronargdefaults":0,"proretset":false}},{"signature":"private.dashboard_admin_live_payout_config(jsonb)","definitionMd5":"3a98ee02d962d862fa4d2661d2977e1b","metadata":{"owner":"postgres","prosecdef":true,"provolatile":"s","proparallel":"u","proconfig":["search_path=\"\""],"acl":"{postgres=X/postgres,authenticated=X/postgres}","returns":"jsonb","lanname":"plpgsql","proisstrict":false,"proleakproof":false,"procost":100,"prorows":0,"pronargdefaults":1,"proretset":false}}]$expected$::jsonb) loop
  select f.*,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure(spec->>'signature');
  if not found or md5(pg_get_functiondef(p.oid)) is distinct from spec->>'definitionMd5' then
   raise exception 'payout_config_access_definition_drift: %',spec->>'signature';
  end if;
  actual:=jsonb_build_object('owner',pg_get_userbyid(p.proowner),'prosecdef',p.prosecdef,'provolatile',p.provolatile,
   'proparallel',p.proparallel,'proconfig',p.proconfig,'acl',p.proacl::text,'returns',p.prorettype::regtype::text,
   'lanname',p.lanname,'proisstrict',p.proisstrict,'proleakproof',p.proleakproof,'procost',p.procost,
   'prorows',p.prorows,'pronargdefaults',p.pronargdefaults,'proretset',p.proretset);
  if actual is distinct from spec->'metadata' or pg_get_userbyid(p.proowner)<>current_user then
   raise exception 'payout_config_access_metadata_drift: %',spec->>'signature';
  end if;
 end loop;
end;$preflight$;

create function private.dashboard_payout_config_access_allowed()
returns boolean language plpgsql stable security invoker set search_path='' as $allowed$
declare v_payload jsonb;
begin
 if private.application_current_session_allowed('dashboard') is not true then return false;end if;
 -- Assigned roles must use this exact, verified gateway route. A legacy true
 -- module flag cannot rescue a missing page grant or a direct public RPC call.
 if exists(select 1 from private.dashboard_role_assignments where auth_user_id=auth.uid())
  and not exists(select 1 from public.dashboard_profiles where auth_user_id=auth.uid() and active and role='owner') then
  if private.dashboard_role_context_valid() is not true then return false;end if;
  v_payload:=nullif(current_setting('hensem.dashboard_role_context',true),'')::jsonb->'payload';
  if v_payload->>'page' is distinct from 'payout_config'
   or v_payload->>'action' is distinct from 'payoutConfig'
   or v_payload->>'rpc' is distinct from 'dashboard_admin_live_payout_config'
   or v_payload->>'capability' is distinct from 'query' then return false;end if;
  return exists(select 1 from private.dashboard_role_assignments a
   join private.dashboard_roles r on r.id=a.role_id
   where a.auth_user_id=auth.uid() and r.active
    and r.permissions @> array['payout_config.view','payout_config.query']::text[]);
 end if;
 -- Preserve the existing owner/unassigned account behavior, including sessions
 -- and legacy scope gates. This helper grants no export or edit capability.
 return public.dashboard_has_permission('auto_withdraw') is true;
exception when others then return false;
end;$allowed$;
revoke all on function private.dashboard_payout_config_access_allowed() from public,anon,authenticated,service_role;
do $acl$
declare a record;
begin
 -- Also remove any installation-specific default EXECUTE grants.
 for a in select distinct x.grantee from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
  where p.oid='private.dashboard_payout_config_access_allowed()'::regprocedure and x.grantee<>p.proowner loop
  execute format('revoke all on function private.dashboard_payout_config_access_allowed() from %s',
   case when a.grantee=0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end);
 end loop;
end;$acl$;

do $patch$
declare signature text; p record; before_meta jsonb; new_body text; old_gate text:=$gate$public.dashboard_has_permission('auto_withdraw')$gate$;
begin
 foreach signature in array array['private.dashboard_admin_live_payout_config(jsonb)','public.dashboard_game66_review_rules()'] loop
  select * into p from pg_proc where oid=to_regprocedure(signature);
  select to_jsonb(f)-'prosrc' into before_meta from pg_proc f where f.oid=p.oid;
  if (length(p.prosrc)-length(replace(p.prosrc,old_gate,'')))/length(old_gate)<>1 then
   raise exception 'payout_config_access_gate_drift: %',signature;
  end if;
  new_body:=replace(p.prosrc,old_gate,'private.dashboard_payout_config_access_allowed()');
  execute replace(pg_get_functiondef(p.oid),p.prosrc,new_body);
  if (select to_jsonb(f)-'prosrc' from pg_proc f where f.oid=p.oid) is distinct from before_meta
   or (select prosrc from pg_proc where oid=p.oid) is distinct from new_body then
   raise exception 'payout_config_access_metadata_changed: %',signature;
  end if;
 end loop;
 if exists(select 1 from pg_proc helper cross join lateral aclexplode(coalesce(helper.proacl,acldefault('f',helper.proowner))) x
  where helper.oid='private.dashboard_payout_config_access_allowed()'::regprocedure and x.grantee<>helper.proowner) then
  raise exception 'payout_config_access_helper_acl';
 end if;
end;$patch$;
notify pgrst,'reload schema';
commit;
