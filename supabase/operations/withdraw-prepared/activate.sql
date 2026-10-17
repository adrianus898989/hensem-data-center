-- Install + seed + verify first. Changes only the generic worker dispatch
-- command; no extra parallel heavy worker is created. Existing payment jobs,
-- prior published heads, native ingestion and permission policies are intact.
begin;
set local lock_timeout='500ms';
set local statement_timeout='5s';
do $activate$
declare j record;again record;
 old_command constant text:=$cmd$set statement_timeout='3s';begin;select private.prepared_aggregate_prepare_claim('native-exact-cron');commit;set statement_timeout='50s';select private.prepared_aggregate_run_claimed('native-exact-cron');$cmd$;
 new_command constant text:=$cmd$set statement_timeout='3s';begin;select private.withdraw_prepared_prepare_claim('native-exact-cron');commit;set statement_timeout='50s';select private.withdraw_prepared_run_dispatch('native-exact-cron');$cmd$;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='withdraw_prepared_installer_denied';end if;
 perform pg_advisory_xact_lock(hashtext('withdraw_prepared_activation_v1'));
 select *into j from cron.job where jobname='exact-aggregate-worker-v1';
 if not found or j.username<>'postgres'or j.database<>current_database()or j.schedule<>'1 second'or not j.active or j.command not in(old_command,new_command)then raise exception 'withdraw_prepared_worker_baseline_drift';end if;
 -- Managed postgres can SELECT cron.job but cannot row-lock or directly update
 -- it. Repeat the baseline check immediately before the supported API call.
 select *into again from cron.job where jobid=j.jobid;
 if to_jsonb(again)is distinct from to_jsonb(j)then raise exception 'withdraw_prepared_worker_changed';end if;
 perform cron.alter_job(j.jobid,command=>new_command);
 update private.withdraw_prepared_scheduler set enabled=true where singleton;
 perform cron.schedule('withdraw-prepared-refresh-v1','*/2 * * * *',$cmd$set statement_timeout='3s';select private.withdraw_prepared_prewarm();$cmd$);
 perform cron.schedule('withdraw-prepared-maintenance-v1','*/2 * * * *',$cmd$set statement_timeout='3s';select private.withdraw_prepared_maintenance();$cmd$);
end;$activate$;
commit;
