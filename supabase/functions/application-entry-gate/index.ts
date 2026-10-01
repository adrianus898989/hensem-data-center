// @ts-ignore Deno pinned dependency.
import { createClient } from 'jsr:@supabase/supabase-js@2.117.2';
// @ts-ignore Deno source extension.
import { createEntryGateHandler } from './handler.ts';
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (r: Request) => Promise<Response>): void };
// Dedicated opening proof: do not rotate or reuse the independent login /
// account-management proxy key. This fingerprint is not the server secret.
const ENTRY_PROXY_KEY_SHA256 = '5ca06495bb01d44b87a8cba0a12548f0eb438b42bdc05c82f0a028a1b5daecfa';
const url = Deno.env.get('SUPABASE_URL') || '', service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const timedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(4000), redirect: 'error' });
const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: timedFetch },
});
Deno.serve(createEntryGateHandler({
  async allowed(ip) {
    const { data, error } = await admin.rpc('application_dashboard_entry_allowed', { p_ip: ip });
    if (error || typeof data !== 'boolean') throw new Error('Entry authorization unavailable');
    return data;
  },
}, { proxyKeySha256: ENTRY_PROXY_KEY_SHA256 }));
