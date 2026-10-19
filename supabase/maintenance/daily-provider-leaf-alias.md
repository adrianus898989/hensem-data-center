# Optional provider leaf transport alias

Install `daily-provider-leaf-alias.sql` before enabling the client option. Roll back with the paired `.rollback.sql`; a client that already opted in still accepts the original complete DTO after rollback.

Only V2 provider requests explicitly carrying `providerLeafAliases: "items-fee-items-v1"` may use this encoding. After the existing complete exact response, authorization, native/dependency/head proofs and size checks, a provider row's `items` may be omitted only when it and `fee_items` are arrays with equal JSONB **and equal JSON text**. The separate `providerLeafAliasTransport` marker lists the affected row indices. If marker overhead would enlarge the response, the original response is retained. Unnegotiated, force, missing, stale/last-complete and unsupported paths keep their prior behavior.

The prepared client restores the full original DTO before validation, cache and native enrichment, removes the marker and enforces the original expanded size limit. Every fee fact, unknown/null field, original name and publication remains intact. Identical restored arrays may share an object reference within one verified native enrichment context; different arrays remain independent. Financial projection, canonicalization, source data and preparation jobs do not change.

Existing-artifact width evidence found substantial duplicate leaves in two seven-day platform responses. This supports a smaller wire format; it is not an end-to-end latency guarantee. Local synthetic whole-JSON/text, permission/current-head, cache/cancellation and full paired CAS/rollback tests cover the contract. Production timing and page acceptance remain separate checks.
