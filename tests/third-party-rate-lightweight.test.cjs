const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadTs, root } = require('./load-typescript.cjs');

test('all-data fee request skips the platform-status matrix when requested', async (t) => {
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const oldFetch = global.fetch;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fees.invalid';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-anon';
  const calls = [];
  global.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') {
      return Response.json({ id: 'synthetic-owner' });
    }
    if (url.pathname === '/rest/v1/dashboard_profiles') {
      return Response.json([{ auth_user_id: 'synthetic-owner', username: 'owner', role: 'owner', active: true, permissions: {}, data_scope: null }]);
    }
    if (url.pathname === '/rest/v1/third_party_rates') {
      return Response.json([{ id: 'r1', country: '印度', third_party: 'SyntheticPay', collect_fee: '1%', updated_at: '2026-09-17T00:00:00Z' }], { headers: { 'content-range': '0-0/1' } });
    }
    throw new Error(`unexpected request ${url.pathname}`);
  };
  t.after(() => {
    global.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = oldKey;
  });

  const { readSupabaseThirdPartyRates } = loadTs(path.join(root, 'src/lib/supabaseDashboardServer.ts'));
  const payload = await readSupabaseThirdPartyRates(new Request('https://site.invalid/api/supabase-third-party-rates?includeStatuses=0', { headers: { Authorization: 'Bearer synthetic-session' } }));
  assert.equal(payload.rates.length, 1);
  assert.equal(payload.platformStatuses.length, 0);
  assert.equal(payload.summary.totalStatusCells, 0);
  assert.equal(calls.includes('/rest/v1/third_party_platform_status'), false);
});
