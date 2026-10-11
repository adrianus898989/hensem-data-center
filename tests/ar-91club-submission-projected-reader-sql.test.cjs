// Offline full-JSON differential tool. Every order/account below is synthetic.
// Run with node --test; no workspace-only fixture or production dependency.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const repo=path.resolve(__dirname,'..'),tests=path.join(repo,'tests');
const nativeFile=path.join(tests,'ar-submission-native-null-members-sql.test.cjs');
const realRequire=createRequire(nativeFile);let setup;
const context=vm.createContext({__dirname:tests,require:name=>name==='node:test'?{test(){},before:fn=>setup=fn,beforeEach(){},after(){}}:realRequire(name)});
vm.runInContext(fs.readFileSync(nativeFile,'utf8').split(/\ntest\(/)[0]+'\nglobalThis.fixture={get db(){return db},get f(){return f},get seed(){return seed},installCurrent:()=>db.exec(patch),get receipts(){return receipts},get yash(){return yash}};',context);
let baseline,candidate;const readerMigration=fs.readFileSync(path.join(repo,'supabase/migrations/20261011124504_ar_91club_submission_fact_reader.sql'),'utf8');
const info=async db=>(await db.query("select md5(prosrc) hash,pg_get_functiondef(oid) definition,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure")).rows[0];
const withoutClock=value=>{const result=JSON.parse(JSON.stringify(value));delete result.asOf;return result};
const metric=(r,t=15,p=null)=>r.metrics.find(x=>x.threshold===t&&x.provider===p);
async function main(){
 await setup();const {db,f,seed:oldSeed}=context.fixture;const seed=async(kind,member,n=20)=>{if(kind!=='ar')return oldSeed(kind,member,n);await db.query(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel,member_level,recharge_count)
 select 'AR','IN','91CLUB','recharge',$1||'-'||i,$1,case when i=1 then 0 else 123.45678901 end,'待支付',timestamp '2026-10-10 10:00'+i*interval '1 second',case when i%2=0 then 'route-a' else 'Other Pay' end,0,0 from generate_series(1,$2::int)i`,[member,n]);};
 try{
  await f.as(f.owner);await context.fixture.installCurrent();await db.query("update fixture_platforms set source_name='91CLUB',name='91CLUB' where id=$1",[f.ids.ar]);assert.equal((await info(db)).hash,'325c95878225f211b91aed89c7abae86');baseline=(await info(db)).definition;
  await db.exec('truncate ar_collected_orders,newar_detail_records,lg_orders,game66_charge_orders,private.yash_orders,private.yash_sync_windows;alter table ar_collected_orders alter column member_level type integer using null::integer');
  // Recreate the native source using exact production physical types/bounds.
  // The real source key remains immediate and unique throughout this matrix.
  const {sourceDDL,local}=require('./fixtures/ar-91club-submission-projection-harness.cjs');
  await db.exec("drop table ar_collected_orders cascade;do $$begin if not exists(select 1 from pg_roles where rolname='service_role')then create role service_role bypassrls;end if;end;$$");await db.exec(sourceDDL);
  await db.exec('revoke all on function private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)from public,anon,authenticated,service_role');
  await db.exec(local(fs.readFileSync(path.join(repo,'supabase/migrations/20261011121607_ar_91club_submission_narrow_facts.sql'),'utf8')));await db.exec(fs.readFileSync(path.join(repo,'supabase/migrations/20261011124227_ar_91club_submission_fact_readiness.sql'),'utf8'));
  // Supplemental corrupt-identity boundary is impossible under the deployed
  // source CHECK, but the projected algorithm still preserves its old guard.
  await db.exec('alter table ar_collected_orders drop constraint ar_collected_orders_order_no_check');
  for(const member of ['VALID','PAID','PRIOR','LATER','UNKNOWN','UNDATED','DUP','BLANK','0001','1','未知原生成员','UNKNOWN-MONEY'])await seed('ar',member,20);
  for(const n of [10,11,15,16,20,21,30,31,50,51,100,101])await seed('ar','THRESHOLD-'+n,n);
  await db.exec(`update ar_collected_orders set status='已支付',completed_at='2026-10-10 14:00' where order_no='PAID-19';
   update ar_collected_orders set status='已支付',completed_at='2026-10-11 14:00' where order_no='LATER-19';
   update ar_collected_orders set status='unknown' where order_no='UNKNOWN-19';
   update ar_collected_orders set applied_at=null,raw_channel='Unselected provider' where order_no='UNDATED-19';
   update ar_collected_orders set order_no='' where order_no='DUP-19';
   update ar_collected_orders set member_id='  ' where member_id='BLANK';
   update ar_collected_orders set amount=null where order_no='UNKNOWN-MONEY-19';
   update ar_collected_orders set money_format_version=1,amount_local=0,currency_local='INR' where order_no='VALID-1';
   update ar_collected_orders set money_format_version=1,amount_local=123.45678901,currency_local='INR' where order_no='VALID-2';
   update ar_collected_orders set money_format_version=1,amount_local=10,currency_local='USD' where order_no='UNKNOWN-MONEY-1';
   update ar_collected_orders set money_issue_code='LOCAL_AMOUNT_STALE_FOR_USDT' where order_no='UNKNOWN-MONEY-3';
   insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,completed_at,raw_channel) values
   ('AR','IN','91CLUB','recharge','PRIOR-SUCCESS','PRIOR',1,'已支付','2026-10-09 10:00','2026-10-10 14:00','Other Pay'),
   ('AR','IN','OTHER-PLATFORM','recharge','FOREIGN-PLATFORM','VALID',1,'unknown',null,null,'Unselected provider'),
   ('AR','PK','91CLUB','recharge','FOREIGN-COUNTRY','VALID',1,'unknown',null,null,'Unselected provider'),
   ('AR','IN','91CLUB','withdraw','FOREIGN-DIRECTION','VALID',1,'unknown',null,null,'Unselected provider'),
   ('OTHER','IN','91CLUB','recharge','FOREIGN-SOURCE','VALID',1,'unknown',null,null,'Unselected provider');`);
  await db.exec("begin isolation level repeatable read;select private.approve_ar_91club_submission_day('2026-10-10');select private.approve_ar_91club_submission_day('2026-10-11');select private.approve_ar_91club_submission_null();select private.approve_ar_91club_submission_future();commit");
  assert.equal((await db.query("select private.ar_91club_submission_can_read('2026-10-10','2026-10-11')b")).rows[0].b,true,'this matrix MUST execute the proved projected branch');
  const base={startAt:'2026-10-10T00:00:00+05:30',endAt:'2026-10-11T00:00:00+05:30',charts:false,operation:'summary'};
  const requests=[base,{...base,charts:true},{...base,providers:['CombinedPay']},{...base,providers:['ABSENT']},
   {...base,providers:['Other Pay'],startAt:'2026-10-10T10:00:01+05:30',endAt:'2026-10-10T10:00:08+05:30'},
   {...base,startAt:'2026-10-09T00:00:00+05:30',endAt:'2026-10-10T00:00:00+05:30'},
   {...base,startAt:'2026-10-10T10:00:01+05:30',endAt:'2026-10-10T10:00:02+05:30'},
   ...[10,15,20,30,50,100].map(threshold=>({...base,threshold})),
   ...['all','new','funded','unknown','l0'].map(level=>({...base,operation:'members',level,providers:['CombinedPay']})),
   ...['VALID','PAID','PRIOR','LATER','UNKNOWN','UNDATED','DUP','0001','1','未知原生成员','UNKNOWN-MONEY'].map(memberId=>({...base,operation:'memberOrders',memberId,day:'2026-10-10',limit:100,providers:['CombinedPay']}))];
  for(const kind of ['newar','lg','game','yash'])await oldSeed(kind,'SYNTHETIC-OTHER');await context.fixture.receipts();
  const foreignRequests=[];for(const [platformId,zone]of [[f.ids.newar,'+05:45'],[f.ids.lg,'+08:00'],[f.ids.game,'+05:30'],[context.fixture.yash,'+05:30']])for(const charts of [true,false])for(const operation of ['summary','members','memberOrders'])foreignRequests.push({platformId,charts,operation,startAt:'2026-10-02T00:00:00'+zone,endAt:'2026-10-03T00:00:00'+zone,...(operation==='memberOrders'?{memberId:'SYNTHETIC-OTHER',day:'2026-10-02',limit:100}:{})});
  const call=async q=>withoutClock(await f.call(f.request(q)));
  await db.exec('begin isolation level repeatable read');
  await db.exec(baseline);const metadata=(await info(db)).metadata,expected=[];
  for(const q of requests)expected.push(await call(q));
  assert.equal(expected[0].dashboard,null);assert.deepEqual(expected[0].metrics,expected[1].metrics);assert.deepEqual(expected[0].coverage,expected[1].coverage);
  assert.equal(expected[0].coverage.sourceCompletenessVerified,false);
  assert(expected[0].coverage.orderSequenceUncertainCount>0);assert(expected[0].coverage.unknownStatusCount>0);assert.equal(expected[0].coverage.missingMemberCount,20);
  assert.equal(metric(expected[3]).invalid_count,0);assert.equal(expected[3].coverage.orderCount,0);
  const orderResponses=expected.slice(-11);assert.equal(orderResponses[0].total,10);
  for(const r of orderResponses.slice(1,7))assert.equal(r.total,0,'paid/prior/later/unknown/undated/blank-order members must not qualify');
  for(let i=7;i<10;i++){assert.equal(orderResponses[i].total,10);assert.equal(orderResponses[i].rows[0].member_id,requests[requests.length-11+i].memberId);}
  assert.equal(orderResponses.at(-1).total,10); // Unknown amounts do not change the count qualification.
  const monitored=expected[1].dashboard.monitoring.find(x=>x.provider===null);assert.equal(monitored.invalid_count,metric(expected[1]).invalid_count);assert.equal(monitored.order_count,expected[1].coverage.orderCount);
  assert.equal(monitored.invalid_amount,metric(expected[1]).invalid_amount);
  const expectedForeign=[];for(const q of foreignRequests)expectedForeign.push(await call(q));
  await db.exec(readerMigration.slice(readerMigration.indexOf('lock table'),readerMigration.lastIndexOf('commit;')));candidate=(await info(db)).definition;const after=await info(db);assert.deepEqual(after.metadata,metadata,'owner, ACL and execution settings must be unchanged');
  for(let i=0;i<requests.length;i++)assert.deepEqual(await call(requests[i]),expected[i],'full JSON difference at request '+i);
  for(let i=0;i<foreignRequests.length;i++)assert.deepEqual(await call(foreignRequests[i]),expectedForeign[i],'other native source full JSON difference at request '+i);
  await db.exec(readerMigration.slice(readerMigration.indexOf('lock table'),readerMigration.lastIndexOf('commit;')));assert.deepEqual(await info(db),after,'reader migration replay must preserve body/ACL/settings');
  await db.exec('rollback');
  await db.exec(candidate.replace('   v_sql:=$q$with source_rows as not materialized (',`   raise exception 'SYNTHETIC_PROJECTED_FAST_PATH';\n   v_sql:=$q$with source_rows as not materialized (`));
  await assert.rejects(()=>call(base),/SYNTHETIC_PROJECTED_FAST_PATH/);
  await db.exec(candidate);
  const nullReady=(await db.query('select * from private.ar_91club_submission_null_ready')).rows[0];await db.exec('delete from private.ar_91club_submission_null_ready');
  assert.equal((await db.query("select private.ar_91club_submission_can_read('2026-10-10','2026-10-11')b")).rows[0].b,false);
  for(let i=0;i<requests.length;i++)assert.deepEqual(await call(requests[i]),expected[i],'unproved fallback full JSON difference at request '+i);
  await db.query('insert into private.ar_91club_submission_null_ready values($1,$2,$3,$4)',Object.values(nullReady));
  for(const change of ["grant execute on function private.ar_91club_submission_can_read(date,date)to authenticated","alter function private.dashboard_admin_live_submission_analysis(jsonb)set jit=on","alter table ar_collected_orders disable trigger ar91_submission_fact_sync_update"]){await db.exec('begin;'+change);const old=await info(db);await assert.rejects(()=>db.exec(readerMigration.slice(readerMigration.indexOf('lock table'),readerMigration.lastIndexOf('commit;'))),/drift|generation_invalid/);assert.deepEqual(await info(db).catch(()=>null),null,'failed migration leaves transaction aborted');await db.exec('rollback');assert.equal((await info(db)).hash,after.hash);}
  await db.exec(candidate);await f.as(f.viewer);await assert.rejects(()=>call({...base,platformId:f.ids.hidden}),/platform_denied/);await f.as(f.owner);
  console.log(JSON.stringify({offline:true,synthetic_only:true,baseline_hash:'325c95878225f211b91aed89c7abae86',candidate_hash:after.hash,requests:requests.length,other_source_requests:foreignRequests.length,migration_replay:true,migration_drift_rejected:true,projected_branch_verified:true,full_json_differences:0,fallback_json_differences:0,ignored_volatile_keys:['asOf'],same_snapshot:'repeatable_read_no_fact_mutations',denied_hidden_platform:true}));
 } finally {await db.close();}
}
require('node:test')('proved native facts and unchanged fallback preserve 29 full JSON contracts, real branch, all auth/settings and hidden denial',main);
