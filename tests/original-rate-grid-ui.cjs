/* Production renderer and global CSS, synthetic sheets only. All outbound requests are blocked. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/Users/jun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compiled = ts.transpileModule(read('src/components/OriginalRateGrid.tsx'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, jsxFactory: '__jsx', jsxFragmentFactory: '__Fragment' } }).outputText;
const react = fs.readFileSync(path.join(path.dirname(require.resolve('react/package.json')), 'umd/react.development.js'), 'utf8');
const reactDom = fs.readFileSync(path.join(path.dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.development.js'), 'utf8');
const script = text => text.replace(/<\/script/gi, '<\\/script');
function fixture() {
  const rowCount = 60, columnCount = 49;
  const grid = { sheet: { sheetId: 277747449, title: '原表网格测试 · 合成数据', index: 0, rowCount, columnCount, frozenRowCount: 2, frozenColumnCount: 2 },
    rowCount, columnCount, cells: Array.from({ length: rowCount }, (_, row) => Array.from({ length: columnCount }, (_, col) => ({
      text: row < 2 ? `原表列${col + 1}${row === 1 ? '子标题' : ''}` : col === 0 ? `原名 ${row - 1}` : col === 1 ? 'UPI' : col < 15 ? '4.00%' : col < 31 ? `能力原文 ${col + 1}` : '运行原文',
      format: { backgroundColor: row < 2 ? { red: .72, green: .84, blue: .67 } : col >= 31 ? { red: .96, green: .8, blue: .8 } : { red: 1, green: 1, blue: 1 }, horizontalAlignment: col === 0 ? 'LEFT' : 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP', textFormat: { fontFamily: 'Arial', fontSize: 10, bold: row < 2 } }
    }))),
    rowHeights: Array.from({ length: rowCount }, (_, row) => row < 2 ? 30 : row === 5 ? 45 : 21), columnWidths: Array.from({ length: columnCount }, (_, col) => col === 0 ? 125 : col === 1 ? 80 : 100),
    merges: [{ startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 }, { startRowIndex: 0, endRowIndex: 1, startColumnIndex: 2, endColumnIndex: 4 }], hiddenRows: [10], hiddenColumns: [10], fetchedAt: '2026-09-14T00:00:00Z' };
  grid.cells[2][15] = { text: '极长备注不得撑高单元格。'.repeat(200), format: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } };
  grid.cells[3][15] = { text: '' }; grid.cells[3][16] = { text: '0' };
  return grid;
}
async function run() {
  const requests = [], errors = [];
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const context = await browser.newContext({ viewport: { width: 1540, height: 950 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const tick = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>${read('src/app/globals.css')}</style><style>${read('src/components/ThirdPartyRatesDashboard.css')}</style><style>${read('src/components/OriginalRateGrid.css')}</style>
  <style>html,body{margin:0}body{background:#f3f5f8}.test-shell{padding:10px;min-width:0}.test-title{font:12px Arial;color:#555;margin:0 0 8px}.test-toolbar{height:34px;background:#f8f9fa;border:1px solid #ccc;display:flex;align-items:center;font:12px Arial;padding:0 10px}</style></head><body>
  <main class="test-shell"><p class="test-title">原表网格 · 离线合成测试，不是真实费率</p><div class="test-toolbar">A1　|　原始单元格</div><div class="third-party-module"><div id="app"></div></div></main>
  <script>${script(react)}</script><script>${script(reactDom)}</script><script>const __jsx=React.createElement,__Fragment=React.Fragment,exports={};function require(name){if(name==='react')return React;if(name.endsWith('.css'))return {};throw Error(name);}${script(compiled)}
  const app=ReactDOM.createRoot(document.getElementById('app'));window.selections=[];window.renderGrid=(grid,zoom=1)=>app.render(React.createElement(exports.default,{grid,zoom,onCellSelect:(row,column,cell)=>window.selections.push({row,column,text:cell.text})}));</script></body></html>`;
  try {
    await page.setContent(html);
    const grid = fixture(); await page.evaluate(grid => window.renderGrid(grid), grid); await page.locator('[data-cell="A1"]').waitFor(); await tick();
    const measure = () => page.evaluate(() => {
      const box = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const cell = address => box(document.querySelector(`[data-cell="${address}"]`));
      return { a1: cell('A1'), a3: cell('A3'), b3: cell('B3'), c1: cell('C1'), c3: cell('C3'), p3: cell('P3'),
        rows: Array.from(document.querySelectorAll('tbody tr')).slice(0, 7).map(row => box(row).height),
        viewport: box(document.querySelector('.original-rate-grid-viewport')), docWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
    });
    let initial = await measure();
    for (const [actual, expected, label] of [[initial.a1.width, 125, 'original A width'], [initial.a1.height, 60, 'vertical merge height'], [initial.c1.width, 200, 'horizontal merge width'], [initial.a3.height, 21, 'original data row'], [initial.p3.height, 21, 'long note cannot enlarge row']]) assert(Math.abs(actual - expected) < .1, `${label}: ${actual} vs ${expected}`);
    assert.deepEqual(initial.rows, [30, 30, 21, 21, 21, 45, 21]);
    assert.equal(initial.docWidth, initial.clientWidth, 'horizontal overflow belongs only to sheet viewport');
    assert.equal(await page.locator('[data-source-column="10"]').count(), 0); assert.equal(await page.locator('tbody [data-source-row="10"]').count(), 0);
    assert.equal(await page.locator('[data-cell="P4"] .original-rate-grid-cell-text').textContent(), '');
    assert.equal(await page.locator('[data-cell="Q4"] .original-rate-grid-cell-text').textContent(), '0');
    await page.locator('.original-rate-grid-viewport').evaluate(node => { node.scrollLeft = 1700; node.scrollTop = 500; }); await tick();
    const scrolled = await measure();
    assert.equal(scrolled.a1.x, initial.a1.x); assert.equal(scrolled.a1.y, initial.a1.y);
    assert.equal(scrolled.a3.x, initial.a3.x); assert.equal(scrolled.b3.x, initial.b3.x);
    assert.equal(scrolled.c1.y, initial.c1.y); assert(scrolled.c1.x < initial.c1.x);
    assert(scrolled.a3.y < initial.a3.y); assert(scrolled.c3.x < initial.c3.x);
    // Parent name-box/search uses native scrollIntoView. Left/up jumps must not
    // put the target under sticky original columns/rows.
    await page.locator('[data-cell="C3"]').evaluate(node => node.scrollIntoView({ block: 'nearest', inline: 'nearest' })); await tick();
    const located = await measure();
    assert(Math.abs(located.c3.x - initial.c3.x) < .1, 'search left jump clears frozen columns');
    assert(Math.abs(located.c3.y - initial.c3.y) < .1, 'search upward jump clears frozen rows');
    await page.locator('[data-cell="A1"]').click(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.cell), 'B1');
    await page.keyboard.press('ArrowRight'); assert.equal(await page.evaluate(() => document.activeElement.dataset.cell), 'C1');
    await page.keyboard.press('ArrowRight'); assert.equal(await page.evaluate(() => document.activeElement.dataset.cell), 'E1');
    const selected = await page.evaluate(() => window.selections.at(-1)); assert.equal(selected.column, 4); assert.equal(selected.row, 0);
    assert.equal(await page.locator('[data-selected="true"]').count(), 1);
    for (const zoom of [.7, .85, 1]) {
      await page.evaluate(({ grid, zoom }) => window.renderGrid(grid, zoom), { grid, zoom }); await tick();
      await page.locator('.original-rate-grid-viewport').evaluate(node => { node.scrollLeft = 0; node.scrollTop = 0; }); await tick();
      const m = await measure();
      assert(Math.abs(m.a1.width - 125 * zoom) < .1, `width at ${zoom}`); assert(Math.abs(m.a1.height - 60 * zoom) < .1, `height at ${zoom}`);
      assert(Math.abs(m.p3.height - 21 * zoom) < .1, `long note height at ${zoom}`);
      await page.locator('.original-rate-grid-viewport').evaluate(node => { node.scrollLeft = 1700; node.scrollTop = 400; });
      await page.locator('[data-cell="C3"]').evaluate(node => node.scrollIntoView({ block: 'nearest', inline: 'nearest' })); await tick();
      const jumped = await measure();
      assert(Math.abs(jumped.c3.x - m.c3.x) < .1, `left search jump at ${zoom}`);
      assert(Math.abs(jumped.c3.y - m.c3.y) < .1, `upward search jump at ${zoom}`);
    }
    const output = path.join(root, 'outputs/original-rate-grid-synthetic-desktop.png'); fs.mkdirSync(path.dirname(output), { recursive: true }); await page.screenshot({ path: output, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); await tick();
    const mobile = await measure(); assert.equal(mobile.docWidth, mobile.clientWidth); assert.equal(await page.locator('.original-rate-grid-viewport').count(), 1);
    assert.equal(errors.length, 0, errors.join('\n')); assert.equal(requests.length, 0, 'no external requests');
    console.log(JSON.stringify({ passed: true, geometry: initial, screenshot: output, externalRequests: requests.length }, null, 2));
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
