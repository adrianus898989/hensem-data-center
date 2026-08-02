import { NextResponse } from "next/server";
import { getSnapshotModuleKeys, refreshSnapshotModule } from "@/lib/snapshotSync";
import type { SnapshotModuleKey } from "@/lib/snapshotStore";
import { queueThirdPartyMonthlyJob } from "@/lib/thirdPartyMonthlySync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function isSameOriginBrowserRequest(request: Request): boolean {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const fetchSite = String(request.headers.get("sec-fetch-site") || "").toLowerCase();

  if (origin) return origin === requestUrl.origin;
  if (referer) {
    try {
      return new URL(referer).origin === requestUrl.origin;
    } catch {
      return false;
    }
  }
  return fetchSite === "same-origin" || fetchSite === "same-site";
}

function isAllowed(request: Request): boolean {
  const token = process.env.SNAPSHOT_REFRESH_TOKEN || process.env.DASHBOARD_REFRESH_TOKEN || "";
  if (!token) return true;
  if (request.method === "POST" && isSameOriginBrowserRequest(request)) return true;

  const url = new URL(request.url);
  const provided = url.searchParams.get("token") || request.headers.get("x-refresh-token") || "";
  return provided === token;
}

async function handle(request: Request) {
  if (!isAllowed(request)) {
    return NextResponse.json({ ok: false, message: "Invalid refresh token" }, { status: 401 });
  }

  const url = new URL(request.url);
  const moduleParam = url.searchParams.get("module") as SnapshotModuleKey | null;
  const allowed = getSnapshotModuleKeys();

  try {
    // V222：三方量不再在网页 API 请求里直接读取 Google Sheet。
    // 网页请求只负责把任务放进 Background Function，立即返回 JSON；页面关闭后任务仍继续。
    if (moduleParam === "third-party-volume") {
      // V228：所有网页刷新入口都只刷新当前月，历史月永久封存。
      const queued = await queueThirdPartyMonthlyJob({
        mode: "current",
        origin: url.origin,
        force: true
      });
      return NextResponse.json(queued, { status: 202 });
    }

    if (moduleParam && !allowed.includes(moduleParam)) {
      return NextResponse.json({ ok: false, message: `未知模块：${moduleParam}` }, { status: 400 });
    }

    if (moduleParam) {
      const results = [await refreshSnapshotModule(moduleParam, "manual-sync")];
      const ok = results.every((item) => item.ok);
      return NextResponse.json({ ok, updatedAt: new Date().toISOString(), results }, { status: ok ? 200 : 500 });
    }

    // “全部刷新”也不再走旧三方量分片逻辑；其它模块照常，三方量单独进入 V225 月度后台队列。
    const results = [];
    for (const key of allowed.filter((item) => item !== "third-party-volume")) {
      results.push(await refreshSnapshotModule(key, "manual-sync"));
    }
    const thirdPartyQueued = await queueThirdPartyMonthlyJob({ mode: "current", origin: url.origin, force: true });
    const ok = results.every((item) => item.ok) && thirdPartyQueued.ok;
    return NextResponse.json({ ok, updatedAt: new Date().toISOString(), results, thirdPartyQueued }, { status: ok ? 200 : 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
