CREATE OR REPLACE FUNCTION private.prepared_aggregate_take_turn(p_kind text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare turn private.prepared_aggregate_worker_turn%rowtype;other_due boolean;
begin
 if current_user<>'postgres'or p_kind not in('provider','prepared')then raise exception using errcode='42501',message='prepared_worker_denied';end if;
 -- Both callers already hold provider_snapshot_claim_v1 and have selected a
 -- runnable task. Only a successful grant advances the alternating turn.
 select *into turn from private.prepared_aggregate_worker_turn where singleton for update;
 if turn.next_kind is not null and turn.next_kind<>p_kind then
  if p_kind='provider'then
   select exists(select 1 from private.prepared_aggregate_jobs where status in('queued','failed')and attempts<3 and not_before<=clock_timestamp())into other_due;
  else
   select exists(select 1 from private.provider_snapshot_jobs q join private.provider_snapshot_targets t on t.target=q.target and t.enabled
    where q.status in('queued','failed')and q.attempts<3 and q.not_before<=clock_timestamp()
    and(not exists(select 1 from private.provider_snapshot_cohort_jobs cj where cj.job_id=q.id)or exists(select 1 from private.provider_snapshot_cohort_jobs cj join private.provider_snapshot_cohorts c on c.id=cj.cohort_id where cj.job_id=q.id and c.status='building')))into other_due;
  end if;
  -- Let the other one-second scheduler claim first. If it is unavailable,
  -- bounded fallback avoids indefinitely stalling a healthy scheduler.
  if other_due and(turn.waiting_since is null or turn.waiting_since>clock_timestamp()-interval'3seconds')then
   update private.prepared_aggregate_worker_turn set waiting_since=coalesce(waiting_since,clock_timestamp())where singleton;return false;
  end if;
 end if;
 update private.prepared_aggregate_worker_turn set next_kind=case p_kind when'provider'then'prepared'else'provider'end,waiting_since=null where singleton;
 return true;
end;$function$
