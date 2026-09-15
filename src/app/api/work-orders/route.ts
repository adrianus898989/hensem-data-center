import { NextResponse } from "next/server";
import { emptyWorkOrderPayload } from "@/lib/emptyPayloads";
import {
  currentMonthKey,
  isSettlementMonth,
  previousMonthKey,
  missingMonthlySnapshotMonths,
  readCombinedMonthlyPayload,
  requestedMonthsFromUrl
} from "@/lib/monthlySnapshotStore";
import { monthlyResponseHeaders } from "@/lib/monthlyApiResponse";
import { withDashboardDataAccess, scopeWorkOrderPayload, requireDashboardRefresh } from "@/lib/dashboardDataAccessServer";
import { queueNetlifyBackgroundFunction } from "@/lib/netlifyFunctionQueue";
import { readSnapshotCursor } from "@/lib/snapshotStore";
import { readSupabaseWorkOrderMonths } from "@/lib/supabaseDashboardServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const WORK_ORDER_STATUS_NAME = "work-orders-worker-status-v226";

export async function GET(request: Request) {
  return withDashboardDataAccess(request, "work_orders", async (access) => {
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get("live") === "1" || url.searchParams.get("refresh") === "1";
  const months = requestedMonthsFromUrl(url);

  // 最新工单优先直读 Supabase；历史月份或迁移尚未完成时继续使用原有 Google 快照兜底。
  const supabasePayload = await readSupabaseWorkOrderMonths(request, months).catch(() => null);
  if (supabasePayload?.rows?.length) {
    return NextResponse.json(scopeWorkOrderPayload(access, supabasePayload), { headers: monthlyResponseHeaders(months), status: 200 });
  }

  // 只有明确刷新当前月时才排队；普通打开页面以及历史查询都只读快照。
  if (forceRefresh && months.length === 1 && months[0] === currentMonthKey()) {
    requireDashboardRefresh(access);
    await queueNetlifyBackgroundFunction(request, "sync-work-orders-background", { source: "manual" }).catch(() => undefined);
  }

  let snapshot = await readCombinedMonthlyPayload("work-orders", months).catch(() => null);
  let responseMonths = months;
  const explicitRange = Boolean(url.searchParams.get("month") || url.searchParams.get("months") || url.searchParams.get("start") || url.searchParams.get("startDate") || url.searchParams.get("end") || url.searchParams.get("endDate"));
  if (!snapshot && !explicitRange) {
    const previous = previousMonthKey();
    if (isSettlementMonth(previous)) {
      const fallback = await readCombinedMonthlyPayload("work-orders", [previous]).catch(() => null);
      if (fallback) { snapshot = fallback; responseMonths = [previous]; }
    }
  }
  if (snapshot) {
    const headers = monthlyResponseHeaders(responseMonths);
    return NextResponse.json(scopeWorkOrderPayload(access, snapshot), { headers, status: 200 });
  }

  const missing = await missingMonthlySnapshotMonths("work-orders", months).catch(() => months);
  const workerStatus = access.scope.mode === "all" ? await readSnapshotCursor<any>(WORK_ORDER_STATUS_NAME).catch(() => null) : null;
  const statusMessage = String(workerStatus?.message || "").trim();
  return NextResponse.json(
    emptyWorkOrderPayload(
      `工单月快照尚未建立；当前缺少 ${missing.map((month) => month.replace("_", "-")).join("、") || "有效月份"}。${statusMessage ? `后台状态：${statusMessage}。` : ""}当前月每小时更新，历史月份只读。`
    ),
    { headers: monthlyResponseHeaders(months, "", false), status: 200 }
  );
  });
}
