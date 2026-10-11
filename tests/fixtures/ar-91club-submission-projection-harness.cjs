const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const here=__dirname,repo=path.resolve(here,'../..'),read=f=>fs.readFileSync(path.join(repo,f),'utf8');
const sourceDDL=`create table public.ar_collected_orders(
 source_system text not null,country_code text not null,platform text not null,order_kind text not null,
 order_no text not null,member_id text,status text,raw_channel text,
 applied_at timestamp,completed_at timestamp,member_level integer,recharge_count integer,
 channel_type text,money_format_version smallint,amount_local numeric,currency_local text,money_issue_code text,amount numeric(20,2),
 constraint ar_collected_orders_order_no_check check(length(order_no)>=1 and length(order_no)<=160),
 constraint ar_collected_orders_member_id_check check(length(member_id)>=1 and length(member_id)<=80),
 constraint ar_collected_orders_status_check check(length(status)<=160),
 constraint ar_collected_orders_raw_channel_check check(length(raw_channel)<=240),
 constraint ar_collected_orders_pkey primary key(source_system,country_code,platform,order_kind,order_no));
 alter table public.ar_collected_orders enable row level security;
 revoke all on public.ar_collected_orders from public,anon,authenticated;
 grant all on public.ar_collected_orders to service_role;`;
const local=sql=>{assert.equal(sql.split('/10000<>17').length,2);return sql.replace('/10000<>17','/10000<>18')};
async function fixture(){const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema private;set check_function_bodies=off;');
 await db.exec(sourceDDL);await db.exec('alter table ar_collected_orders add observed_at timestamptz;alter table ar_collected_orders add raw_payload jsonb;');
 await db.exec(read('tests/fixtures/ar-submission-native-null-amount-helper.sql'));await db.exec(read('tests/fixtures/ar-submission-native-null-production.sql'));
 await db.exec(`revoke all on function private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric) from public,anon,authenticated,service_role;
 revoke all on function private.dashboard_admin_live_submission_analysis(jsonb) from public,anon,service_role;grant execute on function private.dashboard_admin_live_submission_analysis(jsonb) to authenticated;`);
 await db.exec(read('supabase/migrations/20261011065859_ar_submission_native_null_members.sql'));await db.exec('set check_function_bodies=on;');
 await db.exec(`create index ar_91club_recharge_applied_cover_idx on ar_collected_orders(applied_at)include(order_no,member_id,status,raw_channel,member_level,recharge_count)where source_system='AR'and country_code='IN'and platform='91CLUB'and order_kind='recharge';
 create index ar_91club_recharge_paid_cover_idx on ar_collected_orders(completed_at)include(member_id)where source_system='AR'and country_code='IN'and platform='91CLUB'and order_kind='recharge'and status='已支付';`);
 return db;}
async function row(db,id,patch={}){const v={source_system:'AR',country_code:'IN',platform:'91CLUB',order_kind:'recharge',order_no:id,applied_at:'2026-10-10 10:00:00',completed_at:null,member_id:'MEMBER',status:'待支付',raw_channel:'Native Pay',member_level:0,recharge_count:0,channel_type:'INR',money_format_version:1,amount_local:'123.45678900',currency_local:'INR',money_issue_code:null,amount:'12.00',observed_at:'2026-10-11T12:00:00Z',raw_payload:{synthetic:true},...patch};const ns=Object.keys(v);await db.query(`insert into ar_collected_orders(${ns.join(',')})values(${ns.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(v));}
const metadata=async db=>(await db.query("select md5(prosrc) hash,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure")).rows[0];
const stage1=()=>read('supabase/migrations/20261011121607_ar_91club_submission_narrow_facts.sql'),stage2=()=>read('supabase/migrations/20261011124227_ar_91club_submission_fact_readiness.sql');
const columns=["source_system","country_code","platform","order_kind","order_no","applied_at","completed_at","member_id","status","raw_channel","member_level","recharge_count","channel_type","money_format_version","amount_local","currency_local","money_issue_code","amount"];
module.exports={here,repo,read,local,fixture,row,metadata,sourceDDL,stage1,stage2,columns};
