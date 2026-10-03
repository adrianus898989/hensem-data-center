import { dashboardRolePages } from "./dashboardRoleClient";

// Presentation only: keep retired permission codes in the canonical catalog,
// saved drafts and authorization checks. The old route now opens merchants.
const displayPageLabels: Readonly<Record<string, string>> = {
  merchants: "商户经营",
  teamcountries: "团队经营 · 国家表现",
  teamplatforms: "团队经营 · 平台经营",
};
export const dashboardRoleDisplayPages = dashboardRolePages
  .filter(page => page.id !== "merchantproviders")
  .map(page => ({
    ...page,
    label: displayPageLabels[page.id] || page.label,
    // The merged workspace keeps each original view's permission keys.
    ...(page.moduleId === "team" || page.moduleId === "merchant"
      ? { moduleId: "merchant", moduleLabel: "运营中心" }
      : {}),
  }));
const displayCodes = dashboardRoleDisplayPages.flatMap(page => page.actions.map(action => page.id + "." + action.id));

export function dashboardRoleDisplayPermissionCount(permissions: readonly string[]): number {
  return displayCodes.filter(code => permissions.includes(code)).length;
}

export function dashboardRoleDisplayPageCount(permissions: readonly string[]): number {
  return dashboardRoleDisplayPages.filter(page => permissions.includes(page.id + ".view")).length;
}
