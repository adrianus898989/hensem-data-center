-- MANUAL MAINTENANCE ONLY. This is NOT a transactional migration.
-- Do not run this file automatically or pass the entire file to an SQL runner.
-- Select and execute ONE CREATE INDEX CONCURRENTLY statement at a time using a
-- verified autocommit connection. Never wrap it in BEGIN/COMMIT, a function,
-- DO block, or a transaction-wrapping migration runner.
--
-- Scope: only MAANWIN/DhaniWin charge/withdraw. No function, auth, role, ACL,
-- RLS, timeout policy or order-data change; existing indexes remain untouched.
-- Local tests prove eligibility and result parity, NOT production planner
-- choice, zero heap fetches, duration or the authenticated request SLA.
--
-- Deployment attempt, 2026-10-12 (not a successful rollout):
-- The first build through the official SQL Editor was stopped by an upstream
-- timeout. It reached 122 MB, indisready=true, indisvalid=false, with no active
-- pg_stat_progress_create_index row. It was NOT usable by the planner.
-- The second build was not attempted. The failed first index was subsequently
-- removed after user approval; the operator verified both names were absent.
-- Order data was not changed. Recheck current state before any later retry.
-- Retry only AFTER cleanup is confirmed, through a direct, verified autocommit
-- connection with sufficient execution time; execute one CREATE at a time.
-- This file is not evidence that the remaining NEWAR read timeout is fixed.
--
-- Before EACH build:
-- 1. Inspect the exact index name/definition, storage headroom and concurrent
--    activity. Concurrent builds still consume heap reads, CPU, I/O and WAL.
-- 2. Choose short session lock_timeout and an explicit bounded build budget on
--    that same verified connection. Do not change role/database timeout policy.
-- 3. Do not use IF NOT EXISTS to silently accept an invalid or different index.
-- 4. Only one concurrent index build on this table may be active at a time.
--
-- After EACH build, check both indisready AND indisvalid (not just file size):
-- SELECT c.relname, i.indisready, i.indisvalid, pg_get_indexdef(c.oid)
-- FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
-- JOIN pg_index i ON i.indexrelid=c.oid
-- WHERE n.nspname='public' AND c.relname IN
--   ('newar_member_two_created_cover_idx','newar_member_two_success_cover_idx');
--
-- If the client reports timeout/disconnect, DO NOT blindly rerun or drop it:
-- first check index state and active progress from a fresh connection.
-- ready=true/valid=false may still be an active build, not a completed failure.
-- SELECT pid, phase, lockers_total, lockers_done, blocks_total, blocks_done,
--        tuples_total, tuples_done
-- FROM pg_stat_progress_create_index
-- WHERE relid='public.newar_detail_records'::regclass;
-- Confirm no active build before deciding whether an invalid leftover should
-- be removed and retried. Do not cancel collection or other sessions.
-- Verify the unchanged member reader for both platforms/directions after the
-- valid indexes exist, with bounded EXPLAIN and independently recorded parity.
--
-- Statement 1: execute alone, then verify completion before statement 2.
CREATE INDEX CONCURRENTLY newar_member_two_created_cover_idx
ON public.newar_detail_records (platform,dataset,created_at)
INCLUDE (member_id,currency)
WHERE platform IN ('MAANWIN','DhaniWin') AND dataset IN ('charge','withdraw');

-- Statement 2: execute alone only after statement 1 has finished.
CREATE INDEX CONCURRENTLY newar_member_two_success_cover_idx
ON public.newar_detail_records (platform,dataset,success_at)
INCLUDE (member_id,currency,created_at)
WHERE platform IN ('MAANWIN','DhaniWin') AND dataset IN ('charge','withdraw')
AND status_group='success' AND success_at IS NOT NULL;

-- ROLLBACK: remove only these exact new indexes, one autocommit statement at a
-- time, after confirming no build is active. This removes the optimization;
-- it does not delete order data or revert/alter any reader function or grants.
-- DROP INDEX CONCURRENTLY public.newar_member_two_created_cover_idx;
-- DROP INDEX CONCURRENTLY public.newar_member_two_success_cover_idx;
--
-- PostgreSQL concurrent-build caveats:
-- https://www.postgresql.org/docs/current/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY
