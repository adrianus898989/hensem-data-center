const INTERVAL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10000;
const validRevision = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** Inform the mounted page once; permission checks and user work stay untouched. */
export function installDashboardReleaseCheck({
  currentRevision, basePath, onUpdate,
}: { currentRevision: string; basePath: string; onUpdate: () => void }): () => void {
  if (!validRevision(currentRevision) || basePath !== "" && (!/^\/[A-Za-z0-9_/-]+$/.test(basePath) || basePath.includes("//"))) return () => {};
  let stopped = false, busy = false, nextAttemptAt = 0;
  let controller: AbortController | null = null;
  let cancelRead: (() => void) | null = null;
  const url = basePath.replace(/\/$/, "") + "/dashboard-release.json";
  const stop = () => {
    stopped = true;
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", visible);
    controller?.abort();
    cancelRead?.();
  };
  const check = async () => {
    if (stopped || busy || document.visibilityState !== "visible" || Date.now() < nextAttemptAt) return;
    busy = true;
    nextAttemptAt = Date.now() + INTERVAL_MS;
    const ownController = new AbortController();
    controller = ownController;
    let timeout: number | undefined;
    try {
      const deadline = new Promise<null>(resolve => {
        cancelRead = () => resolve(null);
        timeout = window.setTimeout(() => { ownController.abort(); resolve(null); }, TIMEOUT_MS);
      });
      const read = (async () => {
        const response = await fetch(url, { cache: "no-store", credentials: "omit", redirect: "error", signal: ownController.signal });
        if (!response.ok || !/\bapplication\/json\b/i.test(response.headers.get("Content-Type") || "")) return null;
        return response.json();
      })();
      const release: unknown = await Promise.race([read, deadline]);
      if (stopped || ownController.signal.aborted || !release || typeof release !== "object" || Array.isArray(release)) return;
      const value = release as Record<string, unknown>;
      if (Object.keys(value).length !== 2 || value.version !== 1 || !validRevision(value.revision) || value.revision === currentRevision) return;
      stop();
      onUpdate();
    } catch {
      // An unavailable or invalid manifest is not evidence of a new version.
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
      ownController.abort();
      if (controller === ownController) { controller = null; cancelRead = null; }
      busy = false;
    }
  };
  const visible = () => { if (document.visibilityState === "visible") void check(); };
  const interval = window.setInterval(() => { void check(); }, INTERVAL_MS);
  document.addEventListener("visibilitychange", visible);
  void check();
  return stop;
}
