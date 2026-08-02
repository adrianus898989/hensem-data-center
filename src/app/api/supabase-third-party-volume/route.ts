import { NextResponse } from "next/server";
import { readSupabaseThirdPartyVolume } from "@/lib/supabaseDashboardServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const start = url.searchParams.get("start") || url.searchParams.get("startDate") || "";
    const end = url.searchParams.get("end") || url.searchParams.get("endDate") || start;
    const payload = await readSupabaseThirdPartyVolume(request, start, end);
    return NextResponse.json(payload, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Supabase 三方量读取失败");
    const status = /未登录|登录状态|权限|停用/.test(message) ? 401 : 500;
    return NextResponse.json({ ok: false, message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
