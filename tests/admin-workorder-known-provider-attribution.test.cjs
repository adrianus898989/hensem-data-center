// Exact original/provider attribution executes in real PostgreSQL with synthetic records only.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'../supabase',p),'utf8');
const patch=read('migrations/20260930140000_newar_workorder_original_totals.sql');
const oldPatch=read('migrations/20260928150000_admin_live_workorder_unique_not_received.sql');
const req={country:'印度',startAt:'2026-09-29T00:00:00+05:30',endAt:'2026-09-29T23:59:59+05:30',direction:'charge',limit:20};
const kycPatch=read('migrations/20260930170000_workorder_not_received_kyc.sql');
const coveragePatch=read('migrations/20260930191000_workorder_cohort_coverage.sql');
const attributionPatch=read('migrations/20260930221000_workorder_known_provider_attribution.sql');
let db,legacy,baseAcl,baseSummaryBody,preKyc,preCoverage,preAttribution;
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
 await db.exec(patch);await db.exec('alter table ar_workorder_issue_details add column kyc_connected boolean');preKyc=await call();await db.exec(kycPatch);preCoverage=await call();await db.exec(coveragePatch);preAttribution=await call();await db.exec(attributionPatch);
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


test('five known rows plus two unmarked rows produce two originals without false conflicts or duplicate amounts',async()=>{
 await resetAr();
 for(let i=1;i<=3;i++)await ar('KNOWN-A'+i,'ORIGINAL-A',{provider:'SUPER',amount:200,kyc:false});
 for(let i=1;i<=2;i++)await ar('KNOWN-B'+i,'ORIGINAL-B',{provider:'SUPER',amount:300,kyc:false});
 await ar('UNKNOWN-A','ORIGINAL-A',{provider:'未标记三方',amount:200,status:4,kyc:true});
 await ar('UNKNOWN-B','ORIGINAL-B',{provider:'未标记三方',amount:300,kyc:true});await rebuildAr();
 const r=await arCall(),s=provider(r,'SUPER');
 assert.equal(r.summary.submittedCount,7);assert.equal(s.submittedCount,5);
 assert.equal(r.summary.uniqueOrderCount,2);assert.equal(s.uniqueOrderCount,2);
 assert.equal(s.uniqueOrderAmount,500);assert.equal(s.uniqueSuccessCount,1);assert.equal(s.uniqueSuccessAmount,200);
 assert.equal(s.uniqueNotReceivedCount,1);assert.equal(s.uniqueNotReceivedAmount,300);
 assert.equal(s.uniqueNotReceivedKycCount,1);assert.equal(s.uniqueNotReceivedKycAmount,300);
 assert.equal(s.uniqueCoverage.providerConflictCount,0);assert.equal(s.uniqueCoverage.resolvedProviderOrderCount,2);
 assert.equal(s.uniqueCoverage.unknownProviderRecordCount,2);assert.equal(s.uniqueCoverage.unresolvedProviderOrderCount,0);
 assert.equal(s.uniqueCoverage.complete,true);assert.equal(r.summary.uniqueCoverage.complete,true);
 assert.equal(s.uniqueCoverage.detailCount,5);assert.equal(s.uniqueCoverage.detailMismatchCount,0);
 assert.equal(s.uniqueCoverage.diagnosticDays[0].resolvedProviderOrderCount,2);
 assert.equal(s.uniqueCoverage.diagnosticDays[0].unknownProviderRecordCount,2);
 assert.equal(provider(r,'未标记三方').uniqueOrderCount,null);
});
test('selecting the known provider still includes related unmarked status and KYC evidence',async()=>{
 await resetAr();await ar('KNOWN','REF',{provider:'SUPER',status:3,kyc:false});
 await ar('UNKNOWN','REF',{provider:'未标记三方',status:4,kyc:true});await rebuildAr();
 const r=await arCall({providers:['SUPER']}),s=provider(r,'SUPER');
 assert.equal(r.byProvider.length,1);assert.equal(r.summary.submittedCount,1);
 assert.equal(s.uniqueOrderCount,1);assert.equal(s.uniqueSuccessCount,1);assert.equal(s.uniqueSuccessAmount,100);
 assert.equal(s.uniqueNotReceivedCount,0);assert.equal(s.uniqueCoverage.resolvedProviderOrderCount,1);
 assert.equal(s.uniqueCoverage.complete,true);
});
test('related unmarked KYC true confirms only one not-received original',async()=>{
 await resetAr();await ar('KNOWN','REF',{provider:'SUPER',kyc:false});
 await ar('UNKNOWN','REF',{provider:'未标记三方',kyc:true});await rebuildAr();
 const s=provider(await arCall({providers:['SUPER']}),'SUPER');
 assert.equal(s.uniqueNotReceivedCount,1);assert.equal(s.uniqueNotReceivedKycCount,1);
 assert.equal(s.uniqueNotReceivedKycAmount,100);assert.equal(s.uniqueCoverage.kycUnknownOrderCount,0);
});
test('related unmarked unknown KYC does not become a false known-negative result',async()=>{
 await resetAr();await ar('KNOWN','REF',{provider:'SUPER',kyc:false});
 await ar('UNKNOWN','REF',{provider:'未标记三方',kyc:null});await rebuildAr();
 const s=provider(await arCall({providers:['SUPER']}),'SUPER');
 assert.equal(s.uniqueNotReceivedCount,1);assert.equal(s.uniqueNotReceivedKycCount,null);
 assert.equal(s.uniqueNotReceivedKycAmount,null);assert.equal(s.uniqueCoverage.kycUnknownOrderCount,1);
});
test('different amounts on related unmarked records remain a real amount conflict',async()=>{
 await resetAr();await ar('KNOWN','REF',{provider:'SUPER',amount:100});
 await ar('UNKNOWN','REF',{provider:'未标记三方',amount:200,kyc:true});await rebuildAr();
 const s=provider(await arCall({providers:['SUPER']}),'SUPER');
 assert.equal(s.uniqueOrderCount,1);assert.equal(s.uniqueOrderAmount,null);assert.equal(s.uniqueNotReceivedAmount,null);
 assert.equal(s.uniqueCoverage.providerConflictCount,0);assert.equal(s.uniqueCoverage.amountConflictCount,1);
 assert.equal(s.uniqueCoverage.complete,false);assert.equal(s.uniqueCoverage.diagnosticDays[0].amountConflictCount,1);
});
test('a confirmed related amount fills an unknown amount without multiplication',async()=>{
 await resetAr();await ar('KNOWN','REF',{provider:'SUPER',amount:null});
 await ar('UNKNOWN','REF',{provider:'未标记三方',amount:250});await rebuildAr();
 const s=provider(await arCall({providers:['SUPER']}),'SUPER');
 assert.equal(s.uniqueOrderAmount,250);assert.equal(s.uniqueCoverage.amountConflictCount,0);
 assert.equal(s.uniqueCoverage.missingAmountCount,0);assert.equal(s.uniqueCoverage.complete,true);
});
test('all unknown aliases remain unresolved, never multiple competing providers',async()=>{
 await resetAr();await ar('A','REF',{provider:'未标记三方',kyc:false});
 await ar('B','REF',{provider:'未识别三方',kyc:false});await ar('C','REF',{provider:null,kyc:false});await rebuildAr();
 const r=await arCall();
 assert.equal(r.summary.uniqueOrderCount,1);assert.equal(r.summary.uniqueOrderAmount,100);
 assert.equal(r.summary.uniqueCoverage.providerConflictCount,0);
 assert.equal(r.summary.uniqueCoverage.unresolvedProviderOrderCount,1);
 assert.equal(r.summary.uniqueCoverage.resolvedProviderOrderCount,0);
 assert.equal(r.summary.uniqueCoverage.complete,false);
 assert.ok(r.byProvider.every(p=>p.uniqueOrderCount===null));
 assert.ok(r.summary.uniqueCoverage.diagnosticDays.every(d=>d.providerConflictCount===0));
});
test('two known providers remain a conflict even with an additional unmarked record',async()=>{
 await resetAr();await ar('SUPER','REF',{provider:'SUPER',amount:100,kyc:false});
 await ar('OTHER','REF',{provider:'OtherPay',amount:200,status:4,kyc:true});
 await ar('UNKNOWN','REF',{provider:'未标记三方',amount:300,status:4,kyc:true});await rebuildAr();
 const all=await arCall(),filtered=await arCall({providers:['SUPER']});
 assert.equal(all.summary.uniqueOrderCount,1);assert.equal(all.summary.uniqueCoverage.providerConflictCount,1);
 assert.equal(provider(all,'SUPER').uniqueOrderCount,null);assert.equal(provider(all,'OtherPay').uniqueOrderCount,null);
 assert.equal(filtered.summary.uniqueOrderCount,1);assert.equal(filtered.summary.uniqueOrderAmount,100);
 assert.equal(filtered.summary.uniqueSuccessCount,0);assert.equal(filtered.summary.uniqueNotReceivedKycCount,null);
 assert.equal(filtered.summary.uniqueCoverage.providerConflictCount,1);
 assert.equal(filtered.summary.uniqueCoverage.resolvedProviderOrderCount,0);
 assert.equal(provider(filtered,'SUPER').uniqueCoverage.providerConflictCount,1);
});
test('a selected unknown source cohort does not borrow unselected known success or amount',async()=>{
 await resetAr();await ar('SUPER','REF',{provider:'SUPER',amount:200,status:4,kyc:true});
 await ar('UNKNOWN','REF',{provider:'未标记三方',amount:100,status:3,kyc:false});await rebuildAr();
 const r=await arCall({providers:['未标记三方']});
 assert.equal(r.summary.uniqueOrderCount,1);assert.equal(r.summary.uniqueOrderAmount,100);
 assert.equal(r.summary.uniqueSuccessCount,0);assert.equal(r.summary.uniqueCoverage.resolvedProviderOrderCount,0);
 assert.equal(r.byProvider.length,1);assert.equal(r.byProvider[0].provider,'未标记三方');
});
test('an unrelated provider selection does not import the resolved original',async()=>{
 await resetAr();await ar('SUPER','REF',{provider:'SUPER'});await ar('UNKNOWN','REF',{provider:'未标记三方',status:4});
 await ar('OTHER','OTHER-REF',{provider:'OtherPay',amount:80,kyc:false});await rebuildAr();
 const r=await arCall({providers:['OtherPay']});
 assert.equal(r.summary.uniqueOrderCount,1);assert.equal(r.summary.uniqueOrderAmount,80);
 assert.equal(r.summary.uniqueSuccessCount,0);assert.equal(r.summary.uniqueCoverage.resolvedProviderOrderCount,0);
});
test('matching references on another platform, day or direction cannot resolve or affect the selected original',async()=>{
 await resetAr();await ar('SUPER','REF',{provider:'SUPER',amount:100,kyc:false});
 await ar('OTHER-PLATFORM','REF',{provider:'未标记三方',platform:'OtherPlatform',amount:200,status:4,kyc:true});
 await ar('OTHER-DAY','REF',{provider:'未标记三方',date:'2026-09-28',amount:300,status:4,kyc:true});
 await ar('OTHER-DIRECTION','REF',{provider:'未标记三方',kind:'withdraw',amount:400,status:4,kyc:true});await rebuildAr();
 const r=await arCall({providers:['SUPER']}),s=provider(r,'SUPER');
 assert.equal(s.uniqueOrderCount,1);assert.equal(s.uniqueOrderAmount,100);assert.equal(s.uniqueSuccessCount,0);
 assert.equal(s.uniqueCoverage.resolvedProviderOrderCount,0);assert.equal(s.uniqueCoverage.unknownProviderRecordCount,0);
 assert.equal(s.uniqueNotReceivedKycCount,0);assert.equal(s.uniqueCoverage.complete,true);
});
test('permission scoping and pagination remain independent of original attribution',async()=>{
 await resetAr();await ar('SUPER','REF',{provider:'SUPER',kyc:false});await ar('UNKNOWN','REF',{provider:'未标记三方',kyc:true});await rebuildAr();
 await db.exec(`select set_config('test.scope','{"mode":"selected","platforms":["Alpha"]}',true)`);
 const r=await call(),paged=await call({offset:99999});
 assert.deepEqual(r.summary,paged.summary);assert.doesNotMatch(JSON.stringify(r),/Dhani|TukPay|RushPay/);
 assert.equal(provider(r,'SUPER').uniqueNotReceivedKycCount,1);
});
test('no-unknown baseline is unchanged except new explicit diagnostic counters',async()=>{
 const stripNew=v=>Array.isArray(v)?v.map(stripNew):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!['unresolvedProviderOrderCount','resolvedProviderOrderCount','unknownProviderRecordCount'].includes(k)).map(([k,x])=>[k,stripNew(x)])):v;
 assert.deepEqual(stripNew(await call()),preAttribution);
});
test('migration replay preserves function metadata, ACL and outer read model',async()=>{
 const before=(await db.query("select prosrc,proacl::text acl,proconfig,prosecdef from pg_proc where oid='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure")).rows[0];
 await db.exec(attributionPatch);
 assert.deepEqual((await db.query("select prosrc,proacl::text acl,proconfig,prosecdef from pg_proc where oid='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure")).rows[0],before);
 assert.equal(before.acl,baseAcl);assert.equal(before.prosecdef,false);
 assert.equal((await db.query("select prosrc from pg_proc where oid='private.dashboard_admin_live_workorders(jsonb)'::regprocedure")).rows[0].prosrc,baseSummaryBody);
});
test('widened execution rights are rejected before installation',async()=>{
 await db.exec('grant execute on function private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb) to authenticated');
 await assert.rejects(db.exec(attributionPatch),/ACL changed/);
});

test('AR and NEW_AR records with the same reference remain independent source originals',async()=>{
 await resetAr();await db.exec('delete from newar_detail_records');
 await ar('AR-SUPER','SHARED-REF',{provider:'SUPER',kyc:false});
 await put('NEWAR-UNKNOWN','SHARED-REF',{provider:'未标记三方',status:'4',amount:500});
 await rebuild();await rebuildAr();
 const r=await call(),s=provider(r,'SUPER');
 assert.equal(r.summary.uniqueOrderCount,2);assert.equal(r.summary.uniqueSuccessCount,1);
 assert.equal(r.summary.uniqueOrderAmount,600);assert.equal(s.uniqueOrderCount,1);
 assert.equal(s.uniqueSuccessCount,0);assert.equal(s.uniqueOrderAmount,100);
 assert.equal(s.uniqueCoverage.resolvedProviderOrderCount,0);assert.equal(s.uniqueCoverage.complete,true);
});
test('known alias normalization and case-insensitive unknown markers retain a single original',async()=>{
 await resetAr();await ar('A','REF',{provider:'SUPER',kyc:false});await ar('B','REF',{provider:'SUPER-QR',kyc:false});
 await ar('U1','REF',{provider:'Un_Marked',kyc:true});await ar('U2','REF',{provider:'UNKNOWN',kyc:false});await rebuildAr();
 const s=provider(await arCall({providers:['SUPER']}),'SUPER');
 assert.equal(s.submittedCount,2);assert.equal(s.uniqueOrderCount,1);assert.equal(s.uniqueOrderAmount,100);
 assert.equal(s.uniqueNotReceivedKycCount,1);assert.equal(s.uniqueCoverage.providerConflictCount,0);
 assert.equal(s.uniqueCoverage.resolvedProviderOrderCount,1);assert.equal(s.uniqueCoverage.unknownProviderRecordCount,2);
});
test('unknown rows without an explicit original number cannot be attached to a known original',async()=>{
 await resetAr();await ar('KNOWN','REF',{provider:'SUPER',kyc:false});
 await ar('UNKNOWN',null,{provider:'未标记三方',status:4,kyc:true});await rebuildAr();
 const s=provider(await arCall({providers:['SUPER']}),'SUPER');
 assert.equal(s.uniqueOrderCount,1);assert.equal(s.uniqueSuccessCount,0);assert.equal(s.uniqueNotReceivedKycCount,0);
 assert.equal(s.uniqueCoverage.resolvedProviderOrderCount,0);assert.equal(s.uniqueCoverage.complete,true);
});
test('cross-day known and unknown records can combine only inside the requested date range',async()=>{
 await resetAr();await ar('KNOWN','REF',{provider:'SUPER',date:'2026-09-29',kyc:false});
 await ar('UNKNOWN','REF',{provider:'未标记三方',date:'2026-09-28',status:4,kyc:true});await rebuildAr();
 const one=provider(await arCall({providers:['SUPER']}),'SUPER');
 const both=provider(await arCall({providers:['SUPER'],startAt:'2026-09-28T00:00:00+05:30'}),'SUPER');
 assert.equal(one.uniqueSuccessCount,0);assert.equal(one.uniqueCoverage.resolvedProviderOrderCount,0);
 assert.equal(both.uniqueOrderCount,1);assert.equal(both.uniqueSuccessCount,1);
 assert.equal(both.uniqueCoverage.resolvedProviderOrderCount,1);assert.equal(both.uniqueCoverage.detailCount,1);
});
test('an unexpected helper body is rejected rather than silently replaced',async()=>{
 await db.exec("create or replace function private.dashboard_admin_live_workorder_unique_totals(p_request jsonb,p_result jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$begin return p_result;end;$$");
 await assert.rejects(db.exec(attributionPatch),/baseline changed/);
});
