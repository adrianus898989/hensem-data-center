CREATE OR REPLACE FUNCTION private.daily_provider_base_claim()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j private.daily_provider_base_jobs%rowtype;warm_job private.daily_provider_base_jobs%rowtype;warm_request jsonb;started timestamptz;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_base_worker_denied';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then return null;end if;
 if exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())
  or exists(select 1 from private.prepared_aggregate_jobs where status='running'and lease_until>clock_timestamp())
  or exists(select 1 from private.withdraw_prepared_jobs where status='running'and lease_until>clock_timestamp())
  or exists(select 1 from private.daily_provider_base_jobs where status='running'and lease_until>clock_timestamp())then return null;end if;
 -- Idle metadata maintenance runs BEFORE any base-row write/lock. Both this
 -- background path and the reader acquire actor/source rows before base rows.
 if not exists(select 1 from private.daily_provider_base_jobs where status='running')
  and not exists(select 1 from private.daily_provider_base_jobs where status in('queued','failed')and attempts<3 and not_before<=clock_timestamp())then
  select *into warm_job from private.daily_provider_base_jobs where last_requested_at>=clock_timestamp()-interval'1day'and not_before<=clock_timestamp()
   and(status='ready'or(status='failed'and attempts>=3 and last_error='daily_provider_base_obsolete'))
   order by not_before,last_requested_at desc,created_at limit 1;
  if warm_job.id is not null then
   -- The family contains original daily q key presence/types. Canonical job
   -- request alone loses offset/limit and would prewarm a different family.
   warm_request:=(warm_job.content_key->'dailyRequests'->0)||jsonb_build_object(
    'startAt',warm_job.request->>'startAt','endAt',warm_job.request->>'endAt',
    'successStartAt',warm_job.request->>'successStartAt','successEndAt',warm_job.request->>'successEndAt');
   if warm_job.request->>'successBasis'='created'then warm_request:=warm_request-array['successStartAt','successEndAt'];end if;
   begin
    perform private.daily_provider_base_prewarm_internal(jsonb_build_array(warm_request),warm_job.last_requested_at);
   exception when invalid_parameter_value or object_not_in_prerequisite_state or lock_not_available then
    null; -- Conservative drift/contention miss; no authority/deadline catch.
   end;
   -- A new content key may have retired this old non-running row. Zero rows is
   -- expected; no running lease/retry budget/activity timestamp is rewritten.
   update private.daily_provider_base_jobs set not_before=clock_timestamp()+interval'5minutes'
    where id=warm_job.id and content_key=warm_job.content_key
     and(status='ready'or(status='failed'and attempts>=3 and last_error='daily_provider_base_obsolete'));
  end if;
 end if;
 update private.daily_provider_base_jobs set status='failed',lease_until=null,last_error='daily_provider_base_lease_expired',not_before=clock_timestamp()+interval'1minute'
  where status='running'and lease_until<=clock_timestamp();
 select *into j from private.daily_provider_base_jobs where status in('queued','failed')and attempts<3 and not_before<=clock_timestamp()
  order by not_before,created_at for update skip locked limit 1;
 if not found then return null;end if;
 if not private.prepared_aggregate_take_turn('prepared')then return null;end if;
 select backend_start into started from pg_stat_activity where pid=pg_backend_pid();
 update private.daily_provider_base_jobs set status='running',attempts=attempts+1,fence=fence+1,run_id=gen_random_uuid(),
  lease_until=clock_timestamp()+interval'120seconds',claim_pid=pg_backend_pid(),claim_backend_start=started where id=j.id returning *into j;
 return jsonb_build_object('jobId',j.id,'runId',j.run_id,'fence',j.fence);
end;$function$
