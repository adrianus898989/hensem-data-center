// Standalone endpoint. Deploy as withdraw-reasons-ingest with verify_jwt=false.
// Every ingest/report request authenticates its dedicated X-Reasons-Key below.
// Never reuse dashboard passwords, browser JWTs, or an existing sync secret.

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_GROUPS = 5000;
const MAX_COUNT = Number.MAX_SAFE_INTEGER;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const CLASSES = ["auto", "manual", "unknown"] as const;
const CLASSIFICATIONS = ["template", "empty", "unclassified", "truncated"] as const;

type JsonObject = Record<string, unknown>;
type Scope = { country_code: string; platform: string };
type Credential = { source_system: string; allowed_scopes: Scope[]; expires_at: string; revoked: boolean };
type Dependencies = { env: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string }; fetch?: typeof fetch; now?: () => Date };

class RequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function invalid(path: string): never { throw new RequestError(422, "invalid_snapshot", `Invalid snapshot field: ${path}`); }
function object(value: unknown): value is JsonObject { return !!value && typeof value === "object" && !Array.isArray(value); }
function onlyKeys(value: JsonObject, allowed: string[], path: string): void { if (Object.keys(value).some(key => !allowed.includes(key))) invalid(`${path}.unexpected_fields`); }
function cleanText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}
function count(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function sum(a: number, b: number, path: string): number { const next = a + b; if (!Number.isSafeInteger(next) || next > MAX_COUNT) invalid(path); return next; }
function realDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function dateInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map(key => parts.find(part => part.type === key)!.value).join("-");
}

export function validateSnapshot(value: unknown, now = new Date(), nested = false): JsonObject {
  if (!object(value)) invalid("snapshot");
  onlyKeys(value, ["schema_version", "source_system", "country_code", "platform", "stat_date", "timezone", "snapshot_id", "snapshot_at", "classifier_version", "coverage", "totals", "groups", "note_field", "member_notes"], "snapshot");
  if ("note_field" in value || "member_notes" in value) {
    if (nested || value.source_system !== "NEWAR" || value.note_field !== "remark") invalid("note_field");
    if ("member_notes" in value) {
      const member = validateSnapshot(value.member_notes, now, true);
      for (const key of ["source_system", "country_code", "platform", "stat_date", "timezone", "snapshot_at"])
        if (member[key] !== value[key]) invalid(`member_notes.${key}`);
      if (!object(value.totals) || !object(value.coverage)) invalid("member_notes.scope");
      for (const key of ["total", ...CLASSES, "success", "reject", "other"])
        if ((member.totals as JsonObject)[key] !== value.totals[key]) invalid(`member_notes.totals.${key}`);
      for (const key of ["expected_count", "fetched_count", "unique_count"])
        if ((member.coverage as JsonObject)[key] !== value.coverage[key]) invalid(`member_notes.coverage.${key}`);
    }
  }
  if (value.schema_version !== 1) invalid("schema_version");
  if (!cleanText(value.source_system, 32) || !/^[A-Z0-9][A-Z0-9_-]*$/.test(value.source_system)) invalid("source_system");
  if (typeof value.country_code !== "string" || !/^[A-Z]{2}$/.test(value.country_code)) invalid("country_code");
  if (!cleanText(value.platform, 80)) invalid("platform");
  if (!realDate(value.stat_date)) invalid("stat_date");
  if (!cleanText(value.timezone, 80)) invalid("timezone");
  try { if (value.stat_date > dateInZone(now, value.timezone)) invalid("stat_date"); } catch (error) { if (error instanceof RequestError) throw error; invalid("timezone"); }
  if (typeof value.snapshot_id !== "string" || !UUID.test(value.snapshot_id)) invalid("snapshot_id");
  if (typeof value.snapshot_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value.snapshot_at) || !realDate(value.snapshot_at.slice(0, 10))) invalid("snapshot_at");
  const timestamp = Date.parse(value.snapshot_at);
  if (!Number.isFinite(timestamp) || timestamp > now.getTime() + 5 * 60_000) invalid("snapshot_at");
  if (!cleanText(value.classifier_version, 80)) invalid("classifier_version");
  if (!object(value.coverage)) invalid("coverage");
  const coverage = value.coverage;
  onlyKeys(coverage, ["complete", "expected_count", "fetched_count", "unique_count", "missing_order_ids", "note_header_found", "incomplete_note_count"], "coverage");
  if (coverage.complete !== true || coverage.note_header_found !== true || coverage.missing_order_ids !== 0) invalid("coverage.complete");
  for (const key of ["expected_count", "fetched_count", "unique_count", "incomplete_note_count"]) if (!count(coverage[key])) invalid(`coverage.${key}`);
  if (coverage.expected_count !== coverage.unique_count || (coverage.unique_count as number) > (coverage.fetched_count as number)) invalid("coverage.counts");
  if (!object(value.totals)) invalid("totals");
  const totals = value.totals;
  onlyKeys(totals, ["total", ...CLASSES, "success", "reject", "other"], "totals");
  for (const key of ["total", ...CLASSES, "success", "reject", "other"]) if (!count(totals[key])) invalid(`totals.${key}`);
  if (totals.total !== coverage.expected_count) invalid("totals.total");
  if (!Array.isArray(value.groups) || value.groups.length > MAX_GROUPS) invalid("groups");
  const aggregate = { total: 0, auto: 0, manual: 0, unknown: 0, success: 0, reject: 0, other: 0, truncated: 0 };
  const seen = new Set<string>();
  for (let index = 0; index < value.groups.length; index++) {
    const group = value.groups[index];
    const field = `groups[${index}]`;
    if (!object(group)) invalid(field);
    onlyKeys(group, ["operator_class", "reason_key", "reason_label", "classification", "count", "success", "reject", "other", "samples"], field);
    if (!CLASSES.includes(group.operator_class as typeof CLASSES[number])) invalid(`${field}.operator_class`);
    if (typeof group.reason_key !== "string" || !SHA256.test(group.reason_key)) invalid(`${field}.reason_key`);
    if (!cleanText(group.reason_label, 400)) invalid(`${field}.reason_label`);
    if (!CLASSIFICATIONS.includes(group.classification as typeof CLASSIFICATIONS[number])) invalid(`${field}.classification`);
    for (const key of ["count", "success", "reject", "other"]) if (!count(group[key])) invalid(`${field}.${key}`);
    if (!Array.isArray(group.samples) || group.samples.length > 3 || group.samples.some(sample => typeof sample !== "string" || sample.length > 500)) invalid(`${field}.samples`);
    const identity = `${group.operator_class}:${group.reason_key}`;
    if (seen.has(identity)) invalid(`${field}.duplicate_reason`);
    seen.add(identity);
    if (sum(sum(group.success as number, group.reject as number, field), group.other as number, field) !== group.count) invalid(`${field}.statuses`);
    aggregate.total = sum(aggregate.total, group.count as number, "groups.total");
    const operator = group.operator_class as typeof CLASSES[number];
    aggregate[operator] = sum(aggregate[operator], group.count as number, `groups.${operator}`);
    for (const status of ["success", "reject", "other"] as const) aggregate[status] = sum(aggregate[status], group[status] as number, `groups.${status}`);
    if (group.classification === "truncated") aggregate.truncated = sum(aggregate.truncated, group.count as number, "groups.truncated");
  }
  for (const key of ["total", ...CLASSES, "success", "reject", "other"] as const) if (aggregate[key] !== totals[key]) invalid(`totals.${key}`);
  if (aggregate.truncated !== coverage.incomplete_note_count) invalid("coverage.incomplete_note_count");
  return value;
}

export function validateReport(value: JsonObject): { start: string; end: string; platforms: string[] } {
  if (!realDate(value.start) || !realDate(value.end) || value.start > value.end || (Date.parse(value.end) - Date.parse(value.start)) / 86400000 >= 31) {
    throw new RequestError(422, "invalid_report", "Report must cover 1–31 inclusive calendar days");
  }
  if (!Array.isArray(value.platforms) || value.platforms.length > 1000 || value.platforms.some(platform => !cleanText(platform, 80)) || new Set(value.platforms).size !== value.platforms.length) {
    throw new RequestError(422, "invalid_report", "platforms must be a list of unique platform names");
  }
  return { start: value.start, end: value.end, platforms: value.platforms as string[] };
}

async function readBody(request: Request): Promise<JsonObject> {
  const length = request.headers.get("content-length");
  if (length && Number(length) > MAX_BODY_BYTES) throw new RequestError(413, "payload_too_large", "Payload exceeds 2 MiB");
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "invalid_json", "JSON body is required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new RequestError(413, "payload_too_large", "Payload exceeds 2 MiB"); }
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

export async function tokenHash(token: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function response(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

export function createWithdrawReasonsHandler(dependencies: Dependencies): (request: Request) => Promise<Response> {
  const requestFetch = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const url = (dependencies.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = dependencies.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  async function database(path: string, body?: JsonObject): Promise<unknown> {
    const result = await requestFetch(`${url}/rest/v1/${path}`, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const data = await result.json().catch(() => null);
    if (!result.ok) {
      const code = object(data) ? String(data.message || "") : "";
      if (code === "WR_AUTH_INVALID") throw new RequestError(401, "invalid_key", "Reasons key is invalid or expired");
      if (code === "WR_SCOPE_DENIED") throw new RequestError(403, "scope_denied", "Reasons key does not allow this source or platform");
      if (code === "WR_ID_CONFLICT") throw new RequestError(409, "snapshot_conflict", "snapshot_id was already used with different content");
      if (code.startsWith("WR_INVALID")) throw new RequestError(422, "invalid_snapshot", "Snapshot or report failed database validation");
      throw new RequestError(503, "storage_unavailable", "Snapshot storage is temporarily unavailable");
    }
    return data;
  }
  return async request => {
    try {
      if (request.method !== "POST") return response(405, { ok: false, error: "method_not_allowed" });
      if (!url || !serviceKey) throw new RequestError(503, "not_configured", "Snapshot storage is not configured");
      const token = request.headers.get("X-Reasons-Key") || "";
      if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new RequestError(401, "invalid_key", "A dedicated X-Reasons-Key is required");
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) throw new RequestError(415, "unsupported_media_type", "Use application/json");
      const hash = await tokenHash(token);
      const params = new URLSearchParams({ select: "source_system,allowed_scopes,expires_at,revoked", token_hash: `eq.${hash}`, limit: "1" });
      const rows = await database(`withdraw_reasons_credentials?${params}`);
      const credential = Array.isArray(rows) ? rows[0] as Credential | undefined : undefined;
      if (!credential || credential.revoked !== false || !Number.isFinite(Date.parse(credential.expires_at)) || Date.parse(credential.expires_at) <= now().getTime()) throw new RequestError(401, "invalid_key", "Reasons key is invalid or expired");
      if (!Array.isArray(credential.allowed_scopes) || !credential.allowed_scopes.length || credential.allowed_scopes.some(scope => !scope || !/^[A-Z]{2}$/.test(scope.country_code) || !cleanText(scope.platform, 80))) throw new RequestError(401, "invalid_key", "Reasons key is not configured with a valid scope");
      const body = await readBody(request);
      if (body.action === "ingest") {
        onlyKeys(body, ["action", "snapshot"], "request");
        const snapshot = validateSnapshot(body.snapshot, now());
        if (snapshot.source_system !== credential.source_system || !credential.allowed_scopes.some(scope => scope.country_code === snapshot.country_code && scope.platform === snapshot.platform)) throw new RequestError(403, "scope_denied", "Reasons key does not allow this source or platform");
        const ack = await database("rpc/publish_withdraw_reasons_snapshot", { p_token_hash: hash, p_snapshot: snapshot });
        if (!object(ack) || ack.ok !== true || !["accepted", "unchanged", "stale"].includes(String(ack.status)) || ack.snapshot_id !== snapshot.snapshot_id || typeof ack.current_snapshot_id !== "string") throw new RequestError(503, "storage_unavailable", "Snapshot storage returned an invalid acknowledgement");
        if (ack.status !== "stale" && ack.current_snapshot_id.toLowerCase() !== String(snapshot.snapshot_id).toLowerCase()) throw new RequestError(503, "storage_unavailable", "Snapshot acknowledgement does not match the current snapshot");
        return response(200, ack);
      }
      if (body.action === "report") {
        onlyKeys(body, ["action", "start", "end", "platforms"], "request");
        const report = validateReport(body);
        if (report.platforms.some(platform => !credential.allowed_scopes.some(scope => scope.platform === platform))) throw new RequestError(403, "scope_denied", "Report includes a platform outside this reasons key");
        // One JSON aggregate RPC avoids PostgREST's row cap and pagination drift.
        const result = await database("rpc/report_withdraw_reasons_snapshots", { p_token_hash: hash, p_start: report.start, p_end: report.end, p_platforms: report.platforms });
        if (!object(result) || result.ok !== true || !Array.isArray(result.snapshots)) throw new RequestError(503, "storage_unavailable", "Snapshot report returned an invalid response");
        return response(200, result);
      }
      throw new RequestError(400, "invalid_action", "Use action ingest or report");
    } catch (error) {
      if (error instanceof RequestError) return response(error.status, { ok: false, error: error.code, message: error.message });
      // Never log tokens, reason samples, credentials, or upstream response bodies.
      return response(503, { ok: false, error: "temporarily_unavailable", message: "Please retry this complete snapshot later" });
    }
  };
}

if (import.meta.main) {
  Deno.serve(createWithdrawReasonsHandler({ env: { SUPABASE_URL: Deno.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") } }));
}
