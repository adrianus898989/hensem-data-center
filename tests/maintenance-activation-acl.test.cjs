// Offline managed-ACL model: postgres can read cron.job, but only pg_cron's API
// owner can mutate it. No production queries or direct grants are performed.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const activation=fs.readFileSync(path.join(__dirname,'../supabase/operations/activate-maintenance.sql'),'utf8');
const originalCommand=`-- Only this release's jobs: successful logs 24h, failed logs 7d; at most 1000 per tick.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='3s';
SET LOCAL lock_timeout='500ms';
WITH expired AS MATERIALIZED (
 SELECT d.runid FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid
 WHERE j.jobname IN ('provider-snapshot-worker-v1','provider-snapshot-dispatch-v1','provider-snapshot-maintenance-v1')
 AND j.username=current_user AND j.database=current_database()
 AND d.username=current_user AND d.database=current_database()
 AND ((d.status='succeeded' AND d.end_time<clock_timestamp()-interval'1day')
   OR (d.status='failed' AND d.end_time<clock_timestamp()-interval'7days'))
 ORDER BY d.runid LIMIT 1000
)
DELETE FROM cron.job_run_details d USING expired e WHERE d.runid=e.runid;
COMMIT;
-- Keep log cleanup committed if derived-storage maintenance subsequently fails.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='5s';
SET LOCAL lock_timeout='500ms';
SELECT private.provider_snapshot_maintain(100);
COMMIT;`;
async function fixture(){const db=new PGlite();await db.exec(`
 create role harness_admin superuser;create role cron_owner;create role anon;
 create schema cron authorization cron_owner;create schema private;
 create table cron.job(jobid bigint primary key,jobname text unique,schedule text,command text,active boolean,username text,database text);
 alter table cron.job owner to cron_owner;
 grant usage on schema cron to postgres;grant select on cron.job to postgres;
 create function cron.alter_job(job_id bigint,command text)returns void language plpgsql security definer set search_path='' as $f$begin update cron.job set command=alter_job.command where jobid=job_id;end$f$;
 alter function cron.alter_job(bigint,text)owner to cron_owner;revoke all on function cron.alter_job(bigint,text)from public;grant execute on function cron.alter_job(bigint,text)to postgres;
 create function cron.schedule(job_name text,schedule text,command text)returns bigint language plpgsql security definer set search_path='' as $f$declare v bigint;begin select coalesce(max(jobid),0)+1 into v from cron.job;insert into cron.job values(v,job_name,schedule,command,true,'postgres',current_database());return v;end$f$;
 alter function cron.schedule(text,text,text)owner to cron_owner;revoke all on function cron.schedule(text,text,text)from public;grant execute on function cron.schedule(text,text,text)to postgres;
 create function private.provider_snapshot_cleanup_logs(integer)returns void language sql as $$select$$;
 create function private.provider_snapshot_archive_old_failures(integer)returns void language sql as $$select$$;
 create function private.provider_snapshot_archive_closed_storage(integer)returns void language sql as $$select$$;
 create function private.provider_snapshot_storage_balanced()returns boolean language sql as $$select true$$;
 `);await db.query("insert into cron.job values(35,'provider-snapshot-maintenance-v1','*/5 * * * *',$1,true,'postgres',current_database())",[originalCommand]);
 // PGlite's bootstrap role must remain SUPERUSER. Rename that test-only role,
 // then create the real managed-role shape under the expected postgres name.
 await db.exec(`set session authorization harness_admin;alter role postgres rename to bootstrap_superuser;create role postgres;
 grant usage on schema cron to postgres;grant select on cron.job to postgres;
 grant execute on function cron.alter_job(bigint,text),cron.schedule(text,text,text)to postgres;
 alter schema private owner to postgres;
 alter function private.provider_snapshot_cleanup_logs(integer)owner to postgres;
 alter function private.provider_snapshot_archive_old_failures(integer)owner to postgres;
 alter function private.provider_snapshot_archive_closed_storage(integer)owner to postgres;
 alter function private.provider_snapshot_storage_balanced()owner to postgres;
 set role postgres`);return db;}
test('SELECT-only managed cron ACL permits guarded API activation and still denies direct mutations/row locks',async()=>{const db=await fixture();try{
 assert.equal((await db.query('select current_user u')).rows[0].u,'postgres');
 assert.equal((await db.query("select rolsuper from pg_roles where rolname=current_user")).rows[0].rolsuper,false);
 assert.equal((await db.query("select md5(command)m from cron.job where jobid=35")).rows[0].m,'7013a5f440c5c815295e0fb2c03766c0');
 await assert.rejects(db.query('select * from cron.job for update'),e=>e.code==='42501');
 await assert.rejects(db.query("update cron.job set active=false"),e=>e.code==='42501');
 await db.exec(activation);const jobs=(await db.query('select * from cron.job order by jobid')).rows;
 assert.equal(jobs.length,4);assert.match(jobs[0].command,/provider_snapshot_gc_versions\(100\)/);assert.doesNotMatch(jobs[0].command,/cleanup|maintain\(/);
 assert.deepEqual(jobs.slice(1).map(j=>j.jobname),['provider-snapshot-storage-archive-v1','provider-snapshot-failure-archive-v1','provider-snapshot-log-cleanup-v1']);
 assert(jobs.every(j=>j.active&&j.username==='postgres'));
 await assert.rejects(db.query('select * from cron.job for update'),e=>e.code==='42501');
 await assert.rejects(db.exec(activation),/snapshot_maintenance_cron_drift/);await db.exec('rollback');
 assert.equal((await db.query('select count(*)n from cron.job')).rows[0].n,4);
 }finally{await db.close();}});
test('changed command or missing helper fails closed before any API mutation',async()=>{for(const variant of ['command','helper']){const db=await fixture();try{
 if(variant==='command')await db.query("select cron.alter_job(35,'changed command')");else await db.exec('drop function private.provider_snapshot_cleanup_logs(integer)');
 const before=(await db.query('select * from cron.job')).rows;
 await assert.rejects(db.exec(activation),variant==='command'?/snapshot_maintenance_cron_drift/:/snapshot_maintenance_helper_missing/);await db.exec('rollback');
 assert.deepEqual((await db.query('select * from cron.job')).rows,before);
 }finally{await db.close();}}});
test('baseline reread detects a command change during preflight and rolls the whole activation back',async()=>{const db=await fixture();try{
 await db.exec("create or replace function private.provider_snapshot_storage_balanced()returns boolean language plpgsql as $$begin perform cron.alter_job(35,'changed during preflight');return true;end$$;");
 const before=(await db.query('select * from cron.job')).rows;
 await assert.rejects(db.exec(activation),/snapshot_maintenance_cron_drift/);await db.exec('rollback');
 assert.deepEqual((await db.query('select * from cron.job')).rows,before);
 }finally{await db.close();}});
