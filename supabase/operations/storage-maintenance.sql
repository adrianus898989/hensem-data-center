-- Local candidate only. Derived queue/storage maintenance; no source business tables.
begin;
set local statement_timeout='5s';
set local lock_timeout='500ms';
do $guard$
declare e record;
begin
 if current_user<>'postgres' then raise exception 'snapshot_storage_denied';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))
 or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))
 or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))
 then raise exception 'snapshot_storage_busy';end if;
 if exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())then raise exception 'snapshot_storage_active_lease';end if;
 for e in select *from(values
 ('private.provider_snapshot_account_jobs()','5e33ce7204bca7a1508c2a3a9e7529b8'),
 ('private.provider_snapshot_account_artifacts()','24b4570052c1399c4466fe634d231886'))v(sig,hash)loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(e.sig)and md5(p.prosrc)=e.hash
   and pg_get_userbyid(p.proowner)='postgres'and not p.prosecdef and p.provolatile='v'
   and p.proconfig=array['search_path=""']and p.proacl::text='{postgres=X/postgres}')then raise exception 'snapshot_storage_baseline_drift';end if;
 end loop;
 if not exists(select 1 from pg_proc p where p.oid='private.provider_snapshot_storage_class(jsonb,timestamptz,timestamptz)'::regprocedure
  and md5(prosrc)='15e2f7e2e32ee078188a4a936ec65824'and pg_get_userbyid(proowner)='postgres'and not prosecdef and provolatile='i'
  and proconfig=array['search_path=""']and proacl::text='{postgres=X/postgres}')then raise exception 'snapshot_storage_class_drift';end if;
 if not(with j as(select private.provider_snapshot_storage_class(target,window_from,window_to)c,count(*)n,count(*)filter(where status='failed')f from private.provider_snapshot_jobs group by 1),
 a as(select private.provider_snapshot_storage_class(j.target,j.window_from,j.window_to)c,count(*)n,sum(a.stored_bytes)b from private.provider_snapshot_artifacts a join private.provider_snapshot_jobs j on j.id=a.job_id group by 1)
 select count(*)=2 and bool_and(row(u.jobs,u.failed_jobs,u.artifacts,u.stored_bytes)=row(coalesce(j.n,0),coalesce(j.f,0),coalesce(a.n,0),coalesce(a.b,0)))
 from private.provider_snapshot_storage_usage u left join j on j.c=u.storage_class left join a on a.c=u.storage_class)
 then raise exception 'snapshot_storage_counters_drift';end if;
 if exists(select 1 from pg_attribute where attrelid='private.provider_snapshot_jobs'::regclass and attname='storage_class'and not attisdropped)then raise exception 'snapshot_storage_already_installed';end if;
end;$guard$;
alter table private.provider_snapshot_jobs add column storage_class text;
update private.provider_snapshot_jobs set storage_class=private.provider_snapshot_storage_class(target,window_from,window_to);
alter table private.provider_snapshot_jobs alter column storage_class set not null;
alter table private.provider_snapshot_jobs add constraint provider_snapshot_job_storage_class check(storage_class in('hot','history'));

create function private.provider_snapshot_persist_storage_class()returns trigger language plpgsql security invoker set search_path=''as $fn$
begin
 if tg_op='INSERT'then
  if new.storage_class is not null and new.storage_class<>private.provider_snapshot_storage_class(new.target,new.window_from,new.window_to)then raise exception 'snapshot_storage_insert_class';end if;
  new.storage_class:=private.provider_snapshot_storage_class(new.target,new.window_from,new.window_to);
 elsif new.storage_class is distinct from old.storage_class then
  if current_user<>'postgres'or current_setting('app.snapshot_storage_move',true)is distinct from pg_current_xact_id()::text
   or old.storage_class<>'hot'or new.storage_class<>'history'
   or old.status='running'or old.lease_until>clock_timestamp()
   or old.window_to>((statement_timestamp()at time zone'Asia/Kolkata')::date::timestamp at time zone'Asia/Kolkata')
  then raise exception 'snapshot_storage_move_denied';end if;
 end if;
 return new;
end;$fn$;
revoke all on function private.provider_snapshot_persist_storage_class()from public,anon,authenticated,service_role;
create trigger provider_snapshot_persist_storage_class before insert or update of storage_class on private.provider_snapshot_jobs for each row execute function private.provider_snapshot_persist_storage_class();

create function private.provider_snapshot_storage_balanced()returns boolean language sql stable security invoker set search_path=''as $fn$
 with j as(select storage_class,count(*)jobs,count(*)filter(where status='failed')failed_jobs from private.provider_snapshot_jobs group by 1),
 a as(select j.storage_class,count(*)artifacts,sum(a.stored_bytes)stored_bytes from private.provider_snapshot_artifacts a join private.provider_snapshot_jobs j on j.id=a.job_id group by 1)
 select count(*)=2 and bool_and(row(u.jobs,u.failed_jobs,u.artifacts,u.stored_bytes)=row(coalesce(j.jobs,0),coalesce(j.failed_jobs,0),coalesce(a.artifacts,0),coalesce(a.stored_bytes,0)))
 from private.provider_snapshot_storage_usage u left join j using(storage_class)left join a using(storage_class);
$fn$;
revoke all on function private.provider_snapshot_storage_balanced()from public,anon,authenticated,service_role;
do $check$begin if not private.provider_snapshot_storage_balanced()then raise exception 'snapshot_storage_counters_drift';end if;end;$check$;

create or replace function private.provider_snapshot_account_jobs()returns trigger language plpgsql security invoker set search_path=''as $jobs$
declare c text;delta integer;failed_delta integer;cap integer;artifact_n bigint;artifact_bytes bigint;
begin
 c:=coalesce(new.storage_class,old.storage_class);
 if tg_op='UPDATE'and new.storage_class<>old.storage_class then
  -- Both counters locked in lexical order. Heavy/dispatch/claim locks protect the
  -- bounded archival caller; triggers remain atomic for all other writers.
  perform 1 from private.provider_snapshot_storage_usage order by storage_class for update;
  select count(*),coalesce(sum(stored_bytes),0)into artifact_n,artifact_bytes from private.provider_snapshot_artifacts where job_id=new.id;
  update private.provider_snapshot_storage_usage set jobs=jobs+1,failed_jobs=failed_jobs+(new.status='failed')::int,
   artifacts=artifacts+artifact_n,stored_bytes=stored_bytes+artifact_bytes
   where storage_class='history'and jobs<50000 and artifacts+artifact_n<=25000 and stored_bytes+artifact_bytes<=2147483648;
  if not found then raise exception using errcode='54000',message='snapshot_history_capacity';end if;
  update private.provider_snapshot_storage_usage set jobs=jobs-1,failed_jobs=failed_jobs-(old.status='failed')::int,
   artifacts=artifacts-artifact_n,stored_bytes=stored_bytes-artifact_bytes where storage_class='hot';
  if not found then raise exception 'snapshot_storage_counter_missing';end if;
  return new;
 end if;
 delta:=case tg_op when'INSERT'then 1 when'DELETE'then -1 else 0 end;
 failed_delta:=case when tg_op<>'DELETE'and new.status='failed'then 1 else 0 end-case when tg_op<>'INSERT'and old.status='failed'then 1 else 0 end;
 cap:=case c when'history'then 50000 else 5000 end;
 update private.provider_snapshot_storage_usage set jobs=jobs+delta,failed_jobs=failed_jobs+failed_delta
 where storage_class=c and(delta<>1 or(jobs<cap and failed_jobs<500));
 if not found then raise exception using errcode='54000',message='snapshot_queue_capacity';end if;
 return coalesce(new,old);
end;$jobs$;
drop trigger provider_snapshot_account_jobs on private.provider_snapshot_jobs;
create trigger provider_snapshot_account_jobs after insert or delete or update of status,storage_class on private.provider_snapshot_jobs for each row execute function private.provider_snapshot_account_jobs();
-- Preserve account_artifacts metadata/OID and every existing quota rule.
do $patch$
declare d text;old_text text:='select private.provider_snapshot_storage_class(j.target,j.window_from,j.window_to)into strict c from private.provider_snapshot_jobs j where j.id=coalesce(new.job_id,old.job_id);';
begin
 d:=pg_get_functiondef('private.provider_snapshot_account_artifacts()'::regprocedure);
 if(length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 then raise exception 'snapshot_artifact_class_patch_drift';end if;
 execute replace(d,old_text,'select j.storage_class into strict c from private.provider_snapshot_jobs j where j.id=coalesce(new.job_id,old.job_id);');
end;$patch$;

create table private.provider_snapshot_failed_archive(
 job_id uuid primary key,job_record jsonb not null,cohort_records jsonb not null,membership_records jsonb not null,
 evidence_md5 text not null,archived_at timestamptz not null default clock_timestamp(),restored_at timestamptz
);
alter table private.provider_snapshot_failed_archive enable row level security;
revoke all on private.provider_snapshot_failed_archive from public,anon,authenticated,service_role;

create function private.provider_snapshot_archive_old_failures(p_limit integer default 100)returns jsonb language plpgsql volatile security invoker set search_path=''as $fn$
declare j private.provider_snapshot_jobs%rowtype;cohorts jsonb;members jsonb;n integer:=0;budget interval;
begin
 if current_user<>'postgres'then raise exception 'snapshot_storage_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if p_limit is null or p_limit not between 1 and 100 or budget<=interval'0'or budget>interval'5seconds'then raise exception 'snapshot_storage_budget';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then return jsonb_build_object('status','busy');end if;
 if exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())then return jsonb_build_object('status','busy');end if;
 if not private.provider_snapshot_storage_balanced()then raise exception 'snapshot_storage_counters_drift';end if;
 for j in select q.*from private.provider_snapshot_jobs q
  where q.status='failed'and q.storage_class='hot'and(q.lease_until is null or q.lease_until<=clock_timestamp())
  and q.window_to<=((statement_timestamp()at time zone'Asia/Kolkata')::date::timestamp at time zone'Asia/Kolkata')
  and q.updated_at<clock_timestamp()-interval'1hour'
  and not exists(select 1 from private.provider_snapshot_heads h where h.job_id=q.id)
  and not exists(select 1 from private.provider_snapshot_artifacts a where a.job_id=q.id)
  and exists(select 1 from private.provider_snapshot_cohort_jobs m where m.job_id=q.id)
  and not exists(select 1 from private.provider_snapshot_cohort_jobs m join private.provider_snapshot_cohorts c on c.id=m.cohort_id where m.job_id=q.id and(c.lane<>'current'or c.local_date>=(statement_timestamp()at time zone'Asia/Kolkata')::date or c.status not in('failed','obsolete')))
  and not exists(select 1 from private.provider_snapshot_failed_archive a where a.job_id=q.id)
  order by q.window_to,q.id for update of q skip locked limit p_limit
 loop
  select jsonb_agg(to_jsonb(m)order by m.cohort_id),jsonb_agg(to_jsonb(c)order by c.id)into members,cohorts
   from private.provider_snapshot_cohort_jobs m join private.provider_snapshot_cohorts c on c.id=m.cohort_id where m.job_id=j.id;
  insert into private.provider_snapshot_failed_archive(job_id,job_record,cohort_records,membership_records,evidence_md5)
   values(j.id,to_jsonb(j),cohorts,members,md5(jsonb_build_array(to_jsonb(j),cohorts,members)::text));
  delete from private.provider_snapshot_cohort_jobs where job_id=j.id;
  delete from private.provider_snapshot_jobs where id=j.id;
  n:=n+1;
 end loop;
 if not private.provider_snapshot_storage_balanced()then raise exception 'snapshot_storage_counters_drift';end if;
 return jsonb_build_object('status','archived','jobs',n);
end;$fn$;
revoke all on function private.provider_snapshot_archive_old_failures(integer)from public,anon,authenticated,service_role;

create function private.provider_snapshot_restore_failed(p_job uuid)returns jsonb language plpgsql volatile security invoker set search_path=''as $fn$
declare a private.provider_snapshot_failed_archive%rowtype;v jsonb;budget interval;
begin
 if current_user<>'postgres'then raise exception 'snapshot_storage_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if budget<=interval'0'or budget>interval'5seconds'then raise exception 'snapshot_storage_budget';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then return jsonb_build_object('status','busy');end if;
 select *into a from private.provider_snapshot_failed_archive where job_id=p_job for update;
 if exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())then return jsonb_build_object('status','busy');end if;
 if not private.provider_snapshot_storage_balanced()then raise exception 'snapshot_storage_counters_drift';end if;
 if not found or a.restored_at is not null then raise exception 'snapshot_archive_not_restorable';end if;
 if a.evidence_md5<>md5(jsonb_build_array(a.job_record,a.cohort_records,a.membership_records)::text)then raise exception 'snapshot_archive_evidence_changed';end if;
 if not private.provider_snapshot_target_current(a.job_record->'target')then raise exception 'snapshot_archive_target_changed';end if;
 for v in select value from jsonb_array_elements(a.cohort_records)loop
  if not exists(select 1 from private.provider_snapshot_cohorts c where c.id=(v->>'id')::uuid and to_jsonb(c)=v)then raise exception 'snapshot_archive_cohort_changed';end if;
 end loop;
 insert into private.provider_snapshot_jobs select *from jsonb_populate_record(null::private.provider_snapshot_jobs,a.job_record);
 insert into private.provider_snapshot_cohort_jobs select *from jsonb_populate_recordset(null::private.provider_snapshot_cohort_jobs,a.membership_records);
 update private.provider_snapshot_failed_archive set restored_at=clock_timestamp()where job_id=p_job;
 return jsonb_build_object('status','restored_failed','jobId',p_job);
end;$fn$;
revoke all on function private.provider_snapshot_restore_failed(uuid)from public,anon,authenticated,service_role;

create function private.provider_snapshot_archive_closed_storage(p_limit integer default 100)returns jsonb language plpgsql volatile security invoker set search_path=''as $fn$
declare ids uuid[];n integer;budget interval;
begin
 if current_user<>'postgres'then raise exception 'snapshot_storage_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if p_limit is null or p_limit not between 1 and 100 or budget<=interval'0'or budget>interval'5seconds'then raise exception 'snapshot_storage_budget';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))or not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then return jsonb_build_object('status','busy');end if;
 if exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())then return jsonb_build_object('status','busy');end if;
 if not private.provider_snapshot_storage_balanced()then raise exception 'snapshot_storage_counters_drift';end if;
 perform 1 from private.provider_snapshot_storage_usage order by storage_class for update;
 select array_agg(id order by id)into ids from(select q.id from private.provider_snapshot_jobs q where q.storage_class='hot'and q.status='ready'
  and(q.lease_until is null or q.lease_until<=clock_timestamp())
  and q.window_to<=((statement_timestamp()at time zone'Asia/Kolkata')::date::timestamp at time zone'Asia/Kolkata')
  and not exists(select 1 from private.provider_snapshot_cohort_jobs m join private.provider_snapshot_cohorts c on c.id=m.cohort_id where m.job_id=q.id and(c.status='building'or c.local_date>=(statement_timestamp()at time zone'Asia/Kolkata')::date))
  order by q.window_to,q.id for update of q skip locked limit p_limit)s;
 perform set_config('app.snapshot_storage_move',pg_current_xact_id()::text,true);
 update private.provider_snapshot_jobs set storage_class='history'where id=any(ids);
 get diagnostics n=row_count;
 perform set_config('app.snapshot_storage_move','',true);
 if not private.provider_snapshot_storage_balanced()then raise exception 'snapshot_storage_counters_drift';end if;
 return jsonb_build_object('status','archived_storage','jobs',n);
end;$fn$;
revoke all on function private.provider_snapshot_archive_closed_storage(integer)from public,anon,authenticated,service_role;

-- Bounded independent maintenance calls: failure archival cannot be rolled back
-- by a later retirement proof; no source jobs are retried by these operations.
commit;
