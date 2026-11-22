import { LIGHT_PILOT_CONTROLS } from "./lightPilotControls";
import { LIGHT_PILOT_STYLES } from "./lightPilotStyles";
import { LIGHT_PILOT_REPORT_SCRIPT, LIGHT_PILOT_REPORT_STYLES } from "./lightPilotReports";

type DashboardPresentation = { frame: (html: string) => string; hostCss: string };

export const presentation: DashboardPresentation = {
  frame(html) {
    const styles = '<style id="m8-light-pilot-style">' + LIGHT_PILOT_STYLES + LIGHT_PILOT_REPORT_STYLES + '</style>';
    const controls = '<script id="m8-light-pilot-controls">' + LIGHT_PILOT_CONTROLS + LIGHT_PILOT_REPORT_SCRIPT + '</script>';
    return html.replace(/<\/body\s*>(?:\s*<\/html\s*>)?\s*$/i, closing => styles + controls + closing);
  },
  hostCss: `
    .owner-preview-account-page {background:#f5f6fa;color:#30354a}
    .owner-preview-account-tabs {background:#fafaff;border-color:#e0e4ed}
    .owner-preview-account-tabs button[aria-selected=true] {background:#eeeafb;color:#5644ad;border-color:#ddd7f2}
    .owner-preview-account-page input,.owner-preview-account-page select {border-color:#dfe3ed;border-radius:6px}
    .owner-preview-account-page table thead {background:#f7f8fb}
    .owner-preview-account-page :focus-visible {outline-color:#6655ce}
/* Account dialogs mount directly on body. Their layout, focus trap and disabled states are supplied by their components. */
body.owner-preview-shell-active :is(.account-editor-dialog, .account-permission-dialog) {
  color-scheme: light;
  color: #2e3246;
  background-color: #fff;
  border-color: #dfe3ed;
  accent-color: #6150c6;
}
body.owner-preview-shell-active :is(.account-editor-dialog, .account-permission-dialog) :is(button, input, select, textarea):focus-visible {
  outline: 2px solid #6150c6;
  outline-offset: 2px;
}
body.owner-preview-shell-active .account-permission-nav { background-color: #f7f8fb; }
body.owner-preview-shell-active .account-permission-module.is-selected {
  color: #5141ad;
  background-color: #eeeafb;
  border-left-color: #6150c6;
}
body.owner-preview-shell-active :is(.account-permission-module.is-selected .account-permission-module-count, .account-permission-filters button.is-selected) {
  color: #5141ad;
  background-color: #eeeafb;
}
body.owner-preview-shell-active .account-permission-card.is-enabled:not(.is-readonly) { background-color: #faf9ff; border-color: #c6bce9; }
body.owner-preview-shell-active .account-permission-card > input { accent-color: #6150c6; }
body.owner-preview-shell-active .account-permission-card-state { color: #5141ad; }
body.owner-preview-shell-active .account-permission-dialog :is(
  .account-permission-eyebrow, .account-permission-role, .account-permission-header p,
  .account-permission-overall, .account-permission-overall small, .account-permission-nav-caption,
  .account-permission-nav-note, .account-permission-module-heading > span, .account-permission-module-count,
  .account-permission-toolbar > p, .account-permission-filters button:not(.is-selected),
  .account-permission-batch-row, .account-permission-readonly-notice, .account-permission-page-heading > span,
  .account-permission-card-description, .account-permission-card code, .account-permission-card-state.is-locked,
  .account-permission-card:not(.is-enabled) .account-permission-card-state, .account-permission-empty,
  .account-permission-footer-copy p:not(.account-permission-error)
) { color: #586177; }
body.owner-preview-shell-active .account-permission-search input::placeholder { color: #626a81; }
body.owner-preview-shell-active .account-permission-sensitive { color: #78541d; }
body.owner-preview-shell-active .account-permission-save { color: #fff; background-color: #6150c6; border-color: #6150c6; }
body.owner-preview-shell-active .account-permission-save:hover:not(:disabled) { background-color: #5141ad; }
  `,
};
