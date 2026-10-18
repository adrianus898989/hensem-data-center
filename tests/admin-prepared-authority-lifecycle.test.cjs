// Actual manager and virtual timers; verify ownership, never simulated speed.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const setup=fs.readFileSync(path.join(__dirname,'admin-prepared-derived-poll.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,q,envelope,building,deferred,flush,check}=new Function('require','__dirname',setup+';return {harness,q,envelope,building,deferred,flush,check};')(require,__dirname);

for(const change of ['cancel','actor','native'])test('an obsolete '+change+' batch denial cannot revoke the current request or its completion',async()=>{
 const late=deferred(),fresh=deferred(),h=harness({handler:()=>late.promise});
 const old=h.manager.read(q()),oldCancelled=assert.rejects(old,check('cancelled'));await flush();
 if(change==='cancel')h.manager.cancel();
 if(change==='actor')h.setContext('synthetic-actor-b|role2|providers|queryA');
 if(change==='native')h.setNative({capabilities:{syntheticChanged:true}});
 h.setHandler(()=>fresh.promise);let settled=false;
 const current=h.manager.read(q()).then(result=>{settled=true;return result;},error=>{settled=true;throw error;});
 // Observe every rejection immediately, including the old implementation's bug.
 const currentOutcome=current.then(result=>({result}),error=>({error}));await flush();
 late.reject(Object.assign(Error('Synthetic old authority denial'),{code:'ADMIN_LIVE_PERMISSION_DENIED'}));await flush();await oldCancelled;
 assert.equal(settled,false,'only a current batch may revoke the current authority');
 fresh.resolve(envelope(h.calls[1].payload.requests));const outcome=await currentOutcome;assert.equal(outcome.error,undefined);assert(outcome.result);
 assert.equal((await h.manager.read(q()))._preparedPublication.id,outcome.result._preparedPublication.id);assert.equal(h.calls.length,2);
});

test('an aborted batch late denial cannot evict a subsequently completed snapshot',async()=>{
 const late=deferred(),h=harness({handler:()=>late.promise});
 const old=h.manager.read(q()),oldCancelled=assert.rejects(old,check('cancelled'));await flush();h.manager.cancel();await oldCancelled;
 h.setHandler(p=>envelope(p.requests));await h.manager.read(q());
 late.reject(Object.assign(Error('Synthetic obsolete session denial'),{code:'ADMIN_LIVE_SESSION_DENIED'}));await flush();
 await h.manager.read(q());assert.equal(h.calls.length,2,'the current completed receipt remains reusable');assert.equal(h.time.timers.size,0);
});

test('a current batch denial still clears completed peers and cancels every active polling family',async()=>{
 const h=harness(),deny=Object.assign(Error('Synthetic current denial'),{code:'42501'});await h.manager.read(q());
 h.setHandler(p=>envelope(p.requests,building));const waiting=h.manager.read(q({platformId:'native-2'})),denied=assert.rejects(waiting,e=>e===deny);await flush();
 h.setHandler(()=>{throw deny;});await assert.rejects(h.manager.read(q({platformId:'native-3'})),e=>e===deny);await denied;
 assert.equal(h.time.timers.size,0);h.setHandler(p=>envelope(p.requests));await h.manager.read(q());assert.equal(h.calls.length,4);
});
