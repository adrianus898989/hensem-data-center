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
    if (name === './AutoWithdrawRateComparison') return component('AutoWithdrawRateComparison');
    if (name.startsWith('@/lib/')) return loadTs(path.join(root, 'src', name.slice(2) + '.ts'));
    throw Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}
const {AutoWithdrawDailySummary: Summary} = component('AutoWithdrawDailySummary');
const {AutoWithdrawRateComparison: RateComparison} = component('AutoWithdrawRateComparison');
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

const current = {total: 100, autoCount: 60, manualCount: 40, success: 80, rejected: 20};
const previous = {total: 200, autoCount: 100, manualCount: 100, success: 180, rejected: 20};
const comparison = {totals: previous, matchedPlatforms: 2, totalPlatforms: 2, date: '2026-09-09'};
const compareProps = {startDate: '2026-09-10', endDate: '2026-09-10', comparison};
const metric = (html, tone) => html.match(new RegExp(`<div class="aw-daily-metric is-${tone}">([\\s\\S]*?)<\\/div>`))[1];
const rate = (extra = {}) => renderToStaticMarkup(React.createElement(RateComparison, {
  count: 60, total: 100, previousCount: 100, previousTotal: 200, tone: 'auto', compare: true, ...extra
}));

test('daily summary shows exact prior date and weighted previous rates with pp changes', () => {
  const html = render(current, compareProps);
  assert.match(html, /对比 2026-09-09/);
  assert.match(metric(html, 'auto'), /前日 50\.00%/);
  assert.match(metric(html, 'auto'), /\+10\.00 pp/);
  assert.match(metric(html, 'manual'), /-10\.00 pp/);
  assert.match(metric(html, 'success'), /前日 90\.00%/);
  assert.match(metric(html, 'success'), /-10\.00 pp/);
  assert.match(metric(html, 'rejected'), /前日 10\.00%/);
  assert.match(metric(html, 'rejected'), /\+10\.00 pp/);
  assert.doesNotMatch(html, /aw-daily-comparison-incomplete/);
});

test('summary total uses count growth percentage rather than pp', () => {
  const total = metric(render(current, compareProps), 'total');
  assert.match(total, /前日 200 笔/);
  assert.match(total, /−50\.00%/);
  assert.doesNotMatch(total, / pp/);
});

test('zero prior total remains a known zero count but rates and growth are incomparable', () => {
  const zero = Object.fromEntries(Object.keys(previous).map(key => [key, 0]));
  const html = render(current, {...compareProps, comparison: {...comparison, totals: zero}});
  assert.match(metric(html, 'total'), /前日 0 笔/);
  assert.match(metric(html, 'total'), /不可比/);
  assert.match(metric(html, 'auto'), /前日 —/);
  assert.match(metric(html, 'auto'), /不可比/);
  assert.doesNotMatch(html, /Infinity|NaN|\+0\.00 pp/);
});

test('partial previous platform coverage never compares a subset against all current totals', () => {
  const html = render(current, {...compareProps, comparison: {...comparison, matchedPlatforms: 1}});
  assert.match(html, /覆盖 1\/2 平台，汇总不可比/);
  assert.equal((html.match(/无完整对比数据/g) || []).length, 5);
  assert.doesNotMatch(html, /前日 200 笔|前日 50\.00%|10\.00 pp/);
});

test('missing aggregate and zero matched platforms cannot become a zero percent comparison', () => {
  const html = render(current, {...compareProps, comparison: {...comparison, totals: null, matchedPlatforms: 0}});
  assert.match(html, /覆盖 0\/2 平台，汇总不可比/);
  assert.doesNotMatch(html, /前日 0\.00%|前日 0 笔| pp/);
});

test('range summaries do not inherit a single yesterday comparison', () => {
  const html = render(current, {...compareProps, startDate: '2026-09-01', dayCount: 10});
  assert.doesNotMatch(html, /aw-daily-comparison-scope|aw-daily-previous|前日| pp/);
});

test('summary distinguishes favorable directions by metric rather than sign alone', () => {
  const html = render(current, compareProps);
  assert.match(metric(html, 'auto'), /is-up is-favorable/);
  assert.match(metric(html, 'manual'), /is-down is-favorable/);
  assert.match(metric(html, 'success'), /is-down is-unfavorable/);
  assert.match(metric(html, 'rejected'), /is-up is-unfavorable/);
});

test('rate cell emphasizes current percent and shows previous denominator-based percent and pp', () => {
  const html = rate();
  assert.match(html, /class="aw-rate-current">60\.00%/);
  assert.match(html, /昨日 50\.00%/);
  assert.match(html, /\+10\.00 pp/);
  assert.match(html, /is-up is-favorable/);
  assert.match(html, /aw-rate-current-line[\s\S]*aw-rate-current[\s\S]*aw-rate-delta[\s\S]*aw-rate-previous/);
  assert.match(html, /class="aw-rate-previous">昨日 50\.00%<\/span>/);
});

test('rate cell with no prior row is explicitly missing rather than zero', () => {
  const html = rate({previousCount: undefined, previousTotal: undefined});
  assert.match(html, /60\.00%/);
  assert.match(html, /无对比数据/);
  assert.doesNotMatch(html, /昨日| pp|0\.00%<\/span>.*0\.00%/);
});

test('rate cell keeps positive-denominator zero rates comparable', () => {
  const html = rate({count: 0, previousCount: 0});
  assert.match(html, /class="aw-rate-current">0\.00%/);
  assert.match(html, /昨日 0\.00%/);
  assert.match(html, /is-flat is-neutral/);
  assert.match(html, /0\.00 pp/);
  assert.doesNotMatch(html, /无对比数据|不可比/);
});

test('zero denominators and invalid inputs never show Infinity or fictional zero comparisons', () => {
  for (const extra of [{previousTotal: 0}, {total: 0}, {count: NaN}, {previousCount: Infinity}]) {
    const html = rate(extra);
    assert.doesNotMatch(html, /NaN|Infinity|\+0\.00 pp/);
    assert.match(html, /不可比|无对比数据/);
  }
});

test('manual and rejected decreases are favorable while increases are unfavorable', () => {
  for (const tone of ['manual', 'rejected']) {
    assert.match(rate({tone, count: 40}), /is-down is-favorable/);
    assert.match(rate({tone, count: 60}), /is-up is-unfavorable/);
  }
});

test('delta color direction uses the same two-decimal rounding as its displayed pp', () => {
  const html = rate({count: 0, total: 100000, previousCount: 5, previousTotal: 100000, tone: 'manual'});
  assert.match(html, /-0\.01 pp/);
  assert.match(html, /is-down is-favorable/);
  assert.doesNotMatch(html, /is-flat/);
});

test('rate comparisons hidden outside comparison mode retain current percent', () => {
  const html = rate({compare: false});
  assert.match(html, /60\.00%/);
  assert.doesNotMatch(html, /aw-rate-previous|昨日| pp/);
});
