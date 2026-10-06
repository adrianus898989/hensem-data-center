const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase/collector-control.sql'), 'utf8');
const source = fs.readFileSync(path.join(root, 'supabase/functions/collector-control/handler.ts'), 'utf8');
function evaluate(source, requireModule = () => { throw Error('Unexpected import'); }) {
  const moduleValue = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: moduleValue, exports: moduleValue.exports, require: requireModule, Request, Response, Headers, URL, TextEncoder, TextDecoder, Uint8Array, AbortSignal, atob, crypto: webcrypto, fetch });
  return moduleValue.exports;
}
const security = evaluate(fs.readFileSync(path.join(root, 'supabase/functions/_shared/application-security.ts'), 'utf8'));
const { createCollectorControlHandler } = evaluate(source, name => { assert.equal(name, '../_shared/application-security.ts'); return security; });
const ACTOR = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const USER_JWT = 'verified-by-auth.' + Buffer.from(JSON.stringify({ session_id: SESSION })).toString('base64url') + '.signature';
const PROXY_KEY = 'test-identity-proxy-key', CLIENT_IP = '203.0.113.19';
const sha = value => createHash('sha256').update(value).digest('hex');
let db, baselineCatalog, baselineMetadata;
const scalar = async (query, values = []) => Object.values((await db.query(query, values)).rows[0])[0];
const catalogMetadata = () => scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.dashboard_role_catalog()'::regprocedure");
before(async () => {
  db = new PGlite();
  await db.exec('create schema private; create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(fs.readFileSync(path.join(root, 'tests/fixtures/daily-comparison-role-catalog-baseline.sql'), 'utf8'));
  await db.exec('revoke all on function private.dashboard_role_catalog() from public;');
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261004140008_daily_comparison_role_catalog.sql'), 'utf8'));
  baselineCatalog = await scalar('select private.dashboard_role_catalog()');
  baselineMetadata = await catalogMetadata();
  await db.exec(sql);
});
after(async () => db?.close());
beforeEach(async () => db.exec('begin'));
afterEach(async () => { await db.exec('rollback'); await db.exec('reset role'); });
function harness() {
  const state = { calls: [], role: { mode: 'assigned', canView: true, permissions: ['collector_control.view', 'collector_control.edit'] },
    profile: { auth_user_id: ACTOR, role: 'owner', active: true }, authId: ACTOR, authStatus: 200, expectedToken: USER_JWT,
    sessionAllowed: true, ipAllowed: true, fail: '', random: 0 };
  const remote = async (input, init) => {
    const url = new URL(String(input)); state.calls.push({ path: url.pathname, init });
    assert.equal(url.origin, 'https://control.test'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    if (state.fail === url.pathname) throw Error('secret raw upstream token and child stdout');
    if (url.pathname === '/auth/v1/user') {
      assert.equal(init.headers.Authorization, 'Bearer ' + state.expectedToken); assert.equal(init.headers.apikey, 'public-key');
      return Response.json({ id: state.authId, user_metadata: { role: 'owner' } }, { status: state.authStatus });
    }
    if (url.pathname === '/rest/v1/dashboard_profiles') {
      assert.equal(init.headers.Authorization, 'Bearer ' + state.expectedToken); assert.equal(init.headers.apikey, 'public-key');
      assert.equal(url.searchParams.get('auth_user_id'), 'eq.' + state.authId);
      assert.equal(url.searchParams.get('limit'), '1');
      return Response.json(state.profile ? [state.profile] : []);
    }
    if (url.pathname === '/rest/v1/rpc/dashboard_role_access') {
      assert.equal(init.headers.Authorization, 'Bearer ' + state.expectedToken); assert.equal(init.headers.apikey, 'public-key');
      return Response.json(state.role);
    }
    assert.equal(init.headers.Authorization, 'Bearer service-key'); assert.equal(init.headers.apikey, 'service-key');
    const name = url.pathname.split('/').pop(), args = JSON.parse(init.body);
    if (name === 'application_session_check') {
      assert.deepEqual(args, { p_user_id: state.authId, p_session_id: SESSION, p_surface: 'dashboard' });
      return Response.json({ allowed: state.sessionAllowed, code: state.sessionAllowed ? 'ok' : 'application_session_denied' });
    }
    if (name === 'application_auth_ip_check') {
      assert.deepEqual(args, { p_surface: 'dashboard', p_ip: CLIENT_IP, p_user_id: state.authId });
      return Response.json(state.ipAllowed);
    }
    assert.match(url.pathname, /^\/rest\/v1\/rpc\/collector_control_/);
    await db.exec('set local role service_role');
    try {
      const keys = Object.keys(args);
      const result = await scalar(`select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')})`, keys.map(key => typeof args[key] === 'object' ? JSON.stringify(args[key]) : args[key]));
      return Response.json(result);
    } finally { await db.exec('reset role'); }
  };
  const handler = createCollectorControlHandler({ url: 'https://control.test', publicKey: 'public-key', serviceKey: 'service-key', proxyKeySha256: sha(PROXY_KEY), allowedOrigins: ['https://dashboard.test'], fetch: remote, randomBytes: size => new Uint8Array(size).fill(++state.random) });
  const request = (body, token = USER_JWT, headers = {}) => handler(new Request('https://edge.test/collector-control', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(['pair', 'poll'].includes(body.action) ? {} : { 'x-portal-proxy-key': PROXY_KEY, 'x-portal-client-ip': CLIENT_IP }), ...headers }, body: JSON.stringify(body) }));
  const call = async (...args) => { const response = await request(...args); return { status: response.status, body: await response.json(), headers: response.headers }; };
  const pair = async (name = 'Test Mac') => {
    const created = await call({ action: 'createPairing', name }); assert.equal(created.status, 200);
    const paired = await call({ action: 'pair', code: created.body.code, agentVersion: '1.0.0' }, null); assert.equal(paired.status, 200);
    return { ...paired.body, code: created.body.code };
  };
  return { state, request, call, pair };
}
const item = (id = 'demo', patch = {}) => ({ id, label: 'Harmless demo', observedState: 'stopped', pid: null, detailCode: 'stopped', ...patch });
const poll = (h, d, tasks = [item()]) => h.call({ action: 'poll', deviceId: d.deviceId, agentVersion: '1.0.0', tasks }, d.token);
const desired = (h, d, desiredState = 'running', expectedRevision = 0) => h.call({ action: 'setDesired', deviceId: d.deviceId, taskId: 'demo', desiredState, expectedRevision });
const age = d => db.query("update private.collector_control_devices set last_seen_at=clock_timestamp()-interval '30 seconds' where id=$1", [d.deviceId]);
const writes = h => h.state.calls.filter(call => call.path.startsWith('/rest/v1/rpc/collector_control_'));

test('fresh owner identity and profile authorize overview; no raw hashes or secrets returned', async () => {
  const h = harness(), d = await h.pair(); await poll(h, d);
  const result = await h.call({ action: 'overview' }); assert.equal(result.status, 200); assert.equal(result.body.canEdit, true);
  assert.equal(result.body.devices[0].tasks[0].desiredState, 'stopped');
  assert.doesNotMatch(JSON.stringify(result.body), new RegExp(d.token + '|' + sha(d.token) + '|' + d.code + '|service-key'));
  assert.match(result.headers.get('cache-control'), /private, no-store/);
});
test('legacy allow-all and user metadata cannot grant collector control; assigned view cannot edit', async () => {
  const h = harness(); h.state.profile.role = 'viewer'; h.state.role.mode = 'legacy';
  assert.equal((await h.call({ action: 'overview' })).status, 403); assert.equal(writes(h).length, 0);
  h.state.role.mode = 'assigned'; h.state.role.permissions = ['collector_control.view'];
  assert.equal((await h.call({ action: 'overview' })).body.canEdit, false);
  assert.equal((await h.call({ action: 'createPairing', name: 'Denied' })).status, 403);
  h.state.role.canView = false; assert.equal((await h.call({ action: 'overview' })).status, 403);
});
test('assigned collector editors can manage, but removal of the view or edit grant denies the next request', async () => {
  const h = harness(); h.state.profile.role = 'viewer';
  const d = await h.pair(); await poll(h, d);
  assert.equal((await desired(h, d)).body.revision, 1);
  h.state.role.permissions = ['collector_control.view'];
  const before = writes(h).length;
  assert.equal((await desired(h, d, 'stopped', 1)).status, 403);
  assert.equal(writes(h).length, before);
  h.state.role.permissions = ['collector_control.edit'];
  assert.equal((await h.call({ action: 'overview' })).status, 403);
  assert.equal(writes(h).length, before);
});
test('Auth loss, inactive/missing/mismatched profiles immediately deny even a previously authorized request', async () => {
  const h = harness(); assert.equal((await h.call({ action: 'overview' })).status, 200);
  const before = writes(h).length;
  for (const patch of [{ authStatus: 401 }, { profile: null }, { profile: { auth_user_id: ACTOR, active: false, role: 'owner' } }, { profile: { auth_user_id: 'wrong', active: true, role: 'owner' } }]) {
    h.state.authStatus = 200; Object.assign(h.state, patch); assert([401, 403].includes((await h.call({ action: 'overview' })).status));
  }
  assert.equal(writes(h).length, before);
});
test('device tokens cannot call human endpoints and human JWT cannot poll a device', async () => {
  const h = harness(), d = await h.pair(), before = h.state.calls.length;
  assert.equal((await h.call({ action: 'overview' }, d.token)).status, 401);
  assert.equal((await h.call({ action: 'poll', deviceId: d.deviceId, agentVersion: '1.0.0', tasks: [] })).status, 401);
  assert.equal(h.state.calls.length, before);
});
test('every human action checks trusted proxy, approved application session and current account IP before owner bypass', async () => {
  const actions = [{ action: 'overview' }, { action: 'createPairing', name: 'Denied' }, { action: 'revokeDevice', deviceId: ACTOR },
    { action: 'setDesired', deviceId: ACTOR, taskId: 'demo', desiredState: 'running', expectedRevision: 0 }];
  for (const action of actions) {
    const h = harness();
    for (const headers of [{ 'x-portal-proxy-key': '' }, { 'x-portal-proxy-key': 'forged' }, { 'x-portal-client-ip': 'not-an-ip' }]) {
      assert.equal((await h.call(action, USER_JWT, headers)).body.code, 'proxy_denied'); assert.equal(h.state.calls.length, 0);
    }
    h.state.sessionAllowed = false;
    assert.equal((await h.call(action)).body.code, 'application_session_denied');
    assert(!h.state.calls.some(c => c.path === '/rest/v1/dashboard_profiles'));
    h.state.sessionAllowed = true; h.state.ipAllowed = false;
    assert.equal((await h.call(action)).body.code, 'ip_denied'); assert.equal(writes(h).length, 0);
  }
  const h = harness();
  assert.equal((await h.call({ action: 'overview' })).status, 200);
  h.state.sessionAllowed = false;
  assert.equal((await h.call({ action: 'overview' })).body.code, 'application_session_denied');
  assert.equal(writes(h).length, 1);
});
test('missing session identifiers and unavailable security checks never grant a previously verified Auth user', async () => {
  const h = harness(); h.state.expectedToken = 'verified-by-auth.e30.signature';
  assert.equal((await h.call({ action: 'overview' }, h.state.expectedToken)).body.code, 'login_required');
  assert.equal(writes(h).length, 0); h.state.expectedToken = USER_JWT;
  for (const path of ['/rest/v1/rpc/application_session_check', '/rest/v1/rpc/application_auth_ip_check']) {
    h.state.fail = path; assert.equal((await h.call({ action: 'overview' })).status, 503); assert.equal(writes(h).length, 0);
  }
});
test('pairing stores only hashes, expires, and consumes a code exactly once', async () => {
  const h = harness(), created = await h.call({ action: 'createPairing', name: 'First' });
  const stored = await scalar('select to_jsonb(p) from private.collector_control_pairings p');
  assert.equal(stored.code_hash, sha(created.body.code)); assert(!JSON.stringify(stored).includes(created.body.code));
  await db.exec("update private.collector_control_pairings set expires_at=clock_timestamp()-interval '1 second'");
  assert.equal((await h.call({ action: 'pair', code: created.body.code, agentVersion: '1' }, null)).body.code, 'invalid_pairing');
  const d = await h.pair(); assert.equal((await h.call({ action: 'pair', code: d.code, agentVersion: '1' }, null)).body.code, 'invalid_pairing');
  assert.equal(await scalar('select count(*)::int from private.collector_control_devices'), 1);
  assert.equal(await scalar('select token_hash from private.collector_control_devices'), sha(d.token));
});
test('cross-device polling and revoked bearer are rejected inside the database', async () => {
  const h = harness(), a = await h.pair('A'), b = await h.pair('B');
  const crossed = await poll(h, { ...b, token: a.token }); assert.equal(crossed.status, 401);
  assert.equal(await scalar('select count(*)::int from private.collector_control_tasks'), 0);
  assert.equal(await scalar('select last_seen_at from private.collector_control_devices where id=$1', [b.deviceId]), null);
  assert.equal((await h.call({ action: 'revokeDevice', deviceId: a.deviceId })).status, 200);
  assert.equal((await poll(h, a)).body.code, 'device_denied');
  assert.equal((await poll(h, b)).status, 200);
});
test('registered tasks start stopped; revisions prevent stale controls and no-op clicks do not audit', async () => {
  const h = harness(), d = await h.pair(); await poll(h, d);
  assert.equal((await desired(h, d)).body.revision, 1);
  assert.equal((await desired(h, d)).body.code, 'revision_conflict');
  const count = await scalar('select count(*)::int from private.collector_control_audit');
  assert.equal((await desired(h, d, 'running', 1)).body.revision, 1);
  assert.equal(await scalar('select count(*)::int from private.collector_control_audit'), count);
  assert.equal((await desired(h, d, 'stopped', 0)).status, 409);
  assert.equal((await desired(h, d, 'stopped', 1)).body.revision, 2);
  assert.equal((await h.call({ action: 'setDesired', deviceId: d.deviceId, taskId: 'unknown', desiredState: 'running', expectedRevision: 0 })).body.code, 'task_not_found');
});
test('removed tasks lose latent start, become unavailable, are excluded from commands and re-add stopped', async () => {
  const h = harness(), d = await h.pair(); await poll(h, d); await desired(h, d); await age(d);
  assert.deepEqual((await poll(h, d, [])).body.tasks, []);
  assert.equal((await desired(h, d, 'running', 2)).body.code, 'task_unavailable');
  let task = (await h.call({ action: 'overview' })).body.devices[0].tasks[0]; assert.equal(task.detailCode, 'unavailable'); assert.equal(task.desiredState, 'stopped');
  await age(d); const again = await poll(h, d); assert.equal(again.body.tasks[0].desiredState, 'stopped'); assert.equal(again.body.tasks[0].revision, 2);
});
test('unchanged heartbeat does not rewrite task status timestamp or accumulate audit rows', async () => {
  const h = harness(), d = await h.pair(); await poll(h, d);
  const before = await scalar('select to_jsonb(t) from private.collector_control_tasks t'), audits = await scalar('select count(*) from private.collector_control_audit');
  assert.equal((await poll(h, d)).body.code, 'poll_too_soon');
  await age(d); assert.equal((await poll(h, d)).status, 200);
  assert.deepEqual(await scalar('select to_jsonb(t) from private.collector_control_tasks t'), before);
  assert.equal(await scalar('select count(*) from private.collector_control_audit'), audits);
  await age(d); await poll(h, d, [item('demo', { observedState: 'running', pid: 42, detailCode: 'ok' })]);
  assert.equal(await scalar('select pid from private.collector_control_tasks'), 42);
});
test('inventory validates duplicates, bounds, paths/commands, raw detail text and invalid types before database access', async () => {
  const h = harness(), d = await h.pair(), count = writes(h).length;
  for (const tasks of [[item(), item()], [item('../x')], [item('x', { command: 'rm' })], [item('x', { label: 'line\nbreak' })], [item('x', { pid: -1 })], [item('x', { detailCode: 'token=super-secret' })], [item('x', { observedState: 'healthy' })], [item('x', { observedState: ['running'] })], [item('x', { detailCode: ['ok'] })], Array.from({ length: 101 }, (_, i) => item('id' + i))]) {
    assert.equal((await poll(h, d, tasks)).status, 400);
  }
  assert.equal(writes(h).length, count);
  assert.equal((await h.call({ action: ['overview'] })).status, 400);
  assert.equal((await h.call({ action: 'createPairing', name: 'Name', password: 'never' })).status, 400);
});
test('transport rejects disallowed origins, methods, oversized JSON and safely redacts upstream failure', async () => {
  const h = harness();
  assert.equal((await h.call({ action: 'overview' }, USER_JWT, { origin: 'https://hostile.test' })).status, 403); assert.equal(h.state.calls.length, 0);
  assert.equal((await h.call({ action: 'overview', blob: 'x'.repeat(70000) })).status, 413);
  h.state.fail = '/auth/v1/user'; const failure = await h.call({ action: 'overview' }); assert.equal(failure.status, 503);
  assert.deepEqual(failure.body, { ok: false, code: 'service_unavailable' });
});
test('RLS is enabled and anon/authenticated cannot access control storage or service-only RPCs', async () => {
  assert.equal(await scalar("select count(*)::int from pg_class c join pg_namespace n on c.relnamespace=n.oid where n.nspname='private' and c.relname like 'collector_control_%' and c.relkind='r' and c.relrowsecurity"), 4);
  assert.equal(await scalar("select count(*)::int from pg_proc p join pg_namespace n on p.pronamespace=n.oid where p.proname like 'collector_control_%' and p.prosecdef"), 0);
  for (const role of ['anon', 'authenticated']) {
    assert.equal(await scalar("select bool_or(has_function_privilege($1,p.oid,'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'collector_control_%'", [role]), false);
    assert.equal(await scalar("select bool_or(has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and c.relname like 'collector_control_%'", [role]), false);
    for (const query of ['select public.collector_control_overview()', "select public.collector_control_poll(null,null,null,'[]')", 'select * from private.collector_control_devices']) {
      await db.exec('savepoint acl'); await db.exec('set local role ' + role);
      await assert.rejects(() => db.query(query), /permission denied/); await db.exec('rollback to savepoint acl'); await db.exec('reset role');
    }
  }
});
test('failed pairing insert rolls back consumption and leaves no half-created device', async () => {
  const h = harness(), d = await h.pair(), created = await h.call({ action: 'createPairing', name: 'Second' });
  await db.exec('savepoint duplicate_hash');
  await assert.rejects(() => scalar('select public.collector_control_pair($1,$2,$3)', [sha(created.body.code), sha(d.token), '1']), /unique constraint/);
  await db.exec('rollback to savepoint duplicate_hash');
  assert.equal(await scalar('select count(*)::int from private.collector_control_pairings where code_hash=$1', [sha(created.body.code)]), 1);
  assert.equal(await scalar('select count(*)::int from private.collector_control_devices'), 1);
});
test('control audit retention is bounded and stores no code, token, exception or child output fields', async () => {
  await db.exec("insert into private.collector_control_audit(action,created_at) select 'paired',clock_timestamp()-interval '31 days' from generate_series(1,10); insert into private.collector_control_audit(action) select 'paired' from generate_series(1,10005)");
  const h = harness(); await h.call({ action: 'createPairing', name: 'Retention' });
  assert.equal(await scalar('select count(*)::int from private.collector_control_audit'), 10000);
  const columns = (await db.query("select column_name from information_schema.columns where table_schema='private' and table_name='collector_control_audit' order by ordinal_position")).rows.map(x => x.column_name);
  assert.deepEqual(columns, ['id', 'actor_id', 'device_id', 'task_id', 'action', 'revision', 'created_at']);
});

test('additive SQL preserves all prior catalog entries and metadata, and replays without losing control data', async () => {
  const h = harness(), d = await h.pair(); await poll(h, d); await desired(h, d);
  const device = await scalar('select to_jsonb(d) from private.collector_control_devices d');
  const task = await scalar('select to_jsonb(t) from private.collector_control_tasks t');
  await db.exec(sql.replace(/^begin;$/m, '').replace(/^commit;$/m, ''));
  assert.deepEqual(await scalar('select to_jsonb(d) from private.collector_control_devices d'), device);
  assert.deepEqual(await scalar('select to_jsonb(t) from private.collector_control_tasks t'), task);
  const catalog = await scalar('select private.dashboard_role_catalog()');
  const expectedPages = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/dashboardRoleCatalog.json'), 'utf8')).pages;
  assert.deepEqual(catalog.pages, expectedPages);
  assert.deepEqual(catalog.pages.filter(p => p.id !== 'collector_control'), baselineCatalog.pages);
  assert.deepEqual(catalog.permissions, [...baselineCatalog.permissions, { key: 'collector_control.view' }, { key: 'collector_control.edit' }]);
  assert.deepEqual({ ...catalog, pages: baselineCatalog.pages, permissions: baselineCatalog.permissions }, baselineCatalog);
  assert.deepEqual(await catalogMetadata(), baselineMetadata);
});
test('catalog registration rejects missing, partial or unknown bodies without overwriting current metadata or control data', async () => {
  const h = harness(), d = await h.pair(); await poll(h, d);
  const replay = sql.replace(/^begin;$/m, '').replace(/^commit;$/m, '');
  for (const catalog of [{ version: 999, pages: [], permissions: [] },
    { ...baselineCatalog, pages: [...baselineCatalog.pages, { id: 'collector_control' }] },
    { ...baselineCatalog, permissions: [...baselineCatalog.permissions, { key: 'collector_control.view' }] }]) {
    await db.exec('savepoint catalog_case');
    const definition = await scalar("select format('create or replace function private.dashboard_role_catalog() returns jsonb language sql immutable set search_path='''' as %L','select '||quote_literal($1::jsonb::text)||'::jsonb')", [JSON.stringify(catalog)]);
    await db.exec(definition); const meta = await catalogMetadata();
    await db.exec('savepoint rejected_registration');
    await assert.rejects(() => db.exec(replay), /collector_control_catalog_baseline_drift/);
    await db.exec('rollback to savepoint rejected_registration');
    assert.deepEqual(await scalar('select private.dashboard_role_catalog()'), catalog);
    assert.deepEqual(await catalogMetadata(), meta);
    assert.equal(await scalar('select count(*)::int from private.collector_control_devices'), 1);
    await db.exec('rollback to savepoint catalog_case');
  }
  await db.exec('drop function private.dashboard_role_catalog(); savepoint missing_catalog');
  await assert.rejects(() => db.exec(replay), /collector_control_catalog_missing/);
  await db.exec('rollback to savepoint missing_catalog');
  assert.equal(await scalar("select to_regprocedure('private.dashboard_role_catalog()')"), null);
});
test('catalog registration refuses ACL, owner or execution-metadata drift on baseline and replay', async () => {
  const replay = sql.replace(/^begin;$/m, '').replace(/^commit;$/m, '');
  for (const applied of [false, true]) for (const change of [
    'grant execute on function private.dashboard_role_catalog() to public',
    'grant execute on function private.dashboard_role_catalog() to authenticated',
    'grant execute on function private.dashboard_role_catalog() to service_role',
    'alter function private.dashboard_role_catalog() owner to authenticated',
    'alter function private.dashboard_role_catalog() security definer',
    'alter function private.dashboard_role_catalog() stable',
    "alter function private.dashboard_role_catalog() set search_path='public'",
    'alter function private.dashboard_role_catalog() cost 999',
  ]) {
    await db.exec('savepoint catalog_case');
    if (!applied) {
      await db.exec(fs.readFileSync(path.join(root, 'tests/fixtures/daily-comparison-role-catalog-baseline.sql'), 'utf8'));
      await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261004140008_daily_comparison_role_catalog.sql'), 'utf8').replace(/^begin;$/m, '').replace(/^commit;$/m, ''));
    }
    await db.exec(change); const catalog = await scalar('select private.dashboard_role_catalog()'), meta = await catalogMetadata();
    await db.exec('savepoint rejected_registration');
    await assert.rejects(() => db.exec(replay), /collector_control_catalog_(metadata|baseline)_drift/);
    await db.exec('rollback to savepoint rejected_registration');
    assert.deepEqual(await scalar('select private.dashboard_role_catalog()'), catalog);
    assert.deepEqual(await catalogMetadata(), meta);
    await db.exec('rollback to savepoint catalog_case');
  }
});
