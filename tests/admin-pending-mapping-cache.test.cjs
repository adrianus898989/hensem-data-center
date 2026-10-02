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
const date='2026-09-26';let db;let baselineMeta;
const candidate=read('migrations/20261002064434_pending_analysis_range_catalog_once.sql');
const reader=read('migrations/20261002070136_pending_analysis_verified_capture_reader.sql');
const cache=read('migrations/20261002085625_pending_mapping_validation_once.sql');
const fixture=n=>fs.readFileSync(path.join(__dirname,'fixtures/pending-analysis',n),'utf8').trim()+';';
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
 await db.exec(fixture('production-snapshot.sql'));await db.exec(fixture('production-analysis.sql'));
 await db.exec(`create sequence native_calls;create sequence seed_calls;
 create or replace function private.dashboard_admin_live_platforms() returns setof public.native_catalog language plpgsql stable security definer set search_path='' as $$declare s jsonb:=private.dashboard_admin_live_scope();begin perform nextval('public.native_calls');return query select * from public.native_catalog p where private.dashboard_scope_allows(s,p.scope_group,p.source_name);end$$;
 create or replace function private.dashboard_admin_live_withdraw_platforms() returns setof public.seed_catalog language plpgsql stable security definer set search_path='' as $$declare s jsonb:=private.dashboard_admin_live_scope();begin perform nextval('public.seed_calls');return query select * from public.seed_catalog p where private.dashboard_scope_allows(s,p.scope_group,p.source_name);end$$;
 create table wg_fixture(value jsonb);
 create function private.dashboard_admin_wg_pending_row(p jsonb,d date,providers text[])returns jsonb language sql stable as $$select coalesce((select value from public.wg_fixture limit 1),jsonb_build_object('id',p->>'id','name',p->>'name','source','wg','state','missing','timezone',p->>'timezone','groups','[]'::jsonb))$$;`);
 baselineMeta=(await db.query("select p.oid::text,to_jsonb(p)-'prosrc' meta from pg_proc p where oid in('private.dashboard_admin_live_pending_analysis(jsonb)'::regprocedure,'private.dashboard_admin_live_pending_snapshot(jsonb)'::regprocedure)")).rows;
 await db.exec(candidate);
 await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/pending-analysis/capture-schema.sql'),'utf8'));
 await db.exec(reader);
 await db.exec(fixture('production-capture-analysis.sql'));
 await db.exec(fixture('production-snapshot-validator.sql'));
 await db.exec(fixture('production-capture-analysis.sql').replace('private.dashboard_admin_live_pending_analysis(p_request jsonb)','private.synthetic_pending_analysis_baseline(p_request jsonb)'));
 await db.exec(cache);
 await db.exec(`create sequence canonical_calls;
 alter function private.dashboard_admin_live_provider_canonical(text,text,text) rename to synthetic_canonical_baseline;
 create function private.dashboard_admin_live_provider_canonical(a text,b text,c text) returns text language plpgsql stable security definer set search_path='' as $$begin perform nextval('public.canonical_calls');return private.synthetic_canonical_baseline(a,b,c);end$$;`);
});
beforeEach(async()=>{await db.exec('reset role;alter sequence native_calls restart with 1;alter sequence seed_calls restart with 1;alter sequence canonical_calls restart with 1;truncate private.withdraw_pending_capture_orders,private.withdraw_pending_capture_archive,wg_fixture,native_catalog,seed_catalog,dashboard_platform_team_map,withdraw_pending_backlog_daily,withdraw_pending_daily,withdraw_pending_orders,newar_detail_platforms;update dashboard_profiles set active=true;update dashboard_admin_preview_grants set can_view=true;');await as(owner);});
after(async()=>{if(db)await db.close()});

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
let arcSeq=10000;
async function archive(platform,options={}){
 const aid=id(++arcSeq);const country=options.country||'IN';
 await db.query(`insert into private.withdraw_pending_capture_archive
 (id,source_system,country_code,platform,stat_date,capture_date,window_start,window_end,window_days,snapshot_id,snapshot_at,snapshot,timezone,capture_basis,within_midnight_window,identity_status,native_source_system,platform_id,team_name,currency,partition_snapshots,pending_count,pending_amount,updated_at)
 select $1,b.source_system,b.country_code,b.platform,b.stat_date,b.capture_date,b.window_start,b.window_end,7,b.snapshot_id,b.snapshot_at,b.snapshot,'Asia/Kolkata','actual_capture',$4,'resolved',case n.source when 'ar' then 'AR' when 'newar' then 'NEW_AR' end,n.id,n.team,n.currency,'[]',(snapshot#>>'{totals,pending_count}')::bigint,(snapshot#>>'{totals,pending_amount}')::numeric,updated_at
 from withdraw_pending_backlog_daily b join native_catalog n on n.scope_group=b.country_code and n.source_name=b.platform
 where b.platform=$2 and b.country_code=$3 and b.stat_date=$5::date`,[aid,platform,country,options.onTime??true,date]);
 await db.query(`insert into private.withdraw_pending_capture_orders select $1,order_no,source_system,country_code,platform,stat_date,amount,applied_at,timezone,raw_channel,channel_type,status,snapshot_id,snapshot_at from withdraw_pending_orders where platform=$2 and country_code=$3`,[aid,platform,country]);return aid;
}

async function baseline(ids,extra={}){return(await db.query('select private.synthetic_pending_analysis_baseline($1::jsonb) data',[{startDate:date,endDate:date,platformIds:ids,...extra}])).rows[0].data;}
async function canonicalCalls(){return +(await db.query('select case when is_called then last_value else 0 end n from canonical_calls')).rows[0].n;}
async function resetCalls(){await db.exec('alter sequence canonical_calls restart with 1;alter sequence native_calls restart with 1;alter sequence seed_calls restart with 1');}
test('actual-size 16-platform/5014-order observations preserve every field while resolving 176 exact tuples once',async()=>{
 const ids=[];for(let p=0;p<16;p++){
  const platform='SYNTHETIC_PLATFORM_'+p,n=p<6?314:313;ids.push(await target(p+1,platform));
  const groups=Array.from({length:11},(_,c)=>{const count=Math.floor(n/11)+(c<n%11?1:0);return group('SYNTHETIC_PAY_'+c,count,count*60)});
  await snapshot(platform,groups);
  await snapshot(platform,groups,{day:'2026-09-25',capture:'2026-09-26',start:'2026-09-19',at:'2026-09-25T18:30:15Z'});
  const receipt=id(3000+p),at='2026-09-26T18:30:15Z';
  await db.query('insert into withdraw_pending_daily values($1,$2,$3,$4,$5,$6,$7,$6)',['WITHDRAW_REVIEW','IN',platform,date,receipt,at,JSON.stringify({fixture:'synthetic'})]);
  await db.query(`insert into withdraw_pending_orders select 'WITHDRAW_REVIEW','IN',$1,$2::date,'SYNTHETIC_ORDER_'||i,'SYNTHETIC_MEMBER',60,($3::timestamptz at time zone 'Asia/Kolkata')-interval '24 hours'*(i%5),'Asia/Kolkata','SYNTHETIC_PAY_'||(i%11),'BANK','已提交',$4::uuid,$3::timestamptz,$3::timestamptz from generate_series(0,$5::int-1)i`,[platform,date,at,receipt,n]);
  // Application time must agree with the source partition for age to count;
  // keeping mismatched dates in this fixture deliberately preserves unknowns.
  if(p<13)await archive(platform);
 }
 await resetCalls();const optimized=await call(ids);const optimizedCalls=await canonicalCalls();
 assert.equal(optimized.daily[0].count,5014);assert.equal(optimized.aging.matchedCount,5014);
 assert.equal(optimizedCalls,176);assert.equal((await db.query('select last_value n from native_calls')).rows[0].n,1);assert.equal((await db.query('select last_value n from seed_calls')).rows[0].n,1);
 await resetCalls();const original=await baseline(ids);const originalCalls=await canonicalCalls();
 assert.deepEqual(optimized,original);assert.equal(originalCalls,5366);assert.ok(originalCalls>optimizedCalls*30);
 assert.equal(JSON.stringify(optimized).includes('SYNTHETIC_MEMBER'),false);
});
test('canonical tuple includes country and raw platform; provider filter and report aliases retain exact baseline semantics',async()=>{
 const a=await target(1,'RAJA'),report=await target(2,'RAJALOTTERY',{source:'withdraw'}),b=await target(3,'FOREIGN',{country:'BR',currency:'INR'});
 await snapshot('RAJA',[group('USDT(TRC20)-3',2,120),group('SYNTHETIC_PAY',1,60)]);await details('RAJA',[{provider:'USDT(TRC20)-3'},{provider:'USDT(TRC20)-3'},{provider:'SYNTHETIC_PAY'}]);
 await snapshot('FOREIGN',[group('USDT(TRC20)-3',1,60)],{country:'BR'});await details('FOREIGN',[{provider:'USDT(TRC20)-3'}],{country:'BR'});
 for(const providers of [[],['TronPayUSDT'],['ABSENT']])assert.deepEqual(await call([a,report,b],{providers}),await baseline([a,report,b],{providers}));
 await as(viewer);await db.exec('set role authenticated');await assert.rejects(()=>call([b]),/platform_denied/);const limited=await call([a,report]);assert.equal(limited.daily[0].expectedPlatformCount,1);assert.equal(JSON.stringify(limited).includes('FOREIGN'),false);
});
test('snapshot validation remains complete; bad timezones, inconsistent totals and missing capture details fail closed',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC');await details('SYNTHETIC',[{hours:1},{hours:2}]);
 for(const mutate of ["jsonb_set(snapshot,'{timezone}','\"Not/A_Real_Zone\"')","jsonb_set(snapshot,'{totals,pending_amount}','121')","jsonb_set(snapshot,'{groups,0,pending_count}','3')"]){
  await db.exec('begin');await db.exec('update withdraw_pending_backlog_daily set snapshot='+mutate);const r=await call([a]);assert.equal(r.daily[0].rows[0].state,'invalid');assert.deepEqual(r,await baseline([a]));await db.exec('rollback');
 }
 await db.exec('delete from withdraw_pending_orders');const r=await call([a]);assert.equal(r.aging.platforms[0].state,'detail_unavailable');assert.deepEqual(r,await baseline([a]));
 // An invalid catalog timezone cannot be passed through a forged snapshot.
 await db.exec("update native_catalog set timezone='Not/A_Real_Zone';update withdraw_pending_backlog_daily set snapshot=jsonb_set(snapshot,'{timezone}','\"Not/A_Real_Zone\"')");assert.equal((await call([a])).daily[0].rows[0].state,'invalid');
});
test('legal but nonselected timezone and malformed group shape remain invalid, without throwing during cache preparation',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC');
 for(const mutate of ["jsonb_set(snapshot,'{timezone}','\"UTC\"')","jsonb_set(snapshot,'{groups}','{}')","jsonb_set(snapshot,'{groups,0,raw_channel}','null')"]){
  await db.exec('begin');await db.exec('update withdraw_pending_backlog_daily set snapshot='+mutate);const r=await call([a]);assert.equal(r.daily[0].rows[0].state,'invalid');assert.deepEqual(r,await baseline([a]));await db.exec('rollback');
 }
});
test('ambiguous registry alias values and identical raw labels across platforms/countries remain independent',async()=>{
 const a=await target(1,'SYNTHETIC_A'),b=await target(2,'SYNTHETIC_B'),c=await target(3,'SYNTHETIC_A',{country:'BR',currency:'INR'});
 await db.query('insert into private.dashboard_admin_provider_registry values($1,$2,$3,$4)',['印度','SYNTHETIC_A','SAME',['FIRST','SECOND']]);
 await db.exec("insert into private.dashboard_admin_provider_registry values('印度','SYNTHETIC_B','SAME',array['SAME']),('BR','SYNTHETIC_A','SAME',array['SAME'])");
 await db.exec("insert into private.dashboard_admin_provider_overrides values('印度','SYNTHETIC_B','SAME','OTHER_PLATFORM'),('BR','SYNTHETIC_A','SAME','OTHER_COUNTRY')");
 for(const [platform,country]of [['SYNTHETIC_A','IN'],['SYNTHETIC_B','IN'],['SYNTHETIC_A','BR']]){
  await snapshot(platform,[group('SAME',2,120)],{country});await details(platform,[{provider:'SAME'},{provider:'SAME'}],{country});
 }
 await resetCalls();const r=await call([a,b,c]);assert.equal(await canonicalCalls(),3);assert.deepEqual(r,await baseline([a,b,c]));
 assert.deepEqual(r.daily[0].groups.map(g=>g.provider).sort(),['OTHER_COUNTRY','OTHER_PLATFORM','SAME']);
 await db.exec('truncate private.dashboard_admin_provider_registry,private.dashboard_admin_provider_overrides');
});
test('null and empty raw detail channels retain unknown identity checks rather than disappearing in the distinct join',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC');await details('SYNTHETIC',[{hours:1},{hours:2}]);
 for(const channel of [null,'']){
  await db.exec('begin');await db.query('update withdraw_pending_orders set raw_channel=$1',[channel]);const r=await call([a]);assert.equal(r.aging.platforms[0].state,'detail_unavailable');assert.deepEqual(r,await baseline([a]));await db.exec('rollback');
 }
});
test('missing, ambiguous, resolved-identity rejection and mutable fallback results remain exact',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC');await details('SYNTHETIC',[{hours:1},{hours:2}]);const aid=await archive('SYNTHETIC');
 for(const [column,value]of [['platform_id',id(998)],['native_source_system','NEW_AR'],['team_name','OTHER'],['currency','PHP'],['timezone','UTC']]){
  await db.exec('begin');await db.query('update private.withdraw_pending_capture_archive set '+column+'=$1 where id=$2',[value,aid]);const r=await call([a]);assert.equal(r.daily[0].rows[0].state,'missing');assert.deepEqual(r,await baseline([a]));await db.exec('rollback');
 }
 await db.exec(`insert into private.withdraw_pending_capture_archive select gen_random_uuid(),source_system,country_code,platform,stat_date,capture_date,window_start+1,window_end,window_days-1,snapshot_id,snapshot_at,snapshot,timezone,capture_basis,within_midnight_window,identity_status,native_source_system,platform_id,team_name,currency,partition_snapshots,pending_count,pending_amount,updated_at from private.withdraw_pending_capture_archive`);
 const r=await call([a]);assert.equal(r.daily[0].rows[0].state,'ambiguous');assert.deepEqual(r,await baseline([a]));
});
test('one, seven and 31 days each use one catalog and one timezone scan with no overlapping-stock sum',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC');
 for(const start of [date,'2026-09-20','2026-08-27']){
  await resetCalls();const r=await call([a],{startDate:start});assert.equal(await canonicalCalls(),1);assert.equal((await db.query('select last_value n from native_calls')).rows[0].n,1);assert.equal((await db.query('select last_value n from seed_calls')).rows[0].n,1);assert.deepEqual(r,await baseline([a],{startDate:start}));assert.equal(r.count,undefined);assert.equal(r.amount,undefined);
 }
 assert.equal((cache.match(/from pg_catalog\.pg_timezone_names /g)||[]).length,1);
 const cachedValidator=cache.split('CREATE OR REPLACE FUNCTION private.dashboard_admin_pending_assert_snapshot_cached')[1].split('CREATE OR REPLACE FUNCTION')[0];assert.equal(cachedValidator.includes('pg_timezone_names'),false);
});
test('cached private helpers cannot accept caller-supplied forged scopes/timezones; entry metadata and publisher validator stay unchanged',async()=>{
 for(const signature of ['private.dashboard_admin_pending_assert_snapshot_cached(jsonb,text[])','private.dashboard_admin_pending_resolved_day_cached(jsonb,jsonb,jsonb,jsonb,jsonb,text[])']){
  assert.deepEqual((await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service",[signature])).rows[0],{anon:false,authenticated:false,service:false});
  const p=(await db.query('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[signature])).rows[0];assert.equal(p.prosecdef,false);assert.deepEqual(p.proconfig,['search_path=""']);
 }
 const old=(await db.query("select md5(prosrc) md5 from pg_proc where oid='public.withdraw_pending_assert_snapshot(jsonb)'::regprocedure")).rows[0].md5;assert.equal(old,'fa3cd408659596d6dd3ffbe2c494cce2');
 const a=await target(1);await snapshot('SYNTHETIC');const prior=(await db.query('select * from withdraw_pending_backlog_daily')).rows;await call([a]);assert.deepEqual((await db.query('select * from withdraw_pending_backlog_daily')).rows,prior);
 await as(viewer);await db.exec('set role authenticated');await assert.rejects(()=>db.query("select private.dashboard_admin_pending_assert_snapshot_cached('{}',array['FORGED'])"),/permission denied/);await assert.rejects(()=>db.query("select private.dashboard_admin_pending_resolved_day_cached('{}','{\"mode\":\"all\"}','[]','[]','{}',array['FORGED'])"),/permission denied/);
 await db.exec('reset role;update dashboard_profiles set active=false');await assert.rejects(()=>call([a]),/preview_denied/);
});
test('guard rejects body, original validator, ACL and search_path drift before modifying the existing function',async()=>{
 const baselineSql=fixture('production-capture-analysis.sql');
 for(const change of [
  "create or replace function public.withdraw_pending_assert_snapshot(p_snapshot jsonb) returns void language plpgsql set search_path='' as $$begin return;end$$",
  "grant execute on function private.dashboard_admin_live_pending_analysis(jsonb) to service_role",
  "alter function private.dashboard_admin_live_pending_analysis(jsonb) set search_path='public'",
  "create or replace function private.dashboard_admin_live_pending_analysis(p_request jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$begin return '{}'::jsonb;end$$"
 ]){
  await db.exec('begin;drop function private.dashboard_admin_pending_assert_snapshot_cached(jsonb,text[]);drop function private.dashboard_admin_pending_resolved_day_cached(jsonb,jsonb,jsonb,jsonb,jsonb,text[]);'+baselineSql+change+';');await assert.rejects(()=>db.exec(cache),/pending_cache_(baseline|access)_drift/);await db.exec('rollback');
 }
});
