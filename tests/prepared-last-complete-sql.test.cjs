const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.PREPARED_BASELINE_DIR?path.resolve(process.env.PREPARED_BASELINE_DIR):path.resolve(__dirname,'..');
const original=path.join(base,'tests/exact-prepared-aggregates-sql.test.cjs');
const source=fs.readFileSync(original,'utf8');
let setup=source.slice(0,source.indexOf("test('read admits"))+source.slice(source.indexOf('const canonical='),source.indexOf("test('semantic key"));
setup=setup.replace('test.before(async()=>{','async function initialize(){').replace('});\ntest.after(async()=>{await db?.close()});','}\nasync function close(){await db?.close()}').replace("test.beforeEach(async()=>{","async function reset(){").replace("[OWNER]);});\nconst canonical","[OWNER]);}\nconst canonical");
const oldRequire=require('node:module').createRequire(original);
const h=new Function('require','__dirname',setup+';return {initialize,reset,close,val,read,req,publish,claim,complete,payload,getDB:()=>db,getTargets:()=>targets};')(oldRequire,path.dirname(original));
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261017054431_prepared_last_complete_reader.sql'),'utf8');
let beforeReader,beforeToken,beforeFunctions;
test.before(async()=>{await h.initialize();beforeReader=await h.val("select pg_get_functiondef('private.prepared_aggregate_read(text,jsonb)'::regprocedure)value");beforeToken=await h.val("select private.provider_snapshot_dependency_token('{}'::jsonb)value");beforeFunctions=await h.val("select jsonb_agg(to_jsonb(p)order by p.oid)value from pg_proc p where pronamespace='private'::regnamespace and oid<>'private.prepared_aggregate_read(text,jsonb)'::regprocedure");await h.getDB().exec(migration)});
test.beforeEach(()=>h.reset());test.after(()=>h.close());
const read=(extra={},qs=[h.req()])=>h.val('select public.dashboard_admin_aggregate_prepared($1,$2)value',['providers',JSON.stringify({requests:qs,publicationVersion:2,...extra})]);
async function expire(){await h.getDB().exec("insert into private.prepared_aggregate_artifacts select gen_random_uuid(),job_id,gen_random_uuid(),fence,revision,dependency,payload,clock_timestamp()-interval'2hours',clock_timestamp()-interval'1hour',cutoff,source_complete,bytes from private.prepared_aggregate_artifacts;update private.prepared_aggregate_heads set artifact_id=(select id from private.prepared_aggregate_artifacts order by expires_at limit 1);update private.prepared_aggregate_jobs set next_due_at=clock_timestamp()-interval'1hour'");}
test('expired exact complete v2 remains readable while v1 stays expiry-strict; no raw work or new version is fabricated',async()=>{
 await h.publish();await expire();const before=await h.val('select to_jsonb(a)value from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a on a.id=h.artifact_id');
 const r=await read();assert.equal(r.version,2);const i=r.items[0];assert.equal(i.status,'ready');assert.equal(i.publication.freshness,'refresh_due');assert.equal(i.publication.refreshState,'queued');assert.equal(i.publication.id,before.id);assert.equal(Date.parse(i.publication.computedAt),Date.parse(before.computed_at));assert.equal(Date.parse(i.publication.expiresAt),Date.parse(before.expires_at));assert.equal(i.publication.sourceComplete,false);assert.equal(i.result.total,2);
 assert.equal((await h.read()).items[0].result,null);assert.equal(await h.val('select count(*)value from private.prepared_aggregate_jobs'),1);assert.equal(await h.val('select count(*)value from private.prepared_aggregate_artifacts'),2);
});
test('force refresh is explicit, does not expire the old immutable result, and preserves a running lease',async()=>{
 await h.publish();const before=(await read()).items[0].publication;assert.equal(before.refreshState,'idle');const r=(await read({forceRefresh:true})).items[0];assert.equal(r.status,'ready');assert.equal(r.publication.freshness,'fresh');assert.equal(r.publication.refreshState,'queued');assert.equal(r.publication.id,before.id);assert.equal(r.publication.expiresAt,before.expiresAt);
 const c=await h.claim(),j=await h.val('select to_jsonb(j)value from private.prepared_aggregate_jobs j');assert(c);const x=(await read({forceRefresh:true})).items[0];assert.equal(x.publication.refreshState,'running');assert.deepEqual(await h.val('select to_jsonb(j)value from private.prepared_aggregate_jobs j'),j);
});
test('failed refresh retains last complete result without resetting exhausted attempts or failure evidence',async()=>{
 await h.publish();await expire();await h.getDB().exec("update private.prepared_aggregate_jobs set status='failed',attempts=3,last_error='synthetic_timeout',not_before=clock_timestamp()+interval'1hour'");
 const j=await h.val('select to_jsonb(j)value from private.prepared_aggregate_jobs j');const i=(await read({forceRefresh:true})).items[0];assert.equal(i.status,'ready');assert.equal(i.publication.refreshState,'failed');assert.equal(i.publication.freshness,'refresh_due');assert.deepEqual(await h.val('select to_jsonb(j)value from private.prepared_aggregate_jobs j'),j);
});
test('semantic revision, dependency, native identity and scope changes cannot borrow the old complete version',async()=>{
 for(const update of ["revision=revision+1","dependency='changed'","target=jsonb_set(target,'{currency}','\"USD\"')"]){await h.getDB().exec('truncate private.prepared_aggregate_heads,private.prepared_aggregate_artifacts,private.prepared_aggregate_jobs');await h.publish();await expire();await h.getDB().exec('update private.prepared_aggregate_jobs set '+update);const i=(await read()).items[0];assert.notEqual(i.status,'ready');assert.equal(i.result,null);}
 await h.getDB().exec('truncate private.prepared_aggregate_heads,private.prepared_aggregate_artifacts,private.prepared_aggregate_jobs');await h.publish();assert.equal((await read({},[h.req(h.getTargets()[0],{startAt:'2026-10-12T18:30:00Z'})])).items[0].result,null);
});
test('permission/IP revocation and malformed version are rejected before any refresh mutation',async()=>{
 await h.publish();await expire();const j=await h.val('select to_jsonb(j)value from private.prepared_aggregate_jobs j');await h.getDB().query("select set_config('test.ip_allowed','false',false)");await assert.rejects(read({forceRefresh:true}),e=>e.code==='42501');assert.deepEqual(await h.val('select to_jsonb(j)value from private.prepared_aggregate_jobs j'),j);await h.getDB().query("select set_config('test.ip_allowed','true',false)");
 for(const patch of [{publicationVersion:1},{publicationVersion:'2'},{forceRefresh:'true'},{publicationVersion:undefined,forceRefresh:true}])await assert.rejects(read(patch),e=>e.code==='22023');
});
test('actual v2 adapter accepts PostgreSQL stale envelope and keeps exact independent clocks',async()=>{
 const q=h.req(h.getTargets()[0],{successStartAt:'2026-10-11T00:00:00.000001Z',successEndAt:'2026-10-12T00:00:00.000001Z',successBasis:'success'});await h.publish(q);await expire();
 const client=require(process.env.PREPARED_V2_ADAPTER?path.resolve(process.env.PREPARED_V2_ADAPTER):path.join(base,'admin-preview/live-prepared-aggregates.js')).create({publicationVersion:2,context:()=> 'owner/providers',platform:()=>h.payload(q).platform,request:b=>h.val('select public.dashboard_admin_aggregate_prepared($1,$2)value',['providers',JSON.stringify(Object.fromEntries(Object.entries(b).filter(([k])=>k!=='action')))])});
 const r=await client.read(q);assert.equal(r._preparedPublication.freshness,'refresh_due');assert.equal(r.successStartAt,q.successStartAt);assert.equal(r._preparedPublication.sourceComplete,false);client.clear();
});

test('only reader body changes; producer/TTL/scheduler metadata and old provider dependency stay exact',async()=>{
 assert.equal(await h.val("select private.provider_snapshot_dependency_token('{}'::jsonb)value"),beforeToken);
 assert.deepEqual(await h.val("select jsonb_agg(to_jsonb(p)order by p.oid)value from pg_proc p where pronamespace='private'::regnamespace and oid<>'private.prepared_aggregate_read(text,jsonb)'::regprocedure"),beforeFunctions);
 assert.equal(await h.val('select enabled value from private.prepared_aggregate_schedule'),false);
 await assert.rejects(h.getDB().exec(migration),/prepared_last_complete_reader_drift/);await h.getDB().exec('rollback');
 const current=await h.val("select pg_get_functiondef('private.prepared_aggregate_read(text,jsonb)'::regprocedure)value");
 await h.getDB().exec(beforeReader);await h.getDB().exec('grant execute on function private.prepared_aggregate_read(text,jsonb)to authenticated');
 await assert.rejects(h.getDB().exec(migration),/prepared_last_complete_reader_drift/);await h.getDB().exec('rollback');
 await h.getDB().exec('revoke execute on function private.prepared_aggregate_read(text,jsonb)from authenticated');await h.getDB().exec(current);
});
test('provider switching projects the same expired complete base and an unauthorized second batch target prevents first refresh',async()=>{
 await h.publish();await expire();
 const q=h.req(h.getTargets()[0],{providers:['SelectedPay'],direction:'charge'}),r=(await read({},[q])).items[0];
 assert.equal(r.status,'ready');assert.equal(r.result.total,2);assert.equal(r.result.groups.provider[0].fee_low_amount,'1.123456789');
 const other=(await read({},[h.req(h.getTargets()[0],{providers:['Another'],direction:'withdraw'})])).items[0];
 assert.equal(other.publication.id,r.publication.id);assert.equal(other.result.total,0);assert.equal(await h.val('select count(*)value from private.prepared_aggregate_jobs'),1);
 await h.getDB().exec("update private.prepared_aggregate_jobs set status='ready'");const j=await h.val('select to_jsonb(j)value from private.prepared_aggregate_jobs j');
 await assert.rejects(read({forceRefresh:true},[q,{...q,platformId:'00000000-0000-4000-8000-000000000000'}]),e=>e.code==='42501');
 assert.deepEqual(await h.val('select to_jsonb(j)value from private.prepared_aggregate_jobs j'),j);
});

test('ordinary expired reads respect the next scheduled refresh; explicit force can queue without changing original freshness clocks',async()=>{
 await h.publish();await expire();await h.getDB().exec("update private.prepared_aggregate_jobs set next_due_at=clock_timestamp()+interval'2hours'");
 const old=await h.val('select to_jsonb(j)value from private.prepared_aggregate_jobs j');
 const i=(await read()).items[0];assert.equal(i.status,'ready');assert.equal(i.publication.freshness,'refresh_due');assert.equal(i.publication.refreshState,'idle');assert.equal(Date.parse(i.publication.nextRefreshAt),Date.parse(old.next_due_at));
 assert.deepEqual(await h.val('select to_jsonb(j)value from private.prepared_aggregate_jobs j'),old);
 const forced=(await read({forceRefresh:true})).items[0];assert.equal(forced.publication.refreshState,'queued');assert.equal(forced.publication.expiresAt,i.publication.expiresAt);assert.equal(forced.publication.computedAt,i.publication.computedAt);
});
