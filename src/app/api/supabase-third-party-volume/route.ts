import { NextResponse } from "next/server";
import { dashboardDataErrorResponse, dashboardPrivateHeaders } from "@/lib/dashboardDataAccessServer";
import { readSupabaseThirdPartyVolume } from "@/lib/supabaseDashboardServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const start = url.searchParams.get("start") || url.searchParams.get("startDate") || "";
    const end = url.searchParams.get("end") || url.searchParams.get("endDate") || start;
    const country = url.searchParams.get("country") || "";
    const payload = await readSupabaseThirdPartyVolume(request, start, end, country);
    return NextResponse.json(payload, { status: 200, headers: dashboardPrivateHeaders() });
  } catch (error) {
    return dashboardDataErrorResponse(error);
  }
}
