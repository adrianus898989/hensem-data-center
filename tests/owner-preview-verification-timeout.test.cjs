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
