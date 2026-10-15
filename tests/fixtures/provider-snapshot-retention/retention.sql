-- OFFLINE CANDIDATE ONLY. Not part of the frozen shadow migration.
-- Retirement is explicit; an ordinary version GC never deletes a head.
create table private.provider_snapshot_retired_cohorts(
 cohort_id uuid primary key references private.provider_snapshot_cohorts(id),
 replacement_cohort_id uuid not null,retired_at timestamptz not null default clock_timestamp(),
 retired_jobs integer not null,retired_heads integer not null
);
create table private.provider_snapshot_retired_jobs(
 job_id uuid primary key references private.provider_snapshot_jobs(id)on delete cascade,
 cohort_id uuid not null,retired_at timestamptz not null default clock_timestamp()
);
alter table private.provider_snapshot_retired_cohorts enable row level security;
alter table private.provider_snapshot_retired_jobs enable row level security;
revoke all on private.provider_snapshot_retired_cohorts,private.provider_snapshot_retired_jobs from public,anon,authenticated,service_role;
create index provider_snapshot_cohorts_retention on private.provider_snapshot_cohorts(local_date,roster_token,cutoff desc)where status='ready';

-- A full common cohort means EXACTLY all five native/current+prior slots exist.
-- Individual source completeness is deliberately not invented or required here.
create function private.provider_snapshot_cohort_complete(p_id uuid)
returns boolean language sql stable security invoker set search_path=''as $complete$
 with c as materialized(select *from private.provider_snapshot_cohorts where id=p_id and status='ready'
  and jsonb_array_length(targets)between 1 and 18),
 t as materialized(select x.value target,private.provider_snapshot_dependency_token(x.value)dependency from c cross join lateral jsonb_array_elements(c.targets)x),
 expected as(
  select c.id,t.target,t.dependency,v.component,
   ((c.local_date-case when v.prior then 1 else 0 end)::timestamp at time zone'Asia/Kolkata')window_from,
   (((c.cutoff at time zone'Asia/Kolkata')-case when v.prior then interval'1day'else interval'0'end)at time zone'Asia/Kolkata')window_to
  from c cross join t cross join(values('orders',false),('orders',true),('intake',false),('intake',true),('submission',false))v(component,prior)
 ),checked as(
  select e.*,j.id job_id,j.status,j.revision,j.dependency_token job_dependency,a.id artifact_id,a.revision artifact_revision,a.dependency_token artifact_dependency,a.provenance,a.next_due_at
  from expected e left join private.provider_snapshot_jobs j on j.target=e.target and j.component=e.component and j.window_from=e.window_from and j.window_to=e.window_to
  left join private.provider_snapshot_cohort_jobs cj on cj.cohort_id=e.id and cj.job_id=j.id
  left join private.provider_snapshot_heads h on h.job_id=cj.job_id left join private.provider_snapshot_artifacts a on a.id=h.snapshot_id
 )select exists(select 1 from c)and private.provider_snapshot_kernel_contract_current()
 and not exists(select 1 from t where not private.provider_snapshot_target_current(target))
 and not exists(select 1 from c where c.local_date=(statement_timestamp()at time zone'Asia/Kolkata')::date and c.cutoff<statement_timestamp()-interval'30minutes')
 and(select count(distinct target)from t)=(select jsonb_array_length(targets)from c)
 and(select count(*)from private.provider_snapshot_cohort_jobs where cohort_id=p_id)=(select jsonb_array_length(targets)*5 from c)
 and(select count(*)from checked)=(select jsonb_array_length(targets)*5 from c)
 and not exists(select 1 from checked where job_id is null or artifact_id is null or status<>'ready'
  or artifact_revision<>revision or artifact_dependency<>dependency or job_dependency<>dependency
  or next_due_at<=statement_timestamp()or provenance->'computationComplete'is distinct from'true'::jsonb);
$complete$;
revoke all on function private.provider_snapshot_cohort_complete(uuid)from public,anon,authenticated,service_role;

create function private.provider_snapshot_retire_intraday(p_cohort_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path=''as $retire$
declare c private.provider_snapshot_cohorts%rowtype;replacement uuid;members uuid[];removable uuid[];n integer;h integer;budget interval;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='snapshot_retention_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if budget<=interval'0'or budget>interval'5seconds'then raise exception using errcode='22023',message='snapshot_retention_deadline_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))then return jsonb_build_object('status','busy');end if;
 select *into c from private.provider_snapshot_cohorts where id=p_cohort_id for update nowait;
 if not found then return jsonb_build_object('status','missing');end if;
 if exists(select 1 from private.provider_snapshot_retired_cohorts where cohort_id=c.id)then return jsonb_build_object('status','already_retired');end if;
 if c.lane<>'current'or c.status not in('ready','failed','obsolete')or c.cutoff>=(c.local_date+1)::timestamp at time zone'Asia/Kolkata'
  or c.updated_at>clock_timestamp()-interval'1hour'or jsonb_array_length(c.targets)not between 1 and 18 then return jsonb_build_object('status','protected');end if;
 select id into replacement from private.provider_snapshot_cohorts n where n.local_date=c.local_date and n.roster_token=c.roster_token and n.targets=c.targets and n.cutoff>c.cutoff
  and n.status='ready'order by n.cutoff desc limit 1;
 -- Validate one latest ready candidate, never execute metadata hashes once per
 -- historical cutoff. An invalid latest candidate stops retirement conservatively.
 if replacement is null or not private.provider_snapshot_cohort_complete(replacement)then return jsonb_build_object('status','no_complete_replacement');end if;
 select array_agg(job_id order by job_id)into members from private.provider_snapshot_cohort_jobs where cohort_id=c.id;
 if cardinality(members)is distinct from jsonb_array_length(c.targets)*5 or cardinality(members)>90 then return jsonb_build_object('status','protected');end if;
 if exists(select 1 from private.provider_snapshot_jobs j where j.id=any(members)and(
  not c.targets@>jsonb_build_array(j.target)or not(
   j.window_from=c.local_date::timestamp at time zone'Asia/Kolkata'and j.window_to=c.cutoff
   or j.component<>'submission'and j.window_from=(c.local_date-1)::timestamp at time zone'Asia/Kolkata'
    and j.window_to=((c.cutoff at time zone'Asia/Kolkata')-interval'1day')at time zone'Asia/Kolkata'
  )))then return jsonb_build_object('status','invalid_cohort_membership');end if;
 perform 1 from private.provider_snapshot_jobs where id=any(members)order by id for update nowait;
 if exists(select 1 from private.provider_snapshot_jobs where id=any(members)and(status in('queued','running','failed')))then return jsonb_build_object('status','active_jobs_protected');end if;
 -- Keep a tombstone so the scheduler cannot reconstruct an already retired cutoff.
 delete from private.provider_snapshot_cohort_jobs where cohort_id=c.id;
 update private.provider_snapshot_cohorts set status='obsolete',updated_at=clock_timestamp()where id=c.id;
 select array_agg(j.id order by j.id)into removable from private.provider_snapshot_jobs j where j.id=any(members)
  and not exists(select 1 from private.provider_snapshot_cohort_jobs x where x.job_id=j.id)
  and j.window_to<((j.window_from at time zone'Asia/Kolkata')::date+1)::timestamp at time zone'Asia/Kolkata';
 insert into private.provider_snapshot_retired_jobs(job_id,cohort_id)select x,c.id from unnest(removable)x on conflict do nothing;
 get diagnostics n=row_count;
 -- This is the only head deletion: these exact windows were explicitly retired
 -- after proving a newer complete common cutoff. Other heads remain untouched.
 delete from private.provider_snapshot_heads where job_id=any(removable);get diagnostics h=row_count;
 insert into private.provider_snapshot_retired_cohorts(cohort_id,replacement_cohort_id,retired_jobs,retired_heads)values(c.id,replacement,n,h);
 return jsonb_build_object('status','retired','replacementCohortId',replacement,'jobs',n,'heads',h);
end;$retire$;
revoke all on function private.provider_snapshot_retire_intraday(uuid)from public,anon,authenticated,service_role;

create function private.provider_snapshot_gc_versions(p_limit integer default 100)
returns jsonb language plpgsql volatile security invoker set search_path=''as $gc$
declare removed integer;freed bigint;jobs integer;budget interval;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='snapshot_retention_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if p_limit is null or p_limit not between 1 and 200 or budget<=interval'0'or budget>interval'5seconds'then raise exception using errcode='22023',message='invalid_snapshot_gc_budget';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))then return jsonb_build_object('status','busy');end if;
 with candidates as materialized(
  select a.id from private.provider_snapshot_artifacts a where a.computed_at<clock_timestamp()-interval'1hour'
   and not exists(select 1 from private.provider_snapshot_heads h where h.snapshot_id=a.id)
   order by a.computed_at,a.id for update of a skip locked limit p_limit
 ),gone as(delete from private.provider_snapshot_artifacts a using candidates c where a.id=c.id
  and not exists(select 1 from private.provider_snapshot_heads h where h.snapshot_id=a.id)returning a.stored_bytes)
 select count(*),coalesce(sum(stored_bytes),0)into removed,freed from gone;
 with candidates as materialized(
  select j.id from private.provider_snapshot_jobs j join private.provider_snapshot_retired_jobs r on r.job_id=j.id
  where (j.status='ready'or j.status='failed'and j.attempts>=3)
   and not exists(select 1 from private.provider_snapshot_heads h where h.job_id=j.id)
   and not exists(select 1 from private.provider_snapshot_artifacts a where a.job_id=j.id)
   and not exists(select 1 from private.provider_snapshot_cohort_jobs c where c.job_id=j.id)
  order by j.id for update of j skip locked limit p_limit
 ),gone as(delete from private.provider_snapshot_jobs j using candidates c where j.id=c.id returning j.id)
 select count(*)into jobs from gone;
 return jsonb_build_object('status','collected','artifacts',removed,'storedBytes',freed,'retiredJobs',jobs);
end;$gc$;
revoke all on function private.provider_snapshot_gc_versions(integer)from public,anon,authenticated,service_role;
