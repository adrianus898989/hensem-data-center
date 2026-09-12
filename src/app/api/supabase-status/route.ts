import { NextResponse } from "next/server";
import { dashboardDataErrorResponse, dashboardPrivateHeaders } from "@/lib/dashboardDataAccessServer";
import { readSupabaseHomeStatus } from "@/lib/supabaseDashboardServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET(request: Request) {
  try {
    return NextResponse.json(await readSupabaseHomeStatus(request), { status: 200, headers: dashboardPrivateHeaders() });
  } catch (error) {
    return dashboardDataErrorResponse(error);
  }
}
