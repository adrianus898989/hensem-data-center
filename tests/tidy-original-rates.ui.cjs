/* Real React UI, offline synthetic source snapshots; no production data or writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/Users/jun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'outputs');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const safe = value => value.replace(/<\/script/gi, '<\\/script');
const modules = {};
const styles = new Set(['src/app/globals.css']);
function include(file) {
  const key = path.basename(file).replace(/\.tsx?$/, '');
  if (modules[key]) return;
  const source = read(file);
  modules[key] = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, jsxFactory: '__jsx', jsxFragmentFactory: '__Fragment' } }).outputText;
  for (const match of source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)) {
    const target = match[1];
    if (target.endsWith('.css')) { styles.add(path.normalize(path.join(path.dirname(file), target))); continue; }
    if (!target.startsWith('.') && !target.startsWith('@/')) continue;
    if (/(?:DashboardAuthGate|dashboardDataClient)$/.test(target)) continue;
    const base = target.startsWith('@/') ? 'src/' + target.slice(2) : path.join(path.dirname(file), target);
    const resolved = ['.tsx', '.ts'].map(ext => base + ext).find(candidate => fs.existsSync(path.join(root, candidate)));
    if (resolved && !resolved.endsWith('Types.ts')) include(resolved);
  }
}
include('src/components/ThirdPartyRatesDashboard.tsx');
const css = [...styles].map(read).join('\n');
const react = fs.readFileSync(path.join(path.dirname(require.resolve('react/package.json')), 'umd/react.development.js'), 'utf8');
const dom = fs.readFileSync(path.join(path.dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.development.js'), 'utf8');
const longText = '完整原文 第一行  两个空格\n第二行 <img src=x onerror=alert(1)> 🙂\n' + '长期说明保留；'.repeat(70) + '全文尾标';
function sheet(sheetId, title, index) { return { sheetId, title, index, rowCount: 11, columnCount: 18, frozenRowCount: 2, frozenColumnCount: 1 }; }
const sheets = [sheet(277747449, '印度线下 · 合成样本', 0), sheet(202, '越南盘口 · 合成样本', 1)];
function gridFor(meta) {
  const labels = ['三方名称', '类型 / 钱包', '合计费率', '代收', '', '', '', '代付', '', '', '', '使用情况', '原始接口版本', '备注', 'PLATFORM_A(AR)', 'PLATFORM_B(AR)', '隐藏字段', '收款类型'];
  const second = ['', '', '', '费率', '单笔', '范围', '状态', '费率', '单笔', '范围', '状态', '', '', '', '', '', '', ''];
  const rows = [
    ['样本Pay', 'UPI', '7.50% + 6', '4.00%', '0', '100–50,000', '开启', '3.50%', '6', '100–50,000', '开启', '专用', 'v2.7', longText, '开启 🟢', '未接入 ⭕', '不能展示隐藏列', '唤醒'],
    ['', 'PaytmQR', '7.20% + 6', '3.70%', '0', '100–50,000', '备用', '3.50%', '6', '100–50,000', '开启', '再用', 'v2.8', '第二个渠道独立费率', '停用 ⛔', '开启 🟢', '不能展示隐藏列', '跑分'],
    ['FixtureB', 'UPI', '6.80% + 6', '3.80%', '0', '100–50,000', '开启', '3.00%', '6', '100–50,000', '开启', '再用', 'v1.5', '平台未知状态保持原值', '', '维护待确认', '不能展示隐藏列', '跑分'],
    ['HiddenProvider', '隐藏类型', '不能展示隐藏行', '0%', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['FixtureC', 'BANK', '8.20% + 6', '4.20%', '0', '100–50,000', '暂停', '4.00%', '6', '100–50,000', '开启', '暂停', 'v3.1', '正常备注', '未接入 ⭕', '停用 ⛔', '不能展示隐藏列', '唤醒'],
    ['FixtureD', 'UPI', '0%', '0%', '0', '0–100', '开启', '0%', '0', '0–100', '开启', '再用', 'v0.0', '数值零不是缺失', '开启 🟢', '开启 🟢', '不能展示隐藏列', '跑分'],
    ['FixtureE', 'UPI', '7.00% + 6', '4.00%', '0', '100–50,000', '开启', '3.00%', '6', '100–50,000', '开启', '再用', 'v1.0', '尾行', '开启 🟢', '备用', '不能展示隐藏列', '跑分'],
    ['FixtureF', 'BANK', '7.00% + 6', '4.00%', '0', '100–50,000', '开启', '3.00%', '6', '100–50,000', '开启', '再用', 'v1.0', '尾行二', '停用 ⛔', '未接入 ⭕', '不能展示隐藏列', '跑分'],
    ['FixtureG', 'UPI', '7.00% + 6', '4.00%', '0', '100–50,000', '开启', '3.00%', '6', '100–50,000', '开启', '再用', 'v1.0', '尾行三', '开启 🟢', '开启 🟢', '不能展示隐藏列', '跑分'],
  ];
  const cells = [labels, second, ...rows].map((row, r) => row.map(text => ({ text, format: { backgroundColor: r < 2 ? { red: 0, green: 1, blue: 1 } : { red: 1, green: .8, blue: 0 }, textFormat: { fontSize: 16, bold: r < 2 }, wrapStrategy: 'WRAP' } })));
  const merges = [{ startRowIndex: 0, endRowIndex: 1, startColumnIndex: 3, endColumnIndex: 7 }, { startRowIndex: 0, endRowIndex: 1, startColumnIndex: 7, endColumnIndex: 11 }, { startRowIndex: 2, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 1 }];
  for (const c of [0, 1, 2, 11, 12, 13, 14, 15, 16, 17]) merges.push({ startRowIndex: 0, endRowIndex: 2, startColumnIndex: c, endColumnIndex: c + 1 });
  return { sheet: meta, cells, merges, rowHeights: Array(11).fill(140), columnWidths: Array(18).fill(280), hiddenRows: [5], hiddenColumns: [16], fetchedAt: '2026-09-14T08:00:00Z', rowCount: 11, columnCount: 18 };
}
const grids = Object.fromEntries(sheets.map(meta => [meta.sheetId, gridFor(meta)]));
const meta = { title: '各国家费率 · 离线合成样本', sheets, fetchedAt: '2026-09-14T08:00:00Z' };
const profiles = {
  all: { auth_user_id: 'synthetic-all', role: 'viewer', active: true, permissions: { third_party: true }, data_scope: { mode: 'all', countries: [] }, updated_at: 'a' },
  restricted: { auth_user_id: 'synthetic-restricted', role: 'viewer', active: true, permissions: { third_party: true }, data_scope: { mode: 'selected', countries: ['BR_PANGHU'] }, updated_at: 'b' },
};
const tick = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function run() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(4500);
  const errors = [], network = [], checks = [], screenshots = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => { network.push(route.request().url()); return route.abort(); });
  const html = String.raw`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;background:#f2f5fa}.fixture-shell{padding:12px;min-width:0}.fixture-note{font:12px Arial,sans-serif;color:#53657c;margin:0 0 8px}</style><body><main class="fixture-shell"><p class="fixture-note">离线 UI 验收 · 合成原表数据，不代表真实费率</p><div id="app"></div></main><script>${safe(react)}</script><script>${safe(dom)}</script><script>
  const __jsx=React.createElement,__Fragment=React.Fragment,sources=${safe(JSON.stringify(modules))},cache={};
  window.fixture={meta:${safe(JSON.stringify(meta))},grids:${safe(JSON.stringify(grids))}};window.calls=[];window.storageReads=0;window.sideEffects=0;window.currentProfile=null;window.options={};
  Object.defineProperty(window,'localStorage',{configurable:true,get(){window.storageReads++;throw Error('Local storage forbidden');}});
  window.alert=window.open=()=>{window.sideEffects++;};window.fetch=()=>{throw Error('Native fetch forbidden');};
  function request(url,init={}) {
    const record={id:window.calls.length,url,signal:init.signal,aborted:false,done:false};window.calls.push(record);if(init.signal)init.signal.addEventListener('abort',()=>{record.aborted=true;});
    if(url==='/api/supabase-third-party-rates'){record.done=true;return Promise.resolve({ok:true,json:async()=>({rates:[],platformStatuses:[],anomalies:[],meta:{sheets:[],updatedAt:'2026-09-14T08:00:00Z'},summary:{totalRates:0,totalPlatforms:0}})});}
    if(!/^\/api\/original-rate-sheet(?:\?sheetId=\d+)?$/.test(url))throw Error('Unexpected API '+url);
    const id=new URL(url,'https://offline.invalid').searchParams.get('sheetId');
    return new Promise((resolve,reject)=>{record.deliver=(value,status=200)=>{record.done=true;resolve({ok:status===200,status,json:async()=>structuredClone(value)});};record.reject=()=>{record.done=true;reject(Object.assign(Error('synthetic denied'),{denied:true}));};if(id===null&&!window.options.holdMeta)record.deliver(window.fixture.meta);if(id!==null&&!window.options.holdGrid)record.deliver(window.fixture.grids[id]);});
  }
  function require(name){if(name==='react')return React;if(name.endsWith('.css'))return {};const key=name.split('/').pop();if(key==='DashboardAuthGate')return {useDashboardAuth:()=>({profile:window.currentProfile,session:{access_token:'OFFLINE_'+window.currentProfile?.auth_user_id}})};if(key==='dashboardDataClient')return {dashboardBusinessFetch:request,isDashboardDataDenied:error=>error?.denied===true};if(cache[key])return cache[key].exports;if(!sources[key])throw Error('Unexpected module '+name);const module={exports:{}};cache[key]=module;new Function('require','module','exports','__jsx','__Fragment',sources[key])(require,module,module.exports,__jsx,__Fragment);return module.exports;}
  const app=ReactDOM.createRoot(document.getElementById('app'));window.parentKey=0;
  window.mount=(profile,options={},fresh=true)=>{window.currentProfile=profile;window.options=options;if(fresh)window.parentKey++;app.render(React.createElement(require('./ThirdPartyRatesDashboard').default,{key:window.parentKey,embedded:true}));};window.pending=()=>window.calls.filter(call=>!call.done&&!call.aborted).map(call=>({id:call.id,url:call.url}));window.deliver=(id,value,status)=>window.calls[id].deliver(value,status);window.rejectCall=id=>window.calls[id].reject();
  </script></body></html>`;
  const mount = async (profile = profiles.all, options = {}, fresh = true) => { await page.evaluate(value => window.mount(value.profile, value.options, value.fresh), { profile, options, fresh }); await tick(page); };
  const ready = id => page.locator(`.tidy-rate-scroll[data-sheet-id="${id || 277747449}"]`).waitFor();
  const calls = () => page.evaluate(() => window.calls.map(({ id, url, aborted, done }) => ({ id, url, aborted, done })));
  const pending = async url => { await page.waitForFunction(url => window.pending().some(call => call.url === url), url); return (await page.evaluate(() => window.pending())).find(call => call.url === url).id; };
  const deliver = async (id, value, status = 200) => { await page.evaluate(value => window.deliver(value.id, value.value, value.status), { id, value, status }); await tick(page); };
  const sourceColumns = () => page.locator('.tidy-rate-table tbody tr').first().locator('[data-source-column]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.sourceColumn)));
  const rowCount = () => page.locator('.tidy-rate-table tbody tr').count();
  const check = async (name, task) => { try { await task(); checks.push({ name, passed: true }); console.log('PASS ' + name); } catch (error) { checks.push({ name, passed: false, error: error.message }); console.log('FAIL ' + name + ' ' + error.message); } };
  try {
    await page.setContent(html); assert.deepEqual(errors, [], 'Offline React harness initializes');
    await check('compact mode keeps original fee/channel variants and every platform', async () => {
      await mount(); await ready(); await page.getByRole('button', { name: '精简展示', exact: true }).click();
      const columns = await sourceColumns(); assert(columns.includes(3) && columns.includes(7), 'Both fee columns remain'); assert(columns.includes(14) && columns.includes(15), 'Every platform remains'); assert(!columns.includes(13) && !columns.includes(12), 'Verbose note and unknown ancillary field are excluded only in compact'); assert(!columns.includes(16), 'Hidden source column stays hidden');
      assert.equal(await rowCount(), 8); assert.equal(await page.locator('[data-cell="D3"]').textContent(), '4.00%'); assert.equal(await page.locator('[data-cell="D4"]').textContent(), '3.70%'); assert.match(await page.locator('[data-cell="A4"]').textContent(), /样本Pay/); assert.match(await page.locator('[data-cell="O4"]').textContent(), /停用/); assert.equal(await page.locator('[data-cell="D8"]').textContent(), '0%');
      assert.equal(await page.getByText('HiddenProvider', { exact: true }).count(), 0); assert.deepEqual(await page.evaluate(() => window.fixture), { meta, grids });
    });
    await check('full mode includes every visible source column in original order without normalizing values', async () => {
      await page.getByRole('button', { name: '原表全部列', exact: true }).click();
      assert.deepEqual(await sourceColumns(), Array.from({ length: 18 }, (_, c) => c).filter(c => c !== 16));
      assert.equal(await page.locator('[data-cell="M3"]').textContent(), 'v2.7'); assert.equal(await page.locator('[data-cell="E3"]').textContent(), '0'); assert.equal(await page.locator('[data-cell="N3"]').textContent(), longText);
      assert.match(await page.locator('.tidy-rate-table thead').innerText(), /原始接口版本/); assert.equal(await rowCount(), 8);
    });
    await check('full text opens inline and source markup remains inert', async () => {
      await page.locator('[data-cell="N3"]').click(); const field = page.getByLabel('原单元格完整内容'); assert.equal(await field.inputValue(), longText); assert(await field.evaluate(node => node.readOnly));
      assert.equal(await page.locator('dialog,[role="dialog"],.tidy-rate-table img').count(), 0); assert.equal(await page.evaluate(() => window.sideEffects), 0);
      assert.equal(await page.locator('[data-cell="N3"] span[title]').getAttribute('title'), longText);
    });
    await check('data rows stay compact and the provider remains sticky during horizontal scroll', async () => {
      const heights = await page.locator('.tidy-rate-table tbody tr').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height)); assert(heights.every(height => height >= 34 && height <= 38), 'Expected 36px rows, got ' + heights.join(','));
      const scroll = page.locator('.tidy-rate-scroll'); await scroll.evaluate(node => { node.scrollLeft = 0; }); await tick(page); const first = page.locator('.tidy-rate-provider.tidy-rate-frozen').first(); const before = await first.boundingBox();
      await scroll.evaluate(node => { node.scrollLeft = 650; }); await tick(page); const after = await first.boundingBox(); assert(Math.abs(after.x - before.x) <= 1, 'Provider name column must not move'); assert(await scroll.evaluate(node => node.scrollLeft > 0));
    });
    await check('platform shortcut exposes first platform beyond frozen columns; fee shortcut returns left', async () => {
      await page.getByRole('button', { name: '定位平台区', exact: true }).click(); await tick(page);
      const geometry = await page.locator('.tidy-rate-scroll').evaluate(node => { const bounds = node.getBoundingClientRect(); const header = node.querySelector('[data-platform-start]').getBoundingClientRect(); const frozen = Math.max(...[...node.querySelectorAll('thead .tidy-rate-frozen')].map(item => item.getBoundingClientRect().right)); return { left: header.left, right: header.right, viewportRight: bounds.right, frozen, scrollLeft: node.scrollLeft }; });
      assert(geometry.scrollLeft > 0); assert(geometry.left >= geometry.frozen - 1, 'First platform is obscured by frozen identity columns: ' + JSON.stringify(geometry)); assert(geometry.right <= geometry.viewportRight + 1, 'First platform fits in viewport');
      await page.getByRole('button', { name: '定位费率区', exact: true }).click(); await tick(page); assert.equal(await page.locator('.tidy-rate-scroll').evaluate(node => node.scrollLeft), 0);
    });
    await check('provider and wallet filters preserve source rows and resetting sheet removes filters', async () => {
      const initialType = await page.getByRole('combobox', { name: '类型 / 钱包', exact: true }).inputValue();
      await page.getByRole('searchbox', { name: '三方名称', exact: true }).fill('样本Pay'); assert.equal(await rowCount(), 2);
      await page.getByRole('combobox', { name: '类型 / 钱包', exact: true }).selectOption({ label: 'PaytmQR' }); assert.equal(await rowCount(), 1); assert.equal(await page.locator('[data-cell="D4"]').textContent(), '3.70%');
      await page.getByRole('button', { name: sheets[1].title, exact: true }).click(); await ready(202); await tick(page); assert.equal(await rowCount(), 8); assert.equal(await page.getByRole('searchbox', { name: '三方名称', exact: true }).inputValue(), ''); assert.equal(await page.getByRole('combobox', { name: '类型 / 钱包', exact: true }).inputValue(), initialType);
    });
    await check('platform and status filters are about platform cells rather than global fee status', async () => {
      const platform = page.getByRole('combobox', { name: '平台', exact: true }); const status = page.getByRole('combobox', { name: '平台状态', exact: true });
      await platform.selectOption({ label: 'PLATFORM_B(AR)' });
      const options = await status.locator('option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, label: node.textContent })));
      const open = options.find(option => option.value === 'good'); assert(open, 'Enabled platform status option exists'); await status.selectOption(open.value);
      assert.equal(await rowCount(), 3, 'Only rows with selected platform enabled'); assert.equal(await page.locator('[data-cell="A3"]').count(), 0, 'Globally enabled provider but 未接入 on selected platform is excluded');
      assert.equal(await page.locator('[data-cell="A4"]').count(), 1, 'Selected platform enabled even when collect status is 备用');
      await page.getByRole('button', { name: sheets[0].title, exact: true }).click(); await ready();
    });
    await check('sheet switching aborts pending request and ignores late result', async () => {
      await mount(profiles.all, { holdGrid: true }); const old = await pending('/api/original-rate-sheet?sheetId=277747449'); await page.getByRole('button', { name: sheets[1].title, exact: true }).click(); const next = await pending('/api/original-rate-sheet?sheetId=202');
      assert.equal((await calls()).find(call => call.id === old).aborted, true); await deliver(next, grids[202]); await ready(202); await deliver(old, grids[277747449]); assert.equal(await page.locator('.tidy-rate-scroll').getAttribute('data-sheet-id'), '202');
    });
    await check('refresh keeps current sheet and never reads grid before successful metadata', async () => {
      await mount(); await ready(); await page.getByRole('button', { name: sheets[1].title, exact: true }).click(); await ready(202);
      await page.evaluate(() => { window.options = { holdMeta: true, holdGrid: true }; }); const before = (await calls()).length; await page.getByRole('button', { name: '刷新', exact: true }).click(); const first = await pending('/api/original-rate-sheet'); await tick(page);
      assert.equal(await page.locator('[data-cell]').count(), 0); assert.equal((await calls()).slice(before).filter(call => call.url.includes('?sheetId=')).length, 0); assert(await page.getByRole('button', { name: '刷新', exact: true }).isDisabled());
      await deliver(first, { message: '离线元数据错误' }, 503); await page.getByRole('alert').waitFor(); assert.equal(await page.locator('[data-cell]').count(), 0); await page.getByRole('button', { name: '重试', exact: true }).click(); const retry = await pending('/api/original-rate-sheet'); await deliver(retry, meta);
      const next = await pending('/api/original-rate-sheet?sheetId=202'); await deliver(next, grids[202]); await ready(202); assert.equal((await calls()).slice(before).filter(call => call.url.includes('?sheetId=')).length, 1);
    });
    await check('account identity change aborts and ignores earlier account response', async () => {
      await mount(profiles.all, { holdGrid: true }); const old = await pending('/api/original-rate-sheet?sheetId=277747449');
      await mount({ ...profiles.all, auth_user_id: 'synthetic-other', updated_at: 'next' }, { holdGrid: true }, false); const next = await pending('/api/original-rate-sheet?sheetId=277747449'); assert.notEqual(old, next); assert.equal((await calls()).find(call => call.id === old).aborted, true);
      const other = structuredClone(grids[277747449]); other.cells[2][0] = { text: '新账号三方' }; await deliver(next, other); await ready(); await deliver(old, grids[277747449]); assert.equal(await page.locator('[data-cell="A3"]').textContent(), '新账号三方');
    });
    await check('metadata unavailable offers the existing authorized rates page without raw stale content', async () => {
      const before = (await calls()).length; await mount(profiles.all, { holdMeta: true }); const request = await pending('/api/original-rate-sheet'); await deliver(request, { message: '离线模拟快照暂不可用' }, 503); await page.getByRole('alert').waitFor();
      await page.getByRole('button', { name: '查看现有费率', exact: true }).click(); await tick(page); assert.equal(await page.locator('.original-rates-workspace,[data-cell]').count(), 0); assert.equal(await page.locator('.third-party-module').count(), 1);
      const recent = (await calls()).slice(before); assert.equal(recent.filter(call => call.url === '/api/supabase-third-party-rates').length, 1); assert.equal(recent.filter(call => call.url.includes('?sheetId=')).length, 0);
    });
    await check('permission changes unmount source table, abort pending reads, and retain scoped fallback', async () => {
      await mount(profiles.all, { holdGrid: true }); const old = await pending('/api/original-rate-sheet?sheetId=277747449'); const before = (await calls()).filter(call => call.url.startsWith('/api/original-rate-sheet')).length; await mount(profiles.restricted, {}, false);
      assert.equal((await calls()).find(call => call.id === old).aborted, true); assert.equal(await page.locator('.original-rates-workspace,[data-cell]').count(), 0); assert.equal((await calls()).filter(call => call.url.startsWith('/api/original-rate-sheet')).length, before); await deliver(old, grids[277747449]); assert.equal(await page.locator('[data-cell]').count(), 0); assert.equal(await page.locator('.third-party-module').count(), 1);
    });
    await check('source permission failure removes old table and does not reveal stale cells', async () => {
      await mount(); await ready(); await page.evaluate(() => { window.options = { holdGrid: true }; }); await page.getByRole('button', { name: sheets[1].title, exact: true }).click(); const id = await pending('/api/original-rate-sheet?sheetId=202'); await page.evaluate(id => window.rejectCall(id), id); await page.getByRole('alert').waitFor(); assert.equal(await page.locator('[data-cell]').count(), 0); assert.match(await page.getByRole('alert').textContent(), /权限/);
    });
    await check('responsive layout confines horizontal overflow to table only', async () => {
      await mount(); await ready();
      await page.setViewportSize({ width: 1280, height: 900 }); await page.getByRole('button', { name: '精简展示', exact: true }).click(); await tick(page);
      const compact = path.join(output, 'tidy-original-rates-compact.png'); await page.screenshot({ path: compact, fullPage: true }); screenshots.push(compact);
      await page.getByRole('button', { name: '定位平台区', exact: true }).click(); await tick(page); const platforms = path.join(output, 'tidy-original-rates-platforms.png'); await page.screenshot({ path: platforms, fullPage: true }); screenshots.push(platforms); await page.getByRole('button', { name: '定位费率区', exact: true }).click();
      for (const width of [1280, 768, 390]) {
        await page.setViewportSize({ width, height: 900 }); await tick(page); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page overflow at width ' + width);
        for (const name of ['精简展示', '原表全部列']) { await page.getByRole('button', { name, exact: true }).click(); await tick(page); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' page overflow at ' + width); }
        const frozenWidth = Number(await page.locator('.tidy-rate-scroll').getAttribute('data-frozen-width')); assert(width < 600 ? frozenWidth < 250 : frozenWidth > 250, 'Frozen columns adapt to viewport width ' + width + ': ' + frozenWidth);
        const file = path.join(output, `tidy-original-rates-${width}.png`); await page.screenshot({ path: file, fullPage: true }); screenshots.push(file);
      }
    });
    await check('no storage, external request, popup, runtime error, or source mutation', async () => { assert.equal(await page.evaluate(() => window.storageReads), 0); assert.equal(await page.evaluate(() => window.sideEffects), 0); assert.deepEqual(errors, []); assert.deepEqual(network, []); assert.deepEqual(await page.evaluate(() => window.fixture), { meta, grids }); });
    const report = { passed: checks.every(check => check.passed), actualReact: true, syntheticOnly: true, externalRequests: network.length, pageErrors: errors, checks, screenshots };
    fs.writeFileSync(path.join(output, 'tidy-original-rates-verification.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1;
  } finally { await context.close(); await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
