-- READ ONLY. Run the statements individually with 3-second bounds and retain
-- each UTC receipt outside the database. This is an acceptance probe, not cron.
-- Pair it with exact_prepared_aggregates_readiness.sql's expected 126 logical
-- requests, whose 108 mutable views now resolve to 36 master jobs.
begin read only;
set local statement_timeout='3s';
set local lock_timeout='250ms';
with heads as materialized(
 select j.id,j.request,j.target,j.status,j.not_before,j.next_due_at,j.last_error,j.attempts,
 a.id artifact_id,a.computed_at,a.cutoff,a.expires_at,a.revision,a.fence,
 extract(epoch from(a.computed_at-a.cutoff))*1000 compute_elapsed_ms
 from private.prepared_aggregate_jobs j left join private.prepared_aggregate_heads h on h.job_id=j.id
 left join private.prepared_aggregate_artifacts a on a.id=h.artifact_id
 where j.last_requested_at>now()-interval'24hours'
 and j.last_error is distinct from'superseded_by_full_master')
select clock_timestamp()receipt_utc,target->>'scope_group'scope,target->>'source'source,
 request->>'view'view,request->>'durationVersion'duration_version,count(*)jobs,
 count(*)filter(where status='queued')queued,count(*)filter(where status='running')running,
 count(*)filter(where status='failed')failed,count(*)filter(where expires_at<=now()or artifact_id is null)missing_or_expired,
 max(extract(epoch from(now()-not_before)))filter(where status in('queued','failed'))max_queue_age_seconds,
 percentile_cont(.5)within group(order by compute_elapsed_ms)compute_p50_ms,
 percentile_cont(.95)within group(order by compute_elapsed_ms)compute_p95_ms,max(compute_elapsed_ms)compute_max_ms
 from heads group by 2,3,4,5 order by 2,3,4,5;
commit;

-- Retention may remove earlier artifacts. A missing predecessor is UNKNOWN,
-- not proof of zero refresh gaps. Preserve prior head receipts and compare new
-- computed_at with the previous receipt's expires_at for two refresh rounds.
begin read only;
set local statement_timeout='3s';
set local lock_timeout='250ms';
select clock_timestamp()receipt_utc,j.id job_id,j.target->>'name'platform,j.request->>'startAt'creation_start,
 j.request->>'successStartAt'secondary_start,j.request->>'successBasis'secondary_clock,
 a.id artifact_id,a.revision::text||':'||a.fence::text generation,a.computed_at,a.cutoff,a.expires_at,
 old.expires_at predecessor_expires_at,
 case when old.id is null then null else greatest(extract(epoch from(a.computed_at-old.expires_at)),0)end refresh_gap_seconds
 from private.prepared_aggregate_jobs j join private.prepared_aggregate_heads h on h.job_id=j.id
 join private.prepared_aggregate_artifacts a on a.id=h.artifact_id
 left join lateral(select p.id,p.expires_at from private.prepared_aggregate_artifacts p
  where p.job_id=j.id and p.computed_at<a.computed_at order by p.computed_at desc limit 1)old on true
 where j.target->>'scope_group'='IN'and j.request->>'view'='full'and j.request->>'durationVersion'='2'
 and greatest((j.request->>'endAt')::timestamptz,coalesce(j.request->>'successEndAt',j.request->>'endAt')::timestamptz)>now()-interval'24hours'
 order by j.target->>'name',j.request->>'startAt';
commit;

-- Existing published orders/intake/submission still run. Measure this queue
-- alongside the new one; successful idle cron calls are not completed work.
begin read only;
set local statement_timeout='3s';
select clock_timestamp()receipt_utc,status,count(*)jobs,
 max(extract(epoch from(now()-not_before)))filter(where status in('queued','failed')and attempts<3)max_runnable_age_seconds,
 count(*)filter(where attempts>=3)parked
 from private.provider_snapshot_jobs group by status;
commit;
