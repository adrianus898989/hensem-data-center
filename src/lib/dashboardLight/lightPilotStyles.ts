// The marker is applied only to a verified, authorized dashboard document.
const page = 'html[data-m8-light-pilot="1"]:root body';
const filterSelect = `${page} :is(.live-field,.live-filters,.wo-filter-grid,.live-pager,.daily-toolbar,.config-filters,.filterbar) select:not([multiple]):not([size])`;

export const LIGHT_PILOT_STYLES = `
html[data-m8-light-pilot="1"] { color-scheme: light; }
${page} {
  --lp-bg: #f3f6f8;
  --lp-paper: #fff;
  --lp-rail: #e9eff2;
  --lp-ink: #203548;
  --lp-muted: #526778;
  --lp-line: #d2dce2;
  --lp-rule: #e2e9ed;
  --lp-fill: #f0f5f7;
  --lp-accent: #086b80;
  --lp-accent-strong: #07576a;
  --lp-selection: #e1f1f3;
  --lp-error: #913c39;
  --lp-warn: #835516;
  --line: var(--lp-line);
  --daily-line: var(--lp-line);
  color: var(--lp-ink);
  background: var(--lp-bg);
  font-variant-numeric: tabular-nums;
}
${page} :is(.content,.main-content) { background: var(--lp-bg); }

/* The authenticated source can append its own navigation styles after initial render. */
${page} .sidebar {
  color: var(--lp-ink) !important;
  background: linear-gradient(165deg,#f0f5f7 0%,#e8eff2 58%,#e6edf1 100%) !important;
  border-right: 1px solid #c9d6dd !important;
  box-shadow: inset -1px 0 #ffffff75;
}
${page} .sidebar .brand {
  color: #143746 !important;
  border-color: #cbd9e0 !important;
}
${page} .sidebar .brand :is(b,strong) { color: #143746 !important; font-weight: 750; letter-spacing: -.025em; }
${page} .sidebar .brand small { color: #527082 !important; }
${page} .sidebar .brand :is(.logo,.brand-logo,.brand-icon,.brandmark,.brand-mark),
${page} .sidebar .brand > :first-child:not(:has(b,small)):has(+ div b) {
  color: #fff !important;
  background: linear-gradient(145deg,#16889b,#075b70) !important;
  border: 1px solid #0a6b7e;
  border-radius: 10px;
  box-shadow: inset 0 1px #ffffff40,0 2px 5px #16495c1c;
}
${page} .sidebar :is(.nav-title,.nav-section-title,.nav-hint,.nav-caption,.sidebar-note) { color: #526c7c !important; }
${page} .sidebar :is(.nav,.subnav,.nav-center) { background: transparent; }
${page} .sidebar .center-button {
  min-height: 42px;
  gap: 9px;
  border-radius: 8px;
  color: #304c5e !important;
  background: transparent !important;
  box-shadow: none;
}
${page} .sidebar .center-button .nav-label { font-size: 13px; font-weight: 640; }
${page} .sidebar .center-button .ico {
  display: inline-grid;
  place-items: center;
  flex: 0 0 27px;
  width: 27px;
  height: 27px;
  box-sizing: border-box;
  border: 1px solid #c5d4dc;
  border-radius: 7px;
  color: #365a6b !important;
  background: #f9fcfc !important;
  box-shadow: inset 0 1px #fff;
  font: 600 16px/1 system-ui,sans-serif;
}
${page} .sidebar .center-button .nav-arrow { color: #4e6e7b !important; }
${page} .sidebar .center-button:hover { color: #153e4b !important; background: #dce8ed !important; }
${page} .sidebar .center-button.current { color: #133e4c !important; background: #d5e6eb !important; }
${page} .sidebar .center-button.current .ico {
  color: #fff !important;
  background: var(--lp-accent) !important;
  border-color: var(--lp-accent);
  box-shadow: none;
}
${page} .sidebar .subnav > a {
  min-height: 33px;
  padding-block: 7px;
  border-radius: 6px;
  color: #3d596a !important;
  background: transparent !important;
  font-size: 12px;
  line-height: 1.45;
}
${page} .sidebar .subnav > a:hover { color: #184550 !important; background: #d9e8ec !important; }
${page} .sidebar .subnav > a.active {
  color: #fff !important;
  background: var(--lp-accent) !important;
  box-shadow: inset 0 1px #ffffff1a,0 1px 2px #24536124;
  font-weight: 680;
}
${page} .sidebar .sub-dot { background: #7791a0; }
${page} .sidebar .active .sub-dot { background: #fff; }
${page} .sidebar :is(.center-button,.subnav > a):focus-visible { outline: 2px solid #256174; outline-offset: -2px; }
${page} .sidebar .subnav > a.active:focus-visible { outline-color: #fff; }

${page} :is([data-m8-nav-toggle],[data-m8-nav-backdrop]) { display: none; }
@media (max-width: 700px) {
  ${page}[data-m8-nav-ready] > main.main { margin-left: 0 !important; }
  ${page}[data-m8-nav-ready] > main.main > .topbar { padding-left: 51px !important; }
  ${page}[data-m8-nav-ready] > .sidebar {
    inset: 0 auto auto 0 !important; z-index: 122 !important; box-sizing: border-box;
    width: 48px !important; height: 48px !important; min-height: 0;
    padding: 0 !important; background: transparent !important;
    border: 0 !important; box-shadow: none; overflow: visible;
  }
  ${page}[data-m8-nav-ready]:not([data-m8-nav-open]) > .sidebar > :not([data-m8-nav-toggle]) { display: none !important; }
  ${page}[data-m8-nav-ready] .sidebar > [data-m8-nav-toggle] {
    position: absolute; top: 3px; left: 4px; z-index: 1;
    display: grid; place-items: center; width: 42px; height: 42px; padding: 0;
    color: var(--lp-accent-strong); background: transparent; border: 0; border-radius: 7px; cursor: pointer;
  }
  ${page}[data-m8-nav-ready] [data-m8-nav-toggle]:hover { background: #e0edef; }
  ${page} [data-m8-nav-toggle] span,
  ${page} [data-m8-nav-toggle] span::before,
  ${page} [data-m8-nav-toggle] span::after {
    display: block; width: 19px; height: 2px; border-radius: 2px; background: currentColor;
  }
  ${page} [data-m8-nav-toggle] span { position: relative; }
  ${page} [data-m8-nav-toggle] span::before,
  ${page} [data-m8-nav-toggle] span::after { position: absolute; left: 0; content: ''; }
  ${page} [data-m8-nav-toggle] span::before { top: -6px; }
  ${page} [data-m8-nav-toggle] span::after { top: 6px; }
  ${page}[data-m8-nav-open] > .sidebar {
    inset: 0 auto 0 0 !important; width: min(284px,calc(100vw - 52px)) !important;
    height: 100vh !important; height: 100dvh !important;
    padding: 10px 10px max(12px,env(safe-area-inset-bottom)) !important;
    overflow-y: auto; overscroll-behavior: contain; background: var(--lp-rail) !important;
    border-right: 1px solid var(--lp-line) !important; box-shadow: 10px 0 32px #17334337;
  }
  ${page}[data-m8-nav-open] > [data-m8-nav-backdrop]:not([hidden]) {
    display: block; position: fixed; inset: 0; z-index: 121; background: #18303e57;
  }
  /* These slots position host-rendered account panels. Keep their width and mount
     while moving them below the open drawer, then restore their normal geometry. */
  ${page}[data-m8-nav-open] :is(#hle-access,#hle-ip) {
    position: fixed; inset: 100vh 0 auto; top: 100dvh; width: auto; min-width: 1px;
  }
  ${page}[data-m8-nav-open] .sidebar > [data-m8-nav-toggle] { left: auto; right: 5px; top: 9px; }
  ${page}[data-m8-nav-open] [data-m8-nav-toggle] span { background: transparent; }
  ${page}[data-m8-nav-open] [data-m8-nav-toggle] span::before { top: 0; transform: rotate(45deg); }
  ${page}[data-m8-nav-open] [data-m8-nav-toggle] span::after { top: 0; transform: rotate(-45deg); }
  ${page}[data-m8-nav-open] .sidebar .brand {
    justify-content: flex-start; min-height: 46px; padding: 2px 39px 10px 3px; gap: 10px;
  }
  ${page}[data-m8-nav-open] .sidebar .brand > :has(b) { display: block !important; }
  ${page}[data-m8-nav-open] .sidebar #nav { width: 100%; }
  ${page}[data-m8-nav-open] .sidebar .center-button {
    width: 100%; justify-content: flex-start !important; text-align: left; padding: 7px 9px;
  }
  ${page}[data-m8-nav-open] .sidebar .center-button :is(.nav-label,.nav-arrow) { display: inline !important; }
  ${page}[data-m8-nav-open] .sidebar .center-button .nav-label { flex: 1; }
  ${page}[data-m8-nav-open] .sidebar .subnav { display: block !important; padding: 3px 0 5px 26px; }
  ${page}[data-m8-nav-open] .sidebar .subnav > a { min-height: 38px; padding: 7px 12px; white-space: nowrap; }
}

${page} .topbar {
  color: var(--lp-ink);
  background: var(--lp-paper) !important;
  border-bottom-color: var(--lp-line) !important;
}
${page} .topbar #crumbTitle { color: #344e60; font-weight: 650; }
${page} #livePageTabs {
  background: #f9fbfc !important;
  border-bottom: 1px solid var(--lp-line) !important;
}
${page} #livePageTabs .live-page-tab-list { gap: 5px; }
${page} #livePageTabs .live-page-tab {
  border: 1px solid transparent !important;
  border-radius: 6px;
  background: transparent !important;
}
${page} #livePageTabs .live-page-tab button { color: #4f6575 !important; font-size: 12px; }
${page} #livePageTabs .live-page-tab:hover { background: #edf3f5 !important; }
${page} #livePageTabs .live-page-tab[aria-current=page] {
  background: #fff !important;
  border-color: #b8d7de !important;
  box-shadow: inset 0 -2px var(--lp-accent);
}
${page} #livePageTabs .live-page-tab[aria-current=page] button { color: var(--lp-accent-strong) !important; font-weight: 650; }
${page} #livePageTabs .live-page-tab .live-page-close { padding-inline: 7px; font-size: 15px; }
${page} #livePageTabs .live-page-tab .live-page-close:hover { color: var(--lp-ink) !important; background: #dbe9ed; }
${page} #livePageTabs > button { color: var(--lp-muted); font-size: 11px; }
${page} #livePageTabs button:focus-visible { outline: 2px solid var(--lp-accent); outline-offset: -2px; }

${page} :is(.page-title h1,.panel-head h2,.daily-panel-title h2) { color: var(--lp-ink); }
${page} .page-title h1 { font-size: clamp(21px,1.65vw,27px); line-height: 1.3; font-weight: 720; letter-spacing: -.02em; }
${page} :is(.panel,.live-filters,.daily-panel,.daily-section,.wo-filter-panel,.daily-card,.live-metric,.kpi) {
  color: var(--lp-ink);
  background-color: var(--lp-paper);
  border-color: var(--lp-line);
  border-radius: 9px;
  box-shadow: 0 2px 5px #20354808;
}
${page} :is(.live-metric strong,.kpi-value) { color: var(--lp-ink); }
${page} :is(.live-metric label,.kpi-label,.live-field > label,.wo-filter-grid > label,.live-metric-endpoint > span,.live-date-endpoint > label) {
  color: var(--lp-muted); font-size: 12px; font-weight: 550; line-height: 1.4;
}
${page} :is(.live-tabs,.live-overview-tabs,.daily-toolbar) :is(button.on,button.active,button[aria-pressed=true]),
${page} .live-pager button.on { background: var(--lp-selection); color: var(--lp-accent-strong); border-color: #9ecbd3; }
${page} .section-switcher.live-team-workspace .tabs {
  display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px;
  max-width: 100%; width: fit-content; box-sizing: border-box; padding: 3px;
  border: 1px solid var(--lp-line); border-radius: 8px; background: #edf3f5;
}
${page} .section-switcher.live-team-workspace .tabs > button {
  min-height: 32px; padding: 4px 12px;
  border: 1px solid transparent !important; border-radius: 5px;
  background: transparent !important; color: #3c5667 !important; box-shadow: none;
  font-family: inherit; font-size: 13px; font-weight: 550; line-height: 1.4;
}
${page} .section-switcher.live-team-workspace .tabs > button:hover { background: #dce8ec !important; }
${page} .section-switcher.live-team-workspace .tabs > button:is(.on,[aria-pressed=true]) {
  background: #fff !important; color: var(--lp-accent-strong) !important;
  border-color: #a5cbd4 !important; box-shadow: inset 0 -2px var(--lp-accent); font-weight: 680;
}
${page} .section-switcher.live-team-workspace .tabs > button:focus-visible { outline-offset: -2px; }
${page} :is(.live-filters,.wo-filter-panel,.withdraw-toolbar,.daily-toolbar,.config-filters) :is(button,input,select,summary) { font-family: inherit; }
${page} :is(.live-field,.wo-filter-grid,.live-date-endpoint,.live-metric-endpoint,.config-filters) :is(input:not([type=checkbox]):not([type=radio]):not([type=hidden]),select),
${page} :is(.live-date-trigger,.live-multi summary) {
  box-sizing: border-box;
  min-height: 35px;
  border: 1px solid #c3d2db;
  border-radius: 6px;
  background-color: var(--lp-paper);
  color: var(--lp-ink);
  font-size: 13px;
  line-height: 1.45;
}
${page} :is(.live-metric-endpoint,.live-date-endpoint) input { font-variant-numeric: tabular-nums; }
${page} :is(.live-field,.wo-filter-grid,.config-filters) input::placeholder { color: #667a86; }
${page} :is(.live-date-trigger,.live-multi summary):hover,
${page} .live-multi details[open] summary { border-color: #72a6b3; }
${page} :is(.live-multi-menu,.live-date-panel) {
  background: var(--lp-paper);
  color: var(--lp-ink);
  border: 1px solid var(--lp-line);
  border-radius: 8px;
  box-shadow: 0 9px 26px #1d3d501c,0 2px 5px #1d3d500b;
}
${page} .live-multi-menu label.live-multi-option { color: var(--lp-ink); }
${page} .live-multi-menu label.live-multi-option:hover,
${page} .live-multi-menu label.live-multi-option:has(input:checked) { background: var(--lp-selection); color: var(--lp-accent-strong); }
${page} .live-multi-menu .live-multi-actions button { color: var(--lp-accent-strong); }
${page} .live-multi-menu .live-multi-actions span { color: var(--lp-muted); }
${page} :is(.live-multi-menu,.daily-controls) :is(input[type=checkbox],input[type=radio]) { accent-color: var(--lp-accent); }
${page} :is(button.btn,.wo-filter-actions button,.live-date-panel button,.live-pager button) { border-radius: 6px; }
${page} :is(.live-query-actions,.withdraw-toolbar .live-actions,.wo-filter-actions) .btn {
  min-height: 35px; padding: 0 12px; border: 1px solid #c3d2db; background: #fff; color: #3a5263; font-size: 13px; font-weight: 550;
}
${page} :is(.btn.primary,.wo-filter-actions .primary),
${page} :is(.live-query-actions,.withdraw-toolbar .live-actions,.wo-filter-actions) .btn.primary {
  color: #fff; background: var(--lp-accent); border: 1px solid var(--lp-accent); font-weight: 650;
}
${page} .btn.primary:hover:not(:disabled) { background: var(--lp-accent-strong); border-color: var(--lp-accent-strong); }
${page} .title-actions .btn.primary { color: var(--lp-accent-strong); background: #fff; border: 1px solid #b7cdd5; }
${page} .title-actions .btn.primary:hover:not(:disabled) { background: var(--lp-selection); }
${page} :is(.btn,.link):disabled { cursor: not-allowed; }
${page} :is(.live-query-actions,.withdraw-toolbar .live-actions,.wo-filter-actions) .btn:disabled:not([aria-busy=true]) {
  color: #617480; background: #e8eef1; border-color: #d9e4e8;
}
${page} :is(button,select,summary,a,input,textarea):focus-visible { outline: 2px solid #257c91; outline-offset: 2px; }
${page} :is(.live-table,.daily-table,.daily-detail-table,.wo-records-table,.report-table) th {
  background-color: var(--lp-fill); color: #345262; border-color: var(--lp-line); font-weight: 650;
}
${page} :is(.live-table,.daily-table,.daily-detail-table,.wo-records-table,.report-table) td { border-color: var(--lp-rule); }
${page} :is(.live-table,.daily-table,.daily-detail-table,.wo-records-table) tbody tr:hover { background-color: #f1f7f8; }
${page} :is(.live-table,.daily-table,.daily-detail-table) tfoot { background: #eaf3f5; color: var(--lp-ink); }
${page} :is(.live-status,.daily-query-status,.live-read-phase) {
  padding: 5px 9px; margin: 6px 0; border: 1px solid var(--lp-rule); border-radius: 6px;
  background: #f4f8f9; color: #496273; font-size: 12px; line-height: 1.45;
}
${page} .daily-query-status { min-height: 0; }
${page} :is(.live-error,[role=alert].live-status) { color: var(--lp-error); background: #fcf1f0; border-color: #ebc7c5; }
${page} :is(.daily-read-issues,.daily-progress,.live-warning) { color: var(--lp-warn); }
${page} .lp-secondary-prompt {
  position: absolute!important; inline-size: 1px!important; block-size: 1px!important; margin: -1px!important;
  padding: 0!important; overflow: hidden!important; clip-path: inset(50%)!important; white-space: nowrap!important; border: 0!important;
}
${page} .btn[aria-busy=true]::before {
  content: ''; display: inline-block; width: 10px; height: 10px; margin-right: 5px; vertical-align: -1px;
  border: 1.5px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: lp-turn .8s linear infinite;
}
@keyframes lp-turn {to {transform: rotate(360deg)}}
@media (prefers-reduced-motion:reduce) { ${page} .btn[aria-busy=true]::before { animation: none; } }

/* Customizable native select retains user-agent semantics, typeahead and keyboard selection. */
@supports(appearance:base-select) and selector(::picker(select)) {
  ${filterSelect}, ${filterSelect}::picker(select) { appearance:base-select; }
  ${filterSelect} { align-items: center; padding: 4px 9px; }
  ${filterSelect}::picker(select) {
    color: var(--lp-ink); background: #fff; border: 1px solid var(--lp-line); border-radius: 8px;
    padding: 4px; margin-block: 4px; max-height: min(300px,65vh); box-shadow: 0 8px 22px #1d3d501c;
  }
  ${filterSelect} option { min-height: 30px; border-radius: 4px; padding: 5px 8px; font: inherit; }
  ${filterSelect} option:checked { background: var(--lp-selection); color: var(--lp-accent-strong); }
  ${filterSelect} option:disabled { color: #687984; }
  ${filterSelect}::picker-icon { color: var(--lp-muted); font-size: 10px; }
}
`;
