"use client";
import { APPLICATION_GATEWAY, ensureDashboardSession, type DashboardSession } from "./dashboardAuthClient";

export type AccountSurface = "workorder" | "dashboard";
export type SecurityPolicy = { failure_limit: number; ip_enabled: boolean; version: number };
export type IpRule = { id: string | number; network: string; note: string; active: boolean; version: number };
export type AccountIpRule = { id: string | number; network: string; note: string; active: boolean };
export type AccountSecurityState = { ip_mode: "inherit" | "allowlist"; ip_rules: AccountIpRule[]; user_id?: string; failed_count: number; failure_limit: number | null; locked: boolean; locked_at: string | null; version: number };
export type SecurityResponse = { ok: true; policy?: SecurityPolicy; currentIp?: string; lastOwnerProtected?: boolean; rules?: IpRule[]; security?: AccountSecurityState; states?: AccountSecurityState[]; message?: string };
export { APPLICATION_GATEWAY };
const actions = new Set(["policy", "list-rules", "upsert-rule", "set-rule-active", "delete-rule", "account-security", "list-account-security", "set-account-policy", "unlock-account", "account-ip-rules", "set-account-ip-mode", "upsert-account-ip-rule", "set-account-ip-rule-active", "delete-account-ip-rule"]);

export async function securityRequest(session: DashboardSession, request: Record<string, unknown> & {action: string; surface: AccountSurface}, signal?: AbortSignal): Promise<SecurityResponse> {
  if (!actions.has(request.action) || !["workorder", "dashboard"].includes(request.surface)) throw Error("不支持的安全设置操作");
  signal?.throwIfAborted();
  const current = await ensureDashboardSession(session);
  if (current.user.id !== session.user.id) throw Error("登录账号已改变，请重新打开页面");
  signal?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, {once: true});
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
  try {
    const response = await fetch(APPLICATION_GATEWAY + "/api/security-admin", {
      method: "POST", cache: "no-store", credentials: "omit", redirect: "error", signal: controller.signal,
      headers: {Authorization: `Bearer ${current.access_token}`, "Content-Type": "application/json"}, body: JSON.stringify(request),
    });
    const data = await response.json();
    if (!response.ok || data.ok !== true) throw Error(response.status === 401 ? "登录已失效，请重新登录" : data.message || "安全设置服务暂时不可用");
    return data;
  } catch (error) {
    if (timedOut) throw Error("请求超时；请刷新确认结果后再操作");
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", cancel);
  }
}
