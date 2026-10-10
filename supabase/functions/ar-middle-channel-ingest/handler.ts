// Read-only source channel snapshots. One tenant's two complete directions are
// validated and published by a single scoped, token-hashed database transaction.
export const AR_MIDDLE_ORIGIN = "https://m8-admin.payplatform-manager.com";
export const MAX_AR_MIDDLE_BYTES = 8 * 1024 * 1024;
const RATE_FIELDS = ["15m", "30m", "1h", "4h", "8h", "24h", "today", "total"].map(x => "success_rate_" + x);
const TEXT_FIELDS = ["channel_name", "provider", "channel_type", "payment_method", "status_text", "category_id", "category_name", "source_state", "source_channel_state", "source_merchant_state", "sys_channel_id", "third_pay_merchant_id", "source_channel_name"];
const MONEY_FIELDS = ["min_amount", "max_amount", "balance", "balance_threshold", "weight", "real_time_weight", "fee_rate", "fee_amount"];
const INTEGER_FIELDS = ["required_deposit_count", "priority", "source_position"];
const CURRENCY_FIELDS = ["limit_currency", "balance_currency", "balance_threshold_currency"];
const RECORD_FIELDS = ["channel_id", ...TEXT_FIELDS, ...MONEY_FIELDS, ...RATE_FIELDS, ...INTEGER_FIELDS, ...CURRENCY_FIELDS, "enabled", "notes", "source_updated_at", "fee_rate_basis", "channel_categories", "withdrawal_details"];
const WITHDRAWAL_LABELS = ["merchant_code", "merchant_name", "third_channel_code", "system_category_name", "last_update_by", "source_tenant_name"];
const WITHDRAWAL_COUNTS = ["today_submit_count", "recent_1h_success_count"];
const WITHDRAWAL_TIMES = ["balance_updated_at", "last_updated_at"];
const WITHDRAWAL_BOOLEANS = ["is_use_channel_code", "is_fixed_channel_code"];
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const TENANT = /^[0-9]{1,18}$/;
const DECIMAL = /^[0-9]{1,16}(?:\.[0-9]{1,8})?$/;
const SIGNED_DECIMAL = /^-?[0-9]{1,16}(?:\.[0-9]{1,8})?$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/;
const UNSAFE_SOURCE_LABEL = /(?:[a-z][a-z0-9+.-]*:\/\/|(?:javascript|data):|bearer\s+\S|(?:password|passwd|token|access[_-]?token|secret|cookie|api[_-]?key|auth|authorization|密码|密钥)\s*[:=：]\s*\S)/i;
type Json = Record<string, unknown>;
function object(value: unknown): value is Json { return !!value && typeof value === "object" && !Array.isArray(value); }
class RequestError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
function invalid(): never { throw new RequestError(422, "invalid_request"); }
function only(value: Json, fields: readonly string[]): void { if (Object.keys(value).some(x => !fields.includes(x))) invalid(); }
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value
    && !/[\u0000-\u001f\u007f]|<[^>]*>/.test(value);
}
// These source labels carry names and native IDs only, never source URLs or credentials.
function sourceLabel(value: unknown): value is string {
  return text(value) && !UNSAFE_SOURCE_LABEL.test(value);
}
function categories(value: unknown): void {
  if (value == null) return; // Older collectors may omit the additional source fields.
  if (!Array.isArray(value) || value.length > 1000) invalid();
  const seen = new Set<string>();
  for (const category of value) {
    if (!object(category)) invalid();
    only(category, ["category_id", "category_name", "sort"]);
    if (!sourceLabel(category.category_id) || seen.has(category.category_id)
      || !("category_name" in category) || !("sort" in category)
      || (category.category_name !== null && !sourceLabel(category.category_name))
      || (category.sort !== null && (!Number.isInteger(category.sort) || Number(category.sort) < -2147483648 || Number(category.sort) > 2147483647))) invalid();
    seen.add(category.category_id);
  }
}
function instant(value: unknown, now: number): number {
  if (typeof value !== "string" || !INSTANT.test(value)) invalid();
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time < Date.UTC(2020, 0, 1) || time > now + 300_000
    || new Date(time).toISOString().slice(0, 19) !== value.slice(0, 19)) invalid();
  return time;
}
function ipAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 49 || !/^[0-9a-f:.]+(?:\/[0-9]{1,3})?$/.test(value)) return false;
  const [address, prefix] = value.split("/");
  const ipv4 = (s: string) => s.split(".").length === 4 && s.split(".").every(part => /^(?:0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255);
  if (!address.includes(":")) return ipv4(address) && (prefix === undefined || Number(prefix) <= 32);
  if (prefix !== undefined && Number(prefix) > 128) return false;
  const halves = address.split("::");
  if (halves.length > 2) return false;
  const groups = halves.flatMap(half => half ? half.split(":") : []);
  let size = 0;
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (/^[0-9a-f]{1,4}$/.test(group)) size++;
    else if (i === groups.length - 1 && ipv4(group)) size += 2;
    else return false;
  }
  return halves.length === 2 ? size < 8 : size === 8;
}
function withdrawalDetails(value: unknown, orderType: unknown, now: number): void {
  if (value == null) return;
  if (orderType !== "withdrawal" || !object(value)) invalid();
  only(value, [...WITHDRAWAL_LABELS, ...WITHDRAWAL_COUNTS, ...WITHDRAWAL_TIMES, ...WITHDRAWAL_BOOLEANS, "system_category_id", "third_pay_api_url", "notify_white_ips"]);
  for (const key of WITHDRAWAL_LABELS) if (value[key] != null && !sourceLabel(value[key])) invalid();
  for (const key of WITHDRAWAL_COUNTS) if (value[key] != null && (!Number.isInteger(value[key]) || Number(value[key]) < 0 || Number(value[key]) > 2147483647)) invalid();
  for (const key of WITHDRAWAL_TIMES) if (value[key] != null) instant(value[key], now);
  for (const key of WITHDRAWAL_BOOLEANS) if (value[key] != null && typeof value[key] !== "boolean") invalid();
  if (value.system_category_id != null && (typeof value.system_category_id !== "string" || !/^[0-9]{1,19}$/.test(value.system_category_id))) invalid();
  if (value.notify_white_ips != null && (!Array.isArray(value.notify_white_ips) || value.notify_white_ips.length > 100
    || !value.notify_white_ips.every(ipAddress) || new Set(value.notify_white_ips).size !== value.notify_white_ips.length)) invalid();
  if (value.third_pay_api_url != null) {
    const raw = value.third_pay_api_url;
    if (typeof raw !== "string" || raw.length > 2048 || !/^https?:\/\/[a-z0-9.:[\]-]+(?:\/[^?#]*)?$/i.test(raw)
      || /[\u0000-\u0020\u007f\\]|<[^>]*>|%0[0-9a-f]|%1[0-9a-f]|%7f/i.test(raw)) invalid();
    let url: URL; try { url = new URL(raw); } catch { invalid(); }
    if (url.username || url.password || url.search || url.hash) invalid();
    let path: string; try { path = decodeURIComponent(url.pathname); } catch { invalid(); }
    if (UNSAFE_SOURCE_LABEL.test(path) || /[\u0000-\u001f\u007f\\]|<[^>]*>|\/(?:password|passwd|token|access[_-]?token|secret|cookie|api[_-]?key|auth|authorization)\/[^/]+/i.test(path)) invalid();
  }
}
function sanitizeNotes(value: string): string | null {
  return value.replace(/<[^>]*>/g, "")
    .replace(/https?:\/\/\S+/gi, "[已移除链接]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[已移除邮箱]")
    .replace(/\+?\d[\d\s().-]{5,}\d/g, "[已移除号码]")
    .replace(/(?:password|passwd|token|secret|cookie|密码|密钥)\s*[:=：]\s*[^\s;；,，]+/gi, "[已移除凭据]")
    .replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 400) || null;
}
export function validateArMiddleChannelRequest(input: unknown, now = Date.now()): Json {
  if (!object(input) || input.source !== "ar_middle" || input.source_origin !== AR_MIDDLE_ORIGIN) invalid();
  if (input.action === "check") {
    only(input, ["action", "source", "source_origin"]);
    return input;
  }
  only(input, ["action", "schema_version", "source", "source_origin", "source_tenant_id", "snapshot_id", "captured_at", "directions"]);
  if (input.action !== "channels" || input.schema_version !== 1 || typeof input.source_tenant_id !== "string" || !TENANT.test(input.source_tenant_id)
    || typeof input.snapshot_id !== "string" || !UUID.test(input.snapshot_id) || !Array.isArray(input.directions) || input.directions.length !== 2) invalid();
  const captured = instant(input.captured_at, now), seenDirections = new Set<string>();
  const directions = input.directions.map(value => {
    if (!object(value)) invalid();
    only(value, ["order_type", "observed_at", "source_count", "fetched_count", "complete", "page_count", "records"]);
    if (typeof value.order_type !== "string" || !["deposit", "withdrawal"].includes(value.order_type) || seenDirections.has(value.order_type)) invalid();
    seenDirections.add(value.order_type);
    if (instant(value.observed_at, now) > captured || value.complete !== true
      || !Number.isInteger(value.page_count) || Number(value.page_count) < 1 || Number(value.page_count) > 1000
      || !Number.isInteger(value.source_count) || Number(value.source_count) < 0 || Number(value.source_count) > 10000
      || value.source_count !== value.fetched_count || !Array.isArray(value.records) || value.records.length !== value.source_count) invalid();
    const seen = new Set<string>();
    const records = value.records.map((entry, position) => {
      if (!object(entry)) invalid();
      only(entry, RECORD_FIELDS);
      if (!text(entry.channel_id) || seen.has(entry.channel_id) || !text(entry.channel_name) || !text(entry.status_text) || entry.source_position !== position) invalid();
      seen.add(entry.channel_id);
      for (const field of TEXT_FIELDS) if (entry[field] != null && !text(entry[field])) invalid();
      if (entry.source_channel_name != null && !sourceLabel(entry.source_channel_name)) invalid();
      categories(entry.channel_categories);
      withdrawalDetails(entry.withdrawal_details, value.order_type, now);
      if (entry.real_time_weight != null && value.order_type !== "deposit") invalid();
      for (const field of [...MONEY_FIELDS, ...RATE_FIELDS]) {
        const number = entry[field], pattern = field === "balance" ? SIGNED_DECIMAL : DECIMAL;
        if (number != null && (typeof number !== "string" || !pattern.test(number))) invalid();
        if (RATE_FIELDS.includes(field) && number != null && Number(number) > 100) invalid();
      }
      if (entry.min_amount != null && entry.max_amount != null && Number(entry.min_amount) > Number(entry.max_amount)) invalid();
      for (const field of INTEGER_FIELDS) if (entry[field] != null && (!Number.isInteger(entry[field]) || Number(entry[field]) < 0 || Number(entry[field]) > 2147483647)) invalid();
      for (const field of CURRENCY_FIELDS) if (entry[field] != null && (typeof entry[field] !== "string" || !/^[A-Z0-9]{3,8}$/.test(String(entry[field])))) invalid();
      if (entry.enabled != null && typeof entry.enabled !== "boolean") invalid();
      if (entry.source_updated_at != null) instant(entry.source_updated_at, now);
      if (entry.fee_rate != null ? entry.fee_rate_basis !== "source_raw" : entry.fee_rate_basis != null) invalid();
      if (entry.notes != null && (typeof entry.notes !== "string" || entry.notes.length > 400)) invalid();
      return {...entry, notes: typeof entry.notes === "string" ? sanitizeNotes(entry.notes) : null};
    });
    return {...value, records};
  });
  return {...input, directions};
}
async function readBody(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared != null && (!/^\d+$/.test(declared) || Number(declared) > MAX_AR_MIDDLE_BYTES)) throw new RequestError(413, "payload_too_large");
  const reader = request.body?.getReader(); if (!reader) invalid();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const {done, value} = await reader.read(); if (done) break; size += value.length;
      if (size > MAX_AR_MIDDLE_BYTES) { await reader.cancel(); throw new RequestError(413, "payload_too_large"); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)); } catch { invalid(); }
  } finally { reader.releaseLock(); }
}
function reply(status: number, value: unknown): Response {
  return Response.json(value, {status, headers: {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}});
}
function acknowledgement(data: unknown, input: Json): Json {
  if (!object(data) || data.ok !== true || data.source !== "ar_middle") throw new RequestError(503, "storage_unavailable");
  if (input.action === "check") {
    if (data.schema_version !== 1 || data.action_scope !== "channels") throw new RequestError(503, "storage_unavailable");
    return {ok: true, source: "ar_middle", schema_version: 1, action_scope: "channels"};
  }
  const count = (input.directions as Json[]).reduce((sum, item) => sum + Number(item.source_count), 0);
  if (data.accepted !== count || data.source_count !== count || typeof data.snapshot_applied !== "boolean" || data.snapshot_id !== input.snapshot_id) throw new RequestError(503, "storage_unavailable");
  return {ok: true, source: "ar_middle", accepted: count, source_count: count, snapshot_applied: data.snapshot_applied, snapshot_id: data.snapshot_id};
}
export function createArMiddleChannelIngestHandler(deps: {env: {SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string}; fetch?: typeof fetch; now?: () => number}) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "POST") return reply(405, {ok: false, error: "method_not_allowed"});
      const token = request.headers.get("X-Collector-Key") || "";
      if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new RequestError(401, "invalid_key");
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) throw new RequestError(415, "unsupported_media_type");
      const url = deps.env.SUPABASE_URL?.replace(/\/$/, ""), key = deps.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new RequestError(503, "not_configured");
      const target = new URL(url);
      if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash || target.pathname !== "/") throw new RequestError(503, "not_configured");
      const payload = validateArMiddleChannelRequest(await readBody(request), (deps.now || Date.now)());
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map(x => x.toString(16).padStart(2, "0")).join("");
      const response = await (deps.fetch || fetch)(`${target.origin}/rest/v1/rpc/ar_middle_channel_ingest`, {
        method: "POST", headers: {apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json"},
        body: JSON.stringify({p_token_hash: hash, p_request: payload}), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = object(data) ? String(data.message || "") : "", code = object(data) ? String(data.code || "") : "";
        if (message === "AR_MIDDLE_UNAUTHORIZED" || code === "28000") throw new RequestError(401, "invalid_key");
        if (/^AR_MIDDLE_(?:INVALID_|DUPLICATE_|SCOPE_DENIED$)/.test(message) || ["23514", "23502", "22007", "22008", "22P02", "22003"].includes(code)) invalid();
        throw new RequestError(503, "storage_unavailable");
      }
      return reply(200, acknowledgement(data, payload));
    } catch (error) {
      return error instanceof RequestError ? reply(error.status, {ok: false, error: error.code}) : reply(503, {ok: false, error: "storage_unavailable"});
    }
  };
}
