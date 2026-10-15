-- Optional bounded maintenance call; this file creates no schedule.
create function private.provider_snapshot_maintain(p_artifact_limit integer default 100)
returns jsonb language plpgsql volatile security invoker set search_path=''as $maintain$
declare c uuid;r jsonb;g jsonb;budget interval;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='snapshot_retention_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if p_artifact_limit is null or p_artifact_limit not between 1 and 200 or budget<=interval'0'or budget>interval'5seconds'then raise exception using errcode='22023',message='invalid_snapshot_gc_budget';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))then return jsonb_build_object('status','busy');end if;
 select o.id into c from private.provider_snapshot_cohorts o where o.lane='current'and o.status in('ready','failed','obsolete')
  and o.cutoff<(o.local_date+1)::timestamp at time zone'Asia/Kolkata'and o.updated_at<clock_timestamp()-interval'1hour'
  and not exists(select 1 from private.provider_snapshot_retired_cohorts r where r.cohort_id=o.id)
  and not exists(select 1 from private.provider_snapshot_cohort_jobs cj join private.provider_snapshot_jobs j on j.id=cj.job_id where cj.cohort_id=o.id and j.status in('queued','running','failed'))
  and exists(select 1 from private.provider_snapshot_cohorts n where n.local_date=o.local_date and n.roster_token=o.roster_token and n.targets=o.targets and n.cutoff>o.cutoff and n.status='ready')
  order by o.cutoff,o.id limit 1;
 if c is not null then r:=private.provider_snapshot_retire_intraday(c);end if;
 g:=private.provider_snapshot_gc_versions(p_artifact_limit);
 return jsonb_build_object('retirement',r,'gc',g);
end;$maintain$;
revoke all on function private.provider_snapshot_maintain(integer)from public,anon,authenticated,service_role;
