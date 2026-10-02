// @ts-ignore Deno pinned dependency.
import { createClient } from 'jsr:@supabase/supabase-js@2.117.2';
// @ts-ignore Deno source extension.
import { createPresenceHandler } from './handler.ts';
// @ts-ignore Deno source extension.
import { SecurityError, PROXY_KEY_SHA256 } from '../_shared/application-security.ts';
declare const Deno: {env: {get(name: string): string | undefined}; serve(handler: (r: Request) => Promise<Response>): void};
const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', {
  auth: {persistSession: false, autoRefreshToken: false},
  global: {fetch: (input: any, init: any) => fetch(input, {...init, signal: AbortSignal.timeout(12000), redirect: 'error'})},
});
const messages: Record<string, string> = {
  application_session_denied: '会话未通过登录策略，请重新登录',
  presence_account_denied: '账号当前未获后台访问授权',
  ip_denied: '当前 IP 不在后台白名单',
  invalid_presence_request: '在线状态请求格式不正确',
  presence_roster_limit: '在线账号目录超出读取上限，请联系管理员',
};
Deno.serve(createPresenceHandler({
  async getUser(token) {
    const r = await admin.auth.getUser(token);
    if (r.error) { if ([401, 403].includes(r.error.status)) return null; throw new Error('Auth temporarily unavailable'); }
    return r.data.user;
  },
  async presence(args) {
    const {data, error} = await admin.rpc('application_dashboard_presence', {
      p_actor: args.actor, p_session_id: args.session, p_ip: args.ip, p_action: args.action,
    });
    if (error) {
      const code = messages[error.message] ? error.message : 'service_unavailable';
      throw new SecurityError(error.code === '42501' ? 403 : error.code?.startsWith('22') ? 400 : 503,
        code, messages[code] || '在线状态暂时不可用，请稍后重试');
    }
    return data;
  },
}, {proxyKeySha256: PROXY_KEY_SHA256}));
