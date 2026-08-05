"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  canOpenAdminCenter,
  changeOwnDashboardPassword,
  dashboardAuthEnabled,
  DASHBOARD_PERMISSION_LABELS,
  fetchDashboardProfile,
  normalizedPermissions,
  readSavedDashboardSession,
  refreshDashboardSession,
  saveDashboardSession,
  signInDashboard,
  verifyDashboardAccess,
  type DashboardProfile,
  type DashboardSession,
} from "@/lib/dashboardAuthClient";

type AuthContextValue = {
  session: DashboardSession | null;
  profile: DashboardProfile | null;
  logout: () => void;
  openAdminCenter: () => void;
  openProfile: () => void;
};

const AuthContext = createContext<AuthContextValue>({ session: null, profile: null, logout: () => undefined, openAdminCenter: () => undefined, openProfile: () => undefined });

const DASHBOARD_IDLE_MS = 60 * 60 * 1000;
const DASHBOARD_LAST_ACTIVITY_KEY = "hensem.dashboard.last_activity";

function readLastActivity(): number {
  if (typeof window === "undefined") return 0;
  const value = Number(window.localStorage.getItem(DASHBOARD_LAST_ACTIVITY_KEY) || 0);
  return Number.isFinite(value) ? value : 0;
}

function writeLastActivity(value = Date.now()) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DASHBOARD_LAST_ACTIVITY_KEY, String(value));
}

function clearLastActivity() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DASHBOARD_LAST_ACTIVITY_KEY);
}

export function useDashboardAuth() {
  return useContext(AuthContext);
}

export default function DashboardAuthGate({ children }: { children: ReactNode }) {
  const enabled = dashboardAuthEnabled();
  const [ready, setReady] = useState(!enabled);
  const [session, setSession] = useState<DashboardSession | null>(null);
  const [profile, setProfile] = useState<DashboardProfile | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);

  function applyAuthenticated(nextSession: DashboardSession, nextProfile: DashboardProfile) {
    saveDashboardSession(nextSession);
    setSession(nextSession);
    setProfile(nextProfile);
    setReady(true);
  }

  function logout() {
    saveDashboardSession(null);
    clearLastActivity();
    setSession(null);
    setProfile(null);
    setPassword("");
    setUserMenuOpen(false);
    setProfileOpen(false);
    setReady(true);
  }

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const saved = readSavedDashboardSession();
      if (!saved) {
        clearLastActivity();
        if (!cancelled) setReady(true);
        return;
      }

      const lastActivity = readLastActivity();
      if (lastActivity > 0 && Date.now() - lastActivity >= DASHBOARD_IDLE_MS) {
        saveDashboardSession(null);
        clearLastActivity();
        if (!cancelled) setReady(true);
        return;
      }
      // 老版本升级过来还没有活动时间时，从本次打开开始计时。
      if (!lastActivity) writeLastActivity();

      try {
        let active = saved;
        let nextProfile: DashboardProfile;
        try {
          nextProfile = await fetchDashboardProfile(active);
        } catch {
          if (!active.refresh_token) throw new Error("登录已过期");
          active = await refreshDashboardSession(active.refresh_token);
          nextProfile = await fetchDashboardProfile(active);
        }
        await verifyDashboardAccess(active);
        if (!cancelled) applyAuthenticated(active, nextProfile);
      } catch {
        saveDashboardSession(null);
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !session?.refresh_token) return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const nextSession = await refreshDashboardSession(session.refresh_token);
          const nextProfile = await fetchDashboardProfile(nextSession);
          await verifyDashboardAccess(nextSession);
          applyAuthenticated(nextSession, nextProfile);
        } catch { /* 下一轮再校验 */ }
      })();
    }, 45 * 60 * 1000);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, session?.refresh_token]);

  useEffect(() => {
    if (!userMenuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setUserMenuOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [userMenuOpen]);

  useEffect(() => {
    if (!enabled || !profile?.username) return;

    // 严格 idle：
    // - 只认浏览器真实用户事件（isTrusted=true）
    // - 不再监听 scroll，因为页面渲染/恢复位置也可能触发 scroll，旧版会被误判成用户活动
    // - token 自动刷新不算活动
    // - 用“最后真实活动时间 + 精确截止时间”退出，而不是靠会被重置的周期计时器
    let idleTimer: number | undefined;
    let disposed = false;

    const logoutEverywhere = () => {
      if (disposed) return;
      try {
        window.localStorage.setItem("hensem.dashboard.idle_logout_at", String(Date.now()));
      } catch {}
      logout();
    };

    const scheduleIdleCheck = () => {
      if (disposed) return;
      if (idleTimer) window.clearTimeout(idleTimer);

      let last = readLastActivity();
      if (!last) {
        last = Date.now();
        writeLastActivity(last);
      }

      const remaining = DASHBOARD_IDLE_MS - (Date.now() - last);
      if (remaining <= 0) {
        logoutEverywhere();
        return;
      }

      idleTimer = window.setTimeout(() => {
        const latest = readLastActivity();
        if (!latest || Date.now() - latest >= DASHBOARD_IDLE_MS) {
          logoutEverywhere();
        } else {
          scheduleIdleCheck();
        }
      }, Math.max(250, remaining + 100));
    };

    const markActivity = (event: Event) => {
      // 代码触发的 synthetic event 不算用户活动。
      if (!event.isTrusted) return;
      writeLastActivity(Date.now());
      scheduleIdleCheck();
    };

    const checkNow = () => {
      const last = readLastActivity();
      if (last && Date.now() - last >= DASHBOARD_IDLE_MS) {
        logoutEverywhere();
        return;
      }
      scheduleIdleCheck();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") checkNow();
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === DASHBOARD_LAST_ACTIVITY_KEY) {
        scheduleIdleCheck();
      }
      if (event.key === "hensem.dashboard.idle_logout_at" && event.newValue) {
        logout();
      }
      if (event.key === "hensem:dashboard:auth-session:v2" && !event.newValue) {
        logout();
      }
    };

    // wheel 是真实滚轮动作；programmatic scroll 不会触发 wheel。
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart", "wheel"];
    events.forEach((name) => window.addEventListener(name, markActivity, { passive: true }));
    window.addEventListener("focus", checkNow);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibility);

    scheduleIdleCheck();

    return () => {
      disposed = true;
      if (idleTimer) window.clearTimeout(idleTimer);
      events.forEach((name) => window.removeEventListener(name, markActivity));
      window.removeEventListener("focus", checkNow);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, profile?.username]);

  async function submitLogin(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const nextSession = await signInDashboard(username, password);
      const nextProfile = await fetchDashboardProfile(nextSession);
      await verifyDashboardAccess(nextSession);
      writeLastActivity();
      applyAuthenticated(nextSession, nextProfile);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  async function submitOwnPassword(event: React.FormEvent) {
    event.preventDefault();
    if (!session || !profile) return;
    setPasswordMessage("");
    if (newPassword.length < 8) {
      setPasswordMessage("新密码至少 8 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage("两次输入的新密码不一致");
      return;
    }
    if (currentPassword === newPassword) {
      setPasswordMessage("新密码不能和当前密码完全相同");
      return;
    }
    setPasswordBusy(true);
    try {
      const nextSession = await changeOwnDashboardPassword(profile.username, currentPassword, newPassword);
      const nextProfile = await fetchDashboardProfile(nextSession);
      await verifyDashboardAccess(nextSession);
      writeLastActivity();
      applyAuthenticated(nextSession, nextProfile);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("密码修改成功，新的登录会话已经生效。");
    } catch (err) {
      setPasswordMessage(err instanceof Error ? err.message : "修改密码失败");
    } finally {
      setPasswordBusy(false);
    }
  }

  const value = useMemo<AuthContextValue>(() => ({
    session,
    profile,
    logout,
    openAdminCenter: () => { if (profile && canOpenAdminCenter(profile)) window.dispatchEvent(new CustomEvent("hensem:open-admin")); },
    openProfile: () => setProfileOpen(true),
  }), [session, profile]);
  const permissionList = useMemo(() => {
    if (!profile) return [];
    const permissions = normalizedPermissions(profile);
    return DASHBOARD_PERMISSION_LABELS.filter((item) => permissions[item.key]);
  }, [profile]);

  const roleTitle = profile?.role === "owner" ? "Owner / 总管理员" : profile?.role === "admin" ? "Administrator" : "Viewer";
  const roleDetail = profile?.role === "owner" ? "总管理员 · 唯一最高权限" : profile?.role === "admin" ? "管理员 · 权限由 Owner 分配" : "Viewer · 只读账号";

  if (!enabled) return <>{children}</>;
  if (!ready) {
    return (
      <div className="auth-loading-page">
        <div className="auth-loading-card"><div className="auth-loading-spinner" />正在确认安全登录状态...</div>
      </div>
    );
  }

  if (!session || !profile) {
    return (
      <div className="auth-login-page">
        <div className="auth-login-shell">
          <section className="auth-login-brand-panel compact">
            <div className="auth-login-brand-center">
              <div className="auth-login-brand-mark large">H</div>
              <strong>Hensem 数据后台</strong>
              <small>Data Center</small>
            </div>
          </section>

          <form className="auth-login-card compact" onSubmit={submitLogin}>
            <div className="auth-login-card-top">
              <h2>登录</h2>
            </div>
            <label>账号</label>
            <div className="auth-input-wrap"><span>◎</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入账号" /></div>
            <label>密码</label>
            <div className="auth-input-wrap"><span>⌁</span><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "隐藏" : "显示"}</button></div>
            {error && <div className="auth-login-error">{error}</div>}
            <button className="auth-login-submit" type="submit" disabled={busy}>{busy ? "正在验证..." : "登录"}</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {children}

      <div className="auth-user-menu-wrap" ref={menuRef}>
        <button className={userMenuOpen ? "auth-user-trigger open" : "auth-user-trigger"} type="button" onClick={() => setUserMenuOpen((value) => !value)}>
          <span className="auth-user-avatar">{profile.username.slice(0, 1).toUpperCase()}</span>
          <span className="auth-user-copy"><b>{profile.username}</b><small>{roleTitle}</small></span>
          <span className="auth-user-chevron">⌄</span>
        </button>
        {userMenuOpen && (
          <div className="auth-user-dropdown">
            <div className="auth-user-dropdown-head">
              <span className="auth-user-avatar large">{profile.username.slice(0, 1).toUpperCase()}</span>
              <div><b>{profile.username}</b><small>{roleDetail}</small></div>
            </div>
            <button type="button" onClick={() => { setProfileOpen(true); setUserMenuOpen(false); }}>个人资料与密码</button>
            {canOpenAdminCenter(profile) && <button type="button" onClick={() => { window.dispatchEvent(new CustomEvent("hensem:open-admin")); setUserMenuOpen(false); }}>管理后台</button>}
            <div className="auth-user-dropdown-line" />
            <button className="danger" type="button" onClick={logout}>退出登录</button>
          </div>
        )}
      </div>

      {profileOpen && (
        <div className="profile-center-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileOpen(false); }}>
          <section className="profile-center-card">
            <header className="profile-center-header">
              <div><span>ACCOUNT CENTER</span><h2>个人资料</h2><p>查看账号权限并安全修改自己的登录密码。</p></div>
              <button type="button" onClick={() => setProfileOpen(false)}>关闭</button>
            </header>
            <div className="profile-center-grid">
              <div className="profile-overview-panel">
                <div className="profile-big-avatar">{profile.username.slice(0, 1).toUpperCase()}</div>
                <h3>{profile.username}</h3>
                <span className={`profile-role ${profile.role}`} >{profile.role === "owner" ? "OWNER" : profile.role === "admin" ? "ADMINISTRATOR" : "VIEWER"}</span>
                <dl>
                  <div><dt>账号状态</dt><dd>正常</dd></div>
                  <div><dt>账号角色</dt><dd>{profile.role === "owner" ? "总管理员" : profile.role === "admin" ? "管理员" : "查看账号"}</dd></div>
                  <div><dt>可查看模块</dt><dd>{profile.role === "owner" ? "全部模块" : `${permissionList.length} 个模块`}</dd></div>
                </dl>
                <div className="profile-permission-chips">
                  {permissionList.map((item) => <span key={item.key}>{item.label}</span>)}
                </div>
              </div>

              <form className="profile-password-panel" onSubmit={submitOwnPassword}>
                <span>SECURITY</span>
                <h3>修改登录密码</h3>
                <p>修改前会先验证当前密码。新密码保存后，系统会自动建立新的登录会话。</p>
                <label>当前密码</label>
                <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="输入当前密码" />
                <label>新密码</label>
                <input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少 8 位" />
                <label>确认新密码</label>
                <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入新密码" />
                {passwordMessage && <div className={passwordMessage.includes("成功") ? "profile-password-message ok" : "profile-password-message"}>{passwordMessage}</div>}
                <button type="submit" disabled={passwordBusy}>{passwordBusy ? "正在修改..." : "保存新密码"}</button>
              </form>
            </div>
          </section>
        </div>
      )}

    </AuthContext.Provider>
  );
}
