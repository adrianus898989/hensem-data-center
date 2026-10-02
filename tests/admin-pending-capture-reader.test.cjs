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
});
beforeEach(async()=>{await db.exec('reset role;alter sequence native_calls restart with 1;alter sequence seed_calls restart with 1;truncate private.withdraw_pending_capture_orders,private.withdraw_pending_capture_archive,wg_fixture,native_catalog,seed_catalog,dashboard_platform_team_map,withdraw_pending_backlog_daily,withdraw_pending_daily,withdraw_pending_orders,newar_detail_platforms;update dashboard_profiles set active=true;update dashboard_admin_preview_grants set can_view=true;');await as(owner);});
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
 where b.platform=$2 and b.country_code=$3`,[aid,platform,country,options.onTime??true]);
 await db.query(`insert into private.withdraw_pending_capture_orders select $1,order_no,source_system,country_code,platform,stat_date,amount,applied_at,timezone,raw_channel,channel_type,status,snapshot_id,snapshot_at from withdraw_pending_orders where platform=$2 and country_code=$3`,[aid,platform,country]);return aid;
}
test('verified midnight observation and its exact archived details survive later mutable replacement',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC');await details('SYNTHETIC',[{hours:12},{hours:48}]);const aid=await archive('SYNTHETIC');
 await db.exec('truncate withdraw_pending_backlog_daily,withdraw_pending_orders,withdraw_pending_daily');
 await snapshot('SYNTHETIC',[group('OTHER',1,999)],{at:'2026-09-27T10:00:00Z'});await details('SYNTHETIC',[{hours:1,provider:'OTHER',amount:999}],{at:'2026-09-27T10:00:00Z'});
 const r=await call([a]);assert.equal(r.daily[0].count,2);assert.equal(+r.daily[0].amount,120);const row=r.daily[0].rows[0];assert.equal(row.archiveId,aid);assert.equal(row.timingState,'on_time');assert.equal(row.captureVerified,true);assert.equal(row.observationSource,'verified_archive');
 assert.equal(r.aging.complete,true);assert.equal(r.aging.count,2);assert.equal(r.aging.maxHours,48);assert.equal(r.aging.over24Count,1);assert.equal(r.aging.platforms[0].snapshotAt,row.snapshotAt);
});
test('nearest verified observation inside inclusive midnight window wins; late archives cannot override it',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC',[],{at:'2026-09-26T18:35:00Z'});await archive('SYNTHETIC');
 await db.exec('truncate withdraw_pending_backlog_daily');await snapshot('SYNTHETIC',[],{at:'2026-09-26T18:30:20Z'});const best=await archive('SYNTHETIC');
 await db.exec('truncate withdraw_pending_backlog_daily');await snapshot('SYNTHETIC',[],{at:'2026-09-27T01:00:00Z'});await archive('SYNTHETIC',{onTime:false});
 const r=await call([a]);assert.equal(r.daily[0].rows[0].archiveId,best);assert.equal(r.daily[0].rows[0].delaySeconds,20);assert.equal(r.aging.complete,true);assert.equal(r.aging.count,0);
});
test('without midnight archive latest late verified observation is visible only as late actual capture',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC',[],{at:'2026-09-27T01:00:00Z'});await archive('SYNTHETIC',{onTime:false});
 await db.exec('truncate withdraw_pending_backlog_daily');await snapshot('SYNTHETIC',[],{at:'2026-09-27T02:00:00Z'});const latest=await archive('SYNTHETIC',{onTime:false});
 const d=(await call([a])).daily[0];assert.equal(d.rows[0].archiveId,latest);assert.equal(d.rows[0].timingState,'late');assert.equal(d.rows[0].midnightEligible,false);assert.equal(d.onTimePlatformCount,0);assert.equal(d.latePlatformCount,1);
});
test('mutable fallback remains truthful actual data but cannot qualify as a verified midnight observation',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC');await details('SYNTHETIC',[{hours:1},{hours:2}]);
 const r=await call([a]);const row=r.daily[0].rows[0];assert.equal(row.state,'complete');assert.equal(row.count,2);assert.equal(row.timingState,'unknown');assert.equal(row.captureVerified,false);assert.equal(row.observationSource,'current_summary');assert.equal(row.delaySeconds,15);assert.equal(row.midnightEligible,false);assert.equal(r.aging.complete,true);
});
test('range baseline stays separate; catalog is still resolved once and same-named foreign archives cannot leak',async()=>{
 const a=await target(1),b=await target(2,'SYNTHETIC',{country:'BR',currency:'INR'});await snapshot('SYNTHETIC',[]);await archive('SYNTHETIC');await snapshot('SYNTHETIC',[group('X',1,100)],{country:'BR'});await archive('SYNTHETIC',{country:'BR'});
 await as(viewer);await db.exec('set role authenticated');const r=await call([a],{startDate:'2026-09-20'});assert.equal(r.daily.length,7);assert.equal(r.baseline.snapshotDate,'2026-09-19');assert.equal(r.daily.at(-1).count,0);assert.equal(JSON.stringify(r).includes('"BR"'),false);
 await assert.rejects(()=>call([b]),/platform_denied/);await db.exec('reset role');assert.equal((await db.query('select last_value n from native_calls')).rows[0].n,2);assert.equal((await db.query('select last_value n from seed_calls')).rows[0].n,2);
});
test('archived detail consistency remains checked and never falls back to unrelated mutable rows for an archived head',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC');await details('SYNTHETIC',[{hours:1},{hours:2}]);const aid=await archive('SYNTHETIC');
 await db.query('delete from private.withdraw_pending_capture_orders where archive_id=$1 and order_no=$2',[aid,'SYNTHETIC_0']);
 const r=await call([a]);assert.equal(r.daily[0].rows[0].captureVerified,true);assert.equal(r.aging.available,false);assert.equal(r.aging.count,null);assert.equal(r.aging.platforms[0].state,'detail_unavailable');
});
test('unknown catalog currency blocks archive amounts and metadata cannot invent a currency',async()=>{
 const a=await target(1,'SYNTHETIC',{currency:null});await snapshot('SYNTHETIC');await archive('SYNTHETIC');
 const r=await call([a]);assert.equal(r.daily[0].rows[0].state,'unsupported');assert.equal(r.daily[0].rows[0].captureVerified,false);assert.equal(r.daily[0].count,null);assert.equal(r.daily[0].amount,null);assert.equal(r.daily[0].currency,null);
});
test('new private helpers and archive tables remain uncallable to authenticated and service roles',async()=>{
 for(const signature of ['private.dashboard_admin_pending_capture_heads(jsonb,jsonb,date,date)','private.dashboard_admin_pending_capture_day(jsonb,jsonb,jsonb)']){
  const acl=(await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service",[signature])).rows[0];assert.deepEqual(acl,{anon:false,authenticated:false,service:false});
 }
 await as(viewer);await db.exec('set role authenticated');for(const table of ['private.withdraw_pending_capture_archive','private.withdraw_pending_capture_orders'])await assert.rejects(()=>db.query('select * from '+table),/permission denied/);
});
test('conflicting same-capture archive windows remain ambiguous instead of choosing a plausible first total',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC',[]);await archive('SYNTHETIC');
 await db.exec(`insert into private.withdraw_pending_capture_archive select gen_random_uuid(),source_system,country_code,platform,stat_date,capture_date,window_start+1,window_end,window_days-1,snapshot_id,snapshot_at,snapshot,timezone,capture_basis,within_midnight_window,identity_status,native_source_system,platform_id,team_name,currency,partition_snapshots,pending_count,pending_amount,updated_at from private.withdraw_pending_capture_archive`);
 const r=await call([a]);assert.equal(r.daily[0].rows[0].state,'ambiguous');assert.equal(r.daily[0].count,null);assert.equal(r.daily[0].rows[0].captureVerified,false);assert.equal(r.daily[0].rows[0].midnightEligible,false);
});
test('reader preserves existing function metadata and source/archive rows',async()=>{
 const current=(await db.query("select p.oid::text,to_jsonb(p)-'prosrc' meta from pg_proc p where oid in('private.dashboard_admin_live_pending_analysis(jsonb)'::regprocedure,'private.dashboard_admin_live_pending_snapshot(jsonb)'::regprocedure)")).rows;assert.deepEqual(current,baselineMeta);
 const a=await target(1);await snapshot('SYNTHETIC',[]);await archive('SYNTHETIC');const prior=(await db.query('select * from private.withdraw_pending_capture_archive')).rows;
 await call([a]);assert.deepEqual((await db.query('select * from private.withdraw_pending_capture_archive')).rows,prior);
});
test('reader guard rejects optimized function body, ACL and search-path drift atomically',async()=>{
 const optimized=candidate.split('execute $new_analysis$')[1].split(';$new_analysis$')[0]+';';
 for(const change of [
  'grant execute on function private.dashboard_admin_live_pending_analysis(jsonb) to service_role',
  "alter function private.dashboard_admin_live_pending_analysis(jsonb) set search_path='public'",
  "create or replace function private.dashboard_admin_live_pending_analysis(p_request jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$begin return '{}'::jsonb;end$$"
 ]){
  await db.exec('begin;drop function private.dashboard_admin_pending_capture_heads(jsonb,jsonb,date,date);drop function private.dashboard_admin_pending_capture_day(jsonb,jsonb,jsonb);'+optimized+change+';');
  await assert.rejects(()=>db.exec(reader),/pending_archive_reader_baseline_drift/);await db.exec('rollback');
 }
});

test('resolved historical identity must match current native id source team currency and timezone without mutable fallback',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC');await details('SYNTHETIC',[{hours:1},{hours:2}]);const aid=await archive('SYNTHETIC');
 for(const [column,value]of [['platform_id',id(998)],['native_source_system','NEW_AR'],['team_name','OTHER'],['currency','PHP'],['timezone','UTC']]){
  await db.exec('begin');await db.query('update private.withdraw_pending_capture_archive set '+column+'=$1 where id=$2',[value,aid]);
  const r=await call([a]);assert.equal(r.daily[0].rows[0].state,'missing',column);assert.equal(r.daily[0].count,null,column);assert.equal(r.aging.available,false,column);assert.equal(JSON.stringify(r).includes(aid),false,column);
  await db.exec('rollback');
 }
 // A current team reassignment cannot claim the old team's immutable capture.
 await db.query("update native_catalog set team='OTHER' where id=$1",[a]);const moved=await call([a]);assert.equal(moved.daily[0].count,null);assert.equal(moved.daily[0].rows[0].state,'missing');
});
test('legacy unbound archive and report-only identity never manufacture historical ownership',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC',[]);const aid=await archive('SYNTHETIC');
 await db.query("update private.withdraw_pending_capture_archive set identity_status='legacy_unbound',native_source_system=null,platform_id=null,team_name=null,currency=null where id=$1",[aid]);
 let r=await call([a]);assert.equal(r.daily[0].rows[0].state,'missing');assert.equal(r.daily[0].rows[0].midnightEligible,false);
 await db.exec('truncate private.withdraw_pending_capture_orders,private.withdraw_pending_capture_archive');await archive('SYNTHETIC');const seed=await target(2,'SYNTHETIC',{source:'withdraw'});
 r=await call([seed]);assert.equal(r.daily[0].rows[0].state,'missing');assert.equal(r.aging.available,false);
});
