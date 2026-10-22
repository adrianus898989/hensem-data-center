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
   or not coalesce(q->>'successBasis'in('success','created'),false)or coalesce(q->>'status','all')<>'all'
   or q->>'successBasis'='created'and q?|array['successStartAt','successEndAt']
   or q-array['action','view','platformId','startAt','endAt','successStartAt','successEndAt','successBasis','direction','status','providers','currency','offset','limit','amountBands']<>'{}'::jsonb
   or q->>'successBasis'<>'created'and((q->>'startAt')::timestamptz is distinct from(q->>'successStartAt')::timestamptz or(q->>'endAt')::timestamptz is distinct from(q->>'successEndAt')::timestamptz)
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
   if q->>'successBasis'='created'then dq:=dq-array['successStartAt','successEndAt'];end if;
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
end;$function$

