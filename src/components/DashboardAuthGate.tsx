"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  dashboardAuthEnabled,
  fetchDashboardProfile,
  readSavedDashboardSession,
  refreshDashboardSession,
  saveDashboardSession,
  signInDashboard,
  type DashboardProfile,
  type DashboardSession,
} from "@/lib/dashboardAuthClient";
import AdminControlCenter from "./AdminControlCenter";

type AuthContextValue = {
  session: DashboardSession | null;
  profile: DashboardProfile | null;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue>({ session: null, profile: null, logout: () => undefined });

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
  const [manageOpen, setManageOpen] = useState(false);

  function applyAuthenticated(nextSession: DashboardSession, nextProfile: DashboardProfile) {
    saveDashboardSession(nextSession);
    setSession(nextSession);
    setProfile(nextProfile);
    setReady(true);
  }

  function logout() {
    saveDashboardSession(null);
    setSession(null);
    setProfile(null);
    setPassword("");
    setManageOpen(false);
    setReady(true);
  }

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const saved = readSavedDashboardSession();
      if (!saved) {
        if (!cancelled) setReady(true);
        return;
      }
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
          applyAuthenticated(nextSession, nextProfile);
        } catch { /* 下一轮再校验 */ }
      })();
    }, 45 * 60 * 1000);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, session?.refresh_token]);

  async function submitLogin(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const nextSession = await signInDashboard(username, password);
      const nextProfile = await fetchDashboardProfile(nextSession);
      applyAuthenticated(nextSession, nextProfile);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  const value = useMemo<AuthContextValue>(() => ({ session, profile, logout }), [session, profile]);

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
          <section className="auth-login-brand-panel">
            <div className="auth-login-brand-mark">Data</div>
            <span className="auth-login-eyebrow">HENSEM CONTROL CENTER</span>
            <h1>数据中控平台</h1>
            <p>统一查看业务数据、三方量与费率。账号权限由管理员集中分配。</p>
            <div className="auth-login-feature-list">
              <div><i>01</i><span><b>Supabase 数据层</b><small>小时自动同步，页面快速读取</small></span></div>
              <div><i>02</i><span><b>分级账号权限</b><small>Admin 管理，Viewer 只读</small></span></div>
              <div><i>03</i><span><b>后台操作审计</b><small>账号与手动刷新操作可追踪</small></span></div>
            </div>
          </section>

          <form className="auth-login-card" onSubmit={submitLogin}>
            <div className="auth-login-card-top">
              <span>SECURE SIGN IN</span>
              <h2>欢迎登录</h2>
              <p>使用管理员为你分配的账号密码进入 Hensem 数据后台。</p>
            </div>
            <label>账号</label>
            <div className="auth-input-wrap"><span>◎</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入账号" /></div>
            <label>密码</label>
            <div className="auth-input-wrap"><span>⌁</span><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "隐藏" : "显示"}</button></div>
            {error && <div className="auth-login-error">{error}</div>}
            <button className="auth-login-submit" type="submit" disabled={busy}>{busy ? "正在验证..." : "登录数据中控"}</button>
            <div className="auth-login-security"><span>●</span>加密登录 · 权限隔离 · 会话自动续期</div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
      <div className="auth-session-pill">
        <div><b>{profile.username}</b><span>{profile.role === "admin" ? "Administrator" : "Viewer · 只读"}</span></div>
        {profile.role === "admin" && <button className="admin-entry-btn" type="button" onClick={() => setManageOpen(true)}>管理后台</button>}
        <button type="button" onClick={logout}>退出</button>
      </div>
      {profile.role === "admin" && session && (
        <AdminControlCenter open={manageOpen} session={session} profile={profile} onClose={() => setManageOpen(false)} />
      )}
    </AuthContext.Provider>
  );
}
