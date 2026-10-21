/* Exact ready-only probe + existing bounded queue. Synthetic data, no live timing claim. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-prepared-aggregates.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {create,q,item,clone,P,NOW,deferred,tick}=new Function('require','__dirname',prefix+';return {create,q,item,clone,P,NOW,deferred,tick};')(require,__dirname);
const request=n=>q({providers:['Synthetic '+n],startAt:'2026-10-13T18:30:00.000Z',endAt:'2026-10-14T18:30:00.000Z',successStartAt:'2026-10-13T18:30:00.000Z',successEndAt:'2026-10-14T18:30:00.000Z',successBasis:'success'});
function ready(r,expired=false){const v=item(r);Object.assign(v.publication,{freshness:expired?'refresh_due':'fresh',refreshState:expired?'failed':'idle',computedAt:new Date(NOW-(expired?900000:60000)).toISOString(),expiresAt:new Date(NOW+(expired?-300000:300000)).toISOString(),cutoff:new Date(NOW-(expired?900000:60000)).toISOString()});return v;}
function envelope(p,make=r=>ready(r)){return {version:2,...(p.readMode?{readMode:p.readMode}:{}),items:p.requests.map(make)};}
const miss=(r,reason='ready_head_missing')=>({request:clone(r),status:'miss',reason,result:null,publication:null});
function setup(handler,extra={}){let scope='account-a|role-v1|providers',native=clone(P),stamp=NOW;const calls=[];const api=create({publicationVersion:2,maxBatchSize:3,maxConcurrent:2,completedCacheTtlMs:1000,derivedPollMaxMs:60000,context:()=>scope,platform:()=>native,now:()=>stamp,request:async(p,c)=>{calls.push({p,c});return handler?handler(p,c,calls.length):envelope(p);},...extra});return {api,calls,setScope:v=>scope=v,setNative:v=>native=v,setNow:v=>stamp=v};}
const opts={readyOnlyProbe:true};

test('19 fresh exact heads use one opt-in probe and existing completed cache; never invoke ordinary compute-capable reads',async()=>{
 const h=setup(),rs=Array.from({length:19},(_,i)=>request(i));const out=await Promise.all(rs.map(r=>h.api.read(r,opts)));assert.equal(h.calls.length,1);assert.equal(h.calls[0].p.readMode,'ready-only-v1');assert.equal(h.calls[0].p.requests.length,19);assert.equal(h.calls[0].p.providerLeafAliases,undefined);assert.equal(out[0].summary[0].all_amount,'9007199254740993.01');assert.equal(out[0].summary[0].success_amount,null);assert.equal(out[0]._preparedPublication.sourceComplete,false);
 await Promise.all(rs.map(r=>h.api.read(r,opts)));h.api.releaseRefresh();await tick();assert.equal(h.calls.length,1);
});
test('expired ready heads settle primary first, preserve clocks, and refresh once through the same 2 by 3 queue',async()=>{
 const flights=[];let active=0,peak=0;const h=setup((p,c)=>{if(p.readMode)return envelope(p,r=>ready(r,true));const d=deferred();active++;peak=Math.max(peak,active);flights.push({p,c,d});return d.promise.finally(()=>active--);});
 const rs=Array.from({length:19},(_,i)=>request(i)),out=await Promise.all(rs.map(r=>h.api.read(r,opts)));assert.equal(out.length,19);assert.equal(h.calls.length,1);assert.equal(out[0]._preparedPublication.expiresAt,'2026-10-15T11:55:00.000Z');assert.equal(out[0]._preparedPublication.freshness,'refresh_due');assert.equal(out[0]._preparedPublication.refreshState,'failed');assert.equal(out[0]._preparedPublication.sourceComplete,false);
 h.api.releaseRefresh();await tick();assert.equal(flights.length,2);let resolved=0;while(resolved<flights.length){const flight=flights[resolved++];assert(flight.p.requests.length<=3);assert.equal(flight.p.forceRefresh,undefined);assert.equal(flight.p.readMode,undefined);flight.d.resolve(envelope(flight.p,r=>ready(r,true)));await tick();}assert.equal(resolved,7);assert.equal(peak,2);h.api.releaseRefresh();await tick();assert.equal(h.calls.length,8);assert.equal(out[0]._preparedPublication.expiresAt,'2026-10-15T11:55:00.000Z');
});
test('all misses fall back once to original bounded reads, without another probe or synthesized failure',async()=>{
 const h=setup(p=>p.readMode?envelope(p,r=>miss(r)):envelope(p)),rs=Array.from({length:19},(_,i)=>request(i));const out=await Promise.all(rs.map(r=>h.api.read(r,opts)));assert.equal(out.length,19);assert.equal(h.calls.filter(x=>x.p.readMode).length,1);assert.equal(h.calls.filter(x=>!x.p.readMode).length,7);assert(h.calls.filter(x=>!x.p.readMode).every(x=>x.p.requests.length<=3));
});
test('a mixed probe delivers ready peers while misses use foreground slots; released refresh cannot overtake them',async()=>{
 const foreground=deferred(),h=setup(p=>p.readMode?envelope(p,r=>r.providers[0]==='Synthetic 0'?ready(r,true):miss(r)):p.requests.some(r=>r.providers[0]!=='Synthetic 0')?foreground.promise:envelope(p));
 let early;const a=h.api.read(request(0),opts).then(v=>early=v),b=h.api.read(request(1),opts);await a;await tick();assert(early);assert.equal(h.calls.length,2);h.api.releaseRefresh();await tick();assert.equal(h.calls.length,2,'background does not occupy the second slot while foreground remains');foreground.resolve(envelope(h.calls[1].p));await b;await tick();assert.equal(h.calls.length,3);assert.equal(h.calls[2].p.requests[0].providers[0],'Synthetic 0');
});
for(const change of [e=>delete e.readMode,e=>e.readMode='unknown',e=>e.items.push(e.items[0]),e=>e.items[0].request.providers=['wrong'],e=>e.items[0].status='failed',e=>{e.items[0]=miss(e.items[0].request,'unknown');},e=>{e.items[0]=miss(e.items[0].request);e.items[0].preparation={state:'failed'};},e=>{e.items[0]=miss(e.items[0].request);e.items[0].result={};},e=>{e.items[0].result.platform.source='other';},e=>{e.items[0].publication.calculationComplete=false;}])test('malformed probe is an error, not a cache miss '+change.toString(),async()=>{
 const h=setup(p=>{const v=envelope(p);change(v);return v;});await assert.rejects(h.api.read(request(1),opts),e=>e.code==='PREPARED_AGGREGATE_INVALID');h.api.releaseRefresh();await tick();assert.equal(h.calls.length,1);
});
for(const code of ['ADMIN_LIVE_PERMISSION_DENIED','ADMIN_LIVE_SESSION_DENIED','42501','ADMIN_LIVE_CANCELLED'])test('probe '+code+' does not retry as misses',async()=>{
 const h=setup(()=>{throw Object.assign(Error('Synthetic rejection'),{code});});await assert.rejects(h.api.read(request(1),opts),e=>e.code===code);await tick();assert.equal(h.calls.length,1);
});
test('one-shot refresh can populate newer exact cache without changing the already delivered object',async()=>{
 const h=setup(p=>{const e=envelope(p,r=>ready(r,!!p.readMode));if(!p.readMode)for(const v of e.items){v.publication.id='new';v.publication.generation=6;v.result.summary[0].all_count=99;}return e;});const first=await h.api.read(request(1),opts);h.api.releaseRefresh();await tick();assert.equal(first.summary[0].all_count,2);const next=await h.api.read(request(1),opts);assert.equal(next.summary[0].all_count,99);assert.equal(h.calls.length,2);
});
test('re-reading the same expired head does not extend its existing cache TTL or publication expiry',async()=>{
 const h=setup(p=>envelope(p,r=>ready(r,true)));const first=await h.api.read(request(1),opts);h.setNow(NOW+500);h.api.releaseRefresh();await tick();assert.equal(h.calls.length,2);h.setNow(NOW+1100);await h.api.read(request(1),opts);assert.equal(h.calls.length,3,'original completed retention deadline remains effective');assert.equal(first._preparedPublication.expiresAt,'2026-10-15T11:55:00.000Z');
});
for(const kind of ['network','building','invalid'])test('background '+kind+' is a one-shot outcome and cannot poll or retry',async()=>{
 const h=setup(p=>{if(p.readMode)return envelope(p,r=>ready(r,true));if(kind==='network')throw Error('Synthetic network error');if(kind==='invalid')return {version:2,items:[]};return envelope(p,r=>({request:r,status:'building',result:null,publication:null,preparation:{state:'queued',retryable:true}}));});await h.api.read(request(1),opts);h.api.releaseRefresh();await tick();h.api.releaseRefresh();await tick();assert.equal(h.calls.length,2);assert.equal((await h.api.read(request(1),opts)).summary[0].all_count,2);assert.equal(h.calls.length,2);
});
for(const code of ['ADMIN_LIVE_PERMISSION_DENIED','ADMIN_LIVE_CANCELLED'])test('current background '+code+' reaches owned cleanup after primary has settled',async()=>{
 const errors=[],h=setup(p=>{if(p.readMode)return envelope(p,r=>ready(r,true));throw Object.assign(Error('Synthetic refresh failure'),{code});});const first=await h.api.read(request(1),{...opts,isCurrent:()=>true,refreshIsCurrent:()=>true,onRefreshError:e=>errors.push(e.code)});assert.equal(first.summary[0].all_count,2);h.api.releaseRefresh();await tick();assert.deepEqual(errors,[code]);assert.equal(h.calls.length,2);
});
for(const transition of ['cancel','context','native','owner'])test('obsolete background '+transition+' cannot deliver or report late denial to a new owner',async()=>{
 let owned=true;const errors=[],late=deferred(),h=setup(p=>p.readMode?envelope(p,r=>ready(r,true)):late.promise);await h.api.read(request(1),{...opts,isCurrent:()=>owned,refreshIsCurrent:()=>owned,onRefreshError:e=>errors.push(e.code)});h.api.releaseRefresh();await tick();if(transition==='cancel')h.api.cancel();if(transition==='context')h.setScope('account-b|role-v2|providers');if(transition==='native')h.setNative({...P,sourceName:'Another native'});if(transition==='owner')owned=false;late.reject(Object.assign(Error('Late denial'),{code:'ADMIN_LIVE_PERMISSION_DENIED'}));await tick();assert.deepEqual(errors,[]);assert.equal(h.calls.length,2);
});
test('force invalidation aborts the older background family before late error can evict the new snapshot',async()=>{
 const late=deferred(),errors=[],h=setup((p,c,n)=>n===1?envelope(p,r=>ready(r,true)):n===2?late.promise:envelope(p));await h.api.read(request(1),{...opts,onRefreshError:e=>errors.push(e.code)});h.api.releaseRefresh();await tick();await h.api.read(request(1),{forceRefresh:true});assert.equal(h.calls[1].c.signal.aborted,true);late.reject(Object.assign(Error('Late forced predecessor'),{code:'ADMIN_LIVE_PERMISSION_DENIED'}));await tick();const before=h.calls.length;await h.api.read(request(1));assert.equal(h.calls.length,before);assert.deepEqual(errors,[]);
});
test('non-opt-in and force reads retain original limits, and forbidden opt-in combinations fail before dispatch',async()=>{
 const h=setup();await Promise.all(Array.from({length:8},(_,i)=>h.api.read(request(i))));assert(h.calls.every(x=>!x.p.readMode&&x.p.requests.length<=3));const f=setup();await f.api.read(request(1),{forceRefresh:true});assert.equal(f.calls[0].p.forceRefresh,true);for(const [r,o]of [[request(1),{...opts,forceRefresh:true}],[request(1),{...opts,responseProfile:'time-v1'}],[{...request(1),view:'full'},opts],[request(1),{readyOnlyProbe:'yes'}]])await assert.rejects(f.api.read(r,o));assert.equal(f.calls.length,1);
});

test('an explicit read after cache expiry promotes a held refresh instead of waiting for its release hook',async()=>{
 const h=setup(p=>envelope(p,r=>ready(r,true)));await h.api.read(request(1),opts);assert.equal(h.calls.length,1);h.setNow(NOW+1100);const value=await h.api.read(request(1),opts);assert.equal(value.summary[0].all_count,2);assert.equal(h.calls.length,2);assert.equal(h.calls[1].p.readMode,undefined);h.api.releaseRefresh();await tick();assert.equal(h.calls.length,2);
});

for(const outcome of ['lru-same-head','expired-same-head','new-head'])test('background retention after '+outcome+' preserves the original deadline unless the head changes',async()=>{
 const late=deferred(),h=setup((p,c,n)=>n===2?late.promise:envelope(p,r=>ready(r,true)),{completedCacheMaxBytes:6000});
 await h.api.read(request(1),opts);h.api.releaseRefresh();await tick();assert.equal(h.calls.length,2);
 h.setNow(NOW+500);await h.api.read(request(2));assert.equal(h.calls.length,3,'second exact key occupies the bounded completed cache');
 h.setNow(NOW+(outcome==='expired-same-head'?1100:800));const reply=envelope(h.calls[1].p,r=>ready(r,true));if(outcome==='new-head'){reply.items[0].publication.id='new-head';reply.items[0].publication.generation=2;}
 late.resolve(reply);await tick();h.setNow(NOW+1200);const n=h.calls.length;await h.api.read(request(1));assert.equal(h.calls.length,n+(outcome==='new-head'?0:1));
});
