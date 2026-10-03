// PostgreSQL correctness regression; synthetic orders and local PGlite only.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20261003180000_admin_member_daily_single_group.sql');
const fixture=require('./fixtures/wg-existing-member-functions.json').find(x=>x.proname==='dashboard_admin_live_member_daily');
const schemas=read('tests/uploaded-order-sources.test.cjs').split('\n').filter(l=>/^ create table (game66_platforms|game66_charge_orders|game66_withdraw_orders|ar_config_targets|ar_collected_orders|newar_detail_platforms|newar_detail_records)\(/.test(l)).join('\n');
const authSql=read('supabase/admin-live-query.sql').match(/create function private\.dashboard_admin_live_scope\(\)[\s\S]*?\n\$\$;/)[0];
const ids={ar:'00000000-0000-4000-8000-000000000001',newar:'00000000-0000-4000-8000-000000000002',lg:'00000000-0000-4000-8000-000000000003',game:'00000000-0000-4000-8000-000000000004',wg:'00000000-0000-4000-8000-000000000005',foreign:'00000000-0000-4000-8000-000000000006'};
const owner='10000000-0000-4000-8000-000000000001',viewer='10000000-0000-4000-8000-000000000002';
const req=(overrides={})=>({platformId:ids.ar,startAt:'2026-10-01T00:00:00+05:30',endAt:'2026-10-04T00:00:00+05:30',direction:'all',...overrides});
let db,beforeMeta,beforeBody,baselines;
const trimClock=({asOf,...value})=>value;
const call=async q=>trimClock((await db.query('select public.dashboard_admin_live_member_daily($1::jsonb) data',[JSON.stringify(q)])).rows[0].data);
const meta=async()=> (await db.query("select to_jsonb(p)-'prosrc' data from pg_proc p where oid='private.dashboard_admin_live_member_daily(jsonb)'::regprocedure")).rows[0].data;
const code=async()=> (await db.query("select prosrc,md5(prosrc) hash from pg_proc where oid='private.dashboard_admin_live_member_daily(jsonb)'::regprocedure")).rows[0];
const requests=[];
for(const platformId of Object.values(ids))for(const direction of ['all','charge','withdraw'])requests.push(req({platformId,direction}));
for(const extra of [{startAt:'2026-10-02T00:00:00+05:30',endAt:'2026-10-03T00:00:00+05:30'},
 {startAt:'2026-10-02T00:30:00+05:30',endAt:'2026-10-02T02:00:00+05:30'},
 {providers:['CombinedPay']},{providers:['route-a']},{providers:['missing']},
 {currency:'INR'},{currency:'USDT'},{currency:'XXX'},
 {startAt:'2026-10-05T00:00:00+05:30',endAt:'2026-10-06T00:00:00+05:30'}])requests.push(req(extra));
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create schema auth;create role anon;create role authenticated;
 grant usage on schema auth,private to authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table dashboard_profiles(auth_user_id uuid primary key,role text,active boolean,data_scope jsonb);
 create table dashboard_admin_preview_grants(auth_user_id uuid primary key,can_view boolean);
 create function private.dashboard_current_data_scope() returns jsonb language sql stable security definer as $$select data_scope from public.dashboard_profiles where auth_user_id=auth.uid() and active$$;
 ${authSql}
 create table fixture_platforms(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text);
 create function private.dashboard_admin_live_platforms() returns setof fixture_platforms language plpgsql stable security definer set search_path='' as $$declare s jsonb:=private.dashboard_admin_live_scope();begin return query select * from public.fixture_platforms p where s->>'mode'='all' or (s->'countries' ? p.scope_group and s->'platforms' ? p.source_name);end$$;
 create function private.dashboard_admin_live_expand_provider_filter(q jsonb) returns jsonb language sql stable security definer set search_path='' as $$select case when q->'providers' ? 'CombinedPay' then jsonb_set(q,'{providers}','["route-a","route-b"]') else q end$$;
 create function private.dashboard_admin_wg_member_daily(jsonb,timestamptz,timestamptz,text,text[],text) returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('wgExistingAdapter',true,'direction',$4,'currency',$6,'created_member_count',null,'success_member_count',null)$$;
 ${schemas}
 create table lg_orders(source_system text,country_code text,platform text,order_kind text,member_id text,third_party text,raw_channel text,created_at timestamptz,paid_at timestamptz,status_class text);
 create table private.dashboard_admin_order_provider_confirmations(source_system text,country_code text,platform text,order_kind text,order_no text,confirmed_provider text,active boolean);
 insert into dashboard_profiles values('${owner}','owner',true,'{"mode":"all"}'),('${viewer}','viewer',true,'{"countries":["IN"],"platforms":["AR-RAW"]}');
 insert into dashboard_admin_preview_grants values('${viewer}',true);
 insert into fixture_platforms values
 ('${ids.ar}','AR','M8','印度','IN','ar','Asia/Kolkata','INR','AR-RAW'),
 ('${ids.newar}','NEWAR','M8','尼泊尔','NP','newar','Asia/Kathmandu','NPR','NEW-RAW'),
 ('${ids.lg}','LG','M8','菲律宾','PH','lg','Asia/Manila','PHP','LG-RAW'),
 ('${ids.game}','GAME','香港','印度','HK_TEAM','game66','Asia/Kolkata','INR','G-RAW'),
 ('${ids.wg}','WG','M8','巴西','BR','wg','America/Sao_Paulo','BRL','WG-RAW'),
 ('${ids.foreign}','AR foreign','Other','巴西','BR','ar','America/Sao_Paulo','BRL','AR-RAW');
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,status,applied_at,completed_at,raw_channel)
 select 'AR','IN','AR-RAW',k,'O-'||d||'-'||k||'-'||n||'-'||i,' M'||n||' ',case k when 'recharge' then '已支付' else '已通过' end,
 ('2026-10-01'::date+(d-1))::timestamp+(interval '1 hour'*i),('2026-10-01'::date+(d-1))::timestamp+(interval '1 hour'*i)+interval '2 minutes',case when i%2=0 then 'route-a' else 'route-b' end
 from generate_series(1,3)d cross join unnest(array['recharge','withdraw'])k cross join generate_series(1,5)n cross join lateral generate_series(1,n)i;
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,status,applied_at,completed_at,raw_channel) values
 ('AR','IN','AR-RAW','recharge','NULL-ID',null,'已支付','2026-10-02 00:00','2026-10-02 00:00','route-a'),
 ('AR','IN','AR-RAW','recharge','BLANK-ID','   ','已支付','2026-10-02 00:30','2026-10-02 00:31','route-b'),
 ('AR','IN','AR-RAW','recharge','PENDING','PENDING','待支付','2026-10-02 01:00',null,'route-b'),
 ('AR','IN','AR-RAW','recharge','CROSS-IN','IN','已支付','2026-09-30 23:59','2026-10-01 00:00','route-a'),
 ('AR','IN','AR-RAW','recharge','CROSS-DAY','CROSS','已支付','2026-10-01 23:50','2026-10-02 00:10','route-a'),
 ('AR','IN','AR-RAW','withdraw','CROSS-OUT','OUT','已通过','2026-10-03 23:59','2026-10-04 00:00','route-b'),
 ('AR','IN','AR-RAW','withdraw','REJECTED','REJECT','未通过','2026-10-02 00:00','2026-10-02 00:01',''),
 ('AR','IN','AR-RAW','withdraw','CONFIRMED','CONF','已通过','2026-10-02 01:00','2026-10-02 01:01',null),
 ('AR','BR','AR-RAW','recharge','OTHER-C','FOREIGN','已支付','2026-10-02 00:00','2026-10-02 00:01','route-a'),
 ('NEW_AR','IN','AR-RAW','recharge','OTHER-S','FOREIGN','已支付','2026-10-02 00:00','2026-10-02 00:01','route-a');
 insert into private.dashboard_admin_order_provider_confirmations values('AR','IN','AR-RAW','withdraw','CONFIRMED','route-a',true);
 insert into newar_detail_platforms values('NEW-RAW','NP','尼泊尔','Asia/Kathmandu','NPR',true,'2026-10-01T00:00+05:45');
 insert into newar_detail_records(platform,dataset,source_id,member_id,provider,currency,status_group,created_at,success_at) values
 ('NEW-RAW','charge','N1','N','route-a','NPR','success','2026-10-01T00:00+05:45','2026-10-02T00:00+05:45'),
 ('NEW-RAW','charge','N2','N','route-b','NPR','success','2026-10-02T00:00+05:45','2026-10-02T00:01+05:45'),
 ('NEW-RAW','charge','N3',null,'route-b',null,'success','2026-10-02T00:00+05:45','2026-10-02T00:01+05:45'),
 ('NEW-RAW','withdraw','N4','   ','route-a','USDT','success','2026-10-02T00:00+05:45','2026-10-02T00:01+05:45'),
 ('NEW-RAW','charge','N5','PRE-LAUNCH','route-a','NPR','success','2026-09-30T23:59+05:45','2026-10-02T00:01+05:45');
 insert into lg_orders values
 ('LG','PH','LG-RAW','recharge','L','route-a','raw','2026-10-01T00:00+08','2026-10-02T00:00+08','success'),
 ('LG','PH','LG-RAW','recharge','L','route-b','raw','2026-10-02T00:00+08','2026-10-02T00:01+08','success'),
 ('LG','PH','LG-RAW','withdraw',null,'route-a','raw','2026-10-02T00:00+08','2026-10-02T00:01+08','success');
 insert into game66_charge_orders(platform_id,order_num,uid,create_time,pay_time,status_code,pay_method_name) values
 ('${ids.game}','G1','G','2026-10-01T00:00+05:30','2026-10-02T00:00+05:30','1','route-a'),
 ('${ids.game}','G2','G','2026-10-02T00:00+05:30','2026-10-02T00:01+05:30','1','route-b'),
 ('${ids.game}','G3',null,'2026-10-02T00:00+05:30',null,'0','route-a');
 insert into game66_withdraw_orders(platform_id,order_num,uid,create_time,update_time,status_code,pay_channel) values
 ('${ids.game}','W1','G','2026-10-02T00:00+05:30','2026-10-02T00:01+05:30','3','route-a'),
 ('${ids.game}','W2',' ','2026-10-02T00:00+05:30','2026-10-02T00:01+05:30','2','');
 `);
 const original=fixture.definition.replace("  if v_platform.source='ar' and v_providers is not null",`  -- wg_existing_members_v1: preserve all original source implementations.
  if v_platform.source='wg' then
    return private.dashboard_admin_wg_member_daily(to_jsonb(v_platform),v_start,v_end,v_direction,v_providers,v_currency);
  end if;
  if v_platform.source='ar' and v_providers is not null`);
 await db.exec(original);await db.exec(`revoke all on function private.dashboard_admin_live_member_daily(jsonb) from public,anon;grant execute on function private.dashboard_admin_live_member_daily(jsonb) to authenticated;
 create function public.dashboard_admin_live_member_daily(p_request jsonb) returns jsonb language sql stable security invoker set search_path='' as $$select private.dashboard_admin_live_member_daily(p_request)$$;
 revoke all on function public.dashboard_admin_live_member_daily(jsonb) from public,anon;grant execute on function public.dashboard_admin_live_member_daily(jsonb) to authenticated;`);
 await db.query("select set_config('test.uid',$1,false)",[owner]);
 beforeBody=await code();assert.equal(beforeBody.hash,'f6798fbbe20b7156b31a8af92bbe2888');beforeMeta=await meta();
 baselines=await Promise.all(requests.map(call));await db.exec(migration);
});
after(async()=>db?.close());
test('all DTO metrics match existing reader across sources, dates, directions, provider/currency filters',async()=>{
 for(let i=0;i<requests.length;i++)assert.deepEqual(await call(requests[i]),baselines[i],JSON.stringify(requests[i]));
});
test('three local days preserve creation/success cross-day counts and missing IDs',async()=>{
 const rows=(await call(req())).rows,r=rows.find(x=>x.date==='2026-10-02'&&x.direction==='charge');
 assert.equal(rows.length,6);assert.equal(r.created_member_count,6);assert.equal(r.success_member_count,6);
 assert.equal(r.created_order_count,18);assert.equal(r.success_order_count,18);
 assert.equal(r.created_missing_member_count,2);assert.equal(r.success_missing_member_count,2);
 assert.equal(rows.find(x=>x.date==='2026-10-01'&&x.direction==='charge').success_member_count,6);
 assert.equal(rows.find(x=>x.date==='2026-10-03'&&x.direction==='withdraw').success_order_count,15);
});
test('frequency thresholds remain cumulative and never count NULL or whitespace identities',async()=>{
 const r=(await call(req())).rows.find(x=>x.date==='2026-10-02'&&x.direction==='charge');
 for(const basis of ['created','success'])assert.deepEqual([2,3,4,5].map(n=>r[basis+'_members_ge'+n]),[4,3,2,1]);
 assert.doesNotMatch(JSON.stringify(await call(req())),/member_id|M1|NULL-ID|CONFIRMED/);
});
test('nonselected direction and unknown currency produce equivalent explicit-empty cohorts',async()=>{
 assert.equal((await call(req({direction:'charge'}))).rows.length,3);
 const r=await call(req({currency:'XXX'}));for(const x of r.rows)for(const [key,value]of Object.entries(x))if(key!=='date'&&key!=='direction')assert.equal(value,0,key);
 for(const currency of ['NPR','USDT','XXX']){
  // NEWAR currency is nullable; unknown currency never inferred from platform.
  await db.exec('begin');await db.exec(fixture.definition.replace("  if v_platform.source='ar' and v_providers is not null",`  -- wg_existing_members_v1: preserve all original source implementations.
  if v_platform.source='wg' then
    return private.dashboard_admin_wg_member_daily(to_jsonb(v_platform),v_start,v_end,v_direction,v_providers,v_currency);
  end if;
  if v_platform.source='ar' and v_providers is not null`));
  const old=await call(req({platformId:ids.newar,currency}));await db.exec('rollback');assert.deepEqual(await call(req({platformId:ids.newar,currency})),old);
 }
});
test('OID, all pg_proc metadata, owner, ACL, settings and public wrapper stay unchanged; rerun is idempotent',async()=>{
 assert.deepEqual(await meta(),beforeMeta);assert.equal((await code()).hash,'477dc1efd988b2985032974976299ce5');
 await db.exec(migration);assert.deepEqual(await meta(),beforeMeta);
 for(const role of ['anon','authenticated']){
  const r=await db.query('select has_function_privilege($1,$2,\'execute\') ok',[role,'private.dashboard_admin_live_member_daily(jsonb)']);assert.equal(r.rows[0].ok,role==='authenticated');
 }
});
test('fresh session and scope checks still reject revoked preview/unauthorized platform',async()=>{
 await db.query("select set_config('test.uid',$1,false)",[viewer]);
 await assert.rejects(()=>call(req({platformId:ids.lg})),/platform_denied/);
 await db.exec('update dashboard_admin_preview_grants set can_view=false');await assert.rejects(()=>call(req()),/preview_denied/);
 await db.exec('update dashboard_admin_preview_grants set can_view=true');await db.query("select set_config('test.uid',$1,false)",[owner]);
});
test('new unsupported basis/cohort/status filters remain rejected; source scans and request contract are unmodified',async()=>{
 for(const extra of [{basis:'success'},{cohort:'success'},{status:'success'}])await assert.rejects(()=>call(req(extra)),/invalid_request/);
 const after=(await code()).prosrc,old=beforeBody.prosrc;
 assert.equal(after.slice(0,after.indexOf("  v_sql:=")),old.slice(0,old.indexOf("  v_sql:=")));
 assert.equal(after.slice(after.indexOf('  execute v_sql')),old.slice(old.indexOf('  execute v_sql')));
 assert.doesNotMatch(after,/count\(distinct member_id\)|left join frequency f/);
});
test('metadata drift guard rejects altered config, ACL and body without modifying the reader',async()=>{
 for(const drift of ["alter function private.dashboard_admin_live_member_daily(jsonb) set statement_timeout='20s'",'grant execute on function private.dashboard_admin_live_member_daily(jsonb) to anon',"alter function private.dashboard_admin_live_member_daily(jsonb) cost 101"]){
  await db.exec('begin;'+drift+';');const snapshot=await meta();await assert.rejects(()=>db.exec(migration.replace(/^begin;/m,'').replace(/^commit;/m,'')),/metadata changed/);await db.exec('rollback');assert.deepEqual(await meta(),beforeMeta);assert.notDeepEqual(snapshot,beforeMeta);
 }
 await db.exec('begin');await db.exec(fixture.definition);await assert.rejects(()=>db.exec(migration.replace(/^begin;/m,'').replace(/^commit;/m,'')),/production body changed/);await db.exec('rollback');assert.equal((await code()).hash,'477dc1efd988b2985032974976299ce5');
});
test('migration performs only guarded function replacement and reload notification',()=>{
 assert.doesNotMatch(migration,/\b(create table|alter table|create index|delete from|update public\.|insert into|grant execute|revoke all)\b/i);
 assert.match(migration,/before_metadata.*after_metadata|after_metadata is distinct from before_metadata/s);
});
