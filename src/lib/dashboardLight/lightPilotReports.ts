// Inject both strings only into an authorized dashboard document.
const withdraw = 'html[data-m8-report-pilot] body.live-admin .withdraw-toolbar';

export const LIGHT_PILOT_REPORT_STYLES = `
html[data-m8-report-pilot] {
  --rp-ink: #253b48;
  --rp-muted: #526875;
  --rp-line: #d4e0e5;
  --rp-raised: #f3f7f8;
  --rp-accent: #096a80;
  --rp-tint: #e7f3f5;
}
html[data-m8-report-pilot] body.live-admin .withdraw-toolbar,
html[data-m8-report-pilot] body.live-admin .wo-operations-filter {
  padding: 12px 16px; background: #fff; border: 1px solid var(--rp-line); border-radius: 9px;
}
html[data-m8-report-pilot] body.live-admin :is(.withdraw-toolbar,.wo-operations-filter) :is(.btn,input,select),
html[data-m8-report-pilot] body.live-admin .withdraw-toolbar .live-multi summary,
html[data-m8-report-pilot] body.live-admin .wo-operations-filter .wo-filter-actions .btn {
  min-height: 32px; border-radius: 6px; font-size: 12px;
}
html[data-m8-report-pilot] body.live-admin :is(.withdraw-toolbar,.wo-operations-filter) :is(label,.live-metric-endpoint>span) {
  color: var(--rp-muted); font-size: 11px;
}
html[data-m8-report-pilot] body.live-admin .withdraw-toolbar :is(input,select),
html[data-m8-report-pilot] body.live-admin .wo-operations-filter :is(input,select) {
  color: var(--rp-ink); border-color: var(--rp-line); background-color: #fff;
}
/* The source renderers own form fields, presets and action handlers. Keep them
   visible in place, with a shared layout on aggregate, snapshot and withdrawal reports. */
html[data-m8-report-pilot] body.live-admin #liveFilters .live-business-filters {
  display: grid; grid-template-columns: repeat(12,minmax(0,1fr));
  align-items: end; gap: 9px 12px; padding: 12px 16px;
}
html[data-m8-report-pilot] #liveFilters .live-business-filters > .live-filter-fields {
  display: grid; grid-column: 1 / -1; gap: 8px 12px;
  grid-template-columns: repeat(auto-fit,minmax(min(130px,100%),1fr));
}
html[data-m8-report-pilot] #liveFilters .live-business-filters > .live-filter-fields > .live-field {
  width: auto; min-width: 0; max-width: none; margin: 0;
}
html[data-m8-report-pilot] body.live-admin #liveFilters .live-business-filters .live-metric-windows {
  order: 2; grid-column: 1 / -1; display: flex; flex-wrap: wrap;
  align-items: end; gap: 7px 12px; min-width: 0;
}
html[data-m8-report-pilot] body.live-admin #liveFilters .live-business-filters .live-metric-window {
  display: flex; align-items: end; flex-wrap: wrap; flex: 1 1 340px;
  gap: 6px 10px; min-width: 0; max-width: 540px;
}
html[data-m8-report-pilot] body.live-admin #liveFilters .live-business-filters .live-metric-endpoint {
  flex: 1 1 155px; min-width: 0;
}
html[data-m8-report-pilot] body.live-admin #liveFilters .live-business-filters .live-metric-endpoint :is(input,select) {
  width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box;
}
html[data-m8-report-pilot] body.live-admin #liveFilters .live-business-filters .live-metric-zone {
  align-self: end; min-width: 0; max-width: 100%; white-space: normal;
  order: 0; margin: 0; padding-bottom: 5px; color: var(--rp-muted); font-size: 11px;
}
html[data-m8-report-pilot] #liveFilters .live-business-filters > .live-filter-date {
  grid-column: 1 / -1; width: min(100%,280px);
}
html[data-m8-report-pilot] #liveFilters .live-business-filters > .daily-date-extra {
  order: 3; grid-column: span 3; display: grid; justify-self: start; gap: 4px;
  color: var(--rp-muted); font-size: 11px;
}
html[data-m8-report-pilot] #liveFilters .live-business-filters > .daily-date-extra :is(input,select) {
  max-width: 100%; min-width: 0; height: 32px; box-sizing: border-box;
}
html[data-m8-report-pilot] body.live-admin #liveFilters .live-date-shortcuts {
  order: 4; grid-column: 1 / 7; justify-content: start; align-self: end;
}
html[data-m8-report-pilot] body.live-admin #liveFilters .live-query-actions {
  order: 5; grid-column: 7 / -1; justify-content: end; align-self: end;
}
html[data-m8-report-pilot] body.live-admin :is(#liveFilters .live-date-shortcuts,#liveFilters .live-query-actions) {
  display: flex; flex-wrap: wrap; align-items: center; min-width: 0;
  height: auto; min-height: 32px; gap: 5px; margin: 0; padding: 0;
}
html[data-m8-report-pilot] #liveFilters .live-search-row { grid-column: 1 / -1; order: 6; }
html[data-m8-report-pilot] #liveFilters .live-business-filters > [data-wg-success-filter] { grid-column: 1 / -1; order: 7; }
html[data-m8-report-pilot] body.live-admin :is(#liveFilters .live-business-filters,.wo-filter-actions) .btn {
  min-height: 35px; padding-inline: 10px; border-radius: 6px; font-size: 13px;
}
html[data-m8-report-pilot] body.live-admin #liveFilters .live-date-shortcuts .btn {
  color: var(--rp-ink); background: #fff; border: 1px solid var(--rp-line);
}
html[data-m8-report-pilot] body.live-admin :is(#liveFilters .live-date-shortcuts,.wo-filter-actions) .btn[aria-pressed="true"] {
  color: #085c6d; background: var(--rp-tint); border-color: var(--rp-accent); font-weight: 650;
}
html[data-m8-report-pilot] body.live-admin :is(#liveFilters .live-query-actions,.withdraw-toolbar .live-actions,.wo-filter-actions) .btn.primary:enabled:not(:hover) {
  background-color: var(--rp-accent); border-color: var(--rp-accent); color: #fff;
}
html[data-m8-report-pilot] body.live-admin :is(#liveFilters .live-business-filters,.withdraw-toolbar,.wo-filter-actions) .btn:focus-visible {
  outline: 2px solid var(--rp-accent); outline-offset: 2px;
}
@media (max-width:760px) {
  html[data-m8-report-pilot] body.live-admin #liveFilters .live-business-filters {
    padding: 10px 12px; gap: 8px;
  }
  html[data-m8-report-pilot] #liveFilters .live-business-filters > .daily-date-extra { grid-column: span 6; }
  html[data-m8-report-pilot] body.live-admin :is(#liveFilters .live-date-shortcuts,#liveFilters .live-query-actions) {
    grid-column: 1 / -1; justify-content: start;
  }
}
/* Scope, date pairs and commands wrap as groups. Keep full native date segments
   visible, including seconds and the AM/PM field in 12-hour browser locales. */
${withdraw} {
  display: block; container-type: inline-size; container-name: withdraw-filters;
  padding: 8px 12px;
}
${withdraw}::before { content: none; }
${withdraw} .withdraw-filter-form {
  display: flex; flex-wrap: wrap; align-items: end; gap: 7px 12px; margin: 0;
}
${withdraw} .withdraw-scope-fields {
  display: flex; flex-wrap: wrap; align-items: end; gap: 5px 8px; max-width: 100%;
}
${withdraw} .withdraw-scope-fields > .live-field {
  width: 110px; flex: 0 1 auto; min-width: 0; max-width: none; gap: 3px; margin: 0;
}
${withdraw} .withdraw-scope-fields > :is(.live-multi,.wide) { width: 142px; }
${withdraw} .withdraw-scope-fields > .withdraw-record-source { width: 190px; }
${withdraw} .live-metric-windows { display: contents; }
${withdraw} .live-metric-window {
  display: flex; align-items: end; gap: 8px; min-width: 0; max-width: 100%;
}
${withdraw} .live-metric-endpoint { width: 210px; max-width: 100%; min-width: 0; flex: 1 1 auto; gap: 3px; }
${withdraw} .live-metric-endpoint input { width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; }
${withdraw} :is(.live-field > select,.live-field > input,.live-multi summary,.live-metric-endpoint input) {
  height: 30px; min-height: 30px; padding-block: 2px; font-size: 12px;
}
${withdraw} .withdraw-command-row {
  display: flex; flex: 1 1 510px; flex-wrap: wrap; align-items: center; gap: 5px 12px; min-width: 0;
}
${withdraw} :is(.withdraw-shortcuts,.live-actions) {
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px; height: auto; min-height: 0; margin: 0; padding: 0;
}
${withdraw} .live-actions { order: 0; margin-inline-start: auto; }
${withdraw} .live-metric-zone {
  order: 0; margin: 0; padding: 0; flex: 0 1 auto; align-self: center; color: var(--rp-muted); font-size: 11px;
}
${withdraw} :is(.withdraw-shortcuts,.live-actions) .btn {
  min-height: 29px; height: 29px; border-radius: 5px; padding: 2px 8px; font-size: 12px; white-space: nowrap;
}
${withdraw} .withdraw-shortcuts .btn { color: var(--rp-ink); background: #fff; border: 1px solid var(--rp-line); }
${withdraw} .withdraw-shortcuts .btn[aria-pressed="true"] {
  color: #085c6d; background: var(--rp-tint); border-color: var(--rp-accent); font-weight: 650;
}
@container withdraw-filters (max-width: 700px) {
  ${withdraw} .withdraw-scope-fields { display: grid; width: 100%; grid-template-columns: repeat(auto-fit,minmax(min(125px,100%),1fr)); }
  ${withdraw} .withdraw-scope-fields > .live-field { width: auto; }
  ${withdraw} .withdraw-scope-fields > .withdraw-record-source { grid-column: 1 / -1; width: min(100%, 210px); }
  ${withdraw} .live-metric-window { width: 100%; }
  ${withdraw} .live-metric-endpoint { width: auto; flex: 1 1 0; }
}
@container withdraw-filters (max-width: 448px) {
  ${withdraw} .withdraw-filter-form { gap: 7px; }
  ${withdraw} .live-metric-window { display: grid; gap: 4px; }
  ${withdraw} .live-metric-endpoint {
    display: grid; grid-template-columns: minmax(0,1fr) minmax(min(204px,100%),2fr);
    align-items: center; gap: 5px;
  }
  ${withdraw} .live-metric-endpoint > span { line-height: 1.25; white-space: normal; }
  ${withdraw} .withdraw-command-row { gap: 6px 8px; }
  ${withdraw} .withdraw-shortcuts { flex-basis: 100%; }
  ${withdraw} :is(.withdraw-shortcuts,.live-actions) .btn { min-height: 34px; height: auto; }
}
@media (max-width: 800px) {
  html[data-m8-report-pilot] body.live-admin:has(.withdraw-toolbar) .title-actions > .btn[onclick="liveExport()"] { display: inline-flex; }
}
html[data-m8-report-pilot] body.live-admin .withdraw-kpis {
  display: grid; grid-template-columns: repeat(auto-fit,minmax(min(158px,100%),1fr)); gap: 0;
}
html[data-m8-report-pilot] body.live-admin .withdraw-kpis .withdraw-kpi {
  border: 0; border-radius: 0; border-inline-start: 1px solid var(--rp-line);
  padding: 11px 14px; min-width: 0; background: #fff; box-shadow: none;
}
html[data-m8-report-pilot] body.live-admin .withdraw-kpis .withdraw-kpi:first-child { border-inline-start: 0; }
html[data-m8-report-pilot] body.live-admin .withdraw-kpi>strong {
  color: var(--rp-ink); font-size: clamp(20px,2vw,27px); line-height: 1.2; font-variant-numeric: tabular-nums;
}
html[data-m8-report-pilot] body.live-admin .withdraw-kpi .rp-previous {
  display: block; color: var(--rp-ink); font-weight: 550; font-size: 12px; margin: 2px 0;
}
html[data-m8-report-pilot] body.live-admin .daily-comparison {
  --daily-ink: var(--rp-ink); --daily-muted: var(--rp-muted); --daily-line: var(--rp-line);
}
html[data-m8-report-pilot] body.live-admin .daily-comparison .daily-query-status {
  background: transparent; min-height: 28px; padding: 3px 0; border: 0; margin-bottom: 6px;
}
html[data-m8-report-pilot] body.live-admin .daily-comparison .daily-empty { min-height: 84px; padding: 15px; }
html[data-m8-report-pilot] body.live-admin .daily-comparison .daily-periods { gap: 3px 12px; margin-bottom: 4px; }
html[data-m8-report-pilot] body.live-admin .daily-comparison .daily-disclosures { margin: 0 0 8px; }
html[data-m8-report-pilot] body.live-admin .daily-comparison .daily-metrics {
  background: #fff; border: 1px solid var(--rp-line); border-radius: 9px; overflow: hidden; gap: 0;
}
html[data-m8-report-pilot] body.live-admin .daily-comparison .daily-metrics>div {
  border: 0; box-shadow: inset -1px 0 var(--rp-line); border-radius: 0; gap: 4px; padding: 11px 14px;
}
html[data-m8-report-pilot] body.live-admin .daily-comparison .daily-panel-title { padding: 10px 14px; }
html[data-m8-report-pilot] body.live-admin .daily-comparison .daily-toolbar {
  border-bottom: 1px solid var(--rp-line); padding-bottom: 5px; margin-bottom: 8px;
}
html[data-m8-report-pilot] body.live-admin .daily-comparison .daily-toolbar button.on {
  color: #085c6d; background: var(--rp-tint); border-color: #b6d6db;
}
html[data-m8-report-pilot] body.live-admin .wo-operations-filter .wo-filter-grid { gap: 7px 10px; }
html[data-m8-report-pilot] body.live-admin .wo-operations-filter .wo-filter-actions {
  margin-top: 9px; border-top: 1px solid #e4ecef; padding-top: 8px;
}
html[data-m8-report-pilot] body.live-admin .wo-operations-filter [hidden] { display: none; }
html[data-m8-report-pilot] body.live-admin .wo-operations-results :is(.wo-log-table,.wo-records-table,.wo-deposit-ticket-table) {
  overflow-x: auto; max-width: 100%; background: #fff;
}
html[data-m8-report-pilot] body.live-admin .wo-operations-results table th,
html[data-m8-report-pilot] body.live-admin .wo-deposit-ticket-table th {
  color: var(--rp-muted); background-color: var(--rp-raised);
}
html[data-m8-report-pilot] body.live-admin .wo-ticket-section dl>div { padding-block: 6px; }
html[data-m8-report-pilot] body.live-admin .live-payout-config .lpc-top h2[data-rp-repeat] { display: none; }
html[data-m8-report-pilot] body.live-admin .live-payout-config .lpc-top span { color: var(--rp-muted); }
html[data-m8-report-pilot] body.live-admin .live-payout-config .lpc-tabs { gap: 4px; padding-bottom: 6px; }
html[data-m8-report-pilot] body.live-admin .live-payout-config :is(.lpc-tabs,.lpc-platforms) button.active {
  background-color: var(--rp-tint); border-color: #b6d6db; color: #085c6d;
}
html[data-m8-report-pilot] body.live-admin .live-payout-config .lpc-browser :is(aside,article) {
  border-radius: 9px; border-color: var(--rp-line);
}
html[data-m8-report-pilot] body.live-admin .live-payout-config .lpc-platforms button {
  min-height: 34px; text-align: left;
}
html[data-m8-report-pilot] body.live-admin .live-payout-config .lpc-browser :is(input,select) {
  min-height: 30px; font-size: 12px; border-radius: 6px;
}
@media (min-width:950px) {
  html[data-m8-report-pilot] body.live-admin .live-payout-config .lpc-browser {
    grid-template-columns: clamp(210px,18vw,260px) minmax(0,1fr); gap: 14px;
  }
}
@media (min-width:1280px) {
  /* Both regions must contain an actual row / plotted point. The source chart uses
     inline stroke on its two series, while its always-present grid has only a class. */
  html[data-m8-report-pilot] body.live-admin .daily-comparison:has(> [data-daily-primary] .daily-detail-table > tbody > tr):has(> [data-daily-trend] .daily-charts svg path[stroke][d*="M"]) {
    display: grid; grid-template-columns: minmax(0,1.62fr) minmax(0,1fr);
    align-items: start; column-gap: 14px;
    grid-template-areas:
      "controls controls"
      "period period"
      "status status"
      "notes notes"
      "kpis kpis"
      "detail trend"
      "cashflow trend";
    & > .daily-toolbar { grid-area: controls; }
    & > .daily-periods { grid-area: period; }
    & > .daily-query-status { grid-area: status; }
    & > .daily-disclosures { grid-area: notes; }
    & > .daily-metrics { grid-area: kpis; }
    & > [data-daily-primary] { grid-area: detail; }
    & > [data-platform-daily-cashflow] { grid-area: cashflow; }
    & > [data-daily-trend] { grid-area: trend; }
    & .daily-panel, & .daily-detail-wrap { min-width: 0; max-width: 100%; }
    & [data-daily-trend] .daily-charts { grid-template-columns: 1fr; gap: 14px; }
    & [data-daily-trend] .daily-trend-controls { flex-wrap: wrap; }
  }
  /* Only the authorized, native deposit-ticket drawer contains .wo-ticket-section.
     Keep its original modal lifecycle and leave the visible ticket queue alongside. */
  html[data-m8-report-pilot] body.live-admin:has(.wo-deposit-ticket-table) #drawerBackdrop:has(> .drawer .wo-ticket-section) {
    background: rgb(35 52 62 / .09);
  }
  html[data-m8-report-pilot] body.live-admin:has(.wo-deposit-ticket-table) #drawerBackdrop > .drawer:has(.wo-ticket-section) {
    right: 0; left: auto; width: clamp(390px,36vw,590px); max-width: 46vw;
    box-sizing: border-box; background: #fff; color: var(--rp-ink);
    border-left: 1px solid var(--rp-line); box-shadow: -8px 0 32px rgb(35 52 62 / .09);
  }
  html[data-m8-report-pilot] body.live-admin .drawer .wo-ticket-section dl {
    grid-template-columns: repeat(2,minmax(0,1fr)); background: #fff;
  }
}
@media (max-width:680px) {
  html[data-m8-report-pilot] body.live-admin .withdraw-toolbar .live-actions { flex-wrap: wrap; height: auto; }
  html[data-m8-report-pilot] body.live-admin .withdraw-kpis .withdraw-kpi { border-inline-start: 0; }
}
`;

export const LIGHT_PILOT_REPORT_SCRIPT = String.raw`
(() => {
  const doc = document;
  const root = doc.documentElement;
  if (!root || root.hasAttribute('data-m8-report-pilot')) return;
  root.setAttribute('data-m8-report-pilot', '');

  const baseline = '.withdraw-auto-kpi-panel .withdraw-kpi [data-comparison-baseline="matched-platforms"]';
  const configTitle = '.live-payout-config .lpc-top h2';
  const selector = [baseline, configTitle].join(',');

  function showBaseline(element) {
    // A matched-platform tooltip is produced only after the report validates the comparison.
    const match = /；当期 [\d,]+ 笔，昨日 ([\d,]+) 笔。/.exec(element.title || '');
    const existing = element.querySelector(':scope > .rp-previous');
    if (!match) { existing?.remove(); return; }
    const text = '同平台昨日 ' + match[1] + ' 笔';
    if (existing) {
      if (existing.textContent !== text) existing.textContent = text;
    } else {
      const value = doc.createElement('span');
      value.className = 'rp-previous';
      value.textContent = text;
      element.prepend(value);
    }
  }

  function decorate(element) {
    if (element.matches(baseline)) {
      showBaseline(element);
    } else if (element.matches(configTitle)) {
      const heading = doc.getElementById('pageTitle');
      element.toggleAttribute('data-rp-repeat', !!heading && heading.textContent.trim() === element.textContent.trim());
    }
  }

  function visit(node) {
    if (node.nodeType !== 1) return;
    if (node.matches(selector)) decorate(node);
    for (const element of node.querySelectorAll(selector)) decorate(element);
  }

  function start() {
    const surface = doc.getElementById('page') || doc.body;
    if (!surface) return;
    visit(surface);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') {
          if (record.target.matches(baseline)) showBaseline(record.target);
        } else {
          for (const element of record.addedNodes) visit(element);
        }
      }
    });
    observer.observe(surface, {childList:true, subtree:true, attributes:true, attributeFilter:['title']});
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
`;
