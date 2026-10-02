// Synthetic fixtures only; all paths are repository-relative for Linux CI.
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20261002105434_wg_provider_options_index_walk.sql');
const baseline=read('tests/fixtures/wg-provider-options-baseline.sql');
const ids={wg:'10000000-0000-0000-0000-000000000001',other:'10000000-0000-0000-0000-000000000002',br:'10000000-0000-0000-0000-000000000003',ar:'10000000-0000-0000-0000-000000000004',lg:'10000000-0000-0000-0000-000000000005'};
async function setup(){
 const db=new PGlite();
 await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
 create table private.test_platforms(id uuid,source text,country text,name text,source_name text,scope_group text);
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin
  if current_setting('test.denied',true)='yes' then raise exception 'access_denied' using errcode='42501';end if;
  return jsonb_build_object('platform',current_setting('test.platform',true));end$$;
 create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql stable as $$
  select coalesce(nullif(s->>'platform','') is null or s->>'platform'=p,false)$$;
 create function private.dashboard_admin_live_platforms() returns setof private.test_platforms language sql stable as $$
  select p.* from private.test_platforms p where private.dashboard_scope_allows(private.dashboard_admin_live_scope(),p.country,p.name)$$;
 create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[],directions text[]);
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text);
 create function private.dashboard_admin_live_provider_alias(c text,n text) returns text language sql immutable as $$select n$$;
 create function private.dashboard_admin_live_provider_alias_values(c text,n text[]) returns text[] language sql immutable as $$select n$$;
 create function private.dashboard_admin_live_confirmed_usdt_provider(c text,n text) returns text language sql immutable as $$select null::text$$;
 create function private.dashboard_admin_live_provider_canonical(c text,p text,n text) returns text language sql stable as $$
  select coalesce((select o.canonical_provider from private.dashboard_admin_provider_overrides o where o.country=c and o.platform=p and o.raw_provider=n),
   case when c='越南' and n in ('YesPay(VND)','YesPay(VND)(已删除:731329)') then 'YesPay' else n end)$$;
 create table public.lg_success_daily(country_code text,platform text,scope_type text,order_kind text,third_party text,raw_channel text);
 create table public.wg_recharge_details(site_code text,provider text,country text,platform text);
 create table public.wg_withdraw_details(like public.wg_recharge_details);
 alter table public.wg_recharge_details enable row level security;
 alter table public.wg_withdraw_details enable row level security;
 create index wg_recharge_site_provider on public.wg_recharge_details(site_code,provider);
 create index wg_withdraw_site_provider on public.wg_withdraw_details(site_code,provider);
 CREATE OR REPLACE FUNCTION private.dashboard_admin_wg_sites()
 RETURNS TABLE(site_code text, country_code text, country text, platform text, timezone text, currency text)
 LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
 values ('278','BR','巴西','26BET','America/Sao_Paulo','BRL'),
 ('8311','BR','巴西','POPKKK','America/Sao_Paulo','BRL'),
 ('12588','BR','巴西','POPMIU','America/Sao_Paulo','BRL'),
 ('3257','VN','越南','98VV','Asia/Ho_Chi_Minh','VND'),
 ('3605','VN','越南','XX98','Asia/Ho_Chi_Minh','VND');
$function$;
 revoke all on function private.dashboard_admin_wg_sites() from public,anon,authenticated,service_role;
 grant usage on schema private to anon,authenticated,service_role;
 `);
 await db.exec(baseline);
 await db.exec(`revoke all on function private.dashboard_admin_live_provider_options(jsonb) from public,anon,authenticated,service_role;
 grant execute on function private.dashboard_admin_live_provider_options(jsonb) to authenticated;`);
 for(const [id,source,country,name,scope]of [[ids.wg,'wg','越南','98VV','VN'],[ids.other,'wg','越南','XX98','VN'],[ids.br,'wg','巴西','26BET','BR'],[ids.ar,'ar','印度','ARTEST','IN'],[ids.lg,'lg','菲律宾','LGTEST','PH']])
  await db.query('insert into private.test_platforms values($1,$2,$3,$4,$4,$5)',[id,source,country,name,scope]);
 const names=['YesPay(VND)','YesPay(VND)(已删除:731329)','Unregistered-Z',null,'','  ',' 中文通道 ','ÄPay','áPay','A','a','\u00a0','東京Pay','😀Pay'];
 for(const name of names)await db.query("insert into public.wg_recharge_details values('3257',$1,null,null)",[name]);
 await db.exec(`insert into public.wg_recharge_details values('3257','LegacyFieldMismatch','OLD','OLD'),('3605','SecondSiteOnly','VN','XX98'),('278','BrazilOnly','BR','26BET'),('forged-site','Unauthorized','VN','98VV');
 insert into public.wg_withdraw_details values('3257','WithdrawOnly','VN','98VV'),('3257',null,'VN','98VV'),('3605','SecondWithdraw','VN','XX98');
 insert into private.dashboard_admin_provider_registry values('印度','ARTEST','ARRaw',array['ARCanonical'],array['代收']);
 insert into public.lg_success_daily values('PH','LGTEST','channel','withdraw',null,'LGRaw');
 insert into private.dashboard_admin_provider_overrides values('越南','98VV','Unregistered-Z','ManualOverride');
 `);
 return db;
}
const options=async(db,platformIds=Object.values(ids),direction='all')=>(await db.query('select private.dashboard_admin_live_provider_options($1::jsonb) result',[JSON.stringify({platformIds,direction})])).rows[0].result;
const names=async(db,c,p,d)=>(await db.query('select provider from private.dashboard_admin_wg_provider_names($1,$2,$3) order by provider',[c,p,d])).rows.map(x=>x.provider);
module.exports={setup,options,names,ids,migration,baseline};
