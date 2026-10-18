-- Stage 2: enable only after bounded client deployment and verified common-window warmup.
begin;
set local lock_timeout='500ms';
set local statement_timeout='15s';
do $guard$begin
 if current_user<>'postgres'then raise exception'daily_base_async_install_denied';end if;
 if not exists(select 1 from pg_proc p where oid='public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure and md5(prosrc)='3db6a5b8f8b3f104a08a2ed23c458df4'and md5(pg_get_functiondef(p.oid))='1c13d7415eba1a5bbb38bdbc166ed2d2'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres,authenticated=X/postgres}'and prosecdef=true and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='e032c2062fc64bb81481593df061a9e9'and md5(pg_get_functiondef(p.oid))='3114e3bb4274b891c45edc7212e78c06'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure and md5(prosrc)='125afac728629ef0323c22887eb16b88'and md5(pg_get_functiondef(p.oid))='85ed3075a6bb501686cd01e960fbf5e7'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure and md5(prosrc)='4e28cfb2d1690ce1b8f11daedb248c99'and md5(pg_get_functiondef(p.oid))='83c12cd4df61b8cfe69a8466d834ef9b'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=true and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.withdraw_prepared_prepare_claim(text)'::regprocedure and md5(prosrc)='174aa423474363e135adeefa80530740'and md5(pg_get_functiondef(p.oid))='664f6398837318c8e178983b83d55b1a'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.withdraw_prepared_run_dispatch(text)'::regprocedure and md5(prosrc)='6a4b1983ada38ae912c37f67720bb09c'and md5(pg_get_functiondef(p.oid))='613dfb11a3ca89c9ae35dfaa7e2ea5fe'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.withdraw_prepared_provider_gate()'::regprocedure and md5(prosrc)='ce8dd3bf6d00394ec6f66c5b312461ba'and md5(pg_get_functiondef(p.oid))='08689f2282ced4611d88802d595e29cb'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_read(text,jsonb)'::regprocedure and md5(prosrc)='4a38ca3d9bbfbed3cc94250db95064da')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_admin_live_remap_groups(jsonb,text,text,boolean)'::regprocedure and md5(prosrc)='0ce8e6980d543059024eb1010d600946')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_canonical_request(jsonb,jsonb)'::regprocedure and md5(prosrc)='56218033e0849e0744f34ba92ad96e72')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure and md5(prosrc)='008e5cee3a4f6ac9e90706c45bee56da')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='58fee45de05fe5567a62e69b297cee88')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_base_request(jsonb,jsonb,timestamp with time zone)'::regprocedure and md5(prosrc)='e05bf399932d1441b3425a548e0af7ed')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_dependency_common(text)'::regprocedure and md5(prosrc)='36966b6e1e434eb6d5990e551f816b8e')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_echo(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='f72bd9afabd7c74de273f02f5e46499d')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_key(jsonb,jsonb)'::regprocedure and md5(prosrc)='220e789b11f814a39784fbf63ebdc30c')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_request_reason(jsonb,jsonb)'::regprocedure and md5(prosrc)='56807ad65f1f575fd4d46c1bff0fa885')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.provider_snapshot_dependency_token(jsonb)'::regprocedure and md5(prosrc)='ccf807a978ba7f0d3cb9f527dad6c5d4')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_dependency(jsonb,text)'::regprocedure and md5(prosrc)='8abe872feeb5ab4b2a7f2ee662e39dba')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_master_projection(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='0909f6961bc2fe1de9101af88396760b')then raise exception'daily_base_async_dependency_drift';end if;
 if not exists(select 1 from pg_trigger where tgrelid='private.prepared_aggregate_artifacts'::regclass and tgname='prepared_aggregate_immutable'and tgenabled in('O','A')and tgfoid=to_regprocedure('private.prepared_aggregate_immutable()')and(tgtype&19)=19)then raise exception'daily_base_async_immutable_required';end if;
 if not exists(select 1 from cron.job where jobid=40 and md5(command)='8bb7fcdf4d41a60db1a490326e67f440'and schedule='1 second'and active=true)then raise exception'daily_base_async_dispatch_schedule_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.daily_provider_base_identity(jsonb,jsonb,jsonb,text)'::regprocedure and md5(prosrc)='480ca3b477bda870fd4b35606429216f'and md5(pg_get_functiondef(p.oid))='0f925406c76f576e05d6e921a16b2186'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_async_helper_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.daily_provider_base_manifest_matches(jsonb)'::regprocedure and md5(prosrc)='7b28ca322f500d36fcf3195b51b94f27'and md5(pg_get_functiondef(p.oid))='2954df9d970eaf0db6c7424ca8017d56'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_async_helper_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.daily_provider_base_current(jsonb,jsonb)'::regprocedure and md5(prosrc)='b90f4e12c10f6eff54cc74f713b42d6d'and md5(pg_get_functiondef(p.oid))='3085c2eef73f7cf5aae356a129fca821'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_async_helper_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.daily_provider_base_lookup(jsonb,jsonb,jsonb,text)'::regprocedure and md5(prosrc)='823d756a9df2d4a8e2bcce7e6cfffe55'and md5(pg_get_functiondef(p.oid))='c68306dbb0eca5e44d421557f2ea9d10'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_async_helper_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.daily_provider_base_enqueue(jsonb)'::regprocedure and md5(prosrc)='889c093d1ab76aa388d23b0f57a4cbf5'and md5(pg_get_functiondef(p.oid))='6dac86d72c0f8c823ac6cff95a6072a7'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_async_helper_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.daily_provider_base_claim()'::regprocedure and md5(prosrc)='f3b25be0e0bc27cf3dc921aeede543aa'and md5(pg_get_functiondef(p.oid))='4472b2026c37879acca0ea70dda072c4'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_async_helper_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.daily_provider_base_run_claimed()'::regprocedure and md5(prosrc)='526e5ed10164effd493031c34ce32064'and md5(pg_get_functiondef(p.oid))='5866b70c2deea1f6d620243314d678b8'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_async_helper_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.daily_provider_base_prewarm(jsonb)'::regprocedure and md5(prosrc)='a47e0e34ee7530d2dc8fc63b3461fc9e'and md5(pg_get_functiondef(p.oid))='739d3ef7c8acbea783bf5e1e1441f5d4'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and not prosecdef and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then raise exception'daily_base_async_helper_drift';end if;
 if not exists(select 1 from pg_class c where c.oid='private.daily_provider_base_jobs'::regclass and c.relkind='r'and pg_get_userbyid(c.relowner)='postgres'and c.relrowsecurity and not c.relforcerowsecurity and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)and not exists(select 1 from pg_policy where polrelid=c.oid))then raise exception'daily_base_async_storage_drift';end if;
 if not exists(select 1 from pg_class c where c.oid='private.daily_provider_base_artifacts'::regclass and c.relkind='r'and pg_get_userbyid(c.relowner)='postgres'and c.relrowsecurity and not c.relforcerowsecurity and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)and not exists(select 1 from pg_policy where polrelid=c.oid))then raise exception'daily_base_async_storage_drift';end if;
 if not exists(select 1 from pg_class c where c.oid='private.daily_provider_base_heads'::regclass and c.relkind='r'and pg_get_userbyid(c.relowner)='postgres'and c.relrowsecurity and not c.relforcerowsecurity and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)and not exists(select 1 from pg_policy where polrelid=c.oid))then raise exception'daily_base_async_storage_drift';end if;
 if not exists(select 1 from pg_class c where c.oid='private.daily_provider_base_scheduler'::regclass and c.relkind='r'and pg_get_userbyid(c.relowner)='postgres'and c.relrowsecurity and not c.relforcerowsecurity and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)and not exists(select 1 from pg_policy where polrelid=c.oid))then raise exception'daily_base_async_storage_drift';end if;
 if not exists(select 1 from pg_class c where c.oid='private.daily_provider_base_admissions'::regclass and c.relkind='r'and pg_get_userbyid(c.relowner)='postgres'and c.relrowsecurity and not c.relforcerowsecurity and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee<>c.relowner)and not exists(select 1 from pg_policy where polrelid=c.oid))then raise exception'daily_base_async_storage_drift';end if;
 if not exists(select 1 from private.daily_provider_base_heads h join private.daily_provider_base_artifacts a on a.id=h.artifact_id where a.item->>'status'='ready'and a.item->'publication'->'calculationComplete'='true'::jsonb and a.item_digest=md5(a.item::text))then raise exception'daily_base_async_warmup_required';end if;
end;$guard$;
create temporary table daily_base_async_guard on commit drop as
select 'entries'::text key,jsonb_agg(jsonb_build_array(p.oid,case when p.oid in('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure,'private.withdraw_prepared_prepare_claim(text)'::regprocedure,'private.withdraw_prepared_run_dispatch(text)'::regprocedure,'private.withdraw_prepared_provider_gate()'::regprocedure)then to_jsonb(p)-'prosrc'else to_jsonb(p)end)order by p.oid)value from pg_proc p where p.oid in('public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure,'private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure,'private.withdraw_prepared_prepare_claim(text)'::regprocedure,'private.withdraw_prepared_run_dispatch(text)'::regprocedure,'private.withdraw_prepared_provider_gate()'::regprocedure)
union all select 'financial',to_jsonb((select md5(coalesce(jsonb_agg(to_jsonb(p)order by p.oid),'[]'::jsonb)::text)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_prepared_%' or p.proname like 'prepared_aggregate_%' or p.proname like 'dashboard_admin_duoli_%' or p.proname like 'dashboard_admin_panda_%' or p.proname like 'dashboard_admin_wg_%' or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')))
union all select 'snapshot',to_jsonb((select md5(coalesce(jsonb_agg(to_jsonb(p)order by p.oid),'[]'::jsonb)::text)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')))
union all select 'cron40',to_jsonb(c)from cron.job c where jobid=40;

-- BEGIN async prepared base reader enable.
create or replace function private.dashboard_admin_daily_provider_prepared_read(p_page text,p_request jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=''as $function$
declare
 access jsonb;page jsonb;ctx jsonb;catalog jsonb;targets jsonb:='[]';q jsonb;t jsonb;dq jsonb;
 commons jsonb:='{}';scope text;common text;dep text;baseq jsonb;k jsonb;
 parts jsonb:='[]';mappings jsonb:='[]';all_items jsonb:='[]';items jsonb:='[]';chunk jsonb;response jsonb;folded jsonb;
 a timestamptz;b timestamptz;local_a timestamp;local_b timestamp;day date;day_end timestamptz;tz text;
 i integer:=0;start_index integer;part_index integer:=0;mapping jsonb;selected jsonb;original_q jsonb;
 j private.prepared_aggregate_jobs%rowtype;artifact private.prepared_aggregate_artifacts%rowtype;prepared jsonb;pending jsonb:='[]';states jsonb;reason text;identity jsonb;
begin
 -- Same page, query grant and assigned-context checks as the unmodified reader.
 -- Do this before even looking up a prepared head or native platform metadata.
 access:=private.dashboard_role_access();
 if(access->>'canView')::boolean is not true then raise exception using errcode='42501',message='preview_denied';end if;
 select value into page from jsonb_array_elements(private.dashboard_role_catalog()->'pages')where value->>'id'=p_page;
 if page is null or not(page->'requests'?'aggregate')or not(page->'requests'?'aggregatePrepared')then raise exception using errcode='42501',message='page_action_denied';end if;
 if access->>'mode'='assigned'then
  if not private.dashboard_role_context_valid()or not(access->'permissions'?&array[p_page||'.view',p_page||'.query'])then raise exception using errcode='42501',message='role_permission_denied';end if;
  ctx:=nullif(current_setting('hensem.dashboard_role_context',true),'')::jsonb->'payload';
  if ctx->>'page'is distinct from p_page or ctx->>'rpc'is distinct from'dashboard_admin_live_aggregate_prepared'or ctx->>'action'is distinct from'aggregatePrepared'then raise exception using errcode='42501',message='page_action_denied';end if;
 end if;
 if p_request is null or jsonb_typeof(p_request)is distinct from'object'
  or p_request-array['requests','publicationVersion','forceRefresh']<>'{}'::jsonb or octet_length(p_request::text)>1048576
  or p_request->'publicationVersion'is distinct from'2'::jsonb or jsonb_typeof(p_request->'requests')is distinct from'array'
  or jsonb_array_length(p_request->'requests')not between 1 and 3
  or p_request?'forceRefresh'and jsonb_typeof(p_request->'forceRefresh')is distinct from'boolean'
 then return private.prepared_aggregate_read(p_page,p_request);end if;
 select coalesce(jsonb_agg(to_jsonb(p)),'[]')into catalog from private.dashboard_admin_live_platforms()p;
 for q in select value from jsonb_array_elements(p_request->'requests')loop
  -- Invalid UUIDs are delegated to the original validation, never coerced.
  select value into t from jsonb_array_elements(catalog)where value->>'id'=q->>'platformId';
  if t is null then return private.prepared_aggregate_read(p_page,p_request);end if;
  if private.prepared_aggregate_request_reason(q,t)is not null or t->>'source'not in('ar','newar','kb')
   or q-array['action','view','platformId','startAt','endAt','successStartAt','successEndAt','successBasis','direction','status','providers','currency','offset','limit','amountBands']<>'{}'::jsonb
   or q->>'view'is distinct from'providers'or coalesce(q->>'status','all')<>'all'or q->>'successBasis'is distinct from'success'
   or q->>'successStartAt'is null or q->>'successEndAt'is null
   or q?'currency'and q->'currency'<>'null'::jsonb and q->>'currency'is distinct from t->>'currency'
  then return private.prepared_aggregate_read(p_page,p_request);end if;
  a:=(q->>'startAt')::timestamptz;b:=(q->>'endAt')::timestamptz;tz:=t->>'timezone';
  local_a:=a at time zone tz;local_b:=b at time zone tz;
  if a is distinct from(q->>'successStartAt')::timestamptz or b is distinct from(q->>'successEndAt')::timestamptz
   or local_a<>date_trunc('day',local_a)or local_b<>date_trunc('day',local_b)
   or local_b::date-local_a::date not between 2 and 31 or b>clock_timestamp()
  then return private.prepared_aggregate_read(p_page,p_request);end if;
  start_index:=jsonb_array_length(parts);targets:=targets||jsonb_build_array(t);
  scope:=t->>'scope_group';common:=commons->>scope;
  if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;
  dep:=private.prepared_aggregate_dependency(t,common);
  for day in select generate_series(local_a::date,local_b::date-1,interval'1day')::date loop
   day_end:=(day+1)::timestamp at time zone tz;
   -- Provider totals ignore validated chart bands, just like the unchanged
   -- canonical/base request. Drop them before widening daily direction to all.
   dq:=(q-array['providers','amountBands'])||jsonb_build_object('direction','all',
    'startAt',to_char(day::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'endAt',to_char(day_end at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'successStartAt',to_char(day::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'successEndAt',to_char(day_end at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
   baseq:=private.prepared_aggregate_base_request(dq,t);k:=private.prepared_aggregate_key(baseq,t);
   select *into j from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k;
   select a0.*into artifact from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a0 on a0.id=h.artifact_id where h.job_id=j.id;
   if artifact.id is null or artifact.revision is distinct from j.revision or artifact.dependency is distinct from dep
    or j.dependency is distinct from dep or j.target is distinct from t or artifact.cutoff<day_end
    or artifact.cutoff is null or artifact.computed_at is null or artifact.expires_at<=artifact.computed_at
    or artifact.source_complete is null
   then return private.prepared_aggregate_read(p_page,p_request);end if;
   parts:=parts||jsonb_build_array(dq);
  end loop;
  mappings:=mappings||jsonb_build_array(jsonb_build_object('first',start_index,'count',jsonb_array_length(parts)-start_index,'dependency',dep));
 end loop;
 -- 3 platforms ×31 local days, split sequentially. No client concurrency change,
 -- no broadened original RPC batch contract, no synchronous raw computation.
 if jsonb_array_length(parts)>93 then return private.prepared_aggregate_read(p_page,p_request);end if;
 part_index:=0;
 while part_index<jsonb_array_length(parts)loop
  select jsonb_agg(value order by n)into chunk from jsonb_array_elements(parts)with ordinality p(value,n)where n>part_index and n<=part_index+50;
  response:=private.prepared_aggregate_read(p_page,(p_request-'requests')||jsonb_build_object('requests',chunk));
  if response->>'version'is distinct from'2'or jsonb_typeof(response->'items')is distinct from'array'
   or jsonb_array_length(response->'items')<>jsonb_array_length(chunk)
   or exists(select 1 from jsonb_array_elements(response->'items')with ordinality r(value,n)where value->>'status'is distinct from'ready'or value->'request'is distinct from chunk->(n::integer-1))
  then return private.prepared_aggregate_read(p_page,p_request);end if;
  all_items:=all_items||(response->'items');part_index:=part_index+50;
 end loop;
 i:=0;
 for mapping in select value from jsonb_array_elements(mappings)loop
  original_q:=p_request->'requests'->i;t:=targets->i;
  select jsonb_agg(value order by n)into selected from jsonb_array_elements(all_items)with ordinality r(value,n)
   where n>(mapping->>'first')::integer and n<=(mapping->>'first')::integer+(mapping->>'count')::integer;
  begin
   prepared:=private.daily_provider_base_lookup(selected,original_q,t,mapping->>'dependency');
   if prepared->'fallback'='true'::jsonb then return private.prepared_aggregate_read(p_page,p_request);end if;
   folded:=prepared->'item';
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then folded:=null;end;
  if folded is null then return private.prepared_aggregate_read(p_page,p_request);end if;
  items:=items||jsonb_build_array(folded);
  pending:=pending||jsonb_build_array(prepared->'pending');i:=i+1;
 end loop;
 response:=jsonb_build_object('version',2,'items',items);
 -- Match the existing prepared manager's 16 MiB encoded-response bound.
 -- Preserve original fallback behavior instead of truncating providers/leaves.
 if octet_length(response::text)>16*1024*1024 then return private.prepared_aggregate_read(p_page,p_request);end if;
 states:=private.daily_provider_base_enqueue(pending);
 i:=0;
 for prepared in select value from jsonb_array_elements(pending)loop
  identity:=prepared->'identity';reason:=states->>md5((identity->'key')::text);
  if reason is not null then
   if response->'items'->i->>'status'='building'then
    response:=jsonb_set(response,array['items',i::text],(response->'items'->i)||jsonb_build_object('status','failed','reason',reason));
   elsif response->'items'->i->'publication'->'servedLastComplete'='true'::jsonb then
    response:=jsonb_set(response,array['items',i::text,'publication'],(response->'items'->i->'publication')||jsonb_build_object('refreshState','failed','refreshError',reason));
   end if;
  end if;
  i:=i+1;
 end loop;
 return response;
end;$function$;
revoke all on function private.dashboard_admin_daily_provider_prepared_read(text,jsonb)from public,anon,authenticated,service_role;

-- END async prepared base reader enable.
do $verify$begin
 if not exists(select 1 from pg_proc p where oid='public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure and md5(prosrc)='3db6a5b8f8b3f104a08a2ed23c458df4'and md5(pg_get_functiondef(p.oid))='1c13d7415eba1a5bbb38bdbc166ed2d2'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres,authenticated=X/postgres}'and prosecdef=true and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='e032c2062fc64bb81481593df061a9e9'and md5(pg_get_functiondef(p.oid))='3114e3bb4274b891c45edc7212e78c06'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure and md5(prosrc)='85e91bc6e7f1eb5158236fcf90280dd7'and md5(pg_get_functiondef(p.oid))='9a8e54ef3917b86d9838c08c2d30390b'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure and md5(prosrc)='4e28cfb2d1690ce1b8f11daedb248c99'and md5(pg_get_functiondef(p.oid))='83c12cd4df61b8cfe69a8466d834ef9b'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=true and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.withdraw_prepared_prepare_claim(text)'::regprocedure and md5(prosrc)='174aa423474363e135adeefa80530740'and md5(pg_get_functiondef(p.oid))='664f6398837318c8e178983b83d55b1a'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.withdraw_prepared_run_dispatch(text)'::regprocedure and md5(prosrc)='6a4b1983ada38ae912c37f67720bb09c'and md5(pg_get_functiondef(p.oid))='613dfb11a3ca89c9ae35dfaa7e2ea5fe'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if not exists(select 1 from pg_proc p where oid='private.withdraw_prepared_provider_gate()'::regprocedure and md5(prosrc)='ce8dd3bf6d00394ec6f66c5b312461ba'and md5(pg_get_functiondef(p.oid))='08689f2282ced4611d88802d595e29cb'and pg_get_userbyid(proowner)='postgres'and proacl::text='{postgres=X/postgres}'and prosecdef=false and to_jsonb(proconfig)=$config$["search_path=\"\""]$config$::jsonb)then raise exception'daily_base_async_entry_drift';end if;
 if(select value from pg_temp.daily_base_async_guard where key='entries')is distinct from(select jsonb_agg(jsonb_build_array(p.oid,case when p.oid in('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure,'private.withdraw_prepared_prepare_claim(text)'::regprocedure,'private.withdraw_prepared_run_dispatch(text)'::regprocedure,'private.withdraw_prepared_provider_gate()'::regprocedure)then to_jsonb(p)-'prosrc'else to_jsonb(p)end)order by p.oid)from pg_proc p where p.oid in('public.dashboard_admin_aggregate_prepared(text,jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)'::regprocedure,'private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'::regprocedure,'private.dashboard_admin_live_aggregate_prepared(jsonb)'::regprocedure,'private.withdraw_prepared_prepare_claim(text)'::regprocedure,'private.withdraw_prepared_run_dispatch(text)'::regprocedure,'private.withdraw_prepared_provider_gate()'::regprocedure))then raise exception'daily_base_async_metadata_changed';end if;
 if(select value from pg_temp.daily_base_async_guard where key='financial')is distinct from to_jsonb((select md5(coalesce(jsonb_agg(to_jsonb(p)order by p.oid),'[]'::jsonb)::text)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_prepared_%' or p.proname like 'prepared_aggregate_%' or p.proname like 'dashboard_admin_duoli_%' or p.proname like 'dashboard_admin_panda_%' or p.proname like 'dashboard_admin_wg_%' or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')))then raise exception'daily_base_async_financial_changed';end if;
 if(select value from pg_temp.daily_base_async_guard where key='snapshot')is distinct from to_jsonb((select md5(coalesce(jsonb_agg(to_jsonb(p)order by p.oid),'[]'::jsonb)::text)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')))then raise exception'daily_base_async_snapshot_changed';end if;
 if(select value from pg_temp.daily_base_async_guard where key='cron40')is distinct from(select to_jsonb(c)from cron.job c where jobid=40)then raise exception'daily_base_async_cron_changed';end if;
end;$verify$;
commit;
