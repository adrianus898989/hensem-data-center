import { NextResponse } from "next/server";
import { dashboardDataErrorResponse, dashboardPrivateHeaders } from "@/lib/dashboardDataAccessServer";
import { readOriginalRateSheet } from "@/lib/originalRateGridServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const payload = await readOriginalRateSheet(request);
    return NextResponse.json(payload, { status: 200, headers: dashboardPrivateHeaders() });
  } catch (error) {
    return dashboardDataErrorResponse(error);
  }
}
