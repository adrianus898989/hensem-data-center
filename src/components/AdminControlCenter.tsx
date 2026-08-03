"use client";

import { useEffect, useMemo, useState } from "react";
import {
  canOpenAdminCenter,
  createDashboardAccount,
  DASHBOARD_PERMISSION_LABELS,
  DEFAULT_ADMIN_MANAGEMENT_PERMISSIONS,
  DEFAULT_ADMIN_PERMISSIONS,
  DEFAULT_VIEWER_PERMISSIONS,
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

const SYNC_JOBS: Array<{ key: ManualSyncJob; label: string; note: string }> = [
  { key: "today_collect", label: "今日代收", note: "小时安全增量同步" },
  { key: "today_payout", label: "今日代付", note: "小时安全增量同步" },
  { key: "yesterday_collect", label: "昨日代收", note: "补齐延迟录入平台" },
  { key: "yesterday_payout", label: "昨日代付", note: "补齐延迟录入平台" },
  { key: "rates", label: "费率 / 盘口", note: "同步最新费率与盘口状态" },
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
  const business = DASHBOARD_PERMISSION_LABELS.filter((item) => p[item.key]).map((item) => item.label);
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
  };
  return labels[action] || action;
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

  const stats = useMemo(() => ({
    owners: users.filter((u) => u.role === "owner").length,
    admins: users.filter((u) => u.role === "admin").length,
    viewers: users.filter((u) => u.role === "viewer").length,
    disabled: users.filter((u) => !u.active).length,
  }), [users]);

  async function loadUsers() {
    setLoading(true);
    try { setUsers(await listDashboardUsers(session)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "读取账号失败"); }
    finally { setLoading(false); }
  }

  async function loadAudit() {
    if (!canViewAudit) return;
    try { setLogs(await listDashboardAudit(session, 80)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "读取操作记录失败"); }
  }

  async function loadHistoryStatus() {
    if (!canRefreshData) return;
    setHistoryLoading(true);
    try { setHistoryStatus(await getDashboardHistoryStatus(session)); }
    catch { setHistoryStatus(null); }
    finally { setHistoryLoading(false); }
  }

  useEffect(() => {
    if (!open || !canOpenAdminCenter(profile)) return;
    setMessage("");
    void loadUsers();
    if (canViewAudit) void loadAudit();
    if (canRefreshData) void loadHistoryStatus();
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
    setSyncProgress([`正在刷新：${SYNC_JOBS.find((item) => item.key === job)?.label || job}`]);
    setMessage("");
    try {
      const result = await triggerDashboardSync(session, job);
      const written = result?.result?.written;
      const suffix = written?.volume ? `，写入 ${written.volume} 行` : written?.rates ? `，费率 ${written.rates} / 盘口 ${written.platformStatuses}` : "";
      setSyncProgress([`${SYNC_JOBS.find((item) => item.key === job)?.label || job}：完成${suffix}`]);
      if (canViewAudit) await loadAudit();
    } catch (error) {
      setSyncProgress([`${SYNC_JOBS.find((item) => item.key === job)?.label || job}：${error instanceof Error ? error.message : "失败"}`]);
    } finally { setSyncRunning(""); }
  }

  async function runAllLatest() {
    if (!canRefreshData) return;
    setSyncRunning("all");
    const lines: string[] = [];
    setSyncProgress([]);
    for (const job of SYNC_JOBS) {
      setSyncProgress([...lines, `正在刷新：${job.label}...`]);
      try {
        const result = await triggerDashboardSync(session, job.key);
        const written = result?.result?.written;
        const suffix = written?.volume ? `（${written.volume} 行）` : written?.rates ? `（费率 ${written.rates} / 盘口 ${written.platformStatuses}）` : "";
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

  const sectionTitle = tab === "users" ? "账号与权限" : tab === "data" ? "数据同步" : "操作记录";
  const sectionSubtitle = tab === "users"
    ? "建立账号、分配业务模块与后台权限；只有 Owner 可以管理小管理员。"
    : tab === "data"
      ? "查看历史补齐进度，并在需要时立即同步今日、昨日或最新费率。"
      : "查看账号建立、权限修改、密码重置、删除账号与手动同步记录。";

  const content = (
    <>
      {tab === "users" && (canManageUsers || isOwner) && (
        <div className="admin-users-layout-v249">
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
                {DASHBOARD_PERMISSION_LABELS.map((item) => <label key={item.key} className="admin-permission-row"><input type="checkbox" checked={newPermissions[item.key]} onChange={(e) => setNewPermissions((prev) => ({ ...prev, [item.key]: e.target.checked }))} /><span><b>{item.label}</b><small>{item.note}</small></span></label>)}
              </div>
              {newRole === "admin" && isOwner && <><label>后台管理权限</label><div className="admin-permission-list management-list">{MANAGEMENT_OPTIONS.map((item) => <label key={item.key} className="admin-permission-row"><input type="checkbox" checked={newManagement[item.key]} onChange={(e) => setNewManagement((prev) => ({ ...prev, [item.key]: e.target.checked }))} /><span><b>{item.label}</b><small>{item.note}</small></span></label>)}</div></>}
              <button className="admin-primary-btn" type="submit" disabled={createBusy}>{createBusy ? "建立中..." : `建立${newRole === "admin" ? "小管理员" : "查看账号"}`}</button>
              <p className="admin-form-note">小管理员不能建立其他管理员；只有总管理员可以建立 / 删除 / 修改小管理员。</p>
            </form>
          </section>

          <section className="admin-panel-card admin-user-list-card-v249">
            <div className="admin-card-title"><div><span>ACCOUNT DIRECTORY</span><h3>账号目录</h3></div><button type="button" className="admin-light-btn" onClick={() => void loadUsers()}>刷新列表</button></div>
            {loading && !users.length ? <div className="admin-empty">正在读取账号...</div> : <div className="admin-user-list-v249">
              {users.map((user) => {
                const permissions = normalizedPermissions(user);
                const managerPermissions = normalizedManagementPermissions(user);
                const editable = canEditTarget(user);
                return <article className={`admin-user-row-v249 role-${user.role}`} key={user.auth_user_id}>
                  <div className="admin-user-row-head"><div className="admin-user-avatar">{user.username.slice(0, 1).toUpperCase()}</div><div className="admin-user-identity"><div><h4>{user.username}</h4><span className={`admin-user-role ${user.role}`}>{roleEnglish(user.role)}</span><span className={user.active ? "admin-user-state active" : "admin-user-state off"}>{user.active ? "正常" : "停用"}</span></div><p>{permissionSummary(user)}</p></div></div>
                  {editable && <div className="admin-user-edit-grid">
                    <div><span className="admin-inline-title">业务模块</span><div className="admin-user-permissions-inline">{DASHBOARD_PERMISSION_LABELS.map((item) => <label key={item.key}><input type="checkbox" checked={permissions[item.key]} disabled={savingUser === user.username} onChange={(e) => void saveAccount(user, { permissions: { ...permissions, [item.key]: e.target.checked } })} />{item.label}</label>)}</div></div>
                    {user.role === "admin" && isOwner && <div><span className="admin-inline-title">后台管理</span><div className="admin-user-permissions-inline management">{MANAGEMENT_OPTIONS.map((item) => <label key={item.key}><input type="checkbox" checked={managerPermissions[item.key]} disabled={savingUser === user.username} onChange={(e) => void saveAccount(user, { management_permissions: { ...managerPermissions, [item.key]: e.target.checked } })} />{item.label}</label>)}</div></div>}
                    <div className="admin-user-buttons-v249"><button type="button" onClick={() => void saveAccount(user, { active: !user.active })}>{user.active ? "停用" : "启用"}</button><button type="button" onClick={() => { setResetTarget(resetTarget === user.username ? "" : user.username); setResetPassword(""); }}>重置密码</button><button className="danger" type="button" onClick={() => void removeAccount(user)}>删除账号</button></div>
                    {resetTarget === user.username && <form className="admin-inline-reset" onSubmit={submitResetPassword}><input type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} placeholder="输入新的临时密码（至少 8 位）" autoFocus /><button type="submit" disabled={savingUser === user.username}>保存新密码</button><button type="button" onClick={() => setResetTarget("")}>取消</button></form>}
                  </div>}
                  {!editable && user.role === "owner" && <div className="admin-owner-lock">唯一总管理员账号 · 不能在这里停用、删除或被其他账号修改</div>}
                </article>;
              })}
            </div>}
          </section>
        </div>
      )}

      {tab === "data" && canRefreshData && (
        <div className="admin-data-grid">
          <section className="admin-panel-card admin-data-hero"><div><span>DATA CONTROL</span><h3>数据同步</h3><p>网站查询只读 Supabase。这里显示后台同步状态；只有需要立即拿到最新 Google 数据时才手动刷新。</p></div><button type="button" className="admin-refresh-all" disabled={Boolean(syncRunning)} onClick={() => void runAllLatest()}>{syncRunning === "all" ? "正在刷新全部..." : "刷新全部最新数据"}</button></section>
          <section className="admin-panel-card admin-history-card">
            <div className="admin-history-head"><div><span>HISTORY DATABASE</span><h3>历史数据补齐</h3><p>完成数达到总任务数且失败为 0，才表示历史数据已经完整写入 Supabase。</p></div><button type="button" className="admin-light-btn" onClick={() => void loadHistoryStatus()} disabled={historyLoading}>{historyLoading ? "读取中..." : "刷新进度"}</button></div>
            {historyStatus ? <><div className="admin-history-progress-line"><div style={{ width: `${Math.max(0, Math.min(100, historyStatus.completedPct || 0))}%` }} /></div><div className="admin-history-stats"><div><span>完成进度</span><b>{historyStatus.completed} / {historyStatus.total}</b><small>{historyStatus.completedPct.toFixed(1)}%</small></div><div><span>待补任务</span><b>{historyStatus.pending + historyStatus.retry}</b><small>{historyStatus.nextPendingDate || "-"}</small></div><div><span>失败任务</span><b>{historyStatus.failed}</b><small>{historyStatus.failed ? "需要检查" : "正常"}</small></div><div><span>历史写入</span><b>{historyStatus.rowsWritten.toLocaleString()}</b><small>{historyStatus.lastSyncAt ? formatTime(historyStatus.lastSyncAt) : "尚未开始"}</small></div></div><div className="admin-history-actions"><span>{historyStatus.completed === historyStatus.total && historyStatus.failed === 0 ? "✓ 历史数据已全部补齐" : "历史全部完成后任务会自动停止。"}</span><button type="button" disabled={Boolean(syncRunning)} onClick={() => void runHistoryNext()}>{syncRunning === "history_next" ? "正在补齐..." : "立即补下一项"}</button></div></> : <div className="admin-history-empty">暂时没有历史进度数据。</div>}
          </section>
          <section className="admin-sync-jobs">{SYNC_JOBS.map((job) => <div className="admin-panel-card admin-sync-job" key={job.key}><div><h4>{job.label}</h4><p>{job.note}</p></div><button type="button" disabled={Boolean(syncRunning)} onClick={() => void runJob(job.key)}>{syncRunning === job.key ? "刷新中..." : "立即刷新"}</button></div>)}</section>
          {syncProgress.length > 0 && <section className="admin-panel-card admin-sync-progress"><h4>本次执行结果</h4>{syncProgress.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}</section>}
        </div>
      )}

      {tab === "audit" && canViewAudit && (
        <section className="admin-panel-card admin-audit-card-v249"><div className="admin-card-title"><div><span>ADMIN AUDIT LOG</span><h3>后台操作记录</h3></div><button type="button" className="admin-light-btn" onClick={() => void loadAudit()}>刷新记录</button></div><div className="admin-audit-table-wrap"><table className="admin-audit-table"><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>目标</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td>{formatTime(log.created_at)}</td><td>{log.actor_username || "system"}</td><td>{actionLabel(log.action)}</td><td>{log.target_username || "-"}</td></tr>)}</tbody></table>{!logs.length && <div className="admin-empty">暂无操作记录。</div>}</div></section>
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
