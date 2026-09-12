// Synthetic snapshots and mocked transport only; no source or Supabase network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { createHash } = require('node:crypto');
const { loadTs, root } = require('./load-typescript.cjs');
const client = loadTs(path.join(root, 'src/lib/autoWithdrawReasonsClient.ts'));
const box = { exports: {} };
const source = ts.transpileModule(fs.readFileSync(path.join(root, 'BACKEND_CURRENT/withdraw-reasons-ingest.ts'), 'utf8').replaceAll('import.meta.main', 'false'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function('module', 'exports', source)(box, box.exports);
const edge = box.exports;
const NOW = new Date('2026-09-12T12:00:00Z');
const KEY = 'synthetic_wg_reasons_key_'.repeat(3);
const LABELS = ['会员层级命中必审名单', '会员标签命中必审名单', '提现账户首次提款必须审核', '会员前N次提款必须审核'];
const SAMPLES = [
  'Reasons for not automatically withdrawing funds: The membership level is in the list of required membership levels;',
  'Reasons for not automatically withdrawing funds: The member tag exists in the list of required member tags;',
  'Reasons for not automatically withdrawing funds: The first withdrawal of cash from the withdrawal account must be reviewed;',
  "Reasons for not automatically withdrawing funds: Members' first 5 withdrawals must be reviewed;",
];
const digest = value => createHash('sha256').update(value).digest('hex');
function snapshot() {
  const groups = LABELS.map((reason_label, index) => ({ operator_class: 'manual', reason_key: digest(reason_label), reason_label,
    classification: 'template', count: 2, success: 1, reject: 1, other: 0, samples: [SAMPLES[index]] }));
  // Ordinary remarks and empty remarks are both excluded placeholders. They
  // still conserve the source daily counts, without storing ordinary text.
  groups.push({ operator_class: 'auto', reason_key: digest('empty'), reason_label: '未填写备注', classification: 'empty',
    count: 92, success: 92, reject: 0, other: 0, samples: [] });
  return { schema_version: 1, source_system: 'WG', country_code: 'BR', platform: '26BET', stat_date: '2026-09-11',
    timezone: 'America/Sao_Paulo', snapshot_id: '00000000-0000-4000-8000-000000000111', snapshot_at: '2026-09-12T08:00:00Z',
    classifier_version: 'wg-offline-fixture', coverage: { complete: true, expected_count: 100, fetched_count: 100,
      unique_count: 100, missing_order_ids: 0, note_header_found: true, incomplete_note_count: 0 },
    totals: { total: 100, auto: 92, manual: 8, unknown: 0, success: 96, reject: 4, other: 0 }, groups };
}
function day(value = snapshot()) {
  return { source_system: value.source_system, country_code: value.country_code, platform: value.platform,
    stat_date: value.stat_date, updated_at: NOW.toISOString(), snapshot: value };
}
function fixture(options = {}) {
  const calls = [], publications = [];
  const handler = edge.createWithdrawReasonsHandler({ env: { SUPABASE_URL: 'https://wg-reasons-offline.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service' }, now: () => NOW,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://wg-reasons-offline.invalid');
      assert.equal(JSON.stringify(init.headers).includes(KEY), false, 'Dedicated raw key must not reach database');
      calls.push({ pathname: url.pathname, method: init.method });
      if (url.pathname.endsWith('/withdraw_reasons_credentials')) {
        assert.equal(url.searchParams.get('token_hash'), `eq.${digest(KEY)}`);
        return Response.json([{ source_system: 'WG', allowed_scopes: [{ country_code: 'BR', platform: '26BET' }],
          expires_at: '2027-01-01T00:00:00Z', revoked: false, ...options.credential }]);
      }
      const body = JSON.parse(init.body);
      assert.equal(body.p_token_hash, digest(KEY));
      if (url.pathname.endsWith('/report_withdraw_reasons_snapshots')) {
        assert.equal(init.method, 'POST');
        assert.equal(body.p_start, '2026-09-01'); assert.equal(body.p_end, '2026-09-11');
        return Response.json({ ok: true, snapshots: [] });
      }
      assert.equal(url.pathname, '/rest/v1/rpc/publish_withdraw_reasons_snapshot');
      assert.equal(init.method, 'POST'); publications.push(body.p_snapshot);
      return Response.json(options.ack || { ok: true, status: 'accepted', snapshot_id: body.p_snapshot.snapshot_id, current_snapshot_id: body.p_snapshot.snapshot_id });
    } });
  const request = body => handler(new Request('https://wg-reasons-edge.invalid', { method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Reasons-Key': KEY }, body: JSON.stringify(body) }));
  return { request, publications, calls };
}

test('existing receiver and dashboard validator accept complete WG protocol without a new schema', async () => {
  const value = snapshot(), mock = fixture();
  assert.equal(edge.validateSnapshot(value, NOW), value);
  assert.deepEqual(client.validateReasonsDay(day(value)), day(value));
  const response = await mock.request({ action: 'ingest', snapshot: value });
  assert.equal(response.status, 200); assert.equal((await response.json()).status, 'accepted');
  assert.deepEqual(mock.publications, [value]);
  assert.deepEqual(mock.calls.map(call => call.method), ['GET', 'POST']);
});
test('Chinese normalized labels, English samples and source counts survive unchanged', () => {
  const value = snapshot(), rendered = client.validateReasonsDay(day(value));
  assert.deepEqual(rendered.snapshot.groups.map(group => group.reason_label).slice(0, 4), LABELS);
  assert.deepEqual(rendered.snapshot.groups.slice(0, 4).map(group => group.samples[0]), SAMPLES);
  const reasons = rendered.snapshot.groups.filter(group => group.classification !== 'empty');
  const denominator = reasons.reduce((sum, group) => sum + group.count, 0);
  assert.equal(denominator, 8); assert.equal(rendered.snapshot.totals.total, 100);
  for (const reason of reasons) assert.equal(client.reasonPercent(reason.count, denominator), '25.00%');
  assert.equal(client.reasonNoteSnapshot(rendered, 'reasons'), rendered.snapshot);
  assert.equal(client.reasonNoteSnapshot(rendered, 'member'), null);
});
for (const [label, change] of [['AR credential', { source_system: 'AR' }], ['wrong country', { allowed_scopes: [{ country_code: 'VN', platform: '26BET' }] }],
  ['wrong platform', { allowed_scopes: [{ country_code: 'BR', platform: '26BET2' }] }]]) {
  test(`${label} cannot publish WG or cross the dedicated scope`, async () => {
    const mock = fixture({ credential: change });
    assert.equal((await mock.request({ action: 'ingest', snapshot: snapshot() })).status, 403);
    assert.equal(mock.publications.length, 0);
  });
}
test('2026-09-01 through 11 inclusive is a valid scoped reason report', async () => {
  const mock = fixture();
  assert.equal((await mock.request({ action: 'report', start: '2026-09-01', end: '2026-09-11', platforms: ['26BET'] })).status, 200);
  assert.equal(mock.publications.length, 0);
  assert.equal((await mock.request({ action: 'report', start: '2026-09-01', end: '2026-09-11', platforms: ['OUTSIDE'] })).status, 403);
});
for (const [label, change] of [
  ['NEWAR note marker', value => { value.note_field = 'remark'; }],
  ['NEWAR member channel', value => { value.member_notes = {}; }],
  ['incomplete coverage', value => { value.coverage.complete = false; }],
  ['missing order identity', value => { value.coverage.missing_order_ids = 1; }],
  ['duplicate counting', value => { value.groups[0].count += 1; value.groups[0].success += 1; }],
  ['unbalanced statuses', value => { value.groups[0].reject = 0; }],
  ['duplicate group identity', value => { value.groups[1].reason_key = value.groups[0].reason_key; }],
  ['oversized non-PANDA label', value => { value.groups[0].reason_label = '文'.repeat(401); }],
  ['oversized non-PANDA sample', value => { value.groups[0].samples = ['文'.repeat(501)]; }],
]) test(`${label} remains fail closed for WG`, async () => {
  const value = snapshot(), mock = fixture(); change(value);
  assert.equal((await mock.request({ action: 'ingest', snapshot: value })).status, 422);
  assert.equal(mock.publications.length, 0);
});
test('mismatched receipt does not report accepted', async () => {
  const mock = fixture({ ack: { ok: true, status: 'accepted', snapshot_id: snapshot().snapshot_id, current_snapshot_id: '00000000-0000-4000-8000-000000000999' } });
  const response = await mock.request({ action: 'ingest', snapshot: snapshot() });
  assert.equal(response.status, 503); assert.equal((await response.json()).ok, false);
});
test('existing AR, PANDA, BAIFU and NEWAR routing remains isolated', () => {
  for (const [country, platform, expected] of [['IN', 'TPPLAY', 'AR'], ['BR', '776F', 'PANDA'], ['BR', '5C555', 'BAIFU'], ['PK', 'POPZAR', 'NEWAR'], ['IN', 'DHANIWIN', 'NEWAR']])
    assert.equal(client.reasonSourceTarget(country, platform).source, expected);
});
test('only the five existing WG reason platforms map to WG in their exact countries', () => {
  for (const [country, names] of [['VN', ['98VV', 'XX98']], ['BR', ['26BET', 'POPKKK', 'POPMIU']]]) {
    for (const platform of names) {
      assert.deepEqual(client.reasonSourceTarget(country, ` ${platform.toLowerCase()} `), { source: 'WG', platform });
      for (const wrong of ['IN', country === 'VN' ? 'BR' : 'VN']) assert.equal(client.reasonSourceTarget(wrong, platform).source, 'AR');
    }
  }
  for (const platform of ['KK98', '98VV2', 'XX98-NEW', '26BET2', 'POPKKK2', 'POPMIU2'])
    for (const country of ['BR', 'VN']) assert.equal(client.reasonSourceTarget(country, platform).source, 'AR');
});
test('WG dashboard query is authenticated GET, exact-scoped and never falls back to AR', async () => {
  const auth = loadTs(path.join(root, 'src/lib/dashboardAuthClient.ts'));
  const session = { access_token: 'synthetic-ui-token', refresh_token: 'synthetic-refresh', expires_at: 4102444800, user: { id: 'synthetic-user' } };
  const oldFetch = global.fetch, oldURL = process.env.NEXT_PUBLIC_SUPABASE_URL, oldKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://wg-reasons-read.invalid'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-public-key';
  auth.saveDashboardSession(session);
  let calls = 0, returnWrongSource = false;
  global.fetch = async (input, init) => {
    const url = new URL(String(input)); calls++;
    assert.equal(url.origin, 'https://wg-reasons-read.invalid');
    assert.equal(url.pathname, '/rest/v1/withdraw_reasons_daily_grouped');
    assert.equal(url.searchParams.get('source_system'), 'eq.WG'); assert.equal(url.searchParams.get('country_code'), 'eq.BR');
    assert.equal(url.searchParams.get('platform'), 'ilike.26BET'); assert.equal(url.searchParams.get('stat_date'), 'eq.2026-09-11');
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer synthetic-ui-token');
    return Response.json([{ ...day(), source_system: returnWrongSource ? 'AR' : 'WG' }]);
  };
  try {
    const target = { country: '巴西', platform: '26bet', date: '2026-09-11' };
    assert.equal((await client.getAutoWithdrawReasons(session, target)).source_system, 'WG');
    returnWrongSource = true;
    await assert.rejects(client.getAutoWithdrawReasons(session, target), /不匹配/);
    assert.equal(calls, 2, 'One request each; no fallback source');
  } finally {
    auth.saveDashboardSession(null); global.fetch = oldFetch;
    if (oldURL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = oldURL;
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = oldKey;
  }
});
function render(value = snapshot(), search = '') {
  const target = { country: '巴西', platform: '26BET', date: '2026-09-11' };
  const states = [target, true, { key: JSON.stringify(target), viewerKey: 'synthetic-user', day: day(value) }, '', false, 0, 'manual', search, 1, 'reasons', true];
  let index = 0;
  const react = { ...React, useState: initial => React.useState(index < states.length ? states[index++] : initial) };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/components/AutoWithdrawReasons.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === '@/lib/autoWithdrawReasonsClient') return client;
    if (name === './DashboardAuthGate') return { useDashboardAuth: () => ({ session: { access_token: 'synthetic-token', user: { id: 'synthetic-user' } }, profile: { active: true, role: 'owner' } }) };
    throw Error(`Unmocked dependency: ${name}`);
  }, module, module.exports);
  const { AutoWithdrawReasonsProvider: Provider, AutoWithdrawReasonsInlineRow: Row } = module.exports;
  return renderToStaticMarkup(React.createElement(Provider, { startDate: target.date, endDate: target.date, availableRows: [{ ...target, total: 100, manualCount: 8 }] },
    React.createElement('table', null, React.createElement('tbody', null, React.createElement(Row, target)))));
}
test('WG UI counts only reason groups, preserves raw samples and labels unchanged outcome basis', () => {
  const html = render();
  assert.match(html, /异常原因订单/); assert.match(html, />8<\/strong>/);
  assert.match(html, /其余 92 笔不计/); assert.match(html, /25.00%/);
  assert.match(html, /沿用 WG 原日表的最终成功\/驳回及自动\/人工口径/);
  assert.doesNotMatch(html, /会员 \/ ID 备注|自动出款原因尚未采集|未填写备注<\/td>/);
  for (const label of LABELS) assert.ok(html.includes(label));
  assert.match(html, /Reasons for not automatically withdrawing funds/);
});
test('WG search does not rebase the reason percentage denominator', () => {
  const html = render(snapshot(), '会员层级');
  assert.match(html, /class="wr-reason-share"[^>]*><strong>25.00%<\/strong>/);
  assert.doesNotMatch(html, /class="wr-reason-share"[^>]*><strong>100.00%<\/strong>/);
  assert.match(html, /会员层级命中必审名单/); assert.doesNotMatch(html, /会员标签命中必审名单/);
});
test('explicit but not yet classified WG interception remains visible, never silently discarded', () => {
  const value = snapshot();
  value.groups[0].reason_label = '自动出款拦截：未识别规则'; value.groups[0].classification = 'unclassified';
  value.groups[0].samples = ['Reasons for not automatically withdrawing funds: Synthetic unmatched review condition;'];
  const html = render(value);
  assert.match(html, /自动出款拦截：未识别规则/); assert.match(html, /25.00%/);
  assert.match(html, /其余 92 笔不计/);
});

module.exports = { snapshot, day, fixture, LABELS, SAMPLES };
