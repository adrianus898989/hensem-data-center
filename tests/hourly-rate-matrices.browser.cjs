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
    fixtureCalls: []
  });
  const row = (direction, total, success) => ({
    currency: 'INR', direction, all_count: total, success_count: success, created_success_count: success,
    all_amount: total * 100, success_amount: success * 100, failed_amount: (total - success) * 100,
    failed_count: total - success, pending_count: 0, pending_amount: 0, unknown_count: 0, rejected_count: 0, missing_amount_count: 0
  });
  function result(q) {
    const p = platforms.find(p => p.id === q.platformId);
    if (!p) throw Error('Unknown fixture platform');
    const a = p.id === platforms[0].id;
    const hours = ['charge', 'withdraw'].flatMap(direction => [
      {...row(direction, 5, direction === 'charge' ? (a ? 5 : 3) : 1), hour: 9, provider: '示例三方 A'},
      {...row(direction, 10, direction === 'charge' ? (a ? 2 : 1) : 9), hour: 10, provider: '示例三方 B'}
    ]);
    const summary = ['charge', 'withdraw'].map(d => row(d, 15, hours.filter(r => r.direction === d).reduce((n, r) => n + r.success_count, 0)));
    return {version: 1, platform: p, durationVersion: q.durationVersion, complete: true, hasMore: false, total: 30, offset: 0, rows: [], summary,
      startAt: q.startAt, endAt: q.endAt, successBasis: q.successBasis,
      ...(q.successBasis === 'created' ? {capabilities: {successCohort: 'created_at_current_stored_status', successMetricBasis: 'created', independentSuccessWindow: false}} : {successStartAt: q.successStartAt, successEndAt: q.successEndAt}),
      ...(q.providerHourMatrix ? {providerHourMatrix: true, segment: {kind: 'custom', hourRange: {minHour: 0, maxHour: 24}}} : {}),
      groups: {provider: hours, hourly: hours, provider_hour: hours, amount: hours.map(r => ({...r, bucket: '100'})), amount_range: [], matrix_range: [], daily: [], latency: [], pending_age: [], matrix: []}
    };
  }
  window.hensemLiveRequest = async q => {
    fixtureCalls.push(q);
    if (q.action === 'catalog') return {platforms};
    if (q.action === 'providerOptions') return {providers: ['示例三方 A', '示例三方 B']};
    if (q.action === 'aggregate') return result(q);
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
    const region = page.locator('[data-hourly-rate-region]');
    await region.waitFor({timeout: 5000});
    await region.scrollIntoViewIfNeeded();
    const provider = d => region.locator('[data-band-matrix="' + key + '/' + d + '/provider"]');
    const merchant = d => region.locator('[data-band-matrix="' + key + '/' + d + '/merchant"]');
    const main = page.locator('.analysis-compact > .panel').filter({has: page.locator('.live-pager')}).last();
    const original = await main.locator('tbody').first().innerText();
    await provider('charge').getByText('示例三方 B', {exact: true}).waitFor({timeout: 8000});
    const rows = el => el.locator('th[scope=row]').allTextContents();
    assert.deepEqual(await rows(provider('charge')), ['示例三方 A', '示例三方 B']);
    assert.deepEqual(await provider('charge').locator('tbody .success-provider-type').allTextContents(), ['跑分', '钱包']);
    const beforeMerchant = await rows(merchant('charge'));
    const total = provider('charge').getByRole('button', {name: /总成功率/});
    await total.focus(); await page.keyboard.press('Enter');
    assert.deepEqual(await rows(provider('charge')), ['示例三方 B', '示例三方 A']);
    assert.deepEqual(await rows(merchant('charge')), beforeMerchant);
    assert.equal(await provider('charge').locator('.band-success-slot').count(), 24);
    assert.equal(await provider('charge').locator('tbody td.success-total-rate').first().innerText(), '15.00%');
    const markupOrder = await page.locator('.analysis-compact').evaluate(el => {
      const pager = el.querySelector('.live-pager'), groups = el.querySelectorAll('[data-band-matrix]');
      return groups.length === 2 && !!(pager.compareDocumentPosition(groups[0]) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        !!(groups[0].compareDocumentPosition(groups[1]) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    assert.equal(markupOrder, true);
    assert.equal(await main.locator('tbody').first().innerText(), original);
    const rpcCount = () => page.evaluate(() => fixtureCalls.filter(q => q.providerHourMatrix).length);
    assert.equal(await rpcCount(), 2);
    await region.getByRole('button', {name: '代付', exact: true}).click();
    assert.deepEqual(await rows(provider('withdraw')), ['示例三方 B', '示例三方 A']);
    assert.equal(await main.locator('tbody').first().innerText(), original);
    // The real pager changes only the original table. Use a small size so both pages have a second page.
    await page.evaluate(() => {adminLive.tableSizes['analysis-state'] = 5; livePage(1, 'ref-analysis-state');});
    const shortFirst = await main.locator('tbody').first().innerText();
    await main.getByRole('button', {name: '下一页', exact: true}).click();
    assert.notEqual(await main.locator('tbody').first().innerText(), shortFirst);
    assert.deepEqual(await rows(provider('withdraw')), ['示例三方 B', '示例三方 A']);
    assert.equal(await rpcCount(), 2);
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
      assert.ok(typeOffsets.every(left => left === 'auto'), 'Type cells overlay the first visible hour on narrow viewports: ' + typeOffsets.join(', '));
    }
    if (evidence) {
      await region.getByRole('button', {name: '代收', exact: true}).click();
      await region.locator('.band-success-scroll').evaluateAll(scrolls => {
        for (const el of scrolls) {
          let stickyEnd = el.querySelector('thead th').getBoundingClientRect().right;
          const type = el.querySelector('thead .success-provider-type');
          if (type && getComputedStyle(type).left !== 'auto') stickyEnd = type.getBoundingClientRect().right;
          el.scrollLeft += el.querySelectorAll('.band-success-slot')[9].getBoundingClientRect().left - stickyEnd;
        }
      });
      await region.scrollIntoViewIfNeeded();
      await region.screenshot({path: path.join(evidence, key + '-' + width + '.png')});
    }
    await queryDay('2026-11-10');
    await region.scrollIntoViewIfNeeded();
    await provider('charge').getByText('示例三方 B', {exact: true}).waitFor({timeout: 8000});
    assert.equal(await rpcCount(), 4);
    assert.equal(await page.evaluate(() => new Set(fixtureCalls.filter(q => q.providerHourMatrix).map(q => q.startAt)).size), 2);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    return {key, width, display, matrixRPCsForTwoDateScopes: 4, externalRequests: 0, pageErrors: 0};
  } catch (error) {
    const state = await page.evaluate(() => ({text: document.querySelector('#page')?.innerText.slice(-300), hourly: document.querySelector('[data-hourly-rate-region]')?.innerText.slice(0,1050), failure: window.adminLive?.error,
      calls: window.fixtureCalls?.map(q => [q.action, q.view, q.providerHourMatrix]), warnings: window.adminLive?.queryWarnings}));
    throw Error(error.message + '\n' + JSON.stringify({key, width, errors, state}), {cause: error});
  } finally { await page.close(); }
}

(async () => {
  if (evidence) fs.mkdirSync(evidence, {recursive: true, mode: 0o700});
  const browser = await chromium.launch({channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true});
  try {
    const results = [];
    for (const [key, width] of [['time', 1280], ['amount', 360]]) results.push(await inspect(browser, key, width));
    console.log(JSON.stringify(results, null, 2));
    if (evidence) fs.writeFileSync(path.join(evidence, 'browser-regression.json'), JSON.stringify({source: 'offline-fixture', results}, null, 2), {mode: 0o600});
  } finally { await browser.close(); }
})().catch(err => {console.error(err); process.exitCode = 1;});
