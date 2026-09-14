const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../BACKEND_CURRENT/collection-success-ingest.ts'), 'utf8').replace('if (import.meta.main)', 'if (false)');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function('exports', 'module', compiled)(loaded.exports, loaded);
const { validateCollectionSnapshot, createCollectionSuccessHandler } = loaded.exports;
const NOW = new Date('2026-09-14T12:00:00Z');
function snapshot(patch = {}) {
  return { schema_version: 1, source_system: 'RECHARGE_REVIEW', country_code: 'IN', platform: '91CLUB', stat_date: '2026-09-13', timezone: 'Asia/Kolkata',
    snapshot_id: '11111111-1111-4111-8111-111111111111', snapshot_at: '2026-09-13T18:31:00Z',
    coverage: { complete: true, expected_count: 100, fetched_count: 100, unique_count: 100 }, totals: { submitted_count: 100, success_count: 80 },
    groups: [{ raw_channel: 'PAYTM-RAPay', channel_type: 'UPI', submitted_count: 60, success_count: 40 }, { raw_channel: 'NewWinPay2', channel_type: 'UPI', submitted_count: 40, success_count: 40 }], ...patch };
}
function harness(overrides = {}) {
  const credential = { source_system: 'RECHARGE_REVIEW', allowed_scopes: [{ country_code: 'IN', platform: '91CLUB', timezone: 'Asia/Kolkata' }], expires_at: '2027-01-01T00:00:00Z', revoked: false, ...overrides.credential };
  const calls = [];
  const handler = createCollectionSuccessHandler({ env: { SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' }, now: () => NOW,
    fetch: async (url, options) => {
      calls.push({ url, options }); assert.ok(options.signal); assert.equal(options.headers.apikey, 'synthetic-service-key');
      if (url.includes('collection_success_credentials?')) return Response.json(overrides.missing ? [] : [credential]);
      assert.ok(url.endsWith('/rpc/publish_collection_success_snapshot'));
      if (overrides.error) return Response.json({ message: overrides.error }, { status: 400 });
      const body = JSON.parse(options.body); assert.match(body.p_token_hash, /^[0-9a-f]{64}$/); assert.notEqual(body.p_token_hash, 'a'.repeat(48));
      return Response.json(overrides.ack || { ok: true, status: 'accepted', snapshot_id: body.p_snapshot.snapshot_id, current_snapshot_id: body.p_snapshot.snapshot_id });
    } });
  return { calls, run: (body = { action: 'ingest', snapshot: snapshot() }, options = {}) => handler(new Request('https://synthetic.supabase.co/ingest', {
    method: options.method || 'POST', headers: { 'X-Collection-Key': options.key ?? 'a'.repeat(48), 'content-type': options.contentType ?? 'application/json' },
    ...(options.method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) })) };
}
test('full submission cohort preserves raw aliases and success numerator independently', () => {
  assert.deepEqual(validateCollectionSnapshot(snapshot(), NOW), snapshot());
  const zero = snapshot({ groups: [], coverage: { complete: true, expected_count: 0, fetched_count: 0, unique_count: 0 }, totals: { submitted_count: 0, success_count: 0 } });
  assert.deepEqual(validateCollectionSnapshot(zero, NOW), zero);
  const zeroSuccess = snapshot(); zeroSuccess.groups.forEach(g => g.success_count = 0); zeroSuccess.totals.success_count = 0;
  assert.doesNotThrow(() => validateCollectionSnapshot(zeroSuccess, NOW));
});
test('incomplete, wrong business day, malformed counts and PII-shaped descriptors rejected', () => {
  const cases = [ { stat_date: '2026-09-14' }, { stat_date: '2026-02-30' }, { stat_date: '2019-01-01' }, { timezone: 'bogus' },
    { snapshot_at: '2026-09-13T18:29:00Z' }, { snapshot_at: '2026-09-14T25:00:00Z' }, { snapshot_at: '2999-01-01T00:00:00Z' }, { order_id: 'secret' },
    { coverage: { ...snapshot().coverage, complete: false } }, { coverage: { ...snapshot().coverage, fetched_count: 101 } },
    { totals: { submitted_count: '100', success_count: 80 } }, { totals: { submitted_count: 100, success_count: 101 } }, { groups: [snapshot().groups[0], snapshot().groups[0]] },
    { groups: [{ raw_channel: 'person@example.com', channel_type: 'UPI', submitted_count: 100, success_count: 80 }] },
    { groups: [{ raw_channel: 'WPay', channel_type: '1234567890', submitted_count: 100, success_count: 80 }] },
    { groups: [{ raw_channel: 'WPay', channel_type: 'UPI', submitted_count: 100, success_count: 80, account: 'secret' }] },
    { groups: [{ raw_channel: 'WPay', channel_type: 'UPI', submitted_count: -100, success_count: 0 }] },
    { groups: [{ raw_channel: 'WPay', channel_type: 'UPI', submitted_count: 100.1, success_count: 80 }] },
    { groups: Array.from({ length: 2001 }, (_, i) => ({ raw_channel: `Provider${i}`, channel_type: 'UPI', submitted_count: 1, success_count: 1 })) } ];
  for (const patch of cases) assert.throws(() => validateCollectionSnapshot(snapshot(patch), NOW), /Invalid snapshot/);
});
test('handler requires dedicated credential; check does not read or write daily data', async () => {
  let h = harness(); assert.equal((await h.run(undefined, { key: '' })).status, 401); assert.equal(h.calls.length, 0);
  h = harness(); assert.equal((await h.run(undefined, { method: 'GET' })).status, 405); assert.equal(h.calls.length, 0);
  for (const opts of [{ missing: true }, { credential: { revoked: true } }, { credential: { expires_at: NOW.toISOString() } }]) {
    h = harness(opts); assert.equal((await h.run()).status, 401); assert.equal(h.calls.length, 1);
  }
  h = harness(); const checked = await h.run({ action: 'check' });
  assert.deepEqual(await checked.json(), { ok: true, source_system: 'RECHARGE_REVIEW', scope_count: 1 }); assert.equal(h.calls.length, 1);
});
test('scope and timezone match are exact; unsupported actions never read reports', async () => {
  for (const patch of [{ country_code: 'VN' }, { platform: 'OTHER' }, { timezone: 'Asia/Colombo' }]) {
    const h = harness(); assert.equal((await h.run({ action: 'ingest', snapshot: snapshot(patch) })).status, 403); assert.equal(h.calls.length, 1);
  }
  const h = harness(); assert.equal((await h.run({ action: 'report' })).status, 400); assert.equal(h.calls.length, 1);
});
test('accepted/unchanged/stale acknowledgement and database failures are safely handled', async () => {
  let h = harness(); const result = await h.run(); assert.equal(result.status, 200); assert.equal((await result.json()).status, 'accepted'); assert.equal(h.calls.length, 2);
  for (const [error, status] of [['CS_AUTH_INVALID', 401], ['CS_SCOPE_DENIED', 403], ['CS_ID_CONFLICT', 409], ['CS_INVALID_TOTALS', 422], ['upstream secret', 503]]) {
    h = harness({ error }); const response = await h.run(); assert.equal(response.status, status); assert.ok(!(await response.text()).includes('upstream secret'));
  }
  for (const status of ['unchanged', 'stale']) {
    const ack = { ok: true, status, snapshot_id: snapshot().snapshot_id, current_snapshot_id: status === 'stale' ? '22222222-2222-4222-8222-222222222222' : snapshot().snapshot_id };
    h = harness({ ack }); assert.equal((await h.run()).status, 200);
  }
  h = harness({ ack: { ok: true, status: 'accepted', snapshot_id: snapshot().snapshot_id, current_snapshot_id: 'different' } }); assert.equal((await h.run()).status, 503);
});
test('JSON/media/body size rejected before publication', async () => {
  let h = harness(); assert.equal((await h.run('{')).status, 400);
  h = harness(); assert.equal((await h.run(undefined, { contentType: 'text/plain' })).status, 415); assert.equal(h.calls.length, 0);
  h = harness(); assert.equal((await h.run(' '.repeat(1024 * 1024 + 1))).status, 413); assert.equal(h.calls.length, 1);
});
