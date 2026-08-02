import { NextResponse } from "next/server";
import { emptyAutoWithdrawPayload } from "@/lib/emptyPayloads";
import {
  currentMonthKey,
  isSettlementMonth,
  previousMonthKey,
  readCombinedMonthlyPayload,
  requestedMonthsFromUrl,
  writeMonthlySnapshot
} from "@/lib/monthlySnapshotStore";
import { monthlyResponseHeaders, weakMonthlyEtag } from "@/lib/monthlyApiResponse";
import { countSnapshotPayloadRows, isSnapshotPayloadUsable } from "@/lib/snapshotStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const forceLive = url.searchParams.get("live") === "1" || url.searchParams.get("refresh") === "1";
  const months = requestedMonthsFromUrl(url);

  // 普通页面请求只读一个月快照。历史月份永不现场读取 Google Sheet。
  let snapshot = await readCombinedMonthlyPayload("auto-withdraw", months).catch(() => null);
  let responseMonths = months;
  // V237：月初当前月尚无数据时，只回退到上月结算快照；不把“上月+当前月”整包一起发给浏览器。
  const explicitRange = Boolean(url.searchParams.get("month") || url.searchParams.get("months") || url.searchParams.get("start") || url.searchParams.get("startDate") || url.searchParams.get("end") || url.searchParams.get("endDate"));
  if (!snapshot && !explicitRange) {
    const previous = previousMonthKey();
    if (isSettlementMonth(previous)) {
      const fallback = await readCombinedMonthlyPayload("auto-withdraw", [previous]).catch(() => null);
      if (fallback) { snapshot = fallback; responseMonths = [previous]; }
    }
  }

  if (!snapshot && forceLive && months.length === 1 && months[0] === currentMonthKey()) {
    try {
      const { getAutoWithdrawPayload } = await import("@/lib/googleSheets");
      const payload = await getAutoWithdrawPayload({ months: [currentMonthKey()] });
      const rows = countSnapshotPayloadRows("auto-withdraw", payload as any);
      if (rows <= 0 || !isSnapshotPayloadUsable("auto-withdraw", payload as any)) {
        throw new Error((payload as any)?.meta?.message || `${currentMonthKey()} 自动出款返回 0 行`);
      }
      await writeMonthlySnapshot("auto-withdraw", currentMonthKey(), payload as any, "manual-sync", { status: "current" });
      snapshot = await readCombinedMonthlyPayload("auto-withdraw", months).catch(() => payload as any);
    } catch {
      snapshot = null;
    }
  }

  if (snapshot) {
    const etag = weakMonthlyEtag("auto-withdraw", responseMonths, snapshot);
    const headers = monthlyResponseHeaders(responseMonths, etag);
    if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
    return NextResponse.json(snapshot, { headers, status: 200 });
  }

  const payload = emptyAutoWithdrawPayload(
    `暂时没有 ${months.map((month) => month.replace("_", "-")).join("、")} 的自动出款月快照。当前月每小时更新；历史月份只读且不会被覆盖。`
  );
  return NextResponse.json(payload, { headers: monthlyResponseHeaders(months, "", false), status: 200 });
}
