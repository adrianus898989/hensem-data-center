const {loadEdge}=require('./load-edge-typescript.cjs');
const assert=require('node:assert/strict');
const { test }=require('node:test');
const { createHandler, MAX_BYTES, MAX_ROWS, PLATFORMS }=loadEdge(require('node:path').join(__dirname,'../supabase/functions/duoli-detail-ingest/handler.ts'));

// All credentials, rows, and responses below are synthetic. fetch is always injected.
const key = "synthetic-custom-key-for-unit-tests";
const jwt = (role) => `${btoa('{"alg":"HS256"}').replaceAll("=", "")}.${btoa(JSON.stringify({ role })).replaceAll("=", "")}.synthetic-signature`;
const serviceKey = jwt("service_role");
const windowId = "00000000-0000-4000-8000-000000000001";
const batchId = "00000000-0000-4000-8000-000000000002";
const timestamp = "2026-10-04T01:00:00Z";
const dimension = { window_id: windowId, platform: "UANG", business: "recharge",
  local_day: "2026-10-04", end_exclusive: timestamp };
const row = () => ({ order_id: "synthetic-order", source_order_id: "synthetic-id", platform: "UANG",
  business_type: "recharge", order_no: "synthetic-order-no", member_id: "synthetic-member",
  created_at: timestamp, created_day: "2026-10-04", updated_at: null, status_code: "2", status_text: "synthetic",
  currency: null, operator: null, provider: null, provider_code: null, channel: null, amount_raw: "10",
  amount_source: "amount", amount_unit: "source_unverified", amount_fields_raw: { amount: "10" },
  raw: { order_no: "synthetic-order-no", amount: 10, status: 2 } });
const batch = () => ({ schema_version: 1, action: "batch", ...dimension, batch_id: batchId,
  observed_at: timestamp, rows: [row()] });
const finalize = () => ({ schema_version: 1, action: "finalize", ...dimension, source_count: 1,
  batch_ids: [batchId], proof: "terminal_double_census", status_coverage: "requested_all_unverified" });
const checkResult = () => ({ ok: true, schema_version: 1, action: "check", platforms: [...PLATFORMS],
  receiver_version: "DOLI_DETAIL_R1", status_coverage: "requested_all_unverified", query_mode: "creation_day_recheck" });
const batchResult = () => ({ ok: true, schema_version: 1, action: "batch", batch_id: batchId,
  window_id: windowId, received: 1, written: 1, replayed: false });
const finalizeResult = () => ({ ok: true, schema_version: 1, action: "finalize", ...dimension,
  source_count: 1, uploaded_count: 1, finalized: true, status_coverage: "requested_all_unverified",
  query_mode: "creation_day_recheck" });
const progress = () => ({ ...dimension, source_count: 1, uploaded_count: 1, finalized: true,
  status_coverage: "requested_all_unverified", query_mode: "creation_day_recheck", acknowledged_at: timestamp });
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json", ...headers },
});
const request = (value, headers = {}, method = "POST") => new Request("https://receiver.example/duoli-details", {
  method, headers: { "x-api-key": key, "content-type": "application/json", ...headers },
  ...(method === "GET" ? {} : { body: typeof value === "string" ? value : JSON.stringify(value) }),
});
function setup(upstream = checkResult(), options = {}) {
  const calls = [];
  const handler = createHandler({ env: (name) => ({ SUPABASE_URL: "https://project.example",
    SUPABASE_SERVICE_ROLE_KEY: serviceKey })[name],
    fetch: async (...args) => { calls.push(args); return typeof upstream === "function" ? upstream(...args) : json(upstream); },
    ...options });
  return { handler, calls };
}
async function failure(handler, input, expectedStatus, expectedError) {
  const result = await handler(input);
  assert.equal(result.status, expectedStatus);
  assert.deepEqual(await result.json(), { ok: false, schema_version: 1, error: expectedError });
  assert.equal(result.headers.get("access-control-allow-origin"), null);
}

test("custom credential goes only to the isolated RPC argument; service JWT stays in privileged headers", async () => {
  const { handler, calls } = setup();
  const result = await handler(request({ schema_version: 1, action: "check" }, { Authorization: "Bearer ignored-caller-jwt" }));
  assert.deepEqual(await result.json(), checkResult());
  assert.equal(calls.length, 1);
  const [url, init] = calls[0];
  assert.equal(url, "https://project.example/rest/v1/rpc/duoli_detail_ingest");
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error");
  assert.equal(init.headers.apikey, serviceKey);
  assert.equal(init.headers.Authorization, `Bearer ${serviceKey}`);
  assert.equal(init.headers["Content-Profile"], "public");
  assert.deepEqual(JSON.parse(init.body), { p_key: key, p_body: { schema_version: 1, action: "check" } });
  assert.equal(result.headers.get("access-control-allow-origin"), null);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal(result.headers.get("x-content-type-options"), "nosniff");
});

test("batch and replay ACKs project only known fields", async () => {
  for (const replayed of [false, true]) {
    const safe = { ...batchResult(), replayed };
    const { handler } = setup({ ...safe, secret: serviceKey, rows: [{ private: "ignored" }] });
    assert.deepEqual(await (await handler(request(batch()))).json(), safe);
  }
});

test("modern secret keys are server-only apikey credentials, never non-JWT Bearer tokens", async () => {
  const modern = 'sb_secret_synthetic12345678901234567890';
  const { handler, calls } = setup(checkResult(), {env:name=>({SUPABASE_URL:'https://project.example',SUPABASE_SERVICE_ROLE_KEY:modern})[name]});
  const response = await handler(request({schema_version:1,action:'check'}));
  assert.equal(response.status,200);
  assert.equal(calls[0][1].headers.apikey,modern);
  assert.equal(calls[0][1].headers.Authorization,undefined);
});

test("finalize ACK matches the request and accepts equivalent UTC representations", async () => {
  const safe = { ...finalizeResult(), end_exclusive: "2026-10-04T01:00:00.000000+00:00" };
  const { handler } = setup({ ...safe, raw: "private" });
  assert.deepEqual(await (await handler(request(finalize()))).json(), safe);
});

test("Postgres UUID normalization does not reject an acknowledged uppercase UUID", async () => {
  const window = "ABCDEF00-0000-4000-8000-000000000001";
  const id = "ABCDEF00-0000-4000-8000-000000000002";
  const { handler } = setup({ ...batchResult(), window_id: window.toLowerCase(), batch_id: id.toLowerCase() });
  assert.equal((await handler(request({ ...batch(), window_id: window, batch_id: id }))).status, 200);
});

test("ACK timestamp comparison preserves microseconds", async () => {
  const { handler } = setup({ ...finalizeResult(), end_exclusive: "2026-10-04T01:00:00.000002Z" });
  await failure(handler, request({ ...finalize(), end_exclusive: "2026-10-04T01:00:00.000001Z" }), 502, "upstream_failure");
});

test("empty-day finalize permits zero rows and zero batch IDs", async () => {
  const body = { ...finalize(), source_count: 0, batch_ids: [] };
  const { handler } = setup({ ...finalizeResult(), source_count: 0, uploaded_count: 0 });
  assert.equal((await handler(request(body))).status, 200);
});

test("state returns progress metadata only, stripping all extra fields", async () => {
  const safe = progress();
  const { handler } = setup({ ok: true, schema_version: 1, action: "state",
    progress: [{ ...safe, orders: [row()], secret: serviceKey }], extra: key });
  assert.deepEqual(await (await handler(request({ schema_version: 1, action: "state" }))).json(), {
    ok: true, schema_version: 1, action: "state", progress: [safe],
  });
});

test("every non-POST method, including preflight, is rejected without RPC", async () => {
  for (const method of ["GET", "OPTIONS", "PUT", "DELETE"]) {
    const { handler, calls } = setup();
    await failure(handler, request({}, {}, method), 405, "method_not_allowed");
    assert.equal(calls.length, 0);
  }
});

test("missing, whitespace, or merged API keys cannot reach RPC", async () => {
  for (const invalid of ["", "two,keys", "has a space", "x".repeat(1025)]) {
    const { handler, calls } = setup();
    await failure(handler, request({ schema_version: 1, action: "check" }, { "x-api-key": invalid }), 401, "unauthorized");
    assert.equal(calls.length, 0);
  }
});

test("JSON content type is required", async () => {
  const { handler, calls } = setup();
  await failure(handler, request({}, { "content-type": "text/plain" }), 415, "unsupported_media_type");
  assert.equal(calls.length, 0);
});

test("unknown top-level fields, missing fields, bad action, version, and JSON fail closed", async () => {
  const values = ["{", [], null, { schema_version: true, action: "check" }, { schema_version: 3, action: "check" },
    { schema_version: 1, action: "delete" }, { schema_version: 1, action: "check", rows: [] },
    { action: "state" }, { ...batch(), unexpected: true }, { ...finalize(), unexpected: true }];
  for (const value of values) {
    const { handler, calls } = setup();
    await failure(handler, request(value), 400, "invalid_request");
    assert.equal(calls.length, 0);
  }
});

test("request size is strictly under 1 MiB, even without a trustworthy content length", async () => {
  for (const input of [request(" ".repeat(MAX_BYTES)), request("{}", { "content-length": String(MAX_BYTES) }),
    request("{}", { "content-length": String(MAX_BYTES + 1) })]) {
    const { handler, calls } = setup();
    await failure(handler, input, 413, "payload_too_large");
    assert.equal(calls.length, 0);
  }
  const { handler } = setup();
  const small = JSON.stringify({ schema_version: 1, action: "check" });
  assert.equal((await handler(request(small.padEnd(MAX_BYTES - 1, " ")))).status, 200);
});

test("invalid content length and malformed UTF-8 are invalid requests", async () => {
  const { handler } = setup();
  await failure(handler, request("{}", { "content-length": "-1" }), 400, "invalid_request");
  const badUtf8 = new Request("https://receiver.example", { method: "POST", headers: {
    "x-api-key": key, "content-type": "application/json" }, body: new Uint8Array([0xff]) });
  await failure(handler, badUtf8, 400, "invalid_request");
});

test("200 rows are permitted; empty, 201-row, non-array, and non-object rows are rejected", async () => {
  const { handler } = setup({ ...batchResult(), received: MAX_ROWS, written: MAX_ROWS });
  assert.equal((await handler(request({ ...batch(), rows: Array.from({ length: MAX_ROWS }, row) }))).status, 200);
  for (const rows of [[], Array.from({ length: MAX_ROWS + 1 }, row), {}, [null], [[]]]) {
    const { handler: reject, calls } = setup();
    await failure(reject, request({ ...batch(), rows }), 400, "invalid_request");
    assert.equal(calls.length, 0);
  }
});

test("platform/business/date/UUID/timestamp values and finalize proof are checked", async () => {
  const changes = [{ platform: "OTHER" }, { business: "deposit" }, { local_day: "2026-02-30" },
    { local_day: "2026-2-01" }, { window_id: "bad" }, { batch_id: "bad" },
    { end_exclusive: "2026-10-04T01:00:00+07:00" }, { observed_at: "2026-10-04T24:00:00Z" }];
  for (const change of changes) {
    const { handler, calls } = setup();
    await failure(handler, request({ ...batch(), ...change }), 400, "invalid_request");
    assert.equal(calls.length, 0);
  }
  for (const change of [{ source_count: -1 }, { source_count: 1.5 }, { source_count: true },
    { source_count: Number.MAX_SAFE_INTEGER + 1 }, { batch_ids: ["bad"] }, { batch_ids: [batchId, batchId] },
    { proof: "claimed_complete" }, { status_coverage: "all_verified" }]) {
    const { handler, calls } = setup();
    await failure(handler, request({ ...finalize(), ...change }), 400, "invalid_request");
    assert.equal(calls.length, 0);
  }
});

test("row allowlists reject credentials, nested raw data, null raw values, and unknown amount fields", async () => {
  const cases = [{ ...row(), token: "secret" }, { ...row(), raw: { access_token: "secret" } },
    { ...row(), raw: { amount: {} } }, { ...row(), raw: { amount: null } },
    { ...row(), raw: { order_no: "x".repeat(513) } }, { ...row(), amount_fields_raw: { unknown: "10" } },
    { ...row(), amount_fields_raw: { amount: 10 } }, { ...row(), amount_fields_raw: { amount: "NaN" } },
    { ...row(), platform: "FB168" }, { ...row(), business_type: "withdraw" },
    { ...row(), created_at: null }, { ...row(), updated_at: "2026-10-04" },
    { ...row(), amount_unit: "assumed_currency" }];
  for (const item of cases) {
    const { handler, calls } = setup();
    await failure(handler, request({ ...batch(), rows: [item] }), 400, "invalid_request");
    assert.equal(calls.length, 0);
  }
});

test("string limits count Unicode characters consistently with Python and Postgres", async () => {
  const { handler } = setup(batchResult());
  const value = { ...row(), status_text: "🙂".repeat(512), raw: { status_text: "🙂".repeat(512) } };
  assert.equal((await handler(request({ ...batch(), rows: [value] }))).status, 200);
  const { handler: reject } = setup();
  await failure(reject, request({ ...batch(), rows: [{ ...value, status_text: "🙂".repeat(513) }] }), 400, "invalid_request");
});

test("missing server environment, non-HTTPS URLs, and anon credentials never trigger privileged fetch", async () => {
  for (const values of [{}, { SUPABASE_URL: "http://project.example", SUPABASE_SERVICE_ROLE_KEY: serviceKey },
    { SUPABASE_URL: "https://user:password@project.example", SUPABASE_SERVICE_ROLE_KEY: serviceKey },
    { SUPABASE_URL: "https://project.example/path", SUPABASE_SERVICE_ROLE_KEY: serviceKey },
    { SUPABASE_URL: "https://project.example", SUPABASE_SERVICE_ROLE_KEY: jwt("anon") },
    { SUPABASE_URL: "https://project.example", SUPABASE_SERVICE_ROLE_KEY: "not-a-jwt" }]) {
    const { handler, calls } = setup(checkResult(), { env: (name) => values[name] });
    await failure(handler, request({ schema_version: 1, action: "check" }), 503, "receiver_unconfigured");
    assert.equal(calls.length, 0);
  }
});

test("SQLSTATE errors use fixed responses without echoing RPC body or credentials", async () => {
  for (const [code, status, error] of [["28000", 401, "unauthorized"], ["22023", 400, "invalid_request"],
    ["23514", 400, "invalid_request"], ["23505", 409, "conflict"], ["XX000", 502, "upstream_failure"]]) {
    const { handler } = setup(() => json({ code, message: `${key} ${serviceKey}`, details: row(), hint: "private" }, 400));
    await failure(handler, request({ schema_version: 1, action: "check" }), status, error);
  }
});

test("network exceptions and redirects return fixed failures", async () => {
  for (const upstream of [() => { throw new Error(`${key} ${serviceKey}`); },
    () => new Response("redirect", { status: 302, headers: { location: "https://other.example" } })]) {
    const { handler } = setup(upstream);
    await failure(handler, request({ schema_version: 1, action: "check" }), 502, "upstream_failure");
  }
});

test("upstream response size is bounded for both declared and streamed bodies", async () => {
  for (const upstream of [() => json(checkResult(), 200, { "content-length": String(MAX_BYTES) }),
    () => new Response("x".repeat(MAX_BYTES)), () => json(checkResult(), 200, { "content-length": "garbage" })]) {
    const { handler } = setup(upstream);
    await failure(handler, request({ schema_version: 1, action: "check" }), 502, "upstream_failure");
  }
});

test("success envelopes and ACK identities/counts must match the operation", async () => {
  for (const upstream of [[], { ...checkResult(), ok: false }, { ...checkResult(), schema_version: true },
    { ...checkResult(), action: "batch" }, { ...checkResult(), receiver_version: "other" },
    { ...checkResult(), platforms: [...PLATFORMS.slice(1), PLATFORMS[1]] }]) {
    const { handler } = setup(upstream);
    await failure(handler, request({ schema_version: 1, action: "check" }), 502, "upstream_failure");
  }
  for (const change of [{ batch_id: windowId }, { window_id: batchId }, { received: 0 },
    { written: 2 }, { written: true }, { replayed: "true" }]) {
    const { handler } = setup({ ...batchResult(), ...change });
    await failure(handler, request(batch()), 502, "upstream_failure");
  }
  for (const change of [{ uploaded_count: 0 }, { source_count: 0 }, { finalized: false },
    { end_exclusive: "2026-10-04T02:00:00Z" }, { status_coverage: "verified" }]) {
    const { handler } = setup({ ...finalizeResult(), ...change });
    await failure(handler, request(finalize()), 502, "upstream_failure");
  }
});

test("state rejects malformed progress or any unfinalized or unmatched count", async () => {
  for (const progressValue of [null, [row()], [{ ...progress(), finalized: false }],
    [{ ...progress(), uploaded_count: 0 }], [{ ...progress(), acknowledged_at: null }]]) {
    const { handler } = setup({ ok: true, schema_version: 1, action: "state", progress: progressValue });
    await failure(handler, request({ schema_version: 1, action: "state" }), 502, "upstream_failure");
  }
});

test("RPC timeout aborts fetch, including an injected fetch that ignores abort", async () => {
  let signal;
  const { handler } = setup((_, init) => { signal = init.signal; return new Promise(() => {}); }, { rpcTimeoutMs: 10 });
  await failure(handler, request({ schema_version: 1, action: "check" }), 504, "upstream_timeout");
  assert.equal(signal.aborted, true);
});

test("RPC timeout covers slow response bodies and cancels their stream", async () => {
  let canceled = false;
  const { handler } = setup(() => new Response(new ReadableStream({ cancel() { canceled = true; } })), { rpcTimeoutMs: 10 });
  await failure(handler, request({ schema_version: 1, action: "check" }), 504, "upstream_timeout");
  assert.equal(canceled, true);
});

test("request timeout cancels an unfinished upload stream before RPC", async () => {
  let canceled = false;
  const slow = new Request("https://receiver.example", { method: "POST", headers: {
    "x-api-key": key, "content-type": "application/json" }, duplex: "half",
    body: new ReadableStream({ cancel() { canceled = true; } }) });
  const { handler, calls } = setup(checkResult(), { bodyTimeoutMs: 10 });
  await failure(handler, slow, 408, "request_timeout");
  assert.equal(canceled, true);
  assert.equal(calls.length, 0);
});

test("Deno entrypoint installs the injectable handler without external imports", async () => {
  const before = globalThis.Deno;
  let served;
  globalThis.Deno = { env: { get: () => undefined }, serve(handler) { served = handler; } };
  try {
    loadEdge(require('node:path').join(__dirname,'../supabase/functions/duoli-detail-ingest/index.ts'), {Deno:globalThis.Deno});
    assert.equal(typeof served, "function");
  } finally {
    if (before === undefined) delete globalThis.Deno;
    else globalThis.Deno = before;
  }
});
