import { NextResponse } from "next/server";
import { withDashboardDataAccess } from "@/lib/dashboardDataAccessServer";
import { getAutoWithdrawPayload } from "@/lib/googleSheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export async function GET(request: Request) {
  return withDashboardDataAccess(request, "auto_withdraw", async () => {
  try {
    const payload = await getAutoWithdrawPayload();
    const operatorRows = payload.operatorRows || [];
    const dailyRows = payload.dailyRows || [];
    return NextResponse.json({
      ok: true,
      meta: payload.meta,
      counts: {
        dailyRows: dailyRows.length,
        monthlyRows: payload.monthlyRows?.length || 0,
        operatorRows: operatorRows.length,
        rawDailyRows: payload.meta.rawDailyRows || 0,
        rawOperatorRows: payload.meta.rawOperatorRows || 0
      },
      dates: {
        daily: uniq(dailyRows.map((r) => r.date)).sort().slice(-10),
        operator: uniq(operatorRows.map((r) => r.date)).sort().slice(-10)
      },
      countries: {
        daily: uniq(dailyRows.map((r) => r.country)).sort(),
        operator: uniq(operatorRows.map((r) => r.country)).sort()
      },
      sampleOperatorRows: operatorRows.slice(0, 10)
    });
  } catch (error) { throw error; }
  }, {ownerOnly: true});
}
