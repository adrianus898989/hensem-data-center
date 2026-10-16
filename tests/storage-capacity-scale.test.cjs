const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,scalar}=require('./fixtures/provider-snapshot-retention/harness.cjs');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/operations/storage-maintenance.sql'),'utf8');
test('2048 occupied real hot heads admit a new normalcomplete after bounded tier migration; no quota is raised and old heads survive',async()=>{const{db,cohort}=await fixture({tiered:true});try{
 const c=await cohort('2026-09-13',10),prototype=c.jobs[0];
 // Synthetic exact request/payload identities, real production accounting
 // triggers and quotas. No injected counters and no oversized mocked byte count.
 await db.query(`with base as(select *from private.provider_snapshot_jobs where id=$1),copies as(
 select b.*,gen_random_uuid()new_id,b.window_to+g*interval'1second'new_end,
 b.request||jsonb_build_object('endAt',private.provider_snapshot_iso(b.window_to+g*interval'1second'))q
 from base b cross join generate_series(1,2038)g)
 insert into private.provider_snapshot_jobs select(jsonb_populate_record(null::private.provider_snapshot_jobs,
 to_jsonb(c)-array['new_id','new_end','q']||jsonb_build_object('id',new_id,'window_to',new_end,'request',q,'request_key',request_key||jsonb_build_object('request',q)))).*from copies c`,[prototype]);
 await db.query(`with base as(select a.*from private.provider_snapshot_heads h join private.provider_snapshot_artifacts a on a.id=h.snapshot_id where h.job_id=$1),
 copies as(select a.*,j.id new_job,j.request->>'endAt'end_at,a.payload||jsonb_build_object('endAt',j.request->>'endAt')new_payload
 from base a cross join private.provider_snapshot_jobs j where not exists(select 1 from private.provider_snapshot_heads h where h.job_id=j.id))
 insert into private.provider_snapshot_artifacts select(jsonb_populate_record(null::private.provider_snapshot_artifacts,
 to_jsonb(c)-array['new_job','end_at','new_payload']||jsonb_build_object('id',gen_random_uuid(),'job_id',new_job,'payload',new_payload,'payload_hash',md5(new_payload::text),'stored_bytes',pg_column_size(new_payload)))).*from copies c`,[prototype]);
 await db.exec('insert into private.provider_snapshot_heads(job_id,snapshot_id)select a.job_id,a.id from private.provider_snapshot_artifacts a where not exists(select 1 from private.provider_snapshot_heads h where h.job_id=a.job_id)');
 assert.equal(await scalar(db,"select artifacts from private.provider_snapshot_storage_usage where storage_class='hot'"),2048);
 const before=await scalar(db,"select md5(string_agg(to_jsonb(h)::text||to_jsonb(a)::text,''order by h.job_id))from private.provider_snapshot_heads h join private.provider_snapshot_artifacts a on a.id=h.snapshot_id");
 await db.query("update private.provider_snapshot_cohorts set status='building'where id=$1",[c.id]);await db.query('select private.provider_snapshot_requeue($1)',[prototype]);
 let claim=await scalar(db,"select private.provider_snapshot_claim('full-hot-test',120)");const old=await scalar(db,'select to_jsonb(a)from private.provider_snapshot_heads h join private.provider_snapshot_artifacts a on a.id=h.snapshot_id where h.job_id=$1',[prototype]);
 await assert.rejects(scalar(db,'select private.provider_snapshot_complete($1,$2,$3,$4,$5)',[claim.jobId,claim.runId,claim.fence,old.payload,old.provenance]),/snapshot_artifact_capacity/);
 await db.query("update private.provider_snapshot_jobs set status='ready',lease_until=null where id=$1",[prototype]);await db.query("update private.provider_snapshot_cohorts set status='ready'where id=$1",[c.id]);
 await db.exec(sql);await db.exec("set statement_timeout='5s'");let moved=0;
 for(let n=0;n<22;n++){const x=await scalar(db,'select private.provider_snapshot_archive_closed_storage(100)');moved+=x.jobs;assert.equal(await scalar(db,'select private.provider_snapshot_storage_balanced()'),true);}
 assert.equal(moved,2048);assert.equal(await scalar(db,"select artifacts from private.provider_snapshot_storage_usage where storage_class='hot'"),0);
 assert.equal(await scalar(db,"select md5(string_agg(to_jsonb(h)::text||to_jsonb(a)::text,''order by h.job_id))from private.provider_snapshot_heads h join private.provider_snapshot_artifacts a on a.id=h.snapshot_id"),before);
 await db.query("update private.provider_snapshot_cohorts set status='building'where id=$1",[c.id]);await db.query('select private.provider_snapshot_requeue($1)',[prototype]);claim=await scalar(db,"select private.provider_snapshot_claim('history-recovered-test',120)");
 assert.equal((await scalar(db,'select private.provider_snapshot_complete($1,$2,$3,$4,$5)',[claim.jobId,claim.runId,claim.fence,old.payload,old.provenance])).published,true);
 assert.equal(await scalar(db,"select artifacts from private.provider_snapshot_storage_usage where storage_class='history'"),2049);assert.equal(await scalar(db,'select count(*)from private.provider_snapshot_heads'),2048);assert.equal(await scalar(db,'select private.provider_snapshot_storage_balanced()'),true);
 }finally{await db.close();}});
