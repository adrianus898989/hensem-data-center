// Synthetic fixtures only. Never read WG headers, collector settings or HAR data.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, dependencies = {}) {
  const box = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8').replaceAll('import.meta.main', 'false'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (!Object.hasOwn(dependencies, name)) throw Error('Unmocked dependency');
    return dependencies[name];
  }, box, box.exports);
  return box.exports;
}
const contract = load(path.join(root, 'src/lib/wgConfigContract.ts'));
const edge = load(path.join(root, 'BACKEND_CURRENT/wg-auto-withdraw-config-ingest.ts'), { '../src/lib/wgConfigContract.ts': contract });
const NOW = new Date('2026-09-12T12:00:00Z');
const KEY = 'a'.repeat(64);
function configuration() {
  const extra = { firstFewWithdrawals: { value: 0 }, withdrawalAccountFirstWithdrawal: { excludeNoWallet: false, excludeThirdPartyWallet: false },
    last3DaysSystemReleaseAudit: { day: 0 }, withdrawalIsRefusedOrCancelled: { value: 0 }, codingMultiple: { day: 0, multiple: 0 },
    depositAndWithdrawalDifference: { ratio: 0, difference: 0 }, memberSuccessWithdraw: { severalTimes: 0 }, withdrawalDeviceAccountNumber: { value: 0 },
    rechargeWithdrawalBalanceDifference: { day: 0, multiple: 0 }, totalWithdrawalFrequency: { severalTimes: 0 }, manualDepositAudit: { day: 0 },
    sportRollingBetProfit: { amount: 0 }, exemptRechargeWithdrawalDifference: { day: 0, difference: 0 }, exemptCodingMultiple: { day: 0, multiple: 0 } };
  const ruleNames = 'firstFewWithdrawals withdrawalAccountFirstWithdrawal riskControlRulesAndNotAddressed gamblingRiskControlRulesAndNotAddressed depositAndWithdrawalDifferenceGreaterThan0 accumulatedHistoricalLoss last3DaysSystemReleaseAudit firstDepositIsComplete depositAndWithdrawalCPFIsInconsistent withdrawalIsRefusedOrCancelled withdrawalIPDoesNotHaveTheSameName codingMultiple depositAndWithdrawalDifference memberSuccessWithdraw withdrawalDeviceAccountNumber rechargeWithdrawalBalanceDifference firstUseWalletWithdraw firstUseNoWalletWithdraw perUseNoWalletWithdraw perUseWalletWithdraw totalWithdrawalFrequency manualDepositAudit sportRollingBetProfit exemptRechargeWithdrawalDifference exemptCodingMultiple'.split(' ');
  const rules = Object.fromEntries(ruleNames.map(name => [name, { status: false, ...extra[name] }]));
  rules.mustBeReceivedDiscount = { severalHours: 0, specifiedDiscount: [] }; rules.requiredWithdrawTypes = null;
  const setting = { exemptSwitch: 1, unavoidableCauseRemarkSwitch: 0, levelIds: [], tagIds: [], registerTime: 0,
    requiredLevelIds: [], requiredTagIds: [], requiredRegisterTime: 0, noRequiredTagIds: [], otherCondition: null,
    exemptAmountList: [], otherConditionV2: rules, PIXCondition: [], exemptMemberLevelAmount: [],
    mustBeReviewedAmountList: [], mustBeReviewedMemberLevelAmountList: [], reviewBankCodeList: null, betGameLimit: { games: null, days: 0 } };
  return { settings: Object.fromEntries(['0', '278', '8311', '12588'].map(id => [id, structuredClone(setting)])),
    dictionaries: { levels: [], tags: [], activities: [], withdraw_types: [], merchants: [] },
    completeness: { available: ['settings', 'levels', 'tags', 'activities', 'withdraw_types', 'merchants'], unavailable: ['games', 'banks'] } };
}
function snapshot(patch = {}) {
  return { schema_version: 1, source_system: 'WG', parser_version: 'wg-config-v1', country_code: 'BR', platform: '26BET', site_code: '278',
    timezone: 'America/Sao_Paulo', observed_at: '2026-09-10T08:00:00Z', observed_local_date: '2026-09-10',
    snapshot_id: '00000000-0000-4000-8000-000000000001', configuration: configuration(), ...patch };
}
async function fixture(options = {}) {
  const calls = [], publications = [];
  const handler = edge.createWGConfigHandler({ env: { SUPABASE_URL: 'https://wg-offline-db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' }, now: () => NOW,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.hostname, 'wg-offline-db.invalid', 'No real network');
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers.Authorization, 'Bearer synthetic-service-key');
      assert.equal(JSON.stringify(init.headers).includes(KEY), false);
      calls.push({ path: url.pathname, method: init.method });
      if (options.fetchError) throw Error('SECRET_UPSTREAM_BODY');
      if (url.pathname.endsWith('/wg_config_credentials')) {
        assert.equal(url.searchParams.get('token_hash'), `eq.${await edge.wgConfigHash(KEY)}`);
        return Response.json(options.noCredential ? [] : [{ active: true, allowed_targets: ['BR:26BET'], expires_at: '2027-01-01T00:00:00Z', ...options.credential }]);
      }
      if (url.pathname.endsWith('/wg_config_targets')) return Response.json(options.noTarget ? [] : [{ site_code: '278', timezone: 'America/Sao_Paulo',
        members: [{ site_code: '278' }, { site_code: '8311' }, { site_code: '12588' }], ...options.target }]);
      if (url.pathname.endsWith('/wg_config_latest')) return Response.json(options.report || [{ country_code: 'BR', platform: '26BET', snapshot_id: snapshot().snapshot_id }, { country_code: 'VN', platform: '98VV', snapshot_id: 'not-readable' }]);
      assert.equal(url.pathname, '/rest/v1/rpc/ingest_wg_config'); assert.equal(init.method, 'POST');
      const body = JSON.parse(init.body); publications.push(body);
      assert.equal(body.p_snapshot_hash, await edge.wgConfigHash(JSON.stringify(body.p_snapshot)));
      assert.equal(body.p_configuration_hash, await edge.wgConfigHash(JSON.stringify(body.p_snapshot.configuration)));
      assert.equal(body.p_token_hash, await edge.wgConfigHash(KEY));
      if (options.rpcError) return Response.json({ message: options.rpcError, details: 'SECRET_UPSTREAM_BODY' }, { status: 400 });
      return Response.json(options.ack || { status: 'accepted', snapshot_id: body.p_snapshot.snapshot_id, current_snapshot_id: body.p_snapshot.snapshot_id });
    } });
  const request = (body, headers = {}) => handler(new Request('https://wg-offline-edge.invalid', { method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Config-Key': KEY, ...headers }, body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) }));
  return { calls, publications, request, handler };
}
module.exports = { configuration, snapshot, contract, edge, fixture, NOW };

if (require.main === module) {
  test('valid synthetic configuration publishes whole snapshot with server-derived hashes', async () => {
    const value = snapshot(), mock = await fixture(); contract.validateWGConfigSnapshot(value, NOW);
    assert.equal((await mock.request({ action: 'ingest', snapshot: value })).status, 200);
    assert.deepEqual(mock.publications[0].p_snapshot, value);
    assert.deepEqual(mock.calls.map(c => c.method), ['GET', 'GET', 'POST']);
  });
  for (const [name, options] of [['missing', { noCredential: true }], ['revoked', { credential: { active: false } }],
    ['truthy string active', { credential: { active: 'true' } }], ['truthy numeric active', { credential: { active: 1 } }],
    ['expired', { credential: { expires_at: NOW.toISOString() } }], ['empty scope', { credential: { allowed_targets: [] } }],
    ['invalid expiry', { credential: { expires_at: 'bad' } }], ['malformed scope', { credential: { allowed_targets: [12] } }]]) {
    test(`credential ${name} rejects ingest and report`, async () => {
      const mock = await fixture(options);
      assert.equal((await mock.request({ action: 'ingest', snapshot: snapshot() })).status, 401);
      assert.equal((await mock.request({ action: 'report' })).status, 401);
      assert.equal(mock.publications.length, 0);
    });
  }
  test('key/method/content type rejected before any database call', async () => {
    const mock = await fixture();
    assert.equal((await mock.handler(new Request('https://offline.invalid'))).status, 405);
    assert.equal((await mock.request({}, { 'X-Config-Key': 'invalid' })).status, 401);
    assert.equal((await mock.request({}, { 'content-type': 'text/plain' })).status, 415);
    assert.equal(mock.calls.length, 0);
  });
  test('malformed JSON/UTF-8 and excessive real or declared body bytes fail without publication', async () => {
    const mock = await fixture();
    assert.equal((await mock.request('{')).status, 400);
    assert.equal((await mock.request(new Uint8Array([0xff]))).status, 400);
    assert.equal((await mock.request('[]')).status, 400);
    assert.equal((await mock.request(' '.repeat(2097153))).status, 413);
    assert.equal((await mock.request('{}', { 'content-length': '2097153' })).status, 413);
    assert.equal(mock.publications.length, 0);
  });
  test('whole request exactly 2 MiB accepted, extra one byte rejected', async () => {
    const body = JSON.stringify({ action: 'ingest', snapshot: snapshot() }), mock = await fixture();
    const exact = body + ' '.repeat(2097152 - Buffer.byteLength(body));
    assert.equal((await mock.request(exact)).status, 200);
    assert.equal((await mock.request(exact + ' ')).status, 413);
    assert.equal(mock.publications.length, 1);
  });
  for (const [name, change] of [['extra root', s => { s.secret = 'SECRET_PAYLOAD'; }], ['extra setting', s => { s.configuration.settings['0'].operator = 'SECRET_PAYLOAD'; }],
    ['wrong version', s => { s.schema_version = 2; }], ['invalid local date', s => { s.observed_local_date = '2026-09-11'; }],
    ['invalid snapshot id', s => { s.snapshot_id = 'not-uuid'; }], ['pre-2020', s => { s.observed_at = '2019-09-10T08:00:00Z'; s.observed_local_date = '2019-09-10'; }]]) {
    test(`strict configuration ${name} rejects with fixed error`, async () => {
      const value = snapshot(); change(value); const mock = await fixture();
      const result = await mock.request({ action: 'ingest', snapshot: value });
      assert.equal(result.status, 422); assert.equal((await result.text()).includes('SECRET_PAYLOAD'), false);
      assert.equal(mock.publications.length, 0);
    });
  }
  for (const [name, options, mutate] of [
    ['credential scope', { credential: { allowed_targets: ['VN:98VV'] } }, () => {}],
    ['missing target', { noTarget: true }, () => {}], ['target parent', { target: { site_code: '99999' } }, () => {}],
    ['target timezone', { target: { timezone: 'UTC' } }, () => {}],
    ['missing member', {}, s => { delete s.configuration.settings['8311']; }],
    ['unregistered member', {}, s => { s.configuration.settings['99999'] = structuredClone(s.configuration.settings['0']); }],
  ]) test(`scope ${name} rejects without RPC`, async () => {
    const value = snapshot(); mutate(value); const mock = await fixture(options);
    assert.equal((await mock.request({ action: 'ingest', snapshot: value })).status, 403);
    assert.equal(mock.publications.length, 0);
  });
  test('report scopes metadata only and never returns another login group', async () => {
    const mock = await fixture();
    const result = await mock.request({ action: 'report' });
    assert.equal(result.status, 200); const body = await result.json();
    assert.equal(body.snapshots.length, 1); assert.equal(body.snapshots[0].platform, '26BET');
    assert.deepEqual((await (await mock.request({ action: 'report', platforms: ['98VV'] })).json()).snapshots, []);
    assert.equal((await mock.request({ action: 'report', extra: 'bad' })).status, 400);
    assert.equal(mock.publications.length, 0);
  });
  for (const status of ['accepted', 'unchanged', 'daily_exists']) test(`valid ${status} receipt binds requested identity`, async () => {
    const value = snapshot(), mock = await fixture({ ack: { status, snapshot_id: value.snapshot_id,
      current_snapshot_id: status === 'daily_exists' ? '00000000-0000-4000-8000-000000000002' : value.snapshot_id } });
    assert.equal((await mock.request({ action: 'ingest', snapshot: value })).status, 200);
  });
  for (const ack of [null, {}, { status: 'accepted', snapshot_id: snapshot().snapshot_id, current_snapshot_id: '00000000-0000-4000-8000-000000000002' },
    { status: 'unchanged', snapshot_id: snapshot().snapshot_id, current_snapshot_id: '00000000-0000-4000-8000-000000000002' },
    { status: 'accepted', snapshot_id: 'wrong', current_snapshot_id: snapshot().snapshot_id },
    { status: 'daily_exists', snapshot_id: snapshot().snapshot_id, current_snapshot_id: 'invalid' }]) test(`bad ACK ${JSON.stringify(ack)} rejects`, async () => {
    const mock = await fixture({ ack: ack === null ? { status: null } : ack });
    assert.equal((await mock.request({ action: 'ingest', snapshot: snapshot() })).status, 503);
  });
  for (const [error, status] of [['wg_config_unauthorized', 401], ['wg_config_snapshot_id_conflict', 409], ['SECRET_UNKNOWN_ERROR', 503]]) test(`RPC error ${status} safely returned`, async () => {
    const mock = await fixture({ rpcError: error }), result = await mock.request({ action: 'ingest', snapshot: snapshot() });
    assert.equal(result.status, status); assert.equal((await result.text()).includes('SECRET'), false);
  });
  test('unhandled network error contains no raw exception', async () => {
    const mock = await fixture({ fetchError: true }), result = await mock.request({ action: 'report' });
    assert.equal(result.status, 503); assert.equal((await result.text()).includes('SECRET'), false);
  });
}
