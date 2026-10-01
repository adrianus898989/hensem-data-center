"use client";

import { useEffect, useState, type ReactNode } from "react";
import { dashboardIsTopLevel, dashboardSecureEntryRedirect } from "@/lib/dashboardEmbedding";

export default function DashboardEmbeddingGuard({ children }: { children: ReactNode }) {
  // Do not mount authentication or account controls before the browser has
  // checked the embedding context; SSR must not expose an interactive login.
  const [context, setContext] = useState<"checking" | "allowed" | "blocked" | "redirecting">("checking");
  useEffect(() => {
    if (!dashboardIsTopLevel(window)) { setContext("blocked"); return; }
    const secureEntry = dashboardSecureEntryRedirect(window.location?.href);
    if (secureEntry) { setContext("redirecting"); window.location.replace(secureEntry); return; }
    setContext("allowed");
  }, []);
  if (context === "allowed") return <>{children}</>;
  return <div className="auth-loading-page">
    <div className="auth-loading-card" role={context === "blocked" ? "alert" : "status"}>
      {context === "checking" ? "正在检查后台访问环境…" : context === "redirecting" ? "正在转到安全入口…" : <>
        <strong>请单独打开数据中控后台</strong>
        <p>后台登录和账号操作不允许在其他页面的嵌入窗口中运行。</p>
        <button type="button" onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")}>单独打开后台</button>
      </>}
    </div>
  </div>;
}
