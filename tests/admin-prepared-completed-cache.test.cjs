/* Actual prepared manager, synthetic envelopes only; no orders, credentials or network. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-prepared-aggregates.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,q,item,envelope,P,NOW,deferred,tick,clone,code}=new Function('require',prefix+';return {harness,q,item,envelope,P,NOW,deferred,tick,clone,code};')(require);
function response(payload){const r=envelope(payload.requests);if(payload.publicationVersion===2){r.version=2;for(const i of r.items)Object.assign(i.publication,{freshness:'fresh',refreshState:'idle'});}return r;}
const cached=(options={})=>harness({completedCacheTtlMs:30000,...options,handler:options.handler||response});

test('explicit completion reuse preserves exact DTOs, uncertainty and independent clones',async()=>{
 const h=cached(),request=q(),a=await h.adapter.read(request),before=clone(a);
 a.summary[0].all_amount='changed';a.groups.provider[0].all_count=999;
 const reordered=Object.fromEntries(Object.entries(request).reverse()),b=await h.adapter.read(reordered);
 assert.equal(h.calls.length,1);assert.deepEqual(b,before);assert.equal(b.summary[0].all_amount,'9007199254740993.01');assert.equal(b.summary[0].success_amount,null);assert.equal(b._preparedPublication.sourceComplete,false);assert.equal(b.coverage.complete,false);
});
test('TTL is capped at thirty seconds and hits do not extend the original receipt time',async()=>{
 let time=NOW;const h=cached({completedCacheTtlMs:999999,now:()=>time});await h.adapter.read(q());
 time+=29999;await h.adapter.read(q());assert.equal(h.calls.length,1);
 time++;await h.adapter.read(q());assert.equal(h.calls.length,2);
 time-=1;await h.adapter.read(q());assert.equal(h.calls.length,3,'clock rollback cannot reuse a future receipt');
});
test('v1 server expiry remains a hard limit even within the local TTL',async()=>{
 let time=NOW;const h=cached({now:()=>time,handler:payload=>{const r=response(payload);for(const i of r.items)i.publication.expiresAt=new Date(time+500).toISOString();return r;}});
 await h.adapter.read(q());time+=499;await h.adapter.read(q());assert.equal(h.calls.length,1);
 time++;await h.adapter.read(q());assert.equal(h.calls.length,2);
});
test('expiry crossing before cached microtask delivery falls back to one authorized read',async()=>{
 let time=NOW;const h=cached({now:()=>time});await h.adapter.read(q());time+=29999;const pending=h.adapter.read(q());time++;await pending;assert.equal(h.calls.length,2);
});
test('v2 last-complete refresh-due heads keep their real generation, clocks and refresh state',async()=>{
 for(const refreshState of ['idle','queued','running','failed']){
  let time=NOW;const h=cached({publicationVersion:2,now:()=>time,handler:payload=>{const r=response(payload);for(const i of r.items)Object.assign(i.publication,{expiresAt:'2026-10-15T11:59:59Z',freshness:'refresh_due',refreshState});return r;}});
  const a=await h.adapter.read(q());time+=1000;const b=await h.adapter.read(q());assert.equal(h.calls.length,1);assert.deepEqual(b,a);assert.equal(b._preparedPublication.freshness,'refresh_due');assert.equal(b._preparedPublication.refreshState,refreshState);assert.equal(b._preparedPublication.computedAt,'2026-10-15T11:59:00Z');
 }
});
test('a cached v2 fresh head is revalidated as refresh-due when its soft expiry passes',async()=>{
 let time=NOW;const h=cached({publicationVersion:2,now:()=>time,handler:payload=>{const r=response(payload);for(const i of r.items)i.publication.expiresAt=new Date(NOW+500).toISOString();return r;}});
 const a=await h.adapter.read(q());assert.equal(a._preparedPublication.freshness,'fresh');time+=1000;const b=await h.adapter.read(q());assert.equal(h.calls.length,1);assert.equal(b._preparedPublication.freshness,'refresh_due');assert.equal(b._preparedPublication.id,a._preparedPublication.id);assert.equal(b._preparedPublication.cutoff,a._preparedPublication.cutoff);assert.equal(b._preparedPublication.expiresAt,a._preparedPublication.expiresAt);
});
test('providers, views, directions and both exact time windows remain separate cache requests',async()=>{
 const h=cached(),requests=[q(),q({providers:[]}),q({providers:['T3Pay','3TPay']}),q({direction:'charge'}),q({view:'full'}),q({endAt:'2026-10-14T18:30:00.000002Z'}),q({successStartAt:'2026-10-01T00:00:00Z',successEndAt:'2026-10-02T00:00:00Z',successBasis:'success'}),q({successStartAt:'2026-10-01T00:00:00Z',successEndAt:'2026-10-02T00:00:00Z',successBasis:'source_updated'})];
 for(const request of requests)await h.adapter.read(request);assert.equal(h.calls.length,requests.length);
 for(const request of requests)await h.adapter.read(request);assert.equal(h.calls.length,requests.length);
 assert.equal(h.calls[1].payload.requests[0].providers.length,0,'an unfiltered base never projects a different provider request');
});
test('account, permissions, page and native capability changes cannot reuse another identity',async()=>{
 const h=cached();await h.adapter.read(q());for(const scope of ['account-b|role-v1|overview','account-b|role-v2|overview','account-b|role-v2|providers']){h.setScope(scope);await h.adapter.read(q());}assert.equal(h.calls.length,4);
 h.setScope('');await assert.rejects(h.adapter.read(q()),code('cancelled'));h.setScope('account-b|role-v2|providers');await h.adapter.read(q());assert.equal(h.calls.length,5,'unconfirmed authority clears completed values');
 let p={...P,capabilities:{success:true}};const native=cached({platform:()=>p,handler:payload=>{const r=response(payload);for(const i of r.items)i.result.platform=clone(p);return r;}});await native.adapter.read(q());p={...p,capabilities:{success:false}};await native.adapter.read(q());assert.equal(native.calls.length,2);
 p={...p,sourceName:'OTHER_NATIVE'};await native.adapter.read(q());assert.equal(native.calls.length,3);
});
test('cancel retains completed peers but rejects ignored-abort late work without caching it',async()=>{
 const flight=deferred();const h=cached({handler:(payload,control,n)=>n===2?flight.promise:response(payload)}),a=q(),b=q({providers:['IndependentPay']});await h.adapter.read(a);
 const pending=h.adapter.read(b),rejected=assert.rejects(pending,code('cancelled'));await tick();h.adapter.cancel();await rejected;assert.equal(h.calls[1].control.signal.aborted,true);
 flight.resolve(response(h.calls[1].payload));await tick();await h.adapter.read(a);assert.equal(h.calls.length,2,'a completed peer survives ordinary cancellation');await h.adapter.read(b);assert.equal(h.calls.length,3,'the late response was not stored');
 h.adapter.clear();await h.adapter.read(a);assert.equal(h.calls.length,4,'clear discards completed results too');
});
test('cached delivery rechecks current scope, signal, generation and native identity in its microtask',async()=>{
 for(const change of ['cancel','context','signal','current','native']){
  let current=true;const controller=new AbortController(),h=cached();await h.adapter.read(q());const pending=h.adapter.read(q(),{signal:controller.signal,isCurrent:()=>current});
  if(change==='cancel')h.adapter.cancel();if(change==='context')h.setScope('different-account');if(change==='signal')controller.abort();if(change==='current')current=false;if(change==='native')h.setPlatform({...P,capabilities:{revoked:true}});
  await assert.rejects(pending,code('cancelled'));
 }
});
test('transport authority denial clears every completed result without replacing the denial code',async()=>{
 for(const denied of ['42501','ADMIN_LIVE_SESSION_DENIED','ADMIN_LIVE_PERMISSION_DENIED','ROLE_DENIED']){
  const h=cached({handler:(payload,control,n)=>{if(n===2)throw Object.assign(Error('denied'),{code:denied});return response(payload);}});await h.adapter.read(q());await assert.rejects(h.adapter.read(q({providers:['Other']})),e=>e.code===denied);await h.adapter.read(q());assert.equal(h.calls.length,3);
 }
});
test('force bypasses and invalidates matching base/provider/view entries while other dates remain cached',async()=>{
 const h=cached({publicationVersion:2}),base=q({providers:[]}),filtered=q({providers:['3TPay']}),full=q({view:'full',providers:[]}),other=q({startAt:'2026-10-12T18:30:00Z',endAt:'2026-10-13T18:30:00Z'});
 for(const request of [base,filtered,full,other])await h.adapter.read(request);assert.equal(h.calls.length,4);
 await h.adapter.read(filtered,{forceRefresh:true});assert.equal(h.calls.length,5);assert.equal(h.calls.at(-1).payload.forceRefresh,true);
 await h.adapter.read(base);await h.adapter.read(full);assert.equal(h.calls.length,7);await h.adapter.read(filtered);await h.adapter.read(other);assert.equal(h.calls.length,7);
 const beforeForce=h.adapter.read(base),rejected=assert.rejects(beforeForce,code('cancelled'));const forced=h.adapter.read(base,{forceRefresh:true});await rejected;await forced;
});
test('force prevents an older in-flight family from repopulating its cleared cache',async()=>{
 const flight=deferred(),h=cached({publicationVersion:2,handler:(payload,control,n)=>n===1?flight.promise:response(payload)}),old=q({providers:['Earlier']}),next=q({providers:['Later']});
 const pending=h.adapter.read(old);await tick();await h.adapter.read(next,{forceRefresh:true});flight.resolve(response(h.calls[0].payload));await pending;await h.adapter.read(old);assert.equal(h.calls.length,3);
});
test('a force fanout retains every independent native platform completion and duplicate force joins',async()=>{
 const a={...P,id:'platform-a'},b={...P,id:'platform-b'},platform=id=>id===a.id?a:b;
 const h=cached({publicationVersion:2,platform,handler:payload=>{const r=response(payload);for(const i of r.items)i.result.platform=clone(platform(i.request.platformId));return r;}}),qa=q({platformId:a.id}),qb=q({platformId:b.id});
 await Promise.all([h.adapter.read(qa,{forceRefresh:true}),h.adapter.read(qb,{forceRefresh:true})]);assert.equal(h.calls.length,1);assert.equal(h.calls[0].payload.requests.length,2);
 await Promise.all([h.adapter.read(qa),h.adapter.read(qb)]);assert.equal(h.calls.length,1,'one native refresh cannot invalidate another platform completion');
 await Promise.all([h.adapter.read(qa,{forceRefresh:true}),h.adapter.read(qa,{forceRefresh:true})]);assert.equal(h.calls.length,2);assert.equal(h.calls[1].payload.requests.length,1);await h.adapter.read(qa);assert.equal(h.calls.length,2,'joining the same force does not discard its completion');
});
test('replacing a force-invalidated exact job settles both queued and abort-ignoring active waiters',async()=>{
 for(const active of [false,true]){
  const oldTransport=deferred(),newTransport=deferred(),request=q({providers:['Earlier']}),h=cached({publicationVersion:2,handler:(payload,control,n)=>active&&n===1?oldTransport.promise:payload.forceRefresh?response(payload):newTransport.promise});
  const old=h.adapter.read(request),oldRejected=assert.rejects(old,code('cancelled'));if(active)await tick();
  const forced=h.adapter.read(q({providers:['Later']}),{forceRefresh:true}),next=h.adapter.read(request),nextRejected=assert.rejects(next,code('cancelled'));await forced;await tick();h.adapter.cancel();
  let timer;try{await Promise.race([Promise.all([oldRejected,nextRejected]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('a replaced waiter remained pending')),1000);})]);}finally{clearTimeout(timer);}
  assert(h.calls.filter(call=>!call.payload.forceRefresh).every(call=>call.control.signal.aborted),'both active and replacement transports are aborted; unresolved transports cannot hold their callers');
 }
});
test('missing/building/invalid/partial and transport failures are never completed cache entries',async()=>{
 const cases=[r=>Object.assign(r.items[0],{status:'missing',publication:null,result:null}),r=>Object.assign(r.items[0],{status:'building',publication:null,result:null}),r=>{r.items[0].publication.calculationComplete=false;},r=>{r.items[0].result.partial=true;},r=>{r.items[0].result.coverage.calculationComplete=false;},()=>{throw Object.assign(Error('timeout'),{code:'57014'});}];
 for(const change of cases){const h=cached({handler:(payload,control,n)=>{const r=response(payload);if(n===1)change(r);return r;}});await assert.rejects(h.adapter.read(q()));await h.adapter.read(q());await h.adapter.read(q());assert.equal(h.calls.length,2);}
});
test('an LRU bound evicts completed entries and oversized envelopes are not retained',async()=>{
 const h=cached();for(let n=0;n<129;n++)await h.adapter.read(q({providers:['Synthetic-'+n]}));await h.adapter.read(q({providers:['Synthetic-128']}));assert.equal(h.calls.length,129);await h.adapter.read(q({providers:['Synthetic-0']}));assert.equal(h.calls.length,130);
 const big=cached({handler:payload=>{const r=response(payload);r.items[0].result.sourceEvidence='x'.repeat(1100000);return r;}});await big.adapter.read(q());await big.adapter.read(q());assert.equal(big.calls.length,2);
});
test('the total byte bound evicts old envelopes before the entry-count bound is reached',async()=>{
 const h=cached({handler:payload=>{const r=response(payload);r.items[0].result.sourceEvidence='x'.repeat(500000);return r;}});
 for(let n=0;n<18;n++)await h.adapter.read(q({providers:['Large-'+n]}));await h.adapter.read(q({providers:['Large-17']}));assert.equal(h.calls.length,18);await h.adapter.read(q({providers:['Large-0']}));assert.equal(h.calls.length,19);
});
