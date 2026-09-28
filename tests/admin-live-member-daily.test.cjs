// Synthetic PostgreSQL; no network or actual member identifiers are used.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,'supabase',n),'utf8');
const migration=read('migrations/20260928092739_admin_live_member_daily.sql');
const authSql=read('admin-live-query.sql').match(/create function private\.dashboard_admin_live_scope\(\)[\s\S]*?\n\$\$;/)[0];
const schemas=fs.readFileSync(path.join(__dirname,'uploaded-order-sources.test.cjs'),'utf8').split('\n').filter(l=>/^ create table (game66_platforms|game66_charge_orders|game66_withdraw_orders|ar_config_targets|ar_collected_orders|newar_detail_platforms|newar_detail_records)\(/.test(l)).join('\n');
const ids={ar:'00000000-0000-4000-8000-000000000001',lg:'00000000-0000-4000-8000-000000000002',newar:'00000000-0000-4000-8000-000000000003',game:'00000000-0000-4000-8000-000000000004',hidden:'00000000-0000-4000-8000-000000000005',kp:'00000000-0000-4000-8000-000000000006'};
const owner='10000000-0000-4000-8000-000000000001',viewer='10000000-0000-4000-8000-000000000002';
let db;
const request=(overrides={})=>({platformId:ids.ar,startAt:'2026-09-25T00:00:00+05:30',endAt:'2026-09-26T00:00:00+05:30',direction:'all',...overrides});
const call=async(q=request())=>(await db.query('select public.dashboard_admin_live_member_daily($1::jsonb) data',[JSON.stringify(q)])).rows[0].data;
const as=uid=>db.query("select set_config('test.uid',$1,false)",[uid]);
const row=(result,date='2026-09-25',direction='charge')=>result.rows.find(r=>r.date===date&&r.direction===direction);
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create schema auth;create role anon;create role authenticated;
 grant usage on schema auth,private to authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table dashboard_profiles(auth_user_id uuid primary key,role text,active boolean,data_scope jsonb);
 create table dashboard_admin_preview_grants(auth_user_id uuid primary key,can_view boolean);
 create function private.dashboard_current_data_scope() returns jsonb language sql stable security definer as $$select data_scope from public.dashboard_profiles where auth_user_id=auth.uid() and active$$;
 create table fixture_platforms(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text);
 ${authSql}
 create function private.dashboard_admin_live_platforms() returns setof fixture_platforms language plpgsql stable security definer set search_path='' as $$
 declare s jsonb:=private.dashboard_admin_live_scope();begin return query select * from public.fixture_platforms p
 where s->>'mode'='all' or (s->'countries' ? p.scope_group and s->'platforms' ? p.source_name);end;$$;
 create function private.dashboard_admin_live_expand_provider_filter(q jsonb) returns jsonb language sql stable security definer set search_path='' as $$
 select case when q->'providers' ? 'CombinedPay' then jsonb_set(q,'{providers}','["route-a","route-b"]') else q end$$;
 ${schemas}
 create table lg_orders(source_system text,country_code text,platform text,order_kind text,member_id text,third_party text,raw_channel text,created_at timestamptz,paid_at timestamptz,status_class text);
 create table private.dashboard_admin_order_provider_confirmations(source_system text,country_code text,platform text,order_kind text,order_no text,confirmed_provider text,active boolean);
 insert into dashboard_profiles values('${owner}','owner',true,'{"mode":"all"}'),('${viewer}','viewer',true,'{"countries":["IN"],"platforms":["AR-RAW"]}');
 insert into dashboard_admin_preview_grants values('${viewer}',true);
 insert into fixture_platforms values
 ('${ids.ar}','AR Display','M8','印度','IN','ar','Asia/Kolkata','INR','AR-RAW'),
 ('${ids.lg}','LG Display','M8','菲律宾','PH','lg','Asia/Manila','PHP','LG-RAW'),
 ('${ids.newar}','New display','M8','尼泊尔','NP','newar','Asia/Kathmandu','NPR','NEW-RAW'),
 ('${ids.game}','GAME display','香港','印度','HK_TEAM','game66','Asia/Kolkata','INR','G-RAW'),
 ('${ids.hidden}','AR Display','Other','巴西','BR','ar','America/Sao_Paulo','BRL','AR-RAW'),
 ('${ids.kp}','KP','M8','南美','SA','kp','UTC','USD','KP-RAW');
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,status,applied_at,completed_at,raw_channel) values
 ('AR','IN','AR-RAW','recharge','A1','SYNTH-0001','已支付','2026-09-25 00:00','2026-09-25 00:03','route-a'),
 ('AR','IN','AR-RAW','recharge','A2','SYNTH-0001','已支付','2026-09-25 01:00','2026-09-25 01:05','route-b'),
 ('AR','IN','AR-RAW','recharge','A3','SYNTH-1','待支付','2026-09-25 02:00',null,'route-b'),
 ('AR','IN','AR-RAW','recharge','A4',null,'已取消','2026-09-25 03:00',null,'route-a'),
 ('AR','IN','AR-RAW','recharge','A5','   ','已支付','2026-09-25 04:00','2026-09-25 04:10','route-a'),
 ('AR','IN','AR-RAW','recharge','CROSS-IN','SYNTH-IN','已支付','2026-09-24 20:00','2026-09-25 05:00','route-a'),
 ('AR','IN','AR-RAW','recharge','CROSS-OUT','SYNTH-OUT','已支付','2026-09-25 23:00','2026-09-26 00:01','route-b'),
 ('AR','IN','AR-RAW','recharge','NEXT','SYNTH-0001','已支付','2026-09-26 00:00','2026-09-26 00:02','route-b'),
 ('AR','IN','AR-RAW','withdraw','W1','SYNTH-0001','已通过','2026-09-25 10:00','2026-09-25 10:01','route-a'),
 ('AR','IN','AR-RAW','withdraw','W2','SYNTH-0001','未通过','2026-09-25 11:00',null,'route-b'),
 ('AR','BR','AR-RAW','recharge','OTHER-COUNTRY','SYNTH-FOREIGN','已支付','2026-09-25 10:00','2026-09-25 10:01','route-a'),
 ('NEW_AR','IN','AR-RAW','recharge','WRONG-SYSTEM','SYNTH-FOREIGN','已支付','2026-09-25 10:00','2026-09-25 10:01','route-a');
 insert into lg_orders values
 ('LG','PH','LG-RAW','recharge',null,'route-a','raw','2026-09-25T00:00+08','2026-09-25T00:05+08','success'),
 ('LG','PH','LG-RAW','recharge','','route-b','raw','2026-09-25T01:00+08',null,'pending'),
 ('LG','PH','LG-RAW','withdraw','LG-SYNTH','route-a','raw','2026-09-24T23:00+08','2026-09-25T01:00+08','success'),
 ('LG','LG','LG-RAW','recharge','WRONG-COUNTRY','route-a','raw','2026-09-25T00:00+08','2026-09-25T00:05+08','success');
 insert into newar_detail_platforms values('NEW-RAW','NP','尼泊尔','Asia/Kathmandu','NPR',true,'2026-09-25T00:00+05:45');
 insert into newar_detail_records(platform,dataset,source_id,member_id,provider,currency,status_group,created_at,success_at) values
 ('NEW-RAW','charge','N1','NEW-SYNTH','route-a','NPR','success','2026-09-25T00:00+05:45','2026-09-25T00:01+05:45'),
 ('NEW-RAW','charge','N2','NEW-SYNTH','route-b','NPR','pending','2026-09-25T02:00+05:45',null),
 ('NEW-RAW','charge','N3','PRE-LAUNCH','route-a','NPR','success','2026-09-24T23:00+05:45','2026-09-25T00:02+05:45'),
 ('NEW-RAW','workorder','NW','NOT-AN-ORDER','route-a','NPR','success','2026-09-25T01:00+05:45','2026-09-25T02:00+05:45'),
 ('NEW-RAW','withdraw','W1','NEW-SYNTH','route-a','USD','success','2026-09-25T03:00+05:45','2026-09-25T03:01+05:45');
 insert into game66_charge_orders(platform_id,order_num,uid,create_time,pay_time,status_code,pay_method_name) values
 ('${ids.game}','GC1','G-SYNTH','2026-09-25T00:00+05:30','2026-09-25T00:05+05:30','1','route-a'),
 ('${ids.game}','GC2','G-SYNTH','2026-09-25T01:00+05:30','2026-09-25T01:05+05:30','1','route-b'),
 ('${ids.game}','GC3',null,'2026-09-25T02:00+05:30',null,'0','route-a'),
 ('${ids.hidden}','GCX','PRIVATE-GAME','2026-09-25T02:00+05:30','2026-09-25T02:05+05:30','1','route-a');
 insert into game66_withdraw_orders(platform_id,order_num,uid,create_time,update_time,status_code,pay_channel) values
 ('${ids.game}','GW1','G-SYNTH','2026-09-25T03:00+05:30','2026-09-25T03:05+05:30','3','route-a'),
 ('${ids.game}','GW2','G-SYNTH','2026-09-25T04:00+05:30','2026-09-25T04:05+05:30','2','route-b');
 `);await db.exec(migration);await as(owner);
});
after(async()=>db?.close());

test('daily members deduplicate across repeated orders and providers, keeping creation and success clocks separate',async()=>{
 const r=await call(),c=row(r),w=row(r,'2026-09-25','withdraw');
 assert.deepEqual(c,{date:'2026-09-25',direction:'charge',created_member_count:3,success_member_count:2,created_order_count:6,success_order_count:4,created_missing_member_count:2,success_missing_member_count:1});
 assert.equal(w.created_member_count,1);assert.equal(w.success_member_count,1);assert.equal(w.created_order_count,2);
 assert.equal(r.platform.sourceName,'AR-RAW');assert.equal(r.platform.name,'AR Display');assert.equal(r.capabilities.sourceCompletenessVerified,false);
 assert.doesNotMatch(JSON.stringify(r),/SYNTH|member_id|A1|CROSS-/,'only counts, never member or order IDs');
});
test('same member is counted on each local day; daily counts are not a period distinct count',async()=>{
 const r=await call(request({endAt:'2026-09-27T00:00:00+05:30',direction:'charge'}));assert.equal(r.rows.length,2);
 assert.equal(row(r).created_member_count,3);assert.equal(row(r,'2026-09-26').created_member_count,1);
 assert.equal(row(r,'2026-09-26').success_member_count,2,'prior-day creation paid today belongs to today success members');
});
test('partial-day boundaries are honored exactly, including the exclusive end',async()=>{
 const r=await call(request({startAt:'2026-09-25T00:30:00+05:30',endAt:'2026-09-25T02:00:00+05:30',direction:'charge'}));
 assert.equal(row(r).created_member_count,1);assert.equal(row(r).created_order_count,1);assert.equal(row(r).success_member_count,1);
 assert.equal(r.rows.length,1);
});
test('empty days return zero rows for each selected direction without inventing missing coverage',async()=>{
 const r=await call(request({startAt:'2026-09-20T00:00:00+05:30',endAt:'2026-09-22T00:00:00+05:30'}));assert.equal(r.rows.length,4);
 for(const x of r.rows)for(const [k,v]of Object.entries(x))if(k.endsWith('_count'))assert.equal(v,0);
 const noProviders=await call(request({providers:['not-present']}));assert.equal(row(noProviders).created_order_count,0);
});
test('canonical provider selection expands once, then deduplicates the combined raw routes',async()=>{
 const r=await call(request({providers:['CombinedPay']}));assert.equal(row(r).created_member_count,3);
 const narrow=await call(request({providers:['route-b']}));assert.equal(row(narrow).created_member_count,3);assert.equal(row(narrow).success_member_count,1);
 assert.deepEqual((await call(request({providers:[]}))).rows,(await call()).rows);
});
test('LG uses paid_at and platform timezone while missing IDs remain explicitly incomplete',async()=>{
 const r=await call(request({platformId:ids.lg,startAt:'2026-09-25T00:00:00+08:00',endAt:'2026-09-26T00:00:00+08:00'}));
 const c=row(r),w=row(r,'2026-09-25','withdraw');assert.equal(c.created_member_count,0);assert.equal(c.created_order_count,2);assert.equal(c.created_missing_member_count,2);
 assert.equal(c.success_member_count,0);assert.equal(c.success_order_count,1);assert.equal(c.success_missing_member_count,1);
 assert.equal(w.created_member_count,0);assert.equal(w.success_member_count,1);assert.equal(r.platform.timezone,'Asia/Manila');
});
test('NEWAR excludes workorders and pre-launch source rows and honors exact currency filtering',async()=>{
 const q=request({platformId:ids.newar,startAt:'2026-09-25T00:00:00+05:45',endAt:'2026-09-26T00:00:00+05:45'}),r=await call(q);
 assert.equal(row(r).created_member_count,1);assert.equal(row(r).created_order_count,2);assert.equal(row(r).success_member_count,1);
 assert.equal(row(r,'2026-09-25','withdraw').success_member_count,1);
 const npr=await call({...q,currency:'NPR'});assert.equal(row(npr,'2026-09-25','withdraw').created_order_count,0);
});
test('GAME66 reads uid for both directions with correct successful statuses and platform isolation',async()=>{
 const r=await call(request({platformId:ids.game}));assert.equal(row(r).created_member_count,1);assert.equal(row(r).created_order_count,3);assert.equal(row(r).created_missing_member_count,1);assert.equal(row(r).success_member_count,1);assert.equal(row(r).success_order_count,2);
 const w=row(r,'2026-09-25','withdraw');assert.equal(w.created_member_count,1);assert.equal(w.created_order_count,2);assert.equal(w.success_order_count,1);
});
test('raw IDs stay exact strings, so leading zero and case distinctions survive',async()=>{
 await db.exec("begin;insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,status,applied_at,raw_channel) values('AR','IN','AR-RAW','recharge','ZERO','0001','待支付','2026-09-25 06:00','identity'),('AR','IN','AR-RAW','recharge','ONE','1','待支付','2026-09-25 06:00','identity'),('AR','IN','AR-RAW','recharge','LOW','abc','待支付','2026-09-25 06:00','identity'),('AR','IN','AR-RAW','recharge','UP','ABC','待支付','2026-09-25 06:00','identity')");
 try{assert.equal(row(await call(request({providers:['identity']}))).created_member_count,4)}finally{await db.exec('rollback')}
});
test('unsupported status/search/pagination filters and malformed input never silently change semantics',async()=>{
 for(const q of [null,[],{...request(),status:'all'},{...request(),orderNumber:'X'},{...request(),memberId:'X'},{...request(),offset:0},{...request(),action:'memberDaily'},request({platformId:'bad'}),request({direction:'both'}),request({providers:[1]}),request({providers:'x'}),request({startAt:'2026-09-25'}),request({startAt:'infinity'}),request({endAt:'2026-09-24T00:00:00Z'}),request({endAt:'2026-11-01T00:00:00Z'}),request({currency:1})])await assert.rejects(()=>call(q),/invalid_/);
 await assert.rejects(()=>call(request({platformId:ids.kp})),/unsupported_source/);
});
test('fresh scope, revoked grants, disabled accounts and anonymous access remain enforced on every call',async()=>{
 await as(viewer);assert.equal(row(await call()).created_member_count,3);await assert.rejects(()=>call(request({platformId:ids.lg})),/platform_denied/);await assert.rejects(()=>call(request({platformId:ids.hidden})),/platform_denied/);
 await db.exec(`update dashboard_admin_preview_grants set can_view=false where auth_user_id='${viewer}'`);await assert.rejects(()=>call(),/preview_denied/);
 await db.exec(`update dashboard_admin_preview_grants set can_view=true where auth_user_id='${viewer}';update dashboard_profiles set active=false where auth_user_id='${viewer}'`);await assert.rejects(()=>call(),/preview_denied/);
 await as('');await assert.rejects(()=>call(),/login_required/);await as(owner);
 for(const name of ['public.dashboard_admin_live_member_daily(jsonb)','private.dashboard_admin_live_member_daily(jsonb)'])assert.equal((await db.query('select has_function_privilege($1,$2,$3) allowed',['anon',name,'execute'])).rows[0].allowed,false);
 await db.exec('set role authenticated');try{assert.equal(row(await call()).created_member_count,3);await assert.rejects(()=>db.query('select member_id from public.ar_collected_orders limit 1'),/permission denied/)}finally{await db.exec('reset role')}
});
test('migration only adds isolated read functions and uses a public invoker wrapper',()=>{
 assert.doesNotMatch(migration,/\b(insert into|update public\.|delete from|alter table|create table|create index|create or replace)\b/i);
 assert.match(migration,/public\.dashboard_admin_live_member_daily\(p_request jsonb\)[\s\S]*?security invoker/);
 assert.equal([...migration.matchAll(/create function /g)].length,2);
});
test('daily frequency thresholds count members across providers, independently for created and successful orders',async()=>{
 const frequencyMigration=read('migrations/20260928094906_admin_live_member_frequency.sql');
 await db.exec(frequencyMigration);await db.exec(frequencyMigration);await as(owner);
 await db.exec(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,status,applied_at,completed_at,raw_channel)
 select 'AR','IN','AR-RAW','withdraw','F-'||n||'-'||i,'F-MEMBER-'||n,
   case when i=1 then '未通过' else '已通过' end,'2026-09-28 03:00'::timestamp,
   case when i=1 then null else '2026-09-28 03:05'::timestamp end,
   case when i%2=0 then 'route-a' else 'route-b' end
 from generate_series(1,5) n cross join lateral generate_series(1,n) i;
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,status,applied_at,completed_at,raw_channel) values
 ('AR','IN','AR-RAW','withdraw','F-MISSING',null,'已通过','2026-09-28 04:00','2026-09-28 04:05','route-a'),
 ('AR','IN','AR-RAW','withdraw','F-NEXT','F-MEMBER-5','已通过','2026-09-29 01:00','2026-09-29 01:05','route-a'),
 ('AR','IN','AR-RAW','withdraw','F-CROSS','F-MEMBER-5','已通过','2026-09-27 23:00','2026-09-28 01:05','route-a');`);
 const q=request({startAt:'2026-09-28T00:00:00+05:30',endAt:'2026-09-30T00:00:00+05:30',direction:'withdraw',providers:['CombinedPay']});
 const r=await call(q),first=row(r,'2026-09-28','withdraw'),second=row(r,'2026-09-29','withdraw');
 assert.equal(first.created_member_count,5);assert.equal(first.success_member_count,4);
 assert.deepEqual([2,3,4,5].map(n=>first['created_members_ge'+n]),[4,3,2,1]);
 assert.deepEqual([2,3,4,5].map(n=>first['success_members_ge'+n]),[3,2,1,1]);
 assert.equal(first.created_missing_member_count,1);assert.equal(first.success_missing_member_count,1);
 assert.deepEqual([2,3,4,5].map(n=>second['success_members_ge'+n]),[0,0,0,0],'same member starts again next local day');
 const narrow=row(await call({...q,providers:['route-a']}),'2026-09-28','withdraw');
 assert.deepEqual([2,3,4,5].map(n=>narrow['created_members_ge'+n]),[2,0,0,0]);
 assert.deepEqual([2,3,4,5].map(n=>narrow['success_members_ge'+n]),[2,1,0,0]);
 assert.equal(r.capabilities.frequencyBasis,'per_platform_local_day_order_count');assert.deepEqual(r.capabilities.frequencyThresholds,[2,3,4,5]);
 assert.doesNotMatch(JSON.stringify(r),/F-MEMBER|F-MISSING|member_id/);
 await as('');await assert.rejects(()=>call(q),/login_required/);await as(owner);
});
test('frequency uses source-specific member identities and successful statuses across LG, NEWAR and GAME66',async()=>{
 const lg=row(await call(request({platformId:ids.lg,startAt:'2026-09-25T00:00:00+08:00',endAt:'2026-09-26T00:00:00+08:00'})));
 assert.equal(lg.created_members_ge2,0);assert.equal(lg.created_missing_member_count,2);
 const newar=row(await call(request({platformId:ids.newar,startAt:'2026-09-25T00:00:00+05:45',endAt:'2026-09-26T00:00:00+05:45'})));
 assert.equal(newar.created_members_ge2,1);assert.equal(newar.success_members_ge2,0);
 const game=await call(request({platformId:ids.game}));assert.equal(row(game).success_members_ge2,1);assert.equal(row(game,'2026-09-25','withdraw').created_members_ge2,1);assert.equal(row(game,'2026-09-25','withdraw').success_members_ge2,0);
});
