// Synthetic PostgreSQL only. This test has no network or production data.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),sql=n=>fs.readFileSync(path.join(root,'supabase',n),'utf8');
const patch=sql('admin-live-lg-native.sql');
const offline=patch.replace(/-- BEGIN LIVE BASELINE GUARD[\s\S]*?-- END LIVE BASELINE GUARD/,'-- Offline fixture has synthetic baseline function bodies.');
const owner='10000000-0000-0000-0000-000000000001',viewer='10000000-0000-0000-0000-000000000002';
const baseFixture=fs.readFileSync(path.join(__dirname,'uploaded-order-sources.test.cjs'),'utf8').split('\n').filter(l=>/^ create table (game66_platforms|game66_charge_orders|game66_withdraw_orders|ar_config_targets|ar_collected_orders|newar_detail_platforms|newar_detail_records)\(/.test(l)).join('\n');
function fn(source,name){const start=source.indexOf('create or replace function private.'+name+'(');assert(start>=0,name);return source.slice(start,source.indexOf('\n$$;',start)+4)}
let db,catalog,lgId,originalAcl;
const query=(overrides={})=>({action:'aggregate',platformId:lgId,startAt:'2026-09-25T00:00:00+08:00',endAt:'2026-09-26T00:00:00+08:00',direction:'charge',...overrides});
const call=async(q=query())=>(await db.query('select public.dashboard_admin_live_query($1::jsonb) data',[JSON.stringify(q)])).rows[0].data;
const drill=async(q)=>(await db.query('select public.dashboard_admin_live_drilldown($1::jsonb) data',[JSON.stringify(query({action:'aggregate',view:'drilldown',...q}))])).rows[0].data;
const as=uid=>db.query("select set_config('test.uid',$1,false)",[uid]);
const acl=async()=> (await db.query("select p.proname,coalesce(p.proacl::text,'DEFAULT') acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=any($1::text[]) order by p.proname",[['dashboard_admin_live_platforms','dashboard_admin_live_query','dashboard_admin_live_query_raw','dashboard_admin_live_drilldown_raw','dashboard_admin_live_provider_options','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_order_intake','dashboard_admin_live_sync_health_rows']])).rows;
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create schema auth;create role anon;create role authenticated;grant usage on schema private,auth to authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table dashboard_profiles(auth_user_id uuid primary key,role text,active boolean,data_scope jsonb,permissions jsonb);
 create table dashboard_admin_preview_grants(auth_user_id uuid primary key,can_view boolean);
 create function private.dashboard_current_data_scope() returns jsonb language sql stable security definer as $$select data_scope from public.dashboard_profiles where auth_user_id=auth.uid() and active$$;
 create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable as $$select coalesce(s->>'mode'='all' or (s->'countries' ? c and (not(s ? 'platforms') or s->'platforms' ? p)),false)$$;
 ${baseFixture}
 alter table game66_charge_orders add column status_group text;
 create table dashboard_platform_team_map(source_system text,source_country text,source_platform text,country_code text,country_name text,platform_name text,team_name text,active boolean);
 create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[],directions text[],primary key(country,platform,raw_provider));
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text,primary key(country,platform,raw_provider));
 create table lg_orders(source_system text default 'LG',country_code text,platform text,stat_date date,order_kind text,order_no text,member_id text,status_text text,status_class text,metric_amount numeric,order_amount numeric,actual_amount numeric,created_at timestamptz,paid_at timestamptz,finished_at timestamptz,third_party text,raw_channel text,payment_method text,updated_at timestamptz default now(),raw jsonb,primary key(platform,order_kind,order_no));
 create index lg_orders_created on lg_orders(country_code,platform,order_kind,created_at);
 create index lg_orders_paid on lg_orders(country_code,platform,order_kind,paid_at) where paid_at is not null;
 create index lg_orders_scope on lg_orders(platform,stat_date,order_kind);
 create table lg_success_daily(country_code text,platform text,stat_date date,order_kind text,scope_type text,third_party text,raw_channel text,observed_at timestamptz,updated_at timestamptz);
 create index lg_success_scope on lg_success_daily(platform,stat_date,order_kind,scope_type,third_party);
 create table lg_sync_runs(country_code text,platform text,stat_date date,order_kind text,status text,sync_mode text,expected_count bigint,fetched_count bigint,published_at timestamptz,observed_at timestamptz);
 create function public.lg_platform_country(p text) returns text language sql immutable as $$select case when p in('SUPERLG','LGPARTY','LGSABONG','LGBIGWIN') then 'PH' when p='LG111' then 'ID' when p='LG789' then 'PK' end$$;
 create function public.lg_country_timezone(c text) returns text language sql immutable as $$select case c when 'PH' then 'Asia/Manila' when 'ID' then 'Asia/Jakarta' when 'PK' then 'Asia/Karachi' end$$;
 create function private.dashboard_admin_live_withdraw_platforms() returns table(id uuid,scope_group text,source_name text) language sql as $$select null::uuid,null::text,null::text where false$$;
 create table fixture_feeds(value jsonb);
 create function private.dashboard_admin_live_collected_data(jsonb) returns jsonb language sql stable as $$select jsonb_build_object('rows',coalesce(jsonb_agg(value),'[]'::jsonb)) from public.fixture_feeds$$;
 create function private.dashboard_admin_live_report_country(text,text) returns text language sql immutable as $$select $1$$;
 create table panda_config_targets(like ar_config_targets);create table wg_config_targets(like ar_config_targets);
 create table auto_withdraw_daily(country text,platform text,data_date date,source_updated_at timestamptz,updated_at timestamptz);
 insert into dashboard_profiles values('${owner}','owner',true,'{"mode":"all"}','{}'),('${viewer}','viewer',true,'{"countries":["PH"],"platforms":["SUPERLG"]}','{}');
 insert into dashboard_admin_preview_grants values('${viewer}',true);
 insert into dashboard_platform_team_map select 'LG',case public.lg_platform_country(p) when 'PH' then '菲律宾' when 'ID' then '印尼' else '巴基斯坦' end,p,public.lg_platform_country(p),null,p,'M8',true from unnest(array['SUPERLG','LGPARTY','LGSABONG','LGBIGWIN','LG111','LG789'])p;
 insert into dashboard_platform_team_map values('LG','LG','SUPERLG','PH','菲律宾','Historical alias','WRONG HISTORICAL TEAM',true);
 insert into lg_orders(country_code,platform,stat_date,order_kind,order_no,status_class,status_text,metric_amount,actual_amount,created_at,paid_at,third_party,raw_channel,payment_method,raw)
 select public.lg_platform_country(p),p,'2026-09-25','recharge','OTHER-'||p,'success','成功',11,10,timestamp '2026-09-25 10:00' at time zone public.lg_country_timezone(public.lg_platform_country(p)),timestamp '2026-09-25 10:01' at time zone public.lg_country_timezone(public.lg_platform_country(p)),'OtherPay','GCash-OtherPay','GCash','{"phone":"SECRET-PHONE"}' from unnest(array['LGPARTY','LGSABONG','LGBIGWIN','LG111','LG789'])p;
 insert into lg_orders(country_code,platform,stat_date,order_kind,order_no,member_id,status_class,status_text,metric_amount,order_amount,actual_amount,created_at,paid_at,finished_at,third_party,raw_channel,payment_method,raw) values
 ('PH','SUPERLG','2026-09-24','recharge','PRIOR','MEM','success','成功',100,999,98,'2026-09-24T23:59+08','2026-09-25T00:00+08','2026-09-25T00:00+08','dy-pay','GCash-dy-pay','GCash','{"phone":"SECRET-PHONE"}'),
 ('PH','SUPERLG','2026-09-25','recharge','START','MEM','success','成功',200,999,195,'2026-09-25T00:00+08','2026-09-25T00:04+08','2026-09-25T00:04+08','dy-pay','GCash-dy-pay','GCash','{}'),
 ('PH','SUPERLG','2026-09-25','recharge','CROSS-OUT','MEM','success','成功',300,999,299,'2026-09-25T23:59+08','2026-09-26T00:00+08','2026-09-26T00:00+08','dy-pay','GCash-dy-pay','GCash','{}'),
 ('PH','SUPERLG','2026-09-25','recharge','UNKNOWN','MEM','unknown','未知',null,999,0,'2026-09-25T01:00+08',null,null,'OtherPay','Maya-OtherPay','Maya','{}'),
 ('PH','SUPERLG','2026-09-25','recharge','PENDING','MEM','pending','待支付',0,999,0,'2026-09-25T02:00+08',null,null,'OtherPay','Maya-OtherPay','Maya','{}'),
 ('PH','SUPERLG','2026-09-25','recharge','NO-PAID','MEM','success','成功',50,999,49,'2026-09-25T03:00+08',null,'2026-09-25T03:01+08','OtherPay','Maya-OtherPay','Maya','{}'),
 ('PH','SUPERLG','2026-09-26','recharge','END','MEM','success','成功',800,999,799,'2026-09-26T00:00+08','2026-09-26T00:01+08','2026-09-26T00:01+08','OtherPay','Maya-OtherPay','Maya','{}'),
 ('PH','SUPERLG','2026-09-25','withdraw','PAYOUT','MEM','success','成功',700,999,695,'2026-09-25T10:00+08','2026-09-25T11:00+08','2026-09-25T11:00+08','OutPay','OutPay-gcash','GCash','{}'),
 ('PH','SUPERLG','2026-09-25','withdraw','REJECT','MEM','rejected','驳回',900,999,0,'2026-09-25T10:00+08',null,'2026-09-25T11:00+08','OutPay','OutPay-gcash','GCash','{}');
 insert into lg_success_daily select country_code,platform,stat_date,order_kind,'third_party',third_party,raw_channel,now(),now() from lg_orders group by country_code,platform,stat_date,order_kind,third_party,raw_channel;
 insert into lg_success_daily values('LG','SUPERLG','2026-07-30','recharge','third_party','HISTORICAL ONLY','LEGACY',now(),now());
 insert into private.dashboard_admin_provider_registry values('菲律宾','SUPERLG','dy-pay',array['DyPay'],array['代收']);
 insert into lg_sync_runs values('PH','SUPERLG','2026-09-25','recharge','published','full',5,5,now(),now());
 insert into fixture_feeds values('{"dataset":"lg_orders","system":"LG","name":"SUPERLG","country":"菲律宾","rawCountry":"PH","rawPlatform":"SUPERLG","directions":["charge","withdraw"],"provenance":{"kind":"direct"}}');
 `);
 await db.exec(sql('admin-live-query.sql'));
 await db.exec('alter function private.dashboard_admin_live_query(jsonb) rename to dashboard_admin_live_query_raw');
 await db.exec(sql('admin-live-provider-aliases.sql'));
 for(const name of ['dashboard_admin_live_provider_alias_values','dashboard_admin_live_provider_canonical'])await db.exec(fn(sql('admin-live-configuration.sql'),name));
 for(const name of ['dashboard_admin_live_remap_groups','dashboard_admin_live_remap_rows','dashboard_admin_live_query'])await db.exec(fn(sql('admin-live-configuration-query.sql'),name));
 await db.exec(sql('admin-live-provider-filter-performance.sql'));
 await db.exec(sql('admin-live-drilldown.sql'));
 await db.exec(sql('admin-live-order-intake.sql'));
 await db.exec(sql('admin-live-sync-health.sql'));
 await db.exec(fn(sql('admin-live-collected-data.sql'),'dashboard_admin_live_lg_scopes'));
 // Set existing helper ACLs before CREATE OR REPLACE; the patch must retain them.
 await db.exec(`create function private.dashboard_admin_live_provider_options(jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;
 revoke all on function private.dashboard_admin_live_query_raw(jsonb),private.dashboard_admin_live_lg_scopes() from public,anon,authenticated;
 revoke all on function private.dashboard_admin_live_provider_options(jsonb) from public,anon;grant execute on function private.dashboard_admin_live_provider_options(jsonb),private.dashboard_admin_live_query(jsonb),private.dashboard_admin_live_platforms() to authenticated;`);
 originalAcl=await acl();await db.exec(offline);await as(owner);
 catalog=(await call({action:'catalog'})).platforms;lgId=catalog.find(p=>p.name==='SUPERLG').id;
});
after(async()=>db?.close());
test('native catalog includes six known LG order platforms; historical LG is not a second PH platform',async()=>{
 assert.equal(catalog.length,6);assert(catalog.every(p=>p.source==='lg'&&p.team==='M8'));
 assert.equal(catalog.filter(p=>p.scopeGroup==='PH').length,4);assert.equal(new Set(catalog.map(p=>p.id)).size,6);
 for(const [name,country,zone,currency] of [['SUPERLG','PH','Asia/Manila','PHP'],['LG111','ID','Asia/Jakarta','IDR'],['LG789','PK','Asia/Karachi','PKR']]){
  const p=catalog.find(p=>p.name===name);assert.equal(p.scopeGroup,country);assert.equal(p.sourceName,name);assert.equal(p.timezone,zone);assert.equal(p.currency,currency);
  assert.deepEqual(Object.fromEntries(['systemOrderId','thirdPartyOrderNumber','utr','historicalFees','actualAmount','recordedFee'].map(k=>[k,p.capabilities[k]])),{systemOrderId:false,thirdPartyOrderNumber:false,utr:false,historicalFees:false,actualAmount:true,recordedFee:false});
 }
});
test('creation and paid windows are separate, metric money is authoritative and status is not invented',async()=>{
 const r=await call(),s=r.summary[0];assert.equal(s.all_count,5);assert.equal(s.success_count,2);assert.equal(s.success_amount,'300');assert.equal(s.all_amount,null);assert.equal(s.pending_count,1);assert.equal(s.unknown_count,1);assert.equal(s.created_success_count,3);
 assert.equal(r.groups.provider.find(p=>p.provider==='DyPay').all_amount,'500');
 const metrics=rows=>rows.map(x=>Object.fromEntries(Object.entries(x).filter(([k])=>!['date','hour','bucket'].includes(k))));
 for(const view of ['providers','full']){const q=await call(query({view}));assert.deepEqual(metrics(q.summary),metrics(r.summary));assert.deepEqual(metrics(q.groups.provider),metrics(r.groups.provider));}
 const w=await call(query({direction:'withdraw'}));assert.equal(w.summary[0].all_count,2);assert.equal(w.summary[0].success_count,1);assert.equal(w.summary[0].success_amount,'700');assert.equal(w.summary[0].rejected_count,1);assert.equal(w.summary[0].failed_count,0);
 for(const key of ['provider','daily','hourly','amount','amount_range','matrix','matrix_range']){assert.equal(r.groups[key].reduce((n,x)=>n+x.all_count,0),5,key);assert.equal(r.groups[key].reduce((n,x)=>n+x.success_count,0),2,key);}
});
test('LG details preserve actual amounts and raw channel while rejecting unsupported identifiers',async()=>{
 const r=await call(query({action:'details',status:'success'}));assert.equal(r.total,2);assert.deepEqual(r.rows.map(r=>r.order_number).sort(),['PRIOR','START']);
 const start=r.rows.find(r=>r.order_number==='START');assert.equal(start.provider,'DyPay');assert.equal(start.raw_provider,'GCash-dy-pay');assert.equal(start.amount,'200');assert.equal(start.actual_amount,'195');assert.equal(start.withdraw_fee,null);
 assert.equal(r.capabilities.recordedFee,false);assert.doesNotMatch(JSON.stringify(r),/SECRET-PHONE|"raw"|operator_name/);
 for(const key of ['thirdPartyOrderNumber','systemOrderId','utr'])await assert.rejects(call(query({[key]:'unsupported'})),/unsupported_filter/);
 assert.equal((await call(query({action:'details',orderNumber:'START',memberId:'MEM',currency:'PHP',channelTypes:['GCash'],amountMin:'200',amountMax:'200'}))).total,1);
 assert.equal((await call(query({action:'details',orderNumber:'START',memberId:'OTHER'}))).total,0);
});
test('provider options, canonical filters and details share LG third_party identity without history leakage',async()=>{
 const options=async direction=>(await db.query('select private.dashboard_admin_live_provider_options($1::jsonb) data',[JSON.stringify({platformIds:[lgId],direction})])).rows[0].data;
 assert.deepEqual((await options('charge')).providers,['DyPay','OtherPay']);assert.deepEqual((await options('withdraw')).providers,['OutPay']);
 const q=await call(query({providers:['DyPay']}));assert.equal(q.summary[0].all_count,2);assert.equal(q.summary[0].success_count,2);assert.equal(q.summary[0].success_amount,'300');
 assert.equal((await call(query({action:'details',status:'success',providers:['DyPay']}))).total,2);
 assert.equal((await call(query({providers:['HISTORICAL ONLY']}))).summary.length,0);
});
test('latency, hourly and amount drilldowns agree with native aggregation across midnight',async()=>{
 const r=await call();for(const [kind,extra,predicate]of [['hourly',{hour:0},r=>r.hour===0],['amount',{bucket:'200'},r=>r.bucket==='200'],['amount_range',{bucket:'100–200'},r=>r.bucket==='100–200'],['matrix',{hour:0,bucket:'200'},r=>r.hour===0&&r.bucket==='200'],['matrix_range',{hour:0,bucket:'100–200'},r=>r.hour===0&&r.bucket==='100–200']]){
  const d=await drill({kind,...extra}),e=r.groups[kind].find(predicate);assert.equal(d.summary[0].all_count,e.all_count,kind);assert.equal(d.summary[0].success_count,e.success_count,kind);assert.equal(d.summary[0].success_amount,e.success_amount,kind);
 }
 const latency=await drill({kind:'latency',bucket:0,cumulative:false,providers:['DyPay']});assert.equal(latency.total,2);assert.equal(latency.summary[0].amount,'300');assert.equal(latency.groups.provider[0].provider,'DyPay');assert.doesNotMatch(JSON.stringify(latency),/order_number|member_id|SECRET/);
});
test('different country timezones and currencies stay isolated',async()=>{
 for(const [name,zone,currency]of [['LG111','+07:00','IDR'],['LG789','+05:00','PKR']]){
  const r=await call(query({platformId:catalog.find(p=>p.name===name).id,startAt:'2026-09-25T00:00:00'+zone,endAt:'2026-09-26T00:00:00'+zone}));assert.equal(r.summary[0].all_count,1);assert.equal(r.summary[0].success_count,1);assert.equal(r.summary[0].currency,currency);
 }
});
test('renaming a platform cannot change its provider option, filter or latency identity',async()=>{
 await db.exec("update dashboard_platform_team_map set platform_name='Friendly display' where source_country='菲律宾' and source_platform='SUPERLG'");
 try{
  const cat=(await call({action:'catalog'})).platforms.find(p=>p.id===lgId);assert.equal(cat.name,'Friendly display');assert.equal(cat.sourceName,'SUPERLG');
  const q=await call(query({providers:['DyPay']}));assert.equal(q.groups.provider[0].provider,'DyPay');assert.equal(q.summary[0].success_count,2);
  const d=await drill({kind:'latency',bucket:0,cumulative:false,providers:['DyPay']});assert.equal(d.groups.provider[0].provider,'DyPay');assert.equal(d.total,2);
  const options=(await db.query('select private.dashboard_admin_live_provider_options($1::jsonb) data',[JSON.stringify({platformIds:[lgId],direction:'charge'})])).rows[0].data;assert.deepEqual(options.providers,['DyPay','OtherPay']);
 }finally{await db.exec("update dashboard_platform_team_map set platform_name='SUPERLG' where source_country='菲律宾' and source_platform='SUPERLG'")}
});
test('unknown sources fail closed instead of falling through to GAME66',async()=>{
 const saved=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_platforms()'::regprocedure) d")).rows[0].d;
 await db.exec(`create or replace function private.dashboard_admin_live_platforms() returns table(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) language sql as $$select '${lgId}'::uuid,'SUPERLG','M8','菲律宾','PH','unsupported','Asia/Manila','PHP','SUPERLG'$$;`);
 try{await assert.rejects(call(),/unsupported_source/);await assert.rejects(drill({kind:'latency',bucket:0}),/unsupported_source/)}finally{await db.exec(saved)}
});
test('scope, creation and paid probes reuse indexes without scanning order history',async()=>{
 await db.exec('begin');try{
  await db.exec(`insert into lg_orders(country_code,platform,stat_date,order_kind,order_no,status_class,created_at,paid_at) select 'PH','SUPERLG','2026-01-01','recharge','PERF-'||i,'success',timestamptz '2026-01-01Z'+i*interval '1 minute',timestamptz '2026-01-01Z'+i*interval '2 minute' from generate_series(1,12000)i;analyze lg_orders;`);
  const probes=[
   "select created_at from lg_orders where country_code='PH' and platform='SUPERLG' and order_kind='recharge' and created_at >= '2026-09-24T16:00Z' and created_at < '2026-09-25T16:00Z'",
   "select paid_at from lg_orders where country_code='PH' and platform='SUPERLG' and order_kind='recharge' and paid_at is not null and paid_at >= '2026-09-24T16:00Z' and paid_at < '2026-09-25T16:00Z'",
   "select country_code,platform from lg_orders where (country_code,platform)>('PH','LGPARTY') order by country_code,platform limit 1"];
  for(const q of probes){const plan=JSON.stringify((await db.query('explain(format json) '+q)).rows);assert.match(plan,/Index/);assert.doesNotMatch(plan,/Seq Scan/)}
 }finally{await db.exec('rollback')}
});
test('fresh scope and grant checks deny unrelated LG countries, platforms and raw table access',async()=>{
 await as(viewer);try{
  await db.exec('set role authenticated');assert.deepEqual((await call({action:'catalog'})).platforms.map(p=>p.name),['SUPERLG']);assert.equal((await call()).summary[0].all_count,5);
  await assert.rejects(call(query({platformId:catalog.find(p=>p.name==='LG111').id})),/platform_denied/);
  await assert.rejects(db.query('select * from lg_orders'),/permission denied/);await assert.rejects(db.query('select private.dashboard_admin_live_query_raw($1)',[query()]),/permission denied/);
  await db.exec('reset role');await db.query('update dashboard_admin_preview_grants set can_view=false where auth_user_id=$1',[viewer]);await assert.rejects(call(),/preview_denied/);
 }finally{await db.exec('reset role');await db.query('update dashboard_admin_preview_grants set can_view=true where auth_user_id=$1',[viewer]);await as(owner)}
});
test('LG intake reports real direction dates and native health does not duplicate lg_orders feeds',async()=>{
 const intake=(await db.query('select private.dashboard_admin_live_order_intake() data')).rows[0].data;assert.equal(intake.filter(p=>p.name==='SUPERLG').length,2);assert.equal(intake.find(p=>p.name==='SUPERLG'&&p.directions[0]==='withdraw').lastDate,'2026-09-25');
 const health=(await db.query("select * from private.dashboard_admin_live_sync_health_rows('2026-09-26T01:00Z') where platform='SUPERLG'")).rows;assert.equal(health.length,14);assert(health.every(h=>h.dataset==='orders'));
 const charge=health.find(h=>h.direction==='charge'&&h.data_date.toISOString().startsWith('2026-09-25'));assert.equal(charge.status,'received');assert.equal(charge.evidence,'source_day_task_completed');
});
test('forward replacement preserves existing helper ACLs and never replaces the outer authorization wrapper',async()=>{
 assert.deepEqual(await acl(),originalAcl);assert.doesNotMatch(patch,/CREATE OR REPLACE FUNCTION (?:public\.|private\.dashboard_admin_live_query\()/i);assert.doesNotMatch(patch,/\b(insert into|update public\.|delete from|alter table|create index)\b/i);
 assert.match(patch,/LG native baseline changed/);assert.match(patch,/lg_scopes\(\)/);assert.match(patch,/unsupported_source/);
 await db.exec(patch); // Exact after-hashes allow safe repeated application.
 const saved=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_order_intake()'::regprocedure) d")).rows[0].d;
 await db.exec("create or replace function private.dashboard_admin_live_order_intake() returns jsonb language sql as $$select '[]'::jsonb$$;");
 try{await assert.rejects(db.exec(patch),/LG native baseline changed/);await db.exec('rollback');}finally{await db.exec(saved)}
});
