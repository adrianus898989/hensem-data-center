"use client";

export type DashboardRole = "owner" | "admin" | "viewer";
export type DashboardPermissionKey = "home" | "third_party" | "auto_withdraw" | "work_orders" | "customer_service";
export type DashboardPermissions = Record<DashboardPermissionKey, boolean>;

export type DashboardManagementPermissions = {
  manage_viewers: boolean;
  refresh_data: boolean;
  view_audit: boolean;
};

export const DASHBOARD_PERMISSION_LABELS: Array<{ key: DashboardPermissionKey; label: string; note: string }> = [
  { key: "third_party", label: "三方量 / 费率", note: "查看三方量、费率、盘口状态" },
  { key: "auto_withdraw", label: "提现 / 自动出款", note: "自动出款与提现操作人统计" },
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

export const DEFAULT_ADMIN_PERMISSIONS: DashboardPermissions = {
  home: true,
  third_party: true,
  auto_withdraw: true,
  work_orders: true,
  customer_service: true,
};

export const DEFAULT_ADMIN_MANAGEMENT_PERMISSIONS: DashboardManagementPermissions = {
  manage_viewers: true,
  refresh_data: true,
  view_audit: true,
};

export type DashboardProfile = {
  auth_user_id: string;
  username: string;
  role: DashboardRole;
  active: boolean;
  permissions?: Partial<DashboardPermissions> | null;
  management_permissions?: Partial<DashboardManagementPermissions> | null;
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
  if (profile?.role === "owner") return { ...DEFAULT_ADMIN_PERMISSIONS };
  if (profile?.role === "admin") {
    return {
      home: true,
      third_party: profile?.permissions?.third_party !== false,
      auto_withdraw: profile?.permissions?.auto_withdraw !== false,
      work_orders: profile?.permissions?.work_orders !== false,
      customer_service: profile?.permissions?.customer_service !== false,
    };
  }
  return {
    home: true,
    third_party: profile?.permissions?.third_party !== false,
    auto_withdraw: profile?.permissions?.auto_withdraw === true,
    work_orders: profile?.permissions?.work_orders === true,
    customer_service: profile?.permissions?.customer_service === true,
  };
}

export function normalizedManagementPermissions(profile?: DashboardProfile | null): DashboardManagementPermissions {
  if (profile?.role === "owner") return { manage_viewers: true, refresh_data: true, view_audit: true };
  if (profile?.role !== "admin") return { manage_viewers: false, refresh_data: false, view_audit: false };
  return {
    manage_viewers: profile?.management_permissions?.manage_viewers !== false,
    refresh_data: profile?.management_permissions?.refresh_data !== false,
    view_audit: profile?.management_permissions?.view_audit !== false,
  };
}

export function canOpenAdminCenter(profile?: DashboardProfile | null): boolean {
  if (!profile) return false;
  if (profile.role === "owner") return true;
  if (profile.role !== "admin") return false;
  const p = normalizedManagementPermissions(profile);
  return p.manage_viewers || p.refresh_data || p.view_audit;
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
  params.set("select", "auth_user_id,username,role,active,permissions,management_permissions,created_at,updated_at");
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

export async function createDashboardAccount(
  session: DashboardSession,
  usernameInput: string,
  password: string,
  role: "admin" | "viewer",
  permissions: DashboardPermissions,
  managementPermissions?: DashboardManagementPermissions,
) {
  const username = validateDashboardUsername(usernameInput);
  if (String(password || "").length < 8) throw new Error("密码至少 8 位");
  return await callAdminFunction(session, {
    action: "create-account",
    username,
    password,
    role,
    permissions,
    management_permissions: managementPermissions || DEFAULT_ADMIN_MANAGEMENT_PERMISSIONS,
  });
}

export async function createViewerAccount(session: DashboardSession, usernameInput: string, password: string, permissions: DashboardPermissions) {
  return await createDashboardAccount(session, usernameInput, password, "viewer", permissions);
}

export async function listDashboardUsers(session: DashboardSession): Promise<DashboardProfile[]> {
  const result = await callAdminFunction(session, { action: "list-users" });
  return Array.isArray(result?.users) ? result.users : [];
}

export type DashboardAccountPatch = {
  active?: boolean;
  permissions?: DashboardPermissions;
  management_permissions?: DashboardManagementPermissions;
  role?: "admin" | "viewer";
  expected_role?: "admin" | "viewer";
};

export async function updateDashboardAccount(session: DashboardSession, username: string, patch: DashboardAccountPatch) {
  return await callAdminFunction(session, { action: "update-account", username, ...patch });
}

export async function updateViewerAccount(session: DashboardSession, username: string, patch: { active?: boolean; permissions?: DashboardPermissions }) {
  return await updateDashboardAccount(session, username, patch);
}

export async function resetDashboardUserPassword(session: DashboardSession, username: string, password: string) {
  if (String(password || "").length < 8) throw new Error("密码至少 8 位");
  return await callAdminFunction(session, { action: "reset-password", username, password });
}

export async function resetViewerPassword(session: DashboardSession, username: string, password: string) {
  return await resetDashboardUserPassword(session, username, password);
}

export async function deleteDashboardAccount(session: DashboardSession, username: string) {
  return await callAdminFunction(session, { action: "delete-account", username });
}

export async function changeOwnDashboardPassword(username: string, currentPassword: string, newPassword: string): Promise<DashboardSession> {
  if (!String(currentPassword || "")) throw new Error("请输入当前密码");
  if (String(newPassword || "").length < 8) throw new Error("新密码至少 8 位");
  if (String(newPassword || "").length > 128) throw new Error("新密码太长");

  // 先用当前密码重新验证一次，避免仅凭浏览器里残留的会话就能直接改密码。
  const verifiedSession = await signInDashboard(username, currentPassword);
  const { url, anonKey } = publicConfig();
  const response = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${verifiedSession.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: newPassword }),
  });
  await readJson(response);

  // 用新密码重新登录并保存一套新的 token，后续自动续期不会继续拿旧 refresh token。
  return await signInDashboard(username, newPassword);
}

export async function listDashboardAudit(session: DashboardSession, limit = 50): Promise<DashboardAuditLog[]> {
  const result = await callAdminFunction(session, { action: "list-audit", limit });
  return Array.isArray(result?.logs) ? result.logs : [];
}


export type DashboardIpWhitelistRow = {
  id: number;
  ip: string;
  note: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type DashboardIpSettings = {
  enabled: boolean;
  currentIp: string;
  rows: DashboardIpWhitelistRow[];
};

export async function verifyDashboardAccess(session: DashboardSession) {
  return await callAdminFunction(session, { action: "check-access" });
}

export async function getDashboardIpSettings(session: DashboardSession): Promise<DashboardIpSettings> {
  const result = await callAdminFunction(session, { action: "ip-settings" });
  return {
    enabled: Boolean(result?.enabled),
    currentIp: String(result?.currentIp || ""),
    rows: Array.isArray(result?.rows) ? result.rows : [],
  };
}

export async function addDashboardAllowedIp(session: DashboardSession, ip: string, note = "") {
  return await callAdminFunction(session, { action: "add-ip", ip, note });
}

export async function setDashboardIpActive(session: DashboardSession, id: number, active: boolean) {
  return await callAdminFunction(session, { action: "set-ip-active", id, active });
}

export async function deleteDashboardAllowedIp(session: DashboardSession, id: number) {
  return await callAdminFunction(session, { action: "delete-ip", id });
}

export async function setDashboardIpWhitelistMode(session: DashboardSession, enabled: boolean) {
  return await callAdminFunction(session, { action: "set-ip-mode", enabled });
}

export type ManualSyncJob = "today_collect" | "today_payout" | "yesterday_collect" | "yesterday_payout" | "rates" | "history_next" | "auto_latest" | "auto_history_next";

export type HistoryBackfillStatus = {
  total: number;
  completed: number;
  pending: number;
  retry: number;
  failed: number;
  completedPct: number;
  rowsWritten: number;
  lastSyncAt: string;
  nextPendingDate: string;
};

export async function getDashboardHistoryStatus(session: DashboardSession): Promise<HistoryBackfillStatus | null> {
  const result = await callAdminFunction(session, { action: "history-status" });
  return result?.history || null;
}

export async function getDashboardAutoWithdrawHistoryStatus(session: DashboardSession): Promise<HistoryBackfillStatus | null> {
  const result = await callAdminFunction(session, { action: "auto-withdraw-history-status" });
  return result?.history || null;
}

export async function triggerDashboardSync(session: DashboardSession, job: ManualSyncJob) {
  return await callAdminFunction(session, { action: "trigger-sync", job });
}
