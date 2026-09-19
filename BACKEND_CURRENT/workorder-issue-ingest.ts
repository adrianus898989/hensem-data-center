// Deploy with verify_jwt=false only when this dedicated, revocable and
// platform-scoped credential check remains enabled. The collector must never
// receive a Supabase service-role key or dashboard read access.
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_GROUPS = 2000;
const MAX_SAFE_AMOUNT = 90_071_992_547_409.91;
const SOURCE_SYSTEM = "AR_WORKORDER";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type JsonObject = Record<string, unknown>;
type Scope = { country_code: string; platform: string; timezone: string };
type Credential = {
  source_system: string;
  allowed_source_systems: string[];
  allowed_scopes: Scope[];
  expires_at: string;
  revoked: boolean;
};
type Dependencies = {
  env: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  fetch?: typeof fetch;
  now?: () => Date;
};

const COUNT_FIELDS = [
  "submitted_count", "success_count", "withdraw_not_received_count", "withdraw_success_count",
] as const;
const AMOUNT_FIELDS = [
  "submitted_amount", "success_amount", "withdraw_not_received_amount", "withdraw_success_amount",
] as const;
const METRIC_FIELDS = [...COUNT_FIELDS, ...AMOUNT_FIELDS] as const;
const DEPOSIT_STATUSES = ["存款/待处理", "存款/处理中", "存款/已驳回", "存款/已处理", "存款/系统处理中"];
const WITHDRAW_STATUSES = ["提款/待处理", "提款/处理中", "提款/已驳回", "提款/已处理", "提款/系统处理中"];
const STATUS_KEYS = [...DEPOSIT_STATUSES, ...WITHDRAW_STATUSES];

class RequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function invalid(path: string): never {
  throw new RequestError(422, "invalid_snapshot", `Invalid snapshot field: ${path}`);
}
function object(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function onlyKeys(value: JsonObject, allowed: readonly string[], path: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid(`${path}.unexpected_fields`);
}
function cleanText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}
export function safeWorkorderDescriptor(value: unknown, max: number): value is string {
  return cleanText(value, max)
    && /^[\p{L}\p{N} ._/:,+()&#'‐‑‒–—−-]+$/u.test(value)
    && !/\d{7}/.test(value)
    && !/(https?:|www[.]|account[ _-]*number|member[ _-]*id|user[ _-]*id|order[ _-]*id|银行卡号|会员账号|会员姓名|真实姓名|手机号码|身份证)/i.test(value);
}
// Keep exact tuples aligned with workorder_issue_scopes_are_allowed.
export function allowedWorkorderIssueScope(value: unknown): value is Scope {
  if (!object(value) || Object.keys(value).sort().join(",") !== "country_code,platform,timezone") return false;
  return (value.country_code === "PK" && typeof value.platform === "string" && ["POPZAR", "92BLAZE"].includes(value.platform) && value.timezone === "Asia/Karachi")
    || (value.country_code === "IN" && value.platform === "DhaniWin" && value.timezone === "Asia/Kolkata");
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function amount(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_SAFE_AMOUNT) return false;
  const scaled = value * 100;
  return Number.isSafeInteger(Math.round(scaled)) && Math.abs(scaled - Math.round(scaled)) < 1e-6;
}
function cents(value: unknown, path: string): number {
  if (!amount(value)) invalid(path);
  return Math.round((value as number) * 100);
}
function realDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}
function dateInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  return ["year", "month", "day"].map(key => parts.find(part => part.type === key)!.value).join("-");
}
function validZone(value: unknown): value is string {
  if (!cleanText(value, 80)) return false;
  try { dateInZone(new Date(), value); return true; } catch { return false; }
}
function addSafe(total: number, value: number, path: string): number {
  const next = total + value;
  if (!Number.isSafeInteger(next)) invalid(`${path}.overflow`);
  return next;
}
function validateMetricObject(value: JsonObject, path: string): void {
  for (const key of COUNT_FIELDS) if (!count(value[key])) invalid(`${path}.${key}`);
  for (const key of AMOUNT_FIELDS) if (!amount(value[key])) invalid(`${path}.${key}`);
  if ((value.success_count as number) > (value.submitted_count as number)
    || (value.withdraw_success_count as number) > (value.withdraw_not_received_count as number)
    || cents(value.success_amount, `${path}.success_amount`) > cents(value.submitted_amount, `${path}.submitted_amount`)
    || cents(value.withdraw_success_amount, `${path}.withdraw_success_amount`) > cents(value.withdraw_not_received_amount, `${path}.withdraw_not_received_amount`)) {
    invalid(`${path}.success_bounds`);
  }
}
function validateStatusCounts(value: unknown, group: JsonObject, path: string): void {
  if (!object(value)) invalid(path);
  onlyKeys(value, STATUS_KEYS, path);
  for (const [key, item] of Object.entries(value)) if (!count(item)) invalid(`${path}.${key}`);
  const sum = (keys: string[]) => keys.reduce((total, key) => addSafe(total, Number(value[key] || 0), path), 0);
  if (sum(DEPOSIT_STATUSES) !== group.submitted_count
    || sum(WITHDRAW_STATUSES) !== group.withdraw_not_received_count
    || Number(value["存款/已处理"] || 0) !== group.success_count
    || Number(value["提款/已处理"] || 0) !== group.withdraw_success_count) invalid(`${path}.totals`);
}

export function validateWorkorderIssueSnapshot(value: unknown, now = new Date()): JsonObject {
  if (!object(value)) invalid("snapshot");
  onlyKeys(value, [
    "schema_version", "source_system", "country_code", "country", "platform", "stat_date", "timezone",
    "snapshot_id", "snapshot_at", "coverage", "totals", "groups",
  ], "snapshot");
  let encoded: Uint8Array;
  try { encoded = new TextEncoder().encode(JSON.stringify(value)); } catch { invalid("snapshot"); }
  if (encoded!.byteLength > MAX_BODY_BYTES) invalid("snapshot.size");
  if (value.schema_version !== 1 || value.source_system !== SOURCE_SYSTEM) invalid("schema_version/source_system");
  if (typeof value.country_code !== "string" || !/^[A-Z]{2}$/.test(value.country_code)) invalid("country_code");
  if (!safeWorkorderDescriptor(value.country, 80)) invalid("country");
  if (!safeWorkorderDescriptor(value.platform, 80)) invalid("platform");
  if (!realDate(value.stat_date) || value.stat_date < "2020-01-01") invalid("stat_date");
  if (!validZone(value.timezone)) invalid("timezone");
  if (!allowedWorkorderIssueScope({country_code:value.country_code,platform:value.platform,timezone:value.timezone})
    || value.country !== (value.country_code === "PK" ? "巴基斯坦" : "印度")) invalid("scope");
  if (typeof value.snapshot_id !== "string" || !UUID.test(value.snapshot_id)) invalid("snapshot_id");
  if (typeof value.snapshot_at !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value.snapshot_at)) invalid("snapshot_at");
  const timestamp = Date.parse(value.snapshot_at);
  if (!Number.isFinite(timestamp) || timestamp < Date.UTC(2020, 0, 1)
    || new Date(timestamp).toISOString().slice(0, 19) !== value.snapshot_at.slice(0, 19)
    || timestamp > now.getTime() + 5 * 60_000) invalid("snapshot_at");
  if (value.stat_date >= dateInZone(now, value.timezone as string)
    || value.stat_date >= dateInZone(new Date(timestamp), value.timezone as string)) invalid("stat_date.incomplete_day");

  if (value.platform === "92BLAZE" && (value.stat_date < "2026-09-22"
    || timestamp < Date.parse("2026-09-21T19:00:00Z")
    || now.getTime() < Date.parse("2026-09-21T19:00:00Z"))) invalid("stat_date.launch");

  if (!object(value.coverage) || !object(value.totals)) invalid("coverage/totals");
  const coverage = value.coverage, totals = value.totals;
  onlyKeys(coverage, [
    "complete", "expected_count", "fetched_count", "unique_count", "target_count", "ignored_count", "unmapped_count",
  ], "coverage");
  onlyKeys(totals, METRIC_FIELDS, "totals");
  if (coverage.complete !== true) invalid("coverage.complete");
  for (const key of ["expected_count", "fetched_count", "unique_count", "target_count", "ignored_count", "unmapped_count"])
    if (!count(coverage[key])) invalid(`coverage.${key}`);
  if (coverage.unmapped_count !== 0
    || coverage.expected_count !== coverage.fetched_count
    || coverage.expected_count !== coverage.unique_count
    || addSafe(coverage.target_count as number, coverage.ignored_count as number, "coverage") !== coverage.unique_count) {
    invalid("coverage.counts");
  }
  validateMetricObject(totals, "totals");
  if (addSafe(totals.submitted_count as number, totals.withdraw_not_received_count as number, "totals")
    + (coverage.unmapped_count as number) !== coverage.target_count) invalid("coverage.target_count");

  if (!Array.isArray(value.groups) || value.groups.length > MAX_GROUPS) invalid("groups");
  const seen = new Set<string>();
  const sums: Record<string, number> = Object.fromEntries(METRIC_FIELDS.map(key => [key, 0]));
  for (let index = 0; index < value.groups.length; index++) {
    const group = value.groups[index], path = `groups[${index}]`;
    if (!object(group)) invalid(path);
    onlyKeys(group, ["third_party", "channel_type", ...METRIC_FIELDS, "status_counts"], path);
    if (!safeWorkorderDescriptor(group.third_party, 96) || !safeWorkorderDescriptor(group.channel_type, 80)) invalid(`${path}.descriptor`);
    validateMetricObject(group, path);
    if (addSafe(group.submitted_count as number, group.withdraw_not_received_count as number, path) <= 0) invalid(`${path}.empty`);
    validateStatusCounts(group.status_counts, group, `${path}.status_counts`);
    const identity = JSON.stringify([group.third_party, group.channel_type]);
    if (seen.has(identity)) invalid(`${path}.duplicate`);
    seen.add(identity);
    for (const key of COUNT_FIELDS) sums[key] = addSafe(sums[key], group[key] as number, `groups.${key}`);
    for (const key of AMOUNT_FIELDS) sums[key] = addSafe(sums[key], cents(group[key], `${path}.${key}`), `groups.${key}`);
  }
  for (const key of COUNT_FIELDS) if (sums[key] !== totals[key]) invalid(`totals.${key}.groups`);
  for (const key of AMOUNT_FIELDS) if (sums[key] !== cents(totals[key], `totals.${key}`)) invalid(`totals.${key}.groups`);
  return value;
}

async function readBody(request: Request): Promise<JsonObject> {
  const length = request.headers.get("content-length");
  if (length && Number(length) > MAX_BODY_BYTES) throw new RequestError(413, "payload_too_large", "Payload exceeds 1 MiB");
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "invalid_json", "JSON body is required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RequestError(413, "payload_too_large", "Payload exceeds 1 MiB");
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!object(parsed)) throw new Error();
    return parsed;
  } catch { throw new RequestError(400, "invalid_json", "Body must be a JSON object"); }
}

export async function workorderIssueTokenHash(token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function response(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
  } });
}

export function createWorkorderIssueHandler(dependencies: Dependencies): (request: Request) => Promise<Response> {
  const requestFetch = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const url = (dependencies.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = dependencies.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  async function database(path: string, body?: JsonObject): Promise<unknown> {
    const result = await requestFetch(`${url}/rest/v1/${path}`, {
      method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000), redirect: "error", cache: "no-store",
    });
    const data: unknown = await result.json().catch(() => null);
    if (!result.ok) {
      const code = object(data) ? String(data.message || "") : "";
      if (code === "WOI_AUTH_INVALID") throw new RequestError(401, "invalid_key", "Work-order issue key is invalid or expired");
      if (code === "WOI_SCOPE_DENIED") throw new RequestError(403, "scope_denied", "Work-order issue key does not allow this scope");
      if (code === "WOI_ID_CONFLICT") throw new RequestError(409, "snapshot_conflict", "Snapshot ID was reused with different content");
      if (code.startsWith("WOI_INVALID")) throw new RequestError(422, "invalid_snapshot", "Snapshot failed database validation");
      throw new RequestError(503, "storage_unavailable", "Snapshot storage is temporarily unavailable");
    }
    return data;
  }
  return async request => {
    try {
      if (request.method !== "POST") return response(405, { ok: false, error: "method_not_allowed" });
      if (!url || !key) throw new RequestError(503, "not_configured", "Snapshot storage is not configured");
      const token = request.headers.get("X-Workorder-Issue-Key") || "";
      if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new RequestError(401, "invalid_key", "A dedicated X-Workorder-Issue-Key is required");
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || ""))
        throw new RequestError(415, "unsupported_media_type", "Use application/json");
      const hash = await workorderIssueTokenHash(token);
      const params = new URLSearchParams({
        select: "source_system,allowed_source_systems,allowed_scopes,expires_at,revoked", token_hash: `eq.${hash}`, limit: "1",
      });
      const credentials = await database(`workorder_issue_credentials?${params}`);
      const credential = Array.isArray(credentials) ? credentials[0] as Credential | undefined : undefined;
      if (!credential || credential.source_system !== SOURCE_SYSTEM || credential.revoked !== false
        || !Array.isArray(credential.allowed_source_systems) || credential.allowed_source_systems.length !== 1 || credential.allowed_source_systems[0] !== SOURCE_SYSTEM
        || !Number.isFinite(Date.parse(credential.expires_at)) || Date.parse(credential.expires_at) <= now().getTime()) {
        throw new RequestError(401, "invalid_key", "Work-order issue key is invalid or expired");
      }
      if (!Array.isArray(credential.allowed_scopes) || !credential.allowed_scopes.length || credential.allowed_scopes.length > 3
        || credential.allowed_scopes.some(scope => !allowedWorkorderIssueScope(scope))
        || new Set(credential.allowed_scopes.map(scope => scope.platform)).size !== credential.allowed_scopes.length) {
        throw new RequestError(401, "invalid_key", "Work-order issue key has no valid scope");
      }
      const body = await readBody(request);
      if (body.action === "check") {
        onlyKeys(body, ["action"], "request");
        return response(200, { ok: true, source_system: credential.source_system, scope_count: credential.allowed_scopes.length });
      }
      if (body.action !== "ingest") throw new RequestError(400, "invalid_action", "Use action ingest or check");
      onlyKeys(body, ["action", "snapshot"], "request");
      const snapshot = validateWorkorderIssueSnapshot(body.snapshot, now());
      if (!credential.allowed_source_systems.includes(String(snapshot.source_system))
        || !credential.allowed_scopes.some(scope => scope.country_code === snapshot.country_code
          && scope.platform === snapshot.platform && scope.timezone === snapshot.timezone)) {
        throw new RequestError(403, "scope_denied", "Work-order issue key does not allow this scope");
      }
      const ack = await database("rpc/publish_workorder_issue_snapshot", { p_token_hash: hash, p_snapshot: snapshot });
      if (!object(ack) || ack.ok !== true || !["accepted", "unchanged", "stale"].includes(String(ack.status))
        || ack.snapshot_id !== snapshot.snapshot_id || typeof ack.current_snapshot_id !== "string" || !UUID.test(ack.current_snapshot_id)
        || (ack.status !== "stale" && ack.current_snapshot_id.toLowerCase() !== String(snapshot.snapshot_id).toLowerCase())) {
        throw new RequestError(503, "storage_unavailable", "Snapshot storage returned an invalid acknowledgement");
      }
      return response(200, ack);
    } catch (error) {
      if (error instanceof RequestError) return response(error.status, { ok: false, error: error.code, message: error.message });
      // Never log or reflect credentials, submitted aggregates or database response bodies.
      return response(503, { ok: false, error: "temporarily_unavailable", message: "Please retry this complete snapshot later" });
    }
  };
}
