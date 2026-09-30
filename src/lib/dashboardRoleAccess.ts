"use client";
import { ensureDashboardSession, type DashboardSession } from "./dashboardAuthClient";
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
    || !Array.isArray(v.permissions) || v.permissions.some(key => typeof key !== "string" || !codes.has(key) && !retiredCodes.has(key))
    || (v.mode === "assigned" && (typeof v.roleId !== "string" || !/^[0-9a-f-]{36}$/i.test(v.roleId)))
    || (v.roleName !== null && typeof v.roleName !== "string")) throw Error("角色权限响应不完整，请重新验证。");
  const permissions = v.permissions.filter(key => !retiredCodes.has(key));
  return {...v, permissions, canView: v.canView && (v.mode !== "assigned" || permissions.some(key => key.endsWith(".view")))};
}
export function dashboardRoleAllows(access: DashboardRoleAccess | null | undefined, page: string, action = "view"): boolean {
  return page !== "channelquality" && !!access && access.canView && (access.mode !== "assigned"
    || access.permissions.includes(page + ".view") && access.permissions.includes(page + "." + action));
}
export async function readDashboardRoleAccess(session: DashboardSession, signal?: AbortSignal): Promise<DashboardRoleAccess> {
  const current = await ensureDashboardSession(session);
  if (current.user.id !== session.user.id) throw Error("当前登录账号已改变");
  const base = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const url = new URL(base);
  if (url.protocol !== "https:" || url.origin !== base) throw Error("后台地址配置无效");
  const response = await fetch(base + "/rest/v1/rpc/dashboard_role_access", {method: "POST", body: "{}", signal,
    cache: "no-store", redirect: "error", credentials: "omit", headers: {Authorization: `Bearer ${current.access_token}`,
      apikey: String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""), "Content-Type": "application/json"}});
  if (!response.ok) throw Error([401, 403].includes(response.status) ? "角色权限验证未通过，请重新登录或联系管理员。" : "角色权限暂时无法读取，请重试。");
  return validateDashboardRoleAccess(await response.json());
}
