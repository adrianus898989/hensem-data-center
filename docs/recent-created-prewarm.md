# Recent created-day refresh

Existing recent-day results could remain on the closed-day twice-daily refresh schedule even though interactive reads already used a shorter recent-day interval. The country prewarm planner now uses the same existing recent-day policy and ranks ready jobs by their effective deadline before selecting its bounded batch. This prevents future jobs at the front of the stored-deadline order from delaying already-due jobs.

The migration changes only `private.dashboard_serving_country_prewarm`. It preserves the approved native target list, six-target and 50-ready-job limits, created-date basis, original worker queue, failed/running protection, and `FOR UPDATE OF j SKIP LOCKED` lock behavior. No cron, grants, schema, source data or publication rows are changed. The former scheduled-only assignment is replaced in the original loop; there is no second refresh loop.

The helper's original query-only comment records its installation context; this migration adds the planner as a caller without editing the helper definition or changing semantic dependency hashes. Full-day created requests accepted by the existing helper, including eligible filtered requests, use its recent interval. Older dates, non-day ranges and explicit success windows retain the original schedule. This is not an arbitrary-history source-change invalidation system.

Install and rollback require the exact pinned function metadata and the original dispatcher advisory lock. A mismatch aborts the transaction. Rollback restores the previous body but does not reverse already processed queue jobs or erase worker artifacts. Do not weaken metadata guards to force a stale migration onto changed functions.

Run the 28 actual SQL behavior and metadata checks with:

```sh
node --test tests/prepared-recent-prewarm.test.cjs tests/prepared-recent-prewarm-metadata.test.cjs
```

These tests use PGlite, real planner/queue/key/deadline definitions and synthetic identities. They verify recent/manual/older-date policy, bounded fairness and next-tick progression, state preservation, head/dependency handling, installation, rejected replay, rollback and ACL drift. They do not replace production worker or multi-session contention checks.
