// Offline synthetic PostgreSQL compares the exact reviewed production body.
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const migration=read('supabase/migrations/20261010100701_submission_shared_aggregation_single_pass.sql');
const nativePatch=read('supabase/migrations/20261010074216_submission_member_order_native_status.sql');
let setup,db,f,baseline,metadata,yash;
const context=vm.createContext({__dirname,require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,beforeEach(){},after(){}}:require(n)});
vm.runInContext(read('tests/submission-member-order-native-status-sql.test.cjs').split(/\ntest\(/)[0]+'\nglobalThis.fixture={get db(){return db},get f(){return f}};',context);
const info=async()=>(await db.query("select pg_get_functiondef(oid) definition,md5(prosrc) hash,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure")).rows[0];
const strip=r=>{delete r.asOf;return r;};
const call=extra=>f.call(f.request({startAt:'2026-10-02T00:00:00Z',endAt:'2026-10-03T00:00:00Z',...extra}));
async function compare(requests){
 await db.exec(baseline);const expected=[];for(const q of requests)expected.push(strip(await call(q)));
 await db.exec(migration);for(let i=0;i<requests.length;i++)assert.deepEqual(strip(await call(requests[i])),expected[i],JSON.stringify(requests[i]));return expected;
}
async function seed(kind,member,n=20){
 if(kind==='ar')await db.query(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel,member_level,recharge_count)
 select 'AR','IN','AR-RAW','recharge',$1||'-'||i,$1,case when i=1 then 0 else 123.45678901 end,'待支付',timestamp '2026-10-02 10:00'+i*interval '1 second',case when i%2=0 then 'route-a' else 'Other Pay' end,'LV0',0 from generate_series(1,$2::int)i`,[member,n]);
 else if(kind==='newar')await db.query(`insert into newar_detail_records(platform,dataset,source_id,order_number,member_id,provider,currency,status_group,status_code,amount,created_at,raw)
 select 'NEW-RAW','charge',$1||'-'||i,$1||'-'||i,$1,case when i%2=0 then 'route-a' else 'Other Pay' end,'NPR','pending','Wait',case when i=1 then 0 else 123.45678901 end,'2026-10-02T10:00:00+05:45'::timestamptz+i*interval '1 second','{"rechargeLevel":"LV0","rechargeCount":0}' from generate_series(1,$2::int)i`,[member,n]);
 else if(kind==='lg')await db.query(`insert into lg_orders(source_system,country_code,platform,order_kind,order_no,member_id,third_party,metric_amount,status_class,status_text,status_code,created_at)
 select 'LG','PH','LG-RAW','recharge',$1||'-'||i,$1,case when i%2=0 then 'route-a' else 'Other Pay' end,case when i=1 then 0 else 123.45678901 end,'pending','Native pending',9,'2026-10-02T10:00:00+08:00'::timestamptz+i*interval '1 second' from generate_series(1,$2::int)i`,[member,n]);
 else if(kind==='game')await db.query(`insert into game66_charge_orders(platform_id,order_num,uid,create_time,status_code,pay_method_name,amount_display)
 select $3::uuid,$1||'-'||i,$1,'2026-10-02T10:00:00+05:30'::timestamptz+i*interval '1 second','0',case when i%2=0 then 'route-a' else 'Other Pay' end,case when i=1 then 0 else 123.45678901 end from generate_series(1,$2::int)i`,[member,n,f.ids.game]);
 else if(kind==='yash')await db.query(`insert into private.yash_orders(source_site,order_type,order_no,uid,status,amount,currency,supplier,created_at,source_timezone)
 select 'yash','deposit',$1||'-'||i,$1,'已创建',case when i=1 then 0 else 123.45678901 end,'INR',case when i%2=0 then 'route-a' else 'Other Pay' end,'2026-10-02T10:00:00+05:30'::timestamptz+i*interval '1 second','UTC+08:00' from generate_series(1,$2::int)i`,[member,n]);
}
async function receipts(){await db.exec(`insert into private.yash_sync_windows(order_type,stream,start_at,end_exclusive,source_count,uploaded_count,stored_count,complete,observed_at,source_timezone)
 select 'deposit',s,'2026-10-02T00:00:00+05:30','2026-10-03T00:00:00+05:30',n,n,n,true,'2026-10-03T01:00:00+05:30','UTC+08:00'
 from (values('createTime'),('completeTime'))streams(s) cross join lateral (select count(*) n from private.yash_orders where (case when s='createTime' then created_at else completed_at end)>='2026-10-02T00:00:00+05:30' and (case when s='createTime' then created_at else completed_at end)<'2026-10-03T00:00:00+05:30') counts;`);}
before(async()=>{await setup();db=context.fixture.db;f=context.fixture.f;await db.exec(nativePatch);const current=await info();assert.equal(current.hash,'219db2fb64d519ce975a5a2a907cd6db');baseline=current.definition;metadata=current.metadata;yash=(await db.query("select md5('kb:IN:YASH.BET')::uuid id")).rows[0].id;});
beforeEach(async()=>{await f.as(f.owner);await db.exec(baseline);await db.exec('truncate ar_collected_orders,newar_detail_records,lg_orders,game66_charge_orders,private.yash_orders,private.yash_sync_windows');});
after(async()=>db?.close());

test('all five native sources retain exact summary, members and order pages across provider and half-open clock scopes',async()=>{
 const specs=[['ar',f.ids.ar,'+05:30','INR'],['newar',f.ids.newar,'+05:45','NPR'],['lg',f.ids.lg,'+08:00','PHP'],['game',f.ids.game,'+05:30','INR'],['yash',yash,'+05:30','INR']];
 for(const [kind]of specs)await seed(kind,'VALID');await receipts();
 const queries=[];for(const [kind,platformId,zone,currency]of specs){const q={platformId,startAt:'2026-10-02T00:00:00'+zone,endAt:'2026-10-03T00:00:00'+zone,currency};for(const patch of [{},{providers:['CombinedPay']},{providers:['Other Pay'],startAt:'2026-10-02T10:00:01'+zone,endAt:'2026-10-02T10:00:08'+zone}])for(const operation of ['summary','members','memberOrders'])queries.push({...q,...patch,operation,...(operation==='memberOrders'?{memberId:'VALID',day:'2026-10-02',limit:20,offset:0}:{})});}
 const results=await compare(queries);assert(results.filter(r=>r.operation==='memberOrders').every(r=>r.total>0));
});
test('cross-provider success, later completion, unknown status and repeated or absent order/time identity preserve exclusions and coverage',async()=>{
 for(const member of ['VALID','PAID','PRIOR','LATER','UNKNOWN','DUP','UNDATED','BLANK'])await seed('newar',member);
 await db.exec(`update newar_detail_records set status_group='success',success_at='2026-10-02T12:00:00+05:45' where source_id='PAID-19';
 update newar_detail_records set status_group='success',success_at='2026-10-03T12:00:00+05:45' where source_id='LATER-20';
 update newar_detail_records set status_group='unknown',status_code='Unexpected' where source_id='UNKNOWN-19';
 update newar_detail_records set order_number='DUPLICATE' where member_id='DUP';
 update newar_detail_records set created_at=null where source_id='UNDATED-20';
 update newar_detail_records set order_number='  ' where source_id='BLANK-20';
 insert into newar_detail_records(platform,dataset,source_id,order_number,member_id,provider,currency,status_group,status_code,amount,created_at)
 values('NEW-RAW','charge','PRIOR-SUCCESS','PRIOR-SUCCESS','PRIOR','Other Pay','USD','success','Payed',1,'2026-10-01T10:00:00+05:45');
 update newar_detail_records set success_at='2026-10-02T14:00:00+05:45' where source_id='PRIOR-SUCCESS';`);
 const q={platformId:f.ids.newar,currency:'NPR',providers:['CombinedPay']},requests=[{...q},{...q,operation:'members'},...['VALID','PAID','PRIOR','LATER','UNKNOWN','DUP','UNDATED','BLANK'].map(memberId=>({...q,operation:'memberOrders',memberId,day:'2026-10-02',limit:100}))];
 const results=await compare(requests);assert(results[0].coverage.orderSequenceUncertainCount>0);assert.equal(results[2].total,10);assert(results.slice(3).every(r=>r.total===0));
});
test('strict thresholds, source-level histories, null amounts, currency mismatch and selected missing identities remain unchanged',async()=>{
 for(const n of [10,11,15,16,20,21,30,31,50,51,100,101])await seed('ar','BOUNDARY-'+n,n);await seed('ar','UNKNOWN-MONEY');await seed('ar','UNPLACED');
 await db.exec(`update ar_collected_orders set amount=null where order_no='UNKNOWN-MONEY-1';
 update ar_collected_orders set member_level=null,recharge_count=null where member_id='UNKNOWN-MONEY';
 update ar_collected_orders set applied_at=null,raw_channel=null where order_no in ('UNPLACED-19','UNPLACED-20');
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel) values
 ('AR','IN','AR-RAW','recharge','NO-MEMBER',null,0,'unknown','2026-10-02 10:00','route-a');`);
 const requests=[];for(const threshold of [10,15,20,30,50,100])for(const operation of ['summary','members'])requests.push({threshold,operation});for(const level of ['all','l0','new','funded','unknown'])requests.push({operation:'members',level});requests.push({operation:'memberOrders',memberId:'UNKNOWN-MONEY',day:'2026-10-02',limit:100});
 const results=await compare(requests),orders=results.at(-1);assert.equal(orders.rows[0].amount,null);assert.equal(orders.amountGroups.at(-1).total_amount,null);assert(results[0].coverage.missingMemberCount>0);assert(results[0].coverage.orderSequenceUncertainCount>0);
});
test('empty selections, missing time/member values and incomplete YASH proofs remain byte-equivalent',async()=>{
 await seed('newar','MIXED');await db.exec("update newar_detail_records set currency='USD' where source_id='MIXED-20';update newar_detail_records set member_id=null,raw='{}' where source_id='MIXED-1'");await seed('yash','UNPROVEN');
 const results=await compare([{platformId:f.ids.newar,currency:'NPR'},{platformId:f.ids.newar,currency:'NPR',providers:['Absent']},{platformId:yash,operation:'members'},{platformId:yash,operation:'memberOrders',memberId:'UNPROVEN',day:'2026-10-02',limit:100}]);assert.equal(results[1].coverage.orderCount,0);assert.equal(results[3].total,0);assert.equal(results[3].coverage.calculationComplete,false);
});
test('the guarded replacement retains every security attribute, is reentrant and contains one coverage aggregate and no normalized copy',async()=>{
 await db.exec(migration);const current=await info();assert.equal(current.hash,'ab63c0ce48fe0ab393b4d5e6ef8a4d83');assert.deepEqual(current.metadata,metadata);await db.exec(migration);assert.deepEqual(await info(),current);
 assert.doesNotMatch(current.definition,/normalized_orders|not exists\(select 1 from unplaced_members/);assert.match(current.definition,/from orders left join unplaced_members u using\(member_id\)/);assert.match(current.definition,/and bool_and\(u.member_id is null\) sequence_known/);assert.match(current.definition,/selected_coverage as \([\s\S]*?from selected_orders\n \), selected_member_days/);
 assert.match(current.definition,/with source_rows as not materialized/);assert.match(current.definition,/dashboard_orders as materialized \(\n  select o\.provider,o\.created_at,o\.day,o\.amount,o\.paid,coalesce/);
 await f.as(f.viewer);await assert.rejects(()=>call({platformId:f.ids.newar}),/platform_denied/);await f.as(f.owner);
});
test('function body, settings, PUBLIC/extra/grantable ACL drift fail before any definition changes',async()=>{
 for(const command of [baseline.replace('perform private.dashboard_admin_live_scope();','perform private.dashboard_admin_live_scope(); -- drift'),"alter function private.dashboard_admin_live_submission_analysis(jsonb) set jit=on","grant execute on function private.dashboard_admin_live_submission_analysis(jsonb) to anon","grant execute on function private.dashboard_admin_live_submission_analysis(jsonb) to public","grant execute on function private.dashboard_admin_live_submission_analysis(jsonb) to authenticated with grant option","update pg_proc set proacl=null where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure"]){
  await db.exec(baseline);await db.exec('begin');await db.exec(command);await assert.rejects(()=>db.exec(migration),/definition_drift|acl_drift/);await db.exec('rollback');assert.equal((await info()).hash,'219db2fb64d519ce975a5a2a907cd6db');assert.deepEqual((await info()).metadata,metadata);
 }
});
