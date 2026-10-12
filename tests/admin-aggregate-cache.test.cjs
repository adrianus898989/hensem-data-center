// Real host code, synthetic document/requests only; no database or credentials.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
let prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const boot='  if(isSupervisorPage(state.page))render();else initializeLiveData();';
const exposed=" window.__cacheTest={readAggregate,cachedAggregate,clearAggregateCache,stats:()=>({entries:aggregateCache.size,bytes:aggregateCacheBytes,inflight:aggregateInflight.size})};\n"+boot;
prefix=prefix.replace('vm.runInContext(source,context,','vm.runInContext(source.replace('+JSON.stringify(boot)+','+JSON.stringify(exposed)+'),context,');
const {harness,settle,deferred,aggregate,P}=new Function('require','__dirname',prefix+';return {harness,settle,deferred,aggregate,P};')(require,__dirname);
const stats=h=>h.c.__cacheTest.stats(),queries=h=>h.calls.filter(q=>q.action==='aggregate');
function response(q,p=P,extra={}){return {...aggregate(p,65),startAt:q.startAt,endAt:q.endAt,...extra};}
async function ready(){const h=harness();await settle();h.c.hensemDataScope={mode:'selected',identity:'SYNTHETIC-SCOPE-1'};h.c.hensemRoleAccess={mode:'assigned',roleId:'SYNTHETIC-ROLE',version:1,assignmentVersion:1,canView:true,permissions:['merchants.view','merchants.query']};h.c.hensemRoleAllowed=()=>true;h.c.setPage('merchants');await settle();h.L.from='2026-09-22T00:00:00';h.L.to='2026-09-22T05:59:59';h.setHandler(q=>q.action==='aggregate'?response(q):q.action==='rates'?{rows:[],total:0}:q.action==='providerOptions'?{providers:[]}:aggregate());return h;}
function request(extra={}){return {action:'aggregate',view:'providers',platformId:P.id,startAt:'2026-09-21T18:30:00.000Z',endAt:'2026-09-22T00:30:00.000Z',direction:'all',status:'all',currency:'INR',offset:0,limit:20,...extra};}
const read=(h,q=request(),cache=true)=>h.c.__cacheTest.readAggregate(q,h.L.serial,cache);

test('merchant repeat query reuses both periods; dedicated refresh bypasses cache and keeps read time truthful',async()=>{
 const h=await ready();await h.c.liveQuery();await settle();assert.equal(queries(h).length,2);assert(queries(h).every(q=>q.view==='providers'));const original=h.L.results[0]._aggregateReadAt,allCalls=h.calls.length;
 h.setNow('2026-09-23T12:01:00Z');await h.c.liveQuery();await settle();assert.equal(queries(h).length,2);assert.equal(h.calls.length,allCalls,'same merchant query starts no extra RPC');assert.equal(h.L.results[0]._aggregateReadAt,original);assert.equal(h.L.results[0]._aggregateCacheHit,true);assert.match(h.nodes.get('liveFilters').innerHTML,/liveQuery\(true\)/);assert.match(h.nodes.get('liveFilters').innerHTML,/数据读取[^]*缓存/);
 await h.c.liveQuery(true);await settle();assert.equal(queries(h).length,4);assert.equal(h.L.results[0]._aggregateCacheHit,false);assert(h.L.results[0]._aggregateReadAt>original);
});
test('overview normal query reuses complete reads, displays original read time, and refresh bypasses cache',async()=>{
 const h=await ready();h.c.setPage('overview');await settle();await h.c.liveQuery();await settle();const before=queries(h).length,readAt=h.L.results[0]._aggregateReadAt;
 assert(before>0);h.setNow('2026-09-23T12:00:20Z');await h.c.liveQuery();await settle();assert.equal(queries(h).length,before);assert.equal(h.L.results[0]._aggregateReadAt,readAt);assert.equal(h.L.results[0]._aggregateCacheHit,true);assert.match(h.nodes.get('liveFilters').innerHTML,/liveQuery\(true\)/);assert.match(h.nodes.get('liveFilters').innerHTML,/数据读取[^]*缓存/);
 await h.c.liveQuery(true);await settle();assert(queries(h).length>before);assert.equal(h.L.results[0]._aggregateCacheHit,false);assert(h.L.results[0]._aggregateReadAt>readAt);
});
test('live overview cache retains its exact as-of boundary, then advances on expiry or explicit refresh',async()=>{
 const h=await ready();h.c.setPage('overview');await settle();h.L.from='2026-09-23T00:00:00';h.L.to='2026-09-23T23:59:59';h.L.dirty=true;await h.c.liveQuery();await settle();const before=queries(h).length,asOf=h.L.queryNow,end=h.L.results[0].endAt;
 h.setNow('2026-09-23T12:00:20Z');await h.c.liveQuery();await settle();assert.equal(queries(h).length,before);assert.equal(h.L.queryNow,asOf);assert.equal(h.L.results[0].endAt,end);
 h.setNow('2026-09-23T12:00:30Z');await h.c.liveQuery();await settle();assert(queries(h).length>before);assert(h.L.queryNow>asOf);assert(Date.parse(h.L.results[0].endAt)>Date.parse(end));const advanced=h.L.queryNow;
 h.setNow('2026-09-23T12:00:35Z');await h.c.liveQuery(true);await settle();assert(h.L.queryNow>advanced);assert.equal(h.L.results[0]._aggregateCacheHit,false);
});
test('host query propagates normal or forced refresh to supplementary caches without launching the phase scheduler on overview',async()=>{
 const members=[],snapshots=[];const h=harness({extraModules:['live-member-counts.js','live-pending-snapshot.js'],beforeLive(c){for(const [name,method,observed]of [['HensemLiveMemberCounts','beginQuery',members],['HensemLivePendingSnapshot','load',snapshots]]){const create=c[name].create;c[name].create=config=>{const api=create(config),run=api[method];api[method]=force=>{observed.push(force);return run(force)};return api;};}}});await settle();h.setHandler(q=>q.action==='aggregate'?response(q):{rows:[],providers:[]});h.L.from='2026-09-22T00:00:00';h.L.to='2026-09-22T05:59:59';
 await h.c.liveQuery();await settle();assert.equal(members.at(-1),false);assert.equal(snapshots.at(-1),false);
 await h.c.liveQuery(true);await settle();assert.equal(members.at(-1),true);assert.equal(snapshots.at(-1),true);assert.equal(h.L.loading,false);
});
test('history providers expire at five minutes; current and asOf-dependent full responses at thirty seconds',async()=>{
 for(const [q,ttl] of [[request(),300000],[request({view:'full'}),30000],[request({startAt:'2026-09-23T00:00:00Z',endAt:'2026-09-23T12:00:00Z'}),30000]]){
  const h=await ready();await read(h,q);const initial=queries(h).length;h.setNow(new Date(Date.parse('2026-09-23T12:00:00Z')+ttl-1).toISOString());const hit=await read(h,q);assert.equal(queries(h).length,initial);assert.equal(hit._aggregateCacheHit,true);h.setNow(new Date(Date.parse('2026-09-23T12:00:00Z')+ttl).toISOString());await read(h,q);assert.equal(queries(h).length,initial+1);
 }
});
test('identical active requests share one transport and do not expose mutable cache objects',async()=>{
 const h=await ready(),wait=deferred();h.setHandler(()=>wait.promise);const a=read(h,request(),false),b=read(h,request(),false);await settle();assert.equal(queries(h).length,1);assert.equal(stats(h).inflight,1);wait.resolve(response(request()));const [ra,rb]=await Promise.all([a,b]);assert.equal(ra.total,rb.total);assert.equal(stats(h).entries,1);assert.equal(stats(h).inflight,0);ra.summary[0].all_count=999;const hit=await read(h);assert.equal(hit.summary[0].all_count,65);hit.groups.provider[0].provider='MUTATED';assert.notEqual((await read(h)).groups.provider[0].provider,'MUTATED');
});
test('failed, incomplete, wrong-clock, and missing group responses never become reusable complete snapshots',async()=>{
 for(const extra of [{coverage:{complete:false}},{partial:true},{complete:false},{startAt:'2026-01-01T00:00:00Z'},{groups:{}}]){
  const h=await ready();h.setHandler(q=>response(q,P,extra));await read(h);await read(h);assert.equal(queries(h).length,2);assert.equal(stats(h).entries,0);
 }
 const h=await ready();h.setHandler(()=>{throw Error('Synthetic offline');});await assert.rejects(read(h),/Synthetic offline/);assert.equal(stats(h).inflight,0);assert.equal(stats(h).entries,0);h.setHandler(q=>response(q));await read(h);assert.equal(stats(h).entries,1);
});
test('role, data-scope and source directory changes isolate results; denied reads and new documents retain nothing',async()=>{
 const h=await ready();await read(h);h.c.hensemRoleAccess.assignmentVersion++;await read(h);assert.equal(queries(h).length,2);assert.equal(stats(h).entries,1);h.c.hensemDataScope.identity='SYNTHETIC-SCOPE-2';await read(h);assert.equal(queries(h).length,3);h.L.catalog=[{...P,sourceName:'SYNTHETIC-OTHER-NATIVE'}];await read(h);assert.equal(queries(h).length,4);
 h.c.hensemRoleAllowed=()=>false;await assert.rejects(read(h),/权限|范围/);assert.equal(stats(h).entries,0);assert.equal(queries(h).length,4);const next=await ready();assert.equal(stats(next).entries,0);await read(next);assert.equal(queries(next).length,1);
});
test('same scoped result may serve another authorized page, but its query permission cannot be bypassed',async()=>{
 const h=await ready();await read(h);h.c.setPage('time');assert.equal((await read(h))._aggregateCacheHit,true);assert.equal(queries(h).length,1);
 h.c.hensemRoleAllowed=(page,action)=>page!=='time'||action!=='query';await assert.rejects(read(h),/权限|范围/);assert.equal(queries(h).length,1);assert.equal(stats(h).entries,0);h.c.setPage('merchants');await read(h);assert.equal(queries(h).length,2);
});
test('native split reads retain their authority and cache only the complete contiguous whole result',async()=>{
 const h=await ready(),p={...P,id:'5e952cbb-e42f-d6b1-a24a-a0d42d165df9',name:'91CLUB'};h.L.catalog=[p];h.setHandler(q=>response(q,p));const q=request({platformId:p.id,startAt:'2026-09-21T18:30:00Z',endAt:'2026-09-22T04:30:00Z'}),r=await read(h,q);assert.equal(queries(h).length,3);assert.equal(r._parts.length,3);assert.equal(typeof r._aggregateAccessContext,'string');assert(r._parts.every(x=>x._aggregateAccessContext===r._aggregateAccessContext));assert.equal(r.total,195);const hit=await read(h,q);assert.equal(queries(h).length,3);assert.equal(hit.total,195);assert.equal(hit._aggregateCacheHit,true);
});
test('navigation aborts the actual aggregate signal and rejects a late success without caching it',async()=>{
 const h=await ready(),wait=deferred(),signals=[];h.c.hensemLiveRequest=(q,options)=>{h.calls.push(q);signals.push(options?.signal);return wait.promise;};const old=read(h,request(),false);await settle();h.c.setPage('time');assert.equal(signals[0].aborted,true);wait.resolve(response(request()));await assert.rejects(old,/替换/);assert.equal(stats(h).entries,0);assert.equal(stats(h).inflight,0);
});
test('authority change during a flight rejects old data; fresh same request has a separate transport',async()=>{
 const h=await ready(),oldWait=deferred(),newWait=deferred();let n=0;h.setHandler(()=>++n===1?oldWait.promise:newWait.promise);const old=read(h);await settle();h.c.hensemRoleAccess.version++;const fresh=read(h);await settle();assert.equal(queries(h).length,2);oldWait.resolve(response(request(),P,{total:999}));await assert.rejects(old,/替换/);newWait.resolve(response(request()));assert.equal((await fresh).total,65);assert.equal((await read(h)).total,65);
});
test('cache bounds and exact request filters prevent uncontrolled retention or cross-member/provider reads',async()=>{
 const h=await ready();for(let i=0;i<140;i++)await read(h,request({memberId:'SYNTHETIC-'+i}));assert.equal(stats(h).entries,128);assert(stats(h).bytes<=16*1024*1024);const before=queries(h).length;await read(h,request({memberId:'SYNTHETIC-139'}));assert.equal(queries(h).length,before);await read(h,request({memberId:'SYNTHETIC-139',providers:['Different']}));assert.equal(queries(h).length,before+1);await read(h,request({currency:'USD'}));assert.equal(queries(h).length,before+2);
});
test('merchant trends load full only on demand, keep totals while loading, then support cached tab switches',async()=>{
 const h=await ready();await h.c.liveQuery();const original=h.L.results,wait=deferred();h.setHandler(q=>q.action==='aggregate'?wait.promise:aggregate());const pending=h.c.liveReferenceSet('view','trend');await settle();assert.equal(h.L.results,original);assert.equal(queries(h).length,3);assert.equal(queries(h).at(-1).view,undefined);assert.match(h.html(),/正在按需读取订单趋势/);assert.doesNotMatch(h.html(),/<svg class="live-chart"/);await h.c.liveReferenceSet('view','trend');assert.equal(queries(h).length,3);wait.resolve(response(queries(h).at(-1)));await pending;assert.equal(h.L.loadedView,'full');assert.equal(h.L.merchantTrend.status,'ready');assert.match(h.html(),/订单趋势/);h.c.liveReferenceSet('view','business');await h.c.liveReferenceSet('view','trend');assert.equal(queries(h).length,3);assert(h.L.results[0].groups.hourly.length);
});
test('leaving a trend read or changing filters prevents a late response from replacing the merchant ledger',async()=>{
 for(const change of [h=>h.c.setPage('time'),h=>h.c.liveSet('provider','Changed')]){
  const h=await ready();await h.c.liveQuery();const wait=deferred();h.setHandler(q=>q.action==='aggregate'?wait.promise:aggregate());const run=h.c.liveReferenceSet('view','trend');await settle();change(h);const results=h.L.results;wait.resolve(response(request({view:'full'}),P,{total:999}));await run;assert.equal(h.L.results,results);assert(!h.L.results.some(r=>r.total===999));
 }
});
test('a new host query replaces an unstarted aggregate without sending old filters or leaving a pending query',async()=>{
 const h=await ready(),old=h.c.liveQuery();h.c.liveSet('provider','SYNTHETIC-NEW-SCOPE');const fresh=h.c.liveQuery();await Promise.all([old,fresh]);await settle();
 assert.equal(queries(h).length,2,'only the current and previous windows under the new filters reach transport');assert(queries(h).every(q=>q.providers?.length===1&&q.providers[0]==='SYNTHETIC-NEW-SCOPE'));assert.equal(h.L.results.length,1);assert.equal(h.L.results[0].total,65);assert.equal(h.L.queryFailures.length,0);assert.equal(h.L.loading,false);assert.equal(stats(h).inflight,0);assert.equal(stats(h).entries,2);
});
test('a bounded multi-day failure caches only completed leaves and retry preserves their exact clocks',async()=>{
 const h=await ready(),from='2026-09-19T18:30:00.000Z',middle='2026-09-20T18:30:00.000Z',last='2026-09-21T18:30:00.000Z',end='2026-09-22T00:30:00.000Z',q=request({startAt:from,endAt:end});let failed=true;
 h.setHandler(r=>{if(r.startAt===middle&&failed)throw Error('Synthetic source offline');return response(r);});await assert.rejects(h.c.__cacheTest.readAggregate(q,h.L.serial,false,true),/Synthetic source offline/);assert.equal(stats(h).entries,1,'an incomplete overall period is never cached as complete');assert.equal(h.c.__cacheTest.cachedAggregate(q),null);
 failed=false;const r=await h.c.__cacheTest.readAggregate(q,h.L.serial,true,true);assert.equal(queries(h).filter(x=>x.startAt===from).length,1);assert.equal(queries(h).filter(x=>x.startAt===middle).length,2);assert(queries(h).some(x=>x.startAt===last&&x.endAt===end));assert.deepEqual(Array.from(r._parts,p=>[p.startAt,p.endAt]),[[from,middle],[middle,last],[last,end]]);assert.equal(r.total,195);const before=queries(h).length;assert.equal((await read(h,q)).total,195);assert.equal(queries(h).length,before,'only the successful contiguous whole range can be reused on the next query');
});
