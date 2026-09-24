// Synchronize only the safe deposit-not-received columns from the UPI核对 tab.
// The private admin page reads Supabase; it never calls Google directly.
const DEFAULT_SOURCE_ID = "1Y110H-E0ny6Yj6ZEhn7tRLgCuRrSE5iDeFwaZ8-aCqg";
const SHEET_TAB = "UPI核对";
const MAX_ROWS = 40000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
const encoder = new TextEncoder();

type Runtime = { env: (name: string) => string | undefined; fetch: typeof fetch; now: () => number; crypto: Crypto };
type Settings = { sourceId: string; email: string; privateKey: string; supabaseUrl: string; serviceKey: string };
class SyncError extends Error { constructor(readonly code: string, readonly status = 503) { super(code); } }

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" } });
}
function base64Url(bytes: Uint8Array): string {
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sameSecret(expected: string, supplied: string, crypto: Crypto): Promise<boolean> {
  if (!expected || !supplied || supplied.length > 4096) return false;
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(expected)), crypto.subtle.digest("SHA-256", encoder.encode(supplied))]);
  const left = new Uint8Array(a), right = new Uint8Array(b); let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}
function sourceId(value: string): string {
  const input = value.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (/^[a-zA-Z0-9_-]{10,200}$/.test(input)) return input;
  try {
    const url = new URL(input), match = /^\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,200})(?:\/(?:edit|view|preview|htmlview|copy))?\/?$/.exec(url.pathname);
    if (url.protocol === "https:" && url.hostname === "docs.google.com" && !url.port && !url.username && !url.password && match) return match[1];
  } catch { /* fixed error below */ }
  throw new SyncError("source_configuration_invalid", 500);
}
function config(runtime: Runtime): Settings {
  const email = runtime.env("GOOGLE_SERVICE_ACCOUNT_EMAIL") || "";
  const privateKey = (runtime.env("GOOGLE_PRIVATE_KEY") || "").trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n");
  const source = runtime.env("DEPOSIT_ISSUE_SHEET_ID") || runtime.env("DEPOSIT_ISSUE_SHEET_URL") || DEFAULT_SOURCE_ID;
  const supabaseUrl = (runtime.env("SUPABASE_URL") || "").trim().replace(/\/$/, "");
  const serviceKey = runtime.env("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!email || !privateKey || !serviceKey) throw new SyncError("sync_configuration_incomplete", 500);
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:" || url.origin !== supabaseUrl || url.username || url.password || url.port || !url.hostname.endsWith(".supabase.co")) throw new Error();
  } catch { throw new SyncError("sync_configuration_incomplete", 500); }
  return { sourceId: sourceId(source), email, privateKey, supabaseUrl, serviceKey };
}
async function assertion(settings: Settings, runtime: Runtime): Promise<string> {
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const now = Math.floor(runtime.now() / 1000);
  const claims = base64Url(encoder.encode(JSON.stringify({ iss: settings.email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })));
  const unsigned = header + "." + claims;
  const clean = settings.privateKey.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s+/g, "");
  const bytes = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
  const key = await runtime.crypto.subtle.importKey("pkcs8", bytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await runtime.crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  return unsigned + "." + base64Url(new Uint8Array(signature));
}
async function readText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader(), decoder = new TextDecoder(); let size = 0, output = "";
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new SyncError("source_payload_too_large", 413); }
      output += decoder.decode(chunk.value, { stream: true });
    }
    return output + decoder.decode();
  } finally { reader.releaseLock(); }
}
async function requestJson(runtime: Runtime, url: string, init: RequestInit, maxBytes: number): Promise<any> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await runtime.fetch(url, { ...init, redirect: "error", cache: "no-store", signal: controller.signal });
    const text = await readText(response, maxBytes);
    if (!response.ok) throw new SyncError("upstream_request_failed", response.status >= 500 ? 503 : 502);
    try { return text ? JSON.parse(text) : null; } catch { throw new SyncError("invalid_upstream_response"); }
  } catch (error) {
    if (error instanceof SyncError) throw error;
    throw new SyncError(controller.signal.aborted ? "sync_request_timed_out" : "sync_upstream_unavailable", controller.signal.aborted ? 504 : 503);
  } finally { clearTimeout(timer); }
}
function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace(/[,，\s]/g, ""); if (!text) return null;
  const number = Number(text); return Number.isFinite(number) ? number : null;
}
function dateValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Only real Google date serials. Never infer the sheet's date from an order ID.
    if (value < 1 || value > 73415) return null;
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  }
  const text = String(value ?? "").trim();
  const match = /^(\d{4})[年\/-](\d{1,2})[月\/-](\d{1,2})(?:日|$|[ T])/.exec(text);
  if (!match) return null;
  const candidate = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const date = new Date(candidate + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === candidate ? candidate : null;
}
function textValue(value: unknown, max = 200): string | null {
  const text = String(value ?? "").replace(/[\u0000-\u001f]/g, "").trim(); return text ? text.slice(0, max) : null;
}
function rowValue(row: unknown[], headers: Map<string, number>, name: string): unknown { const index = headers.get(name); return index === undefined ? null : row[index]; }
function rowsFromValues(values: unknown[][], sourceSheet: string, collectedAt: string): Record<string, unknown>[] {
  if (!Array.isArray(values) || !values.length || !Array.isArray(values[0])) throw new SyncError("source_rows_missing", 502);
  const headers = new Map<string, number>(); (values[0] as unknown[]).forEach((value, index) => { const key = String(value ?? "").trim(); if (key && !headers.has(key)) headers.set(key, index); });
  for (const required of ["盘口", "订单号", "金额", "三方", "状态", "未入款天数", "日期"]) if (!headers.has(required)) throw new SyncError("source_headers_missing", 502);
  const rows: Record<string, unknown>[] = [];
  for (let index = 1; index < Math.min(values.length, MAX_ROWS + 1); index++) {
    const row = Array.isArray(values[index]) ? values[index] : [];
    const platform = textValue(rowValue(row, headers, "盘口"));
    const orderNumber = textValue(rowValue(row, headers, "订单号"));
    if (!platform && !orderNumber) continue;
    const sourceRow = index + 1;
    rows.push({
      id: `${sourceSheet}:${SHEET_TAB}:${sourceRow}`,
      source_sheet: sourceSheet, source_tab: SHEET_TAB, source_row: sourceRow,
      platform, order_number: orderNumber, utr: textValue(rowValue(row, headers, "UTR")),
      amount: numberValue(rowValue(row, headers, "金额")), provider: textValue(rowValue(row, headers, "三方")),
      provider_reply: textValue(rowValue(row, headers, "三方回复"), 4000),
      utr_match: textValue(rowValue(row, headers, "UTR是否匹配")), kyc_correct: textValue(rowValue(row, headers, "KYC正确")),
      match_status: textValue(rowValue(row, headers, "对上")), status: textValue(rowValue(row, headers, "状态")),
      unreceived_days: numberValue(rowValue(row, headers, "未入款天数")), record_date: dateValue(rowValue(row, headers, "日期")),
      source_updated_at: collectedAt, updated_at: collectedAt,
    });
  }
  return rows;
}

export function createDepositIssueSyncHandler(runtime: Runtime) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== "POST") return json({ ok: false, code: "method_not_allowed" }, 405);
    if (!(await sameSecret(runtime.env("SYNC_SECRET") || "", request.headers.get("x-sync-secret") || "", runtime.crypto))) return json({ ok: false, code: "unauthorized" }, 401);
    let body: any = {}; try { body = await request.json(); } catch { return json({ ok: false, code: "invalid_sync_request" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || body.action !== "sync") return json({ ok: false, code: "invalid_sync_request" }, 400);
    try {
      const settings = config(runtime), collectedAt = new Date(runtime.now()).toISOString();
      const assertionValue = await assertion(settings, runtime);
      const token = await requestJson(runtime, "https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: assertionValue }).toString() }, 64 * 1024);
      if (typeof token?.access_token !== "string" || !token.access_token) throw new SyncError("google_source_unavailable");
      const range = encodeURIComponent(`${SHEET_TAB}!A1:N${MAX_ROWS + 1}`);
      const sourceUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(settings.sourceId)}/values/${range}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`;
      const source = await requestJson(runtime, sourceUrl, { method: "GET", headers: { Authorization: "Bearer " + token.access_token, Accept: "application/json" } }, MAX_RESPONSE_BYTES);
      const rows = rowsFromValues(source?.values, settings.sourceId, collectedAt);
      let written = 0;
      for (let at = 0; at < rows.length; at += 500) {
        const batch = rows.slice(at, at + 500);
        await requestJson(runtime, settings.supabaseUrl + "/rest/v1/admin_deposit_issue_rows?on_conflict=source_sheet,source_tab,source_row", { method: "POST", headers: { apikey: settings.serviceKey, Authorization: "Bearer " + settings.serviceKey, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(batch) }, 128 * 1024);
        written += batch.length;
      }
      // A successful full read is the only point where stale rows can be
      // removed. If Google or an upsert fails, the previous complete set stays.
      const stale = settings.supabaseUrl + "/rest/v1/admin_deposit_issue_rows?source_sheet=eq." + encodeURIComponent(settings.sourceId) + "&source_tab=eq." + encodeURIComponent(SHEET_TAB) + "&updated_at=lt." + encodeURIComponent(collectedAt);
      await requestJson(runtime, stale, { method: "DELETE", headers: { apikey: settings.serviceKey, Authorization: "Bearer " + settings.serviceKey, Prefer: "return=minimal" } }, 64 * 1024);
      return json({ ok: true, action: "sync", source: settings.sourceId, tab: SHEET_TAB, rowsRead: rows.length, rowsWritten: written, collectedAt });
    } catch (error) {
      const code = error instanceof SyncError ? error.code : "deposit_issue_sync_failed";
      const status = error instanceof SyncError ? error.status : 503;
      return json({ ok: false, code }, status);
    }
  };
}
const deno = (globalThis as unknown as { Deno?: { env: { get: (name: string) => string | undefined }; serve: (handler: (request: Request) => Promise<Response>) => unknown } }).Deno;
if (deno) deno.serve(createDepositIssueSyncHandler({ env: name => deno.env.get(name), fetch, now: Date.now, crypto }));
