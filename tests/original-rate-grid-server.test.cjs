const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const nativeRequire = createRequire(path.join(root, 'package.json'));
const PRIVATE = 'DO_NOT_FORWARD_SYNTHETIC_SECRET';
const ORIGIN = 'https://scope-preview.invalid';
const RPC = '/rest/v1/rpc/dashboard_original_rate_sheet';
function fixtures() {
  const sheet = { sheetId: 0, title: "印度 O'Brien ! tab", index: 1, rowCount: 1000, columnCount: 49, frozenRowCount: 2, frozenColumnCount: 1, hidden: false };
  const metadata = { title: '原始费率', sheets: [{ ...sheet, sheetId: 9, title: '巴西', index: 0 }, sheet], fetchedAt: '2026-09-14T00:00:00.000Z' };
  const cells = Array.from({ length: 5 }, () => Array.from({ length: 6 }, () => ({ text: '' })));
  cells[0][0] = { text: '三方', format: { backgroundColor: { red: .8, green: .1, blue: .2 }, textFormat: { fontSize: 10, fontFamily: 'Arial', bold: true, foregroundColor: {} }, verticalAlignment: 'MIDDLE', horizontalAlignment: 'CENTER', wrapStrategy: 'WRAP', padding: { left: 4 }, textRotation: { angle: 10 } } };
  cells[1][0] = { text: 'SUPER', format: { textFormat: { bold: false }, borders: { bottom: { style: 'DOUBLE', color: { red: 1 }, width: 3 } } } };
  cells[1][1] = { text: '001', runs: [{ startIndex: 0, format: { bold: true } }, { startIndex: 1, format: { italic: true, foregroundColor: { blue: 1 } } }] };
  cells[1][2] = { text: '4.50%', format: { horizontalAlignment: 'RIGHT' } };
  cells[4][5] = { text: '0' };
  const grid = { sheet, cells, merges: [{ startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: 4 }, { startRowIndex: 2, endRowIndex: 4, startColumnIndex: 1, endColumnIndex: 2 }],
    rowHeights: [31, 42, 0, 25, 35], columnWidths: [145, 61, 90, 100, 100, 127], hiddenRows: [2, 3], hiddenColumns: [2, 5], fetchedAt: metadata.fetchedAt, rowCount: 5, columnCount: 6 };
  return { metadata, grid };
}
function harness(overrides = {}, env = {}) {
  const state = { ...fixtures(), profile: { auth_user_id: 'synthetic-user', username: 'synthetic', role: 'viewer', active: true, permissions: { third_party: true }, data_scope: { mode: 'all', countries: [] }, ...overrides },
    user: { id: 'synthetic-user', user_metadata: { role: 'owner', data_scope: { mode: 'all' } } }, authStatus: 200, profileStatus: 200, rpcStatus: 200, rpcError: null, rpcBody: undefined, rpcHeaders: {}, calls: [], envReads: [], onProfile: null, onRpc: null };
  const values = { NEXT_PUBLIC_SUPABASE_URL: ORIGIN, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public', ...env };
  const environment = new Proxy(values, { get(target, key) { state.envReads.push(key); if (/GOOGLE|SERVICE_ROLE|PRIVATE_KEY|THIRD_PARTY_RATE_SHEET/.test(String(key))) throw Error('Forbidden source credential read'); return target[key]; } });
  const modules = new Map();
  const fetch = async (input, init = {}) => {
    const url = new URL(input); assert.equal(url.origin, ORIGIN, 'credentials never leave configured Supabase origin');
    state.calls.push({ url, init });
    if (url.pathname === '/auth/v1/user') return Response.json(state.user, { status: state.authStatus });
    if (url.pathname === '/rest/v1/dashboard_profiles') { state.onProfile?.(); return Response.json(state.profile === null ? [] : [state.profile], { status: state.profileStatus }); }
    if (url.pathname === RPC) {
      state.onRpc?.(init); if (state.rpcError) throw state.rpcError;
      if (state.rpcBody !== undefined) return new Response(state.rpcBody, { status: state.rpcStatus, headers: state.rpcHeaders });
      if (state.rpcStatus !== 200) return Response.json({ message: PRIVATE, details: PRIVATE, hint: PRIVATE }, { status: state.rpcStatus });
      const id = JSON.parse(init.body).p_sheet_id;
      return Response.json(id === null ? state.metadata : id === 0 ? state.grid : null, { headers: state.rpcHeaders });
    }
    throw Error('Unexpected network path');
  };
  function load(file) {
    file = path.resolve(root, file); if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const require = specifier => {
      assert.notEqual(specifier, 'googleapis', 'reader cannot load source SDK');
      const resolved = specifier.startsWith('@/') ? path.join(root, 'src', specifier.slice(2)) : specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : null;
      if (resolved && fs.existsSync(resolved + '.ts')) return load(resolved + '.ts');
      return nativeRequire(specifier);
    };
    new Function('require', 'module', 'exports', 'fetch', 'process', compiled)(require, module, module.exports, fetch, { ...process, env: environment });
    return module.exports;
  }
  const request = (query = '', headers = { Authorization: 'Bearer synthetic-session' }, signal) => new Request('https://site-preview.invalid/api/original-rate-sheet' + query, { headers, signal });
  return { state, environment, get: (query, headers, signal) => load('src/app/api/original-rate-sheet/route.ts').GET(request(query, headers, signal)), rpcCalls: () => state.calls.filter(call => call.url.pathname === RPC) };
}
function assertPrivate(response) {
  for (const header of ['cache-control', 'netlify-cdn-cache-control', 'cdn-cache-control']) assert.match(response.headers.get(header), /private.*no-store/);
  assert.match(response.headers.get('vary'), /Authorization/); assert.equal(response.headers.get('etag'), null);
}

test('metadata is read only from one Supabase RPC after fresh user/profile authorization', async () => {
  const h = harness(), response = await h.get(); assert.equal(response.status, 200); assertPrivate(response);
  assert.deepEqual(await response.json(), h.state.metadata);
  assert.deepEqual(h.state.calls.map(call => call.url.pathname), ['/auth/v1/user', '/rest/v1/dashboard_profiles', RPC]);
  const call = h.rpcCalls()[0]; assert.equal(call.init.method, 'POST'); assert.deepEqual(JSON.parse(call.init.body), { p_sheet_id: null });
  assert.equal(call.init.headers.Authorization, 'Bearer synthetic-session'); assert.equal(call.init.headers.apikey, 'synthetic-public');
  assert.equal(call.init.cache, 'no-store'); assert.equal(call.init.redirect, 'error'); assert.equal(call.init.credentials, 'omit'); assert(call.init.signal instanceof AbortSignal);
});
test('snapshot raw text, explicit blanks/zero, colors, merges, hidden indices and dimensions pass through unchanged', async () => {
  const h = harness(), before = structuredClone(h.state.grid), response = await h.get('?sheetId=0'); assert.equal(response.status, 200); assertPrivate(response);
  const data = await response.json(); assert.deepEqual(data, before); assert.deepEqual(h.state.grid, before);
  assert.equal(data.cells[4][5].text, '0'); assert.equal(data.cells[3][4].text, ''); assert.equal(data.cells[1][0].text, 'SUPER');
  assert.deepEqual(JSON.parse(h.rpcCalls()[0].init.body), { p_sheet_id: 0 });
});
test('raw displayed strings are inert; unexpected upstream-only fields are not forwarded', async () => {
  const h = harness(); h.state.grid.privateKey = PRIVATE; h.state.grid.sheet.sourceUrl = PRIVATE;
  h.state.grid.cells[1][0] = { text: '<img src=x onerror=alert(1)>\n=HYPERLINK("x")', note: PRIVATE, hyperlink: PRIVATE, format: { textFormat: { bold: false, link: { uri: PRIVATE } }, backgroundColor: { red: 1, private: PRIVATE } } };
  const response = await h.get('?sheetId=0'), data = await response.json(); assert.equal(response.status, 200); assert.equal(data.cells[1][0].text, h.state.grid.cells[1][0].text);
  assert.doesNotMatch(JSON.stringify(data), new RegExp(PRIVATE)); assert.equal(data.cells[1][0].format.textFormat.bold, false);
});
for (const query of ['', '?sheetId=0']) test('anonymous denied before all RPC/source/configuration reads: ' + query, async () => {
  const h = harness(), response = await h.get(query, {}); assert.equal(response.status, 401); assertPrivate(response); assert.equal(h.state.calls.length, 0); assert.equal(h.state.envReads.length, 0);
});
test('every request checks fresh scope; revocation cannot receive an old successful snapshot', async () => {
  const h = harness(); assert.equal((await h.get('?sheetId=0')).status, 200); assert.equal((await h.get('?sheetId=0')).status, 200);
  assert.equal(h.rpcCalls().length, 2); assert.equal(h.state.calls.length, 6);
  h.state.profile.data_scope = { mode: 'selected', countries: ['BR_PANGHU'] };
  const response = await h.get('?sheetId=0'); assert.equal(response.status, 403); assertPrivate(response); assert.equal(h.rpcCalls().length, 2); assert.equal(h.state.calls.length, 8);
  assert.doesNotMatch(await response.text(), /原始费率|SUPER|4\.50%/);
});
for (const profile of [{ permissions: {} }, { permissions: { third_party: false } }, { active: false }, { role: 'admin', data_scope: { mode: 'selected', countries: ['BR'] } }, { data_scope: { mode: 'all', countries: ['BR'] } }, { role: 'invalid' }]) test('disabled/missing module/restricted or malformed profile stops before RPC: ' + JSON.stringify(profile), async () => {
  const h = harness(profile), response = await h.get(); assert.equal(response.status, 403); assertPrivate(response); assert.equal(h.rpcCalls().length, 0);
});
test('forged user_metadata privileges do not override real fresh profile/module/scope', async () => {
  const h = harness({ permissions: { third_party: false } }); const response = await h.get(); assert.equal(response.status, 403); assert.equal(h.rpcCalls().length, 0);
});
test('auth/profile identity mismatch and fresh authentication failures deny without RPC', async () => {
  const h = harness(); h.state.profile.auth_user_id = 'someone-else'; assert.equal((await h.get()).status, 403); assert.equal(h.rpcCalls().length, 0);
  for (const status of [401, 403, 500]) { const h = harness(); h.state.authStatus = status; const res = await h.get(); assert.equal(res.status, status === 500 ? 503 : status); assert.equal(h.rpcCalls().length, 0); }
});
for (const query of ['?sheetId=-1', '?sheetId=', '?sheetId=01', '?sheetId=1.5', '?sheetId=1e2', '?sheetId=2147483648', '?sheetId=0&sheetId=9', '?range=A1:B2', '?url=https://attacker.invalid', '?sheetId=0&refresh=1', '?p_sheet_id=0']) test('rejects unsupported query before database RPC: ' + query, async () => {
  const h = harness(), response = await h.get(query); assert.equal(response.status, 400); assertPrivate(response); assert.equal(h.rpcCalls().length, 0);
});
test('sheetId maximum is valid, missing tab is not metadata fallback', async () => {
  const h = harness(), response = await h.get('?sheetId=2147483647'); assert.equal(response.status, 404); assert.deepEqual(JSON.parse(h.rpcCalls()[0].init.body), { p_sheet_id: 2147483647 });
});
test('null metadata reports unsynced snapshot; null requested tab reports not found', async () => {
  const h = harness(); h.state.metadata = null; let response = await h.get(); assert.equal(response.status, 503); assert.equal((await response.json()).code, 'original_sheet_snapshot_not_synced');
  h.state.grid = null; response = await h.get('?sheetId=0'); assert.equal(response.status, 404); assert.equal((await response.json()).code, 'original_sheet_not_found');
});
for (const mutate of [grid => { grid.sheet.sheetId = 9; }, grid => { grid.sheet.hidden = true; }, grid => { grid.cells[0].pop(); }, grid => { grid.cells[0][0].text = 0; }, grid => { grid.rowHeights = []; }, grid => { grid.hiddenRows = [99]; }, grid => { grid.merges[0].endColumnIndex = 999; }, grid => { grid.fetchedAt = 'invalid'; }]) test('mismatched/invalid snapshot fails closed: ' + mutate.toString(), async () => {
  const h = harness(); mutate(h.state.grid); const response = await h.get('?sheetId=0'); assert.equal(response.status, 503); assertPrivate(response); assert.equal((await response.json()).code, 'original_sheet_snapshot_invalid');
});
test('metadata duplicates/hidden sheets and wrong response kind are rejected', async () => {
  const h = harness(); h.state.metadata.sheets[0].sheetId = 0; assert.equal((await h.get()).status, 503);
  h.state.metadata = h.state.grid; assert.equal((await h.get()).status, 503);
  h.state.grid = fixtures().metadata; assert.equal((await h.get('?sheetId=0')).status, 503);
});
test('upstream 401/403 keep auth semantics; raw errors, redirects and invalid JSON stay private', async () => {
  for (const status of [401, 403, 404, 500]) { const h = harness(); h.state.rpcStatus = status; const response = await h.get(); assert.equal(response.status, [401, 403].includes(status) ? status : 503); assertPrivate(response); assert.doesNotMatch(await response.text(), new RegExp(PRIVATE)); }
  const h = harness(); h.state.rpcError = Error(PRIVATE + ' https://attacker.invalid/redirect'); assert.equal((await h.get()).status, 503);
  h.state.rpcError = null; h.state.rpcBody = PRIVATE; const response = await h.get(); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), new RegExp(PRIVATE));
});
test('oversized snapshot returns a private fixed error, never a clipped successful table', async () => {
  const h = harness(); h.state.rpcHeaders = { 'content-length': String(16 * 1024 * 1024 + 1) }; const response = await h.get(); assert.equal(response.status, 413); assertPrivate(response);
});
test('only configured HTTPS origin accepts session credentials; malformed configuration rejects before any network', async () => {
  for (const base of ['https://user:password@scope-preview.invalid', 'http://scope-preview.invalid', ORIGIN + '/rest/v1', ORIGIN + '?redirect=https://attacker.invalid']) {
    const h = harness({}, { NEXT_PUBLIC_SUPABASE_URL: base }), response = await h.get(); assert.equal(response.status, 503); assert.equal(h.state.calls.length, 0);
  }
  const h = harness(); await h.get('?sheetId=0', { Authorization: 'Bearer current-user-jwt', Cookie: 'private-cookie', 'X-Source-Url': 'https://attacker.invalid' });
  assert(h.state.calls.every(call => call.url.origin === ORIGIN && call.init.headers.Authorization === 'Bearer current-user-jwt'));
  assert.equal(h.rpcCalls()[0].init.headers.Cookie, undefined); assert.equal(h.rpcCalls()[0].init.headers['X-Source-Url'], undefined);
});
test('request cancellation is propagated and cannot return a late successful snapshot', async () => {
  const controller = new AbortController(), h = harness(); h.state.onProfile = () => controller.abort();
  assert.equal((await h.get('', undefined, controller.signal)).status, 503); assert.equal(h.rpcCalls().length, 0);
  const next = new AbortController(), second = harness(); second.state.onRpc = init => { assert(init.signal instanceof AbortSignal); next.abort(); };
  assert.equal((await second.get('', undefined, next.signal)).status, 503); assert.equal(second.rpcCalls()[0].init.signal.aborted, true);
});
test('concurrent requests retain independent fresh authorization and current JWTs, no cross-user cache', async () => {
  const h = harness(); const res = await Promise.all(['one', 'two', 'three'].map(token => h.get('', { Authorization: `Bearer ${token}` })));
  assert(res.every(response => response.status === 200)); assert.equal(h.state.calls.length, 9); assert.equal(h.rpcCalls().length, 3);
  assert.deepEqual(h.rpcCalls().map(call => call.init.headers.Authorization).sort(), ['Bearer one', 'Bearer three', 'Bearer two']);
});
test('reader has no Google/source SDK, environment access, service-role fallback, source fetch, sync trigger or business fee import', () => {
  const source = fs.readFileSync(path.join(root, 'src/lib/originalRateGridServer.ts'), 'utf8');
  assert.doesNotMatch(source, /googleapis|GOOGLE_|SERVICE_ROLE|THIRD_PARTY_RATE_SHEET|spreadsheets\.get|google\.auth|sourceCache|sourceFlights|sync-original|buildRateMap|findMatchedRate/);
  assert.equal((source.match(/\bfetch\(/g) || []).length, 1);
  assert.match(source, /requireDashboardDataAccess\(request, "third_party"\)/); assert.match(source, /requireDashboardAllData\(access\)/);
});
