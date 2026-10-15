const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/ownerPreviewVerification.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){const timers=new Map();let seq=0;const m={exports:{}};vm.runInNewContext(source,{module:m,exports:m.exports,AbortController,Error,setTimeout:(fn,ms)=>{timers.set(++seq,{fn,ms});return seq},clearTimeout:id=>timers.delete(id)});return{api:m.exports,timers,fire(ms){const entry=[...timers].find(([,x])=>x.ms===ms);assert(entry,'scheduled '+ms+' ms deadline');timers.delete(entry[0]);entry[1].fn()}}}
test('a stalled permission or body read has a bounded deadline and aborts only that attempt',async()=>{
 for(const phase of ['permission','body']){
  const h=setup(),parent=new AbortController();let child,resolve;
  const result=h.api.ownerPreviewVerificationAttempt(async signal=>{child=signal;if(phase==='body')await Promise.resolve();return new Promise(r=>resolve=r)},parent.signal);
  const rejected=assert.rejects(result,e=>e.code==='owner_preview_timeout'&&h.api.ownerPreviewRetryable(e));await flush();assert.equal(child.aborted,false);h.fire(15000);await rejected;
  assert.equal(child.aborted,true);assert.equal(parent.signal.aborted,false);assert.equal(h.timers.size,0);resolve('synthetic late private body');await flush();
  assert.equal(await h.api.ownerPreviewVerificationAttempt(async()=>true,parent.signal),true);assert.equal(h.timers.size,0);
 }
});
test('three hanging attempts exhaust the bounded budget without overlapping active signals',async()=>{
 const h=setup(),parent=new AbortController(),signals=[],retries=[];
 const result=h.api.retryOwnerPreviewVerification(()=>h.api.ownerPreviewVerificationAttempt(async signal=>{assert(signals.every(s=>s.aborted));signals.push(signal);return new Promise(()=>{})},parent.signal),parent.signal,n=>retries.push(n));
 const rejected=assert.rejects(result,e=>e.code==='owner_preview_timeout');
 for(let i=0;i<3;i++){await flush();assert.equal(signals.length,i+1);h.fire(15000);await flush();if(i<2)h.fire(i===0?500:1500)}await rejected;
 assert.deepEqual(retries,[2,3]);assert(signals.every(s=>s.aborted));assert.equal(h.timers.size,0);
});
test('parent cancellation settles even a non-abortable read and removes its deadline',async()=>{
 const h=setup(),parent=new AbortController();let signal;
 const result=h.api.ownerPreviewVerificationAttempt(async child=>{signal=child;return new Promise(()=>{})},parent.signal);
 const rejected=assert.rejects(result,e=>e.name==='AbortError'&&!h.api.ownerPreviewRetryable(e));await flush();parent.abort();await rejected;assert(signal.aborted);assert.equal(h.timers.size,0);
 let read=false;await assert.rejects(h.api.ownerPreviewVerificationAttempt(async()=>{read=true},parent.signal),e=>e.name==='AbortError');assert.equal(read,false);assert.equal(h.timers.size,0);
});
test('successful and terminal responses release timers without changing validation failures into timeouts',async()=>{
 const h=setup(),parent=new AbortController();let signal;
 assert.equal(await h.api.ownerPreviewVerificationAttempt(async child=>{signal=child;return 'ok'},parent.signal),'ok');assert(signal.aborted);assert.equal(h.timers.size,0);
 const denied=Object.assign(Error('synthetic denied'),{status:403,code:'preview_denied'});
 await assert.rejects(h.api.ownerPreviewVerificationAttempt(async()=>{throw denied},parent.signal),e=>e===denied&&!h.api.ownerPreviewRetryable(e));assert.equal(h.timers.size,0);
});
test('a previously joined refresh flight can expire before the verification deadline and recover through a new locked attempt',async()=>{
 const fixturePath=path.join(__dirname,'dashboard-session-lock-timeout.test.cjs');
 const fixture=fs.readFileSync(fixturePath,'utf8').split(/\ntest\(/)[0];
 const {runtime,heldHarness}=new Function('require','__dirname',fixture+';return {runtime,heldHarness};')(require,__dirname);
 const r=runtime(),{h:auth,locks}=heldHarness(r),old=r.session('shared-before-preview',5),next=r.session('shared-recovered');
 auth.api.saveDashboardSession(old);auth.setFetch(()=>r.json(next));
 const first=auth.api.ensureDashboardSession(old).catch(error=>error);await r.tick();await r.advance(auth,10000);
 const h=setup(),parent=new AbortController(),retries=[],signals=[];let granted=false;
 const verified=h.api.retryOwnerPreviewVerification(()=>h.api.ownerPreviewVerificationAttempt(async signal=>{
  signals.push(signal);await auth.api.ensureDashboardSession(old);return 'verified';
 },parent.signal),parent.signal,n=>retries.push(n)).then(value=>{granted=true;return value});
 await r.tick();assert.equal(locks.requests.length,1,'preview joins the already waiting refresh');assert.equal(auth.calls.length,0);
 await r.advance(auth,5000);assert.equal((await first).code,'refresh_coordination_timeout');await flush();
 assert.equal(granted,false);assert.equal(signals[0].aborted,true);assert.deepEqual(retries,[2]);assert.equal(h.timers.size,1);assert.equal(auth.saved().refresh_token,old.refresh_token);
 h.fire(500);await r.tick();assert.equal(locks.requests.length,2);assert.equal(locks.requests[1].options.mode,'exclusive');assert.equal(auth.calls.length,0);
 locks.requests[1].grant();assert.equal(await verified,'verified');assert.equal(auth.refreshCalls().length,1);assert.equal(auth.saved().access_token,next.access_token);assert(signals.every(signal=>signal.aborted));assert.equal(h.timers.size,0);assert.equal(r.timers.size,0);
});
test('coordination errors have bounded recovery while authorization and cancellation still take precedence',async()=>{
 for(const code of ['refresh_coordination_timeout','refresh_coordination_failed']){
  const h=setup(),parent=new AbortController();let attempts=0;
  const pending=h.api.retryOwnerPreviewVerification(async()=>{attempts++;throw Object.assign(Error('synthetic coordinator unavailable'),{status:0,code});},parent.signal,()=>{});
  const rejected=assert.rejects(pending,error=>error.code===code&&h.api.ownerPreviewRetryable(error));
  await flush();h.fire(500);await flush();h.fire(1500);await rejected;assert.equal(attempts,3);assert.equal(h.timers.size,0);
  for(const status of [401,403])assert.equal(h.api.ownerPreviewRetryable({status,code}),false);
  assert.equal(h.api.ownerPreviewRetryable({status:0,code,name:'AbortError'}),false);
 }
 const h=setup();assert.equal(h.api.ownerPreviewRetryable({status:0,code:'session_changed'}),false);assert.equal(h.api.ownerPreviewRetryable({status:0,code:'session_logged_out'}),false);
});
