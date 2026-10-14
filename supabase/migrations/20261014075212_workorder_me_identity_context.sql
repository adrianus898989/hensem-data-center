-- Me-only service RPC. No account, session, role, catalog or business data is changed.
begin;
set local statement_timeout='3s';
set local lock_timeout='1s';
do $install$
declare spec jsonb; actual_body text; actual_metadata jsonb; name_count integer;
begin
for spec in select value from jsonb_array_elements($dependencies$[{"signature":"public.application_auth_ip_check(text,text,uuid)","md5":"bddc9f615ef7b109ecc5de8110758ca2","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_surface text, p_ip text, p_user_id uuid","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":true,"setret":false,"strict":false,"returns":"boolean","defaults":0,"parallel":"u","variadic":"0","volatile":"s","leakproof":false}},{"signature":"public.application_session_check(uuid,uuid,text)","md5":"9d7fcccd65900447d232a844438a5d1a","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_user_id uuid, p_session_id uuid, p_surface text","cost":100,"kind":"f","lang":"sql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":true,"setret":false,"strict":false,"returns":"jsonb","defaults":0,"parallel":"u","variadic":"0","volatile":"s","leakproof":false}},{"signature":"private.application_ip_allowed(text,inet,uuid)","md5":"c6a2ebc5c0705887a4aa4e0d5c1840bf","metadata":{"acl":"{postgres=X/postgres}","args":"p_surface text, p_ip inet, p_user uuid","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":true,"setret":false,"strict":false,"returns":"boolean","defaults":0,"parallel":"u","variadic":"0","volatile":"s","leakproof":false}},{"signature":"private.application_session_allowed(uuid,uuid,text)","md5":"4e92bdf9dd6365b45f0b4f24814030a4","metadata":{"acl":"{postgres=X/postgres}","args":"p_user uuid, p_session uuid, p_surface text","cost":100,"kind":"f","lang":"sql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":true,"setret":false,"strict":false,"returns":"boolean","defaults":0,"parallel":"u","variadic":"0","volatile":"s","leakproof":false}},{"signature":"public.workorder_portal_account_context(uuid)","md5":"d917c751720a14b6a751893ab2e01a58","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_actor uuid","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"jsonb","defaults":0,"parallel":"u","variadic":"0","volatile":"s","leakproof":false}},{"signature":"public.workorder_portal_effective_access(uuid)","md5":"c90acb13f98ee98ed535565393c8bfb8","metadata":{"acl":"{postgres=X/postgres,service_role=X/postgres}","args":"p_actor uuid","cost":100,"kind":"f","lang":"plpgsql","rows":0,"owner":"postgres","config":["search_path=\"\""],"secdef":false,"setret":false,"strict":false,"returns":"jsonb","defaults":0,"parallel":"u","variadic":"0","volatile":"s","leakproof":false}}]$dependencies$::jsonb) loop
 select md5(p.prosrc),jsonb_build_object('owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'volatile',p.provolatile,'secdef',p.prosecdef,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'kind',p.prokind,'setret',p.proretset,'variadic',p.provariadic,'defaults',p.pronargdefaults,'args',pg_get_function_arguments(p.oid),'returns',pg_get_function_result(p.oid),'lang',l.lanname) into actual_body,actual_metadata from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec->>'signature');
 if actual_body is distinct from spec->>'md5' or actual_metadata is distinct from spec->'metadata' then raise exception 'workorder_identity_dependency_drift';end if;
end loop;
select count(*) into name_count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='workorder_portal_identity_context';
if name_count<>0 then
 if name_count<>1 then raise exception 'workorder_identity_name_collision';end if;
 spec:=$target${"signature":"public.workorder_portal_identity_context(uuid,text,uuid,boolean,text)","md5":"833fdc5793f4a6ec3f2deae163fda2e7","metadata":{"owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"volatile":"v","secdef":false,"parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"kind":"f","setret":false,"variadic":"0","defaults":0,"args":"p_actor uuid, p_email text, p_session_id uuid, p_proxy_present boolean, p_client_ip text","returns":"jsonb","lang":"plpgsql"}}$target$::jsonb;
select md5(p.prosrc),jsonb_build_object('owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'volatile',p.provolatile,'secdef',p.prosecdef,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'kind',p.prokind,'setret',p.proretset,'variadic',p.provariadic,'defaults',p.pronargdefaults,'args',pg_get_function_arguments(p.oid),'returns',pg_get_function_result(p.oid),'lang',l.lanname) into actual_body,actual_metadata from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec->>'signature');
 if actual_body is distinct from spec->>'md5' or actual_metadata is distinct from spec->'metadata' then raise exception 'workorder_identity_installed_drift';end if;
return;end if;
execute $identity_definition$-- Internal service-only identity read; Auth.getUser and proxy-proof validation stay in Edge.
CREATE OR REPLACE FUNCTION public.workorder_portal_identity_context(
 p_actor uuid, p_email text, p_session_id uuid, p_proxy_present boolean, p_client_ip text)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare prof jsonb; account jsonb; catalog_rows jsonb; owner_account boolean; surface text;
begin
 if p_actor is null or p_proxy_present is null then raise exception using errcode='22023',message='invalid_identity_request';end if;
 select jsonb_build_object('auth_user_id',p.auth_user_id,'username',p.username,'role',p.role,'active',p.active)
 into prof from public.dashboard_profiles p where p.auth_user_id=p_actor;
 owner_account:=coalesce(prof->>'auth_user_id'=p_actor::text and prof->'active'='true'::jsonb and prof->>'role'='owner',false);
 surface:=case when prof is not null then 'dashboard' else 'workorder' end;
 -- Keep the existing session-before-proxy/IP-before-account rejection order.
 if p_session_id is null then
  return jsonb_build_object('version',1,'ok',false,'status',403,'code','session_denied','message','会话未通过登录策略，请重新登录');
 end if;
 if (public.application_session_check(p_actor,p_session_id,surface)->'allowed') is distinct from 'true'::jsonb then
  return jsonb_build_object('version',1,'ok',false,'status',403,'code','session_denied','message','会话未通过登录策略，请重新登录');
 end if;
 if prof is null or p_proxy_present then
  if p_client_ip is null then
   return jsonb_build_object('version',1,'ok',false,'status',403,'code','proxy_denied','message','登录来源验证失败');
  end if;
  if public.application_auth_ip_check(surface,p_client_ip,p_actor) is not true then
   return jsonb_build_object('version',1,'ok',false,'status',403,'code','ip_denied','message','当前 IP 不在登录白名单');
  end if;
 end if;
 if not owner_account then
  if prof is not null then
   return jsonb_build_object('version',1,'ok',false,'status',403,'code','account_denied','message','此后台账号没有工单所有者权限');
  end if;
  account:=public.workorder_portal_account_context(p_actor);
  if account is null or account->>'auth_user_id' is distinct from p_actor::text
   or account->'active' is distinct from 'true'::jsonb
   or coalesce(account->>'role','') not in ('agent','supervisor','auditor')
   or lower(p_email) is distinct from ((account->>'username')||'@workorder.hensem.local') then
   return jsonb_build_object('version',1,'ok',false,'status',403,'code','account_denied','message','工单账号未启用或未授权');
  end if;
 end if;
 -- The same two native registration sources, predicates and independent caps.
 -- Ambiguous cross-team names and the final staff scope are still checked by buildCatalog in Edge.
 select coalesce(jsonb_agg(jsonb_build_object('team',r.team_name,'platform',r.platform_name)),'[]'::jsonb)
 into catalog_rows from (
  (select team_name,platform_name from public.dashboard_platform_team_map where active=true and country_code='IN' limit 1000)
  union all
  (select team_name,platform_name from public.game66_platforms where team_name in ('红膏蟹','香港') limit 1000)
 ) r;
 return jsonb_build_object('version',1,'ok',true,'profile',prof,'account',account,'catalogRows',catalog_rows);
end;
$function$;
$identity_definition$;
revoke all on function public.workorder_portal_identity_context(uuid,text,uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.workorder_portal_identity_context(uuid,text,uuid,boolean,text) to service_role;
spec:=$target${"signature":"public.workorder_portal_identity_context(uuid,text,uuid,boolean,text)","md5":"833fdc5793f4a6ec3f2deae163fda2e7","metadata":{"owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","config":["search_path=\"\""],"volatile":"v","secdef":false,"parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"kind":"f","setret":false,"variadic":"0","defaults":0,"args":"p_actor uuid, p_email text, p_session_id uuid, p_proxy_present boolean, p_client_ip text","returns":"jsonb","lang":"plpgsql"}}$target$::jsonb;
select md5(p.prosrc),jsonb_build_object('owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'volatile',p.provolatile,'secdef',p.prosecdef,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'kind',p.prokind,'setret',p.proretset,'variadic',p.provariadic,'defaults',p.pronargdefaults,'args',pg_get_function_arguments(p.oid),'returns',pg_get_function_result(p.oid),'lang',l.lanname) into actual_body,actual_metadata from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec->>'signature');
 if actual_body is distinct from spec->>'md5' or actual_metadata is distinct from spec->'metadata' then raise exception 'workorder_identity_installed_drift';end if;
end;
$install$;
notify pgrst,'reload schema';
commit;
