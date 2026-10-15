-- Read-only production acceptance; run each bounded transaction separately.
-- This checks current native target, exact code/data dependencies and expiry.
-- A jobs.status of ready on its own is NOT sufficient proof of readable data.
begin read only;
set local statement_timeout='3s';
set local lock_timeout='250ms';
with targets as materialized(select to_jsonb(p)t from private.prepared_aggregate_native_catalog()p where p.scope_group='IN'),
 common as materialized(select private.prepared_aggregate_dependency_common('IN')d),
 profiles as(select t,days.offset_day,v.profile,
 jsonb_build_object('action','aggregate','view',case when profile='providers'then'providers'else'full'end,'platformId',t->>'id',
 'startAt',private.provider_snapshot_iso((((now()at time zone(t->>'timezone'))::date-days.offset_day)::timestamp at time zone(t->>'timezone'))),
 'endAt',private.provider_snapshot_iso((((now()at time zone(t->>'timezone'))::date-days.offset_day+1)::timestamp at time zone(t->>'timezone'))),
 'successStartAt',private.provider_snapshot_iso((((now()at time zone(t->>'timezone'))::date-days.offset_day)::timestamp at time zone(t->>'timezone'))),
 'successEndAt',private.provider_snapshot_iso((((now()at time zone(t->>'timezone'))::date-days.offset_day+1)::timestamp at time zone(t->>'timezone'))),
 'successBasis','success','direction','all','status','all','currency',t->>'currency','offset',0,'limit',20)
 ||case when profile<>'providers'then jsonb_build_object('amountBands','{"charge":[100,200,300,400,500,1000,2000,5000,10000,20000,50000],"withdraw":[100,200,300,400,500,1000,2000,5000,10000,20000,50000]}'::jsonb)else'{}'::jsonb end
 ||case when profile='latency_v2'then jsonb_build_object('durationVersion',2)else'{}'::jsonb end q
 from targets cross join generate_series(0,2)days(offset_day)cross join(values('providers'),('full'),('latency_v2'))v(profile)
 where profile='providers'or days.offset_day<2),
 expected as materialized(select *,private.prepared_aggregate_key(q,t)k from profiles),
 checked as(select e.t target,e.q request,e.profile,e.offset_day,j.id,j.status,j.last_error,j.last_requested_at,j.next_due_at,j.attempts,
 a.id artifact_id,a.revision artifact_revision,j.revision,a.dependency artifact_dependency,j.dependency,
 private.prepared_aggregate_dependency(e.t,c.d)expected_dependency,a.expires_at,a.computed_at,a.cutoff,a.source_complete,a.bytes
 from expected e cross join common c
 left join private.prepared_aggregate_jobs j on j.request_fingerprint=md5(e.k::text)and j.request_key=e.k and j.target=e.t
 left join private.prepared_aggregate_heads h on h.job_id=j.id
 left join private.prepared_aggregate_artifacts a on a.id=h.artifact_id)
select count(*)over()expected_profiles,target->>'name'platform,target->>'source'source,
 ((request->>'startAt')::timestamptz at time zone(target->>'timezone'))::date local_date,
 profile,request->>'successBasis'secondary_clock,
 coalesce(status,'not_enqueued')status,coalesce(artifact_id is not null and artifact_revision=revision and artifact_dependency=expected_dependency
 and dependency=expected_dependency and expires_at>now(),false)as readable_valid,
 computed_at,cutoff,expires_at,next_due_at,source_complete,bytes,attempts,last_error
 from checked order by local_date desc,profile,platform;
commit;

begin read only;
set local statement_timeout='3s';
select clock_timestamp()received_at_utc,status,count(*)jobs,min(not_before)oldest_due,
 max(attempts)max_attempts from private.prepared_aggregate_jobs group by status;
select jobname,schedule,active from cron.job where jobname like 'exact-aggregate-%';
select j.jobname,r.status,r.start_time,r.end_time,
 extract(epoch from(r.end_time-r.start_time))*1000 duration_ms,
 case when r.status<>'succeeded'then left(r.return_message,160)end failure
 from cron.job j join lateral(select status,start_time,end_time,return_message
 from cron.job_run_details r where r.jobid=j.jobid order by start_time desc limit 5)r on true
 where j.jobname like 'exact-aggregate-%' order by j.jobname,r.start_time desc;
commit;
