"use client";

import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { dashboardScopeIdentity, effectiveDashboardDataScope, dashboardScopeLabel } from "@/lib/dashboardDataScope";
import { clearDashboardDataCaches, setDashboardDataViewer, DASHBOARD_PROFILE_EVENT } from "@/lib/dashboardDataClient";
import {
  canOpenAdminCenter,
  changeOwnDashboardPassword,
  dashboardAuthEnabled,
  DASHBOARD_PERMISSION_LABELS,
  DASHBOARD_SESSION_EVENT,
  ensureDashboardSession,
  fetchDashboardProfile,
  isDashboardAuthTerminalError,
  normalizedPermissions,
  readSavedDashboardSession,
  saveDashboardSession,
  signInDashboard,
  signOutDashboard,
  verifyDashboardAccess,
  type DashboardProfile,
  type DashboardSession,
} from "@/lib/dashboardAuthClient";

import { DASHBOARD_IDLE_MS, readLastActivity, writeLastActivity, clearLastActivity, installDashboardIdleMonitor } from "@/lib/dashboardIdle";
import { setDashboardPresenceSession, stopDashboardPresence } from "@/lib/dashboardPresenceClient";

type AuthContextValue = {
  session: DashboardSession | null;
  profile: DashboardProfile | null;
  logout: () => void;
  openAdminCenter: () => void;
  openProfile: () => void;
};

const AuthContext = createContext<AuthContextValue>({ session: null, profile: null, logout: () => undefined, openAdminCenter: () => undefined, openProfile: () => undefined });

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
  const [authWarning, setAuthWarning] = useState("");
  const [restorePending, setRestorePending] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const operationRef = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  function applyAuthenticated(nextSession: DashboardSession, nextProfile: DashboardProfile) {
    // A slower older profile response must not restore a revoked wider scope.
    if(!setDashboardDataViewer(nextProfile))return;
    const saved = readSavedDashboardSession();
    if (saved?.access_token !== nextSession.access_token || saved?.refresh_token !== nextSession.refresh_token) saveDashboardSession(nextSession);
    setDashboardPresenceSession(nextSession, dashboardScopeIdentity(nextProfile));
    sessionRef.current = nextSession;
    setSession(nextSession);
    setProfile(nextProfile);
    setRestorePending(false);
    setAuthWarning("");
    setReady(true);
  }

  function clearAuthenticatedView() {
    operationRef.current += 1;
    stopDashboardPresence();
    clearLastActivity();
    clearDashboardDataCaches();
    setDashboardDataViewer(null);
    sessionRef.current = null;
    setSession(null);
    setProfile(null);
    setPassword("");
    setUserMenuOpen(false);
    setProfileOpen(false);
    setRestorePending(false);
    setAuthWarning("");
    setReady(true);
  }

  function logout() {
    const endingSession = sessionRef.current;
    saveDashboardSession(null);
    clearAuthenticatedView();
    if (endingSession) void signOutDashboard(endingSession).catch(() => {});
  }

  function logoutWithReason(cause: unknown) {
    logout();
    setError(cause instanceof Error ? cause.message : "登录会话已失效，请重新登录。");
  }

  useEffect(() => {
    const verified=(event:Event)=>{
      const detail=(event as CustomEvent).detail;
      const saved=readSavedDashboardSession();
      if(detail?.profile?.auth_user_id===saved?.user.id&&detail?.session?.access_token===saved?.access_token)applyAuthenticated(detail.session,detail.profile);
    };
    window.addEventListener(DASHBOARD_PROFILE_EVENT,verified);
    return ()=>window.removeEventListener(DASHBOARD_PROFILE_EVENT,verified);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

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

      let active = saved;
      try {
        active = await ensureDashboardSession(saved);
        let nextProfile: DashboardProfile;
        try { nextProfile = await fetchDashboardProfile(active); }
        catch (cause) {
          // An unknown/legacy expiry still gets a single authenticated refresh on 401.
          if (!(cause && typeof cause === "object" && "status" in cause && cause.status === 401)) throw cause;
          active = await ensureDashboardSession(active, true);
          nextProfile = await fetchDashboardProfile(active);
        }
        await verifyDashboardAccess(active);
        const current = readSavedDashboardSession();
        if (!cancelled && current?.access_token === active.access_token && current.user.id === active.user.id) applyAuthenticated(active, nextProfile);
      } catch (cause) {
        if (cancelled) return;
        const current = readSavedDashboardSession();
        if (!current || isDashboardAuthTerminalError(cause)) {
          if (!current || current.user.id === active.user.id && current.access_token === active.access_token) logoutWithReason(cause);
          else { setReady(false); setRestoreAttempt(n => n + 1); }
        } else {
          // A temporary connection failure must not discard a valid refresh token.
          setRestorePending(true);
          setAuthWarning("登录连接暂时不可用，已保留登录状态；恢复网络后将自动重试。");
          setReady(true);
        }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, restoreAttempt]);

  useEffect(() => {
    if (!enabled || !restorePending) return;
    const retry = () => setRestoreAttempt(n => n + 1);
    const timer = window.setInterval(retry, 30000);
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => { window.clearInterval(timer); window.removeEventListener("online", retry); window.removeEventListener("focus", retry); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, restorePending]);

  useEffect(() => {
    if (!enabled) return;
    const receive = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== "hensem:dashboard:auth-session:v2") return;
      const saved = readSavedDashboardSession(), previous = sessionRef.current;
      if (!saved) { clearAuthenticatedView(); return; }
      if (!previous) {
        if (event.type === "storage") { operationRef.current += 1; setReady(false); setRestoreAttempt(n => n + 1); }
        return;
      }
      if (previous.user.id !== saved.user.id) {
        operationRef.current += 1;
        stopDashboardPresence();
        setDashboardDataViewer(null);
        clearDashboardDataCaches();
        sessionRef.current = null; setSession(null); setProfile(null);
        setReady(false); setRestoreAttempt(n => n + 1); return;
      }
      sessionRef.current = saved;
      setSession(saved);
    };
    window.addEventListener(DASHBOARD_SESSION_EVENT, receive);
    window.addEventListener("storage", receive);
    return () => { window.removeEventListener(DASHBOARD_SESSION_EVENT, receive); window.removeEventListener("storage", receive); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !session || profile?.active !== true) { stopDashboardPresence(); return; }
    setDashboardPresenceSession(session, dashboardScopeIdentity(profile));
  }, [enabled, session, profile]);
  useEffect(() => () => stopDashboardPresence(), []);

  useEffect(() => {
    if (!enabled || !session?.user.id) return;
    let disposed = false, checking = false, checkedToken = "", checkedAt = 0;
    const check = async () => {
      if (disposed || checking) return;
      const previous = sessionRef.current;
      if (!previous) return;
      const last = readLastActivity();
      if (last && Date.now() - last >= DASHBOARD_IDLE_MS) { logout(); return; }
      checking = true;
      let active = previous;
      try {
        active = await ensureDashboardSession(previous);
        if (disposed) return;
        if (active.access_token !== checkedToken || Date.now() - checkedAt >= 30000) {
          let nextProfile: DashboardProfile;
          try { nextProfile = await fetchDashboardProfile(active); }
          catch (cause) {
            if (!(cause && typeof cause === "object" && "status" in cause && cause.status === 401)) throw cause;
            active = await ensureDashboardSession(active, true);
            nextProfile = await fetchDashboardProfile(active);
          }
          await verifyDashboardAccess(active);
          const current = readSavedDashboardSession();
          if (!disposed && current?.access_token === active.access_token && current.user.id === active.user.id) {
            applyAuthenticated(active, nextProfile);
            checkedToken = active.access_token; checkedAt = Date.now();
          }
        } else setAuthWarning("");
      } catch (cause) {
        if (disposed) return;
        const current = readSavedDashboardSession();
        if (!current || isDashboardAuthTerminalError(cause)) {
          if (!current || current.user.id === active.user.id && current.access_token === active.access_token) logoutWithReason(cause);
        } else setAuthWarning("登录连接暂时不稳定，已保留会话，正在自动重试。");
      } finally { checking = false; }
    };
    const trigger = () => { void check(); };
    const visible = () => { if (document.visibilityState === "visible") trigger(); };
    const timer = window.setInterval(trigger, 30000);
    window.addEventListener("focus", trigger);
    window.addEventListener("online", trigger);
    document.addEventListener("visibilitychange", visible);
    trigger();
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("focus", trigger); window.removeEventListener("online", trigger); document.removeEventListener("visibilitychange", visible); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, session?.user.id, session?.access_token]);

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

    return installDashboardIdleMonitor(logout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, profile?.username]);

  async function submitLogin(event: React.FormEvent) {
    event.preventDefault();
    const operation = ++operationRef.current;
    setBusy(true);
    setError("");
    try {
      const nextSession = await signInDashboard(username, password);
      const nextProfile = await fetchDashboardProfile(nextSession);
      await verifyDashboardAccess(nextSession);
      if (operation !== operationRef.current) return;
      writeLastActivity();
      applyAuthenticated(nextSession, nextProfile);
      setPassword("");
    } catch (err) {
      if (operation === operationRef.current) setError(err instanceof Error ? err.message : "登录失败");
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
    const operation = ++operationRef.current;
    try {
      const nextSession = await changeOwnDashboardPassword(profile.username, currentPassword, newPassword);
      const nextProfile = await fetchDashboardProfile(nextSession);
      await verifyDashboardAccess(nextSession);
      if (operation !== operationRef.current) return;
      writeLastActivity();
      applyAuthenticated(nextSession, nextProfile);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("密码修改成功，新的登录会话已经生效。");
    } catch (err) {
      if (operation === operationRef.current) setPasswordMessage(err instanceof Error ? err.message : "修改密码失败");
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

  if (restorePending && !profile) {
    return <div className="auth-loading-page"><div className="auth-loading-card" role="status" style={{display:"grid",gap:16,maxWidth:480}}>
      <strong>正在恢复登录连接</strong><span>{authWarning}</span>
      <button type="button" onClick={() => setRestoreAttempt(n => n + 1)}>重试连接</button>
      <button type="button" onClick={logout}>退出此登录</button>
    </div></div>;
  }

  if (!session || !profile) {
    return (
      <div className="auth-login-page">
        <div className="auth-login-shell">
          <section className="auth-login-brand-panel">
            <div className="auth-login-brand-copy">
              <div className="auth-login-brand-mark large">H</div>
              <span className="auth-login-eyebrow">M8 | 数据中控后台</span>
              <h1>让每一笔业务数据<br />更清晰、更可控</h1>
              <p>统一查看提现效率、工单服务和三方资金流，快速定位异常并掌握关键趋势。</p>
              <div className="auth-login-feature-list">
                <div><i>01</i><span><b>统一数据视图</b><small>核心业务指标集中呈现</small></span></div>
                <div><i>02</i><span><b>安全权限管理</b><small>按角色开放对应模块</small></span></div>
                <div><i>03</i><span><b>及时异常追踪</b><small>费率、同步与业务状态可查</small></span></div>
              </div>
            </div>
          </section>

          <form className="auth-login-card" onSubmit={submitLogin}>
            <div className="auth-login-card-top">
              <span>SECURE ACCESS</span>
              <h2>欢迎回来</h2>
              <p>登录 M8 | 数据中控后台，继续查看今日业务数据。</p>
            </div>
            <label>账号</label>
            <div className="auth-input-wrap"><span className="auth-field-icon">ID</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入账号" /></div>
            <label>密码</label>
            <div className="auth-input-wrap"><span className="auth-field-icon">••</span><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "隐藏" : "显示"}</button></div>
            {error && <div className="auth-login-error">{error}</div>}
            <button className="auth-login-submit" type="submit" disabled={busy}>{busy ? "正在验证..." : "安全登录"}</button>
            <div className="auth-login-security"><span>●</span>账号连接受安全策略保护</div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {authWarning && <div role="status" className="auth-session-warning" style={{position:"fixed",left:"50%",top:12,transform:"translateX(-50%)",zIndex:1200,padding:"10px 18px",background:"#fff8e8",border:"1px solid #efd5a0",borderRadius:6,color:"#805d23",fontSize:13,maxWidth:"85vw"}}>{authWarning}</div>}
      {effectiveDashboardDataScope(profile).mode === "selected" && <div role="status" className="dashboard-data-scope-notice" style={{padding:"8px 16px",background:"#eef4ff",color:"#315b95",fontSize:12}}>可见数据范围：{dashboardScopeLabel(profile?.data_scope)}；仅在已授权模块内生效。</div>}
      <Fragment key={dashboardScopeIdentity(profile)}>{children}</Fragment>

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
