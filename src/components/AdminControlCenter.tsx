"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createViewerAccount,
  DASHBOARD_PERMISSION_LABELS,
  DEFAULT_VIEWER_PERMISSIONS,
  listDashboardAudit,
  listDashboardUsers,
  normalizedPermissions,
  resetViewerPassword,
  triggerDashboardSync,
  updateViewerAccount,
  type DashboardAuditLog,
  type DashboardPermissions,
  type DashboardProfile,
  type DashboardSession,
  type ManualSyncJob,
} from "@/lib/dashboardAuthClient";

type Props = {
  open: boolean;
  session: DashboardSession;
  profile: DashboardProfile;
  onClose: () => void;
};

type Tab = "users" | "data" | "audit";

const SYNC_JOBS: Array<{ key: ManualSyncJob; label: string; note: string }> = [
  { key: "today_collect", label: "今日代收", note: "安全增量同步，不删除暂未到齐的数据" },
  { key: "today_payout", label: "今日代付", note: "安全增量同步，不删除暂未到齐的数据" },
  { key: "yesterday_collect", label: "昨日代收", note: "补齐延迟录入的平台 / 国家" },
  { key: "yesterday_payout", label: "昨日代付", note: "补齐延迟录入的平台 / 国家" },
  { key: "rates", label: "费率 / 盘口状态", note: "重新读取最新费率与盘口状态" },
];

function formatTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function permissionSummary(profile: DashboardProfile) {
  if (profile.role === "admin") return "全部权限";
  const p = normalizedPermissions(profile);
  return DASHBOARD_PERMISSION_LABELS.filter((item) => p[item.key]).map((item) => item.label).join("、") || "无模块权限";
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    bootstrap_admin: "初始化 Admin",
    create_viewer: "建立 Viewer",
    update_viewer: "修改账号权限",
    reset_password: "重置密码",
    manual_sync: "手动刷新数据",
    manual_sync_failed: "手动刷新失败",
  };
  return labels[action] || action;
}

export default function AdminControlCenter({ open, session, profile, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<DashboardProfile[]>([]);
  const [logs, setLogs] = useState<DashboardAuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPermissions, setNewPermissions] = useState<DashboardPermissions>({ ...DEFAULT_VIEWER_PERMISSIONS });
  const [createBusy, setCreateBusy] = useState(false);
  const [savingUser, setSavingUser] = useState("");
  const [resetTarget, setResetTarget] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [syncRunning, setSyncRunning] = useState<ManualSyncJob | "all" | "">("");
  const [syncProgress, setSyncProgress] = useState<string[]>([]);

  const viewers = useMemo(() => users.filter((user) => user.role === "viewer"), [users]);

  async function loadUsers() {
    setLoading(true);
    try {
      setUsers(await listDashboardUsers(session));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取账号失败");
    } finally {
      setLoading(false);
    }
  }

  async function loadAudit() {
    setLoading(true);
    try {
      setLogs(await listDashboardAudit(session, 60));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取操作记录失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setMessage("");
    void loadUsers();
    void loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || profile.role !== "admin") return null;

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    setCreateBusy(true);
    setMessage("");
    try {
      const result = await createViewerAccount(session, newUsername, newPassword, newPermissions);
      setMessage(`账号 ${result?.username || newUsername} 已建立。`);
      setNewUsername("");
      setNewPassword("");
      setNewPermissions({ ...DEFAULT_VIEWER_PERMISSIONS });
      await Promise.all([loadUsers(), loadAudit()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "建立账号失败");
    } finally {
      setCreateBusy(false);
    }
  }

  async function saveViewer(user: DashboardProfile, patch: { active?: boolean; permissions?: DashboardPermissions }) {
    setSavingUser(user.username);
    setMessage("");
    try {
      await updateViewerAccount(session, user.username, patch);
      setMessage(`${user.username} 已更新。`);
      await Promise.all([loadUsers(), loadAudit()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新失败");
    } finally {
      setSavingUser("");
    }
  }

  async function submitResetPassword(event: React.FormEvent) {
    event.preventDefault();
    if (!resetTarget) return;
    setSavingUser(resetTarget);
    setMessage("");
    try {
      await resetViewerPassword(session, resetTarget, resetPassword);
      setMessage(`${resetTarget} 密码已重置。`);
      setResetTarget("");
      setResetPassword("");
      await loadAudit();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重置密码失败");
    } finally {
      setSavingUser("");
    }
  }

  async function runJob(job: ManualSyncJob) {
    setSyncRunning(job);
    setSyncProgress([`正在刷新：${SYNC_JOBS.find((item) => item.key === job)?.label || job}`]);
    setMessage("");
    try {
      const result = await triggerDashboardSync(session, job);
      const written = result?.result?.written;
      const suffix = written?.volume ? `，写入 ${written.volume} 行` : written?.rates ? `，费率 ${written.rates} / 盘口 ${written.platformStatuses}` : "";
      setSyncProgress([`${SYNC_JOBS.find((item) => item.key === job)?.label || job}：完成${suffix}`]);
      await loadAudit();
    } catch (error) {
      setSyncProgress([`${SYNC_JOBS.find((item) => item.key === job)?.label || job}：${error instanceof Error ? error.message : "失败"}`]);
    } finally {
      setSyncRunning("");
    }
  }

  async function runAllLatest() {
    setSyncRunning("all");
    setMessage("");
    const lines: string[] = [];
    setSyncProgress([]);
    try {
      for (const job of SYNC_JOBS) {
        setSyncProgress([...lines, `正在刷新：${job.label}...`]);
        try {
          const result = await triggerDashboardSync(session, job.key);
          const written = result?.result?.written;
          const suffix = written?.volume ? `（${written.volume} 行）` : written?.rates ? `（费率 ${written.rates} / 盘口 ${written.platformStatuses}）` : "";
          lines.push(`✓ ${job.label} ${suffix}`);
        } catch (error) {
          lines.push(`✕ ${job.label}：${error instanceof Error ? error.message : "失败"}`);
        }
        setSyncProgress([...lines]);
      }
      await loadAudit();
    } finally {
      setSyncRunning("");
    }
  }

  return (
    <div className="admin-center-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="admin-center-shell">
        <header className="admin-center-header">
          <div className="admin-center-brand">
            <div className="admin-center-logo">H</div>
            <div>
              <span>HENSEM CONTROL CENTER</span>
              <h2>管理后台</h2>
              <p>账号权限、数据刷新与操作记录</p>
            </div>
          </div>
          <div className="admin-center-header-actions">
            <span className="admin-role-chip">ADMIN · {profile.username}</span>
            <button type="button" onClick={onClose}>关闭</button>
          </div>
        </header>

        <nav className="admin-center-tabs">
          <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>账号与权限</button>
          <button className={tab === "data" ? "active" : ""} onClick={() => setTab("data")}>数据刷新</button>
          <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}>操作记录</button>
        </nav>

        {message && <div className="admin-center-message">{message}</div>}

        <div className="admin-center-body">
          {tab === "users" && (
            <div className="admin-users-layout">
              <div className="admin-panel-card admin-create-card">
                <div className="admin-card-title"><div><span>CREATE VIEWER</span><h3>建立查看账号</h3></div><em>Admin Only</em></div>
                <form onSubmit={submitCreate}>
                  <label>账号</label>
                  <input value={newUsername} onChange={(event) => setNewUsername(event.target.value)} placeholder="例如 finance01" />
                  <label>初始密码</label>
                  <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少 8 位" />
                  <label>允许查看的模块</label>
                  <div className="admin-permission-list">
                    {DASHBOARD_PERMISSION_LABELS.map((item) => (
                      <label key={item.key} className="admin-permission-row">
                        <input
                          type="checkbox"
                          checked={newPermissions[item.key]}
                          onChange={(event) => setNewPermissions((prev) => ({ ...prev, [item.key]: event.target.checked }))}
                        />
                        <span><b>{item.label}</b><small>{item.note}</small></span>
                      </label>
                    ))}
                  </div>
                  <button className="admin-primary-btn" type="submit" disabled={createBusy}>{createBusy ? "建立中..." : "建立 Viewer 账号"}</button>
                  <p className="admin-form-note">Viewer 永远没有“建立账号 / 修改权限 / 刷新数据”能力。</p>
                </form>
              </div>

              <div className="admin-panel-card admin-user-list-card">
                <div className="admin-card-title"><div><span>ACCOUNT ACCESS</span><h3>账号权限</h3></div><button type="button" className="admin-light-btn" onClick={() => void loadUsers()}>刷新列表</button></div>
                {loading && !users.length ? <div className="admin-empty">正在读取账号...</div> : (
                  <div className="admin-user-list">
                    {users.map((user) => {
                      const permissions = normalizedPermissions(user);
                      return (
                        <article className="admin-user-row" key={user.auth_user_id}>
                          <div className="admin-user-main">
                            <div className="admin-user-avatar">{user.username.slice(0, 1).toUpperCase()}</div>
                            <div><h4>{user.username}</h4><p>{permissionSummary(user)}</p></div>
                            <span className={user.role === "admin" ? "admin-user-role admin" : "admin-user-role"}>{user.role === "admin" ? "ADMIN" : "VIEWER"}</span>
                            <span className={user.active ? "admin-user-state active" : "admin-user-state off"}>{user.active ? "正常" : "停用"}</span>
                          </div>
                          {user.role === "viewer" && (
                            <div className="admin-user-controls">
                              <div className="admin-user-permissions-inline">
                                {DASHBOARD_PERMISSION_LABELS.map((item) => (
                                  <label key={item.key}>
                                    <input
                                      type="checkbox"
                                      checked={permissions[item.key]}
                                      disabled={savingUser === user.username}
                                      onChange={(event) => void saveViewer(user, { permissions: { ...permissions, [item.key]: event.target.checked } })}
                                    />
                                    {item.label}
                                  </label>
                                ))}
                              </div>
                              <div className="admin-user-buttons">
                                <button type="button" onClick={() => void saveViewer(user, { active: !user.active })} disabled={savingUser === user.username}>{user.active ? "停用账号" : "启用账号"}</button>
                                <button type="button" onClick={() => { setResetTarget(user.username); setResetPassword(""); }}>重置密码</button>
                              </div>
                            </div>
                          )}
                        </article>
                      );
                    })}
                    {!users.length && <div className="admin-empty">还没有其他 Viewer 账号。</div>}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "data" && (
            <div className="admin-data-grid">
              <div className="admin-panel-card admin-data-hero">
                <div><span>MANUAL DATA SYNC</span><h3>刷新最新数据</h3><p>自动 Cron 会继续每小时运行。这里是 Admin 的手动刷新入口，适合需要马上看到最新 Google 数据时使用。</p></div>
                <button type="button" className="admin-refresh-all" disabled={Boolean(syncRunning)} onClick={() => void runAllLatest()}>{syncRunning === "all" ? "正在刷新全部..." : "刷新全部最新数据"}</button>
              </div>
              <div className="admin-sync-jobs">
                {SYNC_JOBS.map((job) => (
                  <div className="admin-panel-card admin-sync-job" key={job.key}>
                    <div><h4>{job.label}</h4><p>{job.note}</p></div>
                    <button type="button" disabled={Boolean(syncRunning)} onClick={() => void runJob(job.key)}>{syncRunning === job.key ? "刷新中..." : "立即刷新"}</button>
                  </div>
                ))}
              </div>
              {syncProgress.length > 0 && <div className="admin-panel-card admin-sync-progress"><h4>本次执行结果</h4>{syncProgress.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}</div>}
            </div>
          )}

          {tab === "audit" && (
            <div className="admin-panel-card admin-audit-card">
              <div className="admin-card-title"><div><span>ADMIN AUDIT LOG</span><h3>后台操作记录</h3></div><button type="button" className="admin-light-btn" onClick={() => void loadAudit()}>刷新记录</button></div>
              <div className="admin-audit-table-wrap">
                <table className="admin-audit-table">
                  <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>目标</th></tr></thead>
                  <tbody>
                    {logs.map((log) => <tr key={log.id}><td>{formatTime(log.created_at)}</td><td>{log.actor_username || "system"}</td><td>{actionLabel(log.action)}</td><td>{log.target_username || "-"}</td></tr>)}
                  </tbody>
                </table>
                {!logs.length && <div className="admin-empty">暂无操作记录。</div>}
              </div>
            </div>
          )}
        </div>

        {resetTarget && (
          <div className="admin-reset-layer">
            <form className="admin-reset-card" onSubmit={submitResetPassword}>
              <h3>重置 {resetTarget} 的密码</h3>
              <p>设置一个新的初始密码，保存后旧密码立即失效。</p>
              <input type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="至少 8 位" autoFocus />
              <div><button type="button" onClick={() => setResetTarget("")}>取消</button><button type="submit" disabled={savingUser === resetTarget}>确认重置</button></div>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
