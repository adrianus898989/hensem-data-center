// Synthetic PostgreSQL; no network or actual member identifiers are used.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,'supabase',n),'utf8');
const migration=read('migrations/20260929170000_daily_submission_analysis.sql');
const authSql=read('admin-live-query.sql').match(/create function private\.dashboard_admin_live_scope\(\)[\s\S]*?\n\$\$;/)[0];
const schemas=fs.readFileSync(path.join(__dirname,'uploaded-order-sources.test.cjs'),'utf8').split('\n').filter(l=>/^ create table (game66_platforms|game66_charge_orders|game66_withdraw_orders|ar_config_targets|ar_collected_orders|newar_detail_platforms|newar_detail_records)\(/.test(l)).join('\n');
const ids={ar:'00000000-0000-4000-8000-000000000001',lg:'00000000-0000-4000-8000-000000000002',newar:'00000000-0000-4000-8000-000000000003',game:'00000000-0000-4000-8000-000000000004',hidden:'00000000-0000-4000-8000-000000000005',kp:'00000000-0000-4000-8000-000000000006'};
const owner='10000000-0000-4000-8000-000000000001',viewer='10000000-0000-4000-8000-000000000002';
let db;
const request=(overrides={})=>({platformId:ids.ar,startAt:'2026-09-25T00:00:00+05:30',endAt:'2026-09-26T00:00:00+05:30',direction:'charge',...overrides});
const call=async(q=request())=>(await db.query('select public.dashboard_admin_live_submission_analysis($1::jsonb) data',[JSON.stringify(q)])).rows[0].data;
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
 `);await db.exec(`alter table lg_orders add column order_no text,add column metric_amount numeric;alter table ar_collected_orders add column member_level text,add column recharge_count integer;alter table newar_detail_records add column raw jsonb default '{}';create function private.dashboard_admin_live_provider_canonical(country text,platform text,provider text) returns text language sql stable as $$select case when provider in ('route-a','route-b') then 'CombinedPay' else provider end$$;`);await db.exec(migration);await db.exec(read('migrations/20260928092956_admin_live_dynamic_amount_bands.sql').split('do $patch$')[0]+'commit;');await db.exec(read('migrations/20260929200000_submission_risk_dashboard.sql'));await as(owner);await seed();
});
after(async()=>db?.close());


const q=(extra={})=>request({startAt:'2026-09-27T00:00:00+05:30',endAt:'2026-09-29T00:00:00+05:30',...extra});
const metric=(r,threshold=30,provider=null)=>r.metrics.find(x=>x.threshold===threshold&&x.provider===provider);
async function seed(){
 await db.exec(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,completed_at,raw_channel,member_level)
 select 'AR','IN','AR-RAW','recharge',member||'-'||day||'-'||n,member,100,'待支付',day::date+time '10:00',null,case when n%2=0 then 'route-a' else 'route-b' end,level
 from (values('ZERO','2026-09-27',30,'L0'),('ZERO','2026-09-28',30,'LV0'),('OLD','2026-09-27',31,'LV3'),('UNKNOWN','2026-09-27',30,null),('LOW','2026-09-27',29,'L0'),('SPLIT','2026-09-27',20,'L0'),('SPLIT','2026-09-28',20,'L0'),('CROSS-PAY','2026-09-27',30,'L0'),('LATER-PAY','2026-09-27',30,'L0')) v(member,day,total,level) cross join lateral generate_series(1,total) n;
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,completed_at,raw_channel,member_level) values
 ('AR','IN','AR-RAW','recharge','CROSS-PAID','CROSS-PAY',100,'已支付','2026-09-26 23:00','2026-09-27 08:00','OtherPay','L1'),
 ('AR','IN','AR-RAW','recharge','LATER-PAID','LATER-PAY',100,'已支付','2026-09-27 23:00','2026-09-28 08:00','OtherPay','L1');
 update ar_collected_orders set recharge_count=case when member_id='OLD' then 4 else 0 end where member_level is not null;`);
}
test('qualifies per local day across providers; 30 counts, 29 does not; repeated days do not duplicate IDs',async()=>{
 const r=await call(q());const m=metric(r);assert.equal(m.member_count,3);assert.equal(m.member_days,4);assert.equal(m.invalid_count,121);
 assert.equal(m.new_members,1);assert.equal(m.funded_members,1);assert.equal(m.unknown_members,1);
 assert.equal(metric(r,50).member_count,0);assert.equal(metric(r,50).member_days,0);
 assert.doesNotMatch(JSON.stringify(r),/ZERO|UNKNOWN|OLD|CROSS-PAY/,'summary never exposes identifiers');
});
test('success through another provider or prior-day creation prevents false no-charge classification',async()=>{
 const r=await call(q({operation:'members',providers:['CombinedPay']}));assert.equal(r.total,4);
 assert.ok(r.rows.every(x=>!['CROSS-PAY','LATER-PAY','SPLIT','LOW'].includes(x.member_id)));
 assert.equal(r.members,3);assert.equal(r.rows.find(x=>x.member_id==='ZERO').selected_count,30);
});
test('detail filters levels and pages actual IDs with stable ordering',async()=>{
 const r=await call(q({operation:'members',level:'new',limit:20}));assert.equal(r.total,2);assert.equal(r.members,1);assert.deepEqual(r.rows.map(x=>x.day),['2026-09-28','2026-09-27']);
 assert.equal((await call(q({operation:'members',level:'funded'}))).rows[0].member_id,'OLD');
 assert.equal((await call(q({operation:'members',level:'unknown'}))).rows[0].member_id,'UNKNOWN');
 assert.equal((await call(q({operation:'members',offset:2,level:'new'}))).rows.length,0);
});
test('full local-day eligibility is independent of clock selections',async()=>{
 const r=await call(q({startAt:'2026-09-27T09:00:00+05:30',endAt:'2026-09-27T11:00:00+05:30'}));
 assert.equal(metric(r).member_count,3);assert.equal(metric(r).invalid_count,91);
 assert.equal(Date.parse(r.dayStart),Date.parse('2026-09-26T18:30:00Z'));
});
test('same-name platform or unauthorized source cannot leak members',async()=>{
 await as(viewer);await assert.rejects(call(q({platformId:ids.hidden})),/platform_denied/);await as(owner);
 await assert.rejects(call(q({platformId:ids.kp})),/submission_source_unavailable/);
});
test('strict request validation and empty selection do not turn unavailable data into members',async()=>{
 for(const bad of [{threshold:29},{threshold:'30'},{direction:'withdraw'},{operation:'delete'},{level:'invalid'},{offset:-1},{extra:true}])await assert.rejects(call(q(bad)),/invalid_/);
 const r=await call(q({providers:['absent']}));assert.equal(metric(r).invalid_count,0);assert.equal(metric(r).member_days,0);
});
test('new AR launch boundary, raw level and normalized route identity are honored',async()=>{
 await db.exec(`insert into newar_detail_records(platform,dataset,source_id,member_id,order_number,provider,currency,status_group,created_at,raw) select 'NEW-RAW','charge','SPAM-'||n,'NEW-ZERO','SPAM-'||n,'route-a','NPR','pending','2026-09-27T10:00+05:45','{"rechargeLevel":"LV0","rechargeCount":0}' from generate_series(1,30)n;`);
 const r=await call(q({platformId:ids.newar,startAt:'2026-09-27T00:00:00+05:45',endAt:'2026-09-28T00:00:00+05:45'}));
 assert.equal(metric(r).member_count,1);assert.equal(metric(r).new_members,1);assert.equal(metric(r,30,'CombinedPay').invalid_count,30);
});

test('L0 with prior recharges stays L0 but is never classified as never funded',async()=>{
 await db.exec("update ar_collected_orders set member_level='L0',recharge_count=2 where member_id='OLD'");
 const r=await call(q({operation:'members',level:'funded'}));assert.equal(r.rows[0].member_id,'OLD');assert.equal(r.rows[0].member_level,'L0');assert.equal(r.rows[0].recharge_count,2);
 const all=await call(q());assert.equal(metric(all).l0_members,2);assert.equal(metric(all).new_members,1);assert.equal(metric(all).funded_members,1);
 await db.exec("update ar_collected_orders set member_level='LV3',recharge_count=4 where member_id='OLD'");
});
test('short clock window keeps full-day eligibility but subtracts only submissions in that clock window',async()=>{
 const r=await call(q({startAt:'2026-09-27T11:00:00+05:30',endAt:'2026-09-27T12:00:00+05:30'}));assert.equal(metric(r).invalid_count,0);
});

test('LG and GAME66 qualify native member IDs using each local-day boundary',async()=>{
 await db.exec(`insert into lg_orders(source_system,country_code,platform,order_kind,member_id,third_party,created_at,status_class,order_no,metric_amount)
 select 'LG','PH','LG-RAW','recharge','LG-ZERO','route-a','2026-09-27T10:00+08','pending','LG-'||n,100 from generate_series(1,30)n;
 insert into game66_charge_orders(platform_id,order_num,uid,create_time,status_code,pay_method_name,amount_display)
 select '${ids.game}','G-ZERO-'||n,'G-ZERO','2026-09-27T10:00+05:30','0','route-a',100 from generate_series(1,30)n;`);
 for(const [id,zone] of [[ids.lg,'+08:00'],[ids.game,'+05:30']]){const result=await call(q({platformId:id,startAt:'2026-09-27T00:00:00'+zone,endAt:'2026-09-28T00:00:00'+zone}));assert.equal(metric(result).invalid_count,30);assert.equal(metric(result).unknown_members,1);}
});
test('currency is filtered after eligibility; a success in another currency still disqualifies the ID',async()=>{
 await db.exec(`insert into newar_detail_records(platform,dataset,source_id,member_id,order_number,provider,currency,status_group,created_at,raw)
 select 'NEW-RAW','charge','USD-'||n,'USD-MIX','USD-'||n,'OtherPay','USD','pending','2026-09-27T10:00+05:45','{}' from generate_series(1,30)n;`);
 const result=await call(q({platformId:ids.newar,startAt:'2026-09-27T00:00:00+05:45',endAt:'2026-09-28T00:00:00+05:45',currency:'NPR'}));assert.equal(metric(result).member_count,1);
});

const amountBands={charge:[10,20,30,50,100,200,500,1000,5000,10000,100000]};
test('risk chart totals reconcile and shared amount boundaries never overlap',async()=>{
 const r=await call(q({amountBands})),d=r.dashboard,total=d.monitoring.find(x=>x.provider===null);
 assert.equal(total.order_count,r.coverage.orderCount);assert.equal(total.invalid_count,metric(r).invalid_count);
 for(const key of ['hourly','amounts'])assert.equal(d[key].reduce((n,x)=>n+x.count,0),total.invalid_count);
 assert.equal(d.daily.reduce((n,x)=>n+x.invalid_count,0),total.invalid_count);
 assert.equal(d.amounts.find(x=>x.bucket==='band:4').count,121);assert.equal(d.amounts.length,1);
 assert.equal(d.frequency.filter(x=>['30–49','50–99','100+'].includes(x.band)).reduce((n,x)=>n+x.count,0),metric(r).member_days);
 assert.deepEqual(d.amountBands,amountBands);assert.ok(d.hourly.every(x=>x.hour===10));
 assert.doesNotMatch(JSON.stringify(d),/ZERO|UNKNOWN|OLD|CROSS-PAY/);
 const empty=await call(q({providers:['absent'],amountBands}));assert.equal(empty.dashboard.monitoring[0].order_count,0);assert.equal(empty.dashboard.amounts.length,0);
});
test('risk charts retain whole-day qualification while matching provider and time filters',async()=>{
 const r=await call(q({providers:['CombinedPay'],startAt:'2026-09-27T09:00:00+05:30',endAt:'2026-09-27T11:00:00+05:30',amountBands}));
 assert.equal(r.dashboard.monitoring.find(x=>x.provider===null).invalid_count,91);
 assert.ok(r.dashboard.hourly.every(x=>x.provider==='CombinedPay'));assert.equal(r.dashboard.daily.length,1);
 assert.equal(r.dashboard.monitoring.find(x=>x.provider==='CombinedPay').invalid_amount,'9100');
});
test('risk chart amounts honor decimal boundaries and the final inclusive maximum',async()=>{
 await db.exec("update ar_collected_orders set amount=case when order_no='ZERO-2026-09-27-1' then 99.99 when order_no='ZERO-2026-09-27-2' then 100000 when order_no='ZERO-2026-09-27-3' then 100000.01 when order_no='ZERO-2026-09-27-4' then null else amount end where member_id='ZERO'");
 const d=(await call(q({amountBands}))).dashboard;const value=b=>d.amounts.find(x=>x.bucket===b)?.count||0;
 assert.equal(value('band:3'),1);assert.equal(value('band:9'),1);assert.equal(value('above'),1);assert.equal(value('unknown'),1);assert.equal(value('band:4'),117);
 assert.equal(d.monitoring.find(x=>x.provider===null).invalid_amount,null);
 await db.exec("update ar_collected_orders set amount=100 where member_id='ZERO'");
});
test('invalid chart boundaries are rejected at the database authorization boundary',async()=>{
 for(const bands of [null,{}, {charge:[1,2]}, {charge:[10,20,20,50,100,200,500,1000,5000,10000,100000]}, {charge:[10,20,30,50,100,200,500,1000,5000,10000,'100000']}])await assert.rejects(call(q({amountBands:bands})),/invalid_amount_bands/);
});
test('provider summary skips charts and returns the identical exclusion metrics',async()=>{
 const full=await call(q()),lite=await call(q({charts:false}));assert.equal(lite.dashboard,null);assert.deepEqual(lite.metrics,full.metrics);assert.deepEqual(lite.coverage,full.coverage);
 for(const charts of [null,'false',0,{}])await assert.rejects(call(q({charts})),/invalid_charts/);
 const config=(await db.query("select proconfig from pg_proc where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure")).rows[0].proconfig;assert(config.includes('enable_nestloop=off'));
});
