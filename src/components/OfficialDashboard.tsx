"use client";

import { useEffect, useState } from "react";
import { useDashboardAuth } from "./DashboardAuthGate";
import OwnerAdminPreview from "./OwnerAdminPreview";
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
  const accountId = profile?.auth_user_id || "";
  const active = profile?.active === true && !!accountId && session?.user.id === accountId;
  const [route, setRoute] = useState<{ accountId: string; page: string; revision: number } | null>(null);
  // OwnerAdminPreview performs the complete role and protected-document checks
  // before mounting any HTML. A separate access preflight repeats that same gate.
  const allowed = active;
  const canManage = active && canOpenAdminCenter(profile);

  useEffect(() => mountOwnerPreviewHostShell(), []);

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
  return <section className="owner-preview-shell" aria-label="数据中控后台">
    <style>{OWNER_PREVIEW_HOST_CSS}</style>
    <div className="owner-preview-shell-status" role={active ? "status" : "alert"}>
      {active ? "正在打开后台…" : "当前登录账号不可用，请重新登录。"}
      <div className="owner-preview-shell-status-actions">
        <button type="button" className="owner-preview-shell-return" onClick={logout}>退出登录</button>
      </div>
    </div>
  </section>;
}
