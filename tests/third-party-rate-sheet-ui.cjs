/* Isolated React/browser preview. Synthetic by default; never fetches live data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs');
const source = fs.readFileSync(path.join(root, 'src/components/ThirdPartyRateSheet.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/ThirdPartyRateSheet.css'), 'utf8');
const productionCss = process.env.RATE_SHEET_GLOBAL_CSS === '1';
const globalCss = productionCss ? fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8') : '';
const compile = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, jsxFactory: '__jsx', jsxFragmentFactory: '__Fragment' } }).outputText;
const react = fs.readFileSync(path.join(path.dirname(require.resolve('react/package.json')), 'umd/react.development.js'), 'utf8');
const reactDom = fs.readFileSync(path.join(path.dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.development.js'), 'utf8');
const makeRate = (id, name, category, row, extra = {}) => ({ id, sheetName: '印度线下', country: '印度', thirdParty: name, category,
  collectFee: '4%', payoutFee: '2.5%', totalFee: '', collectSingleFee: '0', payoutSingleFee: '6', collectLimit: '100–50,000', payoutLimit: '200–100,000',
  channelInfo: '代收状态: 开启 / 代付状态: 备用 / 备注: 此行为布局示例，非实时费率', leak: '', whitelist: '', status: '正常', sourceRow: row, ...extra });
const sample = { country: '印度', title: '各国家费率 · 表格视图（预览）', notice: '仅本地布局示例 · 费率、范围和状态均为演示数据 · 未发布',
  rateRows: [makeRate('preview-1', 'SUPER', 'UPI', 3), makeRate('preview-2', 'SUPER', 'IMPS', 4, { collectFee: '3.8%', payoutFee: '2.8%', collectSingleFee: '', channelInfo: '代收状态: 暂停 / 代付状态: 开启 / 备注: 同三方不同类型，独立一行' }),
    makeRate('preview-3', 'RsPay', 'UPI', 5, { collectFee: '4.2%', payoutFee: '3%' }), makeRate('preview-4', 'Transafe-QR', '扫码', 10, { collectFee: '3.8%', payoutFee: '2.8%' }),
    makeRate('preview-5', '示例通道', 'Bank', 11, { collectFee: '0%', payoutFee: '', collectLimit: '', status: '', channelInfo: '', whitelist: '仅用于演示空值不补0' }),
    makeRate('other-sheet', '示例通道', '原生', 4, { sheetName: '印度原生线上' })], statusRows: [] };
for (const rate of sample.rateRows) for (let i = 0; i < 3; i++) sample.statusRows.push({ ...rate, id: `${rate.id}-platform-${i}`, platform: `示例盘口${i + 1}`, status: i ? '备用' : '正常', rawStatus: i ? '备用（示例）' : '开启', sourceColumn: 22 + i });
const countryCases = {
  brazil: ['巴西', '巴西盘口', ['PIX', 'Bank'], 'R$ 0,50', 'R$ 10–50.000'],
  vietnam: ['越南', '越南盘口', ['Bank', 'QR'], '2.000 ₫', 'VND 100.000–50.000.000'],
  indonesia: ['印尼', '印尼盘', ['QRIS', 'DANA'], 'Rp 1.500', 'IDR 10.000–5.000.000'],
  south_america: ['南美', '南美盘口', ['COP', 'CLP'], 'COP 1.000 / CLP 100', 'COP 10.000–9.000.000'],
  usdt: ['USDT通道', 'USDT通道', ['TRC20', 'ERC20'], '1 USDT', '10–1,000 USDT'],
};
const scenario = process.env.RATE_SHEET_SCENARIO || 'india';
assert(scenario === 'india' || Object.hasOwn(countryCases, scenario), 'Only known synthetic scenarios are allowed');
let countrySample = sample;
if (scenario !== 'india') {
  const [country, sheet, types, unit, limit] = countryCases[scenario];
  const longNote = '备注: 多语言长说明，保留原币种 R$ / VND / IDR / USDT，不换算；条件 <= 100，🙂。\n'.repeat(35) + '长备注结束标记';
  const rateRows = types.map((category, i) => makeRate(`${scenario}-${i}`, '同名示例渠道', category, 6 + i, { country, sheetName: sheet,
    collectFee: i ? '0%' : '0.75%', collectSingleFee: unit, collectLimit: limit, payoutFee: '', payoutSingleFee: '', payoutLimit: '',
    channelInfo: '代收情况: 支持限额 / 代付情况: 20万50万', status: '' }));
  rateRows.push(makeRate(`${scenario}-long`, '长备注示例', types[0], 9, { country, sheetName: sheet, channelInfo: longNote, collectSingleFee: unit, collectLimit: limit }));
  rateRows.push(makeRate(`${scenario}-other`, '其他页签示例', types[1], 5, { country, sheetName: `${sheet} · 示例第二页`, collectSingleFee: unit, collectLimit: limit }));
  const statusRows = [];
  for (const rate of rateRows) for (let i = 0; i < 6; i++) statusRows.push({ ...rate, id: `${rate.id}-status-${i}`, platform: `示例盘口${i + 1}`, status: i % 2 ? '备用' : '正常', rawStatus: i % 2 ? '备用（原文示例）' : '开启', sourceColumn: 23 + i });
  countrySample = { country, title: `${country}费率 · 表格视图（验收）`, notice: '仅本地模拟验收 · 所有数值、范围和状态均为演示数据', rateRows, statusRows };
}
const fixture = process.env.RATE_SHEET_FIXTURE ? JSON.parse(fs.readFileSync(process.env.RATE_SHEET_FIXTURE, 'utf8')) : countrySample;
assert(Array.isArray(fixture.rateRows) && Array.isArray(fixture.statusRows) && typeof fixture.country === 'string');
const safe = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const scriptSafe = text => text.replace(/<\/script/gi, '<\\/script');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1720, height: 960 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const external = [], errors = [], page = await context.newPage();
  await context.route('**/*', route => { external.push(route.request().url()); return route.abort(); });
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${globalCss}</style><style>
      *{box-sizing:border-box}body{margin:0;background:#f2f5fa;color:#20324e;font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif}.preview{margin:26px;padding:26px;background:#fff;border:1px solid #e1e8f2;border-radius:12px;box-shadow:0 5px 20px #26385308;min-width:0}.preview-head{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:22px}.preview h1{font-size:22px;margin:0 0 9px}.preview p{font-size:12px;color:#70809a;margin:0;line-height:1.7}.preview-badge{color:#a36724;background:#fff4df;border:1px solid #efd5a4;padding:6px 10px;border-radius:5px;font-size:12px;white-space:nowrap}@media(max-width:760px){.preview{margin:10px;padding:14px}.preview-head{align-items:flex-start;flex-direction:column;gap:10px}.preview h1{font-size:18px}}
      ${css}</style></head><body><main class="preview"><header class="preview-head"><div><h1>${safe(fixture.title || '费率表格布局预览')}</h1><p>${safe(fixture.notice || '本地只读预览 · 未发布')}</p></div><span class="preview-badge">布局确认稿 · 未发布</span></header>${productionCss ? '<div class="third-party-module"><div class="country-rate-page"><section class="panel rate-panel">' : ''}<div id="app"></div>${productionCss ? '</section></div></div>' : ''}</main>
      <script>${scriptSafe(react)}</script><script>${scriptSafe(reactDom)}</script><script>
      const __jsx=React.createElement,__Fragment=React.Fragment,exports={};function require(name){if(name==='react')return React;if(name.endsWith('.css'))return {};throw Error('Unexpected import');}
      ${scriptSafe(compile)}
      window.previewFixture=${scriptSafe(JSON.stringify(fixture))};window.detailRows=[];
      const previewRoot=ReactDOM.createRoot(document.getElementById('app'));
      window.previewSelectCalls=[];window.renderControlledPreview=sheet=>previewRoot.render(React.createElement(exports.default,{...window.previewFixture,selectedSheet:sheet,onSelectSheet:next=>window.previewSelectCalls.push(next)}));
      previewRoot.render(React.createElement(exports.default,{...window.previewFixture,onOpenRate:row=>window.detailRows.push(row.id)}));
      </script></body></html>`);
    await page.locator('.rate-sheet-table tbody tr').first().waitFor();
    const firstSheet = fixture.rateRows[0]?.sheetName, firstRows = fixture.rateRows.filter(row => row.sheetName === firstSheet);
    assert.equal(await page.locator('.rate-sheet-table tbody tr').count(), firstRows.length);
    assert.equal(await page.locator('tbody .rate-sheet-sticky-party').first().evaluate(node => getComputedStyle(node).top), 'auto', 'Global sticky th must not pin body row names vertically');
    assert.equal(await page.getByRole('checkbox', { name: '盘口状态矩阵' }).isChecked(), false);
    const screenshots = [];
    const snap = async name => { const named = scenario === 'india' ? name : name.replace('preview-', `${scenario}-`); const file = path.join(out, productionCss ? named.replace('.png', '-global.png') : named); await page.locator('.preview').screenshot({ path: file }); screenshots.push(file); };
    for (const row of firstRows) {
      // The raw source arrays are authoritative even when punctuation/currency differs.
      assert(await page.locator(`[data-rate-id="${row.id}"]`).textContent().then(text => text.includes(row.collectSingleFee) && text.includes(row.collectLimit)));
    }
    if (scenario !== 'india') {
      assert.equal(await page.locator('.rate-sheet-table tbody tr').first().locator('.rate-sheet-status-good,.rate-sheet-status-bad').count(), 0);
      assert((await page.locator('.rate-sheet-notes').allTextContents()).join('').includes('长备注结束标记'));
      const note = page.locator('.rate-sheet-notes').filter({ hasText: '长备注结束标记' });
      assert(await note.evaluate(node => node.scrollHeight > node.clientHeight && node.clientHeight <= 160));
      await note.evaluate(node => { node.scrollTop = node.scrollHeight; });
      assert(await note.evaluate(node => node.scrollTop > 0));
      await note.evaluate(node => { node.scrollTop = 0; });
    }
    await snap('third-party-rate-sheet-preview-desktop.png');
    // Interactivity uses the actual compiled component, not static fake controls.
    if (new Set(fixture.rateRows.map(row => row.sheetName)).size > 1) {
      const second = [...new Set(fixture.rateRows.map(row => row.sheetName))][1];
      await page.getByRole('button', { name: second, exact: true }).click();
      assert.equal(await page.locator('.rate-sheet-table tbody tr').count(), fixture.rateRows.filter(row => row.sheetName === second).length);
      await page.getByRole('button', { name: firstSheet, exact: true }).click();
    }
    await page.getByRole('checkbox', { name: '盘口状态矩阵' }).check();
    await page.getByText('盘口接入状态 · 原单元格', { exact: true }).waitFor();
    const before = await page.locator('tbody .rate-sheet-sticky-party').first().boundingBox();
    await page.locator('.rate-sheet-scroll').evaluate(node => { node.scrollLeft = node.scrollWidth; });
    const after = await page.locator('tbody .rate-sheet-sticky-party').first().boundingBox();
    assert(Math.abs(before.x - after.x) < 2, 'The original party must remain pinned while scrolling');
    await snap('third-party-rate-sheet-preview-matrix.png');
    await page.locator('.rate-sheet-detail').first().click();
    assert.deepEqual(await page.evaluate(() => window.detailRows), [firstRows[0].id]);
    await page.getByRole('checkbox', { name: '盘口状态矩阵' }).uncheck();
    await page.locator('.rate-sheet-scroll').evaluate(node => { node.scrollLeft = 0; });
    await page.setViewportSize({ width: 390, height: 844 });
    const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert(width.scroll <= width.client + 1, 'The document must not overflow horizontally');
    assert(await page.locator('.rate-sheet-scroll').evaluate(node => node.scrollWidth > node.clientWidth));
    await snap('third-party-rate-sheet-preview-mobile.png');
    await page.getByRole('checkbox', { name: '盘口状态矩阵' }).check();
    await page.locator('.rate-sheet-scroll').evaluate(node => { node.scrollLeft = node.scrollWidth; });
    await page.getByText('盘口接入状态 · 原单元格', { exact: true }).waitFor();
    const mobileWidth = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert(mobileWidth.scroll <= mobileWidth.client + 1, 'Expanded mobile matrix must remain in its scroll region');
    if (scenario !== 'india') {
      const header = page.locator('thead th').first(), headerBefore = await header.boundingBox();
      await page.locator('.rate-sheet-scroll').evaluate(node => { node.scrollTop = 240; });
      const headerAfter = await header.boundingBox();
      assert(Math.abs(headerBefore.y - headerAfter.y) < 2, 'Header must remain fixed above long notes');
    }
    await snap('third-party-rate-sheet-preview-mobile-matrix.png');
    const sheetNames = [...new Set(fixture.rateRows.map(row => row.sheetName))];
    if (sheetNames.length > 1) {
      await page.evaluate(sheet => window.renderControlledPreview(sheet), firstSheet);
      await page.getByRole('button', { name: sheetNames[1], exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.previewSelectCalls), [sheetNames[1]]);
      assert.equal(await page.locator('.rate-sheet-table tbody tr').count(), firstRows.length, 'Controlled click must wait for parent state');
      await page.evaluate(sheet => window.renderControlledPreview(sheet), sheetNames[1]);
      await page.waitForFunction(sheet => document.querySelector('.rate-sheet-tabs [aria-pressed="true"]').textContent === sheet, sheetNames[1]);
      assert.equal(await page.locator('.rate-sheet-table tbody tr').count(), fixture.rateRows.filter(row => row.sheetName === sheetNames[1]).length);
      assert(await page.getByRole('checkbox', { name: '盘口状态矩阵' }).isChecked(), 'Parent sheet state must not reset matrix choice');
    }
    assert.deepEqual(await page.evaluate(() => window.previewFixture.rateRows), fixture.rateRows);
    assert.deepEqual(external, [], 'All external traffic is forbidden'); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', country: fixture.country, productionCss, localOnly: true, externalRequests: 0, synthetic: !process.env.RATE_SHEET_FIXTURE, initialRows: firstRows.length,
      checks: ['one type per row', 'sheet switch', 'matrix toggle', 'sticky original name', 'detail receives exact source row', 'mobile bounded scrolling', 'raw units and punctuation', 'missing status not invented', 'long notes preserved', 'narrow matrix and sticky headers', 'controlled parent selection and matrix preservation'], screenshots }, null, 2));
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
