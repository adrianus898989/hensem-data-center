"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import "./AdminControlCenter.css";
import AccountRoleEditor from "./AccountRoleEditor";
import AccountAssignedRoleDialog from "./AccountAssignedRoleDialog";
import AccountIpAdmin from "./AccountIpAdmin";
import { dashboardRoleAllows, type DashboardRoleAccess } from "@/lib/dashboardRoleAccess";
import { dashboardRolePages, dashboardRoleRequest, type DashboardCustomRole, type DashboardRoleAccount, type DashboardRoleResponse } from "@/lib/dashboardRoleClient";
import AccountPermissionDialog from "./AccountPermissionDialog";
import AccountEditorDialog from "./AccountEditorDialog";
import AccountLoginPolicy, {type AccountLoginSnapshot} from "./AccountLoginPolicy";
import { ACCOUNT_PERMISSION_MODULES, ALL_ACCOUNT_PERMISSIONS, createPermissionDraft, permissionModuleCount } from "@/lib/accountPermissionCatalog";
import { DASHBOARD_DATA_GROUPS, dashboardScopeLabel, effectiveDashboardDataScope, isDashboardDataScopeSubset, normalizeDashboardDataScope, type DashboardDataScope } from "@/lib/dashboardDataScope";
import {
  canOpenAdminCenter,
  createDashboardRoleAccount,
  DASHBOARD_PERMISSION_LABELS,
  deleteDashboardAccount,
  getDashboardHistoryStatus,
  listDashboardAudit,
  listDashboardUsers,
  normalizedManagementPermissions,
  normalizedPermissions,
  resetDashboardUserPassword,
  triggerDashboardSync,
  updateDashboardAccount,
  type DashboardAuditLog,
  type DashboardAccountPatch,
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
  section?: "accounts" | "permissions" | "ip" | "data" | "audit";
  embedded?: boolean;
  accountsOnlyLoading?: boolean;
  manualQuery?: boolean;
  roleAccess?: DashboardRoleAccess | null;
};

type Tab = "accounts" | "permissions" | "ip" | "data" | "audit";

function accountStoredScope(user: DashboardProfile): DashboardDataScope {
  return user.role === "owner" ? { mode: "all", countries: [] } : normalizeDashboardDataScope(user.data_scope);
}

function DataScopePicker({ id, value, actor, disabled, onChange }: {
  id: string; value: DashboardDataScope; actor: DashboardProfile; disabled: boolean; onChange: (value: DashboardDataScope) => void;
}) {
  const allowed = effectiveDashboardDataScope(actor);
  const choices = DASHBOARD_DATA_GROUPS.filter(group => allowed.mode === "all" || allowed.countries.includes(group.key));
  return <fieldset className="admin-data-scope-picker" disabled={disabled}>
    <legend>可见数据范围</legend>
    <p>仅限制已授权业务模块的数据，不改变模块权限。巴西与胖虎巴西分开选择。</p>
    <div className="admin-data-scope-modes">
      <label><input type="radio" name={`${id}-scope-mode`} value="all" checked={value.mode === "all"} disabled={disabled || allowed.mode !== "all"} onChange={() => onChange({ mode: "all", countries: [] })} />全部数据</label>
      <label><input type="radio" name={`${id}-scope-mode`} value="selected" checked={value.mode === "selected"} onChange={() => onChange({ mode: "selected", countries: value.mode === "selected" ? value.countries : [] })} />指定国家 / 盘口组</label>
    </div>
    {value.mode === "selected" && <div className="admin-data-scope-options">{choices.map(group => <label key={group.key}><input type="checkbox" checked={value.countries.includes(group.key)} onChange={event => onChange({ mode: "selected", countries: event.target.checked ? [...value.countries, group.key] : value.countries.filter(key => key !== group.key) })} />{group.label}</label>)}</div>}
    {value.mode === "selected" && !value.countries.length && <small role="status">请至少选择一个国家或盘口组。</small>}
    {allowed.mode !== "all" && <small>只能分配自己可见的范围。</small>}
  </fieldset>;
}

function AccountDataScopeEditor({ user, actor, busy, onSave }: {
  user: DashboardProfile; actor: DashboardProfile; busy: boolean; onSave: (patch: DashboardAccountPatch) => Promise<boolean>;
}) {
  const current = accountStoredScope(user);
  const [draft, setDraft] = useState<DashboardDataScope>(() => current);
  const [error, setError] = useState("");
  const normalized = normalizeDashboardDataScope(draft);
  const changed = JSON.stringify(normalized) !== JSON.stringify(current);
  const valid = (draft.mode === "all" || draft.countries.length > 0) && isDashboardDataScopeSubset(normalized, effectiveDashboardDataScope(actor));
  async function save() {
    if (busy || !changed || !valid) return;
    setError("");
    if (!(await onSave({ data_scope: normalized }))) setError("范围保存失败，请检查提示后重试；当前选择已保留。");
  }
  return <div className="admin-account-data-scope-editor">
    <DataScopePicker id={`edit-${user.auth_user_id}`} value={draft} actor={actor} disabled={busy} onChange={setDraft} />
    <div className="admin-data-scope-actions"><button type="button" disabled={busy || !changed || !valid} onClick={() => void save()}>{busy ? "保存中…" : "保存数据范围"}</button>{changed && <button type="button" disabled={busy} onClick={() => { setDraft(current); setError(""); }}>取消范围修改</button>}</div>
    {error && <p role="alert">{error}</p>}
  </div>;
}

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
  const previousRole = String((details as any)?.previous_role || "");
  if (previousRole && previousRole !== role && ["admin", "viewer"].includes(previousRole)) parts.push(`原角色：${roleLabel(previousRole as DashboardProfile["role"])}`);
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

export default function AdminControlCenter({ open, session, profile, onClose, section = "accounts", embedded = false, accountsOnlyLoading = false, manualQuery = false, roleAccess }: Props) {
  const management = normalizedManagementPermissions(profile);
  const isOwner = profile.role === "owner";
  const hasAllData = effectiveDashboardDataScope(profile).mode === "all";
  const actorDataScopeKey = JSON.stringify(effectiveDashboardDataScope(profile));
  const assignedActor = roleAccess?.mode === "assigned";
  const canManageUsers = isOwner || (assignedActor ? dashboardRoleAllows(roleAccess,"access") : management.manage_viewers);
  const canEnterAdmin = assignedActor ? ["access","ip","data_health","operation_logs"].some(page=>dashboardRoleAllows(roleAccess,page)) : canOpenAdminCenter(profile);
  const canViewLoginSecurity = isOwner || assignedActor && dashboardRoleAllows(roleAccess,"access");
  const canViewIp = isOwner || assignedActor && dashboardRoleAllows(roleAccess,"ip");
  const canUseAccountAction = (action: string) => roleAccess?.mode !== "assigned" || roleAccess.canView === true
    && roleAccess.permissions.includes("access.view") && roleAccess.permissions.includes("access." + action);
  const canConfigureAccount = canUseAccountAction("edit");
  const canCreateRoleAccount = isOwner || assignedActor && canUseAccountAction("create") && canConfigureAccount;
  const canOpenAccountSettings = canConfigureAccount || canUseAccountAction("reset_password") || canUseAccountAction("delete");
  const canRefreshData = hasAllData && (isOwner || (assignedActor ? dashboardRoleAllows(roleAccess,"data_health","refresh") : management.refresh_data));
  const canViewAudit = hasAllData && (isOwner || (assignedActor ? dashboardRoleAllows(roleAccess,"operation_logs") : management.view_audit));

  const [tab, setTab] = useState<Tab>(section);
  const [userRows, setUsers] = useState<DashboardProfile[]>([]);
  const [logs, setLogs] = useState<DashboardAuditLog[]>([]);
  const directoryScope = JSON.stringify([session.user.id, profile.auth_user_id, profile.active, profile.role, actorDataScopeKey, management.manage_viewers, roleAccess]);
  const [directory, setDirectory] = useState<{ scope: string; status: "idle" | "loading" | "ready" | "error"; error: string }>({ scope: "", status: "idle", error: "" });
  const [roleDirectory, setRoleDirectory] = useState<{scope: string; status: "loading" | "ready" | "error"; data?: DashboardRoleResponse}>({scope: "", status: "loading"});
  const directoryRequest = useRef({ scope: directoryScope, serial: 0 });
  if (directoryRequest.current.scope !== directoryScope) directoryRequest.current = { scope: directoryScope, serial: directoryRequest.current.serial + 1 };
  const directoryStatus = directory.scope === directoryScope ? directory.status : "idle";
  const directoryReady = directoryStatus === "ready";
  const loading = directoryStatus === "loading";
  const users = directoryReady ? userRows : [];
  useEffect(() => () => { directoryRequest.current.serial += 1; }, [directoryScope]);
  const [message, setMessage] = useState("");
  const [newRoleId, setNewRoleId] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDataScope, setNewDataScope] = useState<DashboardDataScope>(() => effectiveDashboardDataScope(profile));
  const [createBusy, setCreateBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [securityTarget,setSecurityTarget]=useState<DashboardProfile|null>(null);
  const [loginSnapshot,setLoginSnapshot]=useState<AccountLoginSnapshot>({status:"loading",states:{},failureLimit:null});
  const [editingUsername, setEditingUsername] = useState("");
  const [permissionTarget, setPermissionTarget] = useState<{ username: string; module: string } | null>(null);
  const [savingUser, setSavingUser] = useState("");
  const [resetTarget, setResetTarget] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [accountFeedback, setAccountFeedback] = useState<Record<string, { tone: "success" | "error"; text: string }>>({});
  const [syncRunning, setSyncRunning] = useState<ManualSyncJob | "all" | "">("");
  const [syncProgress, setSyncProgress] = useState<string[]>([]);
  const [historyStatus, setHistoryStatus] = useState<HistoryBackfillStatus | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [autoHistoryStatus, setAutoHistoryStatus] = useState<HistoryBackfillStatus | null>(null);
  const [autoHistoryLoading, setAutoHistoryLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [userScopeFilter, setUserScopeFilter] = useState("all");
  const [userRoleFilter, setUserRoleFilter] = useState<"all" | DashboardProfile["role"]>("all");
  const [userStatusFilter, setUserStatusFilter] = useState<"all" | "active" | "disabled" | "locked">("all");
  const [auditKeyword, setAuditKeyword] = useState("");
  const [auditAction, setAuditAction] = useState("all");
  const [auditStartDate, setAuditStartDate] = useState("");
  const [auditEndDate, setAuditEndDate] = useState("");

  const stats = useMemo(() => ({
    owners: users.filter((u) => u.role === "owner").length,
    admins: users.filter((u) => u.role === "admin").length,
    viewers: users.filter((u) => u.role === "viewer").length,
    disabled: users.filter((u) => !u.active).length,
  }), [users]);

  function accountRoleDisplay(user: DashboardProfile) {
    if (user.role === "owner") return {label: roleLabel(user.role), detail: "OWNER · 固定权限", summary: permissionSummary(user)};
    const identity = `系统身份：${roleEnglish(user.role)}`;
    const data = roleDirectory.scope === directoryScope && roleDirectory.status === "ready" ? roleDirectory.data : undefined;
    const account = data?.accounts?.find(account => account.auth_user_id === user.auth_user_id && account.username === user.username && account.role === user.role);
    if (account?.role_id === null) return {label: "未分配角色", detail: `${identity} · 账号独立授权`, summary: permissionSummary(user)};
    const role = account?.role_id ? data?.roles?.find(role => role.id === account.role_id) : undefined;
    if (role) return {label: role.name, detail: `${identity} · ${role.active ? "角色授权" : "角色已停用"}`,
      summary: role.active ? `角色配置：${role.permissions.filter(code => code.endsWith(".view")).length} 个目录 · ${role.permissions.length} 项权限` : "角色已停用"};
    const unavailable = roleDirectory.scope === directoryScope && roleDirectory.status === "error";
    return {label: roleLabel(user.role), detail: identity, summary: unavailable ? "角色读取失败，请刷新列表" : "角色待核对"};
  }

  function accountRoleEntry(user: DashboardProfile) {
    const data=roleDirectory.scope===directoryScope&&roleDirectory.status==="ready"?roleDirectory.data:undefined;
    return data?.accounts?.find(account=>account.auth_user_id===user.auth_user_id&&account.username===user.username&&account.role===user.role);
  }
  function accountAssignedRole(user: DashboardProfile): DashboardCustomRole | undefined {
    const data=roleDirectory.scope===directoryScope&&roleDirectory.status==="ready"?roleDirectory.data:undefined;
    const account=accountRoleEntry(user);
    return account?.role_id?data?.roles?.find(role=>role.id===account.role_id):undefined;
  }
  function accountRoleVerified(user: DashboardProfile) {
    const account=accountRoleEntry(user);
    return Boolean(account && (account.role_id===null || accountAssignedRole(user)));
  }
  function assignedModuleCount(role: DashboardCustomRole,moduleId:string) {
    const codes=dashboardRolePages.filter(page=>page.moduleId===moduleId).flatMap(page=>page.actions.map(action=>page.id+"."+action.id));
    return {enabled:role.active?codes.filter(code=>role.permissions.includes(code)).length:0,total:codes.length};
  }

  const filteredUsers = useMemo(() => {
    const keyword = userSearch.trim().toLowerCase();
    return users.filter((user) => {
      if (userScopeFilter !== "all") {
        const scope = accountStoredScope(user);
        if (scope.mode !== "all" && !scope.countries.some(code => code === userScopeFilter)) return false;
      }
      if (userRoleFilter !== "all" && user.role !== userRoleFilter) return false;
      if (userStatusFilter === "active" && !user.active) return false;
      if (userStatusFilter === "disabled" && user.active) return false;
      if (userStatusFilter === "locked" && (loginSnapshot.status !== "ready" || !loginSnapshot.states[user.auth_user_id]?.locked)) return false;
      if (!keyword) return true;
      const haystack = [
        user.username,
        roleLabel(user.role),
        roleEnglish(user.role),
        accountRoleDisplay(user).label,
        accountRoleDisplay(user).summary,
        dashboardScopeLabel(accountStoredScope(user)),
      ].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [users, userSearch, userRoleFilter, userStatusFilter, userScopeFilter, loginSnapshot, roleDirectory, directoryScope, isOwner]);

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
    if (!canUseAccountAction("view") || !open || !profile.active || profile.auth_user_id !== session.user.id || !canEnterAdmin || directoryRequest.current.scope !== directoryScope) return;
    const serial = ++directoryRequest.current.serial;
    const current = () => directoryRequest.current.scope === directoryScope && directoryRequest.current.serial === serial;
    setDirectory({ scope: directoryScope, status: "loading", error: "" });
    setRoleDirectory({scope: directoryScope, status: "loading"});
    try {
      const rowsRequest = listDashboardUsers(session);
      // Server returns only the caller-authorized account roster; metadata grants no actions.
      if (canManageUsers) void dashboardRoleRequest(session, {operation: "list"}).then(data => {
        if (current()) setRoleDirectory({scope: directoryScope, status: "ready", data});
      }).catch(() => {
        if (current()) setRoleDirectory({scope: directoryScope, status: "error"});
      });
      const rows = await rowsRequest;
      if (!current()) return;
      setUsers(rows); setDirectory({ scope: directoryScope, status: "ready", error: "" });
    } catch (error) {
      if (!current()) return;
      setUsers([]); setDirectory({ scope: directoryScope, status: "error", error: error instanceof Error ? error.message : "读取账号失败，请重试。" });
    }
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

  useEffect(() => {
    if (!open || manualQuery || !canEnterAdmin) return;
    setMessage("");
    void loadUsers();
    if (!accountsOnlyLoading && canViewAudit) void loadAudit();
    if (!accountsOnlyLoading && canRefreshData) { void loadHistoryStatus(); void loadAutoHistoryStatus(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile.role, manualQuery, directoryScope]);

  useEffect(() => { setNewRoleId(""); setNewUsername(""); setNewPassword(""); setCreateOpen(false); }, [directoryScope]);

  useEffect(() => {
    setTab(section);
    setPermissionTarget(null);
    setEditingUsername("");
    setResetTarget("");
    setResetPassword("");
    setCreateOpen(false);
  }, [section]);

  useEffect(() => { setNewDataScope(JSON.parse(actorDataScopeKey) as DashboardDataScope); }, [profile.auth_user_id, actorDataScopeKey]);

  const creationRolesReady = roleDirectory.scope === directoryScope && roleDirectory.status === "ready";
  const creationRoles = creationRolesReady ? (roleDirectory.data?.roles || []).filter(role => role.active
    && (isOwner || assignedActor && role.permissions.every(permission => roleAccess.permissions.includes(permission)))) : [];
  const selectedCreationRole = creationRoles.find(role => role.id === newRoleId);
  const selectedCreationPages = selectedCreationRole ? dashboardRolePages.filter(page => selectedCreationRole.permissions.includes(page.id + ".view")) : [];

  if (!open || !canEnterAdmin) return null;

  function closeCreate() {
    if (createBusy) return;
    setCreateOpen(false);
    setNewUsername("");
    setNewPassword("");
    setNewRoleId("");
    setNewDataScope(effectiveDashboardDataScope(profile));
    setMessage("");
  }

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!canCreateRoleAccount || createBusy) return;
    const selectedRole = creationRoles.find(role => role.id === newRoleId);
    if (!selectedRole) { setMessage("请明确选择已启用的新版角色；如角色已变更，请刷新角色列表。"); return; }
    const creatingScope = directoryScope;
    if (newDataScope.mode === "selected" && !newDataScope.countries.length) { setMessage("请至少选择一个可见国家或盘口组。"); return; }
    if (!isDashboardDataScopeSubset(newDataScope, effectiveDashboardDataScope(profile))) { setMessage("不能授予超出自己可见数据范围的权限。"); return; }
    setCreateBusy(true);
    setMessage("");
    try {
      const result = await createDashboardRoleAccount(session, newUsername, newPassword, {id:selectedRole.id,version:selectedRole.version}, newDataScope);
      if (directoryRequest.current.scope !== creatingScope) return;
      setMessage(`${result.account.username} 已建立，角色：${result.account.role_name}。`);
      setNewUsername("");
      setNewPassword("");
      setNewRoleId("");
      setNewDataScope(effectiveDashboardDataScope(profile));
      setCreateOpen(false);
      await Promise.all([loadUsers(), canViewAudit ? loadAudit() : Promise.resolve()]);
    } catch (error) {
      if (directoryRequest.current.scope === creatingScope) setMessage(error instanceof Error ? error.message : "建立账号失败");
    } finally { setCreateBusy(false); }
  }

  function canEditTarget(user: DashboardProfile) {
    if (user.role === "owner") return false;
    if (!profile.active || !isDashboardDataScopeSubset(accountStoredScope(user), effectiveDashboardDataScope(profile))) return false;
    if (user.role === "admin") return isOwner;
    if (!isOwner && user.auth_user_id === session.user.id) return false;
    if (assignedActor && !accountRoleVerified(user)) return false;
    const assigned = accountAssignedRole(user);
    if (assignedActor && assigned && !assigned.permissions.every(code => roleAccess.permissions.includes(code))) return false;
    return canManageUsers;
  }

  async function saveAccount(user: DashboardProfile, patch: DashboardAccountPatch): Promise<boolean> {
    if (!canConfigureAccount || typeof patch.active === "boolean" && !canUseAccountAction("status") || !canEditTarget(user) || savingUser || (patch.role && !isOwner)) return false;
    if (patch.data_scope && (!isDashboardDataScopeSubset(patch.data_scope, effectiveDashboardDataScope(profile)) || patch.data_scope.mode === "selected" && !patch.data_scope.countries.length)) return false;
    setSavingUser(user.username);
    setMessage("");
    try {
      await updateDashboardAccount(session, user.username, patch);
      setMessage(patch.role ? `${user.username} 已改为${roleLabel(patch.role)}。该账号刷新页面或重新登录后可看到新权限。` : `${user.username} 已更新。`);
      await Promise.all([loadUsers(), canViewAudit ? loadAudit() : Promise.resolve()]);
      return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "更新失败"); return false; }
    finally { setSavingUser(""); }
  }

  async function submitResetPassword(event: React.FormEvent) {
    event.preventDefault();
    if (!canUseAccountAction("reset_password") || savingUser || !users.some(user => user.username === resetTarget && canEditTarget(user))) return;
    const username = resetTarget;
    setSavingUser(username);
    setMessage("");
    setAccountFeedback((current) => {
      const next = { ...current };
      delete next[username];
      return next;
    });
    try {
      await resetDashboardUserPassword(session, username, resetPassword);
      setMessage(`${username} 密码已重置。`);
      setAccountFeedback((current) => ({ ...current, [username]: { tone: "success", text: "密码已重置成功。请让该账号使用新密码重新登录。" } }));
      setResetTarget("");
      setResetPassword("");
      if (canViewAudit) await loadAudit();
    } catch (error) {
      const text = error instanceof Error ? error.message : "重置密码失败";
      setMessage(text);
      setAccountFeedback((current) => ({ ...current, [username]: { tone: "error", text: `密码重置失败：${text}` } }));
    }
    finally { setSavingUser(""); }
  }

  async function removeAccount(user: DashboardProfile) {
    if (!canUseAccountAction("delete") || savingUser || !canEditTarget(user)) return;
    if (!window.confirm(`确定删除账号 ${user.username}？删除后该账号立即无法登录。`)) return;
    setSavingUser(user.username);
    setMessage("");
    try {
      await deleteDashboardAccount(session, user.username);
      setMessage(`${user.username} 已删除。`);
      if (editingUsername === user.username) setEditingUsername("");
      if (resetTarget === user.username) { setResetTarget(""); setResetPassword(""); }
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

  const sectionTitle = tab === "accounts"
    ? "账号管理"
    : tab === "permissions"
      ? "权限管理"
      : tab === "ip"
        ? "IP 白名单"
        : tab === "data"
          ? "数据同步"
          : "操作记录";
  const sectionSubtitle = tab === "accounts"
    ? "建立账号，管理角色、启停状态、数据范围与密码。"
    : tab === "permissions"
      ? "按账号独立配置模块、页面和具体操作权限。"
      : tab === "ip"
        ? "按角色授权管理全局或指定账号的可信 IP。"
        : tab === "data"
          ? "同步状态与手动刷新。"
          : "后台操作与调整记录。";

  const content = (
    <>
      {!hasAllData && <div className="admin-scope-restriction" role="status">当前账号可见：{dashboardScopeLabel(effectiveDashboardDataScope(profile))}。只能管理此范围内的查看账号；全局数据同步、操作记录和安全设置不可用。</div>}
      {tab === "ip" && canViewIp && <AccountIpAdmin session={session}/>}

      {(tab === "accounts" || tab === "permissions") && (canManageUsers || isOwner) && (
        <div className="admin-users-compact">
          <section className="admin-panel-card admin-account-directory admin-permission-directory">
            <div className="admin-account-directory-head">
              <div>{tab === "accounts" ? <><h3>账号列表</h3><p>建立账号，管理角色、启停状态、数据范围与密码。</p></> : <><h3>按模块、页面和具体操作配置权限</h3><p>新版角色账号按角色目录授权；未分配角色的账号保留独立模块授权。</p></>}</div>
              <div className="admin-account-toolbar-actions"><button type="button" className="admin-light-btn" disabled={loading || !canUseAccountAction("view")} onClick={() => void loadUsers()}>{loading ? "读取中…" : manualQuery && !directoryReady ? "查询账号" : "刷新列表"}</button>{tab === "accounts" && <button type="button" className="admin-account-create-toggle" aria-haspopup="dialog" disabled={loading || Boolean(savingUser) || !canCreateRoleAccount} onClick={() => { if (!canCreateRoleAccount) return; setMessage(""); setNewRoleId(""); setCreateOpen(true); if (!creationRolesReady) void loadUsers(); }}>+ 新建账号</button>}</div>
            </div>
            {tab === "permissions" ? <div className="admin-permission-overview"><div><b>{directoryReady ? users.length : "—"}</b> 当前账号</div><div><b>{ACCOUNT_PERMISSION_MODULES.length}</b> 权限模块</div><div><b>{ALL_ACCOUNT_PERMISSIONS.length}</b> 权限项</div><div><b>{ALL_ACCOUNT_PERMISSIONS.filter((item) => item.kind === "management").length}</b> 后台权限</div><span>权限项与现有系统一致，不新增授权范围</span></div> : <div className="admin-permission-overview admin-account-overview"><div><b>{directoryReady ? users.length : "—"}</b> 全部账号</div><div><b>{directoryReady ? stats.owners : "—"}</b> 总管理员</div><div><b>{directoryReady ? stats.admins : "—"}</b> 管理员</div><div><b>{directoryReady ? stats.viewers : "—"}</b> 查看账号</div><div><b>{directoryReady ? stats.disabled : "—"}</b> 已停用</div></div>}
          {tab === "accounts" && createOpen && canCreateRoleAccount && <AccountEditorDialog title="新建后台账号" busy={createBusy} onClose={closeCreate} bodyClassName="admin-users-compact"><section id="admin-create-account" className="admin-create-card-v249 admin-account-create-panel">
            {message && <p role="alert" className="admin-account-feedback error">{message}</p>}
            <fieldset disabled={createBusy}>
            <form onSubmit={submitCreate}>
              <div className="admin-account-create-fields"><div><label htmlFor="admin-new-username">账号</label><input id="admin-new-username" autoComplete="off" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="例如 finance01" autoFocus /></div>
              <div><label htmlFor="admin-new-password">初始密码</label><input id="admin-new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="至少 8 位" /></div></div>
              <label htmlFor="admin-new-role">新版角色</label>
              <div className="admin-account-role-create-row"><select id="admin-new-role" value={newRoleId} disabled={!creationRolesReady} onChange={event => setNewRoleId(event.target.value)}>
                <option value="">{creationRolesReady ? "请选择角色" : roleDirectory.status === "error" ? "角色读取失败，请刷新" : "正在读取新版角色…"}</option>
                {creationRoles.map(role => <option key={role.id} value={role.id}>{role.name} · {role.permissions.length} 项权限</option>)}
              </select>
              <button type="button" className="admin-light-btn" disabled={createBusy || loading} onClick={() => void loadUsers()}>刷新角色</button></div>
              <p className="admin-account-edit-hint" role="status">{selectedCreationRole ? selectedCreationRole.permissions.length
                ? `${selectedCreationRole.name}：${selectedCreationPages.length} 个页面、${selectedCreationRole.permissions.length} 项权限；后续随该角色统一更新。`
                : `${selectedCreationRole.name}：0 项权限。账号保持启用，角色开放权限后才能进入相应页面。`
                : "请明确选择新版角色，账号权限与该角色同步。"}</p>
              {selectedCreationPages.length > 0 && <div className="admin-account-permission-summary">{selectedCreationPages.map(page => page.label).join(" / ")}</div>}
              <DataScopePicker id="new-account" value={newDataScope} actor={profile} disabled={createBusy} onChange={setNewDataScope} />
              <button className="admin-primary-btn" type="submit" disabled={createBusy || !selectedCreationRole || newDataScope.mode === "selected" && !newDataScope.countries.length}>{createBusy ? "建立中..." : "建立后台账号"}</button>

              <button type="button" className="admin-light-btn admin-create-cancel" onClick={closeCreate}>取消</button>
            </form></fieldset>
          </section></AccountEditorDialog>}

            {tab === "accounts" && canViewLoginSecurity && directoryReady && <AccountLoginPolicy session={session} surface="dashboard" target={securityTarget?{id:securityTarget.auth_user_id,username:securityTarget.username,active:securityTarget.active}:null} onClose={()=>setSecurityTarget(null)} onSnapshot={setLoginSnapshot}/>}
            <div className="admin-search-toolbar admin-user-search-toolbar">
              <div className="admin-search-field wide"><label>{tab === "accounts" ? "搜索账号" : "搜索账号 / 权限"}</label><input aria-label="后台账号搜索" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder={tab === "accounts" ? "输入账号、角色、系统身份或数据范围" : "输入账号、角色、模块或后台权限"} /></div>
              <div className="admin-search-field"><label>系统身份</label><select aria-label="后台账号系统身份筛选" value={userRoleFilter} onChange={(e) => setUserRoleFilter(e.target.value as any)}><option value="all">全部身份</option><option value="owner">总管理员</option><option value="admin">管理员</option><option value="viewer">查看账号</option></select></div>
              <div className="admin-search-field"><label>数据范围</label><select aria-label="后台账号数据范围筛选" value={userScopeFilter} onChange={e => setUserScopeFilter(e.target.value)}><option value="all">全部范围</option>{DASHBOARD_DATA_GROUPS.filter(group => users.some(user => { const scope = accountStoredScope(user); return scope.mode === "all" || scope.countries.includes(group.key); })).map(group => <option key={group.key} value={group.key}>{group.label}</option>)}</select></div>
              <div className="admin-search-field"><label>状态</label><select aria-label="后台账号状态筛选" value={userStatusFilter} onChange={(e) => setUserStatusFilter(e.target.value as any)}><option value="all">全部状态</option><option value="active">正常</option><option value="disabled">停用</option>{tab === "accounts" && canViewLoginSecurity && <option value="locked" disabled={loginSnapshot.status!=="ready"}>自动锁定</option>}</select></div>
              <button type="button" className="admin-light-btn" onClick={() => { setUserSearch(""); setUserRoleFilter("all"); setUserStatusFilter("all"); setUserScopeFilter("all"); }}>重置筛选</button>
            </div>
            <div className="admin-permission-table-meta"><span>{directoryReady ? `显示 ${filteredUsers.length} / ${users.length} 个账号` : loading ? "正在读取账号…" : directoryStatus === "error" ? "账号读取失败" : "尚未查询账号"}</span>{tab === "permissions" && <div className="admin-permission-legend"><span className="all">全部已开</span><span className="partial">部分已开</span><span className="none">未开</span></div>}</div>
            {!directoryReady ? <div className="admin-empty" role={directoryStatus === "error" ? "alert" : "status"}>{loading ? "正在读取账号…" : directoryStatus === "error" ? directory.error : "点击「查询账号」读取现有后台账号。"}</div> : <div className="admin-account-table-wrap"><table className={`admin-account-table ${tab === "permissions" ? "admin-permission-matrix" : "admin-account-management-table"}`}><thead><tr><th scope="col">账号 / 角色</th><th scope="col">{tab === "permissions" ? "模块权限 · 已开 / 权限总数" : "数据范围 / 当前权限"}</th><th scope="col">操作</th></tr></thead><tbody>
              {filteredUsers.map((user) => {
                const draft = createPermissionDraft(user);
                const customRole = accountAssignedRole(user);
                const roleUnverified = canManageUsers && user.role !== "owner" && !accountRoleVerified(user);
                const enabled = customRole ? customRole.active ? customRole.permissions.length : 0 : ALL_ACCOUNT_PERMISSIONS.filter((item) => draft[item.id]).length;
                const permissionTotal = customRole ? dashboardRolePages.flatMap(page=>page.actions).length : ALL_ACCOUNT_PERMISSIONS.length;
                const editable = canEditTarget(user);
                const canConfigureTargetRole = editable && (!customRole || isOwner || assignedActor);
                const expanded = tab === "accounts" && editable && canOpenAccountSettings && editingUsername === user.username;
                const editId = `admin-account-edit-${user.auth_user_id}`;
                return <Fragment key={user.auth_user_id}><tr className={expanded ? "is-editing" : ""}>
                  <th scope="row"><div className="admin-matrix-identity"><div><strong>{user.username}</strong>{user.role === "owner" && <span className="admin-matrix-protected">锁定</span>}</div><div className="admin-matrix-identity-meta"><span className={`admin-user-role ${user.role}`}>{accountRoleDisplay(user).label}</span><span className={user.active ? "admin-user-state active" : "admin-user-state off"}>{user.active ? "正常" : "停用"}</span></div><small>{accountRoleDisplay(user).detail}</small>{tab === "accounts" && canViewLoginSecurity && <small>{loginSnapshot.status==="ready"&&loginSnapshot.states[user.auth_user_id]?`${loginSnapshot.states[user.auth_user_id].locked?"自动锁定 · ":""}失败 ${loginSnapshot.states[user.auth_user_id].failed_count} / ${loginSnapshot.states[user.auth_user_id].failure_limit??loginSnapshot.failureLimit??"—"}`:"登录状态待读取"}</small>}</div></th>
                  <td><div className="admin-account-scope-summary" title={dashboardScopeLabel(accountStoredScope(user))}><b>数据范围</b><span>{dashboardScopeLabel(accountStoredScope(user))}</span></div>{tab === "permissions" && !roleUnverified ? <div className="admin-module-permission-grid">{(customRole?Array.from(new Map(dashboardRolePages.map(page=>[page.moduleId,{id:page.moduleId,label:page.moduleLabel}])).values()):ACCOUNT_PERMISSION_MODULES).map((module) => {
                    const count = customRole ? assignedModuleCount(customRole,module.id) : permissionModuleCount(ACCOUNT_PERMISSION_MODULES.find(entry=>entry.id===module.id)!, draft);
                    const state = count.enabled === count.total ? "all" : count.enabled === 0 ? "none" : "partial";
                    return <button type="button" key={module.id} className={`admin-module-permission-chip ${state} module-${module.id}`} aria-label={`${user.username} · ${module.label}，已开 ${count.enabled} / ${count.total} 项，查看权限`} aria-haspopup="dialog" disabled={!canConfigureAccount} onClick={() => canConfigureAccount && setPermissionTarget({ username: user.username, module: module.id })}><span>{module.label}</span><b>{count.enabled}<small>/{count.total}</small></b></button>;
                  })}</div> : <div className="admin-account-permission-summary">{accountRoleDisplay(user).summary}</div>}</td>
                  <td><div className="admin-matrix-actions">{tab === "permissions" ? <><span className="admin-matrix-total">{roleUnverified ? "—" : enabled}<small> / {roleUnverified ? "—" : permissionTotal}</small></span><button type="button" className="admin-matrix-configure" aria-haspopup="dialog" disabled={!canConfigureAccount} onClick={() => canConfigureAccount && setPermissionTarget({ username: user.username, module: "home" })}>{canConfigureTargetRole ? "配置权限" : user.role === "owner" ? "查看固定权限" : "查看权限"}</button></> : editable ? <button type="button" className="admin-matrix-configure" aria-haspopup="dialog" disabled={!canOpenAccountSettings} onClick={() => { if (!canOpenAccountSettings) return; setSecurityTarget(null); setMessage(""); setEditingUsername(user.username); setResetTarget(""); setResetPassword(""); }}>账号设置</button> : <span className="admin-account-readonly">固定账号</span>}{tab === "accounts" && accountsOnlyLoading && <button type="button" className="admin-matrix-configure" aria-haspopup="dialog" disabled={!canConfigureAccount} onClick={() => canConfigureAccount && setPermissionTarget({ username: user.username, module: "home" })}>{canConfigureTargetRole ? "配置权限" : "查看权限"}</button>}{tab === "accounts" && canViewLoginSecurity && <button type="button" className="admin-matrix-configure" aria-haspopup="dialog" disabled={Boolean(savingUser)||loading||!isOwner&&!canEditTarget(user)} onClick={()=>{setEditingUsername("");setResetTarget("");setResetPassword("");setPermissionTarget(null);setSecurityTarget(user)}}>登录安全</button>}</div></td>
                </tr>
                  {expanded && <AccountEditorDialog title={"后台账号设置 · " + user.username} busy={Boolean(savingUser)} onClose={() => { setEditingUsername(""); setResetTarget(""); setResetPassword(""); }} bodyClassName="admin-users-compact"><div id={editId} className="admin-user-edit-grid admin-account-editor">
                    {message && <p role="status" className="admin-account-feedback">{message}</p>}
                    <div className="admin-account-edit-hint"><strong>{user.username} · 账号设置</strong><span>{savingUser === user.username ? "正在保存…" : accountsOnlyLoading ? "启停、数据范围和密码在这里管理；目录权限点击本行「配置权限」" : "启停、数据范围和密码在这里管理；模块权限请前往左侧「权限管理」"}</span></div>
                    {canConfigureAccount && isOwner && user.role !== "owner" && accountRoleVerified(user) && !accountAssignedRole(user) && <AccountRoleEditor key={`${user.auth_user_id}:${user.role}`} user={user} busy={Boolean(savingUser)} onSave={(patch) => saveAccount(user, patch)} />}
                    {canConfigureAccount && <AccountDataScopeEditor key={`scope-${user.auth_user_id}:${user.updated_at || "legacy"}`} user={user} actor={profile} busy={Boolean(savingUser)} onSave={(patch) => saveAccount(user, patch)} />}
                    <div className="admin-user-buttons-v249"><button type="button" disabled={savingUser === user.username || !canConfigureAccount || !canUseAccountAction("status")} onClick={() => void saveAccount(user, { active: !user.active })}>{user.active ? "停用" : "启用"}</button><button type="button" disabled={savingUser === user.username || !canUseAccountAction("reset_password")} onClick={() => { if (!canUseAccountAction("reset_password")) return; setResetTarget(resetTarget === user.username ? "" : user.username); setResetPassword(""); }}>重置密码</button><button className="danger" type="button" disabled={savingUser === user.username || !canUseAccountAction("delete")} onClick={() => void removeAccount(user)}>删除账号</button></div>
                    {canUseAccountAction("reset_password") && resetTarget === user.username && <form className="admin-inline-reset" onSubmit={submitResetPassword}><input type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} placeholder="输入新的临时密码（至少 8 位）" autoFocus /><button type="submit" disabled={savingUser === user.username}>保存新密码</button><button type="button" onClick={() => setResetTarget("")}>取消</button></form>}
                    {accountFeedback[user.username] && <p className={`admin-account-feedback ${accountFeedback[user.username].tone}`} role={accountFeedback[user.username].tone === "error" ? "alert" : "status"}>{accountFeedback[user.username].text}</p>}
                  </div></AccountEditorDialog>}
                </Fragment>;
              })}
              {!filteredUsers.length && <tr><td colSpan={3}><div className="admin-empty admin-filter-empty">{users.length ? "没有符合当前搜索条件的账号。" : "当前可管理范围内没有后台账号。"}</div></td></tr>}
            </tbody></table></div>}
          </section>
          {(tab === "permissions" || accountsOnlyLoading) && canConfigureAccount && permissionTarget && users.filter((user) => user.username === permissionTarget.username).map((user) => {
            const account=accountRoleEntry(user);
            if (canManageUsers && user.role!=="owner" && !accountRoleVerified(user)) return <AccountEditorDialog title={"目录权限 · "+user.username} onClose={()=>setPermissionTarget(null)}><p role="alert">角色读取尚未完成，请刷新列表后再配置。</p></AccountEditorDialog>;
            if (account?.role_id || assignedActor) return account ? <AccountAssignedRoleDialog key={account.auth_user_id+":"+account.assignment_version} session={session} account={account} roles={roleDirectory.data?.roles||[]} roleAccess={roleAccess} isOwner={isOwner} editable={canEditTarget(user)&&(isOwner||assignedActor)} onSaved={()=>loadUsers()} onClose={()=>setPermissionTarget(null)}/> : <AccountEditorDialog title={"目录权限 · "+user.username} onClose={()=>setPermissionTarget(null)}><p role="alert">角色读取尚未完成，请刷新列表后再配置。</p></AccountEditorDialog>;
            return <AccountPermissionDialog key={`${user.auth_user_id}:${user.role}`} actor={profile} user={user} initialModule={permissionTarget.module} busy={Boolean(savingUser)} onSave={(patch) => saveAccount(user, patch)} onClose={() => setPermissionTarget(null)} />;
          })}
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
        {!accountsOnlyLoading && <div className="admin-inline-header">
          <div><span>HENSEM CONTROL</span><h1>{sectionTitle}</h1><p>{sectionSubtitle}</p></div>
          <div className="admin-inline-role"><b>{profile.username}</b><small>{roleEnglish(profile.role)} · {roleLabel(profile.role)}</small></div>
        </div>}
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
