"use client";

export type DashboardRole = "admin" | "viewer";
export type DashboardPermissionKey = "home" | "third_party" | "auto_withdraw" | "work_orders" | "customer_service";
export type DashboardPermissions = Record<DashboardPermissionKey, boolean>;

export const DASHBOARD_PERMISSION_LABELS: Array<{ key: DashboardPermissionKey; label: string; note: string }> = [
  { key: "third_party", label: "三方量 / 费率", note: "查看三方量、费率、盘口状态" },
  { key: "auto_withdraw", label: "提现 / 自动出款", note: "模块迁移后可查看" },
  { key: "work_orders", label: "工单", note: "模块迁移后可查看" },
  { key: "customer_service", label: "客服", note: "模块迁移后可查看" },
];

export const DEFAULT_VIEWER_PERMISSIONS: DashboardPermissions = {
  home: true,
  third_party: true,
  auto_withdraw: false,
  work_orders: false,
  customer_service: false,
};

export type DashboardProfile = {
  auth_user_id: string;
  username: string;
  role: DashboardRole;
  active: boolean;
  permissions?: Partial<DashboardPermissions> | null;
  created_at?: string;
  updated_at?: string;
};

export type DashboardSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  user: { id: string; email?: string };
};

export type DashboardAuditLog = {
  id: number;
  actor_username: string;
  action: string;
  target_username: string;
  details?: Record<string, unknown> | null;
  created_at: string;
};

const SESSION_KEY = "hensem:dashboard:auth-session:v2";

function publicConfig() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const anonKey = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !anonKey) throw new Error("网站还没有配置 Supabase 登录环境变量");
  return { url, anonKey };
}

export function dashboardAuthEnabled(): boolean {
  return String(process.env.NEXT_PUBLIC_DASHBOARD_AUTH_ENABLED || "").toLowerCase() === "true";
}

export function normalizeDashboardUsername(value: string): string {
  return String(value || "").trim().toLowerCase();
}

export function validateDashboardUsername(value: string): string {
  const username = normalizeDashboardUsername(value);
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new Error("账号只能使用 3-32 位英文、数字、点、下划线或短横线");
  }
  return username;
}

export function dashboardUsernameEmail(value: string): string {
  return `${validateDashboardUsername(value)}@hensem.local`;
}

export function normalizedPermissions(profile?: DashboardProfile | null): DashboardPermissions {
  if (profile?.role === "admin") {
    return { home: true, third_party: true, auto_withdraw: true, work_orders: true, customer_service: true };
  }
  return {
    home: true,
    third_party: profile?.permissions?.third_party !== false,
    auto_withdraw: profile?.permissions?.auto_withdraw === true,
    work_orders: profile?.permissions?.work_orders === true,
    customer_service: profile?.permissions?.customer_service === true,
  };
}

export function hasDashboardPermission(profile: DashboardProfile | null | undefined, key: DashboardPermissionKey): boolean {
  return normalizedPermissions(profile)[key];
}

async function readJson(response: Response) {
  const text = await response.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
  if (!response.ok) {
    throw new Error(json?.msg || json?.message || json?.error_description || json?.error || `HTTP ${response.status}`);
  }
  return json;
}

export async function signInDashboard(usernameInput: string, password: string): Promise<DashboardSession> {
  const { url, anonKey } = publicConfig();
  const email = dashboardUsernameEmail(usernameInput);
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return await readJson(response) as DashboardSession;
}

export async function refreshDashboardSession(refreshToken: string): Promise<DashboardSession> {
  const { url, anonKey } = publicConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  return await readJson(response) as DashboardSession;
}

export async function fetchDashboardProfile(session: DashboardSession): Promise<DashboardProfile> {
  const { url, anonKey } = publicConfig();
  const userId = String(session?.user?.id || "");
  if (!userId) throw new Error("登录状态缺少用户 ID");
  const params = new URLSearchParams();
  params.set("select", "auth_user_id,username,role,active,permissions,created_at,updated_at");
  params.set("auth_user_id", `eq.${userId}`);
  params.set("limit", "1");
  const response = await fetch(`${url}/rest/v1/dashboard_profiles?${params.toString()}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}`, Accept: "application/json" },
    cache: "no-store",
  });
  const rows = await readJson(response);
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile) throw new Error("这个账号还没有配置后台权限");
  if (!profile.active) throw new Error("这个账号已被停用");
  return profile as DashboardProfile;
}

export function saveDashboardSession(session: DashboardSession | null) {
  if (typeof window === "undefined") return;
  try {
    if (!session) window.localStorage.removeItem(SESSION_KEY);
    else window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch { /* 本地记忆失败不影响本次会话 */ }
}

export function readSavedDashboardSession(): DashboardSession | null {
  if (typeof window === "undefined") return null;
  try {
    const text = window.localStorage.getItem(SESSION_KEY);
    return text ? JSON.parse(text) as DashboardSession : null;
  } catch { return null; }
}

async function callAdminFunction(session: DashboardSession, body: Record<string, unknown>) {
  const { url, anonKey } = publicConfig();
  const functionName = String(process.env.NEXT_PUBLIC_DASHBOARD_USER_FUNCTION || "dashboard-user-admin").trim() || "dashboard-user-admin";
  const response = await fetch(`${url}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return await readJson(response);
}

export async function createViewerAccount(session: DashboardSession, usernameInput: string, password: string, permissions: DashboardPermissions) {
  const username = validateDashboardUsername(usernameInput);
  if (String(password || "").length < 8) throw new Error("密码至少 8 位");
  return await callAdminFunction(session, { action: "create-viewer", username, password, permissions });
}

export async function listDashboardUsers(session: DashboardSession): Promise<DashboardProfile[]> {
  const result = await callAdminFunction(session, { action: "list-users" });
  return Array.isArray(result?.users) ? result.users : [];
}

export async function updateViewerAccount(session: DashboardSession, username: string, patch: { active?: boolean; permissions?: DashboardPermissions }) {
  return await callAdminFunction(session, { action: "update-viewer", username, ...patch });
}

export async function resetViewerPassword(session: DashboardSession, username: string, password: string) {
  if (String(password || "").length < 8) throw new Error("密码至少 8 位");
  return await callAdminFunction(session, { action: "reset-password", username, password });
}

export async function listDashboardAudit(session: DashboardSession, limit = 50): Promise<DashboardAuditLog[]> {
  const result = await callAdminFunction(session, { action: "list-audit", limit });
  return Array.isArray(result?.logs) ? result.logs : [];
}

export type ManualSyncJob = "today_collect" | "today_payout" | "yesterday_collect" | "yesterday_payout" | "rates";

export async function triggerDashboardSync(session: DashboardSession, job: ManualSyncJob) {
  return await callAdminFunction(session, { action: "trigger-sync", job });
}
