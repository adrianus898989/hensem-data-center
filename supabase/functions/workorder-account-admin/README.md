# Independent workorder accounts

Deploy this new function separately; do not replace `dashboard-user-admin`.
Apply `supabase/workorder-portal-accounts.sql` first. The function verifies every
bearer through Auth and reads current permissions on every call. Edge gateway
JWT verification may be disabled only because the handler does the verification.

The backend owner manages employee accounts via POST actions:

- `me`: returns `{ok,account,catalog,identity_kind}`.
- `list-accounts`: returns `{ok,accounts,catalog}`.
- `create-account`: username, password, display_name, role, team, platforms.
- `update-account`: auth_user_id, expected_updated_at, patch (display_name, role,
  team, platforms, active). Conflicting edits return 409.
- `reset-password`: auth_user_id and password.

There is no account deletion action. Disable an account to retain case/audit
ownership. Passwords are kept only by Supabase Auth, never in application tables
or audit records. Employee aliases use `username@workorder.hensem.local`; they
have no dashboard_profiles row. Only a current active dashboard owner can enter
the portal as owner; email or user_metadata are never authorization evidence.

The catalog is the real registered India platform directory: active `IN` rows
in dashboard_platform_team_map plus the 香港/红膏蟹 game66_platforms registry.
`game66_platforms.enabled` controls collector scheduling, not employee access.
This catalog count is not an assertion of completed order ingestion. Conflicting
platform names across teams are excluded until the identity is disambiguated.
Staff `me` receives only their currently authorized team/platform directory.

For the Worker proxy, this function stores only the SHA-256 verifier of the
independent `PORTAL_IDENTITY_KEY` kept in the Worker's secret store.
Requests carry `x-portal-proxy-key` and Cloudflare-verified visitor IP in
`x-portal-client-ip`. The function accepts a forwarded IP only after verifying
the key hash, then applies the existing dashboard IP whitelist to portal owners.
Never forward either header from browser input. Browser preflights do not allow
those headers. No service-role key belongs in the Worker or browser.

The portal should keep access/refresh tokens in secure HttpOnly cookies, call
`me` for each protected request, and derive D1 membership by auth_user_id from
that response. D1 role/team/platform copies are projections, not authorities.
Do not auto-promote the first employee to owner. Existing Sites mode remains
separate; production Supabase login needs no Cloudflare Zero Trust subscription.

Before production rollout, validate the SQL and role isolation tests, perform a
staff login/backend denial test, and verify that disabling a logged-in account
blocks its next portal request. Do not create test employees in live data merely
to run unit tests.
