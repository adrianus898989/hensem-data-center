-- Only this release's jobs: successful logs 24h, failed logs 7d; at most 1000 per tick.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='3s';
SET LOCAL lock_timeout='500ms';
WITH expired AS MATERIALIZED (
 SELECT d.runid FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid
 WHERE j.jobname IN ('provider-snapshot-worker-v1','provider-snapshot-dispatch-v1','provider-snapshot-maintenance-v1')
 AND j.username=current_user AND j.database=current_database()
 AND d.username=current_user AND d.database=current_database()
 AND ((d.status='succeeded' AND d.end_time<clock_timestamp()-interval'1day')
   OR (d.status='failed' AND d.end_time<clock_timestamp()-interval'7days'))
 ORDER BY d.runid LIMIT 1000
)
DELETE FROM cron.job_run_details d USING expired e WHERE d.runid=e.runid;
COMMIT;
-- Keep log cleanup committed if derived-storage maintenance subsequently fails.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='5s';
SET LOCAL lock_timeout='500ms';
SELECT private.provider_snapshot_maintain(100);
COMMIT;
