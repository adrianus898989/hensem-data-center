// YASH-only receiver. The database validates the scoped token inside the same
// transaction as ingestion/receipt verification. No source or DB credentials
// are returned to the collector, and source pages/attachments are never stored.
export const MAX_YASH_BYTES = 12 * 1024 * 1024;
export const YASH_RAW_KEYS = [
  "UID", "订单号", "子订单号", "三方订单号", "订单状态", "提现状态", "充值金额", "提现金额", "手续费",
  "充值前余额", "提现后余额", "充值总金额", "优惠比例", "下单时间", "申请时间", "完成时间", "供应商商户",
  "支付通道", "支付方式", "提现账户类型", "来源", "充值类型", "提现类型", "是否首单", "币种", "货币", "Currency",
] as const;
const TEXT_FIELDS = ["uid", "child_order_no", "supplier_order_no", "supplier", "channel", "payment_method", "source_category", "order_category"];
const MONEY_FIELDS = ["amount", "fee", "balance_before", "balance_after", "credited_amount", "discount_percent"];
const RECORD_KEYS = ["source_site", "order_type", "order_no", ...TEXT_FIELDS, "operator", ...MONEY_FIELDS,
  "status", "created_at", "completed_at", "source_timezone", "is_first_order", "currency", "currency_basis", "raw_fields", "observed_at"];
const RAW_LABELS = new Set(["供应商商户", "支付通道", "支付方式", "提现账户类型", "来源", "充值类型", "提现类型"]);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const unsignedDecimal = /^[0-9]{1,16}(?:\.[0-9]{1,8})?$/;
const signedDecimal = /^-?[0-9]{1,16}(?:\.[0-9]{1,8})?$/;
const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/;
type Json = Record<string, unknown>;
function object(value: unknown): value is Json { return !!value && typeof value === "object" && !Array.isArray(value); }
class RequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
function invalid(): never { throw new RequestError(422, "invalid_request"); }
function only(value: Json, allowed: readonly string[]): void { if (Object.keys(value).some(key => !allowed.includes(key))) invalid(); }
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}
function timestamp(value: unknown, now: number): number {
  if (typeof value !== "string" || !instant.test(value)) invalid();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed < Date.UTC(2020, 0, 1) || parsed > now + 300_000
    || new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19)) invalid();
  return parsed;
}
function timezone(value: unknown): void {
  if (typeof value !== "string" || !value || value.length > 64) invalid();
  // Metadata only; uploaded timestamps are already UTC. Do not feed these
  // offset labels to PostgreSQL AT TIME ZONE (POSIX signs differ).
  if (/^UTC[+-](?:(?:0[0-9]|1[0-3]):[0-5][0-9]|14:00)$/.test(value)) return;
  if (!/^[A-Za-z0-9_+\-/]+$/.test(value)) invalid();
  try { new Intl.DateTimeFormat("en", {timeZone: value}); } catch { invalid(); }
}
function redactContact(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "[已移除链接]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[已移除邮箱]")
    .replace(/0x[a-f0-9]{40}|(?:bc1|tb1)[a-z0-9]{20,90}|\bT[1-9A-HJ-NP-Za-km-z]{33}\b/gi, "[已移除地址]")
    .replace(/\+?\d[\d\s().-]{5,}\d/g, "[已移除号码]")
    .replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}
export function sanitizeYashRaw(value: unknown): Json {
  if (!object(value)) invalid();
  const clean: Json = {};
  for (const key of YASH_RAW_KEYS) {
    const entry = value[key];
    if (entry === null || typeof entry === "boolean") clean[key] = entry;
    else if (typeof entry === "string" && entry.length <= 256 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(entry)) clean[key] = RAW_LABELS.has(key) ? redactContact(entry) : entry;
    else if (typeof entry === "number" && Number.isFinite(entry) && (!Number.isInteger(entry) || Number.isSafeInteger(entry))) clean[key] = entry;
  }
  return clean;
}
const CHANNEL_RATES = ["10m", "30m", "1h", "4h", "8h", "24h", "today", "total"].map(x => "success_rate_" + x);
const CHANNEL_TEXT = ["channel_name", "provider", "channel_type", "payment_method", "status_text"];
const CHANNEL_MONEY = ["min_amount", "max_amount", "balance", "balance_threshold"];
const CHANNEL_INTS = ["required_deposit_count", "priority", "weight"];
const CHANNEL_CURRENCIES = ["limit_currency", "balance_currency", "balance_threshold_currency"];
function validateChannels(input: Json, now: number): Json {
  only(input, ["action", "schema_version", "snapshot_id", "order_type", "observed_at", "source_count", "fetched_count", "records"]);
  if (typeof input.snapshot_id !== "string" || !uuid.test(input.snapshot_id)
    || typeof input.order_type !== "string" || !["deposit", "withdrawal"].includes(input.order_type)
    || !Number.isInteger(input.source_count) || Number(input.source_count) < 0 || Number(input.source_count) > 2000
    || input.fetched_count !== input.source_count || !Array.isArray(input.records) || input.records.length !== input.source_count) invalid();
  timestamp(input.observed_at, now);
  const seen = new Set<string>();
  const records = input.records.map(value => {
    if (!object(value)) invalid();
    only(value, ["channel_id", ...CHANNEL_TEXT, ...CHANNEL_MONEY, ...CHANNEL_RATES, ...CHANNEL_INTS, ...CHANNEL_CURRENCIES, "enabled", "notes"]);
    if (!text(value.channel_id) || seen.has(value.channel_id)) invalid(); seen.add(value.channel_id);
    for (const field of ["channel_name", "provider", "channel_type", "status_text"]) if (!text(value[field])) invalid();
    for (const field of CHANNEL_TEXT) if (value[field] != null && (!text(value[field]) || /<[^>]*>/.test(String(value[field])))) invalid();
    for (const field of [...CHANNEL_MONEY, ...CHANNEL_RATES]) {
      const number = value[field], rule = field === "balance" ? signedDecimal : unsignedDecimal;
      if (number != null && (typeof number !== "string" || !rule.test(number))) invalid();
      if (CHANNEL_RATES.includes(field) && number != null && Number(number) > 100) invalid();
    }
    if (value.min_amount != null && value.max_amount != null && Number(value.min_amount) > Number(value.max_amount)) invalid();
    for (const field of CHANNEL_INTS) if (value[field] != null && (!Number.isInteger(value[field]) || Number(value[field]) < 0 || Number(value[field]) > 2147483647)) invalid();
    for (const field of CHANNEL_CURRENCIES) if (value[field] != null && (typeof value[field] !== "string" || !/^[A-Z0-9]{3,8}$/.test(String(value[field])))) invalid();
    if (value.limit_currency == null) invalid();
    if (value.enabled != null && typeof value.enabled !== "boolean") invalid();
    if (value.notes != null && (typeof value.notes !== "string" || value.notes.length > 400)) invalid();
    const notes = typeof value.notes === "string" ? redactContact(value.notes.replace(/<[^>]*>/g, "")).replace(/(?:password|passwd|token|secret|cookie|密码|密钥)\s*[:=：]\s*[^\s;；,，]+/gi, "[已移除凭据]").slice(0, 400) || null : null;
    return {...value, notes};
  });
  return {...input, records};
}
export function validateYashRequest(input: unknown, now = Date.now()): Json {
  if (!object(input)) invalid();
  if (input.action === "check") { only(input, ["action"]); return {action: "check"}; }
  if (input.schema_version !== 1) invalid();
  if (input.action === "channels") return validateChannels(input, now);
  if (input.action === "ingest") {
    only(input, ["action", "schema_version", "batch_id", "records"]);
    if (typeof input.batch_id !== "string" || !uuid.test(input.batch_id) || !Array.isArray(input.records) || input.records.length < 1 || input.records.length > 500) invalid();
    const seen = new Set<string>();
    const records = input.records.map(value => {
      if (!object(value)) invalid();
      only(value, RECORD_KEYS);
      if (value.source_site !== "yash" || typeof value.order_type !== "string" || !["deposit", "withdrawal"].includes(value.order_type) || !text(value.order_no) || !text(value.status)) invalid();
      const key = JSON.stringify([value.order_type, value.order_no]); if (seen.has(key)) invalid(); seen.add(key);
      for (const field of TEXT_FIELDS) if (value[field] != null && !text(value[field])) invalid();
      if (value.operator != null && (typeof value.operator !== "string" || value.operator.length > 200)) invalid();
      for (const field of MONEY_FIELDS) {
        const amount = value[field];
        if (field === "amount" && amount == null) invalid();
        const rule = ["balance_before", "balance_after"].includes(field) ? signedDecimal : unsignedDecimal;
        if (amount != null && (typeof amount !== "string" || !rule.test(amount))) invalid();
      }
      const created = timestamp(value.created_at, now), observed = timestamp(value.observed_at, now);
      if (observed < created || value.completed_at != null && timestamp(value.completed_at, now) < created) invalid();
      timezone(value.source_timezone);
      if (value.is_first_order != null && typeof value.is_first_order !== "boolean") invalid();
      if (value.currency != null && (typeof value.currency !== "string" || !/^[A-Z0-9]{3,8}$/.test(value.currency))) invalid();
      if (typeof value.currency_basis !== 'string' || !['source_field', 'platform_default', 'token_type_unverified'].includes(value.currency_basis)
        || value.currency_basis === 'token_type_unverified' && value.currency !== null
        || value.currency_basis === 'platform_default' && value.currency !== 'INR'
        || value.currency_basis === 'source_field' && value.currency == null) invalid();
      return {...value, operator: typeof value.operator === "string" ? (/^operator-[a-f0-9]{16}$/.test(value.operator) ? value.operator : redactContact(value.operator) || null) : null, raw_fields: sanitizeYashRaw(value.raw_fields)};
    });
    return {...input, records};
  }
  if (input.action === "receipt") {
    only(input, ["action", "schema_version", "window_id", "order_type", "stream", "start_at", "end_exclusive", "snapshot_at", "source_timezone", "source_count", "order_keys"]);
    if (typeof input.window_id !== "string" || !uuid.test(input.window_id) || typeof input.order_type !== "string" || !["deposit", "withdrawal"].includes(input.order_type) || typeof input.stream !== "string" || !["createTime", "completeTime"].includes(input.stream)) invalid();
    const start = timestamp(input.start_at, now), end = timestamp(input.end_exclusive, now), snapshot = timestamp(input.snapshot_at, now);
    if (end <= start || end - start > 36 * 3_600_000 || end > snapshot) invalid();
    timezone(input.source_timezone);
    if (!Number.isSafeInteger(input.source_count) || Number(input.source_count) < 0 || Number(input.source_count) > 50_000
      || !Array.isArray(input.order_keys) || input.order_keys.length !== input.source_count || !input.order_keys.every(text)
      || new Set(input.order_keys).size !== input.order_keys.length) invalid();
    return {...input};
  }
  return invalid();
}
async function readBody(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared != null && (!/^\d+$/.test(declared) || Number(declared) > MAX_YASH_BYTES)) throw new RequestError(413, "payload_too_large");
  const reader = request.body?.getReader(); if (!reader) invalid();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_YASH_BYTES) { await reader.cancel(); throw new RequestError(413, "payload_too_large"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)); }
  catch { invalid(); }
}
function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}});
}
function acknowledgement(data: unknown, request: Json): Json {
  if (!object(data) || data.ok !== true) throw new RequestError(503, "invalid_acknowledgement");
  if (request.action === "check" && data.schema_version === 1 && data.source_site === "yash") return {ok: true, schema_version: 1, source_site: "yash"};
  if (request.action === "channels" && data.accepted === (request.records as unknown[]).length && data.source_count === request.source_count && typeof data.snapshot_applied === "boolean") {
    return {ok: true, accepted: data.accepted, source_count: data.source_count, snapshot_applied: data.snapshot_applied};
  }
  if (request.action === "ingest" && data.accepted === (request.records as unknown[]).length) return {ok: true, accepted: data.accepted};
  if (request.action === "receipt" && typeof data.verified === "boolean" && data.source_count === request.source_count
    && [data.source_count, data.uploaded_count, data.stored_count].every(x => Number.isSafeInteger(x) && Number(x) >= 0)
    && Number(data.uploaded_count) <= Number(data.stored_count) && Number(data.uploaded_count) <= Number(data.source_count)
    && (!data.verified || data.source_count === data.uploaded_count && data.uploaded_count === data.stored_count)) {
    return {ok: true, verified: data.verified, source_count: data.source_count, uploaded_count: data.uploaded_count, stored_count: data.stored_count};
  }
  throw new RequestError(503, "invalid_acknowledgement");
}
export function createYashIngestHandler(deps: {env: {SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string}; fetch?: typeof fetch; now?: () => number}) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "POST") return reply(405, {ok: false, error: "method_not_allowed"});
      const token = request.headers.get("X-Yash-Key") || "";
      if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new RequestError(401, "invalid_key");
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) throw new RequestError(415, "unsupported_media_type");
      const url = deps.env.SUPABASE_URL?.replace(/\/$/, ""), key = deps.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new RequestError(503, "not_configured");
      const target = new URL(url);
      if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash || target.pathname !== "/") throw new RequestError(503, "not_configured");
      const payload = validateYashRequest(await readBody(request), (deps.now || Date.now)());
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map(x => x.toString(16).padStart(2, "0")).join("");
      const response = await (deps.fetch || fetch)(`${target.origin}/rest/v1/rpc/${payload.action === "channels" ? "yash_channel_ingest" : "yash_order_ingest"}`, {
        method: "POST", headers: {apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json"},
        body: JSON.stringify({p_token_hash: hash, p_request: payload}), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = object(data) ? String(data.message || "") : "", code = object(data) ? String(data.code || "") : "";
        if (message === "YASH_UNAUTHORIZED" || code === "28000") throw new RequestError(401, "invalid_key");
        if (/^YASH_(?:INVALID_|DUPLICATE_KEYS$|SCOPE_DENIED$)/.test(message) || ["23514", "23502", "22007", "22008", "22P02", "22003"].includes(code)) invalid();
        throw new RequestError(503, "storage_unavailable");
      }
      return reply(200, acknowledgement(data, payload));
    } catch (error) {
      return error instanceof RequestError ? reply(error.status, {ok: false, error: error.code}) : reply(503, {ok: false, error: "storage_unavailable"});
    }
  };
}
