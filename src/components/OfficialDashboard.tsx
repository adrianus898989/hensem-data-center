"use client";

import { useEffect, useRef, useState } from "react";
import { useDashboardAuth } from "./DashboardAuthGate";
import OwnerAdminPreview from "./OwnerAdminPreview";
import { ownerPreviewRetryable, ownerPreviewVerificationAttempt, retryOwnerPreviewVerification } from "@/lib/ownerPreviewVerification";
import { readAdminPreviewAccess } from "@/lib/adminPreviewClient";
import { adminPreviewPageFromHash } from "@/lib/adminLiveBridge";
import { canOpenAdminCenter } from "@/lib/dashboardAuthClient";
import { OWNER_PREVIEW_HOST_CSS, mountOwnerPreviewHostShell } from "@/lib/ownerPreviewShell";

const legacyPages: Record<string, string> = {
  "#home": "overview", "#auto": "auto_withdraw", "#config": "payout_config",
  "#operator": "withdraw_operators", "#volume": "providers", "#orders": "orders",
  "#channelquality": "providers", "#provider-anomalies": "risk", "#work": "workorders", "#admin": "access",
};

export function officialAdminPageFromHash(hash: string): string {
  return Object.prototype.hasOwnProperty.call(legacyPages, hash)
    ? legacyPages[hash] : adminPreviewPageFromHash(hash) || "overview";
}

// This is the sole mounted dashboard entry. The former Dashboard implementation
// remains source-only: its module hooks, sidebar and business readers never run.
export default function OfficialDashboard() {
  const { session, profile, logout } = useDashboardAuth();
  const sessionRef = useRef(session); sessionRef.current = session;
  const accountId = profile?.auth_user_id || "";
  const active = profile?.active === true && !!accountId && session?.user.id === accountId;
  const owner = active && profile?.role === "owner";
  const [access, setAccess] = useState<{ accountId: string; canView: boolean; ready: boolean; error: string }>({ accountId: "", canView: false, ready: false, error: "" });
  const [retry, setRetry] = useState(0);
  const [route, setRoute] = useState<{ accountId: string; page: string; revision: number } | null>(null);
  const allowed = active && (owner || (access.accountId === accountId && access.ready && access.canView));
  const canManage = active && canOpenAdminCenter(profile);

  useEffect(() => mountOwnerPreviewHostShell(), []);
  useEffect(() => {
    let stopped = false, checking = false, finished = false;
    setAccess({ accountId, canView: false, ready: false, error: "" });
    if (!active || owner) return;
    const controller = new AbortController();
    const check = async () => {
      if (stopped || checking || finished) return;
      const current = sessionRef.current;
      if (!current || current.user.id !== accountId) return;
      checking = true;
      try {
        const result = await retryOwnerPreviewVerification(() => ownerPreviewVerificationAttempt(signal => {
          const activeSession = sessionRef.current;
          if (!activeSession || activeSession.user.id !== accountId) { const error = new Error("后台验证已取消"); error.name = "AbortError"; throw error; }
          return readAdminPreviewAccess(activeSession, signal);
        }, controller.signal), controller.signal, () => {});
        if (!stopped) { finished = true; setAccess({ accountId, canView: result.canView === true, ready: true, error: "" }); }
      } catch (error) {
        if (!stopped) {
          finished = !ownerPreviewRetryable(error);
          setAccess({ accountId, canView: false, ready: true, error: finished ? (error instanceof Error ? error.message : "查看权限验证失败，请重试。") : "后台验证连接暂时不可用，恢复连接后会自动重试。" });
        }
      } finally { checking = false; }
    };
    void check();
    // Only recover an unverified initial entry. Once granted or denied, the
    // mounted preview alone owns periodic authorization; this cannot reset it.
    const recover = () => { void check(); };
    const timer = window.setInterval(recover, 60000);
    window.addEventListener("online", recover);
    window.addEventListener("focus", recover);
    return () => { stopped = true; controller.abort(); window.clearInterval(timer); window.removeEventListener("online", recover); window.removeEventListener("focus", recover); };
  }, [active, owner, accountId, retry]);

  useEffect(() => {
    if (!allowed) { setRoute(null); return; }
    const navigate = (page: string) => {
      window.history.replaceState(null, "", window.location.pathname + window.location.search + "#admin/" + page);
      // Remount also when the menu requested the same host route: the iframe may
      // have since navigated internally. Old in-flight readers are disposed.
      setRoute(previous => ({ accountId, page, revision: (previous?.revision || 0) + 1 }));
    };
    const followLink = () => navigate(officialAdminPageFromHash(window.location.hash));
    const openAccounts = () => { if (canManage) navigate("access"); };
    followLink();
    window.addEventListener("hashchange", followLink);
    window.addEventListener("hensem:open-admin", openAccounts);
    return () => { window.removeEventListener("hashchange", followLink); window.removeEventListener("hensem:open-admin", openAccounts); };
  }, [allowed, accountId, canManage]);

  if (allowed && route?.accountId === accountId && session && profile) {
    return <OwnerAdminPreview key={accountId + ":" + route.page + ":" + route.revision} session={session} profile={profile} canView={allowed} onLogout={logout} />;
  }
  const checking = active && (owner || access.accountId !== accountId || !access.ready);
  const message = checking ? "正在验证后台查看权限…" : access.accountId === accountId && access.error || "当前账号没有后台查看权限，请联系管理员授权。";
  return <section className="owner-preview-shell" aria-label="数据中控后台">
    <style>{OWNER_PREVIEW_HOST_CSS}</style>
    <div className="owner-preview-shell-status" role={checking ? "status" : "alert"}>
      {message}
      <div className="owner-preview-shell-status-actions">
        {!checking && active && <button type="button" className="owner-preview-shell-return" onClick={() => setRetry(value => value + 1)}>重新验证</button>}
        <button type="button" className="owner-preview-shell-return" onClick={logout}>退出登录</button>
      </div>
    </div>
  </section>;
}
