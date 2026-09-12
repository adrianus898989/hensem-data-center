import { validateWGConfigSnapshot } from "../src/lib/wgConfigContract.ts";

// This endpoint accepts a dedicated WG snapshot key, never a WG browser token.
// All writes target our own independent configuration tables, not WG or reports.
const MAX_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const only = (v: Record<string, any>, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
export async function wgConfigHash(text: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), b => b.toString(16).padStart(2, "0")).join("");
}
class ReceiverError extends Error { constructor(public code: string, public status: number) { super(code); } }
async function readBody(request: Request) {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new ReceiverError("request_too_large", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ReceiverError("invalid_request", 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > MAX_BYTES) { await reader.cancel(); throw new ReceiverError("request_too_large", 413); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const part of chunks) { bytes.set(part, at); at += part.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ReceiverError("invalid_request", 400); }
}

export function createWGConfigHandler(deps: {
  env: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string };
  fetch?: typeof fetch; now?: () => Date;
}) {
  const request = deps.fetch || fetch, now = deps.now || (() => new Date());
  async function db(path: string, method = "GET", body?: unknown) {
    const response = await request(`${deps.env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
      method, headers: { apikey: deps.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${deps.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      let value: any; try { value = await response.json(); } catch { /* no raw error logging */ }
      if (value?.message === "wg_config_unauthorized") throw new ReceiverError("unauthorized", 401);
      if (value?.message === "wg_config_snapshot_id_conflict") throw new ReceiverError("snapshot_id_conflict", 409);
      throw new ReceiverError("config_sync_failed", 503);
    }
    return response.json();
  }
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return reply({ ok: false, error: "method_not_allowed" }, 405);
    const key = req.headers.get("X-Config-Key") || "";
    if (!/^[a-f0-9]{64}$/.test(key)) return reply({ ok: false, error: "unauthorized" }, 401);
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") || "")) return reply({ ok: false, error: "invalid_content_type" }, 415);
    try {
      const tokenHash = await wgConfigHash(key);
      const credentials = await db("wg_config_credentials?" + new URLSearchParams({
        select: "allowed_targets,active,expires_at", token_hash: "eq." + tokenHash, active: "eq.true", limit: "1",
      }));
      const credential = Array.isArray(credentials) && credentials.length === 1 ? credentials[0] : null;
      if (!credential || credential.active !== true || !Array.isArray(credential.allowed_targets)
        || !credential.allowed_targets.length || credential.allowed_targets.some((x: unknown) => typeof x !== "string")
        || !Number.isFinite(Date.parse(credential.expires_at)) || Date.parse(credential.expires_at) <= now().getTime())
        throw new ReceiverError("unauthorized", 401);
      const body = await readBody(req);
      if (!object(body)) throw new ReceiverError("invalid_request", 400);
      if (body.action === "report") {
        if (!only(body, ["action", "platforms", "country_code"])
          || (body.platforms !== undefined && (!Array.isArray(body.platforms) || body.platforms.length > 100
            || body.platforms.some((x: unknown) => typeof x !== "string" || !x || x.length > 80)))
          || (body.country_code !== undefined && (typeof body.country_code !== "string" || !/^[A-Z]{2}$/.test(body.country_code))))
          throw new ReceiverError("invalid_report", 400);
        const rows = await db("wg_config_latest?" + new URLSearchParams({
          select: "country_code,platform,site_code,observed_at,observed_local_date,received_at,configuration_hash,snapshot_id", limit: "1000",
        }));
        if (!Array.isArray(rows)) throw new ReceiverError("config_sync_failed", 503);
        return reply({ ok: true, snapshots: rows.filter(r => credential.allowed_targets.includes(`${r.country_code}:${r.platform}`)
          && (!body.country_code || body.country_code === r.country_code)
          && (!body.platforms?.length || body.platforms.includes(r.platform))) });
      }
      if (body.action !== "ingest" || !only(body, ["action", "snapshot"])) throw new ReceiverError("invalid_action", 400);
      let snapshot;
      try { snapshot = validateWGConfigSnapshot(body.snapshot, now()); }
      catch { throw new ReceiverError("invalid_configuration_snapshot", 422); }
      if (Date.parse(snapshot.observed_at) > now().getTime() + 300000 || Date.parse(snapshot.observed_at) < Date.parse("2020-01-01T00:00:00Z"))
        throw new ReceiverError("invalid_configuration_snapshot", 422);
      if (!credential.allowed_targets.includes(`${snapshot.country_code}:${snapshot.platform}`)) throw new ReceiverError("target_not_allowed", 403);
      const targets = await db("wg_config_targets?" + new URLSearchParams({ select: "site_code,timezone,members",
        country_code: "eq." + snapshot.country_code, platform: "eq." + snapshot.platform, limit: "1" }));
      const target = Array.isArray(targets) && targets.length === 1 ? targets[0] : null;
      if (!target || target.site_code !== snapshot.site_code || target.timezone !== snapshot.timezone
        || !Array.isArray(target.members)) throw new ReceiverError("target_mismatch", 403);
      const expectedSites = ["0", ...target.members.map((m: any) => m.site_code)].sort();
      if (JSON.stringify(expectedSites) !== JSON.stringify(Object.keys(snapshot.configuration.settings).sort()))
        throw new ReceiverError("target_members_mismatch", 403);
      const result = await db("rpc/ingest_wg_config", "POST", { p_snapshot: snapshot,
        p_configuration_hash: await wgConfigHash(JSON.stringify(snapshot.configuration)),
        p_snapshot_hash: await wgConfigHash(JSON.stringify(snapshot)), p_token_hash: tokenHash });
      if (!object(result) || !["accepted", "unchanged", "daily_exists"].includes(result.status)
        || result.snapshot_id !== snapshot.snapshot_id || typeof result.current_snapshot_id !== "string" || !UUID.test(result.current_snapshot_id)
        || (result.status !== "daily_exists" && result.current_snapshot_id !== snapshot.snapshot_id)) throw new ReceiverError("receipt_mismatch", 503);
      return reply({ ok: true, status: result.status, snapshot_id: result.snapshot_id, current_snapshot_id: result.current_snapshot_id });
    } catch (error) {
      const known = error instanceof ReceiverError ? error : new ReceiverError("config_sync_failed", 503);
      return reply({ ok: false, error: known.code }, known.status);
    }
  };
}

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };
if (typeof Deno !== "undefined" && import.meta.main) Deno.serve(createWGConfigHandler({ env: {
  SUPABASE_URL: Deno.env.get("SUPABASE_URL") || "", SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
} }));
