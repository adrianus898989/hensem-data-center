// Real host query/cache code with synthetic platforms and deferred transports.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const setup=fs.readFileSync(path.join(__dirname,'admin-aggregate-cache.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,ready,read,request,response,stats,queries,settle,deferred,P}=new Function('require','__dirname',setup+';return {harness,ready,read,request,response,stats,queries,settle,deferred,P};')(require,__dirname);
const replaceNative=(h,patch)=>{h.L.catalog=h.L.catalog.map(p=>p.id===P.id?{...p,...patch}:p);};

test('a native change before the transport microtask sends no obsolete query',async()=>{
 const h=await ready(),old=read(h),rejected=assert.rejects(old,/替换|范围/);
 replaceNative(h,{sourceName:'SYNTHETIC-REPLACEMENT'});await rejected;
 assert.equal(queries(h).length,0);assert.equal(stats(h).entries,0);assert.equal(stats(h).inflight,0);
});

test('a late native response cannot be displayed or stored under the new native identity',async()=>{
 for(const patch of [{sourceName:'SYNTHETIC-REPLACEMENT'},{source:'newar'},{timezone:'Asia/Karachi'},{currency:'PKR'},{capabilities:{syntheticChanged:true}}]){
  const h=await ready(),wait=deferred();h.setHandler(()=>wait.promise);
  const old=read(h),rejected=assert.rejects(old,/替换|范围/);await settle();
  replaceNative(h,patch);wait.resolve(response(request()));await rejected;
  assert.equal(stats(h).entries,0);assert.equal(stats(h).inflight,0);
  h.setHandler(q=>response(q));const fresh=await read(h);assert.notEqual(fresh._aggregateCacheHit,true);
  assert.equal(queries(h).length,2);assert.equal((await read(h))._aggregateCacheHit,true);
 }
});

test('removing the requested native target rejects its late result',async()=>{
 const h=await ready(),wait=deferred();h.setHandler(()=>wait.promise);
 const old=read(h),rejected=assert.rejects(old,/替换|范围/);await settle();
 h.L.catalog=[];wait.resolve(response(request()));await rejected;assert.equal(stats(h).entries,0);
});

test('the current native request has a separate flight and an obsolete completion cannot replace its snapshot',async()=>{
 const h=await ready(),oldWait=deferred(),freshWait=deferred();let calls=0;
 h.setHandler(()=>++calls===1?oldWait.promise:freshWait.promise);
 const old=read(h),rejected=assert.rejects(old,/替换|范围/);await settle();
 replaceNative(h,{sourceName:'SYNTHETIC-REPLACEMENT'});const fresh=read(h);await settle();assert.equal(queries(h).length,2);
 freshWait.resolve(response(request()));assert.equal((await fresh).total,65);
 oldWait.resolve(response(request(),P,{total:999}));await rejected;
 assert.equal((await read(h)).total,65);assert.equal(queries(h).length,2);
});

test('an obsolete native denial does not evict an already completed current native snapshot',async()=>{
 const h=await ready(),late=deferred();h.setHandler(()=>late.promise);
 const old=read(h),rejected=assert.rejects(old);await settle();
 replaceNative(h,{sourceName:'SYNTHETIC-REPLACEMENT'});h.setHandler(q=>response(q));await read(h);
 late.reject(Object.assign(Error('Synthetic obsolete authority denial'),{code:'ADMIN_LIVE_PERMISSION_DENIED'}));await rejected;
 assert.equal((await read(h))._aggregateCacheHit,true);assert.equal(queries(h).length,2);
});

for(const page of ['overview','providers','provider_payout','collection','payout','success_analysis','time','amount','matrix','provider_daily','latency','risk','teamops','teamcountries','teamplatforms','merchants','orders'])test(page+': exact order/member filtering retains raw-query native isolation with independent clocks enabled',async()=>{
 const h=harness({roleAccess:{mode:'owner',canView:true},roleAllowed:()=>true,extraModules:['live-statistic-windows.js','live-prepared-aggregates.js','live-success-analysis.js']});await settle();h.c.setPage(page);await settle();
 const wait=deferred();h.setHandler(q=>q.action==='aggregate'?wait.promise:{providers:[]});
 const q=request({memberId:'SYNTHETIC-EXACT-MEMBER',successStartAt:'2026-09-20T18:30:00Z',successEndAt:'2026-09-21T00:30:00Z',successBasis:'source_updated'});
 const old=read(h,q),rejected=assert.rejects(old,/替换|范围/);await settle();
 assert.equal(queries(h).length,1);assert.equal(h.calls.filter(q=>q.action==='aggregatePrepared').length,0,'exact filters preserve their existing raw endpoint');
 replaceNative(h,{sourceName:'SYNTHETIC-REPLACEMENT'});wait.resolve(response(q));await rejected;assert.equal(stats(h).entries,0);
});

test('a directory change between a bounded leaf and assembly cannot cache a mixed-native whole',async()=>{
 const h=await ready(),q=request({startAt:'2026-09-19T18:30:00Z',endAt:'2026-09-22T00:30:00Z'});
 h.setHandler(leaf=>({then(resolve){resolve(response(leaf));queueMicrotask(()=>replaceNative(h,{sourceName:'SYNTHETIC-REPLACEMENT'}));}}));
 await assert.rejects(h.c.__cacheTest.readAggregate(q,h.L.serial,false,true),/替换|范围/);
 assert.equal(queries(h).length,1,'a changed source cannot start another daily leaf');assert.equal(stats(h).entries,0);
});

test('cached raw delivery rechecks native, actor and query replacement before its microtask returns',async()=>{
 for(const change of ['native','actor','filter']){
  const h=await ready();await read(h);const pending=read(h),rejected=assert.rejects(pending,/替换|范围/);
  if(change==='native')replaceNative(h,{sourceName:'SYNTHETIC-REPLACEMENT'});
  if(change==='actor')h.c.hensemDataScope.identity='SYNTHETIC-NEW-ACTOR';
  if(change==='filter')h.c.liveSet('provider','SYNTHETIC-NEW-FILTER');
  await rejected;assert.equal(queries(h).length,1,'obsolete cached delivery never launches another transport');
 }
});
