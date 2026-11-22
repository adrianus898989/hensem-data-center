// Installed only in an authorized iframe. The root marker keeps the rules inert until bootstrap.
const page = 'html[data-m8-light-pilot="1"]:root body';
const filterSelect = `${page} :is(.live-field,.live-filters,.wo-filter-grid,.live-pager,.daily-toolbar,.config-filters,.filterbar) select:not([multiple]):not([size])`;

export const LIGHT_PILOT_STYLES = `
html[data-m8-light-pilot="1"] { color-scheme:light; }
${page} {
  --lp-bg:#f5f6fa; --lp-paper:#fff; --lp-rail:#fcfcff; --lp-ink:#2e3246;
  --lp-muted:#626a81; --lp-line:#dfe3ed; --lp-rule:#eceef4; --lp-fill:#f7f8fb;
  --lp-violet:#6150c6; --lp-selection:#eeeafb; --lp-error:#984443; --lp-warn:#855c1d;
  --line:var(--lp-line); --shadow:0 1px 3px #25294008; --daily-line:var(--lp-line);
  color:var(--lp-ink); background:var(--lp-bg); font-variant-numeric:tabular-nums;
}
${page} :is(.content,.main-content) { background:var(--lp-bg); }
${page} .sidebar { background:var(--lp-rail)!important; color:var(--lp-ink)!important; border-right:1px solid var(--lp-line); box-shadow:none; }
${page} .sidebar :is(.brand,.brand b,.brand strong) { color:var(--lp-ink)!important; }
${page} .sidebar :is(.brand small,.nav-title,.nav-section-title,.nav-hint,.nav-caption,.sidebar-note,.nav-arrow) {color:var(--lp-muted)!important;}
${page} .sidebar .brand {border-color:var(--lp-line)!important;}
${page} .sidebar .brand :is(.logo,.brand-logo,.brand-icon) {background:var(--lp-violet)!important;color:#fff!important;}
${page} .sidebar :is(.nav,.subnav,.nav-center){background:transparent;}
${page} .sidebar :is(.center-button,.subnav a,.nav .ico){color:#4c546b!important;background:transparent!important;box-shadow:none;}
${page} .sidebar .center-button.current {color:#383353!important;background:#f2f0fa!important;}
${page} .sidebar .center-button.current .ico {color:var(--lp-violet)!important;}
${page} .sidebar :is(.subnav a:hover,.center-button:hover){background:#f3f2f8!important;}
${page} .sidebar .subnav a.active{background:var(--lp-selection)!important;color:#5141ad!important;font-weight:650;}
${page} .sidebar .sub-dot{background:#a2a6b8;}
${page} .sidebar .active .sub-dot{background:var(--lp-violet);}
${page} :is(.topbar,#livePageTabs){background:var(--lp-paper)!important;border-color:var(--lp-line)!important;}
${page} :is(.page-title h1,.panel-head h2,.daily-panel-title h2){color:var(--lp-ink);}
${page} .page-title h1{font-size:clamp(20px,1.75vw,27px);line-height:1.25;}
${page} :is(.panel,.live-filters,.daily-panel,.daily-section,.wo-filter-panel,.daily-card,.live-metric,.kpi){background-color:var(--lp-paper);border-color:var(--lp-line);border-radius:9px;box-shadow:0 1px 2px #25294005;}
${page} :is(.live-metric strong,.kpi-value){color:var(--lp-ink);}
${page} :is(.live-metric label,.kpi-label,.live-field label,.wo-filter-grid label,.live-metric-endpoint,.live-date-endpoint label){color:var(--lp-muted);}
${page} :is(.live-tabs,.live-overview-tabs,.daily-toolbar) :is(button.on,button.active,button[aria-pressed=true]),
${page} .live-pager button.on {background:var(--lp-selection);color:#5141ac;border-color:#d6d0ef;}
${page} :is(.live-filters,.wo-filter-panel,.withdraw-toolbar,.daily-toolbar,.config-filters) :is(button,input,select,summary){font-family:inherit;}
${page} :is(.live-field,.wo-filter-grid,.live-date-endpoint,.live-metric-endpoint,.config-filters) :is(input:not([type=checkbox]):not([type=radio]),select),
${page} :is(.live-date-trigger,.live-multi summary,.lp-date-summary) {
  box-sizing:border-box; min-height:33px; border:1px solid var(--lp-line);border-radius:6px;
  background-color:var(--lp-paper); color:var(--lp-ink);font-size:12px;line-height:1.4;
}
${page} :is(.live-metric-endpoint,.live-date-endpoint) input {font-variant-numeric:tabular-nums;}
${page} :is(.live-date-trigger,.live-multi summary,.lp-date-summary):is(:hover,:focus-visible),
${page} .live-multi details[open] summary {border-color:#a99be4;}
${page} :is(.live-multi-menu,.live-date-panel,.lp-date-body) {
  background:var(--lp-paper);color:var(--lp-ink);border:1px solid var(--lp-line);
  border-radius:9px;box-shadow:0 9px 26px #2830521e,0 1px 4px #28305210;
}
${page} .live-multi-menu label:hover,${page} .live-multi-menu label:has(input:checked) {background:var(--lp-selection);color:#5141ad;}
${page} :is(.live-multi-menu,.daily-controls) :is(input[type=checkbox],input[type=radio]) {accent-color:var(--lp-violet);}
${page} :is(.live-date-controls,.live-metric-windows,.wo-filter-dates){gap:8px;}
${page} :is(button.btn,.wo-filter-actions button,.live-date-panel button,.live-pager button){border-radius:6px;}
${page} :is(.btn.primary,.wo-filter-actions .primary) {color:#fff;background:var(--lp-violet);border-color:var(--lp-violet);}
${page} .title-actions .btn.primary {background:var(--lp-paper);border:1px solid var(--lp-line);color:var(--lp-ink);}
${page} :is(.btn,.link):disabled {cursor:not-allowed;}
${page} :is(button,select,summary,a,input):focus-visible {outline:2px solid #8271ce;outline-offset:2px;}
${page} :is(.live-table,.daily-table,.wo-records-table,.report-table) th{background-color:var(--lp-fill);color:#58627b;border-color:var(--lp-line);}
${page} :is(.live-table,.daily-table,.wo-records-table,.report-table) td{border-color:var(--lp-rule);}
${page} :is(.live-table,.daily-table,.wo-records-table) tbody tr:hover{background:#f8f8fc;}
${page} :is(.live-table,.daily-table) tfoot{background:var(--lp-fill);color:var(--lp-ink);}
${page} :is(.live-status,.daily-query-status,.live-read-phase) {padding:5px 9px;margin:6px 0;border:1px solid var(--lp-rule);border-radius:6px;background:#f8f9fc;color:var(--lp-muted);font-size:12px;}
${page} .daily-query-status {min-height:0;}
${page} :is(.live-error,[role=alert].live-status) {color:var(--lp-error);background:#fdf2f1;border-color:#efd8d6;}
${page} :is(.daily-read-issues,.daily-progress,.live-warning){color:var(--lp-warn);}
${page} .lp-secondary-prompt {
  position:absolute!important;inline-size:1px!important;block-size:1px!important;margin:-1px!important;
  padding:0!important;overflow:hidden!important;clip-path:inset(50%)!important;white-space:nowrap!important;border:0!important;
}
${page} .lp-date-shortcuts {display:block;position:relative;min-width:0;align-self:end;order:10;}
${page} .lp-date-summary {display:inline-flex;align-items:center;gap:7px;padding:5px 9px;cursor:pointer;list-style:none;white-space:nowrap;}
${page} .lp-date-summary::-webkit-details-marker{display:none;}
${page} .lp-date-summary::after {content:'▾';color:var(--lp-muted);font-size:10px;}
${page} .lp-date-body {position:absolute;top:calc(100% + 4px);left:0;z-index:40;min-width:min(236px,80vw);padding:7px;}
${page} .lp-date-body .live-date-shortcuts,${page} .live-date-panel .live-date-shortcuts {
 display:flex;flex-wrap:wrap;position:static;height:auto;gap:4px;margin:0;padding:3px;
}
${page} :is(.live-date-panel,.lp-date-body) .live-date-shortcuts .btn {border:1px solid var(--lp-line);background:var(--lp-paper);color:var(--lp-ink);}
${page} .live-date-panel .live-date-shortcuts{padding:0 0 8px;margin-bottom:6px;border-bottom:1px solid var(--lp-rule);}
${page} .live-business-filters:has(>.lp-date-shortcuts){overflow:visible;}
${page} .btn[aria-busy=true]::before {content:'';display:inline-block;width:10px;height:10px;margin-right:5px;vertical-align:-1px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;animation:lp-turn .8s linear infinite;}
@keyframes lp-turn{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){${page} .btn[aria-busy=true]::before{animation:none;}}
/* The browser keeps the select, its label, typeahead, keyboard handling and change event. */
@supports(appearance:base-select) and selector(::picker(select)) {
  ${filterSelect},${filterSelect}::picker(select){appearance:base-select;}
  ${filterSelect} {align-items:center;padding:4px 8px;}
  ${filterSelect}::picker(select) {color:var(--lp-ink);background:var(--lp-paper);border:1px solid var(--lp-line);border-radius:8px;padding:4px;margin-block:4px;max-height:min(300px,65vh);box-shadow:0 8px 22px #28305220;}
  ${filterSelect} option {min-height:28px;border-radius:4px;padding:4px 7px;font:inherit;}
  ${filterSelect} option:checked {background:var(--lp-selection);color:#5141ad;}
  ${filterSelect} option:disabled {color:#777e90;}
  ${filterSelect}::picker-icon {color:var(--lp-muted);font-size:10px;}
}
@media(max-width:700px){${page} .lp-date-body{min-width:190px;}}
`;
