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
const countryHelper = loadTs(path.join(root, 'src/lib/platformDisplayCountry.ts'));
const names = loadTs(path.join(root, 'src/lib/thirdPartyNameMap.ts'));
const workorders = loadTs(path.join(root, 'src/lib/workOrderDeposit.ts'));
const orderTime = loadTs(path.join(root, 'src/lib/orderTimeVolume.ts'));
const orderClock = loadTs(path.join(root, 'src/lib/orderTimeQuery.ts'));
const format = loadTs(path.join(root, 'src/lib/format.ts'));
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
  'normalizeCountryLabel', 'sumRows', 'aggregateCombo', 'aggregateDirection', 'VolumeMultiSelect', 'summaryQuerySource'];
function compile(code) {
  return ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
}
function functions(search = '') {
  const selected = source.statements.filter(node => ts.isFunctionDeclaration(node) && functionNames.includes(node.name?.text));
  let state = 0;
  const dependencies = { ...helper, ...countryHelper, ...names, ...format, exports: {}, ALL_USDT_COUNTRY_PAGE: '所有国家USDT', useMemo: callback => callback(), useEffect: () => {},
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
test('confirmed India DhaniWin and Veer aliases canonicalize once, without merging similarly named or foreign platforms',()=>{
  const groups=[['DhaniWin',['DhaniWin','DHANIWIN','DHANIWIN(新AR)','DhaniWin（新AR）','DHANI.WIN']],['VEER.GAME',['Veer.Game','VEER.GAME','VEERGAME']]];
  for(const [canonical,aliases] of groups)for(const country of ['印度','IN','印度线下盘口']){
    assert.deepEqual(helper.canonicalThirdPartyPlatformSelections(country,aliases),[canonical]);
    for(const alias of aliases)assert.ok(helper.matchesThirdPartyPlatformSelection(country,alias,[canonical]));
  }
  for(const name of ['VEERGAME2','VEER-GAME','DHANIWIN2','DHANIWIN(旧)'])assert.equal(helper.canonicalThirdPartyPlatform('印度',name),name);
  assert.equal(helper.canonicalThirdPartyPlatform('越南','VEERGAME'),'VEERGAME');
  assert.equal(helper.canonicalThirdPartyPlatform('香港','DHANIWIN(新AR)'),'DHANIWIN(新AR)');
  const input=['DhaniWin','DHANIWIN','DHANIWIN(新AR)','Veer.Game','VEER.GAME','VEERGAME'].map((p,i)=>row('i'+i,p,100,1,{country:'印度'}));
  const output=pipeline({input,country:'印度',statusRows:[]});
  assert.deepEqual(output.platforms.sort(),['DhaniWin','VEER.GAME'].sort());
  assert.equal(output.rows.length,6);assert.equal(output.rows.reduce((n,r)=>n+r.amount,0),600,'display aliases must not duplicate original source rows');
});
function pipeline({ input = data(), platforms = [], country = '巴西', statusRows = rates,
  catalog = [...input.map(({ country, platform }) => ({ country, platform })), ...statusRows] } = {}) {
  const api = functions();
  const context = { ...api, ...helper, ...countryHelper, ...workorders, ...orderTime, payload: { rows: input }, ratePayload: { platformStatuses: statusRows },
    useMemo: callback => callback(), mainTab: 'country', activeCountryPage: country, country: '', effectiveCountryFilter: country,
    optionCountryFilter: country, countrySelections: [], appliedCountrySelections: [], platformSelections: platforms,
    appliedPlatformSelections: platforms, appliedChannel: '', appliedDirection: '', appliedChannelTypeSelections: [],
    filterOptions: { platforms: catalog, ready: true, loading: false, error: '' },
    queryIntentRef: { current: 0 }, queryContextRef: { current: `viewer:${country}` }, viewerIdentity: 'viewer',
    loadFlightRef: { current: null }, loadTimeRates: async () => {},
    timeQuery: {mode:'created',showDaily:()=>{},platforms:[],startClock:'00:00:00',endClock:'23:59:59',optionsLoading:false,optionsError:''},
    setSummaryQueryError:()=>{},setLegacySummaryNotice:()=>{},timeOptionsRows:[], startDate:'2026-09-01', endDate:'2026-09-30' };
  for (const name of ['rows', 'platformSelectionCountry', 'selectedPlatformSet', 'optionScopedRowsBeforeCountry', 'optionScopedRows', 'configuredPlatforms',
    'timePlatformOptions', 'platforms', 'hasLegacyPlatformSelection', 'channelOptionRows', 'workOrderChannelOptions', 'channels', 'channelTypeOptions', 'filteredBaseNoDate']) {
    if (declarations.has(name)) context[name] = evaluate(name, context);
  }
  return context;
}

test('only three confirmed Brazilian aliases canonicalize; other countries remain unchanged', () => {
  for (const country of ['巴西', 'BR']) for (const [input, expected] of [['43r', '43R'], ['43R', '43R'], [' playerbr ', 'PLAYER BR'], ['PLAYER BR', 'PLAYER BR'], ['POPKKK新', 'POPKKK'], [' popkkk新 ', 'POPKKK'], ['popkkk', 'POPKKK']])
    assert.equal(helper.canonicalThirdPartyPlatform(country, input), expected);
  for (const country of ['越南', 'VN', '印度', 'IN', '巴西原生', 'BR2', '']) {
    assert.equal(helper.canonicalThirdPartyPlatform(country, '43r'), '43r');
    assert.equal(helper.canonicalThirdPartyPlatform(country, 'PLAYERBR'), 'PLAYERBR');
    assert.equal(helper.canonicalThirdPartyPlatform(country, 'POPKKK新'), 'POPKKK新');
  }
});
test('similar independent platforms remain distinct without generic suffix stripping', () => {
  for (const platform of ['43-R', '43R2', 'PLAYER-BR', 'PLAYER_BR', 'PLAYER BR2', 'POPKKK新2', 'POPKKK-新', 'POPKKK2'])
    assert.equal(helper.canonicalThirdPartyPlatform('巴西', platform), platform);
  assert.equal(helper.matchesThirdPartyPlatformSelection('巴西', 'POPKKK新2', ['POPKKK新']), false);
});
test('selection normalization is stable, unique, ignores blanks and preserves inputs', () => {
  const selected = ['PLAYERBR', '43r', 'PLAYER BR', '43R', '', ' ', 'POPKKK新', 'POPKKK'];
  const before = [...selected];
  assert.deepEqual(helper.canonicalThirdPartyPlatformSelections('巴西', selected), ['PLAYER BR', '43R', 'POPKKK']);
  assert.deepEqual(selected, before);
  assert.equal(helper.matchesThirdPartyPlatformSelection('巴西', '43r', []), true);
});
test('either old or canonical selection matches all history but not similar platforms', () => {
  for (const selection of ['43r', '43R']) for (const platform of ['43r', '43R'])
    assert.equal(helper.matchesThirdPartyPlatformSelection('巴西', platform, [selection]), true);
  for (const selection of ['PLAYERBR', 'PLAYER BR']) for (const platform of ['PLAYERBR', 'PLAYER BR'])
    assert.equal(helper.matchesThirdPartyPlatformSelection('巴西', platform, [selection]), true);
  for (const country of ['巴西', 'BR']) for (const selection of ['POPKKK新', 'POPKKK']) for (const platform of ['POPKKK新', 'POPKKK'])
    assert.equal(helper.matchesThirdPartyPlatformSelection(country, platform, [selection]), true);
  assert.equal(helper.matchesThirdPartyPlatformSelection('巴西', '43-R', ['43R']), false);
  assert.equal(helper.matchesThirdPartyPlatformSelection('越南', 'PLAYERBR', ['PLAYER BR']), false);
  assert.equal(helper.matchesThirdPartyPlatformSelection('越南', 'POPKKK新', ['POPKKK']), false);
  assert.equal(helper.matchesThirdPartyPlatformSelection('VN', 'POPKKK', ['POPKKK新']), false);
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
test('actual authorized catalog removes duplicate spellings but keeps configured-only platforms', () => {
  const view = pipeline();
  assert.deepEqual(view.platforms, ['43-R', '43R', 'PLAYER BR', 'PLAYER-BR', 'POPKKK', 'RATE_ONLY'].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })));
  assert.equal(view.platforms.filter(name => name === '43R').length, 1);
  assert.equal(view.platforms.filter(name => name === 'PLAYER BR').length, 1);
  assert.equal(view.platforms.filter(name => name === 'POPKKK').length, 1);
  assert.ok(view.platforms.includes('RATE_ONLY')); assert.ok(!view.platforms.includes('VN_RATE_ONLY'));
  assert.equal(view.uniq(view.optionScopedRows.map(row => row.platform)).length, 5);
  assert.equal(view.platforms.length, 6, 'Configured options can legitimately exceed active-volume platforms');
});
test('authorized catalog options are available before any volume response and exclude unregistered payload platforms', () => {
  const catalog = [{ country: '巴西', platform: '43r' }, { country: '巴西', platform: '43R' },
    { country: '巴西', platform: 'RATE_ONLY' }, { country: '越南', platform: 'VN_RATE_ONLY' }];
  const empty = pipeline({ input: [], statusRows: [], catalog });
  assert.deepEqual(empty.platforms, ['43R', 'RATE_ONLY']);
  const loaded = pipeline({ input: [row('secret1', 'NOT_AUTHORIZED', 123, 4)], catalog });
  assert.deepEqual(loaded.platforms, empty.platforms, 'report rows must not widen the authorized platform directory');
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
  const selected = helper.canonicalThirdPartyPlatformSelections('巴西', ['43r', 'PLAYERBR', 'POPKKK新', 'POPKKK']);
  const before = [...selected];
  const html = renderToStaticMarkup(React.createElement(api.VolumeMultiSelect, { label: '平台', options: view.platforms, value: selected, onChange: () => assert.fail('SSR cannot save'), placeholder: '全部平台' }));
  assert.equal((html.match(/<span>43R<\/span>/g) || []).length, 1);
  assert.equal((html.match(/<span>PLAYER BR<\/span>/g) || []).length, 1);
  assert.equal((html.match(/<span>POPKKK<\/span>/g) || []).length, 1);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 6);
  assert.equal((html.match(/checked=""/g) || []).length, 3);
  assert.match(html, /RATE_ONLY/);
  assert.doesNotMatch(html, /<span>43r<\/span>|<span>PLAYERBR<\/span>|POPKKK新/);
  assert.deepEqual(selected, before);
});
test('selecting both aliases cannot duplicate historical amounts or order counts', () => {
  const view = pipeline({ platforms: ['43r', '43R', 'PLAYERBR', 'PLAYER BR', 'POPKKK新', 'POPKKK'] });
  assert.deepEqual(view.filteredBaseNoDate.map(row => row.id), ['r1', 'r2', 'r3', 'r4', 'r5']);
  assert.equal(view.sumRows(view.filteredBaseNoDate).amount, 1500);
  assert.equal(view.sumRows(view.filteredBaseNoDate).count, 150);
});
test('actual selection-retention effect canonicalizes old saved choices instead of clearing them', () => {
  const effect = dashboard.body.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(source) === 'useEffect' && node.expression.arguments[0]?.getText(source).includes('setPlatformSelections(next)'));
  assert.ok(effect, 'Actual selection maintenance effect must exist');
  const callback = effect.expression.arguments[0];
  const view = pipeline({ platforms: ['43r', '43R', 'PLAYERBR', 'PLAYER BR', 'POPKKK新', 'POPKKK', 'REMOVED'] });
  let next, channel, types;
  const context = { ...view, setPlatformSelections: value => { next = value; }, setChannel: value => { channel = value; }, setChannelTypeSelections: value => { types = value; } };
  new Function(...Object.keys(context), compile(`const run = ${callback.getText(source)}; run();`))(...Object.values(context));
  assert.deepEqual(next, ['43R', 'PLAYER BR', 'POPKKK']); assert.equal(channel, ''); assert.deepEqual(types, []);
});
test('catalog loading or failure never clears a platform choice into an all-platform query', () => {
  const effect = dashboard.body.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(source) === 'useEffect' && node.expression.arguments[0]?.getText(source).includes('setPlatformSelections(next)'));
  for (const directory of [{ ready: false, loading: true, error: '' }, { ready: false, loading: false, error: 'denied' }]) {
    const view = pipeline({ platforms: ['43R'], catalog: [] });
    const context = { ...view, filterOptions: { platforms: [], ...directory },
      setPlatformSelections: () => assert.fail('must retain selection while catalog is unavailable'),
      setChannel: () => assert.fail('must retain channel'), setChannelTypeSelections: () => assert.fail('must retain types') };
    new Function(...Object.keys(context), compile(`const run = ${effect.expression.arguments[0].getText(source)}; run();`))(...Object.values(context));
  }
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
  // The selection-retention effect above canonicalizes persisted aliases before submission.
  const context = { ...pipeline({ platforms: ['43R', 'PLAYER BR', 'POPKKK'] }), startDate: '2026-09-09', endDate: '2026-09-10',
    appliedStartDate: '', appliedEndDate: '', channel: '', direction: '', channelTypeSelections: [],
    queryInFlightRef: { current: false }, payloadRef: { current: null },
    loadData: async (...args) => { requests.push(args); return true; },
    ...Object.fromEntries(['IsQuerying', 'AppliedStartDate', 'AppliedEndDate', 'AppliedCountrySelections', 'AppliedPlatformSelections',
      'AppliedChannel', 'AppliedDirection', 'AppliedChannelTypeSelections', 'AppliedCountryPage', 'AppliedViewer', 'LastQueryAt', 'HasQueried']
      .map(name => ['set' + name, value => { writes[name] = value; }])) };
  await new Function(...Object.keys(context), compile(query.getText(source)) + '\nreturn runQuery();')(...Object.values(context));
  assert.deepEqual(writes.AppliedPlatformSelections, ['43R', 'PLAYER BR', 'POPKKK']);
  assert.equal(writes.AppliedCountryPage, '巴西');
  assert.equal(writes.AppliedViewer, 'viewer');
  assert.equal(writes.AppliedStartDate, '2026-09-09'); assert.equal(writes.AppliedEndDate, '2026-09-10');
  assert.deepEqual(requests, [[true, '2026-09-09', '2026-09-10', '', '巴西', true]]);
  assert.equal(writes.IsQuerying, false);
});
test('failed query retains a same-country result but never exposes another country or account result', async () => {
  const query = dashboard.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'runQuery');
  assert.ok(query);
  const writes = {}, queryInFlightRef = { current: false };
  const context = { ...pipeline({ country: '越南' }), mainTab: 'country', activeCountryPage: '越南', appliedCountryPage: '越南',
    appliedViewer: 'viewer',
    startDate: '2026-09-10', endDate: '2026-09-10', appliedStartDate: '2026-09-09', appliedEndDate: '2026-09-09',
    channel: '', direction: '', channelTypeSelections: [], queryInFlightRef,
    payloadRef: { current: { rows: [{ country: '越南' }] } }, loadData: async () => false,
    setCountryPage: value => { writes.CountryPage = value; },
    ...Object.fromEntries(['IsQuerying', 'AppliedStartDate', 'AppliedEndDate', 'AppliedCountrySelections', 'AppliedPlatformSelections',
      'AppliedChannel', 'AppliedDirection', 'AppliedChannelTypeSelections', 'AppliedCountryPage', 'AppliedViewer', 'LastQueryAt', 'HasQueried']
      .map(name => ['set' + name, value => { writes[name] = value; }])) };
  await new Function(...Object.keys(context), compile(query.getText(source)) + '\nreturn runQuery();')(...Object.values(context));
  assert.equal(writes.CountryPage, undefined, 'a failed request must not jump the selected country back');
  assert.equal(writes.AppliedCountryPage, undefined, 'failed filters must not become the applied result');
  assert.equal(writes.HasQueried, true, 'the previous same-country successful payload is retained');
  assert.equal(evaluate('showDailyResult', { ...context, hasQueried: writes.HasQueried }), true);
  assert.equal(evaluate('showDailyResult', { ...context, hasQueried: true, appliedCountryPage: '印度' }), false,
    'an India payload must not render under the Vietnam tab even before the cleanup effect');
  assert.equal(evaluate('showDailyResult', { ...context, hasQueried: true, appliedViewer: 'old-viewer' }), false,
    'an old account payload must not render even before the cleanup effect');
  assert.equal(writes.IsQuerying, false);
  assert.equal(queryInFlightRef.current, false);
});
test('query ref blocks rapid concurrent submits and source ignores stale load completions', async () => {
  const query = dashboard.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'runQuery');
  assert.ok(query);
  let resolveLoad;
  const pending = new Promise(resolve => { resolveLoad = resolve; });
  let calls = 0;
  const queryInFlightRef = { current: false };
  const context = { ...pipeline(), startDate: '2026-09-10', endDate: '2026-09-10', appliedStartDate: '', appliedEndDate: '',
    channel: '', direction: '', channelTypeSelections: [], queryInFlightRef, payloadRef: { current: null },
    loadData: async () => { calls += 1; return pending; },
    ...Object.fromEntries(['IsQuerying', 'AppliedStartDate', 'AppliedEndDate', 'AppliedCountrySelections', 'AppliedPlatformSelections',
      'AppliedChannel', 'AppliedDirection', 'AppliedChannelTypeSelections', 'AppliedCountryPage', 'AppliedViewer', 'LastQueryAt', 'HasQueried']
      .map(name => ['set' + name, () => {}])) };
  const run = new Function(...Object.keys(context), compile(query.getText(source)) + '\nreturn runQuery;')(...Object.values(context));
  const first = run();
  const second = run();
  assert.equal(calls, 1, 'the second submit must not start another request');
  resolveLoad(true);
  await Promise.all([first, second]);
  assert.equal(queryInFlightRef.current, false);

  assert.match(text, /const requestSequence = \+\+loadRequestSequenceRef\.current/);
  assert.match(text, /THIRD_PARTY_VOLUME_QUERY_TIMEOUT_MS = 25_000/);
  assert.match(text, /\[viewerIdentity\]/);
  assert.doesNotMatch(text, /\[session\?\.access_token, profile\]/);
  assert.doesNotMatch(text, /if \(appliedCountryPage\) setCountryPage\(appliedCountryPage\)/);
});
test('mount and identity changes only prefill controls and invalidate old requests, with no report request or timer', () => {
  const effect = dashboard.body.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(source) === 'useEffect'
    && node.expression.arguments[1]?.getText(source) === '[viewerIdentity]');
  assert.ok(effect, 'Account/scope initialization effect must exist');
  const invalidate = dashboard.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'invalidateQuery');
  let aborted = 0, cleared = 0;
  const writes = {};
  const context = {
    profile: {}, COUNTRY_NAV_TABS: ['印度', '巴基斯坦'],
    sourceDay: (zone, offset) => orderClock.sourceDay(zone, offset, Date.parse('2026-09-19T12:00:00Z')),
    effectiveDashboardDataScope: () => ({ mode: 'all' }), dashboardScopeAllows: () => true,
    queryIntentRef: { current: 7 }, loadRequestSequenceRef: { current: 9 },
    loadFlightRef: { current: { abort: () => { aborted += 1; } } }, queryInFlightRef: { current: true },
    payloadRef: { current: { rows: [{ country: '印度' }] } }, timeQuery: { clearResult: () => { cleared += 1; } },
    loadData: () => assert.fail('mount/account change must not request a business report'),
    dashboardBusinessFetch: () => assert.fail('mount/account change must not fetch business data'),
    setInterval: () => assert.fail('there must be no automatic report refresh interval'),
    ...Object.fromEntries(['StartDate', 'EndDate', 'CountryPage', 'PlatformSelections', 'CountrySelections', 'Channel',
      'ChannelTypeSelections', 'RatePayload', 'IsQuerying', 'HasQueried', 'Payload', 'VolumeSyncStatus', 'Error',
      'DataNotice', 'SummaryQueryError', 'LegacySummaryNotice', 'State'].map(name => ['set' + name,
        value => { writes[name] = typeof value === 'function' ? value('') : value; }]))
  };
  const cleanup = new Function(...Object.keys(context), compile(`${invalidate.getText(source)}\nconst run = ${effect.expression.arguments[0].getText(source)};`)
    + '\nreturn run();')(...Object.values(context));
  assert.equal(writes.StartDate, '2026-09-18'); assert.equal(writes.CountryPage, '印度');
  assert.equal(writes.HasQueried, false); assert.equal(writes.Payload, null);
  assert.equal(context.payloadRef.current, null); assert.equal(context.queryInFlightRef.current, false);
  assert.equal(context.queryIntentRef.current, 8); assert.equal(context.loadRequestSequenceRef.current, 10);
  assert.equal(cleared, 1); assert.equal(aborted, 1);
  cleanup();
  assert.equal(context.queryIntentRef.current, 9); assert.equal(context.loadRequestSequenceRef.current, 11);
  assert.equal(aborted, 2);
  for (const statement of dashboard.body.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)
      || statement.expression.expression.getText(source) !== 'useEffect') continue;
    assert.doesNotMatch(statement.expression.arguments[0]?.getText(source) || '', /\bloadData\s*\(|\brunQuery\s*\(/,
      'business queries must remain an explicit submit action');
  }
});

function loadHarness(overrides = {}) {
  const writes = [], requests = [];
  const payload = { rows: [row('p1', 'PK_TEST', 10, 2, { country: '巴基斯坦' })] };
  const response = value => ({ ok: true, status: 200, json: async () => value });
  const context = {
    profile: {}, ratePayload: null, loadRequestSequenceRef: { current: 0 }, queryContextRef: { current: 'viewer:巴基斯坦' },
    loadFlightRef: { current: null }, payloadRef: { current: null },
    THIRD_PARTY_VOLUME_QUERY_TIMEOUT_MS: 25_000, THIRD_PARTY_VOLUME_QUERY_TIMEOUT_SECONDS: 25,
    THIRD_PARTY_RATES_QUERY_TIMEOUT_MS: 12_000, THIRD_PARTY_VOLUME_CACHE_KEY: 'volume', THIRD_PARTY_RATES_CACHE_KEY: 'rates',
    thirdPartyVolumeApiUrl: () => '/volume', thirdPartySyncStatusApiUrl: () => '/status',
    readLocalCache: () => null, writeLocalCache: (...args) => writes.push(['cache', ...args]),
    ratePayloadUsable: value => Boolean(value?.usable), ratePayloadFresh: () => false,
    effectiveDashboardDataScope: () => ({ mode: 'all' }), isDashboardDataDenied: () => false,
    safeReadJson: response => response.json(), rangeIncludesCurrentMonth: () => true,
    sortCountries: values => values, defaultStart: () => '2026-09-10', defaultEnd: () => '2026-09-10',
    dateMatches: () => true, rowMatchesRequestedCountry: (row, country) => row.country === country,
    attachClientFallbackMessage: value => value,
    dashboardBusinessFetch: async (url, options) => {
      requests.push([url, options]);
      return response(url === '/volume' ? payload : url === '/status' ? { ok: true } : { usable: true });
    },
    ...Object.fromEntries(['State', 'Error', 'Payload', 'RatePayload', 'DataNotice', 'VolumeSyncStatus', 'KnownCountries', 'StartDate', 'EndDate']
      .map(name => ['set' + name, value => writes.push([name, value])])),
    ...overrides,
  };
  const declaration = dashboard.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'loadData');
  const run = new Function(...Object.keys(context), compile(declaration.getText(source)) + '\nreturn loadData;')(...Object.values(context));
  return { context, writes, requests, response, run };
}

test('country/account invalidation during rate or status JSON parsing prevents every late data/cache commit', async () => {
  for (const pauseAt of ['rates', 'status']) {
    let reached, resume;
    const waiting = new Promise(resolve => { reached = resolve; });
    const blocked = new Promise(resolve => { resume = resolve; });
    const harness = loadHarness({ dashboardBusinessFetch: async url => ({ ok: true, status: 200, json: async () => {
      const kind = url === '/volume' ? 'volume' : url === '/status' ? 'status' : 'rates';
      if (kind === pauseAt) { reached(); await blocked; }
      return kind === 'volume' ? { rows: [row('late1', 'PK_TEST', 10, 2, { country: '巴基斯坦' })] }
        : kind === 'rates' ? { usable: true } : { ok: true };
    } }) });
    const pending = harness.run(true, '2026-09-10', '2026-09-10', '', '巴基斯坦', true);
    await waiting;
    const before = [...harness.writes];
    harness.context.queryContextRef.current = 'new-viewer:印度';
    ++harness.context.loadRequestSequenceRef.current;
    harness.context.loadFlightRef.current.abort();
    resume();
    assert.equal(await pending, false);
    assert.deepEqual(harness.writes, before, `${pauseAt}: invalidated response cannot change data, notices, loading or cache`);
    assert.equal(harness.context.payloadRef.current, null);
  }
});

test('volume request retains its 25-second timeout and handles abort without publishing fake zero rows', async () => {
  const deadlines = [], controllers = [];
  const harness = loadHarness({ AbortSignal: {
    any: signals => globalThis.AbortSignal.any(signals),
    timeout: milliseconds => {
      deadlines.push(milliseconds);
      const controller = new AbortController(); controllers.push(controller); return controller.signal;
    },
  }, dashboardBusinessFetch: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  const pending = harness.run(true, '2026-09-10', '2026-09-10', '', '巴基斯坦', true);
  assert.equal(deadlines[0], 25_000);
  for (const controller of controllers) controller.abort(new DOMException('deadline', 'TimeoutError'));
  assert.equal(await pending, false);
  assert.ok(harness.writes.some(([name, value]) => name === 'Error' && /25/.test(value)));
  assert.equal(harness.writes.some(([name]) => name === 'Payload' || name === 'cache'), false);
  assert.equal(harness.context.payloadRef.current, null);
});

test('country switch invalidates an in-flight submit including its finally cleanup', async () => {
  const query = dashboard.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'runQuery');
  let resume;
  const waiting = new Promise(resolve => { resume = resolve; });
  const writes = [];
  const context = { ...pipeline(), startDate: '2026-09-10', endDate: '2026-09-10', appliedStartDate: '', appliedEndDate: '',
    channel: '', direction: '', channelTypeSelections: [], queryInFlightRef: { current: false }, payloadRef: { current: null },
    loadData: async () => waiting,
    ...Object.fromEntries(['IsQuerying', 'AppliedStartDate', 'AppliedEndDate', 'AppliedCountrySelections', 'AppliedPlatformSelections',
      'AppliedChannel', 'AppliedDirection', 'AppliedChannelTypeSelections', 'AppliedCountryPage', 'AppliedViewer', 'LastQueryAt', 'HasQueried']
      .map(name => ['set' + name, value => writes.push([name, value])])) };
  const run = new Function(...Object.keys(context), compile(query.getText(source)) + '\nreturn runQuery;')(...Object.values(context));
  const pending = run();
  context.queryContextRef.current = 'viewer:巴基斯坦'; ++context.queryIntentRef.current;
  // A newer country request owns this shared busy flag now.
  context.queryInFlightRef.current = true;
  const before = [...writes]; resume(true); await pending;
  assert.deepEqual(writes, before, 'late submit cannot publish filters or clear the newer request busy state');
  assert.equal(context.queryInFlightRef.current, true);
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
  const context = { uniq: view.uniq, rows: view.optionScopedRows, platformCoverage: undefined };
  const result = new Function(...Object.keys(context), compile(`const result = ${card.getText(source)};`) + '\nreturn result;')(...Object.values(context));
  assert.equal(result.helper, '当前有数据的平台');
  assert.equal(result.value, 5); assert.equal(view.platforms.length, 6);
});
test('confirmed POPKKK historical aliases filter together once while identical Vietnamese spellings remain separate', () => {
  const input = [row('p1', 'POPKKK', 125, 10), row('p2', 'POPKKK新', 250, 20, { date: '2026-09-09', direction: '代付', channel: 'USDT', rawChannel: 'USDT', channelType: 'USDT' }),
    row('p3', 'POPKKK新', 500, 40, { country: '越南' }), row('p4', 'POPKKK-新', 1000, 80)];
  const before = structuredClone(input);
  for (const platforms of [['POPKKK新'], ['POPKKK'], ['POPKKK新', 'POPKKK']]) {
    const view = pipeline({ input, platforms });
    assert.deepEqual(view.filteredBaseNoDate.map(row => row.id), ['p1', 'p2']);
    assert.deepEqual(view.channelOptionRows.map(row => row.id), ['p1', 'p2']);
    assert.deepEqual(view.channels, ['PIX', 'USDT']);
    assert.deepEqual(view.channelTypeOptions, ['PIX', 'USDT']);
    assert.deepEqual(view.sumRows(view.filteredBaseNoDate), { amount: 375, count: 30, collectAmount: 125, collectCount: 10, payoutAmount: 250, payoutCount: 20 });
    const groups = view.aggregateCombo(view.rows, row => [row.country, row.platform]);
    assert.equal(groups.length, 3);
    assert.equal(groups.reduce((sum, group) => sum + group.totalAmount, 0), 1875);
    assert.equal(groups.reduce((sum, group) => sum + group.totalCount, 0), 150);
    assert.equal(groups.find(group => group.labelParts[0] === '巴西' && group.labelParts[1] === 'POPKKK').totalAmount, 375);
    assert.equal(groups.find(group => group.labelParts[0] === '越南' && group.labelParts[1] === 'POPKKK新').totalAmount, 500);
  }
  assert.deepEqual(input, before, 'Every historical raw platform and numeric value remains intact');
});
test('new POPKKK canonicalization never loses numeric/status fields when joining the display group', () => {
  const input = [row('p1', 'POPKKK', 321.5, 13), row('p2', 'POPKKK新', 678.5, 17)];
  const view = pipeline({ input, platforms: ['POPKKK', 'POPKKK新'] });
  assert.equal(view.filteredBaseNoDate.length, 2);
  assert.deepEqual(view.filteredBaseNoDate.map(row => row.platform), ['POPKKK', 'POPKKK']);
  for (const field of ['amount', 'count', 'successCount', 'failedCount'])
    assert.equal(view.filteredBaseNoDate.reduce((sum, row) => sum + row[field], 0), input.reduce((sum, row) => sum + row[field], 0));
  assert.equal(view.sumRows(view.filteredBaseNoDate).amount, 1000);
  assert.equal(view.sumRows(view.filteredBaseNoDate).count, 30);
});

test('actual Brazil and Panghu volume panes partition historical rows before options and filters', () => {
  const input=[row('g1','776F',100,10),row('g2','776F',200,20,{country:'胖虎巴西',date:'2026-09-09'}),
    row('g3','POPNOV',300,30,{country:'胖虎巴西'}),row('g4','POPFEZ',400,40,{country:'胖虎巴西'}),
    row('g5','POPCRA',500,50),row('g6','776F',600,60,{country:'越南'})];
  const statusRows=[{country:'巴西',platform:'776F'},{country:'胖虎巴西',platform:'POPNOV'},
    {country:'胖虎巴西',platform:'POPFEZ'},{country:'巴西',platform:'POPCRA'}];
  const before=structuredClone({input,statusRows});
  for(const [country,expectedIds,expectedPlatforms] of [
    ['胖虎巴西',['g1','g2'],['776F']],['巴西',['g3','g4','g5'],['POPCRA','POPFEZ','POPNOV']],['越南',['g6'],['776F']],
  ]) {
    const result=pipeline({input,statusRows,country});
    assert.deepEqual(result.filteredBaseNoDate.map(r=>r.id).sort(),expectedIds);
    assert.deepEqual([...result.platforms].sort(),expectedPlatforms);
    const expected=input.filter(r=>expectedIds.includes(r.id));
    for(const key of ['amount','count','successCount','failedCount'])
      assert.equal(result.filteredBaseNoDate.reduce((sum,r)=>sum+r[key],0),expected.reduce((sum,r)=>sum+r[key],0));
  }
  assert.deepEqual({input,statusRows},before);
});

test('actual configured-only 776F option belongs to Panghu without inventing a volume record',()=>{
  const input=[row('g1','SSS55',75,3)],statusRows=[{country:'巴西',platform:'776F'},{country:'胖虎巴西',platform:'POPNOV'}];
  const panghu=pipeline({input,statusRows,country:'胖虎巴西'}),brazil=pipeline({input,statusRows,country:'巴西'});
  assert.deepEqual(panghu.platforms,['776F']); assert.equal(panghu.filteredBaseNoDate.length,0);
  assert.ok(brazil.platforms.includes('POPNOV')); assert.ok(!brazil.platforms.includes('776F'));
  assert.equal(brazil.filteredBaseNoDate.length,1); assert.equal(brazil.filteredBaseNoDate[0].amount,75);
});
