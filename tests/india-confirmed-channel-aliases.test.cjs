// Public synthetic fixtures only. No source requests, fee writes or private data.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadTs, root } = require('./load-typescript.cjs');
const names = loadTs(path.join(root, 'src/lib/thirdPartyNameMap.ts'));
const volume = loadTs(path.join(root, 'src/lib/parseThirdPartyVolume.ts'));
const aliases = [
  ['Starpay', 'VstarPay'], ['StarPay', 'VstarPay'], ['QR-RsPay', 'RsPay'],
  ['FancyPayINR-PaytmQR', 'FancyPay'], ['Super-APPPay', 'SUPER'],
  ['QR-WPay', 'WPay'], ['PAYTM-RAPay', 'RAPay'], ['IC2PayINR-PaytmQR', 'ICPay'],
  ['NewWinPay2', 'NewWinPay'],
  ['ArbPay2INR-BANK', 'UPI-QR'], ['ArbPay2INR-UPI', 'UPI-QR'],
];

test('confirmed aliases use existing canonical names only in exact India contexts', () => {
  for (const country of ['印度', '印度线下', '印度盘口', '印度线下盘口', 'IN', 'in', 'India', ' INDIA '])
    for (const [input, expected] of aliases) {
      assert.equal(names.confirmedIndiaThirdPartyAlias(input, country), expected, `${country}/${input}`);
      assert.equal(names.canonicalThirdPartyName(input, country), expected, `${country}/${input}`);
    }
});

test('confirmed matching tolerates case and boundary spaces without broad punctuation removal', () => {
  for (const [input, expected] of aliases) {
    assert.equal(names.confirmedIndiaThirdPartyAlias(`  ${input.toUpperCase()}  `, '印度'), expected);
    assert.equal(names.canonicalThirdPartyName(`  ${input.toLowerCase()}  `, '印度'), expected);
  }
  for (const value of ['QR_RsPay', 'QRRsPay', 'QR RsPay', 'FancyPayINR_PaytmQR', 'ArbPay2INR_BANK', 'St arpay'])
    assert.equal(names.confirmedIndiaThirdPartyAlias(value, '印度'), '', value);
});

test('PAYTM-RAPay accepts dash typography and surrounding spaces, keeping exact provider scope', () => {
  for (const dash of ['-', '‐', '‑', '‒', '–', '—', '﹘', '﹣', '－']) {
    for (const input of [`PAYTM${dash}RAPay`, ` paytm ${dash} RAPAY `, `PAYTM${dash}\u00a0RAPay`]) {
      for (const country of ['印度', '印度线下', 'IN', 'India']) {
        assert.equal(names.confirmedIndiaThirdPartyAlias(input, country), 'RAPay', `${country}/${input}`);
        assert.equal(names.canonicalThirdPartyName(input, country), 'RAPay', `${country}/${input}`);
      }
      for (const country of [undefined, '印尼', '印度尼西亚', '越南', '巴西'])
        assert.equal(names.confirmedIndiaThirdPartyName(input, country), '', `${country}/${input}`);
    }
  }
  for (const input of ['PAYTMRAPay', 'PAYTM RAPay', 'PAYTM_RAPay', 'PAYTM/RAPay', 'PAYTM--RAPay', 'PAYTM-RAPay2'])
    assert.equal(names.confirmedIndiaThirdPartyName(input, '印度'), '', input);
});

test('confirmed provider names keep canonical casing when read from historical snapshots', () => {
  for (const country of ['印度', '印度线下', 'IN', 'India'])
    for (const [input, expected] of [['rapay', 'RAPay'], ['RAPAY', 'RAPay'], ['NewWinPay', 'NewWinPay'], ['NEWWINPAY2', 'NewWinPay']]) {
      assert.equal(names.confirmedIndiaThirdPartyName(input, country), expected);
      assert.equal(names.canonicalThirdPartyName(input, country), expected);
      assert.equal(names.canonicalThirdPartyName(expected, country), expected);
    }
});

test('the scoped helper never recognizes new aliases outside India', () => {
  for (const country of [undefined, '', '印尼', '印度尼西亚', 'Indonesia', 'ID', '越南', 'VN', '巴西', '尼日利亚', 'IN-extra', '印度2'])
    for (const [input] of aliases) assert.equal(names.confirmedIndiaThirdPartyAlias(input, country), '', `${country}/${input}`);
});

test('other countries keep their StarPay provider and existing WPay country alias', () => {
  for (const country of ['印尼', '越南', '巴西'])
    assert.equal(names.canonicalThirdPartyName('StarPay', country), 'StarPay');
  assert.equal(names.canonicalThirdPartyName('WPay', '尼日利亚'), 'WanguPay');
  assert.equal(names.canonicalThirdPartyName('QR-RsPay', '印尼'), 'QR-RsPay');
  assert.equal(names.canonicalThirdPartyName('ArbPay2INR-BANK', '印尼'), 'ArbPay2INR-BANK');
});

test('only the confirmed NewWinPay2 version merges; other unconfirmed names remain independent', () => {
  for (const value of ['NewWinPay3', 'NewWinPay', 'Starpay2', 'QR-RsPay2', 'FancyPay2INR-PaytmQR',
    'IC3PayINR-PaytmQR', 'ArbPay3INR-BANK', 'ArbPay2INR-BANK2', 'ArbPay2INR-UPI2', 'ArbPayINR-BANK'])
    assert.equal(names.confirmedIndiaThirdPartyAlias(value, '印度'), '', value);
  assert.equal(names.canonicalThirdPartyName('NewWinPay2', '印度'), 'NewWinPay');
  assert.notEqual(names.canonicalThirdPartyName('NewWinPay3', '印度'), names.canonicalThirdPartyName('NewWinPay', '印度'));
  for (const country of ['印尼', '越南', '巴西'])
    assert.equal(names.canonicalThirdPartyName('NewWinPay2', country), 'NewWinPay2');
});

test('canonical aliases are idempotent and preserve existing SUPER rate-join identity', () => {
  for (const [, canonical] of aliases)
    assert.equal(names.canonicalThirdPartyName(canonical, '印度'), canonical);
  for (const input of ['Super', 'Superpay', 'SuperPay', 'SUPER', 'Super-QR', 'PAYTM-Super'])
    assert.equal(names.canonicalThirdPartyName(input, '印度'), 'SUPER');
});

test('both explicitly confirmed ArbPay2 BANK and UPI aliases are UPI, not bank-card channels', () => {
  for (const country of ['印度', '印度线下', 'IN', 'India'])
    for (const input of ['ArbPay2INR-BANK', 'ArbPay2INR-UPI', '  ARBPAY2INR-BANK  '])
      assert.equal(names.inferThirdPartyChannelType(input, country, 'BANK 银行卡'), 'UPI');
  assert.equal(names.inferThirdPartyChannelType('ArbPayINR-BANK', '印度'), '银行卡');
  assert.equal(names.inferThirdPartyChannelType('ArbPay3INR-BANK', '印度'), '银行卡');
  assert.equal(names.inferThirdPartyChannelType('BankTransfer', '印度'), '银行卡');
});

test('existing ARB aliases, actual UpiPay and independent ArbPay remain distinct as before', () => {
  for (const input of ['ARB-UPI', 'ARB-BANK', 'UPI-QR']) {
    assert.equal(names.canonicalThirdPartyName(input, '印度'), 'UPI-QR');
    assert.equal(names.inferThirdPartyChannelType(input, '印度'), 'UPI');
  }
  assert.equal(names.canonicalThirdPartyName('UpiPay', '印度'), 'UpiPay');
  assert.equal(names.canonicalThirdPartyName('ArbPay', '印度'), 'ArbPay');
  assert.equal(names.canonicalThirdPartyName('ArbPayINR', '印度'), 'ArbPay');
  assert.equal(names.inferThirdPartyChannelType('TRC20', '印度'), 'USDT');
});

function row(index, channel, channelType, extra = {}) {
  return { id: `synthetic-${index}`, sheetName: 'synthetic', sourceRow: index + 2,
    date: '2026-09-13', country: '印度', platform: 'SYNTHETIC', channel, rawChannel: channel,
    channelType, direction: '代收', amount: index * 100.25, count: index + 2,
    successCount: index + 1, failedCount: 1, successRate: (index + 1) / (index + 2), status: '', ...extra };
}
function payload(rows) {
  return { meta: { year: '2026', month: '9', source: 'synthetic', updatedAt: '2026-09-13', sheets: ['synthetic'] },
    rows, aliasMap: {}, summary: {}, anomalies: [] };
}
function sum(rows, key) { return rows.reduce((total, item) => total + item[key], 0); }

test('actual payload grouping preserves explicit UPI versus PaytmQR categories and source numbers', () => {
  const input = payload([
    row(1, 'FancyPayINR-PaytmQR', 'PaytmQR'), row(2, 'FancyPay', 'UPI'),
    row(3, 'FancyPayINR-PaytmQR', 'PaytmQR', { direction: '代付' }),
    row(4, 'FancyPayINR-PaytmQR', 'PaytmQR', { date: '2026-09-12' }),
    row(5, 'FancyPayINR-PaytmQR', 'PaytmQR', { country: '越南' }),
  ]);
  const before = structuredClone(input), output = volume.normalizeThirdPartyVolumePayload(input);
  assert.deepEqual(input, before);
  assert.equal(output.rows.length, input.rows.length);
  for (const metric of ['amount', 'count', 'successCount', 'failedCount'])
    assert.equal(sum(output.rows, metric), sum(input.rows, metric));
  for (const original of input.rows) {
    const actual = output.rows.find(item => item.sourceRow === original.sourceRow);
    assert.ok(actual);
    for (const key of ['country', 'date', 'platform', 'direction', 'channelType', 'amount', 'count', 'successCount', 'failedCount'])
      assert.equal(actual[key], original[key], key);
    assert.equal(actual.channel, original.country === '印度' ? 'FancyPay' : original.channel);
  }
});

test('actual grouping merges equivalent spellings once without merging different providers or types', () => {
  const input = payload([
    row(1, 'StarPay', 'UPI'), row(2, 'VstarPay', 'UPI'),
    row(3, 'NewWinPay2', 'UPI'), row(4, 'NewWinPay', 'UPI'),
    row(5, 'StarPay', 'PaytmQR'), row(6, 'StarPay', 'UPI', { country: '印尼' }),
    row(7, 'NewWinPay3', 'UPI'),
  ]);
  const before = structuredClone(input), output = volume.normalizeThirdPartyVolumePayload(input);
  assert.equal(output.rows.length, 5);
  const combined = output.rows.find(item => item.country === '印度' && item.channel === 'VstarPay' && item.channelType === 'UPI');
  assert.equal(combined.amount, input.rows[0].amount + input.rows[1].amount);
  assert.equal(combined.count, input.rows[0].count + input.rows[1].count);
  assert.ok(!output.rows.some(item => item.channel === 'NewWinPay2'));
  const newWin = output.rows.find(item => item.channel === 'NewWinPay');
  assert.ok(newWin); assert.equal(newWin.amount, input.rows[2].amount + input.rows[3].amount);
  assert.equal(newWin.count, input.rows[2].count + input.rows[3].count);
  assert.ok(output.rows.some(item => item.channel === 'NewWinPay3'));
  assert.ok(output.rows.some(item => item.country === '印尼' && item.channel === 'StarPay'));
  for (const metric of ['amount', 'count', 'successCount', 'failedCount'])
    assert.equal(sum(output.rows, metric), sum(input.rows, metric));
  assert.deepEqual(input, before);
});

test('actual source-sheet parser uses ArbPay2 UPI classification without changing source totals', () => {
  const values = [['日期', '国家', '平台', '系统', '类型', '三方', '金额', 'total_count'],
    ['2026-09-13', '印度', 'SYNTHETIC', 'SYNTHETIC', '代付', 'ArbPay2INR-BANK', '100.5', '3'],
    ['2026-09-13', '印度', 'SYNTHETIC', 'SYNTHETIC', '代付', 'ArbPay2INR-UPI', '200.5', '4'],
    ['2026-09-13', '印度', 'SYNTHETIC', 'SYNTHETIC', '代付', 'ArbPayINR-BANK', '300.5', '5']];
  const before = structuredClone(values), output = volume.buildThirdPartyVolumePayload({ synthetic: values });
  const combined = output.rows.find(item => item.channel === 'UPI-QR');
  assert.ok(combined); assert.equal(combined.channelType, 'UPI');
  assert.equal(combined.amount, 301); assert.equal(combined.count, 7);
  assert.equal(output.summary.amount, 601.5); assert.equal(output.summary.count, 12);
  assert.deepEqual(values, before);
});

test('cached raw aliases repair old names and Arb BANK types without changing other saved classifications', () => {
  const input = payload([
    row(1, 'ArbPay2', '银行卡', { rawChannel: 'ArbPay2INR-BANK' }),
    row(2, 'ArbPay2', 'UPI', { rawChannel: 'ArbPay2INR-UPI' }),
    row(3, 'StarPay', 'UPI', { rawChannel: 'StarPay' }),
    row(4, 'OldFancy', 'PaytmQR', { rawChannel: 'FancyPayINR-PaytmQR' }),
    row(5, 'NewWinPay2', 'UPI', { rawChannel: 'NewWinPay2' }),
    row(6, 'ArbPay2', '银行卡', { rawChannel: 'ArbPay2INR-BANK', country: '印尼' }),
    row(7, 'SyntheticPay', 'UPI', { rawChannel: 'SyntheticPay-QR' }),
    row(8, '人工确认', '人工确认', { rawChannel: 'ArbPay2INR-BANK' }),
  ]);
  const before = structuredClone(input), output = volume.normalizeThirdPartyVolumePayload(input);
  assert.deepEqual(input, before);
  const arb = output.rows.find(r => r.country === '印度' && r.channel === 'UPI-QR');
  assert.equal(arb.channelType, 'UPI');
  assert.equal(arb.amount, input.rows[0].amount + input.rows[1].amount);
  assert.equal(arb.count, input.rows[0].count + input.rows[1].count);
  assert.ok(output.rows.some(r => r.channel === 'VstarPay'));
  assert.ok(output.rows.some(r => r.channel === 'FancyPay' && r.channelType === 'PaytmQR'));
  assert.ok(output.rows.some(r => r.channel === 'NewWinPay'));
  assert.ok(output.rows.some(r => r.country === '印尼' && r.channel === 'ArbPay2' && r.channelType === '银行卡'));
  assert.ok(output.rows.some(r => r.channel === 'SyntheticPay'));
  assert.ok(output.rows.some(r => r.channel === '人工确认' && r.channelType === '人工确认'));
  for (const metric of ['amount', 'count', 'successCount', 'failedCount'])
    assert.equal(sum(output.rows, metric), sum(input.rows, metric));
  assert.deepEqual(volume.normalizeThirdPartyVolumePayload(output).rows, output.rows);
});
