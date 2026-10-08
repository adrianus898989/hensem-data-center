// Production reader code, synthetic orders, no credentials or network access.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const patch=read('supabase/migrations/20261008050623_duoli_existing_orders.sql');
const live=JSON.parse(read('tests/fixtures/duoli-reader-production-functions.json'));
function fn(source,name){const p=source.search(new RegExp('create(?: or replace)? function private\\.'+name+'\\(','i'));assert(p>=0,name);const tail=source.slice(p),m=tail.match(/as\s+(\$[a-z_]*\$)/i);assert(m,name);const end=tail.indexOf(m[1]+';',m.index+m[0].length);return tail.slice(0,end+m[1].length+1);}
const owner='10000000-0000-0000-0000-000000000001',viewer='10000000-0000-0000-0000-000000000002';
const fixture=read('tests/uploaded-order-sources.test.cjs').split('\n').filter(l=>/^ create table (game66_platforms|game66_charge_orders|game66_withdraw_orders|ar_config_targets|ar_collected_orders|newar_detail_platforms|newar_detail_records)\(/.test(l)).join('\n');
let db,id,other,aclBefore;
const as=uid=>db.query("select set_config('test.uid',$1,false)",[uid]);
const req=(extra={})=>({action:'aggregate',platformId:id,startAt:'2026-10-07T00:00:00+07:00',endAt:'2026-10-08T00:00:00+07:00',direction:'charge',...extra});
const call=async(extra={})=>(await db.query('select private.dashboard_admin_live_query_raw($1::jsonb) data',[JSON.stringify(req(extra))])).rows[0].data;
const drill=async(extra={})=>(await db.query('select private.dashboard_admin_live_drilldown_raw($1::jsonb) data',[JSON.stringify(req({view:'drilldown',kind:'hourly',hour:1,...extra}))])).rows[0].data;
const orders=async(extra={})=>(await db.query('select private.dashboard_admin_live_analysis_orders_raw($1::jsonb) data',[JSON.stringify(req({action:'analysisOrders',kind:'hourly',hour:1,basis:'created',...extra}))])).rows[0].data;
const acl=async()=>(await db.query("select proname,proacl::text,proowner,prosecdef from pg_proc where oid=any($1::regprocedure[]) order by proname",[live.slice(0,9).map(x=>x.signature)])).rows;
async function add(platform,business,order,status,amount,extra={}){
 const d={platform,business,source_order_id:order,order_no:order,system_name:'DOLI',country:'ID',member_id:'synthetic-member',
  created_at:'2026-10-07T01:00:00+07:00',created_day:'2026-10-07',updated_at:'2026-10-07T02:00:00+07:00',audit_completed_at:'2026-10-07T01:01:00+07:00',status_code:status,currency:'IDR',provider:'unsafe-affiliate-fallback',provider_code:'124',channel:'BANK',amount_raw:amount,amount_source:business==='recharge'?'original_price':'gold',received_at:'2026-10-08T04:41:00Z',...extra};
 await db.query('insert into private.duoli_order_details select (jsonb_populate_record(null::private.duoli_order_details,$1::jsonb)).*',[JSON.stringify(d)]);
}
before(async()=>{
 db=new PGlite();await db.exec(`set check_function_bodies=off;create schema auth;create schema private;create role anon;create role authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table dashboard_profiles(auth_user_id uuid primary key,role text,active boolean,data_scope jsonb,permissions jsonb);
 create table dashboard_admin_preview_grants(auth_user_id uuid primary key,can_view boolean);
 create function private.dashboard_current_data_scope() returns jsonb language sql stable security definer as $$select data_scope from public.dashboard_profiles where auth_user_id=auth.uid() and active$$;
 create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable as $$select coalesce(s->>'mode'='all' or (s->'countries'?c and (not(s?'platforms') or s->'platforms'?p)),false)$$;
 ${fixture}
 create table dashboard_platform_team_map(source_system text,source_country text,source_platform text,country_code text,country_name text,platform_name text,team_name text,active boolean);
 create function private.dashboard_admin_live_lg_scopes() returns table(country_code text,platform text) language sql as $$select null::text,null::text where false$$;
 create function public.lg_platform_country(text) returns text language sql as $$select 'PH'::text$$;
 create function public.lg_country_timezone(text) returns text language sql as $$select 'Asia/Manila'::text$$;
 create function private.dashboard_admin_wg_sites() returns table(site_code text,country_code text,country text,platform text,timezone text,currency text) language sql as $$select null::text,null::text,null::text,null::text,null::text,null::text where false$$;
 create function private.dashboard_admin_wg_capabilities() returns jsonb language sql as $$select '{}'::jsonb$$;
 create function private.dashboard_admin_wg_provider_names(text,text,text) returns table(provider text) language sql as $$select null::text where false$$;
 create table lg_success_daily(country_code text,platform text,scope_type text,order_kind text,third_party text,raw_channel text);
 create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[],directions text[]);
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text);
 create function private.dashboard_admin_live_confirmed_provider(text,text,text) returns text language sql as $$select null::text$$;
 create function private.dashboard_admin_live_provider_alias(text,text) returns text language sql as $$select $2$$;
 create function private.dashboard_admin_live_provider_alias_values(text,text[]) returns text[] language sql as $$select $2$$;
 create function private.dashboard_admin_live_provider_canonical(text,text,text) returns text language sql as $$select case when $3='YerePay' then 'CanonicalYere' else $3 end$$;
 create table private.fee_rate_versions(country text);
 create function private.dashboard_admin_fee_category(text,text) returns text language sql as $$select $2$$;
 create function private.dashboard_admin_fee_intervals(text,text,text,text,text,text) returns table(effective_from timestamptz,effective_until timestamptz,percent_rate numeric,fixed_fee numeric) language sql as $$select null::timestamptz,null::timestamptz,null::numeric,null::numeric where false$$;
 create function private.dashboard_admin_fee_quote(text,text,text,text,text,timestamptz,numeric,text) returns jsonb language sql as $$select '{}'::jsonb$$;
 create table private.duoli_order_details(platform text,business text,source_order_id text,order_no text,system_name text,country text,member_id text,created_at timestamptz,created_day date,updated_at timestamptz,audit_completed_at timestamptz,status_code text,currency text,provider text,provider_code text,channel text,amount_raw text,amount_source text,received_at timestamptz,primary key(platform,business,source_order_id));
 create index duoli_order_details_day_idx on private.duoli_order_details(platform,business,created_at);
 alter table private.duoli_order_details enable row level security;
 create table private.duoli_detail_progress_v2(platform text,business text,stream text,start_at timestamptz,end_exclusive timestamptz,acknowledged_at timestamptz,source_count int,uploaded_count int,finalized boolean);
 insert into dashboard_profiles values('${owner}','owner',true,'{"mode":"all"}','{}'),('${viewer}','viewer',true,'{"countries":["ID","印尼"],"platforms":["UANG"]}','{}');
 insert into dashboard_admin_preview_grants values('${viewer}',true);
 insert into dashboard_platform_team_map select case when p in('FB168','FB333') then 'DOLI' else 'REPORT' end,'印尼',p,'ID','印尼',p,'M8',true from unnest(array['UANG','HOT985','IND666','FB168','FB333'])p;
 `);
 await db.exec(fn(read('supabase/admin-live-query.sql'),'dashboard_admin_live_scope'));
 await db.exec(fn(read('supabase/admin-live-dynamic-amount-bands.sql'),'dashboard_admin_validate_amount_bands'));
 await db.exec(fn(read('supabase/migrations/20260930225000_duration_precision_ranges.sql'),'dashboard_admin_validate_duration'));
 for(const item of live) await db.exec(item.definition);
 for(const item of live) await db.exec(`revoke all on function ${item.signature} from public,anon,authenticated;`);
 aclBefore=await acl();await db.exec(patch);await as(owner);
 const catalog=(await call({action:'catalog',platformId:undefined,startAt:undefined,endAt:undefined,direction:undefined})).platforms;
 id=catalog.find(x=>x.name==='UANG').id;other=catalog.find(x=>x.name==='FB168').id;
 await add('UANG','recharge','START','2','20000000');
 await add('UANG','recharge','FAIL','4','30000000');
 await add('UANG','recharge','PENDING','0','40000000',{provider_code:null});
 await add('UANG','recharge','UNKNOWN','99','50000000');
 await add('UANG','recharge','OLD','2','90000000',{created_at:'2026-10-06T23:59:59+07:00',created_day:'2026-10-06'});
 await add('UANG','recharge','END','2','100000000',{created_at:'2026-10-08T00:00:00+07:00',created_day:'2026-10-08'});
 for(const status of ['6','2','1','0','4','7','99'])await add('UANG','withdraw','W'+status,status,'50000',{provider_code:status==='2'?null:'124'});
 await add('FB168','recharge','OTHER','2','999000000');
 await db.exec("insert into private.duoli_detail_progress_v2 values('UANG','recharge','created','2026-10-01T00:00:00+07','2026-10-08T11:40:00+07','2026-10-08T04:41Z',10,10,true),('UANG','withdraw','updated','2026-10-01T00:00:00+07','2026-10-08T11:40:00+07','2026-10-08T04:41Z',2,2,true)");
});
after(async()=>db?.close());
test('five M8 IDR scopes are catalogued with unavailable timestamp/member capabilities',async()=>{
 const c=(await call({action:'catalog',platformId:undefined,startAt:undefined,endAt:undefined,direction:undefined})).platforms;
 assert.equal(c.length,5);assert.equal(new Set(c.map(x=>x.id)).size,5);
 for(const p of c){assert.equal(p.source,'duoli');assert.equal(p.team,'M8');assert.equal(p.currency,'IDR');assert.equal(p.timezone,'Asia/Jakarta');assert.equal(p.capabilities.successTimeAvailable,false);assert.equal(p.capabilities.chargeSuccessTimeAvailable,false);assert.equal(p.capabilities.withdrawSuccessTimeAvailable,false);assert.equal(p.capabilities.memberDailyAvailable,false);}
 assert.deepEqual(await acl(),aclBefore);
});
test('creation amounts use exact field units and separate current success from success time',async()=>{
 const r=await call(),s=r.summary[0];assert.equal(s.all_count,4);assert.equal(Number(s.all_amount),140000);assert.equal(s.created_success_count,1);assert.equal(Number(s.created_success_amount),20000);assert.equal(s.success_count,null);assert.equal(s.success_amount,null);
 for(const key of ['daily','hourly','provider','amount'])assert(r.groups[key].every(x=>x.success_count===null&&x.success_amount===null));
 const p=await call({view:'providers'});assert.equal(Number(p.summary[0].created_success_amount),20000);
 assert.equal(r.capabilities.successTimeBasis,'not_provided');
 const v=await call({direction:'withdraw'});assert.equal(v.summary[0].all_count,7);assert.equal(v.summary[0].created_success_count,2);assert.equal(Number(v.summary[0].created_success_amount),100000);assert.equal(v.summary[0].pending_count,2);assert.equal(v.summary[0].rejected_count,2);
});
test('unsupported units and missing amounts remain unavailable',async()=>{
 const values=(await db.query("select private.dashboard_admin_duoli_amount('recharge','IDR','original_price','123.45') a,private.dashboard_admin_duoli_amount('withdraw','IDR','gold','50000') b,private.dashboard_admin_duoli_amount('recharge','USDT','original_price','1000') c,private.dashboard_admin_duoli_amount('withdraw','IDR','money','50000000') d,private.dashboard_admin_duoli_amount('recharge','IDR','original_price','NaN') e,private.dashboard_admin_duoli_amount('recharge','IDR','original_price','1e999999') f")).rows[0];
 assert.equal(Number(values.a),0.12345);assert.equal(Number(values.b),50000);assert.equal(values.c,null);assert.equal(values.d,null);assert.equal(values.e,null);assert.equal(values.f,null);
 await db.exec('begin');try{await add('UANG','recharge','MISSING','2',null);const s=(await call()).summary[0];assert.equal(s.all_amount,null);assert.equal(s.created_success_amount,null);}finally{await db.exec('rollback');}
});
test('provider filters share the explicit source code projection and hide affiliate names',async()=>{
 const r=(await db.query('select private.dashboard_admin_live_provider_options($1::jsonb) data',[JSON.stringify({platformIds:[id],direction:'charge'})])).rows[0].data;
 assert.deepEqual(r.providers,['CanonicalYere','未识别通道']);
 const expanded=(await db.query('select private.dashboard_admin_live_expand_provider_filter($1::jsonb) data',[JSON.stringify(req({providers:['CanonicalYere']}))])).rows[0].data;
 assert.deepEqual(expanded.providers,['CanonicalYere','YerePay']);assert.equal((await call(expanded)).summary[0].all_count,3);
 assert.equal((await call({action:'details',providers:['unsafe-affiliate-fallback']})).total,0);
});
test('details and analytical grid drilldown preserve creation scope and refuse made-up payment times',async()=>{
 const d=await call({action:'details',orderNumber:'START'});assert.equal(d.total,1);assert.equal(d.rows[0].success_at,null);assert.equal(Number(d.rows[0].amount),20000);assert(!JSON.stringify(d.rows).includes('unsafe-affiliate-fallback'));
 const grid=await drill();assert.equal(grid.summary[0].all_count,4);assert.equal(grid.summary[0].success_count,null);assert.equal(Number(grid.summary[0].created_success_amount),20000);
 for(const direction of ['charge','withdraw','all'])await assert.rejects(call({status:'success',direction}),/unsupported_success_time_filter_for_duoli/);
 await assert.rejects(drill({kind:'latency',hour:undefined,bucket:0}),/unsupported_success_time_filter_for_duoli/);
 const a=await orders();assert.equal(a.total,4);assert(a.rows.every(x=>x.success_at===null));
 await assert.rejects(orders({basis:'success'}),/unsupported_success_time_filter_for_duoli/);
});
test('scope and validation continue to run before all private native reads',async()=>{
 await as(viewer);try{const c=(await call({action:'catalog',platformId:undefined,startAt:undefined,endAt:undefined,direction:undefined})).platforms;assert.equal(c.length,1);await assert.rejects(call({platformId:other}),/platform_denied/);}finally{await as(owner);}
 await as('');try{await assert.rejects(call(),/login_required/);}finally{await as(owner);}
 await assert.rejects(call({utr:'private'}),/unsupported_filter/);await assert.rejects(call({endAt:'2026-11-10T00:00:00+07:00'}),/invalid_range/);
 await db.exec('set role authenticated');try{await assert.rejects(db.query('select * from private.duoli_order_details'),/permission denied/);await assert.rejects(db.query('select private.dashboard_admin_duoli_order_source()'),/permission denied/);}finally{await db.exec('reset role');}
});
test('production wrapper recomputes current-success amount after canonical provider merge',async()=>{
 await db.exec('begin');try{
  await db.exec("create or replace function private.dashboard_admin_live_provider_canonical(text,text,text) returns text language sql as $$select case when $3 in('YerePay','BayarPay') then 'CanonicalYere' else $3 end$$");
  await add('UANG','recharge','ALIAS','2','10000000',{provider_code:'45'});
  const r=(await db.query('select private.dashboard_admin_live_query($1::jsonb) data',[JSON.stringify(req())])).rows[0].data;
  const p=r.groups.provider.find(x=>x.provider==='CanonicalYere');assert.equal(p.all_count,4);assert.equal(p.created_success_count,2);assert.equal(Number(p.created_success_amount),30000);assert.equal(p.success_count,null);
  const daily=r.groups.daily.find(x=>x.provider==='CanonicalYere');assert.equal(Number(daily.created_success_amount),30000);
 }finally{await db.exec('rollback');}
});
test('intake is wired but updated-only payout progress never claims full creation coverage',async()=>{
 const intake=(await db.query('select private.dashboard_admin_live_order_intake() data')).rows[0].data;assert(intake.some(x=>x.rawPlatform==='UANG'&&x.system==='DOLI'));
 const feeds=(await db.query("select private.dashboard_admin_live_intake_coverage('{\"operation\":\"orderCatalog\"}') data")).rows[0].data.feeds.filter(x=>x.rawPlatform==='UANG');assert.equal(feeds.length,2);
 const r=(await db.query('select private.dashboard_admin_live_intake_coverage($1::jsonb) data',[JSON.stringify({operation:'rows',feedIds:feeds.map(x=>x.id),startAt:'2026-10-07',endAt:'2026-10-07'})])).rows[0].data;
 assert.equal(r.rows.length,2);for(const row of r.rows){assert.equal(row.received,true);assert.equal(row.complete,false);assert.equal(row.zeroConfirmed,false);assert.equal(row.sourceWindowCoverage[0].finalized,true);}
 assert.equal(r.rows.find(x=>x.evidence==='duoli_updated_stream_only').createdCoverageAvailable,false);
});
test('exact production baseline drift fails before changing existing readers',async()=>{
 await assert.rejects(db.exec(patch),/production_baseline_drift/);await db.exec('rollback');assert.deepEqual(await acl(),aclBefore);
});
