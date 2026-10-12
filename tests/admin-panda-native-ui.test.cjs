/* Synthetic Panda facts only. These tests execute production UI modules with no network. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
function helpers(file,names){const pre=fs.readFileSync(path.join(__dirname,file),'utf8').split(/\ntest\(/)[0];return new Function('require','__dirname',pre+';return {'+names+'};')(require,__dirname)}
const {harness,settle,aggregate,P}=helpers('admin-navigation-performance.test.cjs','harness,settle,aggregate,P');
const PANDA={...P,id:'77777777-7777-4777-8777-777777777777',name:'Synthetic Panda',source:'panda',sourceName:'platform_SYNTHETIC',sourceNativeDetail:true,nativeSource:'PANDA',sourcePolicy:'details_only',country:'巴西',scopeGroup:'BR',currency:'BRL',timezone:'America/Sao_Paulo',capabilities:{systemOrderId:false,thirdPartyOrderNumber:false,utr:false,memberIdentity:false,memberDailyAvailable:false,autoWithdrawAvailable:false,operatorAvailable:false,workordersAvailable:false,pendingSnapshotAvailable:false,analysisOrdersAvailable:true,actualAmount:true,recordedFee:true,historicalFees:false,successCoverageAvailable:false,successTimeAvailable:false,chargeSuccessTimeAvailable:false,withdrawSuccessTimeAvailable:false,sourceCompletedTimeAvailable:true,chargeSourceCompletedTimeAvailable:true,withdrawSourceCompletedTimeAvailable:false,sourceCompletionTimeBasis:'source_completed_at',paymentSuccessTimeAvailable:false,latencyAvailable:false,chargeLatencyAvailable:false,withdrawLatencyAvailable:false,latencyBasis:'order_processing_duration',reviewedWithdrawalsOnly:true}};
function scope(h,direction='all'){Object.assign(h.L,{country:'巴西',currency:'BRL',from:'2026-09-22T00:00:00',to:'2026-09-22T23:59:59',direction,platform:PANDA.id});h.L.multi.platform=[PANDA.id];h.L.multi.direction=direction==='all'?[]:[direction];}
function result(p=PANDA){const r=aggregate(p,10);r.capabilities=p.capabilities;r.summary=['charge','withdraw'].map(direction=>({...r.summary[0],direction,currency:'BRL',all_count:10,success_count:null,success_amount:null,created_success_count:6,created_success_amount:600,pending_count:direction==='charge'?1:null,pending_amount:direction==='charge'?100:null}));for(const key of Object.keys(r.groups))r.groups[key]=r.summary.map(row=>({...r.groups[key][0],...row}));return r;}
function show(h,r=result()){Object.assign(h.L,{results:[r],queryPlatforms:[PANDA],pageQueried:true,overviewQueried:true,dirty:false,loading:false,comparisonStatus:'idle',loadedView:'full',feeLookupRows:[],feeLookupLoading:false});h.c.render();}
function detailRow(extra={}){return {id:'panda-safe-id',order_number:'safe-order',direction:'withdraw',provider:null,raw_provider:null,channel_id:null,channel_name:null,currency:'BRL',amount:123.45,actual_amount:null,withdraw_fee:null,status:'refuse',status_group:'unknown',created_at:'2026-09-22T04:00:00Z',source_updated_at:'2026-09-22T05:00:00Z',success_at:null,synced_at:'2026-09-22T06:00:00Z',...extra};}

test('Panda native order request uses its UUID, Brazil midnight, server pagination and restricted identity searches',async()=>{
 const h=harness({platforms:[PANDA],page:'orders'});await settle();scope(h);h.L.memberId='old-member';h.c.render();let filters=h.nodes.get('liveFilters').innerHTML;assert.match(filters,/熊猫系统/);assert.match(filters,/id="live-memberId"[^>]*disabled/);assert.match(filters,/id="live-systemOrderId"[^>]*disabled/);assert.equal(h.L.memberId,'');await h.c.liveQuery();await settle();let q=h.calls.find(q=>q.action==='details');assert(q);assert.equal(q.platformId,PANDA.id);assert.equal(q.startAt,'2026-09-22T03:00:00.000Z');assert.equal(q.endAt,'2026-09-23T03:00:00.000Z');assert.equal(q.currency,'BRL');h.c.livePage(2,'server');await settle();q=h.calls.filter(q=>q.action==='details').at(-1);assert.equal(q.offset,20);assert.equal(q.limit,20);
});

test('Panda reviewed withdrawals keep creation-cohort facts, unavailable success metrics and explicit scope',async()=>{
 const h=harness({platforms:[PANDA],page:'time'});await settle();scope(h);show(h);const html=h.html();assert.match(html,/data-panda-existing-source/);assert.match(html,/已审核提现创建单当前成功 6 \/ 10 笔/);assert.match(html,/旧日报快照独立展示，不与明细相加/);assert.match(html,/成功时间统计|成功时间窗口/);assert.doesNotMatch(html,/本期成功 0 \/ 本期创建/);
});

test('Panda success-time filtering stays closed until that axis has complete coverage',async()=>{
 const h=harness({platforms:[PANDA],page:'orders'});await settle();for(const direction of ['all','withdraw','charge']){scope(h,direction);h.L.status='success';h.c.render();assert.match(h.nodes.get('liveFilters').innerHTML,/<option value="success" disabled selected/);const n=h.calls.length;await h.c.liveQuery();await settle();assert.equal(h.calls.slice(n).filter(q=>q.action==='details').length,0);}assert.match(h.nodes.get('liveFilters').innerHTML,/成功时间窗口尚未完整核验/);
});

test('Panda order fields retain null, unknown state and channel identity without unsupported IDs or withdrawal completion',async()=>{
 const h=harness({platforms:[PANDA],page:'orders'});await settle();scope(h,'withdraw');show(h);h.L.detail={platform:PANDA,total:1,rows:[detailRow()]};h.c.render();let html=h.html();assert.match(html,/未识别三方/);assert.match(html,/通道/);assert.match(html,/未知/);assert.doesNotMatch(html,/核对标记|成功时间（源订单完成时间）<\/th>/);h.c.liveOrder(0);html=h.drawers.at(-1).html;for(const unavailable of ['会员 ID','系统 ID','三方订单号','UTR','费率版本','成功时间（源订单完成时间）'])assert(!html.includes(unavailable));assert.match(html,/<td>实际金额<\/td><td>—<\/td>/);assert.match(html,/<td>已记录手续费<\/td><td>—<\/td>/);assert.match(html,/refuse/);assert.match(html,/源更新时间/);
 h.L.detail.rows=[detailRow({direction:'charge',channel_name:'Same provider / channel B',channel_id:'chan-b',provider:'Synthetic pay',status:'PAID',status_group:'success',success_at:'2026-09-22T05:00:00Z'})];h.c.liveOrder(0);assert.match(h.drawers.at(-1).html,/Same provider \/ channel B/);assert.match(h.drawers.at(-1).html,/成功时间（源订单完成时间）/);
});

test('Panda provider drilldown cannot switch reviewed withdrawal to success axis',async()=>{
 const h=harness({platforms:[PANDA],page:'provider_daily'});await settle();scope(h,'withdraw');show(h);h.setHandler(q=>q.action==='details'?{platform:PANDA,total:10,rows:Array.from({length:10},()=>detailRow())}:{rows:[]});await h.c.liveProviderOrders('Synthetic provider','panda','withdraw');assert(h.calls.some(q=>q.action==='details'&&q.status==='all'));let html=h.drawers.at(-1).html;assert.doesNotMatch(html,/onclick="liveProviderOrderBasis\('success'\)/);const n=h.calls.length;await h.c.liveProviderOrderBasis('success');assert.equal(h.calls.length,n);h.c.liveProviderOrder(0);assert.doesNotMatch(h.drawers.at(-1).html,/会员 ID|系统订单号|三方订单号|成功时间（源订单完成时间）/);
});

test('Panda reviewed withdrawals never qualify as current or midnight pending stock',async()=>{
 const {resolvePlatforms}=require('../admin-preview/live-pending-snapshot.js');const resolved=resolvePlatforms([PANDA],[]);assert.equal(resolved.platformIds.length,0);assert.equal(resolved.unsupported.length,1);const {harness:pending}=helpers('admin-pending-snapshot-ui.test.cjs','harness');const h=pending();h.current();h.select([PANDA]);h.orders({...h.orderContext,platforms:[PANDA],results:[result()]});await h.ui.load();assert.equal(h.calls.length,0);assert.match(h.ui.metric(),/>—</);assert.doesNotMatch(h.ui.metric(),/>0.00<|>0 笔</);
});

test('Panda native catalog does not activate workorders or submission analysis',async()=>{
 const h=harness({platforms:[PANDA],page:'providers'});await settle();scope(h);await h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='workorders').length,0);const risk=harness({platforms:[PANDA],page:'events',submission:true});await settle();scope(risk);await risk.c.liveQuery();await settle();assert.equal(risk.calls.filter(q=>q.action==='submissionAnalysis').length,0);
});

test('Panda source completion fields never unlock full latency without success coverage',()=>{
 const {setup,result:durationResult}=helpers('admin-duration-drilldown.test.cjs','setup,result');const r=durationResult(PANDA.id);r.platform=PANDA;r.capabilities={...PANDA.capabilities,latencyAvailable:true,successTimeAvailable:true};for(const direction of ['charge','withdraw','all']){const html=setup([r],{direction}).render('latency');assert.match(html,/暂不可统计/);assert.doesNotMatch(html,/>100\.00%|KB/);}
});

test('Panda exports include reviewed-scope and independent snapshot provenance, never KB-labelled semantics',async()=>{
 const h=harness({platforms:[PANDA],roleAllowed:()=>true});await settle();scope(h);show(h);h.nodes.get('page').querySelectorAll=()=>[{closest:()=>null,querySelectorAll:()=>[{cells:[{innerText:'全部金额'},{innerText:'100.00'}],closest:()=>null}]}];h.c.liveExport();const csv=await h.blobs[0].text();assert.match(csv,/熊猫按创建区间读取已入库订单/);assert.match(csv,/提现仅已审核范围/);assert.doesNotMatch(csv,/KB成功/);
});

test('Panda native coverage never suppresses or adds the independent Google snapshot feed',async()=>{
 const {fixture,feed}=helpers('admin-report-data.test.cjs','fixture,feed');const native={...PANDA,team:'胖虎'};
 const f=fixture({catalog:[native],feeds:[feed({system:'PANDA',name:native.name,rawPlatform:'platform_SYNTHETIC',team:'胖虎',country:'巴西',rawCountry:'BR',currency:'BRL'})]});f.L.results=[{...result(native),capabilities:{...native.capabilities,sourceCompletenessVerified:true}}];f.L.dirty=false;f.L.loading=false;
 await f.page.load({country:'巴西',sources:['panda'],direction:'charge',from:f.L.from,to:f.L.to});const q=f.calls.find(q=>q.action==='reportSummary');assert(q);assert.equal(q.feeds[0].system,'PANDA');assert.equal(q.feeds[0].sourceKind,'google_sheets');const html=f.page.render({page:'overview'});assert.match(html,/Google 表格 → Supabase/);assert.match(html,/300\.00/);assert.doesNotMatch(html,/入库明细汇总/);assert.equal(f.page.state.result.feeds[0].groups[0].metrics.amount,300);
});

test('Panda native identities cannot activate automatic/operator statistics while the old snapshot seed remains selectable',async()=>{
 const vm=require('node:vm'),source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-withdraw-pages.js'),'utf8');const calls=[],root={Date,Intl,HensemLiveFilters:{multi:()=>''},document:{getElementById:()=>null,querySelector:()=>null}};root.window=root;vm.runInNewContext(source,root);const L={catalogReady:true,catalog:[PANDA],country:'巴西',from:'2026-10-09',to:'2026-10-09',withdrawCatalog:[]};const page=root.HensemLiveWithdrawPages.create({L,page:()=> 'auto_withdraw',E:String,C:String,N:String,R:()=>'',box:(_,body)=>body,table:()=>'',render(){},request:async q=>{calls.push(q);return {rows:[],total:0}}});await page.load();assert.equal(calls.length,0);assert.match(page.render(),/没有可读取的出款平台/);L.withdrawCatalog=[{name:PANDA.name,country:'巴西',source:'PANDA',team:PANDA.team}];await page.load();assert.equal(calls.length,1);assert.equal(calls[0].action,'autoWithdraw');
});

test('Panda success and daily comparison keep source-specific basis and null withdrawal success',async()=>{
 const {api,props}=helpers('admin-success-analysis-ui.test.cjs','api,props'),a=api(),input=props({queryPlatforms:[PANDA],results:[result()],workorders:null});const m=a.buildModel(input);assert.equal(m.rows[0].charge[0].value,null);assert.equal(m.rows[0].withdraw[0].value,null);let html=a.render(input);assert.match(html,/熊猫成功时间窗口尚未完整核验/);assert.match(html,/仅含已审核提现/);assert.doesNotMatch(html,/KB成功/);
 const {harness:daily}=helpers('admin-daily-comparison-ui.test.cjs','harness'),h=daily({platforms:[PANDA]});Object.assign(h.L,{country:'巴西',currency:'BRL'});await h.module.load();h.c.liveDailyDirection('withdraw');await h.module.load();assert.equal(h.module.model().now.success_count,null);html=h.module.render();assert.match(html,/提现仅已审核范围/);assert.doesNotMatch(html,/KB成功/);
});

test('Panda explicitly unsupported amount/fee columns are omitted instead of shown as zero',async()=>{
 const p={...PANDA,capabilities:{...PANDA.capabilities,actualAmount:false,recordedFee:false}},h=harness({platforms:[p],page:'orders'});await settle();scope(h);show(h,result(p));h.L.detail={platform:p,total:1,rows:[detailRow({actual_amount:0,withdraw_fee:0})]};h.c.render();assert.doesNotMatch(h.html(),/<th[^>]*>实际金额|<th[^>]*>已记录手续费/);h.c.liveOrder(0);assert.doesNotMatch(h.drawers.at(-1).html,/实际金额|已记录手续费/);
});

test('Panda partial details remain paginated and explicitly incomplete without fabricated overview totals',async()=>{
 const h=harness({platforms:[PANDA],page:'orders'});await settle();scope(h);h.setHandler(q=>q.action==='details'?{platform:PANDA,pandaCoverage:{complete:false,directions:[]},total:1,rows:[detailRow({channel_type:'Original source channel'})]}:{rows:[],groups:{}});await h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0);assert.equal(h.calls.filter(q=>q.action==='details').length,1);assert.match(h.html(),/已入库部分，尚未完整采集/);assert.match(h.html(),/Original source channel/);assert.doesNotMatch(h.html(),/id="df-collect"|id="df-payout"|所选创建窗口已完整采集/);
});

test('Panda incomplete, missing or wrong-window receipt coverage cannot enter aggregate totals or cache',async()=>{
 for(const evidence of [undefined,{complete:false,directions:[]},{complete:true,directions:[]}]){const h=harness({platforms:[PANDA],page:'time'});await settle();scope(h);h.setHandler(q=>q.action==='aggregate'?{...result(),pandaCoverage:evidence}:{rows:[],total:0});await h.c.liveQuery();await settle();assert.equal(h.L.results.length,0);assert.match(h.L.queryWarnings.join(' '),/尚未完整采集/);assert.doesNotMatch(h.html(),/本期成功 6/);}
 const h=harness({platforms:[PANDA],page:'time'});await settle();scope(h);h.setHandler(q=>q.action==='aggregate'?{...result(),startAt:q.startAt,endAt:q.endAt,pandaCoverage:{complete:true,directions:['charge','withdraw'].map(direction=>({direction,complete:true,startAt:q.startAt,endAt:q.endAt}))}}:{rows:[],total:0});await h.c.liveQuery();await settle();assert.equal(h.L.results.length,1);assert.equal(h.L.queryFailures.length,0);assert.match(h.html(),/所选创建窗口已完整采集/);assert.match(h.html(),/充值创建单当前成功 6 \/ 10 笔/);
});


test('Panda native catalog injection cannot replace a legacy feed identity or authorize native aggregate on existing summary pages',async()=>{
 const {feed,summary}=helpers('admin-report-data.test.cjs','feed,summary');const old=feed({system:'PANDA',name:PANDA.name,rawPlatform:PANDA.sourceName,team:'胖虎',country:'巴西',rawCountry:'BR',currency:'BRL'});
 for(const page of ['overview','merchants','providers','provider_payout']){
  const h=harness({page,reports:true,platforms:[PANDA],beforeLive(c){const create=c.HensemLiveReportData.create;c.HensemLiveReportData.create=options=>(c.pandaTestReport=create(options));},handler:q=>q.action==='catalog'?{platforms:[PANDA]}:q.action==='collectedData'?{rows:[old]}:q.action==='reportSummary'?{feeds:q.feeds.map(f=>summary(f))}:{rows:[],total:0}});
  await settle();await h.c.pandaTestReport.loadCatalog();const catalog=h.c.pandaTestReport.catalog();assert.equal(catalog.length,1);assert.equal(catalog[0].reportOnly,true);assert(catalog[0].id.startsWith('report:'));assert.equal(catalog[0].orderPlatformIds.length,0);assert.equal(catalog[0].feeds[0].rawPlatform,PANDA.sourceName);
  scope(h);h.L.platform='all';h.L.multi.platform=[];await h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='aggregate'&&q.platformId===PANDA.id).length,0,page);assert.equal(h.L.results.length,0);assert.doesNotMatch(h.nodes.get('liveFilters').innerHTML,/入库明细<|入库明细</);
  await h.c.pandaTestReport.load({country:'巴西',sources:['panda'],direction:page==='provider_payout'?'withdraw':'charge',from:h.L.from,to:h.L.to});const q=h.calls.find(q=>q.action==='reportSummary');assert(q);assert.equal(q.feeds[0].system,'PANDA');assert.equal(q.feeds[0].platform,PANDA.sourceName);assert.equal(q.feeds[0].sourceKind,'google_sheets');assert.equal(h.c.pandaTestReport.state.result.feeds[0].groups[0].metrics.amount,300);assert.match(h.c.pandaTestReport.render({page}),/300\.00/);
 }
});


test('Panda completeness notice requires every selected platform, never only successful results',async()=>{
 const second={...PANDA,id:'88888888-8888-4888-8888-888888888888',name:'Synthetic Panda B'},h=harness({platforms:[PANDA,second],page:'time'});await settle();scope(h);h.L.platform='all';h.L.multi.platform=[PANDA.id,second.id];const startAt='2026-09-22T03:00:00.000Z',endAt='2026-09-23T03:00:00.000Z',covered=p=>({...result(p),startAt,endAt,pandaCoverage:{complete:true,directions:['charge','withdraw'].map(direction=>({direction,complete:true,startAt,endAt}))}});
 show(h,covered(PANDA));h.L.queryPlatforms=[PANDA,second];h.L.queryFailures=[{id:second.id,message:'Synthetic unavailable'}];h.c.render();assert.match(h.html(),/已入库部分，尚未完整采集/);assert.doesNotMatch(h.html(),/所选创建窗口已完整采集/);
 h.L.queryFailures=[];h.c.render();assert.doesNotMatch(h.html(),/所选创建窗口已完整采集/,'missing result cannot qualify even without an error item');h.L.results.push(covered(second));h.c.render();assert.match(h.html(),/所选创建窗口已完整采集/);
});

test('Panda cached results from another window or direction never claim current scope complete',async()=>{
 const h=harness({platforms:[PANDA],page:'time'});await settle();scope(h);const startAt='2026-09-22T03:00:00.000Z',endAt='2026-09-23T03:00:00.000Z',r={...result(),startAt,endAt,pandaCoverage:{complete:true,directions:['charge','withdraw'].map(direction=>({direction,complete:true,startAt,endAt}))}};show(h,r);assert.match(h.html(),/所选创建窗口已完整采集/);
 h.L.from='2026-09-21T00:00:00';h.L.to='2026-09-21T23:59:59';h.c.render();assert.doesNotMatch(h.html(),/所选创建窗口已完整采集/);assert.match(h.html(),/已入库部分，尚未完整采集/);
 scope(h,'withdraw');r.pandaCoverage.directions=r.pandaCoverage.directions.filter(d=>d.direction==='charge');h.c.render();assert.doesNotMatch(h.html(),/所选创建窗口已完整采集/);
});
