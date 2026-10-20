/* Virtual time validates bounded waiting, identity and cache lifecycle only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-prepared-derived-poll.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,q,ready,envelope,building,flush,deferred,check}=new Function('require','__dirname',prefix+';return {harness,q,ready,envelope,building,flush,deferred,check};')(require,__dirname);
const admitted=(request,status='missing',state='queued')=>({request,status,result:null,publication:null,preparation:{state,retryable:state==='queued'||state==='running'}});
test('full and provider queries wait only after the server admits their exact request',async()=>{
 for(const view of ['full','providers',undefined])for(const status of ['missing','stale','building']){
  const h=harness({handler:(p,c,n)=>envelope(p.requests,r=>n===1?admitted(r,status):ready(r))}),request=q(view?{view}:{});if(view===undefined)delete request.view;
  let done=false;const read=h.manager.read(request).then(result=>{done=true;return result;});await flush();assert.equal(done,false);
  await h.time.advance(1500);const result=await read;assert.equal(result.summary[0].success_amount,null);assert.equal(h.calls.length,2);
  assert.deepEqual(h.calls[1].payload.requests,h.calls[0].payload.requests);await h.manager.read(request);assert.equal(h.calls.length,2);
 }
});
test('missing without valid job evidence, failed jobs, unsupported and malformed evidence never retry',async()=>{
 for(const patch of [
  {preparation:undefined},{preparation:null},{preparation:{state:'failed',retryable:false}},
  {preparation:{state:'unavailable',retryable:false}},{preparation:{state:'queued',retryable:false}},
  {preparation:{state:'running',retryable:'true'}},{preparation:{state:'queued',retryable:true,id:'extra'}},
  {status:'unsupported',preparation:{state:'queued',retryable:true}},
 ]){
  const h=harness({handler:p=>envelope(p.requests,r=>({...admitted(r),...patch}))});
  await assert.rejects(h.manager.read(q({view:'full'})));await h.time.advance(120000);assert.equal(h.calls.length,1);assert.equal(h.time.timers.size,0);
 }
 const h=harness({handler:p=>envelope(p.requests,r=>admitted(r))});await assert.rejects(h.manager.read(q({view:'drilldown'})),check('missing'));assert.equal(h.calls.length,1);
});
test('explicit nonretryable evidence overrides the legacy provider-base retry hint',async()=>{
 const h=harness({handler:p=>envelope(p.requests,r=>({...building(r),preparation:{state:'failed',retryable:false}}))});
 await assert.rejects(h.manager.read(q()),check('building'));await h.time.advance(120000);assert.equal(h.calls.length,1);
});
test('admitted full wait retains the same bounded attempts and sends force only initially',async()=>{
 const h=harness({derivedPollMaxAttempts:3,handler:p=>envelope(p.requests,r=>admitted(r,'stale','running'))});
 const read=h.manager.read(q({view:'full'}),{forceRefresh:true}),done=assert.rejects(read,check('building'));await flush();await h.time.advance(3000);await done;
 assert.equal(h.calls.length,3);assert.equal(h.calls[0].payload.forceRefresh,true);assert(h.calls.slice(1).every(c=>!c.payload.forceRefresh));assert.equal(h.time.timers.size,0);
 h.setHandler(p=>envelope(p.requests));await h.manager.read(q({view:'full'}));assert.equal(h.calls.length,4,'pending never enters completed cache');
});
test('navigation cancellation aborts admitted full polling and a late response cannot refill cache',async()=>{
 const late=deferred(),h=harness({handler:(p,c,n)=>n===1?envelope(p.requests,r=>admitted(r)):n===2?late.promise:envelope(p.requests)});
 const read=h.manager.read(q({view:'full'})),done=assert.rejects(read,check('cancelled'));await flush();await h.time.advance(1500);
 h.manager.cancel();await done;assert.equal(h.calls[1].control.signal.aborted,true);late.resolve(envelope(h.calls[1].payload.requests,r=>ready(r,'late-old')));await flush();
 const result=await h.manager.read(q({view:'full'}));assert.notEqual(result.summary[0].all_amount,'late-old');assert.equal(h.calls.length,3);assert.equal(h.time.timers.size,0);
});
test('permission denial cancels admitted waits and clears completed full results',async()=>{
 const deny=Object.assign(Error('denied'),{code:'42501'}),h=harness();await h.manager.read(q({view:'full'}));
 h.setHandler(p=>envelope(p.requests,r=>admitted(r)));const waiting=h.manager.read(q({platformId:'native-2',view:'full'})),rejected=assert.rejects(waiting,e=>e===deny);await flush();
 h.setHandler(()=>{throw deny;});await assert.rejects(h.manager.read(q({platformId:'native-3',view:'full'})),e=>e===deny);await rejected;
 assert.equal(h.time.timers.size,0);h.setHandler(p=>envelope(p.requests));await h.manager.read(q({view:'full'}));assert.equal(h.calls.length,4);
});
