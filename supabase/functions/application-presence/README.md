# Dashboard presence

`POST /functions/v1/application-presence` accepts exactly `{action:"heartbeat"|"status"|"leave"}` through the existing trusted Worker proxy. It verifies Supabase Auth before using the token's session claim. The service-only RPC rechecks the registered dashboard session, active account, current role, login IP and actual current IP. Caller-supplied account, scope, timestamp and count fields are rejected.

The response is `{ok:true,onlineCount,observedAt,windowSeconds:120,heartbeatSeconds:30,scope:"authorized",accounts?}`. Each account is counted once across tabs/devices. A scope-restricted caller sees itself plus active accounts whose entire current canonical data scope is contained in its own; names are returned only when the current role grants `access.view`. No IP, session ID, Auth ID or role data is returned. Workorder employee sessions are excluded.

The parent dashboard sends one heartbeat every 30 seconds. Navigation, iframe disposal and page/tab closing must not call `leave`, because another page may share the same authorization session. Logout uses the existing session revocation, which excludes a session immediately; `leave` explicitly stops only the caller's registered presence session. An abrupt disconnect expires after 120 seconds. This measures authenticated dashboard sessions with a recent heartbeat, not attention or employment attendance.

Only the latest presence per registered session is stored in a private sidecar. Repeated heartbeats within 10 seconds are coalesced, except IP changes or an explicit return from leave. Reads recheck session/account/IP state. Heartbeats prune rows older than one day; the sidecar cascades when its original registered session is deleted. It stores no passwords, tokens, business rows or long-term activity history.

Deployment requires the reviewed SQL migration and this Edge Function, then adding this endpoint to the existing Worker allowlist. Do not add a direct browser-to-Supabase bypass or relax the proxy proof. Database errors remain unavailable; they must not be rendered as zero online users.
