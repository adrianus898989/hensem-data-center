-- Included atomically by snapshot-capacity-cycle.sql; not standalone.
-- This proof deliberately does not upgrade expiry to freshness. Expired full-day
-- artifacts remain stale in the reader, but older partial windows are no longer
-- part of its supported historical contract and cannot replace a full day.
create function private.provider_snapshot_closed_replacement(p_id uuid)
returns boolean language sql stable security invoker set search_path=''as $proof$
 with c as materialized(select *from private.provider_snapshot_cohorts where id=p_id and status='ready'
  and jsonb_array_length(targets)=18 and local_date<(statement_timestamp()at time zone'Asia/Kolkata')::date
  and cutoff=(local_date+1)::timestamp at time zone'Asia/Kolkata'),
 t as materialized(select x.value target,private.provider_snapshot_dependency_token(x.value)dependency from c cross join lateral jsonb_array_elements(c.targets)x),
 expected as(
  select c.id,t.target,t.dependency,v.component,
   ((c.local_date-case when v.prior then 1 else 0 end)::timestamp at time zone'Asia/Kolkata')window_from,
   ((c.local_date+case when v.prior then 0 else 1 end)::timestamp at time zone'Asia/Kolkata')window_to
  from c cross join t cross join(values('orders',false),('orders',true),('intake',false),('intake',true),('submission',false))v(component,prior)
 ),checked as(
  select e.*,j.id job_id,j.status,j.revision,j.dependency_token job_dependency,a.id artifact_id,a.revision artifact_revision,a.dependency_token artifact_dependency,a.provenance
  from expected e left join private.provider_snapshot_jobs j on j.target=e.target and j.component=e.component and j.window_from=e.window_from and j.window_to=e.window_to
  left join private.provider_snapshot_cohort_jobs cj on cj.cohort_id=e.id and cj.job_id=j.id
  left join private.provider_snapshot_heads h on h.job_id=cj.job_id left join private.provider_snapshot_artifacts a on a.id=h.snapshot_id and a.job_id=j.id
 )select exists(select 1 from c)and private.provider_snapshot_kernel_contract_current()
 and not exists(select 1 from t where not private.provider_snapshot_target_current(target))
 and(select count(distinct target)from t)=18
 and(select count(*)from private.provider_snapshot_cohort_jobs where cohort_id=p_id)=90
 and(select count(*)from checked)=90
 and not exists(select 1 from checked where job_id is null or artifact_id is null or status<>'ready'
  or artifact_revision<>revision or artifact_dependency<>dependency or job_dependency<>dependency
  or provenance->'computationComplete'is distinct from'true'::jsonb);
$proof$;
revoke all on function private.provider_snapshot_closed_replacement(uuid)from public,anon,authenticated,service_role;

-- Replace the old wider-cutoff rule instead of leaving a second unsafe entry.
create or replace function private.provider_snapshot_retire_intraday(p_cohort_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path=''as $retire$
declare c private.provider_snapshot_cohorts%rowtype;replacement uuid;members uuid[];removable uuid[];n integer;h integer;budget interval;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='snapshot_retention_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if budget<=interval'0'or budget>interval'5seconds'then raise exception using errcode='22023',message='snapshot_retention_deadline_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))
  or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))
  or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then return jsonb_build_object('status','busy');end if;
 if exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())then return jsonb_build_object('status','busy');end if;
 -- Retention must stop if a later release broadens the supported reader windows.
 if not exists(select 1 from pg_proc where oid='private.dashboard_admin_live_provider_snapshot(jsonb)'::regprocedure
  and md5(prosrc)='READER_POST_HASH')then raise exception 'snapshot_retention_reader_contract_changed';end if;
 select *into c from private.provider_snapshot_cohorts where id=p_cohort_id for update nowait;
 if not found then return jsonb_build_object('status','missing');end if;
 if exists(select 1 from private.provider_snapshot_retired_cohorts where cohort_id=c.id)then return jsonb_build_object('status','already_retired');end if;
 if c.lane<>'current'or c.status not in('ready','failed','obsolete')or c.cutoff>=(c.local_date+1)::timestamp at time zone'Asia/Kolkata'
  or c.local_date>=(statement_timestamp()at time zone'Asia/Kolkata')::date-1
  or c.updated_at>clock_timestamp()-interval'1hour'or jsonb_array_length(c.targets)<>18 then return jsonb_build_object('status','protected');end if;
 select id into replacement from private.provider_snapshot_cohorts n where n.local_date=c.local_date and n.roster_token=c.roster_token and n.targets=c.targets
  and n.cutoff=(n.local_date+1)::timestamp at time zone'Asia/Kolkata'and n.status='ready'order by n.supplement_pass desc,n.updated_at desc,n.id limit 1;
 if replacement is null or not private.provider_snapshot_closed_replacement(replacement)then return jsonb_build_object('status','no_complete_replacement');end if;
 select array_agg(job_id order by job_id)into members from private.provider_snapshot_cohort_jobs where cohort_id=c.id;
 -- Archived no-head failures may already have left this cohort. Every remaining
-- member must still be one of its original exact slots; membership never expands.
 if coalesce(cardinality(members),0)not between 1 and 90 then return jsonb_build_object('status','protected');end if;
 if exists(select 1 from private.provider_snapshot_jobs j where j.id=any(members)and(
  not c.targets@>jsonb_build_array(j.target)or not(
   j.window_from=c.local_date::timestamp at time zone'Asia/Kolkata'and j.window_to=c.cutoff
   or j.component<>'submission'and j.window_from=(c.local_date-1)::timestamp at time zone'Asia/Kolkata'
    and j.window_to=((c.cutoff at time zone'Asia/Kolkata')-interval'1day')at time zone'Asia/Kolkata'
  )))then return jsonb_build_object('status','invalid_cohort_membership');end if;
 perform 1 from private.provider_snapshot_jobs where id=any(members)order by id for update nowait;
 if exists(select 1 from private.provider_snapshot_jobs where id=any(members)and(status in('queued','running','failed')))then return jsonb_build_object('status','active_jobs_protected');end if;
 delete from private.provider_snapshot_cohort_jobs where cohort_id=c.id;
 update private.provider_snapshot_cohorts set status='obsolete',updated_at=clock_timestamp()where id=c.id;
 select array_agg(j.id order by j.id)into removable from private.provider_snapshot_jobs j where j.id=any(members)
  and not exists(select 1 from private.provider_snapshot_cohort_jobs x where x.job_id=j.id)
  and j.window_to<((j.window_from at time zone'Asia/Kolkata')::date+1)::timestamp at time zone'Asia/Kolkata';
 insert into private.provider_snapshot_retired_jobs(job_id,cohort_id)select x,c.id from unnest(removable)x on conflict do nothing;
 get diagnostics n=row_count;
 delete from private.provider_snapshot_heads where job_id=any(removable);get diagnostics h=row_count;
 insert into private.provider_snapshot_retired_cohorts(cohort_id,replacement_cohort_id,retired_jobs,retired_heads)values(c.id,replacement,n,h);
 return jsonb_build_object('status','retired','replacementCohortId',replacement,'jobs',n,'heads',h);
end;$retire$;
revoke all on function private.provider_snapshot_retire_intraday(uuid)from public,anon,authenticated,service_role;

-- Bounded cursor prevents a drifted or partially archived cohort from starving
-- another complete day. Its only state is the last attempted metadata key.
create table private.provider_snapshot_retirement_cursor(
 singleton boolean primary key default true check(singleton),
 local_date date not null,cutoff timestamptz not null,cohort_id uuid not null
);
alter table private.provider_snapshot_retirement_cursor enable row level security;
revoke all on private.provider_snapshot_retirement_cursor from public,anon,authenticated,service_role;
create function private.provider_snapshot_retire_closed_cycle()
returns jsonb language plpgsql volatile security invoker set search_path=''as $cycle$
declare c record;v_cursor private.provider_snapshot_retirement_cursor%rowtype;budget interval;result jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='snapshot_retention_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if budget<=interval'0'or budget>interval'5seconds'then raise exception 'snapshot_retention_deadline_required';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))
  or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))
  or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then return jsonb_build_object('status','busy');end if;
 select *into v_cursor from private.provider_snapshot_retirement_cursor where singleton for update;
 select p.id,p.local_date,p.cutoff into c from private.provider_snapshot_cohorts p where p.lane='current'and p.status in('ready','failed')
  and p.local_date<(statement_timestamp()at time zone'Asia/Kolkata')::date-1
  and p.cutoff<(p.local_date+1)::timestamp at time zone'Asia/Kolkata'and jsonb_array_length(p.targets)=18
  and p.updated_at<clock_timestamp()-interval'1hour'
  and not exists(select 1 from private.provider_snapshot_retired_cohorts r where r.cohort_id=p.id)
  and exists(select 1 from private.provider_snapshot_cohorts n where n.local_date=p.local_date and n.targets=p.targets and n.roster_token=p.roster_token
   and n.status='ready'and n.cutoff=(n.local_date+1)::timestamp at time zone'Asia/Kolkata')
  order by case when row(p.local_date,p.cutoff,p.id)>row(v_cursor.local_date,v_cursor.cutoff,v_cursor.cohort_id)then 0 else 1 end,p.local_date,p.cutoff,p.id limit 1;
 if c.id is null then return jsonb_build_object('status','idle');end if;
 result:=private.provider_snapshot_retire_intraday(c.id);
 if result->>'status'<>'busy'then
  insert into private.provider_snapshot_retirement_cursor values(true,c.local_date,c.cutoff,c.id)
   on conflict(singleton)do update set local_date=excluded.local_date,cutoff=excluded.cutoff,cohort_id=excluded.cohort_id;
 end if;
 return result;
end;$cycle$;
revoke all on function private.provider_snapshot_retire_closed_cycle()from public,anon,authenticated,service_role;
