/** Isolated DUOLI receiver. The database RPC owns key authorization and row rules. */
export const MAX_BYTES = 1_048_576;
export const MAX_ROWS = 200;
export const PLATFORMS = ["UANG", "HOT985", "IND666", "FB168", "FB333"] as const;
const BUSINESSES = ["recharge", "withdraw"] as const;
const COVERAGE = "requested_all_unverified";
const QUERY_MODE = "creation_day_recheck";
const VERSION = "DOLI_DETAIL_R1";
const QUERY_MODE_V2 = "source_time_stream";
const VERSION_V2 = "DOLI_DETAIL_R2";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTC_ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|\+00:00)$/;
const ROW_KEYS = ["order_id", "source_order_id", "platform", "business_type", "order_no", "member_id",
  "created_at", "created_day", "updated_at", "status_code", "status_text", "currency", "operator", "provider",
  "provider_code", "channel", "amount_raw", "amount_source", "amount_unit", "amount_fields_raw", "raw"];
const ROW_KEYS_V2 = [...ROW_KEYS, "audit_completed_at", "audit_duration_seconds"];
const AMOUNT_KEYS = ["original_price", "gold", "amount", "order_amount", "actual_amount", "pay_amount",
  "payment_amount", "price", "money"];
const AMOUNT_KEYS_V2 = [...AMOUNT_KEYS, "gamount", "actual_received_gamount", "fee", "fee_gamount"];
const RAW_KEYS = ["_id", "order_id", "order_no", "id", "orderId", "created_at", "create_time", "createdAt",
  "createTime", "apply_time", "applyTime", "update_at", "update_time", "updated_at", "updatedAt", "updateTime",
  ...AMOUNT_KEYS, "status_text", "statusText", "audit_status_text", "auditStatusText", "state_text", "stateText",
  "user_id", "status", "currency", "pay_chn", "channel", "channel_code", "bank_code", "bank_child",
  "e_wallet_type_name", "pay_type"];
const RAW_KEYS_V2 = [...RAW_KEYS, "audit_time", "audit_time_consuming", "gamount", "actual_received_gamount",
  "fee", "fee_gamount"];
const encoder = new TextEncoder();
type JsonObject = Record<string, unknown>;
type Action = "check" | "state" | "batch" | "finalize";
type RequestBody = JsonObject & { schema_version: 1 | 2; action: Action };
export type Dependencies = {
  env: (name: string) => string | undefined;
  fetch?: typeof fetch;
  rpcTimeoutMs?: number;
  bodyTimeoutMs?: number;
};

class ReceiverError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: JsonObject, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function day(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function utc(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = UTC_ISO.exec(value);
  return match !== null && day(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60 &&
    Number(match[4]) < 60 && Number.isFinite(Date.parse(value));
}

function normalizedTimestamp(value: string): string {
  const [seconds, fraction = ""] = value.replace(/(?:Z|\+00:00)$/, "").split(".");
  return `${seconds}.${fraction.padEnd(6, "0")}`;
}

function sameTimestamp(left: string, right: string): boolean {
  return normalizedTimestamp(left) === normalizedTimestamp(right);
}

function sameUuid(left: unknown, right: unknown): boolean {
  return uuid(left) && uuid(right) && left.toLowerCase() === right.toLowerCase();
}

function scalarText(value: string): boolean {
  return [...value].length <= 512 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
}

function dimension(value: JsonObject, schemaVersion: 1 | 2 = 1): boolean {
  if (!PLATFORMS.some((platform) => value.platform === platform) ||
    !BUSINESSES.some((business) => value.business === business) || !uuid(value.window_id) ||
    !utc(value.end_exclusive)) return false;
  if (schemaVersion === 1) return day(value.local_day);
  return utc(value.start_at) && normalizedTimestamp(value.start_at) < normalizedTimestamp(value.end_exclusive) &&
    (value.stream === "updated" || (value.stream === "created" && value.business === "recharge"));
}

// Optional evidence is not a verified blocking or rejection cause.
function sourceNotes(value: unknown): boolean {
  if (!object(value) || !exactKeys(value, ["version", "fields"]) || value.version !== 1 ||
    !object(value.fields) || !exactKeys(value.fields, ["condition", "remark"]) ||
    encoder.encode(JSON.stringify(value)).byteLength > 8192) return false;
  for (const item of Object.values(value.fields)) {
    if (!object(item) || !exactKeys(item, ["state", "text", "redacted", "truncated"]) ||
      typeof item.state !== "string" || typeof item.redacted !== "boolean" || typeof item.truncated !== "boolean" ||
      !["missing", "empty", "invalid", "present", "withheld"].includes(item.state)) return false;
    if (item.state === "present") {
      if (typeof item.text !== "string" || [...item.text].length < 1 || [...item.text].length > 512 ||
        item.text.replace(/^ +| +$/g, "").length === 0 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(item.text)) return false;
    } else if (item.text !== null || item.truncated !== false) return false;
    if (item.state === "withheld") {
      if (item.redacted !== true) return false;
    } else if (item.state !== "present" && item.redacted !== false) return false;
  }
  return true;
}

function row(value: unknown, body: JsonObject): boolean {
  const v2 = body.schema_version === 2;
  const hasNotes = object(value) && Object.hasOwn(value, "source_notes");
  const rowKeys = v2 && hasNotes ? [...ROW_KEYS_V2, "source_notes"] : v2 ? ROW_KEYS_V2 : ROW_KEYS;
  const rawKeys = v2 ? RAW_KEYS_V2 : RAW_KEYS;
  const amountKeys = v2 ? AMOUNT_KEYS_V2 : AMOUNT_KEYS;
  if (!object(value) || !exactKeys(value, rowKeys) || value.platform !== body.platform ||
    value.business_type !== body.business || !utc(value.created_at) || !day(value.created_day) ||
    (value.updated_at !== null && !utc(value.updated_at)) || value.amount_unit !== "source_unverified" ||
    !object(value.raw) || !object(value.amount_fields_raw)) return false;
  const special = new Set(["created_at", "created_day", "updated_at", "raw", "amount_fields_raw",
    "audit_completed_at", "audit_duration_seconds", "source_notes"]);
  if (hasNotes && (!v2 || body.business !== "withdraw" || !sourceNotes(value.source_notes))) return false;
  if (typeof value.order_id !== "string" || value.order_id.length === 0 ||
    typeof value.source_order_id !== "string" || value.source_order_id.length === 0) return false;
  if (!v2 && value.created_day !== body.local_day) return false;
  if (v2) {
    if ((value.audit_completed_at !== null && !utc(value.audit_completed_at)) ||
      (value.audit_duration_seconds !== null && !integer(value.audit_duration_seconds)) ||
      value.created_day !== new Date(Date.parse(value.created_at) + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)) return false;
    const event = body.stream === "created" ? value.created_at : value.updated_at;
    if (!utc(event) || normalizedTimestamp(event) < normalizedTimestamp(body.start_at as string) ||
      normalizedTimestamp(event) >= normalizedTimestamp(body.end_exclusive as string)) return false;
  }
  if (rowKeys.some((key) => !special.has(key) && value[key] !== null &&
    (typeof value[key] !== "string" || !scalarText(value[key])))) return false;
  if (Object.entries(value.raw).some(([key, item]) => !rawKeys.includes(key) ||
    !((typeof item === "string" && scalarText(item)) ||
      (typeof item === "number" && Number.isFinite(item)) ||
      typeof item === "boolean"))) return false;
  return Object.entries(value.amount_fields_raw).every(([key, item]) => amountKeys.includes(key) &&
    typeof item === "string" && item.length <= 128 && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(item));
}

function validateBody(value: unknown): RequestBody {
  const invalid = () => { throw new ReceiverError(400, "invalid_request"); };
  if (!object(value) || (value.schema_version !== 1 && value.schema_version !== 2)) return invalid();
  const schemaVersion = value.schema_version;
  const scopeKeys = schemaVersion === 1 ? ["local_day"] : ["stream", "start_at"];
  if (value.action === "check" || value.action === "state") {
    if (!exactKeys(value, ["schema_version", "action"])) return invalid();
  } else if (value.action === "batch") {
    if (!exactKeys(value, ["schema_version", "action", "window_id", "batch_id", "platform", "business",
      ...scopeKeys, "end_exclusive", "observed_at", "rows"]) || !dimension(value, schemaVersion) ||
      !uuid(value.batch_id) || !utc(value.observed_at) || !Array.isArray(value.rows) ||
      value.rows.length === 0 || value.rows.length > MAX_ROWS || !value.rows.every((item) => row(item, value))) return invalid();
  } else if (value.action === "finalize") {
    if (!exactKeys(value, ["schema_version", "action", "window_id", "platform", "business", ...scopeKeys,
      "end_exclusive", "source_count", "batch_ids", "proof", "status_coverage"]) || !dimension(value, schemaVersion) ||
      !integer(value.source_count) || value.source_count > 999_999_999 || !Array.isArray(value.batch_ids) || !value.batch_ids.every(uuid) ||
      new Set(value.batch_ids.map((id) => id.toLowerCase())).size !== value.batch_ids.length ||
      value.proof !== "terminal_double_census" || value.status_coverage !== COVERAGE) return invalid();
  } else return invalid();
  return value as RequestBody;
}

async function boundedText(body: ReadableStream<Uint8Array> | null, tooLargeStatus: number,
  signal: AbortSignal): Promise<string> {
  if (!body) throw new ReceiverError(tooLargeStatus === 413 ? 400 : 502, tooLargeStatus === 413 ? "invalid_request" : "upstream_failure");
  const reader = body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size >= MAX_BYTES) {
        void reader.cancel().catch(() => {});
        throw new ReceiverError(tooLargeStatus, tooLargeStatus === 413 ? "payload_too_large" : "upstream_failure");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof ReceiverError) throw error;
    throw new ReceiverError(tooLargeStatus === 413 ? 400 : 502,
      tooLargeStatus === 413 ? "invalid_request" : "upstream_failure");
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

async function deadline<T>(operation: (signal: AbortSignal) => Promise<T>, milliseconds: number,
  status: number, code: string): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ReceiverError(status, code));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function response(value: JsonObject, status = 200): Response {
  const text = JSON.stringify(value);
  if (encoder.encode(text).byteLength >= MAX_BYTES) throw new ReceiverError(502, "upstream_failure");
  return new Response(text, { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}

function config(env: Dependencies["env"], schemaVersion: 1 | 2): { endpoint: string; serviceKey: string; legacyJwt: boolean } {
  const url = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  try {
    if (!url || !serviceKey || serviceKey.length > 8192 || /[\s\x00-\x1f\x7f]/.test(serviceKey)) throw new Error();
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash ||
      (parsed.pathname !== "/" && parsed.pathname !== "")) throw new Error();
    // Fail closed if the privileged server environment accidentally contains an anon JWT.
    const legacyJwt = !/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(serviceKey);
    if (legacyJwt) {
      const pieces = serviceKey.split(".");
      if (pieces.length !== 3 || !pieces.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
      const payload = pieces[1].replace(/-/g, "+").replace(/_/g, "/");
      if (JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="))).role !== "service_role") throw new Error();
    }
    return { endpoint: `${parsed.origin}/rest/v1/rpc/${schemaVersion === 2 ? "duoli_detail_ingest_v2" : "duoli_detail_ingest"}`,
      serviceKey, legacyJwt };
  } catch {
    throw new ReceiverError(503, "receiver_unconfigured");
  }
}

function project(value: JsonObject, keys: readonly string[]): JsonObject {
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

function safeResult(value: unknown, request: RequestBody): JsonObject {
  const failure = () => { throw new ReceiverError(502, "upstream_failure"); };
  const schemaVersion = request.schema_version;
  const queryMode = schemaVersion === 2 ? QUERY_MODE_V2 : QUERY_MODE;
  const receiverVersion = schemaVersion === 2 ? VERSION_V2 : VERSION;
  const scopeKeys = schemaVersion === 2 ? ["stream", "start_at"] : ["local_day"];
  if (!object(value) || value.ok !== true || value.schema_version !== schemaVersion || value.action !== request.action) return failure();
  if (request.action === "check") {
    const platforms = value.platforms;
    if (value.receiver_version !== receiverVersion || value.status_coverage !== COVERAGE || value.query_mode !== queryMode ||
      !Array.isArray(platforms) || platforms.length !== PLATFORMS.length ||
      !PLATFORMS.every((platform) => platforms.includes(platform))) return failure();
    if (schemaVersion === 2 && Object.hasOwn(value, "source_notes_version") && value.source_notes_version !== 1) return failure();
    return { ok: true, schema_version: schemaVersion, action: "check", platforms: [...PLATFORMS],
      receiver_version: receiverVersion, status_coverage: COVERAGE, query_mode: queryMode,
      ...(schemaVersion === 2 && value.source_notes_version === 1 ? { source_notes_version: 1 } : {}) };
  }
  if (request.action === "batch") {
    const count = (request.rows as unknown[]).length;
    if (!sameUuid(value.window_id, request.window_id) || !sameUuid(value.batch_id, request.batch_id) || value.received !== count ||
      !integer(value.written) || value.written > count || typeof value.replayed !== "boolean") return failure();
    if (schemaVersion === 2 && (!["platform", "business", "stream", "start_at", "end_exclusive"].every((key) => value[key] === request[key]) ||
      value.query_mode !== queryMode || value.status_coverage !== COVERAGE)) return failure();
    const streamKeys = schemaVersion === 2 ? ["platform", "business", "stream", "start_at", "end_exclusive", "query_mode", "status_coverage"] : [];
    return project(value, ["ok", "schema_version", "action", "batch_id", "window_id", "received", "written", "replayed", ...streamKeys]);
  }
  if (request.action === "finalize") {
    if (!sameUuid(value.window_id, request.window_id) ||
      !["platform", "business", ...scopeKeys, "source_count"].every((key) => value[key] === request[key]) ||
      !utc(value.end_exclusive) || (schemaVersion === 2 ? value.end_exclusive !== request.end_exclusive :
        !sameTimestamp(value.end_exclusive, request.end_exclusive as string)) ||
      value.uploaded_count !== request.source_count || value.finalized !== true || value.status_coverage !== COVERAGE ||
      value.query_mode !== queryMode) return failure();
    return project(value, ["ok", "schema_version", "action", "window_id", "platform", "business", ...scopeKeys,
      "end_exclusive", "source_count", "uploaded_count", "finalized", "status_coverage", "query_mode"]);
  }
  if (!Array.isArray(value.progress)) return failure();
  const progressKeys = ["platform", "business", ...scopeKeys, "end_exclusive", "source_count", "uploaded_count",
    "finalized", "window_id", "status_coverage", "query_mode", "acknowledged_at"];
  const progress = value.progress.map((item: unknown) => {
    if (!object(item) || !dimension(item, schemaVersion) || !integer(item.source_count) || !integer(item.uploaded_count) ||
      item.source_count !== item.uploaded_count || item.finalized !== true || item.status_coverage !== COVERAGE ||
      item.query_mode !== queryMode || !utc(item.acknowledged_at)) return failure();
    return project(item, progressKeys);
  });
  return { ok: true, schema_version: schemaVersion, action: "state", progress };
}

function rpcError(value: unknown): ReceiverError {
  const code = object(value) ? value.code : undefined;
  if (code === "28000") return new ReceiverError(401, "unauthorized");
  if (code === "22023" || code === "23514") return new ReceiverError(400, "invalid_request");
  if (code === "23505") return new ReceiverError(409, "conflict");
  return new ReceiverError(502, "upstream_failure");
}

/** No browser CORS, redirects, logs, or error echoes. No caller Supabase credentials are accepted. */
export function createHandler(dependencies: Dependencies): (request: Request) => Promise<Response> {
  const fetchRpc = dependencies.fetch ?? globalThis.fetch;
  const rpcTimeoutMs = dependencies.rpcTimeoutMs ?? 30_000;
  const bodyTimeoutMs = dependencies.bodyTimeoutMs ?? 15_000;
  if (!Number.isSafeInteger(rpcTimeoutMs) || rpcTimeoutMs < 1 || !Number.isSafeInteger(bodyTimeoutMs) || bodyTimeoutMs < 1) {
    throw new Error("invalid_timeout_configuration");
  }
  return async (request: Request): Promise<Response> => {
    let errorVersion: 1 | 2 = 1;
    try {
      if (request.method !== "POST") throw new ReceiverError(405, "method_not_allowed");
      const key = request.headers.get("x-api-key");
      if (!key || !/^[A-Za-z0-9_-]{32,256}$/.test(key)) throw new ReceiverError(401, "unauthorized");
      const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      if (mediaType !== "application/json") throw new ReceiverError(415, "unsupported_media_type");
      const declaredSize = request.headers.get("content-length");
      if (declaredSize !== null) {
        if (!/^\d+$/.test(declaredSize)) throw new ReceiverError(400, "invalid_request");
        if (Number(declaredSize) >= MAX_BYTES) throw new ReceiverError(413, "payload_too_large");
      }
      const raw = await deadline((signal) => boundedText(request.body, 413, signal), bodyTimeoutMs, 408, "request_timeout");
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { throw new ReceiverError(400, "invalid_request"); }
      if (object(parsed) && parsed.schema_version === 2) errorVersion = 2;
      const body = validateBody(parsed);
      const { endpoint, serviceKey, legacyJwt } = config(dependencies.env, body.schema_version);
      const rpcBody = JSON.stringify({ p_key: key, p_body: body });
      if (encoder.encode(rpcBody).byteLength >= MAX_BYTES) throw new ReceiverError(413, "payload_too_large");
      const result = await deadline(async (signal) => {
        const upstream = await fetchRpc(endpoint, { method: "POST", redirect: "error", signal,
          headers: { "Content-Type": "application/json", "Accept": "application/json",
            "Accept-Profile": "public", "Content-Profile": "public", apikey: serviceKey,
            ...(legacyJwt ? { Authorization: `Bearer ${serviceKey}` } : {}) }, body: rpcBody });
        const upstreamSize = upstream.headers.get("content-length");
        if (upstreamSize !== null && (!/^\d+$/.test(upstreamSize) || Number(upstreamSize) >= MAX_BYTES)) {
          void upstream.body?.cancel().catch(() => {});
          throw new ReceiverError(502, "upstream_failure");
        }
        const text = await boundedText(upstream.body, 502, signal);
        let data: unknown;
        try { data = JSON.parse(text); } catch { throw new ReceiverError(502, "upstream_failure"); }
        if (!upstream.ok || upstream.redirected) throw rpcError(data);
        return safeResult(data, body);
      }, rpcTimeoutMs, 504, "upstream_timeout");
      return response(result);
    } catch (error) {
      const safe = error instanceof ReceiverError ? error : new ReceiverError(502, "upstream_failure");
      return response({ ok: false, schema_version: errorVersion, error: safe.code }, safe.status);
    }
  };
}
