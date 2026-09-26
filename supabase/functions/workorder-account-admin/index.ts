// @ts-ignore Deno resolves this pinned JSR import; the backend Next build does not bundle Edge entrypoints.
import { createClient } from 'jsr:@supabase/supabase-js@2.117.2';
// @ts-ignore Deno requires the explicit source extension.
import { ACCOUNT_FIELDS, ACCOUNT_DOMAIN, ApiError, createWorkorderAccountHandler, type Gateway } from './handler.ts';
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };
const url = Deno.env.get('SUPABASE_URL') || '', key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
function checked(result: any) { if (result.error) throw result.error; return result.data; }
const gateway: Gateway = {
  async getUser(token) { const r = await admin.auth.getUser(token); if (r.error) return null; return r.data.user; },
  async profile(id) { return checked(await admin.from('dashboard_profiles').select('auth_user_id,username,role,active').eq('auth_user_id', id).maybeSingle()); },
  async account(id) { return checked(await admin.from('workorder_portal_accounts').select(ACCOUNT_FIELDS).eq('auth_user_id', id).maybeSingle()); },
  async accounts() { return checked(await admin.from('workorder_portal_accounts').select(ACCOUNT_FIELDS).order('username').limit(1000)) || []; },
  async catalogRows() {
    const [mapped, game66] = await Promise.all([
      admin.from('dashboard_platform_team_map').select('team_name,platform_name').eq('active', true).eq('country_code', 'IN').limit(1000),
      // enabled is collector scheduling, not membership. All 24 registered India
      // platforms remain usable for employee account scope while collectors pause.
      admin.from('game66_platforms').select('team_name,platform_name').in('team_name', ['红膏蟹', '香港']).limit(1000),
    ]);
    return [...(checked(mapped) || []), ...(checked(game66) || [])].map(row => ({ team: row.team_name, platform: row.platform_name }));
  },
  async ipEnabled() { const row = checked(await admin.from('dashboard_security_settings').select('ip_whitelist_enabled').eq('id', 1).maybeSingle()); if (!row) throw new Error('Missing IP settings'); return row.ip_whitelist_enabled === true; },
  async ipAllowed(ip) { return !!checked(await admin.from('dashboard_ip_whitelist').select('id').eq('ip', ip).eq('active', true).maybeSingle()); },
  async createUser(email, password) {
    const result = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (result.error?.code === 'email_exists' || result.error?.code === 'user_already_exists') throw new ApiError(409, 'account_exists', '这个工单账号已存在');
    const user = checked(result)?.user; if (!user?.id) throw new Error('Auth create failed'); return user.id;
  },
  async deleteUser(id) { checked(await admin.auth.admin.deleteUser(id)); },
  async insert(account, actor) { return checked(await admin.from('workorder_portal_accounts').insert({ ...account, created_by: actor, updated_by: actor }).select(ACCOUNT_FIELDS).single()); },
  async update(id, expected, patch, actor) { return checked(await admin.from('workorder_portal_accounts').update({ ...patch, updated_by: actor }).eq('auth_user_id', id).eq('updated_at', expected).select(ACCOUNT_FIELDS).maybeSingle()); },
  async resetPassword(id, password) {
    const user = checked(await admin.auth.admin.getUserById(id))?.user;
    if (!user?.email?.toLowerCase().endsWith('@' + ACCOUNT_DOMAIN)) throw new ApiError(403, 'account_denied', '不能重置其他系统账号');
    checked(await admin.auth.admin.updateUserById(id, { password }));
  },
  async audit(actor, action, target) { checked(await admin.from('workorder_portal_account_audit').insert({ actor_id: actor, action, target_id: target })); },
};
Deno.serve(createWorkorderAccountHandler(gateway, {
  allowedOrigins: ['https://adrianus898989.github.io', 'https://hensem-india-workorder.adrianus898989.workers.dev'],
  // Random identity proxy key is a Worker secret; only its verifier is public.
  proxyKeySha256: '0ab9c303e8845503a0bb32e9a4bb898228656ba4928c306e5bc4eff35fd7980f',
}));
