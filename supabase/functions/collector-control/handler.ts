// @ts-ignore Deno source extension.
import { SecurityError, trustedProxyIp, verifiedSessionId } from '../_shared/application-security.ts';
export const DETAIL_CODES = new Set(['ok', 'starting', 'stopped', 'stop_requested', 'spawn_failed', 'exited', 'restart_backoff', 'restart_limit', 'stop_timeout', 'local_lock', 'external_running', 'unavailable', 'config_invalid', 'manager_restarted', 'orphaned_process', 'auth_unavailable', 'network_unavailable']);
const STATES = new Set(['stopped', 'starting', 'running', 'stopping', 'failed', 'blocked', 'external_running']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
type ObjectValue = Record<string, unknown>;
type Options = { url: string; publicKey: string; serviceKey: string; proxyKeySha256: string; allowedOrigins: string[]; fetch?: typeof fetch; randomBytes?: (size: number) => Uint8Array };
class PublicError extends Error { constructor(public status: number, public code: string) { super(code); } }
const fail = (status: number, code: string): never => { throw new PublicError(status, code); };
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
function fields(value: ObjectValue, required: string[]) {
  if (Object.keys(value).length !== required.length || required.some(key => !(key in value))) fail(400, 'invalid_request');
}
function label(value: unknown) { return typeof value === 'string' && value.trim().length >= 1 && value.length <= 80 && !/[\u0000-\u001f\u007f-\u009f]/.test(value); }
function version(value: unknown) { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,39}$/.test(value); }
function uuid(value: unknown) { return typeof value === 'string' && UUID.test(value); }
async function sha256(value: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join(''); }
async function boundedBody(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail(415, 'json_required');
  if (Number(request.headers.get('content-length') || 0) > 65536) fail(413, 'request_too_large');
  const reader = request.body?.getReader() || fail(400, 'invalid_request');
  const parts: Uint8Array[] = []; let length = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    length += next.value.length; if (length > 65536) { await reader.cancel(); fail(413, 'request_too_large'); }
    parts.push(next.value);
  }
  const all = new Uint8Array(length); let offset = 0;
  for (const part of parts) { all.set(part, offset); offset += part.length; }
  try { const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all)); if (!object(value)) fail(400, 'invalid_request'); return value; }
  catch { return fail(400, 'invalid_request'); }
}
const RESULT_CODES: Record<string, number> = { invalid_pairing: 401, device_denied: 401, device_revoked: 401, permission_denied: 403, revision_conflict: 409, task_unavailable: 409, device_limit: 409, pairing_limit: 429, invalid_request: 400, task_not_found: 404, device_not_found: 404, poll_too_soon: 429 };

export function createCollectorControlHandler(options: Options) {
  const fetcher = options.fetch || fetch;
  const randomBytes = options.randomBytes || ((size: number) => crypto.getRandomValues(new Uint8Array(size)));
  const randomHex = (size: number) => [...randomBytes(size)].map(n => n.toString(16).padStart(2, '0')).join('');
  async function upstream(path: string, token: string, key: string, body?: unknown) {
    const response = await fetcher(options.url.replace(/\/$/, '') + path, {
      method: body === undefined ? 'GET' : 'POST', headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      if (path === '/auth/v1/user' && [401, 403].includes(response.status)) fail(401, 'login_required');
      fail(503, 'service_unavailable');
    }
    return response.json();
  }
  async function rpc(name: string, body: unknown) {
    const value = await upstream('/rest/v1/rpc/collector_control_' + name, options.serviceKey, options.serviceKey, body);
    if (!object(value) || typeof value.ok !== 'boolean') fail(503, 'service_unavailable');
    if (value.ok !== true) { const code = String(value.code); fail(RESULT_CODES[code] || 503, RESULT_CODES[code] ? code : 'service_unavailable'); }
    return value;
  }
  async function human(request: Request, token: string, needsEdit: boolean) {
    // Device tokens cannot be repurposed as human credentials, even if upstream Auth is unavailable.
    if (/^[a-f0-9]{64}$/.test(token)) fail(401, 'login_required');
    const ip = await trustedProxyIp(request, options.proxyKeySha256);
    const user = await upstream('/auth/v1/user', token, options.publicKey);
    if (!object(user) || !uuid(user.id)) fail(401, 'login_required');
    // Decode a session identifier only after Auth verified the bearer. A valid
    // Auth JWT alone cannot bypass the application's revoked/expired sessions.
    const session = verifiedSessionId(token);
    if (!session) fail(401, 'login_required');
    const approved = await upstream('/rest/v1/rpc/application_session_check', options.serviceKey, options.serviceKey,
      { p_user_id: user.id, p_session_id: session, p_surface: 'dashboard' });
    if (!object(approved) || approved.allowed !== true) fail(403, 'application_session_denied');
    const ipAllowed = await upstream('/rest/v1/rpc/application_auth_ip_check', options.serviceKey, options.serviceKey,
      { p_surface: 'dashboard', p_ip: ip, p_user_id: user.id });
    if (ipAllowed !== true) fail(403, 'ip_denied');
    const profiles = await upstream('/rest/v1/dashboard_profiles?select=auth_user_id,role,active&auth_user_id=eq.' + encodeURIComponent(String(user.id)) + '&limit=1', token, options.publicKey);
    const profile = Array.isArray(profiles) && profiles.length === 1 ? profiles[0] : null;
    if (!object(profile) || profile.auth_user_id !== user.id || profile.active !== true || !['owner', 'admin', 'viewer'].includes(String(profile.role))) fail(403, 'permission_denied');
    if (profile.role === 'owner') return { actor: String(user.id), canEdit: true };
    const role = await upstream('/rest/v1/rpc/dashboard_role_access', token, options.publicKey, {});
    if (!object(role) || role.mode !== 'assigned' || role.canView !== true || !Array.isArray(role.permissions) || role.permissions.some(p => typeof p !== 'string') || !role.permissions.includes('collector_control.view')) fail(403, 'permission_denied');
    const canEdit = role.permissions.includes('collector_control.edit');
    if (needsEdit && !canEdit) fail(403, 'permission_denied');
    return { actor: String(user.id), canEdit };
  }
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Vary': 'Origin, Authorization', 'X-Content-Type-Options': 'nosniff' });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
    if (origin && !options.allowedOrigins.includes(origin)) return json({ ok: false, code: 'origin_denied' }, 403);
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
    try {
      if (!options.url || !options.publicKey || !options.serviceKey) fail(503, 'service_unavailable');
      const body = await boundedBody(request);
      const action = body.action;
      if (typeof action !== 'string' || !['overview', 'createPairing', 'revokeDevice', 'setDesired', 'pair', 'poll'].includes(action)) fail(400, 'invalid_request');
      if (action === 'pair') {
        fields(body, ['action', 'code', 'agentVersion']);
        if (typeof body.code !== 'string' || !/^[0-9A-Fa-f]{32}$/.test(body.code) || !version(body.agentVersion)) fail(400, 'invalid_request');
        const token = randomHex(32);
        const value = await rpc('pair', { p_code_hash: await sha256(body.code.toUpperCase()), p_token_hash: await sha256(token), p_agent_version: body.agentVersion });
        if (!uuid(value.deviceId)) fail(503, 'service_unavailable');
        return json({ ok: true, deviceId: value.deviceId, token, pollSeconds: 15 });
      }
      const authorization = request.headers.get('authorization') || '';
      if (!/^Bearer [^\s]{1,4096}$/.test(authorization)) fail(401, action === 'poll' ? 'device_denied' : 'login_required');
      const token = authorization.slice(7);
      if (action === 'poll') {
        fields(body, ['action', 'deviceId', 'agentVersion', 'tasks']);
        if (!/^[a-f0-9]{64}$/.test(token)) fail(401, 'device_denied');
        if (!uuid(body.deviceId) || !version(body.agentVersion) || !Array.isArray(body.tasks) || body.tasks.length > 100) fail(400, 'invalid_request');
        const seen = new Set();
        for (const task of body.tasks) {
          if (!object(task)) fail(400, 'invalid_request');
          fields(task, ['id', 'label', 'observedState', 'pid', 'detailCode']);
          if (typeof task.id !== 'string' || !TASK_ID.test(task.id) || seen.has(task.id) || !label(task.label) || typeof task.observedState !== 'string' || !STATES.has(task.observedState) || typeof task.detailCode !== 'string' || !DETAIL_CODES.has(task.detailCode) || !(task.pid === null || (Number.isSafeInteger(task.pid) && Number(task.pid) > 0 && Number(task.pid) <= 2147483647))) fail(400, 'invalid_request');
          seen.add(task.id);
        }
        const value = await rpc('poll', { p_device_id: body.deviceId, p_token_hash: await sha256(token), p_agent_version: body.agentVersion, p_tasks: body.tasks });
        return json({ ok: true, pollSeconds: 15, tasks: value.tasks });
      }
      const access = await human(request, token, action !== 'overview');
      if (action === 'overview') {
        fields(body, ['action']);
        const value = await rpc('overview', {});
        return json({ ok: true, canEdit: access.canEdit, devices: value.devices });
      }
      if (action === 'createPairing') {
        fields(body, ['action', 'name']); if (!label(body.name)) fail(400, 'invalid_request');
        const code = randomHex(16).toUpperCase();
        const value = await rpc('create_pairing', { p_actor: access.actor, p_name: String(body.name).trim(), p_code_hash: await sha256(code) });
        return json({ ok: true, code, expiresAt: value.expiresAt });
      }
      if (action === 'revokeDevice') {
        fields(body, ['action', 'deviceId']); if (!uuid(body.deviceId)) fail(400, 'invalid_request');
        await rpc('revoke', { p_actor: access.actor, p_device_id: body.deviceId });
        return json({ ok: true });
      }
      fields(body, ['action', 'deviceId', 'taskId', 'desiredState', 'expectedRevision']);
      if (!uuid(body.deviceId) || typeof body.taskId !== 'string' || !TASK_ID.test(body.taskId) || typeof body.desiredState !== 'string' || !['running', 'stopped'].includes(body.desiredState) || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) fail(400, 'invalid_request');
      const value = await rpc('set_desired', { p_actor: access.actor, p_device_id: body.deviceId, p_task_id: body.taskId, p_desired_state: body.desiredState, p_expected_revision: body.expectedRevision });
      return json({ ok: true, revision: value.revision });
    } catch (error) {
      // Never return/log upstream response bodies, Authorization, paths or exception messages.
      return error instanceof PublicError || error instanceof SecurityError ? json({ ok: false, code: error.code }, error.status) : json({ ok: false, code: 'service_unavailable' }, 503);
    }
  };
}
