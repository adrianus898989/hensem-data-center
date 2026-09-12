import { NextResponse } from "next/server";
import { emptyCustomerServicePayload } from "@/lib/emptyPayloads";
import {
  currentMonthKey,
  isSettlementMonth,
  previousMonthKey,
  readCombinedMonthlyPayload,
  requestedMonthsFromUrl,
  writeMonthlySnapshot
} from "@/lib/monthlySnapshotStore";
import { monthlyResponseHeaders } from "@/lib/monthlyApiResponse";
import { withDashboardDataAccess, scopeCustomerServicePayload, requireDashboardRefresh } from "@/lib/dashboardDataAccessServer";
import { countSnapshotPayloadRows, isSnapshotPayloadUsable } from "@/lib/snapshotStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  return withDashboardDataAccess(request, "customer_service", async (access) => {
  const url = new URL(request.url);
  const forceLive = url.searchParams.get("live") === "1" || url.searchParams.get("refresh") === "1";
  const months = requestedMonthsFromUrl(url);
  let snapshot = await readCombinedMonthlyPayload("customer-service", months).catch(() => null);
  let responseMonths = months;
  const explicitRange = Boolean(url.searchParams.get("month") || url.searchParams.get("months") || url.searchParams.get("start") || url.searchParams.get("startDate") || url.searchParams.get("end") || url.searchParams.get("endDate"));
  if (!snapshot && !explicitRange) {
    const previous = previousMonthKey();
    if (isSettlementMonth(previous)) {
      const fallback = await readCombinedMonthlyPayload("customer-service", [previous]).catch(() => null);
      if (fallback) { snapshot = fallback; responseMonths = [previous]; }
    }
  }

  if (!snapshot && forceLive && months.length === 1 && months[0] === currentMonthKey()) {
    requireDashboardRefresh(access);
    try {
      const { getCustomerServicePayload } = await import("@/lib/googleSheets");
      const payload = await getCustomerServicePayload({ months: [currentMonthKey()] });
      const rows = countSnapshotPayloadRows("customer-service", payload as any);
      if (rows <= 0 || !isSnapshotPayloadUsable("customer-service", payload as any)) {
        throw new Error((payload as any)?.meta?.message || `${currentMonthKey()} 客服返回 0 行`);
      }
      await writeMonthlySnapshot("customer-service", currentMonthKey(), payload as any, "manual-sync", { status: "current" });
      snapshot = await readCombinedMonthlyPayload("customer-service", months).catch(() => payload as any);
    } catch {
      snapshot = null;
    }
  }

  if (snapshot) {
    const headers = monthlyResponseHeaders(responseMonths);
    return NextResponse.json(scopeCustomerServicePayload(access, snapshot), { headers, status: 200 });
  }

  return NextResponse.json(
    emptyCustomerServicePayload(`暂时没有 ${months.map((month) => month.replace("_", "-")).join("、")} 的客服月快照。当前月每小时更新；历史月份只读。`),
    { headers: monthlyResponseHeaders(months, "", false), status: 200 }
  );
  });
}
