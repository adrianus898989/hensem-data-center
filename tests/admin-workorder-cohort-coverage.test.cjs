// Cohort coverage executes in real PostgreSQL with synthetic records only.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'../supabase',p),'utf8');
const patch=read('migrations/20260930140000_newar_workorder_original_totals.sql');
const oldPatch=read('migrations/20260928150000_admin_live_workorder_unique_not_received.sql');
const req={country:'印度',startAt:'2026-09-29T00:00:00+05:30',endAt:'2026-09-29T23:59:59+05:30',direction:'charge',limit:20};
const kycPatch=read('migrations/20260930170000_workorder_not_received_kyc.sql');
const coveragePatch=read('migrations/20260930191000_workorder_cohort_coverage.sql');
let db,legacy,baseAcl,baseSummaryBody,preKyc,preCoverage;
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
 await db.exec(patch);await db.exec('alter table ar_workorder_issue_details add column kyc_connected boolean');preKyc=await call();await db.exec(kycPatch);preCoverage=await call();await db.exec(coveragePatch);
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

test('one missing platform does not contaminate complete platform/provider cohorts',async()=>{
 await db.exec("insert into catalog values('33333333-3333-4333-8333-333333333333','Missing','Missing','印度','IN','ar')");
 const r=await call(),a=provider(r,'ArbPay');
 assert.equal(r.coverage.complete,false);assert.equal(r.summary.uniqueCoverage.complete,false);
 assert.equal(a.uniqueCoverage.complete,true);assert.equal(a.uniqueCoverage.sourceCoverage.complete,true);
 assert.deepEqual(a.uniqueCoverage.sourceCoverage.platforms.map(x=>x.platform),['Alpha']);
 assert.equal(r.byPlatformProvider.find(x=>x.platform==='Alpha').uniqueCoverage.complete,true);
 const missing=r.summary.uniqueCoverage.sourceCoverage.platforms.find(x=>x.platform==='Missing');
 assert.deepEqual(missing.missingDates,['2026-09-29']);assert.equal(missing.days,0);
});
test('all original-order and KYC metrics retain their baseline when coverage is complete',async()=>{
 const stripAdded=v=>Array.isArray(v)?v.map(stripAdded):v&&typeof v==='object'
  ?Object.fromEntries(Object.entries(v).filter(([k])=>!['diagnosticVersion','diagnosticDays','sourceCoverage'].includes(k)).map(([k,x])=>[k,stripAdded(x)])):v;
 assert.deepEqual(stripAdded(await call()),preCoverage);
});
test('local missing dates are explicit and cannot be rendered as confirmed zero days',async()=>{
 const r=await arCall({startAt:'2026-09-28T00:00:00+05:30'}),a=provider(r,'ArbPay');
 assert.equal(a.uniqueCoverage.complete,false);
 assert.deepEqual(a.uniqueCoverage.sourceCoverage.platforms[0].missingDates,['2026-09-28']);
 assert.equal(a.uniqueCoverage.sourceCoverage.platforms[0].days,1);
 assert.equal(a.uniqueCoverage.sourceCoverage.platforms[0].expectedDays,2);
});
test('daily deficits and excesses cannot cancel into complete range coverage',async()=>{
 await resetAr();await ar('A','A',{date:'2026-09-28'});await ar('B','B',{date:'2026-09-29'});await ar('C','C',{date:'2026-09-29'});await rebuildAr();
 await db.exec("update workorder_deposit_daily set submitted_count=case when stat_date='2026-09-28' then 2 else 1 end");
 const a=provider(await arCall({startAt:'2026-09-28T00:00:00+05:30'}),'KycPay');
 assert.equal(a.uniqueCoverage.detailMismatchCount,0);assert.equal(a.uniqueCoverage.complete,false);
 assert.equal(a.uniqueOrderCount,3);assert.equal(a.uniqueCoverage.diagnosticDays.length,2);
 const missing=a.uniqueCoverage.diagnosticDays.find(x=>x.date==='2026-09-28');
 assert.equal(missing.expectedCount,2);assert.equal(missing.detailCount,1);assert.equal(missing.missingDetailCount,1);
});
test('a missing daily report leaves expected counts unknown rather than inventing zero',async()=>{
 await resetAr();await ar('A','A',{date:'2026-09-28'});await ar('B','B',{date:'2026-09-29'});await rebuildAr();
 await db.exec("delete from workorder_deposit_daily where platform='Alpha' and stat_date='2026-09-28'");
 const a=provider(await arCall({startAt:'2026-09-28T00:00:00+05:30'}),'KycPay');
 const unknown=a.uniqueCoverage.diagnosticDays.find(x=>x.date==='2026-09-28');
 assert.equal(unknown.expectedAvailable,false);assert.equal(unknown.expectedCount,null);
 assert.equal(unknown.missingDetailCount,null);assert.equal(unknown.detailMismatchCount,null);assert.equal(unknown.detailCount,1);
 assert.equal(a.uniqueCoverage.complete,false);assert.deepEqual(a.uniqueCoverage.sourceCoverage.platforms[0].missingDates,['2026-09-28']);
});
test('known report days can compare absent provider rows against zero',async()=>{
 await resetAr();await ar('A','A',{date:'2026-09-28'});await ar('B','B',{date:'2026-09-29'});await ar('C','C',{date:'2026-09-28',provider:'OtherPay'});await rebuildAr();
 await db.exec("delete from workorder_deposit_daily where platform='Alpha' and stat_date='2026-09-28' and third_party='KycPay'");
 const a=provider(await arCall({startAt:'2026-09-28T00:00:00+05:30'}),'KycPay');
 const known=a.uniqueCoverage.diagnosticDays.find(x=>x.date==='2026-09-28');
 assert.equal(known.expectedAvailable,true);assert.equal(known.expectedCount,0);
 assert.equal(known.detailCount,1);assert.equal(known.detailMismatchCount,1);assert.equal(a.uniqueCoverage.complete,false);
});
test('distinct raw labels normalized to one provider preserve both daily rows',async()=>{
 await resetAr();await ar('A','A');await ar('B','B',{provider:' KycPay '});await rebuildAr();
 const a=provider(await arCall(),'KycPay');
 assert.equal(a.submittedCount,2);assert.equal(a.uniqueOrderCount,2);assert.equal(a.uniqueCoverage.complete,true);
 assert.deepEqual(a.uniqueCoverage.diagnosticDays,[]);
});
test('AR missing reference is distinguished from missing records without exposing ticket identifiers',async()=>{
 await resetAr();await ar('private-ticket-secret',null);await rebuildAr();
 await db.exec("update workorder_deposit_daily set submitted_count=3");
 const a=provider(await arCall(),'KycPay'),d=a.uniqueCoverage.diagnosticDays[0];
 assert.equal(d.arPaymentOrderMissingCount,1);assert.equal(d.missingOrderNumberCount,1);
 assert.equal(d.newarExplicitReferenceMissingCount,0);assert.equal(d.missingDetailCount,2);
 assert.equal(d.source,'ar');assert.equal(d.platform,'Alpha');assert.equal(d.date,'2026-09-29');
 assert.equal(a.uniqueOrderCount,null);assert.doesNotMatch(JSON.stringify(d),/private-ticket-secret/);
});
test('NEWAR absent explicit reference and unsupported raw type are separate from the legacy display number',async()=>{
 await db.exec('delete from newar_detail_records');
 await put('N1',null,{raw:{depositOrderNo:null},order:'not-a-proven-deposit'});
 await put('N2',null,{raw:{depositOrderNo:12345}});
 await put('N3',null,{raw:{depositOrderNo:12345,rechargeNumber:'CONFIRMED'}});await rebuild();
 const a=provider(await call({platforms:['DhaniWin']}),'TukPay'),d=a.uniqueCoverage.diagnosticDays[0];
 assert.equal(a.uniqueOrderCount,1);assert.equal(d.detailCount,3);assert.equal(d.missingDetailCount,0);
 assert.equal(d.missingOrderNumberCount,2);assert.equal(d.sourceOrderOnlyCount,1);
 assert.equal(d.newarExplicitReferenceMissingCount,1);assert.equal(d.unsupportedReferenceTypeCount,1);
 assert.equal(d.arPaymentOrderMissingCount,0);assert.equal(d.source,'newar');
});
test('provider and amount conflicts retain original dedupe and show their affected dates',async()=>{
 await resetAr();await ar('A','same',{amount:100});await ar('B','same',{provider:'OtherPay',amount:200});await rebuildAr();
 const r=await arCall(),a=provider(r,'KycPay');
 assert.equal(r.summary.uniqueOrderCount,1);assert.equal(a.uniqueOrderCount,null);
 assert.equal(a.uniqueCoverage.providerConflictCount,1);
 assert.equal(a.uniqueCoverage.diagnosticDays[0].providerConflictCount,1);
 assert.equal(r.summary.uniqueCoverage.diagnosticDays[0].amountConflictCount,1);
});
test('returned zero day is received evidence, but a missing/unresolved identity is not',async()=>{
 await resetAr();await db.exec("insert into workorder_deposit_daily values('2026-09-29','IN','印度','Alpha','Zero','BANK','AR_WORKORDER',0,0,0,0,0,0,0,0,now(),now())");
 const r=await arCall();assert.equal(r.summary.uniqueOrderCount,0);assert.equal(r.summary.uniqueCoverage.complete,true);
 assert.deepEqual(r.summary.uniqueCoverage.sourceCoverage.platforms[0].missingDates,[]);
 const malformed={...r,coverage:{...r.coverage,platforms:r.coverage.platforms.map(x=>({...x,platformId:null}))}};
 const x=(await db.query('select private.dashboard_admin_live_workorder_unique_totals($1,$2) data',[JSON.stringify(req),JSON.stringify(malformed)])).rows[0].data;
 assert.equal(x.summary.uniqueCoverage.complete,false);assert.equal(x.summary.uniqueCoverage.sourceCoverage.platforms[0].identityResolved,false);
});
test('diagnostics retain permission scoping and pagination independence',async()=>{
 await db.exec(`select set_config('test.scope','{"mode":"selected","platforms":["Alpha"]}',true)`);
 const r=await call(),paged=await call({offset:99999});
 assert.deepEqual(r.summary,paged.summary);assert.doesNotMatch(JSON.stringify(r.summary.uniqueCoverage),/Dhani|DHANI|TukPay|RushPay/);
 assert.equal(r.summary.uniqueCoverage.complete,true);
});
test('migration replay is exact and retains both helper and public read-model ACLs',async()=>{
 const before=(await db.query("select prosrc,proacl::text acl,proconfig,prosecdef from pg_proc where oid='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure")).rows[0];
 await db.exec(coveragePatch);
 const after=(await db.query("select prosrc,proacl::text acl,proconfig,prosecdef from pg_proc where oid='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure")).rows[0];
 assert.deepEqual(after,before);assert.equal(after.acl,baseAcl);assert.equal(after.prosecdef,false);
 assert.equal((await db.query("select prosrc from pg_proc where oid='private.dashboard_admin_live_workorders(jsonb)'::regprocedure")).rows[0].prosrc,baseSummaryBody);
});
test('migration rejects an unexpected helper body',async()=>{
 await db.exec("create or replace function private.dashboard_admin_live_workorder_unique_totals(p_request jsonb,p_result jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$begin return p_result;end;$$");
 await assert.rejects(db.exec(coveragePatch),/baseline changed/);
});
test('migration rejects widened helper execution rights even when its body matches',async()=>{
 await db.exec('grant execute on function private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb) to authenticated');
 await assert.rejects(db.exec(coveragePatch),/ACL changed/);
});
