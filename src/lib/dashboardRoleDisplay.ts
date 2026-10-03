import { dashboardRolePages } from "./dashboardRoleClient";

// Presentation only: keep retired permission codes in the canonical catalog,
// saved drafts and authorization checks. The old route now opens merchants.
const displayPageLabels: Readonly<Record<string, string>> = { merchants: "商户经营" };
export const dashboardRoleDisplayPages = dashboardRolePages
  .filter(page => page.id !== "merchantproviders")
  .map(page => displayPageLabels[page.id] ? { ...page, label: displayPageLabels[page.id] } : page);
const displayCodes = dashboardRoleDisplayPages.flatMap(page => page.actions.map(action => page.id + "." + action.id));

export function dashboardRoleDisplayPermissionCount(permissions: readonly string[]): number {
  return displayCodes.filter(code => permissions.includes(code)).length;
}

export function dashboardRoleDisplayPageCount(permissions: readonly string[]): number {
  return dashboardRoleDisplayPages.filter(page => permissions.includes(page.id + ".view")).length;
}
