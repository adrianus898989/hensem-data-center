"use client";

// Only transport reads are wrapped. Validation and HTML transformation errors
// never become retryable merely because they are TypeErrors.
export async function ownerPreviewTransportRead<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try { return await read(); }
  catch (cause) {
    if (signal?.aborted) throw cause;
    if (cause && typeof cause === "object" && "name" in cause && ["TypeError", "NetworkError", "TimeoutError"].includes(String(cause.name))) {
      const error = new Error("后台验证连接暂时不可用，请重试。");
      Object.assign(error, {status: 0, code: "owner_preview_network_error"});
      throw error;
    }
    throw cause;
  }
}

const terminalCodes = new Set(["account_disabled", "application_session_denied", "profile_denied", "role_permission_denied",
  "preview_denied", "invalid_role_response", "invalid_profile", "refresh_invalid", "session_changed", "session_logged_out", "permission_denied", "access_denied", "42501"]);
const networkCodes = new Set(["owner_preview_network_error", "owner_preview_timeout", "refresh_network_error", "network_error", "auth_network_error", "auth_timeout"]);
export function ownerPreviewRetryable(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const error = cause as {status?: unknown; code?: unknown; name?: unknown};
  if (error.name === "AbortError" || terminalCodes.has(String(error.code)) || error.status === 401 || error.status === 403) return false;
  return typeof error.status === "number" && (error.status >= 500 && error.status <= 599
    || error.status === 0 && networkCodes.has(String(error.code)));
}

function cancelled(): Error { const error = new Error("后台验证已取消"); error.name = "AbortError"; return error; }
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(cancelled()); return; }
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(cancelled()); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, {once: true});
  });
}

// Three whole verification attempts, not three retries per endpoint.
export async function retryOwnerPreviewVerification<T>(read: () => Promise<T>, signal: AbortSignal,
  onRetry: (nextAttempt: number) => void): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (signal.aborted) throw cancelled();
    try {
      const value = await read();
      if (signal.aborted) throw cancelled();
      return value;
    } catch (cause) {
      if (signal.aborted) throw cancelled();
      if (attempt === 3 || !ownerPreviewRetryable(cause)) throw cause;
      onRetry(attempt + 1);
      await pause(attempt === 1 ? 500 : 1500, signal);
    }
  }
  throw cancelled();
}

// Bound the whole permission/HTML attempt, including a stalled body or auth
// refresh. Aborting the parent or the deadline invalidates any late response.
export async function ownerPreviewVerificationAttempt<T>(read: (signal: AbortSignal) => Promise<T>, parent: AbortSignal): Promise<T> {
  if (parent.aborted) throw cancelled();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => { reject(cancelled()); controller.abort(); };
    parent.addEventListener("abort", abort, {once: true});
    timer = setTimeout(() => {
      const error = new Error("后台验证连接超时，请重试。");
      Object.assign(error, {status: 0, code: "owner_preview_timeout"});
      reject(error);controller.abort();
    }, 15000);
  });
  try { return await Promise.race([Promise.resolve().then(() => {
    if (controller.signal.aborted) throw cancelled();
    return read(controller.signal);
  }), stopped]); }
  finally { clearTimeout(timer); parent.removeEventListener("abort", abort);controller.abort(); }
}
