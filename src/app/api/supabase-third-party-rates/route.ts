import { NextResponse } from "next/server";
import { dashboardDataErrorResponse, dashboardPrivateHeaders } from "@/lib/dashboardDataAccessServer";
import { readSupabaseThirdPartyRates } from "@/lib/supabaseDashboardServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const payload = await readSupabaseThirdPartyRates(request);
    return NextResponse.json(payload, { status: 200, headers: dashboardPrivateHeaders() });
  } catch (error) {
    return dashboardDataErrorResponse(error);
  }
}
