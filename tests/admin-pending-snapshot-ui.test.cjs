/* Synthetic fixtures only: current order readthrough, historical local dates and stale-response protection. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {create,resolvePlatforms,requestPeriod}=require('../admin-preview/live-pending-snapshot.js');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const p=(id,name='Synthetic A',team='Synthetic Team')=>({id,name,sourceName:name,country:'印度',team,source:'AR',timezone:'Asia/Kolkata',currency:'INR'});
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const now=Date.parse('2026-10-03T12:00:00Z');
const previous=date=>new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
function row(id=A,extra={}){return {...p(id),selectedIds:[id],state:'complete',coverageScope:'all_current_pending',wholeStockComplete:true,windowComplete:true,knownCount:9,knownAmount:'1250.50',count:9,amount:'1250.50',observedAt:'2026-10-03T11:59:00Z',captureId:'synthetic-capture',settlementAmounts:[],groups:[{provider:'Synthetic Pay',rawChannel:'Synthetic original',channelType:'wallet',currency:'INR',knownCount:9,knownAmount:'1250.50',count:9,amount:'1250.50',settlementAmounts:[]}],...extra};}
function response(q,extra={}){const current=q.mode==='current',rows=q.platformIds.map(id=>row(id));return {version:2,mode:q.mode,basis:current?'current_all_pending_stock':'local_midnight_pending_snapshot',date:current?null:q.date,sourceDate:current?null:previous(q.date),queriedAt:'2026-10-03T12:00:00Z',currency:'INR',complete:true,expectedPlatformCount:rows.length,receivedPlatformCount:rows.length,missingPlatforms:[],amount:String(rows.length*1250.5),count:rows.length*9,knownAmount:String(rows.length*1250.5),knownCount:rows.length*9,rows,...extra};}
function orderResult(platform=p(A),extra={}){const metric={direction:'withdraw',currency:platform.currency,pending_count:3,pending_amount:'345.67'};return {platform,summary:[metric],groups:{provider:[{...metric,provider:'Synthetic Pay'}]},...extra};}
function harness(options={}){const L={country:'印度',from:'2026-10-02T01:00:00',to:'2026-10-02T02:00:00',queryNow:now,dirty:false,withdrawCatalog:[]},calls=[],drawers=[];let selected=[p(A)],providers=[],timezone='Asia/Kolkata',handler=async q=>response(q),orders={platforms:[p(A)],results:[orderResult()],loading:false,retrying:false,paused:false,failures:[],queriedAt:new Date(now).toISOString(),scopeMatches:true,status:'all'};const ui=create({L,E:escape,N:number,C:v=>Number(v).toLocaleString('en-US'),selected:()=>selected,providers:()=>providers,scopeZone:()=>timezone,currentOrders:()=>orders,prepare:options.prepare,request:q=>{calls.push(q);return handler(q)},render(){},open:(title,body)=>drawers.push({title,body})});return {ui,L,calls,drawers,select:v=>selected=v,providers:v=>providers=v,timezone:v=>timezone=v,handler:v=>handler=v,orders:v=>orders=v,current:()=>{L.from='2026-10-03T00:00:00';L.to='2026-10-03T23:59:59'},get orderContext(){return orders}};}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};

test('historical request reads the selected end-day 00:00 only; day 2 requires source day 1',async()=>{
 const h=harness();h.providers(['Synthetic Pay','Synthetic Pay']);await h.ui.load();assert.deepEqual(h.calls[0],{action:'pendingSnapshot',mode:'midnight',date:'2026-10-02',platformIds:[A],providers:['Synthetic Pay']});
 assert.equal(h.ui.state.data.sourceDate,'2026-10-01');assert.match(h.ui.metric(),/00:00代付中金额 \/ 笔数/);assert.match(h.ui.metric(),/2026-10-02 00:00/);
 h.L.from='2026-09-01T21:22:23';h.L.to='2026-10-02T23:58:57';await h.ui.load();assert.deepEqual(h.calls[1],h.calls[0]);assert.match(h.ui.metric(),/1,250.50/);assert.match(h.ui.metric(),/9 笔/);assert.doesNotMatch(h.ui.metric(),/昨日|前一日|创建时间|较前|近7天/);
 h.handler(q=>response(q,{sourceDate:'2026-10-02'}));await h.ui.load();assert.equal(h.ui.state.status,'error');assert.doesNotMatch(h.ui.metric(),/1,250.50/);
});

test('today reads the same queried creation-range pending orders without a stock request',async()=>{
 const h=harness();h.current();await h.ui.load();assert.equal(h.calls.length,0);assert.equal(h.ui.state.status,'ready');assert.match(h.ui.metric(),/今日实时代付中金额 \/ 笔数/);assert.match(h.ui.metric(),/>345.67</);assert.match(h.ui.metric(),/3 笔/);assert.match(h.ui.subtitle(),/2026-10-03 · Asia\/Kolkata · 查询 17:30:00/);assert.match(h.ui.summary(),/>345.67</);
 h.L.from='2026-09-01T00:00:00';await h.ui.load();assert.equal(h.calls.length,0);assert.match(h.ui.metric(),/本期实时代付中/);assert.match(h.ui.subtitle(),/2026-09-01 至 2026-10-03/);h.L.to='2026-10-04T00:00:00';await h.ui.load();assert.equal(h.calls.length,0);assert.match(h.ui.metric(),/结束日期不能晚于当地今天/);assert.doesNotMatch(h.ui.metric(),/345.67/);
});

test('today follows selected country timezone rather than browser/UTC calendar',async()=>{
 const instant=Date.parse('2026-10-02T23:00:00Z');
 assert.deepEqual(requestPeriod('2026-10-03','Asia/Kolkata',instant),{mode:'current'});
 assert.deepEqual(requestPeriod('2026-10-02','America/Sao_Paulo',instant),{mode:'current'});
 assert.deepEqual(requestPeriod('2026-10-02','Asia/Kolkata',instant),{mode:'midnight',date:'2026-10-02'});
 const h=harness();h.L.queryNow=instant;h.L.to='2026-10-03T10:00:00';await h.ui.load();assert.equal(h.calls.length,0);assert.equal(h.ui.state.data.mode,'current');h.timezone('America/Sao_Paulo');h.L.to='2026-10-02T10:00:00';await h.ui.load();assert.equal(h.calls.length,0);assert.equal(h.ui.state.data.mode,'current');
});

test('invalid calendar day or timezone fails locally without a broad request',async()=>{
 const h=harness();for(const date of ['2026-02-30','2026-13-01','2026-00-03','not-a-date']){h.L.to=date+'T00:00:00';await h.ui.load();assert.equal(h.ui.state.status,'error');assert.match(h.ui.metric(),/有效结束日期/);}
 h.L.to='2026-10-02T00:00:00';h.timezone('Invalid/Zone');await h.ui.load();assert.match(h.ui.metric(),/时区待核对/);assert.equal(h.calls.length,0);
});

test('report-only selection resolves only its unique same-country same-team authorized seed',()=>{
 const report={...p('report:seed'),reportOnly:true};assert.deepEqual(resolvePlatforms([report],[p(A)]),{platformIds:[A],unsupported:[]});
 for(const seeds of [[p(A,'Synthetic A','Other Team')],[{...p(A),country:'巴西'}],[p(A),p(B)]]){const r=resolvePlatforms([report],seeds);assert.equal(r.platformIds.length,0);assert.equal(r.unsupported.length,1);}
 const dedup=resolvePlatforms([p(A),report],[p(A)]);assert.deepEqual(dedup.platformIds,[A]);assert.equal(dedup.unsupported.length,0);
});

test('stale responses cannot overwrite a newer platform/date/mode or restore after cancellation',async()=>{
 const h=harness(),old=deferred();h.handler(()=>old.promise);const first=h.ui.load();h.select([p(B,'Synthetic B')]);h.handler(q=>response(q,{amount:'200.00',count:2,knownAmount:'200.00',knownCount:2,rows:[row(B,{amount:'200.00',count:2,knownAmount:'200.00',knownCount:2})]}));await h.ui.load();old.resolve(response({mode:'midnight',date:'2026-10-02',platformIds:[A]}));await first;assert.match(h.ui.metric(),/>200.00</);assert.doesNotMatch(h.ui.metric(),/1,250/);
 const late=deferred();h.handler(()=>late.promise);const next=h.ui.load();h.ui.cancel();late.resolve(response({mode:'midnight',date:'2026-10-02',platformIds:[B]}));await next;assert.equal(h.ui.state.status,'paused');assert.doesNotMatch(h.ui.metric(),/1,250|200.00/);
 const changed=deferred();h.handler(()=>changed.promise);const another=h.ui.load();h.L.to='2026-10-03T23:59:59';changed.resolve(response({mode:'midnight',date:'2026-10-02',platformIds:[B]}));await another;assert.doesNotMatch(h.ui.metric(),/1,250/);assert.match(h.ui.metric(),/实时代付中/);
});

test('only full-stock verified zero displays 0; partial or absent zero remains unknown',async()=>{
 const h=harness();h.handler(q=>response(q,{amount:'0',count:0,knownAmount:'0',knownCount:0,rows:[row(A,{amount:'0',count:0,knownAmount:'0',knownCount:0,groups:[]})]}));await h.ui.load();assert.match(h.ui.metric(),/>0.00</);assert.match(h.ui.metric(),/>0 笔</);assert.match(h.ui.metric(),/已核实 1 平台/);
 h.handler(q=>response(q,{complete:false,amount:null,count:null,knownAmount:'0',knownCount:0,rows:[row(A,{state:'partial',wholeStockComplete:false,amount:null,count:null,knownAmount:'0',knownCount:0,groups:[]})]}));await h.ui.load();assert.equal(h.ui.state.status,'ready');assert.match(h.ui.metric(),/>—</);assert.doesNotMatch(h.ui.metric(),/>0.00</);assert.match(h.ui.metric(),/暂无已核实合计 · 入库 1\/1 · 1 未完整/);
 h.handler(q=>response(q,{complete:false,amount:null,count:null,knownAmount:null,knownCount:null,receivedPlatformCount:0,rows:[row(A,{state:'missing',coverageScope:'unavailable',wholeStockComplete:false,amount:null,count:null,knownAmount:null,knownCount:null,groups:[]})]}));await h.ui.load();assert.match(h.ui.metric(),/暂无已核实合计/);h.ui.details();assert.match(h.drawers.at(-1).body,/未采到记录/);
});

test('partial positive amount/count uses known subtotal, displays original sources and honest seven-day coverage only in details',async()=>{
 const h=harness();h.handler(q=>response(q,{complete:false,amount:null,count:null,knownAmount:'1250.50',knownCount:9,rows:[row(A,{source:'wg',state:'partial',wholeStockComplete:false,coverageScope:'last_7_created_days',windowStart:'2026-09-25',windowEnd:'2026-10-01',reason:'last_7_created_days_only',amount:null,count:null,groups:[{provider:'Synthetic Pay',rawChannel:'Synthetic original',channelType:'wallet',currency:'INR',knownCount:9,knownAmount:'1250.50',count:null,amount:null,settlementAmounts:[]}]} )]}));await h.ui.load();assert.match(h.ui.metric(),/1,250.50/);assert.match(h.ui.metric(),/9 笔/);assert.match(h.ui.metric(),/已入库小计 · 入库 1\/1 · 1 未完整/);assert.doesNotMatch(h.ui.summary(),/最近7日/);h.ui.details();const text=h.drawers.at(-1).body;assert.match(text,/最近7日创建窗口（2026-09-25 至 2026-10-01）/);assert.match(text,/wg · 已入库小计/);assert.match(text,/Synthetic original/);assert.match(text,/wallet/);assert.match(text,/源刷新时间/);assert.match(text,/2026-10-03 17:29:00/);assert.doesNotMatch(text,/7day|近7天代付中合计/);
});

test('partial known money/count display independently; an unknown or partial zero counterpart remains dash',async()=>{
 const h=harness();for(const [knownCount,knownAmount,countText,amountText] of [[17,null,'17 笔','—'],[null,'65.50','— 笔','65.50'],[0,'65.50','— 笔','65.50'],[17,'0','17 笔','—']]){
  h.handler(q=>response(q,{complete:false,count:null,amount:null,knownCount,knownAmount,receivedPlatformCount:0,rows:[row(A,{state:'partial',wholeStockComplete:false,count:null,amount:null,knownCount,knownAmount,captureId:null,observedAt:null,lastRecordAt:'2026-10-03T11:30:00Z',groups:[]})]}));await h.ui.load();assert.equal(h.ui.state.status,'ready');assert.match(h.ui.metric(),new RegExp('>'+amountText+'<'));assert(h.ui.metric().includes(countText));assert.match(h.ui.metric(),/入库 1\/1/);assert.doesNotMatch(h.ui.metric(),/>0.00<|>0 笔</);h.ui.details();assert.match(h.drawers.at(-1).body,/完整 0\/1/);assert.match(h.drawers.at(-1).body,/入库 2026-10-03 17:00:00/);
 }
});

test('stale partial values remain labeled and never become complete totals',async()=>{
 const h=harness();h.handler(q=>response(q,{complete:false,amount:null,count:null,rows:[row(A,{state:'stale',reason:'latest_capture_stale',wholeStockComplete:false,amount:null,count:null})]}));await h.ui.load();assert.match(h.ui.metric(),/已入库小计/);assert.doesNotMatch(h.ui.metric(),/已核实 1 平台/);h.ui.details();assert.match(h.drawers.at(-1).body,/数据待刷新/);
});

test('unsupported selected platform makes a verified response only a visible subtotal',async()=>{
 const h=harness();h.select([p(A),p('report:unsupported','Synthetic unconnected')]);await h.ui.load();assert.match(h.ui.metric(),/已入库小计 · 入库 1\/2 · 1 未完整/);h.ui.details();const text=h.drawers.at(-1).body;assert.match(text,/Synthetic unconnected/);assert.match(text,/尚未接入/);
});

test('native settlement money stays separate from fiat totals and escaped original channel',async()=>{
 const h=harness();h.handler(q=>response(q,{rows:[row(A,{source:'wg',settlementAmounts:[{currency:'USDT',amount:'15.25',count:9,missingCount:0,state:'complete'}],groups:[{provider:'<script>Fake</script>',rawChannel:'TRON-PAY',channelType:'USDT-TRC20',currency:'INR',knownCount:9,knownAmount:'1250.50',count:9,amount:'1250.50',settlementAmounts:[{currency:'USDT',amount:'15.25',count:9,missingCount:1,state:'partial'}]}]} )]}));await h.ui.load();assert.match(h.ui.metric(),/1,250.50/);assert.doesNotMatch(h.ui.metric(),/1,265.75|15.25/);h.ui.details();const text=h.drawers.at(-1).body;assert.match(text,/原生结算金额/);assert.match(text,/USDT 15.25/);assert.match(text,/（部分）/);assert.match(text,/USDT-TRC20/);assert.match(text,/&lt;script&gt;Fake&lt;\/script&gt;/);assert.doesNotMatch(text,/<script>/);
});

test('truncated original-channel groups explicitly disclose the 200-group limit without changing known stock totals',async()=>{
 const h=harness(),groups=Array.from({length:200},(_,i)=>({provider:'Synthetic Pay '+i,rawChannel:'Original '+i,channelType:'wallet',currency:'INR',knownCount:1,knownAmount:'1.00',count:null,amount:null,settlementAmounts:[]}));
 h.handler(q=>response(q,{complete:false,count:null,amount:null,knownCount:250,knownAmount:'250.00',rows:[row(A,{state:'partial',wholeStockComplete:false,count:null,amount:null,knownCount:250,knownAmount:'250.00',groupsLimited:true,groups})]}));
 await h.ui.load();assert.match(h.ui.metric(),/>250.00</);assert.match(h.ui.metric(),/250 笔/);h.ui.details();const html=h.drawers.at(-1).body;assert.match(html,/原通道明细（200） · 仅显示前200组，仍有未展示/);assert.match(html,/Original 199/);assert.doesNotMatch(html,/Original 200/);
 h.handler(q=>response(q));await h.ui.load();h.ui.details();assert.doesNotMatch(h.drawers.at(-1).body,/仅显示前200组|仍有未展示/);
});

test('legacy seven-day response, malformed scope, mixed fiat and mismatched midnight/current are rejected',async()=>{
 const h=harness();for(const bad of [{version:1,basis:'seven_day_pending_snapshot'},{basis:'orders'},{sourceDate:'2026-10-02'},{date:'2026-10-01'},{rows:null},{receivedPlatformCount:0},{rows:[row(B)]},{currency:'VND'},{rows:[row(A,{currency:'VND'})]},{complete:false,amount:'1250.50',count:9},{rows:[row(A,{state:'partial',wholeStockComplete:false})]},{count:100.5},{knownCount:100.5},{count:true},{knownCount:true},{knownAmount:true},{rows:[row(A,{count:1.5})]},{rows:[row(A,{knownCount:1.5})]},{count:1},{knownCount:'9007199254740992'},{rows:[row(A,{groups:[{currency:'INR',count:null,amount:null,knownCount:100.5,knownAmount:'5',settlementAmounts:[]}]})]},{rows:[row(A,{settlementAmounts:[{currency:'USDT',amount:'1',count:1.5,missingCount:0,state:'partial'}]})]}]){h.handler(q=>response(q,bad));await h.ui.load();assert.equal(h.ui.state.status,'error',JSON.stringify(bad));assert.doesNotMatch(h.ui.metric(),/1,250.50/);}
 h.L.to='2026-10-03T23:59:59';h.handler(q=>response(q,{mode:'midnight',date:'2026-10-03',sourceDate:'2026-10-02'}));const count=h.calls.length;await h.ui.load();assert.equal(h.calls.length,count);assert.equal(h.ui.state.data.basis,'created_range_latest_pending_orders');assert.match(h.ui.metric(),/345.67/);
 h.select([{...p('report:unbound'),reportOnly:true}]);await h.ui.load();assert.equal(h.calls.length,count);assert.match(h.ui.metric(),/0\/1 平台 · 1 未读取/);h.ui.details();assert.match(h.drawers.at(-1).body,/未接入逐笔订单/);
});

test('transport error cannot be rendered as no data or a zero total',async()=>{
 const h=harness();h.handler(async()=>{throw Error('Synthetic timeout')});await h.ui.load();assert.match(h.ui.metric(),/待付读取失败/);assert.doesNotMatch(h.ui.metric(),/>0.00<|暂无已核实合计/);h.ui.details();assert.match(h.drawers.at(-1).body,/重试/);
});

test('saved tabs retain their own v2 data; loading/cancelled/dirty restores expose no old full total',async()=>{
 const h=harness();await h.ui.load();const saved=h.ui.capture();h.ui.restore(null);assert.doesNotMatch(h.ui.metric(),/1,250/);h.ui.restore(saved);assert.match(h.ui.metric(),/1,250/);h.L.dirty=true;assert.doesNotMatch(h.ui.metric(),/1,250/);h.L.dirty=false;
 const wait=deferred();h.handler(()=>wait.promise);const pending=h.ui.load(),paused=h.ui.capture();assert.equal(paused.status,'paused');h.ui.restore(paused);wait.resolve(response({mode:'midnight',date:'2026-10-02',platformIds:[A]}));await pending;assert.equal(h.ui.state.status,'paused');assert.doesNotMatch(h.ui.metric(),/1,250/);
});

test('load resolves platform mapping only after preparing the same-query directory; cancellation prevents request',async()=>{
 const catalog=deferred(),h=harness({prepare:()=>catalog.promise});h.select([p('report:late','Synthetic late')]);const loading=h.ui.load();assert.equal(h.calls.length,0);h.L.withdrawCatalog=[p(B,'Synthetic late')];catalog.resolve();await loading;assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].platformIds,[B]);assert.equal(h.ui.state.status,'ready');
 const late=deferred(),cancelled=harness({prepare:()=>late.promise});const pending=cancelled.ui.load();cancelled.ui.cancel();late.resolve();await pending;assert.equal(cancelled.calls.length,0);
 const failed=harness({prepare:async()=>{throw Error('Synthetic catalog error')}});await failed.ui.load();assert.equal(failed.calls.length,0);assert.match(failed.ui.summary(),/待付读取失败/);
});

test('parent summary header consumes overlay dynamic title, local subtitle and detail label',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-pages-reference.js'),'utf8'),context={window:{},console};vm.createContext(context);vm.runInContext(source,context);
 const h=harness(),c={L:{direction:'all',results:[],feeLookupRows:[],overviewSections:{status:'ready'},workorders:{}},E:escape,N:number,C:String,R:()=> '—',plus:()=>({}),combine:()=>[],groupRows:()=>[],empty:()=>'',table:()=>'',box:()=>'',pager:()=>'',totals:()=>'',comparisonRows:()=>[],compareMetric:()=>'',chart:()=>'',matrixBody:()=>'',latencyView:()=>'',detailsView:()=>'',providersView:()=>'',platformsView:()=>'',pagedTable:()=>'',feeForRow:()=>({}),ensureFeeLookup(){},providerCell:()=>'',pendingSnapshot:{title:()=> '实时代付中',subtitle:()=> '2026-10-03 17:30:00 · Asia/Kolkata',detailLabel:()=> '平台明细 →',summary:()=> '<p>Synthetic stock</p>',metric:()=> ''},overviewChart:()=>'',overviewAmounts:()=>'',overviewAnalysisRender:fn=>fn(),businessHeaders:[],businessCells:()=>[]};
 context.window.HensemProviderSummary={overviewDimensions:()=>[],buildRows:()=>[],isProviderBusiness:()=>true,feeSummary:()=>({amount:null,successCount:0}),feeCoverageText:()=>'',knownNumber:()=>null,fraction:()=>null};
 const page=context.window.HensemLivePages.create(c);let html=page.render('overview');assert.match(html,/<h2>实时代付中<\/h2>/);assert.match(html,/2026-10-03 17:30:00/);assert.match(html,/平台明细 →/);assert.doesNotMatch(html,/近7天代付中/);
 c.pendingSnapshot.title=()=> '00:00代付中';c.pendingSnapshot.subtitle=()=> '2026-10-02 00:00 · Asia/Kolkata';html=page.render('overview');assert.match(html,/<h2>00:00代付中<\/h2>/);assert.match(html,/2026-10-02 00:00/);
});

test('current values and provider details read through aggregate updates without another load',async()=>{
 const h=harness();h.current();await h.ui.load();assert.match(h.ui.metric(),/>345.67</);h.orderContext.results=[orderResult(p(A),{summary:[{direction:'withdraw',currency:'INR',pending_count:7,pending_amount:'901.25'}],groups:{provider:[{direction:'withdraw',currency:'INR',provider:'<script>Provider</script>',pending_count:0,pending_amount:'0'},{direction:'charge',currency:'INR',provider:'Ignore collection',pending_count:50,pending_amount:'50000'}]}})];
 assert.match(h.ui.metric(),/>901.25</);assert.match(h.ui.summary(),/>7</);h.ui.details();const html=h.drawers.at(-1).body;assert.match(html,/订单已读取/);assert.match(html,/本次查询读到的最新采集状态为准/);assert.match(html,/创建范围 2026-10-03 00:00:00 至 2026-10-03 23:59:59/);assert.match(html,/三方明细（1）/);assert.match(html,/&lt;script&gt;Provider&lt;\/script&gt;/);assert.match(html,/>0<\/td><td>0.00</);assert.doesNotMatch(html,/全量已核实|原通道|Ignore collection|<script>/);assert.equal(h.calls.length,0);
});

test('empty successful native responses prove zero, while unreturned and report-only platforms remain unknown',async()=>{
 const h=harness();h.current();h.orderContext.results=[orderResult(p(A),{summary:[],groups:{provider:[]}})];await h.ui.load();assert.match(h.ui.metric(),/>0.00</);assert.match(h.ui.metric(),/>0 笔</);assert.match(h.ui.metric(),/已读取 1\/1 平台/);
 h.select([p(A),p(B,'Unread B')]);h.orderContext.platforms=[p(A),p(B)];assert.doesNotMatch(h.ui.metric(),/>0.00<|>0 笔</);assert.match(h.ui.metric(),/已读取小计 · 1\/2 平台 · 1 未读取/);
 h.select([{...p(A),id:'report:only',reportOnly:true}]);h.L.withdrawCatalog=[p(A)];assert.doesNotMatch(h.ui.metric(),/>0.00<|>0 笔</);h.ui.details();assert.match(h.drawers.at(-1).body,/未接入逐笔订单/);
});

test('pending amount and count retain separate validity, including valid zeroes and missing fields',async()=>{
 const h=harness();h.current();for(const [count,amount,countText,amountText]of [[7,null,'7 笔','—'],[null,'80.25','— 笔','80.25'],[0,null,'0 笔','—'],[null,'0','— 笔','0.00'],[undefined,undefined,'— 笔','—']]){
  h.orderContext.results=[orderResult(p(A),{summary:[{direction:'withdraw',currency:'INR',pending_count:count,pending_amount:amount}]})];await h.ui.load();assert(h.ui.metric().includes(countText));assert(h.ui.metric().includes('>'+amountText+'<'));assert.match(h.ui.metric(),/待补齐/);
 }
});

test('current failed or paused reads preserve only returned subtotals and offer ordinary query retry',async()=>{
 const h=harness();h.current();h.select([p(A),p(B,'Failed <B>')]);h.orderContext.platforms=[p(A),p(B)];h.orderContext.failures=[{id:B,message:'Timeout <test>'}];await h.ui.load();assert.match(h.ui.metric(),/345.67/);assert.match(h.ui.metric(),/3 笔/);assert.match(h.ui.metric(),/已读取小计 · 1\/2 平台 · 1 未读取/);assert.match(h.ui.metric(),/livePendingSnapshotRetry\(\).*重试未完成平台/);h.ui.details();assert.match(h.drawers.at(-1).body,/Timeout &lt;test&gt;/);assert.match(h.drawers.at(-1).body,/Failed &lt;B&gt;/);
 h.orderContext.failures=[];h.orderContext.paused=true;assert.match(h.ui.metric(),/订单读取已暂停/);assert.match(h.ui.metric(),/继续读取/);h.orderContext.paused=false;h.orderContext.loading=true;h.orderContext.results=[];assert.match(h.ui.metric(),/正在读取订单 · 0\/2 平台/);assert.doesNotMatch(h.ui.metric(),/345.67|>0.00<|>0 笔</);assert.equal(h.calls.length,0);
});

test('mixed or missing currency cannot produce a fiat sum, but valid pending counts remain visible',async()=>{
 const h=harness();h.current();h.select([p(A),{...p(B),currency:'USDT'}]);h.orderContext.platforms=[p(A),{...p(B),currency:'USDT'}];h.orderContext.results=[orderResult(),orderResult({...p(B),currency:'USDT'})];await h.ui.load();assert.match(h.ui.metric(),/>—</);assert.match(h.ui.metric(),/6 笔/);assert.match(h.ui.metric(),/多币种金额不相加/);assert.doesNotMatch(h.ui.metric(),/691.34/);h.ui.details();assert.match(h.drawers.at(-1).body,/INR/);assert.match(h.drawers.at(-1).body,/USDT/);
 h.select([p(A)]);h.orderContext.platforms=[p(A)];h.orderContext.results=[orderResult(p(A),{summary:[{direction:'withdraw',currency:null,pending_count:0,pending_amount:'0'}]})];assert.match(h.ui.metric(),/>—</);assert.match(h.ui.metric(),/0 笔/);assert.match(h.ui.metric(),/金额待补齐/);
});

test('dirty, changed query scope and success-only filters never expose previous current pending values',async()=>{
 const h=harness();h.current();await h.ui.load();const saved=h.ui.capture();h.L.dirty=true;assert.doesNotMatch(h.ui.metric(),/345.67/);h.L.dirty=false;h.orderContext.scopeMatches=false;h.ui.restore(saved);assert.doesNotMatch(h.ui.metric(),/345.67/);h.orderContext.scopeMatches=true;h.orderContext.status='success';assert.match(h.ui.metric(),/请选择全部状态或代付中/);assert.doesNotMatch(h.ui.metric(),/345.67|>0.00<|>0 笔</);h.orderContext.status='pending';assert.match(h.ui.metric(),/345.67/);
});

test('current ignores wrong, duplicate, missing-summary and failed native results rather than inventing zero',async()=>{
 const h=harness();h.current();for(const results of [[orderResult(p(B))],[orderResult(),orderResult()],[{platform:p(A)}]]){h.orderContext.results=results;await h.ui.load();assert.doesNotMatch(h.ui.metric(),/345.67|>0.00<|>0 笔</);}
 h.orderContext.results=[orderResult()];h.orderContext.failures=[{id:A,message:'Synthetic failure'}];assert.doesNotMatch(h.ui.metric(),/345.67/);assert.match(h.ui.metric(),/0\/1 平台 · 1 未读取/);
});

test('current orders need no source catalog preparation and ignore a late historical response',async()=>{
 let prepared=0;const h=harness({prepare:async()=>{prepared++}});h.current();await h.ui.load();assert.equal(prepared,0);assert.equal(h.calls.length,0);assert.match(h.ui.metric(),/345.67/);
 const late=deferred(),history=harness({prepare:()=>late.promise});const loading=history.ui.load();history.current();late.resolve();await loading;assert.equal(history.calls.length,0);assert.match(history.ui.metric(),/345.67/);
 const data=deferred(),switching=harness();switching.handler(()=>data.promise);const pending=switching.ui.load();await Promise.resolve();switching.current();data.resolve(response({mode:'midnight',date:'2026-10-02',platformIds:[A]}));await pending;assert.match(switching.ui.metric(),/345.67/);assert.doesNotMatch(switching.ui.metric(),/1,250.50/);assert.equal(switching.calls.length,1);
});
