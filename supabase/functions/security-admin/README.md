# Login security administration

Deploy `security-admin` with `verify_jwt=false`; the handler verifies Auth, and its service-only SQL operation rechecks the approved dashboard session, active owner role, and trusted current IP in the transaction. Worker proof is mandatory; clients cannot supply an authoritative actor/session/IP in JSON.

Each POST body has `action` and `surface:'dashboard'|'workorder'`. The Worker route is `/api/security-admin`. All replies include `ok:true`; errors use `{ok:false,code,message}` and 409 for stale versions. `version` and `expected_version` are integer numbers, initially 1.

| Action | Extra request fields | Response fields |
| --- | --- | --- |
| `policy` read | none | `policy`, `rules`, `currentIp` |
| `policy` write | `patch:{failure_limit?:1..20,ip_enabled?:boolean}`, `expected_version` | `policy`, `rules`, `currentIp` |
| `list-rules` | none | `rules`, `policy`, `currentIp` |
| `upsert-rule` | `network`, optional `note`; to edit, `id` + `expected_version` | `rules`, `policy`, `currentIp` |
| `set-rule-active` | `id`, `active:boolean`, `expected_version` | `rules`, `policy`, `currentIp` |
| `delete-rule` | `id`, `expected_version` | `rules`, `policy`, `currentIp` |
| `account-security` | `user_id` | `security` |
| `list-account-security` | none | `states` for that surface only, at most 5000 actual accounts |
| `set-account-policy` | `user_id`, `failure_limit:null or 1..20`, `expected_version` | `security` |
| `unlock-account` | `user_id`, `expected_version` | `security` |
| `account-ip-rules` | `user_id` | `security`, `currentIp` |
| `set-account-ip-mode` | `user_id`, `ip_mode:"inherit"|"allowlist"`, `expected_version` | `security`, `currentIp` |
| `upsert-account-ip-rule` | `user_id`, `network`, optional `note`, optional `active`; to edit, `id`; `expected_version` | `security`, `currentIp` |
| `set-account-ip-rule-active` | `user_id`, `id`, `active:boolean`, `expected_version` | `security`, `currentIp` |
| `delete-account-ip-rule` | `user_id`, `id`, `expected_version` | `security`, `currentIp` |

`policy = {failure_limit,ip_enabled,version}`. `rules = [{id,network,note,active,version}]`. IPv4/IPv6 host or CIDR is supported; host bits normalize to the network. `/0` is rejected. Dashboard uses the **existing** `dashboard_security_settings` flag and `dashboard_ip_whitelist` rules as its only canonical IP source. Old IP mutation endpoints are retired. Workorder rules remain separate. Enabling dashboard rules or editing/removing them cannot block the owner request's current trusted address.

`security = {failed_count,failure_limit:null|number,locked,locked_at:null|string,version,ip_mode:"inherit"|"allowlist",ip_rules:[{id,network,note,active}]}`; `states` adds `user_id`. Null threshold inherits the surface policy. Changing a threshold does not reset failures or unlock. Unlock resets only the automatic lock and counter; it does not manually enable an inactive account or reactivate old sessions. Every role, including the final owner, is automatically locked at its threshold. Manual removal/disable of the final active owner is blocked by a database trigger.

`application_revoke_user_sessions(p_user_id,p_surface)` returns the revoked count and increments a separate login epoch, invalidating password checks already in flight. Call before and after a successful password reset. Account-disable triggers also revoke in the same transaction. This prevents a delayed old-password result or manual disable/re-enable sequence from resurrecting a session.


Backend global IP restrictions are mandatory. Workorder global restriction may still be controlled by the owner. Default failure limit is 5. Account `allowlist` overrides the surface's global rules; `inherit` uses those global rules. Every account-rule mutation uses the **account security version**, not a rule version. SQL validates target membership and binds rule IDs to both target account and surface. An owner changing its own rule set cannot block its trusted current address. `application_auth_ip_check(p_surface,p_ip,p_user_id)` is service-only and receives the user ID only after Auth verified it.

Shared collector `SYNC_SECRET` no longer authorizes `bootstrap-admin` or `reset-admin-password` in `dashboard-user-admin`; both operations return 410. Normal owner-managed account creation and password reset remain available.
