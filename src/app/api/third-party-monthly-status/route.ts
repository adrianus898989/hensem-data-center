import { NextResponse } from "next/server";
import { withDashboardDataAccess } from "@/lib/dashboardDataAccessServer";
import { readLatestThirdPartyMonthlyJobStatus } from "@/lib/thirdPartyMonthlySync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return withDashboardDataAccess(request, "third_party", async () => {
  const status = await readLatestThirdPartyMonthlyJobStatus().catch(() => null);
  return NextResponse.json({ ok: true, status }, {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
  }, {allDataOnly: true});
}
