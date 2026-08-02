import { NextResponse } from "next/server";
import { readSupabaseHomeStatus } from "@/lib/supabaseDashboardServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET(request: Request) {
  try {
    return NextResponse.json(await readSupabaseHomeStatus(request), { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Supabase 状态读取失败");
    const status = /未登录|登录状态|权限|停用/.test(message) ? 401 : 500;
    return NextResponse.json({ ok: false, message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
