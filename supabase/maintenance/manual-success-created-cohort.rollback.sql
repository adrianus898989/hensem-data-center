begin;
set transaction isolation level repeatable read;
select pg_advisory_xact_lock(hashtextextended('prepared_aggregate_dispatch_v1',0));
do $guard$ declare expected jsonb;actual jsonb;begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='created_rollout_owner_required';end if;
 if current_setting('transaction_isolation')<>'repeatable read'then raise exception using errcode='55000',message='created_rollout_snapshot_required';end if;
 for expected in select value from jsonb_array_elements('[{"identity":"private.daily_provider_base_prewarm_internal(jsonb,timestamp with time zone)","name":"daily_provider_base_prewarm_internal","body_md5":"1e6c3c70aff3e650e68cb9e2d5ccb14f","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_requests jsonb, p_background_requested_at timestamp with time zone","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)","name":"dashboard_admin_daily_provider_fold","body_md5":"2d3f82b85b41eccf342684b33a3ca801","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_items jsonb, p_request jsonb, p_target jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_daily_provider_prepared_read(text,jsonb)","name":"dashboard_admin_daily_provider_prepared_read","body_md5":"b122e68a38ccb93dfb27fbd7e235fb8f","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_page text, p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_duoli_member_daily(jsonb,timestamp with time zone,timestamp with time zone,text,text[],text)","name":"dashboard_admin_duoli_member_daily","body_md5":"24e0d06eb35f6b7b2f9d3d3feab86973","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\"","jit=off"],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_platform jsonb, p_start timestamp with time zone, p_end timestamp with time zone, p_direction text, p_providers text[], p_currency text","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_duoli_order_result(jsonb)","name":"dashboard_admin_duoli_order_result","body_md5":"9c9164f75a6aa0780807697a5ec4ae67","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"i","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_result jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_live_analysis_orders_raw(jsonb)","name":"dashboard_admin_live_analysis_orders_raw","body_md5":"cc38a60f9b8391024ded4674dc4d16d6","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\"","jit=off"],"security_definer":true,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_live_drilldown_raw(jsonb)","name":"dashboard_admin_live_drilldown_raw","body_md5":"7c1475c6487837c5e9d6d9df7fef2fef","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\"","jit=off"],"security_definer":true,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_live_member_daily(jsonb)","name":"dashboard_admin_live_member_daily","body_md5":"8e883bb4e40a4301eecdd1942d64d12d","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","config":["search_path=\"\"","jit=off"],"security_definer":true,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_live_query_raw(jsonb)","name":"dashboard_admin_live_query_raw","body_md5":"acb2d504332b9ef631896b45efbbf74c","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\"","jit=off"],"security_definer":true,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_request jsonb DEFAULT ''{\"action\": \"catalog\"}''::jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_live_remap_groups(jsonb,text,text,boolean)","name":"dashboard_admin_live_remap_groups","body_md5":"a874377c27aa62d1834e181da0c4f50b","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":true,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_rows jsonb, p_country text, p_platform text, p_daily boolean DEFAULT false","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_panda_order_result(jsonb)","name":"dashboard_admin_panda_order_result","body_md5":"9f41174309dcab2ee923a91ad9dd2087","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"i","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_result jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_wg_member_daily(jsonb,timestamp with time zone,timestamp with time zone,text,text[],text)","name":"dashboard_admin_wg_member_daily","body_md5":"924ebf632b6b58e0d86e8c129989f9d2","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":true,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_platform jsonb, p_start timestamp with time zone, p_end timestamp with time zone, p_direction text, p_providers text[], p_currency text","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_wg_order_result(jsonb,text,text)","name":"dashboard_admin_wg_order_result","body_md5":"7498f4b8448f50fdcdae9e4b32b02bce","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_result jsonb, p_country text, p_platform text","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_prepared_direction_projection(jsonb,jsonb,jsonb)","name":"dashboard_prepared_direction_projection","body_md5":"d78514fd179bf7536a67c3ab327456ba","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"i","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_payload jsonb, p_base_request jsonb, p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)","name":"dashboard_prepared_provider_projection","body_md5":"66fb576dad7f97eb3746a46ed52c1edd","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_payload jsonb, p_base_request jsonb, p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_serving_country_prewarm(timestamp with time zone)","name":"dashboard_serving_country_prewarm","body_md5":"7e09e38e4476ceed2593bfffa1c3b3de","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_now timestamp with time zone DEFAULT now()","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_serving_master_reuse(text,jsonb)","name":"dashboard_serving_master_reuse","body_md5":"c475f3201604212b1790f523c96a54c7","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_page text, p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_canonical_request(jsonb,jsonb)","name":"prepared_aggregate_canonical_request","body_md5":"483f7a0797304ad672ee609e4543e5cb","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"i","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"q jsonb, t jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_complete(uuid,uuid,bigint,jsonb)","name":"prepared_aggregate_complete","body_md5":"c0874536384e456615c8a8ad09ca59b9","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_job uuid, p_run uuid, p_fence bigint, p_payload jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_compute(jsonb,jsonb)","name":"prepared_aggregate_compute","body_md5":"fb3061d22b1be654c896c3d98c873b09","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\"","jit=off"],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"q jsonb, t jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_echo(jsonb,jsonb,jsonb)","name":"prepared_aggregate_echo","body_md5":"38f5a5a3f872b9f2fe15054d713f6798","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"i","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"payload jsonb, q jsonb, t jsonb","result":"jsonb","language":"sql"},{"identity":"private.prepared_aggregate_newar_withdraw_clock_guard(jsonb,jsonb)","name":"prepared_aggregate_newar_withdraw_clock_guard","body_md5":"a81d8f161b73e2293fc4d880c0264d3d","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_result jsonb, p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_prewarm(timestamp with time zone)","name":"prepared_aggregate_prewarm","body_md5":"466d2fb64bead17897436fae23302248","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_now timestamp with time zone DEFAULT now()","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_raw_kernel(jsonb,jsonb)","name":"prepared_aggregate_raw_kernel","body_md5":"7a63e2a1ff52054f87247926772758e1","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\"","jit=off"],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_request jsonb, p_catalog jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_read(text,jsonb)","name":"prepared_aggregate_read","body_md5":"7d883a550ee3d9f282552286b9649f7c","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":true,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_page text, p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_request_reason(jsonb,jsonb)","name":"prepared_aggregate_request_reason","body_md5":"2006141bc6b62bb3436d01f9fed92310","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"q jsonb, t jsonb","result":"text","language":"plpgsql"},{"identity":"private.prepared_aggregate_secondary_reason(jsonb,jsonb)","name":"prepared_aggregate_secondary_reason","body_md5":"a4fc493bf949f282940dcbc14c9b7a04","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"q jsonb, t jsonb","result":"text","language":"plpgsql"},{"identity":"private.dashboard_serving_ready_read(text,jsonb)","name":"dashboard_serving_ready_read","body_md5":"8e096fcf2e3bf216ec9000447c5cc95b","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_page text, p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_base_request(jsonb,jsonb,timestamp with time zone)","name":"prepared_aggregate_base_request","body_md5":"e05bf399932d1441b3425a548e0af7ed","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"q jsonb, t jsonb, p_now timestamp with time zone DEFAULT now()","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_dependency(jsonb)","name":"prepared_aggregate_dependency","body_md5":"719f56b29c6fbb91b70e88f03b647a43","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_target jsonb","result":"text","language":"sql"},{"identity":"private.prepared_aggregate_dependency(jsonb,text)","name":"prepared_aggregate_dependency","body_md5":"8abe872feeb5ab4b2a7f2ee662e39dba","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_target jsonb, p_common text","result":"text","language":"sql"},{"identity":"private.prepared_aggregate_dependency_common(text)","name":"prepared_aggregate_dependency_common","body_md5":"36966b6e1e434eb6d5990e551f816b8e","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_scope text","result":"text","language":"sql"},{"identity":"private.prepared_aggregate_key(jsonb,jsonb)","name":"prepared_aggregate_key","body_md5":"220e789b11f814a39784fbf63ebdc30c","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"i","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"q jsonb, t jsonb","result":"jsonb","language":"sql"},{"identity":"private.prepared_aggregate_master_projection(jsonb,jsonb,jsonb)","name":"prepared_aggregate_master_projection","body_md5":"0909f6961bc2fe1de9101af88396760b","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_payload jsonb, p_base jsonb, p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_source_clocks(text,text,text)","name":"prepared_aggregate_source_clocks","body_md5":"72df486e0133adfa47dcce1d84e7cb52","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"i","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_sql text, p_source text, p_basis text","result":"text","language":"plpgsql"},{"identity":"private.dashboard_serving_default_amount_bands(text)","name":"dashboard_serving_default_amount_bands","body_md5":"d140e1dc8a39cc3a17fd3508fdf9c86c","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"i","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"currency text","result":"jsonb","language":"sql"}]'::jsonb)loop
 select to_jsonb(s)into actual from(select p.oid::regprocedure::text identity,p.proname name,md5(p.prosrc) body_md5,pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.proconfig config,p.prosecdef security_definer,p.provolatile volatility,p.proparallel parallel,p.proisstrict strict,p.proleakproof leakproof,p.procost cost,p.prorows rows,pg_get_function_arguments(p.oid) args,pg_get_function_result(p.oid) result,l.lanname language from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(expected->>'identity'))s;
 if actual is distinct from expected then raise exception using errcode='55000',message='created_rollout_rollback_drift:'||(expected->>'identity');end if;end loop;end;$guard$;
do $helper$ declare meta_row record;begin
 select md5(p.prosrc)body,pg_get_userbyid(p.proowner)owner,p.proacl::text acl,p.proconfig,p.prosecdef,p.provolatile,p.proisstrict,p.proparallel into meta_row from pg_proc p where p.oid=to_regprocedure('private.dashboard_created_manual_transition(jsonb,jsonb,text)');
 if meta_row.body is distinct from 'a4c3046dfdc24cc9c65c9a19d8594af3' or meta_row.owner is distinct from'postgres'or meta_row.acl is distinct from'{postgres=X/postgres}'or meta_row.proconfig is distinct from array['search_path=""']or meta_row.prosecdef or meta_row.provolatile<>'s'or meta_row.proisstrict or meta_row.proparallel<>'u'then raise exception using errcode='55000',message='created_transition_helper_drift';end if;
 if not exists(select 1 from pg_class where oid=to_regclass('private.created_cohort_manual_transition')and relowner=(select oid from pg_roles where rolname='postgres')and relrowsecurity and not relforcerowsecurity and not exists(select 1 from aclexplode(coalesce(relacl,acldefault('r',relowner)))a where a.grantee<>relowner or a.grantor<>relowner))then raise exception using errcode='55000',message='created_transition_table_drift';end if;
 if (select count(*)from pg_constraint where conrelid='private.created_cohort_manual_transition'::regclass and contype='f')<>1 or not exists(select 1 from pg_constraint where conrelid='private.created_cohort_manual_transition'::regclass and contype='f'and convalidated and pg_get_constraintdef(oid)='FOREIGN KEY (artifact_id) REFERENCES private.prepared_aggregate_artifacts(id) ON DELETE CASCADE')then raise exception using errcode='55000',message='created_transition_cascade_drift';end if;
end;$helper$;
CREATE OR REPLACE FUNCTION private.dashboard_serving_ready_read(p_page text, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare catalog jsonb;targets jsonb:='[]';q jsonb;t jsonb;c jsonb;baseq jsonb;k jsonb;
 commons jsonb:='{}';scope text;common text;dep text;reason text;items jsonb:='[]';response jsonb;payload jsonb;
 a timestamptz;b timestamptz;local_a timestamp;local_b timestamp;at timestamptz:=statement_timestamp();
 j private.prepared_aggregate_jobs%rowtype;artifact private.prepared_aggregate_artifacts%rowtype;master record;
begin
 -- The unchanged wrapper has already verified page/query/session/context.
 -- This helper is private, invoker-only, and cannot be called by API roles.
 if current_user<>'postgres'then raise exception using errcode='42501',message='prepared_ready_worker_denied';end if;
 if p_page is distinct from'providers'or p_request is null or jsonb_typeof(p_request)is distinct from'object'
  or p_request-array['requests','publicationVersion','readMode']<>'{}'::jsonb
  or p_request->'readMode'is distinct from'"ready-only-v1"'::jsonb
  or p_request->'publicationVersion'is distinct from'2'::jsonb
  or jsonb_typeof(p_request->'requests')is distinct from'array'
  or jsonb_array_length(p_request->'requests')not between 1 and 50
  or octet_length(p_request::text)>128000
  or exists(select 1 from jsonb_array_elements(p_request->'requests')r group by r having count(*)>1)
 then raise exception using errcode='22023',message='prepared_ready_envelope_invalid';end if;
 -- Native scope is revalidated before any head lookup. No presentation alias
 -- or client-supplied native metadata can authorize a platform.
 select coalesce(jsonb_agg(to_jsonb(p)),'[]')into catalog from private.dashboard_admin_live_platforms()p;
 for q in select value from jsonb_array_elements(p_request->'requests')loop
  if jsonb_typeof(q)is distinct from'object'or q->>'action'is distinct from'aggregate'
   or q->>'view'is distinct from'providers'then raise exception using errcode='22023',message='prepared_ready_query_invalid';end if;
  select value into t from jsonb_array_elements(catalog)where value->>'id'=q->>'platformId';
  if t is null then raise exception using errcode='42501',message='platform_denied';end if;
  reason:=private.prepared_aggregate_request_reason(q,t);
  if reason is not null then raise exception using errcode='22023',message='prepared_ready_query_invalid';end if;
  targets:=targets||jsonb_build_array(t);
 end loop;
 for q,t in select r.value,x.value from jsonb_array_elements(p_request->'requests')with ordinality r(value,n)
  join jsonb_array_elements(targets)with ordinality x(value,n)using(n)loop
  c:=private.prepared_aggregate_canonical_request(q,t);
  a:=(c->>'startAt')::timestamptz;b:=(c->>'endAt')::timestamptz;
  local_a:=a at time zone(t->>'timezone');local_b:=b at time zone(t->>'timezone');
  if c->>'status'<>'all'or c?'durationRange'or c->>'successBasis'<>'success'
   or a is distinct from(c->>'successStartAt')::timestamptz or b is distinct from(c->>'successEndAt')::timestamptz
   or local_a<>date_trunc('day',local_a)or local_b<>date_trunc('day',local_b)
   or local_b::date-local_a::date<>1 or b>at
  then
   items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','miss','reason','ready_query_not_supported','publication',null,'result',null));continue;
  end if;
  scope:=case when t->>'source'='game66'then'IN'else t->>'scope_group'end;
  common:=commons->>scope;if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;
  dep:=private.prepared_aggregate_dependency(t,common);
  baseq:=private.prepared_aggregate_base_request(q,t);k:=private.prepared_aggregate_key(baseq,t);
  -- Match the existing wrapper priority: a proven full master precedes an
  -- exact provider base, even when both immutable heads are present. Unlike
  -- the old all-or-nothing batch adapter, one miss does not block ready peers.
   with candidates as materialized(
    select z.*from private.prepared_aggregate_jobs z where z.target=t and z.dependency=dep
     and z.request->>'platformId'=c->>'platformId'
     and(z.request->>'startAt')::timestamptz=a and(z.request->>'endAt')::timestamptz=b
     and coalesce(z.request->>'successStartAt',z.request->>'startAt')::timestamptz=(c->>'successStartAt')::timestamptz
     and coalesce(z.request->>'successEndAt',z.request->>'endAt')::timestamptz=(c->>'successEndAt')::timestamptz
     and z.request->>'view'='full'and z.request->>'durationVersion'='2')
   select z.id job_id,x.id artifact_id into master from candidates z
    join private.prepared_aggregate_heads h on h.job_id=z.id
    join private.prepared_aggregate_artifacts x on x.id=h.artifact_id and x.job_id=z.id
    where x.dependency=dep and x.revision=z.revision
     and z.request_key=private.prepared_aggregate_key(z.request,t)and z.request_fingerprint=md5(z.request_key::text)
     and z.request->>'direction'='all'and not(z.request?'durationRange')and coalesce(z.request->>'status','all')='all'
     and coalesce(z.request->'providers','[]'::jsonb)='[]'::jsonb
     and(private.prepared_aggregate_canonical_request(z.request,t)-array['view','durationVersion','amountBands','direction','providers'])
       =(c-array['view','durationVersion','amountBands','direction','providers'])
     and x.computed_at is not null and x.expires_at is not null and x.cutoff is not null
     and isfinite(x.computed_at)and isfinite(x.expires_at)and isfinite(x.cutoff)
     and x.computed_at<=at and x.expires_at>x.computed_at and x.source_complete is not null
    -- Use the same IDR default ownership as the ordinary serving adapter.
    -- This read-only selection never changes publication or refresh clocks.
    order by case when t->>'currency'='IDR'and not(c?'amountBands')
     and z.request->'amountBands'=private.dashboard_serving_default_amount_bands('IDR')then 0 else 1 end,
     x.computed_at desc,z.id limit 1;
  if found then
   select *into j from private.prepared_aggregate_jobs where id=master.job_id;
   select *into artifact from private.prepared_aggregate_artifacts where id=master.artifact_id;
   baseq:=j.request;
  else
  select *into j from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k;
  select a0.*into artifact from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a0
   on a0.id=h.artifact_id and a0.job_id=j.id where h.job_id=j.id;
  -- Time expiry is not a semantic revision in V2. Preserve it as refresh_due;
  -- generation, cutoff, sourceComplete and retry/lease state are never rewritten.
  if artifact.id is null or j.target is distinct from t or j.dependency is distinct from dep
   or artifact.revision is distinct from j.revision or artifact.dependency is distinct from dep
   or j.request_key is distinct from private.prepared_aggregate_key(j.request,t)
   or artifact.computed_at is null or artifact.expires_at is null or artifact.cutoff is null
   or not isfinite(artifact.computed_at)or not isfinite(artifact.expires_at)or not isfinite(artifact.cutoff)
   or artifact.computed_at>at or artifact.expires_at<=artifact.computed_at or artifact.source_complete is null

  then
   items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','miss','reason','ready_head_missing','publication',null,'result',null));continue;
  end if;
  end if;
  if jsonb_typeof(artifact.payload)is distinct from'object'
   or jsonb_typeof(artifact.payload#>'{groups,provider}')is distinct from'array'
  then raise exception using errcode='22023',message='prepared_ready_publication_invalid';end if;
  payload:=case when baseq->>'view'='full'and baseq->>'durationVersion'='2'and not(baseq?'durationRange')
   then private.prepared_aggregate_master_projection(artifact.payload,private.prepared_aggregate_canonical_request(baseq,t),c)
   else private.dashboard_prepared_provider_projection(artifact.payload,private.prepared_aggregate_canonical_request(baseq,t),c)end;
  items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','ready','publication',jsonb_build_object(
   'id',artifact.id,'generation',artifact.revision::text||':'||artifact.fence::text,'computedAt',artifact.computed_at,
   'expiresAt',artifact.expires_at,'cutoff',artifact.cutoff,'calculationComplete',true,'sourceComplete',artifact.source_complete,
   'freshness',case when artifact.expires_at>at then'fresh'else'refresh_due'end,'nextRefreshAt',j.next_due_at,
   'refreshState',case when j.status='ready'then'idle'else j.status end),
   'result',private.prepared_aggregate_echo(payload,q,t)));
 end loop;
 response:=jsonb_build_object('version',2,'readMode','ready-only-v1','items',items);
 if octet_length(response::text)>16*1024*1024 then raise exception using errcode='54000',message='prepared_ready_response_capacity';end if;
 return response;
end;$function$;
CREATE OR REPLACE FUNCTION private.prepared_aggregate_secondary_reason(q jsonb, t jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare s text:=t->>'source';basis text:=coalesce(q->>'successBasis',case when s='duoli'then 'source_updated'else 'success'end);direction text:=coalesce(q->>'direction','all');
begin
 if basis='source_updated'then
  if s not in('newar','duoli','wg','game66')or s='wg'and direction<>'charge'or s='game66'and direction<>'withdraw'then return 'source_update_time_unavailable';end if;
  if s='newar'and not exists(select 1 from pg_index where indexrelid=to_regclass('public.newar_detail_source_updated_success_idx')and indrelid=to_regclass('public.newar_detail_records')and indisvalid and indisready and pg_get_indexdef(indexrelid)like '%(platform, dataset, source_updated_at)%'and pg_get_expr(indpred,indrelid)like '%status_group%success%')then return 'source_update_index_not_ready';end if;
 elsif s='duoli'then return 'payment_success_time_unavailable';end if;
 if s='wg'and direction<>'charge'then return 'payment_success_time_unavailable_for_withdraw';end if;
 if s='panda'then return 'success_window_coverage_unavailable';end if;
 return null;
end;$function$;
CREATE OR REPLACE FUNCTION private.prepared_aggregate_request_reason(q jsonb, t jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare k text;a timestamptz;b timestamptz;c timestamptz;d timestamptz;s text:=t->>'source';basis text:=q->>'successBasis';direction text:=coalesce(q->>'direction','all');n numeric;
begin
 if q is null or jsonb_typeof(q)<>'object' or octet_length(q::text)>32768
  or q->>'action' is distinct from 'aggregate' or coalesce(q->>'view','full')not in('providers','full')
  or q->>'platformId' is distinct from t->>'id' or t->>'source' not in('ar','newar','lg','game66','wg','duoli','kb','panda') then return 'unsupported_request';end if;
 if exists(select 1 from jsonb_object_keys(q)x where x<>all(array['action','view','platformId','startAt','endAt','successStartAt','successEndAt','successBasis','direction','status','providers','channelTypes','currency','amountMin','amountMax','amountMaxExclusive','amountBands','durationVersion','durationRange','offset','limit'])) then return 'unsupported_filter';end if;
 foreach k in array array['startAt','endAt','successStartAt','successEndAt'] loop
  if k in('startAt','endAt') or q?k then
   if jsonb_typeof(q->k)is distinct from 'string' or q->>k !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$' then return 'invalid_time';end if;
  end if;
 end loop;
 a:=(q->>'startAt')::timestamptz;b:=(q->>'endAt')::timestamptz;c:=coalesce(q->>'successStartAt',q->>'startAt')::timestamptz;d:=coalesce(q->>'successEndAt',q->>'endAt')::timestamptz;
 if not(isfinite(a)and isfinite(b)and isfinite(c)and isfinite(d))or a>=b or c>=d or b-a>interval'32days'or d-c>interval'32days'or ((b-interval'1microsecond')at time zone(t->>'timezone'))::date-(a at time zone(t->>'timezone'))::date>30 or ((d-interval'1microsecond')at time zone(t->>'timezone'))::date-(c at time zone(t->>'timezone'))::date>30 then return 'invalid_time_range';end if;
 if (q?'successStartAt')<>(q?'successEndAt') or (q?'successBasis' and (jsonb_typeof(q->'successBasis')is distinct from 'string' or basis not in('success','source_updated'))) then return 'invalid_success_clock';end if;
 if coalesce(q->>'view','full')='providers'and coalesce(q->>'status','all')<>'all'then return'unsupported_providers_status';end if;
 if direction not in('all','charge','withdraw')or coalesce(q->>'status','all')not in('all','success','pending','failed','rejected','unknown') then return 'invalid_status_or_direction';end if;
 foreach k in array array['providers','channelTypes']loop
  if q?k and q->k<>'null'::jsonb then
   if jsonb_typeof(q->k)<>'array'or jsonb_array_length(q->k)>200 or exists(select 1 from jsonb_array_elements(q->k)x where jsonb_typeof(x)<>'string'or length(x#>>'{}')not between 1 and 200 or x#>>'{}'~'[[:cntrl:]]')then return 'invalid_filter';end if;
  end if;
 end loop;
 if q?'currency'and q->'currency'<>'null'::jsonb and(jsonb_typeof(q->'currency')<>'string'or length(q->>'currency')>16)then return 'invalid_currency';end if;
 foreach k in array array['amountMin','amountMax']loop if q?k and q->k<>'null'::jsonb then n:=(q->>k)::numeric;if n::text in('NaN','Infinity','-Infinity')then return 'invalid_amount';end if;end if;end loop;
 if (q->>'amountMin')::numeric>(q->>'amountMax')::numeric or (q->>'amountMaxExclusive')::boolean and(q->>'amountMin')::numeric>=(q->>'amountMax')::numeric then return 'invalid_amount';end if;
 if q?'amountMaxExclusive'and(jsonb_typeof(q->'amountMaxExclusive')<>'boolean'or q->>'amountMax'is null)then return 'invalid_amount';end if;
 if q?'offset'and coalesce(q->>'offset','')<>'0'then return 'unsupported_offset';end if;
 if q?'limit'and coalesce(q->>'limit','')not in('20','30','50','100','500')then return 'invalid_limit';end if;
 perform private.dashboard_admin_validate_duration(q);perform private.dashboard_admin_validate_amount_bands(q->'amountBands',direction);
 return null;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then return 'invalid_filter';
end;$function$;
CREATE OR REPLACE FUNCTION private.prepared_aggregate_read(p_page text, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare access jsonb;page jsonb;catalog jsonb;targets jsonb:='[]';q jsonb;t jsonb;items jsonb:='[]';reason text;dep text;k jsonb;j private.prepared_aggregate_jobs%rowtype;a private.prepared_aggregate_artifacts%rowtype;status text;v_id uuid;v_actor uuid:=auth.uid();budget integer;ctx jsonb;baseq jsonb;payload jsonb;commons jsonb:='{}';scope text;common text;v2 boolean;force_refresh boolean;freshness text;admitted_id uuid;preparation jsonb;
begin
 access:=private.dashboard_role_access();
 if (access->>'canView')::boolean is not true then raise exception using errcode='42501',message='preview_denied';end if;
 select value into page from jsonb_array_elements(private.dashboard_role_catalog()->'pages')where value->>'id'=p_page;
 if page is null or not(page->'requests'?'aggregate')or not(page->'requests'?'aggregatePrepared')then raise exception using errcode='42501',message='page_action_denied';end if;
 if access->>'mode'='assigned'then
  if not private.dashboard_role_context_valid()or not(access->'permissions'?&array[p_page||'.view',p_page||'.query'])then raise exception using errcode='42501',message='role_permission_denied';end if;
  ctx:=nullif(current_setting('hensem.dashboard_role_context',true),'')::jsonb->'payload';
  if ctx->>'page'is distinct from p_page or ctx->>'rpc'is distinct from 'dashboard_admin_live_aggregate_prepared'or ctx->>'action'is distinct from 'aggregatePrepared'then raise exception using errcode='42501',message='page_action_denied';end if;
 end if;
 if p_request is null or jsonb_typeof(p_request)<>'object'or p_request-array['requests','publicationVersion','forceRefresh']<>'{}'::jsonb or octet_length(p_request::text)>1048576
 or jsonb_typeof(p_request->'requests')is distinct from 'array'or jsonb_array_length(p_request->'requests')not between 1 and 50 then raise exception using errcode='22023',message='invalid_prepared_batch';end if;
 if p_request?'publicationVersion'and p_request->'publicationVersion'<>'2'::jsonb or p_request?'forceRefresh'and(jsonb_typeof(p_request->'forceRefresh')<>'boolean'or p_request->'publicationVersion'is distinct from '2'::jsonb)then raise exception using errcode='22023',message='invalid_prepared_publication_version';end if;
 v2:=coalesce(p_request->'publicationVersion'='2'::jsonb,false);force_refresh:=coalesce((p_request->>'forceRefresh')::boolean,false);
 -- Includes profile/session/IP/grant and exact native scope authorization.
 select coalesce(jsonb_agg(to_jsonb(p)),'[]')into catalog from private.dashboard_admin_live_platforms()p;
 for q in select value from jsonb_array_elements(p_request->'requests')loop
  begin v_id:=(q->>'platformId')::uuid;exception when others then raise exception using errcode='22023',message='invalid_platform';end;
  select value into t from jsonb_array_elements(catalog)where value->>'id'=v_id::text;
  if t is null then raise exception using errcode='42501',message='platform_denied';end if;
  targets:=targets||jsonb_build_array(t);
 end loop;
 for q,t in select r.value,x.value from jsonb_array_elements(p_request->'requests')with ordinality r(value,n)join jsonb_array_elements(targets)with ordinality x(value,n)using(n)loop
  reason:=private.prepared_aggregate_request_reason(q,t);
  if reason is not null then items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','unsupported','reason',reason,'publication',null,'result',null));continue;end if;
  scope:=case when t->>'source'='game66'then'IN'else t->>'scope_group'end;common:=commons->>scope;if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;dep:=private.prepared_aggregate_dependency(t,common);baseq:=private.prepared_aggregate_base_request(q,t);k:=private.prepared_aggregate_key(baseq,t);payload:=null;
  select *into j from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k;
  select a0.*into a from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a0 on a0.id=h.artifact_id where h.job_id=j.id;
  if a.id is not null and a.revision=j.revision and a.dependency=dep and j.dependency=dep and j.target=t and(v2 or a.expires_at>clock_timestamp())then
   -- Time expiry is a refresh signal, not a new semantic revision. Only a
   -- ready job is re-queued; running leases and failed retry budgets survive.
   if v2 and(force_refresh or(a.expires_at<=clock_timestamp()and coalesce(j.next_due_at,a.expires_at)<=clock_timestamp()))then
    update private.prepared_aggregate_jobs z set status='queued',attempts=0,not_before=clock_timestamp()
     where z.id=j.id and z.status='ready'and z.revision=j.revision and z.dependency=dep and z.target=t;
    select *into j from private.prepared_aggregate_jobs where id=j.id;
    if j.revision is distinct from a.revision or j.dependency is distinct from dep or j.target is distinct from t then
     items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','stale','publication',null,'result',null));continue;
    end if;
   end if;
   freshness:=case when a.expires_at>clock_timestamp()then'fresh'else'refresh_due'end;
   payload:=case when baseq->>'view'='full'and baseq->>'durationVersion'='2'and not(baseq?'durationRange')then private.prepared_aggregate_master_projection(a.payload,private.prepared_aggregate_canonical_request(baseq,t),private.prepared_aggregate_canonical_request(q,t))when coalesce(q->>'view','full')='providers'then private.dashboard_prepared_provider_projection(a.payload,private.prepared_aggregate_canonical_request(baseq,t),private.prepared_aggregate_canonical_request(q,t))when baseq->>'direction'='all'then private.dashboard_prepared_direction_projection(a.payload,private.prepared_aggregate_canonical_request(baseq,t),private.prepared_aggregate_canonical_request(q,t))else a.payload end;
   update private.prepared_aggregate_jobs set last_requested_at=clock_timestamp()where id=j.id and last_requested_at<clock_timestamp()-interval'5minutes';
   items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','ready','publication',jsonb_build_object('id',a.id,'generation',a.revision::text||':'||a.fence::text,'computedAt',a.computed_at,'expiresAt',a.expires_at,'cutoff',a.cutoff,'calculationComplete',true,'sourceComplete',a.source_complete)||case when v2 then jsonb_build_object('freshness',freshness,'nextRefreshAt',j.next_due_at,'refreshState',case when j.status='ready'then'idle'else j.status end)else'{}'::jsonb end,
    'result',private.prepared_aggregate_echo(coalesce(payload,a.payload),q,t)));
  else
   admitted_id:=null;preparation:=jsonb_build_object('state','unavailable','retryable',false);
   status:=case when a.id is not null then 'stale'when j.status in('queued','running')then'building'else'missing'end;
   -- Count newly observed exact requests only. Exceeding admission budget never
   -- reveals another scope or falls back to a synchronous source scan.
   if j.id is null then
    insert into private.prepared_aggregate_admissions(actor,day,total)values(v_actor,current_date,1)on conflict(actor,day)do update set total=private.prepared_aggregate_admissions.total+1 where private.prepared_aggregate_admissions.total<1000 returning total into budget;
    if budget is not null then admitted_id:=private.prepared_aggregate_enqueue(baseq,t,dep,20::smallint);end if;
   else
    admitted_id:=private.prepared_aggregate_enqueue(baseq,t,dep,20::smallint);
    update private.prepared_aggregate_jobs z set status='queued',not_before=clock_timestamp()where z.id=j.id and z.status='ready'and(a.expires_at<=clock_timestamp()or a.id is null);
   end if;

   -- First authorized wait only; polling must not renew the priority age.
   -- Existing usable v2 publications return above and keep background refresh.
   -- The marker never enters the semantic key, permission scope or payload.
   update private.prepared_aggregate_jobs z set interactive_requested_at=clock_timestamp()
    where z.id=admitted_id and z.request_key=k and z.dependency=dep and z.target=t
     and z.status='queued'and z.attempts<3 and isfinite(z.not_before)
     and z.interactive_requested_at is null;
   select *into j from private.prepared_aggregate_jobs z
    where z.id=admitted_id and z.request_key=k and z.dependency=dep and z.target=t;
   if found then
    preparation:=jsonb_build_object('state',
     case when j.status='queued'and j.attempts<3 and isfinite(j.not_before)then'queued'
      when j.status='running'and j.lease_until>clock_timestamp()then'running'
      when j.status='failed'then'failed'else'unavailable'end,
     'retryable',(j.status='queued'and j.attempts<3 and isfinite(j.not_before))
      or(j.status='running'and coalesce(j.lease_until>clock_timestamp(),false)));
   end if;
   items:=items||jsonb_build_array(jsonb_build_object('request',q,'status',status,'publication',null,'result',null,'preparation',preparation));
  end if;
 end loop;
 return jsonb_build_object('version',case when v2 then 2 else 1 end,'items',items);
end;$function$;
CREATE OR REPLACE FUNCTION private.prepared_aggregate_raw_kernel(p_request jsonb, p_catalog jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare
  v_secondary_start timestamptz;v_secondary_end timestamptz;v_basis text;v_secondary_available boolean;
  v_action text; v_options jsonb; v_platform record; v_meta jsonb; v_capabilities jsonb; v_panda_coverage jsonb;
  v_id uuid; v_start timestamptz; v_end timestamptz; v_asof timestamptz := statement_timestamp();
  v_direction text; v_status text; v_order text; v_third text; v_member text; v_system text; v_utr text;
  v_providers text[]; v_types text[]; v_currency text; v_min numeric; v_max numeric;
  v_offset integer; v_limit integer; v_key text; v_source text; v_sql text; v_result jsonb;
  v_confirmations jsonb := '{}'::jsonb;
  v_fee_country text; v_fee_currency_proven boolean := false;
  -- aggregate_exclusive_amount_max_v1: one parsed boolean, never epsilon math.
  v_max_exclusive boolean := false;
  -- duration_precision_ranges_v2: parse once, use bound numeric parameters.
  v_duration jsonb;v_duration_version integer;v_duration_min numeric;v_duration_max numeric;v_duration_custom boolean;
  -- dynamic_amount_bands_v1: validate/parse once, never once per order.
  v_amount_bands jsonb; v_charge_edges numeric[]; v_withdraw_edges numeric[];
begin
 -- duoli_existing_orders_v1
 -- wg_existing_orders_v1
  -- Catalog helper validates Auth, active profile, independent grant and scope
  -- on every call, including queries with no matching orders.
  v_options:=p_catalog;
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>32768
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'successStartAt','successEndAt','successBasis','action','platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId',
      'utr','providers','channelTypes','currency','amountMin','amountMax','amountMaxExclusive','amountBands','durationVersion','durationRange','offset','limit','view'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  v_action:=coalesce(p_request->>'action','catalog');
  if v_action<>'aggregate' then raise exception using errcode='22023',message='prepared_aggregate_only';end if;
  v_secondary_start:=coalesce(p_request->>'successStartAt',p_request->>'startAt')::timestamptz;
  v_secondary_end:=coalesce(p_request->>'successEndAt',p_request->>'endAt')::timestamptz;
  v_basis:=coalesce(p_request->>'successBasis','legacy');
  v_duration:=private.dashboard_admin_validate_duration(p_request);
  v_duration_version:=(v_duration->>'version')::integer;
  v_duration_min:=(v_duration->>'min_ms')::numeric;v_duration_max:=(v_duration->>'max_ms')::numeric;
  v_duration_custom:=coalesce((v_duration->>'custom')::boolean,false);
  v_amount_bands:=private.dashboard_admin_validate_amount_bands(p_request->'amountBands',coalesce(p_request->>'direction','all'));
  select array_agg(value::numeric order by ordinality) into v_charge_edges
    from jsonb_array_elements_text(v_amount_bands->'charge') with ordinality;
  select array_agg(value::numeric order by ordinality) into v_withdraw_edges
    from jsonb_array_elements_text(v_amount_bands->'withdraw') with ordinality;
  if p_request ? 'view' and (jsonb_typeof(p_request->'view')<>'string' or p_request->>'view' not in ('full','providers') or v_action<>'aggregate') then
    raise exception using errcode='22023',message='invalid_view';
  end if;
  if v_action not in ('catalog','query','aggregate','details') then raise exception using errcode='22023',message='invalid_action'; end if;
  if v_action='catalog' then
    if p_request-array['action']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_catalog_request'; end if;
    return jsonb_build_object('version',1,'asOf',v_asof,'platforms',(
      select coalesce(jsonb_agg((p-array['scope_group','source_name'])||jsonb_build_object('scopeGroup',p->'scope_group','sourceName',p->'source_name',
        'capabilities',jsonb_build_object('systemOrderId',p->>'source'='newar','thirdPartyOrderNumber',p->>'source' in ('newar','game66'),'utr',false,
          'historicalFees',true,'actualAmount',p->>'source'<>'ar','recordedFee',p->>'source' in ('newar','game66'),'scopeGroupIsGeographicCountry',p->>'source'<>'game66')||case when p->>'source'='ar' then private.ar_middle_channel_capabilities((p->>'id')::uuid)
      when p->>'source'='panda' then private.dashboard_admin_panda_capabilities()
      when p->>'source'='kb' then private.dashboard_admin_yash_capabilities()
      when p->>'source'='duoli' then private.dashboard_admin_duoli_capabilities()
      when p->>'source'='wg' then private.dashboard_admin_wg_capabilities() else '{}'::jsonb end)),'[]'::jsonb)
      from jsonb_array_elements(v_options) p));
  end if;
  foreach v_key in array array['platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId','utr','currency'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb and
      (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  begin
    v_id:=(p_request->>'platformId')::uuid;
    if coalesce(p_request->>'startAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$'
      or coalesce(p_request->>'endAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      raise exception using errcode='22023',message='invalid_time';
    end if;
    v_start:=(p_request->>'startAt')::timestamptz; v_end:=(p_request->>'endAt')::timestamptz;
    v_offset:=coalesce((p_request->>'offset')::integer,0); v_limit:=coalesce((p_request->>'limit')::integer,20);
    v_min:=nullif(p_request->>'amountMin','')::numeric; v_max:=nullif(p_request->>'amountMax','')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='invalid_filter';
  end;
  if p_request?'amountMaxExclusive' then
    if v_action<>'aggregate' or jsonb_typeof(p_request->'amountMaxExclusive') is distinct from 'boolean'
      or v_max is null then
      raise exception using errcode='22023',message='invalid_amount_max_exclusive';
    end if;
    v_max_exclusive:=(p_request->>'amountMaxExclusive')::boolean;
    if v_max_exclusive and v_min>=v_max then
      raise exception using errcode='22023',message='invalid_range';
    end if;
  end if;
  select * into v_platform from jsonb_to_recordset(v_options)
    as p(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) where p.id=v_id;
  if not found then raise exception using errcode='42501',message='platform_denied'; end if;
  -- Fee evidence is stricter than the legacy display projection. In particular
  -- a country-default AR currency is not source currency proof.
  v_fee_country:=v_platform.scope_group;
  if v_platform.source='ar' then
    v_fee_currency_proven:=exists(select 1 from public.ar_config_targets t
      where t.source_system='AR' and t.country_code=v_platform.scope_group and t.platform=v_platform.source_name
        and nullif(btrim(t.currency),'') is not null and t.currency=v_platform.currency);
  elsif v_platform.source in ('newar','wg') then
    -- These adapters project each order's explicit native currency.
    v_fee_currency_proven:=true;
  elsif v_platform.source='lg' then
    -- Existing confirmed LG adapters have an explicit currency contract; no
    -- generic country fallback or unknown-country adapter may price orders.
    v_fee_currency_proven:=case v_platform.scope_group when 'PH' then v_platform.currency='PHP'
      when 'ID' then v_platform.currency='IDR' when 'PK' then v_platform.currency='PKR' else false end;
  elsif v_platform.source='game66' then
    -- GAME66's source scope identifies the owning team, while its native
    -- monetary unit is explicitly INR. Authorization still uses that scope.
    v_fee_country:='IN';
    v_fee_currency_proven:=v_platform.scope_group in ('HK_TEAM','RED_CRAB') and v_platform.currency='INR';
  end if;
  if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_start>=v_end
    or (v_end at time zone v_platform.timezone)-(v_start at time zone v_platform.timezone)>interval '31 days'
    or v_offset<0 or v_limit not in (20,30,50,100,500)
    or (p_request ? 'offset' and coalesce(p_request->>'offset','0') !~ '^[0-9]+$')
    or (p_request ? 'limit' and coalesce(p_request->>'limit','20') !~ '^[0-9]+$')
    or v_min::text in ('NaN','Infinity','-Infinity') or v_max::text in ('NaN','Infinity','-Infinity')
    or v_min>v_max then raise exception using errcode='22023',message='invalid_range'; end if;
  v_direction:=coalesce(p_request->>'direction','all'); v_status:=coalesce(p_request->>'status','all');
  if v_direction not in ('all','charge','withdraw') or v_status not in ('all','success','pending','failed','rejected','unknown') then
    raise exception using errcode='22023',message='invalid_status_or_direction';
  end if;
  v_order:=nullif(btrim(p_request->>'orderNumber'),''); v_third:=nullif(btrim(p_request->>'thirdPartyOrderNumber'),''); v_member:=nullif(btrim(p_request->>'memberId'),'');
  v_system:=nullif(btrim(p_request->>'systemOrderId'),''); v_utr:=nullif(btrim(p_request->>'utr'),'');
  v_currency:=nullif(btrim(p_request->>'currency'),'');
  if (v_utr is not null and v_platform.source<>'wg') or (v_system is not null and v_platform.source<>'newar') or (v_third is not null and v_platform.source not in ('newar','game66','wg','kb')) then
    raise exception using errcode='22023',message='unsupported_filter';
  end if;
  foreach v_key in array array['providers','channelTypes'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb then
      if jsonb_typeof(p_request->v_key)<>'array' or jsonb_array_length(p_request->v_key)>2000 then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
      if exists(select 1 from jsonb_array_elements(p_request->v_key) a where jsonb_typeof(a)<>'string'
        or length(a#>>'{}') not between 1 and 200 or (a#>>'{}') ~ '[[:cntrl:]]') then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
    end if;
  end loop;
  if jsonb_typeof(p_request->'providers')='array' then select array_agg(value) into v_providers from jsonb_array_elements_text(p_request->'providers'); end if;
  if jsonb_typeof(p_request->'channelTypes')='array' then select array_agg(value) into v_types from jsonb_array_elements_text(p_request->'channelTypes'); end if;
  v_capabilities:=jsonb_build_object('systemOrderId',v_platform.source='newar','thirdPartyOrderNumber',v_platform.source in ('newar','game66'),'utr',false,'historicalFees',true,
    'timeBasis','created_for_all_and_non_success','successTimeBasis','success_at','successCohort','success_at_in_selected_range',
    'latencyBasis','success_at_to_created_at','customerPaymentTime',false,
    'pendingBasis','selected_created_cohort_current_stored_status','asOfBasis','query_time_not_source_snapshot',
    'sourceCompletenessVerified',false,'actualAmount',v_platform.source<>'ar','recordedFee',v_platform.source in ('newar','game66'));
  if v_platform.source='wg' then
    if false then
      raise exception using errcode='22023',message='unsupported_success_time_filter_for_wg_withdraw';
    end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_wg_capabilities(v_direction);
  end if;
  if v_platform.source='duoli' then
    v_capabilities:=v_capabilities||private.dashboard_admin_duoli_capabilities();
  end if;
  if v_platform.source='kb' then v_capabilities:=v_capabilities||private.dashboard_admin_yash_capabilities();end if;
  if v_platform.source='panda' then
    if v_member is not null then raise exception using errcode='22023',message='unsupported_member_filter_for_panda';end if;
    
    v_capabilities:=v_capabilities||private.dashboard_admin_panda_capabilities(v_direction);
    v_panda_coverage:=private.dashboard_admin_panda_query_coverage(v_platform.source_name,v_direction,v_start,v_end);
    if v_action<>'details' and (v_panda_coverage->>'complete')::boolean is not true then raise exception using errcode='22023',message='PANDA_COVERAGE_INCOMPLETE';end if;
  end if;
  if p_request?'successBasis'then v_capabilities:=v_capabilities||jsonb_build_object('successTimeBasis',case when v_basis='source_updated'then'source_updated_at'else'success_at'end,'successCohort','independent_secondary_window','independentSuccessWindow',true);end if;
  v_meta:=jsonb_build_object('id',v_platform.id,'name',v_platform.name,'source',v_platform.source,'sourceName',v_platform.source_name,
    'scopeGroup',v_platform.scope_group,'country',v_platform.country,'team',v_platform.team,
    'timezone',v_platform.timezone,'currency',v_platform.currency,'capabilities',v_capabilities);
  -- All branches project an explicit safe allowlist. No raw JSON, contact,
  -- account/UPI fields, comments, free text, or credentials are selected.
  if v_platform.source='ar' then
    -- Read the small, platform-scoped confirmation map once, outside the order scan.
    -- Optional for older installations; ordinary unknown records remain unknown.
    if to_regclass('private.dashboard_admin_order_provider_confirmations') is not null then
      execute 'select coalesce(jsonb_object_agg(order_kind||chr(31)||order_no,confirmed_provider),''{}''::jsonb)
        from private.dashboard_admin_order_provider_confirmations
        where source_system=$1 and country_code=$2 and platform=$3 and active'
        into v_confirmations using 'AR',v_platform.scope_group,v_platform.source_name;
    end if;
    v_source:=$q$
      select md5(jsonb_build_array(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no)::text)::uuid as id,
        null::text as system_order_id,a.order_no as order_number,null::text as third_party_order_number,a.member_id,
        case when a.order_kind='withdraw' and coalesce(btrim(a.raw_channel),'') in ('','人工取消')
          and a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消','失败','提现失败','出款失败') then '无三方（驳回）'
          else coalesce(nullif(btrim(a.raw_channel),''),$24->>(a.order_kind||chr(31)||a.order_no),'未识别通道') end as provider,
        coalesce(nullif(btrim(a.channel_type),''),'其他类型') as channel_type,
        case a.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,a.status,
        case when a.order_kind='recharge' then case a.status when '已支付' then 'success' when '待支付' then 'pending'
          when '已取消' then 'failed' else 'unknown' end
        else case when a.status='已通过' then 'success' when a.status='已提交' then 'pending'
          when a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消') then 'rejected'
          when a.status in ('失败','提现失败','出款失败') then case when coalesce(btrim(a.raw_channel),'') in ('','人工取消') then 'rejected' else 'failed' end
          else 'unknown' end end as status_group,
        a.applied_at at time zone $4 as created_at,
        case when (a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过')
          then a.completed_at at time zone $4 end as success_at,
        private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end)) as amount,
        null::numeric as actual_amount,null::numeric as withdraw_fee,$21::text as currency,a.updated_at as synced_at,null::text as utr,a.raw_channel as raw_provider
      from public.ar_collected_orders a where a.country_code=$3 and a.platform=$22 and a.source_system='AR'
        and a.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))
        and ($9 is null or a.member_id=$9) and ($10 is null or a.order_no=$10)
    $q$;
    -- ar_local_amount_known_inline_v1: only the fingerprinted native rule is
    -- expanded. A future amount-helper change retains the original call.
    if exists(select 1 from pg_catalog.pg_proc m
      where m.oid=pg_catalog.to_regprocedure('private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)')
        and pg_catalog.md5(m.prosrc)='dc8b95205e35b7366f4f9dbf052d307d'
        and m.proowner='postgres'::regrole and m.prolang=(select oid from pg_catalog.pg_language where lanname='sql')
        and m.provolatile='i' and m.proparallel='s' and not m.prosecdef and not m.proisstrict and not m.proleakproof
        and m.proconfig is not distinct from array['search_path=""']
        and m.proacl::text is not distinct from '{postgres=X/postgres}' and m.pronargdefaults=0
        and m.prorettype='numeric'::regtype and not m.proretset and m.pronargs=8) then
      v_source:=replace(v_source,$ar_amount_call$private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end))$ar_amount_call$,$ar_amount_case$CASE
  WHEN (a.country_code) IS DISTINCT FROM 'IN' THEN (coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end))
  WHEN (a.money_issue_code) = 'LOCAL_AMOUNT_STALE_FOR_USDT' THEN NULL::numeric
  WHEN (a.money_format_version) IS NOT NULL THEN CASE
   WHEN (a.money_format_version) = 1 AND (a.currency_local) = 'INR'
    AND ((a.money_issue_code) IS NULL OR (a.money_issue_code) = 'LOCAL_AMOUNT_NOT_PROVIDED')
    AND (a.amount_local) IS NOT NULL AND (a.amount_local)::text NOT IN ('NaN','Infinity','-Infinity')
   THEN (a.amount_local) ELSE NULL::numeric END
  WHEN (a.order_kind) = 'withdraw' AND upper(btrim(coalesce((a.channel_type),''))) = 'USDT'
   THEN NULL::numeric
  ELSE (coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end))
 END$ar_amount_case$);
    end if;
    -- custom_ar_date_union_v1: index each clock, retain each source row once.
    if position($ar_guard$        and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))$ar_guard$ in v_source)=0 then raise exception using errcode='55000',message='analytical_query_contract_drift';end if;
      v_source:=replace(v_source,$ar_old$        and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))$ar_old$,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$);
    if v_action='aggregate' or v_status='success' then
      v_source:=v_source||' union all '||replace(v_source,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$,$ar_success$        and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
        and a.completed_at>=($5 at time zone $4) and a.completed_at<($6 at time zone $4)
        and (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)) is not true$ar_success$);
    end if;
  elsif v_platform.source='newar' then
    v_source:=$q$
      select n.id,n.source_id as system_order_id,n.order_number,n.third_party_order_number,n.member_id,
        case when n.dataset='charge' and coalesce(btrim(n.provider),'')='' and n.channel_type='ManualRecharge' then '人工充值'
          when n.dataset='withdraw' and n.status_group in ('failed','rejected') and coalesce(btrim(n.provider),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(n.provider),''),'未识别通道') end as provider,coalesce(nullif(btrim(n.channel_type),''),'其他类型') as channel_type,
        n.dataset as direction,n.status_code as status,
        case when n.dataset='withdraw' and n.status_group='failed' and coalesce(btrim(n.provider),'') in ('','人工取消') then 'rejected'
          when n.status_group in ('success','pending','failed','rejected') then n.status_group else 'unknown' end as status_group,
        n.created_at,case when n.status_group='success' then n.success_at end as success_at,
        n.amount,n.actual_amount,n.fee as withdraw_fee,n.currency,n.received_at as synced_at,null::text as utr,n.provider as raw_provider
      from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
      where n.platform=$22 and n.dataset=any(case $7 when 'all' then array['charge','withdraw'] else array[$7] end)
        and (($19<>'aggregate' and $8<>'success' and n.created_at>=$5 and n.created_at<$6)
          or (($19='aggregate' or $8='success') and (n.created_at>=$5 and n.created_at<$6
            or (n.status_group='success' and n.success_at is not null and n.success_at>=$5 and n.success_at<$6))))
        and (t.launch_at is null or n.created_at>=t.launch_at)
        and ($9 is null or n.member_id=$9) and ($10 is null or n.order_number=$10)
        and ($23 is null or n.third_party_order_number=$23)
        and ($11 is null or n.source_id=$11)
    $q$;
  elsif v_platform.source='lg' then
    -- LG timestamps are already timestamptz; never reinterpret them as local
    -- timestamps or restrict paid events to the creation-day stat_date.
    v_source:=$q$
      select md5(jsonb_build_array('LG',l.country_code,l.platform,l.order_kind,l.order_no)::text)::uuid as id,
        null::text as system_order_id,l.order_no as order_number,null::text as third_party_order_number,l.member_id,
        coalesce(nullif(btrim(l.third_party),''),nullif(btrim(l.raw_channel),''),'未识别通道') as provider,
        coalesce(nullif(btrim(l.payment_method),''),'其他类型') as channel_type,
        case l.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,l.status_text as status,
        case when l.status_class in ('success','pending','rejected') then l.status_class else 'unknown' end as status_group,
        l.created_at,case when l.status_class='success' then l.paid_at end as success_at,
        l.metric_amount as amount,l.actual_amount,null::numeric as withdraw_fee,$21::text as currency,
        l.updated_at as synced_at,null::text as utr,l.raw_channel as raw_provider
      from public.lg_orders l
      where l.country_code=$3 and l.platform=$22 and l.source_system='LG'
        and l.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($19<>'aggregate' and $8<>'success' and l.created_at>=$5 and l.created_at<$6)
          or (($19='aggregate' or $8='success') and (l.created_at>=$5 and l.created_at<$6
            or (l.status_class='success' and l.paid_at is not null and l.paid_at>=$5 and l.paid_at<$6))))
        and ($9 is null or l.member_id=$9) and ($10 is null or l.order_no=$10)
    $q$;
  elsif v_platform.source='panda' then
    v_source:=private.dashboard_admin_panda_order_source();
  elsif v_platform.source='kb' then
    v_source:=private.dashboard_admin_yash_order_source();
  elsif v_platform.source='duoli' then
    v_source:=private.dashboard_admin_duoli_order_source();
  elsif v_platform.source='wg' then
    v_source:=private.dashboard_admin_wg_order_source(v_utr,false);
  elsif v_platform.source='game66' then
    v_source:=$q$
      select c.id,null::text as system_order_id,c.order_num as order_number,c.out_trade_no as third_party_order_number,c.uid as member_id,
        coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') as provider,coalesce(nullif(btrim(c.pay_mode),''),'其他类型') as channel_type,
        'charge'::text as direction,coalesce(nullif(c.status_text,''),c.status_code) as status,
        case c.status_code when '1' then 'success' when '0' then
          case when c.status_group in ('pending','failed') then c.status_group else 'pending' end else 'unknown' end as status_group,
        c.create_time as created_at,case when c.status_code='1' then c.pay_time end as success_at,
        coalesce(c.amount_display,c.amount_minor/100.0) as amount,null::numeric as actual_amount,null::numeric as withdraw_fee,
        'INR'::text as currency,c.last_seen_at as synced_at,null::text as utr,c.pay_method_name as raw_provider
      from public.game66_charge_orders c where c.platform_id=$1 and $7 in ('all','charge')
        and (($19<>'aggregate' and $8<>'success' and c.create_time>=$5 and c.create_time<$6)
          or (($19='aggregate' or $8='success') and (c.create_time>=$5 and c.create_time<$6
            or (c.status_code='1' and c.pay_time is not null and c.pay_time>=$5 and c.pay_time<$6))))
        and ($9 is null or c.uid=$9)
        and ($10 is null or c.order_num=$10) and ($23 is null or c.out_trade_no=$23)
      union all
      select w.id,null::text,w.order_num,w.out_trade_no,w.uid,
        case when w.status_code in ('2','-1') and coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'未识别通道') end,
        coalesce(nullif(btrim(w.payout_mode),''),'其他类型'),'withdraw',coalesce(nullif(w.status_text,''),w.status_code),
        case w.status_code when '3' then 'success' when '1' then 'pending' when '2' then case when coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then 'rejected' else 'failed' end when '-1' then 'rejected' else 'unknown' end,
        w.create_time,case when w.status_code='3' then w.update_time end,coalesce(w.amount_display,w.amount_minor/100.0),
        coalesce(w.real_amount_display,w.real_amount_minor/100.0),coalesce(w.fee_display,w.fee_minor/100.0),
        'INR',w.last_seen_at,null::text,coalesce(nullif(w.pay_channel,''),w.pay_method_name)
      from public.game66_withdraw_orders w where w.platform_id=$1 and $7 in ('all','withdraw')
        and (($19<>'aggregate' and $8<>'success' and w.create_time>=$5 and w.create_time<$6)
          or (($19='aggregate' or $8='success') and (w.create_time>=$5 and w.create_time<$6
            or (w.status_code='3' and w.update_time is not null and w.update_time>=$5 and w.update_time<$6))))
        and ($9 is null or w.uid=$9)
        and ($10 is null or w.order_num=$10) and ($23 is null or w.out_trade_no=$23)
    $q$;
  else
    raise exception using errcode='22023',message='unsupported_source';
  end if;
  v_secondary_available:=private.prepared_aggregate_secondary_reason(p_request,to_jsonb(v_platform))is null or(v_direction='all'and(v_platform.source='wg'or(v_platform.source='game66'and v_basis='source_updated')));
  v_source:=private.prepared_aggregate_source_clocks(v_source,v_platform.source,case when v_secondary_available then v_basis else 'legacy' end);
  -- Group and page the identical materialized, filtered source set. The old
  -- detail RPC is never paged repeatedly to manufacture aggregate totals.
  -- Details lets PostgreSQL inline the shared predicate: COUNT can prune all
  -- display/time calculations, and the page can use source time indexes.
  -- Aggregate materializes only compact analytical values (no order IDs/MD5).
  v_sql:='with source_orders as ('||v_source||'), orders as (select *,case when not $38 then null::timestamptz when $37=''source_updated'' then source_updated_at else success_at end as secondary_at from source_orders), filtered as '||
    case when v_action='details' then 'not materialized' else 'materialized' end||$q$ (
    select case when $19<>'aggregate' then id end as id,
      case when $19<>'aggregate' then system_order_id end as system_order_id,
      case when $19<>'aggregate' then order_number end as order_number,
      case when $19<>'aggregate' then third_party_order_number end as third_party_order_number,
      case when $19<>'aggregate' then member_id end as member_id,provider,
      case when $19<>'aggregate' then raw_provider end as raw_provider,
      channel_type,direction,
      case when $19<>'aggregate' then status end as status,status_group,
      created_at,success_at,case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,
      case when $19<>'aggregate' and actual_amount::text not in ('NaN','Infinity','-Infinity') then actual_amount end as actual_amount,
      case when $19<>'aggregate' and withdraw_fee::text not in ('NaN','Infinity','-Infinity') then withdraw_fee end as withdraw_fee,
      currency,synced_at,utr,
      (created_at >= $5 and created_at < $6) as created_in_range,
      (secondary_at >= $35 and secondary_at < $36) as success_in_range,
      (created_at at time zone $4)::date as local_date,
      extract(hour from created_at at time zone $4)::integer as local_hour,
      (secondary_at at time zone $4)::date as success_local_date,
      extract(hour from secondary_at at time zone $4)::integer as success_local_hour,
      case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount in (100,200,300,400,500,750,1000,1500,2000,5000) then trunc(amount)::text else 'other' end as amount_bucket,
      -- Disjoint amount ranges with the labels used by the admin UI. Integer
      -- boundaries are explicit: 100–200, 201–300, and so on. Every order
      -- remains in exactly one range; low/missing values stay visible.
      case when (case when direction='charge' then $25::numeric[] else $26::numeric[] end) is not null then case
        when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<(case when direction='charge' then $25::numeric[] else $26::numeric[] end)[1] then 'below'
        when amount>(case when direction='charge' then $25::numeric[] else $26::numeric[] end)[11] then 'above'
        else 'band:'||(least(width_bucket(amount,(case when direction='charge' then $25::numeric[] else $26::numeric[] end)),10)-1)::text end
        else case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<100 then 'other' when amount<=200 then '100–200'
        when amount<=300 then '201–300' when amount<=400 then '301–400'
        when amount<=500 then '401–500' when amount<=750 then '501–750'
        when amount<=1000 then '751–1,000' when amount<=2000 then '1,001–2,000'
        when amount<=5000 then '2,001–5,000' else '≥5,001' end end as amount_range_bucket,
      case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms,
      case when direction='withdraw' and status_group='pending' and created_at<=$20 then extract(epoch from $20-created_at)*1000 end as pending_wait_ms
    from orders where ($8='all' or status_group=$8) and ($12 is null or provider=any($12))
      and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
      and ($15 is null or amount>=$15) and ($16 is null or case when $31 then amount<$16 else amount<=$16 end)
  ), fee_subjects as materialized (
    select distinct direction,currency,provider,channel_type from filtered where $19<>'details' and status_group='success' and success_in_range
      and ($34 and direction='charge' and channel_type='提现转充值') is not true
      and $33 and exists(select 1 from private.fee_rate_versions where country=$32)
  ), fee_intervals as materialized (
    select s.direction,s.currency,s.provider,s.channel_type,v.* from fee_subjects s
    cross join lateral private.dashboard_admin_fee_intervals($32,$2,s.provider,s.direction,s.currency,private.dashboard_admin_fee_category($32,s.channel_type)) v
  ), fee_version_facts as (
    select f.direction,f.currency,f.provider,jsonb_build_object(
      'fee_version_matched_count',(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_version_unmatched_count',count(*)-(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_exempt_count',count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')),
      'fee_version_estimated_amount',case when count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))>0 then coalesce((sum(f.amount*v.percent_rate+v.fixed_fee) filter(where f.amount>=0)),0)::text end,
      'fee_version_state',case when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))=count(*) then 'complete'
        when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))>0 then 'partial' else 'unknown' end
    ) value from filtered f left join fee_intervals v on v.direction=f.direction and v.currency=f.currency and v.provider=f.provider
      and v.channel_type is not distinct from f.channel_type
      and f.amount>=0 and f.amount::text not in ('NaN','Infinity','-Infinity')
      and isfinite(f.created_at) and f.created_at>=v.effective_from and (v.effective_until is null or f.created_at<v.effective_until)
    where $19<>'details' and f.status_group='success' and f.success_in_range
      and (($33 and exists(select 1 from private.fee_rate_versions where country=$32)) or $34)
    group by f.direction,f.currency,f.provider
  ), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    ), created_metrics as (
    select direction,currency,provider,local_date,local_hour,amount_bucket,amount_range_bucket,
      case when grouping(local_date)=0 then 'daily' when grouping(local_hour,amount_bucket)=0 then 'matrix'
        when grouping(local_hour,amount_range_bucket)=0 then 'matrix_range'
        when grouping(local_hour)=0 then 'hourly' when grouping(amount_bucket)=0 then 'amount'
        when grouping(amount_range_bucket)=0 then 'amount_range'
        when grouping(provider)=0 then 'provider' else 'summary' end as kind,
      count(*) as all_count,case when count(amount)=count(*) then sum(amount) end as all_amount,
      count(*) filter(where amount is null) as missing_amount_count,
      count(*) filter(where amount<0) as negative_amount_count,
      count(*) filter(where status_group='success') as created_success_count,
      0::bigint as success_count,0::numeric as success_amount,
      count(*) filter(where status_group='pending') as pending_count,
      case when count(amount) filter(where status_group='pending')=count(*) filter(where status_group='pending') then coalesce(sum(amount) filter(where status_group='pending'),0) end as pending_amount,
      count(*) filter(where status_group='failed') as failed_count,
      case when count(amount) filter(where status_group='failed')=count(*) filter(where status_group='failed') then coalesce(sum(amount) filter(where status_group='failed'),0) end as failed_amount,
      count(*) filter(where status_group='rejected') as rejected_count,
      case when count(amount) filter(where status_group='rejected')=count(*) filter(where status_group='rejected') then coalesce(sum(amount) filter(where status_group='rejected'),0) end as rejected_amount,
      count(*) filter(where status_group='unknown') as unknown_count,
      case when count(amount) filter(where status_group='unknown')=count(*) filter(where status_group='unknown') then coalesce(sum(amount) filter(where status_group='unknown'),0) end as unknown_amount,
      max(synced_at) as latest_synced_at
    from filtered where $19<>'details' and created_in_range and $8<>'success'
    group by grouping sets ((direction,currency),(direction,currency,provider),
      (direction,currency,provider,local_date),(direction,currency,local_hour),
      (direction,currency,amount_bucket),(direction,currency,local_hour,amount_bucket),
      (direction,currency,amount_range_bucket),(direction,currency,local_hour,amount_range_bucket))
  ), success_metrics as (
    select direction,currency,provider,success_local_date as local_date,success_local_hour as local_hour,amount_bucket,amount_range_bucket,
      case when grouping(success_local_date)=0 then 'daily' when grouping(success_local_hour,amount_bucket)=0 then 'matrix'
        when grouping(success_local_hour,amount_range_bucket)=0 then 'matrix_range'
        when grouping(success_local_hour)=0 then 'hourly' when grouping(amount_bucket)=0 then 'amount'
        when grouping(amount_range_bucket)=0 then 'amount_range'
        when grouping(provider)=0 then 'provider' else 'summary' end as kind,
      case when $8='success' then count(*) else 0 end as all_count,
      case when $8='success' then case when count(amount)=count(*) then sum(amount) end else 0 end as all_amount,
      case when $8='success' then count(*) filter(where amount is null) else 0 end as missing_amount_count,
      case when $8='success' then count(*) filter(where amount<0) else 0 end as negative_amount_count,
      0::bigint as created_success_count,
      count(*) as success_count,
      case when count(amount)=count(*) then coalesce(sum(amount),0) end as success_amount,
      0::bigint as pending_count,0::numeric as pending_amount,
      0::bigint as failed_count,0::numeric as failed_amount,
      0::bigint as rejected_count,0::numeric as rejected_amount,
      0::bigint as unknown_count,0::numeric as unknown_amount,
      max(synced_at) as latest_synced_at
    from filtered where $19<>'details' and status_group='success' and success_in_range and $8 in ('all','success')
    group by grouping sets ((direction,currency),(direction,currency,provider),
      (direction,currency,provider,success_local_date),(direction,currency,success_local_hour),
      (direction,currency,amount_bucket),(direction,currency,success_local_hour,amount_bucket),
      (direction,currency,amount_range_bucket),(direction,currency,success_local_hour,amount_range_bucket))
  ), metrics_raw as (
    select * from created_metrics union all select * from success_metrics
  ), metrics as (
    select direction,currency,provider,local_date,local_hour,amount_bucket,amount_range_bucket,kind,
      sum(all_count)::bigint as all_count,
      case when bool_or(all_count>0 and all_amount is null) then null::numeric else coalesce(sum(all_amount),0) end as all_amount,
      sum(missing_amount_count)::bigint as missing_amount_count,
      sum(negative_amount_count)::bigint as negative_amount_count,
      sum(created_success_count)::bigint as created_success_count,
      sum(success_count)::bigint as success_count,
      case when bool_or(success_count>0 and success_amount is null) then null::numeric else coalesce(sum(success_amount),0) end as success_amount,
      sum(pending_count)::bigint as pending_count,
      case when bool_or(pending_count>0 and pending_amount is null) then null::numeric else coalesce(sum(pending_amount),0) end as pending_amount,
      sum(failed_count)::bigint as failed_count,
      case when bool_or(failed_count>0 and failed_amount is null) then null::numeric else coalesce(sum(failed_amount),0) end as failed_amount,
      sum(rejected_count)::bigint as rejected_count,
      case when bool_or(rejected_count>0 and rejected_amount is null) then null::numeric else coalesce(sum(rejected_amount),0) end as rejected_amount,
      sum(unknown_count)::bigint as unknown_count,
      case when bool_or(unknown_count>0 and unknown_amount is null) then null::numeric else coalesce(sum(unknown_amount),0) end as unknown_amount,
      max(latest_synced_at) as latest_synced_at
    from metrics_raw
    group by direction,currency,provider,local_date,local_hour,amount_bucket,amount_range_bucket,kind
  ), metric_json as (
    select kind,(to_jsonb(m)-array['kind','local_date','local_hour','amount_bucket','amount_range_bucket','all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount'])
      || jsonb_build_object('date',local_date,'hour',local_hour,'bucket',coalesce(amount_range_bucket,amount_bucket),'all_amount',all_amount::text,
        'success_amount',success_amount::text,'pending_amount',pending_amount::text,'failed_amount',failed_amount::text,
        'rejected_amount',rejected_amount::text,'unknown_amount',unknown_amount::text) || coalesce(f.fee_facts,'{}'::jsonb) || case when m.kind='provider' then coalesce(fv.value,jsonb_build_object('fee_version_matched_count',0,'fee_version_unmatched_count',m.success_count,'fee_version_estimated_amount',case when m.success_count=0 then '0' end,'fee_version_state',case when m.success_count=0 then 'complete' else 'unknown' end)) else '{}'::jsonb end as value
    from metrics m left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider
      left join fee_version_facts fv on m.kind='provider' and fv.direction=m.direction and fv.currency is not distinct from m.currency and fv.provider is not distinct from m.provider
  ), time_bounds(kind,bucket,min_ms,max_ms) as (
    select k.kind,b.* from (values('pending_age'::text),('latency'::text))k(kind)
    cross join (values
      (0,null::numeric,300000::numeric),(1,300000,1800000),(2,1800000,3600000),(3,3600000,10800000),
      (4,10800000,21600000),(5,21600000,43200000),(6,43200000,86400000),
      (7,86400000,172800000),(8,172800000,259200000),(9,259200000,null))b(bucket,min_ms,max_ms)
    where k.kind='pending_age' or $27<>2
    union all select 'latency',b.* from (values
      (0,null::numeric,60000::numeric),(1,60000,180000),(2,180000,300000),
      (3,300000,1800000),(4,1800000,3600000),(5,3600000,10800000),
      (6,10800000,21600000),(7,21600000,43200000),(8,43200000,86400000),
      (9,86400000,172800000),(10,172800000,259200000),(11,259200000,null))b(bucket,min_ms,max_ms)
    where $27=2),
  duration_rows as materialized (
    select direction,currency,amount,
      case when status_group='success' then 'latency'::text else 'pending_age'::text end as kind,
      case when status_group='success' then latency_ms else pending_wait_ms end as duration_ms,
      case when status_group='success' then
        case when success_at is null then 'missing_success_at' when not isfinite(success_at) then 'invalid_success_at'
          when success_at<created_at then 'reversed_time' when success_at>$20 then 'future_success_at' end
        else case when created_at>$20 then 'future_created_at' end end as excluded_reason
    from filtered where $19<>'details' and ((status_group='success' and success_in_range)
      or (direction='withdraw' and status_group='pending' and created_in_range))
  ), duration_summary as (
    select kind,direction,currency,count(*) as candidate_count,
      count(duration_ms) as valid_count,count(*) filter(where duration_ms is null) as excluded_count,
      case when count(amount) filter(where duration_ms is not null)=count(duration_ms)
        then coalesce(sum(amount) filter(where duration_ms is not null),0) end as valid_amount,
      count(*) filter(where duration_ms is not null and amount is null) as missing_amount_count,
      jsonb_build_object('missing_success_at',count(*) filter(where excluded_reason='missing_success_at'),
        'invalid_success_at',count(*) filter(where excluded_reason='invalid_success_at'),
        'reversed_time',count(*) filter(where excluded_reason='reversed_time'),
        'future_success_at',count(*) filter(where excluded_reason='future_success_at'),
        'future_created_at',count(*) filter(where excluded_reason='future_created_at')) as excluded_reasons,
      avg(duration_ms) as mean_ms,percentile_cont(0.5) within group(order by duration_ms) as p50_ms,
      percentile_cont(0.95) within group(order by duration_ms) as p95_ms,max(duration_ms) as max_ms
    from duration_rows group by kind,direction,currency
  ), duration_bucket_totals as materialized (
    -- Classify each valid order once. Maxima are inclusive; subsequent bins
    -- have strict lower bounds. No join of every order to every threshold.
    select kind,direction,currency,
      case when kind='latency' and $27=2 then case when duration_ms<=60000 then 0 when duration_ms<=180000 then 1 when duration_ms<=300000 then 2 else (case when duration_ms<=300000 then 0 when duration_ms<=1800000 then 1
        when duration_ms<=3600000 then 2 when duration_ms<=10800000 then 3
        when duration_ms<=21600000 then 4 when duration_ms<=43200000 then 5
        when duration_ms<=86400000 then 6 when duration_ms<=172800000 then 7
        when duration_ms<=259200000 then 8 else 9 end)+2 end else case when duration_ms<=300000 then 0 when duration_ms<=1800000 then 1
        when duration_ms<=3600000 then 2 when duration_ms<=10800000 then 3
        when duration_ms<=21600000 then 4 when duration_ms<=43200000 then 5
        when duration_ms<=86400000 then 6 when duration_ms<=172800000 then 7
        when duration_ms<=259200000 then 8 else 9 end end as bucket,
      count(*) as count,count(*) filter(where amount is null) as missing_amount_count,
      coalesce(sum(amount),0) as known_amount
    from duration_rows where duration_ms is not null group by 1,2,3,4
  ), duration_bins as materialized (
    select s.kind,s.direction,s.currency,b.bucket,b.min_ms,b.max_ms,coalesce(r.count,0) as count,
      case when coalesce(r.missing_amount_count,0)=0 then coalesce(r.known_amount,0) end as amount,
      s.valid_count,s.valid_amount
    from duration_summary s join time_bounds b on b.kind=s.kind left join duration_bucket_totals r
      on r.kind=s.kind and r.direction=s.direction and r.currency is not distinct from s.currency and r.bucket=b.bucket
  ), duration_thresholds as (
    -- Only ten tiny aggregate bins are scanned here. Excluding the current
    -- inclusive bin makes these cumulative values strictly > threshold.
    select kind,direction,currency,bucket,max_ms as threshold_ms,
      coalesce(sum(count) over tail,0) as count,
      case when count(*) filter(where amount is null) over tail=0 then coalesce(sum(amount) over tail,0) end as amount,
      valid_count,valid_amount
    from duration_bins
    window tail as (partition by kind,direction,currency order by bucket rows between 1 following and unbounded following)
  ), duration_json as (
    select kind,false as cumulative,bucket,(to_jsonb(b)-array['kind','amount','valid_amount'])
      ||jsonb_build_object('amount',amount::text,'valid_amount',valid_amount::text,
        'count_share',count::numeric/nullif(valid_count,0),'amount_share',case when valid_amount>0 then amount/valid_amount end) as value
    from duration_bins b
    union all
    select kind,true,bucket,(to_jsonb(t)-array['kind','amount','valid_amount'])
      ||jsonb_build_object('amount',amount::text,'valid_amount',valid_amount::text,
        'count_share',count::numeric/nullif(valid_count,0),'amount_share',case when valid_amount>0 then amount/valid_amount end)
    from duration_thresholds t where threshold_ms is not null
  ), duration_custom as (
    select r.direction,r.currency,$28::numeric as min_ms,$29::numeric as max_ms,
      count(*) filter(where duration_ms is not null and ($28 is null or duration_ms>$28) and ($29 is null or duration_ms<=$29)) as count,
      case when count(*) filter(where duration_ms is not null and ($28 is null or duration_ms>$28) and ($29 is null or duration_ms<=$29) and amount is null)=0
        then coalesce(sum(amount) filter(where duration_ms is not null and ($28 is null or duration_ms>$28) and ($29 is null or duration_ms<=$29)),0) end as amount,
      s.valid_count,s.valid_amount
    from duration_rows r join duration_summary s on s.kind=r.kind and s.direction=r.direction and s.currency is not distinct from r.currency
    where $30 and r.kind='latency' group by r.direction,r.currency,s.valid_count,s.valid_amount
  ), duration_custom_json as (
    select (to_jsonb(c)-array['amount','valid_amount'])||jsonb_build_object('amount',amount::text,'valid_amount',valid_amount::text,
      'count_share',count::numeric/nullif(valid_count,0),'amount_share',case when valid_amount>0 then amount/valid_amount end) as value
    from duration_custom c
  ), page as (
    select id,system_order_id,order_number,third_party_order_number,member_id,provider,raw_provider,channel_type,direction,status,status_group,
      created_at,success_at,amount::text,actual_amount::text,withdraw_fee::text,currency,synced_at,utr,latency_ms,pending_wait_ms
    from filtered where $19<>'aggregate'
      and ($8<>'success' or (status_group='success' and success_in_range))
      order by case when $8='success' then success_at else created_at end desc,direction desc,id desc limit $18 offset $17
  ) select jsonb_build_object('total',(select case when $8='success'
      then count(*) filter(where status_group='success' and success_in_range)
      else count(*) filter(where created_in_range) end from filtered),
    'summary',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency') from metric_json where kind='summary'),'[]'::jsonb),
    'groups',jsonb_build_object(
      'provider',coalesce((select jsonb_agg(value order by value->>'provider',value->>'direction',value->>'currency') from metric_json where kind='provider'),'[]'::jsonb),
      'daily',coalesce((select jsonb_agg(value order by value->>'date',value->>'provider',value->>'direction',value->>'currency') from metric_json where kind='daily'),'[]'::jsonb),
      'hourly',coalesce((select jsonb_agg(value order by (value->>'hour')::integer,value->>'direction',value->>'currency') from metric_json where kind='hourly'),'[]'::jsonb),
      'amount',coalesce((select jsonb_agg(value order by value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='amount'),'[]'::jsonb),
      'matrix',coalesce((select jsonb_agg(value order by (value->>'hour')::integer,value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='matrix'),'[]'::jsonb),
      'amount_range',coalesce((select jsonb_agg(value order by value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='amount_range'),'[]'::jsonb),
      'matrix_range',coalesce((select jsonb_agg(value order by (value->>'hour')::integer,value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='matrix_range'),'[]'::jsonb),
      'latency',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='latency' and not cumulative),'[]'::jsonb),
      'latency_thresholds',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='latency' and cumulative),'[]'::jsonb),
      'pending_age',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='pending_age' and not cumulative),'[]'::jsonb),
      'pending_age_thresholds',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='pending_age' and cumulative),'[]'::jsonb))
      ||case when $30 then jsonb_build_object('latency_custom',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency') from duration_custom_json),'[]'::jsonb)) else '{}'::jsonb end,
    'latencySummary',coalesce((select jsonb_agg((to_jsonb(s)-array['kind','valid_amount'])||jsonb_build_object('valid_amount',valid_amount::text) order by direction,currency) from duration_summary s where kind='latency'),'[]'::jsonb),
    'pendingSummary',coalesce((select jsonb_agg((to_jsonb(s)-array['kind','valid_amount'])||jsonb_build_object('valid_amount',valid_amount::text) order by direction,currency) from duration_summary s where kind='pending_age'),'[]'::jsonb),
    'rows',coalesce((select jsonb_agg(to_jsonb(p) order by case when $8='success' then success_at else created_at end desc,direction desc,id desc) from page p),'[]'::jsonb))
  $q$;

  -- Provider pages do not need the eight chart grouping sets or duration bins.
  -- Reuse exactly the same scoped source and predicates, with two grouping sets.
  if p_request->>'view'='providers' and v_action='aggregate' then
    if v_status<>'all' then raise exception using errcode='22023',message='unsupported_filter';end if;
    v_sql:='with source_orders as ('||v_source||$q$), orders as (select *,case when not $38 then null::timestamptz when $37='source_updated' then source_updated_at else success_at end as secondary_at from source_orders), filtered as materialized (
      select direction,currency,provider,channel_type,status_group,created_at,success_at,
        case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,synced_at,
        (created_at >= $5 and created_at < $6) as created_in_range,
        (secondary_at >= $35 and secondary_at < $36 and status_group='success') as success_in_range
      from orders where ($8='all' or status_group=$8) and ($12 is null or provider=any($12))
        and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
        and ($15 is null or amount>=$15) and ($16 is null or case when $31 then amount<$16 else amount<=$16 end)
    ), fee_subjects as materialized (
    select distinct direction,currency,provider,channel_type from filtered where $19<>'details' and status_group='success' and success_in_range
      and ($34 and direction='charge' and channel_type='提现转充值') is not true
      and $33 and exists(select 1 from private.fee_rate_versions where country=$32)
  ), fee_intervals as materialized (
    select s.direction,s.currency,s.provider,s.channel_type,v.* from fee_subjects s
    cross join lateral private.dashboard_admin_fee_intervals($32,$2,s.provider,s.direction,s.currency,private.dashboard_admin_fee_category($32,s.channel_type)) v
  ), fee_version_facts as (
    select f.direction,f.currency,f.provider,jsonb_build_object(
      'fee_version_matched_count',(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_version_unmatched_count',count(*)-(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_exempt_count',count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')),
      'fee_version_estimated_amount',case when count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))>0 then coalesce((sum(f.amount*v.percent_rate+v.fixed_fee) filter(where f.amount>=0)),0)::text end,
      'fee_version_state',case when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))=count(*) then 'complete'
        when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))>0 then 'partial' else 'unknown' end
    ) value from filtered f left join fee_intervals v on v.direction=f.direction and v.currency=f.currency and v.provider=f.provider
      and v.channel_type is not distinct from f.channel_type
      and f.amount>=0 and f.amount::text not in ('NaN','Infinity','-Infinity')
      and isfinite(f.created_at) and f.created_at>=v.effective_from and (v.effective_until is null or f.created_at<v.effective_until)
    where $19<>'details' and f.status_group='success' and f.success_in_range
      and (($33 and exists(select 1 from private.fee_rate_versions where country=$32)) or $34)
    group by f.direction,f.currency,f.provider
  ), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    ), metric as (
      select direction,currency,provider,case when grouping(provider)=0 then 'provider' else 'summary' end as kind,
        count(*) filter(where created_in_range) as all_count,
        case when count(*) filter(where created_in_range and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range),0) end as all_amount,
        count(*) filter(where created_in_range and amount is null) as missing_amount_count,
        count(*) filter(where created_in_range and amount<0) as negative_amount_count,
        count(*) filter(where created_in_range and status_group='success') as created_success_count,
        count(*) filter(where success_in_range) as success_count,
        case when count(*) filter(where success_in_range and amount is null)=0
          then coalesce(sum(amount) filter(where success_in_range),0) end as success_amount,
        count(*) filter(where created_in_range and status_group='pending') as pending_count,
        case when count(*) filter(where created_in_range and status_group='pending' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='pending'),0) end as pending_amount,
        count(*) filter(where created_in_range and status_group='failed') as failed_count,
        case when count(*) filter(where created_in_range and status_group='failed' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='failed'),0) end as failed_amount,
        count(*) filter(where created_in_range and status_group='rejected') as rejected_count,
        case when count(*) filter(where created_in_range and status_group='rejected' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='rejected'),0) end as rejected_amount,
        count(*) filter(where created_in_range and status_group='unknown') as unknown_count,
        case when count(*) filter(where created_in_range and status_group='unknown' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='unknown'),0) end as unknown_amount,
        max(synced_at) as latest_synced_at
      from filtered group by grouping sets ((direction,currency),(direction,currency,provider))
    ), output as (
      select kind,(to_jsonb(m)-'kind')||jsonb_build_object('all_amount',all_amount::text,
        'success_amount',success_amount::text,'pending_amount',pending_amount::text,
        'failed_amount',failed_amount::text,'rejected_amount',rejected_amount::text,
        'unknown_amount',unknown_amount::text) || coalesce(f.fee_facts,'{}'::jsonb) || case when m.kind='provider' then coalesce(fv.value,jsonb_build_object('fee_version_matched_count',0,'fee_version_unmatched_count',m.success_count,'fee_version_estimated_amount',case when m.success_count=0 then '0' end,'fee_version_state',case when m.success_count=0 then 'complete' else 'unknown' end)) else '{}'::jsonb end as value from metric m
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider
      left join fee_version_facts fv on m.kind='provider' and fv.direction=m.direction and fv.currency is not distinct from m.currency and fv.provider is not distinct from m.provider
    ) select jsonb_build_object('total',(select count(*) from filtered where created_in_range),
      'summary',coalesce((select jsonb_agg(value) from output where kind='summary'),'[]'::jsonb),
      'groups',jsonb_build_object('provider',coalesce((select jsonb_agg(value order by value->>'provider')
        from output where kind='provider'),'[]'::jsonb)),'rows','[]'::jsonb)
    $q$;
    -- ar_provider_fee_fold_v1: unchanged facts, one fewer filtered scan.
    if v_platform.source='ar' then
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_0$), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    $ar_fee_fold_0$,'')))/length($ar_fee_fold_0$), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    $ar_fee_fold_0$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_0$), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    $ar_fee_fold_0$,$ar_fee_fold_0$$ar_fee_fold_0$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_1$max(synced_at) as latest_synced_at$ar_fee_fold_1$,'')))/length($ar_fee_fold_1$max(synced_at) as latest_synced_at$ar_fee_fold_1$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_1$max(synced_at) as latest_synced_at$ar_fee_fold_1$,$ar_fee_fold_1$max(synced_at) as latest_synced_at,
        jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts$ar_fee_fold_1$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_2$(to_jsonb(m)-'kind')$ar_fee_fold_2$,'')))/length($ar_fee_fold_2$(to_jsonb(m)-'kind')$ar_fee_fold_2$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_2$(to_jsonb(m)-'kind')$ar_fee_fold_2$,$ar_fee_fold_2$(to_jsonb(m)-array['kind','fee_facts'])$ar_fee_fold_2$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_3$coalesce(f.fee_facts,'{}'::jsonb)$ar_fee_fold_3$,'')))/length($ar_fee_fold_3$coalesce(f.fee_facts,'{}'::jsonb)$ar_fee_fold_3$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_3$coalesce(f.fee_facts,'{}'::jsonb)$ar_fee_fold_3$,$ar_fee_fold_3$case when m.kind='provider' then m.fee_facts else '{}'::jsonb end$ar_fee_fold_3$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_4$
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider$ar_fee_fold_4$,'')))/length($ar_fee_fold_4$
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider$ar_fee_fold_4$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_4$
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider$ar_fee_fold_4$,$ar_fee_fold_4$$ar_fee_fold_4$);
    end if;
  end if;

  if v_platform.source='duoli' and coalesce(p_request->>'view','full')<>'providers' then
    if (length(v_sql)-length(replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'')))/length($duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$)<>1 then
      raise exception 'duoli_payment_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'null::numeric as latency_ms');
  end if;
  if v_platform.source='panda' and coalesce(p_request->>'view','full')<>'providers' then
    if (length(v_sql)-length(replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'')))/length($panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$)<>1 then raise exception 'panda_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'null::numeric as latency_ms');
  end if;
  execute v_sql into v_result using v_id,v_platform.name,v_platform.scope_group,v_platform.timezone,v_start,v_end,
    v_direction,v_status,v_member,v_order,v_system,v_providers,v_types,v_currency,v_min,v_max,v_offset,v_limit,v_action,v_asof,v_platform.currency,v_platform.source_name,v_third,v_confirmations,v_charge_edges,v_withdraw_edges,v_duration_version,v_duration_min,v_duration_max,v_duration_custom,v_max_exclusive,v_fee_country,v_fee_currency_proven,(v_platform.source='wg'),case when v_secondary_available then v_secondary_start else v_start end,case when v_secondary_available then v_secondary_end else v_start end,v_basis,v_secondary_available;
  if v_action='details' then
    v_result:=jsonb_set(v_result,'{rows}',coalesce((select jsonb_agg(x||case when v_platform.source='wg' and x->>'direction'='charge' and x->>'channel_type'='提现转充值' then
      jsonb_build_object('fee_exempt',true,'fee_exempt_reason','wg_withdraw_to_charge','fee_version_state','complete',
        'fee_version_ids','[]'::jsonb,'fee_version_percent_rate','0','fee_version_fixed_fee','0',
        'fee_version_estimated_amount','0','fee_version_basis','native_business_rule')
      else private.dashboard_admin_fee_quote(v_fee_country,v_platform.name,
      x->>'provider',x->>'direction',case when v_fee_currency_proven then x->>'currency' end,(x->>'created_at')::timestamptz,(x->>'amount')::numeric,private.dashboard_admin_fee_category(v_fee_country,x->>'channel_type')) end order by n)
      from jsonb_array_elements(v_result->'rows') with ordinality t(x,n)),'[]'::jsonb));
  end if;
  if v_action='details' and v_platform.source='ar' then v_result:=private.dashboard_admin_ar_order_money(v_result,v_platform.scope_group,v_platform.source_name);end if;
  if v_platform.source='wg' then v_result:=private.dashboard_admin_wg_order_result(v_result,v_platform.scope_group,v_platform.source_name);end if;
  if v_platform.source='panda' then
    v_result:=private.dashboard_admin_panda_order_result(v_result)||jsonb_build_object('pandaCoverage',v_panda_coverage);
  end if;
  if v_platform.source='duoli' then v_result:=private.dashboard_admin_duoli_order_result(v_result);end if;
  v_result:=private.dashboard_admin_order_business_result(v_result,v_platform.source,v_platform.scope_group,v_platform.source_name,v_platform.id);
  return v_result||case when v_duration_version=2 then jsonb_build_object('durationVersion',2)
      ||case when v_duration_custom then jsonb_build_object('durationRange',v_duration->'range') else '{}'::jsonb end else '{}'::jsonb end
    ||case when v_amount_bands is null then '{}'::jsonb else jsonb_build_object('amountBands',v_amount_bands,'amountBandsVersion',1) end
    ||jsonb_build_object('version',1,'platform',v_meta,'basis','mixed_created_success','startAt',v_start,'endAt',v_end,
    'successStartAt',v_secondary_start,'successEndAt',v_secondary_end,'successBasis',case when v_basis='legacy' and v_platform.source='duoli' then 'source_updated' when v_basis='legacy' then 'success' else v_basis end,
    'asOf',v_asof,'offset',v_offset,'limit',v_limit,'hasMore',(v_result->>'total')::bigint>v_offset::bigint+v_limit,
    'capabilities',v_capabilities);
end;
$function$;
CREATE OR REPLACE FUNCTION private.prepared_aggregate_prewarm(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare state private.prepared_aggregate_schedule%rowtype;native jsonb;t jsonb;d date;offset_day integer;q jsonb;baseq jsonb;k jsonb;dep text;n integer:=0;jobs integer:=0;last_id uuid;
 commons jsonb:='{}';scope text;common text;job private.prepared_aggregate_jobs%rowtype;head private.prepared_aggregate_artifacts%rowtype;due timestamptz;admitted uuid;refreshed integer:=0;unsupported integer:=0;budget interval:=current_setting('statement_timeout')::interval;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='prepared_worker_denied';end if;
 if p_now is null or not isfinite(p_now)then raise exception using errcode='22023',message='invalid_schedule_time';end if;
 if budget<=interval'0'or budget>interval'3seconds'then raise exception using errcode='22023',message='prepared_schedule_deadline_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('prepared_aggregate_dispatch_v1',0))then return jsonb_build_object('status','busy');end if;
 select *into state from private.prepared_aggregate_schedule where singleton for update;
 if not state.enabled then return jsonb_build_object('status','disabled');end if;
 if jsonb_array_length(state.approved_targets)=0 then return jsonb_build_object('status','no_approved_targets');end if;
 select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb)into native from private.prepared_aggregate_native_catalog()p;
 if exists(select 1 from jsonb_array_elements(state.approved_targets)x where not exists(select 1 from jsonb_array_elements(native)y where x=y))
 or(select count(distinct x->>'id')from jsonb_array_elements(state.approved_targets)x)<>jsonb_array_length(state.approved_targets)
 then raise exception using errcode='55000',message='prepared_approved_manifest_drift';end if;
 -- Bound each tick to six reviewed targets. UUID order and persisted cursor
 -- rotate across all countries, without an automatic whole-directory expansion.
 for t in select x from jsonb_array_elements(state.approved_targets)x where state.cursor_id is null or(x->>'id')::uuid>state.cursor_id order by(x->>'id')::uuid limit 6 loop
  d:=(p_now at time zone(t->>'timezone'))::date;scope:=case when t->>'source'='game66'then'IN'else t->>'scope_group'end;common:=commons->>scope;if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;dep:=private.prepared_aggregate_dependency(t,common);
  for offset_day in 0..2 loop
   q:=jsonb_build_object('action','aggregate','view','providers','platformId',t->>'id','startAt',private.provider_snapshot_iso((d-offset_day)::timestamp at time zone(t->>'timezone')),'endAt',private.provider_snapshot_iso((d-offset_day+1)::timestamp at time zone(t->>'timezone')),'successStartAt',private.provider_snapshot_iso((d-offset_day)::timestamp at time zone(t->>'timezone')),'successEndAt',private.provider_snapshot_iso((d-offset_day+1)::timestamp at time zone(t->>'timezone')),'successBasis',case when t->>'source'='duoli'then'source_updated'else'success'end,'direction','all','status','all','currency',t->>'currency','offset',0,'limit',20);
   if private.prepared_aggregate_request_reason(q,t)is not null then unsupported:=unsupported+1;continue;end if;
   baseq:=private.prepared_aggregate_base_request(q,t,p_now);k:=private.prepared_aggregate_key(baseq,t);
   select *into job from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k;
   -- Do not change an already claimed job, even if a rollout changes dependency.
   if job.status='running'and job.lease_until>clock_timestamp()then continue;end if;
   admitted:=private.prepared_aggregate_enqueue(baseq,t,dep,(10-offset_day)::smallint);
   if admitted is not null then jobs:=jobs+1;end if;
   perform private.prepared_aggregate_retire_replaced(q,t,baseq,dep);n:=n+1;
  end loop;last_id:=(t->>'id')::uuid;
 end loop;
 -- Recently used exact/custom windows retain their own keys and do not borrow a
 -- default day. Refresh only approved native identities; running/failed states
 -- are never reset here. Stable computedAt determines the next planned slot.
 for job in select j.*from private.prepared_aggregate_jobs j where j.status='ready'and j.last_requested_at>p_now-interval'24hours'
  and exists(select 1 from jsonb_array_elements(state.approved_targets)x where x=j.target)
  order by j.next_due_at nulls first,j.id limit 50 for update skip locked loop
  t:=job.target;scope:=case when t->>'source'='game66'then'IN'else t->>'scope_group'end;common:=commons->>scope;if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;dep:=private.prepared_aggregate_dependency(t,common);
  if job.dependency<>dep then perform private.prepared_aggregate_enqueue(job.request,t,dep,job.priority);continue;end if;
  select a.*into head from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a on a.id=h.artifact_id where h.job_id=job.id;
  if head.id is null or head.revision<>job.revision or head.dependency<>dep then
   update private.prepared_aggregate_jobs set status='queued',not_before=clock_timestamp()where id=job.id and status='ready';continue;
  end if;
  due:=private.prepared_aggregate_scheduled_due(job.request,t,head.computed_at,p_now);
  update private.prepared_aggregate_jobs set next_due_at=due where id=job.id and status='ready'and next_due_at is distinct from due;
  if due<=p_now then update private.prepared_aggregate_jobs set status='queued',not_before=clock_timestamp(),attempts=0 where id=job.id and status='ready';refreshed:=refreshed+1;end if;
 end loop;
 update private.prepared_aggregate_schedule set cursor_id=last_id,cursor_tier=0 where singleton;
 return jsonb_build_object('status','queued','requests',n,'backgroundJobs',jobs,'refreshed',refreshed,'unsupported',unsupported,'approvedTargets',jsonb_array_length(state.approved_targets),'currentIntervalSeconds',state.current_interval_seconds,'historicalLocalTimes',jsonb_build_array('08:00','20:00'));
end;$function$;
CREATE OR REPLACE FUNCTION private.prepared_aggregate_newar_withdraw_clock_guard(p_result jsonb, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
 r jsonb:=p_result; q jsonb:=coalesce(p_request,'{}'::jsonb); item jsonb; items jsonb:='[]';
 caps jsonb; pcaps jsonb; dcaps jsonb; c jsonb; groups jsonb; rows jsonb; k text; d text;
 platform_name text; direction text; basis text; end_at timestamptz;
 missing_clock boolean; known_clock boolean; evidence jsonb; reason text:='payment_success_time_missing';
BEGIN
 IF jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN r; END IF;
 -- A ready/last-complete publication is guarded after all native projections
 -- and daily-provider folds. Non-ready publications retain the original DTO.
 IF jsonb_typeof(r->'items')='array' AND r->>'version'='2' THEN
  FOR item IN SELECT value FROM jsonb_array_elements(r->'items') LOOP
   IF item->>'status'='ready' AND jsonb_typeof(item->'result')='object' THEN
    item:=jsonb_set(item,'{result}',private.prepared_aggregate_newar_withdraw_clock_guard(item->'result',item->'request'));
   END IF;
   items:=items||jsonb_build_array(item);
  END LOOP;
  RETURN jsonb_set(r,'{items}',items);
 END IF;
 direction:=coalesce(q->>'direction','all');
 IF r#>>'{platform,source}' IS DISTINCT FROM 'newar' OR direction='charge'
  OR direction NOT IN ('all','withdraw') THEN RETURN r; END IF;
 -- Only successful-window aggregates are changed. Detail rows retain the
 -- observed successful state and their true nullable success_at value.
 IF jsonb_typeof(r->'summary') IS DISTINCT FROM 'array'
  OR jsonb_typeof(r->'groups') IS DISTINCT FROM 'object' THEN RETURN r; END IF;
 platform_name:=coalesce(r#>>'{platform,sourceName}',r#>>'{platform,source_name}',r#>>'{platform,name}');
 IF platform_name IS NULL OR NOT EXISTS(SELECT 1 FROM public.newar_detail_platforms p WHERE p.platform=platform_name) THEN
  RAISE EXCEPTION USING errcode='55000',message='newar_withdraw_clock_platform_unavailable';
 END IF;
 r:=private.prepared_aggregate_newar_withdraw_created_cohort(r,q);
 basis:=coalesce(r->>'successBasis','success');
 IF basis NOT IN ('success','source_updated') THEN RETURN r; END IF;
 BEGIN
  end_at:=coalesce(nullif(r->>'successEndAt',''),nullif(q->>'successEndAt',''),nullif(r->>'endAt',''),nullif(q->>'endAt',''))::timestamptz;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION USING errcode='22023',message='newar_withdraw_clock_invalid_end';
 END;
 IF end_at IS NULL OR NOT isfinite(end_at) THEN
  RAISE EXCEPTION USING errcode='22023',message='newar_withdraw_clock_invalid_end';
 END IF;
 -- A missing success clock cannot belong to a window before order creation.
 -- No lower date bound is guessed: the schema does not guarantee that a
 -- client capture timestamp is an upper bound on payment success.
 SELECT EXISTS(SELECT 1 FROM public.newar_detail_records n
  WHERE n.platform=platform_name AND n.dataset='withdraw' AND n.status_group='success'
   AND n.success_at IS NULL AND n.created_at<end_at) INTO missing_clock;
 SELECT EXISTS(SELECT 1 FROM public.newar_detail_records n
  WHERE n.platform=platform_name AND n.dataset='withdraw' AND n.status_group='success'
   AND n.success_at IS NOT NULL AND n.created_at<end_at) INTO known_clock;
 evidence:=jsonb_build_object('status',CASE WHEN missing_clock AND known_clock THEN 'partial' WHEN missing_clock THEN 'missing' ELSE 'no_missing_observed' END,
  'scope','stored_successful_withdrawals_created_before_secondary_end',
  'hasMissing',missing_clock,'hasKnown',known_clock,'secondaryEndAt',end_at,
  'lowerBoundApplied',false,'countsAvailable',false,'sourceUpdatedIsPaymentTime',false);
 caps:=coalesce(r->'capabilities','{}'::jsonb)||jsonb_build_object('withdrawSuccessClockCoverage',evidence);
 r:=jsonb_set(r,'{capabilities}',caps);
 IF missing_clock THEN
  IF basis='success' THEN
   r:=private.prepared_aggregate_mask_secondary(r,reason,'withdraw');
   IF direction='withdraw' THEN
    r:=jsonb_set(r,'{capabilities}',(r->'capabilities')||jsonb_build_object(
     'successTimeAvailable',false,'secondaryTimeAvailable',false,'secondaryTimeUnavailableReason',reason,'latencyAvailable',false));
   END IF;
   IF q->>'status'='success' THEN r:=r||jsonb_build_object('total',null,'hasMore',null); END IF;
  ELSE
   -- Source-update cohorts remain valid as update cohorts. Their elapsed time
   -- is not payment latency, so remove only the affected latency rows.
   groups:=r->'groups';
   FOREACH k IN ARRAY ARRAY['latency','latency_thresholds','latency_custom'] LOOP
    IF groups?k THEN
     SELECT coalesce(jsonb_agg(x ORDER BY n),'[]'::jsonb) INTO rows
      FROM jsonb_array_elements(groups->k) WITH ORDINALITY t(x,n) WHERE x->>'direction' IS DISTINCT FROM 'withdraw';
     groups:=jsonb_set(groups,ARRAY[k],rows);
    END IF;
   END LOOP;
   r:=jsonb_set(r,'{groups}',groups);
   IF jsonb_typeof(r->'latencySummary')='array' THEN
    SELECT coalesce(jsonb_agg(x ORDER BY n),'[]'::jsonb) INTO rows
     FROM jsonb_array_elements(r->'latencySummary') WITH ORDINALITY t(x,n) WHERE x->>'direction' IS DISTINCT FROM 'withdraw';
    r:=jsonb_set(r,'{latencySummary}',rows);
   END IF;
   r:=jsonb_set(r,'{capabilities}',(r->'capabilities')||jsonb_build_object(
    'withdrawSuccessTimeAvailable',false,'withdrawLatencyAvailable',false,'withdrawLatencyUnavailableReason',reason));
   IF direction='withdraw' THEN r:=jsonb_set(r,'{capabilities}',(r->'capabilities')||jsonb_build_object('successTimeAvailable',false,'latencyAvailable',false)); END IF;
  END IF;
 END IF;
 -- Keep projected directional capability metadata consistent without ever
 -- copying a withdrawal restriction onto the charge-only projection.
 dcaps:=r->'_preparedDirectionCapabilities';
 IF jsonb_typeof(dcaps)='object' THEN
  FOREACH d IN ARRAY ARRAY['all','withdraw'] LOOP
   IF jsonb_typeof(dcaps->d)='object' THEN
    c:=(dcaps->d)||jsonb_build_object('withdrawSuccessClockCoverage',evidence,
     'withdrawCreatedSuccessAvailable',r#>'{capabilities,withdrawCreatedSuccessAvailable}',
     'withdrawCreatedSuccessCohort',r#>'{capabilities,withdrawCreatedSuccessCohort}');
    IF missing_clock THEN
     c:=c||jsonb_build_object('withdrawSuccessTimeAvailable',false,'withdrawLatencyAvailable',false);
     IF basis='success' THEN c:=c||jsonb_build_object('withdrawSecondaryTimeAvailable',false,'withdrawSecondaryTimeUnavailableReason',reason); END IF;
     IF d='withdraw' THEN
      c:=c||jsonb_build_object('successTimeAvailable',false,'latencyAvailable',false);
      IF basis='success' THEN c:=c||jsonb_build_object('secondaryTimeAvailable',false,'secondaryTimeUnavailableReason',reason); END IF;
     END IF;
    END IF;
    dcaps:=jsonb_set(dcaps,ARRAY[d],c);
   END IF;
  END LOOP;
  r:=jsonb_set(r,'{_preparedDirectionCapabilities}',dcaps);
 END IF;
 pcaps:=coalesce(r#>'{platform,capabilities}','{}'::jsonb)||(r->'capabilities');
 RETURN jsonb_set(r,'{platform,capabilities}',pcaps);
END;
$function$;
CREATE OR REPLACE FUNCTION private.prepared_aggregate_echo(payload jsonb, q jsonb, t jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select (payload-'_preparedDirectionCapabilities')||jsonb_build_object('offset',coalesce((q->>'offset')::integer,0),'limit',coalesce((q->>'limit')::integer,20),
 'hasMore',case when payload->>'total'is null then null else(payload->>'total')::numeric>coalesce((q->>'offset')::integer,0)+coalesce((q->>'limit')::integer,20)end,'startAt',q->>'startAt','endAt',q->>'endAt','successStartAt',coalesce(q->>'successStartAt',q->>'startAt'),
 'successEndAt',coalesce(q->>'successEndAt',q->>'endAt'),'successBasis',coalesce(q->>'successBasis',case when t->>'source'='duoli' then 'source_updated' else 'success' end))
 ||case when q?'amountBands'then jsonb_build_object('amountBands',q->'amountBands','amountBandsVersion',1)else '{}'::jsonb end;
$function$;
CREATE OR REPLACE FUNCTION private.prepared_aggregate_compute(q jsonb, t jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare request jsonb;result jsonb;reason text;secondary text;missing_direction text;direction_caps jsonb:='{}';d text;c jsonb;native_old jsonb;native_new jsonb;k text;panda_window jsonb;
begin
 reason:=private.prepared_aggregate_request_reason(q,t);if reason is not null then raise exception using errcode='22023',message=reason;end if;
 request:=private.prepared_aggregate_expand_provider_filter(q,t);
 if t->>'source'='panda'then
  panda_window:=panda_private.prepared_window(t->>'source_name',coalesce(q->>'direction','all'),(q->>'startAt')::timestamptz,(q->>'endAt')::timestamptz);
  if(panda_window->>'clipped')::boolean then
   request:=request||jsonb_build_object('endAt',panda_window->'effectiveEndAt');
  end if;
 end if;
 result:=private.prepared_aggregate_raw_kernel(request,jsonb_build_array(t));
 result:=private.provider_snapshot_orders_result_kernel(result,request);
 -- Preserve the exact native directional capability contract inside the
 -- immutable master. Readers can then narrow an all-direction population
 -- without consulting source tables or guessing missing-clock metadata.
 if q->>'view'='full'and q->>'durationVersion'='2'then
  foreach d in array array['all','charge','withdraw']loop
   c:=coalesce(result->'capabilities','{}'::jsonb);native_old:='{}';native_new:='{}';
   if t->>'source'='wg'then native_old:=private.dashboard_admin_wg_capabilities(coalesce(q->>'direction','all'));native_new:=private.dashboard_admin_wg_capabilities(d);
   elsif t->>'source'='panda'then native_old:=private.dashboard_admin_panda_capabilities(coalesce(q->>'direction','all'));native_new:=private.dashboard_admin_panda_capabilities(d);end if;
   c:=(c-coalesce((select array_agg(key)from jsonb_object_keys(native_old)key),array[]::text[]))||native_new;
   foreach k in array array['successTimeBasis','successCohort','independentSuccessWindow']loop if result->'capabilities'?k then c:=jsonb_set(c,array[k],result->'capabilities'->k);end if;end loop;
   secondary:=private.prepared_aggregate_secondary_reason(q||jsonb_build_object('direction',d),t);
   if secondary is not null then
    missing_direction:=case when t->>'source'='wg'and d='all'then'withdraw'when t->>'source'='game66'and q->>'successBasis'='source_updated'and d='all'then'charge'else'all'end;
    c:=private.prepared_aggregate_mask_secondary(jsonb_build_object('summary','[]'::jsonb,'groups','{}'::jsonb,'capabilities',c),secondary,missing_direction)->'capabilities';
   end if;
   direction_caps:=direction_caps||jsonb_build_object(d,c);
  end loop;
  result:=result||jsonb_build_object('_preparedDirectionCapabilities',direction_caps);
 end if;
 secondary:=private.prepared_aggregate_secondary_reason(q,t);
 if secondary is not null then
  missing_direction:=case when t->>'source'='wg'and coalesce(q->>'direction','all')='all'then'withdraw'when t->>'source'='game66'and q->>'successBasis'='source_updated'and coalesce(q->>'direction','all')='all'then'charge'else'all'end;
  result:=private.prepared_aggregate_mask_secondary(result,secondary,missing_direction);
  if q->>'status'='success'then result:=result||jsonb_build_object('total',null,'hasMore',null);end if;
 end if;
 if(panda_window->>'clipped')::boolean then
  -- The compute is complete for the verified prefix. The requested source
  -- window remains explicitly incomplete; original filters are never lost.
  result:=result||jsonb_build_object('startAt',q->'startAt','endAt',q->'endAt',
   'pandaCoverage',(panda_window->'effectiveCoverage')||(panda_window-array['clipped','effectiveCoverage'])||jsonb_build_object('complete',false));
 end if;
 return private.prepared_aggregate_newar_withdraw_clock_guard(result,q);
end;$function$;
CREATE OR REPLACE FUNCTION private.prepared_aggregate_complete(p_job uuid, p_run uuid, p_fence bigint, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j private.prepared_aggregate_jobs%rowtype;aid uuid;dep text;computed timestamptz:=clock_timestamp();cutoff timestamptz;expires timestamptz;bytes integer;secondary text;missing_direction text;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='prepared_worker_denied';end if;
 select *into j from private.prepared_aggregate_jobs where id=p_job for update;
 if not found or j.status<>'running'or j.run_id is distinct from p_run or j.fence<>p_fence or j.lease_until<=clock_timestamp()then return jsonb_build_object('published',false,'reason','obsolete_claim');end if;
 dep:=private.prepared_aggregate_dependency(j.target);
 if dep<>j.dependency or not private.prepared_aggregate_target_current(j.target)then
  update private.prepared_aggregate_jobs set status='queued',revision=revision+1,dependency=dep,lease_until=null,not_before=clock_timestamp(),attempts=0 where id=j.id;
  return jsonb_build_object('published',false,'reason','dependency_changed');end if;
 bytes:=octet_length(p_payload::text);
 if p_payload is null or jsonb_typeof(p_payload)<>'object'or bytes>4194304
 or p_payload->>'version'is distinct from '1'or p_payload->'rows'is distinct from '[]'::jsonb
 or jsonb_typeof(p_payload->'summary')is distinct from'array'or jsonb_typeof(p_payload->'groups')is distinct from'object'
 or jsonb_typeof(p_payload#>'{groups,provider}')is distinct from'array'
 or p_payload->'partial'='true'::jsonb or p_payload->'complete'='false'::jsonb or p_payload?'error'
 or exists(select 1 from jsonb_each(p_payload->'groups')x where jsonb_typeof(x.value)<>'array')
 or p_payload->>'successBasis'is distinct from coalesce(j.request->>'successBasis',case when j.target->>'source'='duoli'then'source_updated'else'success'end)
 or(j.request->>'durationVersion'='2'and p_payload->>'durationVersion'is distinct from'2')
 or(j.request?'durationRange'and p_payload->'durationRange'is distinct from j.request->'durationRange')
 or(coalesce(j.request->>'view','full')='full'and not(p_payload->'groups'?&array['provider','hourly','daily','amount','matrix','latency','pending_age']))
 or p_payload#>>'{platform,id}'is distinct from j.target->>'id'
 or p_payload#>>'{platform,source}'is distinct from j.target->>'source'
 or p_payload#>>'{platform,sourceName}'is distinct from j.target->>'source_name'
 or p_payload#>>'{platform,country}'is distinct from j.target->>'country'
 or p_payload#>>'{platform,scopeGroup}'is distinct from j.target->>'scope_group'
 or p_payload#>>'{platform,currency}'is distinct from j.target->>'currency'
 or p_payload#>>'{platform,timezone}'is distinct from j.target->>'timezone'
 or(p_payload->>'startAt')::timestamptz is distinct from(j.request->>'startAt')::timestamptz
 or(p_payload->>'endAt')::timestamptz is distinct from(j.request->>'endAt')::timestamptz
 or(p_payload->>'successStartAt')::timestamptz is distinct from coalesce(j.request->>'successStartAt',j.request->>'startAt')::timestamptz
 or(p_payload->>'successEndAt')::timestamptz is distinct from coalesce(j.request->>'successEndAt',j.request->>'endAt')::timestamptz
 then raise exception using errcode='22023',message='prepared_incomplete_or_scope_mismatch';end if;
 secondary:=private.prepared_aggregate_secondary_reason(j.request,j.target);
 if secondary is not null then
  missing_direction:=case when j.target->>'source'='wg'and coalesce(j.request->>'direction','all')='all'then'withdraw'when j.target->>'source'='game66'and j.request->>'successBasis'='source_updated'and coalesce(j.request->>'direction','all')='all'then'charge'else'all'end;
  if private.prepared_aggregate_mask_secondary(p_payload,secondary,missing_direction)is distinct from p_payload or(j.request->>'status'='success'and(p_payload->'total'is distinct from'null'::jsonb or p_payload->'hasMore'is distinct from'null'::jsonb))then raise exception using errcode='22023',message='prepared_missing_secondary_capability';end if;
 end if;
 cutoff:=(p_payload->>'asOf')::timestamptz;
 if cutoff is null or not isfinite(cutoff)or cutoff>computed or cutoff<computed-interval'2minutes'then raise exception using errcode='22023',message='prepared_invalid_cutoff';end if;
 -- Current/mutable dates get ten-minute freshness; closed requests six hours.
 expires:=computed+case when greatest((j.request->>'endAt')::timestamptz,coalesce(j.request->>'successEndAt',j.request->>'endAt')::timestamptz)>computed-interval'24hours'then interval'10minutes'else interval'6hours'end;
 if(select coalesce(sum(a0.bytes),0)from private.prepared_aggregate_artifacts a0)+bytes>536870912 then raise exception using errcode='54000',message='prepared_storage_budget';end if;
 insert into private.prepared_aggregate_artifacts(job_id,run_id,fence,revision,dependency,payload,computed_at,expires_at,cutoff,source_complete,bytes)
 values(j.id,p_run,p_fence,j.revision,dep,p_payload,computed,expires,cutoff,false,bytes)returning id into aid;
 insert into private.prepared_aggregate_heads(job_id,artifact_id)values(j.id,aid)on conflict(job_id)do update set artifact_id=excluded.artifact_id;
 update private.prepared_aggregate_jobs set status='ready',lease_until=null,next_due_at=coalesce(private.prepared_aggregate_scheduled_due(j.request,j.target,computed,computed),expires-interval'2minutes'),attempts=0,last_error=null where id=j.id;
 return jsonb_build_object('published',true,'id',aid,'generation',j.revision::text||':'||j.fence::text);
end;$function$;
CREATE OR REPLACE FUNCTION private.prepared_aggregate_canonical_request(q jsonb, t jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare c jsonb:=q-array['offset','limit'];k text;v text;
begin
 c:=c||jsonb_build_object('view',coalesce(q->>'view','full'),'direction',coalesce(q->>'direction','all'),'status',coalesce(q->>'status','all'),
 'successStartAt',coalesce(q->>'successStartAt',q->>'startAt'),'successEndAt',coalesce(q->>'successEndAt',q->>'endAt'),
 'successBasis',coalesce(q->>'successBasis',case when t->>'source'='duoli' then 'source_updated' else 'success' end));
 foreach k in array array['startAt','endAt','successStartAt','successEndAt']loop c:=jsonb_set(c,array[k],to_jsonb(to_char((c->>k)::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));end loop;
 if c->>'view'='providers'then c:=c-'amountBands';end if;
 foreach k in array array['providers','channelTypes']loop
  if c->k='null'::jsonb or c->k='[]'::jsonb then c:=c-k;
  elsif jsonb_typeof(c->k)='array'then c:=jsonb_set(c,array[k],(select jsonb_agg(x order by x)from(select distinct value x from jsonb_array_elements(c->k))a));end if;
 end loop;
 foreach k in array array['currency','amountMin','amountMax','durationRange']loop if c->k='null'::jsonb then c:=c-k;end if;end loop;
 return c;
end;$function$;
CREATE OR REPLACE FUNCTION private.dashboard_serving_master_reuse(p_page text, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare catalog jsonb;targets jsonb:='[]';requests jsonb:='[]';originals jsonb:='[]';
 q jsonb;t jsonb;c jsonb;b jsonb;dep text;common text;scope text;commons jsonb:='{}';
 mapped jsonb:='[]';mixed_miss boolean:=false;mixed_allowed boolean:=true;correct_default_proved boolean:=false;
 master record;response jsonb;item jsonb;result jsonb;direction_caps jsonb;items jsonb:='[]';i integer:=0;different boolean:=false;
begin
 -- The caller has already checked page/session/query grants. Native scope is
 -- checked again here, before touching a head. No external role can call this
 -- helper directly. Unsupported or partially unavailable batches do no work.
 if p_request->'publicationVersion'is distinct from'2'::jsonb
  or jsonb_typeof(p_request->'requests')is distinct from'array'
  or jsonb_array_length(p_request->'requests')not between 1 and 3 then return null;end if;
 select coalesce(jsonb_agg(to_jsonb(p)),'[]')into catalog from private.dashboard_admin_live_platforms()p;
 for q in select value from jsonb_array_elements(p_request->'requests')loop
  select value into t from jsonb_array_elements(catalog)where value->>'id'=q->>'platformId';
  if t is null or private.prepared_aggregate_request_reason(q,t)is not null
   or coalesce(q->>'view','full')not in('full','providers')or q?'durationRange'
   or coalesce(q->>'status','all')<>'all'
  then return null;end if;
  c:=private.prepared_aggregate_canonical_request(q,t);
  -- Mixed remapping is confined to unbanded single ended IDR days. The
  -- existing 2--31 day rollup and explicit custom-band paths stay unchanged.
  mixed_allowed:=mixed_allowed and t->>'currency'='IDR'and not(c?'amountBands')
   and c->>'successBasis'=case when t->>'source'='duoli'then'source_updated'else'success'end
   and(c->>'startAt')::timestamptz=(c->>'successStartAt')::timestamptz
   and(c->>'endAt')::timestamptz=(c->>'successEndAt')::timestamptz
   and(c->>'endAt')::timestamptz<=statement_timestamp()
   and((c->>'startAt')::timestamptz at time zone(t->>'timezone'))=date_trunc('day',(c->>'startAt')::timestamptz at time zone(t->>'timezone'))
   and((c->>'endAt')::timestamptz at time zone(t->>'timezone'))=date_trunc('day',(c->>'endAt')::timestamptz at time zone(t->>'timezone'))
   and((c->>'endAt')::timestamptz at time zone(t->>'timezone'))::date-((c->>'startAt')::timestamptz at time zone(t->>'timezone'))::date=1;
  scope:=case when t->>'source'='game66'then'IN'else t->>'scope_group'end;
  common:=commons->>scope;if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;
  dep:=private.prepared_aggregate_dependency(t,common);
  -- Metadata only until exact target, both clocks, all financial selectors,
  -- current dependency and fenced revision have matched. Amount-band-only
  -- differences are irrelevant to a providers DTO; full custom bands remain
  -- exact. Old and current dates follow the same proof.
  with candidates as materialized(
   select j.*from private.prepared_aggregate_jobs j
   where j.target=t and j.dependency=dep and j.request->>'platformId'=c->>'platformId'
    and (j.request->>'startAt')::timestamptz=(c->>'startAt')::timestamptz
    and (j.request->>'endAt')::timestamptz=(c->>'endAt')::timestamptz
    and coalesce(j.request->>'successStartAt',j.request->>'startAt')::timestamptz=(c->>'successStartAt')::timestamptz
    and coalesce(j.request->>'successEndAt',j.request->>'endAt')::timestamptz=(c->>'successEndAt')::timestamptz
    and j.request->>'view'='full'and j.request->>'durationVersion'='2')
  select j.request,a.id into master
   from candidates j
   join private.prepared_aggregate_heads h on h.job_id=j.id
   join private.prepared_aggregate_artifacts a on a.id=h.artifact_id
   where j.target=t and j.dependency=dep and a.dependency=dep and a.revision=j.revision
    and j.request_key=private.prepared_aggregate_key(j.request,t)
    and j.request_fingerprint=md5(j.request_key::text)
    and j.request->>'view'='full'and j.request->>'durationVersion'='2'
    and j.request->>'direction'='all'and not(j.request?'durationRange')
    and coalesce(j.request->>'status','all')='all'
    and a.computed_at is not null and a.cutoff is not null and isfinite(a.cutoff)
    and a.expires_at>a.computed_at and a.source_complete is not null
    and case when c->>'view'='providers'then
     coalesce(j.request->'providers','[]'::jsonb)='[]'::jsonb
     and(private.prepared_aggregate_canonical_request(j.request,t)-array['view','durationVersion','amountBands','direction','providers'])
       =(c-array['view','durationVersion','amountBands','direction','providers'])
    else
     (private.prepared_aggregate_canonical_request(j.request,t)-array['durationVersion','direction']-case when not(c?'amountBands')then array['amountBands']else array[]::text[]end)
       =(c-array['durationVersion','direction'])
    end
   -- Default consumers prefer the current currency contract over a newer
   -- obsolete-band head. The selected head keeps its actual age and cutoff.
   order by case when t->>'currency'='IDR'and not(c?'amountBands')
    and j.request->'amountBands'=private.dashboard_serving_default_amount_bands('IDR')then 0 else 1 end,
    a.computed_at desc,j.id limit 1;
  if not found then
   mixed_miss:=true;requests:=requests||jsonb_build_array(q);originals:=originals||jsonb_build_array(q);
   targets:=targets||jsonb_build_array(t);mapped:=mapped||'false'::jsonb;continue;
  end if;
  mapped:=mapped||'true'::jsonb;
  correct_default_proved:=correct_default_proved or(t->>'currency'='IDR'and not(c?'amountBands')
   and coalesce(master.request->'amountBands'=private.dashboard_serving_default_amount_bands('IDR'),false));
  different:=different or private.prepared_aggregate_key(private.prepared_aggregate_base_request(q,t),t)
     is distinct from private.prepared_aggregate_key(master.request,t);
  requests:=requests||jsonb_build_array(master.request);originals:=originals||jsonb_build_array(q);targets:=targets||jsonb_build_array(t);
 end loop;
 if not different or mixed_miss and(not mixed_allowed or not correct_default_proved)then return null;end if;
 -- The existing reader remains the only owner of authorization revalidation,
 -- refresh admission, last_requested_at, leases and retry budgets. No second
 -- scheduler and no synchronous source query are introduced.
 response:=private.prepared_aggregate_read(p_page,(p_request-array['requests','providerReuseNames','providerLeafAliases'])||jsonb_build_object('requests',requests));
 if response->>'version'is distinct from'2'or jsonb_typeof(response->'items')is distinct from'array'
  or jsonb_array_length(response->'items')<>jsonb_array_length(requests)then raise exception using errcode='22023',message='dashboard_serving_response_invalid';end if;
 for item in select value from jsonb_array_elements(response->'items')loop
  q:=originals->i;t:=targets->i;b:=private.prepared_aggregate_canonical_request(requests->i,t);c:=private.prepared_aggregate_canonical_request(q,t);
  if item->'request'is distinct from requests->i then raise exception using errcode='22023',message='dashboard_serving_response_scope';end if;
  -- A missing peer is read once under its original DTO; it cannot return a
  -- proven peer to the old default key. No extra read or projection is needed.
  if mapped->i='false'::jsonb then items:=items||jsonb_build_array(item);i:=i+1;continue;end if;
  -- A concurrent semantic/head change keeps the existing reader's admission
  -- result for this master. Never enqueue the alternate key as a second job.
  if item->>'status'is distinct from'ready'then
   items:=items||jsonb_build_array(jsonb_set(item,'{request}',q));i:=i+1;continue;
  end if;
  result:=item->'result';
  -- The original all-direction read strips this internal map after applying
  -- its all-direction capability. Restore only the map from that same immutable
  -- returned artifact so the final projection selects the requested direction.
  select a.payload->'_preparedDirectionCapabilities'into direction_caps
   from private.prepared_aggregate_artifacts a where a.id=(item->'publication'->>'id')::uuid;
  if direction_caps is not null then result:=result||jsonb_build_object('_preparedDirectionCapabilities',direction_caps);end if;
  -- Unrequested range charts are the only removed fields. Exact-amount bins,
  -- totals, source evidence and both metric clocks remain byte-for-byte facts.
  if c->>'view'='full'and not(c?'amountBands')then
   result:=jsonb_set(result-array['amountBands','amountBandsVersion'],'{groups}',(result->'groups')-array['amount_range','matrix_range']);
   b:=b-'amountBands';
  end if;
  result:=private.prepared_aggregate_master_projection(result,b,c);
  items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','ready','publication',item->'publication','result',private.prepared_aggregate_echo(result,q,t)));
  i:=i+1;
 end loop;
 response:=jsonb_build_object('version',2,'items',items);
 if octet_length(response::text)>16*1024*1024 then raise exception using errcode='54000',message='dashboard_serving_response_capacity';end if;
 return response;
end;$function$;
CREATE OR REPLACE FUNCTION private.dashboard_serving_country_prewarm(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare state private.prepared_aggregate_schedule%rowtype;native jsonb;t jsonb;d date;offset_day integer;q jsonb;baseq jsonb;k jsonb;dep text;n integer:=0;jobs integer:=0;last_id uuid;
 commons jsonb:='{}';scope text;common text;job private.prepared_aggregate_jobs%rowtype;head private.prepared_aggregate_artifacts%rowtype;due timestamptz;admitted uuid;refreshed integer:=0;unsupported integer:=0;budget interval:=current_setting('statement_timeout')::interval;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='prepared_worker_denied';end if;
 if p_now is null or not isfinite(p_now)then raise exception using errcode='22023',message='invalid_schedule_time';end if;
 if budget<=interval'0'or budget>interval'3seconds'then raise exception using errcode='22023',message='prepared_schedule_deadline_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('prepared_aggregate_dispatch_v1',0))then return jsonb_build_object('status','busy');end if;
 select *into state from private.prepared_aggregate_schedule where singleton for update;
 if not state.enabled then return jsonb_build_object('status','disabled');end if;
 if jsonb_array_length(state.approved_targets)=0 then return jsonb_build_object('status','no_approved_targets');end if;
 select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb)into native from private.prepared_aggregate_native_catalog()p;
 if exists(select 1 from jsonb_array_elements(state.approved_targets)x where not exists(select 1 from jsonb_array_elements(native)y where x=y))
 or(select count(distinct x->>'id')from jsonb_array_elements(state.approved_targets)x)<>jsonb_array_length(state.approved_targets)
 then raise exception using errcode='55000',message='prepared_approved_manifest_drift';end if;
 -- Bound each tick to six reviewed targets. UUID order and persisted cursor
 -- rotate across all countries, without an automatic whole-directory expansion.
 for t in select x from jsonb_array_elements(state.approved_targets)x where state.cursor_id is null or(x->>'id')::uuid>state.cursor_id order by(x->>'id')::uuid limit 6 loop
  d:=(p_now at time zone(t->>'timezone'))::date;scope:=case when t->>'source'='game66'then'IN'else t->>'scope_group'end;common:=commons->>scope;if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;dep:=private.prepared_aggregate_dependency(t,common);
  for offset_day in 0..2 loop
   q:=jsonb_build_object('action','aggregate','view','providers','platformId',t->>'id','startAt',private.provider_snapshot_iso((d-offset_day)::timestamp at time zone(t->>'timezone')),'endAt',private.provider_snapshot_iso((d-offset_day+1)::timestamp at time zone(t->>'timezone')),'successStartAt',private.provider_snapshot_iso((d-offset_day)::timestamp at time zone(t->>'timezone')),'successEndAt',private.provider_snapshot_iso((d-offset_day+1)::timestamp at time zone(t->>'timezone')),'successBasis',case when t->>'source'='duoli'then'source_updated'else'success'end,'direction','all','status','all','currency',t->>'currency','offset',0,'limit',20);
   if private.prepared_aggregate_request_reason(q,t)is not null then unsupported:=unsupported+1;continue;end if;
   baseq:=private.prepared_aggregate_base_request(q,t,p_now);
   -- Roll out only the verified IDR mismatch (14 keys); other currencies keep
   -- their exact old requests. Explicit/custom jobs are unchanged.
   if t->>'currency'='IDR'and baseq->>'view'='full'and baseq->>'durationVersion'='2'then
    baseq:=baseq||jsonb_build_object('amountBands',private.dashboard_serving_default_amount_bands(t->>'currency'));
   end if;
   k:=private.prepared_aggregate_key(baseq,t);
   select *into job from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k;
   -- Do not change an already claimed job, even if a rollout changes dependency.
   if job.status='running'and job.lease_until>clock_timestamp()then continue;end if;
   admitted:=private.prepared_aggregate_enqueue(baseq,t,dep,(10-offset_day)::smallint);
   if admitted is not null then jobs:=jobs+1;end if;
   perform private.prepared_aggregate_retire_replaced(q,t,baseq,dep);n:=n+1;
  end loop;last_id:=(t->>'id')::uuid;
 end loop;
 -- Recently used exact/custom windows retain their own keys and do not borrow a
 -- default day. Refresh only approved native identities; running/failed states
 -- are never reset here. Stable computedAt determines the next planned slot.
 for job in select j.*from private.prepared_aggregate_jobs j where j.status='ready'and j.last_requested_at>p_now-interval'24hours'
  and exists(select 1 from jsonb_array_elements(state.approved_targets)x where x=j.target)
  order by j.next_due_at nulls first,j.id limit 50 for update skip locked loop
  t:=job.target;scope:=case when t->>'source'='game66'then'IN'else t->>'scope_group'end;common:=commons->>scope;if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;dep:=private.prepared_aggregate_dependency(t,common);
  if job.dependency<>dep then perform private.prepared_aggregate_enqueue(job.request,t,dep,job.priority);continue;end if;
  select a.*into head from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a on a.id=h.artifact_id where h.job_id=job.id;
  if head.id is null or head.revision<>job.revision or head.dependency<>dep then
   update private.prepared_aggregate_jobs set status='queued',not_before=clock_timestamp()where id=job.id and status='ready';continue;
  end if;
  due:=private.prepared_aggregate_scheduled_due(job.request,t,head.computed_at,p_now);
  update private.prepared_aggregate_jobs set next_due_at=due where id=job.id and status='ready'and next_due_at is distinct from due;
  if due<=p_now then update private.prepared_aggregate_jobs set status='queued',not_before=clock_timestamp(),attempts=0 where id=job.id and status='ready';refreshed:=refreshed+1;end if;
 end loop;
 update private.prepared_aggregate_schedule set cursor_id=last_id,cursor_tier=0 where singleton;
 return jsonb_build_object('status','queued','requests',n,'backgroundJobs',jobs,'refreshed',refreshed,'unsupported',unsupported,'approvedTargets',jsonb_array_length(state.approved_targets),'currentIntervalSeconds',state.current_interval_seconds,'historicalLocalTimes',jsonb_build_array('08:00','20:00'));
end;$function$;
CREATE OR REPLACE FUNCTION private.dashboard_prepared_provider_projection(p_payload jsonb, p_base_request jsonb, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  selected jsonb; summaries jsonb:='[]'::jsonb; result jsonb; bucket record;
  summary jsonb; key text; value numeric; invalid boolean; total numeric; evidence jsonb;
  providers text[]; country text; platform text; stamp text;
  count_keys constant text[]:=array['all_count','success_count','pending_count','failed_count','rejected_count','unknown_count','missing_amount_count','negative_amount_count','created_success_count','reviewed_pending_count'];
  amount_keys constant text[]:=array['all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount','created_success_amount','reviewed_pending_amount'];
begin
  if jsonb_typeof(p_base_request) is distinct from 'object'
    or jsonb_typeof(p_request) is distinct from 'object'
    or p_base_request->>'action' is distinct from 'aggregate'
    or p_request->>'action' is distinct from 'aggregate'
    or p_base_request->>'view' is distinct from 'providers'
    or p_request->>'view' is distinct from 'providers'
    or p_base_request->>'direction' is distinct from 'all'
    or coalesce(p_base_request->>'status','all')<>'all'
    or coalesce(p_request->>'status','all')<>'all'
    or coalesce(p_request->>'direction','') not in ('all','charge','withdraw')
    or (p_base_request-array['providers','direction']) is distinct from (p_request-array['providers','direction'])
    or coalesce(p_base_request->'providers','[]'::jsonb)<>'[]'::jsonb
    or jsonb_typeof(coalesce(p_request->'providers','[]'::jsonb)) is distinct from 'array'
  then raise exception using errcode='22023',message='prepared_projection_scope_mismatch';end if;
  if jsonb_array_length(coalesce(p_request->'providers','[]'::jsonb))>200 or exists(
    select 1 from jsonb_array_elements(coalesce(p_request->'providers','[]'::jsonb)) n
    where jsonb_typeof(n)<>'string' or length(btrim(n#>>'{}')) not between 1 and 200 or (n#>>'{}')~'[[:cntrl:]]'
  ) then raise exception using errcode='22023',message='prepared_projection_invalid_providers';end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or p_payload->>'version' is distinct from '1'
    or p_payload->'rows' is distinct from '[]'::jsonb
    or jsonb_typeof(p_payload->'summary') is distinct from 'array'
    or jsonb_typeof(p_payload->'groups'->'provider') is distinct from 'array'
    or p_payload ?| array['error','partial','_parts']
    or p_payload->'platform'->>'id' is distinct from p_request->>'platformId'
    or (p_payload->>'startAt')::timestamptz is distinct from (p_request->>'startAt')::timestamptz
    or (p_payload->>'endAt')::timestamptz is distinct from (p_request->>'endAt')::timestamptz
  then raise exception using errcode='22023',message='prepared_projection_invalid_payload';end if;
  -- The publisher/reader validates the full native identity. Require the name
  -- context used by the same existing country/platform alias resolver as live.
  country:=p_payload->'platform'->>'country';platform:=p_payload->'platform'->>'sourceName';
  if nullif(btrim(country),'') is null or nullif(btrim(platform),'') is null then
    raise exception using errcode='22023',message='prepared_projection_invalid_native_identity';end if;
  -- The canonical request carries the effective success clock, including its
  -- native legacy default. Neither clock can be silently exchanged here.
  if p_request ? 'successStartAt' and (
    (p_payload->>'successStartAt')::timestamptz is distinct from (p_request->>'successStartAt')::timestamptz
    or (p_payload->>'successEndAt')::timestamptz is distinct from (p_request->>'successEndAt')::timestamptz
    or p_payload->>'successBasis' is distinct from p_request->>'successBasis'
  ) then raise exception using errcode='22023',message='prepared_projection_success_window_mismatch';end if;
  select array_agg(distinct private.dashboard_admin_live_provider_canonical(country,platform,n)) into providers
    from jsonb_array_elements_text(coalesce(p_request->'providers','[]'::jsonb)) n;
  if exists(select 1 from jsonb_array_elements(p_payload->'groups'->'provider') r
    where jsonb_typeof(r)<>'object' or coalesce(r->>'direction','') not in ('charge','withdraw'))
  then raise exception using errcode='22023',message='prepared_projection_invalid_provider_rows';end if;
  if providers is null and p_request->>'direction'='all' then return p_payload;end if;
  -- Keep the complete original provider row, including fee intervals, evidence,
  -- nulls and monetary precision. Duplicate requested aliases never duplicate it.
  select coalesce(jsonb_agg(r order by n),'[]'::jsonb) into selected
    from jsonb_array_elements(p_payload->'groups'->'provider') with ordinality a(r,n)
    where (p_request->>'direction'='all' or r->>'direction'=p_request->>'direction')
      and (providers is null or private.dashboard_admin_live_provider_canonical(country,platform,r->>'provider')=any(providers));
  for bucket in select r->'direction' direction,r->'currency' currency,jsonb_agg(r) leaves
    from jsonb_array_elements(selected) r group by r->'direction',r->'currency' order by r->'direction',r->'currency'
  loop
    summary:=jsonb_build_object('direction',bucket.direction,'currency',bucket.currency,'provider',null);
    foreach key in array count_keys loop
      if key='reviewed_pending_count'and not exists(select 1 from jsonb_array_elements(bucket.leaves)r where r?key)then continue;end if;
      if exists(select 1 from jsonb_array_elements(bucket.leaves) r where r ? key)
        or exists(select 1 from jsonb_array_elements(p_payload->'summary') r where r ? key) then
        select bool_or(r->>key is null or coalesce(r->>key,'')!~'^[0-9]+$'),
          sum(case when r->>key~'^[0-9]+$' then (r->>key)::numeric end)
          into invalid,value from jsonb_array_elements(bucket.leaves) r;
        summary:=summary||jsonb_build_object(key,case when invalid then null else value end);
      end if;
    end loop;
    foreach key in array amount_keys loop
      if key in('created_success_amount','reviewed_pending_amount')and not exists(select 1 from jsonb_array_elements(bucket.leaves)r where r?key)then continue;end if;
      select bool_or(r->>key is null or coalesce(r->>key,'')!~'^[+-]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$'),
        sum(case when r->>key~'^[+-]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' then (r->>key)::numeric end)
        into invalid,value from jsonb_array_elements(bucket.leaves) r;
      summary:=summary||jsonb_build_object(key,case when invalid then null else value::text end);
    end loop;
    -- Native clock/evidence labels are not numeric metrics. Retain a label only
    -- when every selected provider leaf contains the identical proven value.
    foreach key in array array['success_time_available','success_time_basis','success_available','success_unavailable_reason','fee_available','fee_unavailable_reason','pending_count_available']loop
      select case when count(distinct r->key)=1 and bool_and(r?key)then(jsonb_agg(r->key))->0 end into evidence from jsonb_array_elements(bucket.leaves)r;
      if evidence is not null then summary:=jsonb_set(summary,array[key],evidence);end if;
    end loop;
    select r->>'latest_synced_at' into stamp from jsonb_array_elements(bucket.leaves) r
      where r->>'latest_synced_at' is not null order by (r->>'latest_synced_at')::timestamptz desc limit 1;
    summary:=summary||jsonb_build_object('latest_synced_at',stamp);
    -- Deliberately no fee/distinct-member/rate summation in summary: the kernel
    -- exposes fee facts on provider leaves, and unique people are not additive.
    summaries:=summaries||jsonb_build_array(summary);
  end loop;
  select coalesce(bool_or(r->>'all_count' is null or coalesce(r->>'all_count','')!~'^[0-9]+$'),false),
    coalesce(sum(case when r->>'all_count'~'^[0-9]+$' then (r->>'all_count')::numeric end),0)
    into invalid,total from jsonb_array_elements(selected) r;
  if invalid then total:=null;end if;
  result:=p_payload||jsonb_build_object('summary',summaries,'total',total,'rows','[]'::jsonb,
    'groups',jsonb_build_object('provider',selected));
  -- No whole-platform dimensional data may survive a provider projection.
  if p_payload ? 'latencySummary' then result:=result||jsonb_build_object('latencySummary','[]'::jsonb);end if;
  if p_payload ? 'pendingSummary' then result:=result||jsonb_build_object('pendingSummary','[]'::jsonb);end if;
  if p_payload ? 'hasMore' then result:=result||jsonb_build_object('hasMore',case when total is null then null else total>coalesce((p_payload->>'offset')::bigint,0)+coalesce((p_payload->>'limit')::bigint,20) end);end if;
  return result;
end;
$function$;
CREATE OR REPLACE FUNCTION private.dashboard_prepared_direction_projection(p_payload jsonb, p_base_request jsonb, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare r jsonb:=p_payload; groups jsonb; rows jsonb; summaries jsonb;k text;total numeric;invalid boolean;count_key text;d text:=p_request->>'direction';
begin
 if jsonb_typeof(p_base_request)is distinct from'object'or jsonb_typeof(p_request)is distinct from'object'
 or p_base_request->>'action'is distinct from'aggregate'or p_request->>'action'is distinct from'aggregate'
 or p_base_request->>'view'is distinct from'full'or p_request->>'view'is distinct from'full'
 or p_base_request->>'direction'is distinct from'all'or d is null or d not in('all','charge','withdraw')
 or(p_base_request-'direction')is distinct from(p_request-'direction')
 or jsonb_typeof(r)is distinct from'object'or r->>'version'is distinct from'1'
 or r->'rows'is distinct from'[]'::jsonb or jsonb_typeof(r->'summary')is distinct from'array'
 or jsonb_typeof(r->'groups')is distinct from'object' or r ?| array['error','partial','_parts']
 or r#>>'{platform,id}'is distinct from p_request->>'platformId'
 or(r->>'startAt')::timestamptz is distinct from(p_request->>'startAt')::timestamptz
 or(r->>'endAt')::timestamptz is distinct from(p_request->>'endAt')::timestamptz
 or(r->>'successStartAt')::timestamptz is distinct from(p_request->>'successStartAt')::timestamptz
 or(r->>'successEndAt')::timestamptz is distinct from(p_request->>'successEndAt')::timestamptz
 or r->>'successBasis'is distinct from p_request->>'successBasis'
 then raise exception using errcode='22023',message='prepared_direction_scope_mismatch';end if;
 if d='all'then return r;end if;
 select coalesce(jsonb_agg(x order by n),'[]'::jsonb)into summaries from jsonb_array_elements(r->'summary')with ordinality a(x,n)where x->>'direction'=d;
 groups:=r->'groups';
 for k in select jsonb_object_keys(groups)loop
  if jsonb_typeof(groups->k)is distinct from'array'then raise exception 'prepared_direction_invalid_group';end if;
  if exists(select 1 from jsonb_array_elements(groups->k)x where coalesce(x->>'direction','')not in('charge','withdraw'))then raise exception 'prepared_direction_unscoped_row';end if;
  select coalesce(jsonb_agg(x order by n),'[]'::jsonb)into rows from jsonb_array_elements(groups->k)with ordinality a(x,n)where x->>'direction'=d;
  groups:=jsonb_set(groups,array[k],rows);
 end loop;
 foreach k in array array['latencySummary','pendingSummary']loop
  if r ? k then
   if jsonb_typeof(r->k)is distinct from'array'then raise exception 'prepared_direction_invalid_summary';end if;
   select coalesce(jsonb_agg(x order by n),'[]'::jsonb)into rows from jsonb_array_elements(r->k)with ordinality a(x,n)where x->>'direction'=d;
   r:=jsonb_set(r,array[k],rows);
  end if;
 end loop;
 count_key:=case when p_request->>'status'='success'then'success_count'else'all_count'end;
 select coalesce(bool_or(x->>count_key is null or coalesce(x->>count_key,'')!~'^[0-9]+$'),false),
  coalesce(sum(case when x->>count_key~'^[0-9]+$'then(x->>count_key)::numeric end),0)
  into invalid,total from jsonb_array_elements(summaries)x;
 if invalid or(count_key='success_count'and(r#>>array['capabilities',d||'SuccessTimeAvailable'])='false')then total:=null;end if;
 return r||jsonb_build_object('summary',summaries,'groups',groups,'total',total,
  'hasMore',case when total is null then null else total>coalesce((r->>'offset')::integer,0)+coalesce((r->>'limit')::integer,20)end);
end;
$function$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_wg_order_result(p_result jsonb, p_country text, p_platform text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v_result jsonb:=p_result;v_key text;v_rows jsonb;v_site text;
begin
 select site_code into strict v_site from private.dashboard_admin_wg_sites() where country_code=p_country and platform=p_platform;
 for v_key in select 'summary' union all select key from jsonb_each(coalesce(v_result->'groups','{}')) loop
  select coalesce(jsonb_agg(case when r->>'direction'='withdraw' then
   r || case when r?'success_count' then jsonb_build_object('success_count',null,'success_amount',null,'success_time_available',false) else '{}'::jsonb end
     || case when r?'fee_low_count' then jsonb_build_object('fee_low_count',null,'fee_low_amount',null,'fee_high_count',null,'fee_high_amount',null,'fee_gap_count',null,'fee_gap_amount',null,'fee_unpriced_count',null) else '{}'::jsonb end
   else r end order by n),'[]') into v_rows
  from jsonb_array_elements(case when v_key='summary' then coalesce(v_result->'summary','[]') else coalesce(v_result#>array['groups',v_key],'[]') end) with ordinality x(r,n);
  v_result:=jsonb_set(v_result,case when v_key='summary' then array['summary'] else array['groups',v_key] end,v_rows,true);
 end loop;
 -- Join only the already-authorized, bounded result page by site/order PK.
 select coalesce(jsonb_agg(r||jsonb_build_object(
  'site_code',v_site,'source_status_code',w.status_code,'source_status_group',w.status_group,
  'source_updated_at',w.updated_at,'operated_at',w.operated_at,'completion_at_unverified',w.completion_at_unverified,
  'member_currency',w.member_currency,'member_unit_scale',w.member_unit_scale,'member_amount_units',w.member_amount_units::text,
  'settlement_currency',w.settlement_currency,'settlement_amount',w.settlement_amount::text,
  'settlement_fee',w.settlement_fee::text,'exchange_rate',w.exchange_rate::text,
  'operator_name',w.business_fields->>'operator_name','operator_class',w.business_fields->>'operator_class',
  'remark_sanitized',w.business_fields->>'remark_sanitized','rejection_reason',w.business_fields->>'rejection_reason',
  'interception_reason',w.business_fields->>'interception_reason','interception_codes',w.business_fields->'interception_codes',
  'front_note_sanitized',w.business_fields->>'front_note_sanitized','back_note_sanitized',w.business_fields->>'back_note_sanitized'
 ) order by n),'[]') into v_rows
 from jsonb_array_elements(coalesce(v_result->'rows','[]')) with ordinality x(r,n)
 join lateral (select status_code,status_group,updated_at,operated_at,completion_at_unverified,member_currency,member_unit_scale,member_amount_units,settlement_currency,settlement_amount,settlement_fee,exchange_rate,business_fields
   from public.wg_recharge_details where site_code=v_site and order_number=r->>'order_number' and r->>'direction'='charge'
  union all select status_code,status_group,updated_at,operated_at,completion_at_unverified,member_currency,member_unit_scale,member_amount_units,settlement_currency,settlement_amount,settlement_fee,exchange_rate,business_fields
   from public.wg_withdraw_details where site_code=v_site and order_number=r->>'order_number' and r->>'direction'='withdraw')w on true;
 if v_result?'rows' then v_result:=jsonb_set(v_result,'{rows}',v_rows,true);end if;
 return v_result||jsonb_build_object('nativeSource','WG','sourcePolicy','details_only','withdrawSuccessTimeAvailable',false);
end;
$function$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_wg_member_daily(p_platform jsonb, p_start timestamp with time zone, p_end timestamp with time zone, p_direction text, p_providers text[], p_currency text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s record; answer jsonb;
begin
 select * into s from private.dashboard_admin_wg_sites() t
  where t.country_code=p_platform->>'scope_group' and t.platform=p_platform->>'source_name';
 if not found then raise exception using errcode='22023',message='invalid_wg_scope';end if;
 -- Bounds, direction, provider expansion, and fresh scope have already been
 -- validated by the existing public/private RPC path. This helper is not granted.
 with events as materialized (
  select 'created'::text basis,'charge'::text direction,d.created_at event_at,null::text member_id,
   coalesce(nullif(btrim(d.provider),''),'未识别通道') provider,d.member_currency currency
  from public.wg_recharge_details d where d.site_code=s.site_code and p_direction in('all','charge')
   and d.created_at>=p_start and d.created_at<p_end
  union all
  select 'success','charge',d.success_at,null::text,
   coalesce(nullif(btrim(d.provider),''),'未识别通道'),d.member_currency
  from public.wg_recharge_details d where d.site_code=s.site_code and p_direction in('all','charge')
   and d.status_code=2 and d.success_at>=p_start and d.success_at<p_end
  union all
  select 'created','withdraw',d.created_at,nullif(btrim(d.member_id),''),
   coalesce(nullif(btrim(d.provider),''),'未识别通道'),d.member_currency
  from public.wg_withdraw_details d where d.site_code=s.site_code and p_direction in('all','withdraw')
   and d.created_at>=p_start and d.created_at<p_end
 ), filtered as materialized (
  select basis,direction,(event_at at time zone s.timezone)::date as date,member_id from events
  where (p_providers is null or provider=any(p_providers)) and (p_currency is null or currency=p_currency)
 ), counts as (
  select date,direction,count(distinct member_id) filter(where basis='created') as created_member_count,
   count(*) filter(where basis='created') as created_order_count,count(*) filter(where basis='success') as success_order_count,
   count(*) filter(where basis='created' and member_id is null) as created_missing_member_count,
   count(*) filter(where basis='success' and member_id is null) as success_missing_member_count
  from filtered group by date,direction
 ), member_orders as (
  select date,direction,member_id,count(*) as created_count from filtered where basis='created' and member_id is not null
  group by date,direction,member_id
 ), frequency as (
  select date,direction,count(*) filter(where created_count>=2) as ge2,count(*) filter(where created_count>=3) as ge3,
   count(*) filter(where created_count>=4) as ge4,count(*) filter(where created_count>=5) as ge5
  from member_orders group by date,direction
 ), days as (
  select d::date date from generate_series((p_start at time zone s.timezone)::date::timestamp,
   ((p_end-interval '1 microsecond') at time zone s.timezone)::date::timestamp,interval '1 day') d
 ), rows as (
  select days.date,d.direction,
   case when d.direction='withdraw' then coalesce(c.created_member_count,0) end as created_member_count,
   null::bigint as success_member_count,coalesce(c.created_order_count,0) as created_order_count,
   case when d.direction='charge' then coalesce(c.success_order_count,0) end as success_order_count,
   coalesce(c.created_missing_member_count,0) as created_missing_member_count,
   case when d.direction='charge' then coalesce(c.success_missing_member_count,0) end as success_missing_member_count,
   case when d.direction='withdraw' then coalesce(f.ge2,0) end as created_members_ge2,
   case when d.direction='withdraw' then coalesce(f.ge3,0) end as created_members_ge3,
   case when d.direction='withdraw' then coalesce(f.ge4,0) end as created_members_ge4,
   case when d.direction='withdraw' then coalesce(f.ge5,0) end as created_members_ge5,
   null::bigint as success_members_ge2,null::bigint as success_members_ge3,null::bigint as success_members_ge4,null::bigint as success_members_ge5,
   d.direction='withdraw' as created_available,false as success_available,
   case when d.direction='charge' then 'source_member_id_unavailable'::text end as created_unavailable_reason,
   case when d.direction='charge' then 'source_member_id_unavailable' else 'source_success_time_unavailable' end as success_unavailable_reason
  from days cross join unnest(case p_direction when 'all' then array['charge','withdraw'] else array[p_direction] end) d(direction)
  left join counts c on c.date=days.date and c.direction=d.direction
  left join frequency f on f.date=days.date and f.direction=d.direction
 )
 select jsonb_build_object('version',1,'asOf',statement_timestamp(),'startAt',p_start,'endAt',p_end,
  'platform',jsonb_build_object('id',p_platform->>'id','name',p_platform->>'name','country',p_platform->>'country',
   'team',p_platform->>'team','source','wg','sourceName',s.platform,'scopeGroup',s.country_code,'timezone',s.timezone,'currency',s.currency),
  'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.date,r.direction) from rows r),'[]'::jsonb),
  'capabilities',jsonb_build_object('memberIdentity',false,'memberIdentityByDirection',jsonb_build_object('charge',false,'withdraw',true),
   'createdBasis','created_at','successBasis','success_at','dedupe','platform_local_date_direction_member',
   'sourceCompletenessVerified',false,'periodTotal','sum_daily_unique_member_visits',
   'frequencyBasis','per_platform_local_day_order_count','frequencyThresholds',jsonb_build_array(2,3,4,5),
   'availability',jsonb_build_object('charge',jsonb_build_object('created',false,'success',false),'withdraw',jsonb_build_object('created',true,'success',false)),
   'unavailabilityReasons',jsonb_build_object('charge','source_member_id_unavailable','withdrawSuccess','source_success_time_unavailable')))
 into answer;
 return answer;
end;
$function$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_panda_order_result(p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare v_result jsonb:=p_result;k text;a jsonb;
begin
 for k in select 'summary' union all select key from jsonb_each(coalesce(v_result->'groups','{}')) loop
  select coalesce(jsonb_agg(r||case when r?'created_success_count' then jsonb_build_object(
   'created_success_amount',case when (r->>'created_success_count')::bigint=0 then '0' else
    ((r->>'all_amount')::numeric-coalesce(r->>'reviewed_pending_amount',r->>'pending_amount')::numeric-
    (r->>'failed_amount')::numeric-(r->>'rejected_amount')::numeric-(r->>'unknown_amount')::numeric)::text end) else '{}'::jsonb end
   ||case when r?'success_count' then jsonb_build_object('success_count',null,'success_amount',null,'success_time_available',false) else '{}'::jsonb end
   ||case when r->>'direction'='withdraw' and r?'success_count' then jsonb_build_object(
    'reviewed_pending_count',coalesce(r->'reviewed_pending_count',r->'pending_count'),
    'reviewed_pending_amount',coalesce(r->'reviewed_pending_amount',r->'pending_amount'),
    'pending_count',null,'pending_amount',null,'pending_count_available',false) else '{}'::jsonb end
   ||case when r?'fee_low_count' then jsonb_build_object('fee_low_count',null,'fee_low_amount',null,'fee_high_count',null,'fee_high_amount',null,'fee_gap_count',null,'fee_gap_amount',null,'fee_unpriced_count',null) else '{}'::jsonb end
   ||case when r?'fee_version_state' then jsonb_build_object('fee_version_state','unknown','fee_version_matched_count',null,
    'fee_version_unmatched_count',null,'fee_version_estimated_amount',null) else '{}'::jsonb end order by n),'[]') into a
  from jsonb_array_elements(case when k='summary' then coalesce(v_result->'summary','[]') else coalesce(v_result#>array['groups',k],'[]') end) with ordinality x(r,n);
  if k='summary' and v_result?'summary' or k<>'summary' then
   v_result:=jsonb_set(v_result,case when k='summary' then array['summary'] else array['groups',k] end,a,true);end if;
 end loop;
 -- No complete success-time cohort is certified; no duration bucket is exposed.
 for k in select unnest(array['latency','latency_thresholds','latency_custom','pending_age','pending_age_thresholds','pending_age_custom']) loop
  if v_result->'groups'?k then
   select coalesce(jsonb_agg(r order by n),'[]') into a from jsonb_array_elements(v_result#>array['groups',k]) with ordinality x(r,n) where false;
   v_result:=jsonb_set(v_result,array['groups',k],a);end if;
 end loop;
 if v_result?'latencySummary' then
  select coalesce(jsonb_agg(r order by n),'[]') into a from jsonb_array_elements(v_result->'latencySummary') with ordinality x(r,n) where false;
  v_result:=jsonb_set(v_result,'{latencySummary}',a);end if;
 return v_result||jsonb_build_object('nativeSource','PANDA','sourcePolicy','details_only','sourceNativeDetail',true,
  'reviewedWithdrawalsOnly',true,'successTimeBasis','source_completed_at','paymentSuccessTimeAvailable',false);
end;$function$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_remap_groups(p_rows jsonb, p_country text, p_platform text, p_daily boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r jsonb; old_row jsonb; out_rows jsonb := '{}'::jsonb; key text; canonical text;
  k text; n numeric; fields text[] := array['all_count','missing_amount_count','negative_amount_count',
    'success_count','created_success_count','pending_count','failed_count','rejected_count','unknown_count','fee_low_count','fee_high_count','fee_gap_count','fee_unpriced_count','fee_version_matched_count','fee_version_unmatched_count','fee_exempt_count'];
  amount_fields text[] := array['all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount','fee_low_amount','fee_high_amount','fee_gap_amount','fee_version_estimated_amount'];
begin
  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    canonical:=private.dashboard_admin_live_provider_canonical(p_country,p_platform,r->>'provider');
    key:=coalesce(r->>'direction','')||chr(31)||coalesce(r->>'currency','')||chr(31)||coalesce(canonical,'')||
      case when p_daily then chr(31)||coalesce(r->>'date','') else '' end;
    if not (out_rows ? key) then
      out_rows:=out_rows||jsonb_build_object(key,jsonb_set(r,'{provider}',to_jsonb(canonical),true));
    else
      old_row:=out_rows->key;
      foreach k in array fields loop
        if r->>k is null or old_row->>k is null then
          old_row:=jsonb_set(old_row,array[k],'null'::jsonb,true);
        else
          n:=coalesce((old_row->>k)::numeric,0)+coalesce((r->>k)::numeric,0);
          old_row:=jsonb_set(old_row,array[k],to_jsonb(n),true);
        end if;
      end loop;
      if old_row?'fee_version_state' or r?'fee_version_state' then
        old_row:=jsonb_set(old_row,'{fee_version_state}',to_jsonb(case
          when old_row->>'fee_version_unmatched_count'='0' then 'complete'
          when (old_row->>'fee_version_matched_count')::numeric>0 then 'partial' else 'unknown' end));
      end if;
      foreach k in array amount_fields loop
        if k='fee_version_estimated_amount' and (old_row->>'fee_version_matched_count')::numeric>0 then
          n:=coalesce((old_row->>k)::numeric,0)+coalesce((r->>k)::numeric,0);
          old_row:=jsonb_set(old_row,array[k],to_jsonb(n::text),true);
        elsif r->>k is null or old_row->>k is null then
          old_row:=jsonb_set(old_row,array[k],'null'::jsonb,true);
        else
          n:=coalesce((old_row->>k)::numeric,0)+coalesce((r->>k)::numeric,0);
          old_row:=jsonb_set(old_row,array[k],to_jsonb(trim(to_char(n,'FM999999999999999999999999999999990D99999999'))),true);
        end if;
      end loop;
      if coalesce(r->>'latest_synced_at','')>coalesce(old_row->>'latest_synced_at','') then
        old_row:=jsonb_set(old_row,'{latest_synced_at}',to_jsonb(r->>'latest_synced_at'),true);
      end if;
      out_rows:=jsonb_set(out_rows,array[key],old_row,true);
    end if;
  end loop;
  return coalesce((select jsonb_agg(value order by value->>'provider',value->>'direction',value->>'currency',value->>'date') from jsonb_each(out_rows)),'[]'::jsonb);
end;
$function$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_query_raw(p_request jsonb DEFAULT '{"action": "catalog"}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare
  v_action text; v_options jsonb; v_platform record; v_meta jsonb; v_capabilities jsonb; v_panda_coverage jsonb;
  v_id uuid; v_start timestamptz; v_end timestamptz; v_asof timestamptz := statement_timestamp();
  v_direction text; v_status text; v_order text; v_third text; v_member text; v_system text; v_utr text;
  v_providers text[]; v_types text[]; v_currency text; v_min numeric; v_max numeric;
  v_offset integer; v_limit integer; v_key text; v_source text; v_sql text; v_result jsonb;
  v_confirmations jsonb := '{}'::jsonb;
  v_fee_country text; v_fee_currency_proven boolean := false;
  -- aggregate_exclusive_amount_max_v1: one parsed boolean, never epsilon math.
  v_max_exclusive boolean := false;
  -- duration_precision_ranges_v2: parse once, use bound numeric parameters.
  v_duration jsonb;v_duration_version integer;v_duration_min numeric;v_duration_max numeric;v_duration_custom boolean;
  -- dynamic_amount_bands_v1: validate/parse once, never once per order.
  v_amount_bands jsonb; v_charge_edges numeric[]; v_withdraw_edges numeric[];
begin
 -- duoli_existing_orders_v1
 -- wg_existing_orders_v1
  -- Catalog helper validates Auth, active profile, independent grant and scope
  -- on every call, including queries with no matching orders.
  select coalesce(jsonb_agg(to_jsonb(p) order by p.scope_group,p.name,p.source),'[]'::jsonb)
    into v_options from private.dashboard_admin_live_platforms() p;
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>32768
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'action','platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId',
      'utr','providers','channelTypes','currency','amountMin','amountMax','amountMaxExclusive','amountBands','durationVersion','durationRange','offset','limit','view'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  v_action:=coalesce(p_request->>'action','catalog');
  v_duration:=private.dashboard_admin_validate_duration(p_request);
  v_duration_version:=(v_duration->>'version')::integer;
  v_duration_min:=(v_duration->>'min_ms')::numeric;v_duration_max:=(v_duration->>'max_ms')::numeric;
  v_duration_custom:=coalesce((v_duration->>'custom')::boolean,false);
  v_amount_bands:=private.dashboard_admin_validate_amount_bands(p_request->'amountBands',coalesce(p_request->>'direction','all'));
  select array_agg(value::numeric order by ordinality) into v_charge_edges
    from jsonb_array_elements_text(v_amount_bands->'charge') with ordinality;
  select array_agg(value::numeric order by ordinality) into v_withdraw_edges
    from jsonb_array_elements_text(v_amount_bands->'withdraw') with ordinality;
  if p_request ? 'view' and (jsonb_typeof(p_request->'view')<>'string' or p_request->>'view' not in ('full','providers') or v_action<>'aggregate') then
    raise exception using errcode='22023',message='invalid_view';
  end if;
  if v_action not in ('catalog','query','aggregate','details') then raise exception using errcode='22023',message='invalid_action'; end if;
  if v_action='catalog' then
    if p_request-array['action']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_catalog_request'; end if;
    return jsonb_build_object('version',1,'asOf',v_asof,'platforms',(
      select coalesce(jsonb_agg((p-array['scope_group','source_name'])||jsonb_build_object('scopeGroup',p->'scope_group','sourceName',p->'source_name',
        'capabilities',jsonb_build_object('systemOrderId',p->>'source'='newar','thirdPartyOrderNumber',p->>'source' in ('newar','game66'),'utr',false,
          'historicalFees',true,'actualAmount',p->>'source'<>'ar','recordedFee',p->>'source' in ('newar','game66'),'scopeGroupIsGeographicCountry',p->>'source'<>'game66')||case when p->>'source'='ar' then private.ar_middle_channel_capabilities((p->>'id')::uuid)
      when p->>'source'='panda' then private.dashboard_admin_panda_capabilities()
      when p->>'source'='kb' then private.dashboard_admin_yash_capabilities()
      when p->>'source'='duoli' then private.dashboard_admin_duoli_capabilities()
      when p->>'source'='wg' then private.dashboard_admin_wg_capabilities() else '{}'::jsonb end)),'[]'::jsonb)
      from jsonb_array_elements(v_options) p));
  end if;
  foreach v_key in array array['platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId','utr','currency'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb and
      (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  begin
    v_id:=(p_request->>'platformId')::uuid;
    if coalesce(p_request->>'startAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$'
      or coalesce(p_request->>'endAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      raise exception using errcode='22023',message='invalid_time';
    end if;
    v_start:=(p_request->>'startAt')::timestamptz; v_end:=(p_request->>'endAt')::timestamptz;
    v_offset:=coalesce((p_request->>'offset')::integer,0); v_limit:=coalesce((p_request->>'limit')::integer,20);
    v_min:=nullif(p_request->>'amountMin','')::numeric; v_max:=nullif(p_request->>'amountMax','')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='invalid_filter';
  end;
  if p_request?'amountMaxExclusive' then
    if v_action<>'aggregate' or jsonb_typeof(p_request->'amountMaxExclusive') is distinct from 'boolean'
      or v_max is null then
      raise exception using errcode='22023',message='invalid_amount_max_exclusive';
    end if;
    v_max_exclusive:=(p_request->>'amountMaxExclusive')::boolean;
    if v_max_exclusive and v_min>=v_max then
      raise exception using errcode='22023',message='invalid_range';
    end if;
  end if;
  select * into v_platform from jsonb_to_recordset(v_options)
    as p(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) where p.id=v_id;
  if not found then raise exception using errcode='42501',message='platform_denied'; end if;
  -- Fee evidence is stricter than the legacy display projection. In particular
  -- a country-default AR currency is not source currency proof.
  v_fee_country:=v_platform.scope_group;
  if v_platform.source='ar' then
    v_fee_currency_proven:=exists(select 1 from public.ar_config_targets t
      where t.source_system='AR' and t.country_code=v_platform.scope_group and t.platform=v_platform.source_name
        and nullif(btrim(t.currency),'') is not null and t.currency=v_platform.currency);
  elsif v_platform.source in ('newar','wg') then
    -- These adapters project each order's explicit native currency.
    v_fee_currency_proven:=true;
  elsif v_platform.source='lg' then
    -- Existing confirmed LG adapters have an explicit currency contract; no
    -- generic country fallback or unknown-country adapter may price orders.
    v_fee_currency_proven:=case v_platform.scope_group when 'PH' then v_platform.currency='PHP'
      when 'ID' then v_platform.currency='IDR' when 'PK' then v_platform.currency='PKR' else false end;
  elsif v_platform.source='game66' then
    -- GAME66's source scope identifies the owning team, while its native
    -- monetary unit is explicitly INR. Authorization still uses that scope.
    v_fee_country:='IN';
    v_fee_currency_proven:=v_platform.scope_group in ('HK_TEAM','RED_CRAB') and v_platform.currency='INR';
  end if;
  if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_start>=v_end
    or (v_end at time zone v_platform.timezone)-(v_start at time zone v_platform.timezone)>interval '31 days'
    or v_offset<0 or v_limit not in (20,30,50,100,500)
    or (p_request ? 'offset' and coalesce(p_request->>'offset','0') !~ '^[0-9]+$')
    or (p_request ? 'limit' and coalesce(p_request->>'limit','20') !~ '^[0-9]+$')
    or v_min::text in ('NaN','Infinity','-Infinity') or v_max::text in ('NaN','Infinity','-Infinity')
    or v_min>v_max then raise exception using errcode='22023',message='invalid_range'; end if;
  v_direction:=coalesce(p_request->>'direction','all'); v_status:=coalesce(p_request->>'status','all');
  if v_direction not in ('all','charge','withdraw') or v_status not in ('all','success','pending','failed','rejected','unknown') then
    raise exception using errcode='22023',message='invalid_status_or_direction';
  end if;
  v_order:=nullif(btrim(p_request->>'orderNumber'),''); v_third:=nullif(btrim(p_request->>'thirdPartyOrderNumber'),''); v_member:=nullif(btrim(p_request->>'memberId'),'');
  v_system:=nullif(btrim(p_request->>'systemOrderId'),''); v_utr:=nullif(btrim(p_request->>'utr'),'');
  v_currency:=nullif(btrim(p_request->>'currency'),'');
  if (v_utr is not null and v_platform.source<>'wg') or (v_system is not null and v_platform.source<>'newar') or (v_third is not null and v_platform.source not in ('newar','game66','wg','kb')) then
    raise exception using errcode='22023',message='unsupported_filter';
  end if;
  foreach v_key in array array['providers','channelTypes'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb then
      if jsonb_typeof(p_request->v_key)<>'array' or jsonb_array_length(p_request->v_key)>2000 then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
      if exists(select 1 from jsonb_array_elements(p_request->v_key) a where jsonb_typeof(a)<>'string'
        or length(a#>>'{}') not between 1 and 200 or (a#>>'{}') ~ '[[:cntrl:]]') then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
    end if;
  end loop;
  if jsonb_typeof(p_request->'providers')='array' then select array_agg(value) into v_providers from jsonb_array_elements_text(p_request->'providers'); end if;
  if jsonb_typeof(p_request->'channelTypes')='array' then select array_agg(value) into v_types from jsonb_array_elements_text(p_request->'channelTypes'); end if;
  v_capabilities:=jsonb_build_object('systemOrderId',v_platform.source='newar','thirdPartyOrderNumber',v_platform.source in ('newar','game66'),'utr',false,'historicalFees',true,
    'timeBasis','created_for_all_and_non_success','successTimeBasis','success_at','successCohort','success_at_in_selected_range',
    'latencyBasis','success_at_to_created_at','customerPaymentTime',false,
    'pendingBasis','selected_created_cohort_current_stored_status','asOfBasis','query_time_not_source_snapshot',
    'sourceCompletenessVerified',false,'actualAmount',v_platform.source<>'ar','recordedFee',v_platform.source in ('newar','game66'));
  if v_platform.source='wg' then
    if v_status='success' and v_direction<>'charge' then
      raise exception using errcode='22023',message='unsupported_success_time_filter_for_wg_withdraw';
    end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_wg_capabilities(v_direction);
  end if;
  if v_platform.source='duoli' then
    v_capabilities:=v_capabilities||private.dashboard_admin_duoli_capabilities();
  end if;
  if v_platform.source='kb' then v_capabilities:=v_capabilities||private.dashboard_admin_yash_capabilities();end if;
  if v_platform.source='panda' then
    if v_member is not null then raise exception using errcode='22023',message='unsupported_member_filter_for_panda';end if;
    if v_status='success' then raise exception using errcode='22023',message='PANDA_SUCCESS_COVERAGE_UNAVAILABLE';end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_panda_capabilities(v_direction);
    v_panda_coverage:=private.dashboard_admin_panda_query_coverage(v_platform.source_name,v_direction,v_start,v_end);
    if v_action<>'details' and (v_panda_coverage->>'complete')::boolean is not true then raise exception using errcode='22023',message='PANDA_COVERAGE_INCOMPLETE';end if;
  end if;
  v_meta:=jsonb_build_object('id',v_platform.id,'name',v_platform.name,'source',v_platform.source,'sourceName',v_platform.source_name,
    'scopeGroup',v_platform.scope_group,'country',v_platform.country,'team',v_platform.team,
    'timezone',v_platform.timezone,'currency',v_platform.currency,'capabilities',v_capabilities);
  -- All branches project an explicit safe allowlist. No raw JSON, contact,
  -- account/UPI fields, comments, free text, or credentials are selected.
  if v_platform.source='ar' then
    -- Read the small, platform-scoped confirmation map once, outside the order scan.
    -- Optional for older installations; ordinary unknown records remain unknown.
    if to_regclass('private.dashboard_admin_order_provider_confirmations') is not null then
      execute 'select coalesce(jsonb_object_agg(order_kind||chr(31)||order_no,confirmed_provider),''{}''::jsonb)
        from private.dashboard_admin_order_provider_confirmations
        where source_system=$1 and country_code=$2 and platform=$3 and active'
        into v_confirmations using 'AR',v_platform.scope_group,v_platform.source_name;
    end if;
    v_source:=$q$
      select md5(jsonb_build_array(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no)::text)::uuid as id,
        null::text as system_order_id,a.order_no as order_number,null::text as third_party_order_number,a.member_id,
        case when a.order_kind='withdraw' and coalesce(btrim(a.raw_channel),'') in ('','人工取消')
          and a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消','失败','提现失败','出款失败') then '无三方（驳回）'
          else coalesce(nullif(btrim(a.raw_channel),''),$24->>(a.order_kind||chr(31)||a.order_no),'未识别通道') end as provider,
        coalesce(nullif(btrim(a.channel_type),''),'其他类型') as channel_type,
        case a.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,a.status,
        case when a.order_kind='recharge' then case a.status when '已支付' then 'success' when '待支付' then 'pending'
          when '已取消' then 'failed' else 'unknown' end
        else case when a.status='已通过' then 'success' when a.status='已提交' then 'pending'
          when a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消') then 'rejected'
          when a.status in ('失败','提现失败','出款失败') then case when coalesce(btrim(a.raw_channel),'') in ('','人工取消') then 'rejected' else 'failed' end
          else 'unknown' end end as status_group,
        a.applied_at at time zone $4 as created_at,
        case when (a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过')
          then a.completed_at at time zone $4 end as success_at,
        private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end)) as amount,
        null::numeric as actual_amount,null::numeric as withdraw_fee,$21::text as currency,a.updated_at as synced_at,null::text as utr,a.raw_channel as raw_provider
      from public.ar_collected_orders a where a.country_code=$3 and a.platform=$22 and a.source_system='AR'
        and a.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))
        and ($9 is null or a.member_id=$9) and ($10 is null or a.order_no=$10)
    $q$;
    -- ar_local_amount_known_inline_v1: only the fingerprinted native rule is
    -- expanded. A future amount-helper change retains the original call.
    if exists(select 1 from pg_catalog.pg_proc m
      where m.oid=pg_catalog.to_regprocedure('private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)')
        and pg_catalog.md5(m.prosrc)='dc8b95205e35b7366f4f9dbf052d307d'
        and m.proowner='postgres'::regrole and m.prolang=(select oid from pg_catalog.pg_language where lanname='sql')
        and m.provolatile='i' and m.proparallel='s' and not m.prosecdef and not m.proisstrict and not m.proleakproof
        and m.proconfig is not distinct from array['search_path=""']
        and m.proacl::text is not distinct from '{postgres=X/postgres}' and m.pronargdefaults=0
        and m.prorettype='numeric'::regtype and not m.proretset and m.pronargs=8) then
      v_source:=replace(v_source,$ar_amount_call$private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end))$ar_amount_call$,$ar_amount_case$CASE
  WHEN (a.country_code) IS DISTINCT FROM 'IN' THEN (coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end))
  WHEN (a.money_issue_code) = 'LOCAL_AMOUNT_STALE_FOR_USDT' THEN NULL::numeric
  WHEN (a.money_format_version) IS NOT NULL THEN CASE
   WHEN (a.money_format_version) = 1 AND (a.currency_local) = 'INR'
    AND ((a.money_issue_code) IS NULL OR (a.money_issue_code) = 'LOCAL_AMOUNT_NOT_PROVIDED')
    AND (a.amount_local) IS NOT NULL AND (a.amount_local)::text NOT IN ('NaN','Infinity','-Infinity')
   THEN (a.amount_local) ELSE NULL::numeric END
  WHEN (a.order_kind) = 'withdraw' AND upper(btrim(coalesce((a.channel_type),''))) = 'USDT'
   THEN NULL::numeric
  ELSE (coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end))
 END$ar_amount_case$);
    end if;
    -- custom_ar_date_union_v1: index each clock, retain each source row once.
    if position($ar_guard$        and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))$ar_guard$ in v_source)=0 then raise exception using errcode='55000',message='analytical_query_contract_drift';end if;
      v_source:=replace(v_source,$ar_old$        and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))$ar_old$,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$);
    if v_action='aggregate' or v_status='success' then
      v_source:=v_source||' union all '||replace(v_source,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$,$ar_success$        and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
        and a.completed_at>=($5 at time zone $4) and a.completed_at<($6 at time zone $4)
        and (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)) is not true$ar_success$);
    end if;
  elsif v_platform.source='newar' then
    v_source:=$q$
      select n.id,n.source_id as system_order_id,n.order_number,n.third_party_order_number,n.member_id,
        case when n.dataset='charge' and coalesce(btrim(n.provider),'')='' and n.channel_type='ManualRecharge' then '人工充值'
          when n.dataset='withdraw' and n.status_group in ('failed','rejected') and coalesce(btrim(n.provider),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(n.provider),''),'未识别通道') end as provider,coalesce(nullif(btrim(n.channel_type),''),'其他类型') as channel_type,
        n.dataset as direction,n.status_code as status,
        case when n.dataset='withdraw' and n.status_group='failed' and coalesce(btrim(n.provider),'') in ('','人工取消') then 'rejected'
          when n.status_group in ('success','pending','failed','rejected') then n.status_group else 'unknown' end as status_group,
        n.created_at,case when n.status_group='success' then n.success_at end as success_at,
        n.amount,n.actual_amount,n.fee as withdraw_fee,n.currency,n.received_at as synced_at,null::text as utr,n.provider as raw_provider
      from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
      where n.platform=$22 and n.dataset=any(case $7 when 'all' then array['charge','withdraw'] else array[$7] end)
        and (($19<>'aggregate' and $8<>'success' and n.created_at>=$5 and n.created_at<$6)
          or (($19='aggregate' or $8='success') and (n.created_at>=$5 and n.created_at<$6
            or (n.status_group='success' and n.success_at is not null and n.success_at>=$5 and n.success_at<$6))))
        and (t.launch_at is null or n.created_at>=t.launch_at)
        and ($9 is null or n.member_id=$9) and ($10 is null or n.order_number=$10)
        and ($23 is null or n.third_party_order_number=$23)
        and ($11 is null or n.source_id=$11)
    $q$;
  elsif v_platform.source='lg' then
    -- LG timestamps are already timestamptz; never reinterpret them as local
    -- timestamps or restrict paid events to the creation-day stat_date.
    v_source:=$q$
      select md5(jsonb_build_array('LG',l.country_code,l.platform,l.order_kind,l.order_no)::text)::uuid as id,
        null::text as system_order_id,l.order_no as order_number,null::text as third_party_order_number,l.member_id,
        coalesce(nullif(btrim(l.third_party),''),nullif(btrim(l.raw_channel),''),'未识别通道') as provider,
        coalesce(nullif(btrim(l.payment_method),''),'其他类型') as channel_type,
        case l.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,l.status_text as status,
        case when l.status_class in ('success','pending','rejected') then l.status_class else 'unknown' end as status_group,
        l.created_at,case when l.status_class='success' then l.paid_at end as success_at,
        l.metric_amount as amount,l.actual_amount,null::numeric as withdraw_fee,$21::text as currency,
        l.updated_at as synced_at,null::text as utr,l.raw_channel as raw_provider
      from public.lg_orders l
      where l.country_code=$3 and l.platform=$22 and l.source_system='LG'
        and l.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($19<>'aggregate' and $8<>'success' and l.created_at>=$5 and l.created_at<$6)
          or (($19='aggregate' or $8='success') and (l.created_at>=$5 and l.created_at<$6
            or (l.status_class='success' and l.paid_at is not null and l.paid_at>=$5 and l.paid_at<$6))))
        and ($9 is null or l.member_id=$9) and ($10 is null or l.order_no=$10)
    $q$;
  elsif v_platform.source='panda' then
    v_source:=private.dashboard_admin_panda_order_source();
  elsif v_platform.source='kb' then
    v_source:=private.dashboard_admin_yash_order_source();
  elsif v_platform.source='duoli' then
    v_source:=private.dashboard_admin_duoli_order_source();
  elsif v_platform.source='wg' then
    v_source:=private.dashboard_admin_wg_order_source(v_utr,false);
  elsif v_platform.source='game66' then
    v_source:=$q$
      select c.id,null::text as system_order_id,c.order_num as order_number,c.out_trade_no as third_party_order_number,c.uid as member_id,
        coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') as provider,coalesce(nullif(btrim(c.pay_mode),''),'其他类型') as channel_type,
        'charge'::text as direction,coalesce(nullif(c.status_text,''),c.status_code) as status,
        case c.status_code when '1' then 'success' when '0' then
          case when c.status_group in ('pending','failed') then c.status_group else 'pending' end else 'unknown' end as status_group,
        c.create_time as created_at,case when c.status_code='1' then c.pay_time end as success_at,
        coalesce(c.amount_display,c.amount_minor/100.0) as amount,null::numeric as actual_amount,null::numeric as withdraw_fee,
        'INR'::text as currency,c.last_seen_at as synced_at,null::text as utr,c.pay_method_name as raw_provider
      from public.game66_charge_orders c where c.platform_id=$1 and $7 in ('all','charge')
        and (($19<>'aggregate' and $8<>'success' and c.create_time>=$5 and c.create_time<$6)
          or (($19='aggregate' or $8='success') and (c.create_time>=$5 and c.create_time<$6
            or (c.status_code='1' and c.pay_time is not null and c.pay_time>=$5 and c.pay_time<$6))))
        and ($9 is null or c.uid=$9)
        and ($10 is null or c.order_num=$10) and ($23 is null or c.out_trade_no=$23)
      union all
      select w.id,null::text,w.order_num,w.out_trade_no,w.uid,
        case when w.status_code in ('2','-1') and coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'未识别通道') end,
        coalesce(nullif(btrim(w.payout_mode),''),'其他类型'),'withdraw',coalesce(nullif(w.status_text,''),w.status_code),
        case w.status_code when '3' then 'success' when '1' then 'pending' when '2' then case when coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then 'rejected' else 'failed' end when '-1' then 'rejected' else 'unknown' end,
        w.create_time,case when w.status_code='3' then w.update_time end,coalesce(w.amount_display,w.amount_minor/100.0),
        coalesce(w.real_amount_display,w.real_amount_minor/100.0),coalesce(w.fee_display,w.fee_minor/100.0),
        'INR',w.last_seen_at,null::text,coalesce(nullif(w.pay_channel,''),w.pay_method_name)
      from public.game66_withdraw_orders w where w.platform_id=$1 and $7 in ('all','withdraw')
        and (($19<>'aggregate' and $8<>'success' and w.create_time>=$5 and w.create_time<$6)
          or (($19='aggregate' or $8='success') and (w.create_time>=$5 and w.create_time<$6
            or (w.status_code='3' and w.update_time is not null and w.update_time>=$5 and w.update_time<$6))))
        and ($9 is null or w.uid=$9)
        and ($10 is null or w.order_num=$10) and ($23 is null or w.out_trade_no=$23)
    $q$;
  else
    raise exception using errcode='22023',message='unsupported_source';
  end if;
  -- Group and page the identical materialized, filtered source set. The old
  -- detail RPC is never paged repeatedly to manufacture aggregate totals.
  -- Details lets PostgreSQL inline the shared predicate: COUNT can prune all
  -- display/time calculations, and the page can use source time indexes.
  -- Aggregate materializes only compact analytical values (no order IDs/MD5).
  v_sql:='with orders as ('||v_source||'), filtered as '||
    case when v_action='details' then 'not materialized' else 'materialized' end||$q$ (
    select case when $19<>'aggregate' then id end as id,
      case when $19<>'aggregate' then system_order_id end as system_order_id,
      case when $19<>'aggregate' then order_number end as order_number,
      case when $19<>'aggregate' then third_party_order_number end as third_party_order_number,
      case when $19<>'aggregate' then member_id end as member_id,provider,
      case when $19<>'aggregate' then raw_provider end as raw_provider,
      channel_type,direction,
      case when $19<>'aggregate' then status end as status,status_group,
      created_at,success_at,case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,
      case when $19<>'aggregate' and actual_amount::text not in ('NaN','Infinity','-Infinity') then actual_amount end as actual_amount,
      case when $19<>'aggregate' and withdraw_fee::text not in ('NaN','Infinity','-Infinity') then withdraw_fee end as withdraw_fee,
      currency,synced_at,utr,
      (created_at >= $5 and created_at < $6) as created_in_range,
      (success_at >= $5 and success_at < $6) as success_in_range,
      (created_at at time zone $4)::date as local_date,
      extract(hour from created_at at time zone $4)::integer as local_hour,
      (success_at at time zone $4)::date as success_local_date,
      extract(hour from success_at at time zone $4)::integer as success_local_hour,
      case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount in (100,200,300,400,500,750,1000,1500,2000,5000) then trunc(amount)::text else 'other' end as amount_bucket,
      -- Disjoint amount ranges with the labels used by the admin UI. Integer
      -- boundaries are explicit: 100–200, 201–300, and so on. Every order
      -- remains in exactly one range; low/missing values stay visible.
      case when (case when direction='charge' then $25::numeric[] else $26::numeric[] end) is not null then case
        when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<(case when direction='charge' then $25::numeric[] else $26::numeric[] end)[1] then 'below'
        when amount>(case when direction='charge' then $25::numeric[] else $26::numeric[] end)[11] then 'above'
        else 'band:'||(least(width_bucket(amount,(case when direction='charge' then $25::numeric[] else $26::numeric[] end)),10)-1)::text end
        else case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<100 then 'other' when amount<=200 then '100–200'
        when amount<=300 then '201–300' when amount<=400 then '301–400'
        when amount<=500 then '401–500' when amount<=750 then '501–750'
        when amount<=1000 then '751–1,000' when amount<=2000 then '1,001–2,000'
        when amount<=5000 then '2,001–5,000' else '≥5,001' end end as amount_range_bucket,
      case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms,
      case when direction='withdraw' and status_group='pending' and created_at<=$20 then extract(epoch from $20-created_at)*1000 end as pending_wait_ms
    from orders where ($8='all' or status_group=$8) and ($12 is null or provider=any($12))
      and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
      and ($15 is null or amount>=$15) and ($16 is null or case when $31 then amount<$16 else amount<=$16 end)
  ), fee_subjects as materialized (
    select distinct direction,currency,provider,channel_type from filtered where $19<>'details' and status_group='success' and success_in_range
      and ($34 and direction='charge' and channel_type='提现转充值') is not true
      and $33 and exists(select 1 from private.fee_rate_versions where country=$32)
  ), fee_intervals as materialized (
    select s.direction,s.currency,s.provider,s.channel_type,v.* from fee_subjects s
    cross join lateral private.dashboard_admin_fee_intervals($32,$2,s.provider,s.direction,s.currency,private.dashboard_admin_fee_category($32,s.channel_type)) v
  ), fee_version_facts as (
    select f.direction,f.currency,f.provider,jsonb_build_object(
      'fee_version_matched_count',(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_version_unmatched_count',count(*)-(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_exempt_count',count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')),
      'fee_version_estimated_amount',case when count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))>0 then coalesce((sum(f.amount*v.percent_rate+v.fixed_fee) filter(where f.amount>=0)),0)::text end,
      'fee_version_state',case when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))=count(*) then 'complete'
        when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))>0 then 'partial' else 'unknown' end
    ) value from filtered f left join fee_intervals v on v.direction=f.direction and v.currency=f.currency and v.provider=f.provider
      and v.channel_type is not distinct from f.channel_type
      and f.amount>=0 and f.amount::text not in ('NaN','Infinity','-Infinity')
      and isfinite(f.created_at) and f.created_at>=v.effective_from and (v.effective_until is null or f.created_at<v.effective_until)
    where $19<>'details' and f.status_group='success' and f.success_in_range
      and (($33 and exists(select 1 from private.fee_rate_versions where country=$32)) or $34)
    group by f.direction,f.currency,f.provider
  ), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    ), created_metrics as (
    select direction,currency,provider,local_date,local_hour,amount_bucket,amount_range_bucket,
      case when grouping(local_date)=0 then 'daily' when grouping(local_hour,amount_bucket)=0 then 'matrix'
        when grouping(local_hour,amount_range_bucket)=0 then 'matrix_range'
        when grouping(local_hour)=0 then 'hourly' when grouping(amount_bucket)=0 then 'amount'
        when grouping(amount_range_bucket)=0 then 'amount_range'
        when grouping(provider)=0 then 'provider' else 'summary' end as kind,
      count(*) as all_count,case when count(amount)=count(*) then sum(amount) end as all_amount,
      count(*) filter(where amount is null) as missing_amount_count,
      count(*) filter(where amount<0) as negative_amount_count,
      count(*) filter(where status_group='success') as created_success_count,
      0::bigint as success_count,0::numeric as success_amount,
      count(*) filter(where status_group='pending') as pending_count,
      case when count(amount) filter(where status_group='pending')=count(*) filter(where status_group='pending') then coalesce(sum(amount) filter(where status_group='pending'),0) end as pending_amount,
      count(*) filter(where status_group='failed') as failed_count,
      case when count(amount) filter(where status_group='failed')=count(*) filter(where status_group='failed') then coalesce(sum(amount) filter(where status_group='failed'),0) end as failed_amount,
      count(*) filter(where status_group='rejected') as rejected_count,
      case when count(amount) filter(where status_group='rejected')=count(*) filter(where status_group='rejected') then coalesce(sum(amount) filter(where status_group='rejected'),0) end as rejected_amount,
      count(*) filter(where status_group='unknown') as unknown_count,
      case when count(amount) filter(where status_group='unknown')=count(*) filter(where status_group='unknown') then coalesce(sum(amount) filter(where status_group='unknown'),0) end as unknown_amount,
      max(synced_at) as latest_synced_at
    from filtered where $19<>'details' and created_in_range and $8<>'success'
    group by grouping sets ((direction,currency),(direction,currency,provider),
      (direction,currency,provider,local_date),(direction,currency,local_hour),
      (direction,currency,amount_bucket),(direction,currency,local_hour,amount_bucket),
      (direction,currency,amount_range_bucket),(direction,currency,local_hour,amount_range_bucket))
  ), success_metrics as (
    select direction,currency,provider,success_local_date as local_date,success_local_hour as local_hour,amount_bucket,amount_range_bucket,
      case when grouping(success_local_date)=0 then 'daily' when grouping(success_local_hour,amount_bucket)=0 then 'matrix'
        when grouping(success_local_hour,amount_range_bucket)=0 then 'matrix_range'
        when grouping(success_local_hour)=0 then 'hourly' when grouping(amount_bucket)=0 then 'amount'
        when grouping(amount_range_bucket)=0 then 'amount_range'
        when grouping(provider)=0 then 'provider' else 'summary' end as kind,
      case when $8='success' then count(*) else 0 end as all_count,
      case when $8='success' then case when count(amount)=count(*) then sum(amount) end else 0 end as all_amount,
      case when $8='success' then count(*) filter(where amount is null) else 0 end as missing_amount_count,
      case when $8='success' then count(*) filter(where amount<0) else 0 end as negative_amount_count,
      0::bigint as created_success_count,
      count(*) as success_count,
      case when count(amount)=count(*) then coalesce(sum(amount),0) end as success_amount,
      0::bigint as pending_count,0::numeric as pending_amount,
      0::bigint as failed_count,0::numeric as failed_amount,
      0::bigint as rejected_count,0::numeric as rejected_amount,
      0::bigint as unknown_count,0::numeric as unknown_amount,
      max(synced_at) as latest_synced_at
    from filtered where $19<>'details' and status_group='success' and success_in_range and $8 in ('all','success')
    group by grouping sets ((direction,currency),(direction,currency,provider),
      (direction,currency,provider,success_local_date),(direction,currency,success_local_hour),
      (direction,currency,amount_bucket),(direction,currency,success_local_hour,amount_bucket),
      (direction,currency,amount_range_bucket),(direction,currency,success_local_hour,amount_range_bucket))
  ), metrics_raw as (
    select * from created_metrics union all select * from success_metrics
  ), metrics as (
    select direction,currency,provider,local_date,local_hour,amount_bucket,amount_range_bucket,kind,
      sum(all_count)::bigint as all_count,
      case when bool_or(all_count>0 and all_amount is null) then null::numeric else coalesce(sum(all_amount),0) end as all_amount,
      sum(missing_amount_count)::bigint as missing_amount_count,
      sum(negative_amount_count)::bigint as negative_amount_count,
      sum(created_success_count)::bigint as created_success_count,
      sum(success_count)::bigint as success_count,
      case when bool_or(success_count>0 and success_amount is null) then null::numeric else coalesce(sum(success_amount),0) end as success_amount,
      sum(pending_count)::bigint as pending_count,
      case when bool_or(pending_count>0 and pending_amount is null) then null::numeric else coalesce(sum(pending_amount),0) end as pending_amount,
      sum(failed_count)::bigint as failed_count,
      case when bool_or(failed_count>0 and failed_amount is null) then null::numeric else coalesce(sum(failed_amount),0) end as failed_amount,
      sum(rejected_count)::bigint as rejected_count,
      case when bool_or(rejected_count>0 and rejected_amount is null) then null::numeric else coalesce(sum(rejected_amount),0) end as rejected_amount,
      sum(unknown_count)::bigint as unknown_count,
      case when bool_or(unknown_count>0 and unknown_amount is null) then null::numeric else coalesce(sum(unknown_amount),0) end as unknown_amount,
      max(latest_synced_at) as latest_synced_at
    from metrics_raw
    group by direction,currency,provider,local_date,local_hour,amount_bucket,amount_range_bucket,kind
  ), metric_json as (
    select kind,(to_jsonb(m)-array['kind','local_date','local_hour','amount_bucket','amount_range_bucket','all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount'])
      || jsonb_build_object('date',local_date,'hour',local_hour,'bucket',coalesce(amount_range_bucket,amount_bucket),'all_amount',all_amount::text,
        'success_amount',success_amount::text,'pending_amount',pending_amount::text,'failed_amount',failed_amount::text,
        'rejected_amount',rejected_amount::text,'unknown_amount',unknown_amount::text) || coalesce(f.fee_facts,'{}'::jsonb) || case when m.kind='provider' then coalesce(fv.value,jsonb_build_object('fee_version_matched_count',0,'fee_version_unmatched_count',m.success_count,'fee_version_estimated_amount',case when m.success_count=0 then '0' end,'fee_version_state',case when m.success_count=0 then 'complete' else 'unknown' end)) else '{}'::jsonb end as value
    from metrics m left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider
      left join fee_version_facts fv on m.kind='provider' and fv.direction=m.direction and fv.currency is not distinct from m.currency and fv.provider is not distinct from m.provider
  ), time_bounds(kind,bucket,min_ms,max_ms) as (
    select k.kind,b.* from (values('pending_age'::text),('latency'::text))k(kind)
    cross join (values
      (0,null::numeric,300000::numeric),(1,300000,1800000),(2,1800000,3600000),(3,3600000,10800000),
      (4,10800000,21600000),(5,21600000,43200000),(6,43200000,86400000),
      (7,86400000,172800000),(8,172800000,259200000),(9,259200000,null))b(bucket,min_ms,max_ms)
    where k.kind='pending_age' or $27<>2
    union all select 'latency',b.* from (values
      (0,null::numeric,60000::numeric),(1,60000,180000),(2,180000,300000),
      (3,300000,1800000),(4,1800000,3600000),(5,3600000,10800000),
      (6,10800000,21600000),(7,21600000,43200000),(8,43200000,86400000),
      (9,86400000,172800000),(10,172800000,259200000),(11,259200000,null))b(bucket,min_ms,max_ms)
    where $27=2),
  duration_rows as materialized (
    select direction,currency,amount,
      case when status_group='success' then 'latency'::text else 'pending_age'::text end as kind,
      case when status_group='success' then latency_ms else pending_wait_ms end as duration_ms,
      case when status_group='success' then
        case when success_at is null then 'missing_success_at' when not isfinite(success_at) then 'invalid_success_at'
          when success_at<created_at then 'reversed_time' when success_at>$20 then 'future_success_at' end
        else case when created_at>$20 then 'future_created_at' end end as excluded_reason
    from filtered where $19<>'details' and ((status_group='success' and success_in_range)
      or (direction='withdraw' and status_group='pending' and created_in_range))
  ), duration_summary as (
    select kind,direction,currency,count(*) as candidate_count,
      count(duration_ms) as valid_count,count(*) filter(where duration_ms is null) as excluded_count,
      case when count(amount) filter(where duration_ms is not null)=count(duration_ms)
        then coalesce(sum(amount) filter(where duration_ms is not null),0) end as valid_amount,
      count(*) filter(where duration_ms is not null and amount is null) as missing_amount_count,
      jsonb_build_object('missing_success_at',count(*) filter(where excluded_reason='missing_success_at'),
        'invalid_success_at',count(*) filter(where excluded_reason='invalid_success_at'),
        'reversed_time',count(*) filter(where excluded_reason='reversed_time'),
        'future_success_at',count(*) filter(where excluded_reason='future_success_at'),
        'future_created_at',count(*) filter(where excluded_reason='future_created_at')) as excluded_reasons,
      avg(duration_ms) as mean_ms,percentile_cont(0.5) within group(order by duration_ms) as p50_ms,
      percentile_cont(0.95) within group(order by duration_ms) as p95_ms,max(duration_ms) as max_ms
    from duration_rows group by kind,direction,currency
  ), duration_bucket_totals as materialized (
    -- Classify each valid order once. Maxima are inclusive; subsequent bins
    -- have strict lower bounds. No join of every order to every threshold.
    select kind,direction,currency,
      case when kind='latency' and $27=2 then case when duration_ms<=60000 then 0 when duration_ms<=180000 then 1 when duration_ms<=300000 then 2 else (case when duration_ms<=300000 then 0 when duration_ms<=1800000 then 1
        when duration_ms<=3600000 then 2 when duration_ms<=10800000 then 3
        when duration_ms<=21600000 then 4 when duration_ms<=43200000 then 5
        when duration_ms<=86400000 then 6 when duration_ms<=172800000 then 7
        when duration_ms<=259200000 then 8 else 9 end)+2 end else case when duration_ms<=300000 then 0 when duration_ms<=1800000 then 1
        when duration_ms<=3600000 then 2 when duration_ms<=10800000 then 3
        when duration_ms<=21600000 then 4 when duration_ms<=43200000 then 5
        when duration_ms<=86400000 then 6 when duration_ms<=172800000 then 7
        when duration_ms<=259200000 then 8 else 9 end end as bucket,
      count(*) as count,count(*) filter(where amount is null) as missing_amount_count,
      coalesce(sum(amount),0) as known_amount
    from duration_rows where duration_ms is not null group by 1,2,3,4
  ), duration_bins as materialized (
    select s.kind,s.direction,s.currency,b.bucket,b.min_ms,b.max_ms,coalesce(r.count,0) as count,
      case when coalesce(r.missing_amount_count,0)=0 then coalesce(r.known_amount,0) end as amount,
      s.valid_count,s.valid_amount
    from duration_summary s join time_bounds b on b.kind=s.kind left join duration_bucket_totals r
      on r.kind=s.kind and r.direction=s.direction and r.currency is not distinct from s.currency and r.bucket=b.bucket
  ), duration_thresholds as (
    -- Only ten tiny aggregate bins are scanned here. Excluding the current
    -- inclusive bin makes these cumulative values strictly > threshold.
    select kind,direction,currency,bucket,max_ms as threshold_ms,
      coalesce(sum(count) over tail,0) as count,
      case when count(*) filter(where amount is null) over tail=0 then coalesce(sum(amount) over tail,0) end as amount,
      valid_count,valid_amount
    from duration_bins
    window tail as (partition by kind,direction,currency order by bucket rows between 1 following and unbounded following)
  ), duration_json as (
    select kind,false as cumulative,bucket,(to_jsonb(b)-array['kind','amount','valid_amount'])
      ||jsonb_build_object('amount',amount::text,'valid_amount',valid_amount::text,
        'count_share',count::numeric/nullif(valid_count,0),'amount_share',case when valid_amount>0 then amount/valid_amount end) as value
    from duration_bins b
    union all
    select kind,true,bucket,(to_jsonb(t)-array['kind','amount','valid_amount'])
      ||jsonb_build_object('amount',amount::text,'valid_amount',valid_amount::text,
        'count_share',count::numeric/nullif(valid_count,0),'amount_share',case when valid_amount>0 then amount/valid_amount end)
    from duration_thresholds t where threshold_ms is not null
  ), duration_custom as (
    select r.direction,r.currency,$28::numeric as min_ms,$29::numeric as max_ms,
      count(*) filter(where duration_ms is not null and ($28 is null or duration_ms>$28) and ($29 is null or duration_ms<=$29)) as count,
      case when count(*) filter(where duration_ms is not null and ($28 is null or duration_ms>$28) and ($29 is null or duration_ms<=$29) and amount is null)=0
        then coalesce(sum(amount) filter(where duration_ms is not null and ($28 is null or duration_ms>$28) and ($29 is null or duration_ms<=$29)),0) end as amount,
      s.valid_count,s.valid_amount
    from duration_rows r join duration_summary s on s.kind=r.kind and s.direction=r.direction and s.currency is not distinct from r.currency
    where $30 and r.kind='latency' group by r.direction,r.currency,s.valid_count,s.valid_amount
  ), duration_custom_json as (
    select (to_jsonb(c)-array['amount','valid_amount'])||jsonb_build_object('amount',amount::text,'valid_amount',valid_amount::text,
      'count_share',count::numeric/nullif(valid_count,0),'amount_share',case when valid_amount>0 then amount/valid_amount end) as value
    from duration_custom c
  ), page as (
    select id,system_order_id,order_number,third_party_order_number,member_id,provider,raw_provider,channel_type,direction,status,status_group,
      created_at,success_at,amount::text,actual_amount::text,withdraw_fee::text,currency,synced_at,utr,latency_ms,pending_wait_ms
    from filtered where $19<>'aggregate'
      and ($8<>'success' or (status_group='success' and success_in_range))
      order by case when $8='success' then success_at else created_at end desc,direction desc,id desc limit $18 offset $17
  ) select jsonb_build_object('total',(select case when $8='success'
      then count(*) filter(where status_group='success' and success_in_range)
      else count(*) filter(where created_in_range) end from filtered),
    'summary',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency') from metric_json where kind='summary'),'[]'::jsonb),
    'groups',jsonb_build_object(
      'provider',coalesce((select jsonb_agg(value order by value->>'provider',value->>'direction',value->>'currency') from metric_json where kind='provider'),'[]'::jsonb),
      'daily',coalesce((select jsonb_agg(value order by value->>'date',value->>'provider',value->>'direction',value->>'currency') from metric_json where kind='daily'),'[]'::jsonb),
      'hourly',coalesce((select jsonb_agg(value order by (value->>'hour')::integer,value->>'direction',value->>'currency') from metric_json where kind='hourly'),'[]'::jsonb),
      'amount',coalesce((select jsonb_agg(value order by value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='amount'),'[]'::jsonb),
      'matrix',coalesce((select jsonb_agg(value order by (value->>'hour')::integer,value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='matrix'),'[]'::jsonb),
      'amount_range',coalesce((select jsonb_agg(value order by value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='amount_range'),'[]'::jsonb),
      'matrix_range',coalesce((select jsonb_agg(value order by (value->>'hour')::integer,value->>'bucket',value->>'direction',value->>'currency') from metric_json where kind='matrix_range'),'[]'::jsonb),
      'latency',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='latency' and not cumulative),'[]'::jsonb),
      'latency_thresholds',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='latency' and cumulative),'[]'::jsonb),
      'pending_age',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='pending_age' and not cumulative),'[]'::jsonb),
      'pending_age_thresholds',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency',bucket) from duration_json where kind='pending_age' and cumulative),'[]'::jsonb))
      ||case when $30 then jsonb_build_object('latency_custom',coalesce((select jsonb_agg(value order by value->>'direction',value->>'currency') from duration_custom_json),'[]'::jsonb)) else '{}'::jsonb end,
    'latencySummary',coalesce((select jsonb_agg((to_jsonb(s)-array['kind','valid_amount'])||jsonb_build_object('valid_amount',valid_amount::text) order by direction,currency) from duration_summary s where kind='latency'),'[]'::jsonb),
    'pendingSummary',coalesce((select jsonb_agg((to_jsonb(s)-array['kind','valid_amount'])||jsonb_build_object('valid_amount',valid_amount::text) order by direction,currency) from duration_summary s where kind='pending_age'),'[]'::jsonb),
    'rows',coalesce((select jsonb_agg(to_jsonb(p) order by case when $8='success' then success_at else created_at end desc,direction desc,id desc) from page p),'[]'::jsonb))
  $q$;

  -- Provider pages do not need the eight chart grouping sets or duration bins.
  -- Reuse exactly the same scoped source and predicates, with two grouping sets.
  if p_request->>'view'='providers' and v_action='aggregate' then
    if v_status<>'all' then raise exception using errcode='22023',message='unsupported_filter';end if;
    v_sql:='with orders as ('||v_source||$q$), filtered as materialized (
      select direction,currency,provider,channel_type,status_group,created_at,success_at,
        case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,synced_at,
        (created_at >= $5 and created_at < $6) as created_in_range,
        (success_at >= $5 and success_at < $6 and status_group='success') as success_in_range
      from orders where ($8='all' or status_group=$8) and ($12 is null or provider=any($12))
        and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
        and ($15 is null or amount>=$15) and ($16 is null or case when $31 then amount<$16 else amount<=$16 end)
    ), fee_subjects as materialized (
    select distinct direction,currency,provider,channel_type from filtered where $19<>'details' and status_group='success' and success_in_range
      and ($34 and direction='charge' and channel_type='提现转充值') is not true
      and $33 and exists(select 1 from private.fee_rate_versions where country=$32)
  ), fee_intervals as materialized (
    select s.direction,s.currency,s.provider,s.channel_type,v.* from fee_subjects s
    cross join lateral private.dashboard_admin_fee_intervals($32,$2,s.provider,s.direction,s.currency,private.dashboard_admin_fee_category($32,s.channel_type)) v
  ), fee_version_facts as (
    select f.direction,f.currency,f.provider,jsonb_build_object(
      'fee_version_matched_count',(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_version_unmatched_count',count(*)-(count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))),
      'fee_exempt_count',count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')),
      'fee_version_estimated_amount',case when count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值'))>0 then coalesce((sum(f.amount*v.percent_rate+v.fixed_fee) filter(where f.amount>=0)),0)::text end,
      'fee_version_state',case when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))=count(*) then 'complete'
        when (count(v.effective_from) filter(where f.amount>=0)+count(*) filter(where ($34 and f.direction='charge' and f.channel_type='提现转充值')))>0 then 'partial' else 'unknown' end
    ) value from filtered f left join fee_intervals v on v.direction=f.direction and v.currency=f.currency and v.provider=f.provider
      and v.channel_type is not distinct from f.channel_type
      and f.amount>=0 and f.amount::text not in ('NaN','Infinity','-Infinity')
      and isfinite(f.created_at) and f.created_at>=v.effective_from and (v.effective_until is null or f.created_at<v.effective_until)
    where $19<>'details' and f.status_group='success' and f.success_in_range
      and (($33 and exists(select 1 from private.fee_rate_versions where country=$32)) or $34)
    group by f.direction,f.currency,f.provider
  ), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    ), metric as (
      select direction,currency,provider,case when grouping(provider)=0 then 'provider' else 'summary' end as kind,
        count(*) filter(where created_in_range) as all_count,
        case when count(*) filter(where created_in_range and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range),0) end as all_amount,
        count(*) filter(where created_in_range and amount is null) as missing_amount_count,
        count(*) filter(where created_in_range and amount<0) as negative_amount_count,
        count(*) filter(where created_in_range and status_group='success') as created_success_count,
        count(*) filter(where success_in_range) as success_count,
        case when count(*) filter(where success_in_range and amount is null)=0
          then coalesce(sum(amount) filter(where success_in_range),0) end as success_amount,
        count(*) filter(where created_in_range and status_group='pending') as pending_count,
        case when count(*) filter(where created_in_range and status_group='pending' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='pending'),0) end as pending_amount,
        count(*) filter(where created_in_range and status_group='failed') as failed_count,
        case when count(*) filter(where created_in_range and status_group='failed' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='failed'),0) end as failed_amount,
        count(*) filter(where created_in_range and status_group='rejected') as rejected_count,
        case when count(*) filter(where created_in_range and status_group='rejected' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='rejected'),0) end as rejected_amount,
        count(*) filter(where created_in_range and status_group='unknown') as unknown_count,
        case when count(*) filter(where created_in_range and status_group='unknown' and amount is null)=0
          then coalesce(sum(amount) filter(where created_in_range and status_group='unknown'),0) end as unknown_amount,
        max(synced_at) as latest_synced_at
      from filtered group by grouping sets ((direction,currency),(direction,currency,provider))
    ), output as (
      select kind,(to_jsonb(m)-'kind')||jsonb_build_object('all_amount',all_amount::text,
        'success_amount',success_amount::text,'pending_amount',pending_amount::text,
        'failed_amount',failed_amount::text,'rejected_amount',rejected_amount::text,
        'unknown_amount',unknown_amount::text) || coalesce(f.fee_facts,'{}'::jsonb) || case when m.kind='provider' then coalesce(fv.value,jsonb_build_object('fee_version_matched_count',0,'fee_version_unmatched_count',m.success_count,'fee_version_estimated_amount',case when m.success_count=0 then '0' end,'fee_version_state',case when m.success_count=0 then 'complete' else 'unknown' end)) else '{}'::jsonb end as value from metric m
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider
      left join fee_version_facts fv on m.kind='provider' and fv.direction=m.direction and fv.currency is not distinct from m.currency and fv.provider is not distinct from m.provider
    ) select jsonb_build_object('total',(select count(*) from filtered where created_in_range),
      'summary',coalesce((select jsonb_agg(value) from output where kind='summary'),'[]'::jsonb),
      'groups',jsonb_build_object('provider',coalesce((select jsonb_agg(value order by value->>'provider')
        from output where kind='provider'),'[]'::jsonb)),'rows','[]'::jsonb)
    $q$;
    -- ar_provider_fee_fold_v1: unchanged facts, one fewer filtered scan.
    if v_platform.source='ar' then
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_0$), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    $ar_fee_fold_0$,'')))/length($ar_fee_fold_0$), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    $ar_fee_fold_0$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_0$), fee_bands as (
      -- fee_bands_v1: successful orders use their success-time window. Aggregate
      -- only amount/count facts; do not expose order identifiers or raw payload.
      select direction,currency,provider,jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts from filtered where $19<>'details'
      group by direction,currency,provider
    $ar_fee_fold_0$,$ar_fee_fold_0$$ar_fee_fold_0$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_1$max(synced_at) as latest_synced_at$ar_fee_fold_1$,'')))/length($ar_fee_fold_1$max(synced_at) as latest_synced_at$ar_fee_fold_1$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_1$max(synced_at) as latest_synced_at$ar_fee_fold_1$,$ar_fee_fold_1$max(synced_at) as latest_synced_at,
        jsonb_build_object(
        'fee_low_count',count(*) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),
        'fee_low_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=0 and amount<=2000),0)::text,
        'fee_high_count',count(*) filter(where status_group='success' and success_in_range and amount>=2001),
        'fee_high_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>=2001),0)::text,
        'fee_gap_count',count(*) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),
        'fee_gap_amount',coalesce(sum(amount) filter(where status_group='success' and success_in_range and amount>2000 and amount<2001),0)::text,
        'fee_unpriced_count',count(*) filter(where status_group='success' and success_in_range and (amount is null or amount<0))
      ) as fee_facts$ar_fee_fold_1$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_2$(to_jsonb(m)-'kind')$ar_fee_fold_2$,'')))/length($ar_fee_fold_2$(to_jsonb(m)-'kind')$ar_fee_fold_2$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_2$(to_jsonb(m)-'kind')$ar_fee_fold_2$,$ar_fee_fold_2$(to_jsonb(m)-array['kind','fee_facts'])$ar_fee_fold_2$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_3$coalesce(f.fee_facts,'{}'::jsonb)$ar_fee_fold_3$,'')))/length($ar_fee_fold_3$coalesce(f.fee_facts,'{}'::jsonb)$ar_fee_fold_3$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_3$coalesce(f.fee_facts,'{}'::jsonb)$ar_fee_fold_3$,$ar_fee_fold_3$case when m.kind='provider' then m.fee_facts else '{}'::jsonb end$ar_fee_fold_3$);
      if (length(v_sql)-length(replace(v_sql,$ar_fee_fold_4$
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider$ar_fee_fold_4$,'')))/length($ar_fee_fold_4$
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider$ar_fee_fold_4$)<>1 then
        raise exception using errcode='55000',message='ar_provider_fee_fold_contract_drift';
      end if;
      v_sql:=replace(v_sql,$ar_fee_fold_4$
      left join fee_bands f on m.kind='provider' and f.direction=m.direction and f.currency is not distinct from m.currency and f.provider is not distinct from m.provider$ar_fee_fold_4$,$ar_fee_fold_4$$ar_fee_fold_4$);
    end if;
  end if;

  if v_platform.source='duoli' and coalesce(p_request->>'view','full')<>'providers' then
    if (length(v_sql)-length(replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'')))/length($duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$)<>1 then
      raise exception 'duoli_payment_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'null::numeric as latency_ms');
  end if;
  if v_platform.source='panda' and coalesce(p_request->>'view','full')<>'providers' then
    if (length(v_sql)-length(replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'')))/length($panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$)<>1 then raise exception 'panda_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'null::numeric as latency_ms');
  end if;
  execute v_sql into v_result using v_id,v_platform.name,v_platform.scope_group,v_platform.timezone,v_start,v_end,
    v_direction,v_status,v_member,v_order,v_system,v_providers,v_types,v_currency,v_min,v_max,v_offset,v_limit,v_action,v_asof,v_platform.currency,v_platform.source_name,v_third,v_confirmations,v_charge_edges,v_withdraw_edges,v_duration_version,v_duration_min,v_duration_max,v_duration_custom,v_max_exclusive,v_fee_country,v_fee_currency_proven,(v_platform.source='wg');
  if v_action='details' then
    v_result:=jsonb_set(v_result,'{rows}',coalesce((select jsonb_agg(x||case when v_platform.source='wg' and x->>'direction'='charge' and x->>'channel_type'='提现转充值' then
      jsonb_build_object('fee_exempt',true,'fee_exempt_reason','wg_withdraw_to_charge','fee_version_state','complete',
        'fee_version_ids','[]'::jsonb,'fee_version_percent_rate','0','fee_version_fixed_fee','0',
        'fee_version_estimated_amount','0','fee_version_basis','native_business_rule')
      else private.dashboard_admin_fee_quote(v_fee_country,v_platform.name,
      x->>'provider',x->>'direction',case when v_fee_currency_proven then x->>'currency' end,(x->>'created_at')::timestamptz,(x->>'amount')::numeric,private.dashboard_admin_fee_category(v_fee_country,x->>'channel_type')) end order by n)
      from jsonb_array_elements(v_result->'rows') with ordinality t(x,n)),'[]'::jsonb));
  end if;
  if v_action='details' and v_platform.source='ar' then v_result:=private.dashboard_admin_ar_order_money(v_result,v_platform.scope_group,v_platform.source_name);end if;
  if v_platform.source='wg' then v_result:=private.dashboard_admin_wg_order_result(v_result,v_platform.scope_group,v_platform.source_name);end if;
  if v_platform.source='panda' then
    v_result:=private.dashboard_admin_panda_order_result(v_result)||jsonb_build_object('pandaCoverage',v_panda_coverage);
  end if;
  if v_platform.source='duoli' then v_result:=private.dashboard_admin_duoli_order_result(v_result);end if;
  v_result:=private.dashboard_admin_order_business_result(v_result,v_platform.source,v_platform.scope_group,v_platform.source_name,v_platform.id);
  return v_result||case when v_duration_version=2 then jsonb_build_object('durationVersion',2)
      ||case when v_duration_custom then jsonb_build_object('durationRange',v_duration->'range') else '{}'::jsonb end else '{}'::jsonb end
    ||case when v_amount_bands is null then '{}'::jsonb else jsonb_build_object('amountBands',v_amount_bands,'amountBandsVersion',1) end
    ||jsonb_build_object('version',1,'platform',v_meta,'basis','mixed_created_success','startAt',v_start,'endAt',v_end,
    'asOf',v_asof,'offset',v_offset,'limit',v_limit,'hasMore',(v_result->>'total')::bigint>v_offset::bigint+v_limit,
    'capabilities',v_capabilities);
end;
$function$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_member_daily(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare
  v_platform record; v_id uuid; v_start timestamptz; v_end timestamptz;
  v_direction text; v_currency text; v_key text; v_request jsonb;
  v_providers text[]; v_confirmations jsonb:='{}'::jsonb;
  v_basis text; v_axis text; v_source text; v_sources text[]:='{}'; v_sql text; v_rows jsonb;
begin
  -- Same fresh Auth/profile/preview grant as the existing live order reader.
  -- The authorized catalog retains raw source identity and excludes disabled,
  -- future and replaced legacy order sources.
  perform private.dashboard_admin_live_scope();
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>16384
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'platformId','startAt','endAt','direction','providers','currency'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  foreach v_key in array array['platformId','startAt','endAt','direction','currency'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb and
      (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  begin
    v_id:=(p_request->>'platformId')::uuid;
    if coalesce(p_request->>'startAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$'
      or coalesce(p_request->>'endAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      raise exception using errcode='22023',message='invalid_time';
    end if;
    v_start:=(p_request->>'startAt')::timestamptz;v_end:=(p_request->>'endAt')::timestamptz;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='invalid_filter';
  end;
  select * into v_platform from private.dashboard_admin_live_platforms() p where p.id=v_id;
  if not found then raise exception using errcode='42501',message='platform_denied';end if;
  if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_start>=v_end
    or (v_end at time zone v_platform.timezone)-(v_start at time zone v_platform.timezone)>interval '31 days' then
    raise exception using errcode='22023',message='invalid_range';
  end if;
  v_direction:=coalesce(p_request->>'direction','all');v_currency:=nullif(btrim(p_request->>'currency'),'');
  if v_direction not in ('all','charge','withdraw') then raise exception using errcode='22023',message='invalid_direction';end if;
  if p_request ? 'providers' and p_request->'providers'<>'null'::jsonb then
    if jsonb_typeof(p_request->'providers')<>'array' or jsonb_array_length(p_request->'providers')>200
      or exists(select 1 from jsonb_array_elements(p_request->'providers') a where jsonb_typeof(a)<>'string'
        or length(a#>>'{}') not between 1 and 200 or (a#>>'{}') ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end if;
  -- Expand canonical provider selections using the exact existing order-reader
  -- mapping. All selected providers enter one DISTINCT set, never summed sets.
  v_request:=private.dashboard_admin_live_expand_provider_filter(p_request);
  if jsonb_typeof(v_request->'providers')='array' and jsonb_array_length(v_request->'providers')>0 then
    select array_agg(value) into v_providers from jsonb_array_elements_text(v_request->'providers');
  end if;
  -- duoli_existing_members_v1: reuse the authorized native catalog identity.
  if v_platform.source='duoli' then
    return private.dashboard_admin_duoli_member_daily(to_jsonb(v_platform),v_start,v_end,v_direction,v_providers,v_currency);
  end if;
  -- wg_existing_members_v1: preserve all original source implementations.
  if v_platform.source='wg' then
    return private.dashboard_admin_wg_member_daily(to_jsonb(v_platform),v_start,v_end,v_direction,v_providers,v_currency);
  end if;
  if v_platform.source='ar' and v_providers is not null
    and to_regclass('private.dashboard_admin_order_provider_confirmations') is not null then
    execute 'select coalesce(jsonb_object_agg(order_kind||chr(31)||order_no,confirmed_provider),''{}''::jsonb)
      from private.dashboard_admin_order_provider_confirmations where source_system=$1 and country_code=$2 and platform=$3 and active'
      into v_confirmations using 'AR',v_platform.scope_group,v_platform.source_name;
  end if;

  -- Separate indexed creation/success scans preserve cross-day successes. The
  -- axes below are internal constants; every request value is a bound parameter.
  foreach v_basis in array array['created','success'] loop
    if v_platform.source='ar' and v_providers is null then
      -- member_daily_read_performance_v1: expose exact kind/status predicates
      -- to the existing partial covering indexes; keep both event clocks.
      v_axis:=case v_basis when 'created' then 'applied_at' else 'completed_at' end;
      v_source:=$q$
        select '$basis$'::text as basis,a.$axis$ at time zone $4 as event_at,
          'charge'::text as direction,a.member_id,null::text as provider,$10::text as currency
        from public.ar_collected_orders a where a.country_code=$2 and a.platform=$3 and a.source_system='AR'
          and $6 in ('all','charge') and a.order_kind='recharge'
          and a.$axis$>=($5 at time zone $4) and a.$axis$<($11 at time zone $4) $charge_success$
        union all
        select '$basis$'::text,a.$axis$ at time zone $4,'withdraw',a.member_id,null::text,$10::text
        from public.ar_collected_orders a where a.country_code=$2 and a.platform=$3 and a.source_system='AR'
          and $6 in ('all','withdraw') and a.order_kind='withdraw'
          and a.$axis$>=($5 at time zone $4) and a.$axis$<($11 at time zone $4) $withdraw_success$
      $q$;
      v_source:=replace(replace(v_source,
        '$charge_success$',case v_basis when 'success' then 'and a.status=''已支付''' else '' end),
        '$withdraw_success$',case v_basis when 'success' then 'and a.status=''已通过''' else '' end);
    elsif v_platform.source='ar' then
      v_axis:=case v_basis when 'created' then 'applied_at' else 'completed_at' end;
      v_source:=$q$
        select '$basis$'::text as basis,a.$axis$ at time zone $4 as event_at,
          case a.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,a.member_id,
          case when a.order_kind='withdraw' and coalesce(btrim(a.raw_channel),'') in ('','人工取消')
            and a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消','失败','提现失败','出款失败') then '无三方（驳回）'
            else coalesce(nullif(btrim(a.raw_channel),''),$9->>(a.order_kind||chr(31)||a.order_no),'未识别通道') end as provider,
          $10::text as currency
        from public.ar_collected_orders a where a.country_code=$2 and a.platform=$3 and a.source_system='AR'
          and a.order_kind=any(case $6 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
          and a.$axis$>=($5 at time zone $4) and a.$axis$<($11 at time zone $4)
      $q$;
      if v_basis='success' then v_source:=v_source||$q$ and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))$q$;end if;
    elsif v_platform.source='newar' then
      v_axis:=case v_basis when 'created' then 'created_at' else 'success_at' end;
      v_source:=$q$
        select '$basis$'::text as basis,n.$axis$ as event_at,n.dataset as direction,n.member_id,
          case when n.dataset='charge' and coalesce(btrim(n.provider),'')='' and n.channel_type='ManualRecharge' then '人工充值'
            when n.dataset='withdraw' and n.status_group in ('failed','rejected') and coalesce(btrim(n.provider),'') in ('','人工取消') then '无三方（驳回）'
            else coalesce(nullif(btrim(n.provider),''),'未识别通道') end as provider,n.currency
        from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
        where n.platform=$3 and n.dataset=any(case $6 when 'all' then array['charge','withdraw'] else array[$6] end)
          and n.$axis$>=$5 and n.$axis$<$11 and (t.launch_at is null or n.created_at>=t.launch_at)
      $q$;
      if v_basis='success' then v_source:=v_source||$q$ and n.status_group='success'$q$;end if;
    elsif v_platform.source='lg' then
      v_axis:=case v_basis when 'created' then 'created_at' else 'paid_at' end;
      v_source:=$q$
        select '$basis$'::text as basis,l.$axis$ as event_at,
          case l.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,l.member_id,
          coalesce(nullif(btrim(l.third_party),''),nullif(btrim(l.raw_channel),''),'未识别通道') as provider,$10::text as currency
        from public.lg_orders l where l.country_code=$2 and l.platform=$3 and l.source_system='LG'
          and l.order_kind=any(case $6 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
          and l.$axis$>=$5 and l.$axis$<$11
      $q$;
      if v_basis='success' then v_source:=v_source||$q$ and l.status_class='success'$q$;end if;
    elsif v_platform.source='kb' then
      v_axis:=case v_basis when 'created' then 'created_at' else 'completed_at' end;
      v_source:=replace(replace(replace($q$
       select '$basis$'::text basis,y.$axis$ event_at,
        case y.order_type when 'deposit' then 'charge' else 'withdraw' end direction,
        y.uid member_id,private.dashboard_admin_yash_order_provider(y.order_type,y.supplier,y.channel) provider,y.currency
       from private.yash_orders y where $2='IN' and $3='YASH.BET' and y.source_site='yash'
        and y.order_type=any(case $6 when 'all' then array['deposit','withdrawal'] when 'charge' then array['deposit'] else array['withdrawal'] end)
        and y.$axis$ >= $5 and y.$axis$ < $11 $success$
       $q$,'$basis$',v_basis),'$axis$',v_axis),'$success$',case when v_basis='success' then
        'and private.dashboard_admin_yash_completed_at(y.order_type,y.status,y.created_at,y.completed_at,statement_timestamp()) is not null' else '' end);
    elsif v_platform.source='game66' then
      v_source:=$q$
        select '$basis$'::text as basis,c.$charge_axis$ as event_at,'charge'::text as direction,c.uid as member_id,
          coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') as provider,'INR'::text as currency
        from public.game66_charge_orders c where c.platform_id=$1 and $6 in ('all','charge')
          and c.$charge_axis$>=$5 and c.$charge_axis$<$11 $charge_success$
        union all
        select '$basis$'::text,w.$withdraw_axis$,'withdraw',w.uid,
          case when w.status_code in ('2','-1') and coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then '无三方（驳回）'
            else coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'未识别通道') end,'INR'
        from public.game66_withdraw_orders w where w.platform_id=$1 and $6 in ('all','withdraw')
          and w.$withdraw_axis$>=$5 and w.$withdraw_axis$<$11 $withdraw_success$
      $q$;
      v_source:=replace(replace(replace(replace(v_source,
        '$charge_axis$',case v_basis when 'created' then 'create_time' else 'pay_time' end),
        '$withdraw_axis$',case v_basis when 'created' then 'create_time' else 'update_time' end),
        '$charge_success$',case v_basis when 'success' then 'and c.status_code=''1''' else '' end),
        '$withdraw_success$',case v_basis when 'success' then 'and w.status_code=''3''' else '' end);
    else
      raise exception using errcode='22023',message='unsupported_source';
    end if;
    v_sources:=array_append(v_sources,replace(replace(v_source,'$basis$',v_basis),'$axis$',coalesce(v_axis,'')));
  end loop;

  v_sql:='with events as ('||array_to_string(v_sources,' union all ')||$q$), filtered as (
    select basis,(event_at at time zone $4)::date as date,direction,nullif(btrim(member_id),'') as member_id
    from events where ($7::text[] is null or provider=any($7)) and ($8::text is null or currency=$8)
  ), member_orders as (
    -- member_daily_single_group_v1: include NULL IDs to preserve missing-order
    -- coverage; they never count as a member or a frequency-threshold member.
    select date,direction,member_id,
      count(*) filter(where basis='created') as created_count,
      count(*) filter(where basis='success') as success_count
    from filtered group by date,direction,member_id
  ), counts as (
    select date,direction,
      count(*) filter(where member_id is not null and created_count>0) as created_member_count,
      count(*) filter(where member_id is not null and success_count>0) as success_member_count,
      sum(created_count) as created_order_count,
      sum(success_count) as success_order_count,
      coalesce(sum(created_count) filter(where member_id is null),0) as created_missing_member_count,
      coalesce(sum(success_count) filter(where member_id is null),0) as success_missing_member_count,
      count(*) filter(where member_id is not null and created_count>=2) as created_members_ge2,
      count(*) filter(where member_id is not null and created_count>=3) as created_members_ge3,
      count(*) filter(where member_id is not null and created_count>=4) as created_members_ge4,
      count(*) filter(where member_id is not null and created_count>=5) as created_members_ge5,
      count(*) filter(where member_id is not null and success_count>=2) as success_members_ge2,
      count(*) filter(where member_id is not null and success_count>=3) as success_members_ge3,
      count(*) filter(where member_id is not null and success_count>=4) as success_members_ge4,
      count(*) filter(where member_id is not null and success_count>=5) as success_members_ge5
    from member_orders group by date,direction
  ), days as (
    select d::date as date from generate_series(($5 at time zone $4)::date::timestamp,
      (($11-interval '1 microsecond') at time zone $4)::date::timestamp,interval '1 day') d
  ), rows as (
    select days.date,d.direction,coalesce(c.created_member_count,0) as created_member_count,
      coalesce(c.success_member_count,0) as success_member_count,
      coalesce(c.created_order_count,0) as created_order_count,coalesce(c.success_order_count,0) as success_order_count,
      coalesce(c.created_missing_member_count,0) as created_missing_member_count,
      coalesce(c.success_missing_member_count,0) as success_missing_member_count,
      coalesce(c.created_members_ge2,0) as created_members_ge2,
      coalesce(c.created_members_ge3,0) as created_members_ge3,
      coalesce(c.created_members_ge4,0) as created_members_ge4,
      coalesce(c.created_members_ge5,0) as created_members_ge5,
      coalesce(c.success_members_ge2,0) as success_members_ge2,
      coalesce(c.success_members_ge3,0) as success_members_ge3,
      coalesce(c.success_members_ge4,0) as success_members_ge4,
      coalesce(c.success_members_ge5,0) as success_members_ge5
    from days cross join unnest(case $6 when 'all' then array['charge','withdraw'] else array[$6] end) d(direction)
    left join counts c on c.date=days.date and c.direction=d.direction
  ) select coalesce(jsonb_agg(to_jsonb(r) order by r.date,r.direction),'[]'::jsonb) from rows r$q$;
  execute v_sql into v_rows using v_id,v_platform.scope_group,v_platform.source_name,v_platform.timezone,
    v_start,v_direction,v_providers,v_currency,v_confirmations,v_platform.currency,v_end;
  return jsonb_build_object('version',1,'asOf',statement_timestamp(),'startAt',v_start,'endAt',v_end,
    'platform',jsonb_build_object('id',v_platform.id,'name',v_platform.name,'country',v_platform.country,
      'team',v_platform.team,'source',v_platform.source,'sourceName',v_platform.source_name,
      'scopeGroup',v_platform.scope_group,'timezone',v_platform.timezone,'currency',v_platform.currency),
    'rows',v_rows,'capabilities',jsonb_build_object('memberIdentity',true,'createdBasis','created_at',
      'successBasis','success_at','dedupe','platform_local_date_direction_member',
      'sourceCompletenessVerified',false,'periodTotal','sum_daily_unique_member_visits',
      'frequencyBasis','per_platform_local_day_order_count','frequencyThresholds',jsonb_build_array(2,3,4,5)));
end;
$function$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_drilldown_raw(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare
  v_action text; v_options jsonb; v_platform record; v_meta jsonb; v_capabilities jsonb; v_panda_coverage jsonb;
  v_id uuid; v_start timestamptz; v_end timestamptz; v_asof timestamptz := statement_timestamp();
  v_direction text; v_status text; v_order text; v_third text; v_member text; v_system text; v_utr text;
  v_providers text[]; v_types text[]; v_currency text; v_min numeric; v_max numeric;
  v_offset integer; v_limit integer; v_key text; v_source text; v_sql text; v_result jsonb;
  v_confirmations jsonb := '{}'::jsonb;
  -- custom_analysis_ranges_v1: isolated hour/amount segment, no re-bucketing.
  v_max_exclusive boolean:=false;v_hour_min integer;v_hour_max integer;v_hour_range jsonb;
  -- duration_precision_ranges_v2: parse once, use bound numeric parameters.
  v_duration jsonb;v_duration_version integer;v_duration_min numeric;v_duration_max numeric;v_duration_custom boolean;
  -- dynamic_amount_bands_v1: validate/parse once, never once per order.
  v_amount_bands jsonb; v_charge_edges numeric[]; v_withdraw_edges numeric[];
  v_kind text; v_hour integer; v_bucket_text text; v_bucket integer; v_cumulative boolean; v_prefix text;
begin
 -- duoli_existing_orders_v1
 -- wg_existing_orders_v1
  -- Catalog helper validates Auth, active profile, independent grant and scope
  -- on every call, including queries with no matching orders.
  select coalesce(jsonb_agg(to_jsonb(p) order by p.scope_group,p.name,p.source),'[]'::jsonb)
    into v_options from private.dashboard_admin_live_platforms() p;
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>32768
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'action','platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId',
      'utr','providers','channelTypes','currency','amountMin','amountMax','amountMaxExclusive','hourRange','amountBands','durationVersion','durationRange','offset','limit','view','kind','hour','bucket','cumulative'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  v_action:=coalesce(p_request->>'action','catalog');
  v_duration:=private.dashboard_admin_validate_duration(p_request);
  v_duration_version:=(v_duration->>'version')::integer;
  v_duration_min:=(v_duration->>'min_ms')::numeric;v_duration_max:=(v_duration->>'max_ms')::numeric;
  v_duration_custom:=coalesce((v_duration->>'custom')::boolean,false);
  v_amount_bands:=private.dashboard_admin_validate_amount_bands(p_request->'amountBands',coalesce(p_request->>'direction','all'));
  select array_agg(value::numeric order by ordinality) into v_charge_edges
    from jsonb_array_elements_text(v_amount_bands->'charge') with ordinality;
  select array_agg(value::numeric order by ordinality) into v_withdraw_edges
    from jsonb_array_elements_text(v_amount_bands->'withdraw') with ordinality;
  if v_action<>'aggregate' or p_request->>'view' is distinct from 'drilldown' then
    raise exception using errcode='22023',message='invalid_drilldown_view';
  end if;
  v_kind:=p_request->>'kind';
  if jsonb_typeof(p_request->'kind') is distinct from 'string' or v_kind not in('hourly','amount','amount_range','matrix','matrix_range','latency','custom') then
    raise exception using errcode='22023',message='invalid_drilldown_kind';
  end if;
  if v_kind in('hourly','matrix','matrix_range') then
    if jsonb_typeof(p_request->'hour') is distinct from 'number' or p_request->>'hour' !~ '^[0-9]{1,2}$' then
      raise exception using errcode='22023',message='invalid_drilldown_hour';end if;
    v_hour:=(p_request->>'hour')::integer;
    if v_hour not between 0 and 23 then raise exception using errcode='22023',message='invalid_drilldown_hour';end if;
  elsif p_request?'hour' then raise exception using errcode='22023',message='unexpected_drilldown_hour';end if;
  if v_kind='latency' then
    if v_duration_custom then
      v_bucket:=null;v_cumulative:=false;
    else
      if jsonb_typeof(p_request->'bucket') is distinct from 'number' or p_request->>'bucket' !~ '^[0-9]{1,2}$' then
        raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
      v_bucket:=(p_request->>'bucket')::integer;
      if v_bucket not between 0 and (case when v_duration_version=2 then 11 else 9 end) then
        raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
      if p_request?'cumulative' and jsonb_typeof(p_request->'cumulative') is distinct from 'boolean' then
        raise exception using errcode='22023',message='invalid_drilldown_cumulative';end if;
      v_cumulative:=coalesce((p_request->>'cumulative')::boolean,false);
      if v_cumulative and v_bucket=(case when v_duration_version=2 then 11 else 9 end) then
        raise exception using errcode='22023',message='invalid_drilldown_threshold';end if;
    end if;
  else
    if p_request?'cumulative' then raise exception using errcode='22023',message='unexpected_drilldown_cumulative';end if;
    if v_kind not in('hourly','custom') then
      if jsonb_typeof(p_request->'bucket') is distinct from 'string' then raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
      v_bucket_text:=p_request->>'bucket';
      if (v_kind in('amount','matrix') and v_bucket_text not in('100','200','300','400','500','750','1000','1500','2000','5000','other','unknown'))
        or (v_kind in('amount_range','matrix_range') and (
          (v_amount_bands is null and v_bucket_text not in('100–200','201–300','301–400','401–500','501–750','751–1,000','1,001–2,000','2,001–5,000','≥5,001','other','unknown'))
          or (v_amount_bands is not null and v_bucket_text !~ '^(band:[0-9]|below|above|unknown)$'))) then
        raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
    elsif p_request?'bucket' then raise exception using errcode='22023',message='unexpected_drilldown_bucket';end if;
  end if;
  foreach v_key in array array['platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId','utr','currency'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb and
      (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  begin
    v_id:=(p_request->>'platformId')::uuid;
    if coalesce(p_request->>'startAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$'
      or coalesce(p_request->>'endAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      raise exception using errcode='22023',message='invalid_time';
    end if;
    v_start:=(p_request->>'startAt')::timestamptz; v_end:=(p_request->>'endAt')::timestamptz;
    v_offset:=coalesce((p_request->>'offset')::integer,0); v_limit:=coalesce((p_request->>'limit')::integer,20);
    v_min:=nullif(p_request->>'amountMin','')::numeric; v_max:=nullif(p_request->>'amountMax','')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='invalid_filter';
  end;
  if p_request?'hourRange' then
    if v_kind<>'custom' or jsonb_typeof(p_request->'hourRange') is distinct from 'object' then
      raise exception using errcode='22023',message='invalid_hour_range';
    end if;
    v_hour_range:=p_request->'hourRange';
    if exists(select 1 from jsonb_object_keys(v_hour_range) k where k<>all(array['minHour','maxHour']))
      or jsonb_typeof(v_hour_range->'minHour') is distinct from 'number'
      or jsonb_typeof(v_hour_range->'maxHour') is distinct from 'number'
      or coalesce(v_hour_range->>'minHour','')!~ '^[0-9]{1,2}$'
      or coalesce(v_hour_range->>'maxHour','')!~ '^[0-9]{1,2}$' then
      raise exception using errcode='22023',message='invalid_hour_range';
    end if;
    v_hour_min:=(v_hour_range->>'minHour')::integer;v_hour_max:=(v_hour_range->>'maxHour')::integer;
    if v_hour_min not between 0 and 23 or v_hour_max not between 1 and 24 or v_hour_min>=v_hour_max then
      raise exception using errcode='22023',message='invalid_hour_range';
    end if;
  end if;
  if p_request?'amountMaxExclusive' then
    if v_kind<>'custom' or jsonb_typeof(p_request->'amountMaxExclusive') is distinct from 'boolean'
      or v_max is null then
      raise exception using errcode='22023',message='invalid_amount_max_exclusive';
    end if;
    v_max_exclusive:=(p_request->>'amountMaxExclusive')::boolean;
    if v_max_exclusive and v_min>=v_max then raise exception using errcode='22023',message='invalid_range';end if;
  end if;
  if v_kind='custom' and (v_min<0 or v_max<0 or (v_hour_range is null and v_min is null and v_max is null)) then
    raise exception using errcode='22023',message='invalid_custom_segment';
  end if;
  select * into v_platform from jsonb_to_recordset(v_options)
    as p(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) where p.id=v_id;
  if not found then raise exception using errcode='42501',message='platform_denied'; end if;
  if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_start>=v_end
    or (v_end at time zone v_platform.timezone)-(v_start at time zone v_platform.timezone)>interval '31 days'
    or v_offset<0 or v_limit not in (20,30,50,100,500)
    or (p_request ? 'offset' and coalesce(p_request->>'offset','0') !~ '^[0-9]+$')
    or (p_request ? 'limit' and coalesce(p_request->>'limit','20') !~ '^[0-9]+$')
    or v_min::text in ('NaN','Infinity','-Infinity') or v_max::text in ('NaN','Infinity','-Infinity')
    or v_min>v_max then raise exception using errcode='22023',message='invalid_range'; end if;
  v_direction:=coalesce(p_request->>'direction','all'); v_status:=coalesce(p_request->>'status','all');
  if v_direction not in ('all','charge','withdraw') or v_status<>'all' or v_offset<>0 then
    raise exception using errcode='22023',message='invalid_status_or_direction';
  end if;
  v_order:=nullif(btrim(p_request->>'orderNumber'),''); v_third:=nullif(btrim(p_request->>'thirdPartyOrderNumber'),''); v_member:=nullif(btrim(p_request->>'memberId'),'');
  v_system:=nullif(btrim(p_request->>'systemOrderId'),''); v_utr:=nullif(btrim(p_request->>'utr'),'');
  v_currency:=nullif(btrim(p_request->>'currency'),'');
  if (v_utr is not null and v_platform.source<>'wg') or (v_system is not null and v_platform.source<>'newar') or (v_third is not null and v_platform.source not in ('newar','game66','wg','kb')) then
    raise exception using errcode='22023',message='unsupported_filter';
  end if;
  foreach v_key in array array['providers','channelTypes'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb then
      if jsonb_typeof(p_request->v_key)<>'array' or jsonb_array_length(p_request->v_key)>2000 then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
      if exists(select 1 from jsonb_array_elements(p_request->v_key) a where jsonb_typeof(a)<>'string'
        or length(a#>>'{}') not between 1 and 200 or (a#>>'{}') ~ '[[:cntrl:]]') then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
    end if;
  end loop;
  if jsonb_typeof(p_request->'providers')='array' then select array_agg(value) into v_providers from jsonb_array_elements_text(p_request->'providers'); end if;
  if jsonb_typeof(p_request->'channelTypes')='array' then select array_agg(value) into v_types from jsonb_array_elements_text(p_request->'channelTypes'); end if;
  v_capabilities:=jsonb_build_object('systemOrderId',v_platform.source='newar','thirdPartyOrderNumber',v_platform.source in ('newar','game66'),'utr',false,'historicalFees',false,
    'timeBasis','created_for_all_and_non_success','successTimeBasis','success_at','successCohort','success_at_in_selected_range',
    'latencyBasis','success_at_to_created_at','customerPaymentTime',false,
    'pendingBasis','selected_created_cohort_current_stored_status','asOfBasis','query_time_not_source_snapshot',
    'sourceCompletenessVerified',false,'actualAmount',v_platform.source<>'ar','recordedFee',v_platform.source in ('newar','game66'));
  if v_platform.source='wg' then
    if v_status='success' and v_direction<>'charge' then
      raise exception using errcode='22023',message='unsupported_success_time_filter_for_wg_withdraw';
    end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_wg_capabilities(v_direction);
  end if;
  if v_platform.source='duoli' then
    v_capabilities:=v_capabilities||private.dashboard_admin_duoli_capabilities();
  end if;
  if v_platform.source='kb' then v_capabilities:=v_capabilities||private.dashboard_admin_yash_capabilities();end if;
  if v_platform.source='panda' then
    if v_member is not null then raise exception using errcode='22023',message='unsupported_member_filter_for_panda';end if;
    if v_status='success' then raise exception using errcode='22023',message='PANDA_SUCCESS_COVERAGE_UNAVAILABLE';end if;
    if v_kind='latency' then raise exception using errcode='22023',message='PANDA_SUCCESS_COVERAGE_UNAVAILABLE';end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_panda_capabilities(v_direction);
    v_panda_coverage:=private.dashboard_admin_panda_query_coverage(v_platform.source_name,v_direction,v_start,v_end);
    if v_action<>'details' and (v_panda_coverage->>'complete')::boolean is not true then raise exception using errcode='22023',message='PANDA_COVERAGE_INCOMPLETE';end if;
  end if;
  v_meta:=jsonb_build_object('id',v_platform.id,'name',v_platform.name,'source',v_platform.source,'sourceName',v_platform.source_name,
    'scopeGroup',v_platform.scope_group,'country',v_platform.country,'team',v_platform.team,
    'timezone',v_platform.timezone,'currency',v_platform.currency,'capabilities',v_capabilities);
  -- All branches project an explicit safe allowlist. No raw JSON, contact,
  -- account/UPI fields, comments, free text, or credentials are selected.
  if v_platform.source='ar' then
    -- Read the small, platform-scoped confirmation map once, outside the order scan.
    -- Optional for older installations; ordinary unknown records remain unknown.
    if to_regclass('private.dashboard_admin_order_provider_confirmations') is not null then
      execute 'select coalesce(jsonb_object_agg(order_kind||chr(31)||order_no,confirmed_provider),''{}''::jsonb)
        from private.dashboard_admin_order_provider_confirmations
        where source_system=$1 and country_code=$2 and platform=$3 and active'
        into v_confirmations using 'AR',v_platform.scope_group,v_platform.source_name;
    end if;
    v_source:=$q$
      select md5(jsonb_build_array(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no)::text)::uuid as id,
        null::text as system_order_id,a.order_no as order_number,null::text as third_party_order_number,a.member_id,
        case when a.order_kind='withdraw' and coalesce(btrim(a.raw_channel),'') in ('','人工取消')
          and a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消','失败','提现失败','出款失败') then '无三方（驳回）'
          else coalesce(nullif(btrim(a.raw_channel),''),$24->>(a.order_kind||chr(31)||a.order_no),'未识别通道') end as provider,
        coalesce(nullif(btrim(a.channel_type),''),'其他类型') as channel_type,
        case a.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,a.status,
        case when a.order_kind='recharge' then case a.status when '已支付' then 'success' when '待支付' then 'pending'
          when '已取消' then 'failed' else 'unknown' end
        else case when a.status='已通过' then 'success' when a.status='已提交' then 'pending'
          when a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消') then 'rejected'
          when a.status in ('失败','提现失败','出款失败') then case when coalesce(btrim(a.raw_channel),'') in ('','人工取消') then 'rejected' else 'failed' end
          else 'unknown' end end as status_group,
        a.applied_at at time zone $4 as created_at,
        case when (a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过')
          then a.completed_at at time zone $4 end as success_at,
        private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end)) as amount,
        null::numeric as actual_amount,null::numeric as withdraw_fee,$21::text as currency,a.updated_at as synced_at,null::text as utr,a.raw_channel as raw_provider
      from public.ar_collected_orders a where a.country_code=$3 and a.platform=$22 and a.source_system='AR'
        and a.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($25='latency'
            and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
            and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4))
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))))
        and ($9 is null or a.member_id=$9) and ($10 is null or a.order_no=$10)
    $q$;
    -- custom_ar_date_union_v1: latency already reads only its successful clock.
    if v_kind<>'latency' then
      if position($ar_guard$        and (($25='latency'
            and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
            and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4))
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))))$ar_guard$ in v_source)=0 then raise exception using errcode='55000',message='analytical_query_contract_drift';end if;
      v_source:=replace(v_source,$ar_old$        and (($25='latency'
            and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
            and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4))
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))))$ar_old$,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$);
      v_source:=v_source||' union all '||replace(v_source,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$,$ar_success$        and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
        and a.completed_at>=($5 at time zone $4) and a.completed_at<($6 at time zone $4)
        and (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)) is not true$ar_success$);
    end if;
  elsif v_platform.source='newar' then
    v_source:=$q$
      select n.id,n.source_id as system_order_id,n.order_number,n.third_party_order_number,n.member_id,
        case when n.dataset='charge' and coalesce(btrim(n.provider),'')='' and n.channel_type='ManualRecharge' then '人工充值'
          when n.dataset='withdraw' and n.status_group in ('failed','rejected') and coalesce(btrim(n.provider),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(n.provider),''),'未识别通道') end as provider,coalesce(nullif(btrim(n.channel_type),''),'其他类型') as channel_type,
        n.dataset as direction,n.status_code as status,
        case when n.dataset='withdraw' and n.status_group='failed' and coalesce(btrim(n.provider),'') in ('','人工取消') then 'rejected'
          when n.status_group in ('success','pending','failed','rejected') then n.status_group else 'unknown' end as status_group,
        n.created_at,case when n.status_group='success' then n.success_at end as success_at,
        n.amount,n.actual_amount,n.fee as withdraw_fee,n.currency,n.received_at as synced_at,null::text as utr,n.provider as raw_provider
      from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
      where n.platform=$22 and n.dataset=any(case $7 when 'all' then array['charge','withdraw'] else array[$7] end)
        and (($25='latency' and n.status_group='success' and n.success_at>=$5 and n.success_at<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and n.created_at>=$5 and n.created_at<$6)
          or (($19='aggregate' or $8='success') and (n.created_at>=$5 and n.created_at<$6
            or (n.status_group='success' and n.success_at is not null and n.success_at>=$5 and n.success_at<$6))))))
        and (t.launch_at is null or n.created_at>=t.launch_at)
        and ($9 is null or n.member_id=$9) and ($10 is null or n.order_number=$10)
        and ($23 is null or n.third_party_order_number=$23)
        and ($11 is null or n.source_id=$11)
    $q$;
  elsif v_platform.source='lg' then
    -- LG timestamps are already timestamptz; never reinterpret them as local
    -- timestamps or restrict paid events to the creation-day stat_date.
    v_source:=$q$
      select md5(jsonb_build_array('LG',l.country_code,l.platform,l.order_kind,l.order_no)::text)::uuid as id,
        null::text as system_order_id,l.order_no as order_number,null::text as third_party_order_number,l.member_id,
        coalesce(nullif(btrim(l.third_party),''),nullif(btrim(l.raw_channel),''),'未识别通道') as provider,
        coalesce(nullif(btrim(l.payment_method),''),'其他类型') as channel_type,
        case l.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,l.status_text as status,
        case when l.status_class in ('success','pending','rejected') then l.status_class else 'unknown' end as status_group,
        l.created_at,case when l.status_class='success' then l.paid_at end as success_at,
        l.metric_amount as amount,l.actual_amount,null::numeric as withdraw_fee,$21::text as currency,
        l.updated_at as synced_at,null::text as utr,l.raw_channel as raw_provider
      from public.lg_orders l
      where l.country_code=$3 and l.platform=$22 and l.source_system='LG'
        and l.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($25='latency' and l.status_class='success' and l.paid_at>=$5 and l.paid_at<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and l.created_at>=$5 and l.created_at<$6)
          or (($19='aggregate' or $8='success') and (l.created_at>=$5 and l.created_at<$6
            or (l.status_class='success' and l.paid_at is not null and l.paid_at>=$5 and l.paid_at<$6))))))
        and ($9 is null or l.member_id=$9) and ($10 is null or l.order_no=$10)
    $q$;
  elsif v_platform.source='panda' then
    v_source:=private.dashboard_admin_panda_order_source();
  elsif v_platform.source='kb' then
    v_source:=private.dashboard_admin_yash_order_source();
  elsif v_platform.source='duoli' then
    v_source:=private.dashboard_admin_duoli_order_source();
  elsif v_platform.source='wg' then
    v_source:=private.dashboard_admin_wg_order_source(v_utr,v_kind='latency');
  elsif v_platform.source='game66' then
    v_source:=$q$
      select c.id,null::text as system_order_id,c.order_num as order_number,c.out_trade_no as third_party_order_number,c.uid as member_id,
        coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') as provider,coalesce(nullif(btrim(c.pay_mode),''),'其他类型') as channel_type,
        'charge'::text as direction,coalesce(nullif(c.status_text,''),c.status_code) as status,
        case c.status_code when '1' then 'success' when '0' then
          case when c.status_group in ('pending','failed') then c.status_group else 'pending' end else 'unknown' end as status_group,
        c.create_time as created_at,case when c.status_code='1' then c.pay_time end as success_at,
        coalesce(c.amount_display,c.amount_minor/100.0) as amount,null::numeric as actual_amount,null::numeric as withdraw_fee,
        'INR'::text as currency,c.last_seen_at as synced_at,null::text as utr,c.pay_method_name as raw_provider
      from public.game66_charge_orders c where c.platform_id=$1 and $7 in ('all','charge')
        and (($25='latency' and c.status_code='1' and c.pay_time>=$5 and c.pay_time<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and c.create_time>=$5 and c.create_time<$6)
          or (($19='aggregate' or $8='success') and (c.create_time>=$5 and c.create_time<$6
            or (c.status_code='1' and c.pay_time is not null and c.pay_time>=$5 and c.pay_time<$6))))))
        and ($9 is null or c.uid=$9)
        and ($10 is null or c.order_num=$10) and ($23 is null or c.out_trade_no=$23)
      union all
      select w.id,null::text,w.order_num,w.out_trade_no,w.uid,
        case when w.status_code in ('2','-1') and coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'未识别通道') end,
        coalesce(nullif(btrim(w.payout_mode),''),'其他类型'),'withdraw',coalesce(nullif(w.status_text,''),w.status_code),
        case w.status_code when '3' then 'success' when '1' then 'pending' when '2' then case when coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then 'rejected' else 'failed' end when '-1' then 'rejected' else 'unknown' end,
        w.create_time,case when w.status_code='3' then w.update_time end,coalesce(w.amount_display,w.amount_minor/100.0),
        coalesce(w.real_amount_display,w.real_amount_minor/100.0),coalesce(w.fee_display,w.fee_minor/100.0),
        'INR',w.last_seen_at,null::text,coalesce(nullif(w.pay_channel,''),w.pay_method_name)
      from public.game66_withdraw_orders w where w.platform_id=$1 and $7 in ('all','withdraw')
        and (($25='latency' and w.status_code='3' and w.update_time>=$5 and w.update_time<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and w.create_time>=$5 and w.create_time<$6)
          or (($19='aggregate' or $8='success') and (w.create_time>=$5 and w.create_time<$6
            or (w.status_code='3' and w.update_time is not null and w.update_time>=$5 and w.update_time<$6))))))
        and ($9 is null or w.uid=$9)
        and ($10 is null or w.order_num=$10) and ($23 is null or w.out_trade_no=$23)
    $q$;
  else
    raise exception using errcode='22023',message='unsupported_source';
  end if;

  if v_platform.source='duoli' and v_kind='latency' then
    raise exception using errcode='22023',message='unsupported_payment_latency_for_duoli';
  end if;
  if v_kind='latency' then
    -- Materialize only latency inputs. Keep all successful-window candidates,
    -- including invalid durations and other bins, for independent denominators.
    v_prefix:='with orders as ('||v_source||$q$), filtered as materialized (
      select provider,direction,currency,
        case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,synced_at,
        (success_at at time zone $4)::date as success_local_date,
        case when status_group='success' and isfinite(created_at) and isfinite(success_at) and success_at>=created_at and success_at<=$20
          then extract(epoch from success_at-created_at)*1000 end as latency_ms
      from orders where ($12 is null or provider=any($12))
        and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
        and ($15 is null or amount>=$15) and ($16 is null or case when $37 then amount<$16 else amount<=$16 end)
    )
    $q$;
  else
    v_prefix:='with orders as ('||v_source||$q$), filtered as materialized (
    select provider,direction,currency,status_group,created_at,success_at,
      case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,synced_at,
      (created_at >= $5 and created_at < $6) as created_in_range,
      (status_group='success' and success_at >= $5 and success_at < $6) as success_in_range,
      (created_at at time zone $4)::date as local_date,
      extract(hour from created_at at time zone $4)::integer as local_hour,
      (success_at at time zone $4)::date as success_local_date,
      extract(hour from success_at at time zone $4)::integer as success_local_hour,
      case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount in (100,200,300,400,500,750,1000,1500,2000,5000) then trunc(amount)::text else 'other' end as amount_bucket,
      case when (case when direction='charge' then $31::numeric[] else $32::numeric[] end) is not null then case
        when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<(case when direction='charge' then $31::numeric[] else $32::numeric[] end)[1] then 'below'
        when amount>(case when direction='charge' then $31::numeric[] else $32::numeric[] end)[11] then 'above'
        else 'band:'||(least(width_bucket(amount,(case when direction='charge' then $31::numeric[] else $32::numeric[] end)),10)-1)::text end
        else case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<100 then 'other' when amount<=200 then '100–200'
        when amount<=300 then '201–300' when amount<=400 then '301–400'
        when amount<=500 then '401–500' when amount<=750 then '501–750'
        when amount<=1000 then '751–1,000' when amount<=2000 then '1,001–2,000'
        when amount<=5000 then '2,001–5,000' else '≥5,001' end end as amount_range_bucket,
      case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms
    from orders where ($12 is null or provider=any($12))
      and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
      and ($15 is null or amount>=$15) and ($16 is null or case when $37 then amount<$16 else amount<=$16 end)
  )
  $q$;
  end if;
  if v_kind='latency' then
    v_sql:=v_prefix||$q$, candidates as (
      select *,case when $33=2 then case when latency_ms<=60000 then 0 when latency_ms<=180000 then 1 when latency_ms<=300000 then 2 else (case when latency_ms<=300000 then 0 when latency_ms<=1800000 then 1
        when latency_ms<=3600000 then 2 when latency_ms<=10800000 then 3
        when latency_ms<=21600000 then 4 when latency_ms<=43200000 then 5
        when latency_ms<=86400000 then 6 when latency_ms<=172800000 then 7
        when latency_ms<=259200000 then 8 when latency_ms is not null then 9 end)+2 end else case when latency_ms<=300000 then 0 when latency_ms<=1800000 then 1
        when latency_ms<=3600000 then 2 when latency_ms<=10800000 then 3
        when latency_ms<=21600000 then 4 when latency_ms<=43200000 then 5
        when latency_ms<=86400000 then 6 when latency_ms<=172800000 then 7
        when latency_ms<=259200000 then 8 when latency_ms is not null then 9 end end as duration_bucket
      from filtered
    ), provider_names as materialized (
      -- Use the same authoritative mapping as the ordinary provider summary,
      -- once per distinct raw name, never once per order or once per day.
      select raw_provider,private.dashboard_admin_live_provider_canonical($30,$2,raw_provider) as provider
      from (select distinct provider as raw_provider from candidates) names
    ), selected as (
      select c.*,n.provider as canonical_provider,
        latency_ms is not null and case when $36 then ($34 is null or latency_ms>$34) and ($35 is null or latency_ms<=$35) when $29 then duration_bucket>$28 else duration_bucket=$28 end as segment_match
      from candidates c join provider_names n on n.raw_provider=c.provider
    ), metrics as (
      -- Group before selecting the segment: valid_* always includes every valid
      -- successful order for this provider/window, including other duration bins.
      select direction,currency,canonical_provider as provider,success_local_date as date,
        grouping(canonical_provider) as gp,grouping(success_local_date) as gd,
        count(*) filter(where segment_match) as count,
        case when count(*) filter(where segment_match and amount is null)=0
          then coalesce(sum(amount) filter(where segment_match),0) end as amount,
        count(latency_ms) as valid_count,
        case when count(*) filter(where latency_ms is not null and amount is null)=0
          then coalesce(sum(amount) filter(where latency_ms is not null),0) end as valid_amount,
        count(*) as candidate_count,count(*) filter(where latency_ms is null) as excluded_count,
        count(*) filter(where segment_match and amount is null) as missing_amount_count,max(synced_at) as latest_synced_at
      from selected group by grouping sets (
        (direction,currency),(direction,currency,success_local_date),
        (direction,currency,canonical_provider),(direction,currency,canonical_provider,success_local_date))
    ), output as (
      select date,gp,gd,(to_jsonb(m)-array['amount','valid_amount','gp','gd'])||jsonb_build_object(
        'amount',amount::text,'valid_amount',valid_amount::text,'success_count',count,'success_amount',amount::text,
        'bucket',$28,'cumulative',$29,'count_share',count::numeric/nullif(valid_count,0),
        'amount_share',case when valid_amount>0 then amount/valid_amount end)
        ||case when $36 then jsonb_build_object('min_ms',$34::numeric,'max_ms',$35::numeric) else '{}'::jsonb end as value from metrics m
    ) select jsonb_build_object(
      'summary',coalesce((select jsonb_agg(value-array['date','provider'] order by value->>'direction',value->>'currency') from output where gp=1 and gd=1),'[]'::jsonb),
      'groups',jsonb_build_object(
        'daily',coalesce((select jsonb_agg(value-'provider' order by date,value->>'direction',value->>'currency') from output where gp=1 and gd=0),'[]'::jsonb),
        'provider',coalesce((select jsonb_agg(value-'date' order by value->>'provider',value->>'direction',value->>'currency') from output where gp=0 and gd=1),'[]'::jsonb),
        'provider_daily',coalesce((select jsonb_agg(value order by date,value->>'provider',value->>'direction',value->>'currency') from output where gp=0 and gd=0),'[]'::jsonb)),
      'rows','[]'::jsonb)
    $q$;
  else
    v_sql:=v_prefix||$q$, segment as (
      select *,
        created_in_range and ($25 not in('hourly','matrix','matrix_range') or local_hour=$26)
          and ($25 not in('amount','matrix') or amount_bucket=$27)
          and ($25 not in('amount_range','matrix_range') or amount_range_bucket=$27)
          and ($25<>'custom' or (($38 is null or local_hour>=$38) and ($39 is null or local_hour<$39))) as created_match,
        success_in_range and ($25 not in('hourly','matrix','matrix_range') or success_local_hour=$26)
          and ($25 not in('amount','matrix') or amount_bucket=$27)
          and ($25 not in('amount_range','matrix_range') or amount_range_bucket=$27)
          and ($25<>'custom' or (($38 is null or success_local_hour>=$38) and ($39 is null or success_local_hour<$39))) as success_match
      from filtered
    ), provider_names as materialized (
      -- Map each distinct raw name once, before provider/day grouping.
      select raw_provider,private.dashboard_admin_live_provider_canonical($30,$2,raw_provider) as provider
      from (select distinct provider as raw_provider from segment where created_match or success_match) names
    ), selected as (
      select s.*,n.provider as canonical_provider from segment s
      join provider_names n on n.raw_provider=s.provider where s.created_match or s.success_match
    ), contributions as (
      -- Distinct event clocks: never copy a successful event into creation totals.
      select direction,currency,canonical_provider as provider,local_date as date,1::bigint as all_count,amount as all_amount,
        (amount is null)::integer as missing_amount_count,(amount<0)::integer as negative_amount_count,
        (status_group='success')::integer as created_success_count,0::bigint as success_count,0::numeric as success_amount,
        (status_group='pending')::integer as pending_count,case when status_group='pending' then amount else 0 end as pending_amount,
        (status_group='failed')::integer as failed_count,case when status_group='failed' then amount else 0 end as failed_amount,
        (status_group='rejected')::integer as rejected_count,case when status_group='rejected' then amount else 0 end as rejected_amount,
        (status_group='unknown')::integer as unknown_count,case when status_group='unknown' then amount else 0 end as unknown_amount,synced_at
      from selected where created_match
      union all
      select direction,currency,canonical_provider,success_local_date,0,0,0,0,0,1,amount,0,0,0,0,0,0,0,0,synced_at from selected where success_match
    ), metrics as (
      select direction,currency,provider,date,grouping(provider) as gp,grouping(date) as gd,sum(all_count)::bigint as all_count,
        case when bool_or(all_count>0 and all_amount is null) then null::numeric else coalesce(sum(all_amount),0) end as all_amount,
        sum(missing_amount_count)::bigint as missing_amount_count,coalesce(sum(negative_amount_count),0)::bigint as negative_amount_count,
        sum(created_success_count)::bigint as created_success_count,sum(success_count)::bigint as success_count,
        case when bool_or(success_count>0 and success_amount is null) then null::numeric else coalesce(sum(success_amount),0) end as success_amount,
        sum(pending_count)::bigint as pending_count,
        case when bool_or(pending_count>0 and pending_amount is null) then null::numeric else coalesce(sum(pending_amount),0) end as pending_amount,
        sum(failed_count)::bigint as failed_count,
        case when bool_or(failed_count>0 and failed_amount is null) then null::numeric else coalesce(sum(failed_amount),0) end as failed_amount,
        sum(rejected_count)::bigint as rejected_count,
        case when bool_or(rejected_count>0 and rejected_amount is null) then null::numeric else coalesce(sum(rejected_amount),0) end as rejected_amount,
        sum(unknown_count)::bigint as unknown_count,
        case when bool_or(unknown_count>0 and unknown_amount is null) then null::numeric else coalesce(sum(unknown_amount),0) end as unknown_amount,
        max(synced_at) as latest_synced_at
      from contributions group by grouping sets ((direction,currency),(direction,currency,date),
        (direction,currency,provider),(direction,currency,provider,date))
    ), output as (
      select date,gp,gd,(to_jsonb(m)-array['gp','gd','all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount'])||jsonb_build_object(
        'all_amount',all_amount::text,'success_amount',success_amount::text,'pending_amount',pending_amount::text,
        'failed_amount',failed_amount::text,'rejected_amount',rejected_amount::text,'unknown_amount',unknown_amount::text) as value from metrics m
    ) select jsonb_build_object(
      'summary',coalesce((select jsonb_agg(value-array['date','provider'] order by value->>'direction',value->>'currency') from output where gp=1 and gd=1),'[]'::jsonb),
      'groups',jsonb_build_object(
        'daily',coalesce((select jsonb_agg(value-'provider' order by date,value->>'direction',value->>'currency') from output where gp=1 and gd=0),'[]'::jsonb),
        'provider',coalesce((select jsonb_agg(value-'date' order by value->>'provider',value->>'direction',value->>'currency') from output where gp=0 and gd=1),'[]'::jsonb),
        'provider_daily',coalesce((select jsonb_agg(value order by date,value->>'provider',value->>'direction',value->>'currency') from output where gp=0 and gd=0),'[]'::jsonb)),
      'rows','[]'::jsonb)
    $q$;
  end if;
  if v_platform.source='duoli' then
    if (length(v_sql)-length(replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'')))/length($duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$)<>1 then
      raise exception 'duoli_payment_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'null::numeric as latency_ms');
  end if;
  if v_platform.source='panda' and coalesce(p_request->>'view','full')<>'providers' then
    if (length(v_sql)-length(replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'')))/length($panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$)<>1 then raise exception 'panda_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'null::numeric as latency_ms');
  end if;
  execute v_sql into v_result using v_id,case when v_platform.source in('lg','wg','duoli','kb','panda') then v_platform.source_name else v_platform.name end,v_platform.scope_group,v_platform.timezone,v_start,v_end,
    v_direction,v_status,v_member,v_order,v_system,v_providers,v_types,v_currency,v_min,v_max,v_offset,v_limit,v_action,v_asof,v_platform.currency,v_platform.source_name,v_third,v_confirmations,
    v_kind,v_hour,v_bucket_text,v_bucket,v_cumulative,v_platform.country,v_charge_edges,v_withdraw_edges,v_duration_version,v_duration_min,v_duration_max,v_duration_custom,v_max_exclusive,v_hour_min,v_hour_max;
  if v_platform.source='wg' then v_result:=private.dashboard_admin_wg_order_result(v_result,v_platform.scope_group,v_platform.source_name);end if;
  if v_platform.source='panda' then
    v_result:=private.dashboard_admin_panda_order_result(v_result)||jsonb_build_object('pandaCoverage',v_panda_coverage);
  end if;
  if v_platform.source='duoli' then v_result:=private.dashboard_admin_duoli_order_result(v_result);end if;
  v_result:=private.dashboard_admin_order_business_result(v_result,v_platform.source,v_platform.scope_group,v_platform.source_name,v_platform.id);
  return v_result||case when v_duration_version=2 then jsonb_build_object('durationVersion',2)
      ||case when v_duration_custom then jsonb_build_object('durationRange',v_duration->'range') else '{}'::jsonb end else '{}'::jsonb end
    ||case when v_amount_bands is null then '{}'::jsonb else jsonb_build_object('amountBands',v_amount_bands,'amountBandsVersion',1) end
    ||jsonb_build_object('version',1,'platform',v_meta,'basis',case when v_kind='latency' then 'success_at' else 'mixed_created_success' end,
    'total',(select coalesce(sum((r->>case when v_kind='latency' then 'count' else 'all_count' end)::bigint),0) from jsonb_array_elements(v_result->'summary') r),
    'startAt',v_start,'endAt',v_end,'asOf',v_asof,'complete',true,'hasMore',false,
    'segment',jsonb_strip_nulls(jsonb_build_object('durationRange',case when v_duration_custom then v_duration->'range' end,'durationVersion',case when v_duration_version=2 then 2 end,'kind',v_kind,'hour',v_hour,'hourRange',v_hour_range,'amountMin',case when v_kind='custom' then v_min end,'amountMax',case when v_kind='custom' then v_max end,'amountMaxExclusive',case when v_kind='custom' and v_max is not null then v_max_exclusive end,'bucket',case when v_kind='latency' then to_jsonb(v_bucket) else to_jsonb(v_bucket_text) end,'cumulative',v_cumulative)),
    'capabilities',v_capabilities);
end;
$function$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_live_analysis_orders_raw(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare
  v_basis text; v_action text; v_options jsonb; v_platform record; v_meta jsonb; v_capabilities jsonb; v_panda_coverage jsonb;
  v_id uuid; v_start timestamptz; v_end timestamptz; v_asof timestamptz := statement_timestamp();
  v_direction text; v_status text; v_order text; v_third text; v_member text; v_system text; v_utr text;
  v_providers text[]; v_types text[]; v_currency text; v_min numeric; v_max numeric;
  v_offset integer; v_limit integer; v_key text; v_source text; v_sql text; v_result jsonb;
  v_confirmations jsonb := '{}'::jsonb;
  -- custom_analysis_ranges_v1: isolated hour/amount segment, no re-bucketing.
  v_max_exclusive boolean:=false;v_hour_min integer;v_hour_max integer;v_hour_range jsonb;
  -- duration_precision_ranges_v2: parse once, use bound numeric parameters.
  v_duration jsonb;v_duration_version integer;v_duration_min numeric;v_duration_max numeric;v_duration_custom boolean;
  -- dynamic_amount_bands_v1: validate/parse once, never once per order.
  v_amount_bands jsonb; v_charge_edges numeric[]; v_withdraw_edges numeric[];
  v_kind text; v_hour integer; v_bucket_text text; v_bucket integer; v_cumulative boolean; v_prefix text;
begin
 -- duoli_existing_orders_v1
 -- wg_existing_orders_v1
  -- Catalog helper validates Auth, active profile, independent grant and scope
  -- on every call, including queries with no matching orders.
  select coalesce(jsonb_agg(to_jsonb(p) order by p.scope_group,p.name,p.source),'[]'::jsonb)
    into v_options from private.dashboard_admin_live_platforms() p;
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>32768
    or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
      'action','platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId',
      'utr','providers','channelTypes','currency','amountMin','amountMax','amountMaxExclusive','hourRange','amountBands','durationVersion','durationRange','offset','limit','basis','kind','hour','bucket','cumulative'])) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  v_action:=coalesce(p_request->>'action','catalog');
  v_duration:=private.dashboard_admin_validate_duration(p_request||jsonb_build_object('action','aggregate','view','drilldown'));
  v_duration_version:=(v_duration->>'version')::integer;
  v_duration_min:=(v_duration->>'min_ms')::numeric;v_duration_max:=(v_duration->>'max_ms')::numeric;
  v_duration_custom:=coalesce((v_duration->>'custom')::boolean,false);
  v_amount_bands:=private.dashboard_admin_validate_amount_bands(p_request->'amountBands',coalesce(p_request->>'direction','all'));
  select array_agg(value::numeric order by ordinality) into v_charge_edges
    from jsonb_array_elements_text(v_amount_bands->'charge') with ordinality;
  select array_agg(value::numeric order by ordinality) into v_withdraw_edges
    from jsonb_array_elements_text(v_amount_bands->'withdraw') with ordinality;
  v_basis:=p_request->>'basis';
  if v_action<>'analysisOrders' or jsonb_typeof(p_request->'basis') is distinct from 'string'
    or v_basis not in ('created','success') then
    raise exception using errcode='22023',message='invalid_analysis_orders_basis';
  end if;
  -- Keep the independent creation/success source union. The final cohort below
  -- chooses exactly one clock, including success events created on another day.
  v_action:='aggregate';
  v_kind:=p_request->>'kind';
  if jsonb_typeof(p_request->'kind') is distinct from 'string' or v_kind not in('hourly','amount','amount_range','matrix','matrix_range','latency','custom') then
    raise exception using errcode='22023',message='invalid_drilldown_kind';
  end if;
  if v_kind in('hourly','matrix','matrix_range') then
    if jsonb_typeof(p_request->'hour') is distinct from 'number' or p_request->>'hour' !~ '^[0-9]{1,2}$' then
      raise exception using errcode='22023',message='invalid_drilldown_hour';end if;
    v_hour:=(p_request->>'hour')::integer;
    if v_hour not between 0 and 23 then raise exception using errcode='22023',message='invalid_drilldown_hour';end if;
  elsif p_request?'hour' then raise exception using errcode='22023',message='unexpected_drilldown_hour';end if;
  if v_kind='latency' then
    if v_duration_custom then
      v_bucket:=null;v_cumulative:=false;
    else
      if jsonb_typeof(p_request->'bucket') is distinct from 'number' or p_request->>'bucket' !~ '^[0-9]{1,2}$' then
        raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
      v_bucket:=(p_request->>'bucket')::integer;
      if v_bucket not between 0 and (case when v_duration_version=2 then 11 else 9 end) then
        raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
      if p_request?'cumulative' and jsonb_typeof(p_request->'cumulative') is distinct from 'boolean' then
        raise exception using errcode='22023',message='invalid_drilldown_cumulative';end if;
      v_cumulative:=coalesce((p_request->>'cumulative')::boolean,false);
      if v_cumulative and v_bucket=(case when v_duration_version=2 then 11 else 9 end) then
        raise exception using errcode='22023',message='invalid_drilldown_threshold';end if;
    end if;
  else
    if p_request?'cumulative' then raise exception using errcode='22023',message='unexpected_drilldown_cumulative';end if;
    if v_kind not in('hourly','custom') then
      if jsonb_typeof(p_request->'bucket') is distinct from 'string' then raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
      v_bucket_text:=p_request->>'bucket';
      if (v_kind in('amount','matrix') and v_bucket_text not in('100','200','300','400','500','750','1000','1500','2000','5000','other','unknown'))
        or (v_kind in('amount_range','matrix_range') and (
          (v_amount_bands is null and v_bucket_text not in('100–200','201–300','301–400','401–500','501–750','751–1,000','1,001–2,000','2,001–5,000','≥5,001','other','unknown'))
          or (v_amount_bands is not null and v_bucket_text !~ '^(band:[0-9]|below|above|unknown)$'))) then
        raise exception using errcode='22023',message='invalid_drilldown_bucket';end if;
    elsif p_request?'bucket' then raise exception using errcode='22023',message='unexpected_drilldown_bucket';end if;
  end if;
  foreach v_key in array array['platformId','startAt','endAt','direction','status','orderNumber','thirdPartyOrderNumber','memberId','systemOrderId','utr','currency'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb and
      (jsonb_typeof(p_request->v_key)<>'string' or length(p_request->>v_key)>200 or p_request->>v_key ~ '[[:cntrl:]]') then
      raise exception using errcode='22023',message='invalid_filter';
    end if;
  end loop;
  begin
    v_id:=(p_request->>'platformId')::uuid;
    if coalesce(p_request->>'startAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$'
      or coalesce(p_request->>'endAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      raise exception using errcode='22023',message='invalid_time';
    end if;
    v_start:=(p_request->>'startAt')::timestamptz; v_end:=(p_request->>'endAt')::timestamptz;
    v_offset:=coalesce((p_request->>'offset')::integer,0); v_limit:=coalesce((p_request->>'limit')::integer,20);
    v_min:=nullif(p_request->>'amountMin','')::numeric; v_max:=nullif(p_request->>'amountMax','')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='invalid_filter';
  end;
  if p_request?'hourRange' then
    if v_kind<>'custom' or jsonb_typeof(p_request->'hourRange') is distinct from 'object' then
      raise exception using errcode='22023',message='invalid_hour_range';
    end if;
    v_hour_range:=p_request->'hourRange';
    if exists(select 1 from jsonb_object_keys(v_hour_range) k where k<>all(array['minHour','maxHour']))
      or jsonb_typeof(v_hour_range->'minHour') is distinct from 'number'
      or jsonb_typeof(v_hour_range->'maxHour') is distinct from 'number'
      or coalesce(v_hour_range->>'minHour','')!~ '^[0-9]{1,2}$'
      or coalesce(v_hour_range->>'maxHour','')!~ '^[0-9]{1,2}$' then
      raise exception using errcode='22023',message='invalid_hour_range';
    end if;
    v_hour_min:=(v_hour_range->>'minHour')::integer;v_hour_max:=(v_hour_range->>'maxHour')::integer;
    if v_hour_min not between 0 and 23 or v_hour_max not between 1 and 24 or v_hour_min>=v_hour_max then
      raise exception using errcode='22023',message='invalid_hour_range';
    end if;
  end if;
  if p_request?'amountMaxExclusive' then
    if v_kind<>'custom' or jsonb_typeof(p_request->'amountMaxExclusive') is distinct from 'boolean'
      or v_max is null then
      raise exception using errcode='22023',message='invalid_amount_max_exclusive';
    end if;
    v_max_exclusive:=(p_request->>'amountMaxExclusive')::boolean;
    if v_max_exclusive and v_min>=v_max then raise exception using errcode='22023',message='invalid_range';end if;
  end if;
  if v_kind='custom' and (v_min<0 or v_max<0 or (v_hour_range is null and v_min is null and v_max is null)) then
    raise exception using errcode='22023',message='invalid_custom_segment';
  end if;
  select * into v_platform from jsonb_to_recordset(v_options)
    as p(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) where p.id=v_id;
  if not found then raise exception using errcode='42501',message='platform_denied'; end if;
  if v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end) or v_start>=v_end
    or (v_end at time zone v_platform.timezone)-(v_start at time zone v_platform.timezone)>interval '31 days'
    or v_offset<0 or v_limit<>20
    or (p_request ? 'offset' and coalesce(p_request->>'offset','0') !~ '^[0-9]+$')
    or (p_request ? 'limit' and coalesce(p_request->>'limit','20') !~ '^[0-9]+$')
    or v_min::text in ('NaN','Infinity','-Infinity') or v_max::text in ('NaN','Infinity','-Infinity')
    or v_min>v_max then raise exception using errcode='22023',message='invalid_range'; end if;
  v_direction:=coalesce(p_request->>'direction','all'); v_status:=coalesce(p_request->>'status','all');
  if v_direction not in ('all','charge','withdraw') or v_status<>'all' then
    raise exception using errcode='22023',message='invalid_status_or_direction';
  end if;
  v_order:=nullif(btrim(p_request->>'orderNumber'),''); v_third:=nullif(btrim(p_request->>'thirdPartyOrderNumber'),''); v_member:=nullif(btrim(p_request->>'memberId'),'');
  v_system:=nullif(btrim(p_request->>'systemOrderId'),''); v_utr:=nullif(btrim(p_request->>'utr'),'');
  v_currency:=nullif(btrim(p_request->>'currency'),'');
  if (v_utr is not null and v_platform.source<>'wg') or (v_system is not null and v_platform.source<>'newar') or (v_third is not null and v_platform.source not in ('newar','game66','wg','kb')) then
    raise exception using errcode='22023',message='unsupported_filter';
  end if;
  foreach v_key in array array['providers','channelTypes'] loop
    if p_request ? v_key and p_request->v_key<>'null'::jsonb then
      if jsonb_typeof(p_request->v_key)<>'array' or jsonb_array_length(p_request->v_key)>2000 then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
      if exists(select 1 from jsonb_array_elements(p_request->v_key) a where jsonb_typeof(a)<>'string'
        or length(a#>>'{}') not between 1 and 200 or (a#>>'{}') ~ '[[:cntrl:]]') then
        raise exception using errcode='22023',message='invalid_filter';
      end if;
    end if;
  end loop;
  if jsonb_typeof(p_request->'providers')='array' then select array_agg(value) into v_providers from jsonb_array_elements_text(p_request->'providers'); end if;
  if jsonb_typeof(p_request->'channelTypes')='array' then select array_agg(value) into v_types from jsonb_array_elements_text(p_request->'channelTypes'); end if;
  v_capabilities:=jsonb_build_object('systemOrderId',v_platform.source='newar','thirdPartyOrderNumber',v_platform.source in ('newar','game66'),'utr',false,'historicalFees',false,
    'timeBasis','created_for_all_and_non_success','successTimeBasis','success_at','successCohort','success_at_in_selected_range',
    'latencyBasis','success_at_to_created_at','customerPaymentTime',false,
    'pendingBasis','selected_created_cohort_current_stored_status','asOfBasis','query_time_not_source_snapshot',
    'sourceCompletenessVerified',false,'actualAmount',v_platform.source<>'ar','recordedFee',v_platform.source in ('newar','game66'));
  if v_platform.source='wg' then
    if v_status='success' and v_direction<>'charge' then
      raise exception using errcode='22023',message='unsupported_success_time_filter_for_wg_withdraw';
    end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_wg_capabilities(v_direction);
  end if;
  if v_platform.source='duoli' then
    v_capabilities:=v_capabilities||private.dashboard_admin_duoli_capabilities();
  end if;
  if v_platform.source='kb' then v_capabilities:=v_capabilities||private.dashboard_admin_yash_capabilities();end if;
  if v_platform.source='panda' then
    if v_member is not null then raise exception using errcode='22023',message='unsupported_member_filter_for_panda';end if;
    if v_status='success' then raise exception using errcode='22023',message='PANDA_SUCCESS_COVERAGE_UNAVAILABLE';end if;
    if v_basis='success' or v_kind='latency' then raise exception using errcode='22023',message='PANDA_SUCCESS_COVERAGE_UNAVAILABLE';end if;
    v_capabilities:=v_capabilities||private.dashboard_admin_panda_capabilities(v_direction);
    v_panda_coverage:=private.dashboard_admin_panda_query_coverage(v_platform.source_name,v_direction,v_start,v_end);
    if v_action<>'details' and (v_panda_coverage->>'complete')::boolean is not true then raise exception using errcode='22023',message='PANDA_COVERAGE_INCOMPLETE';end if;
  end if;
  v_meta:=jsonb_build_object('id',v_platform.id,'name',v_platform.name,'source',v_platform.source,'sourceName',v_platform.source_name,
    'scopeGroup',v_platform.scope_group,'country',v_platform.country,'team',v_platform.team,
    'timezone',v_platform.timezone,'currency',v_platform.currency,'capabilities',v_capabilities);
  -- All branches project an explicit safe allowlist. No raw JSON, contact,
  -- account/UPI fields, comments, free text, or credentials are selected.
  if v_platform.source='ar' then
    -- Read the small, platform-scoped confirmation map once, outside the order scan.
    -- Optional for older installations; ordinary unknown records remain unknown.
    if to_regclass('private.dashboard_admin_order_provider_confirmations') is not null then
      execute 'select coalesce(jsonb_object_agg(order_kind||chr(31)||order_no,confirmed_provider),''{}''::jsonb)
        from private.dashboard_admin_order_provider_confirmations
        where source_system=$1 and country_code=$2 and platform=$3 and active'
        into v_confirmations using 'AR',v_platform.scope_group,v_platform.source_name;
    end if;
    v_source:=$q$
      select md5(jsonb_build_array(a.source_system,a.country_code,a.platform,a.order_kind,a.order_no)::text)::uuid as id,
        null::text as system_order_id,a.order_no as order_number,null::text as third_party_order_number,a.member_id,
        case when a.order_kind='withdraw' and coalesce(btrim(a.raw_channel),'') in ('','人工取消')
          and a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消','失败','提现失败','出款失败') then '无三方（驳回）'
          else coalesce(nullif(btrim(a.raw_channel),''),$24->>(a.order_kind||chr(31)||a.order_no),'未识别通道') end as provider,
        coalesce(nullif(btrim(a.channel_type),''),'其他类型') as channel_type,
        case a.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,a.status,
        case when a.order_kind='recharge' then case a.status when '已支付' then 'success' when '待支付' then 'pending'
          when '已取消' then 'failed' else 'unknown' end
        else case when a.status='已通过' then 'success' when a.status='已提交' then 'pending'
          when a.status in ('未通过','拒绝','驳回','已拒绝','人工取消','已取消') then 'rejected'
          when a.status in ('失败','提现失败','出款失败') then case when coalesce(btrim(a.raw_channel),'') in ('','人工取消') then 'rejected' else 'failed' end
          else 'unknown' end end as status_group,
        a.applied_at at time zone $4 as created_at,
        case when (a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过')
          then a.completed_at at time zone $4 end as success_at,
        private.dashboard_admin_ar_local_amount(a.country_code,a.order_kind,a.channel_type,a.money_format_version,a.amount_local,a.currency_local,a.money_issue_code,coalesce(a.amount,case
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel)='人工充值'
            and length(btrim(a.amount_text))<=24 and btrim(a.amount_text) ~ '^-[0-9]+([.][0-9]+)?$' then btrim(a.amount_text)::numeric
          when a.country_code='IN' and a.order_kind='recharge' and btrim(a.raw_channel) ~ '^USDT[(]TRC20[)]-[0-9]+$'
            and length(a.amount_text)<=250 then substring(replace(a.amount_text,chr(92)||'n',chr(10)) from
            '^[[:space:]]*金额[：:][[:space:]]*([0-9]{1,18}([.][0-9]{1,8})?)[[:space:]]+兑换比例[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]+USDT[：:][[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$')::numeric end)) as amount,
        null::numeric as actual_amount,null::numeric as withdraw_fee,$21::text as currency,a.updated_at as synced_at,null::text as utr,a.raw_channel as raw_provider
      from public.ar_collected_orders a where a.country_code=$3 and a.platform=$22 and a.source_system='AR'
        and a.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($25='latency'
            and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
            and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4))
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))))
        and ($9 is null or a.member_id=$9) and ($10 is null or a.order_no=$10)
    $q$;
    -- custom_ar_date_union_v1: latency already reads only its successful clock.
    if v_kind<>'latency' then
      if position($ar_guard$        and (($25='latency'
            and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
            and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4))
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))))$ar_guard$ in v_source)=0 then raise exception using errcode='55000',message='analytical_query_contract_drift';end if;
      v_source:=replace(v_source,$ar_old$        and (($25='latency'
            and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
            and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4))
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
          or (($19='aggregate' or $8='success') and (
            (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4))
            or (((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
              and a.completed_at is not null
              and a.completed_at >= ($5 at time zone $4) and a.completed_at < ($6 at time zone $4)))))))$ar_old$,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$);
      v_source:=v_source||' union all '||replace(v_source,$ar_created$        and a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)$ar_created$,$ar_success$        and ((a.order_kind='recharge' and a.status='已支付') or (a.order_kind='withdraw' and a.status='已通过'))
        and a.completed_at>=($5 at time zone $4) and a.completed_at<($6 at time zone $4)
        and (a.applied_at>=($5 at time zone $4) and a.applied_at<($6 at time zone $4)) is not true$ar_success$);
    end if;
  elsif v_platform.source='newar' then
    v_source:=$q$
      select n.id,n.source_id as system_order_id,n.order_number,n.third_party_order_number,n.member_id,
        case when n.dataset='charge' and coalesce(btrim(n.provider),'')='' and n.channel_type='ManualRecharge' then '人工充值'
          when n.dataset='withdraw' and n.status_group in ('failed','rejected') and coalesce(btrim(n.provider),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(n.provider),''),'未识别通道') end as provider,coalesce(nullif(btrim(n.channel_type),''),'其他类型') as channel_type,
        n.dataset as direction,n.status_code as status,
        case when n.dataset='withdraw' and n.status_group='failed' and coalesce(btrim(n.provider),'') in ('','人工取消') then 'rejected'
          when n.status_group in ('success','pending','failed','rejected') then n.status_group else 'unknown' end as status_group,
        n.created_at,case when n.status_group='success' then n.success_at end as success_at,
        n.amount,n.actual_amount,n.fee as withdraw_fee,n.currency,n.received_at as synced_at,null::text as utr,n.provider as raw_provider
      from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
      where n.platform=$22 and n.dataset=any(case $7 when 'all' then array['charge','withdraw'] else array[$7] end)
        and (($25='latency' and n.status_group='success' and n.success_at>=$5 and n.success_at<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and n.created_at>=$5 and n.created_at<$6)
          or (($19='aggregate' or $8='success') and (n.created_at>=$5 and n.created_at<$6
            or (n.status_group='success' and n.success_at is not null and n.success_at>=$5 and n.success_at<$6))))))
        and (t.launch_at is null or n.created_at>=t.launch_at)
        and ($9 is null or n.member_id=$9) and ($10 is null or n.order_number=$10)
        and ($23 is null or n.third_party_order_number=$23)
        and ($11 is null or n.source_id=$11)
    $q$;
  elsif v_platform.source='lg' then
    -- LG timestamps are already timestamptz; never reinterpret them as local
    -- timestamps or restrict paid events to the creation-day stat_date.
    v_source:=$q$
      select md5(jsonb_build_array('LG',l.country_code,l.platform,l.order_kind,l.order_no)::text)::uuid as id,
        null::text as system_order_id,l.order_no as order_number,null::text as third_party_order_number,l.member_id,
        coalesce(nullif(btrim(l.third_party),''),nullif(btrim(l.raw_channel),''),'未识别通道') as provider,
        coalesce(nullif(btrim(l.payment_method),''),'其他类型') as channel_type,
        case l.order_kind when 'recharge' then 'charge' else 'withdraw' end as direction,l.status_text as status,
        case when l.status_class in ('success','pending','rejected') then l.status_class else 'unknown' end as status_group,
        l.created_at,case when l.status_class='success' then l.paid_at end as success_at,
        l.metric_amount as amount,l.actual_amount,null::numeric as withdraw_fee,$21::text as currency,
        l.updated_at as synced_at,null::text as utr,l.raw_channel as raw_provider
      from public.lg_orders l
      where l.country_code=$3 and l.platform=$22 and l.source_system='LG'
        and l.order_kind=any(case $7 when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
        and (($25='latency' and l.status_class='success' and l.paid_at>=$5 and l.paid_at<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and l.created_at>=$5 and l.created_at<$6)
          or (($19='aggregate' or $8='success') and (l.created_at>=$5 and l.created_at<$6
            or (l.status_class='success' and l.paid_at is not null and l.paid_at>=$5 and l.paid_at<$6))))))
        and ($9 is null or l.member_id=$9) and ($10 is null or l.order_no=$10)
    $q$;
  elsif v_platform.source='panda' then
    v_source:=private.dashboard_admin_panda_order_source();
  elsif v_platform.source='kb' then
    v_source:=private.dashboard_admin_yash_order_source();
  elsif v_platform.source='duoli' then
    v_source:=private.dashboard_admin_duoli_order_source();
  elsif v_platform.source='wg' then
    v_source:=private.dashboard_admin_wg_order_source(v_utr,v_kind='latency');
  elsif v_platform.source='game66' then
    v_source:=$q$
      select c.id,null::text as system_order_id,c.order_num as order_number,c.out_trade_no as third_party_order_number,c.uid as member_id,
        coalesce(nullif(btrim(c.pay_method_name),''),'未识别通道') as provider,coalesce(nullif(btrim(c.pay_mode),''),'其他类型') as channel_type,
        'charge'::text as direction,coalesce(nullif(c.status_text,''),c.status_code) as status,
        case c.status_code when '1' then 'success' when '0' then
          case when c.status_group in ('pending','failed') then c.status_group else 'pending' end else 'unknown' end as status_group,
        c.create_time as created_at,case when c.status_code='1' then c.pay_time end as success_at,
        coalesce(c.amount_display,c.amount_minor/100.0) as amount,null::numeric as actual_amount,null::numeric as withdraw_fee,
        'INR'::text as currency,c.last_seen_at as synced_at,null::text as utr,c.pay_method_name as raw_provider
      from public.game66_charge_orders c where c.platform_id=$1 and $7 in ('all','charge')
        and (($25='latency' and c.status_code='1' and c.pay_time>=$5 and c.pay_time<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and c.create_time>=$5 and c.create_time<$6)
          or (($19='aggregate' or $8='success') and (c.create_time>=$5 and c.create_time<$6
            or (c.status_code='1' and c.pay_time is not null and c.pay_time>=$5 and c.pay_time<$6))))))
        and ($9 is null or c.uid=$9)
        and ($10 is null or c.order_num=$10) and ($23 is null or c.out_trade_no=$23)
      union all
      select w.id,null::text,w.order_num,w.out_trade_no,w.uid,
        case when w.status_code in ('2','-1') and coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then '无三方（驳回）'
          else coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'未识别通道') end,
        coalesce(nullif(btrim(w.payout_mode),''),'其他类型'),'withdraw',coalesce(nullif(w.status_text,''),w.status_code),
        case w.status_code when '3' then 'success' when '1' then 'pending' when '2' then case when coalesce(nullif(btrim(w.pay_channel),''),nullif(btrim(w.pay_method_name),''),'') in ('','人工取消') then 'rejected' else 'failed' end when '-1' then 'rejected' else 'unknown' end,
        w.create_time,case when w.status_code='3' then w.update_time end,coalesce(w.amount_display,w.amount_minor/100.0),
        coalesce(w.real_amount_display,w.real_amount_minor/100.0),coalesce(w.fee_display,w.fee_minor/100.0),
        'INR',w.last_seen_at,null::text,coalesce(nullif(w.pay_channel,''),w.pay_method_name)
      from public.game66_withdraw_orders w where w.platform_id=$1 and $7 in ('all','withdraw')
        and (($25='latency' and w.status_code='3' and w.update_time>=$5 and w.update_time<$6)
          or ($25<>'latency' and (($19<>'aggregate' and $8<>'success' and w.create_time>=$5 and w.create_time<$6)
          or (($19='aggregate' or $8='success') and (w.create_time>=$5 and w.create_time<$6
            or (w.status_code='3' and w.update_time is not null and w.update_time>=$5 and w.update_time<$6))))))
        and ($9 is null or w.uid=$9)
        and ($10 is null or w.order_num=$10) and ($23 is null or w.out_trade_no=$23)
    $q$;
  else
    raise exception using errcode='22023',message='unsupported_source';
  end if;

  if v_kind='latency' and v_basis<>'success' then
    raise exception using errcode='22023',message='invalid_analysis_orders_basis';
  end if;
  if v_platform.source='duoli' and v_kind='latency' then
    raise exception using errcode='22023',message='unsupported_payment_latency_for_duoli';
  end if;
  if v_platform.source='wg' and v_basis='success' and v_direction<>'charge' then
    raise exception using errcode='22023',message='unsupported_success_time_filter_for_wg_withdraw';
  end if;
  if v_kind='latency' then
    -- Materialize only latency inputs. Keep all successful-window candidates,
    -- including invalid durations and other bins, for independent denominators.
    v_prefix:='with orders as ('||v_source||$q$), filtered as materialized (
      select id,system_order_id,order_number,third_party_order_number,member_id,raw_provider,channel_type,status,status_group,created_at,success_at,actual_amount,withdraw_fee,utr,provider,direction,currency,
        case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,synced_at,
        (success_at at time zone $4)::date as success_local_date,
        case when status_group='success' and isfinite(created_at) and isfinite(success_at) and success_at>=created_at and success_at<=$20
          then extract(epoch from success_at-created_at)*1000 end as latency_ms
      from orders where ($12 is null or provider=any($12))
        and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
        and ($15 is null or amount>=$15) and ($16 is null or case when $37 then amount<$16 else amount<=$16 end)
    )
    $q$;
  else
    v_prefix:='with orders as ('||v_source||$q$), filtered as materialized (
    select id,system_order_id,order_number,third_party_order_number,member_id,raw_provider,channel_type,status,actual_amount,withdraw_fee,utr,provider,direction,currency,status_group,created_at,success_at,
      case when amount::text not in ('NaN','Infinity','-Infinity') then amount end as amount,synced_at,
      (created_at >= $5 and created_at < $6) as created_in_range,
      (status_group='success' and success_at >= $5 and success_at < $6) as success_in_range,
      (created_at at time zone $4)::date as local_date,
      extract(hour from created_at at time zone $4)::integer as local_hour,
      (success_at at time zone $4)::date as success_local_date,
      extract(hour from success_at at time zone $4)::integer as success_local_hour,
      case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount in (100,200,300,400,500,750,1000,1500,2000,5000) then trunc(amount)::text else 'other' end as amount_bucket,
      case when (case when direction='charge' then $31::numeric[] else $32::numeric[] end) is not null then case
        when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<(case when direction='charge' then $31::numeric[] else $32::numeric[] end)[1] then 'below'
        when amount>(case when direction='charge' then $31::numeric[] else $32::numeric[] end)[11] then 'above'
        else 'band:'||(least(width_bucket(amount,(case when direction='charge' then $31::numeric[] else $32::numeric[] end)),10)-1)::text end
        else case when amount is null or amount::text in ('NaN','Infinity','-Infinity') then 'unknown'
        when amount<100 then 'other' when amount<=200 then '100–200'
        when amount<=300 then '201–300' when amount<=400 then '301–400'
        when amount<=500 then '401–500' when amount<=750 then '501–750'
        when amount<=1000 then '751–1,000' when amount<=2000 then '1,001–2,000'
        when amount<=5000 then '2,001–5,000' else '≥5,001' end end as amount_range_bucket,
      case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms
    from orders where ($12 is null or provider=any($12))
      and ($13 is null or channel_type=any($13)) and ($14 is null or currency=$14)
      and ($15 is null or amount>=$15) and ($16 is null or case when $37 then amount<$16 else amount<=$16 end)
  )
  $q$;
  end if;
  -- analysis_segment_orders_v1: stable source keys, numeric money, exact count.
  if v_kind='latency' then
    v_sql:=v_prefix||$q$, candidates as (
      select *,case when $33=2 then case when latency_ms<=60000 then 0 when latency_ms<=180000 then 1 when latency_ms<=300000 then 2 else (case when latency_ms<=300000 then 0 when latency_ms<=1800000 then 1
        when latency_ms<=3600000 then 2 when latency_ms<=10800000 then 3
        when latency_ms<=21600000 then 4 when latency_ms<=43200000 then 5
        when latency_ms<=86400000 then 6 when latency_ms<=172800000 then 7
        when latency_ms<=259200000 then 8 when latency_ms is not null then 9 end)+2 end else case when latency_ms<=300000 then 0 when latency_ms<=1800000 then 1
        when latency_ms<=3600000 then 2 when latency_ms<=10800000 then 3
        when latency_ms<=21600000 then 4 when latency_ms<=43200000 then 5
        when latency_ms<=86400000 then 6 when latency_ms<=172800000 then 7
        when latency_ms<=259200000 then 8 when latency_ms is not null then 9 end end as duration_bucket
      from filtered
    ), provider_names as materialized (
      -- Use the same authoritative mapping as the ordinary provider summary,
      -- once per distinct raw name, never once per order or once per day.
      select raw_provider,private.dashboard_admin_live_provider_canonical($30,$2,raw_provider) as provider
      from (select distinct provider as raw_provider from candidates) names
    ), selected as (
      select c.*,n.provider as canonical_provider,
        latency_ms is not null and case when $36 then ($34 is null or latency_ms>$34) and ($35 is null or latency_ms<=$35) when $29 then duration_bucket>$28 else duration_bucket=$28 end as segment_match
      from candidates c join provider_names n on n.raw_provider=c.provider
    ), eligible as materialized (
      select * from selected where segment_match
    )
    $q$;
  else
    v_sql:=v_prefix||$q$, segment as (
      select *,
        created_in_range and ($25 not in('hourly','matrix','matrix_range') or local_hour=$26)
          and ($25 not in('amount','matrix') or amount_bucket=$27)
          and ($25 not in('amount_range','matrix_range') or amount_range_bucket=$27)
          and ($25<>'custom' or (($38 is null or local_hour>=$38) and ($39 is null or local_hour<$39))) as created_match,
        success_in_range and ($25 not in('hourly','matrix','matrix_range') or success_local_hour=$26)
          and ($25 not in('amount','matrix') or amount_bucket=$27)
          and ($25 not in('amount_range','matrix_range') or amount_range_bucket=$27)
          and ($25<>'custom' or (($38 is null or success_local_hour>=$38) and ($39 is null or success_local_hour<$39))) as success_match
      from filtered
    ), provider_names as materialized (
      -- Map each distinct raw name once, before provider/day grouping.
      select raw_provider,private.dashboard_admin_live_provider_canonical($30,$2,raw_provider) as provider
      from (select distinct provider as raw_provider from segment where created_match or success_match) names
    ), selected as (
      select s.*,n.provider as canonical_provider from segment s
      join provider_names n on n.raw_provider=s.provider where s.created_match or s.success_match
    ), eligible as materialized (
      select * from selected where case when $40::text='success' then success_match else created_match end
    )
    $q$;
  end if;
  v_sql:=v_sql||$q$, page as (
    select id,system_order_id,order_number,third_party_order_number,member_id,canonical_provider as provider,raw_provider,
      channel_type,direction,status,status_group,created_at,success_at,amount::text,actual_amount::text,withdraw_fee::text,
      currency,synced_at,utr,latency_ms,case when $40::text='success' then success_at else created_at end as event_at
    from eligible
    order by case when $40::text='success' then success_at else created_at end desc nulls last,direction desc,id desc
    limit $18 offset $17
  ) select jsonb_build_object(
    'total',(select count(*) from eligible),
    'hasMore',(select count(*)>$17+$18 from eligible),
    'rows',coalesce((select jsonb_agg(to_jsonb(p) order by event_at desc nulls last,direction desc,id desc) from page p),'[]'::jsonb))
  $q$;
  if v_platform.source='duoli' then
    if (length(v_sql)-length(replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'')))/length($duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$)<>1 then
      raise exception 'duoli_payment_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$duoli_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$duoli_latency$,'null::numeric as latency_ms');
  end if;
  if v_platform.source='panda' and coalesce(p_request->>'view','full')<>'providers' then
    if (length(v_sql)-length(replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'')))/length($panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$)<>1 then raise exception 'panda_latency_contract_drift';end if;
    v_sql:=replace(v_sql,$panda_latency$case when status_group='success' and isfinite(success_at) and success_at>=created_at and success_at<=$20
        then extract(epoch from success_at-created_at)*1000 end as latency_ms$panda_latency$,'null::numeric as latency_ms');
  end if;
  execute v_sql into v_result using v_id,case when v_platform.source in('lg','wg','duoli','kb','panda') then v_platform.source_name else v_platform.name end,v_platform.scope_group,v_platform.timezone,v_start,v_end,
    v_direction,v_status,v_member,v_order,v_system,v_providers,v_types,v_currency,v_min,v_max,v_offset,v_limit,v_action,v_asof,v_platform.currency,v_platform.source_name,v_third,v_confirmations,
    v_kind,v_hour,v_bucket_text,v_bucket,v_cumulative,v_platform.country,v_charge_edges,v_withdraw_edges,v_duration_version,v_duration_min,v_duration_max,v_duration_custom,v_max_exclusive,v_hour_min,v_hour_max,v_basis;
  if v_platform.source='panda' then
    v_result:=private.dashboard_admin_panda_order_result(v_result)||jsonb_build_object('pandaCoverage',v_panda_coverage);
  end if;
  if v_platform.source='duoli' then v_result:=private.dashboard_admin_duoli_order_result(v_result);end if;
  if v_platform.source='wg' then v_result:=private.dashboard_admin_wg_order_result(v_result,v_platform.scope_group,v_platform.source_name);end if;
  v_result:=private.dashboard_admin_order_business_result(v_result,v_platform.source,v_platform.scope_group,v_platform.source_name,v_platform.id);
  return v_result||jsonb_build_object('version',1,'platform',v_meta,'basis',v_basis,
    'startAt',v_start,'endAt',v_end,'asOf',v_asof,'offset',v_offset,'limit',v_limit,'complete',true,
    'segment',jsonb_strip_nulls(jsonb_build_object('kind',v_kind,'hour',v_hour,'hourRange',v_hour_range,
      'amountMin',v_min,'amountMax',v_max,'amountMaxExclusive',case when v_max is not null then v_max_exclusive end,
      'bucket',case when v_kind='latency' then to_jsonb(v_bucket) else to_jsonb(v_bucket_text) end,
      'cumulative',v_cumulative,'durationRange',case when v_duration_custom then v_duration->'range' end,
      'durationVersion',v_duration_version)),
    'capabilities',v_capabilities);
end;
$function$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_duoli_order_result(p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare v_result jsonb:=p_result;v_key text;v_rows jsonb;
begin
 for v_key in select 'summary' union all select key from jsonb_each(coalesce(v_result->'groups','{}')) loop
  select coalesce(jsonb_agg(r || case when r?'success_count' then jsonb_build_object(
   'success_time_available',true,'success_time_basis','order_updated_at',
   -- The five current-status groups partition the exact same creation cohort.
   -- This preserves numeric precision and propagates missing amounts.
   'created_success_amount',case when r?'created_success_count' then (
    (r->>'all_amount')::numeric-(r->>'pending_amount')::numeric-(r->>'failed_amount')::numeric
     -(r->>'rejected_amount')::numeric-(r->>'unknown_amount')::numeric)::text end
   ) else '{}'::jsonb end
   || case when r?'fee_low_count' then jsonb_build_object('fee_low_count',null,'fee_low_amount',null,
    'fee_high_count',null,'fee_high_amount',null,'fee_gap_count',null,'fee_gap_amount',null,'fee_unpriced_count',null) else '{}'::jsonb end
   || case when r?'fee_version_state' then jsonb_build_object('fee_version_state','unknown',
    'fee_version_matched_count',null,'fee_version_unmatched_count',null,'fee_version_estimated_amount',null) else '{}'::jsonb end
   order by n),'[]') into v_rows
  from jsonb_array_elements(case when v_key='summary' then coalesce(v_result->'summary','[]') else coalesce(v_result#>array['groups',v_key],'[]') end) with ordinality x(r,n);
  if v_key='summary' and v_result?'summary' or v_key<>'summary' then
   v_result:=jsonb_set(v_result,case when v_key='summary' then array['summary'] else array['groups',v_key] end,v_rows,true);
  end if;
 end loop;
 -- Updating a successful order is a statistical clock, not payment latency.
 if v_result?'latencySummary' then v_result:=jsonb_set(v_result,'{latencySummary}','[]'::jsonb);end if;
 for v_key in select unnest(array['latency','latency_thresholds','latency_custom']) loop
  if v_result->'groups'?v_key then v_result:=jsonb_set(v_result,array['groups',v_key],'[]'::jsonb);end if;
 end loop;
 return v_result||jsonb_build_object('nativeSource','DOLI','sourcePolicy','details_only',
  'successTimeAvailable',true,'chargeSuccessTimeAvailable',true,'withdrawSuccessTimeAvailable',true,
  'successTimeBasis','order_updated_at','paymentSuccessTimeAvailable',false,'latencyAvailable',false);
end;
$function$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_duoli_member_daily(p_platform jsonb, p_start timestamp with time zone, p_end timestamp with time zone, p_direction text, p_providers text[], p_currency text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare v_rows jsonb;v_source text:=p_platform->>'source_name';
begin
 if (p_platform->>'source'='duoli' and p_platform->>'scope_group'='ID'
  and p_platform->>'timezone'='Asia/Jakarta' and p_platform->>'currency'='IDR'
  and v_source=any(array['FB168','FB333','HOT985','IND666','UANG'])
  and p_platform->>'id'=md5('duoli:ID:'||v_source)::uuid::text) is not true then
  raise exception using errcode='42501',message='platform_denied';
 end if;
 if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
  or p_start>=p_end or p_end-p_start>interval '31 days' then
  raise exception using errcode='22023',message='invalid_range';
 end if;
 if p_direction is null or p_direction not in('all','charge','withdraw') then
  raise exception using errcode='22023',message='invalid_direction';
 end if;
 with events as (
  -- Separate native indexed clocks retain cross-day success updates.
  select 'created'::text basis,d.created_at event_at,d.business,d.member_id,d.provider_code,d.currency
  from private.duoli_order_details d
  where d.platform=v_source and d.country='ID' and d.system_name='DOLI'
   and d.business=any(case p_direction when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
   and d.created_at>=p_start and d.created_at<p_end
  union all
  select 'success',d.updated_at,d.business,d.member_id,d.provider_code,d.currency
  from private.duoli_order_details d
  where d.platform=v_source and d.country='ID' and d.system_name='DOLI'
   and d.business=any(case p_direction when 'all' then array['recharge','withdraw'] when 'charge' then array['recharge'] else array['withdraw'] end)
   and d.updated_at>=p_start and d.updated_at<p_end
   and private.dashboard_admin_duoli_success_updated_at(d.business,d.status_code,d.created_at,d.updated_at,statement_timestamp()) is not null
 ), filtered as (
  select basis,(event_at at time zone 'Asia/Jakarta')::date date,
   case business when 'recharge' then 'charge' else 'withdraw' end direction,nullif(btrim(member_id),'') member_id
  from events where (p_providers is null or private.dashboard_admin_duoli_provider(provider_code)=any(p_providers))
   and (p_currency is null or currency=p_currency)
 ), members as (
  select date,direction,member_id,count(*) filter(where basis='created') created_count,
   count(*) filter(where basis='success') success_count from filtered group by date,direction,member_id
 ), counts as (
  select date,direction,
   count(*) filter(where member_id is not null and created_count>0) created_member_count,
   count(*) filter(where member_id is not null and success_count>0) success_member_count,
   sum(created_count) created_order_count,sum(success_count) success_order_count,
   coalesce(sum(created_count) filter(where member_id is null),0) created_missing_member_count,
   coalesce(sum(success_count) filter(where member_id is null),0) success_missing_member_count,
   count(*) filter(where member_id is not null and created_count>=2) created_members_ge2,
   count(*) filter(where member_id is not null and created_count>=3) created_members_ge3,
   count(*) filter(where member_id is not null and created_count>=4) created_members_ge4,
   count(*) filter(where member_id is not null and created_count>=5) created_members_ge5,
   count(*) filter(where member_id is not null and success_count>=2) success_members_ge2,
   count(*) filter(where member_id is not null and success_count>=3) success_members_ge3,
   count(*) filter(where member_id is not null and success_count>=4) success_members_ge4,
   count(*) filter(where member_id is not null and success_count>=5) success_members_ge5
  from members group by date,direction
 ), days as (
  select d::date date from generate_series((p_start at time zone 'Asia/Jakarta')::date::timestamp,
   ((p_end-interval '1 microsecond') at time zone 'Asia/Jakarta')::date::timestamp,interval '1 day')d
 ), rows as (
  select days.date,d.direction,coalesce(c.created_member_count,0) created_member_count,
   coalesce(c.success_member_count,0) success_member_count,coalesce(c.created_order_count,0) created_order_count,
   coalesce(c.success_order_count,0) success_order_count,coalesce(c.created_missing_member_count,0) created_missing_member_count,
   coalesce(c.success_missing_member_count,0) success_missing_member_count,
   coalesce(c.created_members_ge2,0) created_members_ge2,coalesce(c.created_members_ge3,0) created_members_ge3,
   coalesce(c.created_members_ge4,0) created_members_ge4,coalesce(c.created_members_ge5,0) created_members_ge5,
   coalesce(c.success_members_ge2,0) success_members_ge2,coalesce(c.success_members_ge3,0) success_members_ge3,
   coalesce(c.success_members_ge4,0) success_members_ge4,coalesce(c.success_members_ge5,0) success_members_ge5
  from days cross join unnest(case p_direction when 'all' then array['charge','withdraw'] else array[p_direction] end)d(direction)
  left join counts c on c.date=days.date and c.direction=d.direction
 ) select coalesce(jsonb_agg(to_jsonb(r) order by date,direction),'[]'::jsonb) into v_rows from rows r;
 return jsonb_build_object('version',1,'asOf',statement_timestamp(),'startAt',p_start,'endAt',p_end,
  'platform',jsonb_build_object('id',p_platform->'id','name',p_platform->'name','country',p_platform->'country',
   'team',p_platform->'team','source','duoli','sourceName',v_source,'scopeGroup','ID','timezone','Asia/Jakarta','currency','IDR'),
  'rows',v_rows,'capabilities',jsonb_build_object('memberIdentity',true,'memberDailyAvailable',true,
   'createdBasis','created_at','successBasis','success_at','dedupe','platform_local_date_direction_member',
   'successTimeBasis','order_updated_at','successCohort','successful_status_updated_at_in_selected_range',
   'paymentSuccessTimeAvailable',false,'latencyAvailable',false,'sourceCompletenessVerified',false,
   'coverageBasis','collected_orders_only','withdrawCreatedCoverageAvailable',false,
   'periodTotal','sum_daily_unique_member_visits','frequencyBasis','per_platform_local_day_order_count',
   'frequencyThresholds',jsonb_build_array(2,3,4,5)));
end;
$function$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_daily_provider_prepared_read(p_page text, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 access jsonb;page jsonb;ctx jsonb;catalog jsonb;targets jsonb:='[]';q jsonb;t jsonb;dq jsonb;
 missing_days jsonb:='[]';all_days jsonb:='[]';day_states jsonb;day_entry jsonb;day_item jsonb;one_response jsonb;native_missing boolean;native_failed boolean;native_reason text;sourcedays_forced boolean:=false;
 commons jsonb:='{}';scope text;common text;dep text;baseq jsonb;k jsonb;
 metadata jsonb:='[]';parts jsonb:='[]';mappings jsonb:='[]';all_items jsonb:='[]';items jsonb:='[]';chunk jsonb;response jsonb;folded jsonb;
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
 -- Explicit read-only phase follows all unchanged page/session/query grants.
 if p_request?'readMode'then return private.dashboard_serving_ready_read(p_page,p_request);end if;
 -- Explicit compact transport runs after unchanged page/session/query grants.
 if p_request?'responseProfile'then return private.dashboard_serving_compact_read(p_page,p_request);end if;
 -- Optional display-name hints never become financial filters or identity.
 -- Invalid/oversized hints are omitted; valid main requests retain old behavior.
 if p_request?'providerLeafAliases'and p_request->'providerLeafAliases'is distinct from'"items-fee-items-v1"'::jsonb then p_request:=p_request-'providerLeafAliases';end if;
 if p_request?'providerReuseNames'then
  if p_request->'publicationVersion'is distinct from'2'::jsonb or jsonb_typeof(p_request->'providerReuseNames')is distinct from'array'then p_request:=p_request-'providerReuseNames';
  elsif jsonb_array_length(p_request->'providerReuseNames')>200 or octet_length((p_request->'providerReuseNames')::text)>8192 then p_request:=p_request-'providerReuseNames';
  elsif exists(select 1 from jsonb_array_elements(p_request->'providerReuseNames')n where jsonb_typeof(n)is distinct from'string'or length(btrim(n#>>'{}'))not between 1 and 200 or(n#>>'{}')~'[[:cntrl:]]')then p_request:=p_request-'providerReuseNames';end if;
 end if;
 if p_request is null or jsonb_typeof(p_request)is distinct from'object'
  or p_request-array['requests','publicationVersion','forceRefresh','providerReuseNames','providerLeafAliases']<>'{}'::jsonb or octet_length(p_request::text)>1048576
  or p_request->'publicationVersion'is distinct from'2'::jsonb or jsonb_typeof(p_request->'requests')is distinct from'array'
  or jsonb_array_length(p_request->'requests')not between 1 and 3
  or p_request?'forceRefresh'and jsonb_typeof(p_request->'forceRefresh')is distinct from'boolean'
 then return private.prepared_aggregate_read(p_page,p_request-array['providerReuseNames','providerLeafAliases']);end if;
 -- Exact master reuse follows all existing page/context/envelope validation.
 response:=private.dashboard_serving_master_reuse(p_page,p_request);
 if response is not null then return response;end if;
 <<complete_days>>
 begin
 select coalesce(jsonb_agg(to_jsonb(p)),'[]')into catalog from private.dashboard_admin_live_platforms()p;
 for q in select value from jsonb_array_elements(p_request->'requests')loop
  -- Invalid UUIDs are delegated to the original validation, never coerced.
  select value into t from jsonb_array_elements(catalog)where value->>'id'=q->>'platformId';
  if t is null then return private.prepared_aggregate_read(p_page,p_request-array['providerReuseNames','providerLeafAliases']);end if;
  if private.prepared_aggregate_request_reason(q,t)is not null or t->>'source'not in('ar','newar','kb')
   or q-array['action','view','platformId','startAt','endAt','successStartAt','successEndAt','successBasis','direction','status','providers','currency','offset','limit','amountBands']<>'{}'::jsonb
   or q->>'view'is distinct from'providers'or coalesce(q->>'status','all')<>'all'or q->>'successBasis'is distinct from'success'
   or q->>'successStartAt'is null or q->>'successEndAt'is null
   or q?'currency'and q->'currency'<>'null'::jsonb and q->>'currency'is distinct from t->>'currency'
  then return private.prepared_aggregate_read(p_page,p_request-array['providerReuseNames','providerLeafAliases']);end if;
  a:=(q->>'startAt')::timestamptz;b:=(q->>'endAt')::timestamptz;tz:=t->>'timezone';
  local_a:=a at time zone tz;local_b:=b at time zone tz;
  if a is distinct from(q->>'successStartAt')::timestamptz or b is distinct from(q->>'successEndAt')::timestamptz
   or local_a<>date_trunc('day',local_a)or local_b<>date_trunc('day',local_b)
   or local_b::date-local_a::date not between 2 and 31 or b>clock_timestamp()
  then return private.prepared_aggregate_read(p_page,p_request-array['providerReuseNames','providerLeafAliases']);end if;
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
   then
    missing_days:=missing_days||jsonb_build_array(jsonb_build_object('owner',i,'request',dq,'target',t,'dependency',dep));
    metadata:=metadata||jsonb_build_array(null::jsonb);
   else
   metadata:=metadata||jsonb_build_array(jsonb_build_object('request',dq,'jobId',j.id,'publication',jsonb_build_object(
    'id',artifact.id,'generation',artifact.revision::text||':'||artifact.fence::text,'computedAt',artifact.computed_at,
    'expiresAt',artifact.expires_at,'cutoff',artifact.cutoff,'calculationComplete',true,'sourceComplete',artifact.source_complete,
    'freshness',case when artifact.expires_at>clock_timestamp()then'fresh'else'refresh_due'end,
    'nextRefreshAt',j.next_due_at,'refreshState',case when j.status='ready'then'idle'else j.status end)));
   end if;
   all_days:=all_days||jsonb_build_array(jsonb_build_object('owner',i,'request',dq,'target',t,'dependency',dep));
   parts:=parts||jsonb_build_array(dq);
  end loop;
  mappings:=mappings||jsonb_build_array(jsonb_build_object('first',start_index,'count',jsonb_array_length(parts)-start_index,'dependency',dep,'scopeCommon',common));i:=i+1;
 end loop;
 if jsonb_array_length(missing_days)>0 then
  sourcedays_forced:=coalesce((p_request->>'forceRefresh')::boolean,false);
  -- Force and ordinary daily admission share actor->sorted source lock order.
  -- Already-readable ready days receive only the original V2 metadata update.
  day_states:=private.daily_provider_base_admit_days(case when sourcedays_forced then all_days else missing_days end,sourcedays_forced);exit complete_days;
 end if;
 -- 3 platforms ×31 local days, split sequentially. No client concurrency change,
 -- no broadened original RPC batch contract, no synchronous raw computation.
 if jsonb_array_length(parts)>93 then return private.prepared_aggregate_read(p_page,p_request-array['providerReuseNames','providerLeafAliases']);end if;
 -- Only exact completed batches can avoid the old full daily DTO path.
 -- Force, miss and last-complete retain the unchanged original admission.
 if not coalesce((p_request->>'forceRefresh')::boolean,false)then
  response:=private.daily_provider_base_exact_read(p_request,targets,mappings,metadata);
  if response is not null then return response;end if;
 end if;
 part_index:=0;
 while part_index<jsonb_array_length(parts)loop
  select jsonb_agg(value order by n)into chunk from jsonb_array_elements(parts)with ordinality p(value,n)where n>part_index and n<=part_index+50;
  response:=private.prepared_aggregate_read(p_page,(p_request-array['requests','providerReuseNames','providerLeafAliases'])||jsonb_build_object('requests',chunk));
  if response->>'version'is distinct from'2'or jsonb_typeof(response->'items')is distinct from'array'
   or jsonb_array_length(response->'items')<>jsonb_array_length(chunk)
   or exists(select 1 from jsonb_array_elements(response->'items')with ordinality r(value,n)where value->>'status'is distinct from'ready'or value->'request'is distinct from chunk->(n::integer-1))
  then
   -- A head can change after preflight. Recheck/admit only daily keys, never
   -- enqueue the original broad window in parallel with its source-day work.
   missing_days:=all_days;day_states:=private.daily_provider_base_admit_days(missing_days,false);exit complete_days;
  end if;
  all_items:=all_items||(response->'items');part_index:=part_index+50;
 end loop;
 i:=0;
 for mapping in select value from jsonb_array_elements(mappings)loop
  original_q:=p_request->'requests'->i;t:=targets->i;
  select jsonb_agg(value order by n)into selected from jsonb_array_elements(all_items)with ordinality r(value,n)
   where n>(mapping->>'first')::integer and n<=(mapping->>'first')::integer+(mapping->>'count')::integer;
  begin
   prepared:=private.daily_provider_base_lookup(selected,original_q,t,mapping->>'dependency');
   if prepared->'fallback'='true'::jsonb then return private.prepared_aggregate_read(p_page,p_request-array['providerReuseNames','providerLeafAliases']);end if;
   folded:=prepared->'item';
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then folded:=null;end;
  if folded is null then return private.prepared_aggregate_read(p_page,p_request-array['providerReuseNames','providerLeafAliases']);end if;
  items:=items||jsonb_build_array(folded);
  pending:=pending||jsonb_build_array(prepared->'pending');i:=i+1;
 end loop;
 response:=jsonb_build_object('version',2,'items',items);
 -- Match the existing prepared manager's 16 MiB encoded-response bound.
 -- Preserve original fallback behavior instead of truncating providers/leaves.
 if octet_length(response::text)>16*1024*1024 then return private.prepared_aggregate_read(p_page,p_request-array['providerReuseNames','providerLeafAliases']);end if;
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
 end complete_days;
 -- Same existing bounded client poll contract: preparation now includes
 -- normally admitted source days before derived work. No publication/money is
 -- returned for a native whose required days are not all available yet.
 items:='[]';i:=0;
 for original_q in select value from jsonb_array_elements(p_request->'requests')loop
  native_missing:=exists(select 1 from jsonb_array_elements(missing_days)e where(e->>'owner')::integer=i);
  if native_missing then
   native_failed:=exists(select 1 from jsonb_array_elements(day_states)e where(e->>'owner')::integer=i and coalesce(e->>'status','')not in('ready','queued','running'));
   select e->>'reason'into native_reason from jsonb_array_elements(day_states)e where(e->>'owner')::integer=i and coalesce(e->>'status','')not in('ready','queued','running')limit 1;
   day_item:=jsonb_build_object('request',original_q,'status',case when native_failed then'failed'else'building'end,'reason',case when native_failed then coalesce(native_reason,'daily_provider_day_unavailable')else'daily_provider_base_preparing'end,'result',null,'publication',null);
  else
   -- Other fully prepared natives retain their exact ready/last-complete path
   -- and are delivered once; they do not join the missing native's polling.
   one_response:=private.dashboard_admin_daily_provider_prepared_read(p_page,jsonb_set(case when sourcedays_forced then p_request-'forceRefresh'else p_request end,'{requests}',jsonb_build_array(original_q)));
   day_item:=one_response->'items'->0;
  end if;
  items:=items||jsonb_build_array(day_item);i:=i+1;
 end loop;
 response:=jsonb_build_object('version',2,'items',items);
 if octet_length(response::text)>16*1024*1024 then
  select jsonb_agg(value-'providerReuse'order by ordinal)into items from jsonb_array_elements(items)with ordinality r(value,ordinal);response:=jsonb_build_object('version',2,'items',items);
  if octet_length(response::text)>16*1024*1024 then raise exception using errcode='54000',message='daily_provider_response_capacity';end if;
 end if;
 return response;
end;$function$;
CREATE OR REPLACE FUNCTION private.dashboard_admin_daily_provider_fold(p_items jsonb, p_request jsonb, p_target jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
 item jsonb;current_row jsonb;leaf jsonb;bucket record;key text;n numeric;bad boolean;
 all_rows jsonb:='[]';providers jsonb:='[]';summaries jsonb:='[]';row_value jsonb;
 payload jsonb;first_payload jsonb;pub jsonb;components jsonb:='[]';baseq jsonb;canonicalq jsonb;
 computed timestamptz;expires timestamptz;cutoff timestamptz;maxcutoff timestamptz;
 next_refresh timestamptz;refresh_known boolean:=true;identity_token text;fresh boolean:=true;complete boolean:=true;refresh_state text:='idle';
 evidence jsonb;stamp text;total numeric;matched numeric;unmatched numeric;fee numeric;
 counts constant text[]:=array['all_count','success_count','created_success_count','pending_count','failed_count','rejected_count','unknown_count','missing_amount_count','negative_amount_count','fee_low_count','fee_high_count','fee_gap_count','fee_unpriced_count','fee_version_matched_count','fee_version_unmatched_count'];
 amounts constant text[]:=array['all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount','fee_low_amount','fee_high_amount','fee_gap_amount'];
 optional_counts constant text[]:=array['fee_exempt_count','reviewed_pending_count'];
 optional_amounts constant text[]:=array['created_success_amount','reviewed_pending_amount'];
begin
 if jsonb_typeof(p_items)is distinct from'array'or jsonb_array_length(p_items)not between 2 and 31 then return null;end if;
 for item in select value from jsonb_array_elements(p_items)loop
  payload:=item->'result';pub:=item->'publication';
  if item->>'status'is distinct from'ready'or jsonb_typeof(payload)is distinct from'object'
   or payload->>'version'is distinct from'1'or payload->'rows'is distinct from'[]'::jsonb
   or jsonb_typeof(payload->'summary')is distinct from'array'or jsonb_typeof(payload->'groups'->'provider')is distinct from'array'
   or payload?|array['error','partial','_parts','_preparedPublication']
   or payload->'platform'->>'id'is distinct from p_target->>'id'
   or payload->'platform'->>'source'is distinct from p_target->>'source'
   or payload->'platform'->>'name'is distinct from p_target->>'name'
   or payload->'platform'->>'sourceName'is distinct from p_target->>'source_name'
   or payload->'platform'->>'country'is distinct from p_target->>'country'
   or payload->'platform'->>'currency'is distinct from p_target->>'currency'
   or payload->'platform'->>'timezone'is distinct from p_target->>'timezone'
   or payload->>'successBasis'is distinct from'success'
   or (payload->>'startAt')::timestamptz is distinct from(item->'request'->>'startAt')::timestamptz
   or (payload->>'endAt')::timestamptz is distinct from(item->'request'->>'endAt')::timestamptz
   or (payload->>'successStartAt')::timestamptz is distinct from(payload->>'startAt')::timestamptz
   or (payload->>'successEndAt')::timestamptz is distinct from(payload->>'endAt')::timestamptz
   or payload->'coverage'->'calculationComplete'='false'::jsonb
   or jsonb_typeof(pub)is distinct from'object'or coalesce(pub->>'id','')=''
   or coalesce(pub->>'generation','')=''or pub->'calculationComplete'is distinct from'true'::jsonb
   or jsonb_typeof(pub->'sourceComplete')is distinct from'boolean'
   or coalesce(pub->>'freshness','')not in('fresh','refresh_due')or coalesce(pub->>'refreshState','')not in('idle','queued','running','failed')
   or pub->>'computedAt'is null or pub->>'expiresAt'is null or pub->>'cutoff'is null
   or (pub->>'expiresAt')::timestamptz<=(pub->>'computedAt')::timestamptz
   or (pub->>'cutoff')::timestamptz<(payload->>'endAt')::timestamptz
  then return null;end if;
  if first_payload is null then first_payload:=payload;end if;
  computed:=least(computed,(pub->>'computedAt')::timestamptz);
  expires:=least(expires,(pub->>'expiresAt')::timestamptz);
  cutoff:=least(cutoff,(pub->>'cutoff')::timestamptz);maxcutoff:=greatest(maxcutoff,(pub->>'cutoff')::timestamptz);
  next_refresh:=least(next_refresh,(pub->>'nextRefreshAt')::timestamptz);
  refresh_known:=refresh_known and pub->>'nextRefreshAt'is not null;
  fresh:=fresh and pub->>'freshness'='fresh';complete:=complete and(pub->>'sourceComplete')::boolean
   and coalesce(payload->'coverage'->'sourceComplete','true'::jsonb)<>'false'::jsonb
   and coalesce(payload->'capabilities'->'sourceCompletenessVerified','true'::jsonb)<>'false'::jsonb;
  if pub->>'refreshState'='running'then refresh_state:='running';
  elsif pub->>'refreshState'='queued'and refresh_state<>'running'then refresh_state:='queued';
  elsif pub->>'refreshState'='failed'and refresh_state='idle'then refresh_state:='failed';end if;
  components:=components||jsonb_build_array(jsonb_build_object('request',item->'request','publication',pub,
   'evidence',jsonb_build_object('basis',payload->'basis','coverage',payload->'coverage','capabilities',payload->'capabilities')));
  for current_row in select value from jsonb_array_elements(payload->'groups'->'provider')loop
   if jsonb_typeof(current_row)is distinct from'object'or coalesce(current_row->>'direction','')not in('charge','withdraw')
    or current_row->>'currency'is distinct from p_target->>'currency'or current_row->>'provider'is null then return null;end if;
   -- Required additive ABI is finite. Unknown numeric facts stay null; invalid
   -- non-null facts cause an ordinary original-reader fallback, never a zero.
   foreach key in array counts||optional_counts loop
    if key=any(counts)and not(current_row?key)then return null;end if;
    if current_row?key and current_row->>key is not null and current_row->>key!~'^[0-9]+$'then return null;end if;
   end loop;
   foreach key in array amounts||optional_amounts||array['fee_version_estimated_amount']loop
    if(key=any(amounts)or key='fee_version_estimated_amount')and not(current_row?key)then return null;end if;
    if current_row?key and current_row->>key is not null and current_row->>key!~'^[+-]?[0-9]+([.][0-9]*)?([eE][+-]?[0-9]+)?$'then return null;end if;
   end loop;
   if current_row->>'fee_version_matched_count'is not null and current_row->>'fee_version_unmatched_count'is not null and current_row->>'success_count'is not null
    and(current_row->>'fee_version_matched_count')::numeric+(current_row->>'fee_version_unmatched_count')::numeric<>(current_row->>'success_count')::numeric then return null;end if;
   if(current_row->>'fee_version_matched_count')::numeric>0 and current_row->>'fee_version_estimated_amount'is null then return null;end if;
  end loop;
  -- Preserve native day/row order while copying the full array once per day.
  all_rows:=all_rows||(payload->'groups'->'provider');
 end loop;
 -- Resolve every original label in the native platform context. No frontend
 -- dictionary, prefix inference, cross-platform override, or rate averaging.
 for bucket in with labels as materialized(select distinct r->>'provider' raw from jsonb_array_elements(all_rows)r),
 names as materialized(select raw,private.dashboard_admin_live_provider_canonical(p_target->>'country',p_target->>'source_name',raw)canonical from labels)
 select names.canonical provider,r->>'direction'direction,r->>'currency'currency,jsonb_agg(r)leaves
 from jsonb_array_elements(all_rows)r join names on names.raw=r->>'provider'
 group by names.canonical,r->>'direction',r->>'currency'order by names.canonical,r->>'direction',r->>'currency'
 loop
  -- Editable native aliases need not be idempotent. Such a chain could make a
  -- second canonical projection choose a different row than the original one.
  -- Preserve the exact existing contract by falling back rather than guessing.
  if bucket.provider is null or private.dashboard_admin_live_provider_canonical(p_target->>'country',p_target->>'source_name',bucket.provider)is distinct from bucket.provider then return null;end if;
  row_value:=jsonb_build_object('provider',bucket.provider,'direction',bucket.direction,'currency',bucket.currency,
   'items',bucket.leaves,'fee_items',bucket.leaves,'provider_names',(select jsonb_agg(name order by name)from(
    select distinct name from jsonb_array_elements(bucket.leaves)r cross join lateral jsonb_array_elements_text(
     jsonb_build_array(r->>'provider')||case when jsonb_typeof(r->'provider_names')='array'then r->'provider_names'else'[]'::jsonb end)n(name)where name is not null)a));
  foreach key in array counts||optional_counts||amounts||optional_amounts loop
   if(key=any(optional_counts)or key=any(optional_amounts))and not exists(select 1 from jsonb_array_elements(bucket.leaves)r where r?key)then continue;end if;
   select bool_or(r->>key is null),sum((r->>key)::numeric)into bad,n from jsonb_array_elements(bucket.leaves)r;
   row_value:=row_value||jsonb_build_object(key,case when bad then'null'::jsonb when key=any(counts||optional_counts)then to_jsonb(n)else to_jsonb(n::text)end);
  end loop;
  matched:=(row_value->>'fee_version_matched_count')::numeric;unmatched:=(row_value->>'fee_version_unmatched_count')::numeric;
  if matched is null or unmatched is null then fee:=null;
  elsif matched>0 then
   select sum(case when(r->>'fee_version_matched_count')::numeric>0 then(r->>'fee_version_estimated_amount')::numeric else 0 end)into fee from jsonb_array_elements(bucket.leaves)r;
  elsif unmatched>0 then fee:=null;else fee:=0;end if;
  row_value:=row_value||jsonb_build_object('fee_version_estimated_amount',fee::text,'fee_version_state',
   case when matched is null or unmatched is null then'unknown'when unmatched=0 then'complete'when matched>0 then'partial'else'unknown'end);
  foreach key in array array['success_time_available','success_time_basis','success_available','success_unavailable_reason','fee_available','fee_unavailable_reason','pending_count_available']loop
   select case when count(distinct r->key)=1 and bool_and(r?key)then(jsonb_agg(r->key))->0 end into evidence from jsonb_array_elements(bucket.leaves)r;
   if evidence is not null then row_value:=row_value||jsonb_build_object(key,evidence);end if;
  end loop;
  -- Non-additive statistics have no proved range union. Never copy day one's
  -- people, rates, submission deduplication, latency percentiles, or time bucket.
  foreach key in array array['member_count','distinct_member_count','unique_member_count','success_member_count','invalid_members','invalid_count','adjusted_rate','success_rate','p50','p90','p95','p99','avg_duration_seconds','median_duration_seconds']loop
   if exists(select 1 from jsonb_array_elements(bucket.leaves)r where r?key)then row_value:=row_value||jsonb_build_object(key,null);end if;
  end loop;
  select r->>'latest_synced_at'into stamp from jsonb_array_elements(bucket.leaves)r where r->>'latest_synced_at'is not null order by(r->>'latest_synced_at')::timestamptz desc limit 1;
  row_value:=row_value||jsonb_build_object('latest_synced_at',stamp);
  providers:=providers||jsonb_build_array(row_value);
 end loop;
 -- Reuse the existing backend provider projection for its exact summary ABI.
 -- An explicit direction avoids its providerless/all early return.
 baseq:=private.prepared_aggregate_canonical_request((p_request-'providers')||jsonb_build_object('direction','all'),p_target);
 canonicalq:=private.prepared_aggregate_canonical_request(p_request,p_target);
 payload:=jsonb_build_object('version',1,'platform',first_payload->'platform','summary','[]'::jsonb,'rows','[]'::jsonb,
  'groups',jsonb_build_object('provider',providers),'startAt',p_request->>'startAt','endAt',p_request->>'endAt',
  'successStartAt',p_request->>'successStartAt','successEndAt',p_request->>'successEndAt','successBasis','success',
  'asOf',cutoff,'asOfBasis','mixed_daily_publications','asOfRange',jsonb_build_object('earliest',cutoff,'latest',maxcutoff),
  'latencySummary','[]'::jsonb,'pendingSummary','[]'::jsonb,'nonAdditiveStatistics','unavailable_daily_union',
  'coverage',jsonb_build_object('calculationComplete',true,'sourceComplete',complete,'sourceCompletenessVerified',false,'basis','daily_prepared_heads'));
 foreach key in array array['source','timeBasis','capabilities','_preparedDirectionCapabilities','basis']loop
  if first_payload?key then payload:=payload||jsonb_build_object(key,first_payload->key);end if;
 end loop;
 foreach key in array array['charge','withdraw']loop
  current_row:=private.dashboard_prepared_provider_projection(payload,baseq,baseq||jsonb_build_object('direction',key));
  summaries:=summaries||(current_row->'summary');
 end loop;
 select coalesce(bool_or(r->>'all_count'is null),false),coalesce(sum((r->>'all_count')::numeric),0)into bad,total from jsonb_array_elements(providers)r;
 payload:=payload||jsonb_build_object('summary',summaries,'total',case when bad then null else total end);
 payload:=private.prepared_aggregate_echo(private.dashboard_prepared_provider_projection(payload,baseq,canonicalq),p_request,p_target);
 if jsonb_typeof(payload->'capabilities')='object'then payload:=jsonb_set(payload,'{capabilities}',payload->'capabilities'||jsonb_build_object('asOfBasis','mixed_daily_publications','sourceCompletenessVerified',false));end if;
 if jsonb_typeof(payload->'platform'->'capabilities')='object'then payload:=jsonb_set(payload,'{platform,capabilities}',payload->'platform'->'capabilities'||jsonb_build_object('asOfBasis','mixed_daily_publications','sourceCompletenessVerified',false));end if;
 select md5(jsonb_agg(jsonb_build_array(c->'publication'->>'id',c->'publication'->>'generation')order by ord)::text)into identity_token from jsonb_array_elements(components)with ordinality p(c,ord);
 return jsonb_build_object('request',p_request,'status','ready','result',payload,'publication',jsonb_build_object(
  'kind','daily_provider_rollup','id','daily:'||identity_token,'generation','daily:'||identity_token,
  'computedAt',computed,'expiresAt',expires,'cutoff',cutoff,'cutoffRange',jsonb_build_object('earliest',cutoff,'latest',maxcutoff),
  'calculationComplete',true,'sourceComplete',complete,'freshness',case when fresh then'fresh'else'refresh_due'end,
  'nextRefreshAt',case when refresh_known then next_refresh end,'refreshState',refresh_state,'components',components));
end;$function$;
CREATE OR REPLACE FUNCTION private.daily_provider_base_prewarm_internal(p_requests jsonb, p_background_requested_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare q jsonb;t jsonb;dep text;tz text;la timestamp;lb timestamp;d date;dq jsonb;baseq jsonb;k jsonb;
 j private.prepared_aggregate_jobs%rowtype;a private.prepared_aggregate_artifacts%rowtype;
 metadata jsonb;missing_days jsonb:='[]';day_states jsonb;request_index integer:=0;pending jsonb:='[]';identity jsonb;pub jsonb;valid boolean;n integer:=0;states jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_base_worker_denied';end if;
 if current_setting('statement_timeout')::interval<=interval'0seconds'or current_setting('statement_timeout')::interval>interval'3seconds'then raise exception 'daily_provider_base_claim_deadline_required';end if;
 if p_background_requested_at is not null and(not isfinite(p_background_requested_at)or p_background_requested_at>clock_timestamp())then raise exception using errcode='22023',message='daily_provider_background_activity_invalid';end if;
 if jsonb_typeof(p_requests)is distinct from'array'or jsonb_array_length(p_requests)not between 1 and 3 or octet_length(p_requests::text)>1048576 then raise exception 'daily_provider_base_prewarm_invalid';end if;
 for q in select value from jsonb_array_elements(p_requests)loop
  select to_jsonb(p)into t from private.prepared_aggregate_native_catalog()p join private.provider_snapshot_targets st on st.platform_id=p.id and st.enabled and st.target=to_jsonb(p)where p.id::text=q->>'platformId';
  if t is null then continue;end if;
  if private.prepared_aggregate_request_reason(q,t)is not null or t->>'source'not in('ar','newar','kb')or q->>'view'is distinct from'providers'
   or q->>'successBasis'is distinct from'success'or coalesce(q->>'status','all')<>'all'
   or q-array['action','view','platformId','startAt','endAt','successStartAt','successEndAt','successBasis','direction','status','providers','currency','offset','limit','amountBands']<>'{}'::jsonb
   or(q->>'startAt')::timestamptz is distinct from(q->>'successStartAt')::timestamptz or(q->>'endAt')::timestamptz is distinct from(q->>'successEndAt')::timestamptz
   or(q->>'endAt')::timestamptz>clock_timestamp()then continue;end if;
  tz:=t->>'timezone';la:=(q->>'startAt')::timestamptz at time zone tz;lb:=(q->>'endAt')::timestamptz at time zone tz;
  if la<>date_trunc('day',la)or lb<>date_trunc('day',lb)or lb::date-la::date not between 2 and 31 then continue;end if;
  dep:=private.prepared_aggregate_dependency(t,private.prepared_aggregate_dependency_common(t->>'scope_group'));metadata:='[]';valid:=true;
  for d in select generate_series(la::date,lb::date-1,interval'1day')::date loop
   dq:=(q-array['providers','amountBands'])||jsonb_build_object('direction','all',
    'startAt',to_char(d::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'endAt',to_char((d+1)::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'successStartAt',to_char(d::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'successEndAt',to_char((d+1)::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
   baseq:=private.prepared_aggregate_base_request(dq,t);k:=private.prepared_aggregate_key(baseq,t);
   select *into j from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k;
   select a0.*into a from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a0 on a0.id=h.artifact_id where h.job_id=j.id;
   if a.id is null or j.target is distinct from t or j.dependency is distinct from dep or a.dependency is distinct from dep or a.revision is distinct from j.revision
    or a.cutoff<(dq->>'endAt')::timestamptz or a.cutoff is null or a.computed_at is null or a.expires_at<=a.computed_at or a.source_complete is null then
    valid:=false;missing_days:=missing_days||jsonb_build_array(jsonb_build_object('owner',request_index,'request',dq,'target',t,'dependency',dep));continue;
   end if;
   pub:=jsonb_build_object('id',a.id,'generation',a.revision::text||':'||a.fence::text,'computedAt',a.computed_at,'expiresAt',a.expires_at,'cutoff',a.cutoff,
    'calculationComplete',true,'sourceComplete',a.source_complete,'freshness',case when a.expires_at>transaction_timestamp()then'fresh'else'refresh_due'end,
    'nextRefreshAt',j.next_due_at,'refreshState',case when j.status='ready'then'idle'else j.status end);
   metadata:=metadata||jsonb_build_array(jsonb_build_object('request',dq,'publication',pub));
  end loop;
  request_index:=request_index+1;
  if not valid then continue;end if;
  identity:=private.daily_provider_base_identity(metadata,q,t,dep);
  pending:=pending||jsonb_build_array(jsonb_build_object('identity',identity,'target',t,'request',identity->'base','dependency',dep,'metadata',metadata)||case when p_background_requested_at is null then'{}'::jsonb else jsonb_build_object('backgroundRequestedAt',p_background_requested_at)end);n:=n+1;
 end loop;
 day_states:=private.daily_provider_base_admit_days(missing_days,false);
 states:=private.daily_provider_base_enqueue(pending);
 return jsonb_build_object('eligibleWindows',n,'limitedWindows',(select count(*)from jsonb_object_keys(states)),'missingDays',jsonb_array_length(missing_days),'preparingDays',(select count(*)from jsonb_array_elements(day_states)e where e->>'status'in('queued','running','ready')),'failedDays',(select count(*)from jsonb_array_elements(day_states)e where e->>'status'='failed'));
end;$function$;
drop function private.dashboard_created_manual_transition(jsonb,jsonb,text);
drop table private.created_cohort_manual_transition;
do $guard$ declare expected jsonb;actual jsonb;begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='created_rollout_owner_required';end if;
 if current_setting('transaction_isolation')<>'repeatable read'then raise exception using errcode='55000',message='created_rollout_snapshot_required';end if;
 for expected in select value from jsonb_array_elements('[{"identity":"private.daily_provider_base_prewarm_internal(jsonb,timestamp with time zone)","name":"daily_provider_base_prewarm_internal","body_md5":"9aa3342e3095e492bb9a8c0d5903507e","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_requests jsonb, p_background_requested_at timestamp with time zone","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_daily_provider_fold(jsonb,jsonb,jsonb)","name":"dashboard_admin_daily_provider_fold","body_md5":"e032c2062fc64bb81481593df061a9e9","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_items jsonb, p_request jsonb, p_target jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_daily_provider_prepared_read(text,jsonb)","name":"dashboard_admin_daily_provider_prepared_read","body_md5":"ed3519eca618913bef41b1ba90f121fc","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_page text, p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_duoli_member_daily(jsonb,timestamp with time zone,timestamp with time zone,text,text[],text)","name":"dashboard_admin_duoli_member_daily","body_md5":"922c2e546e4ef9b1451df3d1e03522f8","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\"","jit=off"],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_platform jsonb, p_start timestamp with time zone, p_end timestamp with time zone, p_direction text, p_providers text[], p_currency text","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_duoli_order_result(jsonb)","name":"dashboard_admin_duoli_order_result","body_md5":"000d85af8011440a52e15d5b6c458634","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"i","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_result jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_live_analysis_orders_raw(jsonb)","name":"dashboard_admin_live_analysis_orders_raw","body_md5":"d941a049b60e636ac4cb15e281aa3b81","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\"","jit=off"],"security_definer":true,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_live_drilldown_raw(jsonb)","name":"dashboard_admin_live_drilldown_raw","body_md5":"ab65113f3ee7bc2619104a8cc30e34c4","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\"","jit=off"],"security_definer":true,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_live_member_daily(jsonb)","name":"dashboard_admin_live_member_daily","body_md5":"e9aadf0d61a0ac40852277f4e8038830","owner":"postgres","acl":"{postgres=X/postgres,authenticated=X/postgres}","config":["search_path=\"\"","jit=off"],"security_definer":true,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_live_query_raw(jsonb)","name":"dashboard_admin_live_query_raw","body_md5":"8877cb8cee3ec54c65fa6400f590c11d","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\"","jit=off"],"security_definer":true,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_request jsonb DEFAULT ''{\"action\": \"catalog\"}''::jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_live_remap_groups(jsonb,text,text,boolean)","name":"dashboard_admin_live_remap_groups","body_md5":"0ce8e6980d543059024eb1010d600946","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":true,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_rows jsonb, p_country text, p_platform text, p_daily boolean DEFAULT false","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_panda_order_result(jsonb)","name":"dashboard_admin_panda_order_result","body_md5":"3d7f080f728cd65522419b54ba87fdd6","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"i","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_result jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_wg_member_daily(jsonb,timestamp with time zone,timestamp with time zone,text,text[],text)","name":"dashboard_admin_wg_member_daily","body_md5":"fb72a0ff456f230bee481d1267db6973","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":true,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_platform jsonb, p_start timestamp with time zone, p_end timestamp with time zone, p_direction text, p_providers text[], p_currency text","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_admin_wg_order_result(jsonb,text,text)","name":"dashboard_admin_wg_order_result","body_md5":"abb7d4470a13fed819c848ccbec18bc2","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_result jsonb, p_country text, p_platform text","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_prepared_direction_projection(jsonb,jsonb,jsonb)","name":"dashboard_prepared_direction_projection","body_md5":"f36e89e99539f99046df12daaec1ab70","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"i","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_payload jsonb, p_base_request jsonb, p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)","name":"dashboard_prepared_provider_projection","body_md5":"58fee45de05fe5567a62e69b297cee88","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_payload jsonb, p_base_request jsonb, p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_serving_country_prewarm(timestamp with time zone)","name":"dashboard_serving_country_prewarm","body_md5":"fba60aed60bb565640be6cc5361d5ab7","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_now timestamp with time zone DEFAULT now()","result":"jsonb","language":"plpgsql"},{"identity":"private.dashboard_serving_master_reuse(text,jsonb)","name":"dashboard_serving_master_reuse","body_md5":"12e73ba95e2a7f6f9902568907844c34","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_page text, p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_base_request(jsonb,jsonb,timestamp with time zone)","name":"prepared_aggregate_base_request","body_md5":"e05bf399932d1441b3425a548e0af7ed","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"q jsonb, t jsonb, p_now timestamp with time zone DEFAULT now()","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_canonical_request(jsonb,jsonb)","name":"prepared_aggregate_canonical_request","body_md5":"56218033e0849e0744f34ba92ad96e72","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"i","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"q jsonb, t jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_complete(uuid,uuid,bigint,jsonb)","name":"prepared_aggregate_complete","body_md5":"13979f2998cd54fc8fa33eee4407b4ff","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_job uuid, p_run uuid, p_fence bigint, p_payload jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_compute(jsonb,jsonb)","name":"prepared_aggregate_compute","body_md5":"7181dbfca803c236a48290a3ce540b40","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\"","jit=off"],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"q jsonb, t jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_dependency(jsonb)","name":"prepared_aggregate_dependency","body_md5":"719f56b29c6fbb91b70e88f03b647a43","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_target jsonb","result":"text","language":"sql"},{"identity":"private.prepared_aggregate_dependency(jsonb,text)","name":"prepared_aggregate_dependency","body_md5":"8abe872feeb5ab4b2a7f2ee662e39dba","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_target jsonb, p_common text","result":"text","language":"sql"},{"identity":"private.prepared_aggregate_dependency_common(text)","name":"prepared_aggregate_dependency_common","body_md5":"36966b6e1e434eb6d5990e551f816b8e","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_scope text","result":"text","language":"sql"},{"identity":"private.prepared_aggregate_echo(jsonb,jsonb,jsonb)","name":"prepared_aggregate_echo","body_md5":"f72bd9afabd7c74de273f02f5e46499d","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"i","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"payload jsonb, q jsonb, t jsonb","result":"jsonb","language":"sql"},{"identity":"private.prepared_aggregate_key(jsonb,jsonb)","name":"prepared_aggregate_key","body_md5":"220e789b11f814a39784fbf63ebdc30c","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"i","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"q jsonb, t jsonb","result":"jsonb","language":"sql"},{"identity":"private.prepared_aggregate_master_projection(jsonb,jsonb,jsonb)","name":"prepared_aggregate_master_projection","body_md5":"0909f6961bc2fe1de9101af88396760b","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_payload jsonb, p_base jsonb, p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_newar_withdraw_clock_guard(jsonb,jsonb)","name":"prepared_aggregate_newar_withdraw_clock_guard","body_md5":"6fb00b79e643d07cfc75fe2fc4610fdc","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_result jsonb, p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_prewarm(timestamp with time zone)","name":"prepared_aggregate_prewarm","body_md5":"31091a278d78979da832bd6ce4421c96","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_now timestamp with time zone DEFAULT now()","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_raw_kernel(jsonb,jsonb)","name":"prepared_aggregate_raw_kernel","body_md5":"dbb1a426ade3eb696de734ed480aeb91","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\"","jit=off"],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_request jsonb, p_catalog jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_read(text,jsonb)","name":"prepared_aggregate_read","body_md5":"5a0c7f3986cc9291a548db9645b69397","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":true,"volatility":"v","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_page text, p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_request_reason(jsonb,jsonb)","name":"prepared_aggregate_request_reason","body_md5":"56807ad65f1f575fd4d46c1bff0fa885","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"q jsonb, t jsonb","result":"text","language":"plpgsql"},{"identity":"private.prepared_aggregate_secondary_reason(jsonb,jsonb)","name":"prepared_aggregate_secondary_reason","body_md5":"769f35d63309cef0b975a2224229715f","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"q jsonb, t jsonb","result":"text","language":"plpgsql"},{"identity":"private.dashboard_serving_ready_read(text,jsonb)","name":"dashboard_serving_ready_read","body_md5":"69139c9056afd0d0f14d1381fedee272","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"s","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_page text, p_request jsonb","result":"jsonb","language":"plpgsql"},{"identity":"private.prepared_aggregate_source_clocks(text,text,text)","name":"prepared_aggregate_source_clocks","body_md5":"72df486e0133adfa47dcce1d84e7cb52","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"i","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"p_sql text, p_source text, p_basis text","result":"text","language":"plpgsql"},{"identity":"private.dashboard_serving_default_amount_bands(text)","name":"dashboard_serving_default_amount_bands","body_md5":"d140e1dc8a39cc3a17fd3508fdf9c86c","owner":"postgres","acl":"{postgres=X/postgres}","config":["search_path=\"\""],"security_definer":false,"volatility":"i","parallel":"u","strict":false,"leakproof":false,"cost":100,"rows":0,"args":"currency text","result":"jsonb","language":"sql"}]'::jsonb)loop
 select to_jsonb(s)into actual from(select p.oid::regprocedure::text identity,p.proname name,md5(p.prosrc) body_md5,pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.proconfig config,p.prosecdef security_definer,p.provolatile volatility,p.proparallel parallel,p.proisstrict strict,p.proleakproof leakproof,p.procost cost,p.prorows rows,pg_get_function_arguments(p.oid) args,pg_get_function_result(p.oid) result,l.lanname language from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(expected->>'identity'))s;
 if actual is distinct from expected then raise exception using errcode='55000',message='created_rollout_restored_drift:'||(expected->>'identity');end if;end loop;end;$guard$;
commit;
