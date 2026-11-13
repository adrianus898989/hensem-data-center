"use client";

import { useEffect, useState, type ComponentType } from "react";

export default function DeferredOfficialDashboard() {
  const [Dashboard, setDashboard] = useState<ComponentType | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "slow" | "failed">("loading");

  useEffect(() => {
    let mounted = true;
    const timer = window.setTimeout(() => setLoadState("slow"), 15_000);
    // The auth gate mounts this component only when its children can be shown.
    // In particular the embedding check and login never wait for report code.
    import("./OfficialDashboard").then(
      module => {
        if (mounted) setDashboard(() => module.default);
      },
      () => {
        if (mounted) setLoadState("failed");
      },
    ).finally(() => window.clearTimeout(timer));
    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, []);

  if (Dashboard) return <Dashboard />;
  return <div className="auth-loading-page">
    <div className="auth-loading-card" role="status">
      <span>{loadState === "failed" ? "后台页面资源加载失败。" :
        loadState === "slow" ? "后台页面资源仍在加载。" : "正在打开后台…"}</span>
      {loadState !== "loading" &&
        <button type="button" onClick={() => window.location.reload()}>重新加载后台</button>}
    </div>
  </div>;
}
