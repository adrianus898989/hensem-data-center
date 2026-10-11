const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const {fixture,local,here,row,stage1,stage2}=require('./fixtures/ar-91club-submission-projection-harness.cjs');
const read=f=>f==='stage1-install-draft.sql'?stage1():stage2();
async function fixture2(){const db=await fixture();await db.exec(local(read('stage1-install-draft.sql')));await db.exec(read('stage2-controls-guarded-draft.sql'));return db;}
async function run(fn){const db=await fixture2();try{await fn(db)}finally{await db.exec('rollback;reset role').catch(()=>{});await db.close()}}
const generation=async db=>(await db.query('select private.ar_91club_submission_generation() g')).rows[0].g;
async function approve(db,day='2026-10-10'){await db.exec('begin isolation level repeatable read');try{await db.query('select private.approve_ar_91club_submission_day($1::date)',[day]);await db.query('select private.approve_ar_91club_submission_null()');await db.query('select private.approve_ar_91club_submission_future()');await db.exec('commit')}catch(e){await db.exec('rollback');throw e}}
const approvalCount=async db=>(await db.query('select(select count(*)from private.ar_91club_submission_ready)+(select count(*)from private.ar_91club_submission_null_ready)+(select count(*)from private.ar_91club_submission_future_ready) n')).rows[0].n;

test('source-maintained dual time ranges, prior paid rows, historic NULL and verified empty day approve independently',()=>run(async db=>{
 assert.equal(typeof await generation(db),'string');await row(db,'SYNTHETIC-COHORT');await row(db,'SYNTHETIC-OLD-PAID',{applied_at:'2020-01-01',status:'已支付',completed_at:'2026-10-10'});await row(db,'SYNTHETIC-OLD-NULL',{applied_at:null,status:null});await approve(db);assert.equal(await approvalCount(db),3);
 const counts=await db.query('select source_count n from private.ar_91club_submission_ready union all select source_count from private.ar_91club_submission_null_ready');assert.deepEqual(counts.rows.map(x=>Number(x.n)),[2,1]);await approve(db,'2026-10-11');assert.equal(await approvalCount(db),4);
}));
test('missing complete-success-only or ALL-history NULL facts cannot approve; money-scale discrepancy fails',()=>run(async db=>{
 await row(db,'SYNTHETIC-P',{applied_at:'2020-01-01',status:'已支付',completed_at:'2026-10-10',amount_local:'1.0'});await row(db,'SYNTHETIC-N',{applied_at:null});
 await db.exec("delete from private.ar_91club_submission_facts where order_no='SYNTHETIC-P'");await assert.rejects(()=>approve(db),/parity_failed/);
 assert.equal((await db.query("select private.backfill_ar_91club_submission('success','2026-10-10',10) n")).rows[0].n,1);
 await db.exec("delete from private.ar_91club_submission_facts where order_no='SYNTHETIC-N'");await assert.rejects(()=>approve(db),/parity_failed/);await db.query("select private.backfill_ar_91club_submission('nulltime',null,10)");await approve(db);
 await db.exec("update private.ar_91club_submission_facts set amount_local='1.00' where order_no='SYNTHETIC-P'");assert.equal(await approvalCount(db),0);await assert.rejects(()=>approve(db),/parity_failed/);
}));
test('source updates preserve inductive proofs; direct private writes/TRUNCATE invalidate once per statement',()=>run(async db=>{
 await row(db,'SYNTHETIC-C');await row(db,'SYNTHETIC-N',{applied_at:null});await approve(db);const g=await generation(db);
 await db.exec("update ar_collected_orders set amount_local='123.45678901',observed_at='2026-10-11T14:00:00Z' where order_no='SYNTHETIC-C'");assert.equal(await generation(db),g);assert.equal(await approvalCount(db),3);
 await db.exec("update ar_collected_orders set status='已支付',applied_at='2020-01-01',completed_at='2026-10-11' where order_no='SYNTHETIC-C'");assert.equal(await approvalCount(db),3);await db.exec("delete from ar_collected_orders where order_no='SYNTHETIC-N'");assert.equal(await approvalCount(db),3);
 await db.exec('update private.ar_91club_submission_facts set amount_local=amount_local');assert.notEqual(await generation(db),g);assert.equal(await approvalCount(db),0);await approve(db);await db.exec('truncate private.ar_91club_submission_facts');assert.equal(await approvalCount(db),0);
}));
test('bounded native source-locked three pools fill only missing rows, not full scan or zero-as-readiness',()=>run(async db=>{
 // Native rows predating installation are represented by dropping the local
 // source trigger while seeding, then replaying the exact approved trigger.
 await db.exec('alter table ar_collected_orders disable trigger ar91_submission_fact_sync_insert');await row(db,'SYNTHETIC-C');await row(db,'SYNTHETIC-S',{applied_at:'2020-01-01',status:'已支付',completed_at:'2026-10-10'});await row(db,'SYNTHETIC-N',{applied_at:null});await db.exec('alter table ar_collected_orders enable trigger ar91_submission_fact_sync_insert');
 for(const [pool,day]of [['cohort','2026-10-10'],['success','2026-10-10'],['nulltime',null]]){assert.equal((await db.query('select private.backfill_ar_91club_submission($1,$2::date,1) n',[pool,day])).rows[0].n,1);assert.equal(await approvalCount(db),0);assert.equal((await db.query('select private.backfill_ar_91club_submission($1,$2::date,1) n',[pool,day])).rows[0].n,0);}
 await approve(db);for(const args of [[null,'2026-10-10',1],['BAD','2026-10-10',1],['cohort','2026-10-09',1],['cohort',null,1],['cohort','2026-10-10',3001]])await assert.rejects(()=>db.query('select private.backfill_ar_91club_submission($1,$2::date,$3) n',args),/bounds_invalid/);
 for(const [stream,day]of [['cohort','2026-10-10'],['cohort','2026-10-11'],['success','2026-10-10'],['success','2026-10-11'],['nulltime',null]])await db.query('select private.backfill_ar_91club_submission($1,$2::date,3000)',[stream,day]);assert.equal(await approvalCount(db),3,'zero-row maintenance does not revoke truthful proof');
}));
test('disabled/changed source maintenance or private control trigger and schema makes generation unavailable',()=>run(async db=>{
 for(const sql of ['alter table ar_collected_orders disable trigger ar91_submission_fact_sync_update','alter table private.ar_91club_submission_facts disable trigger ar91_submission_ready_update','alter table ar_collected_orders alter member_level type bigint','grant select on private.ar_91club_submission_ready to authenticated','alter table private.ar_91club_submission_ready drop constraint ar_91club_submission_ready_generation_check','alter table private.ar_91club_submission_facts alter member_id set default \'spoof\'']){await db.exec('begin;'+sql);assert.equal(await generation(db),null);await db.exec('rollback');}
}));
test('approval requires RR; service/auth/anon cannot approve/backfill or read readiness',()=>run(async db=>{
 await assert.rejects(()=>db.query("select private.approve_ar_91club_submission_day('2026-10-10')"),/requires_repeatable_read/);
 for(const role of ['service_role','authenticated','anon']){await db.exec('set role '+role);for(const q of ['select * from private.ar_91club_submission_ready','select private.approve_ar_91club_submission_null()',"select private.backfill_ar_91club_submission('nulltime',null,1)"])await assert.rejects(()=>db.query(q),/permission denied/);await db.exec('reset role');}
}));

test('guarded install replay preserves function epochs, approvals and native reader; metadata drift fails before replacement',()=>run(async db=>{
 await row(db,'SYNTHETIC-REPLAY');await approve(db);const g=await generation(db),n=await approvalCount(db);await db.exec(read('stage2-controls-guarded-draft.sql'));assert.equal(await generation(db),g);assert.equal(await approvalCount(db),n);
 for(const change of ["alter function private.approve_ar_91club_submission_null() security definer","grant execute on function private.ar_91club_submission_can_read(date,date)to authenticated","alter function private.backfill_ar_91club_submission(text,date,integer) set search_path=public","alter table private.ar_91club_submission_ready disable row level security"]){await db.exec('begin;'+change);await assert.rejects(()=>db.exec(read('stage2-controls-guarded-draft.sql')),/drift/);await db.exec('rollback');assert.equal(await generation(db),g);}
}));
test('can_read requires ALL day proofs AND historic NULL proof; source updates can populate previously empty future',()=>run(async db=>{
 const can=async(a,b)=>(await db.query('select private.ar_91club_submission_can_read($1::date,$2::date)b',[a,b])).rows[0].b;await row(db,'SYNTHETIC-TEN');await row(db,'SYNTHETIC-ELEVEN',{applied_at:'2026-10-11'});assert.equal(await can('2026-10-10','2026-10-11'),false);await approve(db);assert.equal(await can('2026-10-10','2026-10-11'),true);assert.equal(await can('2026-10-10','2026-10-12'),false);await approve(db,'2026-10-11');assert.equal(await can('2026-10-10','2026-10-12'),true);assert.equal(await can('2026-10-12','2026-10-13'),true);await row(db,'SYNTHETIC-FUTURE',{applied_at:'2026-10-12'});assert.equal(await can('2026-10-12','2026-10-13'),true);
 for(const args of [[null,'2026-10-11'],['2026-10-09','2026-10-10'],['infinity','infinity'],['2026-10-10','2026-10-10'],['2026-10-10','2026-12-10']])assert.equal(await can(...args),false);
 await db.exec('delete from private.ar_91club_submission_null_ready');assert.equal(await can('2026-10-10','2026-10-11'),false);
}));
