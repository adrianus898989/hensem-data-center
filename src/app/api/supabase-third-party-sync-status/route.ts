import { NextResponse } from "next/server";
import { dashboardDataErrorResponse, dashboardPrivateHeaders } from "@/lib/dashboardDataAccessServer";
import { readSupabaseThirdPartySyncStatus } from "@/lib/supabaseDashboardServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const start = url.searchParams.get("start") || "";
    const end = url.searchParams.get("end") || start;
    const payload = await readSupabaseThirdPartySyncStatus(request, start, end);
    return NextResponse.json(payload, { status: 200, headers: dashboardPrivateHeaders() });
  } catch (error) {
    return dashboardDataErrorResponse(error);
  }
}
