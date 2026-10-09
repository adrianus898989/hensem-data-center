/* Production channel browser, real module with session-local catalog, clock and IO. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-channel-status.js'),'utf8');
const NOW='2026-10-09T05:00:00.000Z';
const platform=(n,extra={})=>({id:String(n).padStart(8,'0')+'-1111-4111-8111-111111111111',source:'ar',name:'AR '+n,country:'印度',timezone:'Asia/Kolkata',capabilities:{channelStatusAvailable:true,channelStatusSource:'ar_middle'},...extra});
const AR=platform(1),YASH=platform(2,{source:'kb',name:'YASH.BET',capabilities:{channelStatusAvailable:true}});
const channel=(id='one',extra={})=>({channel_id:id,sys_channel_id:'sys-'+id,channel_name:'Display '+id,source_channel_name:null,provider:'Provider '+id,category_id:'upi',category_name:'UPI',channel_categories:[{category_id:'upi',category_name:'UPI',sort:2},{category_id:'qr',category_name:'QR 大类',sort:1}],channel_type:'native',payment_method:'pay-method',source_state:'1',source_channel_state:'0',source_merchant_state:'1',source_position:0,enabled:true,is_present:true,status_text:'开启',min_amount:'0',max_amount:'50000',limit_currency:'INR',balance:'-2.5',balance_currency:null,required_deposit_count:0,priority:0,weight:0,fee_rate:'0.025',fee_rate_basis:'source_raw',fee_amount:'2',third_pay_merchant_id:'merchant-22',source_updated_at:NOW,success_rate_10m:'99',success_rate_15m:'0',success_rate_30m:'68.4',success_rate_1h:null,success_rate_24h:'60.2',notes:'',observed_at:NOW,...extra});
function response(p,rows=[channel()],extra={}){return {version:1,queriedAt:NOW,platforms:[p],snapshots:['charge','withdraw'].map(direction=>({platformId:p.id,direction,...(p.source==='ar'?{source:'ar_middle'}:{}),observedAt:NOW,receivedAt:NOW,complete:true,sourceCount:rows.length,channels:rows.map(r=>({...r,channel_id:r.channel_id+'-'+direction}))})),...extra};}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(options={}){
 let page='channel_status',clock=Date.parse(NOW),catalog=options.catalog||[AR],permissions=new Set(options.permissions||['view','query','export','detail']),handler=options.handler||((q)=>response(catalog.find(p=>p.id===q.platformIds[0])));
 const timers=[],calls=[],paints=[],events={},rootEvents={};
 const context={console,Intl,Promise,Date:class extends Date{constructor(...a){super(...(a.length?a:[clock]))}static now(){return clock}},document:{visibilityState:'visible',addEventListener:(name,fn)=>events[name]=fn},addEventListener:(name,fn)=>rootEvents[name]=fn,setTimeout:(fn,ms)=>{const item={fn,ms,due:clock+ms,active:true};timers.push(item);return item;},clearTimeout:item=>{item.active=false;}};
 context.window=context;vm.createContext(context);vm.runInContext(source,context);
 const L={catalogReady:true,dirty:true,pageQueried:false,country:'印度'},mod=context.HensemLiveChannelStatus.create({L,getPage:()=>page,catalog:()=>catalog,roleAllowed:action=>permissions.has(action),request:q=>{calls.push(JSON.parse(JSON.stringify(q)));return handler(q)},render:()=>paints.push(mod.render())});
 return {context,L,mod,calls,paints,timers,start:async()=>{mod.render();await flush();},setHandler:fn=>handler=fn,setPage:value=>page=value,setCatalog:value=>catalog=value,setPermissions:value=>permissions=new Set(value),hide:()=>{context.document.visibilityState='hidden';events.visibilitychange();},show:async()=>{context.document.visibilityState='visible';events.visibilitychange();await flush();},unload:()=>rootEvents.pagehide(),advance:async(ms)=>{clock+=ms;for(const timer of [...timers])if(timer.active&&timer.due<=clock){timer.active=false;timer.fn();}await flush();},setNow:value=>clock=Date.parse(value)};
}
const headers=html=>[...html.matchAll(/<th[^>]*scope="col"[^>]*>([^<]*)<\/th>/g)].map(m=>m[1]);
const exported=h=>{const rows=h.mod.exportRows(),header=rows[3];return rows.slice(4).map(row=>Object.fromEntries(header.map((name,i)=>[name,row[i]])));};

test('full authorized directory paginates independently and first automatic request reads exactly one platform',async()=>{
 const catalog=Array.from({length:44},(_,i)=>platform(i+1)),h=fixture({catalog});await h.start();assert.deepEqual(h.calls,[{action:'channelStatus',platformIds:[catalog[0].id],direction:'all'}]);
 const html=h.mod.render();assert.match(html,/共 44 个 · 1–20/);assert.equal((html.match(/onclick="liveChannelSelect/g)||[]).length,20);assert.match(html,/每 5 分钟自动刷新/);
 h.context.liveChannelPage(3);assert.match(h.mod.render(),/共 44 个 · 41–44/);h.context.liveChannelPageSize('500');assert.equal((h.mod.render().match(/onclick="liveChannelSelect/g)||[]).length,44);assert.equal(h.calls.length,1);
 h.context.liveChannelSearch('AR 43');assert.match(h.mod.render(),/共 1 个 · 1–1/);assert.equal(h.calls.length,1);assert.equal(h.mod.capture().platformId,catalog[0].id);
});

test('source and country tabs come only from directory and keep different source caches and exports isolated',async()=>{
 const BR=platform(3,{country:'巴西'}),h=fixture({catalog:[AR,BR,YASH]});await h.start();assert.match(h.mod.render(),/AR 系统/);assert.match(h.mod.render(),/YASH 系统/);assert.match(h.mod.render(),/巴西/);
 h.context.liveChannelCountry(1);await flush();assert.equal(h.calls[1].platformIds[0],BR.id);h.context.liveChannelCountry(0);await flush();assert.equal(h.calls.length,2);
 h.context.liveChannelSource(1);await flush();assert.equal(h.calls[2].platformIds[0],YASH.id);assert.equal(exported(h)[0]['平台'],YASH.name);h.context.liveChannelSource(0);await flush();assert.equal(h.calls.length,3);assert.equal(exported(h)[0]['平台'],AR.name);
});

test('AR full independent columns preserve four native rates and all category memberships without inventing names',async()=>{
 const h=fixture();await h.start();const html=h.mod.render(),list=headers(html);assert.deepEqual(list.filter(x=>x.includes('成功率')),['近15分钟成功率','近30分钟成功率','近1小时成功率','近24小时成功率']);
 for(const label of ['充值大类','通道 ID','系统通道 ID','源通道名称','前台显示名称','支付供应商','最小交易金额 (INR)','最大交易金额 (INR)','余额','余额币种','代收次数要求','优先级','权重','状态','源启用状态','通道可用状态','商户可用状态','费率（源值）','固定手续费','第三方商户 ID','备注','源配置'])assert(list.includes(label),label);
 assert.doesNotMatch(list.join('|'),/通道类型|支付方式|近10分钟|近4小时|近8小时|今日成功率|总成功率/);assert.match(html,/QR 大类/);assert.match(html,/class="channel-original-name">—<\/td>/);assert.match(html,/0\.00%/);assert.match(html,/68\.40%/);assert.doesNotMatch(html,/99\.00%/);
 const row=exported(h)[0];assert.equal(row['源通道名称'],'—');assert.equal(row['全部大类 ID'],'upi / qr');assert.equal(row['通道可用状态'],'0');assert.equal(row['商户可用状态'],'1');assert.equal(row['余额'],-2.5);assert.equal(row['代收次数要求'],0);assert.equal(row['近1小时成功率'],'—');assert.equal(h.mod.exportRows()[3].length,h.mod.exportRows()[4].length);
 h.context.liveChannelSourceDetail(0);assert.match(h.mod.render(),/channel-source-details/);assert.match(h.mod.render(),/费率口径/);assert.match(h.mod.render(),/source_raw/);assert.match(h.mod.render(),/merchant-22/);assert.doesNotMatch(h.mod.render(),/2\.50%/);h.context.liveChannelCategory('qr');assert.equal(exported(h).length,1);assert.equal(h.calls.length,1);
});

test('YASH retains its eight rate windows and payment method while source fifteen-minute value is excluded',async()=>{
 const h=fixture({catalog:[YASH]});await h.start();const list=headers(h.mod.render());assert.equal(list.filter(x=>x.includes('成功率')).length,8);assert(list.includes('支付方式'));assert(!list.includes('近15分钟成功率'));assert.equal(exported(h)[0]['近10分钟成功率'],'99.00%');assert.doesNotMatch(h.mod.render(),/channel-original-name/);
});

test('provider, state, category, history and direction controls never issue source requests and CSV follows them',async()=>{
 const rows=[channel('a'),channel('b',{provider:'Other',enabled:false,source_position:1}),channel('old',{is_present:false,source_position:2})],h=fixture({handler:()=>response(AR,rows)});await h.start();
 h.context.liveChannelProvider('Other');assert.equal(exported(h).length,1);assert.equal(exported(h)[0]['支付供应商'],'Other');h.context.liveChannelStatus('on');assert.equal(exported(h).length,0);h.context.liveChannelProvider('');h.context.liveChannelStatus('all');h.context.liveChannelAbsent(true);assert.equal(exported(h).length,3);h.context.liveChannelTab('withdraw');assert.equal(exported(h)[0]['方向'],'提现');assert(headers(h.mod.render()).includes('余额阈值'));assert(!headers(h.mod.render()).includes('代收次数要求'));assert.equal(h.calls.length,1);
});

test('five-minute timer refreshes the current platform without overlapping pending requests',async()=>{
 const h=fixture();await h.start();let finish;h.setHandler(()=>new Promise(resolve=>finish=resolve));await h.advance(300000);assert.equal(h.calls.length,2);assert.equal(h.mod.capture().status,'loading');const overlap=h.mod.load();assert.equal(h.calls.length,2);await h.advance(300000);assert.equal(h.calls.length,2);h.setHandler(()=>response(AR));finish(response(AR));await overlap;await flush();assert.equal(h.calls.length,3);assert.equal(h.mod.capture().status,'ready');
});

test('ordinary refresh failure preserves known snapshot, collection deadline and last success time',async()=>{
 const h=fixture();await h.start();h.setHandler(()=>{throw Error('network unavailable')});await h.advance(300000);assert.match(h.mod.render(),/更新失败：network unavailable/);assert.match(h.mod.render(),/保留上次成功读取的快照/);assert.match(h.mod.render(),/最后成功读取 2026\/10\/09 10:30:00/);assert.equal(exported(h)[0]['快照采集时间'],NOW);assert.equal(h.mod.capture().status,'ready');
 await h.advance(600001);assert.match(h.mod.render(),/超过 15 分钟未更新/);assert.equal(exported(h)[0]['更新状态'],'超过 15 分钟未更新');
 h.setHandler(()=>response(AR));await h.mod.load();assert.equal(h.mod.capture().error,'');assert.equal(h.mod.capture().status,'ready');
});

test('synchronously thrown request can be retried and cannot leave an inflight lock',async()=>{
 const h=fixture({handler:()=>{throw Error('network failure')}});await h.start();assert.equal(h.mod.capture().status,'error');h.setHandler(()=>response(AR));await h.mod.load();assert.equal(h.calls.length,2);assert.equal(h.mod.capture().status,'ready');
});

test('authorization failure clears cached facts across all platforms and disables automatic retries',async()=>{
 const p=platform(2),h=fixture({catalog:[AR,p]});await h.start();h.context.liveChannelSelect(1);await flush();assert.equal(Object.keys(h.mod.capture().cache).length,2);h.setHandler(()=>{throw Object.assign(Error('正式数据读取未获授权，或会话已失效'),{status:403})});await h.mod.load();assert.deepEqual(Object.keys(h.mod.capture().cache),[]);assert.equal(h.mod.canExport(),false);assert.doesNotMatch(h.mod.render(),/Display one/);await h.advance(600000);assert.equal(h.calls.length,3);assert.match(h.mod.render(),/重新验证授权/);
});

test('query permission revocation purges cached facts and all direct actions remain permission checked',async()=>{
 const h=fixture();await h.start();h.setPermissions(['view','export']);h.mod.render();assert.equal(h.mod.canExport(),false);assert.equal(Object.keys(h.mod.capture().cache).length,0);assert.match(h.mod.render(),/未获查询权限/);await h.mod.load();assert.equal(h.calls.length,1);
});

test('hidden document pauses automatic refresh and rejects a pending response; showing resumes safely',async()=>{
 const h=fixture();await h.start();let finish;h.setHandler(()=>new Promise(resolve=>finish=resolve));await h.advance(300000);h.hide();finish(response(AR,[channel('late')]));await flush();assert.doesNotMatch(h.mod.render(),/Display late/);await h.advance(300000);assert.equal(h.calls.length,2);h.setHandler(()=>response(AR));await h.show();assert.equal(h.calls.length,3);
});

test('platform selection cancels late response and navigation never repaints destination',async()=>{
 let finish;const second=platform(2),h=fixture({catalog:[AR,second],handler:q=>q.platformIds[0]===AR.id?new Promise(resolve=>finish=resolve):response(second,[channel('second')])});await h.start();h.context.liveChannelSelect(1);await flush();finish(response(AR,[channel('late')]));await flush();assert.equal(exported(h)[0]['平台'],second.name);assert.doesNotMatch(h.mod.render(),/Display late/);
 let done;h.setHandler(()=>new Promise(resolve=>done=resolve));const reading=h.mod.load();await flush();h.setPage('overview');h.mod.cancel();const count=h.paints.length;done(response(second,[channel('navigation-late')]));await reading;assert.equal(h.paints.length,count);assert.equal(h.mod.canExport(),false);assert.equal(h.mod.render(),'');
});

test('catalog revocation and changed source identity discard cache and prevent old-scope exports',async()=>{
 const h=fixture();await h.start();h.setCatalog([]);h.mod.render();assert.equal(Object.keys(h.mod.capture().cache).length,0);assert.equal(h.mod.canExport(),false);h.setCatalog([{...AR,source:'kb',capabilities:{channelStatusAvailable:true}}]);h.setHandler(()=>response({...AR,source:'kb',capabilities:{channelStatusAvailable:true}}));await h.start();assert.equal(h.calls.length,2);assert.equal(h.mod.capture().source,'YASH');assert(headers(h.mod.render()).includes('近10分钟成功率'));
});

test('capture/restore keeps per-platform cache, local controls and original freshness without refetch',async()=>{
 const h=fixture();await h.start();h.context.liveChannelTab('withdraw');h.context.liveChannelCategory('qr');h.context.liveChannelPageSize('50');const saved=h.mod.capture();h.mod.clear();h.setNow('2026-10-09T05:01:00Z');h.mod.restore(saved);h.mod.render();await flush();assert.equal(h.calls.length,1);assert.equal(h.mod.capture().tab,'withdraw');assert.equal(h.mod.capture().category,'qr');assert.equal(h.mod.capture().size,50);assert.equal(exported(h)[0]['快照采集时间'],NOW);h.unload();assert.equal(Object.keys(h.mod.capture().cache).length,0);assert(h.timers.every(t=>!t.active));
});

test('source sorting, legacy category fallback and safe text survive independent table fields',async()=>{
 const rows=[channel('second',{source_position:2,enabled:true,channel_categories:null}),channel('first',{source_position:1,enabled:false,channel_categories:undefined,category_name:'Legacy category',source_channel_name:'<img src=x>',notes:'<script>unsafe</script>'+ 'detail'.repeat(30)})],h=fixture({handler:()=>response(AR,rows)});await h.start();const html=h.mod.render();assert(html.indexOf('Display first')<html.indexOf('Display second'));assert.match(html,/Legacy category/);assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<script>|<img src=x>/);h.context.liveChannelToggle(0);assert.match(h.mod.render(),/收起备注/);
});

test('missing snapshot, incomplete snapshot and complete empty snapshot keep separate indicators',async()=>{
 const h=fixture({handler:()=>response(AR,[],{snapshots:[{platformId:AR.id,source:'ar_middle',direction:'charge',observedAt:null,complete:false,sourceCount:null,channels:[]}]})});await h.start();assert.match(h.mod.render(),/尚未收到快照/);assert.match(h.mod.render(),/尚未收到完整通道快照/);h.setHandler(()=>response(AR,[]));await h.mod.load();assert.match(h.mod.render(),/0 个当前通道/);assert.match(h.mod.render(),/已采集，暂无通道/);
});

const navigationPrefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0].replace('vm.runInContext(source,context',"vm.runInContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-channel-status.js'),'utf8'),context);vm.runInContext(source,context");
const {harness,settle}=new Function('require','__dirname',navigationPrefix+';return {harness,settle};')(require,__dirname);
function integrated(options={}){const catalog=options.catalog||[AR],access=options.access||{mode:'owner',canView:true,permissions:[]};return harness({page:'channel_status',roleAccess:access,roleAllowed:()=>true,...options,handler:q=>q.action==='catalog'?{platforms:catalog}:q.action==='channelStatus'?response(catalog.find(p=>p.id===q.platformIds[0])):{}});}

test('live host uses full visible catalog, hides shared filters, automatically loads only one platform and restores the tab without IO',async()=>{
 const catalog=Array.from({length:42},(_,i)=>platform(i+1)),h=integrated({catalog});await settle();assert.deepEqual(h.calls.map(q=>q.action),['catalog','channelStatus']);assert.equal(h.calls[1].platformIds.length,1);assert.equal(h.nodes.get('liveFilters').style.display,'none');assert.match(h.html(),/共 42 个/);assert.equal(h.L.pageQueried,true);assert.equal(h.L.dirty,false);h.c.liveExport();assert.equal(h.blobs.length,1);h.c.setPage('overview');h.c.setPage('channel_status');await settle();assert.match(h.html(),/Display one/);assert.equal(h.calls.filter(q=>q.action==='channelStatus').length,1);h.c.liveReset();await settle();assert.equal(h.calls.filter(q=>q.action==='channelStatus').length,2);h.c.liveClosePage('channel_status');h.c.setPage('channel_status');await settle();assert.equal(h.calls.filter(q=>q.action==='channelStatus').length,3);
});

test('live host view-only role receives authorized directory but no automatic channel facts or export',async()=>{
 const h=integrated({access:{mode:'assigned',canView:true,permissions:['channel_status.view','channel_status.export']}});await settle();assert.deepEqual(h.calls.map(q=>q.action),['catalog']);assert.match(h.html(),/未获查询权限/);assert.doesNotMatch(h.html(),/Display one/);h.c.liveExport();assert.equal(h.blobs.length,0);
});
