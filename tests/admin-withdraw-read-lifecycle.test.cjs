/* Real main host/withdraw modules; synthetic catalog and deferred transport only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,deferred,P}=new Function('require','__dirname',prefix+';return {harness,settle,deferred,P};')(require,__dirname);
const platforms=Array.from({length:18},(_,i)=>({...P,id:String(i+1).padStart(8,'0')+'-1111-4111-8111-111111111111',name:'SYN'+String(i+1).padStart(2,'0'),team:'M8'}));
function response(q){const rows=platforms.filter(p=>q.platforms.includes(p.name)).map((p,i)=>({country:'印度',platform:p.name,source:'AR',total:i+10,success:i+5,rejected:2,autoCount:i+6,manualCount:4,avgSeconds:60,durationBasis:'applied_to_completed',durationSampleCount:i+10,previous:{avgSeconds:30,durationBasis:'applied_to_completed'}}));return {total:rows.length,rows,notes:[],totals:{total:333,platforms:rows.length},startDate:'2026-10-12',endDate:'2026-10-12',previousStartDate:'2026-10-11',previousEndDate:'2026-10-11'};}
async function setup({settleOnAbort=false}={}){let api,ready;const health={cancelled:0,requestsCancelled:[],eligibleOnPaint:[]};
 const h=harness({page:'auto_withdraw',platforms,roleAccess:{mode:'owner',canView:true},roleAllowed:()=>true,beforeLive(c){c.HensemLiveSyncHealth={configure(o){ready=o.ready},cancel(){health.cancelled++},schedule(){if(ready)health.eligibleOnPaint.push(ready())},badge:()=>''};c.hensemLiveCancelRequests=actions=>health.requestsCancelled.push(actions);const create=c.HensemLiveWithdrawPages.create;c.HensemLiveWithdrawPages.create=config=>api=create(config)}});await settle();
 h.L.team='M8';h.L.multi.team=['M8'];h.L.from='2026-10-12T00:00:00';h.L.to='2026-10-12T23:59:59';h.L.initialReadComplete=true;
 const reads=[];h.c.hensemLiveRequest=(q,options={})=>{const d=deferred();reads.push({q,signal:options.signal,d});if(settleOnAbort)options.signal?.addEventListener('abort',()=>d.reject(Object.assign(Error('查询已取消'),{name:'AbortError'})),{once:true});return d.promise};
 return {...h,api,health,reads,ready:()=>ready()};
}
async function succeed(h,read=h.reads.at(-1)){read.d.resolve(response(read.q));await settle();}

test('one all-platform auto read owns actual health busy state and forwards AbortSignal before repaint',async()=>{
 const h=await setup(),start=h.health.eligibleOnPaint.length,run=h.c.liveQuery();await settle();assert.equal(h.reads.length,1);const read=h.reads[0];assert.equal(read.q.action,'autoWithdraw');assert.equal(read.q.platforms.length,18);assert.equal(read.q.limit,500);assert.equal(read.q.offset,0);assert(read.signal instanceof AbortSignal);assert.equal(read.signal.aborted,false);
 assert.equal(h.api.state.loading,true);assert.equal(h.L.autoWithdrawLoading,true);assert.equal(h.ready(),false);assert(h.health.cancelled>0);assert(h.health.requestsCancelled.some(actions=>actions.includes('syncHealth')));assert(h.health.eligibleOnPaint.slice(start).every(x=>x===false));
 await succeed(h);await run;assert.equal(h.api.state.localSnapshot,true);assert.equal(h.L.autoWithdrawLoading,false);assert.equal(h.ready(),true);for(let i=0;i<20;i++){h.api.render();h.c.withdrawSort('success');h.c.withdrawPage(1);h.c.withdrawSize(50);}assert.equal(h.reads.length,1,'render, previous/duration cells, sorting and local pagination do not reread');
});
test('identical in-flight Query joins its pending result and double clicks never clear loading or start another RPC',async()=>{
 const h=await setup(),first=h.c.liveQuery();await settle();let finished=false;const joined=h.c.liveQuery().then(()=>{finished=true});await settle();assert.equal(h.reads.length,1);assert.equal(finished,false);assert.equal(h.L.autoWithdrawLoading,true);assert.equal(h.ready(),false);await succeed(h);await Promise.all([first,joined]);assert.equal(finished,true);assert.equal(h.reads.length,1);
});
test('date replacement aborts the previous transport and its late reply/finally cannot clear the current owner',async()=>{
 const h=await setup(),old=h.c.liveQuery();await settle();const previous=h.reads[0];h.c.withdrawDate('from','2026-10-11');assert.equal(previous.signal.aborted,true);assert.equal(h.api.state.loading,false);assert.equal(h.L.autoWithdrawLoading,false);const current=h.c.liveQuery();await settle();const active=h.reads[1];assert.equal(active.signal.aborted,false);assert.equal(h.ready(),false);
 previous.d.resolve({...response(previous.q),totals:{total:999999}});await old;await settle();assert.equal(h.api.state.loading,true);assert.equal(h.L.autoWithdrawLoading,true);assert.equal(h.ready(),false);assert.equal(active.signal.aborted,false);assert.notEqual(h.api.state.data?.totals?.total,999999);await succeed(h,active);await current;assert.equal(h.L.autoWithdrawLoading,false);assert.equal(h.api.state.data.totals.total,333);
});
test('transport rejection on abort releases the cancelled read while keeping its replacement active',async()=>{
 const h=await setup({settleOnAbort:true}),old=h.c.liveQuery();await settle();const previous=h.reads[0];h.c.withdrawDate('to','2026-10-13');const current=h.c.liveQuery();await old;await settle();assert.equal(previous.signal.aborted,true);assert.equal(h.reads.length,2);assert.equal(h.api.state.loading,true);assert.equal(h.L.autoWithdrawLoading,true);assert.equal(h.ready(),false);assert.equal(h.api.state.error,'');await succeed(h);await current;assert.equal(h.L.autoWithdrawLoading,false);
});
test('pausing or leaving the page cancels the real transport and restoring its snapshot never revives loading',async()=>{
 const h=await setup(),run=h.c.liveQuery();await settle();const read=h.reads[0],saved=h.api.capture();h.c.setPage('time');assert.equal(read.signal.aborted,true);assert.equal(h.L.autoWithdrawLoading,false);read.d.resolve(response(read.q));await run;h.api.restore(saved);assert.equal(h.api.state.loading,false);assert.equal(h.L.autoWithdrawLoading,false);assert.equal(h.api.state.data,null);
});
test('a failed same-scope refresh releases health, preserves stored values, exposes failure and remains retryable',async()=>{
 const h=await setup(),first=h.c.liveQuery();await settle();await succeed(h);await first;const snapshot=h.api.state.data,readCount=h.reads.length,failed=h.c.liveQuery();await settle();assert.equal(h.reads.length,readCount+1,'there is no new TTL cache hiding a retry');h.reads.at(-1).d.reject(Error('自动出款统计读取超时，请重试'));await failed;assert.equal(h.api.state.data,snapshot);assert.match(h.api.state.error,/读取超时/);assert.equal(h.L.autoWithdrawLoading,false);assert.equal(h.ready(),true);const retry=h.c.liveQuery();await settle();await succeed(h);await retry;assert.equal(h.api.state.error,'');assert.equal(h.reads.length,readCount+2);
});
test('daily and operator queries retain genuine server reads with the same busy and abort lifecycle',async()=>{
 for(const mode of ['daily','operators']){const h=await setup();if(mode==='daily')h.api.state.daily=true;else h.c.state.page='withdraw_operators';const first=h.c.liveQuery();await settle();assert.equal(h.reads[0].q.limit,20);assert.equal(h.reads[0].q.view,mode==='daily'?'auto':'operators');assert.equal(h.ready(),false);h.api.cancel();assert.equal(h.reads[0].signal.aborted,true);assert.equal(h.L.autoWithdrawLoading,false);h.reads[0].d.resolve(response(h.reads[0].q));await first;assert.equal(h.api.state.data,null);}
});
test('invalid new scope cancels the old read without sending a broader country request or inventing an empty result',async()=>{
 const h=await setup(),old=h.c.liveQuery();await settle();const read=h.reads[0];h.L.team='missing-team';h.L.multi.team=['missing-team'];await h.c.liveQuery();assert.equal(read.signal.aborted,true);assert.equal(h.reads.length,1);assert.equal(h.api.state.data,null);assert.match(h.api.state.error,/没有可读取的出款平台/);assert.equal(h.L.autoWithdrawLoading,false);read.d.resolve(response(read.q));await old;assert.equal(h.api.state.data,null);
});
