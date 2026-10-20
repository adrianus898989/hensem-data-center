/* Real controller + prepared reader, synthetic publications and virtual timers.
 * These checks measure scope/amount correctness and request counts, not live speed. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,completeAggregate,P,settle,deferred}=new Function('require','__dirname',prefix+';return {harness,completeAggregate,P,settle,deferred};')(require,__dirname);
const pollPrefix=fs.readFileSync(path.join(__dirname,'admin-prepared-derived-poll.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {clock}=new Function('require','__dirname',pollPrefix+';return {clock};')(require,__dirname);
const platforms=[{...P,sourceName:'Synthetic A'},{...P,id:'22222222-2222-4222-8222-222222222222',name:'Queued <native>',sourceName:'Synthetic B'}];
const localDay=request=>new Date(Date.parse(request.startAt)+330*60000).toISOString().slice(0,10);
function ready(request,count=10,success=4,provider='Synthetic provider'){
 const platform=platforms.find(p=>p.id===request.platformId),result=completeAggregate(platform,count,success);
 Object.assign(result,{version:1,startAt:request.startAt,endAt:request.endAt,successStartAt:request.successStartAt,successEndAt:request.successEndAt,successBasis:request.successBasis,...(request.durationVersion?{durationVersion:request.durationVersion}:{})});
 result.groups.provider[0].provider=provider;Object.assign(result.groups.daily[0],{date:localDay(request),provider});
 return {request,status:'ready',publication:{id:'synthetic-'+request.platformId,generation:1,computedAt:'2026-10-18T11:00:00Z',expiresAt:'2026-10-18T11:10:00Z',cutoff:'2026-10-18T11:00:00Z',calculationComplete:true,sourceComplete:false,freshness:'refresh_due',refreshState:'queued'},result};
}
const queued=request=>({request,status:'missing',result:null,publication:null,preparation:{state:'queued',retryable:true}});
const reads=h=>h.calls.filter(q=>q.action==='aggregatePrepared');
const grid=html=>html.match(/<table\b[^>]*class="provider-daily-matrix-table"[\s\S]*?<\/table>/)?.[0]||'';
async function setup(){
 const time=clock(),listeners=new Map();
 const h=harness({platforms,roleAccess:{mode:'owner',canView:true},roleAllowed:()=>true,extraModules:['live-statistic-windows.js','live-prepared-aggregates.js'],beforeLive:c=>{
  c.setTimeout=time.setTimeout;c.clearTimeout=time.clearTimeout;c.Date=class extends Date{constructor(...args){super(...(args.length?args:[time.now]));}static now(){return time.now;}};
  c.addEventListener=(name,fn)=>listeners.set(name,fn);
 }});
 await settle();h.c.setPage('provider_daily');await settle();
 Object.assign(h.L,{from:'2026-10-17T00:00:00',to:'2026-10-17T23:59:59',successFrom:'',successTo:'',dailyView:'all'});
 let handler=request=>request.platformId===platforms[0].id?ready(request):queued(request);
 h.setHandler(async q=>q.action==='aggregatePrepared'?{version:2,items:await Promise.all(q.requests.map(request=>handler(request)))}:q.action==='rates'?{rows:[],total:0}:q.action==='providerOptions'?{providers:[]}:{}); 
 return {...h,time,listeners,setPrepared:fn=>handler=fn};
}
test('a ready daily platform paints real counts and amounts while peers queue, then becomes complete only after all return',async()=>{
 const h=await setup(),run=h.c.liveQuery();await settle();
 assert.equal(h.L.loading,true);assert.equal(h.L.results.length,1);
 assert.match(h.html(),/正在读取 · 已读 1 \/ 2 平台/);assert.match(h.html(),/live-subtotal-label">已读小计/);
 assert.match(h.html(),/Queued &lt;native&gt;：正在读取/);
 assert.match(h.html(),/class="kpi-value">1,000\.00/);assert.match(h.html(),/class="kpi-value">400\.00/);
 assert.match(grid(h.html()),/>40\.00%<\/button>/);
 const messages=[];h.c.toast=text=>messages.push(text);h.c.liveExport();assert.equal(h.blobs.length,0);assert(messages.some(text=>text.includes('读取完成后再导出')));
 const before=h.calls.length;for(let i=0;i<5;i++)h.c.render();await settle();
 assert.equal(h.calls.length,before,'rendering ready peers starts no new query');assert.equal(h.calls.filter(q=>q.action==='rates').length,0);
 assert.equal(reads(h).length,1);assert.equal(reads(h)[0].requests.length,2);
 h.setPrepared(request=>ready(request,20,16));await h.time.advance(1500);await run;await settle();
 assert.equal(h.L.results.length,2);assert.equal(h.L.loading,false);
 assert.deepEqual(reads(h)[1].requests.map(q=>q.platformId),[platforms[1].id],'only queued peer is polled');
 assert.match(h.html(),/class="kpi-value">3,000\.00/);assert.match(h.html(),/class="kpi-value">2,000\.00/);
 assert.match(grid(h.html()),/>66\.67%<\/button>/);assert.doesNotMatch(h.html(),/live-subtotal-label|data-aggregate-read-status/);
 assert(h.L.results.every(r=>r._preparedPublication.sourceComplete===false),'read completion must not rewrite source coverage');
});
test('queued-only states never render zero totals or a completed empty matrix',async()=>{
 const h=await setup();h.setPrepared(queued);const run=h.c.liveQuery();await settle();
 assert.match(h.html(),/已读 0 \/ 2 平台/);assert.doesNotMatch(h.html(),/provider-daily-matrix-table|kpi-value|当前筛选范围没有已入库记录/);
 h.listeners.get('pagehide')();await run;assert.equal(reads(h).length,1);
});
test('failed peer retains partial real amounts and unknown metrics without falsely completing the day',async()=>{
 const h=await setup();h.setPrepared(request=>{if(request.platformId!==platforms[0].id)return queued(request);const item=ready(request);item.result.summary[0].success_amount=null;item.result.groups.provider[0].success_amount=null;item.result.groups.daily[0].success_amount=null;return item;});
 const run=h.c.liveQuery();await settle();assert.match(h.html(),/class="kpi-value">—<\/div>/);
 h.setPrepared(request=>({...queued(request),preparation:{state:'failed',retryable:false}}));await h.time.advance(1500);await run;await settle();
 assert.equal(h.L.results.length,1);assert.equal(h.L.queryFailures.length,1);assert.equal(h.L.loading,false);
 assert.match(h.html(),/查询未完成 · 已读 1 \/ 2 平台/);assert.match(h.html(),/live-subtotal-label">已读小计/);
 assert.match(h.html(),/class="kpi-value">1,000\.00/);assert.match(h.html(),/class="kpi-value">—<\/div>/);
 assert.doesNotMatch(h.html(),/当前筛选范围没有已入库记录/);
 const count=reads(h).length;await h.time.advance(120000);assert.equal(reads(h).length,count);
});
test('a date change cancels the prior queued read and a late old response cannot overwrite the new daily matrix',async()=>{
 const h=await setup(),old=h.c.liveQuery();await settle();assert.match(grid(h.html()),/>40\.00%<\/button>/);
 const late=deferred();h.setPrepared(()=>late.promise);await h.time.advance(1500);assert.equal(reads(h).length,2);
 const previous=reads(h)[1].requests[0];
 h.c.liveMetricTimeSet('from','2026-10-16T00:00:00');h.c.liveMetricTimeSet('to','2026-10-16T23:59:59');
 h.setPrepared(request=>ready(request,7,7,'New day provider'));
 await h.c.liveQuery();await old;await settle();
 const current=JSON.stringify(h.L.results);assert.match(grid(h.html()),/New day provider/);assert.match(grid(h.html()),/10-16/);assert.doesNotMatch(grid(h.html()),/10-17|Synthetic provider/);
 late.resolve(ready(previous,900,900,'Old late provider'));await settle();
 assert.equal(JSON.stringify(h.L.results),current);assert.doesNotMatch(h.html(),/Old late provider/);
 const count=reads(h).length;await h.time.advance(120000);assert.equal(reads(h).length,count);
});
test('navigation while a peer queues hides partial daily data and ignores its late response',async()=>{
 const h=await setup(),run=h.c.liveQuery();await settle();assert(grid(h.html()));
 const late=deferred();h.setPrepared(()=>late.promise);await h.time.advance(1500);const previous=reads(h)[1].requests[0];
 h.c.setPage('time');await run;const after=h.html(),count=reads(h).length;
 assert.doesNotMatch(after,/provider-daily-matrix-table/);
 late.resolve(ready(previous,999,999,'Old page provider'));await settle();await h.time.advance(120000);
 assert.equal(h.html(),after);assert.equal(reads(h).length,count);assert.doesNotMatch(h.html(),/Old page provider/);
});
test('progressive daily rendering retains the existing Panda coverage gate',async()=>{
 const h=await setup(),run=h.c.liveQuery();await settle();assert(grid(h.html()));
 h.listeners.get('pagehide')();await run;
 const panda={...platforms[1],source:'panda'};
 h.L.catalog=[platforms[0],panda];h.L.queryPlatforms=[platforms[0],panda];h.L.loading=true;h.L.dirty=false;h.L.pageQueried=true;
 h.c.render();assert.match(h.html(),/已读 1 \/ 2 平台/);assert.doesNotMatch(h.html(),/provider-daily-matrix-table|kpi-value/);
});
