// Synthetic read-only frontend regression. No credentials, API calls, source
// records, source cleanup or database mutations are used by this test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadTs, root } = require('./load-typescript.cjs');
const helper = loadTs(path.join(root, 'src/lib/thirdPartyPlatform.ts'));
const names = loadTs(path.join(root, 'src/lib/thirdPartyNameMap.ts'));
const text = fs.readFileSync(path.join(root, 'src/components/ThirdPartyVolumeDashboard.tsx'), 'utf8');
const source = ts.createSourceFile('ThirdPartyVolumeDashboard.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const dashboard = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ThirdPartyVolumeDashboard');
assert.ok(dashboard, 'Actual production dashboard must be available');
const declarations = new Map();
for (const statement of dashboard.body.statements) {
  if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations)
    if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, declaration);
}
const functionNames = ['uniq', 'filterLabel', 'localAliasKey', 'normalizePlatformDisplayName', 'collapseThirdPartyDisplayName',
  'normalizeVolumeRowForDisplay', 'isHiddenCountry', 'isAllUsdtCountryPage', 'isUsdtVolumeRow', 'rowMatchesCountryPage',
  'normalizeCountryLabel', 'sumRows', 'aggregateCombo', 'aggregateDirection', 'VolumeMultiSelect'];
function compile(code) {
  return ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
}
function functions(search = '') {
  const selected = source.statements.filter(node => ts.isFunctionDeclaration(node) && functionNames.includes(node.name?.text));
  let state = 0;
  const dependencies = { ...helper, ...names, exports: {}, ALL_USDT_COUNTRY_PAGE: '所有国家USDT', useMemo: callback => callback(), useEffect: () => {},
    useRef: () => ({ current: null }), useState: initial => [state++ === 0 ? true : search, () => {}],
    require: name => { assert.equal(name, 'react/jsx-runtime'); return require(name); } };
  return new Function(...Object.keys(dependencies), compile(selected.map(node => node.getText(source)).join('\n'))
    + `\nreturn {${selected.map(node => node.name.text).join(',')}};`)(...Object.values(dependencies));
}
// Execute the real component's variable/useMemo initializer, not a rewritten
// oracle. Only deterministic dependencies and synthetic payloads are injected.
function evaluate(name, context) {
  const node = declarations.get(name);
  assert.ok(node?.initializer, `Production initializer missing: ${name}`);
  const code = compile(`const result = ${node.initializer.getText(source)};`);
  return new Function(...Object.keys(context), code + '\nreturn result;')(...Object.values(context));
}
function row(id, platform, amount, count, options = {}) {
  return { id, sheetName: 'SYNTHETIC', sourceRow: Number(id.replace(/\D/g, '')) || 1, date: '2026-09-10', country: '巴西',
    platform, channel: 'PIX', rawChannel: 'PIX', channelType: 'PIX', direction: '代收', amount, count,
    successCount: count - 1, failedCount: 1, successRate: (count - 1) / count, status: 'synthetic', ...options };
}
function data() {
  return [row('r1', '43r', 100, 10), row('r2', '43R', 200, 20, { date: '2026-09-09', direction: '代付' }),
    row('r3', 'PLAYERBR', 300, 30), row('r4', 'PLAYER BR', 400, 40, { channel: 'USDT', rawChannel: 'USDT', channelType: 'USDT', direction: '代付' }),
    row('r5', 'POPKKK', 500, 50), row('r6', '43-R', 600, 60), row('r7', 'PLAYER-BR', 700, 70),
    row('r8', '43r', 800, 80, { country: '越南' }), row('r9', 'PLAYERBR', 900, 90, { country: '越南' })];
}
const rates = [{ country: '巴西', platform: '43R' }, { country: '巴西', platform: 'PLAYER BR' },
  { country: '巴西', platform: 'POPKKK新' }, { country: '巴西', platform: 'RATE_ONLY' },
  { country: '越南', platform: 'VN_RATE_ONLY' }];
function pipeline({ input = data(), platforms = [], country = '巴西', statusRows = rates } = {}) {
  const api = functions();
  const context = { ...api, ...helper, payload: { rows: input }, ratePayload: { platformStatuses: statusRows },
    useMemo: callback => callback(), mainTab: 'country', activeCountryPage: country, country: '', effectiveCountryFilter: country,
    optionCountryFilter: country, countrySelections: [], appliedCountrySelections: [], platformSelections: platforms,
    appliedPlatformSelections: platforms, appliedChannel: '', appliedDirection: '', appliedChannelTypeSelections: [] };
  for (const name of ['rows', 'platformSelectionCountry', 'selectedPlatformSet', 'optionScopedRowsBeforeCountry', 'optionScopedRows', 'configuredPlatforms',
    'platforms', 'channelOptionRows', 'channels', 'channelTypeOptions', 'filteredBaseNoDate']) {
    if (declarations.has(name)) context[name] = evaluate(name, context);
  }
  return context;
}

test('only two confirmed Brazilian aliases canonicalize; other countries remain unchanged', () => {
  for (const country of ['巴西', 'BR']) for (const [input, expected] of [['43r', '43R'], ['43R', '43R'], [' playerbr ', 'PLAYER BR'], ['PLAYER BR', 'PLAYER BR']])
    assert.equal(helper.canonicalThirdPartyPlatform(country, input), expected);
  for (const country of ['越南', 'VN', '印度', 'IN', '巴西原生', 'BR2', '']) {
    assert.equal(helper.canonicalThirdPartyPlatform(country, '43r'), '43r');
    assert.equal(helper.canonicalThirdPartyPlatform(country, 'PLAYERBR'), 'PLAYERBR');
  }
});
test('similar independent platforms and unconfirmed POPKKK新 remain distinct', () => {
  for (const platform of ['43-R', '43R2', 'PLAYER-BR', 'PLAYER_BR', 'PLAYER BR2', 'POPKKK新', 'POPKKK'])
    assert.equal(helper.canonicalThirdPartyPlatform('巴西', platform), platform);
  assert.equal(helper.matchesThirdPartyPlatformSelection('巴西', 'POPKKK', ['POPKKK新']), false);
});
test('selection normalization is stable, unique, ignores blanks and preserves inputs', () => {
  const selected = ['PLAYERBR', '43r', 'PLAYER BR', '43R', '', ' ', 'POPKKK新', 'POPKKK'];
  const before = [...selected];
  assert.deepEqual(helper.canonicalThirdPartyPlatformSelections('巴西', selected), ['PLAYER BR', '43R', 'POPKKK新', 'POPKKK']);
  assert.deepEqual(selected, before);
  assert.equal(helper.matchesThirdPartyPlatformSelection('巴西', '43r', []), true);
});
test('either old or canonical selection matches all history but not similar platforms', () => {
  for (const selection of ['43r', '43R']) for (const platform of ['43r', '43R'])
    assert.equal(helper.matchesThirdPartyPlatformSelection('巴西', platform, [selection]), true);
  for (const selection of ['PLAYERBR', 'PLAYER BR']) for (const platform of ['PLAYERBR', 'PLAYER BR'])
    assert.equal(helper.matchesThirdPartyPlatformSelection('巴西', platform, [selection]), true);
  assert.equal(helper.matchesThirdPartyPlatformSelection('巴西', '43-R', ['43R']), false);
  assert.equal(helper.matchesThirdPartyPlatformSelection('越南', 'PLAYERBR', ['PLAYER BR']), false);
});
test('the existing global ShreeWin compatibility behavior remains unchanged', () => {
  for (const country of ['印度', '巴西', '越南', '']) for (const platform of ['Shree.Win', 'Shreewin', 'SHREE WIN'])
    assert.equal(helper.canonicalThirdPartyPlatform(country, platform), 'ShreeWin');
  assert.equal(helper.canonicalThirdPartyPlatform('印度', 'ShreeWin2'), 'ShreeWin2');
});
test('actual component rows normalize names without deleting, duplicating or mutating money/order records', () => {
  const input = data(), before = structuredClone(input), view = pipeline({ input });
  assert.deepEqual(input, before); assert.equal(view.rows.length, input.length);
  const fields = ['id', 'sheetName', 'sourceRow', 'country', 'date', 'amount', 'count', 'successCount', 'failedCount', 'successRate', 'direction'];
  for (let index = 0; index < input.length; index++) for (const field of fields) assert.equal(view.rows[index][field], input[index][field]);
  assert.deepEqual(view.sumRows(view.rows), view.sumRows(input));
});
test('actual volume+rate option union removes confirmed duplicate spellings but keeps rate-only platforms', () => {
  const view = pipeline();
  assert.deepEqual(view.platforms, ['43-R', '43R', 'PLAYER BR', 'PLAYER-BR', 'POPKKK', 'POPKKK新', 'RATE_ONLY'].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })));
  assert.equal(view.platforms.filter(name => name === '43R').length, 1);
  assert.equal(view.platforms.filter(name => name === 'PLAYER BR').length, 1);
  assert.ok(view.platforms.includes('RATE_ONLY')); assert.ok(!view.platforms.includes('VN_RATE_ONLY'));
  assert.equal(view.uniq(view.optionScopedRows.map(row => row.platform)).length, 5);
  assert.equal(view.platforms.length, 7, 'Configured options can legitimately exceed active-volume platforms');
});
test('actual applied filter and draft channel/type options accept old and canonical selections', () => {
  for (const selected of ['PLAYERBR', 'PLAYER BR']) {
    const view = pipeline({ platforms: [selected] });
    assert.deepEqual(view.filteredBaseNoDate.map(row => row.id), ['r3', 'r4']);
    assert.deepEqual(view.channelOptionRows.map(row => row.id), ['r3', 'r4']);
    assert.deepEqual(view.channels, ['PIX', 'USDT']); assert.deepEqual(view.channelTypeOptions, ['PIX', 'USDT']);
    assert.deepEqual(view.sumRows(view.filteredBaseNoDate), { amount: 700, count: 70, collectAmount: 300, collectCount: 30, payoutAmount: 400, payoutCount: 40 });
  }
  for (const selected of ['43r', '43R']) {
    const view = pipeline({ platforms: [selected] });
    assert.deepEqual(view.filteredBaseNoDate.map(row => row.id), ['r1', 'r2']);
  }
});
test('actual grouped summaries preserve counts once per original row and keep country/date/direction boundaries', () => {
  const view = pipeline(), rows = view.rows;
  const grouped = view.aggregateCombo(rows, row => [row.country, row.platform, row.channel]);
  assert.equal(grouped.reduce((sum, group) => sum + group.totalAmount, 0), 4500);
  assert.equal(grouped.reduce((sum, group) => sum + group.totalCount, 0), 450);
  assert.equal(grouped.flatMap(group => group.rows).length, rows.length);
  assert.ok(grouped.some(group => group.labelParts[0] === '越南' && group.labelParts[1] === '43r'));
  assert.ok(grouped.some(group => group.labelParts[0] === '巴西' && group.labelParts[1] === '43R'));
  const dated = view.aggregateDirection(rows, row => [row.country, row.platform, row.date, row.direction]);
  assert.equal(dated.reduce((sum, group) => sum + group.amount, 0), 4500);
  assert.equal(dated.reduce((sum, group) => sum + group.count, 0), 450);
  assert.equal(dated.filter(group => group.parts[0] === '巴西' && group.parts[1] === '43R').length, 2);
});
test('actual dropdown SSR renders each confirmed canonical candidate exactly once without changing selections', () => {
  const view = pipeline(), api = functions();
  const selected = helper.canonicalThirdPartyPlatformSelections('巴西', ['43r', 'PLAYERBR']);
  const before = [...selected];
  const html = renderToStaticMarkup(React.createElement(api.VolumeMultiSelect, { label: '平台', options: view.platforms, value: selected, onChange: () => assert.fail('SSR cannot save'), placeholder: '全部平台' }));
  assert.equal((html.match(/<span>43R<\/span>/g) || []).length, 1);
  assert.equal((html.match(/<span>PLAYER BR<\/span>/g) || []).length, 1);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 7);
  assert.equal((html.match(/checked=""/g) || []).length, 2);
  assert.match(html, /RATE_ONLY/); assert.match(html, /POPKKK新/);
  assert.doesNotMatch(html, /<span>43r<\/span>|<span>PLAYERBR<\/span>/);
  assert.deepEqual(selected, before);
});
test('selecting both aliases cannot duplicate historical amounts or order counts', () => {
  const view = pipeline({ platforms: ['43r', '43R', 'PLAYERBR', 'PLAYER BR'] });
  assert.deepEqual(view.filteredBaseNoDate.map(row => row.id), ['r1', 'r2', 'r3', 'r4']);
  assert.equal(view.sumRows(view.filteredBaseNoDate).amount, 1000);
  assert.equal(view.sumRows(view.filteredBaseNoDate).count, 100);
});
test('actual selection-retention effect canonicalizes old saved choices instead of clearing them', () => {
  const effect = dashboard.body.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(source) === 'useEffect' && node.expression.arguments[0]?.getText(source).includes('setPlatformSelections(next)'));
  assert.ok(effect, 'Actual selection maintenance effect must exist');
  const callback = effect.expression.arguments[0];
  const view = pipeline({ platforms: ['43r', '43R', 'PLAYERBR', 'PLAYER BR', 'REMOVED'] });
  let next, channel, types;
  const context = { ...view, setPlatformSelections: value => { next = value; }, setChannel: value => { channel = value; }, setChannelTypeSelections: value => { types = value; } };
  new Function(...Object.keys(context), compile(`const run = ${callback.getText(source)}; run();`))(...Object.values(context));
  assert.deepEqual(next, ['43R', 'PLAYER BR']); assert.equal(channel, ''); assert.deepEqual(types, []);
});
test('actual modal platform candidates and filtering use the same alias identities', () => {
  const modal = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'VolumeRowsModal');
  const vars = new Map();
  for (const statement of modal.body.statements) if (ts.isVariableStatement(statement))
    for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) vars.set(declaration.name.text, declaration);
  const calculate = (name, context) => new Function(...Object.keys(context), compile(`const result = ${vars.get(name).initializer.getText(source)};`) + '\nreturn result;')(...Object.values(context));
  const context = { ...functions(), ...helper, useMemo: callback => callback(), rows: data(), modalCountry: '巴西', modalPlatform: 'PLAYERBR', modalDirection: '', modalKeyword: '' };
  assert.equal(calculate('platformOptions', context).filter(value => value === 'PLAYER BR').length, 1);
  assert.deepEqual(calculate('filteredRows', context).map(row => row.id), ['r3', 'r4']);
  context.modalPlatform = 'PLAYER BR';
  assert.deepEqual(calculate('filteredRows', context).map(row => row.id), ['r3', 'r4']);
});
test('actual query commits canonical selection state without broadening the selected country or dates', async () => {
  const query = dashboard.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'runQuery');
  assert.ok(query);
  const writes = {}, requests = [];
  const context = { ...pipeline({ platforms: ['43r', '43R', 'PLAYERBR'] }), startDate: '2026-09-09', endDate: '2026-09-10',
    appliedStartDate: '', appliedEndDate: '', channel: '', direction: '', channelTypeSelections: [],
    loadData: async (...args) => { requests.push(args); },
    ...Object.fromEntries(['IsQuerying', 'AppliedStartDate', 'AppliedEndDate', 'AppliedCountrySelections', 'AppliedPlatformSelections',
      'AppliedChannel', 'AppliedDirection', 'AppliedChannelTypeSelections', 'AppliedCountryPage', 'LastQueryAt', 'HasQueried']
      .map(name => ['set' + name, value => { writes[name] = value; }])) };
  await new Function(...Object.keys(context), compile(query.getText(source)) + '\nreturn runQuery();')(...Object.values(context));
  assert.deepEqual(writes.AppliedPlatformSelections, ['43R', 'PLAYER BR']);
  assert.equal(writes.AppliedCountryPage, '巴西');
  assert.equal(writes.AppliedStartDate, '2026-09-09'); assert.equal(writes.AppliedEndDate, '2026-09-10');
  assert.deepEqual(requests, [[true, '2026-09-09', '2026-09-10', '', '巴西', true]]);
  assert.equal(writes.IsQuerying, false);
});
test('actual platform card explicitly counts active data, not the larger configured-option union', () => {
  const page = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'CountryVolumeSinglePage');
  let card;
  const visit = node => {
    if (ts.isObjectLiteralExpression(node) && node.properties.some(property => ts.isPropertyAssignment(property)
      && property.name.getText(source) === 'label' && ts.isStringLiteral(property.initializer) && property.initializer.text === '平台')) card = node;
    ts.forEachChild(node, visit);
  };
  visit(page);
  assert.ok(card, 'Actual platform metric card must exist');
  const view = pipeline();
  const context = { uniq: view.uniq, rows: view.optionScopedRows };
  const result = new Function(...Object.keys(context), compile(`const result = ${card.getText(source)};`) + '\nreturn result;')(...Object.values(context));
  assert.equal(result.helper, '当前有数据的平台');
  assert.equal(result.value, 5); assert.equal(view.platforms.length, 7);
});
