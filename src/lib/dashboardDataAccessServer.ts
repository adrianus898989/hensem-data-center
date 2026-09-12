import { NextResponse } from "next/server";
import { dashboardScopeAllows, effectiveDashboardDataScope, type DashboardDataScope } from "./dashboardDataScope";
import { withPlatformDisplayCountry } from "./platformDisplayCountry";
import type { AutoWithdrawPayload, CustomerServicePayload, WorkOrderPayload } from "./types";

export type DashboardBusinessModule = "home" | "third_party" | "auto_withdraw" | "work_orders" | "customer_service";
export type DashboardAccessProfile = {
  auth_user_id: string; username: string; role: "owner" | "admin" | "viewer"; active: boolean;
  permissions?: Record<string, boolean> | null; management_permissions?: Record<string, boolean> | null;
  data_scope?: unknown; updated_at?: string;
};
export type DashboardDataAccess = { token: string; profile: DashboardAccessProfile; scope: DashboardDataScope };

export class DashboardDataAccessError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export function dashboardPrivateHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    "Netlify-CDN-Cache-Control": "private, no-store",
    "CDN-Cache-Control": "private, no-store",
    Vary: "Authorization, Cookie, Accept-Encoding",
  };
}
export function dashboardPrivateResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(dashboardPrivateHeaders())) headers.set(key, value);
  headers.delete("ETag");
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}
export function dashboardDataErrorResponse(error: unknown): Response {
  const known = error instanceof DashboardDataAccessError;
  return NextResponse.json({ok: false, code: known ? error.code : "data_unavailable",
    message: known ? error.message : "数据读取暂时不可用，请稍后重试。"}, {
    status: known ? error.status : 503, headers: dashboardPrivateHeaders(),
  });
}
export function dashboardModuleAllowed(profile: DashboardAccessProfile, module: DashboardBusinessModule): boolean {
  if (profile.active !== true) return false;
  if (profile.role === "owner" || module === "home") return true;
  // Match the database dashboard_has_permission rule. Client display defaults
  // must never turn an absent grant into server-side data access.
  return profile.permissions?.[module] === true;
}
export function requireDashboardModule(access: DashboardDataAccess, module: DashboardBusinessModule): void {
  if (!dashboardModuleAllowed(access.profile, module)) throw new DashboardDataAccessError(403, "module_denied", "当前账号没有此模块查看权限。");
}
export function requireDashboardAllData(access: DashboardDataAccess): void {
  if (access.scope.mode !== "all") throw new DashboardDataAccessError(403, "global_status_denied", "当前账号仅可查看授权范围，不提供全局同步状态。");
}
export function requireDashboardOwner(access: DashboardDataAccess): void {
  if (access.profile.role !== "owner") throw new DashboardDataAccessError(403, "owner_required", "此诊断入口仅向总管理员开放。");
}
export function requireDashboardRefresh(access: DashboardDataAccess): void {
  requireDashboardAllData(access);
  const enabled = access.profile.management_permissions?.refresh_data;
  if (access.profile.role !== "owner" && !(access.profile.role === "admin" && (enabled === undefined || enabled === true))) {
    throw new DashboardDataAccessError(403, "refresh_denied", "当前账号没有全局数据刷新权限。");
  }
}

// Cache only within the lifetime of this exact server Request, never by bearer,
// user, country, or URL across requests. Every new request reads a fresh profile.
const requestAccess = new WeakMap<Request, Promise<DashboardDataAccess>>();
async function verifyRequest(request: Request): Promise<DashboardDataAccess> {
  const match = /^Bearer ([^\s,]{1,16384})$/i.exec(request.headers.get("authorization") || "");
  if (!match) throw new DashboardDataAccessError(401, "login_required", "请先登录后读取数据。");
  const token = match[1];
  const base = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  let url: URL;
  try { url = new URL(base); } catch { throw new DashboardDataAccessError(503, "auth_unavailable", "登录验证暂时不可用。"); }
  if (!key || url.protocol !== "https:" || url.origin !== base || url.username || url.password) {
    throw new DashboardDataAccessError(503, "auth_unavailable", "登录验证暂时不可用。");
  }
  const read = async (path: string) => {
    const response = await fetch(base + path, {headers: {apikey: key, Authorization: `Bearer ${token}`, Accept: "application/json"}, cache: "no-store", redirect: "error", signal: request.signal});
    if (response.status === 401) throw new DashboardDataAccessError(401, "login_required", "登录已失效，请重新登录。");
    if (response.status === 403) throw new DashboardDataAccessError(403, "profile_denied", "当前账号没有数据查看权限。");
    if (!response.ok) throw new DashboardDataAccessError(503, "auth_unavailable", "登录验证暂时不可用。");
    try { return await response.json(); } catch { throw new DashboardDataAccessError(503, "auth_unavailable", "登录验证暂时不可用。"); }
  };
  const user = await read("/auth/v1/user");
  if (!user || typeof user.id !== "string" || !user.id) throw new DashboardDataAccessError(401, "login_required", "登录验证未通过。");
  const query = new URLSearchParams({select: "auth_user_id,username,role,active,permissions,management_permissions,data_scope,updated_at", auth_user_id: `eq.${user.id}`, limit: "2"});
  const rows = await read(`/rest/v1/dashboard_profiles?${query}`);
  const profile = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (!profile || profile.auth_user_id !== user.id || profile.active !== true || !["owner", "admin", "viewer"].includes(profile.role)) {
    throw new DashboardDataAccessError(403, "profile_denied", "账号已停用或没有数据查看权限。");
  }
  return {token, profile, scope: effectiveDashboardDataScope(profile)};
}
export async function requireDashboardDataAccess(request: Request, module?: DashboardBusinessModule): Promise<DashboardDataAccess> {
  let pending = requestAccess.get(request);
  if (!pending) { pending = verifyRequest(request); requestAccess.set(request, pending); }
  const access = await pending;
  if (module) requireDashboardModule(access, module);
  return access;
}
export async function withDashboardDataAccess(request: Request, module: DashboardBusinessModule | undefined,
  run: (access: DashboardDataAccess) => Promise<Response>, options: {ownerOnly?: boolean; allDataOnly?: boolean} = {}): Promise<Response> {
  try {
    const access = await requireDashboardDataAccess(request, module);
    if (options.ownerOnly) requireDashboardOwner(access);
    if (options.allDataOnly) requireDashboardAllData(access);
    return dashboardPrivateResponse(await run(access));
  } catch (error) { return dashboardDataErrorResponse(error); }
}

export function dashboardAllowedRows<T extends {country?: unknown; platform?: unknown}>(access: DashboardDataAccess, rows: readonly T[]): T[] {
  return rows.filter(row => dashboardScopeAllows(access.scope, row.country, row.platform || ""));
}
function scopedMeta(meta: any) {
  // Do not forward global source IDs, checksums, counts, errors, sheet lists, or
  // arbitrary metadata from an unfiltered snapshot to a restricted account.
  return {year: /^20\d{2}$/.test(String(meta?.year)) ? String(meta.year) : "", month: /^(?:0?[1-9]|1[0-2])$/.test(String(meta?.month)) ? String(meta.month) : "", source: ["google-sheet", "demo", "supabase", "history+supabase"].includes(meta?.source) ? meta.source : "google-sheet",
    updatedAt: new Date().toISOString(), scopeFiltered: true,
    message: "仅显示当前账号授权范围；更新时间为本次权限过滤时间。"};
}
const distinct = (values: unknown[]) => new Set(values.filter(Boolean)).size;
const sum = <T>(rows: T[], key: keyof T) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
function knownFields<T extends object>(row: T, keys: readonly string[]): T {
  return Object.fromEntries(keys.filter(key => Object.prototype.hasOwnProperty.call(row, key)).map(key => [key, (row as Record<string, unknown>)[key]])) as T;
}
export function scopeAutoWithdrawPayload(access: DashboardDataAccess, payload: AutoWithdrawPayload): AutoWithdrawPayload {
  if (access.scope.mode === "all") return payload;
  const autoKeys = ["country", "platform", "total", "success", "rejected", "successRate", "rejectRate", "autoCount", "manualCount", "autoRate", "manualRate", "avgTime", "yesterdayAvgTime", "comparePercent", "sourceSheet", "previousDay", "date", "blockTitle"];
  const project = <T extends {country: string; platform: string}>(rows: T[], keys: string[]) => dashboardAllowedRows(access, rows).map(row => withPlatformDisplayCountry(knownFields(row, keys)));
  const cleanPrevious = <T extends {previousDay?: unknown}>(row: T): T => row.previousDay && typeof row.previousDay === "object"
    ? {...row, previousDay: knownFields(row.previousDay, ["date", "total", "success", "rejected", "autoCount", "manualCount"])} : row;
  const dailyRows = project(payload.dailyRows || [], autoKeys).map(cleanPrevious);
  const operatorRows = project(payload.operatorRows || [], ["country", "platform", "date", "account", "processed", "rejected", "avgTime", "yesterdayAvgTime", "comparePercent"]);
  const monthlyRows = project(payload.monthlyRows || [], autoKeys).map(cleanPrevious);
  return {meta: {...scopedMeta(payload.meta), rawDailyRows: dailyRows.length, rawOperatorRows: operatorRows.length}, dailyRows, monthlyRows, operatorRows};
}
export function scopeWorkOrderPayload(access: DashboardDataAccess, payload: WorkOrderPayload): WorkOrderPayload {
  if (access.scope.mode === "all") return payload;
  const rows = dashboardAllowedRows(access, payload.rows || []).map(row => withPlatformDisplayCountry(knownFields(row, ["id", "date", "country", "platform", "workType", "workName", "operator", "accountType", "total", "success", "failed", "pending", "amount", "status", "sourceSheet", "sourceRow", "kind"])));
  const sheets = [...new Set(rows.map(row => row.sourceSheet).filter(Boolean))];
  return {rows, anomalies: [], meta: {...scopedMeta(payload.meta), sheets}, summary: {
    total: sum(rows, "total"), success: sum(rows, "success"), failed: sum(rows, "failed"), pending: sum(rows, "pending"), amount: sum(rows, "amount"),
    countries: distinct(rows.map(row => row.country)), platforms: distinct(rows.map(row => row.platform)), types: distinct(rows.map(row => row.workType)),
    names: distinct(rows.map(row => row.workName)), operators: distinct(rows.map(row => row.operator)),
  }};
}
export function scopeCustomerServicePayload(access: DashboardDataAccess, payload: CustomerServicePayload): CustomerServicePayload {
  if (access.scope.mode === "all") return payload;
  const rows = dashboardAllowedRows(access, payload.rows || []).map(row => {
    const display = withPlatformDisplayCountry(knownFields(row, ["id", "sheetName", "sourceRow", "date", "country", "platform", "staff", "team", "metricName", "metricValue"]));
    // Both legacy fields and rawText may contain a whole source row, including
    // unrelated columns. A scoped response returns only this metric's value.
    const rawText = String(display.metricValue);
    return {...display, rawText, fields: {日期: display.date, 国家: display.country, 平台: display.platform, 员工: display.staff, 团队: display.team, [display.metricName]: rawText}};
  });
  const sheets = [...new Set(rows.map(row => row.sheetName).filter(Boolean))];
  return {rows, meta: {...scopedMeta(payload.meta), sheets, headers: []}, summary: {
    rows: rows.length, sheets: sheets.length, countries: distinct(rows.map(row => row.country)), platforms: distinct(rows.map(row => row.platform)),
    staff: distinct(rows.map(row => row.staff)), teams: distinct(rows.map(row => row.team)), metricTotal: sum(rows, "metricValue"),
  }};
}
