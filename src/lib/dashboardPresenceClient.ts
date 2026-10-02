"use client";
import { APPLICATION_GATEWAY, dashboardResponseError, ensureDashboardSession, type DashboardSession } from "./dashboardAuthClient";

export const DASHBOARD_PRESENCE_TIMEOUT_MS = 12000;
export type DashboardPresenceAccount = { username: string; lastSeenAt: string };
export type DashboardPresenceSnapshot = {
  onlineCount: number | null;
  observedAt: string | null;
  windowSeconds: number;
  heartbeatSeconds: number;
  scope: "authorized" | null;
  accounts: DashboardPresenceAccount[] | null;
  loading: boolean;
  reason: "initial" | "stopped" | "offline" | "timeout" | "unavailable" | "stale" | null;
};
type Action = "heartbeat" | "status";
type Timer = ReturnType<typeof setTimeout>;
type EventTargetLike = Pick<Window, "addEventListener" | "removeEventListener">;
type Environment = {
  request?: (session: DashboardSession, action: Action, signal: AbortSignal) => Promise<unknown>;
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  target?: EventTargetLike;
  document?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  online?: () => boolean;
};
const unknown = (reason: DashboardPresenceSnapshot["reason"] = "initial"): DashboardPresenceSnapshot => ({ onlineCount: null, observedAt: null, windowSeconds: 120, heartbeatSeconds: 30, scope: null, accounts: null, loading: false, reason });
const iso = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

// Copy only the public presentation contract. No IDs, IPs, tokens or arbitrary
// server fields cross into the opaque dashboard frame.
export function parseDashboardPresenceResponse(input: unknown): DashboardPresenceSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("在线状态格式无效");
  const data = input as Record<string, unknown>;
  if (data.ok !== true || data.scope !== "authorized" || !Number.isSafeInteger(data.onlineCount) || Number(data.onlineCount) < 0 || Number(data.onlineCount) > 500 || !iso(data.observedAt) || data.windowSeconds !== 120 || data.heartbeatSeconds !== 30) throw Error("在线状态格式无效");
  let accounts: DashboardPresenceAccount[] | null = null;
  if (Object.hasOwn(data, "accounts")) {
    if (!Array.isArray(data.accounts) || data.accounts.length !== data.onlineCount || data.accounts.some(item => !item || typeof item !== "object" || Array.isArray(item))) throw Error("在线名单格式无效");
    accounts = data.accounts.map(item => {
      const row = item as Record<string, unknown>;
      if (typeof row.username !== "string" || !/^[a-z0-9._-]{3,32}$/.test(row.username) || !iso(row.lastSeenAt) || Date.parse(row.lastSeenAt) > Date.parse(String(data.observedAt)) || Date.parse(String(data.observedAt)) - Date.parse(row.lastSeenAt) > 120000) throw Error("在线名单格式无效");
      return { username: row.username, lastSeenAt: row.lastSeenAt };
    });
    if (new Set(accounts.map(item => item.username)).size !== accounts.length) throw Error("在线名单格式无效");
  }
  return { onlineCount: Number(data.onlineCount), observedAt: data.observedAt, windowSeconds: 120, heartbeatSeconds: 30, scope: "authorized", accounts, loading: false, reason: null };
}

export async function requestDashboardPresence(session: DashboardSession, action: Action, signal: AbortSignal): Promise<unknown> {
  if (!["heartbeat", "status"].includes(action)) throw Error("不支持的在线状态操作");
  signal.throwIfAborted();
  const current = await ensureDashboardSession(session);
  signal.throwIfAborted();
  if (current.user.id !== session.user.id) throw Error("登录账号已改变");
  const response = await fetch(APPLICATION_GATEWAY + "/api/dashboard-presence", {
    method: "POST", cache: "no-store", credentials: "omit", redirect: "error", signal,
    headers: { Authorization: `Bearer ${current.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const data = await response.json();
  signal.throwIfAborted();
  if (!response.ok) throw dashboardResponseError(response.status, data, "在线状态暂无法读取");
  return data;
}

export function createDashboardPresenceController(environment: Environment = {}) {
  const request = environment.request || requestDashboardPresence, now = environment.now || Date.now;
  const later = environment.setTimeout || setTimeout, cancelTimer = environment.clearTimeout || clearTimeout;
  const target = environment.target || (typeof window !== "undefined" ? window : undefined);
  const doc = environment.document || (typeof document !== "undefined" ? document : undefined);
  const online = environment.online || (() => typeof navigator === "undefined" || navigator.onLine !== false);
  const listeners = new Set<(snapshot: DashboardPresenceSnapshot) => void>();
  let session: DashboardSession | null = null, identity = "", generation = 0, snapshot = unknown(), receivedAt = 0, lastAttempt: number | null = null;
  let next: Timer | undefined, expires: Timer | undefined, paused = false, listening = false;
  let flight: { generation: number; controller: AbortController; timeout?: Timer } | null = null;
  const publish = () => { for (const listener of listeners) { try { listener(copy()); } catch { /* A closed view cannot stop the shared heartbeat. */ } } };
  const copy = (): DashboardPresenceSnapshot => ({ ...snapshot, accounts: snapshot.accounts?.map(row => ({ ...row })) ?? null });
  const clearTimers = () => { if (next !== undefined) cancelTimer(next); if (expires !== undefined) cancelTimer(expires); next = undefined; expires = undefined; };
  const invalidate = (reason: DashboardPresenceSnapshot["reason"]) => { snapshot = unknown(reason); receivedAt = 0; if (expires !== undefined) cancelTimer(expires); expires = undefined; publish(); };
  const getSnapshot = () => {
    if (snapshot.onlineCount !== null && (now() < receivedAt || now() - receivedAt >= snapshot.heartbeatSeconds * 2000)) invalidate("stale");
    return copy();
  };
  const schedule = () => { if (next !== undefined) cancelTimer(next); next = undefined; if (session && !paused) next = later(() => { next = undefined; void run("heartbeat"); }, 30000); };
  async function run(action: Action, throttle = false) {
    if (!session || paused || flight) return getSnapshot();
    if (!online()) { invalidate("offline"); schedule(); return getSnapshot(); }
    if (throttle && lastAttempt !== null && now() - lastAttempt < 10000) return getSnapshot();
    if (next !== undefined) cancelTimer(next); next = undefined;
    const active = session, own = { generation, controller: new AbortController(), timeout: undefined as Timer | undefined };
    flight = own; lastAttempt = now(); snapshot = { ...getSnapshot(), loading: true }; publish();
    let removeAbort = () => {};
    const deadline = new Promise<never>((_resolve, reject) => {
      const aborted = () => { const error = Error("在线请求已取消"); error.name = "AbortError"; reject(error); };
      own.controller.signal.addEventListener("abort", aborted, { once: true }); removeAbort = () => own.controller.signal.removeEventListener("abort", aborted);
      own.timeout = later(() => { const error = Error("在线状态读取超时"); error.name = "PresenceTimeout"; reject(error); own.controller.abort(); }, DASHBOARD_PRESENCE_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([request(active, action, own.controller.signal), deadline]);
      if (flight !== own || own.generation !== generation || !session) return getSnapshot();
      snapshot = parseDashboardPresenceResponse(result); receivedAt = now();
      if (expires !== undefined) cancelTimer(expires);
      expires = later(() => { expires = undefined; if (own.generation === generation) invalidate("stale"); }, snapshot.heartbeatSeconds * 2000);
      publish();
    } catch (error) {
      if (flight === own && own.generation === generation && session) invalidate(error instanceof Error && error.name === "PresenceTimeout" ? "timeout" : !online() ? "offline" : "unavailable");
    } finally {
      removeAbort(); if (own.timeout !== undefined) cancelTimer(own.timeout);
      if (flight === own) { flight = null; schedule(); }
    }
    return getSnapshot();
  }
  const resume = () => { paused = false; if (next === undefined) schedule(); void run("heartbeat", true); };
  const offline = () => { flight?.controller.abort(); invalidate("offline"); };
  const hide = () => { paused = true; generation++; clearTimers(); const previous = flight; flight = null; previous?.controller.abort(); lastAttempt = null; invalidate("stale"); };
  const visible = () => { if (doc?.visibilityState === "visible") resume(); };
  const lifecycle = (install: boolean) => {
    if (listening === install) return; listening = install;
    const operation = install ? "addEventListener" : "removeEventListener";
    target?.[operation]("focus", resume); target?.[operation]("online", resume); target?.[operation]("offline", offline);
    target?.[operation]("pagehide", hide); target?.[operation]("pageshow", resume); doc?.[operation]("visibilitychange", visible);
  };
  const setSession = (value: DashboardSession | null, scopeIdentity = "") => {
    const key = value ? value.user.id + ":" + scopeIdentity : "";
    if (session && value && key === identity) { session = value; return; }
    generation++; clearTimers(); const previous = flight; flight = null; previous?.controller.abort();
    session = value; identity = key; receivedAt = 0; lastAttempt = null; paused = false; invalidate(value ? "initial" : "stopped"); lifecycle(Boolean(value));
    if (value) void run("heartbeat");
  };
  return {
    setSession, getSnapshot, getViewerId: () => session?.user.id ?? null,
    refresh: () => run("status", true),
    subscribe(listener: (value: DashboardPresenceSnapshot) => void) { listeners.add(listener); listener(getSnapshot()); return () => { listeners.delete(listener); }; },
    dispose() { setSession(null); listeners.clear(); },
  };
}

let singleton: ReturnType<typeof createDashboardPresenceController> | undefined;
const shared = () => singleton ||= createDashboardPresenceController();
export function setDashboardPresenceSession(session: DashboardSession | null, scopeIdentity = "") { shared().setSession(session, scopeIdentity); }
export function stopDashboardPresence() { singleton?.setSession(null); }
export function getDashboardPresenceSnapshot() { return singleton?.getSnapshot() || unknown(); }
export function getDashboardPresenceViewerId() { return singleton?.getViewerId() || null; }
export function subscribeDashboardPresence(listener: (value: DashboardPresenceSnapshot) => void) { return shared().subscribe(listener); }
export function refreshDashboardPresence() { return shared().refresh(); }
