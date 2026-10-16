-- Metadata only: change one existing cron command via the managed pg_cron API.
-- The called dispatcher, source collectors, schedules, active flags and query readers stay unchanged.
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL statement_timeout='3s';
SET LOCAL lock_timeout='500ms';
DO $activate$
DECLARE original cron.job%rowtype; checked cron.job%rowtype;
BEGIN
 IF current_user<>'postgres' OR current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'snapshot_dispatch_wait_denied'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_cron_install_v1',0))
 OR NOT pg_try_advisory_xact_lock(hashtext('provider_snapshot_maintenance_activation_v1')) THEN RAISE EXCEPTION 'snapshot_dispatch_wait_activation_busy'; END IF;
 SELECT * INTO original FROM cron.job WHERE jobid=34 AND jobname='provider-snapshot-dispatch-v1';
 IF NOT FOUND OR original.username<>current_user OR original.database<>current_database() OR original.schedule<>'* * * * *' OR NOT original.active
 OR original.command IS DISTINCT FROM $expected_command$BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='3s';
SET LOCAL lock_timeout='500ms';
SELECT private.provider_snapshot_dispatch(clock_timestamp(),600);
COMMIT;$expected_command$ THEN RAISE EXCEPTION 'snapshot_dispatch_wait_cron_drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.provider_snapshot_dispatch(timestamp with time zone,integer)')
 AND md5(prosrc)='206cb60ab0e079b61bb374026662238d' AND pg_get_userbyid(proowner)='postgres' AND NOT prosecdef
 AND proconfig=array['search_path=""'] AND proacl::text='{postgres=X/postgres}'
 AND pg_get_function_arguments(oid)='p_observed_at timestamp with time zone DEFAULT now(), p_interval_seconds integer DEFAULT 600')
 THEN RAISE EXCEPTION 'snapshot_dispatch_wait_function_drift'; END IF;
 -- cron.job is SELECT-only on managed Postgres. Do not use FOR UPDATE or direct DML.
 SELECT * INTO checked FROM cron.job WHERE jobid=original.jobid;
 IF NOT FOUND OR to_jsonb(checked) IS DISTINCT FROM to_jsonb(original) THEN RAISE EXCEPTION 'snapshot_dispatch_wait_cron_drift'; END IF;
 PERFORM cron.alter_job(original.jobid,command:=$next_command$BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='3s';
SET LOCAL lock_timeout='500ms';
-- Both waits and dispatch share one 3 s statement deadline. Each lock waits at most 500 ms.
WITH dispatch_lock AS MATERIALIZED (
 SELECT pg_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))
), claim_lock AS MATERIALIZED (
 SELECT pg_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0)) FROM dispatch_lock
)
SELECT private.provider_snapshot_dispatch(clock_timestamp(),600) FROM claim_lock;
COMMIT;$next_command$);
 SELECT * INTO checked FROM cron.job WHERE jobid=original.jobid;
 IF NOT FOUND OR (to_jsonb(checked)-'command') IS DISTINCT FROM (to_jsonb(original)-'command')
 OR checked.command IS DISTINCT FROM $next_command$BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='3s';
SET LOCAL lock_timeout='500ms';
-- Both waits and dispatch share one 3 s statement deadline. Each lock waits at most 500 ms.
WITH dispatch_lock AS MATERIALIZED (
 SELECT pg_advisory_xact_lock(hashtextextended('provider_snapshot_dispatch_v1',0))
), claim_lock AS MATERIALIZED (
 SELECT pg_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0)) FROM dispatch_lock
)
SELECT private.provider_snapshot_dispatch(clock_timestamp(),600) FROM claim_lock;
COMMIT;$next_command$ THEN RAISE EXCEPTION 'snapshot_dispatch_wait_api_drift'; END IF;
END;$activate$;
COMMIT;
