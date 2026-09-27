/* Synthetic fixtures only: independent snapshot semantics and stale-response protection. */
const test=require('node:test'),assert=require('node:assert/strict');
const {create,resolvePlatforms}=require('../admin-preview/live-pending-snapshot.js');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const p=(id,name='Synthetic A',team='Synthetic Team')=>({id,name,sourceName:name,country:'印度',team,source:'AR',timezone:'Asia/Kolkata',currency:'INR'});
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
function response(ids=[A],overrides={}){return {version:1,basis:'seven_day_pending_snapshot',snapshotDate:'2026-09-26',windowStart:'2026-09-20',windowEnd:'2026-09-26',complete:true,expectedPlatformCount:ids.length,receivedPlatformCount:ids.length,missingPlatforms:[],amount:'1250.50',count:9,observedAt:'2026-09-27T00:30:00Z',firstObservedAt:'2026-09-27T00:00:00Z',rows:ids.map(id=>({...p(id),state:'complete',amount:'1250.50',count:9,snapshotAt:'2026-09-27T00:30:00Z',windowStart:'2026-09-20',windowEnd:'2026-09-26',groups:[{provider:'Synthetic Pay',rawChannel:'Synthetic original',channelType:'wallet',count:9,amount:'1250.50'}]})),...overrides};}
function harness(options={}){const L={country:'印度',from:'2026-09-26T01:00:00',to:'2026-09-26T02:00:00',dirty:false,withdrawCatalog:[]},calls=[],drawers=[];let selected=[p(A)],providers=[],handler=async()=>response();const ui=create({L,E:escape,N:number,C:v=>Number(v).toLocaleString('en-US'),selected:()=>selected,providers:()=>providers,prepare:options.prepare,request:q=>{calls.push(q);return handler(q)},render(){},open:(title,body)=>drawers.push({title,body})});return {ui,L,calls,drawers,select:v=>selected=v,providers:v=>providers=v,handler:v=>handler=v};}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};

test('snapshot requests use only selected end day and authorized platforms/providers, regardless of start time or hours',async()=>{
 const h=harness();h.providers(['Synthetic Pay','Synthetic Pay']);await h.ui.load();assert.deepEqual(h.calls[0],{action:'pendingSnapshot',date:'2026-09-26',platformIds:[A],providers:['Synthetic Pay']});
 h.L.from='2026-09-01T21:22:23';h.L.to='2026-09-26T23:58:57';await h.ui.load();assert.deepEqual(h.calls[1],h.calls[0]);assert.match(h.ui.metric(),/1,250.50/);assert.match(h.ui.metric(),/9 笔/);assert.match(h.ui.metric(),/2026-09-20 至 2026-09-26/);assert.doesNotMatch(h.ui.metric(),/昨日|前一日|创建时间|较前/);
});

test('report-only selection resolves only its unique same-country same-team authorized seed',()=>{
 const report={...p('report:seed'),reportOnly:true};assert.deepEqual(resolvePlatforms([report],[p(A)]),{platformIds:[A],unsupported:[]});
 for(const seeds of [[p(A,'Synthetic A','Other Team')],[{...p(A),country:'巴西'}],[p(A),p(B)]]){const r=resolvePlatforms([report],seeds);assert.equal(r.platformIds.length,0);assert.equal(r.unsupported.length,1);}
 const dedup=resolvePlatforms([p(A),report],[p(A)]);assert.deepEqual(dedup.platformIds,[A]);assert.equal(dedup.unsupported.length,0);
});

test('stale responses cannot overwrite a newer platform/date scope or restore after cancellation',async()=>{
 const h=harness(),old=deferred();h.handler(()=>old.promise);const first=h.ui.load();h.select([p(B,'Synthetic B')]);h.handler(async()=>response([B],{amount:'200.00',count:2}));await h.ui.load();old.resolve(response([A]));await first;assert.match(h.ui.metric(),/>200.00</);assert.doesNotMatch(h.ui.metric(),/1,250/);
 const late=deferred();h.handler(()=>late.promise);const next=h.ui.load();h.ui.cancel();late.resolve(response([B]));await next;assert.equal(h.ui.state.status,'paused');assert.doesNotMatch(h.ui.metric(),/1,250|200.00/);
 const changed=deferred();h.handler(()=>changed.promise);const another=h.ui.load();h.L.to='2026-09-25T23:59:59';changed.resolve(response([B]));await another;assert.doesNotMatch(h.ui.metric(),/1,250/);
});

test('complete zero is distinct from partial zero, missing snapshot and transport failure',async()=>{
 const h=harness();h.handler(async()=>response([A],{amount:'0',count:0}));await h.ui.load();assert.match(h.ui.metric(),/>0.00</);assert.match(h.ui.metric(),/>0 笔</);assert.match(h.ui.metric(),/快照完整/);
 h.handler(async()=>response([A,B],{complete:false,amount:'0',count:0,expectedPlatformCount:2,receivedPlatformCount:1}));await h.ui.load();assert.match(h.ui.metric(),/>—</);assert.doesNotMatch(h.ui.metric(),/>0.00</);assert.match(h.ui.metric(),/快照不完整/);
 h.handler(async()=>response([A],{complete:false,amount:null,count:null,receivedPlatformCount:0,rows:[{...p(A),state:'missing',amount:null,count:null}]}));await h.ui.load();assert.match(h.ui.metric(),/尚无可用合计/);h.ui.details();assert.match(h.drawers.at(-1).body,/未采到当日快照/);
 h.handler(async()=>{throw Error('Synthetic timeout')});await h.ui.load();assert.match(h.ui.metric(),/快照读取失败/);assert.doesNotMatch(h.ui.metric(),/>0.00</);
});

test('partial positive values remain explicitly labeled subtotals and expose actual row dates and original channels',async()=>{
 const h=harness();h.select([p(A),p('report:unsupported','Synthetic unconnected')]);await h.ui.load();assert.match(h.ui.metric(),/已采集小计/);assert.match(h.ui.summary(),/已采集 1 \/ 2 平台/);h.ui.details();const text=h.drawers.at(-1).body;assert.match(text,/class="live-pending-snapshot-detail"/);assert.match(text,/Synthetic unconnected/);assert.match(text,/尚未接入快照/);assert.match(text,/2026-09-20 至 2026-09-26/);assert.match(text,/Synthetic original/);assert.match(text,/采集时间/);assert.doesNotMatch(text,/超过 1 天/);
});

test('invalid responses never masquerade as a complete snapshot, and unqueryable selection makes no broad request',async()=>{
 const h=harness();for(const bad of [{basis:'orders'},{snapshotDate:'2026-09-25'},{rows:null},{receivedPlatformCount:0}]){h.handler(async()=>response([A],bad));await h.ui.load();assert.equal(h.ui.state.status,'error');assert.doesNotMatch(h.ui.metric(),/1,250.50/);}
 h.select([p('report:unbound')]);const count=h.calls.length;await h.ui.load();assert.equal(h.calls.length,count);assert.match(h.ui.metric(),/尚无可查询/);
});

test('saved tabs retain their own snapshot and paused loads never present an old full total',async()=>{
 const h=harness();await h.ui.load();const saved=h.ui.capture();h.ui.restore(null);assert.doesNotMatch(h.ui.metric(),/1,250/);h.ui.restore(saved);assert.match(h.ui.metric(),/1,250/);h.L.dirty=true;assert.doesNotMatch(h.ui.metric(),/1,250/);
});

test('snapshot waits for the same-query report directory before resolving its full platform scope',async()=>{
 const catalog=deferred(),h=harness({prepare:()=>catalog.promise});const loading=h.ui.load();assert.equal(h.calls.length,0);h.select([p(A),p('report:late','Synthetic late')]);catalog.resolve();await loading;assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].platformIds,[A]);assert.match(h.ui.summary(),/已采集 1 \/ 2 平台/);assert.match(h.ui.summary(),/快照不完整/);h.ui.details();assert.match(h.drawers.at(-1).body,/Synthetic late/);
 const late=deferred(),cancelled=harness({prepare:()=>late.promise});const pending=cancelled.ui.load();cancelled.ui.cancel();late.resolve();await pending;assert.equal(cancelled.calls.length,0);
 const failed=harness({prepare:async()=>{throw Error('Synthetic catalog error')}});await failed.ui.load();assert.equal(failed.calls.length,0);assert.match(failed.ui.summary(),/快照读取失败/);
});
