const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const {loadTs, root} = require('./load-typescript.cjs');

function component(name, mocks = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, 'src/components', name + '.tsx'), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX}
  }).outputText;
  const module = {exports: {}};
  new Function('require', 'module', 'exports', source)(name => {
    if (name in mocks) return mocks[name];
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name.startsWith('@/lib/')) return loadTs(path.join(root, 'src', name.slice(2) + '.ts'));
    throw Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}
const {AutoWithdrawDailySummary: Summary} = component('AutoWithdrawDailySummary');
const props = {startDate: '2026-09-09', endDate: '2026-09-09', dayCount: 1};
// Success/reject values are test fixtures; operation totals match the user's screenshot.
const totals = {total: 10742, autoCount: 4536, manualCount: 5033, success: 9500, rejected: 1000};
const render = (counts = totals, extra = {}) => renderToStaticMarkup(React.createElement(Summary, {...props, totals: counts, ...extra}));

test('auto/manual use all withdrawals, not their combined count, as denominator', () => {
  const html = render();
  assert.match(html, /自动出款占总笔数 42.23%/);
  assert.match(html, /人工处理占总笔数 46.85%/);
  assert.match(html, /未分方式 <b>1,173<\/b> · 10.92%/);
  assert.match(html, /成功占总笔数 88.44%/);
  assert.match(html, /驳回占总笔数 9.31%/);
  assert.match(html, /其他状态 <b>242<\/b> · 2.25%/);
});

test('unequal platform/day volumes produce aggregate percentages, not mean row rates', () => {
  const rows = [
    {total: 10, autoCount: 10, manualCount: 0, success: 10, rejected: 0},
    {total: 90, autoCount: 0, manualCount: 90, success: 80, rejected: 10}
  ];
  const aggregate = Object.fromEntries(Object.keys(totals).map(key => [key, rows.reduce((sum, row) => sum + row[key], 0)]));
  const html = render(aggregate, {startDate: '2026-09-01', endDate: '2026-09-09', dayCount: 2});
  assert.match(html, /自动出款占总笔数 10.00%/);
  assert.match(html, /人工处理占总笔数 90.00%/);
  assert.match(html, /2026-09-01 至 2026-09-09 · 2 个统计日/);
  assert.match(html, /日均 50/);
  assert.doesNotMatch(html, /aw-daily-remainders/);
});

test('empty results keep counts at zero and percentages unavailable', () => {
  const html = render(Object.fromEntries(Object.keys(totals).map(key => [key, 0])), {dayCount: 0});
  assert.doesNotMatch(html, /NaN|Infinity|0.00%|aw-daily-remainders|个统计日/);
  assert.equal((html.match(/占总笔数 —/g) || []).length, 4);
  assert.match(html, /日均 0/);
});

test('zero numerator with a positive denominator is a genuine zero percent', () => {
  const html = render({total: 10, autoCount: 0, manualCount: 10, success: 10, rejected: 0});
  assert.match(html, /自动出款占总笔数 0.00%/);
  assert.match(html, /人工处理占总笔数 100.00%/);
  assert.doesNotMatch(html, /aw-daily-remainders/);
});

test('inconsistent source counts are flagged, not hidden or normalized', () => {
  const html = render({total: 10, autoCount: 11, manualCount: 1, success: 12, rejected: 0});
  assert.match(html, /自动出款占总笔数 110.00%/);
  assert.match(html, /分项笔数超过总笔数，请核对明细/);
  assert.doesNotMatch(html, /未分方式 <b>-|其他状态 <b>-/);
});

function combined(allowed = true, availableRows = [{country: '巴基斯坦', platform: '92PKR', date: props.startDate, total: 10742, manualCount: 5033}]) {
  const auth = {useDashboardAuth: () => ({session: {access_token: 'test', user: {id: 'test-user'}}, profile: {active: allowed, role: 'owner'}})};
  const notes = component('AutoWithdrawNotes', {'./DashboardAuthGate': auth});
  const reasons = component('AutoWithdrawReasons', {'./DashboardAuthGate': auth});
  return renderToStaticMarkup(React.createElement(reasons.AutoWithdrawReasonsProvider, {...props, availableRows, showToolbar: false},
    React.createElement(notes.AutoWithdrawNotesProvider, {...props, availableRows, showToolbar: false},
      React.createElement(Summary, {...props, totals, actions: React.createElement(React.Fragment, null,
        React.createElement(reasons.AutoWithdrawReasonsQueryButton), React.createElement(notes.AutoWithdrawNotesActions))}))));
}

test('headless providers put all actions into one header without duplicate toolbars', () => {
  const html = combined();
  assert.equal((html.match(/自动出款日表/g) || []).length, 1);
  assert.equal((html.match(/>查询原因<\/button>/g) || []).length, 1);
  assert.equal((html.match(/>刷新备注<\/button>/g) || []).length, 1);
  assert.equal((html.match(/>备注样本<\/button>/g) || []).length, 1);
  assert.doesNotMatch(html, /class="wr-toolbar"|class="auto-notes-toolbar"|记录各盘口人工处理偏高/);
  assert.match(html, /role="status">正在读取每日备注/);
});

test('reason query stays disabled without permission or available platforms', () => {
  assert.match(combined(false), /disabled="">查询原因<\/button>/);
  assert.match(combined(true, []), /disabled="">查询原因<\/button>/);
  assert.doesNotMatch(combined(), /disabled="">查询原因<\/button>/);
});

test('daily summary uses the full filtered aggregate, not the current table page', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/Dashboard.tsx'), 'utf8');
  assert.match(source, /summarize\(summaryRows\)/);
  assert.match(source, /<AutoWithdrawDailySummary[^>]*totals=\{summary\}/);
  const daily = source.slice(source.indexOf('{autoView === "daily" && ('), source.indexOf('{autoView === "month" && ('));
  assert.doesNotMatch(daily, /<QuickStats|<Panel/);
  assert.match(daily, /AutoWithdrawTable rows=\{paginateRows/);
  assert.equal((daily.match(/showToolbar=\{false\}/g) || []).length, 2);
});
