// Dedicated scoped collector credential; the service key never leaves this server.
// Full validation and atomic replay handling are repeated in PostgreSQL.
export const NEWAR_BUSINESS_FIELDS: Record<string, string[]> = {
  third_party_volume: ["rows"], auto_withdraw_bundle: ["rows", "operator_rows"],
  workorder_daily_bundle: ["rows", "employee_rows", "type_rows"],
};
const COMMON = ["stat_date", "system_name", "country", "country_code", "platform"];
const THIRD = ["biz_type", "biz_label", "type", "third_party", "mapping_code", "mappingCode", "map_code", "mapping", "pay_method", "payMethod", "映射码", "success_count", "success_amount", "total_count", "total_amount", "failed_count", "success_rate", "count", "amount", "updated_at"];
const AUTO = ["total_count", "success_count", "reject_count", "auto_count", "manual_count", "total_handle_seconds", "handle_count"];
const OPERATOR = ["operator", "processed_count", "reject_count", "total_handle_seconds", "handle_count"];
const WORKORDER = ["total_count", "pending_count", "in_progress_count", "system_processing_count", "completed_count", "rejected_count", "one_to_one_count", "total_conversation_count", "total_conversation_rate_text", "total_message_count", "avg_conversation_duration_text", "avg_first_response_time_text", "account_type", "employee_id", "employee_name", "order_type", "order_name", "one_to_one_work_order_count", "total_sation_duration_text", "first_response_time_text"];
export function newarBusinessRowKeys(kind: string, field: string): string[] {
  return [...COMMON, ...(kind === "third_party_volume" && field === "rows" ? THIRD
    : kind === "auto_withdraw_bundle" ? field === "rows" ? AUTO : OPERATOR
    : kind === "workorder_daily_bundle" ? WORKORDER : [])];
}
const MAX_BYTES = 2_000_000;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/;
const LAUNCH = Date.parse("2026-09-21T19:00:00Z");
type Json = Record<string, any>;
function object(v: unknown): v is Json {return !!v && typeof v === "object" && !Array.isArray(v);}
class BusinessError extends Error {constructor(readonly status: number, readonly code: string) {super(code);}}
function invalid(): never {throw new BusinessError(422, "invalid_batch");}
function only(v: Json, keys: string[]) {if (Object.keys(v).some(k => !keys.includes(k))) invalid();}
function date(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v + "T00:00:00Z"))) return false;
  return new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
}
export function validateNewarBusinessBatch(input: unknown, now = Date.now()): Json {
  if (!object(input)) invalid();
  only(input, ["action", "kind", "batch_id", "platform", "captured_at", "snapshot_at", "payload"]);
  const {kind, platform, payload, captured_at: captured} = input;
  if (input.action !== "ingest" || typeof kind !== "string" || !Object.prototype.hasOwnProperty.call(NEWAR_BUSINESS_FIELDS, kind)
    || !["POPZAR", "DhaniWin", "92BLAZE"].includes(platform) || typeof platform !== "string"
    || typeof input.batch_id !== "string" || !UUID.test(input.batch_id) || !object(payload)
    || typeof captured !== "string" || !INSTANT.test(captured) || !Number.isFinite(Date.parse(captured))
    || new Date(captured).toISOString().slice(0, 19) !== captured.slice(0, 19)
    || Date.parse(captured) < Date.UTC(2020, 0, 1) || Date.parse(captured) > now + 300_000
    || ("snapshot_at" in input && input.snapshot_at !== captured)
    || (platform === "92BLAZE" && (Date.parse(captured) < LAUNCH || now < LAUNCH))) invalid();
  const fields = NEWAR_BUSINESS_FIELDS[kind];
  only(payload, [...fields, "action", "source", "system_name", ...(kind === "third_party_volume" ? ["third_party_rows"] : [])]);
  if ("third_party_rows" in payload && JSON.stringify(payload.third_party_rows) !== JSON.stringify(payload.rows)) invalid();
  for (const key of ["action", "source", "system_name"]) if (key in payload
    && (typeof payload[key] !== "string" || payload[key].length > 200 || /[\u0000-\u001f\u007f]/.test(payload[key]))) invalid();
  const country = platform === "DhaniWin" ? "印度" : "巴基斯坦", code = platform === "DhaniWin" ? "IN" : "PK";
  const localDate = new Date(Date.parse(captured) + (platform === "DhaniWin" ? 330 : 300) * 60000).toISOString().slice(0, 10);
  let total = 0;
  for (const field of fields) {
    const rows = payload[field];
    if (!Array.isArray(rows) || rows.length > 5000) invalid();
    total += rows.length; const seen = new Set();
    for (const row of rows) {
      if (!object(row)) invalid();
      only(row, newarBusinessRowKeys(kind, field));
      if (!date(row.stat_date) || row.stat_date < "2020-01-01" || row.stat_date > localDate
        || (platform === "92BLAZE" && row.stat_date < "2026-09-22")
        || row.platform !== platform || row.country !== country || ("country_code" in row && row.country_code !== code)
        || typeof row.system_name !== "string" || !row.system_name.trim()) invalid();
      for (const [key, value] of Object.entries(row)) {
        if (/(_count|_seconds)$/.test(key) || ["count", "amount", "total_amount", "success_amount", "success_rate"].includes(key)) {
          if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER
            || ((/_count$/.test(key) || key === "count") && !Number.isSafeInteger(value)) || (key === "success_rate" && value > 1)) invalid();
        } else if (typeof value !== "string" || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) invalid();
      }
      if (kind === "workorder_daily_bundle") {
        const required = field === "rows"
          ? ["total_count", "pending_count", "in_progress_count", "system_processing_count", "completed_count", "rejected_count", "one_to_one_count",
            "total_conversation_count", "total_conversation_rate_text", "total_message_count", "avg_conversation_duration_text", "avg_first_response_time_text"]
          : ["account_type", "employee_id", "employee_name", "order_type", "order_name", "total_count", "in_progress_count", "completed_count", "rejected_count",
            "one_to_one_work_order_count", "total_conversation_count", "total_conversation_rate_text", "total_message_count", "avg_conversation_duration_text",
            "avg_first_response_time_text", "total_sation_duration_text", "first_response_time_text"];
        if (required.some(k => !(k in row))) invalid();
      }
      let identity: unknown;
      if (kind === "third_party_volume") {
        if (!["recharge", "withdraw"].includes(row.biz_type) || typeof row.third_party !== "string" || !row.third_party.trim()
          || ["mapping_code", "success_count", "success_amount", "total_count", "total_amount", "failed_count", "success_rate", "count", "amount"].some(k => !(k in row))
          || row.success_count > row.total_count || row.failed_count !== row.total_count - row.success_count
          || row.count !== row.success_count || row.amount !== row.success_amount || row.success_amount > row.total_amount) invalid();
        identity = [row.stat_date, row.biz_type, row.third_party, row.mapping_code];
      } else if (kind === "auto_withdraw_bundle" && field === "operator_rows") {
        if (OPERATOR.some(k => !(k in row)) || !row.operator.trim()) invalid();
        identity = [row.stat_date, row.operator];
      } else if (kind === "workorder_daily_bundle" && field !== "rows") {
        if (["employee_name", "order_type", "order_name", "total_count"].some(k => !(k in row))) invalid();
        identity = [row.stat_date, row.employee_name, row.order_type, row.order_name, row.account_type ?? null, row.employee_id ?? null];
      } else {
        if (!("total_count" in row) || (kind === "auto_withdraw_bundle" && AUTO.some(k => !(k in row)))) invalid();
        identity = row.stat_date;
      }
      const id = JSON.stringify(identity); if (seen.has(id)) invalid(); seen.add(id);
    }
  }
  if (total < 1 || total > 10000 || new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_BYTES) invalid();
  return input;
}
async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") || 0) > MAX_BYTES) throw new BusinessError(413, "payload_too_large");
  const reader = request.body?.getReader(); if (!reader) throw new BusinessError(400, "invalid_json");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {const next = await reader.read(); if (next.done) break; size += next.value.length;
      if (size > MAX_BYTES) {await reader.cancel(); throw new BusinessError(413, "payload_too_large");} chunks.push(next.value);}
  } finally {reader.releaseLock();}
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
  try {return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));}
  catch {throw new BusinessError(400, "invalid_json");}
}
function reply(status: number, body: unknown) {return new Response(JSON.stringify(body), {status,
  headers: {"Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}});}
export function createNewarBusinessHandler(deps: {env: {SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string}; fetch?: typeof fetch; now?: () => number}) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "POST") return reply(405, {ok: false, error: "method_not_allowed"});
      const token = request.headers.get("X-Newar-Business-Key") || "";
      if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new BusinessError(401, "invalid_key");
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) throw new BusinessError(415, "unsupported_media_type");
      const url = deps.env.SUPABASE_URL?.replace(/\/$/, ""), serviceKey = deps.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !serviceKey) throw new BusinessError(503, "not_configured");
      const batch = validateNewarBusinessBatch(await readBody(request), (deps.now || Date.now)());
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map(n => n.toString(16).padStart(2, "0")).join("");
      const response = await (deps.fetch || fetch)(`${url}/rest/v1/rpc/ingest_newar_business_batch`, {method: "POST",
        headers: {apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json"},
        body: JSON.stringify({p_token_hash: hash, p_batch: batch}), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(25000)});
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const code = object(data) ? String(data.message || "") : "";
        if (code === "NEWAR_BUSINESS_AUTH_INVALID") throw new BusinessError(401, "invalid_key");
        if (code === "NEWAR_BUSINESS_SCOPE_DENIED") throw new BusinessError(403, "scope_denied");
        if (["NEWAR_BUSINESS_BATCH_CONFLICT", "NEWAR_BUSINESS_SNAPSHOT_CONFLICT"].includes(code)) throw new BusinessError(409, "batch_conflict");
        if (code.startsWith("NEWAR_BUSINESS_INVALID") || code === "NEWAR_BUSINESS_DUPLICATE_ROW") throw new BusinessError(422, "invalid_batch");
        throw new BusinessError(503, "storage_unavailable");
      }
      if (!object(data) || data.ok !== true || data.batch_id !== batch.batch_id || data.platform !== batch.platform || data.kind !== batch.kind
        || !["accepted", "unchanged"].includes(data.status) || !object(data.counts) || data.operator_insert !== 0) throw new BusinessError(503, "invalid_acknowledgement");
      const counts: Json = {};
      for (const field of ["rows", "operator_rows", "employee_rows", "type_rows"]) {
        const expected = batch.payload[field]?.length || 0;
        if (!Number.isSafeInteger(data.counts[field]) || data.counts[field] !== expected) throw new BusinessError(503, "invalid_acknowledgement");
        counts[field] = expected;
      }
      if (data.operator_update !== counts.operator_rows) throw new BusinessError(503, "invalid_acknowledgement");
      return reply(200, {ok: true, batch_id: data.batch_id, kind: data.kind, platform: data.platform, status: data.status,
        counts, operator_insert: 0, operator_update: counts.operator_rows});
    } catch (error) {
      return error instanceof BusinessError ? reply(error.status, {ok: false, error: error.code}) : reply(503, {ok: false, error: "temporarily_unavailable"});
    }
  };
}
