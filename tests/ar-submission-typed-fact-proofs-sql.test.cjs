// Real PostgreSQL logic with synthetic source rows and the actual stage1
// generation. No production access, sessions, personal rows or live probes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./fixtures/ar-91club-submission-projection-harness.cjs');
const read = name => fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8');
const install = read('20261012063352_ar_submission_typed_fact_install.sql');
const proofs = read('20261012063953_ar_submission_typed_fact_proofs.sql');
const sigs = ['begin_ar_submission_fact_day(text,text,date)','verify_ar_submission_fact_hour(text,text,date,integer)','approve_ar_submission_fact_day(text,text,date)','approve_ar_submission_fact_null(text,text)','approve_ar_submission_fact_future(text,text)'];
async function setup(){const db=await h.fixture();await db.exec(h.local(h.stage1()));await db.exec(h.stage2());await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/ar-submission-typed-fact-production.sql'),'utf8'));await db.exec(install);return db;}
async function run(fn){const db=await setup();try{await fn(db);}finally{await db.exec('rollback;reset role').catch(()=>{});await db.close();}}
const gen=async db=>(await db.query("select private.ar_submission_fact_generation('IN','OKWIN')g")).rows[0].g;
const oldGen=async db=>(await db.query('select private.ar_91club_submission_generation()g')).rows[0].g;
const can=async db=>(await db.query("select private.ar_submission_fact_can_read('IN','OKWIN','2026-10-10','2026-10-12')b")).rows[0].b;
const functions=async db=>(await db.query("select p.oid,md5(p.prosrc)hash,to_jsonb(p)metadata from pg_proc p where p.oid=any($1::regprocedure[])order by p.oid",[sigs.map(x=>'private.'+x)])).rows;
const main=async db=>(await db.query("select to_jsonb(p)m from pg_proc p where p.oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure")).rows[0].m;
async function day(db,date){await db.query("select private.begin_ar_submission_fact_day('IN','OKWIN',$1)",[date]);for(let hour=0;hour<24;hour++)await db.query("select private.verify_ar_submission_fact_hour('IN','OKWIN',$1,$2)",[date,hour]);return(await db.query("select private.approve_ar_submission_fact_day('IN','OKWIN',$1)result",[date])).rows[0].result;}
async function prove(db){await db.exec("begin isolation level repeatable read;set local statement_timeout='3s';set local lock_timeout='1s'");await day(db,'2026-10-10');await db.query("select private.approve_ar_submission_fact_null('IN','OKWIN')");await db.query("select private.approve_ar_submission_fact_future('IN','OKWIN')");await db.exec('commit');}
async function row(db,id,patch={}){await h.row(db,id,{platform:'OKWIN',...patch});}

test('install/replay preserve real stage1 generation, existing91 readiness, reader metadata and all source/fact rows',()=>run(async db=>{
  await h.row(db,'SYNTHETIC-91');await db.exec("begin isolation level repeatable read;select private.approve_ar_91club_submission_day('2026-10-10');select private.approve_ar_91club_submission_null();select private.approve_ar_91club_submission_future();commit");
  await row(db,'SYNTHETIC-OKWIN');const g=await gen(db),g91=await oldGen(db),m=await main(db);
  const prior=(await db.query('select to_jsonb(r)x from private.ar_91club_submission_ready r order by data_date')).rows;
  const facts=(await db.query('select to_jsonb(f)x from private.ar_submission_typed_facts f')).rows;
  await db.exec(proofs);assert.equal(await gen(db),g);assert.equal(await oldGen(db),g91);assert.deepEqual(await main(db),m);
  assert.deepEqual((await db.query('select to_jsonb(f)x from private.ar_submission_typed_facts f')).rows,facts);
  assert.deepEqual((await db.query('select to_jsonb(r)x from private.ar_91club_submission_ready r order by data_date')).rows,prior);
  assert.equal((await db.query('select count(*)n from private.ar_submission_day_ready')).rows[0].n,0);
  const installed=await functions(db);assert.equal(installed.length,5);await db.exec(proofs);assert.deepEqual(await functions(db),installed);assert.equal(await gen(db),g);
}));

test('real stage1 source sync supports24-hour/native NULL/future proof, keeps valid source changes and withdraws direct-maintenance proofs',()=>run(async db=>{
  await db.exec(proofs);assert.equal(await can(db),false);
  for(let hour=0;hour<24;hour++)await row(db,'H'+hour,{applied_at:`2026-10-10 ${String(hour).padStart(2,'0')}:00:00`});
  await row(db,'PAID-OLD',{applied_at:'2026-10-09',completed_at:'2026-10-10 23:59:59.999999',status:'已支付'});
  await row(db,'PAID-NULL',{applied_at:null,completed_at:'2026-10-10 07:00:00',status:'已支付'});
  await row(db,'OVERLAP',{applied_at:'2026-10-10 03:59:59.999999',completed_at:'2026-10-10 21:00:00',status:'已支付'});
  await row(db,'NEXT-EDGE',{applied_at:'2026-10-11'});
  await row(db,'UNKNOWN-NULL',{applied_at:null,status:'unknown',member_id:null});
  await row(db,'FOREIGN',{platform:'OK.WIN',applied_at:null});const g=await gen(db);
  await db.exec("begin isolation level repeatable read;set local statement_timeout='3s';set local lock_timeout='1s'");const r=await day(db,'2026-10-10');assert.equal(r.sourceCount,27);await db.exec('commit');
  await db.exec("begin isolation level repeatable read;set local statement_timeout='3s';set local lock_timeout='1s'");await day(db,'2026-10-11');await db.query("select private.approve_ar_submission_fact_null('IN','OKWIN')");await db.query("select private.approve_ar_submission_fact_future('IN','OKWIN')");await db.exec('commit');
  assert.equal(await can(db),true);assert.equal(await gen(db),g);assert.equal((await db.query('select source_count::text n from private.ar_submission_null_ready')).rows[0].n,'2');
  await db.exec("set role service_role;update public.ar_collected_orders set amount_local='1.00',observed_at=clock_timestamp()where order_no='H0';update public.ar_collected_orders set status='待支付'where order_no='PAID-OLD';delete from public.ar_collected_orders where order_no='H1';reset role");
  assert.equal(await can(db),true);assert.equal(await gen(db),g);assert.equal((await db.query("select amount_local::text n from private.ar_submission_typed_facts where order_no='H0'")).rows[0].n,'1.00');
  assert.equal((await db.query("select count(*)n from private.ar_submission_typed_facts where order_no in('PAID-OLD','H1')")).rows[0].n,0);
  await db.exec("update private.ar_submission_typed_facts set amount_local=2 where order_no='H0'");assert.equal(await can(db),false);assert.notEqual(await gen(db),g);
  assert.equal((await db.query('select count(*)n from private.ar_submission_day_ready')).rows[0].n,0);
}));

test('real mirror mismatch, incomplete hours and epoch changes never approve; numeric scale is compared as text',()=>run(async db=>{
  await db.exec(proofs);await row(db,'ONE',{amount_local:'1.0'});
  await db.exec("begin isolation level repeatable read;update private.ar_submission_typed_facts set amount_local='1.00'where order_no='ONE'");
  await db.query("select private.begin_ar_submission_fact_day('IN','OKWIN','2026-10-10')");await assert.rejects(()=>db.query("select private.verify_ar_submission_fact_hour('IN','OKWIN','2026-10-10',10)"),/parity_failed/);await db.exec('rollback');
  await db.exec('begin isolation level repeatable read');await db.query("select private.begin_ar_submission_fact_day('IN','OKWIN','2026-10-10')");
  for(let hour=0;hour<23;hour++)await db.query("select private.verify_ar_submission_fact_hour('IN','OKWIN','2026-10-10',$1)",[hour]);
  await assert.rejects(()=>db.query("select private.approve_ar_submission_fact_day('IN','OKWIN','2026-10-10')"),/parts_incomplete/);await db.exec('rollback');
  await db.exec('begin isolation level repeatable read');await db.query("select private.begin_ar_submission_fact_day('IN','OKWIN','2026-10-10')");
  for(let hour=0;hour<24;hour++)await db.query("select private.verify_ar_submission_fact_hour('IN','OKWIN','2026-10-10',$1)",[hour]);
  await db.exec("update private.ar_submission_typed_facts set amount_local=3 where order_no='ONE'");await assert.rejects(()=>db.query("select private.approve_ar_submission_fact_day('IN','OKWIN','2026-10-10')"),/generation_metadata_changed/);await db.exec('rollback');
  assert.equal((await db.query('select count(*)n from private.ar_submission_day_ready')).rows[0].n,0);assert.equal(await can(db),false);
}));

test('metadata/body/permission drift and partial installs fail closed; maintenance entrypoints are owner-only RR and3s installation stays bounded',()=>run(async db=>{
  const changes=["alter function private.ar_submission_fact_generation(text,text)strict","alter function private.sync_ar_submission_typed_fact()security invoker","grant execute on function private.ar_submission_fact_scope(text,text)to service_role","create table child()inherits(public.ar_collected_orders)"];
  for(const change of changes){await db.exec('begin');await db.exec(change);await assert.rejects(()=>db.exec(proofs),/PREREQUISITE/);await db.exec('rollback');assert.equal((await db.query("select to_regprocedure('private.begin_ar_submission_fact_day(text,text,date)')x")).rows[0].x,null);}
  await db.exec("begin;create function private.begin_ar_submission_fact_day(text,text,text)returns jsonb language sql as $$select '{}'::jsonb$$");await assert.rejects(()=>db.exec(proofs),/OVERLOAD_COLLISION/);await db.exec('rollback');
  await db.exec(proofs);const installed=await functions(db);
  for(const change of ["alter function private.verify_ar_submission_fact_hour(text,text,date,integer)strict","alter function private.approve_ar_submission_fact_day(text,text,date)security definer","alter function private.approve_ar_submission_fact_null(text,text)cost 101","grant execute on function private.approve_ar_submission_fact_future(text,text)to authenticated"]){await db.exec('begin');await db.exec(change);await assert.rejects(()=>db.exec(proofs),/FUNCTION_DRIFT/);await db.exec('rollback');assert.deepEqual(await functions(db),installed);}
  await db.exec('begin;drop function private.verify_ar_submission_fact_hour(text,text,date,integer)');await assert.rejects(()=>db.exec(proofs),/PARTIAL_INSTALL/);await db.exec('rollback');
  await db.exec("begin;create function private.begin_ar_submission_fact_day(text,text,text)returns jsonb language sql as $$select '{}'::jsonb$$");await assert.rejects(()=>db.exec(proofs),/OVERLOAD_COLLISION/);await db.exec('rollback');
  await db.exec('begin');await assert.rejects(()=>db.query("select private.begin_ar_submission_fact_day('IN','OKWIN','2026-10-10')"),/actor_snapshot_invalid/);await db.exec('rollback');
  for(const role of ['anon','authenticated','service_role']){await db.exec(`begin isolation level repeatable read;set local role ${role}`);await assert.rejects(()=>db.query("select private.approve_ar_submission_fact_null('IN','OKWIN')"),/permission denied|actor_snapshot_invalid/);await db.exec('rollback');}
  assert.match(proofs,/statement_timeout='3s'/);assert.match(proofs,/lock_timeout='1s'/);assert.doesNotMatch(proofs,/statement_timeout='(?:[4-9]|\d\d)/);assert.deepEqual(await functions(db),installed);
}));
