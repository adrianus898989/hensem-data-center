// Exercise the shipped page/controller/data/UI in a real browser. Only the host and RPC are fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.join(__dirname, '..', 'admin-preview');
const manifest = fs.readFileSync(path.join(root, 'build-restoration.py'), 'utf8');
const files = name => Array.from(manifest.match(new RegExp('^' + name + ' = \\[([\\s\\S]*?)\\]', 'm'))[1].matchAll(/'([^']+)'/g), m => m[1]);
const css = ['live-data.css', ...files('styles')].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const js = files('names').map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const evidence = process.env.MATRIX_BROWSER_EVIDENCE;
const platforms = [
  {id: '11111111-1111-4111-8111-111111111111', name: '示例商户 A', sourceName: 'Sample-A', source: 'AR'},
  {id: '22222222-2222-4222-8222-222222222222', name: '示例商户 B', sourceName: 'Sample-B', source: 'AR'}
].map(p => ({...p, currency: 'INR', country: '印度', scopeGroup: 'india', timezone: 'Asia/Kolkata'}));

function fixture({page, platforms}) {
  const keys = ['time', 'amount', 'overview', 'orders', 'matrix', 'providers', 'merchants', 'workorders'];
  Object.assign(window, {
    state: {page, navGroup: 'analysis'}, pages: keys.map(k => [k, '', k, '', k]),
    navGroupsV3: [['analysis', '', '数据分析', keys.slice(0, 6)], ['merchant', '', '商户', keys.slice(6)]],
    render() {}, syncFilters() {}, toggleCenterV3() {}, setPage() {}, headerIconV3: () => '', toast() {}, openDrawer() {},
    groupForV3: key => navGroupsV3.find(g => g[3].includes(key)) || navGroupsV3[0],
    HENSEM_PRODUCTION: true, hensemRoleAllowed: () => true,
    hensemRoleAccess: {mode: 'owner', roleId: 'test-owner', version: 1, canView: true},
    hensemAdminInitialPage: page, hensemAdminPageUrl: key => 'https://fixture.test/#' + key,
    fixtureCalls: [], holdMatrix: false, heldMatrices: []
  });
  const row = (direction, total, success) => ({
    currency: 'INR', direction, all_count: total, success_count: success, created_success_count: success,
    all_amount: total * 100, success_amount: success * 100, failed_amount: (total - success) * 100,
    failed_count: total - success, pending_count: 0, pending_amount: 0, unknown_count: 0, rejected_count: 0, missing_amount_count: 0
  });
  function bucket(amount, edges) {
    if (amount === null) return 'unknown';
    if (amount < edges[0]) return 'below';
    if (amount > edges[10]) return 'above';
    const upper = edges.slice(1).findIndex((edge, i) => i === 9 ? amount <= edge : amount < edge);
    return 'band:' + upper;
  }
  function group(orders, keys) {
    const groups = new Map();
    for (const order of orders) {
      const id = JSON.stringify(keys.map(key => order[key]));
      const current = groups.get(id) || {...Object.fromEntries(keys.map(key => [key, order[key]])), ...row(order.direction, 0, 0)};
      current.all_count++; current.success_count += Number(order.success);
      current.created_success_count = current.success_count;
      current.all_amount += order.amount || 0;
      current.success_amount += order.success ? order.amount || 0 : 0;
      current.failed_count += Number(!order.success);
      current.failed_amount += order.success ? 0 : order.amount || 0;
      current.missing_amount_count += Number(order.amount === null);
      groups.set(id, current);
    }
    return [...groups.values()];
  }
  function result(q) {
    const p = platforms.find(p => p.id === q.platformId);
    if (!p) throw Error('Unknown fixture platform');
    const a = p.id === platforms[0].id;
    const charge = [[99.99, 100, 199.99, 200, 50000], [100, 200, 200, 500, 1000, 5000, 10000, 20000, 50000.01, null]];
    const withdraw = [[200, 200, 200, 200, 200], [99, 100, 199.99, 200, 500, 1000, 20000, 50000, 50000.01, null]];
    const orders = ['charge', 'withdraw'].flatMap(direction => (direction === 'charge' ? charge : withdraw).flatMap((amounts, i) => {
      const success = direction === 'charge' ? (i === 0 ? (a ? 5 : 3) : (a ? 2 : 1)) : (i === 0 ? 1 : 9);
      return amounts.map((amount, index) => ({
        direction, amount, hour: 9 + i, provider: '示例三方 ' + (i === 0 ? 'A' : 'B'), success: index < success,
        ...(q.amountBands ? {bucket: bucket(amount, q.amountBands[direction])} : {})
      }));
    }));
    const summary = group(orders, ['direction']);
    const groups = {provider: group(orders, ['direction','provider']), hourly: group(orders, ['direction','hour']),
      amount: group(orders.map(o => ({...o, bucket: String(o.amount ?? 'unknown')})), ['direction','bucket']),
      ...(q.providerHourMatrix ? {provider_hour: group(orders, ['direction','hour','provider'])} : {}),
      ...(q.amountBands ? {amount_range: group(orders, ['direction','bucket']), matrix_range: group(orders, ['direction','hour','bucket'])} : {}),
      ...(q.providerAmountMatrix ? {provider_amount_range: group(orders, ['direction','bucket','provider'])} : {}),
      daily: [], latency: [], pending_age: [], matrix: []};
    return {version: 1, platform: p, durationVersion: q.durationVersion, complete: true, hasMore: false, total: orders.length, offset: 0, rows: [], summary,
      startAt: q.startAt, endAt: q.endAt, successBasis: q.successBasis,
      ...(q.successBasis === 'created' ? {capabilities: {successCohort: 'created_at_current_stored_status', successMetricBasis: 'created', independentSuccessWindow: false}} : {successStartAt: q.successStartAt, successEndAt: q.successEndAt}),
      ...(q.providerHourMatrix || q.providerAmountMatrix ? {segment: {kind: 'custom', hourRange: {minHour: 0, maxHour: 24}}} : {}),
      ...(q.providerHourMatrix ? {providerHourMatrix: true} : {}),
      ...(q.amountBands ? {amountBandsVersion: 1, amountBands: q.amountBands} : {}),
      ...(q.providerAmountMatrix ? {providerAmountMatrix: true} : {}), groups
    };
  }
  window.hensemLiveRequest = async q => {
    fixtureCalls.push(q);
    if (q.action === 'catalog') return {platforms};
    if (q.action === 'providerOptions') return {providers: ['示例三方 A', '示例三方 B']};
    if (q.action === 'aggregate') {
      if ((q.providerHourMatrix || q.providerAmountMatrix) && window.holdMatrix) await new Promise(resolve => heldMatrices.push(resolve));
      return result(q);
    }
    if (q.action === 'aggregatePrepared') return {version: q.publicationVersion || 1, ...(q.readMode ? {readMode: q.readMode} : {}), items: q.requests.map(r => ({request: r, status: 'ready',
      publication: {id: 'fixture', generation: 1, computedAt: new Date().toISOString(), cutoff: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 540000).toISOString(), freshness: 'fresh', refreshState: 'idle', calculationComplete: true, sourceComplete: false}, result: result(r)}))};
    if (q.action === 'workorders') return {rows: [], total: 0, byProvider: [], byDirection: {}};
    if (q.action === 'rates') return {rows: ['示例三方 A', '示例三方 B'].map((provider, i) => ({
      country: '印度', scopeType: 'country', category: 'UPI', provider, sourceTypeProvider: provider, sourceType: i ? '钱包' : '跑分',
      sheetName: '离线类型样例', sourceTypeCell: 'B' + (i + 2)
    })), total: 2};
    throw Error('Unsupported fixture RPC ' + q.action);
  };
}

async function inspect(browser, key, width) {
  const page = await browser.newPage({viewport: {width, height: 800}, locale: 'zh-CN'});
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  const nodes = ['pageTitle', 'pageSubtitle', 'eyebrow', 'crumbTitle', 'nav', 'filters', 'scope', 'page', 'headerActivityV3'];
  await page.route('**/*', route => {
    if (route.request().url() === 'https://fixture.test/') return route.fulfill({contentType: 'text/html', body:
      '<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body class="live-admin">' +
      '<div class="topbar"><div class="top-right"></div></div><div class="title-actions"></div>' +
      nodes.map(id => '<div id="' + id + '"></div>').join('') + '<div class="bottom-note"></div></body></html>'});
    external.push(route.request().url()); return route.abort();
  });
  try {
    await page.goto('https://fixture.test/');
    await page.addStyleTag({content: css});
    await page.evaluate(fixture, {page: key, platforms});
    await page.addScriptTag({content: js});
    await page.addScriptTag({path: path.join(root, 'live-data.js')});
    await page.waitForFunction(() => window.adminLive?.catalogReady, null, {timeout: 5000});
    const queryDay = async day => {
      await page.evaluate(async date => {
        liveMetricTimeSet('from', date + 'T00:00:00');
        liveMetricTimeSet('to', date + 'T23:59:59');
        liveMetricTimeSet('successFrom', ''); liveMetricTimeSet('successTo', '');
        await liveQuery();
      }, day);
    };
    await queryDay('2026-11-09');
    const compact = page.locator('.analysis-compact');
    const nav = compact.locator(':scope > .section-switcher').first();
    const providerTab = key === 'time' ? 'hourly-provider' : 'amount-provider';
    const merchantTab = key === 'time' ? 'hourly-merchant' : 'amount-merchant';
    const matrixFlag = key === 'time' ? 'providerHourMatrix' : 'providerAmountMatrix';
    const otherFlag = key === 'time' ? 'providerAmountMatrix' : 'providerHourMatrix';
    const tab = view => nav.locator('button').filter({hasText: {
      business: key === 'time' ? '时段金额与状态' : '金额分布与订单状态',
      [providerTab]: key === 'time' ? '三方分时成功率' : '三方分金额段成功率',
      [merchantTab]: key === 'time' ? '商户分时成功率' : '商户分金额段成功率',
      checks: '时段费用与核对', trend: '24 小时订单趋势'
    }[view]});
    const region = compact.locator('[data-hourly-rate-region]');
    const matrix = (kind, direction) => region.locator('[data-band-matrix="' + key + '/' + direction + '/' + kind + '"]');
    const provider = d => matrix('provider', d), merchant = d => matrix('merchant', d);
    const rows = el => el.locator('th[scope=row]').allTextContents();
    const rpcCount = () => page.evaluate(flag => fixtureCalls.filter(q => q[flag]).length, matrixFlag);
    const main = compact.locator(':scope > .panel').filter({has: page.locator('.live-pager')}).last();
    const expectedHours = Array.from({length: 24}, (_, hour) => {
      const h = String(hour).padStart(2, '0');
      return h + ':00–' + h + ':59';
    });
    const edges = ['100', '200', '300', '400', '500', '1,000', '2,000', '5,000', '10,000', '20,000', '50,000'];
    const expectedBands = ['< 100', ...edges.slice(0, -1).map((low, i) =>
      low + ' ≤ 金额 ' + (i === 9 ? '≤' : '<') + ' ' + edges[i + 1]), '> 50,000', '金额缺失'];
    const expectedColumns = key === 'time' ? expectedHours : expectedBands;
    async function assertCounts(table, name, label, success, total) {
      const col = expectedColumns.indexOf(label);
      assert.ok(col >= 0, label);
      const tr = table.locator('tbody tr').filter({has: page.getByRole('rowheader', {name, exact: true})});
      const cell = tr.locator('.success-rate-cell').nth(col);
      assert.equal(await cell.getAttribute('title'), '成功 ' + success + ' 笔 / 创建 ' + total + ' 笔');
      assert.equal(await cell.textContent(), total ? (100 * success / total).toFixed(2) + '%' : '—');
    }
    async function select(view) {
      await tab(view).click();
      assert.equal(await nav.locator('button.on').textContent(), await tab(view).textContent());
      assert.equal(await page.evaluate(() => adminLive.view), view);
    }
    async function inspectActive(kind, direction) {
      assert.equal(await compact.locator('[data-band-matrix]').count(), 1);
      assert.equal(await main.count(), 0);
      const table = matrix(kind, direction);
      assert.deepEqual(await table.locator('thead .band-success-slot').allTextContents(), expectedColumns);
      assert.equal(await table.locator('thead .success-provider-type').count(), kind === 'provider' ? 1 : 0);
      assert.equal(await table.locator('tbody tr').first().locator('th,td').count(), expectedColumns.length + (kind === 'provider' ? 3 : 2));
      return table;
    }
    const navLabels = await nav.locator('button').allTextContents();
    for (const view of key === 'time' ? ['business', 'checks', 'trend', providerTab, merchantTab] :
      ['business', providerTab, merchantTab]) assert.equal(await tab(view).count(), 1, navLabels.join(' / '));
    assert.equal(navLabels.length, key === 'time' ? 5 : 3);
    assert.equal(await nav.evaluate(el => el.previousElementSibling?.classList.contains('live-reference-totals')), true);
    assert.equal(await region.count(), 0);
    const mainRpcCount = () => page.evaluate(() => fixtureCalls.filter(q =>
      (q.action === 'aggregate' && !q.providerHourMatrix && !q.providerAmountMatrix) || q.action === 'aggregatePrepared').length);
    const original = await main.locator('tbody').first().innerText();
    const baseReads = await mainRpcCount();
    assert.equal(await rpcCount(), 0);
    await select(merchantTab);
    await merchant('charge').getByText('示例商户 B', {exact: true}).waitFor();
    await inspectActive('merchant', 'charge');
    assert.deepEqual(await rows(merchant('charge')), ['示例商户 A', '示例商户 B']);
    assert.deepEqual(await merchant('charge').locator('tbody td.success-total-rate').allTextContents(), ['46.67%', '26.67%']);
    if (key === 'amount') {
      await assertCounts(merchant('charge'), '示例商户 A', '100 ≤ 金额 < 200', 3, 3);
      await assertCounts(merchant('charge'), '示例商户 B', '200 ≤ 金额 < 300', 0, 3);
    } else {
      await assertCounts(merchant('charge'), '示例商户 B', '09:00–09:59', 3, 5);
    }
    const merchantSort = merchant('charge').getByRole('button', {name: /总成功率/});
    await merchantSort.click();
    assert.deepEqual(await rows(merchant('charge')), ['示例商户 B', '示例商户 A']);
    await merchantSort.click();
    assert.deepEqual(await rows(merchant('charge')), ['示例商户 A', '示例商户 B']);
    assert.equal(await rpcCount(), 0, 'The main query already returned complete merchant groups');

    // Delay the two source reads across a provider → merchant → provider switch.
    await page.evaluate(() => {window.holdMatrix = true;});
    await select(providerTab);
    await page.waitForFunction(() => heldMatrices.length === 2);
    await select(merchantTab);
    await inspectActive('merchant', 'charge');
    await select(providerTab);
    assert.equal(await rpcCount(), 2);
    await page.evaluate(() => {window.holdMatrix = false; heldMatrices.splice(0).forEach(resolve => resolve());});
    await provider('charge').getByText('示例三方 B', {exact: true}).waitFor({timeout: 8000});
    await inspectActive('provider', 'charge');
    assert.deepEqual(await rows(provider('charge')), ['示例三方 A', '示例三方 B']);
    assert.deepEqual(await provider('charge').locator('tbody .success-provider-type').allTextContents(), ['跑分', '钱包']);
    if (key === 'amount') {
      await assertCounts(provider('charge'), '示例三方 A', '< 100', 2, 2);
      await assertCounts(provider('charge'), '示例三方 A', '100 ≤ 金额 < 200', 4, 4);
      await assertCounts(provider('charge'), '示例三方 A', '20,000 ≤ 金额 ≤ 50,000', 1, 2);
      await assertCounts(provider('charge'), '示例三方 B', '200 ≤ 金额 < 300', 1, 4);
      await assertCounts(provider('charge'), '示例三方 B', '> 50,000', 0, 2);
      await assertCounts(provider('charge'), '示例三方 B', '金额缺失', 0, 2);
    } else {
      await assertCounts(provider('charge'), '示例三方 A', '09:00–09:59', 8, 10);
      await assertCounts(provider('charge'), '示例三方 B', '10:00–10:59', 3, 20);
    }
    const total = provider('charge').getByRole('button', {name: /总成功率/});
    await total.focus(); await page.keyboard.press('Enter');
    assert.deepEqual(await rows(provider('charge')), ['示例三方 B', '示例三方 A']);
    assert.equal(await provider('charge').locator('tbody td.success-total-rate').first().innerText(), '15.00%');
    await total.click();
    assert.deepEqual(await rows(provider('charge')), ['示例三方 A', '示例三方 B']);
    await region.getByRole('button', {name: '代付', exact: true}).click();
    assert.deepEqual(await rows(provider('withdraw')), ['示例三方 B', '示例三方 A']);
    await select(merchantTab);
    assert.deepEqual(await rows(merchant('withdraw')), ['示例商户 A', '示例商户 B']);
    await inspectActive('merchant', 'withdraw');
    if (key === 'amount') await assertCounts(merchant('withdraw'), '示例商户 A', '200 ≤ 金额 < 300', 2, 6);
    assert.equal(await rpcCount(), 2);
    await select('business');
    assert.equal(await region.count(), 0);
    assert.equal(await main.locator('tbody').first().innerText(), original);
    await page.evaluate(() => {adminLive.tableSizes['analysis-state'] = 5; livePage(1, 'ref-analysis-state');});
    const shortFirst = await main.locator('tbody').first().innerText();
    await main.getByRole('button', {name: '下一页', exact: true}).click();
    const second = await main.locator('tbody').first().innerText();
    assert.notEqual(second, shortFirst);
    if (key === 'time') {
      for (const view of ['checks', 'trend']) {
        await select(view);
        assert.equal(await region.count(), 0);
        if (view === 'checks') assert.ok(await compact.getByText('掉单金额', {exact: true}).count());
        if (view === 'trend') assert.ok(await compact.getByRole('heading', {name: /24 小时订单趋势/}).count());
      }
    }
    await select(providerTab);
    const directionButton = region.getByRole('button', {name: '代付', exact: true});
    await directionButton.click();
    assert.deepEqual(await rows(provider('withdraw')), ['示例三方 B', '示例三方 A']);
    assert.equal(await rpcCount(), 2);
    if (key === 'amount') await assertCounts(provider('withdraw'), '示例三方 A', '200 ≤ 金额 < 300', 2, 10);
    const display = await provider('withdraw').locator('[role=region]').evaluate(el => {
      const first = el.querySelector('tbody th'), last = el.querySelector('tbody td:last-child');
      const x = first.getBoundingClientRect().left;
      el.scrollLeft = 480;
      return {width: el.clientWidth, scroll: el.scrollLeft,
        rowPinned: Math.abs(first.getBoundingClientRect().left - x) < 2,
        totalPinned: Math.abs(last.getBoundingClientRect().right - el.getBoundingClientRect().right) < 2};
    });
    assert.ok(display.scroll > 0 && display.rowPinned && display.totalPinned && display.width <= width);
    if (width <= 600) {
      const typeOffsets = await provider('withdraw').evaluate(el => Array.from(
        el.querySelectorAll('.success-provider-type'), cell => getComputedStyle(cell).left
      ));
      assert.ok(typeOffsets.every(left => left === 'auto'), 'Type cells overlay the first visible band on narrow viewports: ' + typeOffsets.join(', '));
    }
    if (evidence) {
      await region.getByRole('button', {name: '代收', exact: true}).click();
      await region.locator('.band-success-scroll').evaluateAll((scrolls, slot) => {
        for (const el of scrolls) {
          let stickyEnd = el.querySelector('thead th').getBoundingClientRect().right;
          const type = el.querySelector('thead .success-provider-type');
          if (type && getComputedStyle(type).left !== 'auto') stickyEnd = type.getBoundingClientRect().right;
          el.scrollLeft += el.querySelectorAll('.band-success-slot')[slot].getBoundingClientRect().left - stickyEnd;
        }
      }, key === 'time' ? 9 : 1);
      await region.scrollIntoViewIfNeeded();
      await region.screenshot({path: path.join(evidence, key + '-' + width + '.png')});
    }
    await select('business');
    assert.equal(await main.locator('tbody').first().innerText(), second);
    assert.equal(await mainRpcCount(), baseReads, 'Tab switches, local pagination, direction and sorting did not rerun the primary query');
    await queryDay('2026-11-10');
    assert.equal(await region.count(), 0);
    assert.equal(await rpcCount(), 2);
    await select(providerTab);
    await provider('charge').getByText('示例三方 B', {exact: true}).waitFor({timeout: 8000});
    assert.equal(await rpcCount(), 4);
    const reads = await page.evaluate(flag => fixtureCalls.filter(q => q[flag]), matrixFlag);
    assert.equal(new Set(reads.map(q => q.startAt)).size, 2);
    assert.equal(await page.evaluate(flag => fixtureCalls.filter(q => q[flag]).length, otherFlag), 0);
    for (const platform of platforms) assert.equal(reads.filter(q => q.platformId === platform.id).length, 2);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    return {key, width, display, matrixRPCsForTwoDateScopes: 4, externalRequests: 0, pageErrors: 0};
  } catch (error) {
    const state = await page.evaluate(() => ({text: document.querySelector('#page')?.innerText.slice(-300), hourly: document.querySelector('[data-hourly-rate-region]')?.innerText.slice(0,1050), failure: window.adminLive?.error,
      calls: window.fixtureCalls?.map(q => [q.action, q.view, q.providerHourMatrix, q.providerAmountMatrix]), warnings: window.adminLive?.queryWarnings}));
    throw Error(error.message + '\n' + JSON.stringify({key, width, errors, state}), {cause: error});
  } finally { await page.close(); }
}

(async () => {
  if (evidence) fs.mkdirSync(evidence, {recursive: true, mode: 0o700});
  const browser = await chromium.launch({channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true});
  try {
    const results = [];
    for (const [key, width] of [['time', 1280], ['amount', 360], ['amount', 1280], ['time', 360]]) results.push(await inspect(browser, key, width));
    console.log(JSON.stringify(results, null, 2));
    if (evidence) fs.writeFileSync(path.join(evidence, 'browser-regression.json'), JSON.stringify({source: 'offline-fixture', results}, null, 2), {mode: 0o600});
  } finally { await browser.close(); }
})().catch(err => {console.error(err); process.exitCode = 1;});
