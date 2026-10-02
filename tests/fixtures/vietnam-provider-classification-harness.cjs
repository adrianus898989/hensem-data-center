// Offline synthetic rows; safe production definitions, exact native schema, no live claims.
const fs=require('node:fs'),path=require('node:path'),{PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8');
const fn=(s,name)=>{const low=s.toLowerCase(),a=['create function private.','create or replace function private.'].map(p=>low.indexOf(p+name+'(')).filter(n=>n>=0),rest=s.slice(Math.min(...a)),tag=rest.match(/as\s+([$][a-z_]*[$])/i)[1];return rest.slice(0,rest.indexOf(tag+';',rest.indexOf(tag)+tag.length)+tag.length+1);};
const migration=read('supabase/migrations/20261002115942_vietnam_confirmed_provider_business_class.sql');
const ids={wg:'10000000-0000-0000-0000-000000000001',xx:'10000000-0000-0000-0000-000000000002',ar:'10000000-0000-0000-0000-000000000003',foreign:'10000000-0000-0000-0000-000000000004'};
async function setup(){
 const db=new PGlite();await db.exec([
 "create schema private;create role anon;create role authenticated;create role service_role;grant usage on schema private to anon,authenticated,service_role;",
 "create table private.test_platforms(id uuid,name text,country text,scope_group text,source text,source_name text);",
 "create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin if current_setting('test.denied',true)='yes' then raise exception 'access_denied' using errcode='42501';end if;return jsonb_build_object('platform',current_setting('test.platform',true));end$$;",
 "create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql stable as $$select coalesce(nullif(s->>'platform','') is null or s->>'platform'=p,false)$$;",
 "create function private.dashboard_admin_live_platforms() returns setof private.test_platforms language sql stable as $$select p.* from private.test_platforms p where private.dashboard_scope_allows(private.dashboard_admin_live_scope(),p.country,p.name)$$;",
 "create function private.dashboard_data_group(c text,p text) returns text language sql immutable as $$select case c when '越南' then 'VN' else c end$$;",
 "create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[],directions text[],charge_count bigint,withdraw_count bigint,matched_count bigint,last_data_date date,updated_at timestamptz,primary key(country,platform,raw_provider));",
 "create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text,version bigint default 1,updated_at timestamptz default now(),primary key(country,platform,raw_provider));",
 "create table public.lg_success_daily(country_code text,platform text,scope_type text,order_kind text,third_party text,raw_channel text);",
 "create table public.third_party_rates(id text primary key,country text,category text,third_party text,updated_at timestamptz);"
 ].join('\n'));
 await db.exec(read('tests/fixtures/wg-exact-provider-aliases/native-order-schema.sql'));
 await db.exec(read('tests/fixtures/wg-exact-provider-aliases/runtime-alias-and-wrapper.sql').split('CREATE OR REPLACE FUNCTION private.dashboard_admin_live_payout_config')[0]);
 await db.exec(fn(read('tests/fixtures/wg-exact-provider-aliases/baseline-functions.sql'),'dashboard_admin_wg_sites'));
 await db.exec(fn(read('supabase/migrations/20261002100001_wg_exact_provider_aliases.sql'),'dashboard_admin_wg_provider_aliases'));
 await db.exec(fn(read('supabase/migrations/20261002105434_wg_provider_options_index_walk.sql'),'dashboard_admin_wg_provider_names'));
 const fee=read('supabase/migrations/20261002080803_immutable_fee_effective_versions.sql');await db.exec(fee.slice(fee.indexOf('create table private.fee_rate_generations'),fee.indexOf('create function private.fee_rate_immutable')));
 await db.exec(read('tests/fixtures/vietnam-provider-classification-baseline.sql'));
 await db.exec(fn(read('supabase/migrations/20261002095221_fee_channel_category_overloads.sql'),'dashboard_admin_fee_category'));
 await db.exec("revoke all on function private.dashboard_admin_wg_sites(),private.dashboard_admin_wg_provider_aliases(),private.dashboard_admin_wg_provider_names(text,text,text) from public,anon,authenticated,service_role;");
 for(const [id,name,source,scope,country]of [[ids.wg,'98VV','wg','VN','越南'],[ids.xx,'XX98','wg','VN','越南'],[ids.ar,'92LOTTERY','ar','VN','越南'],[ids.foreign,'OTHER','ar','VN','越南']])await db.query('insert into private.test_platforms values($1,$2,$3,$4,$5,$2)',[id,name,country,scope,source]);
 for(const platform of ['66CLUB','82VN','92LOTTERY','VN168','OTHER'])await db.query("insert into private.dashboard_admin_provider_registry values('越南',$1,'Tron-USDT',array['USDT'],array['代收'],3,0,3,'2026-10-01','2026-10-02Z')",[platform]);
 await db.exec("alter table private.test_platforms add timezone text,add currency text;update private.test_platforms set timezone='Asia/Ho_Chi_Minh',currency='VND';");
 await db.exec("create table public.ar_config_targets(source_system text,country_code text,platform text,currency text);create table public.ar_collected_orders(source_system text,country_code text,platform text,order_kind text,order_no text,member_id text,raw_channel text,channel_type text,status text,amount numeric,amount_text text,applied_at timestamp,completed_at timestamp,updated_at timestamptz);");
 await db.exec("insert into private.dashboard_admin_provider_registry values('越南','98VV','',array['未识别通道'],array['代收'],10,0,10,'2026-10-01','2026-10-02Z');");
 for(const [site,platform,n]of [['3257','98VV',10],['3605','XX98',3]])await db.query("insert into public.wg_recharge_details(country,platform,site_code,business,order_number,provider,channel,status_code,status_group,created_at,success_at,member_currency,member_amount) select 'VN',$1,$2,'recharge','SYNTHETIC-'||$1||'-'||i,null,'提现转充值',2,'success','2026-10-01T12:00Z','2026-10-01T12:01Z','VND',100 from generate_series(1,$3::integer) i",[platform,site,n]);
 return db;
}
const scalar=(db,q,args=[])=>db.query(q,args).then(r=>Object.values(r.rows[0])[0]);
const canon=(db,c,p,r)=>scalar(db,'select private.dashboard_admin_live_provider_canonical($1,$2,$3)',[c,p,r]);
const source=async(db,{platform='98VV',direction='charge',status='success',action='details'}={})=>{
 const s=await scalar(db,'select private.dashboard_admin_wg_order_source(null,false)');
 const args={3:"'VN'::text",5:"'2026-09-30T17:00Z'::timestamptz",6:"'2026-10-01T17:00Z'::timestamptz",7:"'"+direction+"'::text",8:"'"+status+"'::text",9:'NULL::text',10:'NULL::text',19:"'"+action+"'::text",22:"'"+platform+"'::text",23:'NULL::text'};
 return s.replace(/\$(\d+)/g,(_,n)=>args[n]);
};
module.exports={setup,scalar,canon,source,ids,migration};
