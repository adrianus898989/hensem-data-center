-- Reviewed activation after installation, synthetic parity and production
-- admission/read checks. No credential or source-data changes.
-- Run each section separately; CONCURRENTLY cannot run in a transaction.
create index concurrently if not exists newar_detail_source_updated_success_idx
 on public.newar_detail_records(platform,dataset,source_updated_at)
 where status_group='success' and source_updated_at is not null;

-- Enable bounded admission/prewarming. Existing provider snapshot jobs remain
-- in use until its consumer migrates; both worker types share the heavy lock.
begin;
set local statement_timeout='3s';
set local lock_timeout='500ms';
update private.prepared_aggregate_schedule set enabled=true where singleton;
select cron.schedule('exact-aggregate-prewarm-v1','* * * * *',
 $$set statement_timeout='3s';select private.prepared_aggregate_prewarm();$$);
select cron.schedule('exact-aggregate-worker-v1','1 second',
 $$set statement_timeout='3s';begin;select private.prepared_aggregate_prepare_claim('native-exact-cron');commit;set statement_timeout='50s';select private.prepared_aggregate_run_claimed('native-exact-cron');$$);
select cron.schedule('exact-aggregate-maintenance-v1','*/10 * * * *',
 $$set statement_timeout='3s';select private.prepared_aggregate_maintenance();$$);
commit;
