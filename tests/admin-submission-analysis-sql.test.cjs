// Synthetic PostgreSQL; no network or actual member identifiers are used.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,'supabase',n),'utf8');
const migration=read('migrations/20260929170000_daily_submission_analysis.sql');
const authSql=read('admin-live-query.sql').match(/create function private\.dashboard_admin_live_scope\(\)[\s\S]*?\n\$\$;/)[0];
const schemas=fs.readFileSync(path.join(__dirname,'uploaded-order-sources.test.cjs'),'utf8').split('\n').filter(l=>/^ create table (game66_platforms|game66_charge_orders|game66_withdraw_orders|ar_config_targets|ar_collected_orders|newar_detail_platforms|newar_detail_records)\(/.test(l)).join('\n');
const ids={ar:'00000000-0000-4000-8000-000000000001',lg:'00000000-0000-4000-8000-000000000002',newar:'00000000-0000-4000-8000-000000000003',game:'00000000-0000-4000-8000-000000000004',hidden:'00000000-0000-4000-8000-000000000005',kp:'00000000-0000-4000-8000-000000000006'};
const owner='10000000-0000-4000-8000-000000000001',viewer='10000000-0000-4000-8000-000000000002';
let db,productionAcls;
const request=(overrides={})=>({platformId:ids.ar,startAt:'2026-09-25T00:00:00+05:30',endAt:'2026-09-26T00:00:00+05:30',direction:'charge',...overrides});
const call=async(q=request())=>(await db.query('select public.dashboard_admin_live_submission_analysis($1::jsonb) data',[JSON.stringify(q)])).rows[0].data;
const as=uid=>db.query("select set_config('test.uid',$1,false)",[uid]);
const row=(result,date='2026-09-25',direction='charge')=>result.rows.find(r=>r.date===date&&r.direction===direction);
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create schema auth;create role anon;create role authenticated;create role service_role;create role unexpected_caller;
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
 `);await db.exec(`alter table lg_orders add column order_no text,add column metric_amount numeric;alter table ar_collected_orders add column member_level text,add column recharge_count integer;alter table newar_detail_records add column raw jsonb default '{}';create function private.dashboard_admin_live_provider_canonical(country text,platform text,provider text) returns text language sql stable as $$select case when provider in ('route-a','route-b') then 'CombinedPay' else provider end$$;`);await db.exec(migration);await db.exec(read('migrations/20260928092956_admin_live_dynamic_amount_bands.sql').split('do $patch$')[0]+'commit;');await db.exec(read('migrations/20260929200000_submission_risk_dashboard.sql'));await db.exec(read('migrations/20260929210000_newar_charge_wait_status.sql'));await db.exec(read('migrations/20260929220000_submission_threshold_15.sql'));await db.exec(read('migrations/20260930110000_submission_member_day_amount.sql'));
 await db.exec('grant execute on function public.dashboard_admin_live_submission_analysis(jsonb) to service_role');
 productionAcls=(await db.query("select oid::regprocedure::text name,proacl::text acl from pg_proc where oid in ('private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure,'public.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure) order by name")).rows;
 await db.exec(read('migrations/20260930150000_submission_excess_after_15.sql'));await as(owner);await seed();
});
after(async()=>db?.close());


const q=(extra={})=>request({threshold:30,startAt:'2026-09-27T00:00:00+05:30',endAt:'2026-09-29T00:00:00+05:30',...extra});
const metric=(r,threshold=30,provider=null)=>r.metrics.find(x=>x.threshold===threshold&&x.provider===provider);
async function seed(){
 await db.exec(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,completed_at,raw_channel,member_level)
 select 'AR','IN','AR-RAW','recharge',member||'-'||day||'-'||n,member,100,'待支付',day::date+time '10:00'+n*interval '1 second',null,case when n%2=0 then 'route-a' else 'route-b' end,level
 from (values('ZERO','2026-09-27',30,'L0'),('ZERO','2026-09-28',30,'LV0'),('OLD','2026-09-27',31,'LV3'),('UNKNOWN','2026-09-27',30,null),('LOW','2026-09-27',29,'L0'),('SPLIT','2026-09-27',20,'L0'),('SPLIT','2026-09-28',20,'L0'),('CROSS-PAY','2026-09-27',30,'L0'),('LATER-PAY','2026-09-27',30,'L0')) v(member,day,total,level) cross join lateral generate_series(1,total) n;
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,completed_at,raw_channel,member_level) values
 ('AR','IN','AR-RAW','recharge','CROSS-PAID','CROSS-PAY',100,'已支付','2026-09-26 23:00','2026-09-27 08:00','OtherPay','L1'),
 ('AR','IN','AR-RAW','recharge','LATER-PAID','LATER-PAY',100,'已支付','2026-09-27 23:00','2026-09-28 08:00','OtherPay','L1');
 update ar_collected_orders set recharge_count=case when member_id='OLD' then 4 else 0 end where member_level is not null;`);
}
test('qualifies per local day across providers; 30 counts, 29 does not; repeated days do not duplicate IDs',async()=>{
 const r=await call(q());const m=metric(r);assert.equal(m.member_count,3);assert.equal(m.member_days,4);assert.equal(m.invalid_count,61);
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
 assert.equal(metric(r).member_count,3);assert.equal(metric(r).invalid_count,46);
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
 assert.equal(metric(r).member_count,1);assert.equal(metric(r).new_members,1);assert.equal(metric(r,30,'CombinedPay').invalid_count,15);
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
 for(const [id,zone] of [[ids.lg,'+08:00'],[ids.game,'+05:30']]){const result=await call(q({platformId:id,startAt:'2026-09-27T00:00:00'+zone,endAt:'2026-09-28T00:00:00'+zone}));assert.equal(metric(result).invalid_count,15);assert.equal(metric(result).unknown_members,1);}
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
 assert.equal(d.amounts.find(x=>x.bucket==='band:4').count,61);assert.equal(d.amounts.length,1);
 assert.equal(d.frequency.filter(x=>['30–49','50–99','100+'].includes(x.band)).reduce((n,x)=>n+x.count,0),metric(r).member_days);
 assert.deepEqual(d.amountBands,amountBands);assert.ok(d.hourly.every(x=>x.hour===10));
 assert.doesNotMatch(JSON.stringify(d),/ZERO|UNKNOWN|OLD|CROSS-PAY/);
 const empty=await call(q({providers:['absent'],amountBands}));assert.equal(empty.dashboard.monitoring[0].order_count,0);assert.equal(empty.dashboard.amounts.length,0);
});
test('risk charts retain whole-day qualification while matching provider and time filters',async()=>{
 const r=await call(q({providers:['CombinedPay'],startAt:'2026-09-27T09:00:00+05:30',endAt:'2026-09-27T11:00:00+05:30',amountBands}));
 assert.equal(r.dashboard.monitoring.find(x=>x.provider===null).invalid_count,46);
 assert.ok(r.dashboard.hourly.every(x=>x.provider==='CombinedPay'));assert.equal(r.dashboard.daily.length,1);
 assert.equal(r.dashboard.monitoring.find(x=>x.provider==='CombinedPay').invalid_amount,'4600');
});
test('risk chart amounts honor decimal boundaries and the final inclusive maximum',async()=>{
 await db.exec("update ar_collected_orders set amount=case when order_no='ZERO-2026-09-27-16' then 99.99 when order_no='ZERO-2026-09-27-17' then 100000 when order_no='ZERO-2026-09-27-18' then 100000.01 when order_no='ZERO-2026-09-27-19' then null else amount end where member_id='ZERO'");
 const d=(await call(q({amountBands}))).dashboard;const value=b=>d.amounts.find(x=>x.bucket===b)?.count||0;
 assert.equal(value('band:3'),1);assert.equal(value('band:9'),1);assert.equal(value('above'),1);assert.equal(value('unknown'),1);assert.equal(value('band:4'),57);
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

test('NEWAR Wait states retain IDs and contribute to daily exclusion metrics after storage normalization',async()=>{
 await db.exec(`insert into newar_detail_records(platform,dataset,source_id,member_id,order_number,provider,currency,status_code,status_group,created_at,raw)
 select 'NEW-RAW','charge','WAIT-'||n,'WAIT-MEMBER','WAIT-'||n,'route-a','NPR','Wait','unknown','2026-09-29T10:00+05:45','{"rechargeState":"Wait"}' from generate_series(1,30)n;`);
 const result=await call(request({platformId:ids.newar,startAt:'2026-09-29T00:00:00+05:45',endAt:'2026-09-30T00:00:00+05:45',currency:'NPR',charts:false}));
 assert.equal(result.coverage.unknownStatusCount,0);assert.equal(result.coverage.missingMemberCount,0);assert.equal(metric(result).member_count,1);assert.equal(metric(result).invalid_count,15);
});

test('first 15 submissions stay valid; different days and different platforms never share exemptions',async()=>{
 await db.exec(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel)
 select 'AR',country,'AR-RAW','recharge','EDGE-'||country||'-'||member||'-'||day||'-'||n,member,100,
 case when member='UNKNOWN15' and n=1 then 'unknown' else '待支付' end,day::date+time '10:00'+n*interval '1 second',case when n%2=0 then 'EdgePay B' else 'EdgePay A' end
 from (values('IN','BELOW14','2026-09-30',14),('IN','EXACT15','2026-09-30',15),('IN','ABOVE16','2026-09-30',16),
 ('IN','REPEAT15','2026-09-30',15),('IN','REPEAT15','2026-10-01',15),('IN','SPLITDAY','2026-09-30',8),('IN','SPLITDAY','2026-10-01',7),
 ('IN','SPLITPLATFORM','2026-09-30',8),('BR','SPLITPLATFORM','2026-09-30',7),('IN','PAID15','2026-09-30',15),('IN','UNKNOWN15','2026-09-30',15))v(country,member,day,total) cross join lateral generate_series(1,total)n;
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,completed_at,raw_channel)
 values('AR','IN','AR-RAW','recharge','EDGE-PAID','PAID15',100,'已支付','2026-09-29 23:00','2026-09-30 08:00','OtherPay');`);
 const rq=request({startAt:'2026-09-30T00:00:00+05:30',endAt:'2026-10-02T00:00:00+05:30',threshold:15});
 const r=await call(rq),m=metric(r,15);assert.equal(m.member_count,1);assert.equal(m.member_days,1);assert.equal(m.invalid_count,1);assert.equal(m.qualified_member_count,3);assert.equal(m.qualified_member_days,4);
 assert.equal(r.dashboard.threshold,15);assert.equal(r.dashboard.monitoring.find(x=>x.provider===null).invalid_count,1);
 for(const key of ['hourly','amounts'])assert.equal(r.dashboard[key].reduce((n,x)=>n+x.count,0),1);
 assert.equal(r.dashboard.daily.reduce((n,x)=>n+x.invalid_count,0),1);assert.equal(metric(r,30).invalid_count,0);
 const filtered=await call({...rq,providers:['EdgePay A'],charts:false});assert.equal(metric(filtered,15).member_count,0);assert.equal(metric(filtered,15).invalid_count,0);
 const details=await call({...rq,providers:['EdgePay B'],operation:'members'});assert.equal(details.members,1);assert.equal(details.total,1);assert.equal(details.rows[0].submitted_count,16);assert.equal(details.rows[0].selected_count,8);assert.equal(details.rows[0].invalid_count,1);assert.equal(details.rows[0].member_id,'ABOVE16');assert.equal((await call({...rq,providers:['EdgePay A'],operation:'members'})).total,0);
});

test('versioned excess basis defaults to 15 while explicit higher frequency thresholds remain available',async()=>{
 const defaults=await call({...q(),threshold:undefined}),fresh=await call(q({threshold:15})),higher=await call(q({threshold:30}));
 assert.equal(defaults.version,2);assert.equal(defaults.exemptCount,15);assert.equal(defaults.basis,'platform_local_day_all_providers_zero_success_after_first_15');assert.equal(defaults.dashboard.version,2);assert.equal(defaults.dashboard.exemptCount,15);
 assert.deepEqual(defaults.thresholds,[10,15,20,30,50,100]);assert.equal(defaults.dashboard.threshold,15);assert.deepEqual(defaults.metrics,fresh.metrics);assert.deepEqual(higher.metrics,fresh.metrics);
 assert.equal(metric(fresh,15).invalid_count,85);assert.equal(metric(fresh,15).member_count,5);assert.equal(metric(fresh,15).member_days,7);
 const lite=await call(q({threshold:15,charts:false}));assert.equal(lite.dashboard,null);assert.deepEqual(lite.metrics,fresh.metrics);
});

test('member daily totals and selected submissions remain distinct from only the excess amounts',async()=>{
 await db.exec(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel)
 select 'AR','IN','AR-RAW','recharge','AMOUNT-'||day||'-'||n,'AMOUNT-MEMBER',case when n=1 then 100 else n*10 end,'待支付',day::date+case when n=1 then time '10:00' else time '20:00' end+n*interval '1 second',case when n=1 then 'AmountPay A' else 'AmountPay B' end
 from (values('2026-10-03',49),('2026-10-04',15))v(day,total) cross join lateral generate_series(1,total)n;`);
 const scope=request({startAt:'2026-10-03T00:00:00+05:30',endAt:'2026-10-04T00:00:00+05:30',threshold:15,operation:'members',providers:['AmountPay B']});
 const narrow=(await call(scope)).rows[0];assert.equal(narrow.submitted_count,49);assert.equal(narrow.platform_day_amount,'12340');assert.equal(narrow.selected_count,48);assert.equal(narrow.submitted_amount,'12240');assert.equal(narrow.invalid_count,34);assert.equal(narrow.invalid_amount,'11050');assert.equal(narrow.platform_day_invalid_count,34);assert.equal(narrow.platform_day_invalid_amount,'11050');
 assert.equal((await call({...scope,providers:['AmountPay A']})).total,0,'the provider holding only an exempt order has no invalid member');
 const all=(await call({...scope,providers:[]})).rows[0];assert.equal(all.platform_day_amount,narrow.platform_day_amount);assert.equal(all.submitted_amount,'12340');assert.equal(all.selected_count,49);assert.equal(all.invalid_count,34);
 const days=(await call({...scope,endAt:'2026-10-05T00:00:00+05:30'})).rows;assert.equal(days.length,1,'an exact 15-order day contributes no invalid member or amount');
});

test('missing or mixed-currency excess amounts cannot be misrepresented as a full member-day total',async()=>{
 await db.exec(`insert into newar_detail_records(platform,dataset,source_id,member_id,order_number,provider,currency,amount,status_group,created_at)
 select 'NEW-RAW','charge',member||'-'||n,member,member||'-'||n,case when n=1 then 'AmountPay A' else 'AmountPay B' end,
 case when member='MIXED-CURRENCY' and n=16 then 'USD' else 'NPR' end,
 case when member='MISSING-AMOUNT' and n=16 then null else 100 end,'pending','2026-10-03T10:00+05:45'::timestamptz+n*interval '1 second'
 from (values('MIXED-CURRENCY'),('MISSING-AMOUNT'))v(member) cross join generate_series(1,17)n;`);
 const scope=request({platformId:ids.newar,startAt:'2026-10-03T00:00:00+05:45',endAt:'2026-10-04T00:00:00+05:45',currency:'NPR',threshold:15,operation:'members'});
 const rows=(await call({...scope,providers:['AmountPay B']})).rows;assert.equal(rows.length,2);for(const row of rows){assert.equal(row.submitted_count,17);assert.equal(row.platform_day_amount,null);assert.equal(row.platform_day_invalid_amount,null);assert.equal(row.platform_day_invalid_count,2)}
 const missing=rows.find(x=>x.member_id==='MISSING-AMOUNT');assert.equal(missing.submitted_amount,null);assert.equal(missing.invalid_amount,null);assert.equal(missing.invalid_count,2);
 const mixed=rows.find(x=>x.member_id==='MIXED-CURRENCY');assert.equal(mixed.invalid_count,1);assert.equal(mixed.invalid_amount,'100');
});

test('49 submissions exempt the first 15 across providers and charge only the later actual provider amounts',async()=>{
 await db.exec(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel)
 select 'AR','IN','AR-RAW','recharge','CHRONO-'||lpad(n::text,3,'0'),'CHRONO',n*100,'待支付','2026-10-06 10:00'::timestamp+n*interval '1 second',
 case when n<=10 then 'FirstPay' when n<=20 then 'MiddlePay' else 'LastPay' end from generate_series(1,49)n order by n desc;`);
 const scope=request({startAt:'2026-10-06T00:00:00+05:30',endAt:'2026-10-07T00:00:00+05:30',threshold:15});
 const r=await call(scope),total=metric(r,15);assert.equal(total.invalid_count,34);assert.equal(total.invalid_amount,'110500');assert.equal(total.member_count,1);assert.equal(metric(r,15,'FirstPay').invalid_count,0);assert.equal(metric(r,15,'FirstPay').member_count,0);assert.equal(metric(r,15,'FirstPay').qualified_member_count,1);
 assert.equal(metric(r,15,'MiddlePay').invalid_count,5);assert.equal(metric(r,15,'MiddlePay').invalid_amount,'9000');assert.equal(metric(r,15,'LastPay').invalid_count,29);assert.equal(metric(r,15,'LastPay').invalid_amount,'101500');
 const late=await call({...scope,startAt:'2026-10-06T10:00:30+05:30',endAt:'2026-10-06T10:00:40+05:30',providers:['LastPay']});assert.equal(metric(late,15).invalid_count,10);assert.equal(metric(late,15).invalid_amount,'34500');
 const detail=(await call({...scope,providers:['MiddlePay'],operation:'members'})).rows[0];assert.equal(detail.submitted_count,49);assert.equal(detail.selected_count,10);assert.equal(detail.submitted_amount,'15500');assert.equal(detail.invalid_count,5);assert.equal(detail.invalid_amount,'9000');assert.equal(detail.platform_day_invalid_count,34);assert.equal(detail.platform_day_invalid_amount,'110500');
 assert.equal(r.dashboard.monitoring.filter(x=>x.provider!==null).reduce((n,x)=>n+x.invalid_count,0),34);assert.equal(r.dashboard.hourly.reduce((n,x)=>n+x.count,0),34);
});

test('same-time submissions use a stable order identifier before provider filters rather than source insertion order',async()=>{
 await db.exec(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel)
 select 'AR','IN','AR-RAW','recharge','TIE-'||lpad(n::text,3,'0'),'TIE',n*10,'待支付','2026-10-07 10:00',case when n<=15 then 'TieFirst' else 'TieLast' end from generate_series(1,16)n order by n desc;`);
 const scope=request({startAt:'2026-10-07T00:00:00+05:30',endAt:'2026-10-08T00:00:00+05:30',threshold:15});
 assert.equal(metric(await call({...scope,providers:['TieFirst']}),15).invalid_count,0);const r=await call({...scope,providers:['TieLast']});assert.equal(metric(r,15).invalid_count,1);assert.equal(metric(r,15).invalid_amount,'160');assert.equal(r.coverage.orderSequenceUncertainCount,0);
});

test('unknown time or missing and duplicate order identifiers fail closed only for affected members',async()=>{
 await db.exec(`insert into lg_orders(source_system,country_code,platform,order_kind,member_id,third_party,created_at,status_class,order_no,metric_amount)
 select 'LG','PH','LG-RAW','recharge',member,'KnownPay','2026-10-08T10:00+08'::timestamptz+n*interval '1 second','pending',
 case when member='MISSING-ID' and n=1 then null when member='DUP-ID' and n in (1,2) then 'DUPLICATE' else member||'-'||n end,100
 from (values('GOOD'),('UNKNOWN-TIME'),('MISSING-ID'),('DUP-ID'))v(member) cross join generate_series(1,16)n;
 insert into lg_orders(source_system,country_code,platform,order_kind,member_id,third_party,created_at,status_class,order_no,metric_amount)
 values('LG','PH','LG-RAW','recharge','UNKNOWN-TIME','AnotherProvider',null,'pending','UNDATED',100);`);
 const scope=request({platformId:ids.lg,startAt:'2026-10-08T00:00:00+08:00',endAt:'2026-10-09T00:00:00+08:00',threshold:15,providers:['KnownPay']});
 const r=await call(scope);assert.equal(r.coverage.orderCount,64);assert.equal(r.coverage.orderSequenceUncertainCount,48);assert.equal(metric(r,15).member_count,1);assert.equal(metric(r,15).invalid_count,1);assert.equal(metric(r,15).invalid_amount,'100');
 const d=await call({...scope,operation:'members'});assert.equal(d.rows.length,1);assert.equal(d.rows[0].member_id,'GOOD');
 const unaffected=await call(request({startAt:'2026-10-07T00:00:00+05:30',endAt:'2026-10-08T00:00:00+05:30',threshold:15}));assert.equal(unaffected.coverage.orderSequenceUncertainCount,0);assert.equal(metric(unaffected,15).invalid_count,1);
});

test('an exempt order with an unknown amount does not erase the known excess amount',async()=>{
 await db.exec(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel)
 select 'AR','IN','AR-RAW','recharge','EXEMPT-NULL-'||n,'EXEMPT-NULL',case when n=1 then null else n end,'待支付','2026-10-09 10:00'::timestamp+n*interval '1 second','KnownPay' from generate_series(1,16)n;`);
 const scope=request({startAt:'2026-10-09T00:00:00+05:30',endAt:'2026-10-10T00:00:00+05:30',threshold:15});
 const r=await call(scope);assert.equal(metric(r,15).invalid_count,1);assert.equal(metric(r,15).invalid_amount,'16');const d=(await call({...scope,operation:'members'})).rows[0];assert.equal(d.platform_day_amount,null);assert.equal(d.submitted_amount,null);assert.equal(d.platform_day_invalid_amount,'16');assert.equal(d.invalid_amount,'16');
});

test('unknown status in another provider remains visible for the selected member-day without counting known affected orders',async()=>{
 await db.exec(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel)
 select 'AR','IN','AR-RAW','recharge','STATUS-CROSS-'||n,'STATUS-CROSS',100,'待支付','2026-10-20 10:00'::timestamp+n*interval '1 second','SelectedPay' from generate_series(1,16)n;
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel)
 values('AR','IN','AR-RAW','recharge','STATUS-CROSS-UNKNOWN','STATUS-CROSS',100,'unknown','2026-10-20 20:00','OtherPay');`);
 const scope=request({startAt:'2026-10-20T00:00:00+05:30',endAt:'2026-10-21T00:00:00+05:30',threshold:15,providers:['SelectedPay']});
 const r=await call(scope);assert.equal(r.coverage.orderCount,16);assert.equal(r.coverage.unknownStatusCount,1);assert.equal(metric(r,15).invalid_count,0);assert.equal(metric(r,15).member_count,0);
 const narrowed=await call({...scope,startAt:'2026-10-20T09:00:00+05:30',endAt:'2026-10-20T11:00:00+05:30'});assert.equal(narrowed.coverage.unknownStatusCount,1,'same-day unknown outside the selected clock window still blocks zero-success certainty');
 const all=await call({...scope,providers:[]});assert.equal(all.coverage.orderCount,17);assert.equal(all.coverage.unknownStatusCount,1,'the same actual unknown row is not double counted');
 const lite=await call({...scope,charts:false});assert.deepEqual(lite.coverage,r.coverage);assert.equal((await call({...scope,operation:'members'})).total,0);
});

test('unknown status in an unrelated member-day does not taint the selected member-day',async()=>{
 await db.exec(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel)
 select 'AR','IN','AR-RAW','recharge','STATUS-CLEAR-'||n,'STATUS-CLEAR',100,'待支付','2026-10-21 10:00'::timestamp+n*interval '1 second','SelectedPay' from generate_series(1,16)n;
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel) values
 ('AR','IN','AR-RAW','recharge','STATUS-OTHER-MEMBER','STATUS-UNRELATED',100,'unknown','2026-10-21 20:00','OtherPay'),
 ('AR','IN','AR-RAW','recharge','STATUS-OTHER-DAY','STATUS-CLEAR',100,'unknown','2026-10-22 20:00','OtherPay');`);
 const scope=request({startAt:'2026-10-21T00:00:00+05:30',endAt:'2026-10-23T00:00:00+05:30',threshold:15,providers:['SelectedPay']});
 const r=await call(scope);assert.equal(r.coverage.orderCount,16);assert.equal(r.coverage.unknownStatusCount,0);assert.equal(metric(r,15).invalid_count,1);assert.equal(metric(r,15).invalid_amount,'100');
 assert.equal((await call({...scope,operation:'members'})).rows[0].member_id,'STATUS-CLEAR');
 const empty=await call({...scope,providers:['AbsentPay']});assert.equal(empty.coverage.orderCount,0);assert.equal(empty.coverage.unknownStatusCount,0);
});

test('selected unknown rows lacking member IDs remain covered without counting unrelated unidentifiable rows',async()=>{
 await db.exec(`insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,member_id,amount,status,applied_at,raw_channel) values
 ('AR','IN','AR-RAW','recharge','STATUS-NO-ID-SELECTED',null,100,'unknown','2026-10-23 10:00','SelectedPay'),
 ('AR','IN','AR-RAW','recharge','STATUS-NO-ID-OTHER',null,100,'unknown','2026-10-23 10:01','OtherPay');`);
 const r=await call(request({startAt:'2026-10-23T00:00:00+05:30',endAt:'2026-10-24T00:00:00+05:30',providers:['SelectedPay']}));
 assert.equal(r.coverage.orderCount,1);assert.equal(r.coverage.missingMemberCount,1);assert.equal(r.coverage.unknownStatusCount,1);
});

test('migration replays only its exact reviewed body and rejects definition or execute-ACL drift',async()=>{
 const migration=read('migrations/20260930150000_submission_excess_after_15.sql');await db.exec(migration);
 const original=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure) def")).rows[0].def;
 await db.exec(original.replace('perform private.dashboard_admin_live_scope();','perform private.dashboard_admin_live_scope(); -- synthetic drift'));
 await assert.rejects(db.exec(migration),/submission_excess_definition_drift/);await db.exec('rollback;');await db.exec(original);
 await db.exec('grant execute on function private.dashboard_admin_live_submission_analysis(jsonb) to anon');
 await assert.rejects(db.exec(migration),/submission_excess_acl_drift/);await db.exec('rollback;');await db.exec('revoke execute on function private.dashboard_admin_live_submission_analysis(jsonb) from anon');
 await db.exec('alter function private.dashboard_admin_live_submission_analysis(jsonb) set statement_timeout=1000');
 await assert.rejects(db.exec(migration),/submission_excess_definition_drift/);await db.exec('rollback;');await db.exec(original);
 await db.exec(migration);const r=await call(q({threshold:15}));assert.equal(r.version,2);assert.equal(metric(r,15).invalid_count,85);
});


test('reviewed production service_role grant is preserved only on the public wrapper',async()=>{
 const migration=read('migrations/20260930150000_submission_excess_after_15.sql');
 const acls=async()=>(await db.query("select oid::regprocedure::text name,proacl::text acl from pg_proc where oid in ('private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure,'public.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure) order by name")).rows;
 assert.deepEqual(await acls(),productionAcls,'initial predecessor migration preserves exact production-shaped ACLs');
 await db.exec(migration);assert.deepEqual(await acls(),productionAcls,'exact-body replay retains both ACLs');
 for(const [schema,role,grantable] of [['private','service_role',false],['private','PUBLIC',false],['public','PUBLIC',false],['public','anon',false],['public','unexpected_caller',false],['private','authenticated',true],['public','authenticated',true],['public','service_role',true]]){
  const f=schema+'.dashboard_admin_live_submission_analysis(jsonb)';
  await db.exec('grant execute on function '+f+' to '+role+(grantable?' with grant option':''));
  await assert.rejects(db.exec(migration),/submission_excess_acl_drift/,schema+' '+role+(grantable?' grant option':''));await db.exec('rollback');
  await db.exec((grantable?'revoke grant option for execute':'revoke execute')+' on function '+f+' from '+role);
  assert.deepEqual(await acls(),productionAcls);
 }
 await db.exec('revoke execute on function public.dashboard_admin_live_submission_analysis(jsonb) from service_role');
 const withoutService=await acls();await db.exec(migration);assert.deepEqual(await acls(),withoutService,'migration never introduces service_role where absent');
 await db.exec('grant execute on function public.dashboard_admin_live_submission_analysis(jsonb) to service_role');assert.deepEqual(await acls(),productionAcls);
});
