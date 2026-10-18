-- Standalone one-time maintenance command, outside every transaction/DO/function.
-- Require this name absent and all existing indexes/financial functions unchanged.
-- Access path for the original excluded-type diagnostics only; do not remove
-- those diagnostics or infer zero/complete from an absent source row.
CREATE INDEX CONCURRENTLY newar_workorder_usdt_created_v1_idx
ON public.newar_detail_records USING btree(platform,created_at)
WHERE dataset='workorder' AND workorder_type='USDT存款未到账自动化';

-- Require valid+ready+live, nonunique, exact two keys/predicate; no INCLUDE/raw.
-- A cancelled build may leave an invalid index. Verify its exact OID/definition
-- and that the recorded build backend has stopped before optional standalone:
-- DROP INDEX CONCURRENTLY public.newar_workorder_usdt_created_v1_idx;
