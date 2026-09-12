import { NextResponse } from "next/server";
import { withDashboardDataAccess } from "@/lib/dashboardDataAccessServer";
import { getThirdPartyVolumePayload, getThirdPartyRatePayload } from "@/lib/googleSheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 26;

export async function GET(request: Request) {
  return withDashboardDataAccess(request, "third_party", async () => {
  const url = new URL(request.url);
  const moduleName = url.searchParams.get("module") || "volume";
  try {
    if (moduleName === "rates") {
      const payload = await getThirdPartyRatePayload();
      return NextResponse.json({
        ok: true,
        module: "third-party-rates",
        sheets: ((payload.meta as any).sheets || []).length,
        rates: payload.rates.length,
        platformStatuses: payload.platformStatuses.length,
        updatedAt: payload.meta.updatedAt,
        message: payload.meta.message || ""
      });
    }

    const payload = await getThirdPartyVolumePayload({
      startDate: url.searchParams.get("start") || undefined,
      endDate: url.searchParams.get("end") || undefined,
      months: url.searchParams.getAll("month"),
      forceAll: url.searchParams.get("all") === "1"
    });
    return NextResponse.json({
      ok: true,
      module: "third-party-volume",
      sheets: ((payload.meta as any).sheets || []).length,
      rows: payload.rows.length,
      summary: payload.summary,
      updatedAt: payload.meta.updatedAt,
      message: payload.meta.message || "",
      monthKeys: (payload.meta as any).monthKeys || [],
      failedSheets: (payload.meta as any).failedSheets || []
    });
  } catch (error) { throw error; }
  }, {ownerOnly: true});
}
