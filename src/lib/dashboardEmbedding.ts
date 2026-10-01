// The authenticated application must run in its own browser tab. Its internal
// opaque preview frame does not mount this top-level application guard.
export function dashboardIsTopLevel(candidate: Pick<Window, "top" | "self"> | undefined): boolean {
  if (!candidate) return false;
  try { return candidate.top === candidate.self && candidate.self === candidate; }
  catch { return false; }
}
