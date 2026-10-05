// Mirror the safe columns from the reconciliation result and platform follow-up sheets.
// The private admin page reads Supabase; it never calls Google directly.
const DEFAULT_SOURCE_ID = "1Y110H-E0ny6Yj6ZEhn7tRLgCuRrSE5iDeFwaZ8-aCqg";
const SHEET_TAB = "UPI核对";
const DEFAULT_ENTRY_SOURCE_ID = "1o0nhJfztjVX9gNwH43uPWg5BUuhBxDMZ-_WUWdRd588";
const HISTORICAL_ENTRY_SOURCE_ID = "1UBnMj2JS4eDfT-gdE-flUVLWs387FgoR6Rw2baLYzoE";
const ENTRY_TABS = new Set(["SHREEWIN", "VEERGAME", "DHANIWIN", "91CLUB", "BIGMUMBAI", "TPPLAY", "INDIA82", "6CLUB", "OKWIN", "JALWA", "JAICLUB", "RAJALOTTERY", "51GAME", "55CLUB", "IN999", "LOTTERY77"]);
// The October workbook adds 9KCLUB. Mirroring that exact tab does not create a
// platform mapping or grant its records to any account's scope.
const CURRENT_ENTRY_TABS = new Set([...ENTRY_TABS, "9KCLUB"]);
const MAX_ROWS = 40000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
const encoder = new TextEncoder();

type Runtime = { env: (name: string) => string | undefined; fetch: typeof fetch; now: () => number; crypto: Crypto };
type Settings = { sourceId: string; entrySourceId: string; entrySourceMigrated: boolean; email: string; privateKey: string; supabaseUrl: string; serviceKey: string };
type SyncStage = "configuration" | "token" | "result_read" | "entry_metadata" | "entry_read" | "db_upsert" | "db_archive" | "complete";
type MirrorTarget = { table: string; rows: Record<string, unknown>[]; source: string; tabs: string[] };
type SourceResult = { ok: boolean; stage: SyncStage; code?: string; rowsRead: number; rowsWritten: number; tabsRead: number; syncedAt?: string };
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
  const configuredEntrySource = sourceId(runtime.env("DEPOSIT_FOLLOWUP_SHEET_ID") || DEFAULT_ENTRY_SOURCE_ID);
  // The owner moved the active follow-up workbook to October. Treat only the
  // known legacy ID (including its Google URL form) as a retired configuration;
  // unrelated custom source IDs retain their existing override behavior.
  const entrySourceMigrated = configuredEntrySource === HISTORICAL_ENTRY_SOURCE_ID;
  const entrySourceId = entrySourceMigrated ? DEFAULT_ENTRY_SOURCE_ID : configuredEntrySource;
  return { sourceId: sourceId(source), entrySourceId, entrySourceMigrated, email, privateKey, supabaseUrl, serviceKey };
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
// Preserve exactly these owner-authorized columns, including masking and '-'.
// Validation for a new portal address must never erase a historical cell.
function upiValue(value: unknown): string | null { return textValue(value, 500); }
function rowValue(row: unknown[], headers: Map<string, number>, name: string): unknown { const index = headers.get(name); return index === undefined ? null : row[index]; }
function rowsFromValues(values: unknown[][], sourceSheet: string, collectedAt: string, derived: unknown[][] = []): Record<string, unknown>[] {
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
      upi_id: upiValue(rowValue(row, headers, "UPI")), kyc_upi_id: upiValue(rowValue(row, headers, "KYC-UPI")),
      amount: numberValue(rowValue(row, headers, "金额")), provider: textValue(rowValue(row, headers, "三方")),
      provider_reply: textValue(rowValue(row, headers, "三方回复"), 4000),
      utr_match: textValue(rowValue(row, headers, "UTR是否匹配")), kyc_correct: textValue(rowValue(row, headers, "KYC正确")),
      match_status: textValue(rowValue(row, headers, "对上")), status: textValue(rowValue(row, headers, "状态")),
      canonical_provider: textValue(derived[index]?.[0]), confirmation_status: textValue(derived[index]?.[1]),
      unreceived_days: numberValue(rowValue(row, headers, "未入款天数")), record_date: dateValue(rowValue(row, headers, "日期")),
      source_updated_at: collectedAt, updated_at: collectedAt, stale_at: null,
    });
  }
  return rows;
}

// Platform tabs have some historical header spelling differences. Resolve only
// known columns. UPI and KYC-UPI are explicitly authorized; member identifiers,
// phone numbers and bank-account columns remain excluded.
// The user-confirmed staff code is column L. Some tabs also label the member
// column A "ID NUMBER", so it must never be resolved by first matching header.
function entryRowsFromValues(values: unknown[][], sourceSheet: string, tab: string, gid: number, collectedAt: string): Record<string, unknown>[] {
  if (!Array.isArray(values) || !Array.isArray(values[0])) throw new SyncError("entry_rows_missing", 502);
  const normalize = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  const headers = new Map<string, number>(); values[0].forEach((value, i) => { const key = normalize(value); if (key && !headers.has(key)) headers.set(key, i); });
  const upiColumn = normalize(values[0][6]) === "UPI ID" ? 6 : null;
  const kycUpiColumn = normalize(values[0][7]) === "KYC-UPI ID" ? 7 : null;
  const staffColumn = normalize(values[0][11]) === "ID NUMBER" ? 11 : null;
  // P contains the original sheet's age/text value, despite its RECEIPT DATE
  // title. JAICLUB also gives O this title: preserve O separately, never treat
  // it as a follow-up timestamp or let its first header match replace P.
  const receiptColumn = normalize(values[0][15]) === "RECEIPT DATE" ? 15 : null;
  const sourceDateColumn = tab === "JAICLUB" && normalize(values[0][14]) === "RECEIPT DATE" ? 14 : null;
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
      upi_id: upiColumn === null ? null : upiValue(row[upiColumn]), kyc_upi_id: kycUpiColumn === null ? null : upiValue(row[kycUpiColumn]),
      amount: numberValue(get("AMOUNT")), provider: textValue(get("THIRDPARTY")),
      provider_reply: textValue(get("MAIN THIRD PARTY REPLY"), 4000), followup_status: textValue(get("STATUS")),
      utr_match: textValue(get("UTR MATCHED")), kyc_correct: textValue(get("KYC记录正确")),
      evidence: textValue(get("PDF/VIDEO"), 2000), followup_at: followupAt, followup_date: followupDate,
      staff_code: staffColumn === null ? null : textValue(row[staffColumn]),
      receipt_text: receiptColumn === null ? null : textValue(row[receiptColumn]),
      source_date_text: sourceDateColumn === null ? null : textValue(row[sourceDateColumn]),
      source_updated_at: collectedAt, updated_at: collectedAt, stale_at: null });
  }
  return rows;
}
async function readEntrySheets(settings: Settings, runtime: Runtime, headers: Record<string, string>, collectedAt: string, onStage: (stage: SyncStage) => void = () => {}): Promise<{rows: Record<string, unknown>[]; tabs: string[]}> {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(settings.entrySourceId)}`;
  onStage("entry_metadata");
  const metadata = await requestJson(runtime, base + "?fields=sheets.properties", { method: "GET", headers }, 256 * 1024);
  const expectedTabs = settings.entrySourceId === DEFAULT_ENTRY_SOURCE_ID ? CURRENT_ENTRY_TABS : ENTRY_TABS;
  const tabs = (Array.isArray(metadata?.sheets) ? metadata.sheets : []).map((s: any) => s?.properties).filter((p: any) => p && !p.hidden && expectedTabs.has(p.title) && Number.isSafeInteger(p.sheetId));
  // An incomplete workbook read must never remove the previous complete mirror.
  if (tabs.length !== expectedTabs.size || new Set(tabs.map((t: any) => t.title)).size !== expectedTabs.size) throw new SyncError("entry_tabs_incomplete", 502);
  const rows: Record<string, unknown>[] = [];
  onStage("entry_read");
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
    let stage: SyncStage = "configuration";
    try {
      const settings = config(runtime), collectedAt = new Date(runtime.now()).toISOString();
      stage = "token";
      const assertionValue = await assertion(settings, runtime);
      const token = await requestJson(runtime, "https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: assertionValue }).toString() }, 64 * 1024);
      if (typeof token?.access_token !== "string" || !token.access_token) throw new SyncError("google_source_unavailable");
      const databaseHeaders = { apikey: settings.serviceKey, Authorization: "Bearer " + settings.serviceKey };
      const googleHeaders = { Authorization: "Bearer " + token.access_token, Accept: "application/json" };
      // Two independent workbook snapshots. Each worker validates its complete
      // source before writing, then archives only that source. One slow/failed
      // workbook cannot stop the other from refreshing. Within each worker all
      // requests remain sequential: at most two requests are in flight, no retries.
      async function mirror(read: (onStage: (value: SyncStage) => void) => Promise<MirrorTarget>, firstStage: SyncStage) {
        const result: SourceResult = { ok: false, stage: firstStage, rowsRead: 0, rowsWritten: 0, tabsRead: 0 };
        try {
          const target = await read(value => { result.stage = value; });
          result.rowsRead = target.rows.length; result.tabsRead = target.tabs.length;
          result.stage = "db_upsert";
          for (let at = 0; at < target.rows.length; at += 500) {
            const chunk = target.rows.slice(at, at + 500);
            await requestJson(runtime, settings.supabaseUrl + "/rest/v1/" + target.table + "?on_conflict=source_sheet,source_tab,source_row", { method: "POST", headers: { ...databaseHeaders, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(chunk) }, 128 * 1024);
            result.rowsWritten += chunk.length;
          }
          result.stage = "db_archive";
          for (const tab of target.tabs) {
            // Historical workbooks are never rescanned or archived. This exact
            // source/tab scope also protects portal rows and newer overlapping runs.
            const filters = new URLSearchParams({ source_sheet: "eq." + target.source, source_tab: "eq." + tab,
              updated_at: "lt." + collectedAt, stale_at: "is.null" });
            if (target.table === "admin_deposit_followup_rows") filters.set("source_kind", "eq.sheet");
            await requestJson(runtime, settings.supabaseUrl + "/rest/v1/" + target.table + "?" + filters,
              { method: "PATCH", headers: { ...databaseHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
                body: JSON.stringify({ stale_at: collectedAt }) }, 64 * 1024);
          }
          result.ok = true; result.stage = "complete"; result.syncedAt = collectedAt;
          return { result, status: 200 };
        } catch (error) {
          result.code = error instanceof SyncError ? error.code : "deposit_issue_sync_failed";
          return { result, status: error instanceof SyncError ? error.status : 503 };
        }
      }
      const [resultMirror, entryMirror] = await Promise.all([
        mirror(async () => {
          // Keep the result columns in one bounded snapshot. AV:BC (including
          // member IDs) remains outside the authorized projection.
          const ranges = [`${SHEET_TAB}!A1:N${MAX_ROWS + 1}`, `${SHEET_TAB}!AB1:AB${MAX_ROWS + 1}`, `${SHEET_TAB}!AS1:AS${MAX_ROWS + 1}`];
          const params = new URLSearchParams({ valueRenderOption: "FORMATTED_VALUE", majorDimension: "ROWS" });
          for (const range of ranges) params.append("ranges", range);
          const sourceUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(settings.sourceId)}/values:batchGet?${params}`;
          const batch = await requestJson(runtime, sourceUrl, { method: "GET", headers: googleHeaders }, MAX_RESPONSE_BYTES);
          if (!Array.isArray(batch?.valueRanges) || batch.valueRanges.length !== 3) throw new SyncError("source_columns_incomplete", 502);
          const source = batch.valueRanges[0];
          if (!Array.isArray(source?.values) || source.values.length > MAX_ROWS) throw new SyncError("source_row_limit_reached", 413);
          const derived = source.values.map((_: unknown, index: number) => [batch.valueRanges[1]?.values?.[index]?.[0], batch.valueRanges[2]?.values?.[index]?.[0]]);
          return { table: "admin_deposit_issue_rows", rows: rowsFromValues(source.values, settings.sourceId, collectedAt, derived), source: settings.sourceId, tabs: [SHEET_TAB] };
        }, "result_read"),
        mirror(async onStage => {
          const entries = await readEntrySheets(settings, runtime, googleHeaders, collectedAt, onStage);
          return { table: "admin_deposit_followup_rows", rows: entries.rows, source: settings.entrySourceId, tabs: entries.tabs };
        }, "entry_metadata"),
      ]);
      const ok = resultMirror.result.ok && entryMirror.result.ok;
      const failures = [resultMirror, entryMirror].filter(value => !value.result.ok);
      const code = ok ? undefined : failures.length === 1 ? "deposit_issue_sync_partial" : failures[0].result.code === failures[1].result.code ? failures[0].result.code : "deposit_issue_sync_failed";
      return json({ ok, ...(code ? { code } : {}), action: "sync", source: settings.sourceId, tab: SHEET_TAB,
        rowsRead: resultMirror.result.rowsRead, rowsWritten: resultMirror.result.rowsWritten,
        entrySource: settings.entrySourceId, entrySourceRole: "current", entrySourceMigrated: settings.entrySourceMigrated,
        historicalEntrySources: [{ source: HISTORICAL_ENTRY_SOURCE_ID, role: "historical", sync: false }],
        entryRows: entryMirror.result.rowsRead, entryTabs: entryMirror.result.tabsRead, collectedAt,
        sourceResults: { result: resultMirror.result, entries: entryMirror.result } }, ok ? 200 : failures[0].status);
    } catch (error) {
      const code = error instanceof SyncError ? error.code : "deposit_issue_sync_failed";
      const status = error instanceof SyncError ? error.status : 503;
      const notStarted: SourceResult = { ok: false, stage, code, rowsRead: 0, rowsWritten: 0, tabsRead: 0 };
      return json({ ok: false, code, sourceResults: { result: notStarted, entries: notStarted } }, status);
    }
  };
}
const deno = (globalThis as unknown as { Deno?: { env: { get: (name: string) => string | undefined }; serve: (handler: (request: Request) => Promise<Response>) => unknown } }).Deno;
if (deno) deno.serve(createDepositIssueSyncHandler({ env: name => deno.env.get(name), fetch, now: Date.now, crypto }));
