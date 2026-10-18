-- Run once as a standalone top-level maintenance command, outside any transaction.
-- Check that this name is absent and existing indexes are valid before execution.
-- This is a non-unique access path only; original source predicates and financial
-- readers stay unchanged. Do not replace/drop shared indexes or include raw JSON.
CREATE INDEX CONCURRENTLY newar_workorder_deposit_created_v1_idx
ON public.newar_detail_records USING btree (platform,created_at)
WHERE dataset='workorder'
  AND workorder_type IN ('存款未到账','存款未到账自动化');

-- Require valid+ready+live and the exact definition after completion.
-- A cancelled/failed concurrent build can leave an invalid index with write cost.
-- Optional rollback, only after the exact recorded build backend has ended and
-- the trial object's OID/definition have been rechecked (standalone command):
-- DROP INDEX CONCURRENTLY public.newar_workorder_deposit_created_v1_idx;
