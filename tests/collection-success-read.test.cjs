// Exercise the actual authenticated server read with synthetic HTTP responses.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadTs, root } = require('./load-typescript.cjs');
const server = loadTs(path.join(root, 'src/lib/supabaseDashboardServer.ts'));

const snapshot = (country_code, platform) => ({ schema_version: 1, source_system: 'RECHARGE_REVIEW', country_code, platform,
  stat_date: '2026-09-13', timezone: 'Asia/Kolkata', snapshot_id: 'synthetic', snapshot_at: '2026-09-14T01:00:00Z',
  coverage: { complete: true, expected_count: 100, fetched_count: 100, unique_count: 100 },
  totals: { submitted_count: 100, success_count: 80 }, groups: [{ raw_channel: 'WPay', channel_type: 'UPI', submitted_count: 100, success_count: 80 }] });
const row = { id: 'volume-1', sheet_name: 'synthetic', source_row: 1, data_date: '2026-09-13', country: '印度', platform: '91CLUB',
  channel: 'WPay', raw_channel: 'WPay', channel_type: 'UPI', direction: '代收', amount: 80000, count: 999, success_count: 999, failed_count: 0, success_rate: 1, status: '', updated_at: '2026-09-14T01:00:00Z' };

async function fixture({ scope, snapshots = [snapshot('IN', '91CLUB')], successStatus = 200, malformed = false, active = true } = {}, run) {
  const oldFetch = global.fetch;
  const previous = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.supabase.invalid';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-publishable-key';
  const calls = [];
  global.fetch = async (input, init = {}) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://synthetic.supabase.invalid');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-user-jwt');
    assert.equal(init.headers.apikey, 'synthetic-publishable-key');
    assert.equal(init.cache, 'no-store');
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'synthetic-user' });
    if (url.pathname === '/rest/v1/dashboard_profiles') return Response.json([{ auth_user_id: 'synthetic-user', username: 'synthetic', role: scope ? 'viewer' : 'owner', active,
      permissions: { third_party: true }, ...(scope ? { data_scope: scope } : {}) }]);
    const body = JSON.parse(init.body);
    calls.push({ name: url.pathname.split('/').pop(), body });
    if (url.pathname.endsWith('/dashboard_collection_success')) {
      assert.ok(init.signal instanceof AbortSignal);
      return Response.json(malformed ? { invalid: true } : { snapshots }, { status: successStatus });
    }
    if (url.pathname.endsWith('/dashboard_third_party_volume_fast_v2')) return Response.json({ rows: body.p_country === '印度' ? [row] : [], latestWriteAt: row.updated_at });
    throw new Error(`Unexpected path ${url.pathname}`);
  };
  try {
    const request = new Request('https://dashboard.invalid/api/volume', { headers: { Authorization: 'Bearer synthetic-user-jwt' } });
    await run(request, calls);
  } finally {
    global.fetch = oldFetch;
    for (const [index, name] of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'].entries()) {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    }
  }
}

test('actual server returns separate success snapshots with unchanged legacy metrics', async () => {
  await fixture({}, async (request, calls) => {
    const result = await server.readSupabaseThirdPartyVolume(request, '2026-09-13', '2026-09-13', '印度');
    assert.equal(result.rows[0].count, 999);
    assert.equal(result.rows[0].successCount, 999);
    assert.equal(result.rows[0].amount, 80000);
    assert.equal(result.collectionSuccessSnapshots[0].totals.submitted_count, 100);
    assert.equal(result.collectionSuccessError, undefined);
    assert.deepEqual(calls.find(c => c.name === 'dashboard_collection_success').body, { p_start: '2026-09-12', p_end: '2026-09-13', p_country: '印度' });
    assert.deepEqual(calls.find(c => c.name === 'dashboard_third_party_volume_fast_v2').body, { p_start: '2026-09-13', p_end: '2026-09-13', p_country: '印度' });
  });
});

for (const status of [401, 403, 404, 500]) test(`success endpoint ${status} never fails or changes the original volume response`, async () => {
  await fixture({ successStatus: status }, async request => {
    const result = await server.readSupabaseThirdPartyVolume(request, '2026-09-13', '2026-09-13', '印度');
    assert.equal(result.rows.length, 1);
    assert.equal(result.summary.amount, 80000);
    assert.deepEqual(result.collectionSuccessSnapshots, []);
    assert.ok(result.collectionSuccessError);
  });
});

test('malformed success response is additive unavailable, not invented success', async () => {
  await fixture({ malformed: true }, async request => {
    const result = await server.readSupabaseThirdPartyVolume(request, '2026-09-13', '2026-09-13', '印度');
    assert.deepEqual(result.collectionSuccessSnapshots, []);
    assert.equal(result.rows.length, 1);
  });
});

test('restricted user receives only authorized snapshots even if remote mock returns unrelated rows', async () => {
  await fixture({ scope: { mode: 'selected', countries: ['BR_PANGHU'] }, snapshots: [snapshot('BR', '776F'), snapshot('BR', 'POP555'), snapshot('IN', '91CLUB')] }, async (request, calls) => {
    const result = await server.readSupabaseThirdPartyVolume(request, '2026-09-13', '2026-09-13', '胖虎巴西');
    assert.deepEqual(result.collectionSuccessSnapshots.map(s => s.platform), ['776F']);
    assert.equal(calls.find(c => c.name === 'dashboard_collection_success').body.p_country, '胖虎巴西');
  });
});

test('inactive account is denied before either data RPC, not converted to an additive error', async () => {
  await fixture({ active: false }, async (request, calls) => {
    await assert.rejects(server.readSupabaseThirdPartyVolume(request, '2026-09-13', '2026-09-13', '印度'), error => error.status === 403);
    assert.equal(calls.length, 0);
  });
});

test('two-day selection reads its two-day previous comparison without modifying volume range', async () => {
  await fixture({}, async (request, calls) => {
    await server.readSupabaseThirdPartyVolume(request, '2026-09-12', '2026-09-13', '印度');
    assert.deepEqual(calls.find(c => c.name === 'dashboard_collection_success').body, { p_start: '2026-09-10', p_end: '2026-09-13', p_country: '印度' });
    assert.equal(calls.find(c => c.name === 'dashboard_third_party_volume_fast_v2').body.p_start, '2026-09-12');
  });
});
