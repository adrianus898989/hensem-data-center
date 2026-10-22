CREATE OR REPLACE FUNCTION private.provider_snapshot_claim(p_worker text, p_lease_seconds integer DEFAULT 120)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j private.provider_snapshot_jobs%rowtype;lane private.prepared_aggregate_worker_turn%rowtype;
begin
 if p_worker is null or p_worker!~'^[a-zA-Z0-9_.:-]{1,80}$'or p_lease_seconds is null or p_lease_seconds not between 10 and 300 then raise exception using errcode='22023',message='invalid_snapshot_worker';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then return null;end if;
 if exists(select 1 from private.prepared_aggregate_jobs where status='running'and lease_until>clock_timestamp())then return null;end if;
 if exists(select 1 from private.withdraw_prepared_jobs where status='running'and lease_until>clock_timestamp())then return null;end if;
 if not private.provider_snapshot_kernel_contract_current()then return null;end if;
 -- The compute transaction may time out after its claim transaction committed.
 -- Expired third attempts are parked instead of silently retrying forever.
 update private.provider_snapshot_jobs set status='failed',worker=null,lease_until=null,last_error_code='worker_interrupted',updated_at=clock_timestamp()
 where status='running'and lease_until<=clock_timestamp()and attempts>=3;
 update private.provider_snapshot_jobs set status='failed',worker=null,lease_until=null,last_error_code='worker_interrupted',not_before=clock_timestamp()+interval'1minute',updated_at=clock_timestamp()
 where status='running'and lease_until<=clock_timestamp()and attempts<3;
 if exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())then return null;end if;
 with verified as materialized(select t.target from private.provider_snapshot_targets t where t.enabled and private.provider_snapshot_target_current(t.target))
 select q.*into j from private.provider_snapshot_jobs q join verified v on v.target=q.target
 where q.not_before<=clock_timestamp()and q.attempts<3
  and(not exists(select 1 from private.provider_snapshot_cohort_jobs cj where cj.job_id=q.id)or exists(select 1 from private.provider_snapshot_cohort_jobs cj join private.provider_snapshot_cohorts c on c.id=cj.cohort_id where cj.job_id=q.id and c.status='building'))
  and(q.status in('queued','failed')or q.status='running'and q.lease_until<=clock_timestamp())order by q.not_before,q.id for update of q skip locked limit 1;
 if not found then return null;end if;

 -- Permit the other one-second scheduler a bounded foreground burst. If it is
 -- unavailable or all its candidates are locked/invalid, three seconds is the
 -- maximum extra yielding; the original provider turn remains usable.
 select *into lane from private.prepared_aggregate_worker_turn where singleton for update;
 if found and lane.lane_interactive_streak<2 and private.shared_worker_priority_contract_current()
  and private.shared_worker_interactive_due()
  and(lane.lane_waiting_since is null or lane.lane_waiting_since>clock_timestamp()-interval'3seconds')then
  update private.prepared_aggregate_worker_turn set lane_waiting_since=coalesce(lane_waiting_since,clock_timestamp())where singleton;
  return null;
 end if;
 if not private.withdraw_prepared_provider_gate()then return null;end if;
 if not private.prepared_aggregate_take_turn('provider')then return null;end if;
 update private.provider_snapshot_jobs set status='running',fence=fence+1,run_id=gen_random_uuid(),worker=p_worker,claim_backend_pid=pg_backend_pid(),claim_backend_start=(select backend_start from pg_stat_activity where pid=pg_backend_pid()),lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),
  attempts=attempts+1,dependency_token=private.provider_snapshot_dependency_token(target),last_error_code=null,updated_at=clock_timestamp()where id=j.id returning *into j;
 update private.prepared_aggregate_worker_turn set lane_interactive_streak=0,lane_waiting_since=null where singleton;
 return jsonb_build_object('jobId',j.id,'runId',j.run_id,'fence',j.fence::text,'revision',j.revision::text,'target',j.target,'request',j.request,'component',j.component,'dependencyToken',j.dependency_token,'leaseUntil',private.provider_snapshot_iso(j.lease_until));
end;$function$
