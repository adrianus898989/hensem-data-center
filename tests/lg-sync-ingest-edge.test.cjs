// Offline execution of the real Edge handlers. Every transport is a local stub.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, webcrypto } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..'), dir = path.join(root, 'supabase/functions/lg-sync-ingest');
const sources = Object.fromEntries(['index', 'legacy', 'business'].map(name => [name, fs.readFileSync(path.join(dir, name + '.ts'), 'utf8')]));
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name).exports;
  assert(Object.hasOwn(sources, name), 'only the three local production modules may be loaded');
  const mod = { exports: {} }; modules.set(name, mod);
  const compiled = ts.transpileModule(sources[name].replaceAll('import.meta.main', 'false'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const localRequire = specifier => { assert.match(specifier, /^\.\/(?:legacy|business)\.ts$/); return load(specifier.slice(2, -3)); };
  new Function('require', 'module', 'exports', 'fetch', 'crypto', compiled)(localRequire, mod, mod.exports, () => { throw Error('UNMOCKED_NETWORK_FORBIDDEN'); }, webcrypto);
  return mod.exports;
}
const edge = load('index');
const token = 'synthetic_lg_token_' + 'a'.repeat(40), serviceKey = 'synthetic_service_key_not_a_real_credential';
const uuid = '11111111-1111-4111-8111-111111111111', lease = '22222222-2222-4222-8222-222222222222';
const scope = { source_system: 'LG', platform: 'SUPERLG', country_code: 'PH', order_kind: 'withdraw' };
const row = (extra = {}) => ({ order_no: 'SYNTHETIC-LG-ORDER', member_id: null, status_code: 6, status_text: '已驳回', status_class: 'rejected', order_amount: '100.12345678', actual_amount: '99.00', metric_amount: '99.00', created_at: '2020-01-02T00:01:00Z', finished_at: null, paid_at: null, operator_name: 'system', operator_kind: 'auto', handle_seconds: null, third_party: 'TEST', raw_channel: 'TEST', mapping_code: '', payment_method: 'TEST', merchant_name: 'TEST', raw: { status: 6, callbackTime: '2020-01-02T00:05:00Z' }, ...extra });
const raw = (extra = {}) => ({ ...row().raw, businessSchemaVersion: 1, remark: 'Review required', remarkState: 'present', appRemark: '', appRemarkState: 'missing', ...extra });
const noted = (rawExtra = {}, extra = {}) => row({ member_id: 'synthetic_member-1', raw: raw(rawExtra), ...extra });
const kinds = ['callback', 'window-created', 'window-callback'];
function chunk(kind, order = noted()) {
  const p = { ...scope, snapshot_id: uuid, chunk_index: 0, orders: [order] };
  if (kind.startsWith('window-')) return { ...p, action: 'window_chunk', stream: kind.slice(7), lease_token: lease };
  if (kind === 'callback') return { ...p, action: 'callback_chunk', callback_date: '2020-01-02', observed_at: '2020-01-04T00:00:00Z' };
  return { ...p, action: 'chunk', sync_mode: kind, stat_date: '2020-01-02', observed_at: '2020-01-04T00:00:00Z' };
}
function ack(p, extra = {}) {
  const a = { ok: true, ...scope, snapshot_id: p.snapshot_id, status: 'accepted', chunk_index: p.chunk_index, order_count: p.orders?.length ?? 1 };
  if (p.action.startsWith('window_')) Object.assign(a, { stream: p.stream, lease_token: p.lease_token, lease_expires_at: '2020-01-04T00:02:00Z' });
  else if (p.action.startsWith('callback_')) Object.assign(a, { callback_date: p.callback_date, observed_at: p.observed_at });
  return { ...a, ...extra };
}
const request = (payload, headers = {}) => new Request('https://receiver.invalid/functions/v1/lg-sync-ingest', { method: 'POST', headers: { 'x-lg-sync-token': token, 'content-type': 'application/json', ...headers }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) });
function harness({ response, error, throws = false, env = {} } = {}) {
  const calls = [];
  const handler = edge.handler({ SUPABASE_URL: 'https://synthetic.invalid/', SUPABASE_SERVICE_ROLE_KEY: serviceKey, ...env }, async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, init, body });
    if (throws) throw Error('SYNTHETIC_UPSTREAM_SECRET');
    return new Response(JSON.stringify(error ? { message: error } : response ? response(body.p_payload) : ack(body.p_payload)), { status: error ? 400 : 200, headers: { 'content-type': 'application/json' } });
  });
  return { handler, calls };
}

test('index remains exact production bytes and legacy changes only the business gate import and callback privacy block', () => {
  const sha = s => createHash('sha256').update(s).digest('hex');
  assert.equal(sha(sources.index), 'f757d69f36a7443362a6877245e6de2de1f63b88fdd83fa5d9ec0bd0a3f37757');
  const oldBlock = `      if(callback) {
        const fields=['order_no','member_id','status_code','status_text','status_class','order_amount','actual_amount','metric_amount','created_at','finished_at','paid_at','operator_name','operator_kind','handle_seconds','third_party','raw_channel','mapping_code','payment_method','merchant_name','raw'];
        const rawFields=['orderAmount','amount','realAmount','actualAmount','payAmount','callbackAmount','feeAmount','giveAmount','money','status','createTime','callbackTime','operatorAt','operateAt','operateTime','updateTime','updatedAt','createdAt','created_at','createAt','orderCreateTime','orderCreatedAt','applyTime'];
        if(o.member_id!==null || fields.some(f=>!Object.hasOwn(o,f)) || Object.keys(o).some(f=>!fields.includes(f)) || !plain(o.raw) ||
          Object.entries(o.raw).some(([k,v])=>!rawFields.includes(k) || (v!==null && typeof v!=='string' && typeof v!=='number'))) throw new Error('LG_INVALID_PRIVATE_FIELDS');
      }
`;
  const newBlock = "      // SQL remains the authoritative canonical text sanitizer; never rewrite hashed orders.\n      if(callback || (plain(o.raw) && Object.hasOwn(o.raw,'businessSchemaVersion'))) validateBusinessOrder(o);\n";
  assert.equal(sources.legacy.split(newBlock).length, 2);
  const restored = sources.legacy.replace("import { validateBusinessOrder } from './business.ts';\n", '').replace(newBlock, oldBlock);
  assert.equal(sha(restored), '4aa63a4aed7115365248b50e471120dcd3f05e38d54c30d64bbb94e28f70a1e1');
});

test('old v0 and new v1 callback and both window streams forward exact payload content through the real handler', async () => {
  for (const kind of kinds) for (const order of [row(), noted({ groupList: [{ groupId: 1, groupName: 'Review', colorTag: '#abcd' }], groupListTruncated: true, currentProfitAmount: '-20.00', transactionId: '12345678901234567890' })]) {
    const p = chunk(kind, order), original = JSON.stringify(p), h = harness();
    assert.equal(edge.validate(p), p); assert.equal(JSON.stringify(p), original);
    const res = await h.handler(request(p)); assert.equal(res.status, 200, kind); assert.equal(h.calls.length, 1);
    const call = h.calls[0]; assert.equal(JSON.stringify(call.body.p_payload), original);
    assert.equal(call.url, 'https://synthetic.invalid/rest/v1/rpc/' + (kind === 'callback' ? 'lg_callback_ingest' : 'lg_window_ingest'));
    assert.equal(call.body.p_token_hash, createHash('sha256').update(token).digest('hex'));
    assert.equal(call.init.headers.Authorization, 'Bearer ' + serviceKey); assert.equal(call.init.redirect, 'error'); assert(call.init.signal);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await res.text(), /synthetic_member|SYNTHETIC-LG-ORDER|Review required|synthetic_service_key|synthetic_lg_token/);
  }
});

test('new metadata is also validated on live/full chunks without altering the old full-mode contract', async () => {
  for (const kind of ['live', 'full']) {
    const p = chunk(kind), h = harness(); assert.equal((await h.handler(request(p))).status, 200); assert.deepEqual(h.calls[0].body.p_payload, p);
    const rejected = harness(); assert.equal((await rejected.handler(request(chunk(kind, noted({}, { account: 'PRIVATE-CANARY' }))))).status, 422); assert.equal(rejected.calls.length, 0);
  }
  const p = chunk('full', row({ member_id: 'SYNTHETIC LEGACY MEMBER', raw: { old_key: { synthetic: true } } })), h = harness();
  assert.equal((await h.handler(request(p))).status, 200); assert.deepEqual(h.calls[0].body.p_payload, p);
});

test('all 41 canonical sanitized fixtures and a full 12000-character note survive the Edge without rewriting', async () => {
  const vectors = JSON.parse(fs.readFileSync(path.join(root, 'tests/lg-business-notes/sanitizer_vectors.json'), 'utf8'));
  assert.equal(vectors.synthetic_only, true); assert.equal(vectors.vectors.length, 41);
  for (const vector of vectors.vectors) {
    const safe = vector.safe, visible = /[\p{L}\p{N}]/u.test(safe.replaceAll('[已隐藏]', ''));
    const text = visible ? safe : safe === '' ? '' : '[已隐藏]', state = visible ? 'present' : safe === '' ? 'empty' : 'redacted';
    const p = chunk('window-created', noted({ remark: text, remarkState: state })), h = harness();
    assert.equal((await h.handler(request(p))).status, 200, 'sanitizer vector ' + vector.id); assert.equal(h.calls[0].body.p_payload.orders[0].raw.remark, text);
  }
  const text = 'Review '.repeat(1714) + 'OK', dates = 'Reviewed 2026-10-12 00:00:00';
  const p = chunk('callback', noted({ remark: text, appRemark: dates, appRemarkState: 'present' })), h = harness();
  assert.equal((await h.handler(request(p))).status, 200); assert.equal(h.calls[0].body.p_payload.orders[0].raw.remark.length, 12000); assert.deepEqual(h.calls[0].body.p_payload, p);
});

test('private keys, invalid types, nested objects and incompatible note states reject before any fetch', async () => {
  const invalid = [
    noted({ account: 'PRIVATE-CANARY' }), noted({ phone: 'PRIVATE-CANARY' }), noted({ status: { nested: true } }), noted({}, { account: 'PRIVATE-CANARY' }),
    noted({ groupList: [{ groupId: 1, token: 'PRIVATE-CANARY' }] }), noted({ groupList: [{ groupName: {} }] }), noted({ groupList: [{ colorTag: 'url(secret)' }] }),
    noted({ groupList: Array.from({ length: 101 }, () => ({ groupId: 1 })) }), noted({ groupListTruncated: false }),
    noted({ businessSchemaVersion: '1' }), noted({ remarkState: 'wrong' }), noted({ remarkState: 'empty', remark: 'nonempty' }), noted({ remarkState: 'redacted', remark: 'nonempty' }),
    noted({ remarkState: 'present', remark: '' }), noted({ remarkState: 'present', remark: '[已隐藏]' }), noted({ remark: null }), noted({ remark: 'a'.repeat(12001) }),
    noted({ currentProfitAmount: 1 }), noted({ firstFlag: true }), noted({ appName: [] }), noted({ transactionId: 'x'.repeat(201) }),
    noted({}, { member_id: 'bad stable id' }), noted({}, { member_id: 'a'.repeat(129) }),
  ];
  for (const kind of kinds) for (const order of invalid) {
    const h = harness(), res = await h.handler(request(chunk(kind, order)));
    assert.equal(res.status, 422, kind); assert.equal(h.calls.length, 0); assert.match((await res.json()).error, /^LG_INVALID_[A-Z_]+$/);
  }
});

test('SQL remains the canonical privacy authority and its fixed rejection is returned without reflecting private text', async () => {
  for (const kind of kinds) {
    const p = chunk(kind, noted({ remark: 'phone: +5511999988888' })), h = harness({ error: 'LG_INVALID_BUSINESS_NOTE' });
    const res = await h.handler(request(p)); assert.equal(res.status, 422); assert.deepEqual(await res.json(), { ok: false, error: 'LG_INVALID_BUSINESS_NOTE' });
    assert.equal(h.calls.length, 1); assert.deepEqual(h.calls[0].body.p_payload, p, 'Edge must not mutate the payload or its chunk identity');
  }
});

test('unsafe new business integers reject before JSON rounding can silently change a forwarded source value', async () => {
  for (const kind of kinds) for (const rawExtra of [{ successNo: 9007199254740992 }, { groupList: [{ groupId: 9007199254740992 }] }]) {
    const encoded = JSON.stringify(chunk(kind, noted(rawExtra))).replace('9007199254740992', '9007199254740993');
    const h = harness(), res = await h.handler(request(encoded));
    assert.equal(res.status, 422, kind + ': unsafe integers must not be silently rounded'); assert.equal(h.calls.length, 0);
  }
});

test('real callback/window handlers reject mismatched successful ACKs instead of reporting a false accepted chunk', async () => {
  for (const kind of kinds) for (const patch of [{ ok: false }, { source_system: 'WG' }, { platform: 'LGPARTY' }, { country_code: 'ID' }, { order_kind: 'recharge' }, { snapshot_id: lease }, { status: 'published' }, { chunk_index: 1 }, { order_count: 0 }, ...(kind === 'callback' ? [{ callback_date: '2020-01-03' }, { observed_at: '2020-01-05T00:00:00Z' }] : [{ stream: 'wrong' }, { lease_token: uuid }, { lease_expires_at: null }])]) {
    const h = harness({ response: p => ack(p, patch) }), res = await h.handler(request(chunk(kind)));
    assert.equal(res.status, 503); assert.deepEqual(await res.json(), { ok: false, error: 'invalid_ack' }); assert.equal(h.calls.length, 1);
  }
});

test('window finish retains exact counts, partial-coverage and cursor/report proof checks', async () => {
  const p = { ...scope, action: 'window_finish', stream: 'created', snapshot_id: uuid, lease_token: lease, expected_cursor: '2020-01-02T00:00:00Z' };
  const receipt = { ...ack(p), status: 'committed', purpose: 'advance', creation_day_complete: false, coverage: 'window', report_refresh: 'refreshed', refreshed_dates: ['2020-01-02'], order_count: 1, expected_count: 1, fetched_count: 1, source_total: 1, changed_count: 1, stale_count: 0, start_at: p.expected_cursor, end_at: '2020-01-02T00:10:00Z', observed_at: '2020-01-04T00:00:00Z', cursor_before: p.expected_cursor, cursor_after: '2020-01-02T00:10:00Z', cursor: '2020-01-02T00:10:00Z' };
  assert.equal((await harness({ response: () => receipt }).handler(request(p))).status, 200);
  for (const patch of [{ creation_day_complete: true }, { source_total: 2 }, { changed_count: 2 }, { report_refresh: 'pending' }, { cursor_before: '2020-01-01T00:00:00Z' }, { cursor: p.expected_cursor }]) {
    const res = await harness({ response: () => ({ ...receipt, ...patch }) }).handler(request(p)); assert.equal(res.status, 503); assert.equal((await res.json()).error, 'invalid_ack');
  }
});

test('request failures never call RPC and upstream failures expose only fixed safe errors', async () => {
  const h = harness();
  for (const [req, expected] of [[new Request('https://receiver.invalid'), 405], [request(chunk('callback'), { 'x-lg-sync-token': 'bad' }), 401], [request('{bad JSON'), 422], [request(chunk('callback'), { 'content-length': String(8 * 1024 * 1024 + 1) }), 413]]) assert.equal((await h.handler(req)).status, expected);
  assert.equal(h.calls.length, 0);
  const res = await harness({ throws: true }).handler(request(chunk('callback'))); assert.equal(res.status, 503); assert.deepEqual(await res.json(), { ok: false, error: 'temporarily_unavailable' });
});
