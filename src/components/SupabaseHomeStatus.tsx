"use client";

import { useCallback, useEffect, useState } from "react";
import { useDashboardAuth } from "./DashboardAuthGate";
import { formatNumber } from "@/lib/format";
import { triggerDashboardSync, type ManualSyncJob } from "@/lib/dashboardAuthClient";
import { dashboardBusinessFetch } from "@/lib/dashboardDataClient";
import { effectiveDashboardDataScope, dashboardScopeLabel } from "@/lib/dashboardDataScope";

type StatusPayload = {
  ok?: boolean;
  database?: string;
  counts?: { volumeRows?: number; rates?: number; platformStatuses?: number };
  volume?: { last_sync_at?: string; last_data_date?: string; status?: string; message?: string } | null;
  ratesStatus?: { last_sync_at?: string; status?: string; message?: string } | null;
  checkedAt?: string;
  message?: string;
};

function timeText(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

const LATEST_JOBS: ManualSyncJob[] = ["today_collect", "today_payout", "yesterday_collect", "yesterday_payout", "rates"];

export default function SupabaseHomeStatus() {
  const { session, profile } = useDashboardAuth();
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshText, setRefreshText] = useState("");
  const scoped=effectiveDashboardDataScope(profile).mode!=="all";
  const canStatus=Boolean(profile?.role==="owner"||profile?.permissions?.third_party===true);

  const loadStatus = useCallback(async () => {
    if (!session?.access_token || scoped || !canStatus) return;
    try {
      setError("");
      const res = await dashboardBusinessFetch("/api/supabase-status");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "读取 Supabase 状态失败");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取 Supabase 状态失败");
    }
  }, [session?.access_token,scoped,canStatus]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  async function refreshLatest() {
    if (!session || profile?.role === "viewer" || refreshing) return;
    setRefreshing(true);
    setRefreshText("准备刷新...");
    try {
      for (let index = 0; index < LATEST_JOBS.length; index++) {
        const label = ["今日代收", "今日代付", "昨日代收", "昨日代付", "费率 / 盘口"][index];
        setRefreshText(`正在刷新 ${label}（${index + 1}/${LATEST_JOBS.length}）`);
        await triggerDashboardSync(session, LATEST_JOBS[index]);
      }
      setRefreshText("最新数据刷新完成");
      await loadStatus();
    } catch (err) {
      setRefreshText(err instanceof Error ? `刷新失败：${err.message}` : "刷新失败");
    } finally {
      setRefreshing(false);
    }
  }

  if(scoped || !canStatus)return <section className="home-supabase-status-card"><h2>账号数据范围</h2><p>{scoped?dashboardScopeLabel(profile?.data_scope):"请进入已授权的业务模块查看数据。"}</p><p>仅展示你获准查看的数据，不展示全站汇总或其他盘口状态。</p></section>;

  return (
    <section className="home-supabase-status-card">
      <div className="home-supabase-status-head">
        <div>
          <span className="home-supabase-kicker">LIVE DATA SOURCE</span>
          <h2>Supabase 数据状态</h2>
        </div>
        <div className="home-supabase-head-actions">
          <span className={error ? "home-supabase-state bad" : data ? "home-supabase-state ok" : "home-supabase-state"}>{error ? "异常" : data ? "已连接" : "读取中"}</span>
          {profile?.role !== "viewer" && <button className="home-supabase-refresh-btn" type="button" disabled={refreshing} onClick={() => void refreshLatest()}>{refreshing ? "刷新中..." : "刷新最新数据"}</button>}
        </div>
      </div>
      {error ? (
        <div className="home-supabase-error">{error}</div>
      ) : (
        <div className="home-supabase-status-grid">
          <div><span>三方量数据库行数</span><b>{data ? formatNumber(Number(data.counts?.volumeRows || 0)) : "..."}</b></div>
          <div><span>费率</span><b>{data ? formatNumber(Number(data.counts?.rates || 0)) : "..."}</b></div>
          <div><span>盘口状态</span><b>{data ? formatNumber(Number(data.counts?.platformStatuses || 0)) : "..."}</b></div>
          <div><span>最新数据日期</span><b>{data?.volume?.last_data_date || "-"}</b></div>
          <div className="wide"><span>三方量最后同步</span><b>{timeText(data?.volume?.last_sync_at)}</b></div>
          <div className="wide"><span>费率最后同步</span><b>{timeText(data?.ratesStatus?.last_sync_at)}</b></div>
        </div>
      )}
      {refreshText && <div className={refreshText.includes("失败") ? "home-refresh-progress bad" : "home-refresh-progress"}>{refreshText}</div>}
      <p>{profile?.role !== "viewer" ? "自动 Cron 仍会每小时同步；上面的“刷新最新数据”仅供管理员需要立即更新时使用。" : "你的账号为只读 Viewer，只能查看管理员分配的模块。"}</p>
    </section>
  );
}
