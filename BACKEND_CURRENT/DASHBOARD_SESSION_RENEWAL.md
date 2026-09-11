# Dashboard session renewal — 2026-09-11

The notes/reasons REST clients previously treated every HTTP 401 as a final login failure. The gate refreshed on a fixed 45-minute timer instead of the access token's expiry, swallowed renewal failures, and did not propagate rotated sessions between tabs. This could leave the cached statistics visible while protected notes/reasons reads failed.

The frontend now checks expiry before protected reads and at startup, on focus/visibility/online recovery, and every 30 seconds. A single refresh flight is shared by requests; Web Locks coordinate supported same-origin tabs. Rotated tokens are saved before profile/IP checks. A read-only GET/HEAD may replay once after a 401; POST operations are never automatically replayed. A 403 is not a renewal signal. Credentials are only sent to the configured HTTPS Supabase origin, with redirects disabled in the shared client.

Temporary network/5xx failures retain the refresh token and show a recovery state. Invalid refresh credentials, disabled/missing profiles, and failed access policy checks remain terminal. The existing one-hour trusted-user-activity idle logout remains intact; token renewal is not user activity. Logout/account switching invalidates stale refresh and UI login operations. Successful reason panels stay stable during token rotation; failed panels can recover.

No database grants, RLS policies, authentication server settings, passwords, or upstream platform settings were changed by this fix.

Verification: 34 isolated session/client scenarios, seven mocked real-browser authentication scenarios, existing notes/reasons and Panda/AR configuration regressions. All test sessions are synthetic; no real user credentials or upstream modifications are used. The missing 92STRIKE configuration is separate from this session issue and requires a successful collector upload.
