"use client";

import { useEffect, useState, type ReactNode } from "react";
import { dashboardIsTopLevel, dashboardSecureEntryRedirect } from "@/lib/dashboardEmbedding";

export default function DashboardEmbeddingGuard({ children }: { children: ReactNode }) {
  // Do not mount authentication or account controls before the browser has
  // checked the embedding context; SSR must not expose an interactive login.
  const [context, setContext] = useState<"checking" | "allowed" | "blocked" | "redirecting">("checking");
  useEffect(() => {
    const topLevel = dashboardIsTopLevel(window);
    const secureEntry = topLevel ? dashboardSecureEntryRedirect(window.location.href) : null;
    setContext(!topLevel ? "blocked" : secureEntry ? "redirecting" : "allowed");
    window.dispatchEvent(new Event("hensem:entry-ready"));
    if (secureEntry) window.location.replace(secureEntry);
  }, []);
  if (context === "allowed") return <>{children}</>;
  if (context === "checking") return <div className="auth-loading-page">
    <div className="auth-loading-card" role="status" data-entry-check="pending">
      <span data-entry-message>正在检查后台访问环境…</span>
      <div data-entry-recovery hidden>
        <span data-entry-slow>后台页面加载时间较长。</span>
        <span data-entry-failed>后台页面加载失败。</span>
        <span data-entry-offline>网络已断开，连接恢复后可重新加载。</span>
        <button type="button" data-entry-retry>重新加载后台</button>
      </div>
    </div>
  </div>;
  return <div className="auth-loading-page">
    <div className="auth-loading-card" role={context === "blocked" ? "alert" : "status"}>
      {context === "redirecting" ? "正在转到安全入口…" : <>
        <strong>请单独打开数据中控后台</strong>
        <p>后台登录和账号操作不允许在其他页面的嵌入窗口中运行。</p>
        <button type="button" onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")}>单独打开后台</button>
      </>}
    </div>
  </div>;
}
