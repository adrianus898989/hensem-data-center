const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/operations/log-cleanup.sql'),'utf8');
test('PK-bounded scan advances through young/unrelated rows, wraps, and expires only owned terminal logs',async()=>{const db=new PGlite();try{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema private;create schema cron;create table cron.job(jobid bigint primary key,jobname text,username text,database text);create table cron.job_run_details(runid bigint primary key,jobid bigint,username text,database text,status text,end_time timestamptz);insert into cron.job values(33,'provider-snapshot-worker-v1',current_user,current_database()),(99,'unrelated',current_user,current_database());");
 await db.exec(sql);await db.exec("set statement_timeout='3s';insert into cron.job_run_details select i,case when i=5 then 99 else 33 end,current_user,current_database(),case when i=6 then 'running'when i in(7,8)then'failed'else'succeeded'end,clock_timestamp()-case when i in(1,2,3)then interval'1hour'when i=7 then interval'8days'else interval'2days'end from generate_series(1,9)i;");
 const call=async()=> (await db.query('select private.provider_snapshot_cleanup_logs(3)x')).rows[0].x;
 assert.deepEqual(await call(),{status:'cleaned',scanned:3,deleted:0,wrapped:false});assert.equal((await call()).deleted,1);assert.equal((await call()).deleted,2);assert.equal((await call()).wrapped,true);
 assert.deepEqual((await db.query('select runid from cron.job_run_details order by runid')).rows.map(x=>x.runid),[1,2,3,5,6,8]);
 await db.exec("update cron.job_run_details set end_time=clock_timestamp()-interval'2days'where runid in(1,2,3)");assert.equal((await call()).deleted,3);
 for(const role of['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(db.query('select private.provider_snapshot_cleanup_logs(3)'),e=>e.code==='42501');await db.exec('reset role');}
 }finally{await db.close();}});
test('activation isolates log pruning from retention and storage archival; old full-scan command is replaced',()=>{
 const activation=fs.readFileSync(path.join(__dirname,'../supabase/operations/activate-maintenance.sql'),'utf8');
 assert.match(activation,/cron\.alter_job\(j\.jobid,command:=\$maintain\$begin;.*provider_snapshot_gc_versions\(100\);commit;\$maintain\$/);
 assert.doesNotMatch(activation,/select private\.provider_snapshot_maintain\(/);
 assert.doesNotMatch(activation.match(/\$maintain\$([\s\S]*?)\$maintain\$/)[1],/cleanup|job_run_details/);
 assert.match(activation,/cron\.schedule\('provider-snapshot-log-cleanup-v1'/);
 assert.match(sql,/runid>cursor_id order by runid limit p_scan/);
});
