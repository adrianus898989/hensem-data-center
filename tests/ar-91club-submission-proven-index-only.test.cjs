// Offline PostgreSQL differential test. Every order/account is synthetic.
// Builds exact production CEC through committed migrations; no workspace paths
// or network/production queries. Index-only omission requires the proved CHECK.
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
  const {sourceDDL,local}=require(path.join(tests,'fixtures/ar-91club-submission-projection-harness.cjs'));
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
  const providerMigration=fs.readFileSync(path.join(repo,'supabase/migrations/20261011154600_ar_91club_submission_native_provider_once.sql'),'utf8');
  const providerPatch=providerMigration.slice(providerMigration.indexOf('lock table'),providerMigration.lastIndexOf('commit;'));
  const indexMigration=fs.readFileSync(path.join(repo,'supabase/migrations/20261011161442_ar_91club_submission_proven_index_only.sql'),'utf8');
  const indexPatch=indexMigration.slice(indexMigration.indexOf('lock table'),indexMigration.lastIndexOf('commit;'));
  const installIndex=async()=>{if((await info(db)).hash==='d5fbb1bec39eb927dd923e0d1cc6e115')await db.exec(providerPatch);await db.exec(indexPatch);};

  await db.exec('savepoint wrong_parent');await assert.rejects(()=>db.exec(indexPatch),/metadata_drift/);await db.exec('rollback to savepoint wrong_parent');
  await db.exec(providerPatch);const cecBaseline=(await info(db)).definition;
  for(let i=0;i<requests.length;i++)assert.deepEqual(await call(requests[i]),expected[i],'direct deployed cec JSON baseline '+i);
  await installIndex();
  assert.equal((await info(db)).hash,'a8f8bb5de7d906675f5176c5eb4fcb70');
  assert.deepEqual((await info(db)).metadata,metadata,'candidate execution metadata unchanged');
  for(let i=0;i<requests.length;i++)assert.deepEqual(await call(requests[i]),expected[i],'native-provider-once full JSON request '+i);
  for(let i=0;i<foreignRequests.length;i++)assert.deepEqual(await call(foreignRequests[i]),expectedForeign[i],'native-provider-once other source JSON '+i);
  // Extra pure synthetic boundary: two native aliases merge to one canonical
  // provider; selected and unselected clocks, blank labels and unknown IDs.
  await db.exec('savepoint edge_cases');
  const canonicalArgs=(await db.query("select proargnames from pg_proc where oid='private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure")).rows[0].proargnames.map(n=>n+' text').join(',');
  await db.exec(`create or replace function private.dashboard_admin_live_provider_canonical(${canonicalArgs})returns text language sql stable as $$select case when $3 in('route-a','route-b')then 'CombinedPay' else $3 end$$;
   update ar_collected_orders set raw_channel='route-b' where member_id='VALID' and order_no in('VALID-2','VALID-4');
   update ar_collected_orders set member_level=null,recharge_count=null where order_no='VALID-6';
   insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel,member_level,recharge_count)values
   ('AR','IN','91CLUB','recharge','EDGE-MISSING',null,0,'unknown','2026-10-10 10:00:02','route-b',null,null),
   ('AR','IN','91CLUB','recharge','EDGE-BLANK',null,0,'待支付','2026-10-10 10:00:03','  ',0,0),
   ('AR','IN','91CLUB','recharge','EDGE-OUTSIDE','EDGE',0,'待支付','2026-10-10 15:00:00','outside-only',0,0);`);
  const edgeRequests=[base,{...base,providers:['CombinedPay']},{...base,providers:['ABSENT']},{...base,providers:[]},
   {...base,startAt:'2026-10-10T10:00:01+05:30',endAt:'2026-10-10T10:00:07+05:30'},
   {...base,startAt:'2026-10-10T10:00:01+05:30',endAt:'2026-10-10T10:00:07+05:30',providers:['CombinedPay']},
   {...base,startAt:'2026-10-10T20:00:00+05:30',endAt:'2026-10-10T21:00:00+05:30'},
   {...base,startAt:'2026-10-10T10:00:01+05:30',endAt:'2026-10-10T10:00:07+05:30',providers:['outside-only']}];
  await db.exec(candidate);const edges=[];for(const q of edgeRequests)edges.push(await call(q));
  assert(edges[1].coverage.missingMemberCount>0);assert(edges[1].coverage.unknownStatusCount>0);
  assert.equal(edges[6].coverage.orderCount,0);assert.equal(edges[7].coverage.orderCount,0);
  await installIndex();for(let i=0;i<edgeRequests.length;i++)assert.deepEqual(await call(edgeRequests[i]),edges[i],'alias/clock/missing boundary '+i);

  await db.exec('rollback to savepoint edge_cases');await db.exec(candidate);
  await db.exec('savepoint timezone_edges');
  for(const timezone of ['Asia/Calcutta','UTC','Europe/Berlin']){
   await db.query('update fixture_platforms set timezone=$1 where id=$2',[timezone,f.ids.ar]);
   const zoneRequests=[base,{...base,startAt:'2026-10-10T00:00:00Z',endAt:'2026-10-11T00:00:00Z'},
    {...base,startAt:'2026-10-10T04:30:02Z',endAt:'2026-10-10T04:30:03Z'},
    {...base,startAt:'2026-10-09T18:29:59.999999Z',endAt:'2026-10-10T18:30:00.000001Z'}];
   await db.exec(candidate);const zoneExpected=[];for(const q of zoneRequests)zoneExpected.push(await call(q));
   await installIndex();for(let i=0;i<zoneRequests.length;i++)assert.deepEqual(await call(zoneRequests[i]),zoneExpected[i],'native time zone '+timezone+' window '+i);
  }
  await db.query('update fixture_platforms set timezone=$1 where id=$2',['Europe/Berlin',f.ids.ar]);
  await db.query(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel,member_level,recharge_count)
   select 'AR','IN','91CLUB','recharge','DST-'||i,'SYNTHETIC-DST',0,'待支付',timestamp '2026-10-25 02:00:00'+i*interval '1 second','route-a',0,0 from generate_series(1,20)i`);
  await db.exec("select private.approve_ar_91club_submission_day('2026-10-25');select private.approve_ar_91club_submission_day('2026-10-26')");
  const dstRequest={...base,startAt:'2026-10-25T00:30:00Z',endAt:'2026-10-25T01:15:00Z'};
  await db.exec(candidate);const dstExpected=await call(dstRequest);assert.equal(dstExpected.coverage.orderCount,20);
  await installIndex();assert.deepEqual(await call(dstRequest),dstExpected,'non-India DST fold must use unchanged UTC semantics');
  await db.exec('rollback to savepoint timezone_edges');await db.exec(candidate);
  await installIndex();
  // The projected scan may omit redundant identity columns only while exact,
  // validated native population constraints are proven. Any drift must route
  // back to the unmodified native reader, including a foreign private fact.
  const identityDrifts=[
   'alter table private.ar_91club_submission_facts drop constraint ar91_submission_population_check',
   'alter table private.ar_91club_submission_facts rename constraint ar91_submission_population_check to synthetic_population_renamed',
   'alter table private.ar_91club_submission_facts drop constraint ar91_submission_population_check;alter table private.ar_91club_submission_facts add constraint ar91_submission_population_check check(source_system=\'AR\')',
   'alter table private.ar_91club_submission_facts drop constraint ar91_submission_population_check;alter table private.ar_91club_submission_facts add constraint ar91_submission_population_check check(source_system=\'AR\')not valid'];
  for(const change of identityDrifts){
   await db.exec('savepoint identity_drift');await db.exec(change);
   assert.equal((await db.query("select private.ar_91club_submission_generation()g,private.ar_91club_submission_can_read('2026-10-10','2026-10-11')b")).rows[0].g,null);
   assert.equal((await db.query("select private.ar_91club_submission_can_read('2026-10-10','2026-10-11')b")).rows[0].b,false);
   for(let i=0;i<requests.length;i++)assert.deepEqual(await call(requests[i]),expected[i],'identity proof drift native fallback '+i);
   await assert.rejects(()=>db.exec(indexPatch),/generation_invalid/);
   await db.exec('rollback to savepoint identity_drift');
  }
  await db.exec('savepoint foreign_fact');await db.exec('alter table private.ar_91club_submission_facts drop constraint ar91_submission_population_check');
  const {columns}=require(path.join(tests,'fixtures/ar-91club-submission-projection-harness.cjs'));
  await db.exec(`insert into private.ar_91club_submission_facts(${columns.join(',')})select ${columns.join(',')} from ar_collected_orders where order_no='FOREIGN-PLATFORM'and platform='OTHER-PLATFORM'`);
  assert.equal((await db.query("select count(*)n from private.ar_91club_submission_facts where platform='OTHER-PLATFORM'")).rows[0].n,1);
  for(let i=0;i<requests.length;i++)assert.deepEqual(await call(requests[i]),expected[i],'foreign facts cannot enter output under invalid population proof '+i);
  await assert.rejects(()=>db.exec(indexPatch),/generation_invalid/);
  await db.exec('rollback to savepoint foreign_fact');await db.exec(candidate);


  await installIndex();const indexAfter=await info(db);await db.exec(indexPatch);assert.deepEqual(await info(db),indexAfter,'replay retains body, owner, ACL and settings');
  await db.exec(cecBaseline);const beforeIndex=await info(db);
  const indexDrifts=[cecBaseline.replace('declare\n','declare\n -- synthetic unknown parent body\n'),
   'alter function private.dashboard_admin_live_submission_analysis(jsonb)set jit=on',
   'alter function private.dashboard_admin_live_submission_analysis(jsonb)security invoker',
   'alter function private.dashboard_admin_live_submission_analysis(jsonb)volatile',
   'alter function private.dashboard_admin_live_submission_analysis(jsonb)parallel safe',
   'alter function private.dashboard_admin_live_submission_analysis(jsonb)strict',
   'alter function private.dashboard_admin_live_submission_analysis(jsonb)leakproof',
   'grant execute on function private.dashboard_admin_live_submission_analysis(jsonb)to anon',
   'grant execute on function private.dashboard_admin_live_submission_analysis(jsonb)to public',
   'grant execute on function private.dashboard_admin_live_submission_analysis(jsonb)to authenticated with grant option',
   'alter function private.ar_91club_submission_can_read(date,date)set jit=on',
   'alter table ar_collected_orders disable trigger ar91_submission_fact_sync_update'];
  for(const change of indexDrifts){await db.exec('savepoint index_migration_guard');await db.exec(change);await assert.rejects(()=>db.exec(indexPatch),/drift|generation_invalid/);await db.exec('rollback to savepoint index_migration_guard');assert.deepEqual(await info(db),beforeIndex,'failed guard preserves exact parent');}
  await db.exec(candidate);
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
  console.log(JSON.stringify({offline:true,synthetic_only:true,baseline_hash:'325c95878225f211b91aed89c7abae86',candidate_hash:indexAfter.hash,index_only:true,index_identity_drift_cases:identityDrifts.length,index_metadata_drift_cases:indexDrifts.length,extra_alias_requests:edgeRequests.length,extra_timezone_requests:13,requests:requests.length,other_source_requests:foreignRequests.length,migration_replay:true,migration_drift_rejected:true,projected_branch_verified:true,full_json_differences:0,fallback_json_differences:0,ignored_volatile_keys:['asOf'],same_snapshot:'repeatable_read_no_fact_mutations',denied_hidden_platform:true}));
 } finally {await db.close();}
}
require('node:test')('proved index-only identity omission preserves complete DTOs and rejects population proof drift',main);
