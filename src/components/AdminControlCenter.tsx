"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDashboardAllowedIp,
  canOpenAdminCenter,
  createDashboardAccount,
  deleteDashboardAllowedIp,
  DASHBOARD_PERMISSION_LABELS,
  DEFAULT_ADMIN_MANAGEMENT_PERMISSIONS,
  DEFAULT_ADMIN_PERMISSIONS,
  DEFAULT_VIEWER_PERMISSIONS,
  deleteDashboardAccount,
  getDashboardHistoryStatus,
  getDashboardIpSettings,
  listDashboardAudit,
  listDashboardUsers,
  normalizedManagementPermissions,
  normalizedPermissions,
  resetDashboardUserPassword,
  setDashboardIpActive,
  setDashboardIpWhitelistMode,
  triggerDashboardSync,
  updateDashboardAccount,
  type DashboardAuditLog,
  type DashboardIpSettings,
  type DashboardManagementPermissions,
  type DashboardPermissions,
  type DashboardProfile,
  type DashboardSession,
  type HistoryBackfillStatus,
  type ManualSyncJob,
} from "@/lib/dashboardAuthClient";

type Props = {
  open: boolean;
  session: DashboardSession;
  profile: DashboardProfile;
  onClose: () => void;
  section?: "users" | "data" | "audit";
  embedded?: boolean;
};

type Tab = "users" | "data" | "audit";
type CreateRole = "admin" | "viewer";

const THIRD_PARTY_SYNC_JOBS: Array<{ key: ManualSyncJob; label: string; note: string }> = [
  { key: "today_collect", label: "今日代收", note: "同步今日三方代收" },
  { key: "today_payout", label: "今日代付", note: "同步今日三方代付" },
  { key: "yesterday_collect", label: "昨日代收", note: "补齐延迟录入平台" },
  { key: "yesterday_payout", label: "昨日代付", note: "补齐延迟录入平台" },
  { key: "rates", label: "费率 / 盘口", note: "同步最新费率与盘口状态" },
];

const AUTO_WITHDRAW_SYNC_JOBS: Array<{ key: ManualSyncJob; label: string; note: string }> = [
  { key: "auto_latest", label: "自动出款 / 操作人 最新日", note: "重新读取 RAW 昨日数据并立即写入 Supabase" },
];

const ALL_LATEST_SYNC_JOBS = [...THIRD_PARTY_SYNC_JOBS, ...AUTO_WITHDRAW_SYNC_JOBS];

const BUSINESS_PERMISSION_GROUPS: Array<{
  key: string;
  keys: Array<keyof DashboardPermissions>;
  label: string;
  note: string;
}> = [
  { key: "third_party", keys: ["third_party"], label: "三方量 / 费率", note: "查看三方量、费率与盘口状态" },
  { key: "auto_withdraw", keys: ["auto_withdraw"], label: "提现 / 自动出款", note: "自动出款与提现操作人统计，同一个模块" },
  { key: "work_customer", keys: ["work_orders", "customer_service"], label: "工单 / 客服", note: "工单、操作人、客服统计，同一个模块" },
];

const MANAGEMENT_OPTIONS: Array<{ key: keyof DashboardManagementPermissions; label: string; note: string }> = [
  { key: "manage_viewers", label: "账号管理", note: "可建立、停用、删除 Viewer 与重置 Viewer 密码" },
  { key: "refresh_data", label: "数据刷新", note: "可手动刷新今日 / 昨日 / 费率与历史补齐" },
  { key: "view_audit", label: "操作记录", note: "可查看后台管理操作日志" },
];

function formatTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function roleLabel(role: DashboardProfile["role"]) {
  if (role === "owner") return "总管理员";
  if (role === "admin") return "管理员";
  return "查看账号";
}

function roleEnglish(role: DashboardProfile["role"]) {
  if (role === "owner") return "OWNER";
  if (role === "admin") return "ADMIN";
  return "VIEWER";
}

function permissionSummary(profile: DashboardProfile) {
  if (profile.role === "owner") return "全部业务模块 · 全部后台权限";
  const p = normalizedPermissions(profile);
  const business = BUSINESS_PERMISSION_GROUPS
    .filter((group) => group.keys.some((key) => p[key]))
    .map((group) => group.label);
  if (profile.role === "admin") {
    const m = normalizedManagementPermissions(profile);
    const management = MANAGEMENT_OPTIONS.filter((item) => m[item.key]).map((item) => item.label);
    return [...business, ...management].join(" · ") || "未分配权限";
  }
  return business.join(" · ") || "无模块权限";
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    bootstrap_admin: "初始化管理员",
    bootstrap_owner: "初始化总管理员",
    create_admin: "建立管理员",
    create_viewer: "建立 Viewer",
    update_account: "修改账号权限",
    update_viewer: "修改 Viewer 权限",
    delete_account: "删除账号",
    reset_password: "重置密码",
    manual_sync: "手动刷新数据",
    manual_sync_failed: "手动刷新失败",
    ip_whitelist_add: "添加白名单 IP",
    ip_whitelist_update: "修改 IP 状态",
    ip_whitelist_delete: "删除白名单 IP",
    ip_whitelist_mode: "切换 IP 登录限制",
    login_ip_denied: "IP 登录拒绝",
  };
  return labels[action] || action;
}

function auditDetailsText(log: DashboardAuditLog): string {
  const details = log.details || {};
  const parts: string[] = [];
  const job = String((details as any)?.job || "");
  if (job) parts.push(`任务：${job}`);
  const role = String((details as any)?.role || "");
  if (role && ["owner", "admin", "viewer"].includes(role)) parts.push(`角色：${roleLabel(role as DashboardProfile["role"])}`);
  if (typeof (details as any)?.active === "boolean") parts.push((details as any).active ? "启用账号" : "停用账号");

  const permissions = (details as any)?.permissions as Record<string, unknown> | undefined;
  if (permissions && typeof permissions === "object") {
    const enabled = DASHBOARD_PERMISSION_LABELS
      .filter((item) => permissions[item.key] === true)
      .map((item) => item.label);
    if (enabled.length) parts.push(`业务权限：${enabled.join("、")}`);
  }

  const management = (details as any)?.management_permissions as Record<string, unknown> | undefined;
  if (management && typeof management === "object") {
    const enabled = MANAGEMENT_OPTIONS
      .filter((item) => management[item.key] === true)
      .map((item) => item.label);
    if (enabled.length) parts.push(`后台权限：${enabled.join("、")}`);
  }

  const message = String((details as any)?.message || "");
  if (message) parts.push(message);

  if (!parts.length) {
    try {
      const raw = JSON.stringify(details);
      if (raw && raw !== "{}") parts.push(raw);
    } catch {}
  }
  return parts.join(" · ") || "-";
}

function localDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "").slice(0, 10);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function AdminControlCenter({ open, session, profile, onClose, section = "users", embedded = false }: Props) {
  const management = normalizedManagementPermissions(profile);
  const isOwner = profile.role === "owner";
  const canManageUsers = isOwner || management.manage_viewers;
  const canRefreshData = isOwner || management.refresh_data;
  const canViewAudit = isOwner || management.view_audit;

  const [tab, setTab] = useState<Tab>(section);
  const [users, setUsers] = useState<DashboardProfile[]>([]);
  const [logs, setLogs] = useState<DashboardAuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [newRole, setNewRole] = useState<CreateRole>("viewer");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPermissions, setNewPermissions] = useState<DashboardPermissions>({ ...DEFAULT_VIEWER_PERMISSIONS });
  const [newManagement, setNewManagement] = useState<DashboardManagementPermissions>({ ...DEFAULT_ADMIN_MANAGEMENT_PERMISSIONS });
  const [createBusy, setCreateBusy] = useState(false);
  const [savingUser, setSavingUser] = useState("");
  const [resetTarget, setResetTarget] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [syncRunning, setSyncRunning] = useState<ManualSyncJob | "all" | "">("");
  const [syncProgress, setSyncProgress] = useState<string[]>([]);
  const [historyStatus, setHistoryStatus] = useState<HistoryBackfillStatus | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [autoHistoryStatus, setAutoHistoryStatus] = useState<HistoryBackfillStatus | null>(null);
  const [autoHistoryLoading, setAutoHistoryLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState<"all" | DashboardProfile["role"]>("all");
  const [userStatusFilter, setUserStatusFilter] = useState<"all" | "active" | "disabled">("all");
  const [auditKeyword, setAuditKeyword] = useState("");
  const [auditAction, setAuditAction] = useState("all");
  const [auditStartDate, setAuditStartDate] = useState("");
  const [auditEndDate, setAuditEndDate] = useState("");
  const [ipSettings, setIpSettings] = useState<DashboardIpSettings | null>(null);
  const [ipLoading, setIpLoading] = useState(false);
  const [ipInput, setIpInput] = useState("");
  const [ipNote, setIpNote] = useState("");

  const stats = useMemo(() => ({
    owners: users.filter((u) => u.role === "owner").length,
    admins: users.filter((u) => u.role === "admin").length,
    viewers: users.filter((u) => u.role === "viewer").length,
    disabled: users.filter((u) => !u.active).length,
  }), [users]);

  const filteredUsers = useMemo(() => {
    const keyword = userSearch.trim().toLowerCase();
    return users.filter((user) => {
      if (userRoleFilter !== "all" && user.role !== userRoleFilter) return false;
      if (userStatusFilter === "active" && !user.active) return false;
      if (userStatusFilter === "disabled" && user.active) return false;
      if (!keyword) return true;
      const haystack = [
        user.username,
        roleLabel(user.role),
        roleEnglish(user.role),
        permissionSummary(user),
      ].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [users, userSearch, userRoleFilter, userStatusFilter]);

  const auditActionOptions = useMemo(() => {
    return Array.from(new Set(logs.map((log) => log.action).filter(Boolean))).sort();
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const keyword = auditKeyword.trim().toLowerCase();
    return logs.filter((log) => {
      if (auditAction !== "all" && log.action !== auditAction) return false;
      const dateKey = localDateKey(log.created_at);
      if (auditStartDate && dateKey < auditStartDate) return false;
      if (auditEndDate && dateKey > auditEndDate) return false;
      if (!keyword) return true;
      const haystack = [
        log.actor_username,
        log.target_username,
        log.action,
        actionLabel(log.action),
        auditDetailsText(log),
      ].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [logs, auditKeyword, auditAction, auditStartDate, auditEndDate]);

  async function loadUsers() {
    setLoading(true);
    try { setUsers(await listDashboardUsers(session)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "读取账号失败"); }
    finally { setLoading(false); }
  }

  async function loadAudit() {
    if (!canViewAudit) return;
    try { setLogs(await listDashboardAudit(session, 300)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "读取操作记录失败"); }
  }

  async function loadHistoryStatus() {
    if (!canRefreshData) return;
    setHistoryLoading(true);
    try { setHistoryStatus(await getDashboardHistoryStatus(session)); }
    catch { setHistoryStatus(null); }
    finally { setHistoryLoading(false); }
  }

  async function loadAutoHistoryStatus() {
    if (!canRefreshData) return;
    setAutoHistoryLoading(true);
    try {
      const { getDashboardAutoWithdrawHistoryStatus } = await import("@/lib/dashboardAuthClient");
      setAutoHistoryStatus(await getDashboardAutoWithdrawHistoryStatus(session));
    } catch { setAutoHistoryStatus(null); }
    finally { setAutoHistoryLoading(false); }
  }

  async function loadIpSettings() {
    if (!isOwner) return;
    setIpLoading(true);
    try {
      const next = await getDashboardIpSettings(session);
      setIpSettings(next);
      setIpInput((old) => old || next.currentIp || "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取 IP 白名单失败");
    } finally { setIpLoading(false); }
  }

  async function addIp(event?: React.FormEvent) {
    event?.preventDefault();
    if (!isOwner || !ipInput.trim()) return;
    setIpLoading(true); setMessage("");
    try {
      await addDashboardAllowedIp(session, ipInput.trim(), ipNote.trim());
      setIpNote("");
      setMessage(`${ipInput.trim()} 已加入白名单。`);
      await Promise.all([loadIpSettings(), canViewAudit ? loadAudit() : Promise.resolve()]);
    } catch (error) { setMessage(error instanceof Error ? error.message : "添加 IP 失败"); }
    finally { setIpLoading(false); }
  }

  async function toggleIpMode() {
    if (!isOwner || !ipSettings) return;
    setIpLoading(true); setMessage("");
    try {
      const result = await setDashboardIpWhitelistMode(session, !ipSettings.enabled);
      setMessage(result?.message || "IP 登录模式已更新");
      await Promise.all([loadIpSettings(), canViewAudit ? loadAudit() : Promise.resolve()]);
    } catch (error) { setMessage(error instanceof Error ? error.message : "更新 IP 登录模式失败"); }
    finally { setIpLoading(false); }
  }

  async function toggleAllowedIp(id: number, active: boolean) {
    setIpLoading(true); setMessage("");
    try {
      await setDashboardIpActive(session, id, active);
      await Promise.all([loadIpSettings(), canViewAudit ? loadAudit() : Promise.resolve()]);
    } catch (error) { setMessage(error instanceof Error ? error.message : "更新 IP 失败"); }
    finally { setIpLoading(false); }
  }

  async function removeAllowedIp(id: number) {
    if (!window.confirm("确定删除这个白名单 IP？")) return;
    setIpLoading(true); setMessage("");
    try {
      await deleteDashboardAllowedIp(session, id);
      await Promise.all([loadIpSettings(), canViewAudit ? loadAudit() : Promise.resolve()]);
    } catch (error) { setMessage(error instanceof Error ? error.message : "删除 IP 失败"); }
    finally { setIpLoading(false); }
  }

  useEffect(() => {
    if (!open || !canOpenAdminCenter(profile)) return;
    setMessage("");
    void loadUsers();
    if (canViewAudit) void loadAudit();
    if (canRefreshData) { void loadHistoryStatus(); void loadAutoHistoryStatus(); }
    if (isOwner) void loadIpSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile.role]);

  useEffect(() => {
    if (!isOwner && newRole === "admin") setNewRole("viewer");
  }, [isOwner, newRole]);

  useEffect(() => { setTab(section); }, [section]);

  if (!open || !canOpenAdminCenter(profile)) return null;

  function resetCreateRole(role: CreateRole) {
    setNewRole(role);
    setNewPermissions(role === "admin" ? { ...DEFAULT_ADMIN_PERMISSIONS } : { ...DEFAULT_VIEWER_PERMISSIONS });
    setNewManagement({ ...DEFAULT_ADMIN_MANAGEMENT_PERMISSIONS });
  }

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!canManageUsers) return;
    setCreateBusy(true);
    setMessage("");
    try {
      const result = await createDashboardAccount(session, newUsername, newPassword, newRole, newPermissions, newManagement);
      setMessage(`${roleLabel(result?.role || newRole)} ${result?.username || newUsername} 已建立。`);
      setNewUsername("");
      setNewPassword("");
      resetCreateRole("viewer");
      await Promise.all([loadUsers(), canViewAudit ? loadAudit() : Promise.resolve()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "建立账号失败");
    } finally { setCreateBusy(false); }
  }

  function canEditTarget(user: DashboardProfile) {
    if (user.role === "owner") return false;
    if (user.role === "admin") return isOwner;
    return canManageUsers;
  }

  async function saveAccount(user: DashboardProfile, patch: { active?: boolean; permissions?: DashboardPermissions; management_permissions?: DashboardManagementPermissions }) {
    if (!canEditTarget(user)) return;
    setSavingUser(user.username);
    setMessage("");
    try {
      await updateDashboardAccount(session, user.username, patch);
      setMessage(`${user.username} 已更新。`);
      await Promise.all([loadUsers(), canViewAudit ? loadAudit() : Promise.resolve()]);
    } catch (error) { setMessage(error instanceof Error ? error.message : "更新失败"); }
    finally { setSavingUser(""); }
  }

  async function submitResetPassword(event: React.FormEvent) {
    event.preventDefault();
    if (!resetTarget) return;
    setSavingUser(resetTarget);
    setMessage("");
    try {
      await resetDashboardUserPassword(session, resetTarget, resetPassword);
      setMessage(`${resetTarget} 密码已重置。`);
      setResetTarget("");
      setResetPassword("");
      if (canViewAudit) await loadAudit();
    } catch (error) { setMessage(error instanceof Error ? error.message : "重置密码失败"); }
    finally { setSavingUser(""); }
  }

  async function removeAccount(user: DashboardProfile) {
    if (!canEditTarget(user)) return;
    if (!window.confirm(`确定删除账号 ${user.username}？删除后该账号立即无法登录。`)) return;
    setSavingUser(user.username);
    setMessage("");
    try {
      await deleteDashboardAccount(session, user.username);
      setMessage(`${user.username} 已删除。`);
      await Promise.all([loadUsers(), canViewAudit ? loadAudit() : Promise.resolve()]);
    } catch (error) { setMessage(error instanceof Error ? error.message : "删除失败"); }
    finally { setSavingUser(""); }
  }

  async function runJob(job: ManualSyncJob) {
    if (!canRefreshData) return;
    setSyncRunning(job);
    setSyncProgress([`正在刷新：${ALL_LATEST_SYNC_JOBS.find((item) => item.key === job)?.label || job}`]);
    setMessage("");
    try {
      const result = await triggerDashboardSync(session, job);
      const written = result?.result?.written;
      const suffix = written?.volume
        ? `，写入 ${written.volume} 行`
        : written?.rates
          ? `，费率 ${written.rates} / 盘口 ${written.platformStatuses}`
          : written?.autoWithdraw !== undefined
            ? `，自动出款 ${written.autoWithdraw} 行 / 操作人 ${written.operator || 0} 行`
            : "";
      setSyncProgress([`${ALL_LATEST_SYNC_JOBS.find((item) => item.key === job)?.label || job}：完成${suffix}`]);
      if (canViewAudit) await loadAudit();
    } catch (error) {
      setSyncProgress([`${ALL_LATEST_SYNC_JOBS.find((item) => item.key === job)?.label || job}：${error instanceof Error ? error.message : "失败"}`]);
    } finally { setSyncRunning(""); }
  }

  async function runAllLatest() {
    if (!canRefreshData) return;
    setSyncRunning("all");
    const lines: string[] = [];
    setSyncProgress([]);
    for (const job of ALL_LATEST_SYNC_JOBS) {
      setSyncProgress([...lines, `正在刷新：${job.label}...`]);
      try {
        const result = await triggerDashboardSync(session, job.key);
        const written = result?.result?.written;
        const suffix = written?.volume
          ? `（${written.volume} 行）`
          : written?.rates
            ? `（费率 ${written.rates} / 盘口 ${written.platformStatuses}）`
            : written?.autoWithdraw !== undefined
              ? `（自动出款 ${written.autoWithdraw} / 操作人 ${written.operator || 0}）`
              : "";
        lines.push(`✓ ${job.label} ${suffix}`);
      } catch (error) { lines.push(`✕ ${job.label}：${error instanceof Error ? error.message : "失败"}`); }
      setSyncProgress([...lines]);
    }
    if (canViewAudit) await loadAudit();
    setSyncRunning("");
  }

  async function runHistoryNext() {
    if (!canRefreshData) return;
    setSyncRunning("history_next");
    try {
      const result = await triggerDashboardSync(session, "history_next");
      const requested = result?.result?.requested;
      const written = result?.result?.written;
      setSyncProgress([requested?.start
        ? `历史补齐：${requested.start}${requested.end && requested.end !== requested.start ? ` ~ ${requested.end}` : ""} ${requested.direction || ""} 完成${written?.volume ? `（${written.volume} 行）` : ""}`
        : (result?.result?.message || "历史补齐任务已执行")]);
      await loadHistoryStatus();
      if (canViewAudit) await loadAudit();
    } catch (error) {
      setSyncProgress([`历史补齐：${error instanceof Error ? error.message : "失败"}`]);
    } finally { setSyncRunning(""); }
  }

  async function runAutoHistoryNext() {
    if (!canRefreshData) return;
    setSyncRunning("auto_history_next");
    try {
      const result = await triggerDashboardSync(session, "auto_history_next");
      const written = result?.result?.written;
      const date = result?.result?.date || "";
      setSyncProgress([`自动出款历史补齐${date ? ` ${date}` : ""}：${result?.result?.status || "已执行"}${written ? `（自动出款 ${written.autoWithdraw || 0} / 操作人 ${written.operator || 0}）` : ""}`]);
      await loadAutoHistoryStatus();
      if (canViewAudit) await loadAudit();
    } catch (error) {
      setSyncProgress([`自动出款历史补齐：${error instanceof Error ? error.message : "失败"}`]);
    } finally { setSyncRunning(""); }
  }

  const sectionTitle = tab === "users" ? "账号与权限" : tab === "data" ? "数据同步" : "操作记录";
  const sectionSubtitle = tab === "users"
    ? "账号、角色、权限与 IP 登录控制。"
    : tab === "data"
      ? "同步状态与手动刷新。"
      : "后台操作与调整记录。";

  const content = (
    <>
      {tab === "users" && (canManageUsers || isOwner) && (
        <div className="admin-users-layout-v249">
          {isOwner && <section className="admin-panel-card admin-ip-card">
            <div className="admin-card-title"><div><span>LOGIN ACCESS</span><h3>IP 白名单</h3><p className="admin-card-subtitle">当前 IP：{ipSettings?.currentIp || "读取中..."}</p></div><button type="button" className={ipSettings?.enabled ? "admin-ip-mode on" : "admin-ip-mode"} disabled={ipLoading || !ipSettings} onClick={() => void toggleIpMode()}>{ipSettings?.enabled ? "已开启 · 必须白名单" : "未开启 · 账号密码即可"}</button></div>
            <form className="admin-ip-add" onSubmit={addIp}>
              <input value={ipInput} onChange={(e) => setIpInput(e.target.value)} placeholder="IPv4 / IPv6" />
              <input value={ipNote} onChange={(e) => setIpNote(e.target.value)} placeholder="备注，例如 办公室 / 家里" />
              <button type="submit" disabled={ipLoading}>加入白名单</button>
              {ipSettings?.currentIp && <button type="button" className="ghost" onClick={() => setIpInput(ipSettings.currentIp)}>填入当前 IP</button>}
            </form>
            <div className="admin-ip-list">
              {(ipSettings?.rows || []).map((row) => <div className="admin-ip-row" key={row.id}><div><b>{row.ip}</b><span>{row.note || "无备注"}</span></div><em className={row.active ? "on" : "off"}>{row.active ? "启用" : "停用"}</em><button type="button" onClick={() => void toggleAllowedIp(row.id, !row.active)}>{row.active ? "停用" : "启用"}</button><button type="button" className="danger" onClick={() => void removeAllowedIp(row.id)}>删除</button></div>)}
              {!ipLoading && !(ipSettings?.rows || []).length && <div className="admin-empty">还没有白名单 IP。先加入当前 IP，再开启限制。</div>}
            </div>
          </section>}

          <section className="admin-panel-card admin-create-card-v249">
            <div className="admin-card-title"><div><span>CREATE ACCOUNT</span><h3>建立新账号</h3></div><em>{isOwner ? "OWNER CONTROL" : "ADMIN"}</em></div>
            <div className="admin-role-picker">
              {isOwner && <button type="button" className={newRole === "admin" ? "active" : ""} onClick={() => resetCreateRole("admin")}><b>小管理员</b><small>可继续分配后台管理权限</small></button>}
              <button type="button" className={newRole === "viewer" ? "active" : ""} onClick={() => resetCreateRole("viewer")}><b>查看账号</b><small>只有业务模块查看权限</small></button>
            </div>
            <form onSubmit={submitCreate}>
              <label>账号</label><input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder={newRole === "admin" ? "例如 manager01" : "例如 finance01"} />
              <label>初始密码</label><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="至少 8 位" />
              <label>业务模块权限</label>
              <div className="admin-permission-list">
                {BUSINESS_PERMISSION_GROUPS.map((group) => {
                  const checked = group.keys.some((key) => newPermissions[key]);
                  return <label key={group.key} className="admin-permission-row"><input type="checkbox" checked={checked} onChange={(e) => setNewPermissions((prev) => {
                    const next = { ...prev };
                    group.keys.forEach((key) => { next[key] = e.target.checked; });
                    return next;
                  })} /><span><b>{group.label}</b><small>{group.note}</small></span></label>;
                })}
              </div>
              {newRole === "admin" && isOwner && <><label>后台管理权限</label><div className="admin-permission-list management-list">{MANAGEMENT_OPTIONS.map((item) => <label key={item.key} className="admin-permission-row"><input type="checkbox" checked={newManagement[item.key]} onChange={(e) => setNewManagement((prev) => ({ ...prev, [item.key]: e.target.checked }))} /><span><b>{item.label}</b><small>{item.note}</small></span></label>)}</div></>}
              <button className="admin-primary-btn" type="submit" disabled={createBusy}>{createBusy ? "建立中..." : `建立${newRole === "admin" ? "小管理员" : "查看账号"}`}</button>

            </form>
          </section>

          <section className="admin-panel-card admin-user-list-card-v249">
            <div className="admin-card-title"><div><span>ACCOUNT DIRECTORY</span><h3>账号目录</h3><p className="admin-card-subtitle">共 {users.length} 个账号 · 当前显示 {filteredUsers.length} 个</p></div><button type="button" className="admin-light-btn" onClick={() => void loadUsers()}>刷新列表</button></div>
            <div className="admin-search-toolbar admin-user-search-toolbar">
              <div className="admin-search-field wide"><label>搜索账号 / 权限</label><input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="输入账号、角色、模块或后台权限" /></div>
              <div className="admin-search-field"><label>角色</label><select value={userRoleFilter} onChange={(e) => setUserRoleFilter(e.target.value as any)}><option value="all">全部角色</option><option value="owner">总管理员</option><option value="admin">管理员</option><option value="viewer">查看账号</option></select></div>
              <div className="admin-search-field"><label>状态</label><select value={userStatusFilter} onChange={(e) => setUserStatusFilter(e.target.value as any)}><option value="all">全部状态</option><option value="active">正常</option><option value="disabled">停用</option></select></div>
            </div>
            {loading && !users.length ? <div className="admin-empty">正在读取账号...</div> : <div className="admin-user-list-v249">
              {filteredUsers.map((user) => {
                const permissions = normalizedPermissions(user);
                const managerPermissions = normalizedManagementPermissions(user);
                const editable = canEditTarget(user);
                return <article className={`admin-user-row-v249 role-${user.role}`} key={user.auth_user_id}>
                  <div className="admin-user-row-head"><div className="admin-user-avatar">{user.username.slice(0, 1).toUpperCase()}</div><div className="admin-user-identity"><div><h4>{user.username}</h4><span className={`admin-user-role ${user.role}`}>{roleEnglish(user.role)}</span><span className={user.active ? "admin-user-state active" : "admin-user-state off"}>{user.active ? "正常" : "停用"}</span></div><p>{permissionSummary(user)}</p></div></div>
                  {editable && <div className="admin-user-edit-grid">
                    <div><span className="admin-inline-title">业务模块</span><div className="admin-user-permissions-inline">{BUSINESS_PERMISSION_GROUPS.map((group) => {
                      const checked = group.keys.some((key) => permissions[key]);
                      return <label key={group.key}><input type="checkbox" checked={checked} disabled={savingUser === user.username} onChange={(e) => {
                        const nextPermissions = { ...permissions };
                        group.keys.forEach((key) => { nextPermissions[key] = e.target.checked; });
                        void saveAccount(user, { permissions: nextPermissions });
                      }} />{group.label}</label>;
                    })}</div></div>
                    {user.role === "admin" && isOwner && <div><span className="admin-inline-title">后台管理</span><div className="admin-user-permissions-inline management">{MANAGEMENT_OPTIONS.map((item) => <label key={item.key}><input type="checkbox" checked={managerPermissions[item.key]} disabled={savingUser === user.username} onChange={(e) => void saveAccount(user, { management_permissions: { ...managerPermissions, [item.key]: e.target.checked } })} />{item.label}</label>)}</div></div>}
                    <div className="admin-user-buttons-v249"><button type="button" onClick={() => void saveAccount(user, { active: !user.active })}>{user.active ? "停用" : "启用"}</button><button type="button" onClick={() => { setResetTarget(resetTarget === user.username ? "" : user.username); setResetPassword(""); }}>重置密码</button><button className="danger" type="button" onClick={() => void removeAccount(user)}>删除账号</button></div>
                    {resetTarget === user.username && <form className="admin-inline-reset" onSubmit={submitResetPassword}><input type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} placeholder="输入新的临时密码（至少 8 位）" autoFocus /><button type="submit" disabled={savingUser === user.username}>保存新密码</button><button type="button" onClick={() => setResetTarget("")}>取消</button></form>}
                  </div>}
                  {!editable && user.role === "owner" && <div className="admin-owner-lock">唯一总管理员账号 · 不能在这里停用、删除或被其他账号修改</div>}
                </article>;
              })}
              {!filteredUsers.length && <div className="admin-empty admin-filter-empty">没有符合当前搜索条件的账号。</div>}
            </div>}
          </section>
        </div>
      )}

      {tab === "data" && canRefreshData && (
        <div className="admin-data-grid">
          <section className="admin-panel-card admin-data-hero"><div><span>DATA CONTROL</span><h3>数据同步</h3></div><button type="button" className="admin-refresh-all" disabled={Boolean(syncRunning)} onClick={() => void runAllLatest()}>{syncRunning === "all" ? "正在同步全部..." : "立即同步全部最新数据"}</button></section>

          <div className="admin-history-grid">
            <section className="admin-panel-card admin-history-card">
              <div className="admin-history-head"><div><span>THIRD PARTY HISTORY</span><h3>三方量历史补齐</h3></div><button type="button" className="admin-light-btn" onClick={() => void loadHistoryStatus()} disabled={historyLoading}>{historyLoading ? "读取中..." : "刷新进度"}</button></div>
              {historyStatus ? <><div className="admin-history-progress-line"><div style={{ width: `${Math.max(0, Math.min(100, historyStatus.completedPct || 0))}%` }} /></div><div className="admin-history-stats"><div><span>完成</span><b>{historyStatus.completed} / {historyStatus.total}</b><small>{historyStatus.completedPct.toFixed(1)}%</small></div><div><span>待补</span><b>{historyStatus.pending + historyStatus.retry}</b><small>{historyStatus.nextPendingDate || "-"}</small></div><div><span>失败</span><b>{historyStatus.failed}</b><small>{historyStatus.failed ? "需要检查" : "正常"}</small></div><div><span>写入</span><b>{historyStatus.rowsWritten.toLocaleString()}</b><small>{historyStatus.lastSyncAt ? formatTime(historyStatus.lastSyncAt) : "尚未开始"}</small></div></div><div className="admin-history-actions"><span>{historyStatus.completed === historyStatus.total && historyStatus.failed === 0 ? "✓ 已全部补齐" : "后台会继续自动补齐。"}</span><button type="button" disabled={Boolean(syncRunning)} onClick={() => void runHistoryNext()}>{syncRunning === "history_next" ? "补齐中..." : "立即补下一项"}</button></div></> : <div className="admin-history-empty">暂时没有历史进度数据。</div>}
            </section>

            <section className="admin-panel-card admin-history-card auto-withdraw-history-card">
              <div className="admin-history-head"><div><span>AUTO WITHDRAW HISTORY</span><h3>自动出款 / 操作人历史</h3></div><button type="button" className="admin-light-btn" onClick={() => void loadAutoHistoryStatus()} disabled={autoHistoryLoading}>{autoHistoryLoading ? "读取中..." : "刷新进度"}</button></div>
              {autoHistoryStatus ? <><div className="admin-history-progress-line"><div style={{ width: `${Math.max(0, Math.min(100, autoHistoryStatus.completedPct || 0))}%` }} /></div><div className="admin-history-stats"><div><span>完成</span><b>{autoHistoryStatus.completed} / {autoHistoryStatus.total}</b><small>{autoHistoryStatus.completedPct.toFixed(1)}%</small></div><div><span>待补</span><b>{autoHistoryStatus.pending + autoHistoryStatus.retry}</b><small>{autoHistoryStatus.nextPendingDate || "-"}</small></div><div><span>失败</span><b>{autoHistoryStatus.failed}</b><small>{autoHistoryStatus.failed ? "需要检查" : "正常"}</small></div><div><span>写入</span><b>{autoHistoryStatus.rowsWritten.toLocaleString()}</b><small>{autoHistoryStatus.lastSyncAt ? formatTime(autoHistoryStatus.lastSyncAt) : "尚未开始"}</small></div></div><div className="admin-history-actions"><span>{autoHistoryStatus.completed === autoHistoryStatus.total && autoHistoryStatus.failed === 0 ? "✓ 已全部补齐" : "后台会继续自动补齐。"}</span><button type="button" disabled={Boolean(syncRunning)} onClick={() => void runAutoHistoryNext()}>{syncRunning === "auto_history_next" ? "补齐中..." : "立即补下一天"}</button></div></> : <div className="admin-history-empty">暂时没有自动出款历史进度。</div>}
            </section>
          </div>

          <div className="admin-sync-section">
            <div className="admin-sync-section-title"><span>THIRD PARTY</span><h3>三方量 / 费率即时同步</h3></div>
            <section className="admin-sync-jobs">{THIRD_PARTY_SYNC_JOBS.map((job) => <div className="admin-panel-card admin-sync-job" key={job.key}><div><h4>{job.label}</h4><p>{job.note}</p></div><button type="button" disabled={Boolean(syncRunning)} onClick={() => void runJob(job.key)}>{syncRunning === job.key ? "刷新中..." : "立即刷新"}</button></div>)}</section>
          </div>

          <div className="admin-sync-section">
            <div className="admin-sync-section-title"><span>AUTO WITHDRAW</span><h3>自动出款 / 提现操作人即时同步</h3></div>
            <section className="admin-sync-jobs auto-sync-jobs">{AUTO_WITHDRAW_SYNC_JOBS.map((job) => <div className="admin-panel-card admin-sync-job" key={job.key}><div><h4>{job.label}</h4><p>{job.note}</p></div><button type="button" disabled={Boolean(syncRunning)} onClick={() => void runJob(job.key)}>{syncRunning === job.key ? "刷新中..." : "立即刷新"}</button></div>)}</section>
          </div>

          {syncProgress.length > 0 && <section className="admin-panel-card admin-sync-progress"><h4>本次执行结果</h4>{syncProgress.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}</section>}
        </div>
      )}

      {tab === "audit" && canViewAudit && (
        <section className="admin-panel-card admin-audit-card-v249">
          <div className="admin-card-title"><div><span>ADMIN AUDIT LOG</span><h3>后台操作记录</h3><p className="admin-card-subtitle">已载入 {logs.length} 条 · 当前显示 {filteredLogs.length} 条</p></div><button type="button" className="admin-light-btn" onClick={() => void loadAudit()}>刷新记录</button></div>
          <div className="admin-search-toolbar admin-audit-search-toolbar">
            <div className="admin-search-field wide"><label>搜索操作 / 调整内容</label><input value={auditKeyword} onChange={(e) => setAuditKeyword(e.target.value)} placeholder="账号、操作人、权限、角色、停用、同步任务..." /></div>
            <div className="admin-search-field"><label>动作</label><select value={auditAction} onChange={(e) => setAuditAction(e.target.value)}><option value="all">全部动作</option>{auditActionOptions.map((action) => <option key={action} value={action}>{actionLabel(action)}</option>)}</select></div>
            <div className="admin-search-field"><label>开始日期</label><input type="date" value={auditStartDate} onChange={(e) => setAuditStartDate(e.target.value)} /></div>
            <div className="admin-search-field"><label>结束日期</label><input type="date" value={auditEndDate} onChange={(e) => setAuditEndDate(e.target.value)} /></div>
            <button type="button" className="admin-clear-filter" onClick={() => { setAuditKeyword(""); setAuditAction("all"); setAuditStartDate(""); setAuditEndDate(""); }}>清除筛选</button>
          </div>
          <div className="admin-audit-table-wrap"><table className="admin-audit-table"><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>目标</th><th>调整 / 详情</th></tr></thead><tbody>{filteredLogs.map((log) => <tr key={log.id}><td>{formatTime(log.created_at)}</td><td>{log.actor_username || "system"}</td><td><span className="admin-action-chip">{actionLabel(log.action)}</span></td><td>{log.target_username || "-"}</td><td className="admin-audit-details" title={auditDetailsText(log)}>{auditDetailsText(log)}</td></tr>)}</tbody></table>{!filteredLogs.length && <div className="admin-empty">没有符合当前条件的操作记录。</div>}</div>
        </section>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="admin-inline-page">
        <div className="admin-inline-header">
          <div><span>HENSEM CONTROL</span><h1>{sectionTitle}</h1><p>{sectionSubtitle}</p></div>
          <div className="admin-inline-role"><b>{profile.username}</b><small>{roleEnglish(profile.role)} · {roleLabel(profile.role)}</small></div>
        </div>
        {message && <div className="admin-center-message">{message}</div>}
        <div className="admin-inline-content">{content}</div>
      </div>
    );
  }

  return (
    <div className="admin-inline-page standalone">
      <div className="admin-inline-header"><div><span>HENSEM CONTROL</span><h1>{sectionTitle}</h1><p>{sectionSubtitle}</p></div><button className="admin-light-btn" type="button" onClick={onClose}>返回业务后台</button></div>
      {message && <div className="admin-center-message">{message}</div>}
      <div className="admin-inline-content">{content}</div>
    </div>
  );
}
