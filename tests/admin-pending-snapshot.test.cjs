// Offline synthetic pending-stock fixtures. Never connects to production.
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const repo=path.resolve(__dirname,'..');
const read=n=>fs.readFileSync(path.join(repo,'supabase',n),'utf8');
const sql=read('admin-live-pending-snapshot.sql');
const owner='10000000-0000-0000-0000-000000000001',viewer='10000000-0000-0000-0000-000000000002';
const id=n=>'20000000-0000-0000-0000-'+String(n).padStart(12,'0');
const date='2026-09-26';let db;
const as=async uid=>db.query("select set_config('test.uid',$1,false)",[uid]);
async function call(ids,extra={}){return(await db.query('select public.dashboard_admin_live_pending_snapshot($1::jsonb) data',[JSON.stringify({date,platformIds:ids,...extra})])).rows[0].data;}
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
 create table withdraw_pending_daily(snapshot jsonb);
 create table newar_detail_platforms(country_code text,platform text,timezone text,launch_at timestamptz);
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select case upper(btrim($1)) when 'VEER.GAME' then 'VEERGAME' when 'SHREE.WIN' then 'SHREEWIN' when 'DHANI.WIN' then 'DHANIWIN' else upper(btrim($1)) end$$;
 create function public.collection_success_safe_descriptor(text,integer) returns boolean language sql immutable as $$select $1 is not null and length($1) between 1 and $2 and $1!~'[[:cntrl:]]'$$;
 create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[]);
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text);`);
 const base=read('admin-live-query.sql');await db.exec(base.slice(base.indexOf('create function private.dashboard_admin_live_scope()'),base.indexOf('create function private.dashboard_admin_live_platforms()')));
 await db.exec(`create function private.dashboard_admin_live_platforms() returns setof public.native_catalog language plpgsql stable security definer set search_path='' as $$declare s jsonb:=private.dashboard_admin_live_scope();begin return query select * from public.native_catalog p where private.dashboard_scope_allows(s,p.scope_group,p.source_name);end$$;
 create function private.dashboard_admin_live_withdraw_platforms() returns setof public.seed_catalog language plpgsql stable security definer set search_path='' as $$declare s jsonb:=private.dashboard_admin_live_scope();begin return query select * from public.seed_catalog p where private.dashboard_scope_allows(s,p.scope_group,p.source_name);end$$;`);
 const pending=read('migrations/20260915113000_withdraw_pending_daily.sql');
 await db.exec(pending.slice(pending.indexOf('create function public.withdraw_pending_is_count'),pending.indexOf('create function public.publish_withdraw_pending_snapshot')).replace("v_coverage->'expected_count' <> v_coverage->'fetched_count'","(v_coverage->>'fetched_count')::numeric < (v_coverage->>'unique_count')::numeric"));
 await db.exec(read('admin-live-provider-aliases.sql'));
 const config=read('admin-live-configuration.sql');await db.exec(config.slice(config.indexOf('create or replace function private.dashboard_admin_live_provider_alias_values'),config.indexOf('revoke all on function private.dashboard_admin_live_provider_alias_values')));
 const canonical=read('admin-live-india-usdt-classification.sql');await db.exec(canonical.slice(canonical.indexOf('create or replace function private.dashboard_admin_live_provider_canonical('),canonical.indexOf('create or replace function private.dashboard_admin_live_provider_rows(')));
 await db.exec(sql);
});
beforeEach(async()=>{await db.exec('reset role;truncate native_catalog,seed_catalog,dashboard_platform_team_map,withdraw_pending_backlog_daily,withdraw_pending_daily,newar_detail_platforms;update dashboard_profiles set active=true;update dashboard_admin_preview_grants set can_view=true;');await as(owner);});
after(async()=>{if(db)await db.close()});

test('reads one end-day stock head, proven zero, and never sums prior heads/daily partitions',async()=>{
 const a=await target(1),b=await target(2,'ZERO');await snapshot('SYNTHETIC');await snapshot('ZERO',[]);
 await snapshot('SYNTHETIC',[{raw_channel:'OLD',channel_type:'BANK',pending_count:999,pending_amount:999}],{day:'2026-09-25'});
 await db.exec(`insert into withdraw_pending_daily values('{"totals":{"pending_count":888888}}')`);
 const r=await call([a,b]);assert.equal(r.count,2);assert.equal(+r.amount,120);assert.equal(r.complete,true);assert.equal(r.expectedPlatformCount,2);assert.equal(r.snapshotDate,date);assert.equal(r.windowStart,'2026-09-20');assert.equal(r.rows.find(x=>x.name==='ZERO').count,0);assert.equal(r.rows[0].coverage.complete,true);assert.equal(r.rows[0].timezone,'Asia/Kolkata');
});
test('missing, invalid and conflicting heads remain unknown; partial response has only observed subtotal',async()=>{
 const ids=await Promise.all(['GOOD','MISSING','INVALID','DUPLICATE'].map((n,i)=>target(i+1,n)));await snapshot('GOOD');
 await snapshot('INVALID',undefined,{change:{coverage:{complete:false,expected_count:2,fetched_count:2,unique_count:2}}});
 await snapshot('DUPLICATE');await snapshot('DUPLICATE',undefined,{source:'OTHER'});
 const r=await call(ids);assert.equal(r.complete,false);assert.equal(r.receivedPlatformCount,1);assert.equal(r.count,2);
 assert.deepEqual(Object.fromEntries(r.rows.map(x=>[x.name,x.state])),{DUPLICATE:'ambiguous',GOOD:'complete',INVALID:'invalid',MISSING:'missing'});
 assert.equal(r.rows.find(x=>x.name==='MISSING').count,null);const m=await call([ids[1]]);assert.equal(m.count,null);assert.equal(m.amount,null);
});
test('deduplicates exact native/seed aliases within country and retains all requested IDs',async()=>{
 const ids=[await target(1,'RAJA'),await target(2,'RAJALOTTERY'),await target(3,'RAJA',{source:'withdraw'}),await target(4,'LOTTERY77',{sourceName:'LOTTERY7'}),await target(5,'LOTTERY77',{source:'withdraw'})];
 await db.exec(`insert into dashboard_platform_team_map values('IN','RAJA','RAJALOTTERY','M8',true),('IN','LOTTERY7','LOTTERY77','M8',true)`);
 await snapshot('RAJA');await snapshot('LOTTERY7');await snapshot('RAJA',[{raw_channel:'OTHER',channel_type:'BANK',pending_count:999,pending_amount:999}],{country:'PK'});
 const r=await call(ids);assert.equal(r.requestedIdCount,5);assert.equal(r.expectedPlatformCount,2);assert.equal(r.count,4);assert.equal(r.rows.find(x=>x.name==='RAJA').selectedIds.length,3);
});
test('current provider canonical filtering retains channel provenance and true matched zero',async()=>{
 const a=await target(1);await snapshot('SYNTHETIC',[{raw_channel:'USDT(TRC20)-3',channel_type:'USDT',pending_count:2,pending_amount:20},{raw_channel:'USDT(BEP20)-5',channel_type:'USDT',pending_count:3,pending_amount:30},{raw_channel:'USDT',channel_type:'USDT',pending_count:4,pending_amount:40}]);
 const r=await call([a],{providers:['TronPayUSDT']});assert.equal(r.count,2);assert.equal(r.groups[0].provider,'TronPayUSDT');assert.equal(r.rows[0].groups[0].rawChannel,'USDT(TRC20)-3');assert.equal(r.rows[0].groups[0].channelType,'USDT');
 assert.equal((await call([a],{providers:['USDT']})).count,4);const empty=await call([a],{providers:['ABSENT']});assert.equal(empty.complete,true);assert.equal(empty.count,0);
});
test('same-name LG/Game66 and unconfirmed non-M8 RAJA cannot borrow AR snapshot; currencies never combine',async()=>{
 const ids=[await target(1),await target(2,'SYNTHETIC',{source:'lg'}),await target(3,'SYNTHETIC',{source:'game66'})];await snapshot('SYNTHETIC');
 const r=await call(ids);assert.equal(r.expectedPlatformCount,3);assert.equal(r.receivedPlatformCount,1);assert.equal(r.count,2);assert.equal((await call([ids[1]])).count,null);
 const other=await target(4,'RAJALOTTERY',{team:'OTHER_TEAM'});await snapshot('RAJA');assert.equal((await call([other])).rows[0].state,'unsupported');
 const foreign=await target(5,'FOREIGN',{country:'PK',currency:'PKR'});await assert.rejects(()=>call([ids[0],foreign]),/mixed_currency/);
});
test('short windows require exact NewAR launch proof; invalid capture day and overlong windows fail closed',async()=>{
 const names=['NEW_VALID','NEW_UNKNOWN','STALE','LONG'];const ids=[];for(let i=0;i<names.length;i++)ids.push(await target(i+1,names[i],{source:'newar'}));
 await db.exec(`insert into newar_detail_platforms values('IN','NEW_VALID','Asia/Kolkata','2026-09-24T00:00:00+05:30')`);
 await snapshot('NEW_VALID',[],{start:'2026-09-24'});await snapshot('NEW_UNKNOWN',[],{start:'2026-09-24'});await snapshot('STALE',[],{capture:'2026-09-26'});await snapshot('LONG',[],{start:'2026-09-19'});
 const r=await call(ids);assert.equal(r.receivedPlatformCount,1);assert.equal(r.rows.find(x=>x.name==='NEW_VALID').windowStart,'2026-09-24');assert.equal(r.count,0);assert.equal(r.rows.filter(x=>x.state==='invalid').length,3);
});
test('fresh profile, preview grant and country scope gate reads; authenticated cannot read underlying stock table',async()=>{
 const allowed=await target(1),hidden=await target(2,'HIDDEN',{country:'PK'});await snapshot('SYNTHETIC');await as(viewer);await db.exec('set role authenticated');assert.equal((await call([allowed])).count,2);
 await assert.rejects(()=>call([hidden]),/platform_denied/);await assert.rejects(()=>db.query('select * from public.withdraw_pending_backlog_daily'),/permission denied/);
 await db.exec('reset role;update dashboard_admin_preview_grants set can_view=false');await assert.rejects(()=>call([allowed]),/preview_denied/);
 await db.exec('update dashboard_admin_preview_grants set can_view=true;update dashboard_profiles set active=false');await assert.rejects(()=>call([allowed]),/preview_denied/);await as('');await assert.rejects(()=>call([allowed]),/login_required/);
 const acl=(await db.query("select has_function_privilege('anon','public.dashboard_admin_live_pending_snapshot(jsonb)','EXECUTE') anon,has_function_privilege('authenticated','public.dashboard_admin_live_pending_snapshot(jsonb)','EXECUTE') authenticated")).rows[0];assert.deepEqual(acl,{anon:false,authenticated:true});
});
test('request validation rejects malformed dates, duplicate/unknown IDs and invalid filters',async()=>{
 const a=await target(1);for(const extra of [{date:'2026-02-30'},{date:'26-09-26'},{date:'2099-01-01'},{providers:['ONE','ONE']},{providers:['bad\nvalue']},{unexpected:true}])await assert.rejects(()=>call([a],extra),/invalid_|duplicate_/);
 await assert.rejects(()=>call([]),/invalid_request/);await assert.rejects(()=>call([a,a]),/duplicate_platform/);await assert.rejects(()=>call([id(999)]),/platform_denied/);
});

test('complete coverage still rejects mismatched group totals; collected duplicates do not increase stock',async()=>{
 const a=await target(1,'BAD_TOTAL'),b=await target(2,'DEDUPED');await snapshot('BAD_TOTAL',undefined,{change:{totals:{pending_count:2,pending_amount:121}}});
 await snapshot('DEDUPED',undefined,{change:{coverage:{complete:true,expected_count:2,fetched_count:3,unique_count:2}}});
 const r=await call([a,b]);assert.equal(r.count,2);assert.equal(r.rows.find(x=>x.name==='BAD_TOTAL').state,'invalid');assert.equal(r.rows.find(x=>x.name==='DEDUPED').coverage.fetched_count,3);
});

test('conflicting authorized source mappings or selected teams cannot silently borrow one source',async()=>{
 const a=await target(1,'DISPLAY');await db.exec(`insert into dashboard_platform_team_map values('IN','SOURCE_A','DISPLAY','M8',true),('IN','SOURCE_B','DISPLAY','M8',true)`);await snapshot('SOURCE_A');
 assert.equal((await call([a])).rows[0].state,'ambiguous');
 const b=await target(2,'SAME',{team:'M8'}),c=await target(3,'SAME',{team:'OTHER_TEAM'});await snapshot('SAME');assert.equal((await call([b,c])).rows[0].state,'ambiguous');
});

test('all snapshot/head identity mismatches are invalid, never a plausible zero or subtotal',async()=>{
 const changes=[{country_code:'PK'},{platform:'WRONG'},{snapshot_id:id(901)},{snapshot_at:'2026-09-26T18:31:15Z'},{timezone:'Asia/Dubai'},{stat_date:'2026-09-25'},{source_system:'OTHER'}];
 const ids=[];for(let i=0;i<changes.length;i++){const name='IDENTITY_'+i;ids.push(await target(i+1,name));await snapshot(name,undefined,{change:changes[i]});}
 const r=await call(ids);assert.equal(r.receivedPlatformCount,0);assert.equal(r.count,null);assert.equal(r.amount,null);assert.equal(r.rows.length,changes.length);assert.ok(r.rows.every(x=>x.state==='invalid'&&x.coverage===null&&x.count===null));
});

test('narrower same-country platform scope is enforced both at ID resolution and source lookup',async()=>{
 const allowed=await target(1,'ALLOWED'),hidden=await target(2,'HIDDEN');await snapshot('ALLOWED');await snapshot('HIDDEN');
 await db.query("update dashboard_profiles set data_scope=$1 where auth_user_id=$2",[JSON.stringify({mode:'selected',countries:['IN'],platforms:['ALLOWED']}),viewer]);
 await as(viewer);assert.equal((await call([allowed])).count,2);await assert.rejects(()=>call([hidden]),/platform_denied/);
 await db.query("update dashboard_profiles set data_scope=$1 where auth_user_id=$2",[JSON.stringify({mode:'selected',countries:['IN'],platforms:[]}),viewer]);await assert.rejects(()=>call([allowed]),/platform_denied/);
});

test('migration is replayable but rejects an unknown body or widened permissions without overwriting it',async()=>{
 const metadata=async()=> (await db.query("select n.nspname,p.proname,md5(p.prosrc) body,p.provolatile,p.prosecdef,p.proconfig,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('dashboard_admin_pending_platform_key','dashboard_admin_live_pending_snapshot') order by 1,2")).rows;
 const before=await metadata();await db.exec(sql);assert.deepEqual(await metadata(),before);
 await db.exec("begin;create or replace function public.dashboard_admin_live_pending_snapshot(p_request jsonb) returns jsonb language sql stable security invoker set search_path='' as $$ select '{}'::jsonb; $$;");
 await assert.rejects(()=>db.exec(sql),/Pending snapshot definition or permissions changed/);await db.exec('rollback');assert.deepEqual(await metadata(),before);
 await db.exec('begin;grant execute on function public.dashboard_admin_live_pending_snapshot(jsonb) to anon;');
 await assert.rejects(()=>db.exec(sql),/Pending snapshot definition or permissions changed/);await db.exec('rollback');assert.deepEqual(await metadata(),before);
 await db.exec('begin;revoke execute on function private.dashboard_admin_live_pending_snapshot(jsonb) from authenticated;');
 await assert.rejects(()=>db.exec(sql),/Pending snapshot definition or permissions changed/);await db.exec('rollback');assert.deepEqual(await metadata(),before);
});

test('known initial service-role default grant is removed by guarded forward correction without body changes',async()=>{
 const patch=read('admin-live-pending-snapshot-acl.sql');
 const metadata=async()=> (await db.query("select n.nspname,p.proname,md5(p.prosrc) body,p.provolatile,p.prosecdef,p.proconfig,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('dashboard_admin_pending_platform_key','dashboard_admin_live_pending_snapshot') order by 1,2")).rows;
 const before=await metadata();await db.exec('grant execute on function public.dashboard_admin_live_pending_snapshot(jsonb) to service_role;');
 await db.exec(patch);assert.deepEqual(await metadata(),before);await db.exec(patch);assert.deepEqual(await metadata(),before);await db.exec(sql);
 await db.exec('begin;grant execute on function public.dashboard_admin_live_pending_snapshot(jsonb) to anon;');
 await assert.rejects(()=>db.exec(patch),/ACL correction baseline changed/);await db.exec('rollback');assert.deepEqual(await metadata(),before);
 await db.exec('begin;revoke execute on function public.dashboard_admin_live_pending_snapshot(jsonb) from authenticated;');
 await assert.rejects(()=>db.exec(patch),/ACL correction baseline changed/);await db.exec('rollback');assert.deepEqual(await metadata(),before);
});

test('fresh install under Supabase-style service-role default privileges still has only explicit intended grants',async()=>{
 await db.exec(`alter default privileges in schema public grant execute on functions to service_role;
 alter default privileges in schema private grant execute on functions to service_role;
 drop function public.dashboard_admin_live_pending_snapshot(jsonb);
 drop function private.dashboard_admin_live_pending_snapshot(jsonb);
 drop function private.dashboard_admin_pending_platform_key(text,text);`);
 await db.exec(sql);
 const acl=(await db.query("select has_function_privilege('service_role','public.dashboard_admin_live_pending_snapshot(jsonb)','EXECUTE') public_service,has_function_privilege('service_role','private.dashboard_admin_live_pending_snapshot(jsonb)','EXECUTE') private_service,has_function_privilege('service_role','private.dashboard_admin_pending_platform_key(text,text)','EXECUTE') key_service,has_function_privilege('authenticated','public.dashboard_admin_live_pending_snapshot(jsonb)','EXECUTE') authenticated")).rows[0];
 assert.deepEqual(acl,{public_service:false,private_service:false,key_service:false,authenticated:true});
 await db.exec(sql);
 await db.exec('alter default privileges in schema public revoke execute on functions from service_role;alter default privileges in schema private revoke execute on functions from service_role;');
});
