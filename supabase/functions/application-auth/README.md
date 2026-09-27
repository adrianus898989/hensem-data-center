# Application login gateway

`application-auth` is a Worker-only gateway for the independent `dashboard` and `workorder` identities. Deploy with `verify_jwt=false`: login has no JWT; every authenticated action verifies its token through Supabase Auth before using `session_id`.

Every request is POST JSON with server-only `x-portal-proxy-key` and `x-portal-client-ip`. The Worker must construct both headers itself using its platform's trusted visitor address. This endpoint has no browser CORS permission. The proxy key's SHA-256 verifier is shared with the existing workorder identity proxy. No password, token, key, or complete request body may be logged.

- `login`: `{action, surface, username, password}`. Supabase Auth checks the password. The database reserves one outstanding attempt per account; definitive invalid credentials increment its counter. Unavailable/429 responses do not. Successful gateway-created sessions are registered; a direct Auth session is never registered.
- `refresh`: `{action, surface, refresh_token}`. Refreshes through Auth, verifies the returned user/session, and requires an existing approved session. It cannot create registration.
- `me`: `{action, surface}`, with Bearer. Fresh account, approved session and current trusted IP checks. Workorder permissions and catalog come from the authoritative workorder account endpoint.
- `logout` / `logout-all`: `{action, surface}`, with Bearer. Revokes the current approved session or all own sessions in the same surface before local/global Auth logout. Auth logout failure does not undo the registry revocation.

Success is `{ok:true, identity_kind:'dashboard'|'workorder', account, catalog?, tokens?}`. Tokens contain only `access_token`, `refresh_token`, `expires_at`, `expires_in`, `token_type`, and verified `user:{id,email?}`. Logout returns `{ok:true}`. Failures return `{ok:false,code,message}` without upstream internals.

The IP whitelist protects login/refresh and trusted gateway operations. Existing browser Data API calls enforce approved session + live account + lock status and recheck that the registered login IP still fits the current policy. This does **not** claim to enforce the network address of every direct REST request. Such a policy would require proxying all business requests through a trusted IP gateway.

Session validation is service-only `application_session_check(p_user_id,p_session_id,p_surface)`. Call only after Auth verified that exact token. Consumers using the end-user REST bearer may call `application_session_guard()`; it binds to JWT user/session and checks dashboard membership.

See `application-login-security.sql` (prepare) and `application-login-security-activate.sql` (intentional cutover). Do not activate until the new gateway, Worker proxy, and login client are available. Deployment/emergency recovery details are maintained in the private release validation runbook.
