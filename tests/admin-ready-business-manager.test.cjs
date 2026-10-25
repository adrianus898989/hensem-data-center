// Existing prepared queue; synthetic DTOs and errors only, no timing claim.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-prepared-ready-only.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {setup,request,envelope,ready,tick,deferred}=new Function('require','__dirname',prefix+';return {setup,request,envelope,ready,tick,deferred};')(require,__dirname);
const main={readyOnlyProbe:true,responseProfile:'time-v1'},comparison={readyOnlyProbe:true,readyOnlyProbePhase:'comparison'};
const full=n=>({...request(n),view:'full',amountBands:{charge:[0,100,200],withdraw:[0,500]}});
function response(p){const e=envelope(p);if(p.responseProfile)for(const v of e.items){v.result.groups={hourly:v.result.groups.hourly,provider:v.result.groups.provider};v.resultGroups={contract:'prepared-result-groups-v1',profile:'time-v1',groups:['hourly','provider']};}return e;}
test('43 business primaries and exact comparison each coalesce once; numeric, null and completeness semantics survive projection',async()=>{
 const h=setup(response);const a=await Promise.all(Array.from({length:43},(_,i)=>h.api.read(full(i),main)));const b=await Promise.all(Array.from({length:43},(_,i)=>h.api.read(request(i),comparison)));
 assert.equal(h.calls.length,2);assert.deepEqual(h.calls.map(x=>x.p.requests.length),[43,43]);assert(h.calls.every(x=>x.p.readMode==='ready-only-v1'));assert.equal(h.calls[0].p.responseProfile,'time-v1');assert.equal(h.calls[1].p.responseProfile,undefined);
 assert.equal(a[0].summary[0].all_amount,'9007199254740993.01');assert.equal(a[0].summary[0].success_amount,null);assert.equal(a[0]._preparedPublication.sourceComplete,false);assert.deepEqual(Object.keys(a[0].groups),['hourly','provider']);assert.equal(a[0].groups.matrix,undefined);assert.equal(b.length,43);
 await h.api.read(full(100),main);await h.api.read(request(100),comparison);assert(h.calls.slice(2).every(x=>!x.p.readMode&&x.p.requests.length<=3));
});
test('exact capacity refusal falls back once to the original 3 by 2 compact queue',async()=>{
 const flights=[];let active=0,peak=0;const h=setup(p=>{if(p.readMode)throw Object.assign(Error('capacity'),{code:'PREPARED_READY_RESPONSE_CAPACITY'});active++;peak=Math.max(peak,active);const d=deferred();flights.push({p,d});return d.promise.finally(()=>active--);});
 const all=Promise.all(Array.from({length:19},(_,i)=>h.api.read(full(i),main)));await tick();assert.equal(flights.length,2);let done=0;while(done<flights.length){const f=flights[done++];assert.equal(f.p.responseProfile,'time-v1');assert(f.p.requests.length<=3);f.d.resolve(response(f.p));await tick();}assert.equal((await all).length,19);assert.equal(done,7);assert.equal(peak,2);assert.equal(h.calls.filter(c=>c.p.readMode).length,1);
});
for(const code of ['54000','22023','prepared_ready_response_capacity','PREPARED_AGGREGATE_INVALID','ADMIN_LIVE_PERMISSION_DENIED','ADMIN_LIVE_TIMEOUT'])test('unrecognized or access error '+code+' never downgrades to ordinary reads',async()=>{
 const h=setup(()=>{throw Object.assign(Error('denied'),{code});});await assert.rejects(h.api.read(full(1),main),e=>e.code===code);await tick();assert.equal(h.calls.length,1);
});
test('ready byte budget admits a bounded prefix then uses ordinary request batches',async()=>{
 const h=setup(response),qs=Array.from({length:10},(_,i)=>({...full(i),providers:[String(i)+'x'.repeat(24000)]}));await Promise.all(qs.map(q=>h.api.read(q,main)));const probe=h.calls.filter(x=>x.p.readMode);assert.equal(probe.length,1);assert(probe[0].p.requests.length<10);assert(Buffer.byteLength(JSON.stringify(probe[0].p))<=128000);assert(h.calls.filter(x=>!x.p.readMode).every(x=>x.p.requests.length<=3));
});
test('comparison phases are internal bounded options and reset only after cancellation or context change',async()=>{
 const h=setup(response);for(const phase of ['another',{},null,1])await assert.rejects(h.api.read(full(1),{...main,readyOnlyProbePhase:phase}));await assert.rejects(h.api.read(full(1),{responseProfile:'time-v1',readyOnlyProbePhase:'comparison'}));assert.equal(h.calls.length,0);
 await h.api.read(full(1),main);h.api.cancel();await h.api.read(full(2),main);h.setScope('account-b|role-v2|teamops');await h.api.read(full(3),main);assert.equal(h.calls.filter(x=>x.p.readMode).length,3);
});
test('late capacity refusal after cancel cannot start original reads or populate the new authority cache',async()=>{
 const late=deferred(),h=setup((_p,_c,n)=>n===1?late.promise:response(_p));const old=h.api.read(full(1),main);await tick();h.api.cancel();await assert.rejects(old);await h.api.read(full(2),main);late.reject(Object.assign(Error('late'),{code:'PREPARED_READY_RESPONSE_CAPACITY'}));await tick();assert.equal(h.calls.length,2);assert(h.calls.every(c=>c.p.readMode));
});
test('missing profile groups remains invalid; compact publication cannot enter legacy full cache',async()=>{
 const bad=setup(p=>{const e=response(p);delete e.items[0].result.groups.hourly;return e;});await assert.rejects(bad.api.read(full(1),main),e=>e.code==='PREPARED_AGGREGATE_INVALID');assert.equal(bad.calls.length,1);
 const h=setup(response);await h.api.read(full(1),main);const all=await h.api.read(full(1));assert.equal(h.calls.length,2);assert(Array.isArray(all.groups.matrix));assert.equal(all._preparedResultGroups,undefined);
});
test('oversized decoded result is rejected and never cached or converted to a compute miss',async()=>{
 const h=setup((p,_c,n)=>{const e=response(p);if(n===1)e.items[0].result.syntheticPadding='x'.repeat(20000);return e;},{maxResponseBytes:16384});await assert.rejects(h.api.read(full(1),main),e=>e.code==='PREPARED_AGGREGATE_INVALID');assert.equal(h.calls.length,1);const next=await h.api.read(full(1),main);assert.equal(h.calls.length,2);assert.equal(next.summary[0].all_count,2);assert.equal(h.calls[1].p.readMode,undefined);
});
test('JSONB expansion is budgeted before dispatch; scientific numbers retain ordinary reads',async()=>{
 const h=setup(response),qs=Array.from({length:35},(_,i)=>({...full(i),providers:Array.from({length:900},(_,j)=>String(i)+'-'+j)}));await Promise.all(qs.map(q=>h.api.read(q,main)));const probes=h.calls.filter(x=>x.p.readMode);assert.equal(probes.length,1);assert(Buffer.byteLength(JSON.stringify(probes[0].p,null,1))<=128000);assert(h.calls.filter(x=>!x.p.readMode).every(x=>x.p.requests.length<=3));
 const n=setup(response);await n.api.read({...full(1),amountMin:1e-100},main);assert.equal(n.calls[0].p.readMode,undefined);assert.equal(n.calls[0].p.requests[0].amountMin,1e-100);
});
