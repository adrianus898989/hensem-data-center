const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,local,row,stage1,stage2,repo}=require('./fixtures/ar-91club-submission-projection-harness.cjs');
const migration=fs.readFileSync(path.join(repo,'supabase/migrations/20261011140800_ar_91club_submission_proof_native_windows.sql'),'utf8');
const beforeHash='fe4f8523bc19a8e54086e3aa214aa56f',afterHash='016a4d4963a6a23375a83f3440754eae';
const baseline=stage2().split('as $approve_day$')[1].split('$approve_day$')[0];
async function setup(){const db=await fixture();await db.exec(local(stage1()));await db.exec(stage2());return db;}
async function run(fn){const db=await setup();try{await fn(db)}finally{await db.exec('rollback;reset role').catch(()=>{});await db.close()}}
const currentBody=async db=>(await db.query("select prosrc from pg_proc where oid='private.approve_ar_91club_submission_day(date)'::regprocedure")).rows[0].prosrc;
const generation=async db=>(await db.query('select private.ar_91club_submission_generation() g')).rows[0].g;
const meta=async db=>(await db.query("select md5(prosrc) hash,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='private.approve_ar_91club_submission_day(date)'::regprocedure")).rows[0];
function counters(body){let q=body.slice(body.indexOf(' with expected'),body.indexOf('\n if v_missing'));q=q.replace(' select count(a.order_no)',' select array[count(a.order_no)').replace('into v_count,v_missing,v_extra,v_bad ','] counters ').replaceAll('p_day','$1::date');return q;}
const measure=async(db,body,day)=>(await db.query(counters(body),[day])).rows[0].counters.map(Number);
const approve=async(db,day='2026-10-10')=>{await db.exec('begin isolation level repeatable read');try{const r=(await db.query('select private.approve_ar_91club_submission_day($1::date) proof',[day])).rows[0].proof;await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}};

test('native dual-window proof is exactly OR-equivalent at both day edges, overlap, NULL, infinity and foreign scopes',()=>run(async db=>{
 const cases=[
  ['OVERLAP',{status:'已支付',completed_at:'2026-10-10 11:00:00'}],
  ['CREATED-LOW',{applied_at:'2026-10-10 00:00:00'}],
  ['CREATED-HIGH',{applied_at:'2026-10-11 00:00:00'}],
  ['PRIOR-PAID',{applied_at:'2020-01-01',status:'已支付',completed_at:'2026-10-10 00:00:00'}],
  ['NULL-PAID',{applied_at:null,status:'已支付',completed_at:'2026-10-10 23:59:59.999999'}],
  ['NULL-PENDING',{applied_at:null,completed_at:'2026-10-10',status:'待支付'}],
  ['FUTURE-PAID',{applied_at:'2026-10-12',status:'已支付',completed_at:'2026-10-10'}],
  ['INFINITE-PAID',{applied_at:'infinity',status:'已支付',completed_at:'2026-10-10'}],
  ['NEXT-PAID',{applied_at:'2026-10-09',status:'已支付',completed_at:'2026-10-11'}],
  ['NULL-STATUS',{status:null,member_id:null}],
  ['FOREIGN-PLATFORM',{platform:'51GAME'}],['FOREIGN-COUNTRY',{country_code:'PK'}],['FOREIGN-SOURCE',{source_system:'OTHER'}],['FOREIGN-KIND',{order_kind:'withdraw'}]
 ];for(const [id,p]of cases)await row(db,id,p);
 await db.exec(migration);const updated=await currentBody(db);
 for(const zone of ['UTC','Asia/Kolkata','Pacific/Auckland']){await db.query("select set_config('TimeZone',$1,false)",[zone]);for(const day of ['2026-10-10','2026-10-11','2026-10-12'])assert.deepEqual(await measure(db,updated,day),await measure(db,baseline,day));}
 assert.deepEqual(await measure(db,updated,'2026-10-10'),[7,0,0,0],'overlap is counted once; NULL applied paid remains');
 assert.equal((await approve(db)).sourceCount,7);
}));

test('all native business fields, monetary scale, missing and extra rows retain exact parity detection',()=>run(async db=>{
 await row(db,'NATIVE',{status:'已支付',completed_at:'2026-10-10',amount_local:'1.0',amount:'0'});await db.exec(migration);const updated=await currentBody(db);
 const changes={order_no:"'DIFFERENT-KEY'",applied_at:"timestamp '2026-10-11'",completed_at:"timestamp '2026-10-11'",member_id:'null',status:"'unknown'",raw_channel:'null',member_level:'1',recharge_count:'1',channel_type:'null',money_format_version:'null',amount_local:"'1.00'::numeric",currency_local:'null',money_issue_code:"'UNKNOWN'",amount:'null'};
 for(const [field,value]of Object.entries(changes)){await db.exec(`begin;update private.ar_91club_submission_facts set ${field}=${value} where order_no='NATIVE'`);for(const day of ['2026-10-10','2026-10-11'])assert.deepEqual(await measure(db,updated,day),await measure(db,baseline,day),field);assert.notDeepEqual(await measure(db,updated,'2026-10-10'),[1,0,0,0],field);await db.exec('rollback');}
 await db.exec("delete from private.ar_91club_submission_facts where order_no='NATIVE'");assert.deepEqual(await measure(db,updated,'2026-10-10'),[1,1,0,0]);await assert.rejects(()=>approve(db),/parity_failed/);
}));

test('zero, NULL, native numeric scale and nonfinite numeric values stay exact without money conversion',()=>run(async db=>{
 for(const [id,value]of [['ZERO','0.00000000'],['NULL',null],['NAN','NaN'],['POS-INF','Infinity'],['NEG-INF','-Infinity']])await row(db,id,{amount_local:value,amount:null,member_id:null,status:null});
 await db.exec(migration);const updated=await currentBody(db);assert.deepEqual(await measure(db,updated,'2026-10-10'),[5,0,0,0]);assert.deepEqual(await measure(db,updated,'2026-10-10'),await measure(db,baseline,'2026-10-10'));await approve(db);
 await db.exec("update private.ar_91club_submission_facts set amount_local='0.00' where order_no='ZERO'");assert.deepEqual(await measure(db,updated,'2026-10-10'),[5,0,0,1]);await assert.rejects(()=>approve(db),/parity_failed/);
}));

test('patch and replay preserve epoch/generation, approval rows, all sibling functions and reader metadata',()=>run(async db=>{
 await row(db,'REPLAY');await approve(db);const g=await generation(db),m=await meta(db);assert.equal(m.hash,beforeHash);
 const snapshot=async()=>(await db.query("select jsonb_build_object('ready',(select jsonb_agg(to_jsonb(r))from private.ar_91club_submission_ready r),'siblings',(select jsonb_agg(jsonb_build_array(oid,md5(prosrc),to_jsonb(p)-'prosrc')order by oid)from pg_proc p where oid in('private.approve_ar_91club_submission_null()'::regprocedure,'private.approve_ar_91club_submission_future()'::regprocedure,'private.ar_91club_submission_can_read(date,date)'::regprocedure,'private.ar_91club_submission_generation()'::regprocedure,'private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure))) s")).rows[0].s;
 const s=await snapshot();await db.exec(migration);assert.equal((await meta(db)).hash,afterHash);assert.deepEqual((await meta(db)).metadata,m.metadata);assert.equal(await generation(db),g);assert.deepEqual(await snapshot(),s);
 const p=await meta(db);await db.exec(migration);assert.deepEqual(await meta(db),p);assert.deepEqual(await snapshot(),s);assert.equal(await generation(db),g);
 assert.equal((await approve(db)).sourceCount,1);
}));

test('RR/epoch/SUE protocol and owner-only security are retained; unrelated operations never enter the changed CTE',()=>run(async db=>{
 await db.exec(migration);const updated=await currentBody(db),oldStart=baseline.indexOf(' with expected'),newStart=updated.indexOf(' with expected');assert.equal(updated.slice(0,newStart),baseline.slice(0,oldStart));assert.equal(updated.slice(updated.indexOf('\n select count(a.order_no)')),baseline.slice(baseline.indexOf('\n select count(a.order_no)')));
 await assert.rejects(()=>db.query("select private.approve_ar_91club_submission_day('2026-10-10')"),/requires_repeatable_read/);
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(()=>db.query("select private.approve_ar_91club_submission_day('2026-10-10')"),/permission denied/);await assert.rejects(()=>db.exec(migration),/actor_drift/);await db.exec('rollback;reset role');}
 for(const day of [null,'2026-10-09','infinity'])await assert.rejects(()=>approve(db,day),/day_invalid/);
 await row(db,'MAINTENANCE');await approve(db);const g=await generation(db);await db.exec('update private.ar_91club_submission_facts set amount_local=amount_local');assert.notEqual(await generation(db),g);assert.equal((await db.query('select count(*) n from private.ar_91club_submission_ready')).rows[0].n,0);
}));

test('body, permissions, arguments, configuration and generation drift refuse the patch without partial replacement',()=>run(async db=>{
 const changes=["alter function private.approve_ar_91club_submission_day(date) security definer","grant execute on function private.approve_ar_91club_submission_day(date) to authenticated","alter function private.approve_ar_91club_submission_day(date) set search_path=public","alter function private.approve_ar_91club_submission_day(date) volatile;create or replace function private.approve_ar_91club_submission_day(p_day date)returns jsonb language plpgsql set search_path='' as $$begin return '{}'::jsonb;end$$","alter function private.approve_ar_91club_submission_null() stable","alter table private.ar_91club_submission_facts disable trigger ar91_submission_ready_update"];
 for(const change of changes){await db.exec('begin;'+change);await assert.rejects(()=>db.exec(migration),/drift|generation_invalid/);await db.exec('rollback');assert.equal((await meta(db)).hash,beforeHash);}
}));
