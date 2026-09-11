import { createWithdrawReasonsHandler, tokenHash, validateSnapshot } from "../BACKEND_CURRENT/withdraw-reasons-ingest.ts";

function assert(condition: unknown, message = "Assertion failed"): asserts condition { if (!condition) throw new Error(message); }
const now = new Date("2026-09-10T10:00:00Z");
const key = "local-reasons-test-key-with-32-bytes-minimum";
function snapshot() {
  return {
    schema_version: 1, source_system: "AR", country_code: "IN", platform: "SHREE.WIN", stat_date: "2026-09-01", timezone: "Asia/Kolkata",
    snapshot_id: "10000000-0000-4000-8000-000000000001", snapshot_at: "2026-09-10T09:00:00Z", classifier_version: "note-template-v1",
    coverage: { complete: true, expected_count: 9, fetched_count: 10, unique_count: 9, missing_order_ids: 0, note_header_found: true, incomplete_note_count: 1 },
    totals: { total: 9, auto: 5, manual: 3, unknown: 1, success: 6, reject: 2, other: 1 },
    groups: [
      { operator_class: "auto", reason_key: "a".repeat(64), reason_label: "自动处理", classification: "template", count: 5, success: 4, reject: 1, other: 0, samples: ["自动审核通过"] },
      { operator_class: "manual", reason_key: "b".repeat(64), reason_label: "通道维护，转人工", classification: "template", count: 3, success: 2, reject: 1, other: 0, samples: ["通道维护，人工处理"] },
      { operator_class: "unknown", reason_key: "c".repeat(64), reason_label: "备注被截断", classification: "truncated", count: 1, success: 0, reject: 0, other: 1, samples: [] },
    ],
  };
}
type Options = { credentialPatch?: Record<string, unknown>; noCredential?: boolean; rpcError?: string; reportSnapshots?: unknown[]; ack?: Record<string, unknown> };
async function fixture(options: Options = {}) {
  const hash = await tokenHash(key);
  const calls: { path: string; body?: Record<string, unknown> }[] = [];
  const handler = createWithdrawReasonsHandler({
    env: { SUPABASE_URL: "https://local-db.invalid", SUPABASE_SERVICE_ROLE_KEY: "server-only-test-value" }, now: () => now,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      assert(url.hostname === "local-db.invalid", "No real network is allowed");
      assert((init?.headers as Record<string, string>).Authorization === "Bearer server-only-test-value");
      assert(!JSON.stringify(init?.headers).includes(key), "Raw reasons key must never be forwarded");
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path: url.pathname, body });
      if (url.pathname.endsWith("withdraw_reasons_credentials")) {
        assert(url.searchParams.get("token_hash") === `eq.${hash}`);
        return Response.json(options.noCredential ? [] : [{ source_system: "AR", allowed_scopes: [{ country_code: "IN", platform: "SHREE.WIN" }], expires_at: "2027-01-01T00:00:00Z", revoked: false, ...options.credentialPatch }]);
      }
      assert(body?.p_token_hash === hash);
      if (options.rpcError) return Response.json({ message: options.rpcError, details: "sensitive upstream details" }, { status: 400 });
      if (url.pathname.endsWith("publish_withdraw_reasons_snapshot")) {
        const incoming = body?.p_snapshot as Record<string, unknown>;
        return Response.json(options.ack || { ok: true, status: "accepted", snapshot_id: incoming.snapshot_id, current_snapshot_id: incoming.snapshot_id });
      }
      if (url.pathname.endsWith("report_withdraw_reasons_snapshots")) return Response.json({ ok: true, snapshots: options.reportSnapshots || [snapshot()] });
      throw new Error("Unexpected fixture request");
    }) as typeof fetch,
  });
  const request = (body: unknown, headers: Record<string, string> = {}) => handler(new Request("https://edge.invalid", { method: "POST", headers: { "content-type": "application/json", "X-Reasons-Key": key, ...headers }, body: JSON.stringify(body) }));
  return { handler, request, calls };
}

Deno.test("complete snapshot with separate unknown/truncated bucket publishes", async () => {
  const { request, calls } = await fixture();
  const result = await request({ action: "ingest", snapshot: snapshot() });
  assert(result.status === 200);
  assert((await result.json()).status === "accepted");
  assert(calls.length === 2);
});

Deno.test("empty day is valid only when all counters are zero", () => {
  const value = snapshot();
  value.groups = [];
  value.coverage = { ...value.coverage, expected_count: 0, fetched_count: 0, unique_count: 0, incomplete_note_count: 0 };
  value.totals = { total: 0, auto: 0, manual: 0, unknown: 0, success: 0, reject: 0, other: 0 };
  validateSnapshot(value, now);
});

const invalidCases: [string, (value: ReturnType<typeof snapshot>) => void][] = [
  ["unexpected raw data", value => { Object.assign(value, { raw_customer: "must not store" }); }],
  ["unexpected coverage field", value => { Object.assign(value.coverage, { raw_order: "must not store" }); }],
  ["unexpected totals field", value => { Object.assign(value.totals, { account: "must not store" }); }],
  ["unexpected group field", value => { Object.assign(value.groups[0], { bank_card: "must not store" }); }],
  ["incomplete coverage", value => { value.coverage.complete = false; }],
  ["missing order ids", value => { value.coverage.missing_order_ids = 1; }],
  ["missing note header", value => { value.coverage.note_header_found = false; }],
  ["incomplete fetch", value => { value.coverage.fetched_count = 8; }],
  ["coverage mismatch", value => { value.coverage.expected_count = 10; }],
  ["operator mismatch", value => { value.totals.manual = 4; }],
  ["status mismatch", value => { value.groups[0].success = 5; }],
  ["truncated mismatch", value => { value.coverage.incomplete_note_count = 0; }],
  ["negative count", value => { value.groups[0].count = -1; }],
  ["fractional count", value => { value.groups[0].count = 1.5; }],
  ["unsafe count", value => { value.totals.total = Number.MAX_SAFE_INTEGER + 1; }],
  ["duplicate reason", value => { value.groups.push({ ...value.groups[0] }); }],
  ["invalid reason hash", value => { value.groups[0].reason_key = ""; }],
  ["unknown classification", value => { value.groups[0].classification = "other"; }],
  ["oversized reason label", value => { value.groups[0].reason_label = "x".repeat(401); }],
  ["too many samples", value => { value.groups[0].samples = ["a", "b", "c", "d"]; }],
  ["oversized sample", value => { value.groups[0].samples = ["x".repeat(501)]; }],
  ["invalid calendar date", value => { value.stat_date = "2026-02-30"; }],
  ["future date", value => { value.stat_date = "2026-09-11"; }],
  ["future snapshot", value => { value.snapshot_at = "2026-09-10T10:05:01Z"; }],
  ["non-UTC timestamp", value => { value.snapshot_at = "2026-09-10T09:00:00+00:00"; }],
  ["invalid timezone", value => { value.timezone = "not-a-timezone"; }],
  ["too many groups", value => { value.groups = Array.from({ length: 5001 }, () => ({ ...value.groups[0] })); }],
];
for (const [label, change] of invalidCases) Deno.test(`rejects ${label} without publication`, async () => {
  const { request, calls } = await fixture();
  const value = snapshot(); change(value);
  const result = await request({ action: "ingest", snapshot: value });
  assert(result.status === 422, `${label}: HTTP ${result.status}`);
  assert(!calls.some(call => call.path.includes("/rpc/")));
});

for (const [label, options] of [
  ["unknown", { noCredential: true }],
  ["revoked", { credentialPatch: { revoked: true } }],
  ["expired", { credentialPatch: { expires_at: now.toISOString() } }],
  ["unscoped", { credentialPatch: { allowed_scopes: [] } }],
] as [string, Options][]) Deno.test(`${label} credentials cannot ingest or report`, async () => {
  const { request, calls } = await fixture(options);
  assert((await request({ action: "ingest", snapshot: snapshot() })).status === 401);
  assert((await request({ action: "report", start: "2026-09-01", end: "2026-09-01", platforms: [] })).status === 401);
  assert(!calls.some(call => call.path.includes("/rpc/")));
});

Deno.test("missing key, unsupported method, content type and malformed JSON fail closed", async () => {
  const { handler, request, calls } = await fixture();
  assert((await request({}, { "X-Reasons-Key": "" })).status === 401);
  assert((await handler(new Request("https://edge.invalid"))).status === 405);
  assert((await request({}, { "content-type": "text/plain" })).status === 415);
  assert(calls.length === 0);
  assert((await handler(new Request("https://edge.invalid", { method: "POST", headers: { "content-type": "application/json", "X-Reasons-Key": key }, body: "{" }))).status === 400);
});

Deno.test("large bodies reject before publication even without content-length", async () => {
  const { request, calls } = await fixture();
  assert((await request({ action: "ingest", padding: "x".repeat(2 * 1024 * 1024), snapshot: snapshot() })).status === 413);
  assert(!calls.some(call => call.path.includes("/rpc/")));
});

Deno.test("source system and exact country/platform scope are required", async () => {
  for (const patch of [{ source_system: "WG" }, { country_code: "VN" }, { platform: "OTHER" }]) {
    const { request, calls } = await fixture();
    assert((await request({ action: "ingest", snapshot: { ...snapshot(), ...patch } })).status === 403);
    assert(!calls.some(call => call.path.includes("/rpc/")));
  }
});

Deno.test("report scopes platform requests and inclusive 31-day range", async () => {
  const { request } = await fixture();
  assert((await request({ action: "report", start: "2026-08-01", end: "2026-08-31", platforms: ["SHREE.WIN"] })).status === 200);
  assert((await request({ action: "report", start: "2026-08-01", end: "2026-09-01", platforms: [] })).status === 422);
  assert((await request({ action: "report", start: "2026-08-31", end: "2026-08-01", platforms: [] })).status === 422);
  assert((await request({ action: "report", start: "2026-02-30", end: "2026-03-01", platforms: [] })).status === 422);
  assert((await request({ action: "report", start: "2026-08-01", end: "2026-08-31", platforms: ["OTHER"] })).status === 403);
});

Deno.test("report preserves more than 1000 snapshots from aggregate RPC", async () => {
  const snapshots = Array.from({ length: 1100 }, () => snapshot());
  const { request } = await fixture({ reportSnapshots: snapshots });
  const result = await request({ action: "report", start: "2026-08-01", end: "2026-08-31", platforms: [] });
  assert((await result.json()).snapshots.length === 1100);
});

Deno.test("database duplicate/stale ACKs pass through, ID conflict is 409", async () => {
  for (const status of ["unchanged", "stale"]) {
    const { request } = await fixture({ ack: { ok: true, status, snapshot_id: snapshot().snapshot_id, current_snapshot_id: status === "unchanged" ? snapshot().snapshot_id : "20000000-0000-4000-8000-000000000002" } });
    const result = await request({ action: "ingest", snapshot: snapshot() });
    assert(result.status === 200 && (await result.json()).status === status);
  }
  const { request } = await fixture({ rpcError: "WR_ID_CONFLICT" });
  const result = await request({ action: "ingest", snapshot: snapshot() });
  assert(result.status === 409);
  assert(!(await result.text()).includes("sensitive upstream"));
});

Deno.test("credential revoked between check and RPC returns unauthorized", async () => {
  const { request } = await fixture({ rpcError: "WR_AUTH_INVALID" });
  assert((await request({ action: "ingest", snapshot: snapshot() })).status === 401);
});
