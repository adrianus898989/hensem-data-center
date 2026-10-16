-- Review/run only after storage-maintenance.sql and log-cleanup.sql install.
-- New tasks are bounded bookkeeping, not new aggregation workers.
begin;set local statement_timeout='3s';set local lock_timeout='500ms';
do $fn$
declare j cron.job%rowtype;
begin
 if current_user<>'postgres'then raise exception 'snapshot_maintenance_denied';end if;
 select *into j from cron.job where jobname='provider-snapshot-maintenance-v1'for update;
 if not found or j.username<>current_user or j.database<>current_database()or j.schedule<>'*/5 * * * *'or not j.active
 or md5(j.command)<>'7013a5f440c5c815295e0fb2c03766c0'then raise exception 'snapshot_maintenance_cron_drift';end if;
 if exists(select 1 from cron.job where jobname in('provider-snapshot-storage-archive-v1','provider-snapshot-failure-archive-v1','provider-snapshot-log-cleanup-v1'))then raise exception 'snapshot_maintenance_new_job_exists';end if;
 if to_regprocedure('private.provider_snapshot_cleanup_logs(integer)')is null or to_regprocedure('private.provider_snapshot_archive_old_failures(integer)')is null
 or to_regprocedure('private.provider_snapshot_archive_closed_storage(integer)')is null then raise exception 'snapshot_maintenance_helper_missing';end if;
 if not private.provider_snapshot_storage_balanced()then raise exception 'snapshot_storage_counters_drift';end if;
 -- Wider-cutoff retirement cannot preserve every custom historical end. Keep
 -- that old function inactive; collect unreferenced versions only.
 perform cron.alter_job(j.jobid,command:=$maintain$begin;set local statement_timeout='5s';set local lock_timeout='500ms';select private.provider_snapshot_gc_versions(100);commit;$maintain$);
 perform cron.schedule('provider-snapshot-storage-archive-v1','* * * * *',$storage$begin;set local statement_timeout='5s';set local lock_timeout='500ms';select private.provider_snapshot_archive_closed_storage(100);commit;$storage$);
 perform cron.schedule('provider-snapshot-failure-archive-v1','* * * * *',$failed$begin;set local statement_timeout='5s';set local lock_timeout='500ms';select private.provider_snapshot_archive_old_failures(100);commit;$failed$);
 perform cron.schedule('provider-snapshot-log-cleanup-v1','* * * * *',$logs$begin;set local statement_timeout='3s';set local lock_timeout='500ms';select private.provider_snapshot_cleanup_logs(1000);commit;$logs$);
end;$fn$;
commit;
