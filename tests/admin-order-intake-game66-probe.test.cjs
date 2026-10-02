// Real PostgreSQL through PGlite; synthetic identities/rows, no production access.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..');
const baseline=fs.readFileSync(path.join(__dirname,'fixtures/order-intake-game66-baseline.sql'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261002102120_order_intake_game66_bounded_latest.sql'),'utf8');
const replay=migration.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
let db,initial,expected;
const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].value;
const read=()=>scalar('select public.fixture_intake() value');
const metadata=()=>scalar("select to_jsonb(p)-'prosrc' value from pg_proc p where oid='private.dashboard_admin_live_order_intake()'::regprocedure");
before(async()=>{
 db=new PGlite();await db.exec(`
 set timezone='UTC';create schema private;create role anon;create role authenticated;create role service_role;
 grant usage on schema private to anon,authenticated,service_role;
 create table public.fixture_platforms(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text);
 create function private.dashboard_admin_live_platforms()returns setof public.fixture_platforms language plpgsql stable security definer set search_path='' as $$
 declare s jsonb:=nullif(current_setting('test.scope',true),'')::jsonb;begin
 if s is null then raise exception 'unauthorized';end if;
 return query select p.*from public.fixture_platforms p where s->>'mode'='all'or(s->'countries'?p.scope_group and s->'platforms'?p.source_name);end;$$;
 create table public.fixture_sites(site_code text,country_code text,country text,platform text,timezone text,currency text);
 create function private.dashboard_admin_wg_sites()returns setof public.fixture_sites language sql stable set search_path='' as $$select *from public.fixture_sites$$;
 create table public.wg_recharge_details(site_code text,created_at timestamptz,stored_at timestamptz);
 create table public.wg_withdraw_details(like public.wg_recharge_details);
 create table private.wg_detail_progress(site_code text,business text,basis text,cursor jsonb,last_success_at timestamptz);
 create table public.ar_collected_orders(source_system text,country_code text,platform text,order_kind text,applied_at timestamp,updated_at timestamptz);
 create table public.lg_orders(source_system text,country_code text,platform text,order_kind text,created_at timestamptz,updated_at timestamptz);
 create table public.newar_detail_platforms(platform text,country_code text,enabled boolean,launch_at timestamptz);
 create table public.newar_detail_records(platform text,dataset text,created_at timestamptz,received_at timestamptz);
 create table public.game66_charge_orders(platform_id uuid,create_time timestamptz,last_seen_at timestamptz);
 create table public.game66_withdraw_orders(like public.game66_charge_orders);
 create index game66_withdraw_orders_platform_time_idx on public.game66_withdraw_orders(platform_id,create_time desc);
 create index game66_withdraw_orders_dashboard_cover_idx on public.game66_withdraw_orders(create_time,platform_id)include(last_seen_at);
 create index game66_charge_orders_volume_cover_idx on public.game66_charge_orders(platform_id,create_time)include(last_seen_at);
 insert into public.fixture_platforms values
 ('${id(1)}','GAME-A','Team','香港','HK_TEAM','game66','Asia/Kolkata','INR','GAME'),
 ('${id(2)}','GAME-B','Other','红膏蟹','RED_CRAB','game66','Asia/Kolkata','INR','GAME'),
 ('${id(3)}','NullOnly','Team','香港','HK_TEAM','game66','Asia/Kolkata','INR','NULL'),
 ('${id(4)}','Empty','Team','香港','HK_TEAM','game66','Asia/Kolkata','INR','EMPTY'),
 ('${id(5)}','AR','Team','印度','IN','ar','Asia/Kolkata','INR','AR'),
 ('${id(6)}','LG','Team','菲律宾','PH','lg','Asia/Manila','PHP','LG'),
 ('${id(7)}','NEW','Team','印度','IN','newar','Asia/Kolkata','INR','NEW'),
 ('${id(8)}','WG','Team','巴西','BR','wg','America/Sao_Paulo','BRL','WG');
 insert into public.game66_withdraw_orders values
 ('${id(1)}','2026-09-29T21:00Z','2026-09-30Z'),('${id(1)}','2026-09-20Z','2026-10-02Z'),
 ('${id(1)}',null,'2099-01-01Z'),('${id(2)}','2099-01-01Z','2099-01-02Z'),('${id(3)}',null,'2026-09-27Z');
 insert into public.game66_charge_orders values('${id(1)}','2026-09-28T19:00Z','2026-09-29Z');
 insert into public.ar_collected_orders values('AR','IN','AR','recharge','2026-09-30 00:01','2026-09-30Z');
 insert into public.lg_orders values('LG','PH','LG','withdraw','2026-09-29T17:00Z','2026-09-30Z');
 insert into public.newar_detail_platforms values('NEW','IN',true,'2026-09-29Z');
 insert into public.newar_detail_records values('NEW','charge','2026-09-30Z','2026-09-30T01:00Z');
 insert into public.fixture_sites values('WG1','BR','巴西','WG','America/Sao_Paulo','BRL');
 insert into public.wg_recharge_details values('WG1','2026-09-30T02:30Z','2026-09-30T04:00Z');
 select set_config('test.scope','{"mode":"all"}',false);
 `);await db.exec(baseline);await db.exec(`
 create function public.fixture_intake()returns jsonb language sql stable security definer set search_path='' as $$select private.dashboard_admin_live_order_intake()$$;
 revoke all on function public.fixture_intake()from public,anon;grant execute on function public.fixture_intake()to authenticated;
 `);initial=await metadata();expected=await read();await db.exec(migration);
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));
test('all DTO output equals the actual baseline across GAME66, AR, LG, NEW_AR and WG sources',async()=>{
 assert.deepEqual(await read(),expected);assert.equal(await scalar("select md5(prosrc)value from pg_proc where oid='private.dashboard_admin_live_order_intake()'::regprocedure"),'c6122383ac83f6d789a058872fbfec09');
});
test('newest creation row supplies its own metadata; old newly-synced and NULL rows do not win',async()=>{
 const rows=await read(),r=rows.find(x=>x.platformId===id(1)&&x.directions[0]==='withdraw');
 assert.equal(r.lastDate,'2026-09-30');assert.equal(r.updatedAt,'2026-09-30T00:00:00+00:00');
 const charge=rows.find(x=>x.platformId===id(1)&&x.directions[0]==='charge');assert.equal(charge.lastDate,'2026-09-29');assert.equal(charge.updatedAt,'2026-09-29T00:00:00+00:00');
});
test('all-NULL and empty GAME66 directions keep the original fallback and missing-row behavior',async()=>{
 const rows=await read(),n=rows.find(x=>x.platformId===id(3));assert.equal(n.lastDate,null);assert.equal(n.updatedAt,'2026-09-27T00:00:00+00:00');assert.deepEqual(n.directions,['withdraw']);assert(!rows.some(x=>x.platformId===id(4)));
});
test('same-name platform from another native ID/country never leaks through authorized scope',async()=>{
 await db.query("select set_config('test.scope',$1,true)",[JSON.stringify({countries:['HK_TEAM'],platforms:['GAME']})]);await db.exec('set local role authenticated');
 const rows=await read();assert.equal(rows.length,2);assert(rows.every(x=>x.platformId===id(1)&&x.rawCountry==='HK_TEAM'));await db.exec('reset role');await db.query("select set_config('test.scope','',true)");await assert.rejects(read(),/unauthorized/);
});
test('timestamp ties remain original admissible newest rows without inventing a tie order',async()=>{
 await db.exec(`insert into public.game66_withdraw_orders values('${id(1)}','2026-09-29T21:00Z','2026-10-01Z')`);const patched=(await read()).find(x=>x.platformId===id(1)&&x.directions[0]==='withdraw');await db.exec(baseline);const old=(await read()).find(x=>x.platformId===id(1)&&x.directions[0]==='withdraw');assert.equal(patched.lastDate,old.lastDate);for(const r of [patched,old])assert(['2026-09-30T00:00:00+00:00','2026-10-01T00:00:00+00:00'].includes(r.updatedAt));
});
test('existing helper metadata and private ACL stay identical, without new indexes or functions; replay is safe',async()=>{
 const before=await scalar("select count(*)value from pg_indexes where tablename in('game66_charge_orders','game66_withdraw_orders')");await db.exec(replay);assert.deepEqual(await metadata(),initial);assert.equal(await scalar("select count(*)value from pg_indexes where tablename in('game66_charge_orders','game66_withdraw_orders')"),before);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("select has_function_privilege($1,'private.dashboard_admin_live_order_intake()','EXECUTE')value",[role]),false);
});
test('body, ACL, security and search_path drift abort before replacing unknown code',async()=>{
 for(const [sql,pattern]of[
 ["grant execute on function private.dashboard_admin_live_order_intake()to authenticated",/acl_drift/],
 ["grant execute on function private.dashboard_admin_live_order_intake()to public",/acl_drift/],
 ["alter function private.dashboard_admin_live_order_intake()security invoker",/metadata_drift/],
 ["alter function private.dashboard_admin_live_order_intake()set search_path='public'",/metadata_drift/],
 ["alter function private.dashboard_admin_live_order_intake()immutable",/metadata_drift/],
 ["create or replace function private.dashboard_admin_live_order_intake()returns jsonb language plpgsql stable security definer set search_path='' as $$begin return '[]'::jsonb;end;$$",/body_drift/]
 ]){await db.exec('savepoint drift');try{await db.exec(sql);await assert.rejects(()=>db.exec(replay),pattern);}finally{await db.exec('rollback to savepoint drift;release savepoint drift')}}
});
test('production-shaped existing indexes bound both probes across a large, uneven 24-platform history',async()=>{
 await db.exec(`insert into public.fixture_platforms select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'History-'||n,'Team','香港','HK_TEAM','game66','Asia/Kolkata','INR','HISTORY-'||n from generate_series(1,24)n;
 insert into public.game66_withdraw_orders select p.id,timestamptz '2025-01-01Z'+n*interval '1 minute',timestamptz '2026-01-01Z' from public.fixture_platforms p cross join generate_series(1,2000)n where p.source_name like 'HISTORY-%';analyze public.fixture_platforms;analyze public.game66_withdraw_orders;`);
 const query=`select max(found.last_seen_at)from public.fixture_platforms p left join lateral(with newest as materialized(select g.create_time from public.game66_withdraw_orders g where g.platform_id=p.id and g.create_time is not null order by g.create_time desc limit 1)select g.create_time,g.last_seen_at from newest n join public.game66_withdraw_orders g on g.platform_id=p.id and g.create_time=n.create_time order by g.create_time desc limit 1)found on true where p.source_name like 'HISTORY-%'`;
 const plan=(await db.query('explain(analyze,format json,timing off) '+query)).rows[0]['QUERY PLAN'][0].Plan;
 const nodes=p=>[p,...(p.Plans||[]).flatMap(nodes)],all=nodes(plan),first=all.find(p=>p['Subplan Name']==='CTE newest');assert(first);assert.equal(first['Node Type'],'Limit');assert.equal(first['Actual Rows'],1);assert.equal(first['Actual Loops'],24);
 const scan=nodes(first).find(p=>p['Relation Name']==='game66_withdraw_orders');assert(['Index Only Scan','Index Scan'].includes(scan['Node Type']));assert.equal(scan['Index Name'],'game66_withdraw_orders_platform_time_idx');assert.equal(scan['Actual Rows'],1);
 const lookup=all.find(p=>p['Relation Name']==='game66_withdraw_orders'&&!nodes(first).includes(p));assert(lookup);assert.match(lookup['Index Cond'],/platform_id/);assert.match(lookup['Index Cond'],/create_time/);assert.equal(lookup['Actual Rows'],1);assert.equal(lookup['Actual Loops'],24);
 assert(!all.some(p=>p['Relation Name']==='game66_withdraw_orders'&&p['Node Type']==='Seq Scan'));
});
