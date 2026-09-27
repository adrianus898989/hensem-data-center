// @ts-ignore Deno resolves the pinned JSR dependency.
import { createClient } from 'jsr:@supabase/supabase-js@2.117.2';
// @ts-ignore Deno requires explicit source extensions.
import { ApiError, createWorkorderRecordsHandler, type Gateway } from './handler.ts';
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };
const url = Deno.env.get('SUPABASE_URL') || '', key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const gateway: Gateway = {
  async identify(headers) {
    const h = new Headers(headers); h.set('Content-Type', 'application/json'); h.set('apikey', Deno.env.get('SUPABASE_ANON_KEY') || key);
    const response = await fetch(url + '/functions/v1/workorder-account-admin', { method: 'POST', headers: h, body: JSON.stringify({ action: 'me' }), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new ApiError(response.status === 401 ? 401 : response.status === 403 ? 403 : 503, response.status === 401 ? 'login_required' : response.status === 403 ? 'account_denied' : 'identity_unavailable');
    const raw = await response.text(); if (raw.length > 65536) throw new ApiError(503, 'identity_unavailable'); return JSON.parse(raw);
  },
  async query(account, query) { const { data, error } = await admin.rpc('workorder_collected_records', { p_account: account, p_query: query }); if (error) throw error; return data; },
};
Deno.serve(createWorkorderRecordsHandler(gateway, { proxyKeySha256: '0ab9c303e8845503a0bb32e9a4bb898228656ba4928c306e5bc4eff35fd7980f' }));
