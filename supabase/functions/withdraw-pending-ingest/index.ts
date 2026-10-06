import { canonicalMaanScope, validMaanSnapshot } from "../_shared/newar-platform-identity.ts";
// Deploy with verify_jwt=false only because every request is authenticated by
// the dedicated, revocable X-Withdraw-Pending-Key below.
const MAX_BODY_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type JsonObject = Record<string, unknown>;
type Scope = { country_code: string; platform: string; timezone: string };
type Dependencies = { env: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string }; fetch?: typeof fetch; now?: () => Date };
class RequestError extends Error { status: number; code: string; constructor(status: number, code: string, message: string) { super(message); this.status=status; this.code=code; } }
const object = (value: unknown): value is JsonObject => !!value && typeof value === "object" && !Array.isArray(value);
const clean = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const descriptor = (value: unknown, max: number): value is string => clean(value, max) && /^[\p{L}\p{N} ._/()+‐‑‒–—−-]+$/u.test(value) && !/\d{7}/.test(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const amountCents = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  // Ordinary two-decimal values such as 0.29 are not exact in IEEE-754.
  // Accept only the tiny representation error around an otherwise safe cent value.
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  return Number.isSafeInteger(rounded) && Math.abs(scaled - rounded) <= tolerance ? rounded : null;
};
const amount = (value: unknown): value is number => amountCents(value) !== null;
function invalid(path: string): never { throw new RequestError(422, "invalid_snapshot", `Invalid snapshot field: ${path}`); }
function onlyKeys(value: JsonObject, allowed: string[], path: string): void { if (Object.keys(value).some(key => !allowed.includes(key))) invalid(`${path}.unexpected_fields`); }
function realDate(value: unknown): value is string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const n = Date.parse(`${value}T00:00:00Z`); return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value; }
function dateInZone(date: Date, zone: string): string { const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date); return ["year", "month", "day"].map(k => parts.find(part => part.type === k)!.value).join("-"); }
function validZone(value: unknown): value is string { if (!clean(value, 80)) return false; try { dateInZone(new Date(), value); return true; } catch { return false; } }

export function validateWithdrawPendingSnapshot(value: unknown, now = new Date()): JsonObject {
  value = canonicalMaanScope(value);
  if (!object(value)) invalid("snapshot");
  if (!validMaanSnapshot(value, now.getTime(), "WITHDRAW_REVIEW")) invalid("maan_launch");
  onlyKeys(value, ["schema_version", "source_system", "country_code", "platform", "stat_date", "timezone", "snapshot_id", "snapshot_at", "coverage", "totals", "groups"], "snapshot");
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_BODY_BYTES) invalid("snapshot.size");
  if (value.schema_version !== 1 || value.source_system !== "WITHDRAW_REVIEW" || typeof value.country_code !== "string" || !/^[A-Z]{2}$/.test(value.country_code) || !descriptor(value.platform, 80) || !realDate(value.stat_date) || value.stat_date < "2020-01-01" || !validZone(value.timezone) || typeof value.snapshot_id !== "string" || !UUID.test(value.snapshot_id) || typeof value.snapshot_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value.snapshot_at)) invalid("identity");
  const timestamp = Date.parse(value.snapshot_at); if (!Number.isFinite(timestamp) || timestamp > now.getTime() + 5 * 60_000 || value.stat_date >= dateInZone(now, value.timezone) || value.stat_date >= dateInZone(new Date(timestamp), value.timezone)) invalid("snapshot_at");
  // This new target starts on Pakistan 2026-10-11. Keep the original previous-
  // complete-day and five-minute future tolerance for every existing platform.
  if (value.platform === "92NOVA" && (value.country_code !== "PK" || value.timezone !== "Asia/Karachi"
    || now.getTime() < Date.parse("2026-10-10T19:00:00Z") || timestamp < Date.parse("2026-10-10T19:00:00Z")
    || value.stat_date < "2026-10-11")) invalid("nova_launch");
  if (!object(value.coverage) || !object(value.totals)) invalid("coverage/totals");
  onlyKeys(value.coverage, ["complete", "expected_count", "fetched_count", "unique_count"], "coverage"); onlyKeys(value.totals, ["pending_count", "pending_amount"], "totals");
  if (value.coverage.complete !== true || !count(value.coverage.expected_count) || !count(value.coverage.fetched_count) || !count(value.coverage.unique_count) || !count(value.totals.pending_count) || !amount(value.totals.pending_amount) || value.coverage.fetched_count < value.coverage.unique_count || value.coverage.expected_count !== value.coverage.unique_count || value.coverage.expected_count !== value.totals.pending_count) invalid("coverage.counts");
  if (!Array.isArray(value.groups) || value.groups.length > 2000) invalid("groups");
  const seen = new Set<string>(); let totalCount = 0; let totalAmountCents = 0;
  value.groups.forEach((group, index) => { if (!object(group)) invalid(`groups[${index}]`); onlyKeys(group, ["raw_channel", "channel_type", "pending_count", "pending_amount"], `groups[${index}]`); const groupCents = amountCents(group.pending_amount); if (!descriptor(group.raw_channel, 96) || !descriptor(group.channel_type, 48) || !count(group.pending_count) || group.pending_count <= 0 || groupCents === null) invalid(`groups[${index}]`); const id = JSON.stringify([group.raw_channel, group.channel_type]); if (seen.has(id)) invalid(`groups[${index}].duplicate`); seen.add(id); totalCount += group.pending_count; totalAmountCents += groupCents; if (!Number.isSafeInteger(totalAmountCents)) invalid("totals.groups"); });
  const expectedAmountCents = amountCents(value.totals.pending_amount);
  if (totalCount !== value.totals.pending_count || expectedAmountCents === null || totalAmountCents !== expectedAmountCents) invalid("totals.groups");
  return value;
}

async function readBody(request: Request): Promise<JsonObject> {
  const reader=request.body?.getReader();
  if (!reader) throw new RequestError(400,"invalid_json","Body must be a JSON object");
  const chunks: Uint8Array[]=[]; let size=0;
  try { while(true) { const next=await reader.read(); if(next.done) break; size+=next.value.byteLength; if(size>MAX_BODY_BYTES) {await reader.cancel(); throw new RequestError(413,"payload_too_large","Payload exceeds 1 MiB");} chunks.push(next.value); } } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try {const value:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)); if(!object(value)) throw new Error(); return value;} catch {throw new RequestError(400,"invalid_json","Body must be a JSON object");}
}

export function validatePendingScope(value: unknown, now = new Date()): JsonObject {
 value = canonicalMaanScope(value);
 if(!object(value)) invalid("scope");
 onlyKeys(value,["source_system","country_code","platform","stat_date","timezone","snapshot_id","snapshot_at"],"scope");
 validateWithdrawPendingSnapshot({...value,schema_version:1,coverage:{complete:true,expected_count:0,fetched_count:0,unique_count:0},totals:{pending_count:0,pending_amount:0},groups:[]},now);
 return value;
}

export function validatePendingOrdersChunk(body: JsonObject, now = new Date()): JsonObject {
 onlyKeys(body,["action","scope","chunk_index","chunk_count","orders"],"request");
 const scope=validatePendingScope(body.scope,now);
 if(!count(body.chunk_index)||!count(body.chunk_count)||body.chunk_count<1||body.chunk_count>200||body.chunk_index>=body.chunk_count||!Array.isArray(body.orders)||body.orders.length<1||body.orders.length>500) invalid("orders_chunk");
 const seen=new Set<string>();
 for(const [index,entry] of body.orders.entries()) {
  if(!object(entry)) invalid(`orders[${index}]`);
  onlyKeys(entry,["order_no","member_id","amount","applied_at","raw_channel","channel_type","status"],`orders[${index}]`);
  if(!clean(entry.order_no,160)||!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(entry.order_no)||!clean(entry.member_id,80)||!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(entry.member_id)||entry.status!=="已提交"||!descriptor(entry.raw_channel,96)||!descriptor(entry.channel_type,48)) invalid(`orders[${index}].identity`);
  if(typeof entry.amount!=="string"||!/^(0|[1-9][0-9]{0,13})\.[0-9]{2}$/.test(entry.amount)||BigInt(entry.amount.replace('.',''))>9007199254740991n) invalid(`orders[${index}].amount`);
  if(typeof entry.applied_at!=="string"||!/^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(entry.applied_at)||entry.applied_at.slice(0,10)!==scope.stat_date) invalid(`orders[${index}].applied_at`);
  if(seen.has(entry.order_no)) invalid(`orders[${index}].duplicate`); seen.add(entry.order_no);
 }
 return {...body, scope};
}

export function validatePendingManifest(value: unknown, expected: number): JsonObject {
 if(!object(value)) invalid("orders_manifest");
 onlyKeys(value,["details_version","chunk_count","order_count"],"orders_manifest");
 if(value.details_version!==1||!count(value.chunk_count)||value.chunk_count>200||!count(value.order_count)||value.order_count>100000||value.order_count!==expected||(expected===0?value.chunk_count!==0:value.chunk_count<1||expected<value.chunk_count||expected>value.chunk_count*500)) invalid("orders_manifest");
 return value;
}

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
    const body = await readBody(request); if (body.action === "check") { onlyKeys(body, ["action"], "request"); return response(200, { ok: true, source_system: credential.source_system, source: credential.source_system, scope_count: credential.allowed_scopes.length, details_version: 1 }); }
    const allowed = (scope: JsonObject) => credential.allowed_scopes.some(s => s.country_code===scope.country_code && s.platform===scope.platform && s.timezone===scope.timezone);
    if(body.action === "orders-chunk") {
      const chunk=validatePendingOrdersChunk(body,now()); const scope=chunk.scope as JsonObject;
      if(!allowed(scope)) throw new RequestError(403,"scope_denied","Key scope denied");
      const ack=await database("rpc/stage_withdraw_pending_orders",{p_token_hash:hash,p_scope:scope,p_chunk_index:chunk.chunk_index,p_chunk_count:chunk.chunk_count,p_orders:chunk.orders});
      if(!object(ack)||ack.ok!==true||!["accepted","unchanged"].includes(String(ack.status))||ack.snapshot_id!==scope.snapshot_id||ack.chunk_index!==chunk.chunk_index||ack.chunk_count!==chunk.chunk_count||ack.order_count!==(chunk.orders as unknown[]).length) throw new RequestError(503,"storage_unavailable","Invalid chunk acknowledgement");
      return response(200,ack);
    }
    if(body.action!=="ingest") throw new RequestError(400,"invalid_action","Use action ingest, orders-chunk or check");
    onlyKeys(body,["action","snapshot","orders_manifest"],"request");
    const snapshot=validateWithdrawPendingSnapshot(body.snapshot,now());
    if(!allowed(snapshot)) throw new RequestError(403,"scope_denied","Key scope denied");
    const hasDetails=body.orders_manifest!==undefined;
    const manifest=hasDetails?validatePendingManifest(body.orders_manifest,(snapshot.totals as JsonObject).pending_count as number):null;
    const ack=hasDetails
      ? await database("rpc/publish_withdraw_pending_details",{p_token_hash:hash,p_snapshot:snapshot,p_manifest:manifest})
      : await database("rpc/publish_withdraw_pending_snapshot",{p_token_hash:hash,p_snapshot:snapshot});
    if(!object(ack)||ack.ok!==true||!["accepted","unchanged","stale"].includes(String(ack.status))||ack.snapshot_id!==snapshot.snapshot_id||typeof ack.current_snapshot_id!=="string"||!UUID.test(ack.current_snapshot_id)||(ack.status!=="stale"&&ack.current_snapshot_id.toLowerCase()!==String(snapshot.snapshot_id).toLowerCase())||(hasDetails&&(ack.details_version!==1||ack.order_count!==(snapshot.totals as JsonObject).pending_count))) throw new RequestError(503,"storage_unavailable","Invalid storage acknowledgement");
    return response(200,ack);
  } catch (error) { if (error instanceof RequestError) return response(error.status, { ok: false, error: error.code, message: error.message }); return response(503, { ok: false, error: "temporarily_unavailable", message: "Please retry this snapshot later" }); } };
}
if (import.meta.main && typeof Deno !== "undefined") Deno.serve(createWithdrawPendingHandler({ env: { SUPABASE_URL: Deno.env.get("SUPABASE_URL"), SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") } }));
