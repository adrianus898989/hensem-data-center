// Execute actual parent initializers/JSX and the real child presentation with
// synthetic rows. No React effects, accounts, cache, source API or fee writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadTs, root } = require('./load-typescript.cjs');
const filename = path.join(root, 'src/components/ThirdPartyRatesDashboard.tsx');
const text = fs.readFileSync(filename, 'utf8');
const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const dashboard = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ThirdPartyRatesDashboard');
assert.ok(dashboard);
const declarations = new Map();
for (const statement of dashboard.body.statements) if (ts.isVariableStatement(statement))
  for (const declaration of statement.declarationList.declarations)
    if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, declaration);

function compile(code) {
  return ts.transpileModule(code, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
}
const sheetSource = fs.readFileSync(path.join(root, 'src/components/ThirdPartyRateSheet.tsx'), 'utf8');
const sheetApi = {};
new Function('require', 'exports', compile(sheetSource))(specifier => {
  if (specifier.endsWith('.css')) return {};
  assert.ok(['react', 'react/jsx-runtime'].includes(specifier), `Unexpected child dependency ${specifier}`);
  return require(specifier);
}, sheetApi);
const dependencies = {
  exports: {}, ...React,
  ...loadTs(path.join(root, 'src/lib/thirdPartyNameMap.ts')),
  ...loadTs(path.join(root, 'src/lib/platformDisplayCountry.ts')),
  ...loadTs(path.join(root, 'src/lib/format.ts')),
  ...Object.fromEntries(Object.entries(sheetApi).filter(([key]) => key !== 'default')), ThirdPartyRateSheet: sheetApi.default,
};
const constants = source.statements.filter(ts.isVariableStatement);
const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && node !== dashboard);
const expose = [...functions.map(node => node.name.text), ...constants.flatMap(node =>
  node.declarationList.declarations.filter(item => ts.isIdentifier(item.name)).map(item => item.name.text))];
const api = new Function('require', ...Object.keys(dependencies),
  compile([...constants, ...functions].map(node => node.getText(source)).join('\n')) + `\nreturn {${expose.join(',')}};`
)(specifier => { assert.equal(specifier, 'react/jsx-runtime'); return require(specifier); }, ...Object.values(dependencies));

function evaluate(name, context) {
  const initializer = declarations.get(name)?.initializer;
  assert.ok(initializer, `Production initializer missing: ${name}`);
  return new Function(...Object.keys(context), compile(`const result = ${initializer.getText(source)};`) + '\nreturn result;')(...Object.values(context));
}
const filterDefaults = () => ({ countries: [], sheets: [], platforms: [], thirdParties: [], categories: [], statuses: [], channelTypes: [], keyword: '' });
function pipeline(payload, country = '印度', selected = {}, extra = {}) {
  const filters = { ...filterDefaults(), ...selected };
  const context = { ...dependencies, ...api, payload, filters, draftFilters: filters,
    useMemo: callback => callback(), countryRatePage: country, countryRateSheetName: '',
    statusSort: { key: 'sourceOrder', direction: 'asc' }, rateSort: { key: 'sourceOrder', direction: 'asc' },
    runningSort: { key: 'open', direction: 'desc' }, ...extra };
  for (const name of ['matchedStatusSourceRows', 'filteredStatusRows', 'matchedRateSourceRows', 'filteredRateRows',
    'sortedStatusRows', 'sortedRateRows', 'runningRows', 'sortedRunningRows', 'countryThirdPartyRows',
    'statusCounts', 'countryRateSummaryRows', 'highFeeRateRows', 'countryRateOptions', 'activeCountryRate',
    'activeCountryStatusRows', 'activeCountryRateRows', 'activeCountrySheetRows', 'activeCountrySheetStatuses'])
    context[name] = evaluate(name, context);
  for (const name of ['countryRateSheetOptions', 'countryRateSheetNames', 'effectiveCountryRateSheetName', 'visibleCountrySheetRows'])
    if (declarations.has(name)) context[name] = evaluate(name, context);
  return context;
}
function rate(index, extra = {}) {
  return { id: `synthetic-rate-${index}`, country: '印度', sheetName: '印度线下', sourceRow: index + 2,
    thirdParty: 'SYNTHETIC-PAY', category: 'UPI', collectFee: '1.25%', payoutFee: '0.80%', totalFee: '2.05%',
    collectSingleFee: '0', payoutSingleFee: '3', collectLimit: '100–50,000', payoutLimit: '200–100,000',
    status: '正常', channelInfo: `代收状态: 开启 / 原备注: SYNTHETIC-${index}`, leak: '', whitelist: '', ...extra };
}
function status(index, extra = {}) {
  return { ...rate(index), id: `synthetic-status-${index}`, platform: 'SYNTHETIC',
    rawStatus: '原单元格', sourceColumn: 21, ...extra };
}
function payload(rates, platformStatuses = []) {
  return { meta: { sheets: [...new Set(rates.map(row => row.sheetName))], updatedAt: '2026-09-13', source: 'synthetic' }, rates, platformStatuses, anomalies: [] };
}
function findNodes(rootNode, predicate) {
  const found = [];
  const visit = node => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(rootNode); return found;
}
const countryPageJSX = findNodes(dashboard, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'CountryRatePage')[0];
assert.ok(countryPageJSX);
function parentPage(view, overrides = {}) {
  const context = { ...dependencies, ...api, ...view, filteredAnomalies: [], openRateAccess: () => assert.fail('Render cannot open details'),
    openCountrySheetRate: () => assert.fail('Render cannot open details'), openAnomaly: () => assert.fail('Render cannot open anomaly'),
    setCountryRateSheetName: () => assert.fail('SSR cannot select a sheet'), ...overrides };
  return new Function('require', ...Object.keys(context), compile(`const result = ${countryPageJSX.getText(source)};`) + '\nreturn result;')(
    specifier => { assert.equal(specifier, 'react/jsx-runtime'); return require(specifier); }, ...Object.values(context));
}
function nestedHandler(name, context) {
  const node = dashboard.body.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `Actual parent handler missing: ${name}`);
  const scope = { ...dependencies, ...api, ...context };
  return new Function(...Object.keys(scope), compile(node.getText(source)) + `\nreturn ${name};`)(...Object.values(scope));
}
function elementsByType(element, type) {
  if (Array.isArray(element)) return element.flatMap(item => elementsByType(item, type));
  if (!React.isValidElement(element)) return [];
  return [...(element.type === type ? [element] : []), ...elementsByType(element.props.children, type)];
}
function exportFrom(view, options = {}) {
  const exports = [];
  nestedHandler('handleExport', { ...view, mainView: 'countryRates', view: 'anomalies',
    exportCsv: (filename, rows, columns) => exports.push({ filename, rows, columns }), ...options })();
  assert.equal(exports.length, 1);
  return exports[0];
}

test('actual parent passes every unmerged source row to the country sheet while legacy statistics stay deduped', () => {
  const rows = Array.from({ length: 225 }, (_, index) => rate(index));
  const input = payload([...rows].reverse(), [status(0), status(1)]), before = structuredClone(input);
  const view = pipeline(input), page = parentPage(view);
  assert.equal(view.matchedRateSourceRows.length, 225);
  assert.equal(view.filteredRateRows.length, 1, 'Existing fee-equivalent dashboard deduplication remains in force');
  assert.equal(view.filteredStatusRows.length, 1, 'Existing status dashboard deduplication remains in force');
  assert.equal(page.props.sheetRows.length, 225);
  assert.equal(page.props.rateRows.length, 1);
  assert.equal(page.props.sheetStatusRows.length, 2);
  assert.equal(page.props.statusRows.length, 1);
  assert.deepEqual(page.props.sheetRows.map(row => row.id), rows.map(row => row.id));
  for (let index = 0; index < rows.length; index++) assert.strictEqual(page.props.sheetRows[index], rows[index]);
  assert.deepEqual(input, before, 'Parent must not canonicalize or mutate original source rows');
});

test('actual parent passes all 225 rows while the real country sheet starts with a compact first page', () => {
  const rows = Array.from({ length: 225 }, (_, index) => rate(index));
  const page = parentPage(pipeline(payload([...rows].reverse())));
  const html = renderToStaticMarkup(page);
  assert.equal(page.props.sheetRows.length, 225);
  assert.equal((html.match(/data-rate-id=/g) || []).length, 12);
  assert.match(html, /225 条类型记录/);
  assert.ok(html.indexOf('data-rate-id="synthetic-rate-0"') < html.indexOf('data-rate-id="synthetic-rate-11"'));
  assert.match(html, /1–12 \/ 225 条/);
  assert.match(html, /下一页/);
  assert.match(html, /原表全部列/);
  assert.match(html, /不代表实际跑量/);
  assert.doesNotMatch(html, /rate-sheet-detail|三方运行 TOP|最多显示 200 行/);
});

test('parent sheet preserves distinct types, duplicate origin notes, zero and tiered fee strings', () => {
  const rows = [rate(0, { thirdParty: 'Zulu', collectFee: '0%', payoutSingleFee: '' }),
    rate(1, { thirdParty: 'Alpha', category: 'IMPS', payoutFee: '1000以下0.8%\n1000以上0.6% + 2' }),
    rate(2, { thirdParty: 'Zulu', collectFee: '0%', payoutSingleFee: '', channelInfo: '第二条同费率独立备注' })];
  const input = payload([rows[2], rows[0], rows[1]]), before = structuredClone(input);
  const view = pipeline(input);
  const actualSheet = elementsByType(api.CountryRatePage(parentPage(view).props), sheetApi.default)[0];
  const html = renderToStaticMarkup(React.cloneElement(actualSheet, { initialView: 'full' }));
  assert.deepEqual(view.activeCountrySheetRows.map(row => row.id), rows.map(row => row.id));
  assert.equal(view.activeCountrySheetRows.length, 3); assert.equal(view.activeCountryRateRows.length, 2);
  assert.match(html, /第二条同费率独立备注/); assert.match(html, /1000以下0.8%\n1000以上0.6% \+ 2/);
  assert.match(html, /<td>0%<\/td>/); assert.match(html, /<td>—<\/td>/);
  assert.deepEqual(input, before);
});

test('source row coordinates from actual v166/direct IDs override stale row numbers before rendering', () => {
  const rows = [rate(0, { id: 'synthetic-v166-14-Z', sourceRow: 1, thirdParty: 'Zulu' }),
    rate(1, { id: 'synthetic-direct-12-A', sourceRow: 100, thirdParty: 'Alpha' })];
  const view = pipeline(payload(rows));
  assert.deepEqual(view.activeCountrySheetRows.map(row => row.id), [rows[1].id, rows[0].id]);
  const html = renderToStaticMarkup(parentPage(view));
  assert.match(html, /data-rate-id="synthetic-direct-12-A" data-source-row="12"/);
  assert.match(html, /data-rate-id="synthetic-v166-14-Z" data-source-row="15"/);
});

test('all country pages use the same parent sheet path without mixing a namesake provider', () => {
  const countries = ['印度', '越南', '印尼', '巴西', '胖虎巴西', '巴基斯坦'];
  const rows = countries.flatMap((country, index) => [rate(index * 2, { country, sheetName: `${country}-synthetic` }),
    rate(index * 2 + 1, { country, sheetName: `${country}-synthetic` })]);
  const input = payload(rows), before = structuredClone(input);
  for (const country of countries) {
    const view = pipeline(input, country), page = parentPage(view);
    assert.equal(page.props.country, country);
    assert.equal(page.props.sheetRows.length, 2);
    assert.ok(page.props.sheetRows.every(row => row.country === country));
    const html = renderToStaticMarkup(page);
    assert.equal((html.match(/data-rate-id=/g) || []).length, 2);
    for (const row of rows.filter(item => item.country !== country)) assert.ok(!html.includes(`data-rate-id="${row.id}"`));
  }
  assert.deepEqual(input, before);
});

test('Brazil and Panghu platform status projection is scoped before the new matrix receives rows', () => {
  const rates = [rate(0, { country: '巴西', sheetName: 'BR-source' }), rate(1, { country: '胖虎巴西', sheetName: 'PANGHU-source' })];
  const statuses = [status(0, { country: '巴西', platform: '776F' }),
    status(1, { country: '胖虎巴西', platform: 'POPNOV' }), status(2, { country: '胖虎巴西', platform: 'POPFEZ' }),
    status(3, { country: '胖虎巴西', platform: 'POPCRA' }), status(4, { country: '越南', platform: '776F' })];
  const input = payload(rates, statuses), before = structuredClone(input);
  const fat = parentPage(pipeline(input, '胖虎巴西', { countries: ['胖虎巴西'] }));
  assert.deepEqual(fat.props.sheetStatusRows.map(row => row.platform), ['776F']);
  assert.ok(fat.props.sheetRows.every(row => row.country === '胖虎巴西'));
  const regular = parentPage(pipeline(input, '巴西', { countries: ['巴西'] }));
  assert.deepEqual(regular.props.sheetStatusRows.map(row => row.platform), ['POPNOV', 'POPFEZ', 'POPCRA']);
  assert.ok(regular.props.sheetRows.every(row => row.country === '巴西'));
  assert.deepEqual(input, before, 'Display grouping cannot rewrite backend source identities');
});

test('missing or stale active country cannot bring absent authorized data into the sheet', () => {
  const input = payload([rate(0, { country: '胖虎巴西' })], [status(0, { country: '巴西', platform: '776F' })]);
  const view = pipeline(input, '印度');
  assert.equal(view.activeCountryRate, '胖虎巴西');
  assert.deepEqual(view.countryRateOptions, ['胖虎巴西']);
  assert.ok(parentPage(view).props.sheetRows.every(row => row.country === '胖虎巴西'));
  const empty = pipeline(payload([]), '印度');
  assert.equal(empty.activeCountryRate, '');
  assert.deepEqual(empty.activeCountrySheetRows, []);
  assert.match(renderToStaticMarkup(parentPage(empty)), /没有匹配的三方费率资料/);
});

test('new sheet uses the same applied filters without changing legacy summary input', () => {
  const rows = [rate(0), rate(1), rate(2, { category: 'IMPS' }), rate(3, { status: '暂停' }),
    rate(4, { sheetName: 'another-sheet' }), rate(5, { country: '越南' })];
  const selected = { countries: ['印度'], sheets: ['印度线下'], categories: ['UPI'], statuses: ['正常'] };
  const view = pipeline(payload(rows), '印度', selected);
  assert.deepEqual(view.matchedRateSourceRows.map(row => row.id), [rows[0].id, rows[1].id]);
  assert.deepEqual(view.filteredRateRows, api.dedupeRateRows(view.matchedRateSourceRows).sort(api.compareRateSourceOrder));
  assert.deepEqual(view.runningRows, api.summarizeThirdPartyRunning(view.filteredStatusRows, view.filteredRateRows));
  assert.deepEqual(view.countryThirdPartyRows, api.summarizeCountryThirdParties(view.filteredStatusRows, view.filteredRateRows));
  assert.deepEqual(view.countryRateSummaryRows, api.summarizeCountryRateDashboard(view.filteredStatusRows, view.filteredRateRows));
  assert.equal(parentPage(view).props.sheetRows.length, 2);
});

test('new source-order presentation cannot change which duplicate the legacy summary keeps', () => {
  const firstReceived = rate(90, { channelInfo: 'Google费率表直读 / 备注: 先接收的既有代表行' });
  const earlierSheetRow = rate(2, { channelInfo: '备注: 后接收但原表位置较早' });
  const unique = rate(5, { thirdParty: 'ANOTHER-PROVIDER' });
  const input = payload([firstReceived, unique, earlierSheetRow]), before = structuredClone(input);
  const view = pipeline(input);
  assert.deepEqual(view.matchedRateSourceRows.map(row => row.id), input.rates.map(row => row.id), 'Legacy dedupe input must retain received order');
  const previousAlgorithm = api.dedupeRateRows(input.rates).sort(api.compareRateSourceOrder);
  assert.deepEqual(view.filteredRateRows, previousAlgorithm);
  const representative = view.filteredRateRows.find(row => row.id === firstReceived.id);
  assert.ok(representative, 'Existing first-received duplicate remains the summary representative');
  assert.ok(!view.filteredRateRows.some(row => row.id === earlierSheetRow.id));
  assert.equal(representative.channelInfo, firstReceived.channelInfo);
  assert.deepEqual(view.activeCountrySheetRows.map(row => row.id), [earlierSheetRow.id, unique.id, firstReceived.id]);
  assert.equal(parentPage(view).props.sheetRows.length, 3);
  assert.deepEqual(input, before);
});

test('canonical name search may match aliases but original raw names remain unchanged in the country sheet', () => {
  const input = payload([rate(0, { thirdParty: 'Super-APPPay' }), rate(1, { thirdParty: 'SUPER' }), rate(2, { thirdParty: 'WPay' })]);
  const view = pipeline(input, '印度', { thirdParties: ['SUPER'] });
  assert.deepEqual(view.activeCountrySheetRows.map(row => row.thirdParty), ['Super-APPPay', 'SUPER']);
  assert.equal(view.filteredRateRows.length, 1); assert.equal(view.filteredRateRows[0].thirdParty, 'SUPER');
  const html = renderToStaticMarkup(parentPage(view));
  assert.match(html, /Super-APPPay/); assert.match(html, /Superpay/); assert.match(html, /原名：SUPER/);
});

test('country-sheet export follows its active sheet even on the initial anomalies view or stale running view', () => {
  const rows = [rate(0), rate(1), rate(2, { sheetName: '印度原生线上' }), rate(3, { country: '越南', sheetName: '越南盘口' })];
  const input = payload(rows, [status(0)]), before = structuredClone(input), view = pipeline(input);
  for (const previousView of ['anomalies', 'running', 'rates', 'country', 'platform', 'dashboard']) {
    const output = exportFrom(view, { view: previousView });
    assert.strictEqual(output.rows, view.visibleCountrySheetRows);
    assert.deepEqual(output.rows.map(row => row.id), [rows[0].id, rows[1].id]);
    assert.match(output.filename, /^三方费率表-印度-印度线下\.csv$/);
    const columns = Object.fromEntries(output.columns.map(column => [column.label, column.value(rows[0])]));
    assert.equal(columns['原行'], 2); assert.equal(columns['代收手续费'], '1.25%');
    assert.equal(columns['代付单笔'], '3'); assert.equal(columns['通道情况'], rows[0].channelInfo);
  }
  assert.deepEqual(input, before);
});

test('the actual controlled sheet selection aligns visible rows, raw export and the child without clipping', () => {
  const first = rate(0), selectedRows = Array.from({ length: 225 }, (_, index) => rate(index + 1, { sheetName: '印度原生线上' }));
  const view = pipeline(payload([first, ...selectedRows]), '印度', {}, { countryRateSheetName: '印度原生线上' });
  let selected;
  const setter = value => { selected = value; };
  const page = parentPage(view, { setCountryRateSheetName: setter });
  assert.equal(page.props.selectedSheet, '印度原生线上');
  assert.strictEqual(page.props.onSelectSheet, setter);
  const actualSheet = elementsByType(api.CountryRatePage(page.props), sheetApi.default)[0];
  assert.ok(actualSheet); assert.equal(actualSheet.props.selectedSheet, '印度原生线上');
  assert.strictEqual(actualSheet.props.onSelectSheet, setter);
  actualSheet.props.onSelectSheet('印度线下'); assert.equal(selected, '印度线下');
  const html = renderToStaticMarkup(page);
  assert.equal((html.match(/data-rate-id=/g) || []).length, 12);
  assert.match(html, /225 条类型记录/);
  assert.equal(actualSheet.props.rateRows.length, 226, 'Every source sheet remains available to the pagination component');
  assert.doesNotMatch(html, /data-rate-id="synthetic-rate-0"/);
  assert.deepEqual(exportFrom(view).rows, selectedRows);
  assert.equal(exportFrom(view).rows.length, 225);
});

test('a stale sheet from another country falls back to that country first sheet for display and export', () => {
  const rows = [rate(0, { country: '越南', sheetName: '越南盘口' }), rate(1, { country: '越南', sheetName: '越南-第二页' })];
  const view = pipeline(payload(rows), '越南', {}, { countryRateSheetName: '印度原生线上' });
  assert.equal(view.effectiveCountryRateSheetName, '越南盘口');
  assert.deepEqual(exportFrom(view).rows, [rows[0]]);
  assert.equal(parentPage(view).props.selectedSheet, '越南盘口');
});

test('legacy dashboard exports continue using established deduped rate and status rows', () => {
  const view = pipeline(payload([rate(0), rate(1)], [status(0), status(1)]));
  const fees = exportFrom(view, { mainView: 'dashboard', view: 'rates' });
  assert.strictEqual(fees.rows, view.sortedRateRows); assert.equal(fees.rows.length, 1);
  const statuses = exportFrom(view, { mainView: 'dashboard', view: 'platform' });
  assert.strictEqual(statuses.rows, view.sortedStatusRows); assert.equal(statuses.rows.length, 1);
  const running = exportFrom(view, { mainView: 'dashboard', view: 'running' });
  assert.strictEqual(running.rows, view.sortedRunningRows); assert.match(running.filename, /^三方运行查询-/);
});

test('country matrix has no detail popup callback while the legacy detail helper retains exact source matching', () => {
  const selected = rate(2, { id: 'synthetic-v166-8-picked', sourceRow: 1, channelInfo: '当前选中原行备注' });
  const matching = status(20, { id: 'synthetic-v166-status-8-21', sourceRow: 1, rawStatus: '原状态一' });
  const conflicting = { ...matching, id: 'synthetic-v166-status-8-22', rawStatus: '原状态二', sourceColumn: 22 };
  const statuses = [matching, conflicting,
    { ...matching, id: 'wrong-sheet', sourceRow: 9, sheetName: '印度原生线上' },
    { ...matching, id: 'wrong-type', sourceRow: 9, category: 'IMPS' },
    { ...matching, id: 'wrong-row', sourceRow: 10 },
    { ...matching, id: 'wrong-name', sourceRow: 9, thirdParty: 'OTHER' },
    { ...matching, id: 'wrong-country', sourceRow: 9, country: '越南' }];
  const input = payload([rate(0, { channelInfo: '其它重复行备注不可代替' }), selected,
    rate(3, { sheetName: '印度原生线上' }), rate(4, { category: 'IMPS' })], statuses);
  const before = structuredClone(input), view = pipeline(input);
  let detail;
  const handler = nestedHandler('openCountrySheetRate', { ...view, setAnomalyModal: value => { detail = value; } });
  const page = parentPage(view, { openCountrySheetRate: handler });
  const actualSheet = elementsByType(api.CountryRatePage(page.props), sheetApi.default)[0];
  assert.equal(actualSheet.props.onOpenRate, undefined, 'The production country table must display details on-page');
  handler(selected);
  assert.equal(detail.sourceRowDetail, true); assert.deepEqual(detail.rateRows, [selected]);
  assert.strictEqual(detail.rateRows[0], selected); assert.deepEqual(detail.statusRows, [matching, conflicting]);
  assert.match(detail.title, /印度线下 · 原行 9/);
  const html = renderToStaticMarkup(React.createElement(api.RateAnomalyModal, { detail, onClose: () => assert.fail('SSR cannot close') }));
  assert.match(html, /当前选中原行备注/); assert.doesNotMatch(html, /其它重复行备注不可代替/);
  assert.deepEqual(input, before);
});

test('source-row modal does not mistake business capabilities for switches or synthesize combined fees', () => {
  const picked = rate(0, { id: 'synthetic-direct-42-picked', sourceRow: 1,
    channelInfo: '代收情况: 20万50万 / 代付情况: 限额能力 / 备注: <script>SYNTHETIC</script>',
    leak: '原漏单描述', whitelist: '原白名单描述' });
  const view = pipeline(payload([picked]));
  let detail;
  nestedHandler('openCountrySheetRate', { ...view, setAnomalyModal: value => { detail = value; } })(picked);
  const html = renderToStaticMarkup(React.createElement(api.RateAnomalyModal, { detail, onClose: () => {} }));
  assert.match(html, /原表备注完整内容/); assert.match(html, /代收情况: 20万50万/);
  assert.match(html, /原漏单描述/); assert.match(html, /原白名单描述/);
  assert.match(html, /&lt;script&gt;SYNTHETIC&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /第 42 行/); assert.match(html, /未单独提供/);
  const stateSection = html.split('状态 / 停用原因')[1].split('通道能力 / 运营资料')[0];
  assert.doesNotMatch(stateSection, /20万50万|限额能力/);
  assert.doesNotMatch(html, /1\.25%\s*\+\s*0/);
});
