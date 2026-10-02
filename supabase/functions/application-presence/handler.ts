// @ts-ignore Deno source extension.
import { SecurityError, uuid, verifiedSessionId, trustedProxyIp, readSecurityBody, securityResponse, securityFailure } from '../_shared/application-security.ts';

export type PresenceAction = 'heartbeat' | 'status' | 'leave';
export type PresenceGateway = {
  getUser(token: string): Promise<{id: string} | null>;
  presence(args: {actor: string; session: string; ip: string; action: PresenceAction}): Promise<Record<string, unknown>>;
};

export function validatePresenceSnapshot(value: Record<string, unknown>): Record<string, unknown> {
  const keys = ['ok', 'onlineCount', 'observedAt', 'windowSeconds', 'heartbeatSeconds', 'scope', 'accounts'];
  const timestamp = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))
    || value.ok !== true || !Number.isSafeInteger(value.onlineCount) || Number(value.onlineCount) < 0 || Number(value.onlineCount) > 500
    || !timestamp(value.observedAt) || value.windowSeconds !== 120 || value.heartbeatSeconds !== 30 || value.scope !== 'authorized') {
    throw new Error('Invalid presence response');
  }
  const snapshot: Record<string, unknown> = {ok: true, onlineCount: value.onlineCount, observedAt: value.observedAt,
    windowSeconds: 120, heartbeatSeconds: 30, scope: 'authorized'};
  if (Object.hasOwn(value, 'accounts')) {
    if (!Array.isArray(value.accounts) || value.accounts.length !== value.onlineCount) throw new Error('Invalid presence roster');
    const names = new Set<string>();
    snapshot.accounts = value.accounts.map(account => {
      if (!account || typeof account !== 'object' || Array.isArray(account) || Object.keys(account).length !== 2
        || !Object.hasOwn(account, 'username') || !Object.hasOwn(account, 'lastSeenAt')
        || typeof account.username !== 'string' || !account.username.trim() || account.username.length > 100
        || /[\u0000-\u001f\u007f]/.test(account.username) || !timestamp(account.lastSeenAt) || names.has(account.username)) {
        throw new Error('Invalid presence roster');
      }
      names.add(account.username); return {username: account.username, lastSeenAt: account.lastSeenAt};
    });
  }
  return snapshot;
}

/** Worker proof + Auth verification precede session claim use. The SQL RPC then
 * rechecks registration, current IP, fresh account/role scope, and revocation. */
export function createPresenceHandler(gateway: PresenceGateway, options: {proxyKeySha256: string}) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return securityResponse({ok: false, code: 'method_not_allowed'}, 405);
    try {
      const ip = await trustedProxyIp(request, options.proxyKeySha256);
      const token = /^Bearer ([^\s,]{1,16384})$/i.exec(request.headers.get('authorization') || '')?.[1];
      if (!token) throw new SecurityError(401, 'login_required', '请先登录');
      const user = await gateway.getUser(token);
      const session = user && uuid(user.id) ? verifiedSessionId(token) : null;
      if (!user || !uuid(user.id) || !session) throw new SecurityError(401, 'login_required', '登录已失效');
      const body = await readSecurityBody(request);
      if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'action')
        || !['heartbeat', 'status', 'leave'].includes(String(body.action)) || typeof body.action !== 'string') {
        throw new SecurityError(400, 'invalid_request', '在线状态请求格式不正确');
      }
      return securityResponse(validatePresenceSnapshot(await gateway.presence({actor: user.id, session, ip, action: body.action as PresenceAction})));
    } catch (error) { return securityFailure(error); }
  };
}
