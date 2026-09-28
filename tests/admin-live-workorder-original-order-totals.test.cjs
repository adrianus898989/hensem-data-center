// Synthetic original-order cohorts. No production connection or real orders.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=name=>fs.readFileSync(path.join(__dirname,'../supabase',name),'utf8');
const initialPatch=sql('admin-live-workorder-original-order-totals.sql'),patch=sql('admin-live-workorder-unique-single-pass.sql');
const alpha='11111111-1111-4111-8111-111111111111',beta='22222222-2222-4222-8222-222222222222',gamma='33333333-3333-4333-8333-333333333333';
const req={country:'印度',startAt:'2026-09-01T00:00:00+05:30',endAt:'2026-09-02T23:59:59+05:30',limit:20};
let db,legacy,baseAcl;
const call=async extra=>(await db.query('select private.dashboard_admin_live_workorders($1::jsonb) data',[JSON.stringify({...req,...extra})])).rows[0].data;
const byProvider=(r,provider='ArbPay',direction='charge')=>r.byProvider.find(x=>x.provider===provider&&x.direction===direction);
function stripNew(value){if(Array.isArray(value))return value.map(stripNew);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!key.startsWith('unique')).map(([k,v])=>[k,stripNew(v)]));return value;}
async function insert(id,original,amount,{platform='Alpha',direction='deposit',provider='ArbPayINR',status=3,date='2026-09-01',sourceOrder=null,system='AR'}={}){
 await db.query('insert into ar_workorder_issue_details(system_name,country_code,country,platform,work_order_id,work_order_no,payment_order_no,source_order_no,amount,issue_kind,third_party,channel_type,status_code,submitted_date) values($1,\'IN\',\'印度\',$2,$3,$3,$4,$5,$6,$7,$8,\'BANK\',$9,$10)',[system,platform,id,original,sourceOrder,amount,direction,provider,status,date]);
}
async function rebuild(){await db.exec(`delete from workorder_deposit_daily;
 insert into workorder_deposit_daily
 select submitted_date,country_code,country,platform,third_party,channel_type,'AR_WORKORDER',
 count(*) filter(where issue_kind='deposit'),coalesce(sum(amount) filter(where issue_kind='deposit'),0),
 count(*) filter(where issue_kind='deposit' and status_code=4),coalesce(sum(amount) filter(where issue_kind='deposit' and status_code=4),0),
 count(*) filter(where issue_kind='withdraw'),coalesce(sum(amount) filter(where issue_kind='withdraw'),0),
 count(*) filter(where issue_kind='withdraw' and status_code=4),coalesce(sum(amount) filter(where issue_kind='withdraw' and status_code=4),0),now(),now()
 from ar_workorder_issue_details where system_name='AR' group by submitted_date,country_code,country,platform,third_party,channel_type;
 insert into workorder_deposit_daily values('2026-09-01','IN','印度','Gamma','ArbPayINR','BANK','AR_WORKORDER',10,500,2,100,0,0,0,0,now(),now());`);}
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;grant usage on schema private to authenticated;
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin if current_setting('test.active',true)='false' then raise exception 'preview_denied';end if;return coalesce(nullif(current_setting('test.scope',true),'')::jsonb,'{"mode":"all"}'::jsonb);end$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select coalesce($1->>'mode'='all' or $1->'platforms' ? $3,false)$$;
 create table catalog(id uuid,name text,source_name text,country text,scope_group text,source text);
 create function private.dashboard_admin_live_platforms() returns setof public.catalog language sql stable as $$select * from public.catalog where private.dashboard_scope_allows(private.dashboard_admin_live_scope(),country,source_name)$$;
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text);
 create function private.dashboard_admin_live_provider_canonical(text,text,text) returns text language sql stable as $$select $3$$;
 create table workorder_deposit_daily(stat_date date,country_code text,country text,platform text,third_party text,channel_type text,source_system text,submitted_count bigint,submitted_amount numeric,success_count bigint,success_amount numeric,withdraw_not_received_count bigint,withdraw_not_received_amount numeric,withdraw_success_count bigint,withdraw_success_amount numeric,source_updated_at timestamptz default now(),updated_at timestamptz default now());
 create table ar_workorder_issue_details(system_name text,country_code text,country text,platform text,work_order_id text,work_order_no text,payment_order_no text,source_order_no text,amount numeric,issue_kind text,third_party text,channel_type text,status_code integer,submitted_date date,primary key(system_name,country_code,platform,work_order_id));
 create index detail_scope_date on ar_workorder_issue_details(country_code,platform,submitted_date);
 insert into catalog values('${alpha}','Alpha','Alpha','印度','IN','ar'),('${beta}','Beta','Beta','印度','IN','ar'),('${gamma}','Gamma','Gamma','印度','IN','newar');`);
 const config=sql('admin-live-configuration-workorders.sql'),start=config.indexOf('create or replace function private.dashboard_admin_live_workorder_provider(');
 await db.exec(config.slice(start,config.indexOf('\n$$;',start)+4));
 await db.exec(sql('admin-live-workorder-platform-breakdown.sql'));
 await insert('A1-first','A1',100);await insert('A1-second','A1',100,{date:'2026-09-02',status:4});
 await insert('A2-first','A2',200,{status:4});await insert('A2-second','A2',200,{date:'2026-09-02',status:4});
 await insert('missing-original',null,50);
 await insert('conflict-amount-a','C1',300);await insert('conflict-amount-b','C1',301);
 await insert('missing-amount','D1',null);
 await insert('conflict-provider-a','X1',400);await insert('conflict-provider-b','X1',400,{provider:'OtherPay',status:4});
 await insert('beta-same-original','A1',700,{platform:'Beta',status:4});
 await insert('withdraw-first','W1',900,{direction:'withdraw'});
 await insert('withdraw-second','W1',900,{direction:'withdraw',status:4,date:'2026-09-02'});
 await insert('withdraw-missing',null,500,{direction:'withdraw'});
 await insert('newar-not-supported','A1',50,{system:'NEW_AR',platform:'Gamma',status:4});
 await rebuild();legacy=await call();baseAcl=(await db.query("select proacl::text acl from pg_proc where oid='private.dashboard_admin_live_workorders(jsonb)'::regprocedure")).rows[0].acl;
 await db.exec(initialPatch);await db.exec(patch);
});
after(async()=>db?.close());

test('existing summary, provider classification and daily totals are preserved exactly',async()=>{
 assert.deepEqual(stripNew(await call()),legacy);
 const r=await call();assert.equal(r.uniqueOrderVersion,1);assert(r.byProvider.some(x=>x.provider==='ArbPay'));assert(!r.byProvider.some(x=>x.provider==='UPI-QR'));
});
test('whole-range original orders dedupe across days and do not merge platforms or directions',async()=>{
 const r=await call({platforms:['Alpha','Beta'],direction:'charge'}),s=r.summary;
 assert.equal(s.uniqueOrderCount,6);assert.equal(s.uniqueSuccessCount,4);assert.equal(s.uniqueOrderAmount,null);assert.equal(s.uniqueSuccessAmount,1400);
 assert.equal(s.uniqueCoverage.missingOrderNumberCount,1);assert.equal(s.uniqueCoverage.amountConflictCount,1);assert.equal(s.uniqueCoverage.missingAmountCount,1);assert.equal(s.uniqueCoverage.providerConflictCount,1);assert.equal(s.uniqueCoverage.status,'partial');
 const clean=await call({platforms:['Beta'],direction:'charge',endAt:'2026-09-01T23:59:59+05:30'});
 assert.equal(clean.summary.uniqueOrderCount,1);assert.equal(clean.summary.uniqueOrderAmount,700);assert.equal(clean.summary.uniqueSuccessCount,1);assert.equal(clean.summary.uniqueCoverage.complete,true);
 const parent=byProvider(r);assert.equal(parent.uniqueOrderCount,5,'ambiguous provider original is excluded once from each provider');assert.equal(parent.uniqueSuccessAmount,1000);
 assert.equal(byProvider(r,'OtherPay').uniqueOrderCount,null,'no reliable provider attribution is invented');
});
test('provider filters apply to the selected issue cohort and success uses any in-range submitted successful issue',async()=>{
 const r=await call({platforms:['Alpha'],providers:['ArbPay'],direction:'charge'});
 assert.equal(r.summary.uniqueOrderCount,5);assert.equal(r.summary.uniqueSuccessCount,2);assert.equal(r.summary.uniqueSuccessAmount,300);
 assert.equal(r.summary.uniqueCoverage.providerConflictCount,1,'unselected provider still establishes an attribution conflict');
 assert.equal(byProvider(r).uniqueOrderCount,4);
 const other=await call({platforms:['Alpha'],providers:['OtherPay'],direction:'charge'});
 assert.equal(byProvider(other,'OtherPay').uniqueOrderCount,null);assert.equal(byProvider(other,'OtherPay').uniqueCoverage.providerConflictCount,1);
 assert.equal(other.summary.uniqueOrderCount,1);assert.equal(other.summary.uniqueSuccessCount,1);assert.equal(other.summary.uniqueCoverage.status,'partial');
 const day=await call({platforms:['Alpha'],providers:['ArbPay'],direction:'charge',endAt:'2026-09-01T23:59:59+05:30'});
 assert.equal(day.summary.uniqueSuccessCount,1,'a success from a different submitted-date cohort is not pulled in');
 const otherDay=await call({platforms:['Alpha'],providers:['ArbPay'],direction:'charge',startAt:'2026-09-02T00:00:00+05:30'});
 assert.equal(otherDay.summary.uniqueOrderCount,2);assert.equal(otherDay.summary.uniqueSuccessCount,2);
 assert(day.summary.uniqueOrderCount+otherDay.summary.uniqueOrderCount>r.summary.uniqueOrderCount);
});
test('withdraw explicit payment originals work, while independent source order and issue IDs are never substituted',async()=>{
 const r=await call({platforms:['Alpha'],direction:'withdraw'});assert.equal(r.summary.submittedCount,3);
 assert.equal(r.summary.uniqueOrderCount,1);assert.equal(r.summary.uniqueOrderAmount,900);assert.equal(r.summary.uniqueSuccessCount,1);assert.equal(r.summary.uniqueSuccessAmount,900);assert.equal(r.summary.uniqueCoverage.missingOrderNumberCount,1);
 await db.exec('begin');try{await db.exec("update ar_workorder_issue_details set source_order_no=payment_order_no,payment_order_no=null where issue_kind='withdraw'");const missing=await call({platforms:['Alpha'],direction:'withdraw'});assert.equal(missing.summary.uniqueOrderCount,null);assert.equal(missing.summary.uniqueOrderAmount,null);assert.equal(missing.summary.uniqueCoverage.status,'unavailable');assert.equal(missing.summary.uniqueCoverage.missingOrderNumberCount,3);assert.equal(missing.summary.uniqueCoverage.sourceOrderOnlyCount,2);}finally{await db.exec('rollback');}
});
test('missing detail and NEW_AR sources expose coverage rather than false zeros',async()=>{
 const noCoverage=await call({platforms:['Alpha'],direction:'charge',startAt:'2026-09-10T00:00:00+05:30',endAt:'2026-09-10T23:59:59+05:30'});
 assert.equal(noCoverage.summary.uniqueOrderCount,null);assert.equal(noCoverage.summary.uniqueOrderAmount,null);assert.equal(noCoverage.summary.uniqueSuccessCount,null);assert.equal(noCoverage.summary.uniqueSuccessAmount,null);assert.equal(noCoverage.summary.uniqueCoverage.status,'unavailable');
 const r=await call({platforms:['Gamma'],direction:'charge'});
 assert.equal(r.summary.submittedCount,10);assert.equal(r.summary.uniqueOrderCount,null);assert.equal(r.summary.uniqueCoverage.detailCount,0);assert.equal(r.summary.uniqueCoverage.missingDetailCount,10);assert.equal(r.summary.uniqueCoverage.status,'unavailable');
 await db.exec('begin');try{await db.exec("delete from ar_workorder_issue_details where work_order_id='beta-same-original'");const incomplete=await call({platforms:['Beta'],direction:'charge'});assert.equal(incomplete.summary.uniqueOrderCount,null);assert.equal(incomplete.summary.uniqueCoverage.missingDetailCount,1);}finally{await db.exec('rollback');}
});
test('independent source order does not override an explicit payment original and conflicting amounts remain unknown',async()=>{
 await db.exec('begin');try{
  await insert('conflicting-numbers','PAYMENT-A',123,{platform:'Beta',sourceOrder:'SOURCE-B'});await rebuild();
  const r=await call({platforms:['Beta'],direction:'charge',endAt:'2026-09-01T23:59:59+05:30'});assert.equal(r.summary.uniqueOrderCount,2);assert.equal(r.summary.uniqueOrderAmount,823);assert.equal(r.summary.uniqueCoverage.missingOrderNumberCount,0);assert.equal(r.summary.uniqueCoverage.complete,true);
  await db.exec("update ar_workorder_issue_details set status_code=4 where payment_order_no='C1'");
  const conflict=await call({platforms:['Alpha'],providers:['ArbPay'],direction:'charge'});assert.equal(conflict.summary.uniqueSuccessCount,3);assert.equal(conflict.summary.uniqueSuccessAmount,null);assert.equal(conflict.summary.uniqueCoverage.amountConflictCount,1);
 }finally{await db.exec('rollback');}
});
test('full-range metrics are pagination-independent and permissions are checked every time',async()=>{
 const first=await call(),later=await call({offset:1000});assert.deepEqual(first.summary,later.summary);assert.deepEqual(first.byProvider,later.byProvider);assert.deepEqual(first.byPlatformProvider,later.byPlatformProvider);assert.equal(later.rows.length,0);
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify({platforms:['Beta']})]);try{const r=await call();assert.equal(r.summary.uniqueOrderCount,1);assert.equal(r.summary.uniqueOrderAmount,700);}finally{await db.exec("set test.scope=''");}
 await db.exec('set role authenticated');try{await assert.rejects(db.query('select * from ar_workorder_issue_details'),/permission denied/);await assert.rejects(db.query('select private.dashboard_admin_live_workorder_unique_totals($1,$2)',[req,{}]),/permission denied/);}finally{await db.exec('reset role');}
 await db.exec("set test.active='false'");try{await assert.rejects(call(),/preview_denied/);}finally{await db.exec("set test.active='true'");}
 assert.equal((await db.query("select proacl::text acl from pg_proc where oid='private.dashboard_admin_live_workorders(jsonb)'::regprocedure")).rows[0].acl,baseAcl);
});
test('confirmed platform aliases dedupe as one physical platform without duplicating raw issue rows',async()=>{
 await db.exec('begin');try{
  await db.exec("insert into catalog values('44444444-4444-4444-8444-444444444444','RAJAGAMES','RAJA','印度','IN','ar')");
  await insert('raja-day1','RC-RAJA',50,{platform:'RAJA'});await insert('raja-day2','RC-RAJA',50,{platform:'RAJALOTTERY',date:'2026-09-02',status:4});await rebuild();
  const r=await call({platforms:['RAJA','RAJALOTTERY'],direction:'charge'});assert.equal(r.summary.submittedCount,2);assert.equal(r.summary.uniqueOrderCount,1);assert.equal(r.summary.uniqueOrderAmount,50);assert.equal(r.summary.uniqueSuccessCount,1);assert.equal(r.summary.uniqueCoverage.detailCount,2);
  assert.equal(r.byPlatformProvider.length,2,'legacy raw-alias rows remain intact');assert(r.byPlatformProvider.every(x=>x.uniqueOrderCount===1));
 }finally{await db.exec('rollback');}
});
test('migration is repeatable, read-only on business data, and identical to the deployment file',async()=>{
 const first=await call();await db.exec(patch);assert.deepEqual(await call(),first);
 assert.equal(sql('migrations/20260928094501_admin_live_workorder_original_order_totals.sql'),initialPatch);
 assert.equal(sql('migrations/20260928100943_admin_live_workorder_unique_single_pass.sql'),patch);
 assert.doesNotMatch(patch,/\b(create table|alter table|insert into|delete from|update public\.|grant execute)\b/i);
 assert.match(patch,/provider_names as materialized/);assert.match(patch,/submitted_date between v_start and v_end/);
});

// Real cardinality matters: the JSON cohort estimate is one row, while the
// original-order groups contain thousands. Avoid the former quadratic join.
test('large multi-day cohorts use one original-order grouping with exact unchanged totals',async()=>{
 await db.exec('begin');try{
  await db.exec("insert into catalog values('55555555-5555-4555-8555-555555555555','Large','Large','印度','IN','ar')");
  await db.exec(`insert into ar_workorder_issue_details(system_name,country_code,country,platform,work_order_id,payment_order_no,amount,issue_kind,third_party,channel_type,status_code,submitted_date)
    select 'AR','IN','印度','Large','large-'||n||'-'||day,'ORIGINAL-'||n,1000,'deposit','ArbPayINR','BANK',case when day=1 then 3 else 4 end,date '2026-09-01'+(day-1)
    from generate_series(1,5000) n cross join generate_series(1,2) day;`);
  await rebuild();const r=await call({platforms:['Large'],direction:'charge'});
  assert.equal(r.summary.submittedCount,10000);assert.equal(r.summary.uniqueOrderCount,5000);assert.equal(r.summary.uniqueOrderAmount,5000000);
  assert.equal(r.summary.uniqueSuccessCount,5000);assert.equal(r.summary.uniqueSuccessAmount,5000000);assert.equal(r.summary.uniqueCoverage.complete,true);
  assert.doesNotMatch(patch,/original_providers as materialized|selected_originals as/);
 }finally{await db.exec('rollback');}
});
