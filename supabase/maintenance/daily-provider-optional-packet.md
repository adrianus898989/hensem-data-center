# Optional provider prefetch packets

The exact prepared reader builds a provider reuse packet only for explicit valid `providerReuseNames` hints (1–200 string names, at most 8 KiB). Main-only requests retain the same financial result and publication, current native/head/dependency checks and final scope token proof. Invalid optional hints do not change main statistics. Force, missing and last-complete paths remain on the existing reader.

Install the paired SQL as owner through the normal migration process. The script checks current bodies, complete metadata and ACLs, preserves every other routine, and requires common/native/provider dependency tokens to remain identical. The rollback accepts only the exact installed state. No source scanning, source collection, worker, cache or schema changes are introduced.

The host can omit the opt-in callback to avoid speculative packet generation on an initial ALL request. A previously unseen provider still uses the existing server projection over the completed immutable base. Existing opt-in clients remain compatible.

Tests compare complete financial JSONB and text against the original reader on synthetic fixtures, including explicit packets, nulls, selectors, both directions, permissions, cancellation, missing/stale heads and native changes. Production end-to-end latency must be measured after deployment; local timings are not performance evidence.
