const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,scalar}=require('./fixtures/provider-snapshot-retention/harness.cjs');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/operations/storage-maintenance.sql'),'utf8');
const install=async db=>{await db.exec(sql);await db.exec("set statement_timeout='5s'");};
const heads=db=>db.query('select to_jsonb(h)h,to_jsonb(a)a from private.provider_snapshot_heads h join private.provider_snapshot_artifacts a on a.id=h.snapshot_id order by h.job_id').then(r=>r.rows);
const move=(db,n=100)=>scalar(db,'select private.provider_snapshot_archive_closed_storage($1)',[n]);
const archive=(db,n=100)=>scalar(db,'select private.provider_snapshot_archive_old_failures($1)',[n]);
const balanced=db=>scalar(db,'select private.provider_snapshot_storage_balanced()');
test('old heads migrate budgets without changing any payload, TTL, dependency, revision, identity or readable head',async()=>{const{db,cohort,targets}=await fixture({tiered:true});try{
 const c=await cohort('2026-09-10',10),before=await heads(db);const jobs=(await db.query('select to_jsonb(j)j from private.provider_snapshot_jobs j order by id')).rows;
 const deps=await Promise.all(targets.map(t=>scalar(db,'select private.provider_snapshot_dependency_token($1)',[t])));
 await install(db);assert.equal(await balanced(db),true);assert.equal((await move(db,3)).jobs,3);assert.equal((await move(db)).jobs,7);assert.equal((await move(db)).jobs,0);
 assert.deepEqual(await heads(db),before);assert.deepEqual((await db.query("select to_jsonb(j)-'storage_class'j from private.provider_snapshot_jobs j order by id")).rows,jobs);
 assert.deepEqual(await Promise.all(targets.map(t=>scalar(db,'select private.provider_snapshot_dependency_token($1)',[t]))),deps);
 assert.deepEqual((await db.query('select storage_class,jobs,artifacts from private.provider_snapshot_storage_usage order by storage_class')).rows,[{storage_class:'history',jobs:10,artifacts:10},{storage_class:'hot',jobs:0,artifacts:0}]);assert.equal(await balanced(db),true);
 // A later version INSERT/DELETE must debit the persisted class, not recompute
 // the old partial-window class (which is still correctly immutable hot).
 const j=await scalar(db,'select to_jsonb(j)from private.provider_snapshot_jobs j where id=$1',[c.jobs[0]]);assert.equal(await scalar(db,'select private.provider_snapshot_storage_class($1,$2,$3)',[j.target,j.window_from,j.window_to]),'hot');
 await db.query("update private.provider_snapshot_cohorts set status='building'where id=$1",[c.id]);await db.query('select private.provider_snapshot_requeue($1)',[j.id]);
 const claim=await scalar(db,"select private.provider_snapshot_claim('persisted-history-test',120)"),old=before.find(x=>x.h.job_id===j.id).a;
 assert.equal(claim.jobId,j.id);assert.equal((await scalar(db,'select private.provider_snapshot_complete($1,$2,$3,$4,$5)',[claim.jobId,claim.runId,claim.fence,old.payload,old.provenance])).published,true);
 assert.deepEqual((await db.query('select storage_class,artifacts from private.provider_snapshot_storage_usage order by storage_class')).rows,[{storage_class:'history',artifacts:11},{storage_class:'hot',artifacts:0}]);assert.equal(await balanced(db),true);
 await db.exec("delete from private.provider_snapshot_heads;delete from private.provider_snapshot_artifacts;delete from private.provider_snapshot_cohort_jobs;delete from private.provider_snapshot_jobs");assert.equal(await balanced(db),true);
 }finally{await db.close();}});

test('current scope, active lease, failed with head and private roles fail closed',async()=>{const{db,cohort}=await fixture({tiered:true});try{
 const c=await cohort('2026-09-12',10);await install(db);const before=await heads(db);
 await db.query("update private.provider_snapshot_jobs set status='running',lease_until=clock_timestamp()+interval'2minutes'where id=$1",[c.jobs[0]]);assert.equal((await move(db)).status,'busy');assert.equal((await archive(db)).status,'busy');assert.deepEqual(await heads(db),before);
 await db.query("update private.provider_snapshot_jobs set status='ready',lease_until=null where id=$1",[c.jobs[0]]);
 await db.query("update private.provider_snapshot_cohorts set local_date=(statement_timestamp()at time zone'Asia/Kolkata')::date where id=$1",[c.id]);assert.equal((await move(db)).jobs,0);assert.deepEqual(await heads(db),before);
 for(const role of['anon','authenticated','service_role']){await db.exec('set role '+role);for(const name of['provider_snapshot_archive_closed_storage','provider_snapshot_archive_old_failures'])await assert.rejects(db.query('select private.'+name+'(100)'),e=>e.code==='42501');await db.exec('reset role');}
 assert.equal(await balanced(db),true);
 }finally{await db.close();}});
test('failed records archive completely and restore failed with exact cohort membership; readable failures and active/current scopes remain',async()=>{const{db,cohort}=await fixture({tiered:true});try{
 const c=await cohort('2026-09-11',10,{missing:true}),id=c.jobs.at(-1),saved=await heads(db);await db.query("update private.provider_snapshot_jobs set updated_at=clock_timestamp()-interval'2hours'where id=$1",[id]);await install(db);const original=await scalar(db,'select to_jsonb(j)from private.provider_snapshot_jobs j where id=$1',[id]),members=(await db.query('select *from private.provider_snapshot_cohort_jobs where job_id=$1',[id])).rows;
 assert.equal((await archive(db)).jobs,1);assert.equal(await scalar(db,'select exists(select 1 from private.provider_snapshot_jobs where id=$1)',[id]),false);assert.deepEqual(await heads(db),saved);assert.deepEqual(await scalar(db,'select job_record from private.provider_snapshot_failed_archive where job_id=$1',[id]),original);assert.equal(await balanced(db),true);
 await db.query("update private.provider_snapshot_cohorts set status='obsolete'where id=$1",[c.id]);await assert.rejects(scalar(db,'select private.provider_snapshot_restore_failed($1)',[id]),/snapshot_archive_cohort_changed/);assert.equal(await scalar(db,'select exists(select 1 from private.provider_snapshot_jobs where id=$1)',[id]),false);await db.query("update private.provider_snapshot_cohorts set status='failed'where id=$1",[c.id]);
 assert.equal((await scalar(db,'select private.provider_snapshot_restore_failed($1)',[id])).status,'restored_failed');assert.deepEqual(await scalar(db,'select to_jsonb(j)from private.provider_snapshot_jobs j where id=$1',[id]),original);assert.deepEqual((await db.query('select *from private.provider_snapshot_cohort_jobs where job_id=$1',[id])).rows,members);assert.equal(await balanced(db),true);assert.equal((await archive(db)).jobs,0);
 await db.query("update private.provider_snapshot_jobs set status='failed',attempts=3 where id=$1",[c.jobs[0]]);assert.equal((await archive(db)).jobs,0);assert.deepEqual(await heads(db),saved);
 }finally{await db.close();}});

test('counter baseline drift aborts DDL; archive cancellation rolls back its audit, memberships, counters and deletion together',async()=>{const{db,cohort}=await fixture({tiered:true});try{
 const c=await cohort('2026-09-11',11,{missing:true}),id=c.jobs.at(-1);await db.query("update private.provider_snapshot_jobs set updated_at=clock_timestamp()-interval'2hours'where id=$1",[id]);
 await db.exec("update private.provider_snapshot_storage_usage set jobs=jobs+1 where storage_class='hot'");await assert.rejects(db.exec(sql),/snapshot_storage_counters_drift/);await db.exec('rollback');assert.equal(await scalar(db,"select count(*)from pg_attribute where attrelid='private.provider_snapshot_jobs'::regclass and attname='storage_class'and not attisdropped"),0);await db.exec("update private.provider_snapshot_storage_usage set jobs=jobs-1 where storage_class='hot'");await install(db);
 const before=await scalar(db,'select to_jsonb(j)from private.provider_snapshot_jobs j where id=$1',[id]),members=(await db.query('select *from private.provider_snapshot_cohort_jobs where job_id=$1',[id])).rows;
 await db.exec("create function private.test_archive_cancel()returns trigger language plpgsql as $$begin raise exception using errcode='57014',message='synthetic_cancel';end;$$;create trigger test_archive_cancel before delete on private.provider_snapshot_jobs for each row execute function private.test_archive_cancel()");
 await assert.rejects(archive(db),e=>e.code==='57014');assert.equal(await scalar(db,'select count(*)from private.provider_snapshot_failed_archive'),0);assert.deepEqual(await scalar(db,'select to_jsonb(j)from private.provider_snapshot_jobs j where id=$1',[id]),before);assert.deepEqual((await db.query('select *from private.provider_snapshot_cohort_jobs where job_id=$1',[id])).rows,members);assert.equal(await balanced(db),true);
 }finally{await db.close();}});
test('history full causes atomic move rollback and quota counters cannot be bypassed by manual class edits',async()=>{const{db,cohort}=await fixture({tiered:true});try{await cohort('2026-09-12',10);await install(db);const before=await heads(db);
 await assert.rejects(db.exec("update private.provider_snapshot_jobs set storage_class='history'"),/snapshot_storage_move_denied/);
 await db.exec("update private.provider_snapshot_storage_usage set artifacts=25000 where storage_class='history'");await assert.rejects(move(db),/snapshot_storage_counters_drift/);assert.deepEqual(await heads(db),before);await db.exec("update private.provider_snapshot_storage_usage set artifacts=0 where storage_class='history'");assert.equal(await balanced(db),true);
 // Lower ONLY the local synthetic fixture cap to exercise real accounting
 // rollback without allocating 2GiB. Every other production function stays exact.
 const def=await scalar(db,"select pg_get_functiondef('private.provider_snapshot_account_jobs()'::regprocedure)");await db.exec(def.replace('artifacts+artifact_n<=25000','artifacts+artifact_n<=5'));
 await assert.rejects(move(db),/snapshot_history_capacity/);assert.equal(await balanced(db),true);assert.deepEqual(await heads(db),before);assert.equal(await scalar(db,"select count(*)from private.provider_snapshot_jobs where storage_class='history'"),0);
 }finally{await db.close();}});
