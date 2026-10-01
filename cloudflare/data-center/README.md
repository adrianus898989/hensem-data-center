# Protected dashboard entry

Public entry: `https://data-center.workdesk-hub.workers.dev/hensem-data-center/`.
The root redirects to this path to preserve the existing Next.js base path.

Before every document, asset, redirect or error response, this Worker sends only Cloudflare's trusted `CF-Connecting-IP` and its server-side `PORTAL_PROXY_KEY` proof to `application-entry-gate`. The Edge uses the service-only `application_dashboard_entry_allowed` RPC to return one boolean. Missing configuration, unavailable authorization and unlisted addresses return HTTP 403 with the plain text `Access denied`; no login UI or static file is served.

An enabled global IP rule permits opening the login page for any account. A bound account IP rule permits opening it while the account is active, not locked/banned/deleted, and uses a separate allowlist. Login still checks the entered account independently: a bound IP cannot authenticate another account unless that account's own/global rule permits it. The opening decision grants no role permissions or data access.

The gate has no allow-result cache. All protected responses are `private, no-store`, so a rule deletion affects the next request. Only the fixed public GitHub Pages files are fetched after authorization. Incoming cookies, Authorization, query strings, forwarding headers and account names are never copied to that upstream or the gate. Existing Supabase ingestion endpoints and collector identity permissions are not changed by this Worker.

Run `node --test cloudflare/data-center/worker.test.mjs tests/data-center-worker-security.test.cjs tests/dashboard-entry-ip-gate.test.cjs`. Before publishing, apply the reviewed `dashboard_entry_ip_gate` migration, deploy `application-entry-gate` with `verify_jwt=false` (the handler validates the independent proxy proof), and configure a dedicated opening `PORTAL_PROXY_KEY` on this existing Worker through Wrangler's secret input. Its SHA-256 must match `ENTRY_PROXY_KEY_SHA256` in the new Edge. The shared verifier function is reused, but its existing login/account-management key is not changed. Never put the secret in Wrangler vars, source, reports or terminal output. Publish the tested Worker with `wrangler deploy --config cloudflare/data-center/wrangler.jsonc` only after those prerequisites pass.

GitHub Pages is the static publishing source and cannot itself enforce server-side IP rules. Its client should direct ordinary visitors to this protected entry; downloading public source assets from Pages is not equivalent to authorization for Supabase business data.

Public static requests count against the account's free Workers request allowance, shared with its existing portal. No paid plan, custom domain, account rename or repository rename is required. Worker logs are disabled to avoid retaining client query strings. Aggregate Cloudflare request metrics remain available.
