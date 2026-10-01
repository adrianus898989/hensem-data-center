// The authenticated application must run in its own browser tab. Its internal
// opaque preview frame does not mount this top-level application guard.
export function dashboardIsTopLevel(candidate: Pick<Window, "top" | "self"> | undefined): boolean {
  if (!candidate) return false;
  try { return candidate.top === candidate.self && candidate.self === candidate; }
  catch { return false; }
}

// GitHub Pages is the public build origin; its login must open the server-gated entry.
// Never copy a login token or credentials from a query string to another host.
export function dashboardSecureEntryRedirect(href: string | undefined): string | null {
  try {
    if (!href) return null;
    const source = new URL(href);
    if (source.origin !== "https://adrianus898989.github.io" || source.username || source.password
      || !(source.pathname === "/hensem-data-center" || source.pathname.startsWith("/hensem-data-center/"))) return null;
    return "https://data-center.workdesk-hub.workers.dev/hensem-data-center/" + source.hash;
  } catch { return null; }
}
