// Execute the shipped reader migration against synthetic collected tickets.
// No external endpoints, real orders, credentials or collector execution.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'../supabase',p),'utf8');
const migration=read('migrations/20261004084725_newar_workorder_detail_only_cohorts.sql');
const request={country:'印度',platforms:['DHANIWIN','DhaniWin'],direction:'charge',startAt:'2026-10-03T00:00:00.000Z',endAt:'2026-10-03T23:59:59.000Z',limit:20};
const inTransaction=migration.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
let db,oldDefinition,oldMetadata,helperMetadata;
const call=async extra=>(await db.query('select private.dashboard_admin_live_workorders($1::jsonb) result',[JSON.stringify({...request,...extra})])).rows[0].result;
const byProvider=(r,name)=>r.byProvider.find(p=>p.provider===name);
async function ticket(id,original,{provider='UpiPay-QR',status='1',amount=100,platform='DhaniWin',currency='INR',created='2026-10-03T12:00:00+05:30',type='存款未到账自动化',raw,dataset='workorder'}={}){
 await db.query(`insert into newar_detail_records(platform,dataset,source_id,provider,channel_type,currency,amount,status_code,created_at,workorder_type,raw,order_number)
  values($1,$2,$3,$4,'QR',$5,$6,$7,$8,$9,$10,'UNTRUSTED-TICKET-ID')`,[platform,dataset,id,provider,currency,amount,status,created,type,JSON.stringify(raw??{depositOrderNo:original})]);
}
async function daily({date='2026-10-03',platform='DhaniWin',provider='UpiPay-QR',submitted=0,amount=0,success=0,successAmount=0}={}){
 await db.query(`insert into workorder_deposit_daily values($1,'IN','印度',$2,$3,'QR','AR_WORKORDER',$4,$5,$6,$7,0,0,0,0,'2026-10-04T06:00:00Z','2026-10-04T06:01:00Z','{}'::jsonb)`,[date,platform,provider,submitted,amount,success,successAmount]);
}
async function metadata(){return (await db.query("select to_jsonb(p)-'prosrc' value from pg_proc p where oid='private.dashboard_admin_live_workorders(jsonb)'::regprocedure")).rows[0].value;}
async function helpers(){return (await db.query("select md5(prosrc) body,proacl::text acl,prosecdef,provolatile,proconfig from pg_proc where oid='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure")).rows[0];}
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;grant usage on schema private to authenticated;
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin
  if current_setting('test.active',true)='false' then raise exception 'preview_denied';end if;
  return coalesce(nullif(current_setting('test.scope',true),'')::jsonb,'{"mode":"all"}'::jsonb);end$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select coalesce($1->>'mode'='all' or $1->'platforms' ? $3,false)$$;
 create table catalog(id uuid,name text,source_name text,country text,scope_group text,source text,currency text);
 create function private.dashboard_admin_live_platforms() returns setof public.catalog language sql stable as $$select * from public.catalog where private.dashboard_scope_allows(private.dashboard_admin_live_scope(),scope_group,source_name)$$;
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text);
 create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[]);
 create function private.dashboard_admin_live_provider_alias(text,text) returns text language sql immutable as $$select regexp_replace($2,'-QR$','')$$;
 create function private.dashboard_admin_live_provider_alias_values(text,text[]) returns text[] language sql immutable as $$select $2$$;
 create function private.dashboard_admin_live_confirmed_usdt_provider(text,text) returns text language sql immutable as $$select null::text$$;
 create function private.dashboard_admin_live_provider_canonical(text,text,text) returns text language sql stable as $$select regexp_replace($3,'-QR$','')$$;
 create table workorder_deposit_daily(stat_date date,country_code text,country text,platform text,third_party text,channel_type text,source_system text,submitted_count bigint,submitted_amount numeric,success_count bigint,success_amount numeric,withdraw_not_received_count bigint,withdraw_not_received_amount numeric,withdraw_success_count bigint,withdraw_success_amount numeric,source_updated_at timestamptz,updated_at timestamptz,status_counts jsonb);
 create table ar_workorder_issue_details(system_name text,country_code text,country text,platform text,work_order_id text,work_order_no text,payment_order_no text,source_order_no text,amount numeric,issue_kind text,third_party text,channel_type text,status_code integer,submitted_date date,kyc_connected boolean);
 create table newar_detail_platforms(platform text primary key,country_code text,country text,timezone text,currency text,enabled boolean,launch_at timestamptz);
 create table newar_detail_records(platform text,dataset text,source_id text,provider text,channel_type text,currency text,amount numeric,status_code text,created_at timestamptz,workorder_type text,raw jsonb,order_number text,captured_at timestamptz default '2026-10-04T06:00:00Z',received_at timestamptz default '2026-10-04T06:01:00Z',primary key(platform,dataset,source_id));
 create index newar_detail_created_idx on newar_detail_records(platform,dataset,created_at);
 create index daily_scope_idx on workorder_deposit_daily(country_code,platform,stat_date);
 insert into catalog values('11111111-1111-4111-8111-111111111111','Alpha','Alpha','印度','IN','ar','INR'),('22222222-2222-4222-8222-222222222222','DHANIWIN','DhaniWin','印度','IN','newar','INR');
 insert into newar_detail_platforms values('DhaniWin','IN','印度','Asia/Kolkata','INR',true,null),('OtherSite','IN','印度','Asia/Kolkata','INR',true,null),('CrossCountry','PK','巴基斯坦','Asia/Karachi','PKR',true,null);`);
 const config=read('admin-live-configuration-workorders.sql'),start=config.indexOf('create or replace function private.dashboard_admin_live_workorder_provider(');
 await db.exec(config.slice(start,config.indexOf('\n$$;',start)+4));
 for(const file of ['admin-live-workorder-platform-breakdown.sql','admin-live-workorder-original-order-totals.sql','admin-live-workorder-unique-single-pass.sql','admin-live-workorder-provider-lookup-once.sql','admin-live-workorder-provider-batch.sql','admin-live-workorder-grouped-metrics.sql','admin-live-workorder-source-scope-once.sql'])await db.exec(read(file));
 // Install the exact shipped original/helper definitions; this migration does
 // not modify them. They have separate regression suites for all classifications.
 const precision=read('migrations/20261002073527_workorder_source_diagnostics_precision.sql');
 for(const i of [0,1])await db.exec(precision.split('$definition_'+i+'$')[1]);
 await db.exec('revoke all on function private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb) from public,anon,authenticated');
 oldDefinition=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_workorders(jsonb)'::regprocedure) definition")).rows[0].definition;
 assert.equal((await db.query("select md5(prosrc) hash from pg_proc where oid='private.dashboard_admin_live_workorders(jsonb)'::regprocedure")).rows[0].hash,'45eea02c1db9fa617efe277a8bdc056c');
 oldMetadata=await metadata();helperMetadata=await helpers();assert.equal(helperMetadata.body,'a7bcb66755d22ddb9d6228cf94c91a4e');
 await db.exec(migration);
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));

test('detail-only DhaniWin tickets populate provider cohorts and deduplicated originals without pretending a daily receipt exists',async()=>{
 await ticket('A','ORIGINAL-A');await ticket('B','ORIGINAL-A',{status:'4'});await ticket('C','ORIGINAL-B',{amount:200,status:'3'});await ticket('D','ORIGINAL-C',{provider:'Super-QR',amount:300,status:'5'});
 const result=await call(),upi=byProvider(result,'UpiPay');assert.equal(result.basis,'AR_WORKORDER_daily_or_collected_read_model');
 assert.equal(result.summary.submittedCount,4);assert.equal(result.summary.submittedAmount,700);assert.equal(upi.submittedCount,3);
 assert.equal(upi.uniqueOrderCount,2);assert.equal(upi.uniqueOrderAmount,300);assert.equal(upi.uniqueSuccessCount,1);assert.equal(upi.uniqueSuccessAmount,100);assert.equal(upi.uniqueNotReceivedCount,1);assert.equal(upi.uniqueNotReceivedAmount,200);
 assert.equal(upi.uniqueCoverage.complete,false);assert.equal(upi.uniqueCoverage.kycUnknownOrderCount,1);assert.equal(upi.uniqueNotReceivedKycCount,null);
 assert.equal(result.coverage.capturedPlatformDays,0);assert.equal(result.coverage.complete,false);assert.equal(result.coverage.platforms[0].detailOnlyDays,1);
 assert.equal(result.coverage.detailOnly.collectedTickets,4);assert.equal(result.coverage.detailOnly.platformDays,1);assert.equal(result.coverage.detailOnly.complete,false);
 assert.equal(new Date(result.coverage.detailOnly.latestCapturedAt).toISOString(),'2026-10-04T06:00:00.000Z');assert.equal(new Date(result.coverage.detailOnly.latestReceivedAt).toISOString(),'2026-10-04T06:01:00.000Z');
 assert.equal(result.byPlatformProvider.find(p=>p.provider==='UpiPay').platform,'DHANIWIN');assert.equal(result.byPlatformProvider.find(p=>p.provider==='UpiPay').source,'newar');
 assert.deepEqual((await db.query('select * from workorder_deposit_daily')).rows,[],'readers never fabricate/store a daily bundle');
});

test('daily receipt including explicit zero remains authoritative and fallback never overlaps it',async()=>{
 await ticket('STALE','SOURCE-ONLY');await daily({submitted:0});
 const after=await call();await db.exec(oldDefinition);const before=await call();await db.exec(inTransaction);
 assert.deepEqual(after,before);assert.equal(after.coverage.complete,true);assert.equal(after.coverage.detailOnly,undefined);assert.equal(after.summary.submittedCount,0);
 await db.exec('delete from workorder_deposit_daily');await daily({submitted:5,amount:500,success:2,successAmount:200});
 const expected=await call();await db.exec(oldDefinition);assert.deepEqual(await call(),expected);
});

test('complete-day and detail-only adjacent days combine once while provider filter is canonical and pagination independent',async()=>{
 await daily({date:'2026-10-02',submitted:1,amount:100});await ticket('OCT2','OLD',{created:'2026-10-02T12:00:00+05:30'});
 await ticket('OCT3-A','NEW-A');await ticket('OCT3-B','NEW-B',{provider:'Super-QR'});
 const q={startAt:'2026-10-02T00:00:00Z'},all=await call(q);assert.equal(all.summary.submittedCount,3);assert.equal(all.summary.uniqueOrderCount,3);assert.equal(all.coverage.capturedPlatformDays,1);assert.equal(all.coverage.expectedPlatformDays,2);
 const first=await call({...q,providers:['UpiPay']}),later=await call({...q,providers:['UpiPay'],offset:100});assert.equal(first.summary.submittedCount,2);assert.equal(first.summary.uniqueOrderCount,2);assert.equal(first.byProvider.length,1);assert.deepEqual(later.summary,first.summary);assert.deepEqual(later.byProvider,first.byProvider);assert.deepEqual(later.byPlatformProvider,first.byPlatformProvider);assert.deepEqual(later.rows,[]);
});

test('country-local midnight and exact deposit types preserve adjacent-day and nondeposit exclusions',async()=>{
 await ticket('START','A',{created:'2026-10-02T18:30:00Z'});await ticket('END','B',{created:'2026-10-03T18:29:59.999Z'});
 await ticket('BEFORE','OUT',{created:'2026-10-02T18:29:59.999Z'});await ticket('AFTER','OUT',{created:'2026-10-03T18:30:00Z'});
 for(const type of ['一对一客服','取款未到账','USDT存款未到账自动化','存款未到账自动化-extra'])await ticket('OTHER-'+type,'OUT',{type});
 await ticket('CHARGE','OUT',{dataset:'charge'});const result=await call();assert.equal(result.summary.submittedCount,2);assert.equal(result.summary.uniqueOrderCount,2);assert.equal(result.coverage.detailOnly.collectedTickets,2);
 assert.deepEqual((await call({direction:'withdraw'})).byProvider,[]);assert.equal((await call({direction:'withdraw'})).coverage.detailOnly,undefined);
});

test('native catalog authorization, country, enabled and launch restrictions apply before detail reads',async()=>{
 await ticket('VALID','VISIBLE');await ticket('OTHER','PRIVATE',{platform:'OtherSite'});await ticket('CROSS','PRIVATE',{platform:'CrossCountry',currency:'PKR'});
 assert.equal((await call()).summary.submittedCount,1);assert.equal((await call({platforms:[]})).coverage.detailOnly,undefined);
 await db.query("select set_config('test.scope',$1,true)",[JSON.stringify({platforms:['Alpha']})]);assert.equal((await call()).summary.submittedCount,0);assert.equal((await call()).coverage.detailOnly,undefined);
 await db.exec("set local test.scope='';update newar_detail_platforms set enabled=false where platform='DhaniWin'");assert.equal((await call()).summary.submittedCount,0);
 await db.exec("update newar_detail_platforms set enabled=true,launch_at='2999-01-01T00:00:00Z' where platform='DhaniWin'");assert.equal((await call()).summary.submittedCount,0);
 await db.exec("update newar_detail_platforms set launch_at='2026-10-03T13:00:00+05:30' where platform='DhaniWin'");assert.equal((await call()).summary.submittedCount,0);
 await db.exec("update newar_detail_platforms set launch_at=null,country_code='PK' where platform='DhaniWin'");assert.equal((await call()).summary.submittedCount,0);
});

test('missing original IDs, reference types, wrong currencies and conflicts retain the unchanged original helper semantics',async()=>{
 await ticket('NO-ID',null,{raw:{},amount:100});await ticket('BAD-ID',null,{raw:{depositOrderNo:123},amount:200});
 let result=await call(),upi=byProvider(result,'UpiPay');assert.equal(upi.submittedCount,2);assert.equal(upi.uniqueOrderCount,null);assert.equal(upi.uniqueCoverage.missingOrderNumberCount,2);
 await ticket('MONEY','OPAQUE-001',{currency:'USDT',amount:3});result=await call();upi=byProvider(result,'UpiPay');assert.equal(result.summary.submittedAmount,null);assert.equal(result.byDirection.charge.submittedAmount,null);assert.equal(upi.submittedAmount,null);assert.equal(upi.uniqueOrderCount,1);assert.equal(upi.uniqueOrderAmount,null);assert.equal(upi.uniqueCoverage.missingAmountCount,1);
 await ticket('CONFLICT-A','SHARED',{amount:300});await ticket('CONFLICT-B','SHARED',{provider:'Super-QR',amount:300});
 result=await call({providers:['UpiPay']});upi=byProvider(result,'UpiPay');assert.equal(upi.uniqueCoverage.providerConflictCount,1,'conflicts are detected before the provider filter');assert.equal(upi.uniqueCoverage.complete,false);
});

test('empty realtime source does not imply confirmed zero and multiple native catalog identities never multiply tickets',async()=>{
 let result=await call();assert.equal(result.summary.submittedCount,0);assert.equal(result.coverage.complete,false);assert.equal(result.coverage.capturedPlatformDays,0);assert.equal(result.coverage.detailOnly,undefined);
 await db.exec("insert into catalog select '33333333-3333-4333-8333-333333333333',name,source_name,country,scope_group,source,currency from catalog where source='newar'");await ticket('ONE','ONE');result=await call();assert.equal(result.summary.submittedCount,1);assert.equal(result.coverage.detailOnly.collectedTickets,1);assert.equal(result.byPlatformProvider[0].platformId,null,'ambiguous identity is not guessed');
});

test('reader guards and idempotence preserve every permission/execution property and do not touch original helper or source records',async()=>{
 await ticket('ONE','ONE');const sources=(await db.query('select * from newar_detail_records')).rows;
 assert.deepEqual(await metadata(),oldMetadata);assert.deepEqual(await helpers(),helperMetadata);await db.exec(inTransaction);assert.deepEqual(await metadata(),oldMetadata);
 assert.deepEqual((await db.query('select * from newar_detail_records')).rows,sources);
 await db.exec("savepoint auth_check;set local test.active='false'");await assert.rejects(call(),/preview_denied/);await db.exec('rollback to auth_check');
 await db.exec('savepoint table_check;set local role authenticated');await assert.rejects(db.query('select * from newar_detail_records'),/permission denied/);await db.exec('rollback to table_check');
 const candidate=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_workorders(jsonb)'::regprocedure) definition")).rows[0].definition;
 await db.exec(candidate.replace('newar_detail_days_v1 as materialized','unknown_edited_days as materialized'));await assert.rejects(db.exec(inTransaction),/baseline_drift/);
});
