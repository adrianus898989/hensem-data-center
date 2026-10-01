// Real PostgreSQL through PGlite, synthetic rows only; no production access.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),baseline=fs.readFileSync(path.join(__dirname,'fixtures/order-intake-wg-baseline.sql'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261001161404_order_intake_wg_latest_probe.sql'),'utf8');
const migrationBody=migration.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
const md5=s=>crypto.createHash('md5').update(s).digest('hex');
let db,initial,expected,patchedHash;
const read=async()=>(await db.query('select public.fixture_intake() data')).rows[0].data;
const meta=async()=>(await db.query("select prosrc,proacl::text,proowner,prosecdef,provolatile,proparallel,proisstrict,proconfig,pronargs,pronargdefaults,prorettype::regtype::text from pg_proc where oid='private.dashboard_admin_live_order_intake()'::regprocedure")).rows[0];
before(async()=>{
 db=new PGlite();await db.exec(`
 set timezone='UTC';
 create schema private;create role anon;create role authenticated;create role service_role;
 grant usage on schema private to anon,authenticated,service_role;
 create table fixture_platforms(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text);
 create function private.dashboard_admin_live_platforms() returns setof public.fixture_platforms language plpgsql stable security definer set search_path='' as $$
 declare s jsonb:=nullif(current_setting('test.scope',true),'')::jsonb;begin
 if s is null then raise exception 'unauthorized';end if;
 return query select p.* from public.fixture_platforms p where s->>'mode'='all' or (s->'countries'?p.scope_group and s->'platforms'?p.source_name);end;$$;
 create table fixture_sites(site_code text,country_code text,country text,platform text,timezone text,currency text);
 create function private.dashboard_admin_wg_sites() returns setof public.fixture_sites language sql stable set search_path='' as $$select * from public.fixture_sites$$;
 create table wg_recharge_details(site_code text,order_number text,created_at timestamptz,stored_at timestamptz,amount numeric);
 create table wg_withdraw_details(like wg_recharge_details);
 create index wg_recharge_details_created on wg_recharge_details(site_code,created_at desc,order_number desc);
 create index wg_withdraw_details_created on wg_withdraw_details(site_code,created_at desc,order_number desc);
 create table private.wg_detail_progress(site_code text,business text,basis text,cursor jsonb,last_success_at timestamptz,created_total bigint);
 create table ar_collected_orders(source_system text,country_code text,platform text,order_kind text,applied_at timestamp,updated_at timestamptz);
 create table lg_orders(source_system text,country_code text,platform text,order_kind text,created_at timestamptz,updated_at timestamptz);
 create table newar_detail_platforms(platform text,country_code text,enabled boolean,launch_at timestamptz);
 create table newar_detail_records(platform text,dataset text,created_at timestamptz,received_at timestamptz);
 create table game66_charge_orders(platform_id uuid,create_time timestamptz,last_seen_at timestamptz);
 create table game66_withdraw_orders(like game66_charge_orders);
 insert into fixture_platforms values
 ('10000000-0000-4000-8000-000000000001','Display-A','Team','巴西','BR','wg','America/Sao_Paulo','BRL','A'),
 ('10000000-0000-4000-8000-000000000002','Foreign A','Foreign','越南','VN','wg','Asia/Ho_Chi_Minh','VND','A'),
 ('10000000-0000-4000-8000-000000000003','OnlyReceipt','Team','巴西','BR','wg','America/Sao_Paulo','BRL','EMPTY'),
 ('10000000-0000-4000-8000-000000000004','Nothing','Team','巴西','BR','wg','America/Sao_Paulo','BRL','NOTHING'),
 ('10000000-0000-4000-8000-000000000005','NullCreated','Team','巴西','BR','wg','America/Sao_Paulo','BRL','NULL'),
 ('10000000-0000-4000-8000-000000000006','AR','Team','印度','IN','ar','Asia/Kolkata','INR','AR'),
 ('10000000-0000-4000-8000-000000000007','LG','Team','菲律宾','PH','lg','Asia/Manila','PHP','LG'),
 ('10000000-0000-4000-8000-000000000008','NEW','Team','印度','IN','newar','Asia/Kolkata','INR','NEW'),
 ('10000000-0000-4000-8000-000000000009','GAME','Team','香港','HK_TEAM','game66','Asia/Kolkata','INR','GAME');
 insert into fixture_sites values
 ('A1','BR','巴西','A','America/Sao_Paulo','BRL'),('A2','BR','巴西','A','America/Sao_Paulo','BRL'),
 ('FOREIGN','VN','越南','A','Asia/Ho_Chi_Minh','VND'),('ZERO1','BR','巴西','EMPTY','America/Sao_Paulo','BRL'),
 ('ZERO2','BR','巴西','EMPTY','America/Sao_Paulo','BRL'),('NOTHING','BR','巴西','NOTHING','America/Sao_Paulo','BRL'),
 ('NULL1','BR','巴西','NULL','America/Sao_Paulo','BRL'),('NULL2','BR','巴西','NULL','America/Sao_Paulo','BRL');
 insert into wg_recharge_details values
 ('A1','a','2026-09-29T23:00Z','2026-10-01T02:00Z',10),('A2','b','2026-09-30T02:30Z','2026-09-30T04:00Z',20),
 ('A2','old-but-newly-synced','2026-09-20Z','2026-10-02Z',30),('FOREIGN','other','2099-01-01Z','2099-01-02Z',999),
 ('NULL1','null',null,'2026-09-29T02:00Z',1),('NULL2','new-valid','2026-09-30Z','2026-09-30Z',2);
 insert into wg_withdraw_details values('A1','w1','2026-09-28T12:00Z','2026-09-28T13:00Z',40),('A2','w2','2026-09-27Z','2026-10-03Z',50),('NULL2','null',null,'2026-09-27Z',1);
 insert into private.wg_detail_progress values
 ('ZERO1','recharge','created','{}','2026-09-28Z',0),('ZERO2','recharge','created','{}','2026-09-29Z',0),
 ('ZERO1','withdraw','success','{}','2099-01-01Z',999),('ZERO1','withdraw','created',null,'2099-01-01Z',999),
 ('FOREIGN','recharge','created','{}','2099-01-01Z',999);
 insert into ar_collected_orders values('AR','IN','AR','recharge','2026-09-30 00:01','2026-09-30Z');
 insert into lg_orders values('LG','PH','LG','withdraw','2026-09-29T17:00Z','2026-09-30Z');
 insert into newar_detail_platforms values('NEW','IN',true,'2026-09-29Z');
 insert into newar_detail_records values('NEW','charge','2026-09-30Z','2026-09-30T01:00Z');
 insert into game66_withdraw_orders values('10000000-0000-4000-8000-000000000009','2026-09-29T21:00Z','2026-09-30Z');
 select set_config('test.scope','{"mode":"all"}',false);
 `);
 await db.exec(baseline);await db.exec(`revoke all on function private.dashboard_admin_live_order_intake() from public,anon,authenticated,service_role;
 create function public.fixture_intake() returns jsonb language sql stable security definer set search_path='' as $$select private.dashboard_admin_live_order_intake()$$;
 revoke all on function public.fixture_intake() from public,anon;grant execute on function public.fixture_intake() to authenticated;`);
 initial=await meta();assert.equal(md5(initial.prosrc),'7935b7161c8212bd633b4d8b52823594');expected=await read();
 await db.exec(migration);patchedHash=md5((await meta()).prosrc);
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));
test('full output equals actual baseline for mixed native sources and multiple WG sites per platform',async()=>{assert.deepEqual(await read(),expected);assert.equal((await read()).filter(x=>x.system==='WG'&&x.rawPlatform==='A'&&x.rawCountry==='BR').length,2);});
test('latest created row supplies its own stored_at; different directions and local midnight stay independent',async()=>{
 const rows=(await read()).filter(x=>x.rawCountry==='BR'&&x.rawPlatform==='A');const charge=rows.find(x=>x.directions[0]==='charge'),withdraw=rows.find(x=>x.directions[0]==='withdraw');
 assert.equal(charge.lastDate,'2026-09-29');assert.equal(charge.updatedAt,'2026-09-30T04:00:00+00:00');assert.equal(withdraw.lastDate,'2026-09-28');assert.equal(withdraw.updatedAt,'2026-09-28T13:00:00+00:00');assert.equal(charge.name,'Display-A');
 assert(rows.every(x=>!('created_total' in x)&&!('records' in x)&&!('count' in x)));
});
test('NULL creation ordering and all-NULL direction retain original DESC NULLS FIRST semantics',async()=>{
 const rows=(await read()).filter(x=>x.rawPlatform==='NULL');assert.equal(rows.length,2);assert(rows.every(x=>x.lastDate===null));assert.equal(rows.find(x=>x.directions[0]==='charge').updatedAt,'2026-09-29T02:00:00+00:00');
});
test('empty latest probes keep exact progress fallback, exclude success basis and cursorless/foreign receipts',async()=>{
 const rows=await read(),r=rows.find(x=>x.rawPlatform==='EMPTY');assert.deepEqual(r.directions,['charge']);assert.equal(r.lastDate,null);assert.equal(r.updatedAt,'2026-09-29T00:00:00+00:00');assert(!rows.some(x=>x.rawPlatform==='NOTHING'));
 const totals=(await db.query('select created_total from private.wg_detail_progress order by created_total')).rows.map(x=>x.created_total);assert.deepEqual(totals,[0,0,999,999,999]);
});
test('fresh authorized country+platform scope prevents another country with same platform name leaking',async()=>{
 await db.query("select set_config('test.scope',$1,true)",[JSON.stringify({countries:['BR'],platforms:['A']})]);await db.exec('set local role authenticated');const rows=await read();assert.equal(rows.length,2);assert(rows.every(x=>x.rawCountry==='BR'&&x.rawPlatform==='A'));await db.query("select set_config('test.scope','',true)");await assert.rejects(read(),/unauthorized/);
});
test('private helper ACL and all function metadata stay byte-for-byte unchanged; migration is idempotent',async()=>{
 await db.exec(migrationBody);const current=await meta();assert.equal(md5(current.prosrc),patchedHash);for(const k of Object.keys(initial).filter(k=>k!=='prosrc'))assert.deepEqual(current[k],initial[k],k);
 for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') yes',[role,'private.dashboard_admin_live_order_intake()'])).rows[0].yes,false);
});
test('body, ACL, search_path and security property drift fail closed instead of replacing newer code',async()=>{
 for(const [sql,pattern] of [
 ["grant execute on function private.dashboard_admin_live_order_intake() to authenticated",/acl_drift/],
 ["grant execute on function private.dashboard_admin_live_order_intake() to public",/acl_drift/],
 ["alter function private.dashboard_admin_live_order_intake() security invoker",/metadata_drift/],
 ["alter function private.dashboard_admin_live_order_intake() set search_path='public'",/metadata_drift/],
 ["alter function private.dashboard_admin_live_order_intake() immutable",/metadata_drift/],
 ["create or replace function private.dashboard_admin_live_order_intake() returns jsonb language plpgsql stable security definer set search_path='' as $$begin return '[]'::jsonb;end;$$",/body_drift/]
 ]){await db.exec('savepoint drift');try{await db.exec(sql);await assert.rejects(db.exec(migrationBody),pattern);}finally{await db.exec('rollback to savepoint drift;release savepoint drift');}}
});
test('timestamp ties still select an original admissible newest row without claiming deterministic tie order',async()=>{
 await db.exec("insert into wg_recharge_details values('A1','same-time','2026-09-30T02:30Z','2026-10-01Z',5)");const patched=(await meta()).prosrc;const now=(await read()).find(x=>x.rawPlatform==='A'&&x.rawCountry==='BR'&&x.directions[0]==='charge');
 await db.exec(baseline);const old=(await read()).find(x=>x.rawPlatform==='A'&&x.rawCountry==='BR'&&x.directions[0]==='charge');assert.equal(now.lastDate,old.lastDate);for(const row of [now,old])assert(['2026-10-01T00:00:00+00:00','2026-09-30T04:00:00+00:00'].includes(row.updatedAt));assert(patched.includes('cross join lateral'));
});
test('production-shaped indexes stop after one row per site, never all historical WG rows',async()=>{
 await db.exec("insert into wg_recharge_details select s,'history-'||i,timestamptz '2025-01-01Z'+i*interval '1 minute',now(),1 from unnest(array['A1','A2','FOREIGN'])s cross join generate_series(1,5000)i;insert into wg_withdraw_details select * from wg_recharge_details where order_number like 'history-%';analyze wg_recharge_details;analyze wg_withdraw_details;");
 const nodes=p=>[p,...(p.Plans||[]).flatMap(nodes)];for(const table of ['wg_recharge_details','wg_withdraw_details']){
  const query=`select n.created_at,n.stored_at from private.dashboard_admin_wg_sites()s cross join lateral(select w.created_at,w.stored_at from public.${table} w where w.site_code=s.site_code order by w.created_at desc limit 1)n where s.country_code='BR' and s.platform='A' order by n.created_at desc limit 1`;
  const plan=(await db.query('explain(analyze,format json,timing off) '+query)).rows[0]['QUERY PLAN'][0].Plan,scan=nodes(plan).find(p=>p['Relation Name']===table);assert.equal(scan['Node Type'],'Index Scan');assert.equal(scan['Actual Rows'],1);assert.equal(scan['Actual Loops'],2);assert.equal(plan['Actual Rows'],1);assert(!nodes(plan).some(p=>p['Node Type']==='Bitmap Heap Scan'));
 }
});
