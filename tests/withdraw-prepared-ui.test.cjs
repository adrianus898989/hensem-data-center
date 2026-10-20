const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(pageName='auto_withdraw'){
 let renders=0;
 const calls=[],pending=[],context={Date,Intl,AbortController,document:{getElementById:()=>null,querySelector:()=>null},HensemLiveFilters:{multi:()=>''}},L={catalogReady:true,catalog:[{name:'A',country:'印度',team:'M8',source:'ar',timezone:'Asia/Kolkata'}],withdrawCatalog:[],country:'印度',team:'M8',multi:{team:['M8']},from:'2026-10-15T00:00:00',to:'2026-10-15T23:59:59'};
 context.window=context;vm.createContext(context);for(const name of['live-report-data.js','live-withdraw-pages.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../admin-preview',name),'utf8'),context);
 const page=context.HensemLiveWithdrawPages.create({L,E:String,C:String,N:String,R:(n,d)=>d?n/d*100+'%':'—',box:(_,x)=>x,table:()=>'',render(){renders++},page:()=>pageName,request(q,o){calls.push({q,o});return new Promise((resolve,reject)=>pending.push({resolve,reject}))}});
 return {context,L,page,calls,pending,get renders(){return renders}};
}
const data=n=>({prepared:{status:'ready',contract:'withdraw-independent-windows-v2',generation:'synthetic-'+n},rows:[{country:'印度',platform:'A',total:n,success:n,processed:n}],total:1,totals:{total:n,processed:n},startDate:'2026-10-15',endDate:'2026-10-15',notes:[]});
for(const view of['auto_withdraw','withdraw_operators'])test(view+' pending never replaces applied data, date changes are draft, one light read per click',async()=>{
 const f=fixture(view);let run=f.page.load();f.pending.shift().resolve(data(3));await run;const original=f.page.state.data,applied=f.page.state.applied;
 f.context.withdrawDate('from','2026-10-14');assert.equal(f.calls.length,1);assert.equal(f.page.state.data,original);
 run=f.page.load();f.pending.shift().resolve({prepared:{status:'building'},rows:null,totals:null,total:null});await run;
 assert.equal(f.page.state.data,original);assert.equal(f.page.state.applied,applied);assert.equal(f.page.state.dirty,false);assert.match(f.page.render(),/后台正在准备/);assert.equal(f.calls.length,2);assert.equal(f.page.state.loading,false);
 run=f.page.load();f.pending.shift().resolve({...data(7),startDate:'2026-10-14'});await run;assert.equal(f.page.state.data.totals.total,7);assert.equal(f.page.state.prepared,null);assert.equal(f.calls.length,3);assert.equal(f.page.state.applied.query.startAt.slice(0,10),'2026-10-14');
});
test('prepared late replies cannot overwrite another selection, paused page, or revoked access',async()=>{
 const f=fixture();const old=f.page.load();f.context.withdrawDate('from','2026-10-13');assert.equal(f.calls[0].o.signal.aborted,true);const fresh=f.page.load();f.pending[1].resolve(data(8));await fresh;f.pending[0].resolve({prepared:{status:'failed'},rows:null});await old;assert.equal(f.page.state.data.totals.total,8);assert.equal(f.page.state.prepared,null);
 const paused=f.page.load();f.page.pause();f.pending[2].resolve(data(9));await paused;assert.equal(f.page.state.data.totals.total,8);
 const revoked=f.page.load();f.context.hensemRoleAccess={canView:false};f.pending[3].resolve(data(10));await revoked;assert.equal(f.page.state.data,null);assert.equal(f.page.state.applied,null);
});
test('initial pending/failed remain unknown, without zero totals or native fallback',async()=>{
 const f=fixture();for(const status of['missing','stale','failed']){const run=f.page.load();f.pending.shift().resolve({prepared:{status},rows:null,totals:null,total:null});await run;assert.equal(f.page.state.data,null);assert.equal(f.page.state.applied,null);assert.match(f.page.render(),/后台正在准备|统计准备暂未完成/);}assert.equal(f.calls.length,3);
});

test('server permission denial clears previously applied data even before local role metadata refreshes',async()=>{
 for(const code of['42501','ADMIN_LIVE_PERMISSION_DENIED','ADMIN_LIVE_SESSION_DENIED','ROLE_DENIED']){const f=fixture();let run=f.page.load();f.pending.shift().resolve(data(5));await run;f.page.state.reasonData={rows:[{note:'synthetic'}]};run=f.page.load();f.pending.shift().reject(Object.assign(new Error('denied'),{code}));await run;assert.equal(f.page.state.data,null);assert.equal(f.page.state.applied,null);assert.equal(f.page.state.reasonData,null);assert.match(f.page.render(),/权限已变化/);}
});

test('pending polling only rereads the same exact prepared scope, is bounded and stops after draft/cancel',async()=>{
 const f=fixture(),timers=new Map();let id=0;f.context.setTimeout=fn=>{timers.set(++id,fn);return id};f.context.clearTimeout=key=>timers.delete(key);let run=f.page.load();f.pending.shift().resolve({prepared:{status:'building'}});await run;
 for(let n=0;n<20;n++){assert.equal(timers.size,1);const[k,fn]=timers.entries().next().value;timers.delete(k);fn();f.pending.shift().resolve({prepared:{status:'building'}});await new Promise(resolve=>setImmediate(resolve));}
 assert.equal(timers.size,0);assert.equal(f.calls.length,21);assert.equal(f.page.state.prepared.status,'paused');for(const call of f.calls)assert.equal(JSON.stringify(call.q),JSON.stringify(f.calls[0].q));
 run=f.page.load();f.pending.shift().resolve({prepared:{status:'building'}});await run;assert.equal(timers.size,1);f.context.withdrawDate('from','2026-10-12');assert.equal(timers.size,0);
 run=f.page.load();f.pending.shift().resolve({prepared:{status:'building'}});await run;assert.equal(timers.size,1);f.page.pause();assert.equal(timers.size,0);
});
test('an operator page that becomes ready after pending applies its requested offset atomically',async()=>{
 const f=fixture('withdraw_operators'),timers=new Map();let timerId=0;f.context.setTimeout=fn=>{timers.set(++timerId,fn);return timerId};f.context.clearTimeout=id=>timers.delete(id);
 let run=f.page.load();f.pending.shift().resolve({...data(5),total:60});await run;
 f.page.state.page=2;run=f.page.load();assert.equal(f.calls[1].q.offset,20);f.pending.shift().resolve({prepared:{status:'building'}});await run;
 assert.equal(f.page.state.page,1);assert.equal(f.page.state.applied.query.offset,0);
 const[timerKey,poll]=timers.entries().next().value;timers.delete(timerKey);poll();f.pending.shift().resolve({...data(8),total:60});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.page.state.page,2);assert.equal(f.page.state.applied.query.offset,20);assert.equal(f.page.state.data.totals.processed,8);
});

test('ready expired withdrawal results retain real generation time and explicit background refresh status',async()=>{
 for(const refreshState of ['idle','queued','running','failed']){
  const f=fixture(),run=f.page.load();const value=data(3);Object.assign(value.prepared,{computedAt:'2026-10-15T05:10:00Z',expiresAt:'2026-10-15T05:20:00Z',freshness:'refresh_due',refreshState});f.pending.shift().resolve(value);await run;
  assert.equal(f.page.state.data.totals.total,3);assert.equal(f.page.state.data.prepared.computedAt,'2026-10-15T05:10:00Z');assert.equal(f.page.state.prepared,null);assert.match(f.page.render(),/更新于 2026-10-15 10:40:00/);assert.match(f.page.render(),new RegExp(refreshState==='failed'?'更新未完成':['queued','running'].includes(refreshState)?'更新中':'待更新'));assert.equal(f.calls.length,1);
 }
});

function budgetClock(f){
 let now=0,id=0;const timers=new Map();f.context.Date=class extends Date{static now(){return now}};
 f.context.setTimeout=(fn,ms)=>{timers.set(++id,{fn,ms});return id};f.context.clearTimeout=key=>timers.delete(key);
 return {timers,set(value){now=value},fire(){const[key,timer]=timers.entries().next().value;timers.delete(key);timer.fn();return timer.ms}};
}
test('one deadline stops a stalled withdrawal request, preserves the last result and permits explicit resume',async()=>{
 const f=fixture(),clock=budgetClock(f);let run=f.page.load();f.pending.shift().resolve(data(3));await run;
 run=f.page.load();const stalled=f.pending.shift();assert.equal([...clock.timers.values()][0].ms,60000);
 clock.set(60000);clock.fire();await run;assert.equal(f.calls.at(-1).o.signal.aborted,true);assert.equal(f.page.state.loading,false);assert.equal(f.page.state.prepared.status,'paused');assert.equal(f.page.state.data.totals.total,3);assert.match(f.page.render(),/继续读取/);assert.equal(clock.timers.size,0);
 run=f.page.load();assert.equal([...clock.timers.values()][0].ms,60000);stalled.resolve(data(99));await new Promise(resolve=>setImmediate(resolve));assert.equal(f.page.state.data.totals.total,3);f.pending.shift().resolve(data(8));await run;assert.equal(f.page.state.data.totals.total,8);assert.equal(clock.timers.size,0);
});
test('prepared polling stops at one minute while the final in-flight transfer has a bounded grace',async()=>{
 const f=fixture(),clock=budgetClock(f);let run=f.page.load();clock.set(55000);f.pending.shift().resolve({prepared:{status:'building'}});await run;
 assert.equal(clock.fire(),3000);clock.set(58000); // The first poll was dispatched at55s before this clock advances.
 assert.equal([...clock.timers.values()][0].ms,10000);clock.set(65000);clock.fire();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.page.state.prepared.status,'paused');assert.equal(f.page.state.loading,false);assert.equal(clock.timers.size,0);assert.equal(f.calls.length,2);
});
test('a late cancelled response cannot clear the newer selection deadline',async()=>{
 const f=fixture(),clock=budgetClock(f),old=f.page.load();f.context.withdrawDate('from','2026-10-13');const fresh=f.page.load();assert.equal(clock.timers.size,1);f.pending[0].resolve(data(99));await old;assert.equal(clock.timers.size,1);clock.set(60000);clock.fire();await fresh;assert.equal(f.page.state.prepared.status,'paused');assert.equal(f.page.state.data,null);assert.equal(clock.timers.size,0);
});

test('a submitted dirty filter does not ask the user to query again while its request is active',async()=>{
 const f=fixture();let run=f.page.load();f.pending.shift().resolve(data(3));await run;f.context.withdrawDate('from','2026-10-14');assert.match(f.page.render(),/筛选条件已修改/);run=f.page.load();assert.doesNotMatch(f.page.render(),/筛选条件已修改，点击查询更新/);assert.match(f.page.render(),/正在读取自动出款统计/);f.pending.shift().resolve(data(7));await run;
});

test('the final prepared wait is clamped to the remaining whole-read budget',async()=>{
 const f=fixture(),clock=budgetClock(f),run=f.page.load();clock.set(59500);f.pending.shift().resolve({prepared:{status:'building'}});await run;assert.equal([...clock.timers.values()][0].ms,500);clock.set(60000);clock.fire();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,1);assert.equal(f.page.state.prepared.status,'paused');assert.equal(clock.timers.size,0);
});
test('a ready response past the deadline cannot bypass an event-loop-delayed timeout callback',async()=>{
 const f=fixture(),clock=budgetClock(f),run=f.page.load();clock.set(60001);f.pending.shift().resolve(data(99));await run;assert.equal(f.page.state.data,null);assert.equal(f.page.state.applied,null);assert.equal(f.page.state.prepared.status,'paused');assert.equal(clock.timers.size,0);
});

for(const view of ['auto_withdraw','withdraw_operators'])for(const status of ['missing','building','stale'])test(view+' '+status+' preparation remains visible throughout a same-scope background poll',async()=>{
 const f=fixture(view),clock=budgetClock(f),run=f.page.load();
 assert.match(f.page.render(),/正在读取/);f.pending.shift().resolve({prepared:{status}});await run;
 const prepared=f.page.state.prepared,query=JSON.stringify(f.calls[0].q),waiting=f.page.render();
 assert.match(waiting,/后台正在准备/);assert.match(waiting,/>准备中…<\/button>/);
 clock.set(3000);assert.equal(clock.fire(),3000);assert.equal(f.calls.length,2);
 assert.equal(f.page.state.loading,true);assert.equal(f.page.state.prepared,prepared);assert.equal(JSON.stringify(f.calls[1].q),query);
 const polling=f.page.render();assert.match(polling,/后台正在准备/);assert.match(polling,/>准备中…<\/button>/);
 assert.doesNotMatch(polling,/正在读取|筛选条件已修改/);assert.equal(f.page.state.data,null);
 assert.equal([...clock.timers.values()][0].ms,57000,'poll keeps the original deadline');
 f.pending.shift().resolve(data(9));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.page.state.loading,false);assert.equal(f.page.state.prepared,null);assert.equal(f.page.state.data.totals.total,9);assert.equal(clock.timers.size,0);
});
test('manual retry clears the preparation message and starts one normal read',async()=>{
 const f=fixture(),clock=budgetClock(f),first=f.page.load();f.pending.shift().resolve({prepared:{status:'building'}});await first;
 const retry=f.page.load();assert.equal(f.calls.length,2);assert.equal(f.page.state.prepared,null);assert.match(f.page.render(),/正在读取/);assert.doesNotMatch(f.page.render(),/后台正在准备/);
 f.pending.shift().resolve(data(5));await retry;assert.equal(f.page.state.data.totals.total,5);assert.equal(clock.timers.size,0);
});
test('a background poll failure replaces preparation with the real error while retaining applied results',async()=>{
 const f=fixture(),clock=budgetClock(f);let run=f.page.load();f.pending.shift().resolve(data(4));await run;const previous=f.page.state.data;
 run=f.page.load();f.pending.shift().resolve({prepared:{status:'building'}});await run;clock.set(3000);clock.fire();
 assert.equal(f.page.state.data,previous);assert.match(f.page.render(),/上次成功结果已保留/);
 f.pending.shift().reject(Error('synthetic transport failure'));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.page.state.loading,false);assert.equal(f.page.state.prepared,null);assert.equal(f.page.state.data,previous);
 assert.match(f.page.render(),/synthetic transport failure/);assert.doesNotMatch(f.page.render(),/后台正在准备|正在读取/);assert.equal(clock.timers.size,0);
});
test('changing a prepared polling scope cancels it and a late preparation cannot restore the old message',async()=>{
 const f=fixture(),clock=budgetClock(f),first=f.page.load();f.pending.shift().resolve({prepared:{status:'building'}});await first;clock.set(3000);clock.fire();
 const old=f.pending.shift(),signal=f.calls[1].o.signal;f.context.withdrawDate('from','2026-10-14');
 assert.equal(signal.aborted,true);assert.equal(f.page.state.prepared,null);assert.equal(clock.timers.size,0);
 const next=f.page.load();assert.match(f.page.render(),/正在读取/);assert.doesNotMatch(f.page.render(),/后台正在准备/);
 old.resolve({prepared:{status:'stale'}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.page.state.prepared,null);assert.equal(f.page.state.loading,true);assert.equal(clock.timers.size,1);
 f.pending.shift().resolve({...data(8),startDate:'2026-10-14'});await next;assert.equal(f.page.state.data.totals.total,8);assert.equal(clock.timers.size,0);
});

for(const view of ['auto_withdraw','withdraw_operators'])test(view+' accepts a ready final poll within transfer grace without another query',async()=>{
 const f=fixture(view),clock=budgetClock(f),first=f.page.load();
 clock.set(55000);f.pending.shift().resolve({prepared:{status:'building'}});await first;
 clock.set(58000);clock.fire();assert.equal(f.calls.length,2);assert.equal([...clock.timers.values()][0].ms,10000);
 clock.set(62000);f.pending.shift().resolve(data(17));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.page.state.data.totals.total,17);assert.equal(f.page.state.prepared,null);assert.equal(f.page.state.loading,false);assert.equal(clock.timers.size,0);assert.equal(f.calls.length,2);
});
test('final poll still pending in transfer grace pauses without scheduling another poll',async()=>{
 const f=fixture(),clock=budgetClock(f),first=f.page.load();clock.set(55000);f.pending.shift().resolve({prepared:{status:'building'}});await first;
 clock.set(58000);clock.fire();clock.set(62000);f.pending.shift().resolve({prepared:{status:'building'}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.calls.length,2);assert.equal(f.page.state.data,null);assert.equal(f.page.state.prepared.status,'paused');assert.equal(clock.timers.size,0);
});
test('transfer grace cannot accept a ready response after its own deadline',async()=>{
 const f=fixture(),clock=budgetClock(f),first=f.page.load();clock.set(55000);f.pending.shift().resolve({prepared:{status:'building'}});await first;
 clock.set(58000);clock.fire();clock.set(68001);f.pending.shift().resolve(data(99));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.page.state.data,null);assert.equal(f.page.state.prepared.status,'paused');assert.equal(clock.timers.size,0);
});
for(const action of ['date','pause','permission'])test('final transfer grace rejects late data after '+action,async()=>{
 const f=fixture(),clock=budgetClock(f),first=f.page.load();clock.set(55000);f.pending.shift().resolve({prepared:{status:'building'}});await first;
 clock.set(58000);clock.fire();const late=f.pending.shift();clock.set(61000);
 if(action==='date')f.context.withdrawDate('from','2026-10-14');else if(action==='pause')f.page.pause();else f.context.hensemRoleAccess={canView:false};
 late.resolve(data(99));await new Promise(resolve=>setImmediate(resolve));assert.equal(f.page.state.data,null);assert.equal(f.page.state.applied,null);assert.equal(clock.timers.size,0);
});

for(const view of ['auto_withdraw','withdraw_operators'])test(view+' quick dates and day shifts leave optional success inputs entirely manual',()=>{
 const f=fixture(view);
 for(const manual of [false,true]){
  f.L.successFrom=manual?'2026-10-09T08:00:00':'';f.L.successTo=manual?'2026-10-10T09:00:00':'';
  const expected=[f.L.successFrom,f.L.successTo];
  for(const key of ['today','yesterday','before','week','lastweek','month','lastmonth']){f.context.withdrawPeriod(key);assert.deepEqual([f.L.successFrom,f.L.successTo],expected,key);}
  for(const n of [-1,1]){const before=f.L.from;f.context.withdrawShift(n);assert.notEqual(f.L.from,before);assert.deepEqual([f.L.successFrom,f.L.successTo],expected);}
 }
 f.context.withdrawReset();assert.equal(f.L.successFrom,'');assert.equal(f.L.successTo,'');assert.equal(f.calls.length,0);
});

const stage=(done=1,more={})=>({prepared:{status:'building',contract:'withdraw-independent-windows-v2',progress:{
 contract:'withdraw-stages-v1',generation:'a'.repeat(32),doneParts:done,pendingParts:8,running:false,lastProgressAt:'2026-10-20T07:00:00Z',...more
}},rows:null,totals:null,total:null});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function advanceStage(f,clock,at,payload){
 clock.set(at);clock.fire();assert(f.pending.length,'poll dispatched');
 f.pending.shift().resolve(payload);await settle();
}
for(const view of ['auto_withdraw','withdraw_operators'])test(view+' advancing one generation automatically displays ready results after a minute without another click',async()=>{
 const f=fixture(view),clock=budgetClock(f);let run=f.page.load();f.pending.shift().resolve(data(4));await run;
 const old=f.page.state.data;f.context.withdrawDate('from','2026-10-14');run=f.page.load();f.pending.shift().resolve(stage());await run;
 assert.equal(f.page.state.dirty,false);assert.equal(f.page.state.data,old);assert.doesNotMatch(f.page.render(),/查看结果|筛选条件已修改/);
 await advanceStage(f,clock,3000,stage(2));assert.equal([...clock.timers.values()][0].ms,5000);
 clock.set(65000);clock.fire();assert.equal([...clock.timers.values()][0].ms,10000);
 assert.equal(f.page.state.data,old);assert.doesNotMatch(f.page.render(),/正在读取|筛选条件已修改/);
 f.pending.shift().resolve(stage(3));await settle();assert.equal(f.page.state.prepared.status,'building');
 await advanceStage(f,clock,100000,stage(4));assert.equal([...clock.timers.values()][0].ms,10000);
 await advanceStage(f,clock,120000,{...data(19),startDate:'2026-10-14'});
 assert.equal(f.page.state.data.totals.total,19);assert.equal(f.page.state.applied.query.startAt.slice(0,10),'2026-10-14');
 assert.equal(f.page.state.prepared,null);assert.equal(f.page.state.loading,false);assert.equal(clock.timers.size,0);
 for(const call of f.calls.slice(1))assert.equal(JSON.stringify(call.q),JSON.stringify(f.calls[1].q));
});
for(const evidence of ['running','checkpoint'])test('same-generation '+evidence+' confirms ongoing work without renewing the total budget',async()=>{
 const f=fixture(),clock=budgetClock(f),first=f.page.load();f.pending.shift().resolve(stage());await first;
 await advanceStage(f,clock,3000,stage(1,evidence==='running'?{running:true}:{lastProgressAt:'2026-10-20T07:00:01Z'}));
 clock.set(179999);clock.fire();assert.equal([...clock.timers.values()][0].ms,1,'no transfer grace may exceed the three-minute total cap');
 clock.set(180001);f.pending.shift().resolve(data(99));await settle();
 assert.equal(f.page.state.prepared.status,'paused');assert.equal(f.page.state.data,null);assert.equal(clock.timers.size,0);
});
test('a merely queued unchanged stage cannot extend the original one-minute wait',async()=>{
 const f=fixture(),clock=budgetClock(f),first=f.page.load();f.pending.shift().resolve(stage(0));await first;
 await advanceStage(f,clock,55000,stage(0));assert.equal([...clock.timers.values()][0].ms,3000);
 await advanceStage(f,clock,58000,stage(0));assert.equal([...clock.timers.values()][0].ms,2000);
 clock.set(60000);clock.fire();await settle();assert.equal(f.calls.length,3);
 assert.equal(f.page.state.prepared.status,'paused');assert.equal(clock.timers.size,0);
});
test('progress polling never starts more than forty reads even if the clock or progress advances unusually',async()=>{
 const f=fixture(),clock=budgetClock(f),first=f.page.load();f.pending.shift().resolve(stage());await first;
 for(let n=2;n<=40;n++)await advanceStage(f,clock,n,stage(n,{running:true}));
 assert.equal(f.calls.length,40);assert.equal(f.page.state.prepared.status,'paused');assert.equal(clock.timers.size,0);
});
for(const change of ['generation','missing','regression'])test('extended polling stops when its confirmed progress '+change+' changes',async()=>{
 const f=fixture(),clock=budgetClock(f),first=f.page.load();f.pending.shift().resolve(stage());await first;
 await advanceStage(f,clock,3000,stage(2));
 await advanceStage(f,clock,8000,change==='missing'?{prepared:{status:'building'}}:stage(change==='regression'?1:3,change==='generation'?{generation:'b'.repeat(32)}:{}));
 assert.equal(f.page.state.prepared.status,'paused');assert.equal(clock.timers.size,0);assert.equal(f.calls.length,3);
});
for(const invalid of [{contract:'unknown'}, {doneParts:-1}, {lastProgressAt:'invalid'}, {generation:'untrusted'}, {pendingParts:1.5}, {running:'true'}])test('invalid progress metadata stops polling: '+JSON.stringify(invalid),async()=>{
 const f=fixture(),clock=budgetClock(f),first=f.page.load();f.pending.shift().resolve(stage(1,invalid));await first;
 assert.equal(clock.timers.size,0);assert.equal(f.page.state.prepared,null);assert.match(f.page.state.error,/进度无效/);
});
for(const stop of ['failed','unknown','permission','date','pause'])test('an extended wait stops on '+stop+' and rejects a late response',async()=>{
 const f=fixture(),clock=budgetClock(f),first=f.page.load();f.pending.shift().resolve(stage());await first;
 await advanceStage(f,clock,3000,stage(2));clock.set(65000);clock.fire();const late=f.pending.shift(),signal=f.calls.at(-1).o.signal;
 if(stop==='date')f.context.withdrawDate('from','2026-10-14');
 if(stop==='pause')f.page.pause();
 if(stop==='permission')f.context.hensemRoleAccess={canView:false};
 late.resolve(stop==='failed'?{prepared:{status:'failed'}}:stop==='unknown'?{prepared:{status:'unexpected'}}:data(99));await settle();
 assert.equal(clock.timers.size,0);assert.equal(f.page.state.loading,false);assert.equal(f.page.state.data,null);
 if(['date','pause'].includes(stop))assert.equal(signal.aborted,true);
 if(stop==='failed')assert.equal(f.page.state.prepared.status,'failed');
 if(stop==='unknown')assert.match(f.page.state.error,/状态无效/);
});
test('an extended poll has its own ten-second timeout and cannot apply its late response',async()=>{
 const f=fixture(),clock=budgetClock(f),first=f.page.load();f.pending.shift().resolve(stage());await first;
 await advanceStage(f,clock,3000,stage(2));clock.set(8000);clock.fire();const late=f.pending.shift();
 assert.equal([...clock.timers.values()][0].ms,10000);clock.set(18000);clock.fire();await settle();
 assert.equal(f.page.state.prepared.status,'paused');assert.equal(f.calls.at(-1).o.signal.aborted,true);assert.equal(clock.timers.size,0);
 late.resolve(data(99));await settle();assert.equal(f.page.state.data,null);
});
test('unchanged preparation polls do not repaint the table or create another query prompt',async()=>{
 const f=fixture(),clock=budgetClock(f),first=f.page.load();f.pending.shift().resolve(stage());await first;const rendered=f.renders;
 clock.set(3000);clock.fire();assert.equal(f.renders,rendered);
 f.pending.shift().resolve(stage(2));await settle();assert.equal(f.renders,rendered);
 assert.equal(f.page.state.dirty,false);assert.doesNotMatch(f.page.render(),/筛选条件已修改|查看结果/);
 await advanceStage(f,clock,8000,data(9));assert(f.renders>rendered);
});
for(const change of ['permission','catalog','draft'])test('waiting timer cancels before dispatch when '+change+' changes outside the control callback',async()=>{
 const f=fixture(),clock=budgetClock(f),first=f.page.load();f.pending.shift().resolve(stage());await first;
 await advanceStage(f,clock,3000,stage(2));
 if(change==='permission')f.context.hensemRoleAccess={canView:false};
 if(change==='catalog')f.L.catalog[0].timezone='UTC';
 if(change==='draft')f.L.from='2026-10-14T00:00:00';
 clock.set(8000);clock.fire();await settle();
 assert.equal(f.calls.length,2);assert.equal(clock.timers.size,0);assert.equal(f.page.state.prepared,null);assert.equal(f.page.state.loading,false);
});
test('restoring a left page cannot revive polling or advertise automatic completion without an active wait',async()=>{
 const f=fixture(),clock=budgetClock(f),first=f.page.load();f.pending.shift().resolve(stage());await first;
 const saved=f.page.capture();f.page.pause();assert.equal(clock.timers.size,0);
 f.page.restore(saved);assert.equal(f.page.state.prepared.status,'paused');assert.match(f.page.render(),/继续读取/);assert.doesNotMatch(f.page.render(),/完成后自动显示/);
 assert.equal(f.calls.length,1);assert.equal(clock.timers.size,0);
});
