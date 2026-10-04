const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');let db,metadata,previous;
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261004084826_newar_native_provider_filter.sql'),'utf8');
const baseline=fs.readFileSync(path.join(__dirname,'fixtures/newar-provider-filter-baseline.sql'),'utf8');
const ids={newar:'00000000-0000-0000-0000-000000000001',ar:'00000000-0000-0000-0000-000000000002',wg:'00000000-0000-0000-0000-000000000003',lg:'00000000-0000-0000-0000-000000000004'};
const input=(extra={})=>({action:'aggregate',platformId:ids.newar,direction:'charge',status:'all',startAt:'2026-10-02T18:30:00Z',endAt:'2026-10-03T18:30:00Z',providers:['UpiPay'],...extra});
const expand=async q=>(await db.query('select private.dashboard_admin_live_expand_provider_filter($1::jsonb) r',[JSON.stringify(q)])).rows[0].r;
const meta=async()=>(await db.query("select to_jsonb(p)-'prosrc' value from pg_proc p where oid='private.dashboard_admin_live_expand_provider_filter(jsonb)'::regprocedure")).rows[0].value;
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;grant usage on schema private to authenticated;
 create table private.catalog(id uuid,source text,name text,source_name text,country text,scope_group text);
 insert into private.catalog values ('${ids.newar}','newar','DHANIWIN','DhaniWin','印度','IN'),('${ids.ar}','ar','91CLUB','91CLUB','印度','IN'),('${ids.wg}','wg','26BET','26BET','巴西','BR'),('${ids.lg}','lg','LG','LG','印度','IN');
 create function private.dashboard_admin_live_platforms() returns setof private.catalog language plpgsql stable as $$begin if current_setting('test.denied',true)='yes' then raise exception 'access_denied';end if;return query select * from private.catalog;end$$;
 create function private.dashboard_admin_live_scope() returns jsonb language sql as $$select '{}'::jsonb$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql as $$select true$$;
 create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[]);
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text);
 insert into private.dashboard_admin_provider_registry values ('印度','DHANIWIN','UpiPay',array['UpiPay']),('印度','91CLUB','AR-raw',array['UpiPay']);
 create function private.dashboard_admin_live_confirmed_provider(text,text,text) returns text language sql as $$select null::text$$;
 create function private.dashboard_admin_live_provider_alias_values(text,text[]) returns text[] language sql as $$select $2$$;
 create function private.dashboard_admin_live_provider_alias(text,text) returns text language sql as $$select $2$$;
 create function private.dashboard_admin_live_provider_canonical(text,text,text) returns text language sql stable as $$select case $3 when 'UpiPay-QR' then 'UpiPay' when 'ARUPI' then 'UPI-QR' when 'ArbPayINR' then 'ArbPay' when 'Umoney-QR' then 'UmoneyPay' when 'WPay-QR' then 'WPay' else $3 end$$;
 create function private.dashboard_admin_wg_provider_names(text,text,text) returns table(provider text) language sql as $$values ('WG-raw')$$;
 create table public.lg_success_daily(country_code text,platform text,third_party text,raw_channel text,scope_type text,order_kind text);
 insert into public.lg_success_daily values ('IN','LG','LG-raw',null,'third_party','recharge');
 create table public.newar_detail_platforms(platform text primary key,launch_at timestamptz);
 insert into public.newar_detail_platforms values ('DhaniWin',null),('FOREIGN',null),('FUTURE','2999-01-01');
 create table public.newar_detail_records(id text,platform text,dataset text,provider text,channel_type text,status_group text,created_at timestamptz,success_at timestamptz,amount numeric);
 create index created_idx on public.newar_detail_records(platform,dataset,created_at);
 create index success_idx on public.newar_detail_records(platform,dataset,success_at) where status_group='success' and success_at is not null;
 insert into public.newar_detail_records values
 ('C','DhaniWin','charge','UpiPay-QR','QR','failed','2026-10-03T00:00Z',null,700),
 ('BOUNDARY','DhaniWin','charge','ARUPI','QR','pending','2026-10-02T18:30Z',null,200),
 ('X','DhaniWin','charge','ArbPayINR','Bank','success','2026-10-01T00:00Z','2026-10-03T01:00Z',500),
 ('W','DhaniWin','withdraw','Umoney-QR','QR','success','2026-10-03T00:00Z','2026-10-03T01:00Z',800),
 ('M','DhaniWin','charge',null,'ManualRecharge','success','2026-10-03T00:00Z','2026-10-03T00:01Z',50),
 ('R','DhaniWin','withdraw','人工取消','Bank','failed','2026-10-03T00:00Z',null,90),
 ('END','DhaniWin','charge','Outside-QR','QR','pending','2026-10-03T18:30Z',null,100),
 ('HIDDEN','FOREIGN','charge','ForeignOnly','QR','success','2026-10-03T00:00Z','2026-10-03T00:01Z',1000);
 revoke all on public.newar_detail_records,public.newar_detail_platforms from public,anon,authenticated;
 `);await db.exec(baseline+';revoke all on function private.dashboard_admin_live_expand_provider_filter(jsonb) from public,anon,service_role;grant execute on function private.dashboard_admin_live_expand_provider_filter(jsonb) to authenticated;');
 assert.equal((await db.query("select md5(prosrc) h from pg_proc where oid='private.dashboard_admin_live_expand_provider_filter(jsonb)'::regprocedure")).rows[0].h,'42cc6fc75303a7a77dab967b80074902');
 metadata=await meta();previous=await Promise.all(Object.entries(ids).filter(([k])=>k!=='newar').map(async([k,id])=>[k,await expand(input({platformId:id}))]));
 assert.deepEqual((await expand(input())).providers,['UpiPay']);await db.exec(migration);
});
after(()=>db?.close());
test('canonical selection expands actual native name and restores positive amount/hour facts',async()=>{
 const request=await expand(input());assert.deepEqual(request.providers,['UpiPay','UpiPay-QR']);assert.equal(request.platformId,ids.newar);
 const facts=(await db.query("select count(*)::int count,sum(amount)::text amount,extract(hour from created_at at time zone 'Asia/Kolkata')::int local_hour from public.newar_detail_records where platform='DhaniWin' and dataset='charge' and created_at>=$1 and created_at<$2 and provider=any($3) group by local_hour",[request.startAt,request.endAt,request.providers])).rows;
 assert.deepEqual(facts,[{count:1,amount:'700',local_hour:5}]);
 const many=await expand(input({providers:['UPI-QR','ArbPay','UpiPay']}));assert.deepEqual(many.providers,['ARUPI','ArbPay','ArbPayINR','UPI-QR','UpiPay','UpiPay-QR']);
});
test('success-time peers, direction, manual and rejected labels use the existing native engine rules',async()=>{
 assert((await expand(input({providers:['ArbPay']}))).providers.includes('ArbPayINR'));
 assert.deepEqual((await expand(input({action:'details',status:'all',providers:['ArbPay']}))).providers,['ArbPay']);
 assert((await expand(input({action:'details',status:'success',providers:['ArbPay']}))).providers.includes('ArbPayINR'));
 assert.deepEqual((await expand(input({providers:['UmoneyPay']}))).providers,['UmoneyPay']);
 assert.deepEqual((await expand(input({direction:'withdraw',providers:['UmoneyPay','无三方（驳回）']}))).providers,['Umoney-QR','UmoneyPay','无三方（驳回）']);
 assert.deepEqual((await expand(input({providers:['人工充值']}))).providers,['人工充值']);
});
test('foreign source names, outside instants and request ambiguity never add native names',async()=>{
 assert.deepEqual((await expand(input({providers:['ForeignOnly','Outside-QR']}))).providers,['ForeignOnly','Outside-QR']);
 for(const q of [input({providers:[]}),input({providers:undefined}),input({startAt:undefined}),input({startAt:'not-a-date'}),input({startAt:'-infinity'}),input({endAt:'2027-01-01'}),input({direction:'bad'}),input({platformId:'invalid'})])assert.deepEqual(await expand(q),JSON.parse(JSON.stringify(q)));
 await db.query("select set_config('test.denied','yes',false)");try{await assert.rejects(expand(input()),/access_denied/);}finally{await db.query("select set_config('test.denied','',false)");}
});
test('all other sources and function identity/ACL/config retain the actual baseline behavior',async()=>{
 for(const [k,result]of previous)assert.deepEqual(await expand(input({platformId:ids[k]})),result);
 assert.deepEqual(await meta(),metadata);await db.exec(migration);assert.deepEqual(await meta(),metadata);
 await db.exec('set role authenticated');try{assert((await expand(input())).providers.includes('UpiPay-QR'));await assert.rejects(db.query('select * from public.newar_detail_records'),/permission denied/);}finally{await db.exec('reset role');}
 for(const role of ['anon','service_role']){await db.exec('set role '+role);try{await assert.rejects(expand(input()),/permission denied/);}finally{await db.exec('reset role');}}
});
test('baseline or privilege drift fails atomically',async()=>{
 const ddl=migration.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
 for(const [change,message]of [["grant execute on function private.dashboard_admin_live_expand_provider_filter(jsonb) to anon",/METADATA_CHANGED/],["alter function private.dashboard_admin_live_expand_provider_filter(jsonb) reset all",/METADATA_CHANGED/],["create or replace function private.dashboard_admin_live_expand_provider_filter(p_request jsonb) returns jsonb language sql stable security definer set search_path='' as $$select p_request$$",/BASELINE_CHANGED/]]){
 await db.exec('begin;'+change);try{await assert.rejects(db.exec(ddl),message);}finally{await db.exec('rollback');}}
});
