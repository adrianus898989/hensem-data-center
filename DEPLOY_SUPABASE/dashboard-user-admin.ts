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


function requestClientIp(request: Request): string {
  const direct = [
    request.headers.get("cf-connecting-ip"),
    request.headers.get("x-real-ip"),
    request.headers.get("fly-client-ip"),
    request.headers.get("sb-client-ip"),
  ].map((value) => String(value || "").trim()).find(Boolean);
  if (direct) return direct.replace(/^::ffff:/i, "");
  const forwarded = String(request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  return forwarded.replace(/^::ffff:/i, "");
}

function validateIp(value: unknown): string {
  const ip = String(value || "").trim().replace(/^::ffff:/i, "");
  if (!ip || ip.length > 64) throw new Error("IP 格式不正确");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return ip;
    throw new Error("IPv4 格式不正确");
  }
  if (/^[0-9a-f:]+$/i.test(ip) && ip.includes(":")) return ip.toLowerCase();
  throw new Error("只支持单个 IPv4 / IPv6 地址，不支持网段");
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

    async function requireManager() {
      const authHeader = String(request.headers.get("authorization") || "");
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) throw new Error("未登录");

      const { data: userData, error: userError } = await admin.auth.getUser(token);
      const caller = userData?.user;
      if (userError || !caller) throw new Error("登录状态无效");

      const { data: callerProfile, error: profileError } = await admin
        .from("dashboard_profiles")
        .select("username,role,active,permissions,management_permissions")
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
      const { data: callerProfile, error: profileError } = await admin
        .from("dashboard_profiles")
        .select("username,role,active,permissions,management_permissions")
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
      return ctx;
    }

    if (action === "check-access") {
      const ctx = await requireAuthenticated();
      const currentIp = requestClientIp(request);
      const security = await loadIpSecurity();
      if (!security.enabled) return json(request, { ok: true, allowed: true, enabled: false, currentIp });
      if (!currentIp) return json(request, { ok: false, allowed: false, enabled: true, currentIp: "", message: "无法识别当前 IP，已拒绝登录" }, 403);
      const { data: allowedRow, error } = await admin
        .from("dashboard_ip_whitelist")
        .select("id,ip,note,active")
        .eq("ip", currentIp)
        .eq("active", true)
        .maybeSingle();
      if (error) throw new Error(`检查 IP 白名单失败：${error.message}`);
      if (!allowedRow) {
        await audit(ctx.actor, "login_ip_denied", ctx.actor.username || "", { ip: currentIp });
        return json(request, { ok: false, allowed: false, enabled: true, currentIp, message: `当前 IP ${currentIp} 不在登录白名单` }, 403);
      }
      return json(request, { ok: true, allowed: true, enabled: true, currentIp, note: allowedRow.note || "" });
    }

    if (action === "ip-settings") {
      await requireOwner();
      const security = await loadIpSecurity();
      const { data: rows, error } = await admin
        .from("dashboard_ip_whitelist")
        .select("id,ip,note,active,created_at,updated_at")
        .order("active", { ascending: false })
        .order("id", { ascending: true });
      if (error) throw new Error(`读取 IP 白名单失败：${error.message}`);
      return json(request, { ok: true, enabled: security.enabled, currentIp: requestClientIp(request), rows: rows || [] });
    }

    if (action === "add-ip") {
      const ctx = await requireOwner();
      const ip = validateIp(body?.ip || requestClientIp(request));
      const note = String(body?.note || "").trim().slice(0, 100);
      const { error } = await admin.from("dashboard_ip_whitelist").upsert({
        ip, note, active: true, created_by: ctx.caller.id, updated_at: new Date().toISOString(),
      }, { onConflict: "ip" });
      if (error) throw new Error(`添加 IP 失败：${error.message}`);
      await audit(ctx.actor, "ip_whitelist_add", ip, { ip, note });
      return json(request, { ok: true, ip, message: "IP 已加入白名单" });
    }

    if (action === "set-ip-active") {
      const ctx = await requireOwner();
      const id = Number(body?.id || 0);
      if (!id) throw new Error("IP 记录 ID 无效");
      const active = Boolean(body?.active);
      const { data: row, error } = await admin.from("dashboard_ip_whitelist")
        .update({ active, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("id,ip,note,active")
        .maybeSingle();
      if (error) throw new Error(`更新 IP 状态失败：${error.message}`);
      if (!row) throw new Error("IP 记录不存在");
      await audit(ctx.actor, "ip_whitelist_update", String(row.ip || ""), { ip: row.ip, active });
      return json(request, { ok: true, row, message: active ? "IP 已启用" : "IP 已停用" });
    }

    if (action === "delete-ip") {
      const ctx = await requireOwner();
      const id = Number(body?.id || 0);
      if (!id) throw new Error("IP 记录 ID 无效");
      const { data: row } = await admin.from("dashboard_ip_whitelist").select("id,ip").eq("id", id).maybeSingle();
      const { error } = await admin.from("dashboard_ip_whitelist").delete().eq("id", id);
      if (error) throw new Error(`删除 IP 失败：${error.message}`);
      await audit(ctx.actor, "ip_whitelist_delete", String(row?.ip || ""), { ip: row?.ip || "" });
      return json(request, { ok: true, message: "IP 已删除" });
    }

    if (action === "set-ip-mode") {
      const ctx = await requireOwner();
      const enabled = Boolean(body?.enabled);
      const currentIp = requestClientIp(request);
      if (enabled) {
        if (!currentIp) throw new Error("无法识别当前 IP，不能开启白名单限制");
        const { data: currentAllowed, error: allowError } = await admin.from("dashboard_ip_whitelist")
          .select("id")
          .eq("ip", currentIp)
          .eq("active", true)
          .maybeSingle();
        if (allowError) throw new Error(`检查当前 IP 失败：${allowError.message}`);
        if (!currentAllowed) throw new Error(`请先把当前 IP ${currentIp} 加入并启用，再开启白名单限制`);
      }
      const { error } = await admin.from("dashboard_security_settings").upsert({
        id: 1, ip_whitelist_enabled: enabled, updated_by: ctx.caller.id, updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (error) throw new Error(`保存 IP 登录模式失败：${error.message}`);
      await audit(ctx.actor, "ip_whitelist_mode", "", { enabled, currentIp });
      return json(request, { ok: true, enabled, currentIp, message: enabled ? "已开启：只有白名单 IP 可以登录" : "已关闭：账号密码正确即可登录" });
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

      const { error: updateError } = await admin.auth.admin.updateUserById(target.auth_user_id, { password });
      if (updateError) throw new Error(`重置 Admin 密码失败：${updateError.message}`);

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
        created_by: ctx.caller.id,
      });
      if (insertError) {
        await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
        throw new Error(`写入账号权限失败：${insertError.message}`);
      }
      await audit(ctx.actor, requestedRole === "admin" ? "create_admin" : "create_viewer", username, { permissions, management_permissions: managementPermissions });
      return json(request, { ok: true, username, role: requestedRole, permissions, management_permissions: managementPermissions, message: requestedRole === "admin" ? "小管理员已建立" : "查看账号已建立" });
    }

    if (action === "create-viewer") {
      const { caller, actor } = await requireCapability("manage_viewers");
      const username = normalizeUsername(body?.username);
      const password = validatePassword(body?.password);
      const permissions = sanitizePermissions(body?.permissions);

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
        created_by: caller.id,
      });
      if (insertError) {
        await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
        throw new Error(`写入查看权限失败：${insertError.message}`);
      }
      await audit(actor, "create_viewer", username, { permissions });
      return json(request, { ok: true, username, role: "viewer", permissions, message: "只读账号已建立" });
    }

    if (action === "list-users") {
      await requireManager();
      const { data, error } = await admin
        .from("dashboard_profiles")
        .select("auth_user_id,username,role,active,permissions,management_permissions,created_at,updated_at")
        .order("created_at", { ascending: true });
      if (error) throw new Error(`读取账号列表失败：${error.message}`);
      return json(request, { ok: true, users: data || [] });
    }

    if (action === "update-account") {
      const ctx = await requireManager();
      const username = normalizeUsername(body?.username);
      const { data: target, error: targetError } = await admin
        .from("dashboard_profiles")
        .select("auth_user_id,username,role,active,permissions,management_permissions")
        .eq("username", username)
        .maybeSingle();
      if (targetError) throw new Error(`读取目标账号失败：${targetError.message}`);
      if (!target) return json(request, { ok: false, message: "账号不存在" }, 404);
      if (target.role === "owner") return json(request, { ok: false, message: "总管理员不能被其它账号修改" }, 403);
      if (target.role === "admin" && ctx.profile.role !== "owner") return json(request, { ok: false, message: "只有总管理员可以修改小管理员" }, 403);
      if (target.role === "viewer" && ctx.profile.role !== "owner") {
        const management = sanitizeManagementPermissions(ctx.profile.management_permissions);
        if (!management.manage_viewers) return json(request, { ok: false, message: "当前管理员没有账号管理权限" }, 403);
      }

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body?.active === "boolean") patch.active = body.active;
      if (body?.permissions) patch.permissions = sanitizePermissions(body.permissions);
      if (target.role === "admin" && body?.management_permissions) patch.management_permissions = sanitizeManagementPermissions(body.management_permissions);
      const { error } = await admin.from("dashboard_profiles").update(patch).eq("auth_user_id", target.auth_user_id);
      if (error) throw new Error(`更新账号失败：${error.message}`);
      await audit(ctx.actor, "update_account", username, { role: target.role, ...patch });
      return json(request, { ok: true, username, role: target.role, message: "账号权限已更新" });
    }

    if (action === "update-viewer") {
      const { actor } = await requireCapability("manage_viewers");
      const username = normalizeUsername(body?.username);
      const { data: target, error: targetError } = await admin
        .from("dashboard_profiles")
        .select("auth_user_id,username,role,active,permissions")
        .eq("username", username)
        .maybeSingle();
      if (targetError) throw new Error(`读取目标账号失败：${targetError.message}`);
      if (!target) return json(request, { ok: false, message: "账号不存在" }, 404);
      if (target.role !== "viewer") return json(request, { ok: false, message: "不能在这里修改 Admin" }, 403);

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body?.active === "boolean") patch.active = body.active;
      if (body?.permissions) patch.permissions = sanitizePermissions(body.permissions);
      const { error } = await admin.from("dashboard_profiles").update(patch).eq("auth_user_id", target.auth_user_id);
      if (error) throw new Error(`更新账号失败：${error.message}`);
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
        .select("auth_user_id,username,role")
        .eq("username", username)
        .maybeSingle();
      if (targetError) throw new Error(`读取目标账号失败：${targetError.message}`);
      if (!target) return json(request, { ok: false, message: "账号不存在" }, 404);
      if (target.role === "owner") return json(request, { ok: false, message: "总管理员密码请由本人在个人资料修改" }, 403);
      if (target.role === "admin" && ctx.profile.role !== "owner") return json(request, { ok: false, message: "只有总管理员可以重置小管理员密码" }, 403);
      if (target.role === "viewer" && ctx.profile.role !== "owner" && !sanitizeManagementPermissions(ctx.profile.management_permissions).manage_viewers) return json(request, { ok: false, message: "当前管理员没有账号管理权限" }, 403);
      const { error } = await admin.auth.admin.updateUserById(target.auth_user_id, { password });
      if (error) throw new Error(`重置密码失败：${error.message}`);
      await audit(actor, "reset_password", username, {});
      return json(request, { ok: true, username, message: "密码已重置" });
    }

    if (action === "delete-account") {
      const ctx = await requireManager();
      const username = normalizeUsername(body?.username);
      const { data: target, error: targetError } = await admin
        .from("dashboard_profiles")
        .select("auth_user_id,username,role")
        .eq("username", username)
        .maybeSingle();
      if (targetError) throw new Error(`读取目标账号失败：${targetError.message}`);
      if (!target) return json(request, { ok: false, message: "账号不存在" }, 404);
      if (target.role === "owner") return json(request, { ok: false, message: "总管理员账号不能删除" }, 403);
      if (target.role === "admin" && ctx.profile.role !== "owner") return json(request, { ok: false, message: "只有总管理员可以删除小管理员" }, 403);
      if (target.role === "viewer" && ctx.profile.role !== "owner" && !sanitizeManagementPermissions(ctx.profile.management_permissions).manage_viewers) return json(request, { ok: false, message: "当前管理员没有账号管理权限" }, 403);
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
    const status = /未登录|登录状态/.test(message) ? 401 : /只有|没有这个后台管理权限|不能|总管理员/.test(message) ? 403 : 500;
    return json(request, { ok: false, message }, status);
  }
});
