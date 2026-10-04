/* The production controller is exercised at its dedicated module boundary. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0].replace('vm.runInContext(source,context',"if(options.daily)context.HensemLiveDailyComparison=options.daily;if(options.dailySource)vm.runInContext(options.dailySource,context);vm.runInContext(source,context");
const {harness,settle,P,deferred}=new Function('require','__dirname',prefix+';return {harness,settle,P,deferred};')(require,__dirname);
const owner={mode:'owner',canView:true,permissions:[]};
const access=permissions=>({mode:'assigned',canView:true,permissions:permissions.map(p=>'daily_comparison.'+p)});
function moduleProbe(){
 let context,current={status:'idle',marker:''};const calls={load:0,cancel:0,clear:0,restore:[],capture:0,exports:0};
 return {calls,get context(){return context},get current(){return current},set current(value){current=value},module:{create(c){context=c;return {
  load:async()=>{calls.load++;c.L.serial++;c.L.pageQueried=true;c.L.dirty=false;current={status:'ready',marker:'QUERIED_DAILY_DATA'};c.render();},
  cancel(){calls.cancel++;if(current.status==='loading')current={...current,status:'paused'};},
  capture(){calls.capture++;return {...current,status:current.status==='loading'?'paused':current.status};},
  restore(value){calls.restore.push(value);current=value?{...value}:{status:'idle',marker:''};},
  clear(){calls.clear++;current={status:'idle',marker:''};},
  render(){return '<section>DAILY_MODULE '+current.status+' '+current.marker+'</section>';},
  filterDateExtras(){return '<label>对比日期</label><label>趋势 7 / 15 / 30 天</label>';},
  canExport(){return current.status==='ready'&&!c.L.dirty;},
  exportRows(){calls.exports++;return [['平台','笔数'],['=unsafe',7]];}
 };}}};
}
async function setup(options={}){const probe=moduleProbe(),h=harness({page:'daily_comparison',roleAccess:owner,roleAllowed:()=>true,...options,daily:probe.module});await settle();return {...h,probe};}

test('daily comparison registers in operations, defaults to yesterday and never starts a business read on entry',async()=>{
 const h=await setup();assert.equal(h.c.state.page,'daily_comparison');assert.equal(h.c.groupForV3('daily_comparison')[0],'merchant');
 assert.equal(h.c.pages.find(p=>p[0]==='daily_comparison')[2],'每日对比');assert.equal(h.L.from,'2026-09-22T00:00:00');assert.equal(h.L.to,'2026-09-22T23:59:59');assert.equal(h.L.direction,'all');
 assert.equal(h.probe.calls.load,0);assert.deepEqual(h.calls.map(q=>q.action),['catalog']);assert.match(h.html(),/DAILY_MODULE idle/);
 const filters=h.nodes.get('liveFilters').innerHTML;assert.match(filters,/统计日期（平台当地）/);assert.match(filters,/对比日期/);assert.match(filters,/趋势 7 \/ 15 \/ 30 天/);assert.doesNotMatch(filters,/业务方向|近1周|近1个月/);
 await h.c.liveLoad();assert.equal(h.probe.calls.load,0,'non-manual refresh must not fetch comparisons');
});

test('legacy roles cannot see the new route and view-only roles cannot query or export it',async()=>{
 const legacy=await setup({roleAccess:{mode:'legacy',canView:true,permissions:[]}});assert.notEqual(legacy.c.state.page,'daily_comparison');assert(!legacy.c.pages.some(p=>p[0]==='daily_comparison'));legacy.c.setPage('daily_comparison');assert.notEqual(legacy.c.state.page,'daily_comparison');
 const view=await setup({roleAccess:access(['view','export'])});assert.equal(view.c.state.page,'daily_comparison');assert.match(view.html(),/未获查询权限/);await view.c.liveQuery();view.c.liveExport();assert.equal(view.probe.calls.load,0);assert.equal(view.blobs.length,0);assert.equal(view.probe.calls.exports,0);
 const query=await setup({roleAccess:access(['view','query'])});await query.c.liveQuery();query.c.liveExport();assert.equal(query.probe.calls.load,1);assert.equal(query.blobs.length,0);
});

test('explicit query delegates exclusively to daily module with authorized platform and clock adapters',async()=>{
 const h=await setup();h.L.status='failed';h.L.memberId='unrelated-member';h.L.direction='withdraw';h.L.multi.direction=['withdraw'];await h.c.liveQuery();
 assert.equal(h.probe.calls.load,1);assert.equal(h.L.direction,'all');assert.equal(h.L.status,'all');assert.equal(h.L.memberId,'');assert.equal(h.L.pageQueried,true);assert.equal(h.L.dirty,false);
 assert.deepEqual(h.calls.map(q=>q.action),['catalog'],'no old whole-range aggregate, workorder or fee prefetch runs');
 const c=h.probe.context;assert.equal(c.getPage(),'daily_comparison');assert.equal(c.selected()[0].id,P.id);assert.equal(c.nativePlatforms()[0].id,P.id);assert.equal(c.roleAllowed('detail'),true);
 assert.equal(c.instant('2026-09-22T00:00:00',P.timezone),'2026-09-21T18:30:00.000Z');assert.equal(typeof c.readAggregate,'function');assert.equal(typeof c.ensureFeeLookup,'function');
});

test('statistics date and shortcuts stay single-day, cancel old reads and require a new query',async()=>{
 const h=await setup();await h.c.liveQuery();const cancel=h.probe.calls.cancel,reads=h.calls.length;
 h.c.liveDailyStatisticsDate('2026-09-20');assert.equal(h.L.from,'2026-09-20T00:00:00');assert.equal(h.L.to,'2026-09-20T23:59:59');assert.equal(h.L.dirty,true);assert(h.probe.calls.cancel>cancel);assert.equal(h.probe.calls.load,1);
 h.c.livePeriod('month');assert.equal(h.L.from,'2026-09-20T00:00:00');h.c.liveDailyStatisticsDate('2026-02-30');assert.equal(h.L.from,'2026-09-20T00:00:00');
 h.c.livePeriod('today');assert.equal(h.L.from,'2026-09-23T00:00:00');assert.equal(h.L.to,'2026-09-23T23:59:59');assert.equal(h.calls.length,reads);
 h.L.to='2026-09-24T23:59:59';await h.c.liveQuery();assert.equal(h.probe.calls.load,1,'invalid cross-day scope rejected before module read');assert.match(h.L.error,/每次只查询一个当地日/);
});

test('filter changes cancel the module and prevent exporting stale comparison data',async()=>{
 const h=await setup();await h.c.liveQuery();const before=h.probe.calls.cancel;h.c.liveSet('provider','Synthetic provider');await settle();
 assert(h.probe.calls.cancel>before);assert.equal(h.L.dirty,true);assert.equal(h.probe.calls.load,1);h.c.liveExport();assert.equal(h.blobs.length,0);
 await h.c.liveQuery();h.c.liveExport();assert.equal(h.blobs.length,1);assert.equal(h.probe.calls.exports,1);assert.match(await h.blobs[0].text(),/"'=unsafe"/,'CSV formulas remain escaped');
});

test('completed and paused daily tabs restore locally without restarting queries',async()=>{
 const h=await setup();await h.c.liveQuery();h.c.liveDailyStatisticsDate('2026-09-19');await h.c.liveQuery();const ready=h.probe.current;
 h.c.setPage('overview');const reads=h.calls.length;h.c.setPage('daily_comparison');await settle();assert.equal(h.L.from,'2026-09-19T00:00:00');assert.deepEqual(h.probe.current,ready);assert.equal(h.calls.length,reads);assert.equal(h.probe.calls.load,2);assert.match(h.html(),/QUERIED_DAILY_DATA/);
 h.probe.current={status:'loading',marker:'PARTIAL_DAILY_DATA'};h.c.setPage('overview');h.c.setPage('daily_comparison');await settle();assert.equal(h.probe.current.status,'paused');assert.equal(h.probe.calls.load,2);h.c.liveExport();assert.equal(h.blobs.length,0);
});

test('closing and reopening daily comparison discards saved results and restores default single day',async()=>{
 const h=await setup();await h.c.liveQuery();h.c.liveDailyStatisticsDate('2026-09-19');h.c.liveClosePage('daily_comparison');assert(h.probe.calls.clear>0);h.c.setPage('daily_comparison');await settle();assert.equal(h.L.from,'2026-09-22T00:00:00');assert.equal(h.L.pageQueried,false);assert.equal(h.probe.current.status,'idle');assert.equal(h.probe.calls.load,1);
 h.c.liveReset();assert.equal(h.L.from,'2026-09-22T00:00:00');assert.equal(h.probe.current.status,'idle');assert.equal(h.probe.calls.load,1);
});

test('manual query awaiting catalog cannot resume after navigating away',async()=>{
 const catalog=deferred(),probe=moduleProbe(),h=harness({page:'daily_comparison',roleAccess:owner,roleAllowed:()=>true,daily:probe.module,handler:q=>q.action==='catalog'?catalog.promise:{rows:[],total:0}});
 const reading=h.c.liveQuery();h.c.setPage('overview');catalog.resolve({platforms:[P]});await reading;await settle();assert.equal(h.c.state.page,'overview');assert.equal(probe.calls.load,0);assert.deepEqual(h.calls.map(q=>q.action),['catalog']);
});

function nativeResponse(q,count=10){const s={direction:'charge',currency:'INR',all_count:count,all_amount:String(count*100),success_count:count/2,success_amount:String(count*50),created_success_count:count/2,pending_count:0,pending_amount:'0',failed_count:count/2,failed_amount:String(count*50),rejected_count:0,rejected_amount:'0',unknown_count:0,unknown_amount:'0',missing_amount_count:0};return {platform:P,startAt:q.startAt,endAt:q.endAt,total:count,summary:[s,{...s,direction:'withdraw'}],groups:{provider:[{...s,provider:'Synthetic provider'},{...s,direction:'withdraw',provider:'Synthetic provider'}]},rows:[]};}
function realHarness(handler){return harness({page:'daily_comparison',roleAccess:owner,roleAllowed:()=>true,dailySource:fs.readFileSync(path.join(__dirname,'../admin-preview/live-daily-comparison.js'),'utf8'),handler:q=>q.action==='catalog'?{platforms:[P]}:q.action==='rates'?{rows:[],total:0}:handler(q)});}

test('real daily module reads bounded native provider days and renders without the generic aggregate path',async()=>{
 const h=realHarness(q=>nativeResponse(q));await settle();assert.deepEqual(h.calls.map(q=>q.action),['catalog']);await h.c.liveQuery();await settle();
 const queries=h.calls.filter(q=>q.action==='aggregate');assert.equal(queries.length,8,'seven trend days plus the first-day comparison baseline');assert(queries.every(q=>q.view==='providers'&&q.direction==='all'&&q.platformId===P.id));assert(queries.every(q=>Date.parse(q.endAt)-Date.parse(q.startAt)===86400000));assert.equal(queries[0].startAt,'2026-09-21T18:30:00.000Z');
 assert.match(h.html(),/规模与占比/);assert.match(h.html(),/Synthetic platform/);assert.match(h.html(),/50\.00%/);assert.doesNotMatch(h.html(),/每日对比暂不可用/);
 const readCount=h.calls.length;h.c.setPage('overview');h.c.setPage('daily_comparison');await settle();assert.equal(h.calls.length,readCount);assert.match(h.html(),/规模与占比/);
});

test('real module navigation cancellation blocks queued days and old response repaint',async()=>{
 const pending=deferred(),h=realHarness(q=>pending.promise.then(()=>nativeResponse(q)));await settle();const query=h.c.liveQuery();await settle();assert.equal(h.calls.filter(q=>q.action==='aggregate').length,2,'only two lanes begin');
 h.c.setPage('overview');const html=h.html();pending.resolve();await query;await settle();assert.equal(h.html(),html);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,2,'cancelled queue never dispatches the remaining dates');
 h.c.setPage('daily_comparison');await settle();assert.match(h.html(),/查询已暂停/);assert.equal(h.calls.filter(q=>q.action==='aggregate').length,2);h.c.liveExport();assert.equal(h.blobs.length,0);
});

test('real comparison export uses the active query and is blocked after date changes',async()=>{
 const h=realHarness(q=>nativeResponse(q));await settle();h.c.liveExport();assert.equal(h.blobs.length,0);await h.c.liveQuery();h.c.liveExport();assert.equal(h.blobs.length,1);
 const csv=await h.blobs[0].text();assert.match(csv,/提交金额/);assert.match(csv,/金额占比/);assert.match(csv,/提交笔数/);assert.match(csv,/笔数占比/);assert.match(csv,/2026-09-22/);assert.match(csv,/按当前费率估算/);
 h.c.liveDailyStatisticsDate('2026-09-21');h.c.liveExport();assert.equal(h.blobs.length,1);
});

test('real workorder-first query never fetches payment aggregates or fees',async()=>{
 const h=harness({page:'daily_comparison',roleAccess:owner,roleAllowed:()=>true,ancillaryHandler:true,dailySource:fs.readFileSync(path.join(__dirname,'../admin-preview/live-daily-comparison.js'),'utf8'),handler:q=>q.action==='catalog'?{platforms:[P]}:q.action==='workorders'?{startDate:q.startAt.slice(0,10),endDate:q.endAt.slice(0,10),summary:{submittedCount:0,submittedAmount:0,successCount:0,successAmount:0},byPlatformProvider:[],rows:[],total:0}:nativeResponse(q)});
 await settle();assert.match(h.html(),/liveDailyDirection\('workorder'\)/);h.c.liveDailyDirection('workorder');assert.equal(h.calls.length,1);await h.c.liveQuery();await settle();
 assert.equal(h.calls.filter(q=>q.action==='workorders').length,8,'seven trend days plus the first-day comparison baseline');assert.equal(h.calls.filter(q=>q.action==='aggregate'||q.action==='rates').length,0);assert.match(h.html(),/原始工单不去重/);
});
