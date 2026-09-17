"use client";

import type { DashboardDataScope } from "./dashboardDataScope";

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
  data_scope?: DashboardDataScope | null;
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
export const DASHBOARD_SESSION_EVENT = "hensem:dashboard:session-changed";

export class DashboardHttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 0, code = "http_error") {
    super(message);
    this.name = "DashboardHttpError";
    this.status = status;
    this.code = code;
  }
}

export function isInvalidDashboardRefreshError(error: unknown): boolean {
  return error instanceof DashboardHttpError && error.code === "refresh_invalid";
}

export function isDashboardAuthTerminalError(error: unknown): boolean {
  return error instanceof DashboardHttpError && (
    ["refresh_invalid", "session_changed", "session_logged_out", "profile_denied"].includes(error.code)
    || error.status === 401 || error.status === 403
  );
}

let sessionGeneration = 0;
let memorySession: DashboardSession | null = null;
let observedStoredSession = false;
let explicitlyLoggedOut = false;
const freshSignIns = new WeakMap<DashboardSession, number>();
const refreshFlights = new Map<string, Promise<DashboardSession>>();

function publicConfig() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const anonKey = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !anonKey) throw new Error("网站还没有配置 Supabase 登录环境变量");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password
      || (parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash) {
    throw new DashboardHttpError("Supabase 登录地址配置不正确", 0, "auth_configuration_invalid");
  }
  return { url: parsed.origin, anonKey };
}

function jwtExpiresAt(accessToken: string): number | null {
  try {
    const encoded = accessToken.split(".")[1];
    if (!encoded || encoded.length > 65536) return null;
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    return typeof payload?.exp === "number" && Number.isFinite(payload.exp) && payload.exp > 0 ? payload.exp : null;
  } catch { return null; }
}

function sessionExpiry(session: DashboardSession): number | null {
  if (typeof session.expires_at === "number" && Number.isFinite(session.expires_at) && session.expires_at > 0) return session.expires_at;
  return jwtExpiresAt(session.access_token);
}

// JWT decoding is scheduling information only; permissions still come from the server.
export function isDashboardSessionExpired(session: DashboardSession | null | undefined, aheadSeconds = 60): boolean {
  if (!session) return true;
  const expiry = sessionExpiry(session);
  return expiry !== null && expiry <= Date.now() / 1000 + Math.max(0, aheadSeconds);
}

function isSession(value: unknown): value is DashboardSession {
  const s = value as DashboardSession | null;
  return Boolean(s && typeof s === "object" && typeof s.access_token === "string" && s.access_token
    && typeof s.refresh_token === "string" && typeof s.user?.id === "string" && s.user.id);
}

function receivedSession(value: unknown): DashboardSession {
  if (!isSession(value)) throw new DashboardHttpError("登录服务器返回了无效会话，请稍后重试", 502, "auth_response_invalid");
  const expiry = sessionExpiry(value);
  if (expiry !== null) return { ...value, expires_at: expiry };
  if (typeof value.expires_in === "number" && Number.isFinite(value.expires_in) && value.expires_in > 0) {
    return { ...value, expires_at: Math.floor(Date.now() / 1000) + value.expires_in };
  }
  return value;
}

function sameTokens(left: DashboardSession, right: DashboardSession): boolean {
  return left.user.id === right.user.id && left.access_token === right.access_token && left.refresh_token === right.refresh_token;
}

function sessionChanged(loggedOut = false): DashboardHttpError {
  return new DashboardHttpError(loggedOut ? "登录已退出，请重新登录" : "登录账号或会话已改变，请使用当前会话", 409,
    loggedOut ? "session_logged_out" : "session_changed");
}

function currentSession(candidate: DashboardSession): DashboardSession {
  const saved = readSavedDashboardSession();
  if (saved) {
    if (saved.user.id !== candidate.user.id) throw sessionChanged();
    return saved;
  }
  if (explicitlyLoggedOut && freshSignIns.get(candidate) !== sessionGeneration) throw sessionChanged(true);
  return candidate;
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
    const message = json?.msg || json?.message || json?.error_description || json?.error || `HTTP ${response.status}`;
    const code = json?.error_code || json?.code || "http_error";
    throw new DashboardHttpError(
      typeof message === "string" ? message : `HTTP ${response.status}`,
      response.status,
      typeof code === "string" ? code : "http_error",
    );
  }
  return json;
}

type DashboardNetworkOptions = {
  timeoutMessage: string;
  networkMessage: string;
  timeoutCode: string;
  networkCode: string;
  timeoutMs?: number;
  retryReadOnce?: boolean;
};

// Authentication POSTs and administrative mutations must never be replayed after
// an ambiguous network failure. Only callers that are provably read-only may opt
// into the single retry below.
async function dashboardNetworkFetch(
  input: string | URL,
  init: RequestInit,
  options: DashboardNetworkOptions,
): Promise<Response> {
  const attempts = options.retryReadOnce ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const abort = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, options.timeoutMs ?? 15000);
    try {
      return await fetch(input, { ...init, signal: abort.signal });
    } catch (error) {
      if (attempt + 1 < attempts) continue;
      throw new DashboardHttpError(
        timedOut ? options.timeoutMessage : options.networkMessage,
        0,
        timedOut ? options.timeoutCode : options.networkCode,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  throw new DashboardHttpError(options.networkMessage, 0, options.networkCode);
}

export async function signInDashboard(usernameInput: string, password: string): Promise<DashboardSession> {
  const startedGeneration = sessionGeneration;
  const { url, anonKey } = publicConfig();
  const email = dashboardUsernameEmail(usernameInput);
  const response = await dashboardNetworkFetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    redirect: "error",
    credentials: "omit",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }, {
    timeoutMessage: "登录服务响应超时，请检查网络或代理后重试",
    networkMessage: "登录服务暂时无法连接，请检查网络或代理，并关闭会拦截跨站请求的浏览器扩展后重试",
    timeoutCode: "auth_timeout",
    networkCode: "auth_network_error",
    // Supabase Auth can occasionally take 20-30 seconds while the project is
    // resuming or under load. Keep the one-shot password request alive long
    // enough to receive its definitive response; it is deliberately not retried.
    timeoutMs: 60000,
  });
  let payload: unknown;
  try {
    payload = await readJson(response);
  } catch (error) {
    if (error instanceof DashboardHttpError
        && error.status === 400
        && (error.code === "invalid_credentials" || /invalid login credentials/i.test(error.message))) {
      throw new DashboardHttpError("账号或密码不正确", 400, "invalid_credentials");
    }
    if (error instanceof DashboardHttpError && (error.status === 429 || error.status >= 500)) {
      throw new DashboardHttpError(
        error.status === 429 ? "登录请求过于频繁，请稍后再试" : "登录服务暂时繁忙，请稍后重试",
        error.status,
        error.status === 429 ? "auth_rate_limited" : "auth_service_unavailable",
      );
    }
    throw error;
  }
  const session = receivedSession(payload);
  freshSignIns.set(session, startedGeneration);
  return session;
}

async function requestRefreshedSession(refreshToken: string): Promise<DashboardSession> {
  const { url, anonKey } = publicConfig();
  if (!refreshToken) throw new DashboardHttpError("登录已失效，请重新登录", 401, "refresh_invalid");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  try {
    const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST", redirect: "error", credentials: "omit", signal: abort.signal,
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if ([400, 401, 403].includes(response.status)) {
      // Do not reflect token endpoint payloads or token values into an error.
      throw new DashboardHttpError("登录已失效，请重新登录", response.status, "refresh_invalid");
    }
    return receivedSession(await readJson(response));
  } catch (error) {
    if (error instanceof DashboardHttpError) throw error;
    throw new DashboardHttpError("登录续期暂时失败，请检查网络后重试", 0, "refresh_network_error");
  } finally { clearTimeout(timer); }
}

export async function ensureDashboardSession(session: DashboardSession, force = false): Promise<DashboardSession> {
  if (!isSession(session)) throw new DashboardHttpError("登录状态不完整，请重新登录", 401, "refresh_invalid");
  const candidate = currentSession(session);
  // A different token already saved by another request/tab satisfies an old-token 401.
  if (!isDashboardSessionExpired(candidate) && (!force || !sameTokens(candidate, session))) return candidate;
  if (!force && !isDashboardSessionExpired(candidate)) return candidate;

  const key = `${candidate.user.id}:${candidate.refresh_token}`; // Memory-only; never sent as a lock name or logged.
  const existing = refreshFlights.get(key);
  if (existing) return existing;
  const generation = sessionGeneration;
  const startedStored = readSavedDashboardSession();

  const refresh = async (): Promise<DashboardSession> => {
    const before = readSavedDashboardSession();
    if (generation !== sessionGeneration) throw sessionChanged(!before);
    if ((startedStored && !before) || (!before && explicitlyLoggedOut && freshSignIns.get(candidate) !== sessionGeneration)) throw sessionChanged(true);
    if (before && before.user.id !== candidate.user.id) throw sessionChanged();
    const active = before || candidate;
    if (!sameTokens(active, candidate) && !isDashboardSessionExpired(active)) return active;

    try {
      const next = await requestRefreshedSession(active.refresh_token);
      const latest = readSavedDashboardSession();
      if (generation !== sessionGeneration) throw sessionChanged(!latest);
      if ((startedStored && !latest) || (!latest && explicitlyLoggedOut && freshSignIns.get(candidate) !== sessionGeneration)) throw sessionChanged(true);
      if (latest && latest.user.id !== active.user.id) throw sessionChanged();
      if (next.user.id !== active.user.id) throw new DashboardHttpError("登录续期返回了不一致的账号，请稍后重试", 502, "auth_response_invalid");
      // A cross-tab refresh/sign-in may have won while this request was in flight.
      if (latest && !sameTokens(latest, active)) return latest;
      saveDashboardSession(next); // Persist rotated refresh token before profile/IP checks.
      return next;
    } catch (error) {
      const latest = readSavedDashboardSession();
      if (generation !== sessionGeneration) throw sessionChanged(!latest);
      if (latest && latest.user.id !== active.user.id) throw sessionChanged();
      if (latest && !sameTokens(latest, active)) return latest;
      if (isInvalidDashboardRefreshError(error)) {
        // Never clear another account or a newer token published in another tab.
        if (!latest || sameTokens(latest, active)) saveDashboardSession(null);
      }
      throw error;
    }
  };

  const coordinated = async (): Promise<DashboardSession> => {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks?.request) return refresh();
    try {
      return await locks.request(`hensem:dashboard-refresh:${publicConfig().url}:${candidate.user.id}`, { mode: "exclusive" }, refresh);
    } catch (error) {
      if (error instanceof DashboardHttpError) throw error;
      throw new DashboardHttpError("登录续期协调暂时失败，请稍后重试", 0, "refresh_coordination_failed");
    }
  };
  let flight: Promise<DashboardSession>;
  flight = coordinated().finally(() => { if (refreshFlights.get(key) === flight) refreshFlights.delete(key); });
  refreshFlights.set(key, flight);
  return flight;
}

// Retain the old API without allowing an obsolete caller to refresh another account.
export async function refreshDashboardSession(refreshToken: string): Promise<DashboardSession> {
  const saved = readSavedDashboardSession();
  if (!saved) throw sessionChanged(true);
  if (saved.refresh_token !== refreshToken) throw sessionChanged();
  return ensureDashboardSession(saved, true);
}

export async function dashboardAuthenticatedFetch(
  inputURL: string | URL,
  init: RequestInit | undefined,
  session: DashboardSession,
  options: { retry401?: boolean } = {},
): Promise<Response> {
  const { url, anonKey } = publicConfig();
  const target = new URL(String(inputURL), `${url}/`);
  if (target.origin !== url || target.protocol !== "https:" || target.username || target.password) {
    throw new DashboardHttpError("拒绝向其他地址发送登录凭据", 0, "auth_target_not_allowed");
  }
  const method = String(init?.method || "GET").toUpperCase();
  const canRetry = (method === "GET" || method === "HEAD") && options.retry401 !== false;
  const send = async (active: DashboardSession): Promise<Response> => {
    const current = currentSession(active);
    const headers = new Headers(init?.headers);
    headers.set("apikey", anonKey);
    headers.set("Authorization", `Bearer ${current.access_token}`);
    try {
      return await fetch(target.href, { ...init, method, headers, redirect: "error", credentials: "omit" });
    } catch {
      throw new DashboardHttpError("网络请求暂时失败，请稍后重试", 0, "network_error");
    }
  };
  const active = await ensureDashboardSession(session);
  const first = await send(active);
  if (first.status !== 401 || !canRetry) return first;
  const refreshed = await ensureDashboardSession(active, true);
  return send(refreshed); // Exactly one read-only replay; never refresh on 403.
}

export async function fetchDashboardProfile(session: DashboardSession): Promise<DashboardProfile> {
  const { url, anonKey } = publicConfig();
  const userId = String(session?.user?.id || "");
  if (!userId) throw new Error("登录状态缺少用户 ID");
  const params = new URLSearchParams();
  params.set("select", "auth_user_id,username,role,active,permissions,management_permissions,data_scope,created_at,updated_at");
  params.set("auth_user_id", `eq.${userId}`);
  params.set("limit", "1");
  const response = await dashboardNetworkFetch(`${url}/rest/v1/dashboard_profiles?${params.toString()}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}`, Accept: "application/json" },
    cache: "no-store",
  }, {
    timeoutMessage: "账号密码已验证，但读取账号权限超时，请检查网络后重试",
    networkMessage: "账号密码已验证，但暂时无法读取账号权限，请检查网络、代理或浏览器扩展后重试",
    timeoutCode: "profile_timeout",
    networkCode: "profile_network_error",
    retryReadOnce: true,
  });
  const rows = await readJson(response);
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile) throw new DashboardHttpError("这个账号还没有配置后台权限", 403, "profile_denied");
  if (!profile.active) throw new DashboardHttpError("这个账号已被停用", 403, "profile_denied");
  return profile as DashboardProfile;
}

export function saveDashboardSession(session: DashboardSession | null) {
  if (session && !isSession(session)) throw new DashboardHttpError("登录状态不完整，请重新登录", 401, "refresh_invalid");
  const previous = memorySession;
  let previousText = previous ? JSON.stringify(previous) : null;
  if (typeof window !== "undefined") {
    try { previousText = window.localStorage.getItem(SESSION_KEY); } catch { /* Keep the memory-only comparison. */ }
  }
  let next = session;
  if (session) {
    // expires_in is relative only when first received/saved, never at every read.
    let prior: DashboardSession | null = previous;
    try { const parsed: unknown = previousText ? JSON.parse(previousText) : null; if (isSession(parsed)) prior = parsed; } catch { /* Ignore malformed old storage. */ }
    const knownExpiry = sessionExpiry(session) ?? (prior && sameTokens(prior, session) ? sessionExpiry(prior) : null);
    next = knownExpiry !== null ? { ...session, expires_at: knownExpiry } : receivedSession(session);
    freshSignIns.delete(session);
  }
  const text = next ? JSON.stringify(next) : null;
  const changed = text !== previousText || (!session && Boolean(previous));
  if (changed || !session) sessionGeneration += 1;
  memorySession = next;
  explicitlyLoggedOut = !next;
  if (next) observedStoredSession = true;
  if (typeof window === "undefined") return;
  try {
    if (!next) window.localStorage.removeItem(SESSION_KEY);
    else window.localStorage.setItem(SESSION_KEY, text!);
  } catch { /* 本地记忆失败不影响本次会话 */ }
  if (changed) {
    try { window.dispatchEvent(new CustomEvent(DASHBOARD_SESSION_EVENT, { detail: { session: next } })); } catch { /* Event delivery must not discard tokens. */ }
  }
}

export function readSavedDashboardSession(): DashboardSession | null {
  if (typeof window === "undefined") return memorySession;
  try {
    const text = window.localStorage.getItem(SESSION_KEY);
    const parsed: unknown = text ? JSON.parse(text) : null;
    if (isSession(parsed)) {
      memorySession = parsed;
      observedStoredSession = true;
      return parsed;
    }
    if (observedStoredSession) explicitlyLoggedOut = true;
    memorySession = null;
    return null;
  } catch { return memorySession; }
}

async function callAdminFunction(session: DashboardSession, body: Record<string, unknown>) {
  const { url, anonKey } = publicConfig();
  const functionName = String(process.env.NEXT_PUBLIC_DASHBOARD_USER_FUNCTION || "dashboard-user-admin").trim() || "dashboard-user-admin";
  const isAccessCheck = body.action === "check-access";
  const response = await dashboardNetworkFetch(`${url}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, {
    timeoutMessage: isAccessCheck
      ? "账号密码和权限已验证，但登录安全检查超时，请稍后重试"
      : "后台操作响应超时，请稍后重试",
    networkMessage: isAccessCheck
      ? "账号密码和权限已验证，但登录安全检查暂时无法连接，请检查网络、代理或浏览器扩展后重试"
      : "后台服务暂时无法连接，请检查网络后重试",
    timeoutCode: isAccessCheck ? "access_check_timeout" : "admin_timeout",
    networkCode: isAccessCheck ? "access_check_network_error" : "admin_network_error",
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
  dataScope?: DashboardDataScope,
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
    ...(dataScope === undefined ? {} : { data_scope: dataScope }),
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
  data_scope?: DashboardDataScope;
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
  const response = await dashboardNetworkFetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${verifiedSession.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: newPassword }),
  }, {
    timeoutMessage: "修改密码请求超时；为避免重复提交，请重新登录确认密码是否已经生效",
    networkMessage: "修改密码时网络中断；为避免重复提交，请重新登录确认密码是否已经生效",
    timeoutCode: "password_change_timeout",
    networkCode: "password_change_network_error",
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
