import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  readSupabaseAutoWithdraw,
  readSupabaseHomeStatus,
  readSupabaseThirdPartyRates,
  readSupabaseThirdPartySyncStatus,
  readSupabaseThirdPartyVolume,
  readSupabaseWorkOrderMonths,
} from "./lib/supabaseDashboardServer.ts";
import {
  DashboardDataAccessError,
  dashboardDataErrorResponse,
  dashboardAllowedRows,
  requireDashboardAllData,
  requireDashboardDataAccess,
  scopeCustomerServicePayload,
  type DashboardBusinessModule,
} from "./lib/dashboardDataAccessServer.ts";
import { buildCustomerServicePayload } from "./lib/parseCustomerService.ts";
import { anomalyDateRange, buildProviderAnomalyResponse } from "./lib/providerAnomalies.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const PRIVATE_HEADERS = {
  ...CORS_HEADERS,
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "Content-Type": "application/json; charset=utf-8",
  Vary: "Authorization, Origin, Accept-Encoding",
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: PRIVATE_HEADERS });
}

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  headers.delete("etag");
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

function requiredEnv(name: string): string {
  const value = String(Deno.env.get(name) || "").trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function isoDate(value: string): string {
  return /^20\d{2}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function defaultDate(): string {
  return addDays(new Date().toISOString().slice(0, 10), -1);
}

function monthKeys(start: string, end: string): string[] {
  const first = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  const last = new Date(`${end.slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime()) || first > last) return [];
  const result: string[] = [];
  while (first <= last && result.length < 24) {
    result.push(`${first.getUTCFullYear()}_${String(first.getUTCMonth() + 1).padStart(2, "0")}`);
    first.setUTCMonth(first.getUTCMonth() + 1);
  }
  return result;
}

function requestRange(url: URL): {start: string; end: string} {
  const fallback = defaultDate();
  const start = isoDate(url.searchParams.get("start") || url.searchParams.get("startDate") || "") || fallback;
  const end = isoDate(url.searchParams.get("end") || url.searchParams.get("endDate") || "") || start;
  if (start > end) throw new DashboardDataAccessError(400, "invalid_range", "开始日期不能晚于结束日期。");
  return {start, end};
}

function apiRoute(url: URL): string {
  const route = String(url.searchParams.get("_route") || "").replace(/\/+$/, "");
  if (!route.startsWith("/api/")) throw new DashboardDataAccessError(400, "invalid_route", "业务接口地址无效。");
  return route;
}

async function postgrest(request: Request, path: string, init: RequestInit = {}): Promise<Response> {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")?.[1] || "";
  const base = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  const key = requiredEnv("SUPABASE_ANON_KEY");
  return await fetch(base + path, {...init, headers: {...Object.fromEntries(new Headers(init.headers)), apikey: key,
    Authorization: `Bearer ${token}`, Accept: "application/json"}, redirect: "error"});
}

async function readOriginalRateSheet(request: Request, url: URL): Promise<Response> {
  const access = await requireDashboardDataAccess(request, "third_party");
  requireDashboardAllData(access);
  const inputs = url.searchParams.getAll("sheetId");
  const raw = inputs[0] ?? null;
  if (inputs.length > 1 || (raw !== null && (!/^(0|[1-9]\d{0,9})$/.test(raw) || Number(raw) > 2147483647))) {
    throw new DashboardDataAccessError(400, "invalid_original_sheet_request", "原表页签参数无效。");
  }
  const response = await postgrest(request, "/rest/v1/rpc/dashboard_original_rate_sheet", {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({p_sheet_id: raw === null ? null : Number(raw)}),
  });
  if (response.status === 401) throw new DashboardDataAccessError(401, "login_required", "登录已失效，请重新登录。");
  if (response.status === 403) throw new DashboardDataAccessError(403, "data_denied", "当前账号没有此数据查看权限。");
  if (!response.ok) throw new DashboardDataAccessError(503, "original_sheet_unavailable", "原表快照读取暂时不可用，请稍后重试。");
  const data = await response.json();
  if (data === null) throw new DashboardDataAccessError(raw === null ? 503 : 404,
    raw === null ? "original_sheet_snapshot_not_synced" : "original_sheet_not_found",
    raw === null ? "原表快照尚未同步，请稍后重试。" : "此原表页签不存在或快照尚未同步。");
  return json(data);
}

type GoogleToken = {value: string; expiresAt: number};
let googleToken: GoogleToken | null = null;

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function privateKeyBytes(pem: string): Uint8Array {
  const body = pem.replace(/^"|"$/g, "").replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function googleAccessToken(): Promise<string> {
  if (googleToken && googleToken.expiresAt > Date.now() + 60_000) return googleToken.value;
  const email = requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const key = await crypto.subtle.importKey("pkcs8", privateKeyBytes(requiredEnv("GOOGLE_PRIVATE_KEY")),
    {name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"}, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const head = base64url(JSON.stringify({alg: "RS256", typ: "JWT"}));
  const claims = base64url(JSON.stringify({iss: email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600}));
  const unsigned = `${head}.${claims}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion})});
  if (!response.ok) throw new Error("google_auth_failed");
  const result = await response.json();
  if (!result?.access_token) throw new Error("google_auth_failed");
  googleToken = {value: String(result.access_token), expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000};
  return googleToken.value;
}

async function googleJson(url: string, token: string): Promise<any> {
  const response = await fetch(url, {headers: {Authorization: `Bearer ${token}`, Accept: "application/json"}});
  if (!response.ok) throw new Error(`google_${response.status}`);
  return await response.json();
}

function sheetMatchesMonth(name: string, months: string[]): boolean {
  const normalized = name.replace(/[年/.\-]/g, "_").replace(/月/g, "");
  return months.some(month => normalized.includes(month) || normalized.includes(month.replace(/^\d{4}_/, "")));
}

function customerSummary(rows: any[]) {
  const distinct = (key: string) => new Set(rows.map(row => row[key]).filter(Boolean)).size;
  return {rows: rows.length, sheets: new Set(rows.map(row => row.sheetName).filter(Boolean)).size,
    countries: distinct("country"), platforms: distinct("platform"), staff: distinct("staff"), teams: distinct("team"),
    metricTotal: rows.reduce((sum, row) => sum + Number(row.metricValue || 0), 0)};
}

async function readCustomerService(request: Request, url: URL): Promise<Response> {
  const access = await requireDashboardDataAccess(request, "customer_service");
  const {start, end} = requestRange(url);
  const token = await googleAccessToken();
  const spreadsheetId = String(Deno.env.get("CUSTOMER_SERVICE_SHEET_ID") || "1-vvfQq7Sys9rBWvu2X9JauZ6wtMQcn2Oz3OTb65LlkE").trim();
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  const metadata = await googleJson(`${base}?fields=properties(title),sheets(properties(title,hidden,sheetType))`, token);
  const allNames = (metadata?.sheets || []).map((sheet: any) => sheet?.properties)
    .filter((item: any) => item?.title && item.hidden !== true && (!item.sheetType || item.sheetType === "GRID"))
    .map((item: any) => String(item.title));
  const months = monthKeys(start, end);
  const matching = allNames.filter((name: string) => sheetMatchesMonth(name, months));
  const targets = (matching.length ? matching : allNames).slice(0, 64);
  const values: Record<string, string[][]> = {};
  for (let offset = 0; offset < targets.length; offset += 4) {
    await Promise.all(targets.slice(offset, offset + 4).map(async (name: string) => {
      const range = `'${name.replace(/'/g, "''")}'!A1:ZZ20000`;
      const data = await googleJson(`${base}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`, token);
      values[name] = Array.isArray(data?.values) ? data.values : [];
    }));
  }
  const payload = buildCustomerServicePayload(values);
  const rows = dashboardAllowedRows(access, payload.rows.filter(row => !row.date || (row.date >= start && row.date <= end)));
  const filtered = {...payload, rows, summary: customerSummary(rows), meta: {...payload.meta,
    year: start.slice(0, 4), month: String(Number(start.slice(5, 7))), updatedAt: new Date().toISOString(),
    message: `Supabase Edge Function 直读客服表：${start} 至 ${end}`}};
  return json(access.scope.mode === "all" ? filtered : scopeCustomerServicePayload(access, filtered));
}

async function monthlyStatus(request: Request, url: URL): Promise<Response> {
  const map: Record<string, {module: DashboardBusinessModule; table: string; field: string}> = {
    "auto-withdraw": {module: "auto_withdraw", table: "auto_withdraw_daily", field: "updated_at"},
    "work-orders": {module: "work_orders", table: "workorder_daily_bundle", field: "source_updated_at"},
    "third-party-volume": {module: "third_party", table: "third_party_volume", field: "updated_at"},
    "customer-service": {module: "customer_service", table: "", field: ""},
  };
  const key = String(url.searchParams.get("module") || "");
  const item = map[key];
  if (!item) throw new DashboardDataAccessError(400, "invalid_module", "无效模块。");
  await requireDashboardDataAccess(request, item.module);
  let version = key === "customer-service" ? "google-live" : "";
  if (item.table) {
    const response = await postgrest(request, `/rest/v1/${item.table}?select=${item.field}&order=${item.field}.desc&limit=1`);
    if (response.ok) {
      const rows = await response.json();
      version = String(rows?.[0]?.[item.field] || "");
    }
  }
  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}_${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return json({ok: true, module: key, currentMonth, settlingMonth: null, preferredMonth: currentMonth,
    version, checkedAt: new Date().toISOString(), changedAt: version || null, rows: version ? 1 : 0, status: "current"});
}

async function handle(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", {headers: CORS_HEADERS});
  if (request.method !== "GET") return json({ok: false, code: "method_not_allowed", message: "仅支持 GET 请求。"}, 405);
  const url = new URL(request.url);
  const route = apiRoute(url);
  if (route === "/api/provider-anomalies") {
    await requireDashboardDataAccess(request, "third_party");
    const start = url.searchParams.get("startDate") || "", end = url.searchParams.get("endDate") || "";
    try { anomalyDateRange(start, end); }
    catch { throw new DashboardDataAccessError(400, "invalid_range", "请选择最多31天的有效日期范围。"); }
    const response = await postgrest(request, "/rest/v1/rpc/dashboard_provider_anomaly_inputs", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({p_start: start, p_end: end}), signal: AbortSignal.timeout(20000),
    });
    if (response.status === 401) throw new DashboardDataAccessError(401, "login_required", "登录已失效，请重新登录。");
    if (response.status === 403) throw new DashboardDataAccessError(403, "data_denied", "当前账号没有此数据查看权限。");
    if (!response.ok) throw new DashboardDataAccessError(503, "anomaly_data_unavailable", "异常数据接口暂未就绪，不能据此判断正常或异常。");
    return json(buildProviderAnomalyResponse(await response.json(), start, end));
  }
  if (route === "/api/auto-withdraw") {
    const {start, end} = requestRange(url);
    return json(await readSupabaseAutoWithdraw(request, start, end));
  }
  if (route === "/api/work-orders") {
    const {start, end} = requestRange(url);
    return json(await readSupabaseWorkOrderMonths(request, monthKeys(start, end)));
  }
  if (route === "/api/customer-service") return await readCustomerService(request, url);
  if (route === "/api/supabase-third-party-volume") {
    const {start, end} = requestRange(url);
    return json(await readSupabaseThirdPartyVolume(request, start, end, url.searchParams.get("country") || ""));
  }
  if (route === "/api/supabase-third-party-rates") return json(await readSupabaseThirdPartyRates(request));
  if (route === "/api/supabase-third-party-sync-status") {
    const {start, end} = requestRange(url);
    return json(await readSupabaseThirdPartySyncStatus(request, start, end));
  }
  if (route === "/api/supabase-status") return json(await readSupabaseHomeStatus(request));
  if (route === "/api/original-rate-sheet") return await readOriginalRateSheet(request, url);
  if (route === "/api/monthly-status") return await monthlyStatus(request, url);
  throw new DashboardDataAccessError(404, "route_not_found", "业务接口不存在。");
}

Deno.serve(async request => {
  try { return cors(await handle(request)); }
  catch (error) { return cors(dashboardDataErrorResponse(error)); }
});
