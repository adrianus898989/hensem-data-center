// Synthetic PostgreSQL; no network or actual member identifiers are used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=n=>fs.readFileSync(path.join(__dirname,'source-sql',n),'utf8');
const migration=read('migrations/20260929170000_daily_submission_analysis.sql');
const authSql=read('admin-live-query.sql').match(/create function private\.dashboard_admin_live_scope\(\)[\s\S]*?\n\$\$;/)[0];
const schemas=read('synthetic-source-schema.sql');
const ids={ar:'00000000-0000-4000-8000-000000000001',lg:'00000000-0000-4000-8000-000000000002',newar:'00000000-0000-4000-8000-000000000003',game:'00000000-0000-4000-8000-000000000004',hidden:'00000000-0000-4000-8000-000000000005',kp:'00000000-0000-4000-8000-000000000006'};
const owner='10000000-0000-4000-8000-000000000001',viewer='10000000-0000-4000-8000-000000000002';
let db,productionAcls;
const request=(overrides={})=>({platformId:ids.ar,startAt:'2026-09-25T00:00:00+05:30',endAt:'2026-09-26T00:00:00+05:30',direction:'charge',...overrides});
const call=async(q=request())=>(await db.query('select public.dashboard_admin_live_submission_analysis($1::jsonb) data',[JSON.stringify(q)])).rows[0].data;
const as=uid=>db.query("select set_config('test.uid',$1,false)",[uid]);
const row=(result,date='2026-09-25',direction='charge')=>result.rows.find(r=>r.date===date&&r.direction===direction);
async function initializeSources(){
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
 return {db,as,call,request,ids,owner,viewer};
}


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
module.exports={initializeSources};
