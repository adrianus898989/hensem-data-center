// Only the official protected origin owns these fixed, read-only routes.
// Other deployments retain their configured Supabase endpoint; a failed
// protected read never falls back to a second transport.
export function dashboardEntryReadUrl(kind: "role" | "preview", direct: string, query = "", method = "GET"): string {
  if (typeof window === "undefined" || window.location.origin !== "https://data-center.workdesk-hub.workers.dev") return direct;
  if (kind === "role") return "/hensem-data-center/api/dashboard-role-access";
  if (method.toUpperCase() === "GET" && ["", "?check=1", "?action=access"].includes(query)) {
    return "/hensem-data-center/api/dashboard-preview" + query;
  }
  return direct;
}
