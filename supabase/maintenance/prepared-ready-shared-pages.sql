-- Reviewed candidate only. Execute once by the release owner after approval.
-- Changes only two existing private serving helpers. No queues, heads, raw data,
-- statistical kernels, grants, schedulers, source evidence or publication flags.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $ready_reader_change$
declare expected jsonb;actual jsonb;common_before jsonb;common_after jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='ready_reader_release_owner_required';end if;
  for expected in select value from jsonb_array_elements('[{"identity":"private.dashboard_admin_daily_provider_prepared_read(text,jsonb)","body_md5":"b122e68a38ccb93dfb27fbd7e235fb8f","definition_md5":"6d453d257b02b6bd5362abb49bb5d292","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"v","proparallel":"u","procost":100,"prorows":0,"proisstrict":false,"proleakproof":false},{"identity":"private.dashboard_serving_compact_read(text,jsonb)","body_md5":"d6f7270e41f2258d9ecb6782cb95dca7","definition_md5":"8d9589ede59921235d92330b741b61df","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"v","proparallel":"u","procost":100,"prorows":0,"proisstrict":false,"proleakproof":false},{"identity":"private.dashboard_serving_ready_read(text,jsonb)","body_md5":"8d18e88fce406e9bfe201bc668466121","definition_md5":"4f935c8b85dd54d2aa78581102d2622d","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"s","proparallel":"u","procost":100,"prorows":0,"proisstrict":false,"proleakproof":false},{"identity":"private.prepared_aggregate_master_projection(jsonb,jsonb,jsonb)","body_md5":"0909f6961bc2fe1de9101af88396760b","definition_md5":"0d13d39347899ee453179c1b7851d749","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"s","proparallel":"u","procost":100,"prorows":0,"proisstrict":false,"proleakproof":false}]'::jsonb) loop
    select jsonb_build_object('identity',p.oid::regprocedure::text,'body_md5',md5(p.prosrc),'definition_md5',md5(pg_get_functiondef(p.oid)),
      'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'proconfig',to_jsonb(p.proconfig),'prosecdef',p.prosecdef,
      'provolatile',p.provolatile,'proparallel',p.proparallel,'procost',p.procost,'prorows',p.prorows,
      'proisstrict',p.proisstrict,'proleakproof',p.proleakproof) into actual
    from pg_proc p where p.oid=to_regprocedure(expected->>'identity');
    if actual is distinct from expected then raise exception using errcode='22023',message='ready_reader_install_preflight_drift',detail=expected->>'identity';end if;
  end loop;
 select jsonb_object_agg(scope,private.prepared_aggregate_dependency_common(scope))into common_before from unnest(array['IN','BR','VN','ID','PK','ZAR','MX','CO'])scope;
 execute $ready_reader_definition_0$
CREATE OR REPLACE FUNCTION private.dashboard_serving_ready_read(p_page text, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare catalog jsonb;targets jsonb:='[]';q jsonb;t jsonb;c jsonb;baseq jsonb;k jsonb;
 commons jsonb:='{}';scope text;common text;dep text;reason text;items jsonb:='[]';response jsonb;payload jsonb;projection_base jsonb;
 a timestamptz;b timestamptz;local_a timestamp;local_b timestamp;at timestamptz:=statement_timestamp();
 j private.prepared_aggregate_jobs%rowtype;artifact private.prepared_aggregate_artifacts%rowtype;master record;
 profile text:=p_request->>'responseProfile';full_transport boolean:=coalesce(p_request->>'responseProfile'='time-v1',false);
begin
 -- The unchanged wrapper has already verified page/query/session/context.
 -- This helper is private, invoker-only, and cannot be called by API roles.
 if current_user<>'postgres'then raise exception using errcode='42501',message='prepared_ready_worker_denied';end if;
 if p_request is null or jsonb_typeof(p_request)is distinct from'object'
  or not coalesce(case when p_request?'responseProfile'then
   jsonb_typeof(p_request->'responseProfile')='string' and profile='time-v1'
   and p_page in('teamops','teamcountries','teamplatforms','time')
   else p_page in('providers','provider_payout','overview','merchants','teamops','teamcountries','teamplatforms')end,false)
  or p_request-array['requests','publicationVersion','readMode','responseProfile']<>'{}'::jsonb
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
   or coalesce(q->>'view','full')is distinct from(case when full_transport then'full'else'providers'end)then raise exception using errcode='22023',message='prepared_ready_query_invalid';end if;
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
  if c->>'status'<>'all'or c?'durationRange'or not coalesce(c->>'successBasis'in('success','created'),false)
   or c->>'successBasis'<>'created'and(a is distinct from(c->>'successStartAt')::timestamptz or b is distinct from(c->>'successEndAt')::timestamptz)
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
     and coalesce(z.request->>'successStartAt',z.request->>'startAt')::timestamptz=coalesce(c->>'successStartAt',c->>'startAt')::timestamptz
     and coalesce(z.request->>'successEndAt',z.request->>'endAt')::timestamptz=coalesce(c->>'successEndAt',c->>'endAt')::timestamptz
     and z.request->>'view'='full'and z.request->>'durationVersion'='2')
   select z.id job_id,x.id artifact_id into master from candidates z
    join private.prepared_aggregate_heads h on h.job_id=z.id
    join private.prepared_aggregate_artifacts x on x.id=h.artifact_id and x.job_id=z.id
    where x.dependency=dep and x.revision=z.revision
     and z.request_key=private.prepared_aggregate_key(z.request,t)and z.request_fingerprint=md5(z.request_key::text)
     and z.request->>'direction'='all'and not(z.request?'durationRange')and coalesce(z.request->>'status','all')='all'
     and case when not full_transport then
      coalesce(z.request->'providers','[]'::jsonb)='[]'::jsonb
      and(private.prepared_aggregate_canonical_request(z.request,t)-array['view','durationVersion','amountBands','direction','providers'])
        =(c-array['view','durationVersion','amountBands','direction','providers'])
     else
      -- Exact existing full-master semantics: unlike provider-only reads,
      -- full requests retain their provider and explicit amount-band filters.
      (private.prepared_aggregate_canonical_request(z.request,t)-array['durationVersion','direction']-case when not(c?'amountBands')then array['amountBands']else array[]::text[]end)
        =(c-array['durationVersion','direction'])
     end
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
  payload:=artifact.payload;projection_base:=private.prepared_aggregate_canonical_request(baseq,t);
  if full_transport and not(c?'amountBands')then
   -- Match the existing full-master adapter before its strict projection.
   payload:=jsonb_set(payload-array['amountBands','amountBandsVersion'],'{groups}',(payload->'groups')-array['amount_range','matrix_range']);
   projection_base:=projection_base-'amountBands';
  end if;
  payload:=case when baseq->>'view'='full'and baseq->>'durationVersion'='2'and not(baseq?'durationRange')
   then private.prepared_aggregate_master_projection(payload,projection_base,c)
   else private.dashboard_prepared_provider_projection(payload,projection_base,c)end;
  if full_transport then
   if jsonb_typeof(payload->'groups')is distinct from'object'
    or jsonb_typeof(payload#>'{groups,hourly}')is distinct from'array'
    or jsonb_typeof(payload#>'{groups,provider}')is distinct from'array'
   then raise exception using errcode='22023',message='prepared_ready_publication_invalid';end if;
   -- Same time-v1 transport as the ordinary compact reader, after the same
   -- full projection. All monetary totals, clocks and metadata remain intact.
   payload:=jsonb_set(payload,'{groups}',jsonb_build_object('hourly',payload#>'{groups,hourly}','provider',payload#>'{groups,provider}'));
  end if;
  items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','ready','publication',jsonb_build_object(
   'id',artifact.id,'generation',artifact.revision::text||':'||artifact.fence::text,'computedAt',artifact.computed_at,
   'expiresAt',artifact.expires_at,'cutoff',artifact.cutoff,'calculationComplete',true,'sourceComplete',artifact.source_complete,
   'freshness',case when artifact.expires_at>at and coalesce(private.dashboard_serving_recent_refresh_at(baseq,t,artifact.computed_at,at)>at,true)then'fresh'else'refresh_due'end,'nextRefreshAt',j.next_due_at,
   'interactiveRefreshAt',private.dashboard_serving_recent_refresh_at(baseq,t,artifact.computed_at,at),
   'refreshState',case when j.status='ready'then'idle'else j.status end),
   'result',private.prepared_aggregate_echo(payload,q,t))||case when full_transport then
    jsonb_build_object('resultGroups',jsonb_build_object('contract','prepared-result-groups-v1','profile','time-v1','groups',jsonb_build_array('hourly','provider')))
    else '{}'::jsonb end);
 end loop;
 response:=jsonb_build_object('version',2,'readMode','ready-only-v1','items',items);
 if octet_length(response::text)>16*1024*1024 then raise exception using errcode='54000',message='prepared_ready_response_capacity';end if;
 return response;
end;$function$
$ready_reader_definition_0$;
 execute $ready_reader_definition_1$
CREATE OR REPLACE FUNCTION private.dashboard_serving_compact_read(p_page text, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare profile text:=p_request->>'responseProfile';request jsonb;response jsonb;item jsonb;q jsonb;result jsonb;
 groups text[];projected jsonb;items jsonb:='[]';i integer:=0;
begin
 -- This helper is reached only after the existing wrapper's page/session/query
 -- authorization. The unchanged reader repeats its normal native checks.
 if jsonb_typeof(p_request)is distinct from'object'
  or p_request-array['requests','publicationVersion','forceRefresh','responseProfile']<>'{}'::jsonb
  or p_request->'publicationVersion'is distinct from'2'::jsonb
  or jsonb_typeof(p_request->'responseProfile')is distinct from'string'
  or profile is distinct from(case p_page when'time'then'time-v1'when'teamops'then'time-v1'when'teamcountries'then'time-v1'when'teamplatforms'then'time-v1'when'amount'then'amount-v1'when'latency'then'latency-v1'else null end)
  or profile is null or octet_length(p_request::text)>1048576
  or jsonb_typeof(p_request->'requests')is distinct from'array'
 then raise exception using errcode='22023',message='dashboard_serving_profile_invalid';end if;
 if jsonb_array_length(p_request->'requests')not between 1 and 3
  or p_request?'forceRefresh'and jsonb_typeof(p_request->'forceRefresh')is distinct from'boolean'
 then raise exception using errcode='22023',message='dashboard_serving_profile_invalid';end if;
 for q in select value from jsonb_array_elements(p_request->'requests')loop
  if jsonb_typeof(q)is distinct from'object'or q->>'action'is distinct from'aggregate'
   or coalesce(q->>'view','full')<>'full'or q?'durationRange'
   or profile='latency-v1'and q->'durationVersion'is distinct from'2'::jsonb
  then raise exception using errcode='22023',message='dashboard_serving_profile_query';end if;
 end loop;
 -- Full requests cannot use the provider-only daily rollup. Select the same
 -- existing master path, or its original reader fallback, exactly once.
 -- Never pass the transport hint into a canonical key or admission request.
 request:=p_request-'responseProfile';
 response:=private.dashboard_serving_master_reuse(p_page,request);
 if response is null then response:=private.prepared_aggregate_read(p_page,request);end if;
 if response->'version'is distinct from'2'::jsonb or jsonb_typeof(response->'items')is distinct from'array'
 then raise exception using errcode='22023',message='dashboard_serving_profile_response';end if;
 if jsonb_array_length(response->'items')<>jsonb_array_length(request->'requests')
 then raise exception using errcode='22023',message='dashboard_serving_profile_response';end if;
 for item in select value from jsonb_array_elements(response->'items')loop
  q:=request->'requests'->i;
  if item->'request'is distinct from q or item?'resultGroups'
  then raise exception using errcode='22023',message='dashboard_serving_profile_scope';end if;
  if item->>'status'='ready'then
   result:=item->'result';
   groups:=case profile when'time-v1'then array['hourly','provider']
    when'amount-v1'then case when q?'amountBands'then array['amount','amount_range','provider']else array['amount','provider']end
    when'latency-v1'then array['latency','latency_thresholds']end;
   if jsonb_typeof(result)is distinct from'object'or jsonb_typeof(result->'groups')is distinct from'object'
    or result?'_parts'or result?'_preparedPublication'
    or exists(select 1 from unnest(groups)g where jsonb_typeof(result->'groups'->g)is distinct from'array')
   then raise exception using errcode='22023',message='dashboard_serving_profile_groups';end if;
   select jsonb_object_agg(g,result->'groups'->g)into projected from unnest(groups)g;
   item:=jsonb_set(item,'{result,groups}',projected)||jsonb_build_object('resultGroups',
    jsonb_build_object('contract','prepared-result-groups-v1','profile',profile,'groups',to_jsonb(groups)));
  end if;
  items:=items||jsonb_build_array(item);i:=i+1;
 end loop;
 response:=jsonb_set(response,'{items}',items);
 if octet_length(response::text)>16*1024*1024 then raise exception using errcode='54000',message='dashboard_serving_response_capacity';end if;
 return response;
end;$function$
$ready_reader_definition_1$;
  for expected in select value from jsonb_array_elements('[{"identity":"private.dashboard_admin_daily_provider_prepared_read(text,jsonb)","body_md5":"b122e68a38ccb93dfb27fbd7e235fb8f","definition_md5":"6d453d257b02b6bd5362abb49bb5d292","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"v","proparallel":"u","procost":100,"prorows":0,"proisstrict":false,"proleakproof":false},{"identity":"private.dashboard_serving_compact_read(text,jsonb)","body_md5":"a075072ddcfdf1132798f8d63faf39ee","definition_md5":"ac85fc32654644b51e18dc85812678ac","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"v","proparallel":"u","procost":100,"prorows":0,"proisstrict":false,"proleakproof":false},{"identity":"private.dashboard_serving_ready_read(text,jsonb)","body_md5":"42178aad7635d27511812fdba662ea78","definition_md5":"cb5ed7d1ca82195e2f24208f37ab46b5","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"s","proparallel":"u","procost":100,"prorows":0,"proisstrict":false,"proleakproof":false},{"identity":"private.prepared_aggregate_master_projection(jsonb,jsonb,jsonb)","body_md5":"0909f6961bc2fe1de9101af88396760b","definition_md5":"0d13d39347899ee453179c1b7851d749","owner":"postgres","acl":"{postgres=X/postgres}","proconfig":["search_path=\"\""],"prosecdef":false,"provolatile":"s","proparallel":"u","procost":100,"prorows":0,"proisstrict":false,"proleakproof":false}]'::jsonb) loop
    select jsonb_build_object('identity',p.oid::regprocedure::text,'body_md5',md5(p.prosrc),'definition_md5',md5(pg_get_functiondef(p.oid)),
      'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'proconfig',to_jsonb(p.proconfig),'prosecdef',p.prosecdef,
      'provolatile',p.provolatile,'proparallel',p.proparallel,'procost',p.procost,'prorows',p.prorows,
      'proisstrict',p.proisstrict,'proleakproof',p.proleakproof) into actual
    from pg_proc p where p.oid=to_regprocedure(expected->>'identity');
    if actual is distinct from expected then raise exception using errcode='22023',message='ready_reader_install_postflight_drift',detail=expected->>'identity';end if;
  end loop;
 select jsonb_object_agg(scope,private.prepared_aggregate_dependency_common(scope))into common_after from unnest(array['IN','BR','VN','ID','PK','ZAR','MX','CO'])scope;
 if common_after is distinct from common_before then raise exception using errcode='22023',message='ready_reader_financial_dependency_changed';end if;
end;$ready_reader_change$;
COMMIT;
