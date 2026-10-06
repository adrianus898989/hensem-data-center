import { canonicalNewarEnvelope, echoMaanEnvelope, MAAN_LAUNCH } from "../_shared/newar-platform-identity.ts";
// Scoped NEWAR detail receiver; dedicated credentials are validated in SQL.
// Authentication and exact platform/dataset authorization are rechecked inside
// the atomic DB transaction. Never distribute a service-role key to collectors.
const MAX_BYTES = 2 * 1024 * 1024;
const NOVA_LAUNCH = Date.parse("2026-10-10T19:00:00Z");
export const NEWAR_RAW_KEYS = [
  "id", "userId", "memberId", "orderNo", "thirdOrderNo", "thirdId", "payId",
  "createTime", "created", "originCreated", "rechargeSuccessTime", "submittedTime", "lastUpdateTime",
  "withdrawState", "thirdState", "rechargeState", "state", "amount", "actualAmount", "fee",
  "rechargeChannelName", "rechargeType", "payMethod", "withdrawChannelName", "withdrawType",
  "type", "operator", "followUpCount", "followupCount", "countryId", "currency", "currencyEvidence",
  "workOrderId", "workOrderTypeName", "submissionTime", "handledTime", "payTypeId",
  "thirdPaymentName", "thirdPartyMappingCode",
  "rechargeChannelId", "reminderCount", "lastUpdateMan", "displayName", "rechargeNumber",
  "transactionId", "rechargeChannelType", "coinToFiatRate", "uGold",
  "sysCurrency", "uRate", "withdrawChannelId", "withdrawCategoryId", "withdrawCategoryName",
  "depositOrderNo", "utr", "kycConnectState", "utrMatched", "workOrderTypeId",
  "rechargeLevel", "rechargeCount",
  "currencyCost", "cost", "mainCost", "status",
  "businessSchemaVersion", "sourceSubmittedAt", "sourceOperatedAt", "sourceHandledAt", "sourcePaidAt",
  "sourceSubmittedSourceField", "sourceOperatedSourceField", "sourceHandledSourceField", "sourcePaidSourceField",
  "operatorName", "operatorType", "operatorSourceField", "requestedAmount", "requestedAmountSource",
  "paidAmount", "paidAmountSource", "requestedCurrency", "paidCurrency", "paymentMethod",
  "withdrawDisplayState", "thirdPaymentState", "automaticReasonLabel", "memberNoteLabel",
  "automaticReasonSource", "memberNoteSource", "sourceEventCount", "sourceEventFirstTime",
  "sourceEventLastTime", "sourceEventDigest", "lastEventState", "lastEventOperator", "lastEventTime", "lastEventSource",
  "followupSourceField", "workorderTypeId", "issueLabelSanitized",
  "rejectionReasonSanitized", "problemTagsSanitized",
] as const;
const RECORD_KEYS = [
  "source_id", "member_id", "order_number", "third_party_order_number", "provider", "provider_id",
  "channel_type", "currency", "amount", "actual_amount", "fee", "status_code", "status_group",
  "created_at", "success_at", "processed_at", "source_updated_at", "captured_at", "raw",
  "workorder_type", "operator", "followup_count",
];
type Json = Record<string, unknown>;
function object(x: unknown): x is Json { return !!x && typeof x === "object" && !Array.isArray(x); }
class RequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
function invalid(): never { throw new RequestError(422, "invalid_batch"); }
function only(x: Json, keys: readonly string[]): void { if (Object.keys(x).some(k => !keys.includes(k))) invalid(); }
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const decimal = /^[0-9]{1,16}(?:[.][0-9]{1,8})?$/;
const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.]\d{1,6})?(?:Z|[+]00:00)$/;
function cleanText(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= 200 && x.trim() === x && !/[\u0000-\u001f\u007f]/.test(x);
}
/** Preserve allowlisted source scalars only. Nested data, notes, credentials,
 * contact/account/bank/IP fields and pictures never reach the SQL request. */
export function sanitizeNewarRaw(raw: unknown): Json {
  if (!object(raw)) invalid();
  const result: Json = {};
  for (const key of NEWAR_RAW_KEYS) {
    const v = raw[key];
    if (v === undefined) continue;
    if (v === null || typeof v === "boolean") result[key] = v;
    else if (typeof v === "string" && v.length <= 256) result[key] = BUSINESS_TEXT_KEYS.has(key) ? redactBusinessText(v) : v;
    else if (typeof v === "number" && Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v))) result[key] = v;
    // Oversized strings, unsafe numbers and compound values are not retained.
  }
  return result;
}
const BUSINESS_TEXT_KEYS = new Set<string>([
  "operatorName", "lastEventOperator", "automaticReasonLabel", "memberNoteLabel", "issueLabelSanitized",
  "rejectionReasonSanitized", "problemTagsSanitized", "operator", "lastUpdateMan", "displayName",
]);
/** A second privacy boundary: only business text survives, never contact,
 * bank/card/account numbers, secret-bearing URLs or cryptocurrency addresses. */
export function redactBusinessText(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "[已移除链接]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[已移除邮箱]")
    .replace(/0x[a-f0-9]{40}|(?:bc1|tb1)[a-z0-9]{20,90}|\bT[1-9A-HJ-NP-Za-km-z]{33}\b/gi, "[已移除地址]")
    .replace(/(?:\+?\d[\d\s().-]{5,}\d)/g, "[已移除号码]")
    .replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 256);
}
function validateBusinessRaw(raw: Json, now: number): void {
  if (raw.businessSchemaVersion === undefined) return; // Legacy clients remain compatible.
  if (raw.businessSchemaVersion !== 2) invalid();
  if (raw.operatorType != null && !["manual", "auto", "unknown"].includes(String(raw.operatorType))) invalid();
  for (const key of ["sourceSubmittedAt", "sourceOperatedAt", "sourceHandledAt", "sourcePaidAt", "sourceEventFirstTime", "sourceEventLastTime", "lastEventTime"]) {
    const v = raw[key]; if (v == null) continue;
    if (typeof v !== "string" || !instant.test(v) || !Number.isFinite(Date.parse(v))
      || Date.parse(v) < Date.UTC(2020, 0, 1) || Date.parse(v) > now + 300_000
      || new Date(v).toISOString().slice(0, 19) !== v.slice(0, 19)) invalid();
  }
  for (const key of ["requestedAmount", "paidAmount"]) if (raw[key] != null
    && (typeof raw[key] !== "string" || !decimal.test(raw[key] as string))) invalid();
  for (const key of ["requestedCurrency", "paidCurrency"]) if (raw[key] != null
    && (typeof raw[key] !== "string" || !/^[A-Z0-9]{3,8}$/.test(raw[key] as string))) invalid();
  if (raw.sourceEventCount != null && (!Number.isSafeInteger(raw.sourceEventCount) || Number(raw.sourceEventCount) < 0 || Number(raw.sourceEventCount) > 999_999_999)) invalid();
  if (raw.sourceEventDigest != null && (typeof raw.sourceEventDigest !== "string" || !/^[a-f0-9]{64}$/.test(raw.sourceEventDigest))) invalid();
}
export function validateNewarBatch(input: unknown, now = Date.now()): Json {
  input = canonicalNewarEnvelope(input);
  if (!object(input)) invalid();
  only(input, ["schema_version", "batch_id", "platform", "dataset", "records"]);
  if (input.schema_version !== 1 || typeof input.batch_id !== "string" || !uuid.test(input.batch_id)
    || !["POPZAR", "DhaniWin", "92BLAZE", "MAANWIN", "92NOVA"].includes(String(input.platform)) || typeof input.platform !== "string"
    || !["charge", "withdraw", "workorder"].includes(String(input.dataset)) || typeof input.dataset !== "string"
    || !Array.isArray(input.records) || input.records.length < 1 || input.records.length > 500) invalid();
  if (input.platform === "MAANWIN" && now < MAAN_LAUNCH) invalid();
  if (input.platform === "92NOVA" && now < NOVA_LAUNCH) invalid();
  const seen = new Set<string>();
  const records = input.records.map(value => {
    if (!object(value)) invalid();
    only(value, RECORD_KEYS);
    if (["source_id", "amount", "status_code", "status_group", "created_at", "captured_at", "raw"].some(key => !Object.prototype.hasOwnProperty.call(value, key))) invalid();
    if (!cleanText(value.source_id) || seen.has(value.source_id)
      || (value.status_code == null ? value.status_group !== "unknown" : !cleanText(value.status_code))
      || typeof value.status_group !== "string" || !["success", "pending", "failed", "rejected", "unknown"].includes(value.status_group)) invalid();
    seen.add(value.source_id);
    for (const key of ["member_id", "order_number", "third_party_order_number", "provider", "provider_id", "channel_type", "workorder_type", "operator"]) {
      if (value[key] != null && !cleanText(value[key])) invalid();
    }
    if (value.currency != null && (typeof value.currency !== "string" || !/^[A-Z0-9]{3,8}$/.test(value.currency))) invalid();
    for (const key of ["amount", "actual_amount", "fee"]) {
      if ((key === "amount" && value[key] == null) || (value[key] != null && (typeof value[key] !== "string" || !decimal.test(value[key] as string)))) invalid();
    }
    for (const key of ["created_at", "success_at", "processed_at", "source_updated_at", "captured_at"]) {
      const v = value[key];
      if ((key === "created_at" || key === "captured_at") && v == null) invalid();
      if (v == null) continue;
      if (typeof v !== "string" || !instant.test(v) || !Number.isFinite(Date.parse(v))
        || Date.parse(v) < Date.UTC(2020, 0, 1) || Date.parse(v) > now + 300_000
        || new Date(v).toISOString().slice(0, 19) !== v.slice(0, 19)) invalid();
    }
    if (Date.parse(String(value.created_at)) > Date.parse(String(value.captured_at)) + 300_000
      || (value.success_at != null && (value.status_group !== "success" || Date.parse(String(value.success_at)) < Date.parse(String(value.created_at))))
      || (value.processed_at != null && Date.parse(String(value.processed_at)) < Date.parse(String(value.created_at)))) invalid();
    if (input.platform === "MAANWIN" && (Date.parse(String(value.created_at)) < MAAN_LAUNCH
      || Date.parse(String(value.captured_at)) < MAAN_LAUNCH)) invalid();
    if (input.platform === "92NOVA" && (Date.parse(String(value.created_at)) < NOVA_LAUNCH
      || Date.parse(String(value.captured_at)) < NOVA_LAUNCH)) invalid();
    if (value.followup_count != null && (!Number.isSafeInteger(value.followup_count) || Number(value.followup_count) < 0 || Number(value.followup_count) > 999_999_999)) invalid();
    const raw = sanitizeNewarRaw(value.raw); validateBusinessRaw(raw, now);
    return { ...value, ...(typeof value.operator === "string" ? {operator: redactBusinessText(value.operator).slice(0, 200).trim() || null} : {}), raw };
  });
  const batch = { ...input, records };
  if (new TextEncoder().encode(JSON.stringify(batch)).byteLength > MAX_BYTES) invalid();
  return batch;
}
async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") || 0) > MAX_BYTES) throw new RequestError(413, "payload_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "invalid_json");
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > MAX_BYTES) { await reader.cancel(); throw new RequestError(413, "payload_too_large"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new RequestError(400, "invalid_json"); }
}
export function validateNewarCoverage(input: unknown, now = Date.now()): Json {
  input = canonicalNewarEnvelope(input);
  if (!object(input)) invalid();
  only(input, ["schema_version", "coverage_id", "platform", "dataset", "basis", "start_at", "end_at", "observed_at",
    "source_total", "fetched_count", "unique_count", "record_count", "prelaunch_excluded", "batch_ids", "source_evidence"]);
  if (input.schema_version !== 1 || typeof input.coverage_id !== "string" || !uuid.test(input.coverage_id)
    || !["POPZAR", "DhaniWin", "92BLAZE", "MAANWIN", "92NOVA"].includes(String(input.platform))
    || !["charge", "withdraw", "workorder"].includes(String(input.dataset)) || input.basis !== "created") invalid();
  for (const key of ["start_at", "end_at", "observed_at"]) {
    const v = input[key]; if (typeof v !== "string" || !instant.test(v) || !Number.isFinite(Date.parse(v))
      || Date.parse(v) < Date.UTC(2020, 0, 1) || Date.parse(v) > now + 300_000
      || new Date(v).toISOString().slice(0, 19) !== v.slice(0, 19)) invalid();
  }
  const start = Date.parse(String(input.start_at)), end = Date.parse(String(input.end_at));
  if (end <= start || end - start > 36 * 3_600_000 || end > Date.parse(String(input.observed_at))) invalid();
  if (input.platform === "MAANWIN" && (now < MAAN_LAUNCH || start < MAAN_LAUNCH
    || Date.parse(String(input.observed_at)) < MAAN_LAUNCH)) invalid();
  if (input.platform === "92NOVA" && (now < NOVA_LAUNCH || end <= NOVA_LAUNCH
    || Date.parse(String(input.observed_at)) < NOVA_LAUNCH)) invalid();
  for (const key of ["source_total", "fetched_count", "unique_count", "record_count", "prelaunch_excluded"])
    if (!Number.isSafeInteger(input[key]) || Number(input[key]) < 0 || Number(input[key]) > 10_000_000) invalid();
  if (input.source_total !== input.fetched_count || input.source_total !== input.unique_count
    || Number(input.record_count) + Number(input.prelaunch_excluded) !== input.source_total
    || !Array.isArray(input.batch_ids) || input.batch_ids.length > 10_000
    || input.batch_ids.some(v => typeof v !== "string" || !uuid.test(v)) || new Set(input.batch_ids).size !== input.batch_ids.length
    || (Number(input.record_count) > 0 && input.batch_ids.length === 0)) invalid();
  if (!object(input.source_evidence)) invalid();
  only(input.source_evidence, ["request_completed", "request_count", "query_digest"]);
  if (input.source_evidence.request_completed !== true || !Number.isSafeInteger(input.source_evidence.request_count)
    || Number(input.source_evidence.request_count) < 1 || Number(input.source_evidence.request_count) > 10_000
    || typeof input.source_evidence.query_digest !== "string" || !/^[a-f0-9]{64}$/.test(input.source_evidence.query_digest)) invalid();
  return input;
}
function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
export function createNewarDetailHandler(deps: {
  env: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  fetch?: typeof fetch; now?: () => number;
}) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "POST") return reply(405, { ok: false, error: "method_not_allowed" });
      const token = request.headers.get("X-Newar-Detail-Key") || "";
      if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new RequestError(401, "invalid_key");
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) throw new RequestError(415, "unsupported_media_type");
      const url = deps.env.SUPABASE_URL?.replace(/\/$/, ""), key = deps.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new RequestError(503, "not_configured");
      const body = await readBody(request);
      if (!object(body) || !["ingest", "coverage"].includes(String(body.action))) throw new RequestError(400, "invalid_action");
      only(body, body.action === "coverage" ? ["action", "coverage"] : ["action", "batch"]);
      const coverage = body.action === "coverage" ? validateNewarCoverage(body.coverage, (deps.now || Date.now)()) : null;
      const batch = coverage ? null : validateNewarBatch(body.batch, (deps.now || Date.now)());
      const tokenHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map(x => x.toString(16).padStart(2, "0")).join("");
      const response = await (deps.fetch || fetch)(`${url}/rest/v1/rpc/${coverage ? "ingest_newar_detail_coverage" : "ingest_newar_detail_batch"}`, {
        method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(coverage ? {p_token_hash: tokenHash, p_coverage: coverage} : { p_token_hash: tokenHash, p_batch: batch }),
        redirect: "error", signal: AbortSignal.timeout(20_000), cache: "no-store",
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const code = object(data) ? String(data.message || "") : "";
        if (code === "NEWAR_AUTH_INVALID") throw new RequestError(401, "invalid_key");
        if (code === "NEWAR_SCOPE_DENIED") throw new RequestError(403, "scope_denied");
        if (["NEWAR_BATCH_CONFLICT", "NEWAR_COVERAGE_CONFLICT"].includes(code)) throw new RequestError(409, "batch_conflict");
        if (code === "NEWAR_COVERAGE_PENDING") throw new RequestError(409, "coverage_pending");
        if (code.startsWith("NEWAR_INVALID") || code === "NEWAR_DUPLICATE_SOURCE_ID") throw new RequestError(422, "invalid_batch");
        throw new RequestError(503, "storage_unavailable");
      }
      if (coverage) {
        if (!object(data) || data.ok !== true || data.coverage_id !== coverage.coverage_id || data.platform !== coverage.platform
          || data.dataset !== coverage.dataset || data.basis !== "created" || data.complete !== true
          || !["accepted", "unchanged"].includes(String(data.status)) || data.record_count !== coverage.record_count)
          throw new RequestError(503, "invalid_acknowledgement");
        return reply(200, echoMaanEnvelope({ok: true, coverage_id: data.coverage_id, platform: data.platform, dataset: data.dataset,
          basis: data.basis, complete: true, status: data.status, record_count: data.record_count}, object(body.coverage) ? body.coverage.platform : null));
      }
      if (!batch) throw new RequestError(503, "invalid_acknowledgement");
      const expected = (batch.records as unknown[]).length;
      if (!object(data) || data.ok !== true || data.batch_id !== batch.batch_id
        || !["accepted", "unchanged"].includes(String(data.status)) || data.received_count !== expected
        || !Number.isSafeInteger(data.written_count) || !Number.isSafeInteger(data.stale_count)
        || Number(data.written_count) < 0 || Number(data.stale_count) < 0
        || Number(data.written_count) + Number(data.stale_count) !== expected) throw new RequestError(503, "invalid_acknowledgement");
      // Return only the acknowledged contract, never unexpected server fields.
      return reply(200, { ok: true, batch_id: data.batch_id, status: data.status,
        received_count: data.received_count, written_count: data.written_count, stale_count: data.stale_count });
    } catch (error) {
      if (error instanceof RequestError) return reply(error.status, { ok: false, error: error.code });
      return reply(503, { ok: false, error: "temporarily_unavailable" });
    }
  };
}
