export type Account = { auth_user_id: string; username: string; display_name: string; role: string; team: string; platforms: string[]; active: boolean; created_at?: string; updated_at?: string };
export type Catalog = { teams: string[]; platforms: string[]; platformTeams: Record<string, string> };
export type Gateway = {
  getUser(token: string): Promise<{ id: string; email?: string } | null>;
  profile(id: string): Promise<{ auth_user_id: string; username: string; role: string; active: boolean } | null>;
  account(id: string): Promise<Account | null>;
  accounts(): Promise<Account[]>;
  catalogRows(): Promise<{ team: string; platform: string }[]>;
  ipEnabled(): Promise<boolean>;
  ipAllowed(ip: string): Promise<boolean>;
  createUser(email: string, password: string): Promise<string>;
  deleteUser(id: string): Promise<void>;
  insert(account: Account, actor: string): Promise<Account>;
  update(id: string, expected: string, patch: Record<string, unknown>, actor: string): Promise<Account | null>;
  resetPassword(id: string, password: string): Promise<void>;
  audit(actor: string, action: string, target: string): Promise<void>;
};
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const bad = (message: string): never => { throw new ApiError(400, 'invalid_request', message); };
const uid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const roles = new Set(['supervisor', 'agent', 'auditor']);
const fields = 'auth_user_id,username,display_name,role,team,platforms,active,created_at,updated_at';
export const ACCOUNT_FIELDS = fields;
export const ACCOUNT_DOMAIN = 'workorder.hensem.local';
function username(value: unknown) {
  if (typeof value !== 'string' || !/^[a-z0-9._-]{3,32}$/.test(value.trim().toLowerCase())) bad('账号须为 3–32 位英文、数字、点、下划线或短横线');
  return (value as string).trim().toLowerCase();
}
function password(value: unknown) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) bad('密码须为 8–128 位');
  return value as string;
}
function label(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(value)) bad(field + '不正确');
  return (value as string).trim();
}
export function buildCatalog(rows: { team: string; platform: string }[]): Catalog {
  const teamsByPlatform = new Map<string, Set<string>>();
  for (const row of rows) {
    const team = String(row.team || '').trim(), platform = String(row.platform || '').trim();
    if (!team || !platform) continue;
    if (!teamsByPlatform.has(platform)) teamsByPlatform.set(platform, new Set());
    teamsByPlatform.get(platform)!.add(team);
  }
  // A duplicated name with conflicting teams cannot be represented by this API.
  // Do not silently authorize it for whichever row happened to arrive last.
  const pairs = [...teamsByPlatform].filter(([, teams]) => teams.size === 1).map(([platform, teams]) => [platform, [...teams][0]]);
  const platformTeams = Object.fromEntries(pairs);
  return { teams: [...new Set(pairs.map(pair => pair[1]))].sort(), platforms: pairs.map(pair => pair[0]).sort(), platformTeams };
}
function scope(body: Record<string, unknown>, catalog: Catalog) {
  const team = label(body.team, '团队');
  if (!catalog.teams.includes(team) || !Array.isArray(body.platforms) || !body.platforms.length || body.platforms.length > 200) bad('请选择团队及平台');
  if ((body.platforms as unknown[]).some(p => typeof p !== 'string' || catalog.platformTeams[p] !== team)) bad('所选平台不属于该团队或已不在目录');
  return { team, platforms: [...new Set(body.platforms as string[])].sort() };
}
function publicAccount(account: Account): Account {
  return Object.fromEntries(fields.split(',').filter(key => key in account).map(key => [key, (account as any)[key]])) as Account;
}
function normalizeIp(value: string) {
  const ip = value.trim().replace(/^::ffff:/i, '');
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) && ip.split('.').every(n => +n <= 255)) return ip;
  if (ip.includes(':') && ip.length <= 64) { try { return new URL('https://[' + ip + ']').hostname.slice(1, -1); } catch { /* invalid */ } }
  return '';
}
async function proxyIp(request: Request, hash: string | undefined) {
  const key = request.headers.get('x-portal-proxy-key');
  if (!key && !request.headers.has('x-portal-client-ip')) return null;
  if (!key || !hash || !/^[a-f0-9]{64}$/.test(hash) || key.length > 256) throw new ApiError(403, 'proxy_denied', '登录来源验证失败');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  const expected = Uint8Array.from(hash.match(/../g)!, v => parseInt(v, 16));
  let mismatch = 0; for (let i = 0; i < expected.length; i++) mismatch |= expected[i] ^ digest[i];
  const ip = normalizeIp(request.headers.get('x-portal-client-ip') || '');
  if (mismatch || !ip) throw new ApiError(403, 'proxy_denied', '登录来源验证失败');
  return ip;
}
export function createWorkorderAccountHandler(gateway: Gateway, options: { allowedOrigins: string[]; proxyKeySha256?: string }) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Vary': 'Origin, Authorization', 'X-Content-Type-Options': 'nosniff' });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !options.allowedOrigins.includes(origin)) return json({ ok: false, code: 'origin_denied', message: '来源不允许' }, 403);
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') {
      const requested = (request.headers.get('access-control-request-headers') || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
      if (!origin || request.headers.get('access-control-request-method') !== 'POST' || requested.some(h => !['authorization', 'apikey', 'content-type', 'x-client-info'].includes(h))) return json({ ok: false, code: 'preflight_denied', message: '来源不允许' }, 403);
      headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS'); headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed', message: '只支持 POST' }, 405);
    try {
      const token = /^Bearer ([^\s,]{1,16384})$/i.exec(request.headers.get('authorization') || '')?.[1];
      if (!token) throw new ApiError(401, 'login_required', '请先登录');
      const caller = await gateway.getUser(token);
      if (!caller || !uid(caller.id)) throw new ApiError(401, 'login_required', '登录已失效');
      const text = await request.text();
      if (text.length > 16384) bad('请求过大');
      let body: Record<string, unknown>; try { body = JSON.parse(text); } catch { bad('请求格式不正确'); }
      if (!body! || typeof body! !== 'object' || Array.isArray(body!)) bad('请求格式不正确');
      const action = body!.action;
      if (!['me', 'list-accounts', 'create-account', 'update-account', 'reset-password'].includes(String(action))) bad('操作不支持');
      const profile = await gateway.profile(caller.id);
      const owner = !!profile && profile.auth_user_id === caller.id && profile.active === true && profile.role === 'owner';
      if (action !== 'me' && !owner) throw new ApiError(403, 'owner_required', '只有后台总管理员可以管理工单账号');
      if (owner) {
        const forwarded = await proxyIp(request, options.proxyKeySha256);
        if (await gateway.ipEnabled()) {
          // Keep the existing dashboard IP policy. A Worker may forward its
          // visitor address only with server-only proxy proof; never trust body IP.
          const direct = ['cf-connecting-ip', 'x-real-ip', 'fly-client-ip', 'sb-client-ip'].map(h => request.headers.get(h) || '').find(Boolean)
            || (request.headers.get('x-forwarded-for') || '').split(',')[0];
          const ip = forwarded || normalizeIp(direct);
          if (!ip || !(await gateway.ipAllowed(ip))) throw new ApiError(403, 'ip_denied', '当前 IP 不在后台登录白名单');
        }
      }
      let account: Account | null = null;
      if (!owner) {
        // Portal staff never gain backend permissions from metadata or email.
        if (profile) throw new ApiError(403, 'account_denied', '此后台账号没有工单所有者权限');
        account = await gateway.account(caller.id);
        if (!account || account.auth_user_id !== caller.id || account.active !== true || !roles.has(account.role)
          || caller.email?.toLowerCase() !== `${account.username}@${ACCOUNT_DOMAIN}`) throw new ApiError(403, 'account_denied', '工单账号未启用或未授权');
      }
      const catalog = buildCatalog(await gateway.catalogRows());
      if (action === 'me') {
        if (owner) account = { auth_user_id: caller.id, username: profile!.username, display_name: profile!.username, role: 'owner', team: '', platforms: catalog.platforms, active: true };
        else {
          const available = account!.platforms.filter(p => catalog.platformTeams[p] === account!.team);
          if (!available.length) throw new ApiError(403, 'scope_denied', '工单账号尚无有效平台权限');
          account = { ...account!, platforms: available };
        }
        const visibleCatalog = owner ? catalog : buildCatalog(account!.platforms.map(platform => ({ team: account!.team, platform })));
        return json({ ok: true, account: publicAccount(account!), catalog: visibleCatalog, identity_kind: owner ? 'dashboard_owner' : 'workorder' });
      }
      if (action === 'list-accounts') return json({ ok: true, accounts: (await gateway.accounts()).map(publicAccount), catalog });
      if (action === 'create-account') {
        const name = username(body!.username), pass = password(body!.password), display = label(body!.display_name, '显示名称');
        if (!roles.has(String(body!.role))) bad('工单角色不正确');
        const selected = scope(body!, catalog);
        const id = await gateway.createUser(`${name}@${ACCOUNT_DOMAIN}`, pass);
        let created: Account;
        try { created = await gateway.insert({ auth_user_id: id, username: name, display_name: display, role: String(body!.role), ...selected, active: true }, caller.id); }
        catch (error) { try { await gateway.deleteUser(id); } catch { /* An orphan Auth user has no portal row or dashboard profile, so fails closed. */ } throw error; }
        return json({ ok: true, account: publicAccount(created), message: '工单账号已创建' });
      }
      if (!uid(body!.auth_user_id)) bad('账号标识不正确');
      const target = await gateway.account(body!.auth_user_id as string);
      if (!target || !roles.has(target.role) || await gateway.profile(target.auth_user_id)) throw new ApiError(404, 'account_not_found', '未找到独立工单账号');
      if (action === 'reset-password') {
        await gateway.resetPassword(target.auth_user_id, password(body!.password));
        await gateway.audit(caller.id, 'reset-password', target.auth_user_id);
        return json({ ok: true, account: publicAccount(target), message: '工单密码已重置' });
      }
      const patch = body!.patch;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(k => !['display_name', 'role', 'team', 'platforms', 'active'].includes(k))) bad('修改内容不正确');
      const raw = patch as Record<string, unknown>, update: Record<string, unknown> = {};
      if ('display_name' in raw) update.display_name = label(raw.display_name, '显示名称');
      if ('role' in raw) { if (!roles.has(String(raw.role))) bad('工单角色不正确'); update.role = raw.role; }
      if ('active' in raw) { if (typeof raw.active !== 'boolean') bad('启用状态不正确'); update.active = raw.active; }
      if ('team' in raw || 'platforms' in raw || raw.active === true) Object.assign(update, scope({ ...target, ...raw }, catalog));
      if (!Object.keys(update).length) bad('没有需要修改的内容');
      const expected = body!.expected_updated_at;
      if (typeof expected !== 'string' || !expected || !Number.isFinite(Date.parse(expected))) bad('请刷新账号后再修改');
      const updated = await gateway.update(target.auth_user_id, expected as string, update, caller.id);
      if (!updated) throw new ApiError(409, 'account_changed', '账号已被其他操作修改，请刷新后重试');
      return json({ ok: true, account: publicAccount(updated), message: '工单账号已更新' });
    } catch (error) {
      if (error instanceof ApiError) return json({ ok: false, code: error.code, message: error.message }, error.status);
      return json({ ok: false, code: 'service_unavailable', message: '账号服务暂时不可用，请稍后重试' }, 503);
    }
  };
}
