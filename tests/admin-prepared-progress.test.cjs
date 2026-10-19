// Real host + prepared manager with synthetic complete publications; no timing claim.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const definitions=fs.readFileSync(path.join(__dirname,'admin-provider-history-reuse-integration.test.cjs'),'utf8');
const withoutTests=name=>name==='node:test'?()=>{}:require(name);
const {ready,packed,provider,platforms}=new Function('require','__dirname',definitions+';return {ready,packed,provider,platforms};')(withoutTests,__dirname);
const settle=async()=>{for(let i=0;i<48;i++)await new Promise(resolve=>setImmediate(resolve));};
const pageWrites=h=>h.writes.filter(write=>write.id==='page').length;
function frames(h){let next=0;const pending=new Map();h.c.requestAnimationFrame=fn=>{pending.set(++next,fn);return next;};h.c.cancelAnimationFrame=id=>pending.delete(id);return {pending,flush(){const work=[...pending.values()];pending.clear();for(const fn of work)fn();}};}
async function partialRead(){
 const h=await ready(),missing=new Set(platforms.slice(15).map(p=>p.id));
 h.override(q=>{if(q.action!=='aggregatePrepared')return;const response=packed(q);for(const item of response.items)if(missing.has(item.request.platformId))delete item.providerReuse;return response;});
 await provider(h,'');const before=h.calls.length,frame=frames(h),held=[];
 h.override(q=>q.action==='aggregatePrepared'?new Promise((resolve,reject)=>held.push({q,resolve,reject})):undefined);
 h.c.liveProvider('TukPay');const run=h.c.liveQuery();await settle();
 assert.equal(h.L.results.length,15);assert.equal(h.L.loading,true);assert.equal(frame.pending.size,1,'all cached completions share one animation frame');
 const remote=h.calls.slice(before).filter(q=>q.action==='aggregatePrepared').flatMap(q=>q.requests);
 assert.equal(remote.length,3);assert(remote.every(q=>missing.has(q.platformId)));
 return {h,frame,held,run,finish:async()=>{h.override(q=>q.action==='aggregatePrepared'?packed(q):undefined);for(const item of held)item.resolve(packed(item.q));await run;await settle();}};
}
test('prepared partial results render 15 of 18 while three exact reads are pending, without declaring a full total',async()=>{
 const read=await partialRead(),{h,frame}=read,before=pageWrites(h),calls=h.calls.length;
 frame.flush();assert.equal(pageWrites(h),before+1);assert.match(h.html(),/15 \/ 18/);assert.match(h.html(),/部分结果/);assert.match(h.html(),/已读取合计/);assert.doesNotMatch(h.html(),/全部汇总/);assert.equal(h.L.loading,true);assert.equal(h.L.queryFailures.length,0);assert.equal(h.calls.length,calls,'painting launches no supplementary requests');
 assert(h.L.results.every(result=>result.groups.provider[0].provider==='TukPay'));assert(h.L.results.every(result=>result.groups.provider[0].success_amount===null),'unknown financial values stay unknown');
 await read.finish();assert.equal(h.L.results.length,18);assert.equal(h.L.loading,false);assert.equal(frame.pending.size,0);assert.doesNotMatch(h.html(),/三方汇总（部分结果）/);
});
test('leaving a page cancels the pending progress frame and late reads cannot paint the destination',async()=>{
 const read=await partialRead(),{h,frame}=read;h.c.setPage('amount');const before=pageWrites(h),html=h.html();frame.flush();assert.equal(pageWrites(h),before);assert.equal(h.html(),html);await read.finish();assert.equal(h.c.state.page,'amount');assert.equal(h.html(),html);assert.equal(h.L.results.length,0);assert.equal(frame.pending.size,0);
});
test('queued partial paint rejects changed account, native metadata and current filters',async()=>{
 for(const kind of ['account','native','filters','permission']){
  const read=await partialRead(),{h,frame}=read;
  if(kind==='account')h.c.hensemDataScope={identity:'another-synthetic-account',mode:'all'};
  if(kind==='native')h.L.catalog=h.L.catalog.map(p=>p.id===platforms[0].id?{...p,capabilities:{revision:'changed'}}:p);
  if(kind==='filters')h.c.liveMetricTimeSet('successFrom','2026-10-10T00:00:00');
  if(kind==='permission')h.c.hensemRoleAllowed=()=>false;
  const before=pageWrites(h),html=h.html();frame.flush();assert.equal(pageWrites(h),before,kind);assert.equal(h.html(),html,kind);
  h.c.setPage('amount');await read.finish();assert.equal(frame.pending.size,0,kind);
 }
});
test('a permission failure during pending reads clears partial results instead of completing the old table',async()=>{
 const read=await partialRead(),{h,frame,held,run}=read;frame.flush();assert.match(h.html(),/15 \/ 18/);
 for(const item of held)item.reject(Object.assign(Error('Synthetic permission denial'),{code:'ADMIN_LIVE_PERMISSION_DENIED'}));
 await run;await settle();assert.equal(frame.pending.size,0);assert.equal(h.L.results.length,0);assert.match(h.L.error,/权限/);assert.doesNotMatch(h.html(),/全部汇总/);
});
