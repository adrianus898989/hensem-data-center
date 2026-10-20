const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const providerPrefix=fs.readFileSync(path.join(__dirname,'admin-provider-historical-routing.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {fixture,prepared,settle,deferred,harness,platforms}=new Function('require','__dirname',providerPrefix+';return {fixture,prepared,settle,deferred,harness,platforms};')(require,__dirname);
const withdrawalFile=path.join(__dirname,'withdraw-prepared-ui.test.cjs'),withdrawalContext=vm.createContext({__dirname,require:createRequire(withdrawalFile),console,Date,Intl,AbortController});
vm.runInContext(fs.readFileSync(withdrawalFile,'utf8').split('for(const view of')[0]+';globalThis.h={fixture,data};',withdrawalContext);
const withdraw=withdrawalContext.h.fixture,data=withdrawalContext.h.data;
const preparedCalls=h=>h.calls.filter(q=>q.action==='aggregatePrepared').length;
async function historical(){const h=await fixture();h.setNow('2026-10-18T12:00:00Z');h.c.livePeriod('week');h.c.liveMetricTimeSet('from','2026-10-11T00:00:00');h.c.liveMetricTimeSet('to','2026-10-17T23:59:59');return h;}

test('actual shared quick periods and reset leave only creation inputs populated',async()=>{
 const h=await fixture();for(const page of ['providers','merchants','amount','time']){h.c.setPage(page);await settle();for(const mode of ['today','yesterday','before','week','month']){h.c.liveMetricTimeSet('successFrom','2026-10-10T01:02:03');h.c.liveMetricTimeSet('successTo','2026-10-10T04:05:06');const before=preparedCalls(h);h.c.livePeriod(mode);assert.equal(h.L.successFrom,'',page+'/'+mode);assert.equal(h.L.successTo,'');assert.match(h.L.from,/T00:00:00$/);assert.match(h.L.to,/T23:59:59$/);assert.equal(preparedCalls(h),before);assert.doesNotMatch(h.nodes.get('liveFilters')?.innerHTML||'',/成功统计依据|liveMetricBasis/);}}
 h.c.liveReset();assert.equal(h.L.successFrom,'');assert.equal(h.L.successTo,'');
});
test('blank defaults keep prepared wire semantics and manual pair changes remain independent across tabs',async()=>{
 const h=await historical();await h.c.liveQuery();assert.equal(h.L.results.length,18);for(const call of h.calls.filter(q=>q.action==='aggregatePrepared'))for(const q of call.requests){assert.equal(q.successStartAt,q.startAt);assert.equal(q.successEndAt,q.endAt);assert.equal(q.successBasis,'success');}assert.equal(h.L.successFrom,'');assert.equal(h.L.successTo,'');
 const first=preparedCalls(h);h.c.liveMetricTimeSet('successFrom','2026-10-09T01:02:03');await h.c.liveQuery();assert.equal(preparedCalls(h),first);assert.match(h.L.error,/同时填写/);
 h.c.liveMetricTimeSet('successTo','2026-10-10T04:05:06');await h.c.liveQuery();assert(preparedCalls(h)>first);const q=h.calls.filter(q=>q.action==='aggregatePrepared').at(-1).requests[0];assert.notEqual(q.successStartAt,q.startAt);h.c.setPage('amount');h.c.setPage('providers');assert.equal(h.L.successFrom,'2026-10-09T01:02:03');assert.equal(h.L.successTo,'2026-10-10T04:05:06');
});
test('implicit and equal explicit windows share the same authorized exact completed entry',async()=>{
 const h=await historical();await h.c.liveQuery();const first=preparedCalls(h);h.c.liveMetricTimeSet('successFrom',h.L.from);h.c.liveMetricTimeSet('successTo',h.L.to);await h.c.liveQuery();assert.equal(preparedCalls(h),first);h.c.liveMetricTimeSet('successFrom','');h.c.liveMetricTimeSet('successTo','');await h.c.liveQuery();assert.equal(preparedCalls(h),first);assert.equal(h.L.results.length,18);
});
test('clearing or editing the optional pair cancels old prepared reads and rejects their late results',async()=>{
 const h=await historical(),wait=deferred();let held;h.override(q=>{if(q.action==='aggregatePrepared'&&!held){held=q;return wait.promise;}});const run=h.c.liveQuery();await settle();assert(held);const before=JSON.stringify(h.L.results);h.c.liveMetricTimeSet('successFrom','2026-10-09T00:00:00');wait.resolve(prepared(held));await run;await settle();assert.equal(JSON.stringify(h.L.results),before);assert.equal(h.L.dirty,true);assert.equal(h.L.loading,false);
});
for(const page of ['auto_withdraw','withdraw_operators'])test(page+' default UI stays blank while required V2 transport and applied export remain explicit',async()=>{
 const f=withdraw(page),html=f.page.render();assert.doesNotMatch(html,/成功统计依据|<select[^>]*withdrawMetricTimeSet/);assert.equal(f.L.successFrom,'');assert.equal(f.L.successTo,'');assert.equal((html.match(/name="(?:from|to)" required/g)||[]).length,2);assert.doesNotMatch(html,/name="success(?:From|To)" required/);
 let run=f.page.load();assert.equal(f.calls[0].q.windowVersion,2);assert.equal(f.calls[0].q.successStartAt,f.calls[0].q.startAt);assert.equal(f.calls[0].q.successEndAt,f.calls[0].q.endAt);assert.equal(f.L.successFrom,'');f.pending.shift().resolve(data(2));await run;assert.equal(f.page.state.applied.successWindowExplicit,false);assert.match(f.page.exportMeta()[2][0],/默认成功日期/);
 f.context.withdrawMetricTimeSet('successFrom','2026-10-13T12:00');run=f.page.load();await run;assert.equal(f.calls.length,1);assert.match(f.page.state.error,/同时填写/);f.context.withdrawMetricTimeSet('successTo','2026-10-13T13:00');run=f.page.load();assert.equal(f.calls[1].q.successStartAt,'2026-10-13T12:00:00.000Z');f.pending.shift().resolve(data(3));await run;assert.equal(f.page.state.applied.successWindowExplicit,true);assert.match(f.page.exportMeta()[2][0],/独立/);
 f.context.withdrawMetricTimeSet('successFrom','');f.context.withdrawMetricTimeSet('successTo','');f.context.withdrawShift(-1);assert.equal(f.L.successFrom,'');assert.equal(f.L.successTo,'');f.context.withdrawPeriod('yesterday');assert.equal(f.L.successFrom,'');assert.equal(f.L.successTo,'');assert.equal(f.calls.length,2);
});

test('fresh iframe defaults never import old mirrored dates, while a newly explicit equal pair survives tab restore',async()=>{
 let reads=0;const storage={getItem(){reads++;return JSON.stringify({successFrom:'2026-10-15T00:00:00',successTo:'2026-10-15T23:59:59'});},setItem(){}};
 const make=()=>harness({page:'providers',platforms,extraModules:['live-statistic-windows.js'],beforeLive:c=>{c.localStorage=storage;c.sessionStorage=storage;},handler:q=>q.action==='catalog'?{platforms}:q.action==='providerOptions'?{providers:[]}:q.action==='rates'?{rows:[],total:0}:{} });
 const first=make();await settle();assert.equal(first.L.successFrom,'');assert.equal(first.L.successTo,'');first.c.liveMetricTimeSet('successFrom',first.L.from);first.c.liveMetricTimeSet('successTo',first.L.to);const saved=[first.L.successFrom,first.L.successTo];first.c.setPage('amount');first.c.setPage('providers');assert.deepEqual([first.L.successFrom,first.L.successTo],saved);
 const reloaded=make();await settle();assert.equal(reloaded.L.successFrom,'');assert.equal(reloaded.L.successTo,'');assert.equal(reads,0);
});

test('first opening each statistics page clears another page’s manual success window and preserves the original tab',async()=>{
 const targets=['overview','collection','payout','merchants','provider_payout','success_analysis','time','amount','matrix','provider_daily','latency','risk','teamops','teamcountries','teamplatforms','daily_comparison','auto_withdraw','withdraw_operators'];
 for(const target of targets){
  const h=await fixture();
  h.c.liveMetricTimeSet('successFrom','2026-10-09T01:02:03');
  h.c.liveMetricTimeSet('successTo','2026-10-10T04:05:06');
  h.c.setPage(target);await settle();
  assert.equal(h.L.successFrom,'',target+' must start without an inherited success start');
  assert.equal(h.L.successTo,'',target+' must start without an inherited success end');
  assert.match(h.L.from,/^\d{4}-\d{2}-\d{2}T/);
  assert.match(h.L.to,/^\d{4}-\d{2}-\d{2}T/);
  h.c.setPage('providers');
  assert.equal(h.L.successFrom,'2026-10-09T01:02:03','returning to the original tab keeps its manual entry');
  assert.equal(h.L.successTo,'2026-10-10T04:05:06');
 }
});
