// Synthetic queue behavior; actual financial common/provider dependency values are guarded by the maintenance transaction.
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const {setup:sourceSetup}=require('./fixtures/withdraw-reasons-query-harness.cjs');
const files={
 'original':'tests/fixtures/withdraw-prepared-claim.original.sql',
 'install':'supabase/maintenance/withdraw-reason-interactive-priority.sql',
 'rollback':'supabase/maintenance/withdraw-reason-interactive-priority.rollback.sql'
};
const read=f=>fs.readFileSync(path.join(root,files[f]),'utf8');
async function setup(){const db=await sourceSetup();try{
 // Reuse the existing synthetic source fixture and the actual existing queue
 // schema. No production receipt, directory, account, payload or session.
 await db.exec('set check_function_bodies=off');
 await db.exec(fs.readFileSync(path.join(root,'supabase/operations/withdraw-prepared/store.sql'),'utf8'));
 await db.exec(`create table private.provider_snapshot_jobs(status text,lease_until timestamptz);
  create table private.prepared_aggregate_jobs(status text,lease_until timestamptz);
  create function private.prepared_aggregate_native_catalog()returns setof public.synthetic_catalog language sql stable as $$select *from public.synthetic_catalog$$;
  create function private.withdraw_prepared_source_contract_current()returns boolean language sql stable as $$select true$$;
  create function private.prepared_aggregate_take_turn(text)returns boolean language sql volatile as $$select true$$;
  create function private.prepared_aggregate_dependency_common(text)returns text language sql stable as $$select 'synthetic-common'::text$$;
  create function private.provider_snapshot_dependency_token(jsonb)returns text language sql stable as $$select 'synthetic-provider'::text$$;`);
 await db.exec(read('original'));
 await db.exec('revoke all on function private.withdraw_prepared_claim()from public,anon,authenticated,service_role;reset check_function_bodies');
 return db;
}catch(error){await db.close();throw error}}

async function clear(db){await db.exec('truncate private.withdraw_prepared_jobs cascade;truncate private.provider_snapshot_jobs;truncate private.prepared_aggregate_jobs');}
async function job(db,name,{kind='original-auto',human,notBefore='1hour',created='1hour',status='queued',attempts=0}={}){
 const scope=human===undefined?{}:{humanRequestedAt:human};
 return(await db.query("insert into private.withdraw_prepared_jobs(request_key,request,scope,catalog,dependency,status,attempts,not_before,created_at)values(jsonb_build_array($1::text,$2::text),'{}',$3,'[]','synthetic',$4,$5,statement_timestamp()-$6::interval,statement_timestamp()-$7::interval)returning id",[kind,name,scope,status,attempts,notBefore,created])).rows[0].id;
}
async function stamp(db,delta){return(await db.query("select to_jsonb(statement_timestamp()+$1::interval)#>>'{}' t",[delta])).rows[0].t;}
async function claim(db){return(await db.query('select private.withdraw_prepared_claim()c')).rows[0].c;}
const reason='withdraw-reasons-blocking-v1';
test('one ORDER-only inverse; original eligibility, lease, source guard and fairness code is byte preserved',()=>{
 const old=read('original'),next=read('install').match(/CREATE OR REPLACE FUNCTION private\.withdraw_prepared_claim\(\)[\s\S]*?END;\$function\$/)[0]+'\n',start='ORDER BY not_before,created_at FOR UPDATE SKIP LOCKED LIMIT 1';
 assert.equal(crypto.createHash('md5').update(old).digest('hex'),'663b251082638a7ffe4156643ee3e433');
 const order=next.slice(next.indexOf('ORDER BY CASE WHEN request_key'),next.indexOf('FOR UPDATE SKIP LOCKED LIMIT 1')+'FOR UPDATE SKIP LOCKED LIMIT 1'.length);
 assert.equal(next.replace(order,start),old);assert.equal((old.match(/ORDER BY not_before,created_at/g)||[]).length,1);
});
test('full guarded install, human FIFO, invalid timestamps, existing gates/lease and exact guarded rollback',async()=>{
 const db=await setup();try{
  await db.exec("create table public.synthetic_turn_calls(n int);insert into public.synthetic_turn_calls values(0);create or replace function private.prepared_aggregate_take_turn(text)returns boolean language plpgsql volatile as $$begin update public.synthetic_turn_calls set n=n+1;return coalesce(current_setting('test.deny_turn',true),'')<>'yes';end$$");
  const metadata=(await db.query("select to_jsonb(p)-'prosrc'm from pg_proc p where oid='private.withdraw_prepared_claim()'::regprocedure")).rows[0].m;
  await db.exec(read('install'));
  assert.deepEqual((await db.query("select to_jsonb(p)-'prosrc'm from pg_proc p where oid='private.withdraw_prepared_claim()'::regprocedure")).rows[0].m,metadata);
  await job(db,'old-background');const h=await job(db,'recent-human',{kind:reason,human:await stamp(db,'-20seconds'),notBefore:'1second',created:'2seconds'});
  let c=await claim(db);assert.equal(c.jobId,h);
  let lease=(await db.query("select status,fence,attempts,lease_until>statement_timestamp()+interval'110seconds'valid_lease,claim_pid=pg_backend_pid()pid,claim_backend_start=(select backend_start from pg_stat_activity where pid=pg_backend_pid())started from private.withdraw_prepared_jobs where id=$1",[h])).rows[0];
  assert.deepEqual(lease,{status:'running',fence:1,attempts:1,valid_lease:true,pid:true,started:true});
  assert.equal((await db.query('select n from public.synthetic_turn_calls')).rows[0].n,1);
  // Original FIFO (not human timestamp order) remains the tie ordering.
  await clear(db);const one=await job(db,'human-first',{kind:reason,human:await stamp(db,'-80seconds'),notBefore:'30seconds',created:'1minute'});await job(db,'human-second',{kind:reason,human:await stamp(db,'-10seconds'),notBefore:'10seconds',created:'2minutes'});assert.equal((await claim(db)).jobId,one);
  // JSON nonstrings, malformed dates, relative values, stale and future values
  // are ordinary FIFO work, never parser errors or interactive priority.
  for(const human of [null,1,{},[],false,'bad','now','infinity','2026-02-31T12:00:00Z',await stamp(db,'-3minutes'),await stamp(db,'1minute')]){
   await clear(db);const old=await job(db,'background');await job(db,'bad-human',{kind:reason,human,notBefore:'1second',created:'2seconds'});assert.equal((await claim(db)).jobId,old,JSON.stringify(human));
  }
  await clear(db);const auto=await job(db,'auto');await job(db,'auto-with-human-field',{human:await stamp(db,'-10seconds'),notBefore:'1second',created:'2seconds'});assert.equal((await claim(db)).jobId,auto);
  await clear(db);const eligible=await job(db,'eligible');for(const x of[{status:'ready'},{attempts:3},{notBefore:'-1minute'}])await job(db,'ineligible-'+JSON.stringify(x),{kind:reason,human:await stamp(db,'-10seconds'),...x});assert.equal((await claim(db)).jobId,eligible);
  // Existing family turn can still deny, and a running source lease blocks.
  await clear(db);await job(db,'human',{kind:reason,human:await stamp(db,'-10seconds')});await db.exec("select set_config('test.deny_turn','yes',false)");assert.equal(await claim(db),null);assert.equal((await db.query("select status from private.withdraw_prepared_jobs")).rows[0].status,'queued');await db.exec("select set_config('test.deny_turn','',false);insert into private.provider_snapshot_jobs values('running',clock_timestamp()+interval'1minute')");assert.equal(await claim(db),null);
  await clear(db);await job(db,'source-invalid',{kind:reason,human:await stamp(db,'-10seconds')});await db.exec('create or replace function private.withdraw_prepared_source_contract_current()returns boolean language sql stable as $$select false$$');assert.equal(await claim(db),null);assert.deepEqual((await db.query('select status,attempts,last_error from private.withdraw_prepared_jobs')).rows[0],{status:'failed',attempts:3,last_error:'source_contract_changed'});
  await clear(db);await db.exec('create or replace function private.withdraw_prepared_source_contract_current()returns boolean language sql stable as $$select true$$');
  // Full metadata drift refuses the rollback; no ACL weakening is tolerated.
  await db.exec('grant execute on function private.withdraw_prepared_claim()to authenticated');await assert.rejects(db.exec(read('rollback')),/withdraw_claim_priority_function_drift/);await db.exec('rollback;revoke all on function private.withdraw_prepared_claim()from authenticated');
  await db.exec(read('rollback'));
  assert.equal((await db.query("select md5(prosrc)m from pg_proc where oid='private.withdraw_prepared_claim()'::regprocedure")).rows[0].m,'a6bdc64a4137efd9dc613687fd17c310');
  const old=await job(db,'old');await job(db,'human',{kind:reason,human:await stamp(db,'-10seconds'),notBefore:'1second'});assert.equal((await claim(db)).jobId,old);
 }finally{await db.close();}
});
