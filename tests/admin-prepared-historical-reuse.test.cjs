// Exact completed-envelope retention only. Synthetic transport; no timing claims.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-prepared-aggregates.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,q,envelope,NOW,code}=new Function('require',prefix+';return {harness,q,envelope,NOW,code};')(require);
const response=payload=>{const r=envelope(payload.requests);r.version=2;r.items.forEach(i=>Object.assign(i.publication,{freshness:'refresh_due',refreshState:'queued'}));return r;};
test('explicit history policy keeps the exact immutable envelope for at most five minutes without sliding',async()=>{
 let time=NOW;const h=harness({publicationVersion:2,completedCacheTtlMs:()=>999999,now:()=>time,handler:response});const a=await h.adapter.read(q());
 time+=30001;assert.deepEqual(await h.adapter.read(q()),a);time=NOW+299999;assert.deepEqual(await h.adapter.read(q()),a);assert.equal(h.calls.length,1);
 time++;await h.adapter.read(q());assert.equal(h.calls.length,2);
});
test('invalid or throwing retention policy never breaks an authorized read and never caches it',async()=>{
 for(const policy of [()=>NaN,()=>-1,()=>{throw Error('policy');}]){const h=harness({publicationVersion:2,completedCacheTtlMs:policy,handler:response});await h.adapter.read(q());await h.adapter.read(q());assert.equal(h.calls.length,2);}
});
test('longer retention preserves authority denial, force invalidation and native identity boundaries',async()=>{
 let time=NOW;const h=harness({publicationVersion:2,completedCacheTtlMs:()=>300000,now:()=>time,handler:response});await h.adapter.read(q());time+=60000;
 await h.adapter.read(q(),{forceRefresh:true});assert.equal(h.calls.length,2);h.setScope('new-account');await h.adapter.read(q());assert.equal(h.calls.length,3);
 h.setPlatform(null);await assert.rejects(h.adapter.read(q()),code('unsupported'));h.adapter.clear();
});
