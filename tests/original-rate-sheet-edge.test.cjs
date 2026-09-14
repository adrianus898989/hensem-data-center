const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { webcrypto } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const PRIVATE = "DO_NOT_FORWARD_SYNTHETIC_SECRET";
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

function harness(overrides = {}) {
  const source = fixtures();
  const state = { ...source, calls: [], reads: [], stages: [], rpc: [], envReads: [], now: Date.parse("2026-09-14T00:00:00Z"), claim: true, publish: true, failStage: 0, failGoogle: false, publication: "old-published-run", ...overrides };
  const env = { SYNC_SECRET: "synthetic-sync-secret", GOOGLE_SERVICE_ACCOUNT_EMAIL: "synthetic@example.invalid", GOOGLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nAA==\\n-----END PRIVATE KEY-----", THIRD_PARTY_RATE_SHEET_ID: "synthetic_source_12345", SUPABASE_URL: "https://synthetic-project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key", ...overrides.env };
  const modules = new Map();
  const signing = [];
  const cryptography = { randomUUID: () => "11111111-1111-4111-8111-111111111111", subtle: {
    digest: webcrypto.subtle.digest.bind(webcrypto.subtle),
    importKey: async (...args) => { signing.push({ import: args }); return {}; },
    sign: async (...args) => { signing.push({ sign: args }); return new Uint8Array([1, 2, 3]).buffer; },
  } };
  function load(file) {
    file = path.resolve(root, file); if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const require = specifier => {
      const resolved = specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : null;
      if (resolved && fs.existsSync(resolved)) return load(resolved);
      throw new Error("unexpected dependency " + specifier);
    };
    const timeout = (fn, ms) => setTimeout(fn, state.forceTimeout && ms > 5000 ? 0 : ms);
    new Function("require", "module", "exports", "Deno", "setTimeout", compiled)(require, module, module.exports, undefined, timeout);
    return module.exports;
  }
  const fetch = async (input, init) => {
    const url = new URL(input); state.calls.push({ url, init }); assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
    assert.ok(init.signal, "every external request must have a time bound");
    if (state.advanceEachRequest) state.now += state.advanceEachRequest;
    if (url.origin === "https://synthetic-project.supabase.co") {
      assert.equal(init.method, "POST"); assert.equal(init.headers.Authorization, "Bearer synthetic-service-key"); assert.equal(init.headers.apikey, "synthetic-service-key");
      const body = JSON.parse(init.body);
      if (url.pathname === "/rest/v1/third_party_rate_original_sheets") {
        if (state.failStage === state.stages.length + 1) return new Response(PRIVATE, { status: 500 });
        assert.equal(init.headers.Prefer, "return=minimal"); state.stages.push(body); return new Response(null, { status: 201 });
      }
      const name = url.pathname.split("/").pop(); state.rpc.push({ name, body });
      if (name === "original_rate_sync_claim") return Response.json(state.claim);
      if (name === "original_rate_sync_publish") {
        assert.equal(state.stages.length, state.metadata.sheets.filter(s => !s.properties.hidden).length);
        if (state.publish) state.publication = body.p_run_id;
        return Response.json(state.publish);
      }
      if (name === "original_rate_sync_fail") return Response.json(null);
      throw new Error("unexpected RPC " + name);
    }
    if (url.origin === "https://oauth2.googleapis.com") {
      assert.equal(url.pathname, "/token"); const body = new URLSearchParams(init.body); state.assertion = body.get("assertion");
      assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      return Response.json({ access_token: "synthetic-google-token" });
    }
    assert.equal(url.origin, "https://sheets.googleapis.com", "no unexpected external target");
    assert.equal(init.headers.Authorization, "Bearer synthetic-google-token");
    assert.equal(init.method, "GET"); state.reads.push(url);
    if (state.failGoogle) throw new Error(PRIVATE);
    if (state.hangGoogle) return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error(PRIVATE)), { once: true }));
    if (url.pathname.includes("/values/")) return Response.json({ values: state.values });
    if (!url.searchParams.has("ranges")) return Response.json(state.metadata);
    const range = url.searchParams.get("ranges");
    const sheet = state.metadata.sheets.find(s => range.startsWith("'" + s.properties.title.replace(/'/g, "''") + "'!"));
    assert.ok(sheet, "grid range must use an exact metadata title");
    const grid = structuredClone(state.grid); grid.sheets[0].properties = structuredClone(sheet.properties);
    grid.sheets[0].merges = structuredClone(sheet.merges || []);
    if (state.changedTitle) grid.sheets[0].properties.title = "changed title";
    return Response.json(grid);
  };
  const entry = load("supabase/functions/sync-original-rate-sheet/index.ts");
  const handler = entry.createSyncOriginalRateHandler({ env: name => { state.envReads.push(name); return env[name]; }, fetch, now: () => state.now, crypto: cryptography });
  const request = (body = { action: "sync" }, options = {}) => {
    const method = options.method || "POST";
    return new Request("https://synthetic-project.supabase.co/functions/v1/sync-original-rate-sheet" + (options.query || ""), { method, headers: { "x-sync-secret": options.secret ?? "synthetic-sync-secret", "Content-Type": "application/json" }, ...(method !== "GET" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
  };
  return { state, env, signing, run: (body, options) => handler(request(body, options)) };
}

test('internal secret is verified before body, source configuration, or any external read/write', async () => {
  for (const secret of ['', 'wrong', 'synthetic-sync-secreT']) {
    const h = harness(); const response = await h.run('not-json', { secret });
    assert.equal(response.status, 401); assert.deepEqual(h.state.envReads, ['SYNC_SECRET']); assert.equal(h.state.calls.length, 0);
    assert.match(response.headers.get('cache-control'), /private.*no-store/);
  }
});
test('missing server sync secret denies even a matching empty header', async () => {
  const h = harness({ env: { SYNC_SECRET: '' } }); const response = await h.run(undefined, { secret: '' }); assert.equal(response.status, 401); assert.equal(h.state.calls.length, 0);
});
test('only exact POST sync action is accepted; no caller source/range/run selection', async () => {
  for (const body of [{ action: 'ping' }, { action: 'sync', spreadsheetId: 'attacker' }, { action: 'sync', sheetId: 0 }, { action: 'sync', run_id: 'existing' }, { action: 'sync', range: 'A1' }, {}, null, [], 'not json', 'x'.repeat(2000)]) {
    const h = harness(); const response = await h.run(body); assert.equal(response.status, 400); assert.equal(h.state.calls.length, 0); assert.deepEqual(h.state.envReads, ['SYNC_SECRET']);
  }
  let h = harness(); assert.equal((await h.run(undefined, { method: 'GET' })).status, 405); assert.equal(h.state.calls.length, 0);
  h = harness(); assert.equal((await h.run(undefined, { query: '?sheetId=0' })).status, 400); assert.equal(h.state.calls.length, 0);
});
test('sync claims, reads every visible native tab in order, stages sequentially, then atomically publishes', async () => {
  const h = harness(); const response = await h.run(); assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.ok, true); assert.equal(body.sheets, 2); assert.equal(h.state.stages.length, 2); assert.deepEqual(h.state.stages.map(s => s.sheet_id), [9, 0]);
  assert.deepEqual(h.state.rpc.map(r => r.name), ['original_rate_sync_claim', 'original_rate_sync_publish']);
  assert.equal(h.state.calls[0].url.pathname, '/rest/v1/rpc/original_rate_sync_claim'); assert.equal(h.state.publication, '11111111-1111-4111-8111-111111111111');
  const publish = h.state.rpc[1].body; assert.deepEqual(publish.p_meta.sheets.map(s => s.title), ['巴西', title]); assert.equal(publish.p_meta.fetchedAt, '2026-09-14T00:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(body), /OXPay|synthetic|payload|sourceId|run_id|private|token|email/);
  assert.equal(h.state.reads.length, 5); assert.ok(h.state.reads.every(url => !url.pathname.includes(PRIVATE)));
  const stages = h.state.calls.map((c, i) => c.url.pathname.endsWith('third_party_rate_original_sheets') ? i : -1).filter(i => i >= 0);
  const values = h.state.calls.map((c, i) => c.url.pathname.includes('/values/') ? i : -1).filter(i => i >= 0);
  assert.ok(stages[0] < values[1], 'first sheet is staged before second is read');
});
test('all 15 native visible tabs are staged exactly once before the generation publishes', async () => {
  const h = harness(); const template = h.state.metadata.sheets[1];
  h.state.metadata.sheets = Array.from({ length: 15 }, (_, index) => ({ properties: { ...structuredClone(template.properties), sheetId: index, title: '原表页签' + index, index }, merges: structuredClone(template.merges) }));
  const response = await h.run(); assert.equal(response.status, 200); assert.equal((await response.json()).sheets, 15);
  assert.deepEqual(h.state.stages.map(s => s.sheet_id), Array.from({ length: 15 }, (_, i) => i));
  assert.equal(h.state.rpc.at(-1).name, 'original_rate_sync_publish'); assert.equal(h.state.rpc.at(-1).body.p_meta.sheets.length, 15);
});
test('staging payload preserves native displayed text/format, holes, zero, merges, frozen panes, and offset dimensions', async () => {
  const h = harness(); await h.run(); const data = h.state.stages[1].payload;
  assert.equal(data.rowCount, 5); assert.equal(data.columnCount, 6); assert.ok(data.cells.every(row => row.length === 6));
  assert.equal(data.cells[3][4].text, ''); assert.equal(data.cells[4][5].text, '0'); assert.equal(data.cells[4][5].format.horizontalAlignment, 'RIGHT');
  assert.equal(data.cells[1][2].text, '4.50%'); assert.equal(data.cells[1][2].format.horizontalAlignment, 'RIGHT'); assert.equal(data.cells[1][1].format.horizontalAlignment, 'LEFT');
  assert.equal(data.sheet.frozenRowCount, 2); assert.equal(data.sheet.frozenColumnCount, 1);
  assert.deepEqual(data.cells[0][0].format.backgroundColor, { red: .8, green: .1, blue: .2 }); assert.equal(data.cells[0][0].format.textFormat.fontSize, 10); assert.equal(data.cells[0][0].format.textFormat.bold, true);
  assert.equal(data.cells[1][0].format.textFormat.bold, false); assert.equal(data.cells[1][0].format.borders.bottom.style, 'DOUBLE');
  assert.deepEqual(data.cells[1][1].runs, [{ startIndex: 0, format: { bold: true, foregroundColor: { red: .8, green: .1, blue: .2 } } }, { startIndex: 1, format: { italic: true } }]);
  assert.deepEqual(data.rowHeights, [31, 42, 0, 25, 35]); assert.deepEqual(data.columnWidths, [145, 61, 90, 100, 100, 127]); assert.deepEqual(data.hiddenRows, [2, 3]); assert.deepEqual(data.hiddenColumns, [2, 5]);
  assert.equal(data.merges.length, 2); assert.deepEqual(data.merges[0], { startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: 4 });
  assert.doesNotMatch(JSON.stringify(data), new RegExp(PRIVATE)); assert.doesNotMatch(JSON.stringify(data), /effectiveValue|formulaValue|hyperlink|"note"|userEnteredValue/);
  assert.equal(h.state.stages[1].collected_at, data.fetchedAt);
  const range = h.state.reads.filter(url => url.pathname.includes('/values/'))[1]; assert.match(decodeURIComponent(range.pathname), /'印度 O''Brien ! tab'!A1:AW1000$/);
});
test('Google assertion is RS256, readonly, nonextractable, and remains internal', async () => {
  const h = harness(); const response = await h.run(); const parts = h.state.assertion.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(parts[0], 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url')); assert.equal(claims.scope, 'https://www.googleapis.com/auth/spreadsheets.readonly'); assert.equal(claims.aud, 'https://oauth2.googleapis.com/token'); assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(h.signing[0].import[0], 'pkcs8'); assert.equal(h.signing[0].import[3], false); assert.deepEqual(h.signing[0].import[4], ['sign']); assert.equal(h.signing[1].sign[0], 'RSASSA-PKCS1-v1_5');
  assert.doesNotMatch(await response.text(), /assertion|synthetic@example|synthetic-google-token/);
});
test('existing live lease skips without Google reads or staged/published writes', async () => {
  const h = harness({ claim: false }); const response = await h.run(); assert.equal(response.status, 409); assert.equal((await response.json()).code, 'sync_already_running'); assert.equal(h.state.calls.length, 1); assert.equal(h.state.stages.length, 0); assert.equal(h.state.publication, 'old-published-run');
});
test('mid-sync failure marks only the claimed generation failed and retains previous publication', async () => {
  const h = harness({ failStage: 2 }); const response = await h.run(); assert.equal(response.status, 503); const body = await response.json();
  assert.equal(body.code, 'snapshot_write_failed'); assert.equal(body.sheetsStaged, 1); assert.equal(h.state.publication, 'old-published-run'); assert.equal(h.state.stages.length, 1);
  assert.deepEqual(h.state.rpc.map(r => r.name), ['original_rate_sync_claim', 'original_rate_sync_fail']); assert.equal(h.state.rpc[1].body.p_message, 'original_snapshot_write_failed'); assert.doesNotMatch(JSON.stringify(body), new RegExp(PRIVATE));
});
test('publish rejection marks failed without changing previous publication', async () => {
  const h = harness({ publish: false }); const response = await h.run(); assert.equal(response.status, 503); assert.equal((await response.json()).code, 'snapshot_publish_rejected'); assert.equal(h.state.publication, 'old-published-run'); assert.deepEqual(h.state.rpc.map(r => r.name), ['original_rate_sync_claim', 'original_rate_sync_publish', 'original_rate_sync_fail']);
});
test('Google errors are sanitized; no staging/publish after a source read failure', async () => {
  const h = harness({ failGoogle: true }); const response = await h.run(); assert.equal(response.status, 503); const body = await response.json(); assert.doesNotMatch(JSON.stringify(body), new RegExp(PRIVATE)); assert.equal(h.state.stages.length, 0); assert.equal(h.state.publication, 'old-published-run'); assert.equal(h.state.rpc.at(-1).name, 'original_rate_sync_fail');
});
test('per-request timeout aborts a stalled Google read and safely marks failed', async () => {
  const h = harness({ hangGoogle: true, forceTimeout: true }); const response = await h.run(); assert.equal(response.status, 504);
  assert.equal((await response.json()).code, 'sync_request_timed_out'); assert.equal(h.state.publication, 'old-published-run'); assert.equal(h.state.stages.length, 0);
  assert.equal(h.state.rpc.at(-1).body.p_message, 'original_sync_request_timed_out');
});
test('two-minute overall budget stops before additional reads/writes and attempts safe failure cleanup', async () => {
  const h = harness({ advanceEachRequest: 25_000 }); const response = await h.run(); assert.equal(response.status, 504); assert.equal((await response.json()).code, 'sync_budget_exceeded'); assert.equal(h.state.publication, 'old-published-run'); assert.ok(!h.state.rpc.some(r => r.name === 'original_rate_sync_publish'));
});
test('oversize allocated grids fail explicitly, never silently truncate or publish', async () => {
  const h = harness(); h.state.metadata.sheets[1].properties.gridProperties.rowCount = 10001; const response = await h.run(); assert.equal(response.status, 413); assert.equal((await response.json()).code, 'original_sheet_too_large'); assert.equal(h.state.stages.length, 0); assert.equal(h.state.publication, 'old-published-run');
});
test('each staged page has an explicit 8 MiB cap, never truncating a large native cell', async () => {
  const h = harness(); h.state.grid.sheets[0].data[0].rowData[1].values[0].formattedValue = 'x'.repeat(8 * 1024 * 1024);
  const response = await h.run(); assert.equal(response.status, 413); assert.equal((await response.json()).code, 'source_payload_too_large'); assert.equal(h.state.stages.length, 0); assert.equal(h.state.publication, 'old-published-run');
});
test('source/env configuration is private, fixed, and cannot point requests at arbitrary origins', async () => {
  for (const env of [{ GOOGLE_PRIVATE_KEY: '' }, { SUPABASE_SERVICE_ROLE_KEY: '' }, { SUPABASE_URL: 'https://attacker.invalid' }, { SUPABASE_URL: 'http://synthetic-project.supabase.co' }, { THIRD_PARTY_RATE_SHEET_ID: 'https://attacker.invalid/spreadsheets/d/source_id_12345/edit' }]) {
    const h = harness({ env }); const response = await h.run(); assert.equal(response.status, 503); assert.equal(h.state.calls.length, 0); assert.doesNotMatch(await response.text(), /attacker|GOOGLE_|SUPABASE_|synthetic/);
  }
});
test('source-only Edge imports no old business writer/parser or external dependency', () => {
  const source = fs.readFileSync(path.join(root, 'supabase/functions/sync-original-rate-sheet/index.ts'), 'utf8');
  const grid = fs.readFileSync(path.join(root, 'supabase/functions/sync-original-rate-sheet/grid.ts'), 'utf8');
  assert.doesNotMatch(source, /from ["'](?:https:|npm:|jsr:)/); assert.doesNotMatch(grid, /from ["'](?:https:|npm:|jsr:)/);
  assert.doesNotMatch(source, /\/rest\/v1\/(?:third_party_rates|third_party_volume|sync_status)["']/);
  assert.match(source, /original_rate_sync_publish/); assert.match(source, /verify_jwt=false/);
});
