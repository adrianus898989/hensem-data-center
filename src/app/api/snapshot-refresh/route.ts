import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { requireDashboardDataAccess, requireDashboardRefresh, requireDashboardModule, dashboardPrivateResponse, dashboardDataErrorResponse } from "@/lib/dashboardDataAccessServer";
import { getSnapshotModuleKeys, refreshSnapshotModule } from "@/lib/snapshotSync";
import type { SnapshotModuleKey } from "@/lib/snapshotStore";
import { queueThirdPartyMonthlyJob } from "@/lib/thirdPartyMonthlySync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function isTrustedRefreshRequest(request: Request): boolean {
  const token = process.env.SNAPSHOT_REFRESH_TOKEN || process.env.DASHBOARD_REFRESH_TOKEN || "";
  if (!token) return false;
  const url = new URL(request.url);
  const provided = url.searchParams.get("token") || request.headers.get("x-refresh-token") || "";
  const expectedBytes = Buffer.from(token), suppliedBytes = Buffer.from(provided);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

async function handle(request: Request) {
  // Preserve the dedicated internal scheduler credential. An ordinary browser
  // must authenticate and have global refresh permission, not just same origin.
  const access = isTrustedRefreshRequest(request) ? null : await requireDashboardDataAccess(request);
  if (access) requireDashboardRefresh(access);

  const url = new URL(request.url);
  const moduleParam = url.searchParams.get("module") as SnapshotModuleKey | null;
  const allowed = getSnapshotModuleKeys();
  if (moduleParam && !allowed.includes(moduleParam)) {
    return NextResponse.json({ ok: false, message: "未知模块" }, { status: 400 });
  }
  if (access) {
    const modules = {"auto-withdraw":"auto_withdraw", "work-orders":"work_orders", "third-party-volume":"third_party", "third-party-rates":"third_party", "customer-service":"customer_service"} as const;
    // Refresh results contain module-wide metadata. Do not return them to an
    // ordinary browser whose account cannot read that module.
    for (const key of moduleParam ? [moduleParam] : allowed) requireDashboardModule(access, modules[key]);
  }

  try {
    // V222：三方量不再在网页 API 请求里直接读取 Google Sheet。
    // 网页请求只负责把任务放进 Background Function，立即返回 JSON；页面关闭后任务仍继续。
    if (moduleParam === "third-party-volume") {
      // V228：所有网页刷新入口都只刷新当前月，历史月永久封存。
      const queued = await queueThirdPartyMonthlyJob({
        mode: "current",
        origin: url.origin,
        force: true
      });
      return NextResponse.json(queued, { status: 202 });
    }

    if (moduleParam) {
      const results = [await refreshSnapshotModule(moduleParam, "manual-sync")];
      const ok = results.every((item) => item.ok);
      return NextResponse.json({ ok, updatedAt: new Date().toISOString(), results }, { status: ok ? 200 : 500 });
    }

    // “全部刷新”也不再走旧三方量分片逻辑；其它模块照常，三方量单独进入 V225 月度后台队列。
    const results = [];
    for (const key of allowed.filter((item) => item !== "third-party-volume")) {
      results.push(await refreshSnapshotModule(key, "manual-sync"));
    }
    const thirdPartyQueued = await queueThirdPartyMonthlyJob({ mode: "current", origin: url.origin, force: true });
    const ok = results.every((item) => item.ok) && thirdPartyQueued.ok;
    return NextResponse.json({ ok, updatedAt: new Date().toISOString(), results, thirdPartyQueued }, { status: ok ? 200 : 500 });
  } catch (error) { throw error; }
}

export async function GET(request: Request) {
  try { return dashboardPrivateResponse(await handle(request)); }
  catch (error) { return dashboardDataErrorResponse(error); }
}

export async function POST(request: Request) {
  return GET(request);
}
