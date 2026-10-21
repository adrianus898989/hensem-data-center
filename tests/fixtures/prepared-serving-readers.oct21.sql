-- Read-only code snapshot from production 2026-10-21. No source or user data.
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
