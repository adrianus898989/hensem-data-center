const {loadEdge}=require('./load-edge-typescript.cjs');
const assert=require('node:assert/strict');
const { test }=require('node:test');
const { createHandler, MAX_BYTES, MAX_ROWS, PLATFORMS }=loadEdge(require('node:path').join(__dirname,'../supabase/functions/duoli-detail-ingest/handler.ts'));

// Offline contract tests: injected fetch only, synthetic credentials and orders.
const key = "synthetic-custom-key-for-unit-tests";
const serviceKey = "sb_secret_synthetic_server_only_key_1234567890";
const scope = { window_id: "00000000-0000-4000-8000-000000000001", platform: "UANG", business: "recharge",
  stream: "created", start_at: "2026-10-04T01:00:00Z", end_exclusive: "2026-10-04T01:10:00Z" };
const batchId = "00000000-0000-4000-8000-000000000002";
const modes = { status_coverage: "requested_all_unverified", query_mode: "source_time_stream" };
const row = () => ({ order_id: "synthetic-order", source_order_id: "synthetic-id", platform: "UANG",
  business_type: "recharge", order_no: "synthetic-order-no", member_id: "synthetic-member",
  created_at: scope.start_at, created_day: "2026-10-04", updated_at: null, status_code: "2", status_text: "synthetic",
  currency: null, operator: null, provider: null, provider_code: null, channel: null, amount_raw: "10",
  amount_source: "amount", amount_unit: "source_unverified", amount_fields_raw: { amount: "10" },
  raw: { order_no: "synthetic-order-no", amount: 10, status: 2 },
  audit_completed_at: null, audit_duration_seconds: null });
const batch = (change = {}) => ({ schema_version: 2, action: "batch", ...scope, batch_id: batchId,
  observed_at: scope.end_exclusive, rows: [row()], ...change });
const finalize = (change = {}) => ({ schema_version: 2, action: "finalize", ...scope,
  source_count: 1, batch_ids: [batchId], proof: "terminal_double_census",
  status_coverage: modes.status_coverage, ...change });
const checkResult = () => ({ ok: true, schema_version: 2, action: "check", platforms: [...PLATFORMS],
  receiver_version: "DOLI_DETAIL_R2", ...modes });
const batchResult = (body = batch()) => ({ ok: true, schema_version: 2, action: "batch",
  ...Object.fromEntries(Object.keys(scope).map((name) => [name, body[name]])), batch_id: body.batch_id,
  received: body.rows.length, written: body.rows.length, replayed: false, ...modes });
const finalResult = (body = finalize()) => ({ ok: true, schema_version: 2, action: "finalize",
  ...Object.fromEntries(Object.keys(scope).map((name) => [name, body[name]])), source_count: body.source_count,
  uploaded_count: body.source_count, finalized: true, ...modes });
const progress = () => ({ ...scope, source_count: 1, uploaded_count: 1, finalized: true,
  acknowledged_at: "2026-10-04T01:10:01.000001Z", ...modes });
const request = (body) => new Request("https://receiver.example/duoli", { method: "POST",
  headers: { "x-api-key": key, "content-type": "application/json" }, body: JSON.stringify(body) });
function setup(upstream = checkResult(), options = {}) {
  const calls = [];
  const handler = createHandler({ env: (name) => ({ SUPABASE_URL: "https://project.example",
    SUPABASE_SERVICE_ROLE_KEY: serviceKey })[name], fetch: async (...args) => {
      calls.push(args);
      return typeof upstream === "function" ? upstream(...args) : new Response(JSON.stringify(upstream));
    }, ...options });
  return { handler, calls };
}
async function failure(handler, body, status = 400, error = "invalid_request") {
  const result = await handler(request(body));
  assert.equal(result.status, status);
  assert.deepEqual(await result.json(), { ok: false, schema_version: 2, error });
  assert.equal(result.headers.get("access-control-allow-origin"), null);
}

test("schema2 check routes to its own RPC with server-only secret headers", async () => {
  const { handler, calls } = setup({ ...checkResult(), key: serviceKey, rows: [row()] });
  const result = await handler(request({ schema_version: 2, action: "check" }));
  assert.deepEqual(await result.json(), checkResult());
  assert.equal(calls.length, 1);
  const [endpoint, init] = calls[0];
  assert.equal(endpoint, "https://project.example/rest/v1/rpc/duoli_detail_ingest_v2");
  assert.equal(init.redirect, "error");
  assert.equal(init.headers.apikey, serviceKey);
  assert.equal(init.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(init.body), { p_key: key, p_body: { schema_version: 2, action: "check" } });
  assert.equal(result.headers.get("access-control-allow-origin"), null);
  assert.equal(result.headers.get("cache-control"), "no-store");
});

test("schema2 batch ACK returns exact stream scope plus validated counts, omitting orders", async () => {
  for (const replayed of [false, true]) {
    const safe = { ...batchResult(), replayed };
    const { handler } = setup({ ...safe, orders: [row()], private: key });
    assert.deepEqual(await (await handler(request(batch()))).json(), safe);
  }
});

test("updated streams accept older creation dates for recharge and withdraw", async () => {
  for (const business of ["recharge", "withdraw"]) {
    const body = batch({ business, stream: "updated", rows: [{ ...row(), business_type: business,
      created_at: "2026-10-01T17:00:00Z", created_day: "2026-10-02", updated_at: scope.start_at }] });
    const { handler } = setup(batchResult(body));
    assert.equal((await handler(request(body))).status, 200);
  }
});

test("stream event windows include start and exclude end at microsecond precision", async () => {
  for (const stream of ["created", "updated"]) {
    for (const [event, valid] of [[scope.start_at, true], ["2026-10-04T01:09:59.999999Z", true],
      ["2026-10-04T00:59:59.999999Z", false], [scope.end_exclusive, false]]) {
      const item = { ...row(), ...(stream === "created" ? { created_at: event } : { updated_at: event }) };
      const body = batch({ stream, rows: [item] });
      const { handler, calls } = setup(batchResult(body));
      if (valid) assert.equal((await handler(request(body))).status, 200);
      else { await failure(handler, body); assert.equal(calls.length, 0); }
    }
  }
});

test("withdraw creation streams and unsupported stream names are rejected", async () => {
  for (const stream of ["created", "audit", "UPDATED"]) {
    const body = batch({ business: "withdraw", stream, rows: [{ ...row(), business_type: "withdraw" }] });
    const { handler, calls } = setup();
    await failure(handler, body);
    assert.equal(calls.length, 0);
  }
});

test("schema2 update events require updated_at and the original local creation day", async () => {
  for (const change of [{ updated_at: null }, { updated_at: "2026-10-04" }, { created_at: null },
    { created_day: "2026-10-03" }, { created_at: "2026-10-01T17:00:00Z", created_day: "2026-10-01" }]) {
    const body = batch({ stream: "updated", rows: [{ ...row(), updated_at: scope.start_at, ...change }] });
    const { handler, calls } = setup();
    await failure(handler, body);
    assert.equal(calls.length, 0);
  }
});

test("schema2 exact-key validation prevents schema1/schema2 scope mixing", async () => {
  const values = [{ schema_version: 2, action: "check", stream: "updated" },
    { schema_version: 2, action: "state", local_day: "2026-10-04" },
    { ...batch(), local_day: "2026-10-04" }, { ...finalize(), local_day: "2026-10-04" },
    Object.fromEntries(Object.entries(batch()).filter(([key]) => key !== "start_at")),
    Object.fromEntries(Object.entries(finalize()).filter(([key]) => key !== "stream"))];
  for (const value of values) {
    const { handler, calls } = setup();
    await failure(handler, value);
    assert.equal(calls.length, 0);
  }
});

test("schema2 stream intervals require strict UTC ISO and increasing bounds", async () => {
  for (const change of [{ start_at: "2026-10-04T08:00:00+07:00" }, { start_at: scope.end_exclusive },
    { start_at: "2026-10-04T01:11:00Z" }, { end_exclusive: "2026-02-30T01:10:00Z" }]) {
    const { handler, calls } = setup();
    await failure(handler, finalize(change));
    assert.equal(calls.length, 0);
  }
});

test("schema2 audit fields permit null or supported types, rejecting negative/fractional/missing values", async () => {
  const good = batch({ rows: [{ ...row(), audit_completed_at: "2026-10-04T01:01:00.123456+00:00", audit_duration_seconds: 60 }] });
  const { handler } = setup(batchResult(good));
  assert.equal((await handler(request(good))).status, 200);
  for (const change of [{ audit_completed_at: "2026-10-04" }, { audit_duration_seconds: -1 },
    { audit_duration_seconds: 1.5 }, { audit_duration_seconds: "60" }, { audit_duration_seconds: true },
    { audit_duration_seconds: Number.MAX_SAFE_INTEGER + 1 }]) {
    const { handler: reject } = setup();
    await failure(reject, batch({ rows: [{ ...row(), ...change }] }));
  }
  const missing = row();
  delete missing.audit_duration_seconds;
  const { handler: reject } = setup();
  await failure(reject, batch({ rows: [missing] }));
});

test("schema2 raw and amount projections admit the six new source fields without admitting secrets", async () => {
  const body = batch({ rows: [{ ...row(), raw: { audit_time: 1_791_075_660, audit_time_consuming: 60,
    gamount: "10", actual_received_gamount: "9", fee: "1", fee_gamount: "1" },
    amount_fields_raw: { gamount: "10", actual_received_gamount: "9", fee: "1", fee_gamount: "1" } }] });
  const { handler } = setup(batchResult(body));
  assert.equal((await handler(request(body))).status, 200);
  for (const change of [{ raw: { access_token: "private" } }, { raw: { audit_time: { nested: true } } },
    { raw: { audit_time_consuming: null } }, { amount_fields_raw: { gamount: 10 } },
    { amount_fields_raw: { fee: "Infinity" } }, { amount_fields_raw: { audit_time: "10" } }]) {
    const { handler: reject, calls } = setup();
    await failure(reject, batch({ rows: [{ ...row(), ...change }] }));
    assert.equal(calls.length, 0);
  }
});

test("source decimal strings retain a trailing decimal point without a unit conversion", async () => {
  const body = batch({ rows: [{ ...row(), amount_raw: "1.", amount_source: "amount",
    amount_fields_raw: { amount: "1." } }] });
  const { handler, calls } = setup(batchResult(body));
  assert.equal((await handler(request(body))).status, 200);
  assert.equal(JSON.parse(calls[0][1].body).p_body.rows[0].amount_raw, "1.");
});

test("schema2 still caps batches at 200 rows", async () => {
  const body = batch({ rows: Array.from({ length: MAX_ROWS }, row) });
  const { handler } = setup(batchResult(body));
  assert.equal((await handler(request(body))).status, 200);
  for (const rows of [[], Array.from({ length: MAX_ROWS + 1 }, row), [null]]) {
    const { handler: reject, calls } = setup();
    await failure(reject, batch({ rows }));
    assert.equal(calls.length, 0);
  }
});

test("schema2 batch ACK rejects missing or changed scope, mode, counts, and schema", async () => {
  const changes = [{ platform: "FB168" }, { business: "withdraw" }, { stream: "updated" },
    { start_at: "2026-10-04T01:00:00.000000Z" }, { end_exclusive: "2026-10-04T01:10:00+00:00" },
    { query_mode: "creation_day_recheck" }, { status_coverage: "all_verified" }, { received: 0 },
    { written: 2 }, { schema_version: 1 }, { window_id: batchId }, { replayed: "true" }];
  for (const change of changes) {
    const { handler } = setup({ ...batchResult(), ...change });
    await failure(handler, batch(), 502, "upstream_failure");
  }
  for (const key of ["stream", "start_at", "end_exclusive", "platform", "business", "query_mode", "status_coverage"]) {
    const malformed = batchResult();
    delete malformed[key];
    const { handler } = setup(malformed);
    await failure(handler, batch(), 502, "upstream_failure");
  }
});

test("schema2 finalize ACK requires exact stream interval echoes and matching finalized counts", async () => {
  const safe = finalResult();
  const { handler } = setup({ ...safe, orders: [row()], secret: serviceKey });
  assert.deepEqual(await (await handler(request(finalize()))).json(), safe);
  for (const change of [{ stream: "updated" }, { start_at: "2026-10-04T01:00:00+00:00" },
    { end_exclusive: "2026-10-04T01:10:00.000000Z" }, { uploaded_count: 0 }, { finalized: false },
    { status_coverage: "verified" }, { query_mode: "creation_day_recheck" }]) {
    const { handler: reject } = setup({ ...safe, ...change });
    await failure(reject, finalize(), 502, "upstream_failure");
  }
  const empty = finalize({ source_count: 0, batch_ids: [] });
  const { handler: emptyHandler } = setup(finalResult(empty));
  assert.equal((await emptyHandler(request(empty))).status, 200);
});

test("schema2 state returns bounded stream progress metadata without local_day or orders", async () => {
  const safe = progress();
  const { handler } = setup({ ok: true, schema_version: 2, action: "state",
    progress: [{ ...safe, local_day: "2026-10-04", orders: [row()], secret: serviceKey }] });
  assert.deepEqual(await (await handler(request({ schema_version: 2, action: "state" }))).json(), {
    ok: true, schema_version: 2, action: "state", progress: [safe],
  });
  for (const change of [{ stream: "created", business: "withdraw" }, { start_at: scope.end_exclusive },
    { uploaded_count: 0 }, { acknowledged_at: null }, { finalized: false }, { query_mode: "creation_day_recheck" }]) {
    const { handler: reject } = setup({ ok: true, schema_version: 2, action: "state", progress: [{ ...safe, ...change }] });
    await failure(reject, { schema_version: 2, action: "state" }, 502, "upstream_failure");
  }
});

test("schema2 maps SQL errors to fixed versioned errors without upstream details", async () => {
  const { handler } = setup(() => new Response(JSON.stringify({ code: "23505", message: `${key} ${serviceKey}` }), { status: 409 }));
  await failure(handler, batch(), 409, "conflict");
});

test("schema2 keeps strict response byte limits and RPC deadline", async () => {
  const { handler } = setup(() => new Response("x".repeat(MAX_BYTES)));
  await failure(handler, { schema_version: 2, action: "check" }, 502, "upstream_failure");
  let signal;
  const { handler: slow } = setup((_, init) => { signal = init.signal; return new Promise(() => {}); }, { rpcTimeoutMs: 10 });
  await failure(slow, { schema_version: 2, action: "check" }, 504, "upstream_timeout");
  assert.equal(signal.aborted, true);
});

test("schema1 continues to reject schema2-only row/raw/amount fields", async () => {
  const legacyRow = row();
  delete legacyRow.audit_completed_at;
  delete legacyRow.audit_duration_seconds;
  const legacy = { schema_version: 1, action: "batch", window_id: scope.window_id, batch_id: batchId,
    platform: scope.platform, business: scope.business, local_day: "2026-10-04", end_exclusive: scope.end_exclusive,
    observed_at: scope.end_exclusive, rows: [legacyRow] };
  for (const change of [{ audit_completed_at: null }, { raw: { gamount: "10" } }, { amount_fields_raw: { gamount: "10" } }]) {
    const { handler, calls } = setup();
    const result = await handler(request({ ...legacy, rows: [{ ...legacyRow, ...change }] }));
    assert.equal(result.status, 400);
    assert.deepEqual(await result.json(), { ok: false, schema_version: 1, error: "invalid_request" });
    assert.equal(calls.length, 0);
  }
});
