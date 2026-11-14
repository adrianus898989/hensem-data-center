-- Run as a standalone statement so collection can keep writing snapshots.
-- Keep snapshots with no submitted_at available to the reader's final pass.
CREATE INDEX CONCURRENTLY ar_workorder_latest_v1_submission_time_idx
ON private.ar_workorder_latest_v1 (country_code, platform, submitted_at);
