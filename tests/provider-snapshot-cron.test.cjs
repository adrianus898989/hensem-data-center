// Actual PostgreSQL lifecycle and guarded installer tests; cron scheduler APIs use an explicit portable mock.
require('./fixtures/provider-snapshot-cron/behavior.test.cjs');

// Bounded metadata dispatch locking: no calculation/kernel changes.
require('./fixtures/provider-snapshot-cron/dispatch-wait.test.cjs');
