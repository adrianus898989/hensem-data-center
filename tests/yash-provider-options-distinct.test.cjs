// Real providerOptions body; only synthetic data and offline authorization fixtures.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const migration=read('supabase/migrations/20261009111906_yash_provider_options_distinct_names.sql');
const previous=read('supabase/migrations/20261009044023_yash_live_readers.sql');
let baseline=JSON.parse(read('tests/fixtures/yash-reader-production-functions.json')).find(x=>x.signature==='private.dashboard_admin_live_provider_options(jsonb)').definition;
// Reconstruct the deployed YASH addition verbatim; the migration checks its real MD5.
const addition=previous.match(/\$new\$(\n    union\n    select private\.dashboard_admin_live_provider_canonical\(p\.country,p\.source_name,private\.dashboard_admin_yash_provider[\s\S]*?select jsonb_build_object\('providers')\$new\$/)[1];
baseline=baseline.replace("p.source not in('lg','wg','duoli')","p.source not in('lg','wg','duoli','kb')")
 .replace("  )\n  select jsonb_build_object('providers'",addition);
const ids={yash:'10000000-0000-0000-0000-000000000001',ar:'10000000-0000-0000-0000-000000000002',wg:'10000000-0000-0000-0000-000000000003',lg:'10000000-0000-0000-0000-000000000004',duoli:'10000000-0000-0000-0000-000000000005',wrongCountry:'10000000-0000-0000-0000-000000000006',wrongSite:'10000000-0000-0000-0000-000000000007'};
const request=(platformIds=[ids.yash],direction='all')=>({platformIds,direction});
const options=async(d,r=request())=>(await d.query('select private.dashboard_admin_live_provider_options($1::jsonb) result',[JSON.stringify(r)])).rows[0].result;
const meta=async d=>(await d.query("select to_jsonb(p)-'prosrc' m from pg_proc p where p.oid='private.dashboard_admin_live_provider_options(jsonb)'::regprocedure")).rows[0].m;
const resetCalls=d=>d.exec("select setval('private.test_canonical_calls',1,false)");
const calls=async d=>(await d.query('select case when is_called then last_value else 0 end n from private.test_canonical_calls')).rows[0].n;
let db,answers,beforeMeta;
async function setup(){
 const d=new PGlite();
 await d.exec(`create schema private;create role anon;create role authenticated;create role service_role;
 create table private.test_platforms(id uuid,source text,country text,name text,source_name text,scope_group text);
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin
  if current_setting('test.denied',true)='yes' then raise exception 'access_denied' using errcode='42501';end if;
  return jsonb_build_object('platform',current_setting('test.platform',true));end$$;
 create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql stable as $$select coalesce(nullif(s->>'platform','') is null or s->>'platform'=p,false)$$;
 create function private.dashboard_admin_live_platforms() returns setof private.test_platforms language sql stable as $$select p.* from private.test_platforms p where private.dashboard_scope_allows(private.dashboard_admin_live_scope(),p.country,p.name)$$;
 create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[],directions text[]);
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text);
 create function private.dashboard_admin_live_provider_alias(text,text) returns text language sql immutable as $$select $2$$;
 create function private.dashboard_admin_live_provider_alias_values(text,text[]) returns text[] language sql immutable as $$select $2$$;
 create function private.dashboard_admin_live_confirmed_provider(text,text,text) returns text language sql immutable as $$select null::text$$;
 create sequence private.test_canonical_calls;
 create function private.dashboard_admin_live_provider_canonical(c text,p text,n text) returns text language plpgsql stable as $$begin
  perform nextval('private.test_canonical_calls');
  return coalesce((select canonical_provider from private.dashboard_admin_provider_overrides where country=c and platform=p and raw_provider=n),case when n in('Alias-A','Alias-B') then 'Merged' else n end);end$$;
 create function private.dashboard_admin_yash_provider(text) returns text language sql immutable set search_path='' as $$select coalesce(nullif(btrim($1),''),'未识别通道')$$;
 create table private.yash_orders(source_site text,order_type text,supplier text);
 alter table private.yash_orders enable row level security;
 create table public.lg_success_daily(country_code text,platform text,scope_type text,order_kind text,third_party text,raw_channel text);
 create function private.dashboard_admin_wg_sites() returns table(country_code text,platform text) language sql immutable as $$select 'VN'::text,'WGTEST'::text$$;
 create function private.dashboard_admin_wg_provider_names(text,text,text) returns table(provider text) language sql immutable as $$select case $3 when 'withdraw' then 'WG-Withdraw' else 'WG-Charge' end$$;
 create table private.duoli_order_details(country text,system_name text,platform text,business text,provider_code text);
 create function private.dashboard_admin_duoli_provider(text) returns text language sql immutable as $$select coalesce($1,'未识别通道')$$;
 grant usage on schema private to anon,authenticated,service_role;
 `);
 await d.exec(baseline);
 await d.exec('revoke all on function private.dashboard_admin_live_provider_options(jsonb) from public,anon,authenticated,service_role;grant execute on function private.dashboard_admin_live_provider_options(jsonb) to authenticated;');
 for(const [key,source,country,name,scope] of [['yash','kb','印度','YASH.BET','IN'],['ar','ar','印度','ARTEST','IN'],['wg','wg','越南','WGTEST','VN'],['lg','lg','菲律宾','LGTEST','PH'],['duoli','duoli','印尼','DOLITEST','ID'],['wrongCountry','kb','越南','YASH.BET','VN'],['wrongSite','kb','印度','NOTYASH','IN']])await d.query('insert into private.test_platforms values($1,$2,$3,$4,$4,$5)',[ids[key],source,country,name,scope]);
 await d.exec(`insert into private.yash_orders select 'yash','deposit',case i%5 when 0 then 'Alias-A' when 1 then 'Alias-B' when 2 then null when 3 then '' else '  ' end from generate_series(1,500)i;
 insert into private.yash_orders values('yash','withdrawal','WithdrawOnly'),('yash','withdrawal','Alias-A'),('yash','withdrawal',null),('other-site','deposit','MustNotLeak'),('yash','other-direction','MustNotLeak');
 insert into private.dashboard_admin_provider_registry values('印度','ARTEST','AR-raw',array['AR-Canonical'],array['代收']);
 insert into private.dashboard_admin_provider_overrides values('印度','YASH.BET','WithdrawOnly','ConfirmedWithdraw');
 insert into public.lg_success_daily values('PH','LGTEST','channel','withdraw',null,'LG-Withdraw');
 insert into private.duoli_order_details values('ID','DOLI','DOLITEST','recharge','DOLI-Charge'),('ID','DOLI','DOLITEST','withdraw','DOLI-Withdraw');`);
 return d;
}
before(async()=>{db=await setup();beforeMeta=await meta(db);answers=new Map();for(const direction of ['all','charge','withdraw'])for(const platforms of [[ids.yash],[ids.ar,ids.wg,ids.lg,ids.duoli],Object.values(ids)])answers.set(JSON.stringify(request(platforms,direction)),await options(db,request(platforms,direction)));await db.exec(migration);});
after(async()=>db?.close());
test('charge, withdraw, all and mixed old-platform responses remain identical to the deployed baseline',async()=>{
 for(const [r,expected]of answers)assert.deepEqual(await options(db,JSON.parse(r)),expected);
 assert.deepEqual((await options(db,request([ids.yash],'charge'))).providers,['Merged','未识别通道']);
 assert.deepEqual((await options(db,request([ids.yash],'withdraw'))).providers,['ConfirmedWithdraw','Merged','未识别通道']);
});
test('canonical calls scale with distinct raw suppliers rather than order count',async()=>{
 await resetCalls(db);await options(db,request([ids.yash],'charge'));assert.equal(await calls(db),5);
 await db.exec("insert into private.yash_orders select 'yash','deposit','Alias-A' from generate_series(1,2000)");
 await resetCalls(db);await options(db,request([ids.yash],'charge'));assert.equal(await calls(db),5);
 await resetCalls(db);await options(db,request([ids.yash],'all'));assert.equal(await calls(db),6);
});
test('null, empty and whitespace share one final unknown option; aliases and overrides still merge',async()=>{
 const r=await options(db);assert.equal(r.providers.filter(x=>x==='未识别通道').length,1);assert.equal(r.providers.filter(x=>x==='Merged').length,1);
 assert(r.providers.includes('ConfirmedWithdraw'));assert(!r.providers.includes('MustNotLeak'));assert.equal(r.platformCount,1);assert.equal(r.basis,'existing_classification');
});
test('no selection, wrong source identity and denied scope reveal no YASH names',async()=>{
 for(const list of [[],[ids.wrongCountry],[ids.wrongSite]]){await resetCalls(db);const r=await options(db,request(list));assert.deepEqual(r.providers,[]);assert.equal(await calls(db),0);}
 await db.exec("select set_config('test.platform','ARTEST',false)");
 try{const r=await options(db,request([ids.yash,ids.ar]));assert.deepEqual(r.providers,['AR-Canonical']);assert.equal(r.platformCount,1);}finally{await db.exec("select set_config('test.platform','',false)");}
 await db.exec("select set_config('test.denied','yes',false)");try{await assert.rejects(()=>options(db),/access_denied/);}finally{await db.exec("select set_config('test.denied','',false)");}
});
test('the real inner query does not scan YASH orders when no selected platform can access YASH',async()=>{
 const body=(await db.query("select prosrc from pg_proc where oid='private.dashboard_admin_live_provider_options(jsonb)'::regprocedure")).rows[0].prosrc;
 const sql=body.match(/  with platforms[\s\S]*? into v_result;/)[0].replace(' into v_result;',';').replace(/\bp_request\b/g,'$1::jsonb').replace(/\bv_ids\b/g,'$2::uuid[]').replace(/\bv_scope\b/g,"'{}'::jsonb");
 for(const list of [[],[ids.ar],[ids.wrongCountry],[ids.wrongSite]]){
  const result=await db.query('EXPLAIN (ANALYZE, TIMING OFF, FORMAT JSON) '+sql,[JSON.stringify(request(list)),list]);
  const scans=[];function visit(p){if(p['Relation Name']==='yash_orders')scans.push(p);for(const child of p.Plans||[])visit(child);}visit(result.rows[0]['QUERY PLAN'][0].Plan);
  assert(scans.length);assert(scans.every(p=>p['Actual Loops']===0));
 }
});
test('request validation and function/table ACL remain unchanged',async()=>{
 for(const r of [{platformIds:'bad'},{platformIds:[ids.yash],direction:'invalid'},{platformIds:['not-a-uuid']},{platformIds:[ids.yash],unknown:true}])await assert.rejects(()=>options(db,r),/invalid_(request|filter)/);
 assert.deepEqual(await meta(db),beforeMeta);
 for(const role of ['anon','service_role'])assert.equal((await db.query("select has_function_privilege($1,'private.dashboard_admin_live_provider_options(jsonb)','execute') allowed",[role])).rows[0].allowed,false);
 assert.equal((await db.query("select has_function_privilege('authenticated','private.dashboard_admin_live_provider_options(jsonb)','execute') allowed")).rows[0].allowed,true);
 for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_table_privilege($1,'private.yash_orders','select') allowed",[role])).rows[0].allowed,false);
});
test('body, ACL and execution metadata drift stop the migration atomically',async()=>{
 for(const change of ["create or replace function private.dashboard_admin_live_provider_options(p_request jsonb default '{}'::jsonb) returns jsonb language sql stable security definer set search_path='' as $$select $1$$",'grant execute on function private.dashboard_admin_live_provider_options(jsonb) to anon','alter function private.dashboard_admin_live_provider_options(jsonb) volatile']){
  const d=await setup();try{await d.exec(change);const before=await meta(d),definition=(await d.query("select pg_get_functiondef('private.dashboard_admin_live_provider_options(jsonb)'::regprocedure) d")).rows[0].d;
   await assert.rejects(()=>d.exec(migration),/yash_provider_options_(body|metadata)_drift/);await d.exec('rollback');assert.deepEqual(await meta(d),before);assert.equal((await d.query("select pg_get_functiondef('private.dashboard_admin_live_provider_options(jsonb)'::regprocedure) d")).rows[0].d,definition);
  }finally{await d.close();}
 }
});
