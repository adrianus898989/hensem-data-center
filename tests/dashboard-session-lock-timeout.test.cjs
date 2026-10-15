/* Execute the real auth client with synthetic sessions, clocks and Web Locks only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const renewalPath=path.join(__dirname,'dashboard-session-renewal.test.cjs');
const prefix=fs.readFileSync(renewalPath,'utf8').split(/\ntest\(/)[0];
function runtime(){
 let now=0,id=0;const timers=new Map();
 const schedule=(callback,ms)=>{timers.set(++id,{callback,at:now+ms});return id;};
 const clear=id=>timers.delete(id);
 const api=new Function('require','__dirname','setTimeout','clearTimeout',prefix+';return {harness,storageGroup,session,json,gatewayAction,tick,A,B};')(createRequire(renewalPath),__dirname,schedule,clear);
 return {...api,timers,async advance(h,milliseconds){now+=milliseconds;h.advance(milliseconds);for(const [key,timer]of [...timers].sort((a,b)=>a[1].at-b[1].at)){if(timers.has(key)&&timer.at<=now){timers.delete(key);timer.callback();await api.tick();}}}};
}
function queuedLocks({ignoreAbort=false}={}){
 const requests=[];
 return {requests,request(name,options,callback){
  const item={name,options,granted:false,aborted:false};requests.push(item);
  return new Promise((resolve,reject)=>{
   const abort=()=>{if(!item.granted){item.aborted=true;if(!ignoreAbort)reject(new DOMException('Synthetic lock wait aborted','AbortError'));}};
   options.signal?.addEventListener('abort',abort,{once:true});
   item.grant=()=>{item.granted=true;options.signal?.removeEventListener('abort',abort);Promise.resolve().then(()=>callback({name,mode:'exclusive'})).then(resolve,reject);};
   if(options.signal?.aborted)abort();
  });
 }};
}
function heldHarness(r,options){const group=r.storageGroup(),locks=queuedLocks(options);group.locks=locks;return {h:r.harness(group),locks,group};}

test('blocked Web Lock times out all joined callers, preserves the session and allows a new locked retry',async()=>{
 const r=runtime(),{h,locks}=heldHarness(r),old=r.session('queued',5),next=r.session('recovered');h.api.saveDashboardSession(old);h.setFetch(()=>r.json(next));
 let settled=false;const pending=Promise.allSettled([h.api.ensureDashboardSession(old),h.api.ensureDashboardSession(old),h.api.dashboardAuthenticatedFetch('https://supabase.offline.invalid/rest/v1/offline_table',{},old)]).then(value=>{settled=true;return value;});
 await r.tick();assert.equal(locks.requests.length,1);assert.equal(h.calls.length,0);assert.equal(r.timers.size,1);assert.equal(locks.requests[0].options.mode,'exclusive');assert.equal(locks.requests[0].options.steal,undefined);assert.equal(locks.requests[0].options.ifAvailable,undefined);
 await r.advance(h,14999);assert.equal(settled,false);await r.advance(h,1);const results=await pending;
 for(const result of results){assert.equal(result.status,'rejected');assert.equal(result.reason.code,'refresh_coordination_timeout');assert.equal(h.api.isDashboardAuthTerminalError(result.reason),false);assert(!result.reason.message.includes(old.access_token));assert(!result.reason.message.includes(old.refresh_token));}
 assert.equal(locks.requests[0].options.signal.aborted,true);assert.equal(h.saved().refresh_token,old.refresh_token);assert.equal(h.calls.length,0);assert.equal(r.timers.size,0);
 const retry=h.api.ensureDashboardSession(old);await r.tick();assert.equal(locks.requests.length,2,'expired refreshFlights entry must be removed');locks.requests[1].grant();assert.equal((await retry).access_token,next.access_token);assert.equal(h.refreshCalls().length,1);assert.equal(h.saved().refresh_token,next.refresh_token);assert.equal(r.timers.size,0);
});

test('a lock implementation that ignores abort still cannot keep the flight pending or start a late refresh',async()=>{
 const r=runtime(),{h,locks}=heldHarness(r,{ignoreAbort:true}),old=r.session('late-lock',5);h.api.saveDashboardSession(old);h.setFetch(()=>{throw Error('Late lock callback must not fetch');});
 const pending=h.api.ensureDashboardSession(old).catch(error=>error);await r.tick();await r.advance(h,15000);assert.equal((await pending).code,'refresh_coordination_timeout');assert.equal(h.calls.length,0);
 locks.requests[0].grant();await r.tick();assert.equal(h.calls.length,0);assert.equal(h.saved().refresh_token,old.refresh_token);
 const retry=h.api.ensureDashboardSession(old).catch(error=>error);await r.tick();assert.equal(locks.requests.length,2);await r.advance(h,15000);assert.equal((await retry).code,'refresh_coordination_timeout');assert.equal(r.timers.size,0);
});

test('granting the lock ends its wait deadline while the existing HTTP deadline still bounds the refresh',async()=>{
 const r=runtime(),{h,locks}=heldHarness(r),old=r.session('delayed-grant',5),next=r.session('fresh-after-grant');h.api.saveDashboardSession(old);let complete;h.setFetch(call=>new Promise(resolve=>{complete=()=>resolve(r.json(next));assert.equal(r.gatewayAction(call),'refresh');}));
 let finished=false;const pending=h.api.ensureDashboardSession(old).then(value=>{finished=true;return value;});await r.tick();await r.advance(h,14000);locks.requests[0].grant();await r.tick();assert.equal(h.refreshCalls().length,1);
 await r.advance(h,2000);assert.equal(finished,false);assert.equal(locks.requests[0].options.signal.aborted,false);assert.equal(h.refreshCalls()[0].signal.aborted,false,'lock wait deadline must not abort an acquired refresh');assert.equal(r.timers.size,1,'only the existing HTTP timeout remains');
 complete();assert.equal((await pending).access_token,next.access_token);assert.equal(r.timers.size,0);
});

test('an acquired refresh HTTP timeout remains transient and clears the flight for the next attempt',async()=>{
 const r=runtime(),{h,locks}=heldHarness(r),old=r.session('http-wait',5);h.api.saveDashboardSession(old);h.setFetch(call=>new Promise((_resolve,reject)=>call.signal.addEventListener('abort',()=>reject(new DOMException('Synthetic HTTP abort','AbortError')),{once:true})));
 const pending=h.api.ensureDashboardSession(old).catch(error=>error);await r.tick();locks.requests[0].grant();await r.tick();await r.advance(h,15000);const error=await pending;
 assert.equal(error.code,'refresh_network_error');assert.equal(h.api.isDashboardAuthTerminalError(error),false);assert.equal(locks.requests[0].options.signal.aborted,false);assert.equal(h.saved().refresh_token,old.refresh_token);assert.equal(r.timers.size,0);
 h.setFetch(()=>r.json(r.session('after-http-timeout')));const retry=h.api.ensureDashboardSession(old);await r.tick();assert.equal(locks.requests.length,2);locks.requests[1].grant();await retry;assert.equal(h.refreshCalls().length,2);
});

test('logout and account changes while waiting cannot revive or use the previous account after grant',async()=>{
 for(const change of ['logout','switch']){
  const r=runtime(),{h,locks}=heldHarness(r),old=r.session('old-account',5),other=r.session('new-account',3600,r.B);h.api.saveDashboardSession(old);const pending=h.api.ensureDashboardSession(old).catch(error=>error);await r.tick();h.api.saveDashboardSession(change==='logout'?null:other);locks.requests[0].grant();const error=await pending;
  assert.equal(error.code,change==='logout'?'session_logged_out':'session_changed');assert.equal(h.calls.length,0);assert.equal(h.saved()?.user.id??null,change==='logout'?null:r.B);assert.equal(r.timers.size,0);
 }
});

test('another tab may recover the saved session while a lock wait expires; the next check reuses its valid rotation',async()=>{
 const r=runtime(),{h,locks,group}=heldHarness(r),other=r.harness(group),old=r.session('same-account-old',5),next=r.session('other-tab-fresh');h.api.saveDashboardSession(old);
 const pending=h.api.ensureDashboardSession(old).catch(error=>error);await r.tick();other.api.saveDashboardSession(next);await r.advance(h,15000);assert.equal((await pending).code,'refresh_coordination_timeout');assert.equal(h.saved().access_token,next.access_token);
 assert.equal((await h.api.ensureDashboardSession(old)).access_token,next.access_token);assert.equal(locks.requests.length,1);assert.equal(h.calls.length,0);assert.equal(other.calls.length,0);
});

test('Web Lock API errors preserve the session and never fall back to uncoordinated refresh',async()=>{
 const r=runtime(),group=r.storageGroup();let calls=0;group.locks={request(){calls++;throw new DOMException('Synthetic blocked lock manager','SecurityError');}};const h=r.harness(group),old=r.session('restricted-lock',5);h.api.saveDashboardSession(old);
 const error=await h.api.ensureDashboardSession(old).catch(value=>value);assert.equal(error.code,'refresh_coordination_failed');assert.equal(h.api.isDashboardAuthTerminalError(error),false);assert.equal(h.saved().refresh_token,old.refresh_token);assert.equal(h.calls.length,0);assert.equal(calls,1);assert.equal(r.timers.size,0);
});
