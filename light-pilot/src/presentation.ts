import { LIGHT_PILOT_CONTROLS } from "./lightPilotControls";
import { LIGHT_PILOT_STYLES } from "./lightPilotStyles";
import { LIGHT_PILOT_REPORT_SCRIPT, LIGHT_PILOT_REPORT_STYLES } from "./lightPilotReports";

export type PilotPresentation = { frame: (html: string) => string; hostCss: string };

export const presentation: PilotPresentation = {
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
  `,
};
