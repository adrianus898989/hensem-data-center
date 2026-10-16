'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const{fixture,scalar}=require('../provider-snapshot-retention/harness.cjs');
const activate=fs.readFileSync(path.join(root,'supabase/operations/activate-provider-snapshot-dispatch-wait.sql'),'utf8'),rollback=fs.readFileSync(path.join(root,'supabase/operations/rollback-provider-snapshot-dispatch-wait.sql'),'utf8');
const before=activate.split('$expected_command$')[1],after=activate.split('$next_command$')[1];
async function setup(managed=false){const h=await fixture({tiered:true}),{db}=h;await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261015081659_provider_snapshot_inactive_cron.sql'),'utf8').split('$dispatch_payload$')[1]);
await db.exec(`create table private.provider_schedule_catchup_audit(cohort_id uuid primary key,local_date date,cutoff timestamptz,supplement_pass integer,coalesced_passes smallint[],observed_at timestamptz,recorded_at timestamptz default clock_timestamp());
create role cron_owner;create role harness_admin superuser;create schema cron authorization cron_owner;
create table cron.job(jobid bigint primary key,jobname text unique,schedule text,command text,active boolean,username text,database text,nodename text default 'localhost',nodeport integer default 5432);
alter table cron.job owner to cron_owner;grant usage on schema cron to postgres;grant select on cron.job to postgres;
create function cron.alter_job(job_id bigint,command text)returns void language plpgsql security definer set search_path=''as $api$begin
 update cron.job set command=alter_job.command where jobid=job_id;
 if current_setting('test.api_bad_active',true)='yes'then update cron.job set active=false where jobid=job_id;end if;
end;$api$;
alter function cron.alter_job(bigint,text)owner to cron_owner;revoke all on function cron.alter_job(bigint,text)from public;grant execute on function cron.alter_job(bigint,text)to postgres;
`);
await db.query("insert into cron.job(jobid,jobname,schedule,command,active,username,database)values(34,'provider-snapshot-dispatch-v1','* * * * *',$1,true,'postgres',current_database()),(33,'provider-snapshot-worker-v1','1 second','unchanged worker',true,'postgres',current_database()),(35,'provider-snapshot-maintenance-v1','*/5 * * * *','unchanged maintenance',true,'postgres',current_database())",[before]);
if(managed)await db.exec(`set session authorization harness_admin;alter role postgres rename to bootstrap_superuser;create role postgres;
grant usage on schema private,cron to postgres;grant select on cron.job to postgres;grant execute on function cron.alter_job(bigint,text)to postgres;
alter function private.provider_snapshot_dispatch(timestamptz,integer)owner to postgres;revoke all on function private.provider_snapshot_dispatch(timestamptz,integer)from bootstrap_superuser;set role postgres;`);
return h;}
async function rejects(db,sql,check){await assert.rejects(()=>db.exec(sql),check);await db.exec('rollback');}
const jobs=db=>db.query('select *from cron.job order by jobid').then(x=>x.rows);

test('guarded API changes only cron 34 command under managed SELECT-only ACL; exact rollback restores command',async()=>{const{db}=await setup(true);try{
assert.equal(await scalar(db,"select rolsuper from pg_roles where rolname=current_user"),false);
await assert.rejects(db.query('select *from cron.job for update'),e=>e.code==='42501');await assert.rejects(db.query('update cron.job set active=false'),e=>e.code==='42501');
const original=await jobs(db),definition=await scalar(db,"select pg_get_functiondef('private.provider_snapshot_dispatch(timestamptz,integer)'::regprocedure)");
await db.exec(activate);assert.deepEqual(await jobs(db),original.map(j=>j.jobid===34?{...j,command:after}:j));assert.equal(await scalar(db,"select pg_get_functiondef('private.provider_snapshot_dispatch(timestamptz,integer)'::regprocedure)"),definition);
await rejects(db,activate,/snapshot_dispatch_wait_cron_drift/);await db.exec(rollback);assert.deepEqual(await jobs(db),original);
assert.equal(await scalar(db,"select count(*)from pg_locks where locktype='advisory'and pid=pg_backend_pid()"),0);
}finally{await db.close();}});

test('command, owner, schedule, active flag or function drift rejects before mutation; API postcondition failure rolls back',async()=>{for(const variant of['command','username','schedule','active','function','api']){const{db}=await setup();try{
if(variant==='function')await db.exec('alter function private.provider_snapshot_dispatch(timestamptz,integer)security definer');else if(variant==='api')await db.exec("select set_config('test.api_bad_active','yes',false)");else if(variant==='active')await db.exec('update cron.job set active=false where jobid=34');else await db.query(`update cron.job set ${variant}=$1 where jobid=34`,['changed']);
const original=await jobs(db);await rejects(db,activate,variant==='function'?/snapshot_dispatch_wait_function_drift/:variant==='api'?/snapshot_dispatch_wait_api_drift/:/snapshot_dispatch_wait_cron_drift/);assert.deepEqual(await jobs(db),original);
}finally{await db.close();}}});

test('bounded waits are ordered in one 3-second statement; original dispatcher completes a genuinely published building cohort',async()=>{const h=await setup(),{db,targets,cohort}=h;try{
const day=await scalar(db,"select ((clock_timestamp()at time zone'Asia/Kolkata')::date-1)::text");const c=await cohort(day,12);await db.query("update private.provider_snapshot_cohorts set status='building'where id=$1",[c.id]);
const token=await scalar(db,'select private.provider_snapshot_dependency_token($1)',[targets[0]]),definitions=await scalar(db,"select jsonb_object_agg(proname,pg_get_functiondef(oid))from pg_proc where oid in('private.provider_snapshot_dispatch(timestamptz,integer)'::regprocedure,'private.provider_snapshot_complete(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure)");
assert(after.indexOf('provider_snapshot_dispatch_v1')<after.indexOf('provider_snapshot_claim_v1'));assert.equal((after.match(/WITH dispatch_lock AS MATERIALIZED/g)||[]).length,1);
const inspected=after.replace('COMMIT;',`SELECT count(*) AS locks FROM pg_locks WHERE locktype='advisory'AND pid=pg_backend_pid(); SELECT current_setting('statement_timeout') AS timeout,current_setting('lock_timeout') AS locktimeout;COMMIT;`);const results=await db.exec(inspected);assert.equal(results.at(-3).rows[0].locks,2);assert.deepEqual(results.at(-2).rows[0],{timeout:'3s',locktimeout:'500ms'});
assert.equal(await scalar(db,'select status from private.provider_snapshot_cohorts where id=$1',[c.id]),'ready');assert.equal(await scalar(db,'select count(*)from private.provider_snapshot_heads where job_id=any($1::uuid[])',[c.jobs]),10);assert.equal(await scalar(db,'select private.provider_snapshot_dependency_token($1)',[targets[0]]),token);assert.deepEqual(await scalar(db,"select jsonb_object_agg(proname,pg_get_functiondef(oid))from pg_proc where oid in('private.provider_snapshot_dispatch(timestamptz,integer)'::regprocedure,'private.provider_snapshot_complete(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure)"),definitions);
assert.equal(await scalar(db,"select count(*)from pg_locks where locktype='advisory'and pid=pg_backend_pid()"),0);
}finally{await db.close();}});

test('failure after acquiring dispatch lock rolls back and releases it; no dispatcher call or retry/reset is introduced',async()=>{const{db}=await setup();try{
await db.exec("create function private.test_lock_timeout()returns void language plpgsql as $$begin raise exception using errcode='55P03',message='injected lock timeout';end$$");
const count=await scalar(db,'select count(*)from private.provider_snapshot_cohorts');const failed=after.replace("pg_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))","private.test_lock_timeout()");await rejects(db,failed,e=>e.code==='55P03');assert.equal(await scalar(db,'select count(*)from private.provider_snapshot_cohorts'),count);assert.equal(await scalar(db,"select count(*)from pg_locks where locktype='advisory'and pid=pg_backend_pid()"),0);
assert.doesNotMatch(after,/provider_snapshot_requeue|attempts|set active|pg_sleep|shadow_worker/);
}finally{await db.close();}});
