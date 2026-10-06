# Protected dashboard entry

Public entry: `https://data-center.workdesk-hub.workers.dev/hensem-data-center/`.
The root redirects to this path to preserve the existing Next.js base path.

The fixed same-origin POST route `/hensem-data-center/api/collector-control` proxies
only the four registered human control actions to the `collector-control` Edge
Function. It still passes the entry gate first. The Worker replaces client-supplied
proof/IP headers with its existing server proof and trusted `CF-Connecting-IP`,
forwards only the bearer and bounded JSON, and never retries an ambiguous mutation.
The Edge verifies registered dashboard sessions, the account's current IP policy,
and explicit collector permissions independently. Device `pair`/`poll` are rejected
on this route and use the separately authenticated direct Edge path instead.
Neither this route nor the Edge accepts arbitrary commands or local file paths.

Before every document, asset, redirect or error response, this Worker sends only Cloudflare's trusted `CF-Connecting-IP` and its server-side `PORTAL_PROXY_KEY` proof to `application-entry-gate`. The Edge uses the service-only `application_dashboard_entry_allowed` RPC to return one boolean. Missing configuration, unlisted addresses, explicit denials and malformed authorization responses return HTTP 403 with the plain text `Access denied`; no login UI or static file is served.

Temporary gate network failures, timeouts and HTTP 5xx receive at most two fresh checks, each with a five-second deadline covering fetch and response-body reading, separated by 150ms. A fresh positive decision is required before any asset is fetched. If both checks are temporarily unavailable, the Worker returns HTTP 503 `Site temporarily unavailable` with `Retry-After: 1` and `no-store`. It never reuses an earlier allow decision. Real denials, HTTP 4xx/redirects and malformed responses are not retried. A recovered second check serves the original resource normally; exhausted temporary failures are not misreported as revoked IPs.

An enabled global IP rule permits opening the login page for any account. A bound account IP rule permits opening it while the account is active, not locked/banned/deleted, and uses a separate allowlist. Login still checks the entered account independently: a bound IP cannot authenticate another account unless that account's own/global rule permits it. The opening decision grants no role permissions or data access.

The gate has no allow-result cache. All protected responses are `private, no-store`, so a rule deletion affects the next request. Only the fixed public GitHub Pages files are fetched after authorization. Incoming cookies, Authorization, query strings, forwarding headers and account names are never copied to that upstream or the gate. Existing Supabase ingestion endpoints and collector identity permissions are not changed by this Worker.

Run `node --test cloudflare/data-center/worker.test.mjs tests/data-center-worker-security.test.cjs tests/dashboard-entry-ip-gate.test.cjs`. Before publishing, apply the reviewed `dashboard_entry_ip_gate` migration, deploy `application-entry-gate` with `verify_jwt=false` (the handler validates the independent proxy proof), and configure a dedicated opening `PORTAL_PROXY_KEY` on this existing Worker through Wrangler's secret input. Its SHA-256 must match `ENTRY_PROXY_KEY_SHA256` in the new Edge. The shared verifier function is reused, but its existing login/account-management key is not changed. Never put the secret in Wrangler vars, source, reports or terminal output. Publish the tested Worker with `wrangler deploy --config cloudflare/data-center/wrangler.jsonc` only after those prerequisites pass.

GitHub Pages is the static publishing source and cannot itself enforce server-side IP rules. Its client should direct ordinary visitors to this protected entry; downloading public source assets from Pages is not equivalent to authorization for Supabase business data.

Public static requests count against the account's free Workers request allowance, shared with its existing portal. No paid plan, custom domain, account rename or repository rename is required. Worker logs are disabled to avoid retaining client query strings. Aggregate Cloudflare request metrics remain available.
