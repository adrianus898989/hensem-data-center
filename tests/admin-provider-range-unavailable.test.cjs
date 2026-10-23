// Real provider controller and exact prepared DTOs; synthetic IO, no online timing.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-provider-historical-routing.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {fixture,prepared,settle,deferred,platforms,feed}=new Function('require','__dirname',prefix+';return {fixture,prepared,settle,deferred,platforms,feed};')(require,__dirname);
function range(h){for(const [key,value]of Object.entries({from:'2026-10-11T00:00:00',to:'2026-10-17T23:59:59',successFrom:'2026-10-11T00:00:00',successTo:'2026-10-17T23:59:59'}))h.c.liveMetricTimeSet(key,value);h.c.liveSet('provider','TukPay');}
const main=q=>q.action==='aggregatePrepared';
const attachments=q=>['rates','workorders','submissionAnalysis','intakeCoverage'].includes(q.action);
test('seven-day unavailable query replaces old publication status with its exact current range and no invented zeros',async()=>{
 const h=await fixture();await h.c.liveQuery();assert(h.L.retainedContent);h.L.retainedContent.html+='<div data-provider-published>2026-10-15 全部三方 · 缺 54 项统计</div>';
 range(h);const n=h.calls.length,wait=deferred();let held;
 h.override(q=>{if(main(q)){held=q;return wait.promise.then(()=>prepared(q,'building'));}});const run=h.c.liveQuery();await settle();assert(held);assert.match(h.html(),/data-aggregate-read-status[^>]*><strong>正在读取 · 已读 0 \/ 18 平台/);assert.match(h.html(),/data-aggregate-query-scope>印度 · 2026-10-11T00:00:00 至 2026-10-17T23:59:59 · 成功时间 2026-10-11T00:00:00 至 2026-10-17T23:59:59 · TukPay</);assert.doesNotMatch(h.html(),/data-provider-published|缺 54 项|live-retained-result|主表已完成/);
 h.override(q=>main(q)?prepared(q,'building'):undefined);wait.resolve();await run;await settle();assert.equal(h.L.results.length,0);assert.equal(h.L.queryFailures.length,18);assert(h.L.queryFailures.every(f=>f.status==='building'));assert.match(h.html(),/当前范围暂无可用统计 · 已读 0 \/ 18 平台/);assert.match(h.html(),/未完成数据不按 0 计算/);assert.match(h.html(),/data-aggregate-query-scope>印度 · 2026-10-11T00:00:00 至 2026-10-17T23:59:59 · 成功时间 2026-10-11T00:00:00 至 2026-10-17T23:59:59 · TukPay</);assert.doesNotMatch(h.html(),/data-provider-published|缺 54 项|主表已完成|provider-summary-kpis|live-retained-result/);
 const calls=h.calls.slice(n);assert.equal(calls.filter(attachments).length,0);assert.equal(calls.filter(q=>['providerSnapshot','aggregate'].includes(q.action)).length,0);for(const q of calls.filter(main))for(const r of q.requests){assert.equal(r.startAt,'2026-10-10T18:30:00.000Z');assert.equal(r.endAt,'2026-10-17T18:30:00.000Z');assert.equal(r.successStartAt,r.startAt);assert.equal(r.successEndAt,r.endAt);assert.equal(r.providers[0],'TukPay');}
 const before=h.calls.length;await h.c.liveRetryFailed();await settle();assert.equal(h.L.results.length,0);assert.equal(h.calls.slice(before).filter(attachments).length,0,'a manual failed-platform retry also avoids attachments without current orders');
});
test('a selected-provider prepared query starts its main reads before a slow rate directory',async()=>{
 const h=await fixture();h.c.HensemAmountBands={profile:()=>({edges:[100,200,300,400,500,1000,2000,5000,10000,20000,50000]})};range(h);const wait=deferred();let fee;
 h.override(q=>q.action==='rates'?(fee=q,wait.promise):main(q)?prepared(q):undefined);const run=h.c.liveQuery();await settle();assert(h.calls.some(main));assert.equal(h.L.results.length,18);assert.equal(h.L.loading,false);assert(fee);assert.match(h.html(),/主表已完成，正在补充统计/);assert.equal(h.L.amountBandProfiles,null);wait.resolve({rows:[],total:0});await run;await settle();
});
test('partial current orders never claim a complete main table while their attachments run',async()=>{
 const h=await fixture(),wait=deferred();range(h);h.override(q=>main(q)?{version:2,items:q.requests.flatMap(r=>prepared({...q,requests:[r]},r.platformId===platforms[0].id?'missing':'ready').items)}:q.action==='rates'?wait.promise:undefined);const run=h.c.liveQuery();await settle();assert.equal(h.L.results.length,17);assert.equal(h.L.queryFailures.length,1);assert.match(h.html(),/主表读取未完成，正在补充已返回范围的统计/);assert.doesNotMatch(h.html(),/主表已完成，正在补充统计|live-retained-result/);wait.resolve({rows:[],total:0});await run;await settle();assert.equal(h.L.results.length,17);
});
test('new query and navigation keep old late prepared responses from restoring stale scope',async()=>{
 const h=await fixture(),wait=deferred();range(h);let held;h.override(q=>{if(main(q)){held=q;return wait.promise;}});const run=h.c.liveQuery();await settle();h.c.setPage('amount');wait.resolve(prepared(held));await run;await settle();assert.equal(h.c.state.page,'amount');assert.equal(h.L.results.length,0);assert.doesNotMatch(h.html(),/TukPay|主表已完成/);
});
test('same exact live scope preserves its last complete table on forced transient failure, with an explicit old-result notice',async()=>{
 const h=await fixture();h.setDay('2026-10-14');await h.c.liveQuery();await settle();assert(h.L.retainedContent);const old=h.L.retainedContent,scope=old.queryScope;assert.equal(old.providerReadMode,'live');assert.equal(scope,h.L.queryScope);assert.match(old.html,/Synthetic provider/);
 h.override(q=>main(q)?prepared(q,'building'):undefined);await h.c.liveQuery(true);await settle();assert.equal(h.L.retainedContent,old);assert.equal(h.L.results.length,0);assert.equal(h.L.queryFailures.length,18);assert.match(h.html(),/本次读取未完成，以下保留上次查询结果/);assert.match(h.html(),/live-retained-result/);assert.match(h.html(),/Synthetic provider/);assert.doesNotMatch(h.html(),/data-provider-published|缺 54 项|主表已完成/);assert.equal(h.L.retainedContent.queryScope,scope);
});

test('prepared comparison and exact-period intake finish while the independent workorder stays held, without duplicate reads',async()=>{
 const h=await fixture(),wait=deferred();h.setNow('2026-10-18T12:00:00Z');range(h);let work=0,active=0,maxActive=0,intakeActive=0,maxIntakeActive=0;
 h.override(q=>q.action==='workorders'?(work++,wait.promise):main(q)?prepared(q):undefined);
 const request=h.c.hensemLiveRequest;h.c.hensemLiveRequest=async(q,options)=>{
  const tracked=main(q)||attachments(q),intake=q.action==='intakeCoverage';
  if(tracked){active++;maxActive=Math.max(maxActive,active);}if(intake){intakeActive++;maxIntakeActive=Math.max(maxIntakeActive,intakeActive);}
  try{return await request(q,options);}finally{if(tracked)active--;if(intake)intakeActive--;}
 };
 const run=h.c.liveQuery();await settle();
 assert.equal(h.L.results.length,18);assert.equal(h.L.comparisonStatus,'ready');assert.equal(h.L.comparisonResults.length,18);assert.equal(work,1);assert.equal(h.L.workordersLoading,true);assert.equal(h.L.workorders,null);
 const windows=[['providerIntake','2026-10-11','2026-10-17'],['providerComparisonIntake','2026-10-04','2026-10-10']];
 const intake=h.calls.filter(q=>q.action==='intakeCoverage'),catalog=intake.filter(q=>q.operation==='orderCatalog'),rows=intake.filter(q=>q.operation==='rows');
 assert.equal(catalog.length,1,'both periods share the existing catalog request');assert.equal(rows.length,18,'two-platform batches run once for each of the two 18-platform periods');
 for(const [key,from,to]of windows){
  const state=h.L[key];assert.equal(state.status,'ready');assert.equal(state.from,from);assert.equal(state.to,to);assert.equal(state.platforms.length,18);assert(state.platforms.every(p=>p.complete===false),'received evidence must not become proven source completeness');
  const period=rows.filter(q=>q.startAt===from&&q.endAt===to);assert.equal(period.length,9);assert(period.every(q=>q.feedIds.length===2));
  const ids=period.flatMap(q=>q.feedIds);assert.equal(ids.length,18);assert.equal(new Set(ids).size,18,'each native feed is requested once per period');assert.deepEqual(ids.slice().sort(),platforms.map(p=>feed(p).id).sort(),'only the exact authorized native feed set is read');
 }
 assert.deepEqual([...new Set(rows.map(q=>q.startAt+'|'+q.endAt))].sort(),windows.map(([,from,to])=>from+'|'+to).sort());
 assert.equal(maxIntakeActive,1,'the existing shared intake transport remains serial');assert(maxActive<=4,'prepared and supplementary readers retain the host physical request bound');assert.equal(active,1,'only the intentionally held workorder remains');
 const before=h.calls.length,comparison=JSON.stringify(h.L.comparisonResults),current=JSON.stringify(h.L.providerIntake),previous=JSON.stringify(h.L.providerComparisonIntake);
 wait.resolve({rows:[],total:0,byProvider:[],byDirection:{charge:{submittedCount:0}}});await run;await settle();
 assert.equal(h.L.workordersLoading,false);assert(h.L.workorders);assert.equal(work,1);assert.equal(active,0);assert.equal(h.calls.length,before,'settling the workorder does not start a duplicate attachment round');assert.equal(h.L.comparisonStatus,'ready');assert.equal(JSON.stringify(h.L.comparisonResults),comparison);assert.equal(JSON.stringify(h.L.providerIntake),current);assert.equal(JSON.stringify(h.L.providerComparisonIntake),previous);
});
