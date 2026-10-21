/* Completed DTO reuse may cross authorized pages; live work never does.
 * Synthetic receipts and virtual clocks test lifecycle, not production speed. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-prepared-derived-poll.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,q,envelope,ready,building,deferred,flush,check}=new Function('require','__dirname',prefix+';return {harness,q,envelope,ready,building,deferred,flush,check};')(require,__dirname);
function setup(options={}){let authority='actor-a|role-v1|assignment-v1|scope-a';const h=harness({...options,completedReuseContext:()=>authority});return {...h,setAuthority:value=>authority=value};}
test('opt-in page reuse returns the same exact complete DTO without another request and keeps original receipt clocks',async()=>{
 const h=setup(),first=await h.manager.read(q());h.setContext('actor-a|role1|overview|queryA');
 const second=await h.manager.read(q());assert.equal(h.calls.length,1);assert.deepEqual(second,first);
 second.summary[0].all_amount='mutated';h.setContext('actor-a|role1|time|queryA');assert.equal((await h.manager.read(q())).summary[0].all_amount,first.summary[0].all_amount);
 assert.equal(h.calls.length,1);assert.equal(second._preparedPublication.sourceComplete,false);
});
test('cross-page hits do not extend TTL and an explicit refresh invalidates the same exact family',async()=>{
 const h=setup();await h.manager.read(q());await h.time.advance(29999);h.setContext('page-2');await h.manager.read(q());assert.equal(h.calls.length,1);
 await h.time.advance(1);h.setContext('page-3');await h.manager.read(q());assert.equal(h.calls.length,2);
 h.setContext('page-4');await h.manager.read(q(),{forceRefresh:true});assert.equal(h.calls.length,3);assert.equal(h.calls.at(-1).payload.forceRefresh,true);
 h.setContext('page-5');await h.manager.read(q());assert.equal(h.calls.length,3);h.manager.clear();await h.manager.read(q());assert.equal(h.calls.length,4);
});
test('account role assignment and data grants invalidate completed entries across all pages',async()=>{
 const h=setup();await h.manager.read(q());
 for(const authority of ['actor-b|role1|assignment1|scope-a','actor-b|role2|assignment1|scope-a','actor-b|role2|assignment2|scope-a','actor-b|role2|assignment2|scope-b']){h.setAuthority(authority);h.setContext('page-'+authority);await h.manager.read(q());}
 assert.equal(h.calls.length,5);h.setAuthority('');await assert.rejects(h.manager.read(q()),check('cancelled'));h.setAuthority('actor-b|role2|assignment2|scope-b');await h.manager.read(q());assert.equal(h.calls.length,6);
});
test('no permission for a destination page clears shared completions even when actor identity is unchanged',async()=>{
 const h=setup();await h.manager.read(q());h.setContext('');await assert.rejects(h.manager.read(q()),check('cancelled'));
 h.setContext('authorized-page');await h.manager.read(q());assert.equal(h.calls.length,2);
});
test('native identity exact filters and independent time windows remain isolated on another page',async()=>{
 const h=setup();await h.manager.read(q());h.setContext('next-page');
 for(const request of [q({direction:'withdraw'}),q({providers:['Another']}),q({view:'full'}),q({startAt:'2026-10-09T18:30:00.000001Z'}),q({successStartAt:'2026-10-09T18:30:00.000001Z'}),q({successBasis:'source_updated'})])await h.manager.read(request);
 assert.equal(h.calls.length,7);h.setNative({capabilities:{revision:2}});await h.manager.read(q());assert.equal(h.calls.length,8);
 h.setNative({sourceName:'Changed native'});h.setHandler(payload=>envelope(payload.requests,r=>{const item=ready(r);item.result.platform.sourceName='Changed native';return item;}));await h.manager.read(q());assert.equal(h.calls.length,9);
});
test('switching pages cancels pending work and late old data cannot replace shared completed entries',async()=>{
 const late=deferred(),h=setup();await h.manager.read(q());h.setHandler(()=>late.promise);
 const pending=h.manager.read(q({providers:['Not complete']})),cancelled=assert.rejects(pending,check('cancelled'));await flush();
 h.setContext('next-page');await h.manager.read(q());await cancelled;assert.equal(h.calls.length,2);assert.equal(h.calls[1].control.signal.aborted,true);
 late.resolve(envelope(h.calls[1].payload.requests,r=>ready(r,'late-old')));await flush();h.setHandler(p=>envelope(p.requests));
 const result=await h.manager.read(q({providers:['Not complete']}));assert.notEqual(result.summary[0].all_amount,'late-old');assert.equal(h.calls.length,3);
});
test('cross-page denial clears every completed page entry while obsolete aborted denial cannot clear new completions',async()=>{
 const h=setup();await h.manager.read(q());h.setContext('next-page');h.setHandler(()=>{throw Object.assign(Error('denied'),{code:'42501'});});await assert.rejects(h.manager.read(q({providers:['Another']})),e=>e.code==='42501');h.setHandler(p=>envelope(p.requests));h.setContext('original-page');await h.manager.read(q());assert.equal(h.calls.length,3);
 const late=deferred();h.setHandler(()=>late.promise);const old=h.manager.read(q({providers:['Old']})),cancelled=assert.rejects(old,check('cancelled'));await flush();h.setContext('new-page');await h.manager.read(q());await cancelled;
 late.reject(Object.assign(Error('obsolete denied'),{code:'ADMIN_LIVE_SESSION_DENIED'}));await flush();await h.manager.read(q());assert.equal(h.calls.length,4);
});
test('a page change before cached microtask delivery still rejects the old page waiter',async()=>{
 const h=setup();await h.manager.read(q());const old=h.manager.read(q()),cancelled=assert.rejects(old,check('cancelled'));h.setContext('next-page');const current=h.manager.read(q());await cancelled;await current;assert.equal(h.calls.length,1);
});
