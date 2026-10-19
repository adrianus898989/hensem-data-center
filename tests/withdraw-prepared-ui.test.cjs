const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(pageName='auto_withdraw'){
 const calls=[],pending=[],context={Date,Intl,AbortController,document:{getElementById:()=>null,querySelector:()=>null},HensemLiveFilters:{multi:()=>''}},L={catalogReady:true,catalog:[{name:'A',country:'印度',team:'M8',source:'ar',timezone:'Asia/Kolkata'}],withdrawCatalog:[],country:'印度',team:'M8',multi:{team:['M8']},from:'2026-10-15T00:00:00',to:'2026-10-15T23:59:59'};
 context.window=context;vm.createContext(context);for(const name of['live-report-data.js','live-withdraw-pages.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../admin-preview',name),'utf8'),context);
 const page=context.HensemLiveWithdrawPages.create({L,E:String,C:String,N:String,R:(n,d)=>d?n/d*100+'%':'—',box:(_,x)=>x,table:()=>'',render(){},page:()=>pageName,request(q,o){calls.push({q,o});return new Promise((resolve,reject)=>pending.push({resolve,reject}))}});
 return {context,L,page,calls,pending};
}
const data=n=>({prepared:{status:'ready',contract:'withdraw-independent-windows-v2',generation:'synthetic-'+n},rows:[{country:'印度',platform:'A',total:n,success:n,processed:n}],total:1,totals:{total:n,processed:n},startDate:'2026-10-15',endDate:'2026-10-15',notes:[]});
for(const view of['auto_withdraw','withdraw_operators'])test(view+' pending never replaces applied data, date changes are draft, one light read per click',async()=>{
 const f=fixture(view);let run=f.page.load();f.pending.shift().resolve(data(3));await run;const original=f.page.state.data,applied=f.page.state.applied;
 f.context.withdrawDate('from','2026-10-14');assert.equal(f.calls.length,1);assert.equal(f.page.state.data,original);
 run=f.page.load();f.pending.shift().resolve({prepared:{status:'building'},rows:null,totals:null,total:null});await run;
 assert.equal(f.page.state.data,original);assert.equal(f.page.state.applied,applied);assert.equal(f.page.state.dirty,true);assert.match(f.page.render(),/后台正在准备/);assert.equal(f.calls.length,2);assert.equal(f.page.state.loading,false);
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
test('RPC waiting and later prepared polls consume the same whole-query budget',async()=>{
 const f=fixture(),clock=budgetClock(f);let run=f.page.load();clock.set(55000);f.pending.shift().resolve({prepared:{status:'building'}});await run;
 assert.equal(clock.fire(),3000);clock.set(58000); // The first poll was dispatched at55s before this clock advances.
 assert.equal([...clock.timers.values()][0].ms,5000);clock.set(60000);clock.fire();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.page.state.prepared.status,'paused');assert.equal(f.page.state.loading,false);assert.equal(clock.timers.size,0);assert.equal(f.calls.length,2);
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
