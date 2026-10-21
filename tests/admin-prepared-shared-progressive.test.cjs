/* Real shared controller and prepared reader. Virtual waiting tests rendering,
 * scope isolation and request counts; it makes no live latency claim. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-provider-daily-progressive.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {setup:dailySetup,ready,queued,reads,platforms,settle,deferred}=new Function('require','__dirname',prefix+';return {setup,ready,queued,reads,platforms,settle,deferred};')(require,__dirname);
async function setup(page){const h=await dailySetup();h.c.setPage(page);await settle();Object.assign(h.L,{from:'2026-10-17T00:00:00',to:'2026-10-17T23:59:59',successFrom:'',successTo:''});return h;}
const pages=['overview','collection','payout','providers','provider_payout','time','amount','matrix','latency','risk','teamops','teamcountries','teamplatforms','merchants','provider_daily'];
for(const page of pages)test(page+': host suspension unlocks a partial query; explicit continuation reads only the missing platform',async()=>{
 const h=await setup(page),run=h.c.liveQuery();await settle();assert.equal(h.L.results.length,1);const retained=h.L.results[0];
 h.setPrepared(()=>{throw Object.assign(Error('Synthetic host revalidation'),{code:'ADMIN_LIVE_CANCELLED'});});
 await h.time.advance(1500);await run;await settle();
 assert.equal(h.L.loading,false);assert.equal(h.L.queryRetrying,false);assert.equal(h.L.queryPaused,true);assert.equal(h.L.restoredPage,true);assert.equal(h.L.results[0],retained);assert.equal(h.L.queryFailures.length,0);
 assert.match(h.html(),/onclick="liveRetryFailed\(true\)"/);assert.doesNotMatch(h.html(),/live-read-phase/);
 const count=reads(h).length;await h.time.advance(120000);assert.equal(reads(h).length,count,'reverification never starts automatic business retry');
 h.setPrepared(request=>ready(request,20,16));await h.c.liveRetryFailed();await settle();
 assert.equal(h.L.loading,false);assert.equal(h.L.queryRetrying,false);assert.equal(h.L.queryPaused,false);assert.equal(h.L.results.length,2);assert.equal(h.L.results.find(r=>r.platform.id===platforms[0].id),retained);
 assert.deepEqual(reads(h).slice(count).flatMap(q=>q.requests.map(r=>r.platformId)),[platforms[1].id]);
});
test('a denied explicit continuation clears the retained facts and cannot reopen a paused query',async()=>{
 const h=await setup('providers'),run=h.c.liveQuery();await settle();
 h.setPrepared(()=>{throw Object.assign(Error('Synthetic host revalidation'),{code:'ADMIN_LIVE_CANCELLED'});});await h.time.advance(1500);await run;assert.equal(h.L.queryPaused,true);
 h.setPrepared(()=>{throw Object.assign(Error('Synthetic current permission denied'),{code:'ADMIN_LIVE_PERMISSION_DENIED'});});await h.c.liveRetryFailed(true);await settle();
 assert.equal(h.L.results.length,0);assert.equal(h.L.loading,false);assert.equal(h.L.queryRetrying,false);assert.equal(h.L.queryPaused,false);assert.match(h.L.error,/权限/);assert.doesNotMatch(h.html(),/继续查询|1,000\.00/);
 const count=reads(h).length;await h.c.liveRetryFailed(true);assert.equal(reads(h).length,count);
});
for(const page of ['overview','merchants'])test(page+': cancellation of an optional aggregate releases its own loading guard and permits an explicit retry',async()=>{
 const h=await setup(page);h.setPrepared(request=>ready(request));await h.c.liveQuery();await settle();
 const main=h.L.results.slice(),load=()=>page==='overview'?h.c.liveOverviewAnalysis():h.c.liveView('trend');
 h.setPrepared(()=>{throw Object.assign(Error('Synthetic optional read suspension'),{code:'ADMIN_LIVE_CANCELLED'});});await load();await settle();
 assert.equal(h.L.loading,false);assert.equal(h.L.queryPaused,false);assert.deepEqual(h.L.results,main);
 assert.equal(page==='overview'?h.L.overviewSections.status:h.L.merchantTrend.status,page==='overview'?'partial':'paused');
 const count=reads(h).length;await h.time.advance(120000);assert.equal(reads(h).length,count);
 h.setPrepared(request=>ready(request));await load();await settle();assert.equal(page==='overview'?h.L.overviewSections.status:h.L.merchantTrend.status,'ready');
});
for(const page of pages)test(page+': render ready platform facts while an exact peer is preparing',async()=>{
 const h=await setup(page),run=h.c.liveQuery();await settle();
 assert.equal(h.L.results.length,1);assert.equal(h.L.loading,true);
 assert.match(h.html(),/已读|已读取|部分结果/);assert.match(h.html(),/<table|kpi-value|latency-summary/,'ready page content is visible before slow peers finish');
 assert.doesNotMatch(h.html(),/live-retained-result|查询已完成/);
 const count=h.calls.length;for(let i=0;i<3;i++)h.c.render();await settle();assert.equal(h.calls.length,count,'render does not launch an extra query');
 assert.equal(h.calls.filter(q=>q.action==='aggregate').length,0,'prepared screens do not scan raw aggregates');
 const notices=[];h.c.toast=x=>notices.push(x);h.c.liveExport();assert.equal(h.blobs.length,0);assert(notices.length);
 h.setPrepared(request=>ready(request,20,16));await h.time.advance(1500);await run;await settle();
 assert.equal(h.L.loading,false);assert.equal(h.L.results.length,2);
 assert(h.L.results.every(r=>r._preparedPublication.sourceComplete===false),'source completeness is not invented');
});
test('all-pending analysis does not display zero totals or an empty completed table',async()=>{
 const h=await setup('time');h.setPrepared(queued);const run=h.c.liveQuery();await settle();
 assert.match(h.html(),/已读 0 \/ 2/);assert.doesNotMatch(h.html(),/kpi-value|<table|当前筛选范围没有已入库记录/);
 h.listeners.get('pagehide')();await run;
});
test('new prepared facts replace the retained prior query while a peer remains pending',async()=>{
 const h=await setup('time');h.setPrepared(request=>ready(request,99,99,'Old completed provider'));await h.c.liveQuery();await settle();assert(h.L.retainedContent);
 h.c.liveMetricTimeSet('from','2026-10-16T00:00:00');h.c.liveMetricTimeSet('to','2026-10-16T23:59:59');
 h.setPrepared(request=>request.platformId===platforms[0].id?ready(request,7,7,'New provider'):queued(request));const run=h.c.liveQuery();await settle();
 assert.equal(h.L.results.length,1);assert.match(h.html(),/2026-10-16/);assert.match(h.html(),/700\.00/);assert.doesNotMatch(h.html(),/live-retained-result|9,900\.00/);
 h.listeners.get('pagehide')();await run;
});
test('failed peers retain verified amounts and missing success values without a complete footer',async()=>{
 const h=await setup('teamops');h.setPrepared(request=>{if(request.platformId!==platforms[0].id)return {...queued(request),preparation:{state:'failed',retryable:false}};const item=ready(request);item.result.summary[0].success_amount=null;for(const rows of Object.values(item.result.groups))for(const row of rows)row.success_amount=null;return item;});
 await h.c.liveQuery();await settle();assert.equal(h.L.results.length,1);assert.equal(h.L.queryFailures.length,1);
 assert.match(h.html(),/已读小计（非完整总计）/);assert.match(h.html(),/1,000\.00/);assert.match(h.html(),/—/);
});
test('switching pages while a peer polls cancels it and its late response cannot replace the destination',async()=>{
 const h=await setup('amount'),run=h.c.liveQuery();await settle();const late=deferred();h.setPrepared(()=>late.promise);await h.time.advance(1500);const old=reads(h).at(-1).requests[0];
 h.c.setPage('time');await run;const html=h.html(),count=reads(h).length;
 late.resolve(ready(old,999,999,'Late old provider'));await settle();await h.time.advance(120000);
 assert.equal(h.html(),html);assert.equal(reads(h).length,count);assert.doesNotMatch(h.html(),/Late old provider/);
});
test('permission revocation clears progressive results instead of retaining a partial screen',async()=>{
 const h=await setup('matrix'),run=h.c.liveQuery();await settle();
 h.setPrepared(()=>{throw Object.assign(Error('Synthetic denied'),{code:'ADMIN_LIVE_PERMISSION_DENIED'});});await h.time.advance(1500);await run;await settle();
 assert.equal(h.L.results.length,0);assert.match(h.L.error,/权限/);assert.doesNotMatch(h.html(),/kpi-value|live-retained-result/);
});
test('unreturned matrix segments stay unknown while a real returned zero remains zero',async()=>{
 const h=await setup('matrix');h.L.matrixMode='exact';h.setPrepared(request=>{if(request.platformId!==platforms[0].id)return queued(request);const item=ready(request,0,0);return item;});
 const run=h.c.liveQuery();await settle();assert.match(h.html(),/<b>—笔<\/b>/);assert.match(h.html(),/<b>0笔<\/b>/);assert.match(h.html(),/部分已读/);
 h.listeners.get('pagehide')();await run;
});
test('latency direction with no returned facts remains unknown while another platform is pending',async()=>{
 const h=await setup('latency');h.L.direction='withdraw';h.L.multi.direction=['withdraw'];const run=h.c.liveQuery();await settle();
 const payout=h.html().match(/<section class="panel latency-summary" data-duration-direction="withdraw">[\s\S]*?<\/section>/)?.[0];assert(payout);assert.match(payout,/提交 — 笔 · 成功 — 笔/);assert.doesNotMatch(payout,/>0 笔/);assert.match(h.html(),/已读成功订单耗时小计/);
 h.listeners.get('pagehide')();await run;
});
test('an incomplete team view has unknown payout subtotal when only charge facts have returned',async()=>{
 const h=await setup('teamops');h.L.direction='all';h.L.multi.direction=[];const run=h.c.liveQuery();await settle();
 const footer=h.html().match(/<strong>代付已读小计（非完整总计）<\/strong>[\s\S]*?<\/tr>/)?.[0];assert(footer);assert.doesNotMatch(footer,/>0(?:\.00)?<\//);assert.match(footer,/—/);
 h.listeners.get('pagehide')();await run;
});
