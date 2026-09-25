// Mirror the safe columns from the reconciliation result and platform follow-up sheets.
// The private admin page reads Supabase; it never calls Google directly.
const DEFAULT_SOURCE_ID = "1Y110H-E0ny6Yj6ZEhn7tRLgCuRrSE5iDeFwaZ8-aCqg";
const SHEET_TAB = "UPI核对";
const DEFAULT_ENTRY_SOURCE_ID = "1UBnMj2JS4eDfT-gdE-flUVLWs387FgoR6Rw2baLYzoE";
const ENTRY_TABS = new Set(["SHREEWIN", "VEERGAME", "DHANIWIN", "91CLUB", "BIGMUMBAI", "TPPLAY", "INDIA82", "6CLUB", "OKWIN", "JALWA", "JAICLUB", "RAJALOTTERY", "51GAME", "55CLUB", "IN999", "LOTTERY77"]);
const MAX_ROWS = 40000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
const encoder = new TextEncoder();

type Runtime = { env: (name: string) => string | undefined; fetch: typeof fetch; now: () => number; crypto: Crypto };
type Settings = { sourceId: string; entrySourceId: string; email: string; privateKey: string; supabaseUrl: string; serviceKey: string };
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
  return { sourceId: sourceId(source), entrySourceId: sourceId(runtime.env("DEPOSIT_FOLLOWUP_SHEET_ID") || DEFAULT_ENTRY_SOURCE_ID), email, privateKey, supabaseUrl, serviceKey };
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
  const text = String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/\r\n?/g, "\n").trim(); return text ? text.slice(0, max) : null;
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
      platform, country: "印度", order_number: orderNumber, utr: textValue(rowValue(row, headers, "UTR")),
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

// Platform tabs have some historical header spelling differences. Resolve only
// known columns; never ingest UPI/KYC payment addresses or member identifiers.
function entryRowsFromValues(values: unknown[][], sourceSheet: string, tab: string, gid: number, collectedAt: string): Record<string, unknown>[] {
  if (!Array.isArray(values) || !Array.isArray(values[0])) throw new SyncError("entry_rows_missing", 502);
  const normalize = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  const headers = new Map<string, number>(); values[0].forEach((value, i) => { const key = normalize(value); if (key && !headers.has(key)) headers.set(key, i); });
  for (const key of ["ORDER NUMBER", "AMOUNT", "THIRDPARTY", "STATUS", "MAIN THIRD PARTY REPLY"]) if (!headers.has(key)) throw new SyncError("entry_headers_missing", 502);
  if (values.length > MAX_ROWS) throw new SyncError("source_row_limit_reached", 413);
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < values.length; i++) {
    const row = Array.isArray(values[i]) ? values[i] : [];
    const get = (key: string) => rowValue(row, headers, key);
    const orderNumber = textValue(get("ORDER NUMBER"));
    if (!orderNumber) continue;
    const followupAt = textValue(get("MAIN THIRD PARTY FOLLOW UP DATE & TIME"));
    const dayFirst = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|\s)/.exec(followupAt || "");
    const followupDate = dayFirst ? dateValue(`${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}`) : dateValue(followupAt);
    rows.push({ id: `${sourceSheet}:${tab}:${i + 1}`, source_sheet: sourceSheet, source_tab: tab, source_gid: gid, source_row: i + 1,
      country: "印度", platform: tab, order_number: orderNumber, work_order_number: textValue(get("WORK ORDER NUMBER")),
      utr: textValue(get(headers.has("UTR NUMBER") ? "UTR NUMBER" : "UTR NUMMBER")),
      amount: numberValue(get("AMOUNT")), provider: textValue(get("THIRDPARTY")),
      provider_reply: textValue(get("MAIN THIRD PARTY REPLY"), 4000), followup_status: textValue(get("STATUS")),
      utr_match: textValue(get("UTR MATCHED")), kyc_correct: textValue(get("KYC记录正确")),
      evidence: textValue(get("PDF/VIDEO"), 2000), followup_at: followupAt, followup_date: followupDate,
      receipt_text: textValue(get("RECEIPT DATE")), source_updated_at: collectedAt, updated_at: collectedAt });
  }
  return rows;
}
async function readEntrySheets(settings: Settings, runtime: Runtime, headers: Record<string, string>, collectedAt: string): Promise<{rows: Record<string, unknown>[]; tabs: string[]}> {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(settings.entrySourceId)}`;
  const metadata = await requestJson(runtime, base + "?fields=sheets.properties", { method: "GET", headers }, 256 * 1024);
  const tabs = (Array.isArray(metadata?.sheets) ? metadata.sheets : []).map((s: any) => s?.properties).filter((p: any) => p && !p.hidden && ENTRY_TABS.has(p.title) && Number.isSafeInteger(p.sheetId));
  // An incomplete workbook read must never remove the previous complete mirror.
  if (tabs.length !== ENTRY_TABS.size || new Set(tabs.map((t: any) => t.title)).size !== ENTRY_TABS.size) throw new SyncError("entry_tabs_incomplete", 502);
  const rows: Record<string, unknown>[] = [];
  for (let at = 0; at < tabs.length; at += 4) {
    const group = tabs.slice(at, at + 4), query = new URLSearchParams({ valueRenderOption: "FORMATTED_VALUE", majorDimension: "ROWS" });
    group.forEach((t: any) => query.append("ranges", `'${t.title}'!A1:P${MAX_ROWS + 1}`));
    const data = await requestJson(runtime, base + "/values:batchGet?" + query, { method: "GET", headers }, MAX_RESPONSE_BYTES);
    if (!Array.isArray(data?.valueRanges) || data.valueRanges.length !== group.length) throw new SyncError("entry_tabs_incomplete", 502);
    data.valueRanges.forEach((r: any, i: number) => rows.push(...entryRowsFromValues(r.values, settings.entrySourceId, group[i].title, group[i].sheetId, collectedAt)));
    if (rows.length > MAX_ROWS) throw new SyncError("source_row_limit_reached", 413);
  }
  return { rows, tabs: tabs.map((t: any) => t.title) };
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
      if (!Array.isArray(source?.values) || source.values.length > MAX_ROWS) throw new SyncError("source_row_limit_reached", 413);
      const rows = rowsFromValues(source.values, settings.sourceId, collectedAt);
      const entries = await readEntrySheets(settings, runtime, { Authorization: "Bearer " + token.access_token, Accept: "application/json" }, collectedAt);
      const targets = [{ table: "admin_deposit_issue_rows", rows, source: settings.sourceId, tab: SHEET_TAB },
        { table: "admin_deposit_followup_rows", rows: entries.rows, source: settings.entrySourceId, tab: null }];
      const databaseHeaders = { apikey: settings.serviceKey, Authorization: "Bearer " + settings.serviceKey };
      // Read and validate both sources before writing. Failed writes never delete
      // old rows; cleanup starts only after both complete mirrors are persisted.
      for (const target of targets) for (let at = 0; at < target.rows.length; at += 500) {
        await requestJson(runtime, settings.supabaseUrl + "/rest/v1/" + target.table + "?on_conflict=source_sheet,source_tab,source_row", { method: "POST", headers: { ...databaseHeaders, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(target.rows.slice(at, at + 500)) }, 128 * 1024);
      }
      for (const target of targets) {
        const stale = settings.supabaseUrl + "/rest/v1/" + target.table + "?source_sheet=eq." + encodeURIComponent(target.source) + (target.tab ? "&source_tab=eq." + encodeURIComponent(target.tab) : "") + "&updated_at=lt." + encodeURIComponent(collectedAt);
        await requestJson(runtime, stale, { method: "DELETE", headers: { ...databaseHeaders, Prefer: "return=minimal" } }, 64 * 1024);
      }
      return json({ ok: true, action: "sync", source: settings.sourceId, tab: SHEET_TAB, rowsRead: rows.length, rowsWritten: rows.length, entryRows: entries.rows.length, entryTabs: entries.tabs.length, collectedAt });
    } catch (error) {
      const code = error instanceof SyncError ? error.code : "deposit_issue_sync_failed";
      const status = error instanceof SyncError ? error.status : 503;
      return json({ ok: false, code }, status);
    }
  };
}
const deno = (globalThis as unknown as { Deno?: { env: { get: (name: string) => string | undefined }; serve: (handler: (request: Request) => Promise<Response>) => unknown } }).Deno;
if (deno) deno.serve(createDepositIssueSyncHandler({ env: name => deno.env.get(name), fetch, now: Date.now, crypto }));
