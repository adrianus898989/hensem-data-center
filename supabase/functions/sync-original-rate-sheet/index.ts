import { OriginalGridReadError, readOriginalGrid, readOriginalWorkbook } from "./grid.ts";

// Independent source-only ingestion. Never import or call bright-responder,
// normalized fee parsing, volume calculations, or their database tables.
const DEFAULT_SOURCE_ID = "15vq88fo9AU0EXzheSkuIgN03RPsQLDT-5XzXkBf-cyA";
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const MAX_GOOGLE_BYTES = 16 * 1024 * 1024;
const TOTAL_BUDGET_MS = 120_000;
const FAIL_RESERVE_MS = 5_000;
const REQUEST_TIMEOUT_MS = 15_000;
type Runtime = { env: (name: string) => string | undefined; fetch: typeof fetch; now: () => number; crypto: Crypto };
type Config = { sourceId: string; email: string; privateKey: string; supabaseUrl: string; serviceKey: string };
class SyncError extends Error { constructor(readonly code: string, readonly status = 503) { super(code); } }
const encoder = new TextEncoder();

function response(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" } });
}
async function sameSecret(expected: string, supplied: string, crypto: Crypto): Promise<boolean> {
  // Compare fixed-size SHA-256 digests without short-circuiting byte equality.
  // No expected secret or Google credentials are logged or returned.
  if (!expected || !supplied || supplied.length > 4096) return false;
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(expected)), crypto.subtle.digest("SHA-256", encoder.encode(supplied))]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}
function configuredSource(value: string): string {
  const input = value.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (/^[a-zA-Z0-9_-]{10,200}$/.test(input)) return input;
  try {
    const url = new URL(input), match = /^\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,200})(?:\/(?:edit|view|preview|htmlview|copy))?\/?$/.exec(url.pathname);
    if (url.protocol === "https:" && url.hostname === "docs.google.com" && !url.port && !url.username && !url.password && match) return match[1];
  } catch { /* fixed error below */ }
  throw new SyncError("source_configuration_invalid");
}
function config(runtime: Runtime): Config {
  const email = runtime.env("GOOGLE_SERVICE_ACCOUNT_EMAIL") || "";
  const privateKey = (runtime.env("GOOGLE_PRIVATE_KEY") || "").trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n");
  const sourceId = configuredSource(runtime.env("THIRD_PARTY_RATE_SHEET_ID") || runtime.env("THIRD_PARTY_RATE_SPREADSHEET_ID") || runtime.env("THIRD_PARTY_RATE_SHEET_URL") || DEFAULT_SOURCE_ID);
  const supabaseUrl = (runtime.env("SUPABASE_URL") || "").trim().replace(/\/$/, "");
  const serviceKey = runtime.env("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!email || !privateKey || !serviceKey) throw new SyncError("sync_configuration_incomplete");
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:" || url.origin !== supabaseUrl || url.username || url.password || url.port || !url.hostname.endsWith(".supabase.co")) throw new Error();
  } catch { throw new SyncError("sync_configuration_incomplete"); }
  return { email, privateKey, sourceId, supabaseUrl, serviceKey };
}
function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function googleAssertion(settings: Config, runtime: Runtime): Promise<string> {
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const now = Math.floor(runtime.now() / 1000);
  const claims = base64Url(encoder.encode(JSON.stringify({ iss: settings.email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })));
  const unsigned = header + "." + claims;
  const clean = settings.privateKey.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s+/g, "");
  const bytes = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
  const key = await runtime.crypto.subtle.importKey("pkcs8", bytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await runtime.crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  return unsigned + "." + base64Url(new Uint8Array(signature));
}
async function boundedText(body: ReadableStream<Uint8Array> | null, maxBytes: number, timeoutMs?: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader(), decoder = new TextDecoder();
  let count = 0, text = "", timedOut = false;
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, Math.max(1, timeoutMs));
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      count += chunk.value.byteLength;
      if (count > maxBytes) { await reader.cancel(); throw new SyncError("source_payload_too_large", 413); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    if (timedOut) throw new SyncError("sync_request_timed_out", 504);
    return text + decoder.decode();
  } finally { if (timer !== undefined) clearTimeout(timer); reader.releaseLock(); }
}

export function createSyncOriginalRateHandler(runtime: Runtime) {
  return async function handle(request: Request): Promise<Response> {
    const deadline = runtime.now() + TOTAL_BUDGET_MS;
    let runId = "", claimed = false, published = false;
    let settings: Config | undefined;
    let sheetsWritten = 0, cellsWritten = 0;
    const boundedJson = async (input: string, init: RequestInit, maxBytes = MAX_GOOGLE_BYTES, failCleanup = false): Promise<any> => {
      if (!settings) throw new SyncError("sync_configuration_incomplete");
      const url = new URL(input), method = init.method || "GET";
      const rpcPaths = ["/rest/v1/rpc/original_rate_sync_claim", "/rest/v1/rpc/original_rate_sync_publish", "/rest/v1/rpc/original_rate_sync_fail", "/rest/v1/third_party_rate_original_sheets"];
      const allowed = (url.origin === "https://oauth2.googleapis.com" && url.pathname === "/token" && method === "POST")
        || (url.origin === "https://sheets.googleapis.com" && (url.pathname === "/v4/spreadsheets/" + settings.sourceId || url.pathname.startsWith("/v4/spreadsheets/" + settings.sourceId + "/values/")) && method === "GET")
        || (url.origin === settings.supabaseUrl && rpcPaths.includes(url.pathname) && method === "POST" && !url.search);
      if (!allowed || url.username || url.password) throw new SyncError("unexpected_sync_target");
      const remaining = deadline - runtime.now() - (failCleanup ? 0 : FAIL_RESERVE_MS);
      if (remaining <= 0) throw new SyncError("sync_budget_exceeded", 504);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, remaining));
      try {
        const result = await runtime.fetch(url.toString(), { ...init, redirect: "error", cache: "no-store", signal: controller.signal });
        if (!result.ok) {
          await result.body?.cancel();
          throw new SyncError(url.origin === settings.supabaseUrl ? "snapshot_write_failed" : "google_source_unavailable");
        }
        const text = await boundedText(result.body, maxBytes);
        if (!text) return null;
        try { return JSON.parse(text); } catch { throw new SyncError("invalid_upstream_response"); }
      } catch (error) {
        if (error instanceof SyncError) throw error;
        throw new SyncError(controller.signal.aborted ? "sync_request_timed_out" : "sync_upstream_unavailable", controller.signal.aborted ? 504 : 503);
      } finally { clearTimeout(timer); }
    };
    const rpc = async (name: "original_rate_sync_claim" | "original_rate_sync_publish" | "original_rate_sync_fail", body: Record<string, unknown>, failCleanup = false) => {
      if (!settings) throw new SyncError("sync_configuration_incomplete");
      return boundedJson(settings.supabaseUrl + "/rest/v1/rpc/" + name, { method: "POST", headers: { apikey: settings.serviceKey, Authorization: "Bearer " + settings.serviceKey, "Content-Type": "application/json" }, body: JSON.stringify(body) }, 64 * 1024, failCleanup);
    };
    try {
      // No source credentials, request body, Google read, or database operation
      // is touched before this dedicated internal-secret verification.
      if (!(await sameSecret(runtime.env("SYNC_SECRET") || "", request.headers.get("x-sync-secret") || "", runtime.crypto))) return response({ ok: false, code: "unauthorized" }, 401);
      if (request.method !== "POST") return response({ ok: false, code: "method_not_allowed" }, 405);
      if (new URL(request.url).search) return response({ ok: false, code: "invalid_sync_request" }, 400);
      let body: unknown;
      try { body = JSON.parse(await boundedText(request.body, 1024, Math.min(5_000, deadline - runtime.now()))); } catch { return response({ ok: false, code: "invalid_sync_request" }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || (body as { action?: unknown }).action !== "sync") return response({ ok: false, code: "invalid_sync_request" }, 400);
      settings = config(runtime);
      runId = runtime.crypto.randomUUID();
      if ((await rpc("original_rate_sync_claim", { p_run_id: runId })) !== true) return response({ ok: false, code: "sync_already_running" }, 409);
      claimed = true;
      const assertion = await googleAssertion(settings, runtime);
      const tokenPayload = await boundedJson("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString() }, 64 * 1024);
      if (typeof tokenPayload?.access_token !== "string" || !tokenPayload.access_token) throw new SyncError("google_source_unavailable");
      const googleRead = (url: string) => boundedJson(url, { method: "GET", headers: { Authorization: "Bearer " + tokenPayload.access_token, Accept: "application/json" } });
      const workbook = await readOriginalWorkbook(googleRead, settings.sourceId, runtime.now);
      for (const sheet of workbook.meta.sheets) {
        const grid = await readOriginalGrid(googleRead, settings.sourceId, sheet.sheetId, workbook, runtime.now);
        const payload = JSON.stringify(grid);
        if (encoder.encode(payload).byteLength > MAX_PAGE_BYTES) throw new SyncError("source_payload_too_large", 413);
        // One native sheet is written at a time; never retain 15 complete grids
        // in memory or replace/delete the previously published generation.
        const stagingBody = JSON.stringify({ run_id: runId, sheet_id: sheet.sheetId, payload: grid, collected_at: grid.fetchedAt });
        await boundedJson(settings.supabaseUrl + "/rest/v1/third_party_rate_original_sheets", { method: "POST", headers: { apikey: settings.serviceKey, Authorization: "Bearer " + settings.serviceKey, "Content-Type": "application/json", Prefer: "return=minimal" }, body: stagingBody }, 64 * 1024);
        sheetsWritten++; cellsWritten += grid.rowCount * grid.columnCount;
      }
      // Database RPC verifies this claim/lease and the exact complete tab set
      // under its lock; only it can move the published-generation pointer.
      if ((await rpc("original_rate_sync_publish", { p_run_id: runId, p_meta: workbook.meta })) !== true) throw new SyncError("snapshot_publish_rejected");
      published = true;
      return response({ ok: true, action: "sync", sheets: sheetsWritten, cells: cellsWritten, collectedAt: workbook.meta.fetchedAt });
    } catch (error) {
      const code = error instanceof SyncError || error instanceof OriginalGridReadError ? error.code : "original_sync_failed";
      const status = error instanceof SyncError || error instanceof OriginalGridReadError ? error.status : 503;
      if (claimed && !published && settings) {
        try { await rpc("original_rate_sync_fail", { p_run_id: runId, p_message: code.startsWith("original_") ? code : "original_" + code }, true); } catch { /* Existing publication stays intact; lease expires independently. */ }
      }
      return response({ ok: false, code, sheetsStaged: sheetsWritten }, status);
    }
  };
}

// Supabase deployment must use verify_jwt=false: cron authenticates using the
// existing Vault SYNC_SECRET via x-sync-secret, not an end-user JWT.
const deno = (globalThis as unknown as { Deno?: { env: { get: (name: string) => string | undefined }; serve: (handler: (request: Request) => Promise<Response>) => unknown } }).Deno;
if (deno) deno.serve(createSyncOriginalRateHandler({ env: name => deno.env.get(name), fetch, now: Date.now, crypto }));
