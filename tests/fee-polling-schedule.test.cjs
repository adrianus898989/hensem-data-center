// Real PostgreSQL schedule guard behavior. Cron command fixtures are synthetic;
// only their two frozen command digests and the publisher digest are substituted.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const source=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261002094627_rates_two_minute_staggered_polling.sql'),'utf8');
const md5=s=>crypto.createHash('md5').update(s).digest('hex');
const command=(fn,action)=>`select net.http_post(url := 'https://gmfyfzsxpxmaqtuuwgxb.supabase.co/functions/v1/${fn}', body := '{"action":"${action}"}'::jsonb)`;
const commands=[command('bright-responder','sync-rates'),command('sync-original-rate-sheet','sync')];
let db,patch;
before(async()=>{db=new PGlite();await db.exec(`create schema cron;create schema private;
 create table cron.job(jobid bigint primary key,jobname text,schedule text,command text,database text,username text,active boolean,nodename text default 'localhost',nodeport integer default 5432);
 create function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null) returns void language sql as $$update cron.job j set schedule=coalesce($2,j.schedule),command=coalesce($3,j.command),database=coalesce($4,j.database),username=coalesce($5,j.username),active=coalesce($6,j.active) where j.jobid=$1$$;
 create table private.fee_rate_generations(receipt jsonb);
 create function public.fee_rate_publish_generation(uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;`);
 const body=(await db.query("select prosrc from pg_proc where oid='public.fee_rate_publish_generation(uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb)'::regprocedure")).rows[0].prosrc;
 patch=source.replace('cc27a71748a8a23985c4739c0cbb5bf6',md5(commands[0])).replace('66cb1fcc5b9ac57adee4631ab6b7490d',md5(commands[1])).replace('1da790f7dc39d5f58d7444dc1fcff4bc',md5(body));
 for(const [i,id]of [12,24].entries())await db.query('insert into cron.job(jobid,jobname,schedule,command,database,username,active) values($1,$2,$3,$4,\'postgres\',\'postgres\',true)',[id,i?'third-party-original-rates-auto':'third-party-rates-auto',i?'48 * * * *':'45 * * * *',commands[i]]);
 await db.query("insert into cron.job(jobid,jobname,schedule,command,database,username,active) values(88,'unrelated','0 * * * *','select 1','postgres','postgres',true)");
 await db.exec(`insert into private.fee_rate_generations values('{"ok":true}')`);
});
after(()=>db?.close());
const rows=async()=>(await db.query('select * from cron.job order by jobid')).rows;
const body=()=>patch.match(/do \$rate_polling\$[\s\S]*?end \$rate_polling\$;/)[0];
async function rollback(fn){await db.exec('begin');try{await fn()}finally{await db.exec('rollback')}}
test('only two schedules change; exact job metadata, commands and unrelated jobs remain intact',async()=>rollback(async()=>{
 const before=await rows();await db.exec(body());const after=await rows();assert.equal(after[0].schedule,'*/2 * * * *');assert.equal(after[1].schedule,'1-59/2 * * * *');assert.deepEqual(after[2],before[2]);
 assert.deepEqual(after.map(({schedule,...x})=>x),before.map(({schedule,...x})=>x));
}));
test('changed command, destination, action, schedule, owner or active flag fail before either schedule changes',async()=>rollback(async()=>{
 for(const change of ["update cron.job set command=command||';select 2' where jobid=24","update cron.job set schedule='0 * * * *' where jobid=24","update cron.job set active=false where jobid=24","update cron.job set username='other' where jobid=24","delete from cron.job where jobid=24"]){
  await db.exec('savepoint invalidjob');await db.exec(change);const before=await rows();await db.exec('savepoint attempt');await assert.rejects(db.exec(body()),/rates_polling_job_drift/);await db.exec('rollback to attempt');assert.deepEqual(await rows(),before);await db.exec('rollback to invalidjob');
 }
}));
test('publisher drift and absence of a successful generation block faster polling',async()=>rollback(async()=>{
 await db.exec('delete from private.fee_rate_generations;savepoint no_success');await assert.rejects(db.exec(body()),/requires_successful_publication/);await db.exec('rollback to no_success');
 await db.exec(`insert into private.fee_rate_generations values('{"ok":true}');create or replace function public.fee_rate_publish_generation(uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb) returns jsonb language sql as $$select '{"drift":true}'::jsonb$$;savepoint publisher_changed`);
 await assert.rejects(db.exec(body()),/rates_polling_publisher_drift/);await db.exec('rollback to publisher_changed');
}));
test('unexpected alter_job side effects roll back both schedules and altered metadata',async()=>rollback(async()=>{
 await db.exec(`create or replace function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null) returns void language sql as $$update cron.job j set schedule=$2,active=false where j.jobid=$1$$;savepoint before_apply`);
 const before=await rows();await assert.rejects(db.exec(body()),/metadata_changed/);await db.exec('rollback to before_apply');assert.deepEqual(await rows(),before);
}));
