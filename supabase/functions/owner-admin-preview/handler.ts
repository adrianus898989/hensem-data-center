/** Private preview delivery. Fresh Auth/profile/grant checks; no public data files. */
export const PREVIEW_ORIGIN = "https://adrianus898989.github.io";

export type PreviewOptions = {
  supabaseUrl: string;
  anonKey: string;
  payloadBase64: string;
  serviceRoleKey?: string;
  fetcher?: typeof fetch;
};

const allowedHeaders = new Set(["authorization", "apikey", "content-type", "x-client-info"]);
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "CDN-Cache-Control": "private, no-store",
  "Surrogate-Control": "no-store",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Origin, Authorization, Accept-Encoding",
  "X-Content-Type-Options": "nosniff",
};

function responseHeaders(origin: string | null): Headers {
  const headers = new Headers(privateHeaders);
  if (origin === PREVIEW_ORIGIN) headers.set("Access-Control-Allow-Origin", PREVIEW_ORIGIN);
  return headers;
}

function errorResponse(origin: string | null, status: number, code: string): Response {
  const headers = responseHeaders(origin);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (status === 405) headers.set("Allow", "GET, POST, OPTIONS");
  return new Response(JSON.stringify({ ok: false, code }), { status, headers });
}

export function createOwnerAdminPreviewHandler(options: PreviewOptions): (request: Request) => Promise<Response> {
  const fetcher = options.fetcher || fetch;
  // Only decoded after an authenticated, currently enabled, authorized account requests the HTML.
  let compressed: Uint8Array | null = null;
  return async function ownerAdminPreview(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== PREVIEW_ORIGIN) return errorResponse(origin, 403, "origin_denied");
    if (request.method === "OPTIONS") {
      const method = request.headers.get("access-control-request-method");
      const requestedHeaders = (request.headers.get("access-control-request-headers") || "")
        .split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
      if (origin !== PREVIEW_ORIGIN || !["GET", "POST"].includes(method || "") || requestedHeaders.some(header => !allowedHeaders.has(header))) {
        return errorResponse(origin, 403, "preflight_denied");
      }
      const headers = responseHeaders(origin);
      headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info");
      headers.set("Access-Control-Max-Age", "0");
      return new Response(null, { status: 204, headers });
    }
    const requestUrl = new URL(request.url);
    const action = requestUrl.searchParams.get("action") || "";
    if (!["", "access", "grants"].includes(action)) return errorResponse(origin, 400, "invalid_action");
    if (request.method !== "GET" && !(request.method === "POST" && action === "grants")) return errorResponse(origin, 405, "method_not_allowed");
    const bearer = /^Bearer ([^\s,]{1,16384})$/i.exec(request.headers.get("authorization") || "");
    if (!bearer) return errorResponse(origin, 401, "login_required");

    const base = options.supabaseUrl.trim().replace(/\/$/, "");
    const key = options.anonKey.trim();
    try {
      const url = new URL(base);
      if (!key || url.protocol !== "https:" || url.origin !== base || url.username || url.password) {
        return errorResponse(origin, 503, "auth_unavailable");
      }
    } catch { return errorResponse(origin, 503, "auth_unavailable"); }

    const read = (path: string) => fetcher(base + path, {
      method: "GET", headers: { apikey: key, Authorization: `Bearer ${bearer[1]}`, Accept: "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
    });
    try {
      // Do not authorize from JWT claims or user-editable user_metadata.
      const auth = await read("/auth/v1/user");
      if (auth.status === 401 || auth.status === 403) return errorResponse(origin, 401, "login_required");
      if (!auth.ok) return errorResponse(origin, 503, "auth_unavailable");
      const user: unknown = await auth.json();
      const userId = user && typeof user === "object" && "id" in user ? (user as { id: unknown }).id : null;
      if (typeof userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
        return errorResponse(origin, 401, "login_required");
      }
      const query = new URLSearchParams({ select: "auth_user_id,role,active", auth_user_id: `eq.${userId}`, limit: "2" });
      const profileResult = await read(`/rest/v1/dashboard_profiles?${query}`);
      if (profileResult.status === 401) return errorResponse(origin, 401, "login_required");
      if (profileResult.status === 403) return errorResponse(origin, 403, "profile_denied");
      if (!profileResult.ok) return errorResponse(origin, 503, "auth_unavailable");
      const rows: unknown = await profileResult.json();
      const profile = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
      if (!profile || profile.auth_user_id !== userId || profile.active !== true || !["owner", "admin", "viewer"].includes(profile.role)) {
        return errorResponse(origin, 403, "profile_denied");
      }
      const headers = responseHeaders(origin);
      const json = (value: unknown, status = 200): Response => {
        headers.set("Content-Type", "application/json; charset=utf-8");
        return new Response(JSON.stringify(value), { status, headers });
      };
      const canManage = profile.role === "owner";
      if (action === "grants") {
        // This privileged client is constructed only after fresh Auth/profile owner authorization.
        if (!canManage) return errorResponse(origin, 403, "owner_required");
        const serviceKey = options.serviceRoleKey?.trim();
        if (!serviceKey) return errorResponse(origin, 503, "management_unavailable");
        const adminRead = (path: string, init: RequestInit = {}) => fetcher(base + path, {
          ...init, method: init.method || "GET", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
            Accept: "application/json", "Content-Type": "application/json", Prefer: init.method === "POST" ? "resolution=merge-duplicates,return=representation" : "count=exact" },
          cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
        });
        if (request.method === "GET") {
          const rawOffset = requestUrl.searchParams.get("offset") || "0";
          if (!/^\d{1,7}$/.test(rawOffset)) return errorResponse(origin, 400, "invalid_offset");
          const offset = Number(rawOffset), limit = Number(requestUrl.searchParams.get("limit") || "20");
          if (![20, 30, 50, 100, 500].includes(limit)) return errorResponse(origin, 400, "invalid_limit");
          const search = (requestUrl.searchParams.get("search") || "").trim();
          // Restrict only the optional username search syntax; this is never an ID or raw SQL filter.
          if (search.length > 80 || /[^\p{L}\p{N} ._@-]/u.test(search)) return errorResponse(origin, 400, "invalid_search");
          const listQuery = new URLSearchParams({ select: "auth_user_id,username,role,active", order: "username.asc,auth_user_id.asc", offset: String(offset), limit: String(limit) });
          if (search) listQuery.set("username", `ilike.*${search.replaceAll("_", "\\_")}*`);
          const listed = await adminRead(`/rest/v1/dashboard_profiles?${listQuery}`);
          if (!listed.ok) return errorResponse(origin, 503, "management_unavailable");
          const accounts: unknown = await listed.json();
          if (!Array.isArray(accounts) || accounts.length > limit || accounts.some(account => !account || typeof account.auth_user_id !== "string" || !/^[0-9a-f-]{36}$/i.test(account.auth_user_id))) {
            return errorResponse(origin, 503, "management_unavailable");
          }
          let grants: unknown = [];
          if (accounts.length) {
            // Even the 500-row page keeps each PostgREST URL bounded. Every batch
            // contains only IDs in this one requested page, never all accounts.
            const batches = Array.from({ length: Math.ceil(accounts.length / 100) }, (_, index) => accounts.slice(index * 100, index * 100 + 100));
            const results = await Promise.all(batches.map(async batch => {
              const query = new URLSearchParams({ select: "auth_user_id,can_view", auth_user_id: `in.(${batch.map(account => account.auth_user_id).join(",")})`, limit: String(batch.length) });
              const result = await adminRead(`/rest/v1/dashboard_admin_preview_grants?${query}`);
              if (!result.ok) return null;
              const value: unknown = await result.json();
              return Array.isArray(value) && value.length <= batch.length ? value : null;
            }));
            if (results.some(result => result === null)) return errorResponse(origin, 503, "management_unavailable");
            grants = results.flat();
          }
          const permitted = new Set((grants as Array<{ auth_user_id: string; can_view: boolean }>).filter(grant => grant?.can_view === true).map(grant => grant.auth_user_id));
          const totalText = listed.headers.get("content-range")?.split("/")[1];
          if (!totalText || !/^\d+$/.test(totalText)) return errorResponse(origin, 503, "management_unavailable");
          const total = Number(totalText);
          return json({ ok: true, accounts: accounts.map(account => ({ auth_user_id: account.auth_user_id, username: String(account.username || ""), role: account.role,
            active: account.active === true, can_view: account.active === true && (account.role === "owner" || permitted.has(account.auth_user_id)) })),
            offset, limit, total, hasMore: offset + accounts.length < total });
        }
        if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") || "")) return errorResponse(origin, 415, "invalid_content_type");
        const reader = request.body?.getReader();
        if (!reader) return errorResponse(origin, 400, "invalid_grant");
        const chunks: Uint8Array[] = []; let length = 0;
        for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length;
          if (length > 4096) { await reader.cancel(); return errorResponse(origin, 413, "grant_too_large"); } chunks.push(part.value); }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        let mutation: unknown;
        try { mutation = JSON.parse(new TextDecoder().decode(bytes)); } catch { return errorResponse(origin, 400, "invalid_grant"); }
        if (!mutation || typeof mutation !== "object" || Array.isArray(mutation)) return errorResponse(origin, 400, "invalid_grant");
        const grant = mutation as Record<string, unknown>;
        if (Object.keys(grant).some(key => !["auth_user_id", "can_view"].includes(key)) || typeof grant.auth_user_id !== "string"
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(grant.auth_user_id) || typeof grant.can_view !== "boolean") return errorResponse(origin, 400, "invalid_grant");
        const targetQuery = new URLSearchParams({ select: "auth_user_id,role,active", auth_user_id: `eq.${grant.auth_user_id}`, limit: "2" });
        const targetResult = await adminRead(`/rest/v1/dashboard_profiles?${targetQuery}`);
        if (!targetResult.ok) return errorResponse(origin, 503, "management_unavailable");
        const targets: unknown = await targetResult.json();
        const target = Array.isArray(targets) && targets.length === 1 ? targets[0] : null;
        if (!target || target.auth_user_id !== grant.auth_user_id) return errorResponse(origin, 404, "account_not_found");
        if (target.role === "owner") return errorResponse(origin, 400, "owner_access_inherent");
        if (!["admin", "viewer"].includes(target.role) || grant.can_view && target.active !== true) return errorResponse(origin, 400, "account_inactive");
        const saved = await adminRead("/rest/v1/dashboard_admin_preview_grants?on_conflict=auth_user_id&select=auth_user_id,can_view", {
          method: "POST", body: JSON.stringify({ auth_user_id: grant.auth_user_id, can_view: grant.can_view, granted_by: userId, updated_at: new Date().toISOString() }),
        });
        if (!saved.ok) return errorResponse(origin, 503, "grant_save_failed");
        const result: unknown = await saved.json();
        if (!Array.isArray(result) || result.length !== 1 || result[0]?.auth_user_id !== grant.auth_user_id || result[0]?.can_view !== grant.can_view) return errorResponse(origin, 503, "grant_save_failed");
        return json({ ok: true, auth_user_id: grant.auth_user_id, can_view: grant.can_view });
      }
      let canView = canManage;
      if (!canView) {
        const grantQuery = new URLSearchParams({ select: "auth_user_id,can_view", auth_user_id: `eq.${userId}`, limit: "2" });
        const granted = await read(`/rest/v1/dashboard_admin_preview_grants?${grantQuery}`);
        if (granted.status === 401) return errorResponse(origin, 401, "login_required");
        if (!granted.ok) return errorResponse(origin, 503, "access_unavailable");
        const grants: unknown = await granted.json();
        canView = Array.isArray(grants) && grants.length === 1 && grants[0]?.auth_user_id === userId && grants[0]?.can_view === true;
      }
      if (action === "access") return json({ ok: true, canView, canManage });
      if (!canView) return errorResponse(origin, 403, "preview_denied");
      if (requestUrl.searchParams.get("check") === "1") return json({ ok: true, canView: true, canManage });
      if (compressed === null) {
        const decoded = atob(options.payloadBase64);
        const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
        if (bytes.length < 10 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) {
          return errorResponse(origin, 503, "preview_unavailable");
        }
        compressed = bytes;
      }
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.set("Content-Encoding", "gzip");
      // Uint8Array.from above owns its entire non-shared ArrayBuffer.
      return new Response(compressed.buffer as ArrayBuffer, { status: 200, headers });
    } catch {
      // No upstream response bodies, user identifiers, or tokens enter errors/logs.
      return errorResponse(origin, 503, "preview_unavailable");
    }
  };
}
