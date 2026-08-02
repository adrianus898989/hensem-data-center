export type BackgroundQueueResult = {
  ok: boolean;
  status: number;
  text: string;
};

export function requestSiteOrigin(request: Request): string {
  try {
    return new URL(request.url).origin;
  } catch {
    return process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || "";
  }
}

export async function queueNetlifyBackgroundFunction(
  request: Request,
  functionName: string,
  body: Record<string, unknown> = {}
): Promise<BackgroundQueueResult> {
  const origin = requestSiteOrigin(request);
  if (!origin) return { ok: false, status: 0, text: "无法确定 Netlify 站点地址" };

  const token = String(process.env.SNAPSHOT_REFRESH_TOKEN || process.env.DASHBOARD_REFRESH_TOKEN || "");
  try {
    const response = await fetch(`${origin}/.netlify/functions/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...(token ? { "x-refresh-token": token } : {})
      },
      body: JSON.stringify(body)
    });
    const text = await response.text().catch(() => "");
    return { ok: response.ok, status: response.status, text: text.slice(0, 1200) };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: error instanceof Error ? error.message : String(error || "后台排队失败")
    };
  }
}
