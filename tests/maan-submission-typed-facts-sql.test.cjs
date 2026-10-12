// Real PostgreSQL synthetic source and actual migration regression.
{
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{fixture,stage}=require('./fixtures/maan-submission-projection-harness.cjs');
test('scoped objects preserve native source/withdraw hook and refuse ordinary API access',async()=>{
 const f=await fixture();try{
  assert.equal(await f.scalar('select count(*)from public.newar_detail_records'),0);assert.equal(await f.scalar('select count(*)from private.maan_submission_facts'),0);
  assert.equal(await f.scalar("select md5(prosrc)from pg_proc where oid='private.fixture_withdraw_sync()'::regprocedure"),f.before);
  await f.db.exec('set role service_role');await assert.rejects(()=>f.db.query('select *from private.maan_submission_facts'),/permission denied/);await f.db.exec('reset role');
  for(const role of['anon','authenticated']){await f.db.exec('set role '+role);await assert.rejects(()=>f.db.query('select *from public.newar_detail_records'),/permission denied/);await f.db.exec('reset role');}
  const p=await f.db.query("select proowner::regrole::text owner,prosecdef,proconfig,proacl::text from pg_proc where oid='private.sync_maan_submission_fact()'::regprocedure");assert.equal(p.rows[0].owner,'postgres');assert.equal(p.rows[0].prosecdef,true);assert.deepEqual(p.rows[0].proconfig,['search_path=""']);assert.equal(p.rows[0].proacl,'{postgres=X/postgres}');
 }finally{await f.close();}
});
test('native projected fields retain precision, duplicate IDs, empty/coalesce rules and exact raw-derived classes',async()=>{
 const f=await fixture();try{
  for(const [raw,level,count]of[[{rechargeLevel:'LV0000',memberLevel:'L2',rechargeCount:'00'},0,0],[{rechargeLevel:'',memberLevel:'L0',rechargeCount:-1},null,null],[{memberLevel:'L9999',rechargeCount:'999999999'},9999,999999999],[{memberLevel:10000,rechargeCount:'1000000000'},null,null],[{memberLevel:{x:0},rechargeCount:true},null,null]]){
   const id=await f.insert('RAW-'+Math.random(),{raw,order:'',member:' 0001 ',provider:' ',channel:'ManualRecharge'}),r=await f.fact(id);assert.equal(r.member_id,'0001');assert(r.order_id.startsWith('RAW-'));assert.equal(r.raw_provider,'人工充值');assert.equal(r.member_level,level);assert.equal(r.recharge_count,count);assert.equal(r.amount,'123.45678901');assert.equal(r.status_known,true);
  }
  for(const source of['DUP1','DUP2'])await f.insert(source,{order:'DUPLICATE'});assert.equal(await f.scalar("select count(*)from private.maan_submission_facts where order_id='DUPLICATE'"),2,'native UUID identity must never deduplicate MAAN order_number');
  const whitespace=await f.insert('WHITESPACE',{order:'  ',member:' ',provider:null});assert.equal((await f.fact(whitespace)).order_id,'  ');assert.equal((await f.fact(whitespace)).member_id,null);assert.equal((await f.fact(whitespace)).raw_provider,'未识别通道');
  for(const raw of[null,1,true,[],['L0',0]]){const row=(await f.db.query("select *from private.maan_submission_fact(jsonb_populate_record(null::public.newar_detail_records,$1::jsonb))",[JSON.stringify({id:'11111111-1111-4111-8111-111111111111',platform:'MAANWIN',dataset:'charge',source_id:'SHAPE',created_at:'2026-10-12T01:00:00+05:30',status_group:'pending',amount:'1.00000000',raw})])).rows[0];assert.equal(row.member_level,null);assert.equal(row.recharge_count,null);}
 }finally{await f.close();}
});
test('population contains full requested cohorts and cross-created paid rows, without foreign platform/direction history',async()=>{
 const f=await fixture();try{
  const old=await f.insert('OLD',{created:'2026-10-09T00:00:00+05:30'});assert.equal(await f.fact(old),undefined);
  const paid=await f.insert('OLD-PAID',{created:'2026-10-09T00:00:00+05:30',status:'success',success:'2026-10-12T02:00:00+05:30'});assert.equal((await f.fact(paid)).paid,true);
  for(const opts of[{platform:'DhaniWin'},{dataset:'withdraw'},{dataset:'workorder'}]){const id=await f.insert('FOREIGN-'+Math.random(),opts);assert.equal(await f.fact(id),undefined);}
  assert.equal(await f.scalar('select n from public.fixture_withdraw_calls'),1);
  const at=await f.insert('BOUNDARY',{created:'2026-10-10T00:00:00+05:30'});assert(await f.fact(at));const before=await f.insert('BEFORE',{created:'2026-10-09T23:59:59.999999+05:30'});assert.equal(await f.fact(before),undefined);
 }finally{await f.close();}
});
test('actual service source UPSERT, identity changes, FK cascade/delete and reverse population changes preserve correspondence',async()=>{
 const f=await fixture();try{
  await f.receipt();await f.db.exec('set role service_role');const id=await f.insert('SERVICE');await f.db.query("update public.newar_detail_records set order_number='CHANGED',member_id='100',raw='{"+'"memberLevel":"L1","rechargeCount":2'+"}'where id=$1",[id]);await f.db.exec('reset role');assert.equal((await f.fact(id)).member_level,1);
  const next='22222222-2222-4222-8222-222222222222';await f.db.exec('set role service_role');await f.db.query('update public.newar_detail_records set id=$2 where id=$1',[id,next]);await f.db.exec('reset role');assert.equal(await f.fact(id),undefined);assert.equal((await f.fact(next)).member_id,'100');
  await f.db.exec('set role service_role');await f.db.query("update public.newar_detail_records set dataset='withdraw'where id=$1",[next]);await f.db.exec('reset role');assert.equal(await f.fact(next),undefined);
  await f.db.exec('set role service_role');await f.db.query("update public.newar_detail_records set dataset='charge',created_at='2026-10-09T00:00:00+05:30',status_group='success',success_at='2026-10-12T03:00:00+05:30'where id=$1",[next]);await f.db.exec('reset role');assert(await f.fact(next));
  await f.db.exec('set role service_role');await f.db.query("update public.newar_detail_records set status_group='pending',success_at=null where id=$1",[next]);await f.db.exec('reset role');assert.equal(await f.fact(next),undefined);
  await f.db.exec('set role service_role');await f.db.query("update public.newar_detail_records set created_at='2026-10-12T01:00:00+05:30'where id=$1",[next]);await f.db.query('delete from public.newar_detail_records where id=$1',[next]);await f.db.exec('reset role');assert.equal(await f.fact(next),undefined);
  const immediate=await f.insert('IMMEDIATE');await f.db.exec('begin;set constraints all immediate;set role service_role');await f.db.query('update public.newar_detail_records set id=$2 where id=$1',[immediate,'33333333-3333-4333-8333-333333333333']);await f.db.exec('reset role;commit');assert.equal(await f.fact(immediate),undefined);assert(await f.fact('33333333-3333-4333-8333-333333333333'));
  await f.db.exec('begin;set constraints all immediate;set role service_role');await f.db.exec("update public.newar_detail_records set id='44444444-4444-4444-8444-444444444444',dataset='withdraw'where id='33333333-3333-4333-8333-333333333333'");await f.db.exec('reset role;commit');assert.equal(await f.fact('33333333-3333-4333-8333-333333333333'),undefined);assert.equal(await f.fact('44444444-4444-4444-8444-444444444444'),undefined);
  assert.equal(await f.scalar('select epoch from private.maan_submission_epoch'),0);assert.equal(await f.scalar('select count(*)from private.maan_submission_ready'),1,'normal collection must not revoke readiness');
 }finally{await f.close();}
});
test('one thousand actual source rows do not amplify observation-only fact writes',async()=>{
 const f=await fixture();try{
  await f.db.exec('set role service_role');const start=performance.now();await f.db.exec(`insert into public.newar_detail_records(platform,dataset,source_id,order_number,member_id,provider,currency,amount,status_group,created_at,raw,captured_at)
   select 'MAANWIN','charge','BATCH-'||i,'ORDER-'||i,'MEMBER-'||(i/20),'route-a','INR',i+0.12345678,'pending','2026-10-12T00:00:00+05:30'::timestamptz+i*interval'1 second',jsonb_build_object('memberLevel','LV0','rechargeCount',0),now()from generate_series(1,1000)i`);const insertMs=performance.now()-start;await f.db.exec('reset role');
  const before=(await f.db.query('select record_id,xmin::text from private.maan_submission_facts order by record_id')).rows;
  await f.db.exec('set role service_role');const observed=performance.now();await f.db.exec("update public.newar_detail_records set captured_at=now(),received_at=now(),raw=raw||'{\"captureOnly\":\"changed\"}'::jsonb");const observedMs=performance.now()-observed;await f.db.exec('reset role');
  assert.deepEqual((await f.db.query('select record_id,xmin::text from private.maan_submission_facts order by record_id')).rows,before);assert.equal(await f.scalar('select count(*)from private.maan_submission_facts'),1000);
  const mismatches=await f.scalar("select count(*)from public.newar_detail_records n cross join lateral private.maan_submission_fact(n)p join private.maan_submission_facts q on q.record_id=p.record_id where row(p.platform,p.dataset,p.source_id,p.order_id,p.member_id,p.created_at,p.success_at,p.amount::text,p.currency,p.raw_provider,p.paid,p.status_known,p.member_level,p.recharge_count)is distinct from row(q.platform,q.dataset,q.source_id,q.order_id,q.member_id,q.created_at,q.success_at,q.amount::text,q.currency,q.raw_provider,q.paid,q.status_known,q.member_level,q.recharge_count)");assert.equal(mismatches,0);
 }finally{await f.close();}
});
test('capture/status text/unrelated raw churn leaves facts xmin unchanged and a real business update changes it',async()=>{
 const f=await fixture();try{
  const id=await f.insert('CHURN'),xmin=await f.scalar("select xmin::text from private.maan_submission_facts where source_id='CHURN'");
  for(const change of["captured_at=now(),received_at=now()","status_code='native-ui-label'","raw=raw||'{\"unrelated\":\"text\"}'::jsonb","provider=' route-a '"]){await f.db.exec('set role service_role');await f.db.query('update public.newar_detail_records set '+change+' where id=$1',[id]);await f.db.exec('reset role');assert.equal(await f.scalar("select xmin::text from private.maan_submission_facts where source_id='CHURN'"),xmin);}
  await f.db.exec('set role service_role');await f.db.query("update public.newar_detail_records set raw=raw||'{\"rechargeCount\":3}'::jsonb where id=$1",[id]);await f.db.exec('reset role');assert.equal((await f.fact(id)).recharge_count,3);assert.notEqual(await f.scalar("select xmin::text from private.maan_submission_facts where source_id='CHURN'"),xmin);
 }finally{await f.close();}
});
test('direct owner fact changes revoke proofs, zero mutations do not, mistaken API control grants cannot forge readiness',async()=>{
 const f=await fixture();try{
  const id=await f.insert('TAINT');await f.receipt();await f.db.query('update private.maan_submission_facts set amount=amount+1 where record_id=$1',[id]);assert.equal(await f.scalar('select epoch from private.maan_submission_epoch'),1);assert.equal(await f.scalar('select count(*)from private.maan_submission_ready'),0);
  await f.receipt();await f.db.exec('update private.maan_submission_facts set amount=0 where false');assert.equal(await f.scalar('select epoch from private.maan_submission_epoch'),1);assert.equal(await f.scalar('select count(*)from private.maan_submission_ready'),1);
  await f.db.exec('grant usage on schema private to service_role;grant all on private.maan_submission_ready to service_role;set role service_role');await assert.rejects(()=>f.db.exec("insert into private.maan_submission_ready values('2026-10-13',repeat('b',32),0,now())"),/maan_submission_control_owner_only/);await f.db.exec('reset role');
 }finally{await f.close();}
});
test('bounded backfill locks native rows and never overwrites a newer trigger-maintained fact',async()=>{
 const f=await fixture();try{
  const id=await f.insert('BACKFILL');await f.db.query('delete from private.maan_submission_facts where record_id=$1',[id]);
  await f.db.exec("set statement_timeout='3s';set lock_timeout='1s'");const q="select private.backfill_maan_submission_window('created','2026-10-12T00:00:00+05:30','2026-10-12T00:15:00+05:30',250)r";const a=(await f.db.query(q)).rows[0].r;assert.equal(a.inserted,1);assert.equal(a.ready,false);
  await f.db.query("update public.newar_detail_records set amount='999.00000000'where id=$1",[id]);const x=await f.scalar("select xmin::text from private.maan_submission_facts where source_id='BACKFILL'");const b=(await f.db.query(q)).rows[0].r;assert.equal(b.inserted,0);assert.equal((await f.fact(id)).amount,'999.00000000');assert.equal(await f.scalar("select xmin::text from private.maan_submission_facts where source_id='BACKFILL'"),x);
  await assert.rejects(()=>f.db.query("select private.backfill_maan_submission_window('created','2026-10-12','2026-10-13',250)"),/invalid_window/);await f.db.exec('set role service_role');await assert.rejects(()=>f.db.query(q),/permission denied/);await f.db.exec('reset role');
  const sql=stage(1);assert.match(sql,/for share of n skip locked/);assert.match(sql,/on conflict\(record_id\)do nothing/);assert.match(sql,/not exists/);
 }finally{await f.close();}
});

}
{
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{fixture,readArtifact}=require('./fixtures/maan-submission-projection-harness.cjs');
const read=readArtifact,sql=read('stage1-install.sql');
async function installed(){const f=await fixture({install:false});await f.db.exec(sql);return f;}
test('strict install is atomic, leaves native rows and existing trigger unchanged; replay preserves generation and receipts',async()=>{const f=await fixture({install:false});try{
 const before=await f.scalar('select count(*)from public.newar_detail_records');await f.db.exec(sql);const g=await f.scalar('select private.maan_submission_generation()');assert.match(g,/^[a-f0-9]{32}$/);assert.equal(await f.scalar('select count(*)from public.newar_detail_records'),before);assert.equal(await f.scalar("select md5(prosrc)from pg_proc where oid='private.fixture_withdraw_sync()'::regprocedure"),f.before);
 const id=await f.insert('PRESERVE');await f.db.query("insert into private.maan_submission_ready values('2026-10-12',$1,1,now())",[g]);await f.db.exec(sql);assert.equal(await f.scalar('select private.maan_submission_generation()'),g);assert(await f.fact(id));assert.equal(await f.scalar('select count(*)from private.maan_submission_ready'),1);
 assert.match(sql,/statement_timeout='3s'/);assert.match(sql,/lock_timeout='1s'/);assert.doesNotMatch(sql,/drop table|truncate table/i);
}finally{await f.close()}});
test('runtime generation is stable across ANALYZE and session timezone, rejects source/schema/ACL/trigger formula drift',async()=>{const f=await installed();try{
 const g=await f.scalar('select private.maan_submission_generation()');await f.db.exec("analyze private.maan_submission_facts;set timezone='Europe/Berlin'");assert.equal(await f.scalar('select private.maan_submission_generation()'),g);
 for(const change of["alter table public.newar_detail_records alter column created_at drop not null","grant select on private.maan_submission_facts to service_role","alter table public.newar_detail_records disable trigger \"0_maan_submission_sync_update\"","alter function private.maan_submission_fact(public.newar_detail_records)strict"]){await f.db.exec('begin');await f.db.exec(change);assert.equal(await f.scalar('select private.maan_submission_generation()'),null,change);await f.db.exec('rollback');}
 await f.db.exec('alter table public.newar_detail_records disable trigger "0_maan_submission_sync_update";alter table public.newar_detail_records enable trigger "0_maan_submission_sync_update"');assert.notEqual(await f.scalar('select private.maan_submission_generation()'),g,'trigger disable/re-enable must revoke old generation');
}finally{await f.close()}});
test('fresh partial/unknown objects and replay metadata drift abort without deleting source or installed facts',async()=>{for(const change of["create table private.maan_submission_facts(x integer)","create function private.backfill_maan_submission_window()returns integer language sql as 'select 1'"]){const f=await fixture({install:false});try{await f.db.exec(change);await assert.rejects(()=>f.db.exec(sql),/partial_or_unknown|function_drift|already exists/);await f.db.exec('rollback');assert.equal(await f.scalar('select count(*)from public.newar_detail_records'),0)}finally{await f.close()}}
 const f=await installed();try{let id=await f.insert('NO-LOSS');await f.db.exec('alter function private.check_maan_submission_window(text,timestamptz,timestamptz)strict');await assert.rejects(()=>f.db.exec(sql),/function_drift/);await f.db.exec('rollback');assert(await f.fact(id));assert.equal(await f.scalar('select count(*)from public.newar_detail_records'),1)}finally{await f.close()}
});
test('one-window maintenance is bounded, exposes progress, preserves newer source facts, and rejects relaxed budgets/API callers',async()=>{const f=await installed();try{
 const a=await f.insert('A'),b=await f.insert('B');await f.db.query('delete from private.maan_submission_facts where record_id=any($1::uuid[])',[[a,b]]);await f.db.exec("set statement_timeout='3s';set lock_timeout='1s'");const q="select private.maintain_maan_submission_window('created','2026-10-12T00:00:00+05:30','2026-10-12T00:15:00+05:30',1)r";
 let r=(await f.db.query(q)).rows[0].r;assert.equal(r.inserted,1);assert.equal(r.windowComplete,false);assert.equal(r.missingFactExists,true);assert.equal(r.dayReady,false);
 r=(await f.db.query(q)).rows[0].r;assert.equal(r.inserted,1);assert.equal(r.windowComplete,true);r=(await f.db.query(q)).rows[0].r;assert.equal(r.inserted,0);assert.equal(r.windowComplete,true);
 await f.db.query("update public.newar_detail_records set amount='999.00000000'where id=$1",[a]);await f.db.query(q);assert.equal((await f.fact(a)).amount,'999.00000000');
 await f.db.exec("set statement_timeout='4s'");await assert.rejects(()=>f.db.query(q),/budget_required/);await f.db.exec("set statement_timeout='3s';set role service_role");await assert.rejects(()=>f.db.query(q),/permission denied/);await f.db.exec('reset role');
}finally{await f.close()}});

}
