// Only real input renews inactivity. Network traffic and token renewal never do.
export const DASHBOARD_IDLE_MS = 60 * 60 * 1000;
export const DASHBOARD_LAST_ACTIVITY_KEY = "hensem.dashboard.last_activity";
const ACTIVITY_EVENT = "hensem:dashboard:user-activity";
const IDLE_LOGOUT_KEY = "hensem.dashboard.idle_logout_at";
export const DASHBOARD_INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"] as const;
let memoryActivity = 0;

export function readLastActivity(): number {
  if (typeof window === "undefined") return 0;
  try {
    const value = Number(window.localStorage.getItem(DASHBOARD_LAST_ACTIVITY_KEY) || 0);
    return Number.isFinite(value) ? value : 0;
  } catch { return memoryActivity; }
}

export function writeLastActivity(value = Date.now()) {
  memoryActivity = value;
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(DASHBOARD_LAST_ACTIVITY_KEY, String(value)); } catch {}
}

export function clearLastActivity() {
  memoryActivity = 0;
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(DASHBOARD_LAST_ACTIVITY_KEY); } catch {}
}

// Called for trusted host input, or after validating the current sandbox frame's
// source, opaque origin and channel. An already idle session cannot be revived.
export function recordDashboardActivity(occurredAt = Date.now()) {
  const now = Date.now(), last = readLastActivity();
  if (last && now - last >= DASHBOARD_IDLE_MS) return false;
  if (!Number.isFinite(occurredAt) || occurredAt > now || now - occurredAt > 5000) return false;
  writeLastActivity(Math.max(last, occurredAt));
  window.dispatchEvent(new Event(ACTIVITY_EVENT));
  return true;
}

export function installDashboardIdleMonitor(onLogout: () => void): () => void {
  let timer: number | undefined, disposed = false;
  const expire = () => {
    if (disposed) return;
    disposed = true;
    try { window.localStorage.setItem(IDLE_LOGOUT_KEY, String(Date.now())); } catch {}
    onLogout();
  };
  const check = () => {
    if (disposed) return;
    if (timer !== undefined) window.clearTimeout(timer);
    let last = readLastActivity();
    if (!last) { last = Date.now(); writeLastActivity(last); }
    const remaining = DASHBOARD_IDLE_MS - (Date.now() - last);
    if (remaining <= 0) { expire(); return; }
    timer = window.setTimeout(check, remaining);
  };
  const input = (event: Event) => {
    if (!event.isTrusted) return;
    if (!recordDashboardActivity()) check();
  };
  const visible = () => { if (document.visibilityState === "visible") check(); };
  const storage = (event: StorageEvent) => {
    if (event.key === DASHBOARD_LAST_ACTIVITY_KEY) check();
    if (event.key === IDLE_LOGOUT_KEY && event.newValue) {
      // A queued expiry from a sleeping tab must not clear a newer active login.
      const last = readLastActivity();
      if (!last || Date.now() - last >= DASHBOARD_IDLE_MS) expire();
    }
    if (event.key === "hensem:dashboard:auth-session:v2" && !event.newValue) expire();
  };
  DASHBOARD_INPUT_EVENTS.forEach(name => window.addEventListener(name, input, { passive: true, capture: true }));
  window.addEventListener(ACTIVITY_EVENT, check);
  window.addEventListener("focus", check);
  window.addEventListener("storage", storage);
  document.addEventListener("visibilitychange", visible);
  check();
  return () => {
    disposed = true;
    if (timer !== undefined) window.clearTimeout(timer);
    DASHBOARD_INPUT_EVENTS.forEach(name => window.removeEventListener(name, input, true));
    window.removeEventListener(ACTIVITY_EVENT, check);
    window.removeEventListener("focus", check);
    window.removeEventListener("storage", storage);
    document.removeEventListener("visibilitychange", visible);
  };
}
