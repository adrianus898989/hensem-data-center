CREATE OR REPLACE FUNCTION private.daily_provider_base_admit_days(p_entries jsonb, p_force boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare entry jsonb;q jsonb;t jsonb;b jsonb;k jsonb;dep text;scope text;common text;commons jsonb:='{}';validated jsonb:='[]';states jsonb:='[]';seen jsonb:='{}';permits jsonb:='{}';fingerprint text;
 j private.prepared_aggregate_jobs%rowtype;a record;actor_id uuid:=coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid);budget integer;job_id uuid;state text;reason text;readable boolean;was_missing boolean;local_a timestamp;local_b timestamp;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_base_worker_denied';end if;
 if jsonb_typeof(p_entries)is distinct from'array'or jsonb_array_length(p_entries)>93 then raise exception using errcode='22023',message='daily_provider_days_invalid';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_enqueue(jsonb,jsonb,text,smallint)'::regprocedure and md5(prosrc)='a4e4e1a403bf0aa2dc70c7bb7ad4e6c9')then raise exception'daily_provider_days_enqueue_drift';end if;
 -- Validate the ENTIRE plan before the first admission. No partial mutation of
 -- an unauthorized or unsupported later native/date/filter is permitted.
 for entry in select value from jsonb_array_elements(p_entries)loop
  q:=entry->'request';t:=entry->'target';
  if private.prepared_aggregate_target_current(t)is distinct from true or private.prepared_aggregate_request_reason(q,t)is not null
   or t->>'source'not in('ar','newar','kb')or q->>'view'is distinct from'providers'or q->>'direction'is distinct from'all'or q->>'successBasis'is distinct from'success'or coalesce(q->>'status','all')<>'all'
   or q-array['action','view','platformId','startAt','endAt','successStartAt','successEndAt','successBasis','direction','status','currency','offset','limit']<>'{}'::jsonb
   or q?'currency'and q->'currency'<>'null'::jsonb and q->>'currency'is distinct from t->>'currency'
   or(q->>'startAt')::timestamptz is distinct from(q->>'successStartAt')::timestamptz or(q->>'endAt')::timestamptz is distinct from(q->>'successEndAt')::timestamptz
   or(q->>'endAt')::timestamptz>clock_timestamp()then raise exception using errcode='22023',message='daily_provider_days_unsupported';end if;
  local_a:=(q->>'startAt')::timestamptz at time zone(t->>'timezone');local_b:=(q->>'endAt')::timestamptz at time zone(t->>'timezone');
  if local_a<>date_trunc('day',local_a)or local_b<>date_trunc('day',local_b)or local_b::date-local_a::date<>1 then raise exception using errcode='22023',message='daily_provider_days_invalid_window';end if;
  scope:=t->>'scope_group';common:=commons->>scope;if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;
  dep:=private.prepared_aggregate_dependency(t,common);
  if dep is distinct from entry->>'dependency'then raise exception using errcode='55000',message='daily_provider_days_dependency_changed';end if;
  b:=private.prepared_aggregate_base_request(q,t);k:=private.prepared_aggregate_key(b,t);
  validated:=validated||jsonb_build_array(entry||jsonb_build_object('base',b,'key',k));
 end loop;
 -- Original actor/day budget is acquired before any source-job row lock.
 -- This does not introduce a job->actor lock inversion for mixed daily plans.
 for entry in select value from jsonb_array_elements(validated)order by md5((value->'key')::text),(value->'key')::text collate"C"loop
  k:=entry->'key';fingerprint:=md5(k::text);
  if permits?fingerprint then continue;end if;
  if not exists(select 1 from private.prepared_aggregate_jobs where request_fingerprint=fingerprint and request_key=k)then
   budget:=null;
   insert into private.prepared_aggregate_admissions(actor,day,total)values(actor_id,current_date,1)
    on conflict(actor,day)do update set total=private.prepared_aggregate_admissions.total+1 where private.prepared_aggregate_admissions.total<1000 returning total into budget;
   permits:=permits||jsonb_build_object(fingerprint,budget is not null);
  end if;
 end loop;
 for entry in select value from jsonb_array_elements(validated)order by md5((value->'key')::text),(value->'key')::text collate"C"loop
  q:=entry->'request';t:=entry->'target';b:=entry->'base';k:=entry->'key';dep:=entry->>'dependency';fingerprint:=md5(k::text);reason:=null;
  -- Repeated exact source days share one admission and one original quota debit.
  if seen?fingerprint then
   if seen->fingerprint->'key'is distinct from k then raise exception'daily_provider_days_identity_collision';end if;
   states:=states||jsonb_build_array(((seen->fingerprint)-'key')||jsonb_build_object('owner',entry->'owner'));continue;end if;
  select *into j from private.prepared_aggregate_jobs where request_fingerprint=fingerprint and request_key=k for update;
  select a0.id,a0.revision,a0.dependency,a0.cutoff,a0.computed_at,a0.expires_at,a0.source_complete into a
   from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a0 on a0.id=h.artifact_id where h.job_id=j.id;
  readable:=a.id is not null and j.target=t and j.dependency=dep and a.dependency=dep and a.revision=j.revision
   and a.cutoff>=(q->>'endAt')::timestamptz and a.computed_at is not null and a.expires_at>a.computed_at and a.source_complete is not null;
  if readable is true then
   -- Exact original V2 force bookkeeping; it does not recompute, invalidate or
   -- replace the immutable publication, and failed/running jobs are not reset.
   if p_force then
    update private.prepared_aggregate_jobs z set status='queued',attempts=0,not_before=clock_timestamp()
     where z.id=j.id and z.status='ready'and z.revision=a.revision and z.dependency=dep and z.target=t;
   end if;
   state:='ready';
  elsif j.status='running'then state:=case when j.target=t and j.dependency=dep then'running'else'failed'end;reason:=case when state='failed'then'daily_provider_day_running_scope_changed'end;
  elsif j.status='failed'and(j.last_error='superseded_by_full_master'and j.target=t and j.dependency=dep and(j.lease_until is null or j.lease_until<=clock_timestamp()))is not true then
   state:='failed';reason:='daily_provider_day_failed';
  elsif j.lease_until>clock_timestamp()then state:='failed';reason:='daily_provider_day_active_lease';
  else
   job_id:=null;budget:=null;was_missing:=j.id is null;
   if j.id is null then
    if permits->fingerprint='true'::jsonb then budget:=1;job_id:=private.prepared_aggregate_enqueue(b,t,dep,100::smallint);end if;
   else
    job_id:=private.prepared_aggregate_enqueue(b,t,dep,100::smallint);
    -- Only an ordinary READY job with no usable publication is repaired here.
    -- Running leases and all ordinary failed retry budgets remain untouched.
    update private.prepared_aggregate_jobs z set status='queued',not_before=clock_timestamp()
     where z.id=job_id and z.status='ready'and z.target=t and z.dependency=dep
      and(z.lease_until is null or z.lease_until<=clock_timestamp())and z.revision=j.revision;
   end if;
   select *into j from private.prepared_aggregate_jobs where id=job_id;
   state:=case when job_id is null then'failed'when j.target=t and j.dependency=dep and j.status in('queued','running')then j.status else'failed'end;
   reason:=case when job_id is null and was_missing and budget is null then'daily_provider_day_admission_limited'when job_id is null then'daily_provider_day_capacity'when state='failed'then'daily_provider_day_unavailable'end;
  end if;
  seen:=seen||jsonb_build_object(fingerprint,jsonb_build_object('key',k,'status',state,'reason',reason));
  states:=states||jsonb_build_array(jsonb_build_object('owner',entry->'owner','status',state,'reason',reason));
 end loop;
 return states;
end;$function$
