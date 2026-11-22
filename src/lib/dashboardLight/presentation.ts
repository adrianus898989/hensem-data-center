import { LIGHT_MOBILE_NAVIGATION, LIGHT_PILOT_CONTROLS } from "./lightPilotControls";
import { LIGHT_PILOT_STYLES } from "./lightPilotStyles";
import { LIGHT_PILOT_REPORT_SCRIPT, LIGHT_PILOT_REPORT_STYLES } from "./lightPilotReports";

type DashboardPresentation = { frame: (html: string) => string; hostCss: string };

export const presentation: DashboardPresentation = {
  frame(html) {
    const styles = '<style id="m8-light-pilot-style">' + LIGHT_PILOT_STYLES + LIGHT_PILOT_REPORT_STYLES + '</style>';
    const controls = '<script id="m8-light-pilot-controls">' + LIGHT_PILOT_CONTROLS + LIGHT_PILOT_REPORT_SCRIPT + LIGHT_MOBILE_NAVIGATION + '</script>';
    return html.replace(/<\/body\s*>(?:\s*<\/html\s*>)?\s*$/i, closing => styles + controls + closing);
  },
  hostCss: `
    .owner-preview-shell {background:#f3f6f8}
    .owner-preview-account-page {background:#f3f6f8;color:#203548}
    .owner-preview-account-tabs {background:#edf3f5;border-color:#d2dce2}
    .owner-preview-account-tabs button[aria-selected=true] {background:#e1f1f3;color:#07576a;border-color:#a9cfd7}
    .owner-preview-account-page button:focus-visible {outline:2px solid #086b80;outline-offset:2px}
    .owner-preview-account-page input,.owner-preview-account-page select {border-color:#d2dce2;border-radius:6px}
    .owner-preview-account-page table thead {background:#f0f5f7}
    .owner-preview-account-page :focus-visible {outline-color:#086b80}
    body.owner-preview-shell-active .auth-user-trigger {border-color:#cbd9df!important;background:#fff!important;color:#203548}
    body.owner-preview-shell-active .auth-user-trigger:is(:hover,.open) {border-color:#72a6b3!important}
    body.owner-preview-shell-active .auth-user-avatar {background:#086b80;color:#fff}
    body.owner-preview-shell-active .auth-user-dropdown {border-color:#d2dce2;background:#fff;color:#203548}
    body.owner-preview-shell-active .auth-user-dropdown :is(button,a):focus-visible {outline:2px solid #086b80;outline-offset:-2px}
/* Account dialogs mount directly on body. Their layout, focus trap and disabled states are supplied by their components. */
body.owner-preview-shell-active :is(.account-editor-dialog, .account-permission-dialog) {
  color-scheme: light;
  color: #203548;
  background-color: #fff;
  border-color: #d2dce2;
  accent-color: #086b80;
}
body.owner-preview-shell-active :is(.account-editor-dialog, .account-permission-dialog) :is(button, input, select, textarea):focus-visible {
  outline: 2px solid #086b80;
  outline-offset: 2px;
}
body.owner-preview-shell-active .account-permission-nav { background-color: #f0f5f7; }
body.owner-preview-shell-active .account-permission-module.is-selected {
  color: #07576a;
  background-color: #e1f1f3;
  border-left-color: #086b80;
}
body.owner-preview-shell-active :is(.account-permission-module.is-selected .account-permission-module-count, .account-permission-filters button.is-selected) {
  color: #07576a;
  background-color: #e1f1f3;
}
body.owner-preview-shell-active .account-permission-card.is-enabled:not(.is-readonly) { background-color: #f3fafb; border-color: #9ac7d0; }
body.owner-preview-shell-active .account-permission-card > input { accent-color: #086b80; }
body.owner-preview-shell-active .account-permission-card-state { color: #07576a; }
body.owner-preview-shell-active .account-permission-dialog :is(
  .account-permission-eyebrow, .account-permission-role, .account-permission-header p,
  .account-permission-overall, .account-permission-overall small, .account-permission-nav-caption,
  .account-permission-nav-note, .account-permission-module-heading > span, .account-permission-module:not(.is-selected) .account-permission-module-count,
  .account-permission-toolbar > p, .account-permission-filters button:not(.is-selected),
  .account-permission-batch-row, .account-permission-readonly-notice, .account-permission-page-heading > span,
  .account-permission-card-description, .account-permission-card code, .account-permission-card-state.is-locked,
  .account-permission-card:not(.is-enabled) .account-permission-card-state, .account-permission-empty,
  .account-permission-footer-copy p:not(.account-permission-error)
) { color: #4c6272; }
body.owner-preview-shell-active .account-permission-search input::placeholder { color: #526778; }
body.owner-preview-shell-active .account-permission-sensitive { color: #78541d; }
body.owner-preview-shell-active .account-permission-save { color: #fff; background-color: #086b80; border-color: #086b80; }
body.owner-preview-shell-active .account-permission-save:hover:not(:disabled) { background-color: #07576a; }
  `,
};
