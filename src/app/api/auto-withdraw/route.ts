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
import { readSupabaseAutoWithdraw } from "@/lib/supabaseDashboardServer";
import type { AutoWithdrawPayload } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const SUPABASE_START_MONTH = "2026_08";

function monthBounds(months: string[]): { start: string; end: string } {
  const sorted = [...months].filter((m) => /^20\d{2}_\d{2}$/.test(m)).sort();
  const first = sorted[0] || SUPABASE_START_MONTH;
  const last = sorted[sorted.length - 1] || first;
  const [sy, sm] = first.split("_").map(Number);
  const [ey, em] = last.split("_").map(Number);
  const lastDay = new Date(Date.UTC(ey, em, 0)).getUTCDate();
  return {
    start: `${sy}-${String(sm).padStart(2, "0")}-01`,
    end: `${ey}-${String(em).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

function combinePayloads(oldPayload: AutoWithdrawPayload | null, newPayload: AutoWithdrawPayload | null): AutoWithdrawPayload | null {
  if (!oldPayload) return newPayload;
  if (!newPayload) return oldPayload;
  return {
    meta: {
      ...newPayload.meta,
      year: oldPayload.meta.year || newPayload.meta.year,
      month: newPayload.meta.month || oldPayload.meta.month,
      updatedAt: [oldPayload.meta.updatedAt, newPayload.meta.updatedAt].filter(Boolean).sort().pop() || new Date().toISOString(),
      source: "history+supabase",
      message: "4-7月历史快照只读 · 8月起 Supabase 持续同步",
      rawDailyRows: Number(oldPayload.meta.rawDailyRows || 0) + Number(newPayload.meta.rawDailyRows || 0),
      rawOperatorRows: Number(oldPayload.meta.rawOperatorRows || 0) + Number(newPayload.meta.rawOperatorRows || 0),
    },
    monthlyRows: [...oldPayload.monthlyRows, ...newPayload.monthlyRows],
    dailyRows: [...oldPayload.dailyRows, ...newPayload.dailyRows],
    operatorRows: [...oldPayload.operatorRows, ...newPayload.operatorRows],
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const forceLive = url.searchParams.get("live") === "1" || url.searchParams.get("refresh") === "1";
  const months = requestedMonthsFromUrl(url);
  const oldMonths = months.filter((month) => month < SUPABASE_START_MONTH);
  const newMonths = months.filter((month) => month >= SUPABASE_START_MONTH);

  // 4-7月：继续读取原有只读月快照，不重新同步、不覆盖。
  let oldSnapshot: AutoWithdrawPayload | null = null;
  if (oldMonths.length) {
    oldSnapshot = await readCombinedMonthlyPayload("auto-withdraw", oldMonths).catch(() => null);
  }

  // 兼容旧逻辑：历史快照缺失且显式要求当前月 live 时，仍允许旧数据源手动生成快照。
  if (!oldSnapshot && !newMonths.length && forceLive && months.length === 1 && months[0] === currentMonthKey()) {
    try {
      const { getAutoWithdrawPayload } = await import("@/lib/googleSheets");
      const payload = await getAutoWithdrawPayload({ months: [currentMonthKey()] });
      const rows = countSnapshotPayloadRows("auto-withdraw", payload as any);
      if (rows <= 0 || !isSnapshotPayloadUsable("auto-withdraw", payload as any)) throw new Error("自动出款返回 0 行");
      await writeMonthlySnapshot("auto-withdraw", currentMonthKey(), payload as any, "manual-sync", { status: "current" });
      oldSnapshot = payload as AutoWithdrawPayload;
    } catch {
      oldSnapshot = null;
    }
  }

  // 8月起：直接读 Supabase。按“月份”整月取数，保持原页面月内切日/切月无需重复拉取。
  let supabasePayload: AutoWithdrawPayload | null = null;
  if (newMonths.length) {
    try {
      const bounds = monthBounds(newMonths);
      const requestedStart = String(url.searchParams.get("start") || url.searchParams.get("startDate") || "");
      const requestedEnd = String(url.searchParams.get("end") || url.searchParams.get("endDate") || requestedStart || "");
      const start = /^20\d{2}-\d{2}-\d{2}$/.test(requestedStart) && requestedStart > bounds.start ? requestedStart : bounds.start;
      const end = /^20\d{2}-\d{2}-\d{2}$/.test(requestedEnd) && requestedEnd < bounds.end ? requestedEnd : bounds.end;
      supabasePayload = await readSupabaseAutoWithdraw(request, start, end);
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取 Supabase 自动出款失败";
      return NextResponse.json({ ...emptyAutoWithdrawPayload(message), message }, { status: /未登录|登录状态|权限/.test(message) ? 401 : 500, headers: { "Cache-Control": "no-store" } });
    }
  }

  let payload = combinePayloads(oldSnapshot, supabasePayload);

  // 无显式日期时，如果旧月份没有快照，保留旧版月初回退逻辑。
  const explicitRange = Boolean(url.searchParams.get("month") || url.searchParams.get("months") || url.searchParams.get("start") || url.searchParams.get("startDate") || url.searchParams.get("end") || url.searchParams.get("endDate"));
  if (!payload && !explicitRange && !newMonths.length) {
    const previous = previousMonthKey();
    if (isSettlementMonth(previous)) {
      payload = await readCombinedMonthlyPayload("auto-withdraw", [previous]).catch(() => null);
    }
  }

  if (payload) {
    if (newMonths.length) {
      return NextResponse.json(payload, { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } });
    }
    const etag = weakMonthlyEtag("auto-withdraw", oldMonths, payload);
    const headers = monthlyResponseHeaders(oldMonths, etag);
    if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
    return NextResponse.json(payload, { headers, status: 200 });
  }

  const empty = emptyAutoWithdrawPayload(
    `暂时没有 ${months.map((month) => month.replace("_", "-")).join("、")} 的自动出款数据。4-7月保持历史快照；8月起使用 Supabase。`
  );
  return NextResponse.json(empty, { headers: monthlyResponseHeaders(months, "", false), status: 200 });
}
