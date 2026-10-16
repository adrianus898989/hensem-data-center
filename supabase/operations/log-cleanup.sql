-- Separate from result retention. The runid cursor bounds rows examined, even
-- when no log is old enough to expire. No source/business records are accessed.
begin;set local statement_timeout='3s';set local lock_timeout='500ms';
create table private.provider_snapshot_log_cursor(singleton boolean primary key default true check(singleton),last_runid bigint not null check(last_runid>=0));
alter table private.provider_snapshot_log_cursor enable row level security;
revoke all on private.provider_snapshot_log_cursor from public,anon,authenticated,service_role;
insert into private.provider_snapshot_log_cursor values(true,0);
create function private.provider_snapshot_cleanup_logs(p_scan integer default 1000)returns jsonb language plpgsql volatile security invoker set search_path=''as $fn$
declare cursor_id bigint;ids bigint[];scanned integer;deleted integer;max_id bigint;budget interval;
begin
 if current_user<>'postgres'then raise exception 'snapshot_log_cleanup_denied';end if;
 budget:=current_setting('statement_timeout')::interval;
 if p_scan is null or p_scan not between 1 and 1000 or budget<=interval'0'or budget>interval'3seconds'then raise exception 'snapshot_log_cleanup_budget';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_log_cleanup_v1',0))then return jsonb_build_object('status','busy');end if;
 select last_runid into strict cursor_id from private.provider_snapshot_log_cursor where singleton for update;
 select array_agg(runid),count(*),max(runid)into ids,scanned,max_id from(select runid from cron.job_run_details where runid>cursor_id order by runid limit p_scan)s;
 delete from cron.job_run_details d using cron.job j where d.runid=any(ids)and d.jobid=j.jobid
  and j.jobname in('provider-snapshot-worker-v1','provider-snapshot-dispatch-v1','provider-snapshot-maintenance-v1','provider-snapshot-storage-archive-v1','provider-snapshot-failure-archive-v1','provider-snapshot-log-cleanup-v1')
  and j.username=current_user and j.database=current_database()and d.username=current_user and d.database=current_database()
  and((d.status='succeeded'and d.end_time<statement_timestamp()-interval'1day')or(d.status='failed'and d.end_time<statement_timestamp()-interval'7days'));
 get diagnostics deleted=row_count;
 update private.provider_snapshot_log_cursor set last_runid=case when scanned<p_scan then 0 else max_id end where singleton;
 return jsonb_build_object('status','cleaned','scanned',scanned,'deleted',deleted,'wrapped',scanned<p_scan);
end;$fn$;
revoke all on function private.provider_snapshot_cleanup_logs(integer)from public,anon,authenticated,service_role;
commit;
