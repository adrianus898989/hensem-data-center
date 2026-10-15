-- One task per tick; same libpq connection, durable claim before computation.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='3s';
SET LOCAL lock_timeout='500ms';
SELECT private.provider_snapshot_prepare_claim('product-provider-snapshot-v1');
COMMIT;
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='50s';
SET LOCAL lock_timeout='500ms';
SELECT private.provider_snapshot_run_claimed('product-provider-snapshot-v1');
COMMIT;
