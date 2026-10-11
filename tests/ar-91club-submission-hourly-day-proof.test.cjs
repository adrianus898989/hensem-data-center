const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,local,row,metadata,repo,stage1,stage2}=require('./fixtures/ar-91club-submission-projection-harness.cjs');
const read=n=>fs.readFileSync(path.join(repo,n),'utf8');
const migration=read('supabase/migrations/20261011140800_ar_91club_submission_proof_native_windows.sql');
const script=read('supabase/maintenance/ar_91club_submission_hourly_day_proof_20261010.sql');
const start=script.slice(0,script.indexOf('-- Independent statements'));
const calls=Array.from({length:24},(_,h)=>`select pg_temp.ar91_verify_hour(${h});`).join('\n');
const finish='select pg_temp.ar91_finish_hourly_day();';
async function setup(){const db=await fixture();await db.exec(local(stage1()));await db.exec(stage2());await db.exec(migration);return db;}
async function run(fn){const db=await setup();try{await fn(db)}finally{await db.exec('rollback;reset role').catch(()=>{});await db.close()}}
const approval=async db=>(await db.query("select source_count::text n,generation from private.ar_91club_submission_ready where data_date='2026-10-10'")).rows;
const generation=async db=>(await db.query('select private.ar_91club_submission_generation() g')).rows[0].g;
async function rollback(db){await db.exec('rollback;reset role');assert.equal((await db.query("select to_regclass('pg_temp.ar91_hour_proof_parts') t")).rows[0].t,null);}
async function seed(db){
 for(let h=0;h<24;h++)await row(db,'HOUR-'+h,{applied_at:`2026-10-10 ${String(h).padStart(2,'0')}:00:00`,amount_local:h===0?'0.00000000':'1.0'});
 for(const [id,p]of [
  ['OVERLAP-DIFFERENT-HOUR',{applied_at:'2026-10-10 03:59:59.999999',status:'已支付',completed_at:'2026-10-10 21:00:00'}],
  ['PAID-NULL-CREATED',{applied_at:null,status:'已支付',completed_at:'2026-10-10 07:00:00'}],
  ['PAID-PRIOR-CREATED',{applied_at:'2020-01-01',status:'已支付',completed_at:'2026-10-10 09:00:00'}],
  ['PAID-FUTURE-CREATED',{applied_at:'2026-10-11',status:'已支付',completed_at:'2026-10-10 10:00:00'}],
  ['PAID-INFINITE-CREATED',{applied_at:'infinity',status:'已支付',completed_at:'2026-10-10 23:59:59.999999'}],
  ['PAID-NEXT-DAY',{applied_at:'2026-10-10 15:00:00',status:'已支付',completed_at:'2026-10-11'}],
  ['NULL-PENDING',{applied_at:null,status:null}],
  ['NEXT-DAY-EDGE',{applied_at:'2026-10-11'}],
  ['PRIOR-DAY-EDGE',{applied_at:'2026-10-09 23:59:59.999999',status:'unknown'}],
  ['OTHER-PLATFORM',{platform:'51GAME'}],['OTHER-COUNTRY',{country_code:'PK'}],['OTHER-KIND',{order_kind:'withdraw'}],['OTHER-SOURCE',{source_system:'OTHER'}]
 ])await row(db,id,p);
}

test('24-hour statements equal exact whole-day proof: no overlapping paid count, NULL/prior/future paid included, timezone independent',()=>run(async db=>{
 await seed(db);const before=await metadata(db),g=await generation(db);
 await db.exec("begin isolation level repeatable read;select private.approve_ar_91club_submission_day('2026-10-10');commit");const old=await approval(db);assert.equal(old[0].n,'30');
 for(const zone of ['UTC','Asia/Kolkata','Pacific/Auckland']){await db.query("select set_config('TimeZone',$1,false)",[zone]);const result=await db.exec(script);const proof=result.flatMap(r=>r.rows||[]).find(r=>r.proof)?.proof;assert.deepEqual({...proof,day:undefined},{approved:true,day:undefined,sourceCount:30,parts:24,generation:g});assert.deepEqual(await approval(db),old);assert.equal((await db.query("select to_regclass('pg_temp.ar91_hour_proof_context') t,to_regprocedure('pg_temp.ar91_verify_hour(integer)') f")).rows[0].t,null);assert.equal((await db.query("select to_regprocedure('pg_temp.ar91_finish_hourly_day()') f")).rows[0].f,null);}
 assert.deepEqual(await metadata(db),before);assert.equal(await generation(db),g);
}));

test('a missing hour, duplicate hour, corrupted bounds or bad mismatch counter can never approve',()=>run(async db=>{
 await row(db,'ONE');
 await db.exec(start+Array.from({length:23},(_,h)=>`select pg_temp.ar91_verify_hour(${h});`).join(''));
 await assert.rejects(()=>db.exec(finish),/parts_incomplete_or_invalid/);await rollback(db);assert.deepEqual(await approval(db),[]);
 await db.exec(start+'select pg_temp.ar91_verify_hour(0);');await assert.rejects(()=>db.exec('select pg_temp.ar91_verify_hour(0);'),/hour_repeated/);await rollback(db);assert.deepEqual(await approval(db),[]);
 for(const corrupt of ["update pg_temp.ar91_hour_proof_parts set interval_end=interval_end+interval '1 second' where hour=7","update pg_temp.ar91_hour_proof_parts set changed_count=1 where hour=12","delete from pg_temp.ar91_hour_proof_parts where hour=22"]){await db.exec(start+calls+corrupt);await assert.rejects(()=>db.exec(finish),/parts_incomplete_or_invalid/);await rollback(db);assert.deepEqual(await approval(db),[]);}
}));

test('missing/extra and all mutable native-field mismatches fail the hour and roll back every prior verified slice',()=>run(async db=>{
 await row(db,'ONE',{applied_at:'2026-10-10 22:00:00',status:'已支付',completed_at:'2026-10-10 23:00:00',amount_local:'1.0'});
 const changes={order_no:"'OTHER-KEY'",applied_at:"timestamp '2026-10-11'",completed_at:"timestamp '2026-10-11'",member_id:'null',status:"'unknown'",raw_channel:'null',member_level:'1',recharge_count:'1',channel_type:'null',money_format_version:'null',amount_local:"'1.00'::numeric",currency_local:'null',money_issue_code:"'UNKNOWN'",amount:'null'};
 for(const [field,value]of Object.entries(changes)){await db.exec('begin isolation level repeatable read;');await db.exec(`update private.ar_91club_submission_facts set ${field}=${value} where order_no='ONE'`);await assert.rejects(()=>db.exec(script),/parity_failed/,field);await rollback(db);assert.deepEqual(await approval(db),[]);}
 await db.exec('begin isolation level repeatable read;delete from private.ar_91club_submission_facts');await assert.rejects(()=>db.exec(script),/parity_failed/);await rollback(db);assert.deepEqual(await approval(db),[]);
}));

test('native zero, NULL, scale, NaN and +/-Infinity remain exact; no amount helper is invoked',()=>run(async db=>{
 for(const [id,value]of [['ZERO','0.00000000'],['NULL',null],['NAN','NaN'],['POS-INF','Infinity'],['NEG-INF','-Infinity']])await row(db,id,{amount_local:value,amount:null,member_id:null,status:null});
 const amountSig='private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)';const args=(await db.query('select pg_get_function_arguments($1::regprocedure) args',[amountSig])).rows[0].args;await db.exec(`create or replace function private.dashboard_admin_ar_local_amount(${args}) returns numeric language plpgsql immutable set search_path='' as $$begin raise exception 'money_helper_must_not_run';end$$;`);
 await db.exec(script);assert.equal((await approval(db))[0].n,'5');
}));

test('same RR/epoch protocol and source-atomic changes keep proofs; generation/metadata drift before finish refuses readiness',()=>run(async db=>{
 await row(db,'ONE');await db.exec(start+calls);
 await db.exec('update private.ar_91club_submission_facts set amount_local=amount_local');await assert.rejects(()=>db.exec(finish),/generation_metadata_changed/);await rollback(db);assert.deepEqual(await approval(db),[]);
 await db.exec(start+calls);await db.exec('alter function private.approve_ar_91club_submission_day(date) cost 101');await assert.rejects(()=>db.exec(finish),/generation_metadata_changed/);await rollback(db);assert.deepEqual(await approval(db),[]);
 await db.exec(script);const g=await generation(db),old=await approval(db);await db.exec("update ar_collected_orders set amount_local='9.00000000' where order_no='ONE'");assert.equal(await generation(db),g);assert.deepEqual(await approval(db),old);
 await db.exec('update private.ar_91club_submission_facts set amount_local=amount_local');assert.deepEqual(await approval(db),[]);
}));

test('owner/hash/snapshot/120-second deadline guards reject before approval, with complete rollback and no permanent helper changes',()=>run(async db=>{
 await row(db,'ONE');const m=await metadata(db);
 await db.exec('begin;select 1;');await assert.rejects(()=>db.exec(script),/actor_snapshot_invalid|must be called before any query/);await rollback(db);
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(()=>db.exec(script),/actor_snapshot_invalid|permission denied/);await rollback(db);}
 await db.exec('begin isolation level repeatable read;alter function private.approve_ar_91club_submission_day(date) stable');await assert.rejects(()=>db.exec(script),/function_drift/);await rollback(db);
 await db.exec(start);await db.exec("update pg_temp.ar91_hour_proof_context set started_at=clock_timestamp()-interval '121 seconds'");await assert.rejects(()=>db.exec('select pg_temp.ar91_verify_hour(0)'),/deadline/);await rollback(db);
 await db.exec(start+calls);await db.exec("update pg_temp.ar91_hour_proof_context set started_at=clock_timestamp()-interval '121 seconds'");await assert.rejects(()=>db.exec(finish),/deadline/);await rollback(db);
 assert.deepEqual(await approval(db),[]);assert.deepEqual(await metadata(db),m);
}));
