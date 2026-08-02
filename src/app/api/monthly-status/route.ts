import { NextResponse } from "next/server";
import {
  currentMonthKey,
  isSettlementMonth,
  previousMonthKey,
  readMonthlyCheckStatus,
  type MonthlySnapshotModuleKey
} from "@/lib/monthlySnapshotStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

function validModule(value: string): MonthlySnapshotModuleKey | null {
  const key = String(value || "") as MonthlySnapshotModuleKey;
  return ["auto-withdraw", "work-orders", "third-party-volume", "customer-service"].includes(key) ? key : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = validModule(url.searchParams.get("module") || "");
  if (!key) {
    return NextResponse.json({ ok: false, message: "无效模块" }, { status: 400 });
  }

  const current = currentMonthKey();
  const previous = previousMonthKey();
  const currentStatus = await readMonthlyCheckStatus(key, current).catch(() => null);
  const settlingStatus = isSettlementMonth(previous)
    ? await readMonthlyCheckStatus(key, previous).catch(() => null)
    : null;
  const preferred = (currentStatus?.rows || 0) > 0 ? currentStatus : ((settlingStatus?.rows || 0) > 0 ? settlingStatus : currentStatus || settlingStatus);

  return NextResponse.json({
    ok: true,
    module: key,
    currentMonth: current,
    settlingMonth: isSettlementMonth(previous) ? previous : null,
    preferredMonth: preferred?.month || current,
    version: preferred ? `${preferred.month}:${preferred.checksum || preferred.changedAt || preferred.rows || ""}` : "",
    checkedAt: preferred?.checkedAt || null,
    changedAt: preferred?.changedAt || null,
    rows: preferred?.rows || 0,
    status: preferred?.status || "current",
    current: currentStatus,
    settling: settlingStatus
  }, {
    status: 200,
    headers: {
      "Cache-Control": "public, max-age=20, stale-while-revalidate=40",
      "Netlify-CDN-Cache-Control": "public, durable, max-age=20, stale-while-revalidate=40",
      "CDN-Cache-Control": "public, max-age=20, stale-while-revalidate=40",
      "Vary": "Accept-Encoding"
    }
  });
}
