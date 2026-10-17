const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{setup,scalar}=require('./fixtures/snapshot-capacity-cycle/harness.cjs');
const patch=fs.readFileSync(path.join(__dirname,'../supabase/operations/provider-last-complete.sql'),'utf8');
const validate=require('../admin-preview/live-provider-snapshot-shadow.js').validate;
const dataHash=db=>scalar(db,"select md5(jsonb_build_object('jobs',(select jsonb_agg(to_jsonb(j)order by id)from private.provider_snapshot_jobs j),'heads',(select jsonb_agg(to_jsonb(h)order by job_id)from private.provider_snapshot_heads h),'artifacts',(select jsonb_agg(to_jsonb(a)order by id)from private.provider_snapshot_artifacts a))::text)");
const tokens=db=>scalar(db,"select jsonb_agg(jsonb_build_array(t.id,private.provider_snapshot_dependency_token(to_jsonb(t)))order by t.id)from private.provider_snapshot_native_catalog()t");
async function replaceArtifact(db,jobId,{expired=false,complete=true}={}){
 await db.query("with a as(insert into private.provider_snapshot_artifacts(job_id,run_id,fence,revision,dependency_token,payload,payload_hash,stored_bytes,provenance,next_due_at)select job_id,gen_random_uuid(),fence,revision,dependency_token,payload,payload_hash,stored_bytes,jsonb_set(provenance,'{computationComplete}',$2::jsonb),case when $3 then clock_timestamp()-interval'1hour'else next_due_at end from private.provider_snapshot_artifacts where id=(select snapshot_id from private.provider_snapshot_heads where job_id=$1)returning id,job_id)update private.provider_snapshot_heads h set snapshot_id=a.id from a where h.job_id=a.job_id",[jobId,JSON.stringify(complete),expired]);
}
test('v2 reads TTL-only prior complete immutable heads, original clocks intact; v1 still strict and no queue/token changes',async()=>{const h=await setup(),{db,dates,cohort,read}=h;try{
 const c=await cohort(dates[3],1440,{lane:'closed'}),job=c.jobs[0];await replaceArtifact(db,job,{expired:true});
 await db.query("update private.provider_snapshot_jobs set next_due_at=clock_timestamp()+interval'2hours'where id=any($1::uuid[])",[c.jobs]);
 const v1=await read(dates[3]),before=await dataHash(db),deps=await tokens(db);assert.equal(v1.status,'stale');await db.exec(patch);
 assert.deepEqual(await read(dates[3]),v1);const v2=await read(dates[3],{version:2});assert.equal(v2.complete,true);assert.equal(v2.status,'ready');assert.equal(v2.freshness,'refresh_due');assert.equal(v2.refreshState,'idle');assert.ok(v2.nextRefreshAt);assert.equal(v2.version,2);assert.equal(v2.missing.length,0);
 assert.equal(v2.computedAt,v1.computedAt);assert.equal(v2.nextDueAt,v1.nextDueAt);assert.equal(v2.publishedCutoff,v1.publishedCutoff);assert.deepEqual(v2.window,v1.window);
 for(const [i,p]of v2.platforms.entries()){assert.deepEqual(p.current,v1.platforms[i].current);assert.deepEqual(p.previous,v1.platforms[i].previous);for(const [n,s]of p.snapshots.entries()){const old=v1.platforms[i].snapshots[n];for(const k of['snapshotId','computedAt','sourceReadStartedAt','sourceReadCompletedAt','nextDueAt','upstreamComplete'])assert.equal(s[k],old[k]);assert.equal(s.stale,false);}}
 assert.equal(await dataHash(db),before);assert.deepEqual(await tokens(db),deps);
 validate(v2,{version:2,startAt:dates[3]+'T00:00:00',endAt:dates[3]+'T23:59:59',platformIds:h.targets.map(t=>t.id)});
 for(const status of['queued','running','failed']){await db.query('update private.provider_snapshot_jobs set status=$2,fence=fence+1 where id=$1',[job,status]);const prior=await dataHash(db),r=await read(dates[3],{version:2});assert.equal(r.status,'ready');assert.equal(r.refreshState,status);assert.equal(r.computedAt,v1.computedAt);assert.equal(await dataHash(db),prior);assert.equal((await read(dates[3])).complete,false);}
}finally{await db.close();}});
test('metadata drift and failure after both replacements roll back without partial reader or retirement release',async()=>{const h=await setup(),{db}=h;try{
 const hashes=()=>scalar(db,"select jsonb_agg(jsonb_build_array(oid::regprocedure::text,md5(prosrc))order by oid)from pg_proc where oid in('private.dashboard_admin_live_provider_snapshot(jsonb)'::regprocedure,'private.provider_snapshot_retire_intraday(uuid)'::regprocedure)");
 const before=await hashes();await assert.rejects(db.exec(patch.replace('if after_metadata is distinct from before_metadata then','if true then')),/metadata_changed/);await db.exec('rollback');assert.deepEqual(await hashes(),before);
 await db.exec('alter function private.provider_snapshot_retire_intraday(uuid)cost 101');await assert.rejects(db.exec(patch),/baseline_drift/);await db.exec('rollback');assert.deepEqual(await hashes(),before);
}finally{await db.close();}});
test('semantic revision/dependency/native/completeness/permission rejection never relabels stale as readable; exact windows remain enforced',async()=>{const h=await setup(),{db,dates,cohort,read}=h;try{
 const c=await cohort(dates[3],1440,{lane:'closed'});await db.exec(patch);const job=c.jobs[0];
 async function unavailable(){const r=await read(dates[3],{version:2});assert.equal(r.complete,false);assert.equal(r.freshness,null);assert.ok(r.missing.length);for(const m of r.missing){const p=r.platforms.find(x=>x.platform.id===m.platformId);assert.equal(p[m.period][m.component],null);}return r;}
 await db.query('update private.provider_snapshot_jobs set revision=revision+1 where id=$1',[job]);await unavailable();await db.query('update private.provider_snapshot_jobs set revision=revision-1 where id=$1',[job]);
 await db.query("update private.provider_snapshot_jobs set dependency_token='changed'where id=$1",[job]);await unavailable();await db.query('update private.provider_snapshot_jobs set dependency_token=private.provider_snapshot_dependency_token(target)where id=$1',[job]);
 await db.exec("insert into private.dashboard_admin_provider_overrides values('印度','RETENTION_A','raw','changed',1)");await unavailable();await db.exec('delete from private.dashboard_admin_provider_overrides');
 await replaceArtifact(db,job,{complete:false});await unavailable();
 assert.equal((await read(dates[3],{version:2,endAt:dates[3]+'T12:00:00'})).status,'unsupported');assert.equal((await read(dates[3],{version:2,components:['orders']})).status,'unsupported');
 await db.query("select set_config('test.ip_allowed','false',false)");await assert.rejects(read(dates[3],{version:2}),/application_session_denied/);await assert.rejects(read(dates[3],{version:2,endAt:dates[3]+'T12:00:00'}),/application_session_denied/);
}finally{await db.close();}});
test('current 30-minute freshness preserves exact compared cutoff; retire reader guard updated atomically, replay and drift roll back',async t=>{const h=await setup(),{db,dates,cohort,read}=h;try{
 const old=await cohort(dates[3],600);await cohort(dates[3],1440,{lane:'closed'});const before=await dataHash(db);await db.exec(patch);assert.equal(await dataHash(db),before);assert.equal((await h.retire(old.id)).status,'retired');
 const minutes=await scalar(db,"select extract(hour from statement_timestamp()at time zone'Asia/Kolkata')::int*60+extract(minute from statement_timestamp()at time zone'Asia/Kolkata')::int");if(minutes>60){await cohort(dates[0],minutes-45);const v1=await read(dates[0]),v2=await read(dates[0],{version:2});assert.equal(v1.status,'stale');assert.equal(v2.status,'ready');assert.equal(v2.freshness,'refresh_due');assert.deepEqual(v1.window,v2.window);assert.equal(v1.publishedCutoff,v2.publishedCutoff);}
 const reader=await scalar(db,"select md5(prosrc)from pg_proc where oid='private.dashboard_admin_live_provider_snapshot(jsonb)'::regprocedure"),stable=await dataHash(db);await assert.rejects(db.exec(patch),/baseline_drift/);await db.exec('rollback');assert.equal(await dataHash(db),stable);assert.equal(await scalar(db,"select md5(prosrc)from pg_proc where oid='private.dashboard_admin_live_provider_snapshot(jsonb)'::regprocedure"),reader);
}finally{await db.close();}});
