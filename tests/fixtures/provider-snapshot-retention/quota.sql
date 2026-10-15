-- Independent derived-storage budgets. These counters never inspect source orders.
create function private.provider_snapshot_storage_class(p_target jsonb,p_from timestamptz,p_to timestamptz)
returns text language sql immutable security invoker set search_path=''as $class$
 select case when p_target->>'scope_group'='IN'and p_target->>'timezone'in('Asia/Kolkata','Asia/Calcutta')
  and(p_from at time zone'Asia/Kolkata')::time=time'00:00:00'
  and(p_to at time zone'Asia/Kolkata')=(p_from at time zone'Asia/Kolkata')+interval'1day'
  then'history'else'hot'end;
$class$;
revoke all on function private.provider_snapshot_storage_class(jsonb,timestamptz,timestamptz)from public,anon,authenticated,service_role;
create table private.provider_snapshot_storage_usage(
 storage_class text primary key check(storage_class in('hot','history')),
 jobs bigint not null default 0 check(jobs>=0),failed_jobs bigint not null default 0 check(failed_jobs>=0),
 artifacts bigint not null default 0 check(artifacts>=0),stored_bytes bigint not null default 0 check(stored_bytes>=0)
);
alter table private.provider_snapshot_storage_usage enable row level security;
revoke all on private.provider_snapshot_storage_usage from public,anon,authenticated,service_role;
insert into private.provider_snapshot_storage_usage(storage_class)values('hot'),('history');
with j as(select private.provider_snapshot_storage_class(target,window_from,window_to)c,count(*)jobs,count(*)filter(where status='failed')failed from private.provider_snapshot_jobs group by 1)
update private.provider_snapshot_storage_usage u set jobs=j.jobs,failed_jobs=j.failed from j where u.storage_class=j.c;
with a as(select private.provider_snapshot_storage_class(j.target,j.window_from,j.window_to)c,count(*)artifacts,sum(a.stored_bytes)bytes
 from private.provider_snapshot_artifacts a join private.provider_snapshot_jobs j on j.id=a.job_id group by 1)
update private.provider_snapshot_storage_usage u set artifacts=a.artifacts,stored_bytes=a.bytes from a where u.storage_class=a.c;
create function private.provider_snapshot_job_identity_immutable()
returns trigger language plpgsql security invoker set search_path=''as $identity$
begin
 if row(new.request_key,new.target,new.request,new.component,new.platform_id,new.window_from,new.window_to)
  is distinct from row(old.request_key,old.target,old.request,old.component,old.platform_id,old.window_from,old.window_to)
 then raise exception using errcode='55000',message='snapshot_job_identity_immutable';end if;return new;
end;$identity$;
revoke all on function private.provider_snapshot_job_identity_immutable()from public,anon,authenticated,service_role;
create trigger provider_snapshot_job_identity_immutable before update on private.provider_snapshot_jobs for each row execute function private.provider_snapshot_job_identity_immutable();
create function private.provider_snapshot_account_jobs()
returns trigger language plpgsql security invoker set search_path=''as $jobs$
declare c text;delta integer;failed_delta integer;cap integer;
begin
 c:=private.provider_snapshot_storage_class(coalesce(new.target,old.target),coalesce(new.window_from,old.window_from),coalesce(new.window_to,old.window_to));
 delta:=case tg_op when'INSERT'then 1 when'DELETE'then -1 else 0 end;
 failed_delta:=case when tg_op<>'DELETE'and new.status='failed'then 1 else 0 end-case when tg_op<>'INSERT'and old.status='failed'then 1 else 0 end;
 cap:=case c when'history'then 50000 else 5000 end;
 -- AFTER INSERT runs only for actually inserted keys, never an ON CONFLICT replay.
 -- One counter row lock makes concurrent enqueue admission atomic.
 update private.provider_snapshot_storage_usage set jobs=jobs+delta,failed_jobs=failed_jobs+failed_delta
 where storage_class=c and(delta<>1 or(jobs<cap and failed_jobs<500));
 if not found then raise exception using errcode='54000',message='snapshot_queue_capacity';end if;
 return coalesce(new,old);
end;$jobs$;
revoke all on function private.provider_snapshot_account_jobs()from public,anon,authenticated,service_role;
create trigger provider_snapshot_account_jobs after insert or delete or update of status on private.provider_snapshot_jobs for each row execute function private.provider_snapshot_account_jobs();
create function private.provider_snapshot_account_artifacts()
returns trigger language plpgsql security invoker set search_path=''as $artifacts$
declare c text;delta integer;bytes bigint;cap integer;byte_cap bigint;
begin
 select private.provider_snapshot_storage_class(j.target,j.window_from,j.window_to)into strict c from private.provider_snapshot_jobs j where j.id=coalesce(new.job_id,old.job_id);
 delta:=case tg_op when'INSERT'then 1 else -1 end;bytes:=coalesce(new.stored_bytes,old.stored_bytes)*delta;
 cap:=case c when'history'then 25000 else 2048 end;byte_cap:=case c when'history'then 2147483648 else 268435456 end;
 update private.provider_snapshot_storage_usage set artifacts=artifacts+delta,stored_bytes=stored_bytes+bytes
 where storage_class=c and(delta<0 or(artifacts<cap and stored_bytes+bytes<=byte_cap));
 if not found then raise exception using errcode='54000',message='snapshot_artifact_capacity';end if;
 return coalesce(new,old);
end;$artifacts$;
revoke all on function private.provider_snapshot_account_artifacts()from public,anon,authenticated,service_role;
create trigger provider_snapshot_account_artifacts after insert or delete on private.provider_snapshot_artifacts for each row execute function private.provider_snapshot_account_artifacts();
create function private.provider_snapshot_deny_truncate()
returns trigger language plpgsql security invoker set search_path=''as $truncate$
begin raise exception using errcode='55000',message='snapshot_accounting_requires_bounded_delete';end;$truncate$;
revoke all on function private.provider_snapshot_deny_truncate()from public,anon,authenticated,service_role;
create trigger provider_snapshot_deny_truncate before truncate on private.provider_snapshot_jobs for each statement execute function private.provider_snapshot_deny_truncate();
create trigger provider_snapshot_deny_truncate before truncate on private.provider_snapshot_artifacts for each statement execute function private.provider_snapshot_deny_truncate();
