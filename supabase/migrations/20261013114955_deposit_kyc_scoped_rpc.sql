-- KYC-only REST entrypoint. The existing public owner and assigned-role routes
-- keep all authorization and data-scope checks. No source/gateway/role changes.
-- PostgREST hoists this top-level RPC's timeout; nested private settings do not
-- replace a deadline already started by the API. Actual Auth UI verification required.
begin;
set local statement_timeout='3s';set local lock_timeout='1s';
do $install$
declare p record;r record;target regprocedure:=to_regprocedure('public.dashboard_admin_deposit_kyc(jsonb,text)');before_dependencies jsonb;
begin
 if current_user<>'postgres' then raise exception 'kyc_endpoint_owner_required';end if;
 for r in select * from(values
 ('public.dashboard_admin_deposit_statistics(jsonb)','sql','p_request jsonb DEFAULT ''{}''::jsonb','c7ec858ca1a3a08edc0f4960c949ee2c',false,'s',1,array['search_path=""']::text[],'{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
 ('public.dashboard_admin_execute(text,jsonb)','plpgsql','p_page text, p_request jsonb','212a33785c64b3266f4eb84de8b0492b',true,'v',0,array['search_path=""']::text[],'{postgres=X/postgres,authenticated=X/postgres}'),
 ('private.dashboard_admin_deposit_collected_statistics(jsonb)','plpgsql','p_request jsonb','47a0a1b59aa96bda3ee6e91e5fe022b1',false,'s',0,array['search_path=""','plan_cache_mode=force_custom_plan']::text[],'{postgres=X/postgres}'),
 ('private.dashboard_admin_deposit_collected_summary(jsonb)','sql','p_rows jsonb','e7e1ba1ca1d4af4f39918283c215b125',false,'s',0,array['search_path=""']::text[],'{postgres=X/postgres}')
 )x(identity,language,args,body_hash,security_definer,volatility,defaults,config,acl)loop
  select f.*,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure(r.identity);
  if not found or md5(p.prosrc)<>r.body_hash or p.proowner<>'postgres'::regrole or p.lanname<>r.language or p.prokind<>'f'
   or p.prosecdef<>r.security_definer or p.provolatile::text<>r.volatility or p.proparallel<>'u' or p.proretset or p.proisstrict or p.proleakproof
   or p.prorettype<>'jsonb'::regtype or p.pronargdefaults<>r.defaults or p.provariadic<>0 or p.procost<>100 or p.prorows<>0
   or pg_get_function_arguments(p.oid)<>r.args or p.proconfig is distinct from r.config or p.proacl::text is distinct from r.acl then raise exception 'kyc_endpoint_dependency_drift';end if;
 end loop;
 if exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='dashboard_admin_deposit_kyc' and (target is null or oid<>target))then raise exception 'kyc_endpoint_name_collision';end if;
 select (select jsonb_object_agg(f.oid::text,to_jsonb(f))from pg_proc f where f.oid in(to_regprocedure('public.dashboard_admin_deposit_statistics(jsonb)'),to_regprocedure('public.dashboard_admin_execute(text,jsonb)'),to_regprocedure('private.dashboard_admin_deposit_collected_statistics(jsonb)'),to_regprocedure('private.dashboard_admin_deposit_collected_summary(jsonb)')))into before_dependencies;
 if target is not null then
 select f.*,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=target;
 if not found or md5(p.prosrc)<>'ed104b631583bf42608fdac1f4984d0b' or p.proowner<>'postgres'::regrole or p.lanname<>'plpgsql' or p.prokind<>'f'
  or p.prosecdef or p.provolatile<>'v' or p.proparallel<>'u' or p.proretset or p.proisstrict or p.proleakproof
  or p.prorettype<>'jsonb'::regtype or p.pronargs<>2 or p.pronargdefaults<>1 or p.provariadic<>0 or p.procost<>100 or p.prorows<>0
  or pg_get_function_arguments(p.oid)<>'p_request jsonb, p_page text DEFAULT NULL::text'
  or p.proconfig is distinct from array['search_path=""','statement_timeout=20s']::text[]
  or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' then raise exception 'kyc_endpoint_definition_drift';end if;
 else
  execute $definition$CREATE OR REPLACE FUNCTION public.dashboard_admin_deposit_kyc(p_request jsonb,p_page text default null)
returns jsonb language plpgsql volatile security invoker
set search_path='' set statement_timeout='20s'
as $kyc_endpoint$
begin
 if p_request is null or jsonb_typeof(p_request)<>'object'
  or jsonb_typeof(p_request->'section') is distinct from 'string' or p_request->>'section'<>'kyc' then
  raise exception using errcode='22023',message='invalid_kyc_request';end if;
 if p_request ? 'action' and (jsonb_typeof(p_request->'action') is distinct from 'string' or p_request->>'action'<>'depositStatistics') then
  raise exception using errcode='22023',message='invalid_kyc_action';end if;
 if p_page is null then return public.dashboard_admin_deposit_statistics(p_request);end if;
 if p_page<>'deposit_statistics' then raise exception using errcode='22023',message='invalid_kyc_page';end if;
 return public.dashboard_admin_execute(p_page,p_request||jsonb_build_object('action','depositStatistics'));
end;
$kyc_endpoint$;$definition$;
  revoke all on function public.dashboard_admin_deposit_kyc(jsonb,text) from public,anon,authenticated,service_role;
  grant execute on function public.dashboard_admin_deposit_kyc(jsonb,text) to authenticated,service_role;
  target:=to_regprocedure('public.dashboard_admin_deposit_kyc(jsonb,text)');
 end if;
 select f.*,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=target;
 if not found or md5(p.prosrc)<>'ed104b631583bf42608fdac1f4984d0b' or p.proowner<>'postgres'::regrole or p.lanname<>'plpgsql' or p.prokind<>'f'
  or p.prosecdef or p.provolatile<>'v' or p.proparallel<>'u' or p.proretset or p.proisstrict or p.proleakproof
  or p.prorettype<>'jsonb'::regtype or p.pronargs<>2 or p.pronargdefaults<>1 or p.provariadic<>0 or p.procost<>100 or p.prorows<>0
  or pg_get_function_arguments(p.oid)<>'p_request jsonb, p_page text DEFAULT NULL::text'
  or p.proconfig is distinct from array['search_path=""','statement_timeout=20s']::text[]
  or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' then raise exception 'kyc_endpoint_definition_drift';end if;
 if (select jsonb_object_agg(f.oid::text,to_jsonb(f))from pg_proc f where f.oid in(to_regprocedure('public.dashboard_admin_deposit_statistics(jsonb)'),to_regprocedure('public.dashboard_admin_execute(text,jsonb)'),to_regprocedure('private.dashboard_admin_deposit_collected_statistics(jsonb)'),to_regprocedure('private.dashboard_admin_deposit_collected_summary(jsonb)')))is distinct from before_dependencies then raise exception 'kyc_endpoint_postcondition_drift';end if;
end;$install$;
select pg_notify('pgrst','reload schema');
commit;
