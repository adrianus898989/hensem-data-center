const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/components/ThirdPartyRateSheet.tsx');
const source = fs.readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const api = {};
new Function('require', 'exports', compiled)(name => name.endsWith('.css') ? {} : require(name), api);
const rate = (extra = {}) => ({ id: 'India-v166-10-SUPER-UPI', sheetName: '印度线下', country: '印度', category: 'UPI', thirdParty: 'SUPER',
  collectFee: '1.25%', payoutFee: '0.8%', totalFee: '2.05%', collectSingleFee: '0', payoutSingleFee: '3', collectLimit: '100–50,000', payoutLimit: '200–100,000',
  channelInfo: '代收状态: 开启 / 代付状态: 备用 / 备注: 保留实际范围', leak: '', whitelist: '', status: '正常', sourceRow: 11, ...extra });
const status = (extra = {}) => ({ id: 'India-v166-status-10-20', sheetName: '印度线下', country: '印度', platform: 'TEST_A', thirdParty: 'SUPER', category: 'UPI',
  collectFee: '1.25%', payoutFee: '0.8%', totalFee: '2.05%', collectSingleFee: '0', payoutSingleFee: '3', collectLimit: '100–50,000', payoutLimit: '200–100,000',
  status: '正常', rawStatus: '开启', sourceRow: 11, sourceColumn: 21, ...extra });
const render = (rateRows, statusRows = [], extra = {}) => renderToStaticMarkup(React.createElement(api.default, { country: '印度', rateRows, statusRows, ...extra }));

test('one input type stays one row; no collapsed categories, fee addition or alphabetic sorting', () => {
  const rows = [rate({ id: 'first', thirdParty: 'Zulu', category: 'UPI' }), rate({ id: 'second', thirdParty: 'Alpha', category: 'IMPS', collectFee: '2.17%' }), rate({ id: 'third', thirdParty: 'Zulu', category: 'UPI' })];
  const before = JSON.stringify(rows), html = render(rows);
  assert.equal((html.match(/data-rate-id=/g) || []).length, 3);
  assert(html.indexOf('data-rate-id="first"') < html.indexOf('data-rate-id="second"'));
  assert(html.indexOf('data-rate-id="second"') < html.indexOf('data-rate-id="third"'));
  assert.match(html, /2\.17%/); assert.doesNotMatch(html, /多类型|1\.25%\s*\/\s*2\.17%|1\.25% \+ 0/);
  assert.equal(JSON.stringify(rows), before);
});

test('explicit zero, empty and tiered fee text remain distinct without number parsing', () => {
  const html = render([rate({ collectFee: '0%', collectSingleFee: '', payoutSingleFee: '0.00', payoutFee: '1000以下0.8%\n1000以上0.6% + 2' })]);
  assert.match(html, /<td>0%<\/td><td>—<\/td>/);
  assert.match(html, /1000以下0.8%\n1000以上0.6% \+ 2/);
  assert.match(html, /<td>0\.00<\/td>/);
});

test('business side status uses exact metadata field only, never overall status', () => {
  assert.equal(api.rateSheetBusinessStatus(rate(), 'collect'), '开启');
  assert.equal(api.rateSheetBusinessStatus(rate(), 'payout'), '备用');
  assert.equal(api.rateSheetBusinessStatus(rate({ channelInfo: '备注: 代收状态不明', status: '正常' }), 'collect'), '');
  assert.equal(api.rateSheetBusinessStatus(rate({ channelInfo: '代收状态: 开启 / 代收状态: 暂停' }), 'collect'), '开启\n暂停');
  const capability = rate({ channelInfo: '代收情况: 支持限额 / 代付情况: 20万50万' });
  assert.equal(api.rateSheetBusinessStatus(capability, 'collect'), '');
  assert.equal(api.rateSheetBusinessStatus(capability, 'payout'), '');
  assert.match(render([capability]), /代付情况: 20万50万/);
});

test('matrix requires sheet, country, source row, type and exact party', () => {
  const expected = status(), input = [expected,
    status({ sheetName: '另页' }), status({ country: '越南' }), status({ id: 'different', sourceRow: 12 }),
    status({ category: 'IMPS' }), status({ thirdParty: 'SUPER-extra' })];
  const before = JSON.stringify(input);
  assert.deepEqual(api.rateSheetMatrixRows(rate(), input), [expected]);
  assert.equal(JSON.stringify(input), before);
});

test('unknown origin coordinates never falsely match each other', () => {
  assert.equal(api.rateSheetSourceRow({ id: 'unknown', sourceRow: 0 }), null);
  assert.deepEqual(api.rateSheetMatrixRows(rate({ id: 'unknown', sourceRow: 0 }), [status({ id: 'unknown-status', sourceRow: 0 })]), []);
});

test('actual v166 and direct origin IDs take precedence over stale stored sourceRow', () => {
  assert.equal(api.rateSheetSourceRow({ id: 'Sheet-v166-14-X', sourceRow: 1 }), 15);
  assert.equal(api.rateSheetSourceRow({ id: 'Sheet-v166-status-14-22', sourceRow: 1 }), 15);
  assert.equal(api.rateSheetSourceRow({ id: 'Sheet-direct-15-X', sourceRow: 1 }), 15);
  assert.equal(api.rateSheetSourceRow({ id: 'other', sourceRow: 15 }), 15);
});

test('platform columns follow sourceColumn, stable ties preserve source order', () => {
  const columns = api.rateSheetMatrixColumns([status({ platform: 'Z', sourceColumn: 24 }), status({ platform: 'B', sourceColumn: 21 }), status({ platform: 'A', sourceColumn: 21 }), status({ platform: 'Z', sourceColumn: 24 })]);
  assert.deepEqual(columns.map(item => item.platform), ['B', 'A', 'Z']);
});

test('matrix defaults collapsed; matched records preserve raw wording/conflicts without choosing a winner', () => {
  const records = [status({ id: 's1', rawStatus: '支持充值,暂缓代付' }), status({ id: 's2', rawStatus: '暂停维护' })];
  assert.deepEqual(api.rateSheetMatrixRows(rate(), records).map(row => row.rawStatus), ['支持充值,暂缓代付', '暂停维护']);
  const html = render([rate()], records);
  assert.match(html, /盘口状态矩阵/); assert.doesNotMatch(html, /盘口接入状态 · 原单元格/);
});

test('all source note fields preserved, escaped and not executed as markup', () => {
  const html = render([rate({ channelInfo: '<script>alert(1)</script>\n特殊 / 原文', leak: '漏单备注', whitelist: '白名单说明' })]);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/); assert.match(html, /漏单备注/); assert.match(html, /白名单说明/);
  assert.doesNotMatch(html, /<script/);
});

test('sheet selector preserves supplied page order and does not mix pages', () => {
  const html = render([rate({ sheetName: 'B表', id: 'b' }), rate({ sheetName: 'A表', id: 'a' })]);
  assert(html.indexOf('>B表</button>') < html.indexOf('>A表</button>'));
  assert.match(html, /data-rate-id="b"/); assert.doesNotMatch(html, /data-rate-id="a"/);
  assert.match(html, /aria-pressed="true"/);
});

test('controlled selectedSheet chooses the parent page, with a safe current-list fallback', () => {
  const rows = [rate({ sheetName: 'B表', id: 'b' }), rate({ sheetName: 'A表', id: 'a' })];
  const selected = render(rows, [], { selectedSheet: 'A表', onSelectSheet: () => assert.fail('SSR must not emit selection') });
  assert.match(selected, /data-rate-id="a"/); assert.doesNotMatch(selected, /data-rate-id="b"/);
  for (const selectedSheet of ['', '不存在的旧页签']) {
    const html = render(rows, [], { selectedSheet });
    assert.match(html, /data-rate-id="b"/); assert.doesNotMatch(html, /data-rate-id="a"/);
  }
});

test('more than 200 actual rows are not silently clipped', () => {
  const html = render(Array.from({ length: 225 }, (_, i) => rate({ id: `row-${i}` })));
  assert.equal((html.match(/data-rate-id=/g) || []).length, 225);
  assert.match(html, /225 条类型记录/);
});

test('optional detail button receives a source row and empty state needs no data', () => {
  assert.doesNotMatch(render([rate()]), /rate-sheet-detail/);
  assert.match(render([rate()], [], { onOpenRate: () => assert.fail('SSR must not invoke actions') }), /查看 SUPER UPI 详情/);
  assert.match(render([]), /没有匹配的三方费率资料/);
});

test('Superpay is a display label with original SUPER kept; Transafe-QR never becomes RsPay', () => {
  const rows = [rate(), rate({ id: 'qr', thirdParty: 'Transafe-QR' })], before = JSON.stringify(rows), html = render(rows);
  assert.match(html, /Superpay/); assert.match(html, /原名：SUPER/); assert.match(html, /Transafe-QR/); assert.doesNotMatch(html, /RsPay/);
  assert.equal(JSON.stringify(rows), before);
});

test('the confirmed SUPER display alias is limited to explicit India country identifiers', () => {
  for (const country of ['印度', 'IN', 'India']) assert.match(render([rate({ country })], [], { country }), /Superpay/);
  for (const country of ['巴西', '越南', '印尼', '南美', 'USDT通道', '未知']) {
    const html = render([rate({ country, sheetName: '印度线下' })], [], { country });
    assert.doesNotMatch(html, /Superpay/); assert.match(html, />SUPER<\/th>/);
  }
});

for (const [country, sheet, types, units] of [
  ['巴西', '巴西盘口', ['PIX', 'Bank'], ['R$ 0,50', 'R$ 10–50.000']],
  ['越南', '越南盘口', ['Bank', 'QR'], ['2.000 ₫', 'VND 100.000–50.000.000']],
  ['印尼', '印尼盘', ['QRIS', 'DANA'], ['Rp 1.500', 'IDR 10.000–5.000.000']],
  ['南美', '南美盘口', ['COP', 'CLP'], ['COP 1.000 / CLP 100', 'COP 10.000–9.000.000']],
  ['USDT通道', 'USDT通道', ['TRC20', 'ERC20'], ['1 USDT', '10–1,000 USDT']],
]) {
  test(`${country}: keep separate types, native unit/punctuation, unavailable status, and source arrays`, () => {
    const rows = types.map((category, i) => rate({ id: `${country}-${i}`, sheetName: sheet, country, thirdParty: '同名示例渠道', category,
      collectFee: i ? '0%' : '0.75%', collectSingleFee: units[0], collectLimit: units[1], payoutFee: '', payoutSingleFee: '',
      channelInfo: '代收情况: 支持 / 代付情况: 20万50万', status: '', sourceRow: 6 + i }));
    const before = JSON.stringify(rows), html = render(rows, [], { country });
    assert.equal((html.match(/data-rate-id=/g) || []).length, 2);
    for (const text of [...types, ...units]) assert(html.includes(text), text);
    assert.doesNotMatch(html, /多类型|rate-sheet-status-good|rate-sheet-status-bad/);
    assert.equal(api.rateSheetBusinessStatus(rows[0], 'collect'), '');
    assert.equal(api.rateSheetBusinessStatus(rows[0], 'payout'), '');
    assert.match(html, /<td>—<\/td><td>—<\/td>/);
    assert.equal(JSON.stringify(rows), before);
  });
}

test('long multilingual notes including literal comparison signs and emoji have no truncation', () => {
  const note = '原样说明 R$ / VND / USDT，金额 <= 100，范围 > 0，🙂\n'.repeat(80) + '长备注结束标记';
  const html = render([rate({ channelInfo: note })]);
  assert.match(html, /长备注结束标记/);
  assert.equal((html.match(/🙂/gu) || []).length, 80);
  assert.match(html, /金额 &lt;= 100/); assert.match(html, /范围 &gt; 0/);
  assert.match(html, /完整备注，可滚动查看/); assert.match(html, /tabindex="0" role="region"/);
});

test('presentation imports only React, types and isolated CSS; no fee pipeline or I/O', () => {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = tree.statements.filter(ts.isImportDeclaration).map(node => node.moduleSpecifier.text);
  assert.deepEqual(imports, ['react', '@/lib/types', './ThirdPartyRateSheet.css']);
  assert.doesNotMatch(source, /\bfetch\s*\(|localStorage|sessionStorage|buildRateMap|findMatchedRate|parseThirdPartyRates|groupedRateRows/);
  const css = fs.readFileSync(path.join(root, 'src/components/ThirdPartyRateSheet.css'), 'utf8');
  assert.match(css, /overflow: auto/); assert.match(css, /position: sticky/); assert.match(css, /max-width: 760px/);
  assert.doesNotMatch(css, /(?:^|\n)(?:body|html|table|button)\s*\{/);
});
