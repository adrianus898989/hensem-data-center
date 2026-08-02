import { NextResponse } from "next/server";
import { readLatestThirdPartyMonthlyJobStatus } from "@/lib/thirdPartyMonthlySync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const status = await readLatestThirdPartyMonthlyJobStatus().catch(() => null);
  return NextResponse.json({ ok: true, status }, {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}
