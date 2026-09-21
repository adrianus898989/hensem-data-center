const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const { root, loadTs } = require('./load-typescript.cjs');

// Load the actual production fee functions, without mounting the dashboard,
// executing React effects, or accessing a network/account/browser cache.
const filename = path.join(root, 'src/components/ThirdPartyVolumeDashboard.tsx');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = source.statements.filter(node => ts.isFunctionDeclaration(node)
  && node.name?.text !== 'ThirdPartyVolumeDashboard');
const dependencies = {
  exports: {},
  SOUTH_AMERICA_RATE_COUNTRIES: ['墨西哥', '哥伦比亚', '智利'],
  ALL_USDT_COUNTRY_PAGE: '所有国家USDT',
  ...loadTs(path.join(root, 'src/lib/thirdPartyNameMap.ts')),
  ...loadTs(path.join(root, 'src/lib/thirdPartyPlatform.ts')),
  ...loadTs(path.join(root, 'src/lib/platformDisplayCountry.ts')),
  ...loadTs(path.join(root, 'src/lib/format.ts')),
};
const compiled = ts.transpileModule(functions.map(fn => fn.getText(source)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const api = Function('require', ...Object.keys(dependencies), compiled + `
  return { expandRateNameCandidates, buildRateMap, findMatchedRate,
    rateFor, singleFeeFor, estimateSideFee, rateHasSideFee, normalizeVolumeRowForDisplay, aggregateCombo,
    rateNameKey, rateCountriesCompatible, ratePayloadUsable, ratePayloadFresh,
    buildFeeCompareRows, summarizeFeeRows };
`)(require, ...Object.values(dependencies));

test('empty fee responses are never treated as a fresh usable cache', () => {
  const freshMeta = { updatedAt: new Date().toISOString() };
  assert.equal(api.ratePayloadUsable(null), false);
  assert.equal(api.ratePayloadUsable({ meta: freshMeta, rates: [] }), false);
  assert.equal(api.ratePayloadFresh({ meta: freshMeta, rates: [] }), false);
  assert.equal(api.ratePayloadUsable({ meta: freshMeta, rates: [{ id: 'rate-1' }] }), true);
  assert.equal(api.ratePayloadFresh({ meta: freshMeta, rates: [{ id: 'rate-1' }] }), true);
});

test('Pakistan daily summaries and PKR details retain calculated fees without changing totals', () => {
  const rates=[{id:'pk',country:'巴基斯坦',thirdParty:'TestPay',category:'EASYPAISA',collectFee:'2%',payoutFee:'1%',collectSingleFee:'',payoutSingleFee:''}];
  const base={date:'2026-09-20',country:'巴基斯坦',channel:'TestPay',rawChannel:'TestPay',channelType:'EASYPAISA'};
  const rows=[
    {...base,id:'time:detail',platform:'92GAME',currency:'PKR',direction:'代收',amount:1000,count:10},
    {...base,id:'daily',platform:'3PATTI-SUPER',direction:'代收',amount:500,count:5},
    {...base,id:'time:payout',platform:'92GAME',currency:'PKR',direction:'代付',amount:800,count:8},
    {...base,id:'daily:payout',platform:'3PATTI-SUPER',direction:'代付',amount:200,count:2}
  ];
  const before=structuredClone(rows);
  const grouped=api.aggregateCombo(rows,r=>[r.date,r.country,r.platform,r.channel,r.channelType]);
  const fees=api.buildFeeCompareRows(grouped,rates,[],'daily');
  const summary=api.summarizeFeeRows(fees);
  assert.equal(summary.collectFee,30);assert.equal(summary.payoutFee,10);
  assert.equal(summary.estimatedFee,40);assert.equal(summary.collectHasFee,true);assert.equal(summary.payoutHasFee,true);
  assert.deepEqual(rows,before);
  // A same-platform combination must use the identical currency contract.
  const merged=api.aggregateCombo(rows.map(r=>({...r,platform:'92GAME'})),r=>[r.date,r.country,r.platform,r.channel,r.channelType]);
  assert.equal(api.summarizeFeeRows(api.buildFeeCompareRows(merged,rates,[],'daily')).estimatedFee,40);
  // Explicit USDT is never silently converted to PKR.
  const mixed=api.aggregateCombo(rows.map((r,i)=>i===1?{...r,currency:'USDT'}:r),r=>[r.date,r.country,r.platform,r.channel,r.channelType]);
  assert.equal(Number.isNaN(api.summarizeFeeRows(api.buildFeeCompareRows(mixed,rates,[],'daily')).collectFee),true);
});

test('actual settlement columns and provider-only rows are restricted to EK/G66 teams',()=>{
  const {supportsWithdrawActualCountry:supported}=loadTs(path.join(root,'src/lib/withdrawActual.ts'));
  for(const country of ['香港','香港团队','HK_TEAM','红膏蟹','红膏蟹团队','RED_CRAB'])assert.equal(supported(country),true,country);
  for(const country of ['印度','巴基斯坦','PK','巴西','菲律宾','所有国家USDT',''])assert.equal(supported(country),false,country);
  const text=source.text;
  assert.match(text,/withdrawActual=\{supportsWithdrawActualCountry\(country\)\?withdrawActual:undefined\}/);
  assert.match(text,/if \(supportsWithdrawActualCountry\(appliedCountryPage\)\) appendProviderOnly\("actual-only"/);
});

const ARB2 = ['ArbPay2INR-BANK', 'ArbPay2INR-UPI'];
test('the live Supabase dashboard normalizes saved Arb2 types, not only the source parser', () => {
  const source = { country: '印度', platform: 'SYNTHETIC', direction: '代付', channel: 'ArbPay2', rawChannel: 'ArbPay2INR-BANK', channelType: '银行卡', amount: 123.4, count: 9 };
  const before = structuredClone(source), output = api.normalizeVolumeRowForDisplay(source);
  assert.equal(output.channel, 'UPI-QR'); assert.equal(output.channelType, 'UPI');
  assert.equal(output.amount, source.amount); assert.equal(output.count, source.count);
  assert.deepEqual(source, before);
  assert.equal(api.normalizeVolumeRowForDisplay({ ...source, country: '印尼' }).channelType, '银行卡');
  assert.equal(api.normalizeVolumeRowForDisplay({ ...source, channel: '人工确认' }).channel, '人工确认');
  assert.equal(api.normalizeVolumeRowForDisplay({ ...source, channel: '人工确认' }).channelType, '人工确认');
  for (const [rawChannel, name] of [['StarPay', 'VstarPay'], ['NewWinPay2', 'NewWinPay'], ['IC2PayINR-PaytmQR', 'ICPay']]) {
    const actual = api.normalizeVolumeRowForDisplay({ ...source, channel: rawChannel, rawChannel, channelType: 'PaytmQR' });
    assert.equal(actual.channel, name); assert.equal(actual.channelType, 'PaytmQR');
  }
});
function rate(thirdParty, category = 'UPI', extra = {}) {
  return {
    id: `synthetic-${thirdParty}-${category}`, country: '印度', sheetName: 'synthetic-fees',
    thirdParty, category, collectFee: '1.25%', payoutFee: '0.50%', totalFee: '1.75%',
    collectSingleFee: '0.10', payoutSingleFee: '0.20', collectLimit: '100–10000',
    payoutLimit: '200–20000', status: '开启', ...extra,
  };
}
function lookup(map, name, type = 'UPI', side = 'collect', country = '印度', platform = 'SYNTHETIC') {
  return api.findMatchedRate(map, country, platform, name, type, side);
}
function feeFields(row) {
  return Object.fromEntries(['collectFee', 'payoutFee', 'totalFee', 'collectSingleFee',
    'payoutSingleFee', 'collectLimit', 'payoutLimit', 'status'].map(key => [key, row[key]]));
}

test('confirmed Arb2 candidates never add independent ArbPay names', () => {
  for (const name of [...ARB2, '  ARBPAY2INR-BANK  ']) {
    const candidates = api.expandRateNameCandidates('印度', name);
    assert(candidates.includes('UPI-QR'), name);
    assert(!candidates.includes('ArbPay'), name);
    assert(!candidates.includes('ArbPayINR'), name);
  }
  const existing = api.expandRateNameCandidates('印度', 'ArbPay');
  assert(existing.includes('ArbPay'));
  assert(existing.includes('ArbPayINR'));
  assert(!existing.includes('UPI-QR'));
});

test('actual fee map does not leak an Arb2 fee into independent ArbPay', () => {
  for (const name of ARB2) for (const category of ['UPI', '银行卡']) {
    const original = rate(name, category), before = structuredClone(original);
    const map = api.buildRateMap([original]);
    assert.equal(lookup(map, name, category)?.id, original.id);
    assert.equal(lookup(map, 'UPI-QR', category)?.id, original.id);
    for (const independent of ['ArbPay', 'ArbPayINR']) {
      assert.equal(lookup(map, independent, category), undefined, `${name} must not supply ${independent}`);
    }
    for (const key of map.keys()) assert(!['arbpay', 'arbpayinr'].includes(key.split('|||')[2]), key);
    assert.deepEqual(original, before);
  }
});

test('actual fallback cannot borrow independent ArbPay for missing Arb2 or UPI-QR', () => {
  const original = rate('ArbPay', '银行卡'), map = api.buildRateMap([original]);
  assert.equal(lookup(map, 'ArbPayINR', '银行卡')?.id, original.id);
  for (const name of [...ARB2, 'UPI-QR']) {
    assert.equal(lookup(map, name, 'UPI'), undefined, name);
    assert.equal(lookup(map, name, '银行卡'), undefined, name);
  }
});

test('both providers retain their own fees regardless of source row order', () => {
  for (const name of ARB2) {
    const independent = rate('ArbPay', 'UPI', { id: 'independent-arb', collectFee: '7.50%' });
    const confirmed = rate(name, 'UPI', { id: 'confirmed-upi', collectFee: '1.50%' });
    for (const rows of [[independent, confirmed], [confirmed, independent]]) {
      const before = structuredClone(rows), map = api.buildRateMap(rows);
      for (const alias of ['ArbPay', 'ArbPayINR']) assert.equal(lookup(map, alias)?.collectFee, '7.50%');
      for (const alias of [name, 'UPI-QR']) assert.equal(lookup(map, alias)?.collectFee, '1.50%');
      assert.deepEqual(rows, before);
    }
  }
});

test('SUPER remains the shared internal rate key in both directions', () => {
  for (const sourceName of ['SUPER', 'SuperPay', 'Super-APPPay']) {
    const original = rate(sourceName, 'PaytmQR'), map = api.buildRateMap([original]);
    for (const queryName of ['SUPER', 'SuperPay', 'Super-APPPay']) {
      const result = lookup(map, queryName, 'PaytmQR');
      assert(result, `${sourceName} -> ${queryName}`);
      assert.deepEqual(feeFields(result), feeFields(original));
      assert.equal(result.thirdParty, sourceName, 'matching does not rewrite the source fee record');
    }
  }
});

test('confirmed NewWinPay2 joins NewWinPay while unconfirmed NewWinPay3 remains independent', () => {
  for (const sourceName of ['NewWinPay', 'NewWinPay2']) {
    const original = rate(sourceName), map = api.buildRateMap([original]);
    for (const alias of ['NewWinPay', 'NewWinPay2']) assert.equal(lookup(map, alias)?.id, original.id);
    assert.equal(lookup(map, 'NewWinPay3'), undefined);
  }
  const third = rate('NewWinPay3'), map = api.buildRateMap([third]);
  assert.equal(lookup(map, 'NewWinPay3')?.id, third.id);
  assert.equal(lookup(map, 'NewWinPay2'), undefined);
});

test('India QR provider rows and their canonical names use the same existing fee', () => {
  for (const [channel, provider] of [['3TPay-QR', '3TPay'], ['3cPay-QR', '3cPay']]) {
    const source = { country: '印度', platform: 'SYNTHETIC', direction: '代收', channel,
      rawChannel: channel, channelType: 'PaytmQR', amount: 123.45, count: 9 };
    const output = api.normalizeVolumeRowForDisplay(source);
    assert.equal(output.channel, provider);
    assert.equal(output.channelType, source.channelType);
    assert.equal(output.amount, source.amount);
    assert.equal(output.count, source.count);
    for (const sourceName of [provider, channel]) {
      const original = rate(sourceName, 'PaytmQR'), map = api.buildRateMap([original]);
      for (const queryName of [provider, channel])
        assert.equal(lookup(map, queryName, 'PaytmQR')?.id, original.id);
      assert.equal(lookup(map, `${provider}2-QR`, 'PaytmQR'), undefined);
    }
  }
});

test('PAYTM dash variants and RAPay join the existing rate in both directions without rewriting fees', () => {
  const aliases = ['RAPay', 'rapay', 'PAYTM-RAPay', 'PAYTM— RAPay', ' paytm - RAPAY '];
  for (const sourceName of aliases) {
    const original = rate(sourceName, 'PaytmQR'), before = structuredClone(original);
    const map = api.buildRateMap([original]);
    for (const queryName of aliases) for (const side of ['collect', 'payout']) {
      const matched = lookup(map, queryName, 'PaytmQR', side);
      assert.equal(matched?.id, original.id, `${sourceName} -> ${queryName}/${side}`);
      assert.deepEqual(feeFields(matched), feeFields(original));
    }
    for (const queryName of ['NewWinPay', 'PAYTM-RAPay2', 'NewWinPay3'])
      assert.equal(lookup(map, queryName, 'PaytmQR'), undefined, queryName);
    for (const country of ['印尼', '越南', '巴西'])
      assert.equal(lookup(map, 'PAYTM— RAPay', 'PaytmQR', 'collect', country), undefined);
    assert.deepEqual(original, before);
  }
});

function volumeRow(index, channel, rawChannel = channel, extra = {}) {
  return { id: `synthetic-volume-${index}`, sheetName: 'synthetic', sourceRow: index + 2,
    date: '2026-09-13', country: '印度', platform: 'SYNTHETIC', channel, rawChannel,
    channelType: 'PaytmQR', direction: '代收', amount: 100.25, count: 5,
    successCount: 4, failedCount: 1, successRate: 0.8, status: '',
    raw: { channel_canonical: channel, channel: rawChannel, channel_type: 'PaytmQR' }, ...extra };
}

test('live display repairs old canonical/raw names while retaining source fields and classifications', () => {
  // The API exposes the saved canonical value as channel and source text as
  // rawChannel; raw data may additionally retain its historical column names.
  const input = [
    volumeRow(1, 'PAYTM— RAPay'),
    volumeRow(2, 'RAPay', ''),
    volumeRow(3, 'rapay'),
    volumeRow(4, 'NewWinPay2', ''),
    volumeRow(5, 'NewWinPay', ''),
    volumeRow(6, 'old-name', 'newwinpay2'),
    volumeRow(7, 'old-name', 'PAYTM - RAPay'),
    volumeRow(8, 'NewWinPay3'),
    volumeRow(9, '人工确认', 'PAYTM— RAPay', { channelType: '人工确认' }),
    volumeRow(10, 'NewWinPay2', 'NewWinPay2', { country: '印尼', channelType: 'QRIS' }),
    volumeRow(11, 'PAYTM— RAPay', 'PAYTM— RAPay', { country: '越南', channelType: 'BANKQR' }),
  ];
  const before = structuredClone(input), output = input.map(api.normalizeVolumeRowForDisplay);
  assert.deepEqual(output.map(row => row.channel), [
    'RAPay', 'RAPay', 'RAPay', 'NewWinPay', 'NewWinPay', 'NewWinPay', 'RAPay',
    'NewWinPay3', '人工确认', 'NewWinPay2', 'PAYTM— RAPay',
  ]);
  for (let i = 0; i < input.length; i++) {
    assert.deepEqual(output[i], { ...input[i], channel: output[i].channel });
    assert.deepEqual(api.normalizeVolumeRowForDisplay(output[i]), output[i]);
  }
  assert.deepEqual(input, before);
});

test('a saved provider never overrides a different raw provider or an unconfirmed version', () => {
  for (const savedName of ['RAPay', 'NewWinPay', 'NewWinPay2']) {
    for (const rawChannel of ['ArbPay', 'NewWinPay3', 'PAYTM-RAPay2', 'UnknownProvider']) {
      const input = volumeRow(1, savedName, rawChannel), before = structuredClone(input);
      const output = api.normalizeVolumeRowForDisplay(input);
      assert.equal(output.channel, rawChannel, `${savedName}/${rawChannel}`);
      assert.deepEqual(output, { ...input, channel: rawChannel });
      assert.deepEqual(input, before);
    }
  }
});

test('live provider grouping sums every alias row even when amounts and counts are identical', () => {
  const input = [
    volumeRow(1, 'RAPay'), volumeRow(2, 'PAYTM— RAPay'),
    volumeRow(3, 'PAYTM-RAPay', 'PAYTM-RAPay', { successCount: 2, failedCount: 3, successRate: 0.4 }),
    volumeRow(4, 'PAYTM - RAPay', 'PAYTM - RAPay', { direction: '代付' }),
    volumeRow(5, 'NewWinPay'), volumeRow(6, 'NewWinPay2'),
    volumeRow(7, 'NewWinPay3'),
    volumeRow(8, 'NewWinPay2', 'NewWinPay2', { country: '印尼' }),
    volumeRow(9, 'PAYTM— RAPay', 'PAYTM— RAPay', { channelType: 'UPI' }),
    volumeRow(10, 'NewWinPay2', 'NewWinPay2', { date: '2026-09-12' }),
    volumeRow(11, 'NewWinPay2', 'NewWinPay2', { platform: 'OTHER' }),
  ];
  const before = structuredClone(input), normalized = input.map(api.normalizeVolumeRowForDisplay);
  const grouped = api.aggregateCombo(normalized, row => [row.date, row.country, row.platform, row.channel, row.channelType]);
  const rapay = grouped.find(row => row.labelParts[3] === 'RAPay' && row.labelParts[4] === 'PaytmQR');
  assert.equal(rapay.rows.length, 4);
  assert.equal(rapay.collectAmount, 300.75); assert.equal(rapay.collectCount, 15);
  assert.equal(rapay.payoutAmount, 100.25); assert.equal(rapay.payoutCount, 5);
  const collect = rapay.rows.filter(row => row.direction === '代收');
  assert.equal(collect.reduce((sum, row) => sum + row.successCount, 0), 10);
  assert.equal(collect.reduce((sum, row) => sum + row.failedCount, 0), 5);
  assert.equal(collect.reduce((sum, row) => sum + row.successCount, 0) / rapay.collectCount, 2 / 3);
  const newWin = grouped.find(row => row.labelParts.join('/') === '2026-09-13/印度/SYNTHETIC/NewWinPay/PaytmQR');
  assert.equal(newWin.rows.length, 2); assert.equal(newWin.totalAmount, 200.5); assert.equal(newWin.totalCount, 10);
  assert.equal(grouped.length, 7);
  assert.equal(grouped.flatMap(row => row.rows).length, input.length);
  for (const metric of ['amount', 'count', 'successCount', 'failedCount'])
    assert.equal(grouped.flatMap(row => row.rows).reduce((sum, row) => sum + row[metric], 0),
      input.reduce((sum, row) => sum + row[metric], 0), metric);
  assert.deepEqual(input, before);
});

test('India rate keys never supply another country with its confirmed aliases', () => {
  for (const [name, query] of [['SuperPay', 'Super-APPPay'], ['NewWinPay', 'NewWinPay2'], ['UPI-QR', 'ArbPay2INR-BANK']]) {
    const map = api.buildRateMap([rate(name)]);
    assert(lookup(map, query));
    for (const country of ['印尼', '越南', '巴西']) assert.equal(lookup(map, query, 'UPI', 'collect', country), undefined);
  }
});

test('GAME66 team providers only borrow confidently matched India fee rows', () => {
  const rush = rate('RushPay', 'UPI', { id: 'india-rush', collectFee: '4.50%', payoutFee: '3.00%' });
  const upiQr = rate('UPI-QR', 'UPI', { id: 'india-upi-qr', collectFee: '2.00%', payoutFee: '1.00%' });
  const vietnamFast = rate('FASTPay', 'BANKQR', { id: 'vietnam-fast', country: '越南' });
  const philippinesWin2 = rate('WIN2Pay', 'GCASH', { id: 'philippines-win2', country: '菲律宾' });
  const map = api.buildRateMap([rush, upiQr, vietnamFast, philippinesWin2]);

  for (const country of ['红膏蟹', '香港']) {
    assert(api.expandRateNameCandidates(country, 'ARUPI唤醒').includes('UPI-QR'));
    assert.equal(api.rateCountriesCompatible(country, '印度').ok, true);
    assert.equal(lookup(map, 'RushPay唤醒', '其他类型', 'collect', country, '66GAME')?.id, rush.id);
    assert.equal(lookup(map, 'ARUPI唤醒', '其他类型', 'collect', country, '66GAME')?.id, upiQr.id);
    for (const unmatched of ['LovePay唤醒', 'ICPay2唤醒', '999Pay唤醒', 'FastPay唤醒-新', 'Win2Pay唤醒', 'LkgoPay唤醒']) {
      assert.equal(lookup(map, unmatched, '其他类型', 'collect', country, '66GAME'), undefined, `${country}/${unmatched}`);
    }
  }

  // The allowance is one-way and cannot make an India row read a team-only rate.
  const teamOnly = rate('TeamOnlyPay', 'UPI', { id: 'team-only', country: '红膏蟹' });
  assert.equal(lookup(api.buildRateMap([teamOnly]), 'TeamOnlyPay'), undefined);
});

test('aliases do not change percent plus per-order fee formulas or original source values', () => {
  const original = rate('SUPER', 'PaytmQR'), before = structuredClone(original);
  const result = lookup(api.buildRateMap([original]), 'Super-APPPay', 'PaytmQR');
  assert.equal(api.rateFor(result, 'collect'), 0.0125);
  assert.equal(api.singleFeeFor(result, 'collect'), 0.10);
  assert.equal(api.estimateSideFee(1000, 20, api.rateFor(result, 'collect'), api.singleFeeFor(result, 'collect')), 14.5);
  assert.equal(api.rateFor(result, 'payout'), 0.005);
  assert.equal(api.singleFeeFor(result, 'payout'), 0.20);
  assert.equal(api.estimateSideFee(400, 4, api.rateFor(result, 'payout'), api.singleFeeFor(result, 'payout')), 2.8);
  assert.deepEqual(feeFields(result), feeFields(original));
  assert.deepEqual(original, before);
});

test('explicit zero fee remains zero after confirmed alias matching', () => {
  const zero = rate('NewWinPay', 'UPI', { collectFee: '0%', collectSingleFee: '0', totalFee: '0%' });
  const result = lookup(api.buildRateMap([zero]), 'NewWinPay2');
  assert.equal(api.rateHasSideFee(result, 'collect'), true);
  assert.equal(api.rateFor(result, 'collect'), 0);
  assert.equal(api.singleFeeFor(result, 'collect'), 0);
  assert.equal(api.estimateSideFee(1000, 20, api.rateFor(result, 'collect'), api.singleFeeFor(result, 'collect')), 0);
});

test('platform-only status fee aliases keep the existing exact platform restriction', () => {
  const original = rate('ArbPay2INR-UPI', 'UPI', { platform: 'SYNTHETIC' });
  const before = structuredClone(original), map = api.buildRateMap([], [original], true);
  const result = lookup(map, 'UPI-QR');
  assert.equal(result?.scopePlatformOnly, true);
  // Existing status-to-fee adapter keeps fee fields, not the status-only flag.
  assert.deepEqual(feeFields(result), { ...feeFields(original), status: undefined });
  assert.equal(lookup(map, 'UPI-QR', 'UPI', 'collect', '印度', 'OTHER'), undefined);
  assert.equal(lookup(map, 'ArbPay'), undefined);
  assert.deepEqual(original, before);
});

test('uploaded platform display aliases match their own scoped fee without borrowing another platform',()=>{
  for(const [source,display] of [['Shree.Win','ShreeWin'],['SYNTHETIC(AR)','SYNTHETIC']]){
    const original=rate('ArbPay2INR-UPI','UPI',{platform:source});
    const map=api.buildRateMap([], [original], true);
    assert.equal(lookup(map,'UPI-QR','UPI','collect','印度',display)?.platform,source);
    assert.equal(lookup(map,'UPI-QR','UPI','collect','印度',source)?.platform,source);
    assert.equal(lookup(map,'UPI-QR','UPI','collect','印度',display+'2'),undefined);
  }
});
