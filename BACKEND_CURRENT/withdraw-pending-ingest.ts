// Deploy with verify_jwt=false only because every request is authenticated by
// the dedicated, revocable X-Withdraw-Pending-Key below.
const MAX_BODY_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type JsonObject = Record<string, unknown>;
type Scope = { country_code: string; platform: string; timezone: string };
type Dependencies = { env: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string }; fetch?: typeof fetch; now?: () => Date };
class RequestError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }
const object = (value: unknown): value is JsonObject => !!value && typeof value === "object" && !Array.isArray(value);
const clean = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const descriptor = (value: unknown, max: number): value is string => clean(value, max) && /^[\p{L}\p{N} ._/()+‐‑‒–—−-]+$/u.test(value) && !/\d{7}/.test(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const amount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER && Math.round(value * 100) === value * 100;
function invalid(path: string): never { throw new RequestError(422, "invalid_snapshot", `Invalid snapshot field: ${path}`); }
function onlyKeys(value: JsonObject, allowed: string[], path: string): void { if (Object.keys(value).some(key => !allowed.includes(key))) invalid(`${path}.unexpected_fields`); }
function realDate(value: unknown): value is string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const n = Date.parse(`${value}T00:00:00Z`); return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value; }
function dateInZone(date: Date, zone: string): string { const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date); return ["year", "month", "day"].map(k => parts.find(part => part.type === k)!.value).join("-"); }
function validZone(value: unknown): value is string { if (!clean(value, 80)) return false; try { dateInZone(new Date(), value); return true; } catch { return false; } }

export function validateWithdrawPendingSnapshot(value: unknown, now = new Date()): JsonObject {
  if (!object(value)) invalid("snapshot");
  onlyKeys(value, ["schema_version", "source_system", "country_code", "platform", "stat_date", "timezone", "snapshot_id", "snapshot_at", "coverage", "totals", "groups"], "snapshot");
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_BODY_BYTES) invalid("snapshot.size");
  if (value.schema_version !== 1 || value.source_system !== "WITHDRAW_REVIEW" || typeof value.country_code !== "string" || !/^[A-Z]{2}$/.test(value.country_code) || !descriptor(value.platform, 80) || !realDate(value.stat_date) || value.stat_date < "2020-01-01" || !validZone(value.timezone) || typeof value.snapshot_id !== "string" || !UUID.test(value.snapshot_id) || typeof value.snapshot_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value.snapshot_at)) invalid("identity");
  const timestamp = Date.parse(value.snapshot_at); if (!Number.isFinite(timestamp) || timestamp > now.getTime() + 5 * 60_000 || value.stat_date >= dateInZone(now, value.timezone) || value.stat_date >= dateInZone(new Date(timestamp), value.timezone)) invalid("snapshot_at");
  if (!object(value.coverage) || !object(value.totals)) invalid("coverage/totals");
  onlyKeys(value.coverage, ["complete", "expected_count", "fetched_count", "unique_count"], "coverage"); onlyKeys(value.totals, ["pending_count", "pending_amount"], "totals");
  if (value.coverage.complete !== true || !count(value.coverage.expected_count) || !count(value.coverage.fetched_count) || !count(value.coverage.unique_count) || !count(value.totals.pending_count) || !amount(value.totals.pending_amount) || value.coverage.expected_count !== value.coverage.fetched_count || value.coverage.expected_count !== value.coverage.unique_count || value.coverage.expected_count !== value.totals.pending_count) invalid("coverage.counts");
  if (!Array.isArray(value.groups) || value.groups.length > 2000) invalid("groups");
  const seen = new Set<string>(); let totalCount = 0; let totalAmount = 0;
  value.groups.forEach((group, index) => { if (!object(group)) invalid(`groups[${index}]`); onlyKeys(group, ["raw_channel", "channel_type", "pending_count", "pending_amount"], `groups[${index}]`); if (!descriptor(group.raw_channel, 96) || !descriptor(group.channel_type, 48) || !count(group.pending_count) || group.pending_count <= 0 || !amount(group.pending_amount)) invalid(`groups[${index}]`); const id = JSON.stringify([group.raw_channel, group.channel_type]); if (seen.has(id)) invalid(`groups[${index}].duplicate`); seen.add(id); totalCount += group.pending_count; totalAmount += group.pending_amount; });
  if (totalCount !== value.totals.pending_count || Math.round(totalAmount * 100) !== Math.round((value.totals.pending_amount as number) * 100)) invalid("totals.groups");
  return value;
}

async function readBody(request: Request): Promise<JsonObject> { const text = await request.text(); if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new RequestError(413, "payload_too_large", "Payload exceeds 1 MiB"); try { const value: unknown = JSON.parse(text); if (!object(value)) throw new Error(); return value; } catch { throw new RequestError(400, "invalid_json", "Body must be a JSON object"); } }
export async function withdrawPendingTokenHash(token: string): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
const response = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });

export function createWithdrawPendingHandler(dependencies: Dependencies): (request: Request) => Promise<Response> {
  const requestFetch = dependencies.fetch ?? fetch, now = dependencies.now ?? (() => new Date()); const url = (dependencies.env.SUPABASE_URL || "").replace(/\/$/, ""), key = dependencies.env.SUPABASE_SERVICE_ROLE_KEY || ""; const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  async function database(path: string, body?: JsonObject): Promise<unknown> { const result = await requestFetch(`${url}/rest/v1/${path}`, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000), redirect: "error", cache: "no-store" }); const data: unknown = await result.json().catch(() => null); if (!result.ok) { const message = object(data) ? String(data.message || "") : ""; if (message === "WP_AUTH_INVALID") throw new RequestError(401, "invalid_key", "Key is invalid or expired"); if (message === "WP_SCOPE_DENIED") throw new RequestError(403, "scope_denied", "Key scope denied"); if (message === "WP_ID_CONFLICT") throw new RequestError(409, "snapshot_conflict", "Snapshot ID conflict"); if (message.startsWith("WP_INVALID")) throw new RequestError(422, "invalid_snapshot", "Snapshot validation failed"); throw new RequestError(503, "storage_unavailable", "Snapshot storage unavailable"); } return data; }
  return async request => { try {
    if (request.method !== "POST") return response(405, { ok: false, error: "method_not_allowed" }); if (!url || !key) throw new RequestError(503, "not_configured", "Snapshot storage is not configured");
    const token = request.headers.get("X-Withdraw-Pending-Key") || ""; if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new RequestError(401, "invalid_key", "A dedicated key is required");
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) throw new RequestError(415, "unsupported_media_type", "Use application/json");
    const hash = await withdrawPendingTokenHash(token); const query = new URLSearchParams({ select: "source_system,allowed_scopes,expires_at,revoked", token_hash: `eq.${hash}`, limit: "1" }); const rows = await database(`withdraw_pending_credentials?${query}`); const credential = Array.isArray(rows) ? rows[0] as { source_system: string; allowed_scopes: Scope[]; expires_at: string; revoked: boolean } | undefined : undefined;
    if (!credential || credential.source_system !== "WITHDRAW_REVIEW" || credential.revoked || !Number.isFinite(Date.parse(credential.expires_at)) || Date.parse(credential.expires_at) <= now().getTime()) throw new RequestError(401, "invalid_key", "Key is invalid or expired");
    const body = await readBody(request); if (body.action === "check") { onlyKeys(body, ["action"], "request"); return response(200, { ok: true, source_system: credential.source_system, scope_count: credential.allowed_scopes.length }); }
    if (body.action !== "ingest") throw new RequestError(400, "invalid_action", "Use action ingest or check"); onlyKeys(body, ["action", "snapshot"], "request"); const snapshot = validateWithdrawPendingSnapshot(body.snapshot, now());
    if (!credential.allowed_scopes.some(scope => scope.country_code === snapshot.country_code && scope.platform === snapshot.platform && scope.timezone === snapshot.timezone)) throw new RequestError(403, "scope_denied", "Key scope denied");
    const ack = await database("rpc/publish_withdraw_pending_snapshot", { p_token_hash: hash, p_snapshot: snapshot }); if (!object(ack) || ack.ok !== true || !["accepted", "unchanged", "stale"].includes(String(ack.status)) || ack.snapshot_id !== snapshot.snapshot_id) throw new RequestError(503, "storage_unavailable", "Invalid storage acknowledgement"); return response(200, ack);
  } catch (error) { if (error instanceof RequestError) return response(error.status, { ok: false, error: error.code, message: error.message }); return response(503, { ok: false, error: "temporarily_unavailable", message: "Please retry this snapshot later" }); } };
}
if (import.meta.main) Deno.serve(createWithdrawPendingHandler({ env: { SUPABASE_URL: Deno.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") } }));
