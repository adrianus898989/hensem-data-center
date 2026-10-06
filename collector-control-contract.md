# Collector control — first release

This release controls registered Python tasks on the user's existing Macs. It does
not deploy collectors to cloud compute or modify source-platform business rules.
The first installation includes a harmless demo task; production collectors are
registered separately with their exact interpreter, arguments and working path.

## HTTP contract

Endpoint: `/functions/v1/collector-control`, JSON POST only. Replies are JSON with
`ok: true`, or `ok: false, code: <bounded public error code>`. No credentials,
child stdout, arbitrary commands, or arbitrary filesystem paths enter this API.
Human calls use the current Supabase Auth bearer plus the public API key. Device
polls use a separate random bearer; the database stores only its SHA-256 hash.

Admin actions:

- `{action:"overview"}` -> `{ok:true,canEdit:boolean,devices:[{id,name,lastSeenAt,
  revokedAt,agentVersion,tasks:[{id,label,desiredState,revision,observedState,pid,
  updatedAt,detailCode}]}]}`. Offline is computed from lastSeenAt > 90 seconds.
  Process state must never be described as successful order ingestion.
- `{action:"createPairing",name:string}` -> `{ok:true,code:string,expiresAt:string}`.
  A random single-use code expires after ten minutes. Store its hash only.
- `{action:"revokeDevice",deviceId:uuid}` -> `{ok:true}`. Revocation rejects future
  polls; it is not a claim that an offline machine's processes have been stopped.
- `{action:"setDesired",deviceId:uuid,taskId:string,desiredState:"running"|"stopped",
  expectedRevision:integer}` -> `{ok:true,revision:integer}`. Atomically compare
  revision, increment on change, stamp requesting Auth user. Reject unknown tasks.
  An identical desired state is idempotent. A conflict returns HTTP 409.

Device actions:

- `{action:"pair",code:string,agentVersion:string}` ->
  `{ok:true,deviceId:uuid,token:string,pollSeconds:15}`. Single atomic consumption.
- `{action:"poll",deviceId:uuid,agentVersion:string,tasks:[{id,label,
  observedState,pid:null|integer,detailCode:string}]}` ->
  `{ok:true,pollSeconds:15,tasks:[{id,desiredState,revision}]}`.
  Tasks are registered by the paired device; new tasks default to stopped. A task
  absent from this inventory is excluded from commands and marked unavailable.
  All inventories and statuses are bounded; each poll touches only its device.

Task ids: `[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}`. Names and labels: 1..80 characters,
no control characters. Maximum 100 current tasks/device in a poll, no duplicate ids.
Overview may also retain up to 100 unavailable tasks/device (200 total).
States:
`stopped`, `starting`, `running`, `stopping`, `failed`, `blocked`, `external_running`.
Detail codes are fixed codes, never exception text or raw child output.

## Access and implementation boundaries

Owner accounts with a fresh active dashboard profile have access. Non-owner
accounts require assigned-role permissions `collector_control.view` and, for
mutations, `collector_control.edit`; the existing legacy allow-all fallback must
not grant these permissions. A hidden menu is not authorization. Check access on
each human request, before constructing privileged database calls. Device tokens
cannot list or control another machine or use human actions.

Dedicated control tables have RLS enabled and no anon/authenticated direct grants.
Transactional RPC helpers are service-role-only, SECURITY INVOKER, with a fixed
search path. Preserve existing profiles, collectors, orders and business tables.
Record bounded control audit events without secret values. No deployment or live
collector action is required for local acceptance tests.

## Local supervisor

One Python-standard-library manager per Mac, running as the original macOS user.
Only local allowlisted task definitions can become argv arrays (`shell=False`).
Preserve exact cwd, interpreter, args, source state directories and browser ports.
Control APIs never accept code, commands, paths, credentials or edited arguments.
Only a fresh successful poll may start a task. Network failure leaves existing
children running; an offline UI must not show a queued start as running.

Use singleton and per-task locks, retain process ownership evidence, and do not
signal unrelated or manually started processes. Stop uses SIGINT on the managed
process group, with a bounded wait; no automatic SIGKILL or forced data loss.
Manual stop must not trigger automatic restart. Crashes use bounded backoff and
eventually block; auth errors in a still-running child are not solved by restart.
Store state/credentials privately and durably; preserve pending collector data.
Manager event logs rotate and contain no tokens; do not upload raw child logs.
The first release reports process health only. Data freshness, authentication
health, auto-login and backfill require per-collector adapters and must be shown
as not yet connected, not fabricated.

## Acceptance

Test cross-device denial, legacy denial, expired/reused pairing, revision conflict,
duplicate clicks, failed and delayed polls, spawn failure, graceful stop and
preserved files. Exercise the local manager with a temporary dummy process only.
Existing collectors and their browser profiles must never be started or stopped
by development or tests. UI empty/offline/error states must remain actionable.
