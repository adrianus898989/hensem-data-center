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
   q:=jsonb_build_object('action','aggregate','view','providers','platformId',t->>'id','startAt',private.provider_snapshot_iso((d-offset_day)::timestamp at time zone(t->>'timezone')),'endAt',private.provider_snapshot_iso((d-offset_day+1)::timestamp at time zone(t->>'timezone')),'successBasis','created','direction','all','status','all','currency',t->>'currency','offset',0,'limit',20);
   if private.prepared_aggregate_request_reason(q,t)is not null then unsupported:=unsupported+1;continue;end if;
   baseq:=private.prepared_aggregate_base_request(q,t,p_now);
   -- The single created default uses the same currency bands as the page.
   -- Explicit/custom manual requests below keep their exact original keys.
   if baseq->>'view'='full'and baseq->>'durationVersion'='2'then
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
 -- Only the created mode is an automatic default. Retain explicit/custom manual
 -- requests and recently interactive manual jobs, not former scheduled same-day
 -- success defaults. No existing head, budget, or running job is reset.
 -- Recently used exact/custom windows retain their own keys and do not borrow a
 -- default day. Refresh only approved native identities; running/failed states
 -- are never reset here. Stable computedAt determines the next planned slot.
 for job in select j.*from private.prepared_aggregate_jobs j where j.status='ready'and j.last_requested_at>p_now-interval'24hours'
  and (j.request->>'successBasis'='created' or j.interactive_requested_at>p_now-interval'24hours'
   or j.request->>'successStartAt'is distinct from j.request->>'startAt' or j.request->>'successEndAt'is distinct from j.request->>'endAt'
   or j.request?|array['durationRange','amountMin','amountMax','amountMaxExclusive','channelTypes']
   or coalesce(j.request->>'direction','all')<>'all' or coalesce(j.request->>'status','all')<>'all'
   or coalesce(j.request->'providers','[]'::jsonb)not in('[]'::jsonb,'null'::jsonb)
   or j.request?'amountBands'and j.request->'amountBands'<>private.dashboard_serving_default_amount_bands(j.target->>'currency')
    and not(j.priority between 8 and 10 and j.interactive_requested_at is null
     and j.request->'amountBands'=private.dashboard_serving_default_amount_bands('INR'))
   or ((j.request->>'startAt')::timestamptz at time zone(j.target->>'timezone'))<>date_trunc('day',(j.request->>'startAt')::timestamptz at time zone(j.target->>'timezone'))
   or ((j.request->>'endAt')::timestamptz at time zone(j.target->>'timezone'))<>((j.request->>'startAt')::timestamptz at time zone(j.target->>'timezone'))+interval'1day')
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
end;$function$

