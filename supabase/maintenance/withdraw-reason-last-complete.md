# Explicit last completed reason results

Apply `withdraw-reason-last-complete.install-disabled.sql` first. It installs only an owner-only helper and private RLS singleton; the existing reader remains unchanged. After deploying the frontend that validates `withdraw-reasons-last-complete-v1`, apply `withdraw-reason-last-complete.enable.sql`.

The original authorized read still checks current native, date, aliases, source version and semantic dependency and admits the refresh. Only then can the same scope use its immutable previous completed artifact. Publication explicitly reports `refresh_due`, the original compute/data times and the current queue state. Rows, totals, nullable values, source coverage and ordering are unchanged. Current ready results retain their original response. A narrow old/new semantic token seal permits only this audited routing change; subsequent semantic drift rejects the legacy token.

Rollback in order: `withdraw-reason-last-complete.disable.sql`, then `withdraw-reason-last-complete.remove-disabled.sql`. These restore the exact prior parent/guard and remove only the disabled helper/state. Run these before older reason-feature rollbacks. Scripts pin full function metadata and assert unchanged source schemas, financial dependency values and source generations. They introduce no new source writer, queue, worker or schedule.

The portable behavior test uses synthetic artifacts and the existing source-version fixture. It executes the complete paired guards and compares paged PostgreSQL JSONB and text exactly, excluding only the separate publication field. This does not assert production performance or that an old result is current.
