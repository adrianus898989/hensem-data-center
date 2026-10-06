"use client";
import { ownerPreviewTransportRead } from "./ownerPreviewVerification";
import { dashboardResponseError, ensureDashboardSession, type DashboardSession } from "./dashboardAuthClient";
import catalog from "./dashboardRoleCatalog.json";

export type DashboardRoleAccess = {
  mode: "owner" | "legacy" | "assigned";
  roleId: string | null;
  roleName: string | null;
  version: number;
  permissions: string[];
  canView: boolean;
};
const codes = new Set(catalog.pages.flatMap(page => page.actions.map(action => page.id + "." + action.id)));
const retiredCodes = new Set(["channelquality.view", "channelquality.query", "channelquality.detail", "channelquality.export"]);
export function validateDashboardRoleAccess(value: unknown): DashboardRoleAccess {
  const v = value as DashboardRoleAccess;
  if (!v || typeof v !== "object" || !["owner", "legacy", "assigned"].includes(v.mode)
    || typeof v.canView !== "boolean" || !Number.isSafeInteger(v.version) || v.version < 0
    || !Array.isArray(v.permissions) || v.permissions.length > 500
    || v.permissions.some(key => typeof key !== "string" || key.length > 160 || !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(key))
    || (v.mode === "assigned" && (typeof v.roleId !== "string" || !/^[0-9a-f-]{36}$/i.test(v.roleId)))
    || (v.roleName !== null && typeof v.roleName !== "string")) throw Error("角色权限响应不完整，请重新验证。");
  // During a rolling release the server may know newer permissions. Unknown
  // read keys grant nothing locally; role creation/assignment still uses the
  // separate strict catalog validator and the authoritative SQL gateway.
  const permissions = Array.from(new Set(v.permissions.filter(key => codes.has(key) && !retiredCodes.has(key))));
  return {...v, permissions, canView: v.canView && (v.mode !== "assigned" || permissions.some(key => key.endsWith(".view")))};
}
export function dashboardRoleAllows(access: DashboardRoleAccess | null | undefined, page: string, action = "view"): boolean {
  if(page === "collector_control")return !!access && access.canView && (access.mode === "owner" || access.mode === "assigned" && access.permissions.includes(page + ".view") && access.permissions.includes(page + "." + action));
  return page !== "channelquality" && !!access && access.canView && (!["success_analysis", "daily_comparison"].includes(page) || access.mode !== "legacy") && (access.mode !== "assigned"
    || access.permissions.includes(page + ".view") && access.permissions.includes(page + "." + action));
}
export async function readDashboardRoleAccess(session: DashboardSession, signal?: AbortSignal): Promise<DashboardRoleAccess> {
  const current = await ensureDashboardSession(session);
  if (current.user.id !== session.user.id) throw Error("当前登录账号已改变");
  const base = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const url = new URL(base);
  if (url.protocol !== "https:" || url.origin !== base) throw Error("后台地址配置无效");
  const response = await ownerPreviewTransportRead(() => fetch(base + "/rest/v1/rpc/dashboard_role_access", {method: "POST", body: "{}", signal,
    cache: "no-store", redirect: "error", credentials: "omit", headers: {Authorization: `Bearer ${current.access_token}`,
      apikey: String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""), "Content-Type": "application/json"}}), signal);
  if (!response.ok) {
    let payload: unknown; try { payload = await response.json(); } catch { payload = null; }
    const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const code = data.code === "42501" && data.message === "application_session_denied" ? "application_session_denied" : data.code;
    const fallback = [401, 403].includes(response.status) ? "角色权限验证未通过，请重新登录或联系管理员。" : "角色权限暂时无法读取，请重试。";
    throw dashboardResponseError(response.status, {code, message: fallback}, fallback);
  }
  return validateDashboardRoleAccess(await ownerPreviewTransportRead(() => response.json(), signal));
}
