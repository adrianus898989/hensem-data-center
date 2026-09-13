/* Actual production React and CSS; synthetic only, with every external request blocked. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/Users/jun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compiled = ts.transpileModule(read('src/components/ThirdPartyRateSheet.tsx'), { compilerOptions: { target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, jsxFactory: '__jsx', jsxFragmentFactory: '__Fragment' } }).outputText;
const react = fs.readFileSync(path.join(path.dirname(require.resolve('react/package.json')), 'umd/react.development.js'), 'utf8');
const reactDom = fs.readFileSync(path.join(path.dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.development.js'), 'utf8');
const script = value => value.replace(/<\/script/gi, '<\\/script');
const cases = {
  india: ['印度', '印度线下', ['UPI', 'IMPS', 'PaytmQR'], '₹ 0', '₹ 100–50,000', 54, 24],
  brazil: ['巴西', '巴西盘口', ['PIX', 'Bank'], 'R$ 0,50', 'R$ 10–50.000', 15, 18],
  vietnam: ['越南', '越南盘口', ['Bank', 'QR'], '2.000 ₫', 'VND 100.000–50.000.000', 15, 18],
  indonesia: ['印尼', '印尼盘', ['QRIS', 'DANA'], 'Rp 1.500', 'IDR 10.000–5.000.000', 15, 18],
  south_america: ['南美', '南美盘口', ['COP', 'CLP'], 'COP 1.000 / CLP 100', 'COP 10.000–9.000.000', 15, 18],
  usdt: ['USDT通道', 'USDT通道', ['TRC20', 'ERC20'], '1 USDT', '10–1,000 USDT', 15, 18],
};
function fixtureFor(name, countOverride) {
  const [country, sheetName, types, unit, limit, defaultCount, platformCount] = cases[name];
  const rateRows = Array.from({ length: countOverride || defaultCount }, (_, i) => ({
    id: `${name}-source-${i}`, country, sheetName, sourceRow: 11 + i,
    thirdParty: i < 2 ? 'SUPER' : i === 2 ? 'Transafe-QR' : `完整示例三方名称-${i + 1}`, category: types[i % types.length],
    collectFee: i === 2 ? '0%' : i === 3 ? '' : '1.25%', collectSingleFee: i === 2 ? '0' : unit,
    payoutFee: i === 2 ? '' : '0.8%', payoutSingleFee: i === 2 ? '0.00' : '3', totalFee: '原表合计 2.05%',
    collectLimit: limit, payoutLimit: '精确原文 200–100,000', status: i === 2 ? '' : '正常',
    channelInfo: i === 0 ? '原文 R$ / VND / USDT，金额 <= 100，范围 > 0，🙂\n'.repeat(80) + '长备注结束标记'
      : i === 2 ? '代收情况: 支持限额 / 代付情况: 20万50万' : '代收状态: 开启 / 代付状态: 备用',
    leak: i === 0 ? '漏单全文结尾' : '', whitelist: i === 0 ? '白名单全文结尾' : '',
  }));
  rateRows.push({ ...rateRows[0], id: `${name}-other-sheet`, sheetName: `${sheetName} · 第二页`, thirdParty: '第二页独立三方' });
  const statusRows = [];
  for (const row of rateRows) for (let col = 0; col < platformCount; col++) {
    if (row.id === `${name}-source-2` && col === 1) continue;
    statusRows.push({ ...row, id: `${row.id}-status-${col}`, platform: `完整平台名称-${String(col + 1).padStart(2, '0')}`,
      sourceColumn: 21 + col, rawStatus: ['开启', '暂停', '备用', '原文待确认', '0'][col % 5], status: '' });
  }
  statusRows.push({ ...statusRows[0], id: 'raw-conflict', rawStatus: '维护原文（不得覆盖开启）' });
  statusRows.push({ ...statusRows[0], id: 'wrong-country', country: '不匹配国家', rawStatus: '禁止串入国家' });
  statusRows.push({ ...statusRows[0], id: 'wrong-source', sourceRow: 99999, rawStatus: '禁止串入原行' });
  return { country, rateRows, statusRows };
}
const ids = page => page.locator('.rate-sheet-table tbody tr').evaluateAll(rows => rows.map(row => row.dataset.rateId));
const tick = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function run() {
  fs.mkdirSync(out, { recursive: true });
  const externalRequests = [], errors = [], layouts = [], screenshots = [];
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const context = await browser.newContext({ viewport: { width: 1720, height: 1080 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await context.route('**/*', route => { externalRequests.push(route.request().url()); return route.abort(); });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>${read('src/app/globals.css')}</style><style>${read('src/components/ThirdPartyRatesDashboard.css')}</style><style>${read('src/components/ThirdPartyRateSheet.css')}</style>
    <style>html,body{margin:0}body{background:#f2f5fa;color:#22354f;font-family:Arial,"PingFang SC",sans-serif}.test-shell{margin:16px;min-width:0}.test-notice{font-size:12px;margin:0 0 8px;color:#596f8b}.test-shell h1{font-size:19px;margin:0 0 6px}@media(max-width:600px){.test-shell{margin:8px}}</style></head>
    <body><main class="test-shell"><h1>生产组件离线验收 · 合成数据</h1><p class="test-notice">真实 React / 全局 CSS / 父级 CSS；无账户、无网络、非实时费率</p>
    <div class="third-party-module country-rate-workspace"><div class="country-rate-page country-rate-sheet-page"><div id="app"></div></div></div></main>
    <script>${script(react)}</script><script>${script(reactDom)}</script><script>
    const __jsx=React.createElement,__Fragment=React.Fragment,exports={};function require(name){if(name==='react')return React;if(name.endsWith('.css'))return {};throw Error('Unexpected import '+name);}
    ${script(compiled)}
    const app=ReactDOM.createRoot(document.getElementById('app'));window.detailRows=[];window.selectionCalls=[];
    window.renderFixture=(fixture,props={},key='default')=>{window.currentFixture=fixture;app.render(React.createElement(exports.default,{key,...fixture,...props,onOpenRate:row=>window.detailRows.push(row.id)}));};
    window.renderControlled=sheet=>app.render(React.createElement(exports.default,{key:'controlled',...window.currentFixture,selectedSheet:sheet,onSelectSheet:next=>window.selectionCalls.push(next)}));
    </script></body></html>`;
  const snap = async (name, mode, width) => { const file = path.join(out, `production-rate-matrix-${name}-${mode}-${width}.png`); await page.screenshot({ path: file, fullPage: true }); screenshots.push(file); };
  async function render(fixture, props = {}, key = 'default') {
    await page.evaluate(data => window.renderFixture(data.fixture, data.props, data.key), { fixture, props, key });
    await page.locator('.rate-sheet-table tbody tr').first().waitFor(); await tick(page);
  }
  async function traverse(expected) {
    const actual = [];
    for (let guard = 0; guard <= expected.length; guard++) {
      actual.push(...await ids(page));
      const next = page.getByRole('button', { name: '下一页', exact: true });
      if (await next.isDisabled()) break;
      await next.click(); await tick(page);
    }
    assert.deepEqual(actual, expected, 'All source rows reachable exactly once, in original order');
  }
  try {
    await page.setContent(html);
    const scenarios = process.env.RATE_SHEET_SCENARIO ? [process.env.RATE_SHEET_SCENARIO] : Object.keys(cases);
    for (const name of scenarios) {
      assert(Object.hasOwn(cases, name), 'Only known synthetic scenarios allowed');
      const fixture = fixtureFor(name), baseline = JSON.stringify(fixture);
      const [country, sheetName, , unit, limit, count, columns] = cases[name];
      await render(fixture, {}, name);
      assert.equal(await page.locator('.rate-sheet').getAttribute('data-view'), 'compact');
      assert.equal(await page.getByLabel('每页记录数').inputValue(), '12');
      assert.equal((await ids(page)).length, 12);
      assert.equal(await page.locator('[data-platform-start]').count(), 1);
      assert.equal(await page.locator('tbody tr').first().locator('td[data-platform]').count(), columns);
      assert.match(await page.locator('.rate-sheet-config-notice').textContent(), /不代表实际跑量/);
      assert.doesNotMatch(await page.locator('.rate-sheet-table').textContent(), /有跑|没跑|未跑|禁止串入/);
      const row0 = page.locator(`[data-rate-id="${name}-source-0"]`), zero = page.locator(`[data-rate-id="${name}-source-2"]`);
      assert.match(await row0.locator('td[data-platform]').first().textContent(), /开启.*维护原文/s);
      assert.equal(await zero.locator('[data-platform="完整平台名称-02"]').textContent(), '—');
      assert.deepEqual(await zero.locator('.rate-sheet-fee-value').allTextContents(), ['0%', '—']);
      assert.deepEqual(await zero.locator('.rate-sheet-single-value').allTextContents(), ['单笔 0', '单笔 0.00']);
      assert.equal(await page.locator('tbody .rate-sheet-sticky-party').first().evaluate(node => getComputedStyle(node).top), 'auto');
      assert.equal(await page.locator('.rate-sheet-detail,[role="dialog"]').count(), 0);
      assert.equal(await page.locator('.rate-sheet-notes').count(), 0);
      assert((await row0.textContent()).includes(unit), 'Native single-fee unit remains visible');
      for (const width of [1720, 1024, 360]) {
        await page.setViewportSize({ width, height: width === 360 ? 844 : 1080 }); await tick(page);
        await page.getByRole('button', { name: '定位费率区', exact: true }).click(); await tick(page);
        const layout = await page.evaluate(() => { const scroller = document.querySelector('.rate-sheet-scroll'); return {
          client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
          tableClient: scroller.clientWidth, tableScroll: scroller.scrollWidth, rowHeight: document.querySelector('tbody tr').getBoundingClientRect().height,
          minFont: Math.min(...[...document.querySelectorAll('.rate-sheet th,.rate-sheet td,.rate-sheet small,.rate-sheet button')].map(node => parseFloat(getComputedStyle(node).fontSize))) }; });
        assert(layout.scroll <= layout.client + 1, `${name} ${width}: document overflow ${JSON.stringify(layout)}`);
        assert(layout.tableScroll > layout.tableClient); assert(layout.rowHeight <= 160); assert(layout.minFont >= 11);
        await snap(name, 'compact', width);
        await page.getByRole('button', { name: '定位平台区', exact: true }).click(); await tick(page);
        // Wide compact layouts already show the platform edge after five frozen
        // columns; only small screens need a nonzero offset (two frozen columns).
        if (width === 360) assert(await page.locator('.rate-sheet-scroll').evaluate(node => node.scrollLeft > 0), 'Locator really scrolls');
        const platformLocation = await page.locator('.rate-sheet-scroll').evaluate(scroller => {
          const platform = scroller.querySelector('tbody tr td[data-platform]').getBoundingClientRect();
          const frozen = [...scroller.querySelectorAll('tbody tr:first-child > *')].filter(node => getComputedStyle(node).position === 'sticky');
          return { x: platform.x, right: scroller.getBoundingClientRect().right, frozenRight: Math.max(...frozen.map(node => node.getBoundingClientRect().right)) };
        });
        assert(platformLocation.x >= platformLocation.frozenRight - 2 && platformLocation.x < platformLocation.right, 'Located first platform is actually visible after frozen columns');
        if (name === 'india') await snap(name, 'platforms', width);
        const stickyBefore = await page.locator('tbody .rate-sheet-sticky-party').first().boundingBox();
        await page.locator('.rate-sheet-scroll').evaluate(node => { node.scrollLeft = node.scrollWidth; });
        const stickyAfter = await page.locator('tbody .rate-sheet-sticky-party').first().boundingBox();
        assert(Math.abs(stickyBefore.x - stickyAfter.x) < 2, 'Original party stays pinned at the last platform');
        const lastPosition = await page.locator('tbody tr').first().locator('td[data-platform]').last().boundingBox();
        const scrollPosition = await page.locator('.rate-sheet-scroll').boundingBox();
        assert(lastPosition.x >= scrollPosition.x && lastPosition.x < scrollPosition.x + scrollPosition.width, 'Last platform is reachable, not silently clipped');
        await page.getByRole('button', { name: '定位费率区', exact: true }).click();
        assert.equal(await page.locator('.rate-sheet-scroll').evaluate(node => node.scrollLeft), 0);
        layouts.push({ country, width, ...layout });
      }
      await page.setViewportSize({ width: 1720, height: 1080 });
      const expected = fixture.rateRows.filter(row => row.sheetName === sheetName).map(row => row.id);
      await traverse(expected);
      for (const size of [20, 50, 12]) {
        await page.getByLabel('每页记录数').selectOption(String(size)); await tick(page);
        assert.deepEqual(await ids(page), expected.slice(0, size)); await traverse(expected);
      }
      await page.getByLabel('每页记录数').selectOption('20'); await tick(page);
      await page.locator('button[data-view="full"]').click(); await tick(page);
      assert.equal(await page.locator('.rate-sheet').getAttribute('data-view'), 'full');
      assert.equal((await ids(page)).length, Math.min(20, count));
      const fullText = await row0.textContent();
      for (const value of [unit, limit, '原表合计 2.05%', '精确原文 200–100,000', '长备注结束标记', '漏单全文结尾', '白名单全文结尾']) assert(fullText.includes(value), value);
      assert.equal((fullText.match(/🙂/gu) || []).length, 80);
      const note = row0.locator('.rate-sheet-notes');
      assert(await note.evaluate(node => node.scrollHeight > node.clientHeight && node.clientHeight <= 160));
      await note.evaluate(node => { node.scrollTop = node.scrollHeight; }); assert(await note.evaluate(node => node.scrollTop > 0));
      assert.equal(await note.getAttribute('tabindex'), '0'); assert((await row0.boundingBox()).height <= 195);
      assert.equal(await zero.locator('td').nth(2).textContent(), '原表合计 2.05%');
      assert.equal(await zero.locator('td').nth(3).textContent(), '0%'); assert.equal(await zero.locator('td').nth(7).textContent(), '—');
      assert.equal(await zero.locator('td').nth(6).locator('.rate-sheet-status-good,.rate-sheet-status-bad').count(), 0);
      for (const width of [1024, 360]) {
        await page.setViewportSize({ width, height: width === 360 ? 844 : 1080 }); await tick(page);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
        if (name === 'india' || name === 'usdt') await snap(name, 'full', width);
      }
      const beforeMode = await ids(page); await page.locator('button[data-view="compact"]').click(); await tick(page); assert.deepEqual(await ids(page), beforeMode);
      await page.getByRole('button', { name: `${sheetName} · 第二页`, exact: true }).click(); await tick(page); assert.deepEqual(await ids(page), [`${name}-other-sheet`]);
      await page.getByRole('button', { name: sheetName, exact: true }).click(); await tick(page); assert.deepEqual(await ids(page), expected.slice(0, 20));
      assert.equal(JSON.stringify(await page.evaluate(() => window.currentFixture)), baseline); assert.deepEqual(await page.evaluate(() => window.detailRows), []);
    }
    // A one-platform table must not stretch its fixed columns into overlapping
    // sticky offsets on desktop. Its short group header cannot alter sticky top.
    const few = fixtureFor('india', 2);
    few.statusRows = few.statusRows.filter(row => row.platform === '完整平台名称-01');
    await render(few, {}, 'few');
    for (const width of [1720, 1024, 360]) {
      await page.setViewportSize({ width, height: 1080 }); await tick(page);
      const dimensions = await page.locator('.rate-sheet-scroll').evaluate(node => ({
        table: node.querySelector('table').getBoundingClientRect().width,
        frozen: [...node.querySelectorAll('thead tr:first-child [data-freeze]')].map(cell => ({
          width: cell.getBoundingClientRect().width, left: getComputedStyle(cell).left })),
        firstHeader: node.querySelector('thead tr').getBoundingClientRect().height,
        nextTop: parseFloat(getComputedStyle(node.querySelector('thead tr:nth-child(2) th')).top),
      }));
      const expectedWidths = width <= 760 ? [36, 108, 78, 92, 92] : [40, 114, 78, 92, 92];
      assert(Math.abs(dimensions.table - expectedWidths.reduce((sum, size) => sum + size, 106)) <= 2);
      let offset = 0;
      dimensions.frozen.forEach((cell, i) => {
        assert(Math.abs(cell.width - expectedWidths[i]) <= 1);
        if (width > 760 || i < 2) assert(Math.abs(parseFloat(cell.left) - offset) <= 1);
        offset += expectedWidths[i];
      });
      assert(Math.abs(dimensions.firstHeader - dimensions.nextTop) <= 1, 'Second header is pinned below the real first row');
      await snap('one-platform', 'compact', width);
    }
    const none = { ...few, statusRows: [] };
    await render(none, {}, 'none');
    assert.equal(await page.locator('td[data-platform]').count(), 0);
    assert(await page.getByRole('button', { name: '定位平台区', exact: true }).isDisabled());
    assert.doesNotMatch(await page.locator('.rate-sheet-table').textContent(), /有跑|没跑|未跑/);
    const large = fixtureFor('india', 225); await render(large, { pageSize: 50 }, '225');
    await traverse(large.rateRows.filter(row => row.sheetName === '印度线下').map(row => row.id));
    const controlled = fixtureFor('india'); await render(controlled, {}, 'controlled');
    await page.evaluate(() => window.renderControlled('印度线下')); await tick(page);
    await page.getByRole('button', { name: '印度线下 · 第二页', exact: true }).click(); await tick(page);
    assert.deepEqual(await page.evaluate(() => window.selectionCalls), ['印度线下 · 第二页']); assert.equal((await ids(page)).length, 12);
    await page.evaluate(() => window.renderControlled('印度线下 · 第二页')); await tick(page); assert.deepEqual(await ids(page), ['india-other-sheet']);
    assert.deepEqual(externalRequests, [], 'No attempted external requests'); assert.deepEqual(errors, []);
    const report = { result: 'passed', syntheticOnly: true, actualReactComponent: true, productionGlobalAndParentCss: true,
      countries: scenarios, viewportWidths: [1720, 1024, 360], externalRequests: 0, pageErrors: errors,
      checks: ['compact and matrix default', 'exact original type/country/source joins', 'source conflicts preserved', 'unknown differs from zero', 'native money units',
        'source status never volume', '54 and 225 rows reachable', '12/20/50 page sizes', 'all original columns inline', 'complete bounded keyboard-accessible long notes',
        'no source modal', 'view and sheet changes', 'controlled parent sheet', 'inner-only horizontal overflow', 'real locator scrolling',
        'last platform reachable with pinned source name', 'one-platform exact column widths and sticky offsets', 'zero-platform state not invented', 'unchanged input arrays'], layouts, screenshots };
    fs.writeFileSync(path.join(out, 'production-rate-matrix-verification.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2)); return report;
  } finally { await context.close(); await browser.close(); }
}
module.exports = { run, fixtureFor };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
