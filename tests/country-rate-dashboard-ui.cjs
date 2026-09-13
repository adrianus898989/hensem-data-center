/* Actual parent + child React interaction, isolated synthetic data. No account or network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const modules = {};
for (const file of ['components/ThirdPartyRatesDashboard.tsx', 'components/ThirdPartyRateSheet.tsx',
  'lib/thirdPartyNameMap.ts', 'lib/platformDisplayCountry.ts', 'lib/format.ts']) {
  modules[path.basename(file).replace(/\.tsx?$/, '')] = ts.transpileModule(fs.readFileSync(path.join(root, 'src', file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, jsxFactory: '__jsx', jsxFragmentFactory: '__Fragment' },
  }).outputText;
}
const css = ['app/globals.css', 'components/ThirdPartyRateSheet.css', 'components/ThirdPartyRatesDashboard.css']
  .map(file => fs.readFileSync(path.join(root, 'src', file), 'utf8')).join('\n');
const react = fs.readFileSync(path.join(path.dirname(require.resolve('react/package.json')), 'umd/react.development.js'), 'utf8');
const dom = fs.readFileSync(path.join(path.dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.development.js'), 'utf8');
const countries = ['印度', '巴西', '胖虎巴西', '越南', '印尼', '巴基斯坦', '菲律宾', '马来', '缅甸', '哥伦比亚', '墨西哥', '智利', '尼日利亚', 'USDT通道'];
const rates = countries.flatMap((country, c) => Array.from({ length: c ? 4 : 54 }, (_, i) => ({
  id: `local-${c}-${i}`, sourceRow: i + 2, country, sheetName: `${country}原表`,
  thirdParty: ['示例通道A', '示例通道B', '示例通道C'][i % 3], category: i % 2 ? 'Bank' : 'QR',
  collectFee: '4.00%', payoutFee: '2.50%', totalFee: '6.50% + 6', collectSingleFee: '0', payoutSingleFee: '6',
  collectLimit: '100–50,000', payoutLimit: '100–100,000', status: '正常',
  channelInfo: `代收状态: 开启 / 代付状态: 备用 / 备注: 本地UI测试数据 ${i}`, leak: '', whitelist: '',
})));
const platformStatuses = rates.flatMap(row => Array.from({ length: 12 }, (_, i) => ({ ...row,
  id: `${row.id}-status-${i}`, sourceColumn: i + 20, platform: `示例平台${i + 1}`,
  rawStatus: ['开启', '暂停', '未接入', '备用', ''][i % 5], status: i % 5 ? '' : '正常',
})));
const fixture = { meta: { sheets: countries.map(c => `${c}原表`), updatedAt: '2026-09-13T06:45:08Z' }, rates, platformStatuses, anomalies: [] };
const safe = s => s.replace(/<\/script/gi, '<\\/script');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1720, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], external = [], results = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => { external.push(route.request().url()); return route.abort(); });
  try {
    await page.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
      .test-shell{margin-left:196px;padding:14px 16px;min-width:0}.test-shell-note{font-size:11px;margin-bottom:8px;color:#64748b}
      .test-rail{position:fixed;inset:0 auto 0 0;width:196px;background:#0b1930;color:#fff;padding:24px 14px;font-size:14px}
      @media(max-width:760px){.test-rail{display:none}.test-shell{margin-left:0;padding:8px}}
      </style><body><aside class="test-rail">Hensem 数据后台<br><small>本地 UI 测试 · 示例数据</small></aside><main class="test-shell"><div class="test-shell-note">测试用数据，非生产费率或平台状态</div><div id="app"></div></main>
      <script>${safe(react)}</script><script>${safe(dom)}</script><script>
      const __jsx=React.createElement,__Fragment=React.Fragment, sources=${safe(JSON.stringify(modules))},cache={};
      window.testPayload=${safe(JSON.stringify(fixture))};window.testCalls=[];
      function require(name){
        if(name==='react')return React;if(name.endsWith('.css'))return {};
        const key=name.split('/').pop();
        if(key==='DashboardAuthGate')return {useDashboardAuth:()=>({session:{access_token:'LOCAL_TEST_ONLY'}})};
        if(key==='dashboardDataClient')return {isDashboardDataDenied:()=>false,dashboardBusinessFetch:async url=>{if(url!=='/api/supabase-third-party-rates')throw Error('Unexpected API');window.testCalls.push(url);return {ok:true,json:async()=>structuredClone(window.testPayload)}}};
        if(cache[key])return cache[key].exports;if(!sources[key])throw Error('Unexpected module '+name);
        const m={exports:{}};cache[key]=m;new Function('require','module','exports','__jsx','__Fragment',sources[key])(require,m,m.exports,__jsx,__Fragment);return m.exports;
      }
      ReactDOM.createRoot(document.getElementById('app')).render(React.createElement(require('./ThirdPartyRatesDashboard').default,{embedded:true}));
      </script></body></html>`);
    await page.locator('.rate-sheet-table tbody tr').first().waitFor();
    assert.equal(await page.locator('.rate-sheet-table tbody tr').count(), 12);
    assert.equal(await page.locator('.rate-sheet-detail,[role="dialog"]').count(), 0);
    assert.equal(await page.locator('.country-rate-sheet-heading h2').textContent(), '印度线下盘口 费率与平台接入');
    for (const width of [1720, 1024, 360]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await page.evaluate(() => {
        const rect = sel => { const r=document.querySelector(sel).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}; };
        return { viewport:innerWidth,document:document.documentElement.scrollWidth, sync:rect('.rate-access-mode-note'), filters:rect('.filter-card'), table:rect('.rate-sheet-scroll') };
      });
      assert(layout.document <= width + 1, `Parent document overflow at ${width}: ${JSON.stringify(layout)}`);
      assert(layout.sync.h < 45, 'Sync text must remain compact');
      assert(layout.table.w <= width, 'Table must scroll inside its page');
      const out = path.join(root, 'outputs', `production-rate-matrix-parent-${width}.png`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await page.screenshot({ path: out, fullPage: true });
      if (width === 1720) assert(layout.table.y < 420, `Compact top area must leave room for source rows: ${JSON.stringify(layout)}`);
      results.push({ width, ...layout, screenshot: out });
    }
    await page.setViewportSize({ width: 1720, height: 1000 });
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    assert.equal(await page.locator('[data-rate-id="local-0-12"]').count(), 1);
    await page.getByRole('button', { name: '越南盘口', exact: true }).click();
    assert.equal(await page.locator('.rate-sheet-table tbody tr').count(), 4);
    assert.equal(await page.locator('[data-rate-id="local-3-0"]').count(), 1);
    await page.getByRole('button', { name: '原表全部列', exact: true }).click();
    assert.match(await page.locator('.rate-sheet-table').innerText(), /100–50,000/);
    assert.equal(await page.locator('[role="dialog"]').count(), 0);
    await page.getByPlaceholder('搜索三方 / 盘口 / 费率 / 状态').fill('不存在的示例');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await page.getByText('没有匹配的三方费率资料', { exact: true }).waitFor();
    await page.getByRole('button', { name: '重置', exact: true }).click();
    assert.equal(await page.getByPlaceholder('搜索三方 / 盘口 / 费率 / 状态').inputValue(), '');
    // Reset deliberately clears draft fields only; preserve the existing apply step.
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await page.locator('.rate-sheet-table tbody tr').first().waitFor();
    await page.getByRole('button', { name: '异常提醒', exact: true }).click();
    assert.equal(await page.locator('.country-rate-workspace').count(), 0, 'New styles must not target the anomaly view');
    await page.getByRole('button', { name: '各国家费率', exact: true }).click();
    await page.locator('.country-rate-workspace .rate-sheet-table').waitFor();
    assert.deepEqual(await page.evaluate(() => window.testPayload), fixture, 'Production rendering cannot mutate input');
    assert.deepEqual(errors, []);assert.deepEqual(external, []);
    console.log(JSON.stringify({ passed:true,synthetic:true,externalRequests:0,checks:['real parent loader','all country buttons','pagination','full inline fields','filter and reset','anomaly isolation','compact sync and filters','responsive parent'],results },null,2));
  } finally { await context.close();await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
