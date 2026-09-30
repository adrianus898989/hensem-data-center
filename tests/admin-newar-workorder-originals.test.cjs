// Real PostgreSQL execution with synthetic issue records only; no network.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'../supabase',p),'utf8');
const patch=read('migrations/20260930140000_newar_workorder_original_totals.sql');
const oldPatch=read('migrations/20260928150000_admin_live_workorder_unique_not_received.sql');
const req={country:'印度',startAt:'2026-09-29T00:00:00+05:30',endAt:'2026-09-29T23:59:59+05:30',direction:'charge',limit:20};
let db,legacy,baseAcl,baseSummaryBody;
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
 await db.exec(patch);
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));

test('NEW_AR collected issues replace false missing-details explanation without faking original totals',async()=>{
 const r=await call({platforms:['DhaniWin']});
 for(const [name,count] of [['TukPay',23],['RushPay',8]]){const x=provider(r,name);assert.equal(x.submittedCount,count);assert.equal(x.uniqueCoverage.detailCount,count);assert.equal(x.uniqueCoverage.missingDetailCount,0);assert.equal(x.uniqueCoverage.detailMismatchCount,0);assert.equal(x.uniqueCoverage.missingOrderNumberCount,count);assert.equal(x.uniqueCoverage.status,'unavailable');for(const field of ['uniqueOrderCount','uniqueOrderAmount','uniqueSuccessCount','uniqueSuccessAmount','uniqueNotReceivedCount','uniqueNotReceivedAmount'])assert.equal(x[field],null,field);}
 assert.equal(provider(legacy,'TukPay').uniqueCoverage.missingDetailCount,23,'pre-fix regression');
});
test('legacy aggregate totals, paging and AR original metrics remain unchanged',async()=>{
 const r=await call();assert.deepEqual(stripUnique(r),stripUnique(legacy));assert.deepEqual(provider(r,'ArbPay'),provider(legacy,'ArbPay'));
 assert.equal((await db.query("select prosrc from pg_proc where oid='private.dashboard_admin_live_workorders(jsonb)'::regprocedure")).rows[0].prosrc,baseSummaryBody);
});
test('real explicit deposit references immediately enable deduplication and successful original status',async()=>{
 await db.exec("update newar_detail_records set raw=jsonb_build_object('depositOrderNo','DEPOSIT-'||ceil(substring(source_id from 2)::numeric/2)::int) where source_id like 'T%'");
 const r=await call({platforms:['DhaniWin'],providers:['TukPay']}),x=provider(r,'TukPay');
 assert.equal(x.uniqueOrderCount,12);assert.equal(x.uniqueOrderAmount,1200);assert.equal(x.uniqueSuccessCount,8);assert.equal(x.uniqueSuccessAmount,800);assert.equal(x.uniqueNotReceivedCount,4);assert.equal(x.uniqueNotReceivedAmount,400);assert.equal(x.uniqueCoverage.complete,true);
});
test('rechargeNumber is explicit fallback; order_number and source_id never replace missing originals',async()=>{
 await db.exec(`update newar_detail_records set order_number='UNTRUSTED-WORKORDER',raw='{"depositOrderNo":null,"rechargeNumber":null}'::jsonb;
 update newar_detail_records set raw='{"depositOrderNo":"EXPLICIT-A","rechargeNumber":"LEGACY-B"}'::jsonb where source_id='T1';
 update newar_detail_records set raw='{"rechargeNumber":"EXPLICIT-A"}'::jsonb where source_id='T2'`);
 const x=provider(await call({platforms:['DhaniWin'],providers:['TukPay']}),'TukPay');assert.equal(x.uniqueOrderCount,1);assert.equal(x.uniqueOrderAmount,100);assert.equal(x.uniqueCoverage.missingOrderNumberCount,21);assert.equal(x.uniqueCoverage.sourceOrderOnlyCount,21);
});
test('only confirmed deposit issue types are included, never charge orders, customer-service or USDT issues',async()=>{
 for(const type of ['修改密码','客服','存款未到账USDT','提款未到账','存款未到账自动化-extra'])await put('OTHER-'+type,'SYNTHETIC',{type});
 await put('CHARGE','SYNTHETIC',{dataset:'charge'});await put('STANDARD','STANDARD',{type:'存款未到账'});await rebuild();
 const x=provider(await call({platforms:['DhaniWin'],providers:['TukPay']}),'TukPay');assert.equal(x.uniqueCoverage.detailCount,24);assert.equal(x.uniqueOrderCount,1);
});
test('same original across providers remains conflicted before provider filters',async()=>{
 await db.exec(`update newar_detail_records set raw='{"depositOrderNo":"SHARED"}'::jsonb where source_id in ('T1','R1')`);
 const r=await call({platforms:['DhaniWin'],providers:['TukPay']}),x=provider(r,'TukPay');assert.equal(r.summary.uniqueOrderCount,1);assert.equal(x.uniqueOrderCount,null);assert.equal(x.uniqueCoverage.providerConflictCount,1);assert.equal(r.summary.uniqueCoverage.providerConflictCount,1);
});
test('duplicate original across dates dedupes once; local-day half-open bounds exclude adjacent days',async()=>{
 await db.exec('delete from newar_detail_records');
 await put('START','A',{date:'2026-09-28T18:30:00Z'});await put('END','B',{date:'2026-09-29T18:29:59.999Z'});
 await put('BEFORE','A',{date:'2026-09-28T18:29:59.999Z'});await put('AFTER','C',{date:'2026-09-29T18:30:00Z'});await rebuild();
 const x=provider(await call({platforms:['DhaniWin']}),'TukPay');assert.equal(x.uniqueCoverage.detailCount,2);assert.equal(x.uniqueOrderCount,2);
 const span=provider(await call({platforms:['DhaniWin'],startAt:'2026-09-28T00:00:00+05:30'}),'TukPay');assert.equal(span.uniqueCoverage.detailCount,3);assert.equal(span.uniqueOrderCount,2);
});
test('wrong or unknown currency and conflicting original amounts cannot yield invented money',async()=>{
 await put('MONEY-A','M',{currency:'USDT'});await put('MONEY-B','N',{currency:null});await rebuild();
 let x=provider(await call({platforms:['DhaniWin']}),'TukPay');assert.equal(x.uniqueOrderCount,2);assert.equal(x.uniqueOrderAmount,null);assert.equal(x.uniqueCoverage.missingAmountCount,2);
 await put('MONEY-C','C',{amount:200});await put('MONEY-D','C',{amount:201});await rebuild();x=provider(await call({platforms:['DhaniWin']}),'TukPay');assert.equal(x.uniqueCoverage.amountConflictCount,1);assert.equal(x.uniqueNotReceivedAmount,null);
});
test('native platform, country, enabled and launch boundaries are enforced',async()=>{
 await put('OUTSIDE','PRIVATE',{platform:'OtherSite'});await put('CROSS','PRIVATE',{platform:'CrossCountry',currency:'PKR'});
 let x=provider(await call({platforms:['DhaniWin']}),'TukPay');assert.equal(x.uniqueCoverage.detailCount,23);
 await db.exec("update newar_detail_platforms set enabled=false where platform='DhaniWin'");x=provider(await call({platforms:['DhaniWin']}),'TukPay');assert.equal(x.uniqueCoverage.detailCount,0);
 await db.exec("update newar_detail_platforms set enabled=true,launch_at='2026-09-30T00:00:00+05:30' where platform='DhaniWin'");x=provider(await call({platforms:['DhaniWin']}),'TukPay');assert.equal(x.uniqueCoverage.detailCount,0);
});
test('permissions are rechecked for every call and helper/table access is not granted',async()=>{
 await db.query("select set_config('test.scope',$1,true)",[JSON.stringify({platforms:['Alpha']})]);let r=await call();assert.equal(r.summary.uniqueOrderCount,1);assert(!r.byProvider.some(x=>x.provider==='TukPay'));
 await db.exec("set local test.scope='';set local test.active='false'");await assert.rejects(call(),/preview_denied/);await db.exec('rollback;begin');
 await db.exec('set local role authenticated');await assert.rejects(db.query('select * from newar_detail_records'),/permission denied/);await db.exec('rollback;begin;set local role authenticated');await assert.rejects(db.query('select private.dashboard_admin_live_workorder_unique_totals($1,$2)',[req,{}]),/permission denied/);
});
test('missing or malformed explicit original fields remain unknown',async()=>{
 await db.exec('delete from newar_detail_records');
 for(const [i,raw] of [{},{depositOrderNo:null},{depositOrderNo:''},{depositOrderNo:'  '},{depositOrderNo:17},{depositOrderNo:{x:'BAD'}}].entries())await put('BAD'+i,null,{raw});await rebuild();
 const x=provider(await call({platforms:['DhaniWin']}),'TukPay');assert.equal(x.uniqueOrderCount,null);assert.equal(x.uniqueCoverage.missingOrderNumberCount,6);
});
test('no original can merge across separate AR and NEW_AR sources',async()=>{
 await put('SAME-AR-ID','ORIGINAL-A');await rebuild();const r=await call();assert.equal(r.summary.uniqueOrderCount,2);assert.equal(r.summary.uniqueOrderAmount,800);
});
test('pagination-independent metrics remain stable and migration replay preserves exact ACLs',async()=>{
 const first=await call(),later=await call({offset:1000});assert.deepEqual(first.summary,later.summary);assert.deepEqual(first.byProvider,later.byProvider);assert.deepEqual(first.byPlatformProvider,later.byPlatformProvider);assert.deepEqual(later.rows,[]);
 await db.exec('rollback');await db.exec(patch);await db.exec('begin');assert.deepEqual(await call(),first);assert.equal((await db.query("select proacl::text acl from pg_proc where oid='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure")).rows[0].acl,baseAcl);
});
test('unknown prior function bodies and unexpected helper grants fail closed',async()=>{
 await db.exec('rollback');const current=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure) definition")).rows[0].definition;
 try{await db.exec('alter function private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb) security definer');await assert.rejects(db.exec(patch),/execution metadata changed/);await db.exec('rollback');await db.exec(current);
 await db.exec(current.replace('NEWAR_ORIGINAL_WORKORDER_COHORT_V1','UNKNOWN_EDIT'));await assert.rejects(db.exec(patch),/baseline changed/);await db.exec('rollback');await db.exec(current);
 await db.exec('grant execute on function private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb) to authenticated');await assert.rejects(db.exec(patch),/ACL changed/);await db.exec('rollback');}
 finally{await db.exec('revoke all on function private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb) from authenticated');await db.exec(current);await db.exec('begin');}
});
