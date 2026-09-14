const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const nativeRequire = createRequire(path.join(root, 'package.json'));
const PRIVATE = 'DO_NOT_FORWARD_SYNTHETIC_SECRET';
const title = "印度 O'Brien ! tab";
function fixtures() {
  const properties = { sheetId: 0, title, index: 1, sheetType: 'GRID', gridProperties: { rowCount: 1000, columnCount: 49, frozenRowCount: 2, frozenColumnCount: 1 } };
  const merges = [{ sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: 4 }, { startRowIndex: 2, endRowIndex: 4, startColumnIndex: 1, endColumnIndex: 2 }];
  const metadata = {
    spreadsheetId: PRIVATE, spreadsheetUrl: PRIVATE,
    properties: { title: '原始费率', defaultFormat: { backgroundColor: { red: 1, green: 1, blue: 1 }, textFormat: { fontFamily: 'Arial', fontSize: 10, foregroundColor: {} }, verticalAlignment: 'BOTTOM', wrapStrategy: 'OVERFLOW_CELL' }, spreadsheetTheme: { themeColors: [{ colorType: 'ACCENT1', color: { rgbColor: { red: 0.8, green: 0.1, blue: 0.2 } } }] } },
    sheets: [
      { properties: { ...properties, sheetId: 9, title: '巴西', index: 0 } },
      { properties, merges },
      { properties: { ...properties, sheetId: 77, title: PRIVATE, hidden: true, index: 2 } },
    ],
  };
  const values = [['三方', '类型'], ['OXPay', '', '4.50%', '', '类型'], [], [], ['', '', '', '', '', 0]];
  const grid = { sheets: [{ properties, merges, data: [
    { startRow: 0, startColumn: 0,
      rowData: [
        { values: [{ formattedValue: '三方', effectiveFormat: { backgroundColorStyle: { themeColor: 'ACCENT1' }, textFormat: { bold: true } } }, { formattedValue: '类型' }] },
        { values: [{ formattedValue: 'OXPay', hyperlink: PRIVATE, note: PRIVATE, userEnteredValue: { formulaValue: PRIVATE }, effectiveFormat: { textFormat: { link: { uri: PRIVATE }, bold: false }, borders: { bottom: { style: 'DOUBLE', colorStyle: { themeColor: 'ACCENT1' } } } } }, { formattedValue: '001', effectiveValue: { stringValue: '001' }, textFormatRuns: [{ format: { bold: true, link: { uri: PRIVATE }, foregroundColorStyle: { themeColor: 'ACCENT1' } } }, { startIndex: 1, format: { italic: true } }] }, { formattedValue: '4.50%', effectiveValue: { numberValue: .045 } }] },
        { values: [{ formattedValue: '', effectiveFormat: { backgroundColor: { red: 1, green: 1 } } }] },
      ],
      rowMetadata: [{ pixelSize: 31 }, { pixelSize: 42 }, { pixelSize: 0, hiddenByUser: true }, { pixelSize: 25, hiddenByFilter: true }],
      columnMetadata: [{ pixelSize: 145 }, { pixelSize: 61 }, { pixelSize: 90, hiddenByUser: true }],
    },
    { startRow: 4, startColumn: 5, rowData: [{ values: [{ formattedValue: '0', effectiveValue: { numberValue: 0 } }] }], rowMetadata: [{ pixelSize: 35 }], columnMetadata: [{ pixelSize: 127, hiddenByFilter: true }] },
  ] }] };
  return { metadata, values, grid };
}
function harness(overrides = {}, env = {}) {
  const state = { ...fixtures(), profile: { auth_user_id: 'synthetic-user', username: 'synthetic', role: 'viewer', active: true, permissions: { third_party: true }, data_scope: { mode: 'all', countries: [] }, ...overrides }, authStatus: 200, profileStatus: 200, authCalls: [], googleCalls: [], jwtCalls: [], googleError: null, now: Date.parse('2026-09-14T00:00:00Z') };
  const environment = { NEXT_PUBLIC_SUPABASE_URL: 'https://scope-preview.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'synthetic@example.invalid', GOOGLE_PRIVATE_KEY: 'synthetic-key', ...env };
  const modules = new Map();
  const google = { auth: { JWT: class { constructor(options) { state.jwtCalls.push(options); } } }, sheets: () => ({ spreadsheets: {
    get: async (params, options) => { state.googleCalls.push({ kind: params.ranges ? 'grid' : 'metadata', params, options }); if (state.googleError) throw state.googleError; return { data: structuredClone(params.ranges ? state.grid : state.metadata) }; },
    values: { get: async (params, options) => { state.googleCalls.push({ kind: 'values', params, options }); if (state.googleError) throw state.googleError; return { data: { values: structuredClone(state.values) } }; } },
  } }) };
  const fetch = async (input, init) => {
    const url = new URL(input); assert.equal(url.origin, 'https://scope-preview.invalid', 'only mocked auth requests permitted'); state.authCalls.push({ url, init });
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'synthetic-user', user_metadata: { role: 'owner', data_scope: { mode: 'all' } } }, { status: state.authStatus });
    if (url.pathname === '/rest/v1/dashboard_profiles') return Response.json([state.profile], { status: state.profileStatus });
    throw new Error('unexpected network path');
  };
  class Clock extends Date { constructor(value = state.now) { super(value); } static now() { return state.now; } }
  function load(file) {
    file = path.resolve(root, file); if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const require = specifier => {
      if (specifier === 'googleapis') return { google };
      const resolved = specifier.startsWith('@/') ? path.join(root, 'src', specifier.slice(2)) : specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : null;
      if (resolved && fs.existsSync(resolved + '.ts')) return load(resolved + '.ts');
      return nativeRequire(specifier);
    };
    new Function('require', 'module', 'exports', 'fetch', 'process', 'Date', compiled)(require, module, module.exports, fetch, { ...process, env: environment }, Clock);
    return module.exports;
  }
  const api = () => load('src/app/api/original-rate-sheet/route.ts');
  const request = (query = '', headers = { Authorization: 'Bearer synthetic-session' }) => new Request('https://site-preview.invalid/api/original-rate-sheet' + query, { headers });
  return { state, environment, get: (query, headers) => api().GET(request(query, headers)) };
}
function assertPrivate(response) {
  for (const header of ['cache-control', 'netlify-cdn-cache-control', 'cdn-cache-control']) assert.match(response.headers.get(header), /private.*no-store/);
  assert.match(response.headers.get('vary'), /Authorization/); assert.equal(response.headers.get('etag'), null);
}

test('original sheet metadata returns visible native titles and order only', async () => {
  const h = harness(); const response = await h.get(); assert.equal(response.status, 200); assertPrivate(response);
  const data = await response.json(); assert.deepEqual(data.sheets.map(s => [s.sheetId, s.title, s.index]), [[9, '巴西', 0], [0, title, 1]]);
  assert.equal(data.sheets[1].rowCount, 1000); assert.equal(data.sheets[1].columnCount, 49); assert.equal(data.sheets[1].frozenRowCount, 2); assert.equal(data.sheets[1].frozenColumnCount, 1);
  assert.equal(data.title, '原始费率'); assert.equal(data.fetchedAt, '2026-09-14T00:00:00.000Z'); assert.doesNotMatch(JSON.stringify(data), new RegExp(PRIVATE));
  assert.deepEqual(h.state.googleCalls.map(c => c.kind), ['metadata']); assert.equal(h.state.authCalls.length, 2);
  assert.match(h.state.googleCalls[0].params.fields, /defaultFormat,spreadsheetTheme/); assert.deepEqual(h.state.jwtCalls[0].scopes, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
});
test('full populated native grid retains holes, zero, merged cells, exact dimensions, formatting, and offset metadata', async () => {
  const h = harness(), response = await h.get('?sheetId=0'); assert.equal(response.status, 200); assertPrivate(response);
  const data = await response.json(); assert.equal(data.rowCount, 5); assert.equal(data.columnCount, 6); assert.equal(data.cells.length, 5); assert.ok(data.cells.every(row => row.length === 6));
  assert.equal(data.cells[3][4].text, ''); assert.equal(data.cells[4][5].text, '0'); assert.equal(data.cells[4][5].format.horizontalAlignment, 'RIGHT');
  assert.equal(data.cells[1][2].text, '4.50%'); assert.equal(data.cells[1][2].format.horizontalAlignment, 'RIGHT'); assert.equal(data.cells[1][1].format.horizontalAlignment, 'LEFT');
  assert.deepEqual(data.cells[0][0].format.backgroundColor, { red: .8, green: .1, blue: .2 }); assert.equal(data.cells[0][0].format.textFormat.fontSize, 10); assert.equal(data.cells[0][0].format.textFormat.bold, true);
  assert.equal(data.cells[1][0].format.textFormat.bold, false); assert.equal(data.cells[1][0].format.borders.bottom.style, 'DOUBLE'); assert.deepEqual(data.cells[1][0].format.borders.bottom.color, { red: .8, green: .1, blue: .2 });
  assert.deepEqual(data.cells[1][1].runs, [{ startIndex: 0, format: { bold: true, foregroundColor: { red: .8, green: .1, blue: .2 } } }, { startIndex: 1, format: { italic: true } }]);
  assert.deepEqual(data.rowHeights, [31, 42, 0, 25, 35]); assert.deepEqual(data.columnWidths, [145, 61, 90, 100, 100, 127]); assert.deepEqual(data.hiddenRows, [2, 3]); assert.deepEqual(data.hiddenColumns, [2, 5]);
  assert.equal(data.merges.length, 2); assert.deepEqual(data.merges[0], { startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: 4 });
  assert.deepEqual(data.cells[2][0].format.backgroundColor, { red: 1, green: 1 }); assert.doesNotMatch(JSON.stringify(data), new RegExp(PRIVATE)); assert.doesNotMatch(JSON.stringify(data), /effectiveValue|formulaValue|hyperlink|"note"|userEnteredValue/);
  assert.deepEqual(h.state.googleCalls.map(c => c.kind), ['metadata', 'values', 'grid']); assert.equal(h.state.googleCalls[1].params.range, "'印度 O''Brien ! tab'!A1:AW1000"); assert.deepEqual(h.state.googleCalls[2].params.ranges, ["'印度 O''Brien ! tab'!A1:F5"]);
  const gridFields = h.state.googleCalls[2].params.fields; assert.match(gridFields, /formattedValue,effectiveValue,effectiveFormat,textFormatRuns/); assert.doesNotMatch(gridFields, /userEnteredValue|hyperlink|note/);
});
test('untrusted formulas and rich text are inert display-only strings, never returned as executable content', async () => {
  const h = harness(); h.state.grid.sheets[0].data[0].rowData[1].values[0].formattedValue = '<img src=x onerror=alert(1)>';
  h.state.grid.sheets[0].data[0].rowData[1].values[0].effectiveValue = { formulaValue: '=SECRET()', boolValue: true };
  const response = await h.get('?sheetId=0'); const data = await response.json(); assert.equal(data.cells[1][0].text, '<img src=x onerror=alert(1)>'); assert.equal(data.cells[1][0].format.horizontalAlignment, 'CENTER'); assert.doesNotMatch(JSON.stringify(data), /SECRET\(\)|formulaValue/);
});
test('explicit cell RGB overrides default theme styles without losing other defaults', async () => {
  const h = harness(); h.state.metadata.properties.defaultFormat.backgroundColorStyle = { themeColor: 'ACCENT1' };
  h.state.metadata.properties.defaultFormat.textFormat.foregroundColorStyle = { themeColor: 'ACCENT1' };
  h.state.grid.sheets[0].data[0].rowData[2].values[0].effectiveFormat.textFormat = { foregroundColor: {} };
  const data = await (await h.get('?sheetId=0')).json();
  assert.deepEqual(data.cells[2][0].format.backgroundColor, { red: 1, green: 1 });
  assert.deepEqual(data.cells[2][0].format.textFormat.foregroundColor, {});
  assert.equal(data.cells[2][0].format.textFormat.fontSize, 10);
});
for (const query of ['', '?sheetId=0']) test('anonymous is denied before any configuration/cache/source read ' + query, async () => {
  const h = harness(); let response = await h.get(query); assert.equal(response.status, 200); const reads = h.state.googleCalls.length;
  response = await h.get(query, {}); assert.equal(response.status, 401); assertPrivate(response); assert.equal(h.state.googleCalls.length, reads); assert.equal(h.state.authCalls.length, 2);
});
test('fresh profile/module/scope authorization runs before every cached response', async () => {
  const h = harness(); let response = await h.get('?sheetId=0'); assert.equal(response.status, 200); const old = await response.json();
  response = await h.get('?sheetId=0'); assert.equal(response.status, 200); assert.deepEqual(await response.json(), old); assert.equal(h.state.googleCalls.length, 3); assert.equal(h.state.authCalls.length, 4);
  h.state.profile.permissions.third_party = false; response = await h.get('?sheetId=0'); assert.equal(response.status, 403); assert.equal(h.state.googleCalls.length, 3); assertPrivate(response);
  h.state.profile.permissions.third_party = true; h.state.profile.data_scope = { mode: 'selected', countries: ['BR_PANGHU'] }; response = await h.get('?sheetId=0'); assert.equal(response.status, 403); assert.equal(h.state.googleCalls.length, 3); assert.equal(h.state.authCalls.length, 8);
  assert.doesNotMatch(await response.text(), /原始费率|OXPay/);
});
for (const overrides of [{ permissions: {} }, { active: false }, { role: 'admin', data_scope: { mode: 'selected', countries: ['BR'] } }, { data_scope: { mode: 'all', countries: ['BR'] } }]) test('invalid/restricted profile never reads original data ' + JSON.stringify(overrides), async () => {
  const h = harness(overrides); const response = await h.get(); assert.equal(response.status, 403); assert.equal(h.state.googleCalls.length, 0); assertPrivate(response);
});
test('same-tab concurrent cache miss is singleflight without sharing authorization', async () => {
  const h = harness(); const responses = await Promise.all([h.get('?sheetId=0'), h.get('?sheetId=0'), h.get('?sheetId=0')]);
  assert.ok(responses.every(r => r.status === 200)); assert.equal(h.state.googleCalls.length, 3); assert.equal(h.state.authCalls.length, 6);
});
test('five-minute cache expiry refetches rather than pretending data is newly collected', async () => {
  const h = harness(); const old = await (await h.get('?sheetId=0')).json(); h.state.now += 299_000;
  const cached = await (await h.get('?sheetId=0')).json(); assert.equal(cached.fetchedAt, old.fetchedAt); assert.equal(h.state.googleCalls.length, 3);
  h.state.now += 2_000; const fresh = await (await h.get('?sheetId=0')).json(); assert.notEqual(fresh.fetchedAt, old.fetchedAt); assert.equal(h.state.googleCalls.length, 6);
});
for (const query of ['?sheetId=-1', '?sheetId=', '?sheetId=01', '?sheetId=1.5', '?sheetId=1e2', '?sheetId=2147483648', '?sheetId=0&sheetId=9', '?range=A1:B2', '?spreadsheetId=attacker', '?sheetId=0&refresh=1']) test('rejects unsupported client source selection: ' + query, async () => {
  const h = harness(); const response = await h.get(query); assert.equal(response.status, 400); assertPrivate(response); assert.equal(h.state.googleCalls.length, 0);
});
for (const id of [77, 999]) test('hidden/unknown native gid cannot expose source data ' + id, async () => {
  const h = harness(); const response = await h.get('?sheetId=' + id); assert.equal(response.status, 404); assertPrivate(response); assert.equal(h.state.googleCalls.length, 1); assert.doesNotMatch(await response.text(), new RegExp(PRIVATE));
});
test('source credential/configuration failures are private and fixed, no raw credential text', async () => {
  for (const env of [{ GOOGLE_PRIVATE_KEY: '' }, { GOOGLE_SERVICE_ACCOUNT_EMAIL: '' }, { THIRD_PARTY_RATE_SHEET_ID: 'https://attacker.invalid/' }]) {
    const h = harness({}, env); const response = await h.get(); assert.equal(response.status, 503); assertPrivate(response); assert.equal(h.state.googleCalls.length, 0);
    const body = await response.json();
    assert.equal(body.code, env.THIRD_PARTY_RATE_SHEET_ID ? 'original_sheet_source_invalid' : 'original_sheet_google_not_configured');
    assert.match(body.message, env.THIRD_PARTY_RATE_SHEET_ID ? /原表来源地址配置不正确/ : /原表 Google 只读连接尚未配置/);
    assert.doesNotMatch(JSON.stringify(body), /GOOGLE_|attacker|synthetic-key|synthetic@example/);
  }
});
test('source env aliases match existing precedence and accept official Google Sheets file URLs', async () => {
  const primary = 'primary_source_12345', secondary = 'secondary_source_12345', tertiary = 'tertiary_source_12345';
  for (const [env, expected] of [
    [{ THIRD_PARTY_RATE_SHEET_ID: primary, THIRD_PARTY_RATE_SPREADSHEET_ID: secondary, THIRD_PARTY_RATE_SHEET_URL: `https://docs.google.com/spreadsheets/d/${tertiary}/edit` }, primary],
    [{ THIRD_PARTY_RATE_SHEET_ID: '', THIRD_PARTY_RATE_SPREADSHEET_ID: secondary, THIRD_PARTY_RATE_SHEET_URL: `https://docs.google.com/spreadsheets/d/${tertiary}/edit` }, secondary],
    [{ THIRD_PARTY_RATE_SHEET_URL: `https://docs.google.com/spreadsheets/d/${tertiary}/edit?pli=1&gid=277747449#gid=277747449` }, tertiary],
    [{ THIRD_PARTY_RATE_SHEET_ID: `https://docs.google.com/spreadsheets/d/${primary}/edit#gid=0` }, primary],
    [{ THIRD_PARTY_RATE_SPREADSHEET_ID: `https://docs.google.com/spreadsheets/d/${secondary}` }, secondary],
    [{ THIRD_PARTY_RATE_SHEET_URL: `https://docs.google.com/spreadsheets/d/${tertiary}/htmlview` }, tertiary],
  ]) {
    const h = harness({}, env); const response = await h.get(); assert.equal(response.status, 200); assert.equal(h.state.googleCalls[0].params.spreadsheetId, expected);
  }
});
test('source configuration rejects non-Google URLs and never falls back past an invalid higher-priority value', async () => {
  for (const url of [
    'https://attacker.invalid/spreadsheets/d/alternate_source_12345/edit',
    'http://docs.google.com/spreadsheets/d/alternate_source_12345/edit',
    'https://docs.google.com.attacker.invalid/spreadsheets/d/alternate_source_12345/edit',
    'https://user:password@docs.google.com/spreadsheets/d/alternate_source_12345/edit',
    'https://docs.google.com:444/spreadsheets/d/alternate_source_12345/edit',
    'https://docs.google.com/document/d/alternate_source_12345/edit',
    'https://docs.google.com/spreadsheets/d/alternate_source_12345/not-a-file-view',
  ]) {
    const h = harness({}, { THIRD_PARTY_RATE_SHEET_ID: url, THIRD_PARTY_RATE_SPREADSHEET_ID: 'valid_lower_priority_12345' }); const response = await h.get();
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'original_sheet_source_invalid'); assert.equal(h.state.googleCalls.length, 0); assertPrivate(response);
  }
});
test('Google errors are sanitized and never negative-cached or passed through as successful data', async () => {
  const h = harness(); h.state.googleError = new Error('Google invalid key ' + PRIVATE); let response = await h.get('?sheetId=0'); assert.equal(response.status, 503); assertPrivate(response); assert.doesNotMatch(await response.text(), new RegExp(PRIVATE));
  h.state.googleError = null; response = await h.get('?sheetId=0'); assert.equal(response.status, 200); assert.equal(h.state.googleCalls.length, 4);
});
test('auth outages deny cached source data, no stale-success fallback', async () => {
  const h = harness(); await h.get('?sheetId=0'); h.state.authStatus = 500; const response = await h.get('?sheetId=0'); assert.equal(response.status, 503); assertPrivate(response); assert.equal(h.state.googleCalls.length, 3);
});
test('oversized source allocation returns explicit error without scanning/truncating data', async () => {
  const h = harness(); h.state.metadata.sheets[1].properties.gridProperties.rowCount = 10001; const response = await h.get('?sheetId=0'); assert.equal(response.status, 413); assert.match((await response.json()).message, /未截断/); assert.equal(h.state.googleCalls.length, 1); assertPrivate(response);
});
test('merges extend bounds through blank tails and never collapse source rows', async () => {
  const h = harness(); h.state.metadata.sheets[1].merges.push({ startRowIndex: 5, endRowIndex: 7, startColumnIndex: 5, endColumnIndex: 8 }); h.state.grid.sheets[0].merges = h.state.metadata.sheets[1].merges;
  const response = await h.get('?sheetId=0'); assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.rowCount, 7); assert.equal(data.columnCount, 8); assert.equal(data.merges.length, 3); assert.equal(data.cells[6][7].text, '');
});
test('metadata title change during grid read produces explicit retry error', async () => {
  const h = harness(); h.state.grid.sheets[0].properties = { ...h.state.grid.sheets[0].properties, title: 'new title' }; const response = await h.get('?sheetId=0'); assert.equal(response.status, 503); assert.equal((await response.json()).code, 'original_sheet_changed'); assertPrivate(response);
});
