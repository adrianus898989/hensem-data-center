const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const fs = require('node:fs');
const { loadTs, root } = require('./load-typescript.cjs');
const lib = loadTs(path.join(root, 'src/lib/collectionSuccess.ts'));
const key = (name = 'WPay', country = '印度') => lib.collectionSuccessProviderKey(country, name);
const group = (name, submitted, success, type = 'UPI') => ({ raw_channel: name, channel_type: type, submitted_count: submitted, success_count: success });
function snapshot(platform = '91CLUB', date = '2026-09-13', groups = [group('WPay', 100, 80)], extra = {}) {
  const submitted = groups.reduce((n, g) => n + g.submitted_count, 0);
  return { schema_version: 1, source_system: 'RECHARGE_REVIEW', country_code: 'IN', platform, stat_date: date, timezone: 'Asia/Kolkata',
    snapshot_id: '00000000-0000-4000-8000-000000000001', snapshot_at: `${date}T20:00:00Z`,
    coverage: { complete: true, expected_count: submitted, fetched_count: submitted, unique_count: submitted },
    totals: { submitted_count: submitted, success_count: groups.reduce((n, g) => n + g.success_count, 0) }, groups, ...extra };
}
function volume(platform = '91CLUB', channel = 'WPay', date = '2026-09-13', country = '印度') {
  return { id: `${country}:${platform}:${channel}:${date}`, sheetName: 'synthetic', sourceRow: 1, date, country, platform,
    channel, rawChannel: channel, channelType: 'UPI', direction: '代收', amount: 9000000, count: 276521,
    successCount: 276521, failedCount: 0, successRate: 1, status: '' };
}
function view(snapshots = [], extra = {}) {
  return lib.buildCollectionSuccessView({ snapshots, volumeRows: [volume()], start: '2026-09-13', end: '2026-09-13', country: '印度', ...extra });
}

test('denominator comes only from submission snapshots, never original volume count/default success', () => {
  const input = [volume()];
  const before = JSON.stringify(input);
  const result = view([snapshot()], { volumeRows: input }).compare([key()]);
  assert.equal(result.current.submitted, 100);
  assert.equal(result.current.success, 80);
  assert.equal(result.current.rate, 0.8);
  assert.equal(JSON.stringify(input), before);
});

test('aggregate is weighted sum successes / sum submissions, not average of percentages', () => {
  const result = view([snapshot('91CLUB'), snapshot('55CLUB', undefined, [group('WPay', 900, 90)])], { volumeRows: [volume(), volume('55CLUB')] }).compare([key()]);
  assert.equal(result.current.submitted, 1000);
  assert.equal(result.current.success, 170);
  assert.equal(result.current.rate, 0.17);
});

test('daily delta uses percentage points and the preceding submission day', () => {
  const result = view([snapshot(), snapshot('91CLUB', '2026-09-12', [group('WPay', 200, 150)])]).compare([key()]);
  assert.ok(Math.abs(result.deltaPoints - 5) < 1e-9);
  assert.equal(result.comparisonLabel, '较昨日');
});

test('multi-day query compares equal-length preceding period, sums counts first', () => {
  const snapshots = ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'].map((date, i) => snapshot('91CLUB', date, [group('WPay', 100, i < 2 ? 70 : 80)]));
  const result = view(snapshots, { start: '2026-09-12' }).compare([key()]);
  assert.equal(result.comparisonLabel, '较上期');
  assert.equal(result.current.submitted, 200);
  assert.equal(result.previous.submitted, 200);
  assert.ok(Math.abs(result.deltaPoints - 10) < 1e-9);
  assert.equal(lib.collectionSuccessPeriod('2026-09-12', '2026-09-13').previousStart, '2026-09-10');
});

test('missing platform-days fail closed; captured platform detail remains visible', () => {
  const result = view([snapshot()], { volumeRows: [volume(), volume('DHANIWIN')] }).compare([key()]);
  assert.equal(result.current.state, 'partial');
  assert.equal(result.current.rate, null);
  assert.equal(result.current.expected, 2);
  assert.equal(result.current.captured, 1);
  assert.equal(result.platforms.find(p => p.platform === '91CLUB').current.rate, 0.8);
  assert.equal(result.platforms.find(p => p.platform === 'DHANIWIN').current.state, 'missing');
});

test('a platform with no scoped volume on the queried day is not falsely marked uncollected', () => {
  const result = view([snapshot()], {
    volumeRows: [volume(), volume('DHANIWIN', 'WPay', '2026-09-12')],
  }).compare([key()]);
  assert.equal(result.current.state, 'complete');
  assert.equal(result.current.expected, 1);
  assert.equal(result.current.captured, 1);
  assert.equal(result.current.rate, 0.8);
});

test('explicit platform filter removes out-of-scope denominator and missing-platform coverage', () => {
  const result = view([snapshot()], { volumeRows: [volume(), volume('DHANIWIN')], platforms: ['91CLUB'] }).compare([key()]);
  assert.equal(result.current.rate, 0.8);
  assert.equal(result.current.expected, 1);
});

test('selected platform without any volume/snapshot is missing, not zero submissions', () => {
  const result = view([], { volumeRows: [], platforms: ['91CLUB'] }).compare([key()]);
  assert.equal(result.current.state, 'missing');
  assert.equal(result.current.expected, 1);
  assert.equal(result.current.rate, null);
});

test('complete empty day is no submissions; non-empty failed-only day is exactly 0%', () => {
  const empty = view([snapshot('91CLUB', undefined, [])]).compare([key()]);
  assert.equal(empty.current.state, 'zero');
  assert.equal(empty.current.rate, null);
  const failed = view([snapshot('91CLUB', undefined, [group('WPay', 30, 0)])]).compare([key()]);
  assert.equal(failed.current.state, 'complete');
  assert.equal(failed.current.rate, 0);
});

test('failed-only providers absent from original volumes are included in providers and totals', () => {
  const data = view([snapshot('91CLUB', undefined, [group('NewOnlyPay', 30, 0), group('WPay', 100, 80)])]);
  assert.deepEqual(data.providers.map(p => p.channel).sort(), ['NewOnlyPay', 'WPay']);
  assert.equal(data.compare().current.submitted, 130);
  assert.equal(data.compare([key('NewOnlyPay')]).current.rate, 0);
});

test('latest complete snapshot replaces prior snapshot, never double-counts it', () => {
  const newer = snapshot('91CLUB', undefined, [group('WPay', 100, 90)], { snapshot_at: '2026-09-14T01:00:00Z' });
  const result = view([newer, snapshot()]).compare([key()]);
  assert.equal(result.current.submitted, 100);
  assert.equal(result.current.success, 90);
});

test('country aliases and platform case/verified SHREE.WIN alias match only their scope', () => {
  const result = view([snapshot('SHREEWIN'), snapshot('Veer.Game')], { volumeRows: [volume('SHREE.WIN'), volume('VEER.GAME')] }).compare([key()]);
  assert.equal(result.current.expected, 2);
  assert.equal(result.current.captured, 2);
  assert.equal(result.current.rate, 0.8);
  assert.equal(lib.collectionSuccessCountry('BR', '776F'), '胖虎巴西');
  assert.equal(lib.collectionSuccessCountry('BR', 'POPBRA'), '巴西');
});

test('Brazil display scopes remain distinct and can never borrow snapshots', () => {
  const data = view([snapshot('776F', undefined, [group('WPay', 100, 70)], { country_code: 'BR' }), snapshot('POPBRA', undefined, [group('WPay', 900, 900)], { country_code: 'BR' })], { country: '胖虎巴西', volumeRows: [volume('776F', 'WPay', undefined, '胖虎巴西')] });
  assert.equal(data.compare().current.submitted, 100);
  assert.equal(data.compare().current.rate, 0.7);
});

test('confirmed India provider aliases merge counts without deleting type-specific groups', () => {
  const data = view([snapshot('91CLUB', undefined, [group('PAYTM– RAPay', 100, 50, 'PaytmQR'), group('RAPay', 200, 180), group('NewWinPay2', 50, 20), group('NewWinPay', 50, 40)])]);
  assert.equal(data.compare([key('RAPay')]).current.submitted, 300);
  assert.equal(data.compare([key('RAPay')]).current.success, 230);
  assert.equal(data.compare([key('RAPay')], ['PaytmQR']).current.rate, 0.5);
  assert.equal(data.compare([key('RAPay')], ['UPI']).current.rate, 0.9);
  assert.equal(data.compare([key('NewWinPay')]).current.rate, 0.6);
  assert.equal(data.providers.length, 2);
});

test('NewWinPay3 and non-India NewWinPay2 do not merge', () => {
  const data = view([snapshot('91CLUB', undefined, [group('NewWinPay', 100, 90), group('NewWinPay3', 100, 10)])]);
  assert.equal(data.providers.length, 2);
  assert.equal(data.compare([key('NewWinPay')]).current.rate, 0.9);
  assert.notEqual(key('NewWinPay2', '越南'), key('NewWinPay', '越南'));
});

test('unknown type counts are included in all-types but cannot bias a typed rate', () => {
  const snapshots = [snapshot('91CLUB', undefined, [group('WPay', 100, 80), group('WPay', 300, 30, 'UNKNOWN')])];
  assert.equal(view(snapshots).compare([key()]).current.rate, 0.275);
  const result = view(snapshots).compare([key()], ['UPI']);
  assert.equal(result.current.state, 'partial');
  assert.equal(result.current.unknownType, true);
  assert.equal(result.current.rate, null);
  assert.equal(view(snapshots, { types: ['UPI'] }).compare([key()]).current.rate, null);
});

test('unknown type for another provider does not contaminate an exact provider filter', () => {
  const data = view([snapshot('91CLUB', undefined, [group('WPay', 100, 80), group('OtherPay', 300, 30, 'UNKNOWN')])]);
  assert.equal(data.compare([key()], ['UPI']).current.rate, 0.8);
});

test('explicitly selecting UNKNOWN remains a valid exact bucket', () => {
  const data = view([snapshot('91CLUB', undefined, [group('WPay', 100, 80), group('WPay', 300, 30, 'UNKNOWN')])]);
  assert.equal(data.compare([key()], ['UNKNOWN']).current.rate, 0.1);
});

test('confirmed ARB bank suffix stays in India UPI-QR type, not Bank', () => {
  const data = view([snapshot('91CLUB', undefined, [group('ArbPay2INR-BANK', 100, 80, 'BANK'), group('ArbPay2INR-UPI', 100, 60)])]);
  assert.equal(data.compare([key('UPI-QR')], ['UPI']).current.rate, 0.7);
  assert.equal(lib.collectionSuccessType('印度', 'ARB-BANK', 'BANK'), 'UPI');
  assert.equal(lib.collectionSuccessType('越南', 'ARB-BANK', 'BANK'), '银行卡');
});

test('collector wallet labels normalize to the existing country buckets', () => {
  assert.equal(lib.collectionSuccessType('巴基斯坦', 'PkPayPKR-EASYPAISA', 'Easypaisa'), 'EASYPAISA');
  assert.equal(lib.collectionSuccessType('巴基斯坦', 'PkPayPKR-JAZZCASH', 'JazzCash'), 'JAZZCASH');
  assert.equal(lib.collectionSuccessType('印尼', 'KILIPAY', 'Bank'), '银行代付');
  assert.equal(lib.collectionSuccessType('印尼', 'KILIPAY', 'E-Wallet'), '钱包代付');
  assert.equal(lib.collectionSuccessType('印度', 'KILIPAY', 'Bank'), '银行卡');
});

test('calendar rollover and invalid query periods fail closed', () => {
  assert.equal(lib.collectionSuccessPeriod('2026-02-31', '2026-03-03'), null);
  assert.equal(lib.collectionSuccessPeriod('2026-09-14', '2026-09-13'), null);
  assert.equal(lib.validCollectionSuccessSnapshot(snapshot('91CLUB', '2026-02-31')), false);
});

test('missing yesterday never shows invented zero or a delta', () => {
  const result = view([snapshot()]).compare([key()]);
  assert.equal(result.current.rate, 0.8);
  assert.equal(result.previous.state, 'missing');
  assert.equal(result.previous.rate, null);
  assert.equal(result.deltaPoints, null);
});

test('success read error or payout-only filter leaves rates unavailable and volumes untouched', () => {
  assert.equal(view([snapshot()], { error: 'temporarily unavailable' }).compare().current.state, 'unavailable');
  assert.equal(view([snapshot()], { enabled: false }).compare().current.rate, null);
  assert.equal(view([]).compare().current.rate, null);
});

test('partial or inconsistent snapshots cannot be displayed as complete', () => {
  const valid = snapshot();
  for (const bad of [
    { ...valid, coverage: { ...valid.coverage, complete: false } },
    { ...valid, coverage: { ...valid.coverage, complete: 'true' } },
    { ...valid, coverage: { ...valid.coverage, expected_count: 101 } },
    { ...valid, coverage: { ...valid.coverage, fetched_count: 101 } },
    { ...valid, groups: [group('WPay', 100, 101)] },
    { ...valid, totals: { submitted_count: 100, success_count: 79 } },
    { ...valid, groups: [group('WPay', 50, 40), group('WPay', 50, 40)] },
    { ...valid, platform: null }, { ...valid, stat_date: 123 }, { ...valid, snapshot_at: 'invalid' },
    { ...valid, groups: [null] }, { ...valid, groups: [group(123, 100, 80)] },
  ]) {
    assert.equal(lib.validCollectionSuccessSnapshot(bad), false);
    assert.doesNotThrow(() => view([bad]).compare());
    assert.equal(view([bad]).compare().current.rate, null);
  }
});

test('provider and country filters prevent unrelated denominator aggregation', () => {
  const data = view([snapshot('91CLUB', undefined, [group('WPay', 100, 80), group('RAPay', 200, 40)]), snapshot('VN1', undefined, [group('WPay', 400, 20)], { country_code: 'VN' })], { provider: 'RAPay' });
  assert.equal(data.compare().current.submitted, 200);
  assert.deepEqual(data.providers.map(p => p.channel), ['RAPay']);
});

test('page subtotal deduplicates provider keys and still uses complete weighted counts', () => {
  const data = view([snapshot('91CLUB', undefined, [group('WPay', 100, 80), group('RAPay', 300, 60)])]);
  assert.equal(data.compare([key(), key()]).current.submitted, 100);
  assert.equal(data.compare([key(), key('RAPay')]).current.rate, 0.35);
});

test('new API read uses same JWT, additive failure and bounded timeout without touching volume RPC', () => {
  const source = fs.readFileSync(path.join(root, 'src/lib/supabaseDashboardServer.ts'), 'utf8');
  assert.match(source, /"dashboard_collection_success"[\s\S]*p_start: successPeriod.previousStart[\s\S]*token, AbortSignal.timeout\(6000\)/);
  assert.match(source, /collectionSuccessSnapshots: collectionSuccess.snapshots/);
  assert.match(source, /dashboardScopeAllows\(access.scope, collectionSuccessCountry/);
  assert.match(source, /"dashboard_third_party_volume_fast_v2", \{\s*p_start: start,\s*p_end: end/);
  assert.doesNotMatch(source, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
});
