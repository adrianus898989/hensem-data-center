// Synthetic rows using reviewed production schema/functions; no live Auth session.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const migration=read('supabase/migrations/20261002110328_wg_provider_details_name_expansion.sql'),baseline=read('tests/fixtures/wg-provider-details-expansion-baseline.sql');
const fn=(s,name)=>{const lower=s.toLowerCase(),positions=['create function private.','create or replace function private.'].map(prefix=>lower.indexOf(prefix+name+'(')).filter(n=>n>=0);assert(positions.length,name);const rest=s.slice(Math.min(...positions)),tag=rest.match(/as\s+([$][a-z_]*[$])/i)[1],end=rest.indexOf(tag+';',rest.indexOf(tag)+tag.length);assert(end>=0,name);return rest.slice(0,end+tag.length+1);};
const id='10000000-0000-0000-0000-000000000001',xxid='10000000-0000-0000-0000-000000000002';
const request=(extra={})=>({action:'details',platformId:id,startAt:'2026-09-30T17:00:00Z',endAt:'2026-10-01T17:00:00Z',direction:'charge',status:'success',providers:['TronPayUSDT'],offset:0,limit:20,...extra});
async function setup(){
 const x=new PGlite();
 await x.exec([
 "create schema private;create role anon;create role authenticated;create role service_role;",
 "create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[],directions text[],charge_count bigint,withdraw_count bigint,matched_count bigint,last_data_date date,updated_at timestamptz,primary key(country,platform,raw_provider));",
 "create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text,primary key(country,platform,raw_provider));",
 "create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable security definer set search_path='' as $$begin if current_setting('test.denied',true)='true' then raise exception 'preview_denied' using errcode='42501';end if;return coalesce(nullif(current_setting('test.scope',true),''),'{\"mode\":\"all\"}')::jsonb;end$$;",
 "create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable set search_path='' as $$select s->>'mode'='all' or s->'platforms' ? p$$;",
 "create function private.dashboard_admin_live_platforms() returns table(id uuid,name text,country text,scope_group text,source text,source_name text) language plpgsql stable security definer set search_path='' as $$declare s jsonb:=private.dashboard_admin_live_scope();begin return query select p.* from(values('"+id+"'::uuid,'98VV','越南','VN','wg','98VV'),('"+xxid+"'::uuid,'XX98','越南','VN','wg','XX98'),('10000000-0000-0000-0000-000000000003'::uuid,'26BET','巴西','BR','wg','26BET'),('10000000-0000-0000-0000-000000000004'::uuid,'91CLUB','印度','IN','ar','91CLUB'))p(id,name,country,scope_group,source,source_name) where private.dashboard_scope_allows(s,p.country,p.name);end$$;"
 ].join('\n'));
 await x.exec(read('tests/fixtures/wg-exact-provider-aliases/native-order-schema.sql'));
 await x.exec(read('tests/fixtures/wg-exact-provider-aliases/runtime-alias-and-wrapper.sql').split('CREATE OR REPLACE FUNCTION private.dashboard_admin_live_payout_config')[0]);
 await x.exec(fn(read('supabase/admin-live-india-usdt-classification.sql'),'dashboard_admin_live_confirmed_usdt_provider'));
 await x.exec(fn(read('tests/fixtures/wg-exact-provider-aliases/baseline-functions.sql'),'dashboard_admin_wg_sites'));
 const aliases=read('supabase/migrations/20261002100001_wg_exact_provider_aliases.sql');
 await x.exec(fn(aliases,'dashboard_admin_wg_provider_aliases'));await x.exec(fn(aliases,'dashboard_admin_live_provider_canonical'));
 await x.exec(fn(read('supabase/migrations/20261002105434_wg_provider_options_index_walk.sql'),'dashboard_admin_wg_provider_names'));
 await x.exec("revoke all on function private.dashboard_admin_wg_provider_names(text,text,text) from public,anon,authenticated,service_role;grant usage on schema private to authenticated,anon,service_role;");
 await x.exec(baseline);await x.exec(fn(baseline,'dashboard_admin_live_expand_provider_filter').replace('FUNCTION private.dashboard_admin_live_expand_provider_filter(','FUNCTION private.dashboard_admin_live_expand_provider_filter_legacy('));
 await x.exec("insert into public.wg_recharge_details(site_code,provider,created_at,success_at,status_code,status_group,member_currency,member_amount) values('3257','TronPay(USDT)','2026-09-29T12:00Z','2026-10-01T12:00Z',2,'success','VND',200),('3257','TronPay(USDT)','2026-10-01T12:00Z','2026-10-02T12:00Z',2,'success','VND',300),('3257','YesPay(VND)','2026-10-01T12:00Z','2026-10-01T12:01Z',2,'success','VND',100),('3257','YesPay(VND)(已删除:731329)','2026-10-01T13:00Z','2026-10-01T13:01Z',2,'success','VND',100),('3257',' UnknownNative3 ','2026-10-01T13:00Z',null,0,'pending','VND',100),('3257',null,'2026-10-01T13:00Z',null,0,'pending','VND',100),('3257','  ','2026-10-01T13:00Z',null,0,'pending','VND',100),('3605','TronPay(USDT)','2026-10-01T13:00Z','2026-10-01T13:01Z',2,'success','VND',75);insert into public.wg_withdraw_details(site_code,provider,created_at,status_group,member_currency,member_amount) values('3257','WithdrawNative3','2026-10-01T12:00Z','pending','VND',123);insert into private.dashboard_admin_provider_registry(country,platform,raw_provider,canonical_values) values('印度','91CLUB','AR-Raw',array['AR-Canonical']);");
 return x;
}
const expand=(x,req,legacy=false)=>x.query('select private.dashboard_admin_live_expand_provider_filter'+(legacy?'_legacy':'')+'($1::jsonb) value',[JSON.stringify(req)]).then(r=>r.rows[0].value);
const native=(x,p)=>x.query("select provider,created_at::text,success_at::text,member_currency,member_amount::text from public.wg_recharge_details where site_code='3257' and coalesce(nullif(btrim(provider),''),'未识别通道')=any($1::text[]) and status_group='success' and status_code=2 and success_at >= '2026-09-30T17:00Z' and success_at < '2026-10-01T17:00Z' order by created_at",[p]).then(r=>r.rows);
test('native-name expansion equals legacy filters and preserves exact success cohort and money',async()=>{
 const x=await setup();try{
 const requests=[request(),request({providers:['YesPay']}),request({providers:['UnknownNative3']}),request({providers:['未识别通道']}),request({direction:'all',providers:['WithdrawNative3']}),request({platformId:xxid}),request({platformId:'10000000-0000-0000-0000-000000000004',providers:['AR-Canonical']})];
 const old=await Promise.all(requests.map(r=>expand(x,r,true))),source=(await x.query('select to_jsonb(w) value from public.wg_recharge_details w order by w.created_at,w.provider nulls first')).rows;
 const metadata=(await x.query("select to_jsonb(p)-'prosrc' value from pg_proc p where oid='private.dashboard_admin_live_expand_provider_filter(jsonb)'::regprocedure")).rows[0].value;
 await x.exec(migration);
 assert.deepEqual((await x.query("select to_jsonb(p)-'prosrc' value from pg_proc p where oid='private.dashboard_admin_live_expand_provider_filter(jsonb)'::regprocedure")).rows[0].value,metadata,'all PostgreSQL function metadata including ACL, owner and volatility retained');
 for(let i=0;i<requests.length;i++){const value=await expand(x,requests[i]);assert.deepEqual(value,old[i]);assert.deepEqual({...value,providers:requests[i].providers},requests[i],'other request fields retained');}
 const result=await native(x,(await expand(x,request())).providers);assert.equal(result.length,1);assert.equal(result[0].member_amount,'200');assert.equal(result[0].member_currency,'VND');assert(result[0].created_at.startsWith('2026-09-29'),'prior creation retained in success cohort');
 assert.deepEqual((await x.query('select to_jsonb(w) value from public.wg_recharge_details w order by w.created_at,w.provider nulls first')).rows,source);
 }finally{await x.close();}
});
test('manual override beats native mapping; denied platform remains unexpanded; unknown names remain readable',async()=>{
 const x=await setup();try{await x.exec(migration);await x.exec("insert into private.dashboard_admin_provider_overrides values('越南','98VV','TronPay(USDT)','UserChosen')");
 assert.deepEqual((await expand(x,request())).providers,['TronPayUSDT']);assert.deepEqual((await expand(x,request({providers:['UserChosen']}))).providers,['TronPay(USDT)','UserChosen']);
 assert.deepEqual((await expand(x,request({providers:['UnknownNative3']}))).providers,['UnknownNative3']);
 await x.query("select set_config('test.scope',$1,false)",[JSON.stringify({mode:'selected',platforms:['XX98']})]);
 assert.deepEqual(await expand(x,request()),request());assert((await expand(x,request({platformId:xxid}))).providers.includes('TronPay(USDT)'));
 await x.exec("select set_config('test.denied','true',false)");await assert.rejects(expand(x,request({platformId:xxid})),/preview_denied/);
 }finally{await x.close();}
});
test('all-provider bypass, validation and function privileges remain unchanged',async()=>{
 const x=await setup();try{await x.exec(migration);
 for(const providers of [undefined,null,[],['TronPayUSDT']]){const r=request();if(providers===undefined)delete r.providers;else r.providers=providers;assert.deepEqual(await expand(x,r),await expand(x,r,true));}
 for(const providers of [[true],[''],['x\n'],Array.from({length:201},()=> 'x')])await assert.rejects(expand(x,request({providers})),/invalid_filter/);
 for(const role of ['anon','authenticated','service_role'])assert.equal((await x.query("select has_function_privilege($1,'private.dashboard_admin_wg_provider_names(text,text,text)','execute') allowed",[role])).rows[0].allowed,false);
 assert.equal((await x.query("select has_function_privilege('authenticated','private.dashboard_admin_live_expand_provider_filter(jsonb)','execute') allowed")).rows[0].allowed,true);
 await x.exec('set role authenticated');assert((await expand(x,request())).providers.includes('TronPay(USDT)'));await x.exec('reset role');
 }finally{await x.close();}
});
test('canonical work scales with distinct native names rather than duplicate historical orders',async()=>{
 const x=await setup();try{await x.exec(migration);await x.exec("insert into public.wg_recharge_details(site_code,provider,created_at,status_group) select '3257','TronPay(USDT)','2026-09-29T12:00Z','pending' from generate_series(1,5014);alter function private.dashboard_admin_live_provider_canonical(text,text,text) rename to dashboard_admin_live_provider_canonical_actual;create sequence private.canonical_calls;create function private.dashboard_admin_live_provider_canonical(text,text,text) returns text language plpgsql stable security definer set search_path='' as $$begin perform nextval('private.canonical_calls');return private.dashboard_admin_live_provider_canonical_actual($1,$2,$3);end$$;");
 const count=Number((await x.query("select count(*) n from private.dashboard_admin_wg_provider_names('VN','98VV','charge')")).rows[0].n);assert((await expand(x,request())).providers.includes('TronPay(USDT)'));assert.equal(Number((await x.query('select last_value n from private.canonical_calls')).rows[0].n),count);
 }finally{await x.close();}
});
test('reader body, metadata and native-name helper drift abort before changing the reader',async()=>{
 for(const kind of ['body','acl','helper','helper-acl']){const x=await setup();try{
 if(kind==='body')await x.exec("create or replace function private.dashboard_admin_live_expand_provider_filter(p_request jsonb) returns jsonb language sql stable security definer set search_path='' as $$select $1$$");
 if(kind==='acl')await x.exec('grant execute on function private.dashboard_admin_live_expand_provider_filter(jsonb) to anon');
 if(kind==='helper')await x.exec("create or replace function private.dashboard_admin_wg_provider_names(p_country_code text,p_platform text,p_direction text) returns table(provider text) language sql stable set search_path='' as $$select 'WrongName'::text$$");
 if(kind==='helper-acl')await x.exec('grant execute on function private.dashboard_admin_wg_provider_names(text,text,text) to authenticated');
 const before=(await x.query("select md5(prosrc) hash from pg_proc where oid='private.dashboard_admin_live_expand_provider_filter(jsonb)'::regprocedure")).rows[0].hash;
 await assert.rejects(x.exec(migration),/wg_details_(expand|provider_names)_.*drift/);await x.exec('rollback');assert.equal((await x.query("select md5(prosrc) hash from pg_proc where oid='private.dashboard_admin_live_expand_provider_filter(jsonb)'::regprocedure")).rows[0].hash,before);
 }finally{await x.close();}}
});
