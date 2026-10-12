// Complete RPC JSON differential checks in local PostgreSQL; every account and
// order is synthetic. No production access, credentials or workspace fixture.
const {test,before,beforeEach,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const repo=path.resolve(__dirname,'..'),tests=__dirname,read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const baseline=read('tests/fixtures/ar-submission-typed-fact-production.sql');
const guarded=read('supabase/migrations/20261012065610_ar_okwin_submission_proven_fact_reader.sql');
const fragments=guarded.match(/replace\(v_body,\$old\$([^$]*?)\$old\$,\$new\$([\s\S]*?)\$new\$\)/);assert(fragments);
assert.equal(baseline.split(fragments[1]).length,2);
const patch=baseline.replace(fragments[1],fragments[2]);
const migration=patch;
const guardedFragment=guarded.slice(guarded.indexOf('lock table'),guarded.lastIndexOf('commit;'));
const helper=read('tests/fixtures/ar-submission-native-null-amount-helper.sql');
const nativeFile=path.join(tests,'ar-submission-native-null-members-sql.test.cjs'),realRequire=createRequire(nativeFile);
let setup,db,f,seedOther,receipts,yash,metadata,comparisons=0,fastRequests=0;
const ctx=vm.createContext({__dirname:tests,require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,beforeEach(){},after(){}}:realRequire(n)});
vm.runInContext(fs.readFileSync(nativeFile,'utf8').split(/\ntest\(/)[0]+'\nglobalThis.fixture={get db(){return db},get f(){return f},get seed(){return seed},get receipts(){return receipts},get yash(){return yash},installCurrent:()=>db.exec(patch)};',ctx);
const info=async()=>(await db.query("select md5(prosrc) hash,pg_get_functiondef(oid) definition,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure")).rows[0];
const base={operation:'summary',charts:false,startAt:'2026-10-10T00:00:00+05:30',endAt:'2026-10-11T00:00:00+05:30'};
const call=async q=>{const r=await f.call(f.request({...base,...q}));delete r.asOf;return r;};
const metric=(r,t=15,p=null)=>r.metrics.find(x=>x.threshold===t&&x.provider===p);
async function seed(member,n=20,{platform='OKWIN',country='IN',day='2026-10-10'}={}){
 await db.query(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel,member_level,recharge_count)
 select 'AR',$3,$4,'recharge',$1||'-'||i,$1,case when i=1 then 0 else 123.45 end,'待支付',$5::date+time '10:00'+i*interval '1 second',case when i%2=0 then 'route-a' else 'Other Pay' end,0,0 from generate_series(1,$2::int)i`,[member,n,country,platform,day]);
}
async function approve(){
 try{
 for(const day of ['2026-10-10','2026-10-11']){await db.exec('begin isolation level repeatable read');await db.query("select private.begin_ar_submission_fact_day('IN','OKWIN',$1)",[day]);for(let hour=0;hour<24;hour++)await db.query("select private.verify_ar_submission_fact_hour('IN','OKWIN',$1,$2)",[day,hour]);await db.query("select private.approve_ar_submission_fact_day('IN','OKWIN',$1)",[day]);await db.exec('commit');}
 await db.exec("begin isolation level repeatable read;select private.approve_ar_submission_fact_null('IN','OKWIN');select private.approve_ar_submission_fact_future('IN','OKWIN');commit");assert.equal((await db.query("select private.ar_submission_fact_can_read('IN','OKWIN','2026-10-10','2026-10-12')b")).rows[0].b,true);
 }catch(e){await db.exec('rollback');throw e;}
}
async function compare(qs){
 await approve();
 await db.exec('begin isolation level repeatable read');
 try{await db.exec(baseline);const old=[];for(const q of qs)old.push(await call(q));await db.exec(patch);
  for(let i=0;i<qs.length;i++){assert.deepEqual(await call(qs[i]),old[i],'full RPC difference '+JSON.stringify(qs[i]));comparisons++;if(!qs[i].platformId&&qs[i].operation!=='members'&&qs[i].operation!=='memberOrders'&&!qs[i].charts)fastRequests++;}
  assert.deepEqual((await info()).metadata,metadata);return old;
 }finally{await db.exec('rollback');}
}
before(async()=>{
 await setup();({db,f,seed:seedOther,receipts,yash}=ctx.fixture);await f.as(f.owner);await ctx.fixture.installCurrent();
 const h=require(path.join(tests,'fixtures/ar-91club-submission-projection-harness.cjs'));
 await db.exec('drop table ar_collected_orders cascade');await db.exec(h.sourceDDL);
 await db.exec('revoke all on function private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)from public,anon,authenticated,service_role');
 await db.exec(h.local(h.stage1()));await db.exec(h.stage2());
 await db.exec(baseline);await db.exec(read('supabase/migrations/20261012063352_ar_submission_typed_fact_install.sql'));await db.exec(read('supabase/migrations/20261012063953_ar_submission_typed_fact_proofs.sql'));metadata=(await info()).metadata;assert.equal((await info()).hash,'a8f8bb5de7d906675f5176c5eb4fcb70');
});
beforeEach(async()=>{
 await db.exec('rollback;reset role');await f.as(f.owner);await db.exec(baseline);await db.exec(helper);
 await db.exec('truncate ar_collected_orders,private.ar_91club_submission_facts,private.ar_submission_typed_facts,newar_detail_records,lg_orders,game66_charge_orders,private.yash_orders,private.yash_sync_windows');
 await db.query("update fixture_platforms set source_name='OKWIN',name='OKWIN',scope_group='IN',country='印度',timezone='Asia/Kolkata',currency='INR' where id=$1",[f.ids.ar]);
});
after(async()=>{console.log(JSON.stringify({synthetic_only:true,full_rpc_json_comparisons:comparisons,proved_projected_request_comparisons:fastRequests,ignored_volatile_keys:['asOf']}));await db?.close();});

test('whole-day qualifications, all operations, strict thresholds and native members retain the complete RPC response',async()=>{
 for(const m of ['VALID','PAID','PRIOR','LATER','UNKNOWN','UNDATED','0001','1','未知原生成员','UNKNOWN-MONEY'])await seed(m);
 for(const n of [10,11,15,16,20,21,30,31,50,51,100,101])await seed('THRESHOLD-'+n,n);
 await db.exec(`update ar_collected_orders set status='已支付',completed_at='2026-10-10 14:00' where order_no='PAID-19';
 update ar_collected_orders set status='已支付',completed_at='2026-10-11 14:00' where order_no='LATER-19';
 update ar_collected_orders set status='unknown' where order_no='UNKNOWN-19';
 update ar_collected_orders set applied_at=null,raw_channel='Unselected provider' where order_no='UNDATED-19';
 update ar_collected_orders set amount=null where order_no='UNKNOWN-MONEY-19';
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,completed_at,raw_channel)values
 ('AR','IN','OKWIN','recharge','PRIOR-SUCCESS','PRIOR',1,'已支付','2026-10-09 10:00','2026-10-10 14:00','Other Pay'),
 ('AR','IN','OTHER-PLATFORM','recharge','FOREIGN-PLATFORM','VALID',1,'unknown',null,null,'Other Pay'),
 ('AR','PK','OKWIN','recharge','FOREIGN-COUNTRY','VALID',1,'unknown',null,null,'Other Pay'),
 ('AR','IN','OKWIN','withdraw','FOREIGN-DIRECTION','VALID',1,'unknown',null,null,'Other Pay'),
 ('OTHER','IN','OKWIN','recharge','FOREIGN-SOURCE','VALID',1,'unknown',null,null,'Other Pay');`);
 const qs=[{}, {charts:true},{providers:['CombinedPay']},{providers:['ABSENT']},{providers:[]},
  ...[10,15,20,30,50,100].map(threshold=>({threshold})),
  ...['all','new','funded','unknown','l0'].map(level=>({operation:'members',level,providers:['CombinedPay']})),
  ...['VALID','PAID','PRIOR','LATER','UNKNOWN','UNDATED','0001','1','未知原生成员','UNKNOWN-MONEY'].map(memberId=>({operation:'memberOrders',memberId,day:'2026-10-10',providers:['CombinedPay'],limit:100}))];
 const r=await compare(qs);assert.deepEqual(r[0].metrics,r[1].metrics);assert.deepEqual(r[0].coverage,r[1].coverage);assert.equal(r[0].dashboard,null);assert.equal(r[0].coverage.sourceCompletenessVerified,false);
 assert(r[0].coverage.unknownStatusCount>0);assert(r[0].coverage.orderSequenceUncertainCount>0);assert.equal(metric(r[3]).invalid_count,0);assert.equal(r[3].coverage.orderCount,0);
 const orders=r.slice(-10);assert.equal(orders[0].total,10);for(const o of orders.slice(1,6))assert.equal(o.total,0);
 for(let i=6;i<9;i++)assert.equal(orders[i].rows[0].member_id,qs[qs.length-10+i].memberId);
 assert.equal(orders[9].total,10);assert.equal(metric(r[0]).invalid_amount,null,'unknown money does not become zero or alter eligibility');
});

test('selected clocks, canonical provider pools, null identities and duplicate order IDs preserve coverage and dimensions',async()=>{
 for(const m of ['VALID','UNSELECTED-UNKNOWN','UNSELECTED-PAID','DUP'])await seed(m);
 await db.exec(`update ar_collected_orders set raw_channel='route-b' where order_no='VALID-2';
 update ar_collected_orders set status='unknown',raw_channel='Other Pay' where order_no='UNSELECTED-UNKNOWN-19';
 update ar_collected_orders set status='已支付',raw_channel='Other Pay',completed_at='2026-10-10 13:00' where order_no='UNSELECTED-PAID-19';
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel)values
 ('AR','IN','OKWIN','recharge','NO-MEMBER',null,0,'unknown','2026-10-10 10:00:02','route-b'),
 ('AR','IN','OKWIN','recharge','EMPTY-MEMBER',' ',0,'待支付','2026-10-10 10:00:03','  '),
 ('AR','IN','OKWIN','recharge','CLOCK-EDGE','VALID',0,'待支付','2026-10-11 00:00','outside-only');`);
 // Duplicate order identity remains protected even in a source whose unique
 // constraint has drifted. The old distinct check is deliberately retained.
 await db.exec('begin');await db.exec('alter table ar_collected_orders drop constraint ar_collected_orders_pkey cascade');
 await db.exec("insert into ar_collected_orders select * from ar_collected_orders where order_no='DUP-20'");await db.exec('savepoint seeded');
 const qs=[{}, {providers:['CombinedPay']},{providers:['Unselected']},
 {providers:['CombinedPay'],startAt:'2026-10-10T10:00:01+05:30',endAt:'2026-10-10T10:00:07+05:30'},
 {startAt:'2026-10-10T10:00:01+05:30',endAt:'2026-10-10T10:00:02+05:30'},
 {startAt:'2026-10-10T20:00:00+05:30',endAt:'2026-10-10T21:00:00+05:30'},
 {endAt:'2026-10-12T00:00:00+05:30'},{operation:'memberOrders',memberId:'DUP',day:'2026-10-10'}];
 try{await db.exec(baseline);const old=[];for(const q of qs)old.push(await call(q));await db.exec(patch);for(let i=0;i<qs.length;i++){assert.deepEqual(await call(qs[i]),old[i]);comparisons++;if(!qs[i].platformId&&qs[i].operation!=='members'&&qs[i].operation!=='memberOrders'&&!qs[i].charts)fastRequests++;}
  assert(old[1].coverage.missingMemberCount>0);assert(old[1].coverage.unknownStatusCount>0);assert(old[0].coverage.orderSequenceUncertainCount>0);assert.equal(old.at(-1).total,0);assert.equal(old[5].coverage.orderCount,0);
 }finally{await db.exec('rollback');}
});

test('native money zero/scale/invalid metadata remains exact, while only qualified selected orders evaluate the current money helper',async()=>{
 await seed('VALID');await seed('PAID');await seed('BELOW',10);
 await db.exec(`update ar_collected_orders set money_format_version=1,amount_local=0,currency_local='INR' where order_no='VALID-2';
 update ar_collected_orders set money_format_version=1,amount_local=123.45678901,currency_local='INR' where order_no='VALID-4';
 update ar_collected_orders set money_format_version=1,amount_local=9,currency_local='USD' where order_no='VALID-6';
 update ar_collected_orders set money_issue_code='LOCAL_AMOUNT_STALE_FOR_USDT' where order_no='VALID-8';
 update ar_collected_orders set status='已支付',completed_at='2026-10-10 13:00' where order_no='PAID-19';`);
 await compare([{},{providers:['CombinedPay']},{operation:'memberOrders',memberId:'VALID',day:'2026-10-10',limit:100}]);
 await db.exec(migration);await db.exec('begin');
 try{await db.exec(`create sequence money_calls;create or replace function private.dashboard_admin_ar_local_amount(p_country text,p_kind text,p_channel_type text,p_version smallint,p_local numeric,p_local_currency text,p_issue text,p_legacy_display numeric)returns numeric language plpgsql volatile set search_path='' as $$begin perform nextval('public.money_calls');return 7;end$$`);
  const r=await call({providers:['CombinedPay']});assert.equal((await db.query('select last_value from money_calls')).rows[0].last_value,10,'one current-helper evaluation per qualified selected order');assert.equal(metric(r).invalid_amount,'70');
 }finally{await db.exec('rollback');}
});

test('timezone and optional member-column fallback retain old regex and native local-day boundaries',async()=>{
 await seed('VALID');
 for(const zone of ['UTC','Asia/Calcutta','Europe/Berlin']){await db.query('update fixture_platforms set timezone=$1 where id=$2',[zone,f.ids.ar]);await compare([{}, {startAt:'2026-10-10T04:30:02Z',endAt:'2026-10-10T04:30:03Z'},{startAt:'2026-10-09T18:29:59.999999Z',endAt:'2026-10-10T18:30:00.000001Z'}]);}
 await db.exec('begin');
 try{await db.exec('alter table ar_collected_orders drop column member_level,drop column recharge_count');await db.exec(baseline);const old=await call({});await db.exec(patch);assert.deepEqual(await call({}),old);comparisons++;assert.equal(old.coverage.missingLevelCount,20);assert.equal(old.coverage.missingRechargeCount,20);}finally{await db.exec('rollback');}
});

test('NEWAR, LG, GAME66, YASH and non-IN AR continue to use their original source and authorization paths',async()=>{
 for(const kind of ['newar','lg','game','yash'])await seedOther(kind,'OTHER');await receipts();const qs=[];
 for(const [platformId,zone,currency]of [[f.ids.newar,'+05:45','NPR'],[f.ids.lg,'+08:00','PHP'],[f.ids.game,'+05:30','INR'],[yash,'+05:30','INR']])for(const operation of ['summary','members','memberOrders'])for(const charts of [true,false])qs.push({platformId,startAt:'2026-10-02T00:00:00'+zone,endAt:'2026-10-03T00:00:00'+zone,currency,operation,charts,...(operation==='memberOrders'?{memberId:'OTHER',day:'2026-10-02'}:{})});
 await compare(qs);await seed('BR-MEMBER',20,{country:'BR'});await db.query("update fixture_platforms set scope_group='BR',country='巴西',currency='BRL',timezone='America/Sao_Paulo' where id=$1",[f.ids.ar]);
 await compare([{currency:'BRL',startAt:'2026-10-10T00:00:00-03:00',endAt:'2026-10-11T00:00:00-03:00'}]);
});

test('the exact 91CLUB proved branch remains byte-identical and runs with real readiness proofs',async()=>{
 await db.query("update fixture_platforms set source_name='91CLUB',name='91CLUB' where id=$1",[f.ids.ar]);await seed('NATIVE',20,{platform:'91CLUB'});
 await db.exec("begin isolation level repeatable read;select private.approve_ar_91club_submission_day('2026-10-10');select private.approve_ar_91club_submission_day('2026-10-11');select private.approve_ar_91club_submission_null();select private.approve_ar_91club_submission_future();commit");
 assert.equal((await db.query("select private.ar_91club_submission_can_read('2026-10-10','2026-10-11')b")).rows[0].b,true);
 const r=await compare([{}, {charts:true},{providers:['CombinedPay']},{startAt:'2026-10-09T00:00:00+05:30',endAt:'2026-10-10T00:00:00+05:30'},{operation:'members'},{operation:'memberOrders',memberId:'NATIVE',day:'2026-10-10'}]);assert.equal(metric(r[0]).invalid_count,20);
 await db.exec(migration);const candidate=(await info()).definition;const anchor=" if v_platform.source='ar' and v_platform.scope_group='IN' and v_platform.source_name='91CLUB'\n  and v_operation='summary' and not v_charts";
 assert.equal(candidate.slice(candidate.indexOf(anchor)),baseline.slice(baseline.indexOf(anchor)),'entire proved91 branch and security/response suffix unchanged');
});

test('owner/ACL/settings/OID remain exact, replay is stable and unauthorized actual RPC access still fails',async()=>{
 await db.exec(guarded);const next=await info();assert.equal(next.hash,'5b026afa37c300143302323eeccb6def');assert.deepEqual(next.metadata,metadata);await db.exec(guarded);assert.deepEqual(await info(),next);
 await f.as(f.viewer);await assert.rejects(()=>call({platformId:f.ids.hidden}),/platform_denied/);await assert.rejects(()=>call({}),/platform_denied/);await f.as(f.owner);
 for(const role of ['anon','service_role']){await db.exec('set role '+role);try{await assert.rejects(()=>db.query('select private.dashboard_admin_live_submission_analysis($1::jsonb)',[JSON.stringify(f.request(base))]),/permission denied/);}finally{await db.exec('reset role');}}
});

test('invalid generation and partial readiness take the native fallback, never partial projected facts',async()=>{
 await seed('VALID');await approve();await db.exec(baseline);const old=await call({});
 const states=['delete from private.ar_submission_null_ready',"delete from private.ar_submission_day_ready where data_date='2026-10-10'",'alter table private.ar_submission_typed_facts disable row level security','alter table public.ar_collected_orders disable trigger ar_sub_fact_source_update'];
 for(const state of states){await db.exec('begin');try{await db.exec(state);await db.exec(migration);assert.deepEqual(await call({}),old);comparisons++;}finally{await db.exec('rollback');}}
 await db.exec('begin');try{await db.exec("update private.ar_submission_typed_facts set amount=999999 where order_no='VALID-1'");assert.equal((await db.query("select private.ar_submission_fact_can_read('IN','OKWIN','2026-10-10','2026-10-11')b")).rows[0].b,false);await db.exec(migration);assert.deepEqual(await call({}),old);comparisons++;}finally{await db.exec('rollback');}
});


test('runtime input-name drift returns native output without calling a broken proof helper; guarded install rejects all metadata drift atomically',async()=>{
 await seed('VALID');await approve();await db.exec(baseline);const old=await call({});
 for(const signature of ['private.ar_submission_fact_generation(text,text)','private.ar_submission_fact_can_read(text,text,date,date)']){
  await db.exec('begin');try{
   const fn=(await db.query('select pg_get_functiondef($1::regprocedure)d,md5(prosrc)hash from pg_proc where oid=$1::regprocedure',[signature])).rows[0];
   await db.exec('drop function '+signature);await db.exec(fn.d.replace('p_country text','unexpected_country text'));await db.exec('revoke all on function '+signature+' from public,anon,authenticated,service_role');
   assert.equal((await db.query('select md5(prosrc)hash from pg_proc where oid=$1::regprocedure',[signature])).rows[0].hash,fn.hash,'the body remains exactly original despite invalid parameter names');
   await db.exec(migration);assert.deepEqual(await call({}),old);comparisons++;
   await assert.rejects(()=>db.exec(guardedFragment),/AR_OKWIN_READER_PROOF_PREREQUISITE_DRIFT/);
  }finally{await db.exec('rollback');}
 }
 for(const change of [
  'alter function private.dashboard_admin_live_submission_analysis(jsonb)set jit=on',
  'grant execute on function private.ar_submission_fact_can_read(text,text,date,date)to authenticated',
  'alter function private.approve_ar_submission_fact_future(text,text)security definer',
  'alter table private.ar_submission_typed_facts disable row level security'
 ]){
  await db.exec('begin');try{await db.exec(change);await assert.rejects(()=>db.exec(guardedFragment),/AR_OKWIN_READER_(?:METADATA_DRIFT|PROOF_PREREQUISITE_DRIFT|GENERATION_INVALID)/);}finally{await db.exec('rollback');}
  assert.equal((await info()).hash,'a8f8bb5de7d906675f5176c5eb4fcb70');
 }
});
