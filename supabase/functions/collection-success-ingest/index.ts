// Deploy collection-success-ingest with verify_jwt=false: EVERY request instead
// authenticates a dedicated, revocable, platform-scoped X-Collection-Key below.
// The collector never receives a Supabase service role key or dashboard read access.
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_GROUPS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type JsonObject = Record<string, unknown>;
type Scope = { country_code: string; platform: string; timezone: string };
type Credential = { source_system: string; allowed_source_systems: string[]; allowed_scopes: Scope[]; expires_at: string; revoked: boolean };
type Dependencies = { env: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string }; fetch?: typeof fetch; now?: () => Date };
class RequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
function invalid(path: string): never { throw new RequestError(422, "invalid_snapshot", `Invalid snapshot field: ${path}`); }
function object(value: unknown): value is JsonObject { return !!value && typeof value === "object" && !Array.isArray(value); }
function onlyKeys(value: JsonObject, allowed: string[], path: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid(`${path}.unexpected_fields`);
}
function cleanText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}
export function safeDescriptor(value: unknown, max: number): value is string {
  return cleanText(value, max) && /^[\p{L}\p{N} ._/()+‐‑‒–—−-]+$/u.test(value)
    && !/\d{7}/.test(value)
    && !/(https?[/]|www[.]|account[ _-]*number|member[ _-]*id|user[ _-]*id|order[ _-]*id|银行卡号|会员账号|会员姓名|真实姓名|手机号码|身份证)/i.test(value);
}
function count(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function realDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}
function dateInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map(key => parts.find(part => part.type === key)!.value).join("-");
}
function validZone(value: unknown): value is string {
  if (!cleanText(value, 80)) return false;
  try { dateInZone(new Date(), value); return true; } catch { return false; }
}
export function validateCollectionSnapshot(value: unknown, now = new Date()): JsonObject {
  if (!object(value)) invalid("snapshot");
  onlyKeys(value, ["schema_version", "source_system", "country_code", "platform", "stat_date", "timezone", "snapshot_id", "snapshot_at", "coverage", "totals", "groups"], "snapshot");
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_BODY_BYTES) invalid("snapshot.size");
  if (value.schema_version !== 1 || !["RECHARGE_REVIEW", "WITHDRAW_REVIEW"].includes(String(value.source_system))) invalid("schema_version/source_system");
  if (typeof value.country_code !== "string" || !/^[A-Z]{2}$/.test(value.country_code)) invalid("country_code");
  if (!safeDescriptor(value.platform, 80)) invalid("platform");
  if (!realDate(value.stat_date) || value.stat_date < "2020-01-01") invalid("stat_date");
  if (!validZone(value.timezone)) invalid("timezone");
  if (typeof value.snapshot_id !== "string" || !UUID.test(value.snapshot_id)) invalid("snapshot_id");
  if (typeof value.snapshot_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value.snapshot_at)) invalid("snapshot_at");
  const timestamp = Date.parse(value.snapshot_at);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 19) !== value.snapshot_at.slice(0, 19)
    || timestamp > now.getTime() + 5 * 60_000) invalid("snapshot_at");
  // A complete snapshot is only valid AFTER its entire backend business day ends.
  if (value.stat_date >= dateInZone(now, value.timezone) || value.stat_date >= dateInZone(new Date(timestamp), value.timezone)) invalid("stat_date.incomplete_day");
  if (!object(value.coverage) || !object(value.totals)) invalid("coverage/totals");
  const coverage = value.coverage, totals = value.totals;
  onlyKeys(coverage, ["complete", "expected_count", "fetched_count", "unique_count"], "coverage");
  onlyKeys(totals, ["submitted_count", "success_count"], "totals");
  if (coverage.complete !== true) invalid("coverage.complete");
  for (const key of ["expected_count", "fetched_count", "unique_count"]) if (!count(coverage[key])) invalid(`coverage.${key}`);
  for (const key of ["submitted_count", "success_count"]) if (!count(totals[key])) invalid(`totals.${key}`);
  if (coverage.expected_count !== coverage.fetched_count || coverage.expected_count !== coverage.unique_count
    || coverage.expected_count !== totals.submitted_count || (totals.success_count as number) > (totals.submitted_count as number)) invalid("coverage.counts");
  if (!Array.isArray(value.groups) || value.groups.length > MAX_GROUPS) invalid("groups");
  const seen = new Set<string>();
  let submitted = 0, success = 0;
  for (let i = 0; i < value.groups.length; i++) {
    const group = value.groups[i], field = `groups[${i}]`;
    if (!object(group)) invalid(field);
    onlyKeys(group, ["raw_channel", "channel_type", "submitted_count", "success_count"], field);
    if (!safeDescriptor(group.raw_channel, 96) || !safeDescriptor(group.channel_type, 48)) invalid(`${field}.descriptor`);
    if (!count(group.submitted_count) || group.submitted_count <= 0 || !count(group.success_count) || group.success_count > group.submitted_count) invalid(`${field}.counts`);
    const identity = JSON.stringify([group.raw_channel, group.channel_type]);
    if (seen.has(identity)) invalid(`${field}.duplicate`);
    seen.add(identity);
    submitted += group.submitted_count; success += group.success_count;
    if (!Number.isSafeInteger(submitted) || !Number.isSafeInteger(success)) invalid("groups.overflow");
  }
  if (submitted !== totals.submitted_count || success !== totals.success_count) invalid("totals.groups");
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
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new RequestError(413, "payload_too_large", "Payload exceeds 1 MiB"); }
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
export async function collectionTokenHash(token: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function response(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
export function createCollectionSuccessHandler(dependencies: Dependencies): (request: Request) => Promise<Response> {
  const requestFetch = dependencies.fetch ?? fetch, now = dependencies.now ?? (() => new Date());
  const url = (dependencies.env.SUPABASE_URL || "").replace(/\/$/, ""), key = dependencies.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  async function database(path: string, body?: JsonObject): Promise<unknown> {
    const result = await requestFetch(`${url}/rest/v1/${path}`, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000), redirect: "error", cache: "no-store" });
    const data: unknown = await result.json().catch(() => null);
    if (!result.ok) {
      const code = object(data) ? String(data.message || "") : "";
      if (code === "CS_AUTH_INVALID") throw new RequestError(401, "invalid_key", "Collection key is invalid or expired");
      if (code === "CS_SCOPE_DENIED") throw new RequestError(403, "scope_denied", "Collection key does not allow this scope");
      if (code === "CS_ID_CONFLICT") throw new RequestError(409, "snapshot_conflict", "Snapshot ID was reused with different content");
      if (code.startsWith("CS_INVALID")) throw new RequestError(422, "invalid_snapshot", "Snapshot failed database validation");
      throw new RequestError(503, "storage_unavailable", "Snapshot storage is temporarily unavailable");
    }
    return data;
  }
  return async request => {
    try {
      if (request.method !== "POST") return response(405, { ok: false, error: "method_not_allowed" });
      if (!url || !key) throw new RequestError(503, "not_configured", "Snapshot storage is not configured");
      const token = request.headers.get("X-Collection-Key") || "";
      if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new RequestError(401, "invalid_key", "A dedicated X-Collection-Key is required");
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) throw new RequestError(415, "unsupported_media_type", "Use application/json");
      const hash = await collectionTokenHash(token);
      const params = new URLSearchParams({ select: "source_system,allowed_source_systems,allowed_scopes,expires_at,revoked", token_hash: `eq.${hash}`, limit: "1" });
      const credentials = await database(`collection_success_credentials?${params}`);
      const credential = Array.isArray(credentials) ? credentials[0] as Credential | undefined : undefined;
      if (!credential || !Array.isArray(credential.allowed_source_systems) || credential.allowed_source_systems.length < 1 || credential.revoked !== false
        || !Number.isFinite(Date.parse(credential.expires_at)) || Date.parse(credential.expires_at) <= now().getTime()) throw new RequestError(401, "invalid_key", "Collection key is invalid or expired");
      if (!Array.isArray(credential.allowed_scopes) || !credential.allowed_scopes.length || credential.allowed_scopes.length > 1000
        || credential.allowed_scopes.some(scope => !scope || !/^[A-Z]{2}$/.test(scope.country_code) || !safeDescriptor(scope.platform, 80) || !validZone(scope.timezone))) throw new RequestError(401, "invalid_key", "Collection key has no valid scope");
      const body = await readBody(request);
      if (body.action === "check") {
        onlyKeys(body, ["action"], "request");
        return response(200, { ok: true, source_system: credential.source_system, scope_count: credential.allowed_scopes.length });
      }
      if (body.action !== "ingest") throw new RequestError(400, "invalid_action", "Use action ingest or check");
      onlyKeys(body, ["action", "snapshot"], "request");
      const snapshot = validateCollectionSnapshot(body.snapshot, now());
      if (!credential.allowed_source_systems.includes(String(snapshot.source_system)) || !credential.allowed_scopes.some(scope => scope.country_code === snapshot.country_code
        && scope.platform === snapshot.platform && scope.timezone === snapshot.timezone)) throw new RequestError(403, "scope_denied", "Collection key does not allow this scope");
      const ack = await database("rpc/publish_collection_success_snapshot", { p_token_hash: hash, p_snapshot: snapshot });
      if (!object(ack) || ack.ok !== true || !["accepted", "unchanged", "stale"].includes(String(ack.status)) || ack.snapshot_id !== snapshot.snapshot_id
        || typeof ack.current_snapshot_id !== "string" || !UUID.test(ack.current_snapshot_id)
        || (ack.status !== "stale" && ack.current_snapshot_id.toLowerCase() !== String(snapshot.snapshot_id).toLowerCase())) throw new RequestError(503, "storage_unavailable", "Snapshot storage returned an invalid acknowledgement");
      return response(200, ack);
    } catch (error) {
      if (error instanceof RequestError) return response(error.status, { ok: false, error: error.code, message: error.message });
      // No tokens, submitted payloads, upstream response bodies or customer data in logs.
      return response(503, { ok: false, error: "temporarily_unavailable", message: "Please retry this complete snapshot later" });
    }
  };
}
if (import.meta.main) {
  Deno.serve(createCollectionSuccessHandler({ env: { SUPABASE_URL: Deno.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") } }));
}

