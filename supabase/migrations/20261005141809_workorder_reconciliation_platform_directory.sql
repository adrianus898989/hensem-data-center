-- Read only the actual authorized reconciliation platform directory, so the
-- client can bound full-summary work by platform without inventing its scope.
-- Apply after workorder_registration_history_keys: its router baseline is kept.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $directory$
declare p record;h record;auth_role oid;definition text;before_meta jsonb;after_meta jsonb;
 old_text constant text:=$old$begin
 -- registration_reconciliation_v2: narrow India deposit branch only.$old$;
 new_text constant text:=$new$begin
 if p_query->>'operation'='reconciliationPlatforms' then
  return private.dashboard_admin_workorder_reconciliation_platforms(p_query);
 end if;
 -- registration_reconciliation_v2: narrow India deposit branch only.$new$;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_workorder_records(jsonb)');
 select oid into auth_role from pg_roles where rolname='authenticated';
 -- Reversing only the exact new branch must reproduce the known router body.
 if p.oid is null or md5(replace(p.prosrc,new_text,old_text))<>'2fb4df122737456d9d5bbd8307786183'
  or p.prorettype<>'jsonb'::regtype or p.provolatile<>'s' or not p.prosecdef or p.pronargdefaults<>0
  or p.proconfig is distinct from array['search_path=""','statement_timeout=20s']::text[] then raise exception 'RECONCILIATION_DIRECTORY_ROUTER_CHANGED';end if;
 if auth_role is null or not exists(select 1 from aclexplode(p.proacl) a where a.grantee=auth_role and a.privilege_type='EXECUTE' and not a.is_grantable)
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner,auth_role) or a.grantee=auth_role and a.is_grantable) then raise exception 'RECONCILIATION_DIRECTORY_ACL_CHANGED';end if;
 select * into h from pg_proc where oid=to_regprocedure('private.dashboard_admin_workorder_reconciliation_platforms(jsonb)');
 if h.oid is not null and (md5(h.prosrc)<>'b2e943664166bb9a24300c2580291885' or h.prosecdef or h.provolatile<>'s' or h.prorettype<>'jsonb'::regtype or h.pronargdefaults<>0
  or h.proconfig is distinct from array['search_path=""']::text[] or h.proowner<>p.proowner
  or exists(select 1 from aclexplode(coalesce(h.proacl,acldefault('f',h.proowner))) a where a.grantee<>h.proowner)) then raise exception 'RECONCILIATION_DIRECTORY_HELPER_CHANGED';end if;
 if h.oid is null then
  execute $definition$create function private.dashboard_admin_workorder_reconciliation_platforms(p_query jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $function$
declare
 v_scope jsonb:=private.dashboard_admin_live_scope();f jsonb:=p_query->'filters';v_key text;v text;v_platforms jsonb;
begin
 if jsonb_typeof(p_query) is distinct from 'object' or octet_length(p_query::text)>2000
  or p_query-array['view','operation','country','filters']<>'{}'::jsonb
  or p_query->>'operation' is distinct from 'reconciliationPlatforms' or p_query->>'view' is distinct from 'missing'
  or coalesce(p_query->>'country','') not in ('IN','印度') or jsonb_typeof(f) is distinct from 'object'
  or f-array['dateBasis','issueKind','platform']<>'{}'::jsonb then raise exception 'invalid_reconciliation_platform_request';end if;
 for v_key,v in select key,value#>>'{}' from jsonb_each(f) loop
  if jsonb_typeof(f->v_key)<>'string' or length(v)>200 or v<>btrim(v) or v ~ '[[:cntrl:]]' then raise exception 'invalid_reconciliation_platform_filter';end if;
 end loop;
 if f->>'dateBasis' is distinct from 'submission' or f->>'issueKind' is distinct from 'deposit' then raise exception 'unsupported_reconciliation_platform_filter';end if;
 with catalog as materialized (
  -- Match the reconciliation reader's server-authorized catalog before aliases.
  select distinct p.source_name,p.scope_group country_code,p.country,lower(p.source) system,
   private.dashboard_admin_live_deposit_platform_key('IN',p.source_name) platform_key
  from private.dashboard_admin_live_platforms() p
  where p.scope_group='IN' and p.country='印度' and lower(p.source) in ('ar','newar')
   and private.dashboard_scope_allows(v_scope,p.scope_group,p.source_name)
 ), ar_targets as (
  select distinct c.platform_key
  from catalog c cross join lateral (
   select c.source_name platform union select c.platform_key
   union select alias.platform from (values ('82BET'),('82LOTTERY'),('OK.WIN'),('OKWIN'),('VEER.GAME'),('VEERGAME'),
    ('RAJA'),('RAJALOTTERY'),('RAJAGAME'),('RAJAGAMES'),('SHREE.WIN'),('SHREEWIN')) alias(platform)
   where private.dashboard_admin_live_deposit_platform_key('IN',alias.platform)=c.platform_key
  ) a
  where c.system='ar' and private.dashboard_scope_allows(v_scope,c.country_code,a.platform)
   and (coalesce(f->>'platform','') in ('','all')
    or c.platform_key=private.dashboard_admin_live_deposit_platform_key('IN',f->>'platform'))
 ), newar_targets as (
  select distinct c.platform_key
  from catalog c join public.newar_detail_platforms n on c.system='newar' and n.platform=c.source_name
   and n.country_code=c.country_code and n.country=c.country and n.enabled
  where (n.launch_at is null or n.launch_at<=statement_timestamp())
   and private.dashboard_scope_allows(v_scope,n.country_code,n.platform)
   and (coalesce(f->>'platform','') in ('','all')
    or c.platform_key=private.dashboard_admin_live_deposit_platform_key('IN',f->>'platform'))
 ), eligible as (select platform_key from ar_targets union select platform_key from newar_targets)
 select coalesce(jsonb_agg(platform_key order by platform_key),'[]'::jsonb) into v_platforms from eligible;
 return jsonb_build_object('ok',true,'version',2,'operation','reconciliationPlatforms','view','missing',
  'country','印度','countryCode','IN','currency','INR','platforms',v_platforms);
end;
$function$;$definition$;
  revoke all on function private.dashboard_admin_workorder_reconciliation_platforms(jsonb) from public,anon,authenticated,service_role;
 end if;
 before_meta:=to_jsonb(p)-'prosrc';
 if md5(p.prosrc)='2fb4df122737456d9d5bbd8307786183' then
  definition:=pg_get_functiondef(p.oid);
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'RECONCILIATION_DIRECTORY_FRAGMENT_CHANGED';end if;
  execute replace(definition,old_text,new_text);
 end if;
 select to_jsonb(f)-'prosrc' into after_meta from pg_proc f where f.oid=p.oid;
 if before_meta is distinct from after_meta then raise exception 'RECONCILIATION_DIRECTORY_METADATA_CHANGED';end if;
 select * into p from pg_proc where oid=p.oid;
 if md5(replace(p.prosrc,new_text,old_text))<>'2fb4df122737456d9d5bbd8307786183'
  or (length(p.prosrc)-length(replace(p.prosrc,new_text,'')))/length(new_text)<>1 then raise exception 'RECONCILIATION_DIRECTORY_RESULT_CHANGED';end if;
 select * into h from pg_proc where oid='private.dashboard_admin_workorder_reconciliation_platforms(jsonb)'::regprocedure;
 if md5(h.prosrc)<>'b2e943664166bb9a24300c2580291885' or h.prosecdef or h.provolatile<>'s' or h.prorettype<>'jsonb'::regtype or h.pronargdefaults<>0
  or h.proconfig is distinct from array['search_path=""']::text[] or h.proowner<>p.proowner
  or exists(select 1 from aclexplode(coalesce(h.proacl,acldefault('f',h.proowner))) a where a.grantee<>h.proowner) then raise exception 'RECONCILIATION_DIRECTORY_HELPER_METADATA_CHANGED';end if;
end;$directory$;
notify pgrst,'reload schema';
commit;
