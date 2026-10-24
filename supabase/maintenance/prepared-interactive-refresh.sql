-- Recent native-day interactive refresh through existing ready job CAS only.
-- Installation changes no source orders, jobs, artifact heads or schedule settings.
begin;
set local statement_timeout='8s';
set local lock_timeout='500ms';
do $migration$
declare e record;actual jsonb;before_deps jsonb;after_deps jsonb;before_provider jsonb;after_provider jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='interactive_recent_owner_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('interactive_recent_refresh_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('wg_health_batch_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('withdraw_submitted_success_v1',0))then raise exception'interactive_recent_install_busy';end if;
 for e in select key signature,value metadata from jsonb_each($expected${"private.prepared_aggregate_read(text,jsonb)":{"acl":"{postgres=X/postgres}","args":"p_page text, p_request jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"7d883a550ee3d9f282552286b9649f7c","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"v","securityDefiner":true},"private.dashboard_serving_ready_read(text,jsonb)":{"acl":"{postgres=X/postgres}","args":"p_page text, p_request jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"8e096fcf2e3bf216ec9000447c5cc95b","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.dashboard_admin_live_sync_health_rows(timestamp with time zone)":{"acl":"{postgres=X/postgres}","args":"p_asof timestamp with time zone","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\"","jit=off"],"result":"TABLE(country text, team text, platform text, platform_id uuid, source_system text, source_kind text, dataset text, direction text, data_date date, timezone text, status text, received boolean, evidence text, last_received_at timestamp with time zone)","strict":false,"bodyMd5":"0450b8dc45173e9e9f8448e9874146b7","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":true},"private.dashboard_admin_wg_day_evidence(text,text,date)":{"acl":"{postgres=X/postgres}","args":"p_site text, p_business text, p_date date","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"5f29e7114787442db7c502c16f07cd93","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":true},"private.provider_snapshot_dependency_token(jsonb)":{"acl":"{postgres=X/postgres}","args":"p_target jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"7063c3a30384df10b399a7e20ad3612c","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.prepared_aggregate_dependency_common(text)":{"acl":"{postgres=X/postgres}","args":"p_scope text","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"cfee7ea2785d396387dddd2007fa5bf8","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.provider_snapshot_dependency_batch(jsonb)":{"acl":"{postgres=X/postgres}","args":"p_targets jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"5290b2fd082795cb5805aea66536cd8c","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.dashboard_withdraw_status_dependency_md5(pg_proc)":{"acl":"{postgres=X/postgres}","args":"p pg_proc","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"87123b179991627c7d56b66e48f67f1e","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.dashboard_admin_wg_sites()":{"acl":"{postgres=X/postgres}","args":"","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\""],"result":"TABLE(site_code text, country_code text, country text, platform text, timezone text, currency text)","strict":false,"bodyMd5":"839401f31117192068b395d1c9580230","language":"sql","parallel":"u","leakproof":false,"volatility":"i","securityDefiner":false},"private.dashboard_health_wg_evidence_format(bigint,timestamptz,boolean,boolean,timestamptz,timestamptz)":{"acl":"{postgres=X/postgres}","args":"n bigint, seen timestamp with time zone, covered boolean, has_window boolean, hi timestamp with time zone, asof timestamp with time zone","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"98d86e2c8aee47aca8b6d9e2d0170112","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.dashboard_health_wg_evidence_batch(text,text,date,date)":{"acl":"{postgres=X/postgres}","args":"p_site text, p_business text, p_from date, p_to date","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"940523afd7eccfb09a11b27eadd11b54","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":true}}$expected$::jsonb)loop
 select jsonb_build_object('bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'language',(select lanname from pg_language where oid=p.prolang),'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p where p.oid=to_regprocedure(e.signature);
 if actual is distinct from e.metadata then raise exception'interactive_recent_contract_drift:%',e.signature;end if;end loop;
 if to_regprocedure('private.dashboard_serving_recent_refresh_at(jsonb,jsonb,timestamptz,timestamptz)')is not null then raise exception'interactive_recent_helper_exists';end if;
 with native as materialized(select to_jsonb(n)t,n.scope_group from private.prepared_aggregate_native_catalog()n),scopes as(select unnest(array['IN','BR','BR_PANGHU','PK','PH','ID'])s union select scope_group from native),common as materialized(select s,private.prepared_aggregate_dependency_common(s)d from scopes),tokens as(select 'scope:'||s k,d v from common union all select 'native:'||(n.t->>'id'),private.prepared_aggregate_dependency(n.t,c.d)from native n join common c on c.s=n.scope_group union all select 'withdraw',private.withdraw_prepared_dependency() union all select 'reason',private.withdraw_reason_dependency())select jsonb_object_agg(k,v order by k)into before_deps from tokens;
 if before_deps is null or(select count(*)from jsonb_each(before_deps)where key like 'scope:%')<6 or(select count(*)from jsonb_each(before_deps)where key like 'native:%')<1 or exists(select 1 from jsonb_each(before_deps)where value='null'::jsonb or jsonb_typeof(value)<>'string' or value#>>'{}'='')then raise exception'interactive_recent_dependency_missing';end if;
 select private.provider_snapshot_dependency_batch((select jsonb_agg(to_jsonb(n))from private.prepared_aggregate_native_catalog()n))into before_provider;
 if before_provider is null or exists(select 1 from jsonb_each(before_provider)x where x.value->>'token'is null)then raise exception'interactive_recent_provider_proof_missing';end if;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_serving_recent_refresh_at(q jsonb,t jsonb,p_computed timestamptz,p_now timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path='' AS $function$
DECLARE a timestamptz;b timestamptz;la timestamp;lb timestamp;today date;seconds integer;
BEGIN
 -- Query-only policy. The scheduled 08:00/20:00 historical policy is unchanged.
 -- Caller has already authorized the exact native identity and validated q.
 IF q->>'successBasis' IS DISTINCT FROM 'created' OR q?|ARRAY['successStartAt','successEndAt']
  OR coalesce(q->>'view','full')NOT IN('providers','full') OR p_computed IS NULL OR p_now IS NULL
  OR NOT isfinite(p_computed)OR NOT isfinite(p_now)OR p_computed>p_now THEN RETURN NULL;END IF;
 a:=(q->>'startAt')::timestamptz;b:=(q->>'endAt')::timestamptz;
 IF a IS NULL OR b IS NULL OR NOT isfinite(a)OR NOT isfinite(b)OR a>=b THEN RETURN NULL;END IF;
 la:=a AT TIME ZONE(t->>'timezone');lb:=b AT TIME ZONE(t->>'timezone');today:=(p_now AT TIME ZONE(t->>'timezone'))::date;
 IF la<>date_trunc('day',la)OR lb<>date_trunc('day',lb)OR lb::date<>la::date+1
  OR la::date NOT BETWEEN today-2 AND today THEN RETURN NULL;END IF;
 SELECT current_interval_seconds INTO seconds FROM private.prepared_aggregate_schedule WHERE singleton;
 IF seconds IS NULL OR seconds<=0 THEN RETURN NULL;END IF;
 RETURN p_computed+make_interval(secs=>seconds);
END;$function$;
$definition$;
 alter function private.dashboard_serving_recent_refresh_at(jsonb,jsonb,timestamptz,timestamptz) owner to postgres;
 revoke all on function private.dashboard_serving_recent_refresh_at(jsonb,jsonb,timestamptz,timestamptz) from public,anon,authenticated,service_role;
 execute $definition$CREATE OR REPLACE FUNCTION private.prepared_aggregate_read(p_page text, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare access jsonb;page jsonb;catalog jsonb;targets jsonb:='[]';q jsonb;t jsonb;items jsonb:='[]';reason text;dep text;k jsonb;j private.prepared_aggregate_jobs%rowtype;a private.prepared_aggregate_artifacts%rowtype;status text;v_id uuid;v_actor uuid:=auth.uid();budget integer;ctx jsonb;baseq jsonb;payload jsonb;commons jsonb:='{}';scope text;common text;v2 boolean;force_refresh boolean;freshness text;admitted_id uuid;preparation jsonb;transition jsonb;recent_due timestamptz;
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
   recent_due:=case when v2 then private.dashboard_serving_recent_refresh_at(baseq,t,a.computed_at,statement_timestamp())else null end;
   if v2 and(force_refresh or recent_due<=clock_timestamp()or(a.expires_at<=clock_timestamp()and coalesce(j.next_due_at,a.expires_at)<=clock_timestamp()))then
    update private.prepared_aggregate_jobs z set status='queued',attempts=0,not_before=clock_timestamp(),
     priority=case when recent_due<=clock_timestamp()then greatest(z.priority,20)else z.priority end,
     interactive_requested_at=case when recent_due<=clock_timestamp()then coalesce(z.interactive_requested_at,clock_timestamp())else z.interactive_requested_at end
     where z.id=j.id and z.status='ready'and z.revision=j.revision and z.dependency=dep and z.target=t
      -- A delayed read may not requeue a newer publication that completed meanwhile.
      and(force_refresh or z.fence=a.fence and exists(select 1 from private.prepared_aggregate_heads h where h.job_id=z.id and h.artifact_id=a.id));
    select *into j from private.prepared_aggregate_jobs where id=j.id;
    select a0.*into a from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a0 on a0.id=h.artifact_id where h.job_id=j.id;
    if a.id is null or a.dependency is distinct from dep or j.revision is distinct from a.revision or j.dependency is distinct from dep or j.target is distinct from t then
     items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','stale','publication',null,'result',null));continue;
    end if;
   end if;
   recent_due:=case when v2 then private.dashboard_serving_recent_refresh_at(baseq,t,a.computed_at,statement_timestamp())else null end;
   freshness:=case when a.expires_at>clock_timestamp()and(recent_due is null or recent_due>clock_timestamp())then'fresh'else'refresh_due'end;
   payload:=case when baseq->>'view'='full'and baseq->>'durationVersion'='2'and not(baseq?'durationRange')then private.prepared_aggregate_master_projection(a.payload,private.prepared_aggregate_canonical_request(baseq,t),private.prepared_aggregate_canonical_request(q,t))when coalesce(q->>'view','full')='providers'then private.dashboard_prepared_provider_projection(a.payload,private.prepared_aggregate_canonical_request(baseq,t),private.prepared_aggregate_canonical_request(q,t))when baseq->>'direction'='all'then private.dashboard_prepared_direction_projection(a.payload,private.prepared_aggregate_canonical_request(baseq,t),private.prepared_aggregate_canonical_request(q,t))else a.payload end;
   update private.prepared_aggregate_jobs set last_requested_at=clock_timestamp()where id=j.id and last_requested_at<clock_timestamp()-interval'5minutes';
   items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','ready','publication',jsonb_build_object('id',a.id,'generation',a.revision::text||':'||a.fence::text,'computedAt',a.computed_at,'expiresAt',a.expires_at,'cutoff',a.cutoff,'calculationComplete',true,'sourceComplete',a.source_complete)||case when v2 then jsonb_build_object('freshness',freshness,'interactiveRefreshAt',recent_due,'nextRefreshAt',j.next_due_at,'refreshState',case when j.status='ready'then'idle'else j.status end)else'{}'::jsonb end,
    'result',private.prepared_aggregate_echo(coalesce(payload,a.payload),q,t)));
  else
   transition:=case when v2 and not force_refresh then private.dashboard_created_manual_transition(q,t,dep)else null end;
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
   if transition is not null and preparation->>'state'in('idle','queued','running','failed')then
    -- Same original queue admission, same authorization; old manual facts keep
    -- their old generation and timestamps and can never answer created mode.
    items:=items||jsonb_build_array(jsonb_build_object('request',q,'status','ready',
     'publication',(transition->'publication')||jsonb_build_object('refreshState',preparation->>'state','nextRefreshAt',j.next_due_at),
     'result',transition->'result'));
   else
   items:=items||jsonb_build_array(jsonb_build_object('request',q,'status',status,'publication',null,'result',null,'preparation',preparation));
   end if;
  end if;
 end loop;
 return jsonb_build_object('version',case when v2 then 2 else 1 end,'items',items);
end;$function$

$definition$;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_serving_ready_read(p_page text, p_request jsonb)
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
   'freshness',case when artifact.expires_at>at and coalesce(private.dashboard_serving_recent_refresh_at(baseq,t,artifact.computed_at,at)>at,true)then'fresh'else'refresh_due'end,'nextRefreshAt',j.next_due_at,
   'interactiveRefreshAt',private.dashboard_serving_recent_refresh_at(baseq,t,artifact.computed_at,at),
   'refreshState',case when j.status='ready'then'idle'else j.status end),
   'result',private.prepared_aggregate_echo(payload,q,t)));
 end loop;
 response:=jsonb_build_object('version',2,'readMode','ready-only-v1','items',items);
 if octet_length(response::text)>16*1024*1024 then raise exception using errcode='54000',message='prepared_ready_response_capacity';end if;
 return response;
end;$function$

$definition$;
 execute $definition$CREATE OR REPLACE FUNCTION private.dashboard_withdraw_status_dependency_md5(p pg_proc)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE actual jsonb; formatter jsonb; recent_policy jsonb; expected jsonb; callsite text; self_hash text;
BEGIN
 IF NOT coalesce(p.oid=ANY(ARRAY[to_regprocedure('private.prepared_aggregate_read(text,jsonb)'),to_regprocedure('private.dashboard_admin_wg_day_evidence(text,text,date)'),to_regprocedure('private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)'),to_regprocedure('private.prepared_aggregate_dependency_common(text)'),to_regprocedure('private.provider_snapshot_dependency_token(jsonb)')]),false)THEN RETURN md5(p.prosrc);END IF;
 actual:=jsonb_build_object('bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'language',(select lanname from pg_language where oid=p.prolang),'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid));
 -- Exact recent-query serving policy does not change financial computation.
 -- Pin both complete bodies and privilege metadata; unknown changes fail closed.
 IF p.oid=to_regprocedure('private.prepared_aggregate_read(text,jsonb)')THEN
  SELECT jsonb_build_object('bodyMd5',md5(f.prosrc),'owner',pg_get_userbyid(f.proowner),'acl',f.proacl::text,'config',f.proconfig,'securityDefiner',f.prosecdef,'volatility',f.provolatile,'strict',f.proisstrict,'parallel',f.proparallel,'leakproof',f.proleakproof,'cost',f.procost,'rows',f.prorows,'language',(select lanname from pg_language where oid=f.prolang),'args',pg_get_function_arguments(f.oid),'result',pg_get_function_result(f.oid)) INTO recent_policy FROM pg_proc f WHERE f.oid=to_regprocedure('private.dashboard_serving_recent_refresh_at(jsonb,jsonb,timestamptz,timestamptz)');
  IF actual='{"acl":"{postgres=X/postgres}","args":"p_page text, p_request jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"af7b326943db608cc00811542f3a9eb8","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"v","securityDefiner":true}'::jsonb AND recent_policy='{"acl":"{postgres=X/postgres}","args":"q jsonb, t jsonb, p_computed timestamp with time zone, p_now timestamp with time zone","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"timestamp with time zone","strict":false,"bodyMd5":"422aa5d2532a6b8780f11aa3d5898e36","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false}'::jsonb THEN RETURN '7d883a550ee3d9f282552286b9649f7c';END IF;
  RETURN md5(actual::text||coalesce(recent_policy::text,'missing'));
 END IF;
 -- The WG day reader only delegates its unchanged final JSON decisions.
 -- All source acquisition is byte-identical; pin its one shared formatter too.
 IF p.oid=to_regprocedure('private.dashboard_admin_wg_day_evidence(text,text,date)')THEN
  SELECT jsonb_build_object('bodyMd5',md5(f.prosrc),'owner',pg_get_userbyid(f.proowner),'acl',f.proacl::text,'config',f.proconfig,'securityDefiner',f.prosecdef,'volatility',f.provolatile,'strict',f.proisstrict,'parallel',f.proparallel,'leakproof',f.proleakproof,'cost',f.procost,'rows',f.prorows,'language',(select lanname from pg_language where oid=f.prolang),'args',pg_get_function_arguments(f.oid),'result',pg_get_function_result(f.oid)) INTO formatter FROM pg_proc f WHERE f.oid=to_regprocedure('private.dashboard_health_wg_evidence_format(bigint,timestamptz,boolean,boolean,timestamptz,timestamptz)');
  IF actual='{"acl":"{postgres=X/postgres}","args":"p_site text, p_business text, p_date date","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"5f29e7114787442db7c502c16f07cd93","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":true}'::jsonb AND formatter='{"acl":"{postgres=X/postgres}","args":"n bigint, seen timestamp with time zone, covered boolean, has_window boolean, hi timestamp with time zone, asof timestamp with time zone","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"98d86e2c8aee47aca8b6d9e2d0170112","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false}'::jsonb THEN RETURN 'ddbf8cae0223fec61ac59f81b60dce14';END IF;
  -- Unknown downstream body or privilege drift must continue to advance the token.
  RETURN md5(actual::text||coalesce(formatter::text,'missing'));
 END IF;
 -- This AR daily reader is not a generic/prepared/provider computation consumer.
 IF p.oid=to_regprocedure('private.dashboard_admin_ar_withdraw_days(jsonb,jsonb,date,date)')
  AND actual='{"acl":"{postgres=X/postgres}","args":"p_request jsonb, p_scope jsonb, p_start date, p_end date","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\""],"result":"TABLE(data_date date, country text, platform text, platform_key text, total bigint, success bigint, rejected bigint, auto_count bigint, manual_count bigint, avg_seconds numeric, duration_sample_count bigint, duration_total_seconds numeric, source_updated_at timestamp with time zone, updated_at timestamp with time zone, complete boolean, operator_rows jsonb, alias_keys text[])","strict":false,"bodyMd5":"43f204f10037840a839c9890d127e274","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false}'::jsonb THEN RETURN '173bf1a012f07d69942571724ff8f658';END IF;
 -- Normalize only one exact, pinned call-site in these two complete original bodies.
 -- Other routines, unexpected source, signature or metadata always retain actual MD5.
 SELECT value INTO expected FROM jsonb_each('{"private.prepared_aggregate_dependency_common(text)":{"acl":"{postgres=X/postgres}","args":"p_scope text","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"36966b6e1e434eb6d5990e551f816b8e","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.provider_snapshot_dependency_token(jsonb)":{"acl":"{postgres=X/postgres}","args":"p_target jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"ccf807a978ba7f0d3cb9f527dad6c5d4","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false}}'::jsonb)WHERE to_regprocedure(key)=p.oid;
 IF expected IS NULL OR (actual-'bodyMd5') IS DISTINCT FROM(expected-'bodyMd5')THEN RETURN md5(p.prosrc);END IF;
 SELECT md5(h.prosrc)INTO self_hash FROM pg_proc h WHERE h.oid=to_regprocedure('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)');
 callsite:=replace($callsite$CASE WHEN EXISTS(SELECT 1 FROM pg_proc h WHERE h.oid=to_regprocedure('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)') AND md5(h.prosrc)='__HELPER_BODY__' AND pg_get_userbyid(h.proowner)='postgres' AND h.proacl::text='{postgres=X/postgres}' AND h.proconfig=ARRAY['search_path=""'] AND NOT h.prosecdef AND h.provolatile='s' AND NOT h.proisstrict AND NOT h.proleakproof AND h.proparallel='u' AND h.procost=100 AND h.prorows=0 AND NOT h.proretset AND h.prorettype='text'::regtype AND h.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND pg_get_function_arguments(h.oid)='p pg_proc') THEN private.dashboard_withdraw_status_dependency_md5(p) ELSE md5(p.prosrc) END$callsite$,'__HELPER_BODY__',self_hash);
 IF self_hash IS NULL OR length(p.prosrc)-length(replace(p.prosrc,callsite,''))<>length(callsite)
  OR md5(replace(p.prosrc,callsite,'md5(p.prosrc)'))IS DISTINCT FROM expected->>'bodyMd5'
 THEN RETURN md5(p.prosrc);END IF;
 RETURN expected->>'bodyMd5';
END;$function$
$definition$;
 execute $definition$CREATE OR REPLACE FUNCTION private.prepared_aggregate_dependency_common(p_scope text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select md5(jsonb_build_object(
  'contract','exact-prepared-dual-clock-v1',
  'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),CASE WHEN EXISTS(SELECT 1 FROM pg_proc h WHERE h.oid=to_regprocedure('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)') AND md5(h.prosrc)='1cfe700c87c0fa33bee5d0586cb78853' AND pg_get_userbyid(h.proowner)='postgres' AND h.proacl::text='{postgres=X/postgres}' AND h.proconfig=ARRAY['search_path=""'] AND NOT h.prosecdef AND h.provolatile='s' AND NOT h.proisstrict AND NOT h.proleakproof AND h.proparallel='u' AND h.procost=100 AND h.prorows=0 AND NOT h.proretset AND h.prorettype='text'::regtype AND h.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND pg_get_function_arguments(h.oid)='p pg_proc') THEN private.dashboard_withdraw_status_dependency_md5(p) ELSE md5(p.prosrc) END,p.proconfig,p.prosecdef,p.provolatile,pg_get_userbyid(p.proowner),p.proacl::text,(select l.lanname from pg_language l where l.oid=p.prolang),p.proparallel,p.proisstrict,p.proleakproof,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),p.procost,p.prorows)order by n.nspname,p.proname,p.oid)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_prepared_%' or p.proname like 'prepared_aggregate_%' or p.proname like 'dashboard_admin_duoli_%' or p.proname like 'dashboard_admin_panda_%' or p.proname like 'dashboard_admin_wg_%' or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')),
  -- Fee outputs consume immutable versions, category presence and evidence eligibility,
  -- not the sheet publisher's observation/generation identity. Keep all IN directions.
  'feeSemantics',jsonb_build_object(
   'versions',(select coalesce(jsonb_agg(to_jsonb(v)order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country=p_scope),
   'openIntervalEvidence',(select coalesce(jsonb_agg(jsonb_build_array(v.id,
    exists(select 1 from private.fee_rate_current_evidence e
     join private.fee_rate_generations g on g.id=e.generation_id
     join public.third_party_rates r on r.id=e.source_id
     where e.rule_key=v.rule_key and e.version_id=v.id and e.state='ready'
      and r.updated_at=g.published_at))order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country=p_scope),
   'sourceCategories',(select coalesce(jsonb_agg(category order by category),'[]'::jsonb)
    from(select distinct upper(btrim(r.category)) category from public.third_party_rates r
     where private.dashboard_data_group(r.country,'')=p_scope) categories),
   'blockingEvidence',(select coalesce(jsonb_agg(jsonb_build_array(direction,category,provider)
    order by direction,category,provider),'[]'::jsonb)
    from(select distinct bad.direction,upper(btrim(r.category)) category,r.third_party provider
     from private.fee_rate_current_evidence bad
     join public.third_party_rates r on r.id=bad.source_id
     join private.fee_rate_generations generation on generation.id=bad.generation_id
     where (bad.version_id is null or bad.state<>'ready'
       or r.updated_at is distinct from generation.published_at)
      and private.dashboard_data_group(r.country,'')=p_scope) blockers)
  )
 )::text);
$function$
$definition$;
 execute $definition$CREATE OR REPLACE FUNCTION private.provider_snapshot_dependency_token(p_target jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select md5(jsonb_build_object(
  'contract','provider-published-v1',
  'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),CASE WHEN EXISTS(SELECT 1 FROM pg_proc h WHERE h.oid=to_regprocedure('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)') AND md5(h.prosrc)='1cfe700c87c0fa33bee5d0586cb78853' AND pg_get_userbyid(h.proowner)='postgres' AND h.proacl::text='{postgres=X/postgres}' AND h.proconfig=ARRAY['search_path=""'] AND NOT h.prosecdef AND h.provolatile='s' AND NOT h.proisstrict AND NOT h.proleakproof AND h.proparallel='u' AND h.procost=100 AND h.prorows=0 AND NOT h.proretset AND h.prorettype='text'::regtype AND h.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND pg_get_function_arguments(h.oid)='p pg_proc') THEN private.dashboard_withdraw_status_dependency_md5(p) ELSE md5(p.prosrc) END,p.proconfig,p.prosecdef,p.provolatile,pg_get_userbyid(p.proowner),p.proacl::text,(select l.lanname from pg_language l where l.oid=p.prolang),p.proparallel,p.proisstrict,p.proleakproof,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),p.procost,p.prorows)order by n.nspname,p.proname,p.oid)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')),
  -- Fee outputs consume immutable versions, category presence and evidence eligibility,
  -- not the sheet publisher's observation/generation identity. Keep all IN directions.
  'feeSemantics',jsonb_build_object(
   'versions',(select coalesce(jsonb_agg(to_jsonb(v)order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country='IN'),
   'openIntervalEvidence',(select coalesce(jsonb_agg(jsonb_build_array(v.id,
    exists(select 1 from private.fee_rate_current_evidence e
     join private.fee_rate_generations g on g.id=e.generation_id
     join public.third_party_rates r on r.id=e.source_id
     where e.rule_key=v.rule_key and e.version_id=v.id and e.state='ready'
      and r.updated_at=g.published_at))order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country='IN'),
   'sourceCategories',(select coalesce(jsonb_agg(category order by category),'[]'::jsonb)
    from(select distinct upper(btrim(r.category)) category from public.third_party_rates r
     where private.dashboard_data_group(r.country,'')='IN') categories),
   'blockingEvidence',(select coalesce(jsonb_agg(jsonb_build_array(direction,category,provider)
    order by direction,category,provider),'[]'::jsonb)
    from(select distinct bad.direction,upper(btrim(r.category)) category,r.third_party provider
     from private.fee_rate_current_evidence bad
     join public.third_party_rates r on r.id=bad.source_id
     join private.fee_rate_generations generation on generation.id=bad.generation_id
     where (bad.version_id is null or bad.state<>'ready'
       or r.updated_at is distinct from generation.published_at)
      and private.dashboard_data_group(r.country,'')='IN') blockers)
  ),
  'registry',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_values)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_registry where country in('IN','印度')and platform in(p_target->>'name',p_target->>'source_name')),
  'overrides',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_provider,version)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_overrides where country in('IN','印度')and platform in(p_target->>'name',p_target->>'source_name')),
  'confirmations',(select coalesce(jsonb_agg(jsonb_build_array(order_kind,order_no,confirmed_provider)order by order_kind,order_no),'[]'::jsonb)
    from private.dashboard_admin_order_provider_confirmations where source_system='AR'and p_target->>'source'='ar'and country_code=p_target->>'scope_group'and platform=p_target->>'source_name'and active),
  'currencyProof',(select coalesce(jsonb_agg(jsonb_build_array(source_system,country_code,platform,currency)order by source_system,country_code,platform),'[]'::jsonb)
    from public.ar_config_targets where p_target->>'source'='ar'and source_system='AR'and country_code=p_target->>'scope_group'and platform=p_target->>'source_name')
 )::text);
$function$
$definition$;
 execute $definition$CREATE OR REPLACE FUNCTION private.provider_snapshot_dependency_batch(p_targets jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH shared AS MATERIALIZED (
 SELECT jsonb_build_object(
  'contract','provider-published-v1',
  'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),CASE WHEN EXISTS(SELECT 1 FROM pg_proc h WHERE h.oid=to_regprocedure('private.dashboard_withdraw_status_dependency_md5(pg_catalog.pg_proc)') AND md5(h.prosrc)='1cfe700c87c0fa33bee5d0586cb78853' AND pg_get_userbyid(h.proowner)='postgres' AND h.proacl::text='{postgres=X/postgres}' AND h.proconfig=ARRAY['search_path=""'] AND NOT h.prosecdef AND h.provolatile='s' AND NOT h.proisstrict AND NOT h.proleakproof AND h.proparallel='u' AND h.procost=100 AND h.prorows=0 AND NOT h.proretset AND h.prorettype='text'::regtype AND h.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND pg_get_function_arguments(h.oid)='p pg_proc') THEN private.dashboard_withdraw_status_dependency_md5(p) ELSE md5(p.prosrc) END,p.proconfig,p.prosecdef,p.provolatile,pg_get_userbyid(p.proowner),p.proacl::text,(select l.lanname from pg_language l where l.oid=p.prolang),p.proparallel,p.proisstrict,p.proleakproof,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),p.procost,p.prorows)order by n.nspname,p.proname,p.oid)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname=any(array[
    'dashboard_admin_live_query_raw','dashboard_admin_live_query','dashboard_admin_live_submission_analysis','dashboard_admin_live_intake_coverage',
    'dashboard_admin_live_remap_groups','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_intake_order_feeds',
    'dashboard_admin_live_provider_canonical','dashboard_admin_wg_provider_aliases','dashboard_admin_live_provider_alias','dashboard_admin_live_provider_alias_values','dashboard_admin_live_confirmed_provider',
    'dashboard_data_group','dashboard_admin_fee_intervals','dashboard_admin_fee_category','dashboard_admin_ar_local_amount','provider_snapshot_dependency_token',
    'provider_snapshot_orders_raw_kernel','provider_snapshot_orders_result_kernel','provider_snapshot_submission_kernel',
    'provider_snapshot_order_feeds_kernel','provider_snapshot_intake_rows_kernel','provider_snapshot_compute_payload',
    'provider_snapshot_native_catalog','provider_snapshot_target_current','provider_snapshot_kernel_contract_current','dashboard_admin_live_platforms'])
    or p.proname like 'dashboard_admin_yash_%'or p.proname like 'ar_91club_submission_%'or p.proname like 'ar_submission_fact_%'or p.proname like 'maan_submission_%'
    or p.proname like 'dashboard_admin_fee_%'or p.proname like 'dashboard_admin_ar_%'or p.proname like 'dashboard_admin_order_business_%')),
  -- Fee outputs consume immutable versions, category presence and evidence eligibility,
  -- not the sheet publisher's observation/generation identity. Keep all IN directions.
  'feeSemantics',jsonb_build_object(
   'versions',(select coalesce(jsonb_agg(to_jsonb(v)order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country='IN'),
   'openIntervalEvidence',(select coalesce(jsonb_agg(jsonb_build_array(v.id,
    exists(select 1 from private.fee_rate_current_evidence e
     join private.fee_rate_generations g on g.id=e.generation_id
     join public.third_party_rates r on r.id=e.source_id
     where e.rule_key=v.rule_key and e.version_id=v.id and e.state='ready'
      and r.updated_at=g.published_at))order by v.id),'[]'::jsonb)
    from private.fee_rate_versions v where v.country='IN'),
   'sourceCategories',(select coalesce(jsonb_agg(category order by category),'[]'::jsonb)
    from(select distinct upper(btrim(r.category)) category from public.third_party_rates r
     where private.dashboard_data_group(r.country,'')='IN') categories),
   'blockingEvidence',(select coalesce(jsonb_agg(jsonb_build_array(direction,category,provider)
    order by direction,category,provider),'[]'::jsonb)
    from(select distinct bad.direction,upper(btrim(r.category)) category,r.third_party provider
     from private.fee_rate_current_evidence bad
     join public.third_party_rates r on r.id=bad.source_id
     join private.fee_rate_generations generation on generation.id=bad.generation_id
     where (bad.version_id is null or bad.state<>'ready'
       or r.updated_at is distinct from generation.published_at)
      and private.dashboard_data_group(r.country,'')='IN') blockers)
  )
 ) value
), targets AS MATERIALIZED (SELECT value target FROM jsonb_array_elements(p_targets)), dependencies AS MATERIALIZED (
 SELECT t.target,md5((s.value||jsonb_build_object(
  'registry',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_values)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_registry where country in('IN','印度')and platform in(t.target->>'name',t.target->>'source_name')),
  'overrides',(select coalesce(jsonb_agg(jsonb_build_array(country,platform,raw_provider,canonical_provider,version)order by country,platform,raw_provider),'[]'::jsonb)
    from private.dashboard_admin_provider_overrides where country in('IN','印度')and platform in(t.target->>'name',t.target->>'source_name')),
  'confirmations',(select coalesce(jsonb_agg(jsonb_build_array(order_kind,order_no,confirmed_provider)order by order_kind,order_no),'[]'::jsonb)
    from private.dashboard_admin_order_provider_confirmations where source_system='AR'and t.target->>'source'='ar'and country_code=t.target->>'scope_group'and platform=t.target->>'source_name'and active),
  'currencyProof',(select coalesce(jsonb_agg(jsonb_build_array(source_system,country_code,platform,currency)order by source_system,country_code,platform),'[]'::jsonb)
    from public.ar_config_targets where t.target->>'source'='ar'and source_system='AR'and country_code=t.target->>'scope_group'and platform=t.target->>'source_name')
 
 ))::text) token
 FROM targets t CROSS JOIN shared s
)
SELECT jsonb_object_agg(target->>'id',jsonb_build_object('target',target,'token',token)) FROM dependencies;
$function$
$definition$;
 for e in select key signature,value metadata from jsonb_each($expected${"private.prepared_aggregate_read(text,jsonb)":{"acl":"{postgres=X/postgres}","args":"p_page text, p_request jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"af7b326943db608cc00811542f3a9eb8","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"v","securityDefiner":true},"private.dashboard_serving_ready_read(text,jsonb)":{"acl":"{postgres=X/postgres}","args":"p_page text, p_request jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"8d18e88fce406e9bfe201bc668466121","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.dashboard_admin_live_sync_health_rows(timestamp with time zone)":{"acl":"{postgres=X/postgres}","args":"p_asof timestamp with time zone","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\"","jit=off"],"result":"TABLE(country text, team text, platform text, platform_id uuid, source_system text, source_kind text, dataset text, direction text, data_date date, timezone text, status text, received boolean, evidence text, last_received_at timestamp with time zone)","strict":false,"bodyMd5":"0450b8dc45173e9e9f8448e9874146b7","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":true},"private.dashboard_admin_wg_day_evidence(text,text,date)":{"acl":"{postgres=X/postgres}","args":"p_site text, p_business text, p_date date","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"5f29e7114787442db7c502c16f07cd93","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":true},"private.provider_snapshot_dependency_token(jsonb)":{"acl":"{postgres=X/postgres}","args":"p_target jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"e1ec0a067e0b1d15933fe37c57b72c97","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.prepared_aggregate_dependency_common(text)":{"acl":"{postgres=X/postgres}","args":"p_scope text","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"9cba93eff52a872313d36e040b8e494d","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.provider_snapshot_dependency_batch(jsonb)":{"acl":"{postgres=X/postgres}","args":"p_targets jsonb","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"6642e49d7d66acef482795a28e1b330b","language":"sql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.dashboard_withdraw_status_dependency_md5(pg_proc)":{"acl":"{postgres=X/postgres}","args":"p pg_proc","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"text","strict":false,"bodyMd5":"1cfe700c87c0fa33bee5d0586cb78853","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.dashboard_admin_wg_sites()":{"acl":"{postgres=X/postgres}","args":"","cost":100,"rows":1000,"owner":"postgres","config":["search_path=\"\""],"result":"TABLE(site_code text, country_code text, country text, platform text, timezone text, currency text)","strict":false,"bodyMd5":"839401f31117192068b395d1c9580230","language":"sql","parallel":"u","leakproof":false,"volatility":"i","securityDefiner":false},"private.dashboard_health_wg_evidence_format(bigint,timestamptz,boolean,boolean,timestamptz,timestamptz)":{"acl":"{postgres=X/postgres}","args":"n bigint, seen timestamp with time zone, covered boolean, has_window boolean, hi timestamp with time zone, asof timestamp with time zone","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"98d86e2c8aee47aca8b6d9e2d0170112","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false},"private.dashboard_health_wg_evidence_batch(text,text,date,date)":{"acl":"{postgres=X/postgres}","args":"p_site text, p_business text, p_from date, p_to date","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"jsonb","strict":false,"bodyMd5":"940523afd7eccfb09a11b27eadd11b54","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":true},"private.dashboard_serving_recent_refresh_at(jsonb,jsonb,timestamptz,timestamptz)":{"acl":"{postgres=X/postgres}","args":"q jsonb, t jsonb, p_computed timestamp with time zone, p_now timestamp with time zone","cost":100,"rows":0,"owner":"postgres","config":["search_path=\"\""],"result":"timestamp with time zone","strict":false,"bodyMd5":"422aa5d2532a6b8780f11aa3d5898e36","language":"plpgsql","parallel":"u","leakproof":false,"volatility":"s","securityDefiner":false}}$expected$::jsonb)loop
 select jsonb_build_object('bodyMd5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,'language',(select lanname from pg_language where oid=p.prolang),'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid)) into actual from pg_proc p where p.oid=to_regprocedure(e.signature);
 if actual is distinct from e.metadata then raise exception'interactive_recent_contract_drift:%',e.signature;end if;end loop;
 with native as materialized(select to_jsonb(n)t,n.scope_group from private.prepared_aggregate_native_catalog()n),scopes as(select unnest(array['IN','BR','BR_PANGHU','PK','PH','ID'])s union select scope_group from native),common as materialized(select s,private.prepared_aggregate_dependency_common(s)d from scopes),tokens as(select 'scope:'||s k,d v from common union all select 'native:'||(n.t->>'id'),private.prepared_aggregate_dependency(n.t,c.d)from native n join common c on c.s=n.scope_group union all select 'withdraw',private.withdraw_prepared_dependency() union all select 'reason',private.withdraw_reason_dependency())select jsonb_object_agg(k,v order by k)into after_deps from tokens;
 if after_deps is null or(select count(*)from jsonb_each(after_deps)where key like 'scope:%')<6 or(select count(*)from jsonb_each(after_deps)where key like 'native:%')<1 or exists(select 1 from jsonb_each(after_deps)where value='null'::jsonb or jsonb_typeof(value)<>'string' or value#>>'{}'='')then raise exception'interactive_recent_dependency_missing';end if;
 select private.provider_snapshot_dependency_batch((select jsonb_agg(to_jsonb(n))from private.prepared_aggregate_native_catalog()n))into after_provider;
 if after_provider is null or exists(select 1 from jsonb_each(after_provider)x where x.value->>'token'is null)then raise exception'interactive_recent_provider_proof_missing';end if;
 if before_deps is distinct from after_deps or before_provider is distinct from after_provider then raise exception'interactive_recent_dependency_changed';end if;
 perform set_config('audit.interactive_recent_refresh',jsonb_build_object('contract','interactive-recent-refresh-v1','unchangedTokens',(select count(*)from jsonb_each(after_deps)),'providerTargets',(select count(*)from jsonb_each(after_provider)),'sourceRowsWritten',false,'queueWrites',false,'rollback',false)::text,true);
end;$migration$;
select current_setting('audit.interactive_recent_refresh')::jsonb receipt;
commit;
