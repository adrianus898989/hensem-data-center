// Inject both strings only into an authorized dashboard document.
export const LIGHT_PILOT_REPORT_STYLES = `
html[data-m8-report-pilot] {
  --rp-ink: #30354a;
  --rp-muted: #616a80;
  --rp-line: #dfe3ec;
  --rp-raised: #f7f8fb;
  --rp-accent: #6655ce;
  --rp-tint: #efedfc;
}
html[data-m8-report-pilot] body.live-admin .withdraw-toolbar,
html[data-m8-report-pilot] body.live-admin .wo-operations-filter {
  padding: 12px 16px; background: #fff; border: 1px solid var(--rp-line); border-radius: 9px;
}
html[data-m8-report-pilot] body.live-admin .withdraw-toolbar::before { content: none; }
html[data-m8-report-pilot] body.live-admin .withdraw-toolbar {
  gap: 8px 10px; align-items: end;
}
html[data-m8-report-pilot] body.live-admin .withdraw-toolbar .live-field { order: 1; }
html[data-m8-report-pilot] body.live-admin .withdraw-toolbar .live-metric-endpoint { order: 2; }
html[data-m8-report-pilot] body.live-admin .withdraw-toolbar .live-actions { order: 5; gap: 6px; }
html[data-m8-report-pilot] body.live-admin .withdraw-toolbar .live-metric-zone {
  order: 7; font-size: 11px; color: var(--rp-muted);
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
html[data-m8-report-pilot] body.live-admin .rp-period-menu { order: 6; }
html[data-m8-report-pilot] body.live-admin .rp-success-menu { order: 3; }
html[data-m8-report-pilot] body.live-admin :is(.rp-period-menu,.rp-success-menu) {
  max-width: 100%; font-size: 12px; color: var(--rp-muted);
}
html[data-m8-report-pilot] body.live-admin :is(.rp-period-menu,.rp-success-menu)>summary {
  width: max-content; max-width: 100%; line-height: 30px; padding: 0 8px;
  cursor: pointer; border-radius: 6px;
}
html[data-m8-report-pilot] body.live-admin :is(.rp-period-menu,.rp-success-menu)>summary:focus-visible {
  outline: 2px solid var(--rp-accent); outline-offset: 2px;
}
html[data-m8-report-pilot] body.live-admin .rp-period-menu[open] .withdraw-shortcuts,
html[data-m8-report-pilot] body.live-admin .rp-success-menu[open] .live-metric-window {
  display: flex; flex-wrap: wrap; align-items: end; gap: 6px; margin: 4px 0;
}
html[data-m8-report-pilot] body.live-admin .rp-success-menu .live-metric-endpoint {
  flex: 1 1 160px; min-width: min(160px,100%);
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
  color: #5143a9; background: var(--rp-tint); border-color: #d6d0ef;
}
html[data-m8-report-pilot] body.live-admin .wo-operations-filter .wo-filter-grid { gap: 7px 10px; }
html[data-m8-report-pilot] body.live-admin .wo-operations-filter .wo-filter-actions {
  margin-top: 9px; border-top: 1px solid #edf0f5; padding-top: 8px;
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
  background-color: var(--rp-tint); border-color: #dcd8ef; color: #5143a9;
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
    background: rgb(40 45 67 / .09);
  }
  html[data-m8-report-pilot] body.live-admin:has(.wo-deposit-ticket-table) #drawerBackdrop > .drawer:has(.wo-ticket-section) {
    right: 0; left: auto; width: clamp(390px,36vw,590px); max-width: 46vw;
    box-sizing: border-box; background: #fff; color: var(--rp-ink);
    border-left: 1px solid var(--rp-line); box-shadow: -8px 0 32px rgb(38 43 65 / .09);
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
  const shortcuts = '.withdraw-toolbar > .withdraw-shortcuts';
  const successWindow = '.withdraw-toolbar form .live-metric-window';
  const configTitle = '.live-payout-config .lpc-top h2';
  const selector = [baseline, shortcuts, successWindow, configTitle].join(',');
  const openGroups = new Map();

  function group(node, key, title, hasValue) {
    if (node.parentElement?.classList.contains(key)) return;
    const details = doc.createElement('details');
    const summary = doc.createElement('summary');
    details.className = key;
    summary.textContent = title;
    details.append(summary);
    details.open = hasValue || openGroups.get(key) === true;
    details.addEventListener('toggle', () => {
      if (details.isConnected) openGroups.set(key, details.open);
    });
    node.before(details);
    details.append(node);
  }

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
    } else if (element.matches(shortcuts)) {
      group(element, 'rp-period-menu', '快捷日期', false);
    } else if (element.matches(successWindow)) {
      // Only this known pair may collapse. A mixed or new window stays visible.
      const inputs = [...element.querySelectorAll('input,select,textarea,button')];
      if (inputs.length !== 2 || !inputs.some(input => input.name === 'successFrom')
          || !inputs.some(input => input.name === 'successTo')) return;
      group(element, 'rp-success-menu', '成功时间（可选）', inputs.some(input => input.value !== ''));
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
