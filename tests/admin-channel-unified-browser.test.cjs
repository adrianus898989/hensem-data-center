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

// The old automatic all-platform workspace stays retired. Single, explicit grouped
// and cross modes share the authorized full-snapshot transport and cache.
const cross=h=>{h.context.liveChannelMode('cross');};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
const matchedRows=(id='same',extra={})=>[channel(id,{provider:'WPayINR',channel_name:'WPay-QR',...extra})];

test('default fifteen-platform catalog reads only one platform with original buttons and no chips or stacked groups',async()=>{
 const catalog=Array.from({length:15},(_,i)=>platform(i+1)),h=fixture({catalog});await h.start();
 assert.equal(h.mod.capture().version,4);assert.equal(h.mod.capture().mode,'single');assert.deepEqual(h.calls,[{action:'channelStatus',platformIds:[catalog[0].id],direction:'all'}]);
 const html=h.mod.render();assert.match(html,/channel-platforms/);assert.match(html,/liveChannelSelect\(14\)/);assert.match(html,/按平台/);assert.match(html,/按三方/);assert.doesNotMatch(html,/channel-browse-providers|channel-browse-group|channel-cross-group/);assert.equal((html.match(/<tbody>/g)||[]).length,1);
});
test('version3 default all-platform state migrates to one platform without discarding its validated cache',async()=>{
 const catalog=[platform(1),platform(2),platform(3)],h=fixture({catalog});await h.start();const old={...plain(h.mod.capture()),version:3,mode:'browse'};old.browse={...old.browse,platformIds:[],providers:[]};h.mod.clear();h.mod.restore(old);await h.start();
 assert.equal(h.mod.capture().mode,'single');assert.equal(h.mod.capture().version,4);assert.equal(h.mod.capture().platformId,catalog[0].id);assert.equal(h.calls.length,1);assert.equal((h.mod.render().match(/<tbody>/g)||[]).length,1);
});
test('version3 explicit platform/provider drafts migrate to the first still-authorized selected identity',async()=>{
 const catalog=[platform(1),platform(2),platform(3)],h=fixture({catalog});await h.start();h.context.liveChannelSelect(1);await flush();const old={...plain(h.mod.capture()),version:3,mode:'browse',browse:{platformIds:[catalog[1].id,catalog[2].id],providers:['PayOne']}};h.mod.clear();h.mod.restore(old);await h.start();
 const state=h.mod.capture();assert.equal(state.platformId,catalog[1].id);assert.equal(state.provider,'PayOne');assert.equal(state.mode,'single');assert.equal(h.calls.length,2);assert.equal(exported(h)[0]['平台'],catalog[1].name);
});
test('a removed legacy selected identity cannot trigger all-platform reads or resurrect its cache',async()=>{
 const first=platform(1),second=platform(2),h=fixture({catalog:[first,second]});await h.start();const old={...plain(h.mod.capture()),version:3,mode:'browse',browse:{platformIds:[first.id],providers:[]}};h.setCatalog([second]);h.mod.restore(old);await h.start();
 assert.equal(h.mod.capture().mode,'single');assert.equal(h.mod.capture().platformId,second.id);assert.deepEqual(h.calls.at(-1).platformIds,[second.id]);assert(!h.mod.capture().cache[first.id]);
});
test('legacy all-platform handlers cannot activate the retired mode or broaden the default selection',async()=>{
 const h=fixture({catalog:[platform(1),platform(2)]});await h.start();h.context.liveChannelMode('browse');h.context.liveChannelBrowseAllPlatforms();h.context.liveChannelBrowseApplyPlatforms();await flush();assert.equal(h.mod.capture().mode,'single');assert.equal(h.calls.length,1);
});
test('version4 capture/restore retains the single platform and filters without refetch',async()=>{
 const h=fixture();await h.start();h.context.liveChannelProvider('PayOne');h.context.liveChannelCategory('upi');h.context.liveChannelTab('withdraw');h.context.liveChannelAbsent(true);const saved=h.mod.capture();h.mod.clear();h.mod.restore(saved);await h.start();
 assert.equal(h.calls.length,1);assert.equal(h.mod.capture().tab,'withdraw');assert.equal(h.mod.capture().includeAbsent,true);assert.equal(h.mod.capture().platformId,platform(1).id);
});
test('switching to by-provider mode alone reads nothing and shows compact all-country controls',async()=>{
 const h=fixture({catalog:Array.from({length:15},(_,i)=>platform(i+1))});await h.start();cross(h);await flush();const html=h.mod.render();assert.equal(h.calls.length,1);assert.equal(h.mod.capture().cross.country,'');assert.equal(h.mod.capture().cross.source,'');assert.match(html,/全部国家/);assert.match(html,/<datalist id="channel-cross-names">/);assert.match(html,/先选择三方或输入通道名称/);assert.doesNotMatch(html,/channel-browse-providers|channel-cross-group/);
});
test('empty names, partial typing and unknown suggestion changes never start an unrequested full scan',async()=>{
 const h=fixture();cross(h);await h.context.liveChannelCrossQuery('  ');h.context.liveChannelCrossDraft('WPay');h.context.liveChannelCrossChoose('not-a-known-suggestion');await flush();assert.equal(h.calls.length,0);assert.equal(h.mod.capture().cross.query,null);
});
test('selecting a real supplier suggestion queries remaining authorized platforms across all countries',async()=>{
 const first=platform(1),foreign=platform(2,{country:'巴西',timezone:'America/Sao_Paulo'}),h=fixture({catalog:[first,foreign],rowsFor:()=>matchedRows()});await h.start();cross(h);assert.match(h.mod.render(),/<option value="WPayINR">/);await h.context.liveChannelCrossChoose('WPayINR');await flush();assert.deepEqual(h.calls.map(q=>q.platformIds),[[first.id],[foreign.id]]);assert(h.calls.every(q=>!Object.hasOwn(q,'providers')));assert.match(h.mod.render(),/巴西 \/ AR 系统/);
});
test('display-channel search is case/trim compatible and never treats its name as an exact supplier RPC filter',async()=>{
 const a=platform(1),b=platform(2),foreign=platform(3,{country:'巴基斯坦'}),h=fixture({catalog:[a,b,foreign],rowsFor:p=>p.id===b.id?[channel('other',{provider:'Other',channel_name:'Different'})]:matchedRows()});cross(h);await h.context.liveChannelCrossQuery('  WPAY-qr  ');
 assert.deepEqual(h.calls[0].platformIds,[a.id,b.id,foreign.id]);assert(!Object.hasOwn(h.calls[0],'providers'));const html=h.mod.render();assert.match(html,/印度/);assert.match(html,/巴基斯坦/);assert.match(html,/1 个平台当前完整快照无匹配通道/);assert.equal((html.match(/class="channel-cross-country"/g)||[]).length,2);
});
test('switching back restores original platform, direction and all single-platform local filters',async()=>{
 const h=fixture({catalog:[platform(1),platform(2)],rowsFor:()=>matchedRows()});await h.start();h.context.liveChannelSelect(1);await flush();h.context.liveChannelProvider('WPayINR');h.context.liveChannelCategory('upi');h.context.liveChannelCurrency('INR');h.context.liveChannelQuery('WPay','private-merchant');h.context.liveChannelAbsent(true);const saved=plain(h.mod.capture());cross(h);await h.context.liveChannelCrossQuery('WPay');h.context.liveChannelTab('withdraw');h.context.liveChannelCrossAbsent(false);h.context.liveChannelMode('single');await flush();const state=plain(h.mod.capture());for(const key of ['platformId','source','country','tab','provider','category','currency','channelQuery','merchantQuery','includeAbsent'])assert.equal(state[key],saved[key],key);assert.equal(state.singleView,null);
});
test('supplier shortcut preserves the single-platform filters and its raw name without narrowing countries',async()=>{
 const h=fixture({catalog:[platform(1),platform(2,{country:'巴西'})],rowsFor:()=>matchedRows()});await h.start();h.context.liveChannelProvider('WPayINR');await h.context.liveChannelCrossFromProvider();assert.equal(h.mod.capture().mode,'cross');assert.equal(h.mod.capture().cross.draft,'WPayINR');assert.equal(h.mod.capture().cross.country,'');h.context.liveChannelMode('single');assert.equal(h.mod.capture().provider,'WPayINR');
});
test('cross-platform batches are sequential, at most twenty and identical pending requests coalesce',async()=>{
 const catalog=Array.from({length:42},(_,i)=>platform(i+1)),pending=[],h=fixture({catalog,handler:q=>new Promise(resolve=>pending.push({q,resolve}))});cross(h);const original=h.context.liveChannelCrossQuery('PayOne');await flush();const joined=h.context.liveChannelCrossQuery('PayOne');await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].platformIds.length,20);pending[0].resolve(response(catalog.slice(0,20)));await flush();assert.equal(h.calls.length,2);pending[1].resolve(response(catalog.slice(20,40)));await flush();assert.equal(h.calls.length,3);pending[2].resolve(response(catalog.slice(40)));await original;await joined;assert.deepEqual(h.calls.map(q=>q.platformIds.length),[20,20,2]);
});
test('query permission revocation while a batch is pending clears facts and prevents further batches',async()=>{
 const catalog=Array.from({length:21},(_,i)=>platform(i+1)),wait=deferred(),h=fixture({catalog,handler:()=>wait.promise});cross(h);const p=h.context.liveChannelCrossQuery('PayOne');await flush();h.setPermissions(['view']);wait.resolve(response(catalog.slice(0,20)));await p;assert.equal(h.calls.length,1);assert.deepEqual(plain(h.mod.capture().cache),{});assert.doesNotMatch(h.mod.render(),/Display same/);
});
test('navigation discards late cross data and cannot start the next batch or paint the destination',async()=>{
 const catalog=Array.from({length:21},(_,i)=>platform(i+1)),wait=deferred(),h=fixture({catalog,handler:()=>wait.promise});cross(h);const p=h.context.liveChannelCrossQuery('PayOne');await flush();h.setPage('overview');h.mod.cancel();const paints=h.paints.length;wait.resolve(response(catalog.slice(0,20)));await p;assert.equal(h.calls.length,1);assert.equal(h.paints.length,paints);assert(!Object.values(h.mod.capture().cache).some(x=>x.response));
});
test('by-provider scope filters remain within fresh authorized countries, systems and platform UUIDs',async()=>{
 const first=platform(1),foreign=platform(2,{country:'巴西'}),yash=platform(3,{source:'kb',capabilities:{channelStatusAvailable:true}}),h=fixture({catalog:[first,foreign,yash]});cross(h);h.context.liveChannelCrossFilter('country','巴西');h.context.liveChannelCrossFilter('platformId','hidden-uuid');await h.context.liveChannelCrossQuery('PayOne');assert.deepEqual(h.calls[0].platformIds,[foreign.id]);assert.equal(h.mod.capture().cross.platformId,'');
});
test('a removed authorized target cannot accept a pending batch or be exported through another platform',async()=>{
 const first=platform(1),second=platform(2),wait=deferred(),h=fixture({catalog:[first,second],handler:()=>wait.promise});cross(h);const p=h.context.liveChannelCrossQuery('PayOne');await flush();h.setCatalog([first]);h.mod.render();wait.resolve(response([first,second]));await p;assert(!h.mod.capture().cache[second.id]);assert.equal(h.mod.canExport(),false);assert(!Object.values(h.mod.capture().cache).some(x=>x.response));
});
test('different raw names and countries never silently apply country-specific supplier aliases',async()=>{
 const first=platform(1),foreign=platform(2,{country:'巴基斯坦'}),h=fixture({catalog:[first,foreign],rowsFor:p=>p.id===first.id?matchedRows('one'):[channel('two',{provider:'WanguPay',channel_name:'Other'})]});cross(h);await h.context.liveChannelCrossQuery('WPayINR');const html=h.mod.render();assert.match(html,/WPayINR/);assert.doesNotMatch(html,/<td>WanguPay<\/td>/);assert.match(html,/当前完整快照无匹配通道/);
});
test('different name searches reuse full snapshots without changing cached source inventory',async()=>{
 const h=fixture({catalog:[platform(1),platform(2)],rowsFor:()=>[...matchedRows(),channel('other',{provider:'Other',source_position:1})]});cross(h);await h.context.liveChannelCrossQuery('WPay');const before=plain(h.mod.capture().cache);await h.context.liveChannelCrossQuery('Other');assert.equal(h.calls.length,1);assert.deepEqual(plain(h.mod.capture().cache),before);assert.match(h.mod.render(),/Other/);
});
test('single ordinary query reuses fresh snapshot while explicit platform selection refreshes it',async()=>{
 const h=fixture();await h.start();await h.mod.load();assert.equal(h.calls.length,1);h.context.liveChannelSelect(0);await flush();assert.equal(h.calls.length,2);await h.mod.load();assert.equal(h.calls.length,2);
});
test('a failed explicit refresh retains its last successful source snapshot and original collection time',async()=>{
 const h=fixture();await h.start();const old=plain(h.mod.capture().response);h.setHandler(()=>{throw Error('temporary failure')});h.context.liveChannelSelect(0);await flush();assert.deepEqual(plain(h.mod.capture().response),old);assert.match(h.mod.render(),/temporary failure/);assert.match(h.mod.render(),/保留上次成功读取/);
});
test('malformed batch source/identity cannot replace a previously validated snapshot',async()=>{
 const first=platform(1),h=fixture({rowsFor:()=>matchedRows()});await h.start();const before=plain(h.mod.capture().cache[first.id].response);cross(h);await h.context.liveChannelCrossQuery('WPay');h.setHandler(()=>{const r=response([first]);r.snapshots[0].source='wrong-source';return r;});await h.context.liveChannelCrossRefresh();assert.deepEqual(plain(h.mod.capture().cache[first.id].response),before);assert.match(h.mod.render(),/通道快照来源不匹配/);
});
test('view-only role cannot query on entry, mode switching, suggestions or refresh',async()=>{
 const h=fixture({permissions:['view'],catalog:[platform(1),platform(2)]});await h.start();cross(h);h.context.liveChannelCrossChoose('PayOne');await h.context.liveChannelCrossQuery('PayOne');h.context.liveChannelCrossRefresh();await flush();assert.equal(h.calls.length,0);assert.deepEqual(plain(h.mod.capture().cache),{});
});
test('single platform exact provider filter preserves its full enabled weight denominator and row identity',async()=>{
 const h=fixture({rowsFor:(_,direction)=>direction==='withdraw'?[channel('wd')]:[channel('same',{provider:'PayOne',weight:'100'}),channel('same',{provider:'PayOne',category_id:'qr',category_name:'QR',weight:'300',source_position:1}),channel('other',{provider:'PayTwo',weight:'300',source_position:2})]});await h.start();h.context.liveChannelProvider('PayOne');const rows=exported(h);assert.deepEqual(rows.map(r=>[r['通道 ID'],r['通道大类 ID'],r['预设权重占比']]),[['same','upi','25.00%'],['same','qr','100.00%']]);h.context.liveChannelCategory('upi');assert.equal(exported(h)[0]['预设权重占比'],'25.00%');cross(h);await h.context.liveChannelCrossQuery('PayOne');assert.equal(h.mod.canExport(),false);h.context.liveChannelMode('single');assert.equal(exported(h)[0]['预设权重占比'],'25.00%');
});
test('cross-platform provider matching keeps full native category pools isolated when returning to either platform',async()=>{
 const catalog=[platform(1),platform(2)],h=fixture({catalog,rowsFor:(p,direction)=>direction==='withdraw'?[channel('wd')]:[
  channel('selected',{provider:'PayOne',category_id:'upi',weight:p.id===catalog[0].id?'100':'900',real_time_weight:p.id===catalog[0].id?'20':'60'}),
  channel('peer',{provider:'PayTwo',category_id:'upi',weight:p.id===catalog[0].id?'300':'100',real_time_weight:p.id===catalog[0].id?'80':'40',source_position:1}),
  channel('other-category',{provider:'PayOne',category_id:'qr',category_name:'QR',weight:'5000',real_time_weight:'5000',source_position:2}),
 ]});await h.start();h.context.liveChannelProvider('PayOne');
 assert.deepEqual(exported(h).map(r=>[r['预设权重占比'],r['实际权重占比']]),[['25.00%','20.00%'],['100.00%','100.00%']]);
 cross(h);await h.context.liveChannelCrossQuery('PayOne');assert.equal(groups(h.mod.render()).size,2);assert.equal(h.mod.canExport(),false);assert.doesNotMatch(h.mod.render(),/预设权重占比|实际权重占比/);
 h.context.liveChannelMode('single');assert.deepEqual(exported(h).map(r=>[r['预设权重占比'],r['实际权重占比']]),[['25.00%','20.00%'],['100.00%','100.00%']]);
 h.context.liveChannelSelect(1);await flush();h.context.liveChannelProvider('PayOne');
 assert.deepEqual(exported(h).map(r=>[r['预设权重占比'],r['实际权重占比']]),[['90.00%','60.00%'],['100.00%','100.00%']]);
 const calls=h.calls.length;h.context.liveChannelCategory('upi');h.context.liveChannelQuery('selected');assert.equal(exported(h)[0]['预设权重占比'],'90.00%');assert.equal(h.calls.length,calls);
});
test('single export cannot expose detail-only source values and cross mode export remains unavailable',async()=>{
 const h=fixture({permissions:['view','query','export'],rowsFor:()=>[channel('one',{source_channel_name:'PRIVATE',third_pay_merchant_id:'SECRET',notes:'HIDDEN'})]});await h.start();assert.doesNotMatch(JSON.stringify(h.mod.exportRows()),/PRIVATE|SECRET|HIDDEN/);cross(h);await h.context.liveChannelCrossQuery('PayOne');assert.equal(h.mod.canExport(),false);assert.deepEqual(plain(h.mod.exportRows()),[]);
});
test('cross results keep null versus zero rates and never manufacture AR withdrawal percentages',async()=>{
 const h=fixture({rowsFor:()=>matchedRows('one',{success_rate_15m:'0',success_rate_30m:null})});cross(h);await h.context.liveChannelCrossQuery('WPay');assert.match(h.mod.render(),/0\.00%/);assert.match(h.mod.render(),/>—<\/td>/);h.context.liveChannelTab('withdraw');const html=h.mod.render();assert.doesNotMatch(html,/0\.00%/);assert.match(html,/只提供笔数/);assert.doesNotMatch(html,/平均成功率|综合成功率/);
});
test('no matches collapse separately from incomplete, stale or unsupported platform snapshots',async()=>{
 const a=platform(1),b=platform(2),c=platform(3,{capabilities:{channelStatusAvailable:false}}),h=fixture({catalog:[a,b,c],handler:q=>{const r=response([a,b],()=>[]);r.snapshots.filter(s=>s.platformId===b.id).forEach(s=>Object.assign(s,{observedAt:null,complete:false,sourceCount:null}));return r;}});cross(h);await h.context.liveChannelCrossQuery('WPay');const html=h.mod.render();assert.match(html,/<details class="channel-cross-summary"><summary>1 个平台当前完整快照无匹配通道/);assert.match(html,/<details class="channel-cross-summary"><summary>2 个平台待确认/);assert.doesNotMatch(html,/class="channel-cross-country"/);
});
test('IME drafting preserves input selection and never starts reads until a real selection or query',async()=>{
 const h=fixture();cross(h);h.context.document.activeElement={selectionStart:1,selectionEnd:1};const focus=[],ranges=[];h.context.document.querySelector=()=>({focus:()=>focus.push(true),setSelectionRange:(a,b)=>ranges.push([a,b])});h.context.liveChannelCrossDraft('支',true);assert.equal(h.calls.length,0);assert.equal(h.mod.capture().cross.draft,'支');h.context.liveChannelCrossDraft('支付',false,true);assert.equal(h.calls.length,0);assert.deepEqual(focus,[true]);assert.deepEqual(ranges,[[1,1]]);
});
test('five-minute auto refresh follows explicit provider query and pauses when the document is hidden',async()=>{
 const first=platform(1),second=platform(2),h=fixture({catalog:[first,second]});cross(h);await h.context.liveChannelCrossQuery('PayOne');await h.advance(299999);assert.equal(h.calls.length,1);await h.advance(1);assert.equal(h.calls.length,2);h.hide();await h.advance(300000);assert.equal(h.calls.length,2);await h.show();assert.equal(h.calls.length,3);assert(h.calls.every(q=>q.platformIds.length===2));
});
test('directory pause settles loading cache and leaves a retryable provider query without accepting late data',async()=>{
 const h=fixture({rowsFor:()=>matchedRows()});cross(h);await h.context.liveChannelCrossQuery('WPay');const old=plain(h.mod.capture().cache);const wait=deferred();h.setHandler(()=>wait.promise);const p=h.context.liveChannelCrossRefresh();await flush();h.L.catalogReady=false;wait.resolve(response([platform(1)],()=>matchedRows('new')));await p;assert.equal(h.mod.capture().cross.status,'paused');assert.equal(h.mod.capture().cache[platform(1).id].status,'ready');assert.deepEqual(plain(h.mod.capture().cache[platform(1).id].response),old[platform(1).id].response);h.L.catalogReady=true;h.setHandler(()=>response([platform(1)],()=>matchedRows('new')));h.mod.render();await flush();assert.equal(h.calls.length,2,'fresh prior snapshot remains valid but is not replaced by the late response');await h.context.liveChannelCrossRefresh();assert.equal(h.calls.length,3);assert.match(h.mod.render(),/new/);
});
test('generated compact selector remains sandbox-safe and uses exact native suggestion values',async()=>{
 const h=fixture({rowsFor:()=>matchedRows()});await h.start();cross(h);const html=h.mod.render();assert.match(html,/list="channel-cross-names"/);assert.match(html,/onchange="liveChannelCrossChoose\(this.value\)"/);assert.match(html,/type="button" onclick="liveChannelCrossQuery/);assert.doesNotMatch(html,/type="submit"|channel-browse-providers/);await h.context.liveChannelCrossChoose('WPay-QR');assert.equal(h.mod.capture().cross.query.label,'WPay-QR');assert.equal(h.calls.length,1,'a known cached platform needs no repeat read');
});

const grouped=h=>h.context.liveChannelMode('grouped');

test('platform grouping starts with the current platform and reuses its validated snapshot',async()=>{
 const catalog=Array.from({length:15},(_,i)=>platform(i+1)),h=fixture({catalog});await h.start();h.context.liveChannelSelect(2);await flush();const before=h.calls.length;grouped(h);await flush();
 assert.equal(h.mod.capture().mode,'grouped');assert.deepEqual(plain(h.mod.capture().browse.platformIds),[catalog[2].id]);assert.equal(h.calls.length,before);
 const html=h.mod.render();assert.match(html,/平台分组/);assert.match(html,/选择平台 · 已选 1 个平台/);assert.equal(groups(html).size,1);assert(groups(html).has(catalog[2].id));assert.match(html,/liveChannelBrowseCollapse/);
});
test('explicit multi-selection reads only uncached platforms and keeps per-platform channels and rates independent',async()=>{
 const catalog=[platform(1),platform(2),platform(3)],h=fixture({catalog,rowsFor:p=>[channel('same',{success_rate_30m:p.id===catalog[0].id?'20':'90'})]});await h.start();grouped(h);await flush();selectPlatforms(h,catalog,catalog.slice(0,2));await flush();
 assert.deepEqual(h.calls.map(q=>q.platformIds),[[catalog[0].id],[catalog[1].id]]);const result=groups(h.mod.render());assert.equal(result.size,2);assert.match(result.get(catalog[0].id),/20\.00%/);assert.match(result.get(catalog[1].id),/90\.00%/);assert.doesNotMatch(h.mod.render(),/55\.00%/);
 const rows=exported(h);assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r['平台']),catalog.slice(0,2).map(p=>p.name));assert(rows.every(r=>r['通道 ID']==='same'));
});
test('explicit all-platform selection is a fixed authorized set and never silently includes new catalog entries',async()=>{
 const catalog=[platform(1),platform(2)],h=fixture({catalog});await h.start();grouped(h);h.context.liveChannelBrowseAllPlatforms();h.context.liveChannelBrowseApplyPlatforms();await flush();
 assert.deepEqual(plain(h.mod.capture().browse.platformIds),catalog.map(p=>p.id));h.setCatalog([...catalog,platform(3)]);h.mod.render();await flush();assert.equal(h.calls.length,2);assert.equal(groups(h.mod.render()).size,2);assert(!h.mod.capture().browse.platformIds.includes(platform(3).id));
});
test('grouped batch transport stays sequential at twenty and coalesces identical pending loads',async()=>{
 const catalog=Array.from({length:42},(_,i)=>platform(i+1)),h=fixture({catalog});await h.start();grouped(h);await flush();const pending=[];h.setHandler(q=>new Promise(resolve=>pending.push({q,resolve})));h.context.liveChannelBrowseAllPlatforms();h.context.liveChannelBrowseApplyPlatforms();await flush();const joined=h.mod.load();await flush();
 assert.equal(pending.length,1);assert.equal(pending[0].q.platformIds.length,20);pending[0].resolve(response(catalog.slice(1,21)));await flush();assert.equal(pending.length,2);pending[1].resolve(response(catalog.slice(21,41)));await flush();assert.equal(pending.length,3);pending[2].resolve(response(catalog.slice(41)));await joined;await flush();
 assert.deepEqual(h.calls.map(q=>q.platformIds.length),[1,20,20,1]);assert.equal(groups(h.mod.render()).size,42);
});
test('grouped scope changes show only the first platform in the newly selected country and reject old late batches',async()=>{
 const first=platform(1),second=platform(2),foreign=platform(3,{country:'巴西'}),foreign2=platform(4,{country:'巴西'}),catalog=[first,second,foreign,foreign2],h=fixture({catalog});await h.start();grouped(h);await flush();const wait=deferred();h.setHandler(q=>q.platformIds.includes(second.id)?wait.promise:response(catalog.filter(p=>q.platformIds.includes(p.id))));selectPlatforms(h,catalog,[first,second]);await flush();h.context.liveChannelBrowseCountry(1);await flush();wait.resolve(response([second]));await flush();
 assert.equal(h.mod.capture().country,'巴西');assert.deepEqual(plain(h.mod.capture().browse.platformIds),[foreign.id]);assert.deepEqual(h.calls.at(-1).platformIds,[foreign.id]);assert.equal(groups(h.mod.render()).size,1);assert(groups(h.mod.render()).has(foreign.id));assert(!h.mod.capture().cache[second.id]?.response);assert.deepEqual(exported(h).map(r=>r['平台']),[foreign.name]);
});
test('removed selected platforms stay empty rather than broadening to all remaining platforms',async()=>{
 const first=platform(1),second=platform(2),h=fixture({catalog:[first,second]});await h.start();grouped(h);await flush();h.setCatalog([second]);h.mod.render();await flush();
 assert.deepEqual(plain(h.mod.capture().browse.platformIds),[]);assert.equal(h.calls.length,1);assert.equal(groups(h.mod.render()).size,0);assert.equal(h.mod.canExport(),false);assert.match(h.mod.render(),/当前没有已选可见平台/);assert(!h.mod.capture().cache[first.id]);
});
test('grouped permission revocation clears cached facts and rejects a late response and export',async()=>{
 const catalog=[platform(1),platform(2)],h=fixture({catalog});await h.start();grouped(h);await flush();const wait=deferred();h.setHandler(()=>wait.promise);selectPlatforms(h,catalog,catalog);await flush();h.setPermissions(['view']);wait.resolve(response([catalog[1]]));await flush();
 assert.deepEqual(plain(h.mod.capture().cache),{});assert.equal(h.mod.canExport(),false);assert.deepEqual(plain(h.mod.exportRows()),[]);assert.doesNotMatch(h.mod.render(),/Display same/);assert.match(h.mod.render(),/未获查询权限/);
});
test('grouped navigation and account clear prevent a late response from reviving the prior selection',async()=>{
 const catalog=[platform(1),platform(2)],h=fixture({catalog});await h.start();grouped(h);await flush();const wait=deferred();h.setHandler(()=>wait.promise);selectPlatforms(h,catalog,catalog);await flush();h.setPage('overview');h.mod.cancel();h.mod.clear();const paints=h.paints.length;wait.resolve(response([catalog[1]]));await flush();
 assert.equal(h.paints.length,paints);assert.deepEqual(plain(h.mod.capture().cache),{});assert.equal(h.mod.capture().mode,'single');assert.equal(h.mod.canExport(),false);
});
test('grouped refresh retains prior snapshots and separately labels missing and incomplete platforms without false zero',async()=>{
 const catalog=[platform(1),platform(2)],h=fixture({catalog,handler:q=>{const result=response(catalog.filter(p=>q.platformIds.includes(p.id)));for(const s of result.snapshots)if(s.platformId===catalog[1].id){s.observedAt=null;s.receivedAt=null;s.complete=false;s.channels=[];s.sourceCount=null;}return result;}});await h.start();grouped(h);selectPlatforms(h,catalog,catalog);await flush();
 let result=groups(h.mod.render());assert.match(result.get(catalog[1].id),/尚未收到快照|尚未收到完整通道快照/);assert.doesNotMatch(result.get(catalog[1].id),/0 个当前通道|已采集，暂无通道/);
 const wait=deferred();h.setHandler(()=>wait.promise);const refresh=h.context.liveChannelBrowseRefresh();await flush();assert.match(groups(h.mod.render()).get(catalog[0].id),/正在刷新，显示上次快照/);wait.reject(Error('service unavailable'));await refresh;assert.match(groups(h.mod.render()).get(catalog[0].id),/保留上次成功读取的快照/);assert.equal(exported(h).length,1);assert.equal(exported(h)[0]['平台'],catalog[0].name);
});
test('grouped detail permission applies to every platform and CSV, while note expansion uses the exact platform identity',async()=>{
 const catalog=[platform(1,{source:'kb',capabilities:{channelStatusAvailable:true}}),platform(2,{source:'kb',capabilities:{channelStatusAvailable:true}})],h=fixture({catalog,rowsFor:p=>[channel('same',{notes:p.id+' '+ 'long note '.repeat(10)})]});await h.start();grouped(h);selectPlatforms(h,catalog,catalog);await flush();h.context.liveChannelBrowseToggle(catalog[1].id,0);
 const result=groups(h.mod.render());assert.match(result.get(catalog[0].id),/channel-notes-text collapsed/);assert.doesNotMatch(result.get(catalog[1].id),/channel-notes-text collapsed/);assert.match(result.get(catalog[1].id),/收起备注/);
 h.setPermissions(['view','query','export']);h.context.liveChannelBrowseToggle(catalog[0].id,0);assert.doesNotMatch(h.mod.render(),/liveChannelBrowseToggle|long note/);assert(exported(h).every(row=>row['第三方商户 ID']==='—'&&row['备注']==='—'));
});
test('grouped local filters, collapse, direction and revisit use existing snapshots without changing native weight pools',async()=>{
 const catalog=[platform(1),platform(2)],h=fixture({catalog,rowsFor:()=>[channel('one',{provider:'PayOne',weight:'20',real_time_weight:'40'}),channel('two',{provider:'PayTwo',weight:'80',real_time_weight:'60'})]});await h.start();grouped(h);selectPlatforms(h,catalog,catalog);await flush();const calls=h.calls.length;
 h.context.liveChannelBrowseProvider('PayOne');let rows=exported(h);assert.equal(rows.length,2);assert(rows.every(row=>row['预设权重占比']==='20.00%'&&row['实际权重占比']==='40.00%'));h.context.liveChannelBrowseCollapse(catalog[1].id);assert.equal(tableRows(groups(h.mod.render()).get(catalog[1].id)).length,0);assert.equal(exported(h).length,2,'folding is presentation-only');h.context.liveChannelBrowseTab('withdraw');assert.equal(h.calls.length,calls);assert(exported(h).every(row=>row['方向']==='提现'));
 const saved=plain(h.mod.capture());h.mod.clear();h.mod.restore(saved);await h.start();assert.equal(h.mod.capture().mode,'grouped');assert.equal(h.calls.length,calls);assert.deepEqual(plain(h.mod.capture().browse.collapsed),[catalog[1].id]);
});
test('single platform and grouped views restore their independent scope and local filters across cross-provider mode',async()=>{
 const a=platform(1),b=platform(2,{country:'巴西'}),h=fixture({catalog:[a,b],rowsFor:()=>matchedRows()});await h.start();h.context.liveChannelProvider('WPayINR');h.context.liveChannelQuery('WPay');const single=plain(h.mod.capture());grouped(h);h.context.liveChannelBrowseCountry(1);await flush();h.context.liveChannelBrowseTab('withdraw');h.context.liveChannelBrowseFilter('status','on');cross(h);await h.context.liveChannelCrossQuery('WPay');h.context.liveChannelMode('single');await flush();
 for(const key of ['source','country','platformId','tab','provider','channelQuery'])assert.equal(h.mod.capture()[key],single[key],key);grouped(h);await flush();assert.equal(h.mod.capture().country,'巴西');assert.equal(h.mod.capture().tab,'withdraw');assert.equal(h.mod.capture().filterStatus,'on');assert.deepEqual(plain(h.mod.capture().browse.platformIds),[b.id]);
});
test('grouped automatic refresh is bound to the explicit selection and pauses while hidden',async()=>{
 const catalog=[platform(1),platform(2)],h=fixture({catalog});await h.start();grouped(h);await flush();await h.advance(300001);assert.deepEqual(h.calls.map(q=>q.platformIds),[[catalog[0].id],[catalog[0].id]]);h.hide();await h.advance(300001);assert.equal(h.calls.length,2);await h.show();assert.deepEqual(h.calls.at(-1).platformIds,[catalog[0].id]);assert.equal(h.calls.length,3);
});
