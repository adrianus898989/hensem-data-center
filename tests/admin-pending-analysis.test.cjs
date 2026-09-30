// Offline synthetic pending-stock fixtures. Never connects to production.
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const repo=path.resolve(__dirname,'..');
const read=n=>fs.readFileSync(path.join(repo,'supabase',n),'utf8');
const sourceSql=read('admin-live-pending-snapshot.sql');
const sql=read('migrations/20260930130000_pending_analysis.sql');
const owner='10000000-0000-0000-0000-000000000001',viewer='10000000-0000-0000-0000-000000000002';
const id=n=>'20000000-0000-0000-0000-'+String(n).padStart(12,'0');
const date='2026-09-26';let db;
const as=async uid=>db.query("select set_config('test.uid',$1,false)",[uid]);
async function call(ids,extra={}){return(await db.query('select public.dashboard_admin_live_pending_analysis($1::jsonb) data',[JSON.stringify({startDate:date,endDate:date,platformIds:ids,...extra})])).rows[0].data;}
async function target(n,name='SYNTHETIC',options={}){
 const {source='ar',country='IN',currency='INR',team='M8',sourceName=name}=options;
 await db.query('insert into '+(source==='withdraw'?'seed_catalog':'native_catalog')+' values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id(n),name,team,country==='IN'?'印度':country,country,source,'Asia/Kolkata',currency,sourceName]);
 return id(n);
}
async function snapshot(platform,groups=[{raw_channel:'SYNTHETIC_PAY',channel_type:'BANK',pending_count:2,pending_amount:120}],options={}){
 const count=groups.reduce((a,g)=>a+g.pending_count,0),amount=groups.reduce((a,g)=>a+g.pending_amount,0);
 const {country='IN',day=date,capture='2026-09-27',start='2026-09-20',end=day,at='2026-09-26T18:30:15Z',source='WITHDRAW_REVIEW',change={}}=options;
 const value={schema_version:1,source_system:source,country_code:country,platform,stat_date:day,timezone:'Asia/Kolkata',snapshot_id:id(900),snapshot_at:at,coverage:{complete:true,expected_count:count,fetched_count:count,unique_count:count},totals:{pending_count:count,pending_amount:amount},groups,...change};
 await db.query('insert into withdraw_pending_backlog_daily values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9)',[source,country,platform,day,capture,start,end,id(900),at,JSON.stringify(value)]);
}
before(async()=>{
 db=new PGlite();
 await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;create role service_role;
 grant usage on schema auth,private to authenticated;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table dashboard_profiles(auth_user_id uuid primary key,role text,active boolean,data_scope jsonb,permissions jsonb);
 create table dashboard_admin_preview_grants(auth_user_id uuid primary key,can_view boolean not null);
 create function private.dashboard_current_data_scope() returns jsonb language sql stable security definer set search_path='' as $$select coalesce((select p.data_scope from public.dashboard_profiles p where p.auth_user_id=auth.uid() and p.active),'{"mode":"selected","countries":[]}'::jsonb)$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select coalesce($1->>'mode'='all' or ($1->>'mode'='selected' and $1->'countries' ? $2 and (not ($1 ? 'platforms') or $1->'platforms' ? $3)),false)$$;
 insert into dashboard_profiles values('${owner}','owner',true,'{"mode":"all","countries":[]}','{}'),('${viewer}','viewer',true,'{"mode":"selected","countries":["IN"]}','{}');
 insert into dashboard_admin_preview_grants values('${viewer}',true);
 create table native_catalog(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text);
 create table seed_catalog(like native_catalog);
 create table dashboard_platform_team_map(country_code text,source_platform text,platform_name text,team_name text,active boolean);
 create table withdraw_pending_backlog_daily(source_system text,country_code text,platform text,stat_date date,capture_date date,window_start date,window_end date,snapshot_id uuid,snapshot_at timestamptz,snapshot jsonb,updated_at timestamptz,primary key(source_system,country_code,platform,stat_date));
 alter table withdraw_pending_backlog_daily enable row level security;
 create table withdraw_pending_daily(source_system text,country_code text,platform text,stat_date date,snapshot_id uuid unique,snapshot_at timestamptz,snapshot jsonb,updated_at timestamptz,primary key(source_system,country_code,platform,stat_date));
 create table withdraw_pending_orders(source_system text,country_code text,platform text,stat_date date,order_no text,member_id text,amount numeric,applied_at timestamp without time zone,timezone text,raw_channel text,channel_type text,status text,snapshot_id uuid,snapshot_at timestamptz,updated_at timestamptz,primary key(source_system,country_code,platform,stat_date,order_no));
 create index synthetic_pending_snapshot_idx on withdraw_pending_orders(snapshot_id);
 create table newar_detail_platforms(country_code text,platform text,timezone text,launch_at timestamptz);
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select case upper(btrim($1)) when 'VEER.GAME' then 'VEERGAME' when 'SHREE.WIN' then 'SHREEWIN' when 'DHANI.WIN' then 'DHANIWIN' else upper(btrim($1)) end$$;
 create function public.collection_success_safe_descriptor(text,integer) returns boolean language sql immutable as $$select $1 is not null and length($1) between 1 and $2 and $1!~'[[:cntrl:]]'$$;
 create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[]);
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text);`);
 const base=read('admin-live-query.sql');await db.exec(base.slice(base.indexOf('create function private.dashboard_admin_live_scope()'),base.indexOf('create function private.dashboard_admin_live_platforms()')));
 await db.exec(`create function private.dashboard_admin_live_platforms() returns setof public.native_catalog language plpgsql stable security definer set search_path='' as $$declare s jsonb:=private.dashboard_admin_live_scope();begin return query select * from public.native_catalog p where private.dashboard_scope_allows(s,p.scope_group,p.source_name);end$$;
 create function private.dashboard_admin_live_withdraw_platforms() returns setof public.seed_catalog language plpgsql stable security definer set search_path='' as $$declare s jsonb:=private.dashboard_admin_live_scope();begin return query select * from public.seed_catalog p where private.dashboard_scope_allows(s,p.scope_group,p.source_name);end$$;`);
 const pending=read('migrations/20260915113000_withdraw_pending_daily.sql');
 await db.exec(pending.slice(pending.indexOf('create function public.withdraw_pending_is_count'),pending.indexOf('create function public.publish_withdraw_pending_snapshot')).replace("v_coverage->'expected_count' <> v_coverage->'fetched_count'","(v_coverage->>'fetched_count')::numeric < (v_coverage->>'unique_count')::numeric").replace("(v_group->>'pending_count')::numeric <= 0","(v_group->>'pending_count')::numeric < 0"));
 await db.exec(read('admin-live-provider-aliases.sql'));
 const config=read('admin-live-configuration.sql');await db.exec(config.slice(config.indexOf('create or replace function private.dashboard_admin_live_provider_alias_values'),config.indexOf('revoke all on function private.dashboard_admin_live_provider_alias_values')));
 const canonical=read('admin-live-india-usdt-classification.sql');await db.exec(canonical.slice(canonical.indexOf('create or replace function private.dashboard_admin_live_provider_canonical('),canonical.indexOf('create or replace function private.dashboard_admin_live_provider_rows(')));
 await db.exec(sourceSql);await db.exec(sql);
});
beforeEach(async()=>{await db.exec('reset role;truncate native_catalog,seed_catalog,dashboard_platform_team_map,withdraw_pending_backlog_daily,withdraw_pending_daily,withdraw_pending_orders,newar_detail_platforms;update dashboard_profiles set active=true;update dashboard_admin_preview_grants set can_view=true;');await as(owner);});
after(async()=>{if(db)await db.close()});

test('returns ordered independent daily snapshots, never totals overlapping stock',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC');
 await snapshot('SYNTHETIC',[{raw_channel:'SYNTHETIC_PAY',channel_type:'BANK',pending_count:3,pending_amount:180}],{day:'2026-09-25',capture:'2026-09-26',start:'2026-09-19',at:'2026-09-25T18:30:15Z'});
 const r=await call([a],{startDate:'2026-09-25'});
 assert.equal(r.version,1);assert.equal(r.basis,'seven_day_pending_snapshot');assert.equal(r.startDate,'2026-09-25');assert.equal(r.endDate,date);
 assert.deepEqual(r.daily.map(d=>[d.snapshotDate,d.count,Number(d.amount)]),[['2026-09-25',3,180],[date,2,120]]);
 assert.ok(r.daily.every(d=>d.complete));assert.equal(r.count,undefined);assert.equal(r.amount,undefined);
 const direct=(await db.query('select private.dashboard_admin_live_pending_snapshot($1::jsonb) data',[JSON.stringify({date,platformIds:[a]})])).rows[0].data;
 assert.deepEqual(r.daily[1],direct);assert.equal(r.aging.available,false);
});
test('missing day remains unknown, complete zero remains zero, and incomplete platform response stays partial',async()=>{
 const a=await target(1,'ZERO'),b=await target(2,'MISSING');await snapshot('ZERO',[]);
 const r=await call([a,b],{startDate:'2026-09-25'});
 assert.deepEqual(r.daily.map(d=>[d.complete,d.receivedPlatformCount,d.count,d.amount]),[[false,0,null,null],[false,1,0,'0']]);
 assert.equal(r.daily[1].rows.find(p=>p.name==='ZERO').state,'complete');assert.equal(r.daily[1].rows.find(p=>p.name==='MISSING').count,null);
});
test('honors exact provider filters and deduplicates native/report platform identities on every day',async()=>{
 const a=await target(1,'RAJA'),b=await target(2,'RAJALOTTERY',{source:'withdraw'});
 await snapshot('RAJA',[{raw_channel:'USDT(TRC20)-3',channel_type:'USDT',pending_count:2,pending_amount:20},{raw_channel:'OTHER',channel_type:'BANK',pending_count:3,pending_amount:300}]);
 const r=await call([a,b],{providers:['TronPayUSDT']});assert.equal(r.daily[0].expectedPlatformCount,1);assert.equal(r.daily[0].count,2);assert.equal(r.daily[0].groups[0].provider,'TronPayUSDT');
 const zero=await call([a],{providers:['ABSENT']});assert.equal(zero.daily[0].complete,true);assert.equal(zero.daily[0].count,0);
});
test('accepts one and 31 calendar days, rejects 32 and malformed or unsupported request fields',async()=>{
 const a=await target(1);assert.equal((await call([a])).daily.length,1);assert.equal((await call([a],{startDate:'2026-08-27'})).daily.length,31);
 for(const extra of [{startDate:'2026-08-26'},{startDate:'2026-09-27'},{startDate:'2026-02-30'},
 {endDate:'2026-9-26'},{endDate:'2099-01-01'},{startDate:'1999-12-31'},
 {startDate:null},{endDate:5},{date},{operation:'summary'}, {providers:null},{providers:['X','X']},{providers:['bad\nvalue']}]){
  await assert.rejects(()=>call([a],extra),/invalid_|duplicate_/);
 }
 await assert.rejects(()=>call([]),/invalid_request/);await assert.rejects(()=>call([a,a]),/duplicate_platform/);
 await assert.rejects(()=>call(['not-uuid']),/invalid_request/);await assert.rejects(()=>call([id(999)]),/platform_denied/);
 await assert.rejects(()=>db.query('select public.dashboard_admin_live_pending_analysis(null)'),/invalid_request/);
});
test('reuses fresh authorization and single-currency validation with no table grants',async()=>{
 const a=await target(1,'ALLOWED'),b=await target(2,'FOREIGN',{country:'PK',currency:'PKR'});await snapshot('ALLOWED');
 await assert.rejects(()=>call([a,b]),/mixed_currency/);await as(viewer);await db.exec('set role authenticated');assert.equal((await call([a])).daily[0].count,2);
 await assert.rejects(()=>call([b]),/platform_denied/);await assert.rejects(()=>db.query('select * from public.withdraw_pending_backlog_daily'),/permission denied/);
 await db.exec('reset role;update dashboard_admin_preview_grants set can_view=false');await assert.rejects(()=>call([a]),/preview_denied/);
 await db.exec('update dashboard_admin_preview_grants set can_view=true;update dashboard_profiles set active=false');await assert.rejects(()=>call([a]),/preview_denied/);
 await as('');await assert.rejects(()=>call([a]),/login_required/);
});
test('query leaves source tables and established single-day functions unchanged',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC');
 const metadata=async()=> (await db.query("select n.nspname,p.proname,md5(p.prosrc),p.proacl::text,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='dashboard_admin_live_pending_snapshot' order by 1")).rows;
 const prior=await metadata(),rows=(await db.query('select * from withdraw_pending_backlog_daily')).rows;
 await call([a],{startDate:'2026-09-20'});await db.exec(sql);assert.deepEqual(await metadata(),prior);assert.deepEqual((await db.query('select * from withdraw_pending_backlog_daily')).rows,rows);
});
test('replay accepts only exact function bodies and ACL; rejects widened or withdrawn permission',async()=>{
 const metadata=async()=> (await db.query("select n.nspname,p.proname,md5(p.prosrc),p.proacl::text,p.proconfig,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='dashboard_admin_live_pending_analysis' order by 1")).rows;
 const prior=await metadata();await db.exec(sql);assert.deepEqual(await metadata(),prior);
 for(const change of [
  "create or replace function public.dashboard_admin_live_pending_analysis(p_request jsonb) returns jsonb language sql stable security invoker set search_path='' as $$select '{}'::jsonb;$$",
  'grant execute on function public.dashboard_admin_live_pending_analysis(jsonb) to anon',
  'grant execute on function private.dashboard_admin_live_pending_analysis(jsonb) to service_role',
  'revoke execute on function private.dashboard_admin_live_pending_analysis(jsonb) from authenticated',
  "alter function private.dashboard_admin_live_pending_analysis(jsonb) set search_path to public"
 ]){
  await db.exec('begin;'+change);await assert.rejects(()=>db.exec(sql),/Pending analysis definition or permissions changed/);await db.exec('rollback');assert.deepEqual(await metadata(),prior);
 }
});
test('initial install removes Supabase default execution grants from both public and private functions',async()=>{
 await db.exec(`drop function public.dashboard_admin_live_pending_analysis(jsonb);drop function private.dashboard_admin_live_pending_analysis(jsonb);
 alter default privileges in schema public grant execute on functions to service_role;
 alter default privileges in schema private grant execute on functions to service_role;`);
 await db.exec(sql);
 for(const schema of ['public','private']){
  const acl=(await db.query("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('service_role',$1,'EXECUTE') service,has_function_privilege('authenticated',$1,'EXECUTE') authenticated",[schema+'.dashboard_admin_live_pending_analysis(jsonb)'])).rows[0];
  assert.deepEqual(acl,{anon:false,service:false,authenticated:true});
 }
 await db.exec(sql);await db.exec('alter default privileges in schema public revoke execute on functions from service_role;alter default privileges in schema private revoke execute on functions from service_role;');
});
let syntheticReceipt=2000;
async function details(platform,orders,options={}){
 const at=options.at||'2026-09-26T18:30:15Z',country=options.country||'IN',source='WITHDRAW_REVIEW',partitions=new Map();
 for(let i=0;i<orders.length;i++){
  const o=orders[i],applied=o.appliedAt===null?null:o.appliedAt||new Date(Date.parse(at)-(o.hours??1)*3600000+5.5*3600000).toISOString().slice(0,19);
  const day=o.day||applied?.slice(0,10)||date;
  if(!partitions.has(day)){
   const receipt=id(++syntheticReceipt);partitions.set(day,receipt);
   await db.query('insert into withdraw_pending_daily values($1,$2,$3,$4,$5,$6,$7,$6)',[source,country,platform,day,receipt,at,JSON.stringify({fixture:'synthetic'})]);
  }
  await db.query('insert into withdraw_pending_orders values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)',
   [source,country,platform,day,'SYNTHETIC_'+i,'SYNTHETIC_MEMBER',o.amount??60,applied,o.zone??'Asia/Kolkata',o.provider||'SYNTHETIC_PAY',o.type||'BANK',o.status||'已提交',o.receipt||partitions.get(day),o.at||at]);
 }
}
const group=(provider,count,amount)=>({raw_channel:provider,channel_type:'BANK',pending_count:count,pending_amount:amount});
test('uses exact captured daily partitions, not backlog head ID or current time; all bucket edges partition once',async()=>{
 const a=await target(1);const ages=[.5,1,3,6,12,24,48,72];await snapshot('SYNTHETIC',[group('SYNTHETIC_PAY',8,360)]);
 await details('SYNTHETIC',ages.map((hours,i)=>({hours,amount:(i+1)*10})));
 const r=(await call([a])).aging;assert.equal(r.available,true);assert.equal(r.complete,true);assert.equal(r.coverageComplete,true);
 assert.equal(r.expectedCount,8);assert.equal(r.matchedCount,8);assert.equal(r.count,8);assert.equal(r.unknownCount,0);assert.equal(+r.amount,360);
 assert.deepEqual(r.buckets.map(b=>[b.key,b.count,Number(b.amount)]),ages.map((_,i)=>[i,1,(i+1)*10]));
 assert.equal(r.maxHours,72);assert.equal(r.avgHours,ages.reduce((a,b)=>a+b,0)/ages.length);assert.equal(r.over24Count,3);assert.equal(+r.over24Amount,210);
 assert.equal(r.platforms[0].groups[0].provider,'SYNTHETIC_PAY');assert.equal(r.platforms[0].state,'complete');assert.deepEqual(r.missingPlatforms,[]);
 assert.equal(JSON.stringify(r).includes('SYNTHETIC_MEMBER'),false);assert.equal(JSON.stringify(r).includes('SYNTHETIC_0'),false);
});
test('validates unfiltered full head before provider selection; selected provider cannot hide missing detail',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC',[group('A',1,100),group('B',1,200)]);
 await details('SYNTHETIC',[{provider:'A',amount:100,hours:1},{provider:'B',amount:200,hours:48}]);
 const selected=(await call([a],{providers:['A']})).aging;assert.equal(selected.complete,true);assert.equal(selected.expectedCount,1);assert.equal(selected.count,1);assert.equal(+selected.amount,100);assert.equal(selected.maxHours,1);assert.equal(selected.platforms[0].groups.length,1);
 await db.query("delete from withdraw_pending_orders where raw_channel='B'");
 const lost=(await call([a],{providers:['A']})).aging;assert.equal(lost.available,false);assert.equal(lost.count,null);assert.equal(lost.platforms[0].state,'detail_unavailable');assert.deepEqual(lost.buckets,[]);
});
test('full head raw-provider/channel groups must match even when total count and amount match',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC',[group('A',1,100),group('B',1,200)]);
 await details('SYNTHETIC',[{provider:'A',amount:200},{provider:'B',amount:100}]);
 const r=(await call([a])).aging;assert.equal(r.available,false);assert.equal(r.expectedCount,2);assert.equal(r.amount,null);assert.equal(r.missingPlatforms[0].state,'detail_unavailable');
});
test('overwritten historical partition or mismatched capture yields unavailable rather than partial historical age',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC');await details('SYNTHETIC',[{amount:60},{amount:60}]);
 assert.equal((await call([a])).aging.complete,true);
 await db.query('update withdraw_pending_daily set snapshot_id=$1',[id(9999)]);
 let r=(await call([a])).aging;assert.equal(r.available,false);assert.equal(r.matchedCount,null);assert.equal(r.expectedCount,2);
 await db.exec('truncate withdraw_pending_daily,withdraw_pending_orders');await details('SYNTHETIC',[{amount:60},{amount:60}],{at:'2026-09-27T18:30:15Z'});
 r=(await call([a])).aging;assert.equal(r.available,false);assert.equal(r.count,null);
});
test('invalid time, timezone, local date and status stay unknown with their own amount; no made-up zero ages',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC',[group('SYNTHETIC_PAY',7,700)]);
 await details('SYNTHETIC',[{amount:100,hours:24},{amount:100,zone:'Asia/Dubai'},
  {amount:100,appliedAt:null},{amount:100,appliedAt:'2026-09-28T00:00:00',day:date},
  {amount:100,status:'已通过'},{amount:100,appliedAt:'2026-09-25T00:00:00',day:date},
  {amount:100,appliedAt:'infinity',day:date}]);
 const r=(await call([a])).aging;assert.equal(r.available,true);assert.equal(r.coverageComplete,true);assert.equal(r.complete,false);
 assert.equal(r.matchedCount,7);assert.equal(r.unknownCount,6);assert.equal(+r.unknownAmount,600);assert.equal(r.count,1);assert.equal(+r.amount,100);assert.equal(r.maxHours,24);
 assert.equal(r.platforms[0].state,'metadata_incomplete');assert.equal(r.buckets.reduce((n,b)=>n+b.count,0)+r.unknownCount,r.matchedCount);
});
test('zero snapshot proves zero age; missing snapshots do not become zero and partial platforms remain separate',async()=>{
 const a=await target(1,'ZERO'),b=await target(2,'MISSING'),c=await target(3,'NO_DETAIL');await snapshot('ZERO',[]);await snapshot('NO_DETAIL');
 const zero=(await call([a])).aging;assert.equal(zero.complete,true);assert.equal(zero.count,0);assert.equal(+zero.amount,0);assert.equal(zero.maxHours,null);assert.equal(zero.buckets.length,8);
 const r=(await call([a,b,c])).aging;assert.equal(r.available,true);assert.equal(r.complete,false);assert.equal(r.coverageComplete,false);assert.equal(r.count,0);
 assert.deepEqual(Object.fromEntries(r.platforms.map(p=>[p.name,p.state])),{MISSING:'missing',NO_DETAIL:'detail_unavailable',ZERO:'complete'});
 assert.equal(r.missingPlatforms.length,2);
});
test('mapped display/source aliases and native/report duplicate IDs cannot duplicate age totals',async()=>{
 const a=await target(1,'DISPLAY',{sourceName:'DISPLAY'}),b=await target(2,'DISPLAY',{source:'withdraw'});
 await db.exec("insert into dashboard_platform_team_map values('IN','SYNTHETIC_SOURCE','DISPLAY','M8',true)");
 await snapshot('SYNTHETIC_SOURCE');await details('SYNTHETIC_SOURCE',[{hours:1,amount:60},{hours:3,amount:60}]);
 const r=(await call([a,b])).aging;assert.equal(r.complete,true);assert.equal(r.count,2);assert.equal(r.platforms.length,1);assert.equal(r.avgHours,2);
});
test('summary average is count-weighted across platforms and source unknown amount refuses platform age',async()=>{
 const a=await target(1,'ONE'),b=await target(2,'THREE');await snapshot('ONE',[group('A',1,10)]);await snapshot('THREE',[group('B',3,30)]);
 await details('ONE',[{hours:1,amount:10,provider:'A'}]);await details('THREE',[{hours:3,amount:10,provider:'B'},{hours:3,amount:10,provider:'B'},{hours:3,amount:10,provider:'B'}]);
 let r=(await call([a,b])).aging;assert.equal(r.avgHours,2.5);assert.equal(r.count,4);assert.equal(r.maxHours,3);
 await db.exec("update withdraw_pending_orders set amount=null where platform='ONE'");r=(await call([a,b])).aging;
 assert.equal(r.available,true);assert.equal(r.complete,false);assert.equal(r.count,3);assert.equal(r.avgHours,3);assert.equal(r.platforms.find(p=>p.name==='ONE').state,'detail_unavailable');
});
test('one order repeated in two application dates invalidates whole platform even if totals match',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC');await details('SYNTHETIC',[{hours:1,amount:60},{hours:25,amount:60}]);
 await db.exec("update withdraw_pending_orders set order_no='SAME_SYNTHETIC_ORDER'");
 let r=(await call([a])).aging;assert.equal(r.available,false);assert.equal(r.platforms[0].state,'detail_unavailable');assert.equal(r.matchedCount,null);
 await db.exec("update withdraw_pending_orders set order_no=case when stat_date='2026-09-26' then ' ' else 'VALID' end");
 r=(await call([a])).aging;assert.equal(r.available,false);
});
test('legitimate zero groups do not hide complete zero age; zero-count nonzero-money groups are not discarded',async()=>{
 const a=await target(1,'ZERO_GROUP'),b=await target(2,'INVALID_GROUP');await snapshot('ZERO_GROUP',[group('EMPTY',0,0)]);
 await snapshot('INVALID_GROUP',[group('NO_ORDERS_BUT_MONEY',0,100)]);
 const zero=(await call([a])).aging;assert.equal(zero.available,true);assert.equal(zero.complete,true);assert.equal(zero.count,0);assert.equal(+zero.amount,0);assert.equal(zero.buckets.length,8);
 const invalid=await call([b]);assert.equal(invalid.daily[0].rows[0].state,'complete');assert.equal(invalid.aging.available,false);assert.equal(invalid.aging.platforms[0].state,'detail_unavailable');
});
test('age source lookup retains exact empty-team semantics and excludes differently mapped teams',async()=>{
 const a=await target(1,'SYNTHETIC',{team:''});
 await db.exec("insert into dashboard_platform_team_map values('IN','OTHER_SOURCE','SYNTHETIC','OTHER_TEAM',true)");
 await snapshot('SYNTHETIC');await details('SYNTHETIC',[{amount:60},{amount:60}]);
 await snapshot('OTHER_SOURCE',[group('OTHER_PAY',1,999)]);await details('OTHER_SOURCE',[{provider:'OTHER_PAY',amount:999}]);
 const r=(await call([a])).aging;assert.equal(r.complete,true);assert.equal(r.count,2);assert.equal(+r.amount,120);assert.equal(JSON.stringify(r).includes('OTHER_PAY'),false);
});
test('age path cannot widen a narrower same-country authorization through mapped source names',async()=>{
 const a=await target(1,'DISPLAY');await db.exec("insert into dashboard_platform_team_map values('IN','HIDDEN_SOURCE','DISPLAY','M8',true)");
 await snapshot('HIDDEN_SOURCE');await details('HIDDEN_SOURCE',[{amount:60},{amount:60}]);
 await db.query('update dashboard_profiles set data_scope=$1 where auth_user_id=$2',[JSON.stringify({mode:'selected',countries:['IN'],platforms:['DISPLAY']}),viewer]);
 await as(viewer);await db.exec('set role authenticated');const r=await call([a]);
 assert.equal(r.daily[0].rows[0].state,'missing');assert.equal(r.aging.available,false);assert.equal(r.aging.count,null);assert.equal(JSON.stringify(r).includes('SYNTHETIC_PAY'),false);
 await db.exec('reset role');await db.query('update dashboard_profiles set data_scope=$1 where auth_user_id=$2',[JSON.stringify({mode:'selected',countries:['IN']}),viewer]);
});
