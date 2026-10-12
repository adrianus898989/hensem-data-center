/* Unified source channel browsing: real module, bounded in-memory transport only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../admin-preview/live-channel-status.js'), 'utf8');
const NOW = '2026-10-12T05:00:00.000Z';
const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 120; i++) await Promise.resolve(); };
const platform = (number, extra = {}) => ({
  id: String(number).padStart(8, '0') + '-1111-4111-8111-111111111111',
  source: 'ar', name: 'AR ' + number, country: '印度', timezone: 'Asia/Kolkata',
  capabilities: { channelStatusAvailable: true, channelStatusSource: 'ar_middle' }, ...extra,
});
const channel = (id, extra = {}) => ({
  channel_id: id, sys_channel_id: 'sys-' + id, channel_name: 'Display ' + id,
  provider: 'PayOne', category_id: 'upi', category_name: 'UPI',
  channel_categories: [{ category_id: 'upi', category_name: 'UPI', sort: 0 }],
  source_position: 0, source_state: '1', source_channel_state: '1', source_merchant_state: '1',
  enabled: true, is_present: true, status_text: '开启',
  min_amount: '0', max_amount: '50000', limit_currency: 'INR',
  weight: '100', real_time_weight: '100', success_rate_15m: '50', success_rate_30m: '60',
  success_rate_1h: '70', success_rate_24h: '80', observed_at: NOW,
  third_pay_merchant_id: 'private-merchant', source_channel_name: 'Private native name', ...extra,
});
function response(targets, rowsFor = () => [channel('same')]) {
  return {
    version: 1, queriedAt: NOW, platforms: targets,
    snapshots: targets.flatMap(p => ['charge', 'withdraw'].map(direction => ({
      platformId: p.id, direction,
      ...(p.source === 'ar' ? { source: 'ar_middle', sourceTenantId: 'tenant-' + p.id } : {}),
      ...(direction === 'charge' && p.source === 'ar' ? { sourceRowIdentity: 'category_channel' } : {}),
      observedAt: NOW, receivedAt: NOW, complete: true,
      sourceCount: rowsFor(p, direction).filter(r => r.is_present !== false).length,
      channels: rowsFor(p, direction),
    }))),
  };
}
function fixture(options = {}) {
  let page = 'channel_status', clock = Date.parse(NOW), catalog = options.catalog || [platform(1)];
  let permissions = new Set(options.permissions || ['view', 'query', 'detail', 'export']);
  let handler = options.handler || (q => response(catalog.filter(p => q.platformIds.includes(p.id)), options.rowsFor));
  const calls = [], paints = [], timers = [], events = {}, rootEvents = {};
  const context = {
    console, Intl, Promise,
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [clock])); } static now() { return clock; } },
    document: { visibilityState: 'visible', addEventListener: (name, fn) => events[name] = fn },
    addEventListener: (name, fn) => rootEvents[name] = fn,
    setTimeout: (fn, ms) => { const timer = { fn, due: clock + ms, active: true }; timers.push(timer); return timer; },
    clearTimeout: timer => { if (timer) timer.active = false; },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  const L = { catalogReady: true, dirty: true, pageQueried: false, country: options.country || '印度' };
  const mod = context.HensemLiveChannelStatus.create({
    L, getPage: () => page, catalog: () => catalog,
    roleAllowed: action => permissions.has(action),
    request: q => { calls.push(plain(q)); return handler(q); },
    render: () => paints.push(mod.render()),
  });
  return {
    context, L, mod, calls, paints,
    start: async () => { mod.render(); await flush(); },
    setHandler: value => handler = value, setPage: value => page = value,
    setCatalog: value => catalog = value, setPermissions: value => permissions = new Set(value),
    hide: () => { context.document.visibilityState = 'hidden'; events.visibilitychange(); },
    show: async () => { context.document.visibilityState = 'visible'; events.visibilitychange(); await flush(); },
    unload: () => rootEvents.pagehide(),
    advance: async ms => {
      clock += ms;
      for (const timer of [...timers]) if (timer.active && timer.due <= clock) { timer.active = false; timer.fn(); }
      await flush();
    },
  };
}
function groups(html) {
  return new Map([...html.matchAll(/<article\b[^>]*data-platform-id="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)].map(m => [m[1], m[2]]));
}
function tableRows(html) {
  const heading = html.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/)?.[1] || '';
  const names = [...heading.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(m => m[1].replace(/<[^>]+>/g, ''));
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || '';
  return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m => {
    const cells = [...m[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/g)].map(c => c[1].replace(/<[^>]+>/g, ''));
    assert.equal(cells.length, names.length);
    return Object.fromEntries(names.map((name, index) => [name, cells[index]]));
  });
}
function selectPlatforms(h, catalog, selected) {
  for (const p of catalog) h.context.liveChannelBrowsePlatform(p.id, selected.some(item => item.id === p.id));
  h.context.liveChannelBrowseApplyPlatforms();
}
function exported(h) {
  const rows = plain(h.mod.exportRows()), header = rows[3] || [];
  for (const row of rows.slice(4)) assert.equal(row.length, header.length);
  return rows.slice(4).map(row => Object.fromEntries(header.map((name, index) => [name, row[index]])));
}

test('unified browser defaults to all platforms in the current country and system only', async () => {
  const first = platform(1), second = platform(2);
  const abroad = platform(3, { country: '巴西', timezone: 'America/Sao_Paulo' });
  const yash = platform(4, { source: 'kb', name: 'YASH', capabilities: { channelStatusAvailable: true } });
  const h = fixture({ catalog: [first, second, abroad, yash] });
  await h.start();
  const saved = h.mod.capture();
  assert.equal(saved.mode, 'browse');
  assert.equal(saved.source, 'AR');
  assert.equal(saved.country, '印度');
  assert.deepEqual(plain(saved.browse.platformIds), []);
  assert.deepEqual(h.calls, [{ action: 'channelStatus', platformIds: [first.id, second.id], direction: 'all' }]);
  assert.deepEqual([...groups(h.mod.render()).keys()], [first.id, second.id]);
  for (const group of groups(h.mod.render()).values()) {
    const row = tableRows(group)[0];
    assert.equal(row['支付供应商'], 'PayOne');
    assert.equal(row['系统通道 ID'], 'sys-same');
    assert.equal(row['第三方商户 ID'], 'private-merchant');
    assert.equal(row['预设权重占比'], '100.00%');
  }
});

test('platform search only narrows options and platform multiselect applies without redundant reads', async () => {
  const catalog = [platform(1), platform(2), platform(3)], h = fixture({ catalog });
  await h.start();
  h.context.liveChannelBrowseSearch('platform', 'AR 2');
  await flush();
  assert.deepEqual([...groups(h.mod.render()).keys()], catalog.map(p => p.id));
  assert.deepEqual(plain(h.mod.capture().browse.platformIds), []);
  assert.equal(h.calls.length, 1);
  h.context.liveChannelBrowsePlatform(catalog[0].id, false);
  h.context.liveChannelBrowsePlatform(catalog[2].id, false);
  assert.deepEqual([...groups(h.mod.render()).keys()], catalog.map(p => p.id));
  h.context.liveChannelBrowseApplyPlatforms();
  await flush();
  assert.deepEqual(plain(h.mod.capture().browse.platformIds), [catalog[1].id]);
  assert.deepEqual([...groups(h.mod.render()).keys()], [catalog[1].id]);
  assert.equal(h.calls.length, 1);
  h.context.liveChannelBrowsePlatform(catalog[2].id, true);
  h.context.liveChannelBrowseApplyPlatforms();
  await flush();
  assert.deepEqual([...groups(h.mod.render()).keys()], [catalog[1].id, catalog[2].id]);
  assert.equal(h.calls.length, 1);
  h.context.liveChannelBrowseAllPlatforms();
  h.context.liveChannelBrowseApplyPlatforms();
  await flush();
  assert.deepEqual([...groups(h.mod.render()).keys()], catalog.map(p => p.id));
  assert.equal(h.calls.length, 1);
});

test('an empty explicit platform draft never silently expands the selected scope', async () => {
  const first = platform(1), second = platform(2), h = fixture({ catalog: [first, second] });
  await h.start();
  selectPlatforms(h, [first, second], [first]);
  await flush();
  h.context.liveChannelBrowsePlatform(first.id, false);
  h.context.liveChannelBrowseApplyPlatforms();
  await flush();
  assert.deepEqual(plain(h.mod.capture().browse.platformIds), [first.id]);
  assert.deepEqual([...groups(h.mod.render()).keys()], [first.id]);
  assert.equal(h.calls.length, 1);
});

test('payment providers are exact multi-select values, not fuzzy display-name matches', async () => {
  const rows = [
    channel('exact', { provider: 'WPayINR' }),
    channel('prefix', { provider: 'WPayINR Plus', source_position: 1 }),
    channel('other', { provider: 'OtherPay', channel_name: 'WPayINR', source_position: 2 }),
    channel('case', { provider: 'wpayinr', source_position: 3 }),
  ];
  const p = platform(1), h = fixture({ rowsFor: () => rows });
  await h.start();
  const ids = () => tableRows(groups(h.mod.render()).get(p.id)).map(row => row['通道 ID']);
  assert.deepEqual(ids(), ['exact', 'prefix', 'other', 'case']);
  h.context.liveChannelBrowseSearch('provider', 'wPay');
  assert.deepEqual(ids(), ['exact', 'prefix', 'other', 'case']);
  h.context.liveChannelBrowseProvider('WPayINR');
  assert.deepEqual(ids(), ['exact']);
  h.context.liveChannelBrowseProvider('OtherPay');
  assert.deepEqual(ids(), ['exact', 'other']);
  h.context.liveChannelBrowseProvider('WPayINR');
  assert.deepEqual(ids(), ['other']);
  h.context.liveChannelBrowseAllProviders();
  assert.deepEqual(ids(), ['exact', 'prefix', 'other', 'case']);
  h.context.liveChannelBrowseProvider('Not a catalog provider');
  assert.deepEqual(ids(), ['exact', 'prefix', 'other', 'case']);
  await flush();
  assert.equal(h.calls.length, 1);
});

test('provider filtering retains independent platform/category row identities and weight denominators', async () => {
  const first = platform(1), second = platform(2);
  const rowsFor = p => p.id === first.id ? [
    channel('shared', { provider: 'PayOne', weight: '100', real_time_weight: '25' }),
    channel('shared', { provider: 'PayOne', category_id: 'qr', category_name: 'QR', channel_categories: [{ category_id: 'qr', category_name: 'QR', sort: 1 }], weight: '100', real_time_weight: '25', source_position: 1 }),
    channel('other', { provider: 'PayTwo', weight: '200', real_time_weight: '50', source_position: 2 }),
  ] : [channel('shared', { provider: 'PayOne', weight: '100', real_time_weight: '100' })];
  // Withdrawals have channel-only identities, unlike native recharge category/channel rows.
  const h = fixture({ catalog: [first, second], rowsFor: (p, direction) => direction === 'charge' ? rowsFor(p) : [channel('shared')] });
  await h.start();
  h.context.liveChannelBrowseProvider('PayOne');
  const result = groups(h.mod.render()), firstRows = tableRows(result.get(first.id)), secondRows = tableRows(result.get(second.id));
  assert.equal(firstRows.length, 2);
  assert.deepEqual(firstRows.map(row => [row['通道 ID'], row['充值大类'], row['预设权重占比'], row['实际权重占比']]), [
    ['shared', 'UPI', '25.00%', '25.00%'], ['shared', 'QR', '25.00%', '25.00%'],
  ]);
  assert.deepEqual(secondRows.map(row => [row['通道 ID'], row['预设权重占比']]), [['shared', '100.00%']]);
  assert.match(result.get(first.id), /预设合计 400/);
  assert.match(result.get(second.id), /预设合计 100/);
  assert.equal(h.calls.length, 1);
});

test('direction and local source filters do not reread snapshots or flatten withdrawal fields', async () => {
  const p = platform(1), h = fixture({ rowsFor: (p, direction) => [
    channel('current', { withdrawal_details: { merchant_name: 'Native merchant', merchant_code: 'M-22', today_submit_count: 10, recent_1h_success_count: 4, last_update_by: 'Editor' } }),
    channel('old', { is_present: false, source_position: 1 }),
  ] });
  await h.start();
  h.context.liveChannelBrowseFilter('absent', true);
  assert.equal(tableRows(groups(h.mod.render()).get(p.id)).length, 2);
  h.context.liveChannelBrowseFilter('absent', false);
  h.context.liveChannelBrowseQuery('current', '');
  assert.equal(tableRows(groups(h.mod.render()).get(p.id)).length, 1);
  h.context.liveChannelBrowseClearFilters();
  h.context.liveChannelBrowseTab('withdraw');
  const row = tableRows(groups(h.mod.render()).get(p.id))[0];
  assert.equal(row['成功率统计'], '今日已提交笔数：10近1小时成功笔数：4');
  assert.equal(row['三方商户昵称 / 商户号'], '昵称：Native merchant商户号：M-22');
  assert.equal(row['近10分钟成功率'], undefined);
  assert.match(groups(h.mod.render()).get(p.id), /Asia\/Kolkata/);
  await flush();
  assert.equal(h.calls.length, 1);
});

test('platform requests are sequential and bounded to twenty platforms per batch', async () => {
  const catalog = Array.from({ length: 45 }, (_, index) => platform(index + 1)), pending = [];
  const h = fixture({ catalog, handler: q => new Promise(resolve => pending.push({ q, resolve })) });
  await h.start();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].platformIds, catalog.slice(0, 20).map(p => p.id));
  pending[0].resolve(response(catalog.slice(0, 20)));
  await flush();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].platformIds, catalog.slice(20, 40).map(p => p.id));
  pending[1].resolve(response(catalog.slice(20, 40)));
  await flush();
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.calls[2].platformIds, catalog.slice(40).map(p => p.id));
  pending[2].resolve(response(catalog.slice(40)));
  await flush();
  assert.equal(h.mod.capture().browse.status, 'ready');
  assert.equal(Object.values(h.mod.capture().cache).filter(hit => hit.response).length, 45);
  assert(h.calls.every(q => q.action === 'channelStatus' && q.direction === 'all' && q.platformIds.length <= 20));
});

test('country/system switches reuse current cache without crossing source identity or timezone', async () => {
  const india = platform(1), brazil = platform(2, { country: '巴西', timezone: 'America/Sao_Paulo' });
  const yash = platform(3, { source: 'kb', name: 'YASH', capabilities: { channelStatusAvailable: true } });
  const h = fixture({ catalog: [india, brazil, yash] });
  await h.start();
  h.context.liveChannelBrowseCountry(1);
  await flush();
  assert.deepEqual([...groups(h.mod.render()).keys()], [brazil.id]);
  assert.match(groups(h.mod.render()).get(brazil.id), /America\/Sao_Paulo/);
  assert.match(groups(h.mod.render()).get(brazil.id), /02:00/);
  assert.equal(h.calls.length, 2);
  h.context.liveChannelBrowseCountry(0);
  await flush();
  assert.deepEqual([...groups(h.mod.render()).keys()], [india.id]);
  assert.match(groups(h.mod.render()).get(india.id), /10:30/);
  assert.equal(h.calls.length, 2);
  h.context.liveChannelBrowseSource(1);
  await flush();
  assert.deepEqual([...groups(h.mod.render()).keys()], [yash.id]);
  assert.equal(h.calls.length, 3);
  assert.match(groups(h.mod.render()).get(yash.id), /近4小时成功率/);
  h.context.liveChannelBrowseSource(0);
  await flush();
  assert.deepEqual([...groups(h.mod.render()).keys()], [india.id]);
  assert.equal(h.calls.length, 3);
});

test('explicit refresh rereads only selected platforms and failed refresh preserves its own last snapshot', async () => {
  const first = platform(1), second = platform(2), h = fixture({ catalog: [first, second] });
  await h.start();
  selectPlatforms(h, [first, second], [second]);
  await flush();
  assert.equal(h.calls.length, 1);
  h.setHandler(() => { throw Error('fixture transport unavailable'); });
  await h.context.liveChannelBrowseRefresh();
  await flush();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].platformIds, [second.id]);
  assert.equal(tableRows(groups(h.mod.render()).get(second.id)).length, 1);
  assert.match(groups(h.mod.render()).get(second.id), /fixture transport unavailable/);
  assert.equal(h.mod.capture().cache[first.id].error, '');
});

test('role revocation while a batch is pending discards the response and stops following batches', async () => {
  const catalog = Array.from({ length: 21 }, (_, index) => platform(index + 1));
  let release;
  const h = fixture({ catalog, handler: () => new Promise(resolve => release = resolve) });
  await h.start();
  h.setPermissions(['view']);
  release(response(catalog.slice(0, 20)));
  await flush();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(plain(h.mod.capture().cache), {});
  assert.equal(groups(h.mod.render()).size, 0);
  assert.doesNotMatch(h.mod.render(), /private-merchant|Private native name/);
});

test('navigation away ignores late data and never starts the next platform batch', async () => {
  const catalog = Array.from({ length: 21 }, (_, index) => platform(index + 1));
  let release;
  const h = fixture({ catalog, handler: () => new Promise(resolve => release = resolve) });
  await h.start();
  h.setPage('overview');
  assert.equal(h.mod.render(), '');
  release(response(catalog.slice(0, 20)));
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(Object.values(h.mod.capture().cache).filter(hit => hit.response).length, 0);
});

test('a selected platform removed from the authorized directory never expands to all platforms', async () => {
  const first = platform(1), second = platform(2), h = fixture({ catalog: [first, second] });
  await h.start();
  selectPlatforms(h, [first, second], [first]);
  await flush();
  h.setCatalog([second]);
  h.mod.render();
  await flush();
  assert.equal(h.mod.capture().browse.scopeEmpty, true);
  assert.equal(groups(h.mod.render()).size, 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.mod.capture().cache[first.id], undefined);
});

test('detail permission remains enforced for every platform and searches cannot expose masked fields', async () => {
  const first = platform(1), second = platform(2), h = fixture({ catalog: [first, second], permissions: ['view', 'query', 'export'] });
  await h.start();
  assert.doesNotMatch(h.mod.render(), /private-merchant|Private native name|第三方商户 ID/);
  h.context.liveChannelBrowseQuery('Private native name', 'private-merchant');
  for (const group of groups(h.mod.render()).values()) assert.equal(tableRows(group).length, 0);
  h.context.liveChannelBrowseClearFilters();
  h.context.liveChannelBrowseTab('withdraw');
  for (const group of groups(h.mod.render()).values()) {
    const row = tableRows(group)[0];
    assert.equal(row['三方商户昵称 / 商户号'], '未获明细权限');
    assert.equal(row['成功率统计'], '未获明细权限');
  }
  assert.equal(h.calls.length, 1);
});

test('capture/restore retains local multiselection without an immediate repeat request', async () => {
  const first = platform(1), second = platform(2), h = fixture({ catalog: [first, second] });
  await h.start();
  selectPlatforms(h, [first, second], [second]);
  await flush();
  h.context.liveChannelBrowseProvider('PayOne');
  const saved = h.mod.capture();
  h.mod.clear();
  h.mod.restore(saved);
  h.mod.render();
  await flush();
  assert.deepEqual(plain(h.mod.capture().browse.platformIds), [second.id]);
  assert.deepEqual(plain(h.mod.capture().browse.providers), ['PayOne']);
  assert.deepEqual([...groups(h.mod.render()).keys()], [second.id]);
  assert.equal(h.calls.length, 1);
});

test('a response from the previous country cannot replace the newly selected scope', async () => {
  const india = platform(1), brazil = platform(2, { country: '巴西', timezone: 'America/Sao_Paulo' });
  const pending = [], h = fixture({ catalog: [india, brazil], handler: q => new Promise(resolve => pending.push({ q, resolve })) });
  await h.start();
  h.context.liveChannelBrowseCountry(1);
  await flush();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].platformIds, [brazil.id]);
  pending[0].resolve(response([india], () => [channel('late-india')]));
  await flush();
  assert.equal(h.mod.capture().country, '巴西');
  assert.doesNotMatch(h.mod.render(), /late-india/);
  pending[1].resolve(response([brazil], () => [channel('current-brazil')]));
  await flush();
  assert.deepEqual([...groups(h.mod.render()).keys()], [brazil.id]);
  assert.equal(tableRows(groups(h.mod.render()).get(brazil.id))[0]['通道 ID'], 'current-brazil');
  assert.equal(h.mod.capture().browse.status, 'ready');
});

test('a malformed source refresh is rejected without replacing a previously validated platform', async () => {
  const p = platform(1), h = fixture();
  await h.start();
  const before = plain(h.mod.capture().cache[p.id].response);
  h.setHandler(() => {
    const data = response([p], () => [channel('wrong-source')]);
    data.snapshots[0].source = 'yash';
    return data;
  });
  await h.context.liveChannelBrowseRefresh();
  await flush();
  assert.deepEqual(plain(h.mod.capture().cache[p.id].response), before);
  assert.match(h.mod.render(), /通道快照来源不匹配/);
  assert.doesNotMatch(h.mod.render(), /wrong-source/);
  assert.equal(tableRows(groups(h.mod.render()).get(p.id))[0]['通道 ID'], 'same');
});

test('view-only roles make no backend calls and cannot activate selection or refresh reads', async () => {
  const h = fixture({ permissions: ['view'] });
  await h.start();
  h.context.liveChannelBrowseAllPlatforms();
  h.context.liveChannelBrowseApplyPlatforms();
  h.context.liveChannelBrowseRefresh();
  await flush();
  assert.equal(h.calls.length, 0);
  assert.equal(groups(h.mod.render()).size, 0);
  assert.deepEqual(plain(h.mod.capture().cache), {});
});

test('directory removal of the current all-platform country does not auto-query a different country', async () => {
  const india = platform(1), brazil = platform(2, { country: '巴西', timezone: 'America/Sao_Paulo' });
  const h = fixture({ catalog: [india, brazil] });
  await h.start();
  assert.deepEqual(plain(h.mod.capture().browse.platformIds), []);
  h.setCatalog([brazil]);
  h.mod.render();
  await flush();
  assert.equal(h.calls.length, 1, 'Passive authorization changes must not query a replacement country');
  assert.equal(h.mod.capture().browse.scopeEmpty, true);
  assert.equal(groups(h.mod.render()).size, 0);
});

test('directory removal of the current all-platform system does not auto-query a replacement system', async () => {
  const ar = platform(1), yash = platform(2, { source: 'kb', name: 'YASH', capabilities: { channelStatusAvailable: true } });
  const h = fixture({ catalog: [ar, yash] });
  await h.start();
  h.setCatalog([yash]);
  h.mod.render();
  await flush();
  assert.equal(h.calls.length, 1, 'Passive authorization changes must not query a replacement source');
  assert.equal(h.mod.capture().browse.scopeEmpty, true);
  assert.equal(groups(h.mod.render()).size, 0);
});

test('platform checkbox drafts survive rerenders and refreshes until explicitly applied', async () => {
  const catalog = [platform(1), platform(2), platform(3)], h = fixture({ catalog });
  await h.start();
  h.context.liveChannelBrowsePlatform(catalog[1].id, false);
  h.context.liveChannelBrowseSearch('platform', 'AR 3');
  const draft = plain(h.mod.capture().browse.draftPlatformIds);
  assert.deepEqual(draft, [catalog[0].id, catalog[2].id]);
  h.mod.render();
  await h.context.liveChannelBrowseRefresh();
  await flush();
  assert.deepEqual(plain(h.mod.capture().browse.draftPlatformIds), draft);
  assert.equal(h.mod.capture().browse.draftAll, false);
  assert.equal(h.mod.capture().browse.platformSearch, 'AR 3');
  assert.deepEqual([...groups(h.mod.render()).keys()], catalog.map(p => p.id));
  h.context.liveChannelBrowseApplyPlatforms();
  await flush();
  assert.deepEqual([...groups(h.mod.render()).keys()], draft);
  assert.equal(h.calls.length, 2);
});

test('a selected provider absent after refresh stays selected instead of revealing other providers', async () => {
  const p = platform(1), h = fixture({ rowsFor: () => [channel('selected'), channel('other', { provider: 'PayTwo', source_position: 1 })] });
  await h.start();
  h.context.liveChannelBrowseProvider('PayOne');
  h.setHandler(() => response([p], () => [channel('other', { provider: 'PayTwo' })]));
  await h.context.liveChannelBrowseRefresh();
  await flush();
  assert.deepEqual(plain(h.mod.capture().browse.providers), ['PayOne']);
  assert.equal(tableRows(groups(h.mod.render()).get(p.id)).length, 0);
  assert.match(h.mod.render(), /aria-pressed="true"[^>]*liveChannelBrowseProvider\(.*?PayOne/);
  assert.equal(h.calls.length, 2);
});

test('platform/provider Chinese IME input waits for composition end and preserves focused input selection', async () => {
  const h = fixture();
  await h.start();
  for (const kind of ['platform', 'provider']) {
    const focus = [], ranges = [], selectors = [];
    h.context.document.activeElement = { selectionStart: 2, selectionEnd: 2 };
    h.context.document.querySelector = selector => {
      selectors.push(selector);
      return { focus: () => focus.push(true), setSelectionRange: (start, end) => ranges.push([start, end]) };
    };
    const before = h.paints.length;
    h.context.liveChannelBrowseSearch(kind, '印', true);
    assert.equal(h.paints.length, before);
    assert.equal(h.mod.capture().browse[kind + 'Search'], '印');
    h.context.liveChannelBrowseSearch(kind, '印度', false);
    assert.equal(h.paints.length, before + 1);
    assert.deepEqual(focus, [true]);
    assert.deepEqual(ranges, [[2, 2]]);
    assert.deepEqual(selectors, ['.channel-browse-view input[name="' + kind + '"]']);
  }
  assert.equal(h.calls.length, 1);
});

test('five-minute automatic refresh stays limited to the applied platform scope and pauses while hidden', async () => {
  const first = platform(1), second = platform(2), h = fixture({ catalog: [first, second] });
  await h.start();
  selectPlatforms(h, [first, second], [second]);
  await flush();
  await h.advance(299999);
  assert.equal(h.calls.length, 1);
  await h.advance(1);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].platformIds, [second.id]);
  h.hide();
  await h.advance(300000);
  assert.equal(h.calls.length, 2);
  await h.show();
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.calls[2].platformIds, [second.id]);
});

test('clearing platform selection only clears the draft, then selecting one applies exactly that platform', async () => {
  const catalog = [platform(1), platform(2), platform(3)], h = fixture({ catalog });
  await h.start();
  h.context.liveChannelBrowseClearPlatforms();
  assert.equal(h.mod.capture().browse.draftAll, false);
  assert.deepEqual(plain(h.mod.capture().browse.draftPlatformIds), []);
  h.context.liveChannelBrowseApplyPlatforms();
  await flush();
  assert.deepEqual([...groups(h.mod.render()).keys()], catalog.map(p => p.id));
  assert.equal(h.calls.length, 1);
  h.context.liveChannelBrowsePlatform(catalog[1].id, true);
  h.context.liveChannelBrowseApplyPlatforms();
  await flush();
  assert.deepEqual([...groups(h.mod.render()).keys()], [catalog[1].id]);
  assert.deepEqual(plain(h.mod.capture().browse.platformIds), [catalog[1].id]);
  assert.equal(h.calls.length, 1);
});

test('unified export keeps current provider selection and each platform weight denominator without deduping equal channel IDs', async () => {
  const first = platform(1), second = platform(2), h = fixture({ catalog: [first, second], rowsFor: p => p.id === first.id ? [
    channel('shared', { weight: '100' }), channel('other', { provider: 'PayTwo', weight: '300', source_position: 1 }),
  ] : [channel('shared', { weight: '100' })] });
  await h.start();
  h.context.liveChannelBrowseProvider('PayOne');
  assert.equal(h.mod.canExport(), true);
  assert.deepEqual(exported(h).map(row => [row['平台'], row['通道 ID'], row['支付供应商'], row['预设权重占比']]), [
    [first.name, 'shared', 'PayOne', '25.00%'], [second.name, 'shared', 'PayOne', '100.00%'],
  ]);
  assert.match(h.mod.exportRows()[2][1], /2 个所选平台.*PayOne/);
  assert.equal(h.calls.length, 1);
  h.setPermissions(['view', 'query', 'detail']);
  assert.equal(h.mod.canExport(), false);
  assert.deepEqual(plain(h.mod.exportRows()), []);
});

test('multi-platform CSV cannot bypass the detail permission used by source fields on screen', async () => {
  const first = platform(1), second = platform(2), h = fixture({
    catalog: [first, second], permissions: ['view', 'query', 'export'],
    rowsFor: () => [channel('public-channel', { source_channel_name: 'PRIVATE-NATIVE', third_pay_merchant_id: 'PRIVATE-MERCHANT', notes: 'PRIVATE-NOTE' })],
  });
  await h.start();
  assert.equal(h.mod.canExport(), true);
  const rows = exported(h);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row['源通道名称'], '—');
    assert.equal(row['第三方商户 ID'], '—');
    assert.equal(row['备注'], '—');
    assert.equal(row['通道 ID'], 'public-channel');
    assert.equal(row['支付供应商'], 'PayOne');
  }
  assert.doesNotMatch(JSON.stringify(h.mod.exportRows()), /PRIVATE-NATIVE|PRIVATE-MERCHANT|PRIVATE-NOTE/);
});

test('asynchronous platform batches never repaint an active Chinese composition before composition end', async () => {
  const catalog = Array.from({ length: 21 }, (_, index) => platform(index + 1)), pending = [];
  const h = fixture({ catalog, handler: q => new Promise(resolve => pending.push({ q, resolve })) });
  await h.start();
  h.context.liveChannelBrowseSearch('provider', '支付', true);
  const before = h.paints.length;
  pending[0].resolve(response(catalog.slice(0, 20)));
  await flush();
  assert.equal(h.calls.length, 2);
  assert.equal(h.paints.length, before);
  pending[1].resolve(response(catalog.slice(20)));
  await flush();
  assert.equal(h.paints.length, before);
  assert.equal(h.mod.capture().browse.status, 'ready');
  h.context.liveChannelBrowseSearch('provider', '支付三方', false);
  assert.equal(h.paints.length, before + 1);
  assert.equal(h.mod.capture().browse.providerSearch, '支付三方');
});

test('five-minute background refresh preserves active composition but permission revocation does not defer clearing', async () => {
  const h = fixture();
  await h.start();
  h.context.liveChannelBrowseSearch('platform', '印', true);
  const before = h.paints.length;
  await h.advance(300000);
  assert.equal(h.calls.length, 2);
  assert.equal(h.paints.length, before);
  h.context.liveChannelBrowseSearch('platform', '印度', false);
  assert.equal(h.paints.length, before + 1);
  let release;
  h.setHandler(() => new Promise(resolve => release = resolve));
  h.context.liveChannelBrowseRefresh();
  await flush();
  h.context.liveChannelBrowseSearch('provider', '支', true);
  const painted = h.paints.length;
  h.setPermissions(['view']);
  release(response([platform(1)]));
  await flush();
  assert(h.paints.length > painted, 'Security clearing must not wait for input composition');
  assert.deepEqual(plain(h.mod.capture().cache), {});
  assert.doesNotMatch(h.paints.at(-1), /private-merchant|Private native name/);
});

test('complete empty, incomplete, failed and unsupported platform snapshots remain distinct', async () => {
  const empty = platform(1), incomplete = platform(2), unsupported = platform(3, { capabilities: { channelStatusAvailable: false } });
  const h = fixture({ catalog: [empty, incomplete, unsupported], handler: q => {
    const data = response([empty, incomplete], () => []);
    for (const snapshot of data.snapshots.filter(s => s.platformId === incomplete.id)) {
      snapshot.observedAt = null;
      snapshot.complete = false;
      snapshot.sourceCount = null;
    }
    return data;
  } });
  await h.start();
  assert.deepEqual(h.calls[0].platformIds, [empty.id, incomplete.id]);
  const result = groups(h.mod.render());
  assert.match(result.get(empty.id), /0 个当前通道.*源通道数 0/);
  assert.match(result.get(empty.id), /已采集，暂无通道/);
  assert.match(result.get(incomplete.id), /尚未收到完整通道快照，不能判定是否有匹配通道/);
  assert.doesNotMatch(result.get(incomplete.id), /0 个当前通道|已采集，暂无通道/);
  assert.match(result.get(unsupported.id), /未接入通道快照/);
  const failed = fixture({ handler: () => { throw Error('upstream temporarily unavailable'); } });
  await failed.start();
  assert.match(failed.mod.render(), /upstream temporarily unavailable/);
  assert.doesNotMatch(failed.mod.render(), /已采集，暂无通道|0 个当前通道/);
});
