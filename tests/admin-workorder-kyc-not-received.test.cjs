// KYC original-order subset executes in real PostgreSQL with synthetic records only.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'../supabase',p),'utf8');
const patch=read('migrations/20260930140000_newar_workorder_original_totals.sql');
const oldPatch=read('migrations/20260928150000_admin_live_workorder_unique_not_received.sql');
const req={country:'印度',startAt:'2026-09-29T00:00:00+05:30',endAt:'2026-09-29T23:59:59+05:30',direction:'charge',limit:20};
const kycPatch=read('migrations/20260930170000_workorder_not_received_kyc.sql');
let db,legacy,baseAcl,baseSummaryBody,preKyc;
const call=async extra=>(await db.query('select private.dashboard_admin_live_workorders($1::jsonb) data',[JSON.stringify({...req,...extra})])).rows[0].data;
const provider=(r,name)=>r.byProvider.find(x=>x.provider===name);
function stripUnique(v){if(Array.isArray(v))return v.map(stripUnique);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!k.startsWith('unique')).map(([k,x])=>[k,stripUnique(x)]));return v;}
async function put(id,original,{provider='TukPay-QR',platform='DhaniWin',amount=100,status='3',type='存款未到账自动化',date='2026-09-29T12:00:00+05:30',currency='INR',raw,order=null,dataset='workorder'}={}){
 await db.query(`insert into newar_detail_records(platform,dataset,source_id,provider,channel_type,currency,amount,status_code,created_at,workorder_type,raw,order_number)
 values($1,$2,$3,$4,'QR',$5,$6,$7,$8,$9,$10,$11)`,[platform,dataset,id,provider,currency,amount,status,date,type,JSON.stringify(raw??{depositOrderNo:original}),order]);
}
async function rebuild(){await db.exec(`delete from workorder_deposit_daily;
 insert into workorder_deposit_daily
 select (n.created_at at time zone p.timezone)::date,p.country_code,p.country,n.platform,n.provider,n.channel_type,'AR_WORKORDER',
 count(*),sum(n.amount),count(*) filter(where n.status_code='4'),coalesce(sum(n.amount) filter(where n.status_code='4'),0),0,0,0,0,now(),now()
 from newar_detail_records n join newar_detail_platforms p using(platform)
 where n.dataset='workorder' and n.workorder_type in ('存款未到账','存款未到账自动化')
 group by 1,2,3,4,5,6;
 insert into workorder_deposit_daily values('2026-09-29','IN','印度','Alpha','ArbPayINR','BANK','AR_WORKORDER',1,700,1,700,0,0,0,0,now(),now());`);}
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;grant usage on schema private to authenticated;
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin if current_setting('test.active',true)='false' then raise exception 'preview_denied';end if;return coalesce(nullif(current_setting('test.scope',true),'')::jsonb,'{"mode":"all"}'::jsonb);end$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select coalesce($1->>'mode'='all' or $1->'platforms' ? $3,false)$$;
 create table catalog(id uuid,name text,source_name text,country text,scope_group text,source text);
 create function private.dashboard_admin_live_platforms() returns setof public.catalog language sql stable as $$select * from public.catalog where private.dashboard_scope_allows(private.dashboard_admin_live_scope(),scope_group,source_name)$$;
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text);
 create function private.dashboard_admin_live_provider_canonical(text,text,text) returns text language sql stable as $$select regexp_replace($3,'-QR$','')$$;
 create table workorder_deposit_daily(stat_date date,country_code text,country text,platform text,third_party text,channel_type text,source_system text,submitted_count bigint,submitted_amount numeric,success_count bigint,success_amount numeric,withdraw_not_received_count bigint,withdraw_not_received_amount numeric,withdraw_success_count bigint,withdraw_success_amount numeric,source_updated_at timestamptz,updated_at timestamptz);
 create table ar_workorder_issue_details(system_name text,country_code text,country text,platform text,work_order_id text,work_order_no text,payment_order_no text,source_order_no text,amount numeric,issue_kind text,third_party text,channel_type text,status_code integer,submitted_date date);
 create table newar_detail_platforms(platform text primary key,country_code text,country text,timezone text,currency text,enabled boolean,launch_at timestamptz);
 create table newar_detail_records(platform text,dataset text,source_id text,provider text,channel_type text,currency text,amount numeric,status_code text,created_at timestamptz,workorder_type text,raw jsonb,order_number text,primary key(platform,dataset,source_id));
 create index newar_detail_created_idx on newar_detail_records(platform,dataset,created_at);
 insert into catalog values('11111111-1111-4111-8111-111111111111','Alpha','Alpha','印度','IN','ar'),('22222222-2222-4222-8222-222222222222','DHANIWIN','DhaniWin','印度','IN','newar');
 insert into newar_detail_platforms values('DhaniWin','IN','印度','Asia/Kolkata','INR',true,null),('OtherSite','IN','印度','Asia/Kolkata','INR',true,null),('CrossCountry','PK','巴基斯坦','Asia/Karachi','PKR',true,null);
 insert into ar_workorder_issue_details values('AR','IN','印度','Alpha','ISSUE-A','WORK-A','ORIGINAL-A',null,700,'deposit','ArbPayINR','BANK',4,'2026-09-29');`);
 const config=read('admin-live-configuration-workorders.sql'),start=config.indexOf('create or replace function private.dashboard_admin_live_workorder_provider(');
 await db.exec(config.slice(start,config.indexOf('\n$$;',start)+4));await db.exec(read('admin-live-workorder-platform-breakdown.sql'));await db.exec(oldPatch);
 for(let i=1;i<=23;i++)await put('T'+i,null,{status:i<=15?'4':'3'});
 for(let i=1;i<=8;i++)await put('R'+i,null,{provider:'RushPay-QR',status:i<=4?'4':'3'});
 await rebuild();legacy=await call();baseAcl=(await db.query("select proacl::text acl from pg_proc where oid='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure")).rows[0].acl;
 baseSummaryBody=(await db.query("select prosrc from pg_proc where oid='private.dashboard_admin_live_workorders(jsonb)'::regprocedure")).rows[0].prosrc;
 await db.exec(patch);await db.exec('alter table ar_workorder_issue_details add column kyc_connected boolean');preKyc=await call();await db.exec(kycPatch);
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));


function stripKyc(v){if(Array.isArray(v))return v.map(stripKyc);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!['uniqueNotReceivedKycCount','uniqueNotReceivedKycAmount','kycUnknownOrderCount'].includes(k)).map(([k,x])=>[k,stripKyc(x)]));return v;}
const arCall=extra=>call({platforms:['Alpha'],...extra});
async function ar(id,original,{amount=100,kyc=null,status=3,provider='KycPay',date='2026-09-29',kind='deposit',platform='Alpha'}={}){
 await db.query(`insert into ar_workorder_issue_details(system_name,country_code,country,platform,work_order_id,work_order_no,payment_order_no,amount,issue_kind,third_party,channel_type,status_code,submitted_date,kyc_connected)
 values('AR','IN','印度',$1,$2,$2,$3,$4,$5,$6,'BANK',$7,$8,$9)`,[platform,id,original,amount,kind,provider,status,date,kyc]);
}
async function resetAr(){await db.exec("delete from ar_workorder_issue_details;delete from workorder_deposit_daily where platform='Alpha'");}
async function rebuildAr(){await db.exec(`delete from workorder_deposit_daily where platform='Alpha';
 insert into workorder_deposit_daily
 select submitted_date,country_code,country,platform,third_party,channel_type,'AR_WORKORDER',
 count(*) filter(where issue_kind='deposit'),coalesce(sum(amount) filter(where issue_kind='deposit'),0),
 count(*) filter(where issue_kind='deposit' and status_code=4),coalesce(sum(amount) filter(where issue_kind='deposit' and status_code=4),0),
 count(*) filter(where issue_kind='withdraw'),coalesce(sum(amount) filter(where issue_kind='withdraw'),0),
 count(*) filter(where issue_kind='withdraw' and status_code=4),coalesce(sum(amount) filter(where issue_kind='withdraw' and status_code=4),0),now(),now()
 from ar_workorder_issue_details group by 1,2,3,4,5,6;`);}

test('KYC extension leaves every existing total, completeness, pagination and function ACL unchanged',async()=>{
 const r=await call();assert.deepEqual(stripKyc(r),preKyc);
 assert.equal((await db.query("select prosrc from pg_proc where oid='private.dashboard_admin_live_workorders(jsonb)'::regprocedure")).rows[0].prosrc,baseSummaryBody);
 assert.equal((await db.query("select proacl::text acl from pg_proc where oid='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure")).rows[0].acl,baseAcl);
 assert.deepEqual(r.summary,(await call({offset:1000})).summary);
});

test('any explicit true matches once per not-received original; success is excluded and false/null stays unknown',async()=>{
 await resetAr();
 await ar('TRUE-1','MATCHED',{kyc:false});await ar('TRUE-2','MATCHED',{kyc:null});await ar('TRUE-3','MATCHED',{kyc:true});
 await ar('FALSE-1','FALSE',{amount:200,kyc:false});await ar('FALSE-2','FALSE',{amount:200,kyc:false});
 await ar('UNKNOWN-1','UNKNOWN',{amount:300,kyc:false});await ar('UNKNOWN-2','UNKNOWN',{amount:300,kyc:null});
 await ar('SUCCESS-1','PAID',{amount:400,kyc:true});await ar('SUCCESS-2','PAID',{amount:400,kyc:null,status:4});await rebuildAr();
 const r=await arCall(),x=provider(r,'KycPay');assert.equal(x.uniqueOrderCount,4);assert.equal(x.uniqueNotReceivedCount,3);assert.equal(x.uniqueNotReceivedAmount,600);
 assert.equal(x.uniqueNotReceivedKycCount,1);assert.equal(x.uniqueNotReceivedKycAmount,100);assert.equal(x.uniqueCoverage.kycUnknownOrderCount,1);assert.equal(x.uniqueCoverage.complete,true);
 for(const y of [r.summary,r.byDirection.charge,r.byPlatformProvider[0]]){assert.equal(y.uniqueNotReceivedKycCount,1);assert.equal(y.uniqueNotReceivedKycAmount,100);assert.equal(y.uniqueCoverage.kycUnknownOrderCount,1);}
});

test('all explicit false returns zero only with complete coverage; all unknown never becomes zero',async()=>{
 await resetAr();await ar('FALSE-1','FALSE',{kyc:false});await ar('FALSE-2','FALSE',{kyc:false});await rebuildAr();
 let x=provider(await arCall(),'KycPay');assert.equal(x.uniqueNotReceivedKycCount,0);assert.equal(x.uniqueNotReceivedKycAmount,0);assert.equal(x.uniqueCoverage.kycUnknownOrderCount,0);
 await db.exec("update ar_workorder_issue_details set kyc_connected=null where work_order_id='FALSE-2'");
 x=provider(await arCall(),'KycPay');assert.equal(x.uniqueNotReceivedCount,1);assert.equal(x.uniqueCoverage.complete,true);assert.equal(x.uniqueCoverage.kycUnknownOrderCount,1);assert.equal(x.uniqueNotReceivedKycCount,null);assert.equal(x.uniqueNotReceivedKycAmount,null);
});

test('unconfirmed originals or missing details cannot yield an exact KYC zero',async()=>{
 await resetAr();await ar('FALSE','FALSE',{kyc:false});await ar('MISSING',null,{kyc:true});await rebuildAr();
 let x=provider(await arCall(),'KycPay');assert.equal(x.uniqueCoverage.complete,false);assert.equal(x.uniqueCoverage.missingOrderNumberCount,1);assert.equal(x.uniqueCoverage.kycUnknownOrderCount,0);assert.equal(x.uniqueNotReceivedKycCount,null);assert.equal(x.uniqueNotReceivedKycAmount,null);
 await db.exec("delete from ar_workorder_issue_details where work_order_id='MISSING'");
 x=provider(await arCall(),'KycPay');assert.equal(x.uniqueCoverage.missingDetailCount,1);assert.equal(x.uniqueNotReceivedKycCount,null);
 await db.exec("update ar_workorder_issue_details set kyc_connected=true where work_order_id='FALSE'");
 x=provider(await arCall(),'KycPay');assert.equal(x.uniqueCoverage.complete,false);assert.equal(x.uniqueNotReceivedKycCount,1);assert.equal(x.uniqueNotReceivedKycAmount,100);
});

test('conflicting or missing matched-original amounts retain count while money stays unknown',async()=>{
 await resetAr();await ar('A','A',{amount:100,kyc:true});await ar('A-CONFLICT','A',{amount:200,kyc:false});await rebuildAr();
 let x=provider(await arCall(),'KycPay');assert.equal(x.uniqueNotReceivedKycCount,1);assert.equal(x.uniqueNotReceivedKycAmount,null);assert.equal(x.uniqueCoverage.amountConflictCount,1);
 await db.exec("update ar_workorder_issue_details set amount=null");
 x=provider(await arCall(),'KycPay');assert.equal(x.uniqueNotReceivedKycCount,1);assert.equal(x.uniqueNotReceivedKycAmount,null);assert.equal(x.uniqueCoverage.missingAmountCount,1);
});

test('a successful original never contributes matched or unknown KYC to the not-received subset',async()=>{
 await resetAr();await ar('YES','PAID',{kyc:true});await ar('PAID','PAID',{kyc:null,status:4});await ar('UNKNOWN-PAID','PAID-2',{kyc:null,status:4});await rebuildAr();
 const x=provider(await arCall(),'KycPay');assert.equal(x.uniqueNotReceivedCount,0);assert.equal(x.uniqueNotReceivedKycCount,0);assert.equal(x.uniqueNotReceivedKycAmount,0);assert.equal(x.uniqueCoverage.kycUnknownOrderCount,0);
});

test('provider-conflicted originals stay excluded at provider scope before filters and deduped at summary scope',async()=>{
 await resetAr();await ar('P1','SHARED',{kyc:true});await ar('P2','SHARED',{kyc:true,provider:'OtherPay'});await rebuildAr();
 const r=await arCall({providers:['KycPay']}),x=provider(r,'KycPay');assert.equal(x.uniqueCoverage.providerConflictCount,1);assert.equal(x.uniqueNotReceivedCount,null);assert.equal(x.uniqueNotReceivedKycCount,null);assert.equal(x.uniqueNotReceivedKycAmount,null);
 assert.equal(r.summary.uniqueNotReceivedCount,1);assert.equal(r.summary.uniqueNotReceivedKycCount,1);assert.equal(r.summary.uniqueNotReceivedKycAmount,100);
});

test('same original across days counts once and KYC outside the selected submitted cohort cannot alter it',async()=>{
 await resetAr();await ar('TODAY','SAME',{kyc:false});await ar('PRIOR','SAME',{kyc:true,date:'2026-09-28'});await rebuildAr();
 let x=provider(await arCall(),'KycPay');assert.equal(x.uniqueNotReceivedKycCount,0);
 x=provider(await arCall({startAt:'2026-09-28T00:00:00+05:30'}),'KycPay');assert.equal(x.uniqueOrderCount,1);assert.equal(x.uniqueNotReceivedKycCount,1);assert.equal(x.uniqueNotReceivedKycAmount,100);
});

test('NEW_AR unconfirmed numeric and boolean source values stay unknown, with existing originals and totals intact',async()=>{
 await db.exec('delete from newar_detail_records');
 for(const [i,value] of [0,1,8,true,false,null].entries())await put('KYC-'+i,'NEW-'+i,{raw:{depositOrderNo:'NEW-'+i,kycConnectState:value}});await rebuild();
 const x=provider(await call({platforms:['DhaniWin']}),'TukPay');assert.equal(x.uniqueNotReceivedCount,6);assert.equal(x.uniqueCoverage.complete,true);assert.equal(x.uniqueCoverage.kycUnknownOrderCount,6);assert.equal(x.uniqueNotReceivedKycCount,null);assert.equal(x.uniqueNotReceivedKycAmount,null);
});

test('charge-only KYC fields never fold withdrawals into all-direction summaries',async()=>{
 await resetAr();await ar('DEPOSIT','DEPOSIT',{amount:100,kyc:true});await ar('WITHDRAW','WITHDRAW',{amount:900,kyc:true,kind:'withdraw'});await rebuildAr();
 const r=await arCall({direction:'all'});assert.equal(r.summary.uniqueNotReceivedCount,2);assert.equal(r.summary.uniqueNotReceivedKycCount,1);assert.equal(r.summary.uniqueNotReceivedKycAmount,100);
 const w=r.byDirection.withdraw;assert.equal(w.uniqueNotReceivedKycCount,null);assert.equal(w.uniqueNotReceivedKycAmount,null);assert.equal(w.uniqueCoverage.kycUnknownOrderCount,null);
 const only=await arCall({direction:'withdraw'});assert.equal(only.summary.uniqueNotReceivedKycCount,null);assert.equal(only.summary.uniqueNotReceivedKycAmount,null);assert.equal(only.summary.uniqueCoverage.kycUnknownOrderCount,null);
});

test('data-scope checks and helper/table access remain enforced',async()=>{
 await db.query("select set_config('test.scope',$1,true)",[JSON.stringify({platforms:['Alpha']})]);const r=await call();assert(!r.byProvider.some(x=>x.provider==='TukPay'));
 await db.exec("set local test.scope='';set local test.active='false'");await assert.rejects(call(),/preview_denied/);await db.exec('rollback;begin;set local role authenticated');
 await assert.rejects(db.query('select private.dashboard_admin_live_workorder_unique_totals($1,$2)',[req,{}]),/permission denied/);await db.exec('rollback;begin;set local role authenticated');await assert.rejects(db.query('select * from ar_workorder_issue_details'),/permission denied/);
});

test('KYC migration replays only the exact reviewed definition and preserves ACLs',async()=>{
 const before=await call();await db.exec('rollback');await db.exec(kycPatch);await db.exec('begin');assert.deepEqual(await call(),before);
 assert.equal((await db.query("select proacl::text acl from pg_proc where oid='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure")).rows[0].acl,baseAcl);
});

test('KYC migration rejects definition, execution metadata, and privilege drift',async()=>{
 await db.exec('rollback');const current=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure) definition")).rows[0].definition;
 try{
  await db.exec(current.replace('WORKORDER_UNIQUE_NOT_RECEIVED_KYC_V1','UNREVIEWED'));await assert.rejects(db.exec(kycPatch),/baseline changed/);await db.exec('rollback');await db.exec(current);
  await db.exec('alter function private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb) security definer');await assert.rejects(db.exec(kycPatch),/execution metadata changed/);await db.exec('rollback');await db.exec(current);
  await db.exec('grant execute on function private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb) to authenticated');await assert.rejects(db.exec(kycPatch),/ACL changed/);await db.exec('rollback');
 }finally{await db.exec('revoke all on function private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb) from authenticated');await db.exec(current);await db.exec('begin');}
});
