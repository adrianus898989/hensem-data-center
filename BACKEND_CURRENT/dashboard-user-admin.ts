import { createClient } from "jsr:@supabase/supabase-js@2";

type PermissionKey = "home" | "third_party" | "auto_withdraw" | "work_orders" | "customer_service";
type DashboardPermissions = Record<PermissionKey, boolean>;
type ManagementPermissions = { manage_viewers: boolean; refresh_data: boolean; view_audit: boolean };

const VIEWER_DEFAULT: DashboardPermissions = {
  home: true,
  third_party: true,
  auto_withdraw: false,
  work_orders: false,
  customer_service: false,
};

const ADMIN_PERMISSIONS: DashboardPermissions = {
  home: true,
  third_party: true,
  auto_withdraw: true,
  work_orders: true,
  customer_service: true,
};

const ADMIN_MANAGEMENT: ManagementPermissions = { manage_viewers: true, refresh_data: true, view_audit: true };
const VIEWER_MANAGEMENT: ManagementPermissions = { manage_viewers: false, refresh_data: false, view_audit: false };

type DataScope = { mode: "all" | "selected"; countries: string[] };
const DATA_GROUPS = new Set(["BR_PANGHU", "BR", "IN", "PK", "ID", "VN", "PH", "MY", "MM", "NG", "CO", "MX", "CL", "SA", "BR_NATIVE", "USDT"]);
class DataScopeError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
function parseDataScope(value: unknown): DataScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DataScopeError("可见数据范围格式不正确", 400);
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(",") !== "countries,mode" || !Array.isArray(raw.countries)
      || raw.countries.length > DATA_GROUPS.size || !raw.countries.every(key => typeof key === "string" && DATA_GROUPS.has(key))) {
    throw new DataScopeError("可见数据范围包含未知国家或盘口组", 400);
  }
  if (raw.mode === "all" && raw.countries.length === 0) return { mode: "all", countries: [] };
  if (raw.mode !== "selected" || raw.countries.length === 0) throw new DataScopeError("请至少选择一个可见国家或盘口组", 400);
  return { mode: "selected", countries: Array.from(new Set(raw.countries as string[])).sort() };
}
function storedDataScope(profile: { role?: string; data_scope?: unknown }): DataScope {
  if (profile.role === "owner" || profile.data_scope == null) return { mode: "all", countries: [] };
  try { return parseDataScope(profile.data_scope); } catch { return { mode: "selected", countries: [] }; }
}
function dataScopeSubset(child: DataScope, parent: DataScope): boolean {
  return parent.mode === "all" || child.mode === "selected" && child.countries.every(key => parent.countries.includes(key));
}
function assertTargetDataScope(actor: { role?: string; data_scope?: unknown }, target: { role?: string; data_scope?: unknown }) {
  // Disabled accounts retain their real scope; resetting or enabling one must
  // never turn an out-of-scope account into a route around the caller's limits.
  if (actor.role !== "owner" && !dataScopeSubset(storedDataScope(target), storedDataScope(actor))) {
    throw new DataScopeError("不能管理超出自己可见数据范围的账号", 403);
  }
}
function requestedDataScope(body: Record<string, unknown>, actor: { role?: string; data_scope?: unknown }, creating: boolean): DataScope | undefined {
  const present = Object.prototype.hasOwnProperty.call(body, "data_scope");
  if (!present && !creating) return undefined;
  const scope = present ? parseDataScope(body.data_scope) : storedDataScope(actor);
  if (scope.mode === "selected" && !scope.countries.length) throw new DataScopeError("请至少选择一个可见国家或盘口组", 400);
  if (actor.role !== "owner" && !dataScopeSubset(scope, storedDataScope(actor))) throw new DataScopeError("不能授予超出自己可见数据范围的权限", 403);
  return scope;
}

function corsHeaders(request: Request) {
  const allowed = String(Deno.env.get("DASHBOARD_ALLOWED_ORIGIN") || "*").trim() || "*";
  const origin = request.headers.get("origin") || "";
  const value = allowed === "*" || !origin ? allowed : (origin === allowed ? origin : allowed);
  return {
    "Access-Control-Allow-Origin": value,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });
}

function normalizeUsername(value: unknown): string {
  const username = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new Error("账号只能使用 3-32 位英文、数字、点、下划线或短横线");
  }
  return username;
}

function validatePassword(value: unknown): string {
  const password = String(value || "");
  if (password.length < 8) throw new Error("密码至少 8 位");
  if (password.length > 128) throw new Error("密码太长");
  return password;
}

function usernameEmail(username: string): string {
  return `${username}@hensem.local`;
}

function sanitizePermissions(value: unknown): DashboardPermissions {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    home: true,
    third_party: raw.third_party !== false,
    auto_withdraw: raw.auto_withdraw === true,
    work_orders: raw.work_orders === true,
    customer_service: raw.customer_service === true,
  };
}


function sanitizeManagementPermissions(value: unknown): ManagementPermissions {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    manage_viewers: raw.manage_viewers !== false,
    refresh_data: raw.refresh_data !== false,
    view_audit: raw.view_audit !== false,
  };
}


function dateInManila(offsetDays = 0): string {
  const base = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(base);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { ok: false, message: "只支持 POST" }, 405);

  try {
    const supabaseUrl = String(Deno.env.get("SUPABASE_URL") || "");
    const serviceRoleKey = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase 内置环境变量缺失");
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let body: any = {};
    try { body = await request.json(); } catch { body = {}; }
    const action = String(body?.action || "").trim();

    async function audit(actor: { id?: string; username?: string } | null, auditAction: string, targetUsername = "", details: Record<string, unknown> = {}) {
      try {
        await admin.from("dashboard_audit_log").insert({
          actor_user_id: actor?.id || null,
          actor_username: actor?.username || "system",
          action: auditAction,
          target_username: targetUsername,
          details,
        });
      } catch {
        // 操作日志失败不阻断实际管理动作。
      }
    }

    async function requireApprovedSession(token: string, userId: string) {
      // Called only after getUser verifies this exact token.
      let sessionId = "";
      try { sessionId = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).session_id; } catch { /* fail closed */ }
      if (typeof sessionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) throw new DataScopeError("登录已失效，请重新登录", 403);
      const { data, error } = await admin.rpc("application_session_check", { p_user_id: userId, p_session_id: sessionId, p_surface: "dashboard" });
      if (error) throw new DataScopeError("登录验证暂时不可用", 503);
      if (data?.allowed !== true) throw new DataScopeError("登录已失效或账号已自动停用，请重新登录", 403);
    }
    async function revokeSessions(userId: string) {
      const { error } = await admin.rpc("application_revoke_user_sessions", { p_user_id: userId, p_surface: "dashboard" });
      if (error) throw new DataScopeError("无法撤销原登录状态，操作未完成，请重试", 503);
    }

    async function requireManager() {
      const authHeader = String(request.headers.get("authorization") || "");
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) throw new Error("未登录");

      const { data: userData, error: userError } = await admin.auth.getUser(token);
      const caller = userData?.user;
      if (userError || !caller) throw new Error("登录状态无效");
      await requireApprovedSession(token, caller.id);

      const { data: callerProfile, error: profileError } = await admin
        .from("dashboard_profiles")
        .select("username,role,active,permissions,management_permissions,data_scope")
        .eq("auth_user_id", caller.id)
        .maybeSingle();
      if (profileError) throw new Error(`读取管理员权限失败：${profileError.message}`);
      if (!callerProfile?.active || !["owner", "admin"].includes(String(callerProfile.role || ""))) throw new Error("只有管理账号可以执行这个操作");
      return { token, caller, profile: callerProfile, actor: { id: caller.id, username: String(callerProfile.username || "admin") } };
    }

    async function requireAuthenticated() {
      const authHeader = String(request.headers.get("authorization") || "");
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) throw new Error("未登录");
      const { data: userData, error: userError } = await admin.auth.getUser(token);
      const caller = userData?.user;
      if (userError || !caller) throw new Error("登录状态无效");
      await requireApprovedSession(token, caller.id);
      const { data: callerProfile, error: profileError } = await admin
        .from("dashboard_profiles")
        .select("username,role,active,permissions,management_permissions,data_scope")
        .eq("auth_user_id", caller.id)
        .maybeSingle();
      if (profileError) throw new Error(`读取账号权限失败：${profileError.message}`);
      if (!callerProfile?.active) throw new Error("这个账号已被停用");
      return { token, caller, profile: callerProfile, actor: { id: caller.id, username: String(callerProfile.username || "user") } };
    }

    async function requireOwner() {
      const ctx = await requireManager();
      if (ctx.profile.role !== "owner") throw new Error("只有总管理员可以管理 IP 白名单");
      return ctx;
    }

    async function loadIpSecurity() {
      const { data: settings, error: settingsError } = await admin
        .from("dashboard_security_settings")
        .select("ip_whitelist_enabled,updated_at")
        .eq("id", 1)
        .maybeSingle();
      if (settingsError) throw new Error(`读取 IP 安全设置失败：${settingsError.message}`);
      return { enabled: Boolean(settings?.ip_whitelist_enabled), updatedAt: String(settings?.updated_at || "") };
    }

    async function requireCapability(key: keyof ManagementPermissions) {
      const ctx = await requireManager();
      if (ctx.profile.role === "owner") return ctx;
      const permissions = sanitizeManagementPermissions(ctx.profile.management_permissions);
      if (!permissions[key]) throw new Error("当前管理员没有这个后台管理权限");
      if (key !== "manage_viewers" && storedDataScope(ctx.profile).mode !== "all") {
        throw new DataScopeError("当前账号仅可见指定数据范围，不能访问全局同步或全局操作记录", 403);
      }
      return ctx;
    }

    if (action === "check-access") {
      const ctx = await requireAuthenticated();
      const security = await loadIpSecurity();
      // Trusted gateway checked login IP; the registry rechecks the same
      // canonical whitelist. Never use caller-supplied forwarding headers.
      return json(request, { ok: true, allowed: true, enabled: security.enabled, currentIp: "" });
    }

    if (["ip-settings", "add-ip", "set-ip-active", "delete-ip", "set-ip-mode"].includes(action)) {
      await requireOwner();
      return json(request, { ok: false, code: "security_settings_moved", message: "请在登录安全页面管理 IP 白名单" }, 410);
    }

    if (action === "bootstrap-admin") {
      const expected = String(Deno.env.get("SYNC_SECRET") || "");
      const provided = String(request.headers.get("x-sync-secret") || "");
      if (!expected || provided !== expected) return json(request, { ok: false, message: "SYNC_SECRET 不正确" }, 401);

      const { count, error: countError } = await admin
        .from("dashboard_profiles")
        .select("auth_user_id", { count: "exact", head: true })
        .in("role", ["owner", "admin"])
        .eq("active", true);
      if (countError) throw new Error(`检查管理员失败：${countError.message}`);
      if ((count || 0) > 0) return json(request, { ok: false, message: "管理员已经初始化过，禁止再次 bootstrap" }, 409);

      const username = normalizeUsername(body?.username);
      const password = validatePassword(body?.password);
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: usernameEmail(username),
        password,
        email_confirm: true,
        user_metadata: { username, dashboard_role: "owner" },
      });
      if (createError || !created.user) throw new Error(`建立 Admin 登录账号失败：${createError?.message || "unknown"}`);

      const { error: profileError } = await admin.from("dashboard_profiles").insert({
        auth_user_id: created.user.id,
        username,
        role: "owner",
        active: true,
        permissions: ADMIN_PERMISSIONS,
        management_permissions: ADMIN_MANAGEMENT,
        created_by: created.user.id,
      });
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
        throw new Error(`建立 Admin 权限资料失败：${profileError.message}`);
      }
      await audit({ id: created.user.id, username }, "bootstrap_owner", username, { role: "owner" });
      return json(request, { ok: true, username, role: "owner", permissions: ADMIN_PERMISSIONS, management_permissions: ADMIN_MANAGEMENT, message: "总管理员初始化完成" });
    }

    if (action === "reset-admin-password") {
      const expected = String(Deno.env.get("SYNC_SECRET") || "");
      const provided = String(request.headers.get("x-sync-secret") || "");
      if (!expected || provided !== expected) {
        return json(request, { ok: false, message: "SYNC_SECRET 不正确" }, 401);
      }

      const username = normalizeUsername(body?.username || "admin");
      const password = validatePassword(body?.password);
      const { data: target, error: targetError } = await admin
        .from("dashboard_profiles")
        .select("auth_user_id,username,role,active")
        .eq("username", username)
        .maybeSingle();
      if (targetError) throw new Error(`读取 Admin 账号失败：${targetError.message}`);
      if (!target) return json(request, { ok: false, message: "Admin 账号不存在" }, 404);
      if (!["owner", "admin"].includes(String(target.role || ""))) return json(request, { ok: false, message: "这个账号不是管理账号" }, 403);

      await revokeSessions(target.auth_user_id);
      const { error: updateError } = await admin.auth.admin.updateUserById(target.auth_user_id, { password });
      if (updateError) throw new Error(`重置 Admin 密码失败：${updateError.message}`);
      await revokeSessions(target.auth_user_id);

      await audit(null, "reset_admin_password", username, { via: "sync_secret" });
      return json(request, { ok: true, username, role: "admin", message: "Admin 密码已重置" });
    }

    if (action === "create-account") {
      const ctx = await requireManager();
      const username = normalizeUsername(body?.username);
      const password = validatePassword(body?.password);
      const requestedRole = String(body?.role || "viewer") === "admin" ? "admin" : "viewer";
      if (requestedRole === "admin" && ctx.profile.role !== "owner") {
        return json(request, { ok: false, message: "只有总管理员可以建立小管理员" }, 403);
      }
      if (requestedRole === "viewer" && ctx.profile.role !== "owner") {
        const management = sanitizeManagementPermissions(ctx.profile.management_permissions);
        if (!management.manage_viewers) return json(request, { ok: false, message: "当前管理员没有账号管理权限" }, 403);
      }

      const permissions = requestedRole === "admin" ? { ...ADMIN_PERMISSIONS, ...sanitizePermissions(body?.permissions) } : sanitizePermissions(body?.permissions);
      const managementPermissions = requestedRole === "admin" ? sanitizeManagementPermissions(body?.management_permissions) : VIEWER_MANAGEMENT;
      const dataScope = requestedDataScope(body, ctx.profile, true)!;
      const { data: exists } = await admin.from("dashboard_profiles").select("auth_user_id").eq("username", username).maybeSingle();
      if (exists) return json(request, { ok: false, message: "这个账号已经存在" }, 409);

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: usernameEmail(username),
        password,
        email_confirm: true,
        user_metadata: { username, dashboard_role: requestedRole },
      });
      if (createError || !created.user) throw new Error(`建立账号失败：${createError?.message || "unknown"}`);

      const { error: insertError } = await admin.from("dashboard_profiles").insert({
        auth_user_id: created.user.id,
        username,
        role: requestedRole,
        active: true,
        permissions,
        management_permissions: managementPermissions,
        data_scope: dataScope,
        created_by: ctx.caller.id,
      });
      if (insertError) {
        await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
        throw new Error(`写入账号权限失败：${insertError.message}`);
      }
      await audit(ctx.actor, requestedRole === "admin" ? "create_admin" : "create_viewer", username, { permissions, management_permissions: managementPermissions, data_scope: dataScope });
      return json(request, { ok: true, username, role: requestedRole, permissions, management_permissions: managementPermissions, data_scope: dataScope, message: requestedRole === "admin" ? "小管理员已建立" : "查看账号已建立" });
    }

    if (action === "create-viewer") {
      const { caller, actor, profile: callerProfile } = await requireCapability("manage_viewers");
      const username = normalizeUsername(body?.username);
      const password = validatePassword(body?.password);
      const permissions = sanitizePermissions(body?.permissions);
      const dataScope = requestedDataScope(body, callerProfile, true)!;

      const { data: exists } = await admin.from("dashboard_profiles").select("auth_user_id").eq("username", username).maybeSingle();
      if (exists) return json(request, { ok: false, message: "这个账号已经存在" }, 409);

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: usernameEmail(username),
        password,
        email_confirm: true,
        user_metadata: { username, dashboard_role: "viewer" },
      });
      if (createError || !created.user) throw new Error(`建立查看账号失败：${createError?.message || "unknown"}`);

      const { error: insertError } = await admin.from("dashboard_profiles").insert({
        auth_user_id: created.user.id,
        username,
        role: "viewer",
        active: true,
        permissions,
        data_scope: dataScope,
        created_by: caller.id,
      });
      if (insertError) {
        await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
        throw new Error(`写入查看权限失败：${insertError.message}`);
      }
      await audit(actor, "create_viewer", username, { permissions, data_scope: dataScope });
      return json(request, { ok: true, username, role: "viewer", permissions, data_scope: dataScope, message: "只读账号已建立" });
    }

    if (action === "list-users") {
      const ctx = await requireManager();
      const { data, error } = await admin
        .from("dashboard_profiles")
        .select("auth_user_id,username,role,active,permissions,management_permissions,data_scope,created_at,updated_at")
        .order("created_at", { ascending: true });
      if (error) throw new Error(`读取账号列表失败：${error.message}`);
      const scope = storedDataScope(ctx.profile);
      const users = scope.mode === "all" ? data || [] : (data || []).filter(user =>
        sanitizeManagementPermissions(ctx.profile.management_permissions).manage_viewers
        && user.role === "viewer" && dataScopeSubset(storedDataScope(user), scope));
      return json(request, { ok: true, users });
    }

    if (action === "update-account") {
      const ctx = await requireManager();
      const hasRole = Object.prototype.hasOwnProperty.call(body, "role");
      if (hasRole && ctx.profile.role !== "owner") return json(request, { ok: false, message: "只有总管理员可以修改账号角色" }, 403);
      if (hasRole && !["admin", "viewer"].includes(body.role)) return json(request, { ok: false, message: "角色只能选择管理员或查看账号" }, 400);
      if (hasRole && !["admin", "viewer"].includes(body.expected_role)) return json(request, { ok: false, message: "请刷新账号列表后重新修改角色" }, 400);
      const username = normalizeUsername(body?.username);
      const { data: target, error: targetError } = await admin
        .from("dashboard_profiles")
        .select("auth_user_id,username,role,active,permissions,management_permissions,data_scope,updated_at")
        .eq("username", username)
        .maybeSingle();
      if (targetError) throw new Error(`读取目标账号失败：${targetError.message}`);
      if (!target) return json(request, { ok: false, message: "账号不存在" }, 404);
      if (target.role === "owner") return json(request, { ok: false, message: "总管理员不能被其它账号修改" }, 403);
      if (hasRole && body.expected_role !== target.role) return json(request, { ok: false, message: "账号角色已变更，请刷新列表后重试" }, 409);
      if (target.role === "admin" && ctx.profile.role !== "owner") return json(request, { ok: false, message: "只有总管理员可以修改小管理员" }, 403);
      if (target.role === "viewer" && ctx.profile.role !== "owner") {
        const management = sanitizeManagementPermissions(ctx.profile.management_permissions);
        if (!management.manage_viewers) return json(request, { ok: false, message: "当前管理员没有账号管理权限" }, 403);
      }

      assertTargetDataScope(ctx.profile, target);
      const dataScope = requestedDataScope(body, ctx.profile, false);

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (dataScope !== undefined) patch.data_scope = dataScope;
      if (typeof body?.active === "boolean") patch.active = body.active;
      if (body?.permissions) patch.permissions = sanitizePermissions(body.permissions);
      if (target.role === "admin" && body?.management_permissions) patch.management_permissions = sanitizeManagementPermissions(body.management_permissions);
      if (hasRole) {
        // A role change never implicitly grants business access through role defaults.
        const previous = target.permissions || {};
        patch.permissions = {
          home: true,
          third_party: previous.third_party !== false,
          auto_withdraw: target.role === "admin" ? previous.auto_withdraw !== false : previous.auto_withdraw === true,
          work_orders: target.role === "admin" ? previous.work_orders !== false : previous.work_orders === true,
          customer_service: target.role === "admin" ? previous.customer_service !== false : previous.customer_service === true,
        };
        // Change only the role here; other controls retain their existing save path.
        delete patch.active;
        delete patch.data_scope; // Role changes preserve the independently saved data range.
        patch.role = body.role;
        if (body.role === "admin") {
          const requested = body.management_permissions;
          const keys = ["manage_viewers", "refresh_data", "view_audit"];
          if (!requested || typeof requested !== "object" || Array.isArray(requested) || keys.some((key) => typeof requested[key] !== "boolean")) {
            return json(request, { ok: false, message: "请明确选择全部后台权限后保存角色" }, 400);
          }
          patch.management_permissions = sanitizeManagementPermissions(requested);
        } else {
          patch.management_permissions = { ...VIEWER_MANAGEMENT };
        }
      }
      // Do not let a concurrent promotion turn a viewer edit into an admin edit.
      if (patch.active === false) await revokeSessions(target.auth_user_id);
      let update = admin.from("dashboard_profiles").update(patch).eq("auth_user_id", target.auth_user_id).eq("role", target.role);
      if (target.updated_at) update = update.eq("updated_at", target.updated_at);
      const { data: updated, error } = await update.select("role").maybeSingle();
      if (error) throw new Error(`更新账号失败：${error.message}`);
      if (!updated) return json(request, { ok: false, message: "账号信息已变更，请刷新列表后重试" }, 409);
      await audit(ctx.actor, "update_account", username, { previous_role: target.role, ...patch, role: updated.role });
      return json(request, { ok: true, username, role: updated.role, message: hasRole ? "账号角色已更新" : "账号权限已更新" });
    }

    if (action === "update-viewer") {
      const { actor, profile: callerProfile } = await requireCapability("manage_viewers");
      if (Object.prototype.hasOwnProperty.call(body, "role")) return json(request, { ok: false, message: "请使用账号角色设置修改角色" }, 400);
      const username = normalizeUsername(body?.username);
      const { data: target, error: targetError } = await admin
        .from("dashboard_profiles")
        .select("auth_user_id,username,role,active,permissions,data_scope,updated_at")
        .eq("username", username)
        .maybeSingle();
      if (targetError) throw new Error(`读取目标账号失败：${targetError.message}`);
      if (!target) return json(request, { ok: false, message: "账号不存在" }, 404);
      if (target.role !== "viewer") return json(request, { ok: false, message: "不能在这里修改 Admin" }, 403);

      assertTargetDataScope(callerProfile, target);
      const dataScope = requestedDataScope(body, callerProfile, false);

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (dataScope !== undefined) patch.data_scope = dataScope;
      if (typeof body?.active === "boolean") patch.active = body.active;
      if (body?.permissions) patch.permissions = sanitizePermissions(body.permissions);
      if (patch.active === false) await revokeSessions(target.auth_user_id);
      let update = admin.from("dashboard_profiles").update(patch).eq("auth_user_id", target.auth_user_id).eq("role", "viewer");
      if (target.updated_at) update = update.eq("updated_at", target.updated_at);
      const { data: updated, error } = await update.select("role").maybeSingle();
      if (error) throw new Error(`更新账号失败：${error.message}`);
      if (!updated) return json(request, { ok: false, message: "账号角色已变更，请刷新列表后重试" }, 409);
      await audit(actor, "update_viewer", username, patch);
      return json(request, { ok: true, username, message: "账号权限已更新" });
    }

    if (action === "reset-password") {
      const ctx = await requireManager();
      const { actor } = ctx;
      const username = normalizeUsername(body?.username);
      const password = validatePassword(body?.password);
      const { data: target, error: targetError } = await admin
        .from("dashboard_profiles")
        .select("auth_user_id,username,role,data_scope")
        .eq("username", username)
        .maybeSingle();
      if (targetError) throw new Error(`读取目标账号失败：${targetError.message}`);
      if (!target) return json(request, { ok: false, message: "账号不存在" }, 404);
      if (target.role === "owner") return json(request, { ok: false, message: "总管理员密码请由本人在个人资料修改" }, 403);
      if (target.role === "admin" && ctx.profile.role !== "owner") return json(request, { ok: false, message: "只有总管理员可以重置小管理员密码" }, 403);
      if (target.role === "viewer" && ctx.profile.role !== "owner" && !sanitizeManagementPermissions(ctx.profile.management_permissions).manage_viewers) return json(request, { ok: false, message: "当前管理员没有账号管理权限" }, 403);
      assertTargetDataScope(ctx.profile, target);
      await revokeSessions(target.auth_user_id);
      const { error } = await admin.auth.admin.updateUserById(target.auth_user_id, { password });
      if (error) throw new Error(`重置密码失败：${error.message}`);
      await revokeSessions(target.auth_user_id);
      await audit(actor, "reset_password", username, {});
      return json(request, { ok: true, username, message: "密码已重置" });
    }

    if (action === "delete-account") {
      const ctx = await requireManager();
      const username = normalizeUsername(body?.username);
      const { data: target, error: targetError } = await admin
        .from("dashboard_profiles")
        .select("auth_user_id,username,role,data_scope")
        .eq("username", username)
        .maybeSingle();
      if (targetError) throw new Error(`读取目标账号失败：${targetError.message}`);
      if (!target) return json(request, { ok: false, message: "账号不存在" }, 404);
      if (target.role === "owner") return json(request, { ok: false, message: "总管理员账号不能删除" }, 403);
      if (target.role === "admin" && ctx.profile.role !== "owner") return json(request, { ok: false, message: "只有总管理员可以删除小管理员" }, 403);
      if (target.role === "viewer" && ctx.profile.role !== "owner" && !sanitizeManagementPermissions(ctx.profile.management_permissions).manage_viewers) return json(request, { ok: false, message: "当前管理员没有账号管理权限" }, 403);
      assertTargetDataScope(ctx.profile, target);
      const { error } = await admin.auth.admin.deleteUser(target.auth_user_id);
      if (error) throw new Error(`删除账号失败：${error.message}`);
      await audit(ctx.actor, "delete_account", username, { role: target.role });
      return json(request, { ok: true, username, role: target.role, message: "账号已删除" });
    }

    if (action === "list-audit") {
      await requireCapability("view_audit");
      const limit = Math.min(500, Math.max(10, Number(body?.limit || 100)));
      const { data, error } = await admin
        .from("dashboard_audit_log")
        .select("id,actor_username,action,target_username,details,created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`读取操作记录失败：${error.message}`);
      return json(request, { ok: true, logs: data || [] });
    }

    if (action === "history-status") {
      await requireCapability("refresh_data");
      const { data, error } = await admin
        .from("third_party_history_backfill")
        .select("data_date,direction,status,attempts,rows_written,last_error,last_sync_at")
        .order("data_date", { ascending: true })
        .order("direction", { ascending: true });
      if (error) throw new Error(`读取历史补齐进度失败：${error.message}`);
      const rows = Array.isArray(data) ? data : [];
      const counts: Record<string, number> = { pending: 0, retry: 0, success: 0, failed: 0 };
      let rowsWritten = 0;
      let lastSyncAt = "";
      let nextPendingDate = "";
      for (const row of rows) {
        const status = String(row.status || "pending");
        counts[status] = (counts[status] || 0) + 1;
        rowsWritten += Number(row.rows_written || 0);
        const syncAt = String(row.last_sync_at || "");
        if (syncAt && syncAt > lastSyncAt) lastSyncAt = syncAt;
        if (!nextPendingDate && ["pending", "retry"].includes(status)) nextPendingDate = String(row.data_date || "");
      }
      const total = rows.length;
      const completed = Number(counts.success || 0);
      return json(request, {
        ok: true,
        history: {
          total,
          completed,
          pending: Number(counts.pending || 0),
          retry: Number(counts.retry || 0),
          failed: Number(counts.failed || 0),
          completedPct: total ? Math.round(completed * 10000 / total) / 100 : 0,
          rowsWritten,
          lastSyncAt,
          nextPendingDate,
        },
      });
    }


    if (action === "auto-withdraw-history-status") {
      await requireCapability("refresh_data");
      const { data, error } = await admin
        .from("auto_withdraw_history_backfill")
        .select("data_date,status,attempts,auto_rows,operator_rows,last_attempt_at,last_success_at,message")
        .order("data_date", { ascending: true });
      if (error) throw new Error(`读取自动出款历史补齐进度失败：${error.message}`);
      const rows = Array.isArray(data) ? data : [];
      const counts: Record<string, number> = { pending: 0, running: 0, retry: 0, success: 0, failed: 0, source_not_ready: 0 };
      let rowsWritten = 0;
      let lastSyncAt = "";
      let nextPendingDate = "";
      for (const row of rows) {
        const status = String(row.status || "pending");
        counts[status] = (counts[status] || 0) + 1;
        rowsWritten += Number(row.auto_rows || 0) + Number(row.operator_rows || 0);
        const syncAt = String(row.last_success_at || row.last_attempt_at || "");
        if (syncAt && syncAt > lastSyncAt) lastSyncAt = syncAt;
        if (!nextPendingDate && ["pending", "running", "retry", "source_not_ready"].includes(status)) nextPendingDate = String(row.data_date || "");
      }
      const total = rows.length;
      const completed = Number(counts.success || 0);
      return json(request, {
        ok: true,
        history: {
          total,
          completed,
          pending: Number(counts.pending || 0) + Number(counts.running || 0) + Number(counts.source_not_ready || 0),
          retry: Number(counts.retry || 0),
          failed: Number(counts.failed || 0),
          completedPct: total ? Math.round(completed * 10000 / total) / 100 : 0,
          rowsWritten,
          lastSyncAt,
          nextPendingDate,
        },
      });
    }

    if (action === "trigger-sync") {
      const { actor } = await requireCapability("refresh_data");
      const job = String(body?.job || "").trim();
      const syncSecret = String(Deno.env.get("SYNC_SECRET") || "");
      if (!syncSecret) throw new Error("SYNC_SECRET 未配置");
      const thirdPartyFunctionName = String(Deno.env.get("THIRD_PARTY_SYNC_FUNCTION") || "bright-responder").trim() || "bright-responder";
      const autoWithdrawFunctionName = String(Deno.env.get("AUTO_WITHDRAW_SYNC_FUNCTION") || "sync-auto-withdraw-raw").trim() || "sync-auto-withdraw-raw";
      let functionName = thirdPartyFunctionName;
      let syncBody: Record<string, unknown>;

      if (job === "auto_latest") {
        functionName = autoWithdrawFunctionName;
        syncBody = { action: "sync-date", date: dateInManila(-1) };
      } else if (job === "auto_history_next") {
        functionName = autoWithdrawFunctionName;
        syncBody = { action: "backfill-next" };
      } else if (job === "rates") {
        syncBody = { action: "sync-rates" };
      } else if (job === "history_next") {
        syncBody = { action: "sync-history-next" };
      } else {
        const map: Record<string, { date: string; direction: "代收" | "代付" }> = {
          today_collect: { date: dateInManila(0), direction: "代收" },
          today_payout: { date: dateInManila(0), direction: "代付" },
          yesterday_collect: { date: dateInManila(-1), direction: "代收" },
          yesterday_payout: { date: dateInManila(-1), direction: "代付" },
        };
        const selected = map[job];
        if (!selected) return json(request, { ok: false, message: "未知刷新任务" }, 400);
        syncBody = { action: "sync-volume", date: selected.date, direction: selected.direction, mode: "hourly" };
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sync-secret": syncSecret },
        body: JSON.stringify(syncBody),
      });
      const text = await response.text();
      let result: any = {};
      try { result = text ? JSON.parse(text) : {}; } catch { result = { message: text }; }
      if (!response.ok || result?.ok === false) {
        await audit(actor, "manual_sync_failed", "", { job, message: result?.message || `HTTP ${response.status}` });
        return json(request, { ok: false, job, message: result?.message || `同步失败 HTTP ${response.status}` }, 502);
      }
      await audit(actor, "manual_sync", "", { job, requested: result?.requested || null, written: result?.written || null });
      return json(request, { ok: true, job, result, message: "刷新完成" });
    }

    return json(request, {
      ok: false,
      message: "action 请使用 check-access / ip-settings / add-ip / set-ip-active / delete-ip / set-ip-mode / bootstrap-admin / reset-admin-password / create-account / create-viewer / list-users / update-account / update-viewer / reset-password / delete-account / list-audit / history-status / auto-withdraw-history-status / trigger-sync",
    }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof DataScopeError ? error.status : /未登录|登录状态/.test(message) ? 401 : /只有|没有这个后台管理权限|不能|总管理员/.test(message) ? 403 : 500;
    return json(request, { ok: false, message }, status);
  }
});
