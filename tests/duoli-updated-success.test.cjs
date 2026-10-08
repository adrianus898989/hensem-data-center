// Production reader code, synthetic orders, no credentials or network access.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const previousPatch=read('supabase/migrations/20261008050623_duoli_existing_orders.sql');
const patch=read('supabase/migrations/20261008055734_duoli_updated_success.sql');
const current=JSON.parse(read('tests/fixtures/duoli-updated-success-production-functions.json'));
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
const acl=async()=>(await db.query("select proname,proacl::text,proowner,prosecdef from pg_proc where oid=any($1::regprocedure[]) order by proname",[current.map(x=>x.signature)])).rows;
async function add(platform,business,order,status,amount,extra={}){
 const d={platform,business,source_order_id:order,order_no:order,system_name:'DOLI',country:'ID',member_id:'synthetic-member',
  created_at:'2026-10-07T01:00:00+07:00',created_day:'2026-10-07',updated_at:'2026-10-07T02:00:00+07:00',audit_completed_at:'2026-10-07T01:01:00+07:00',status_code:status,currency:'IDR',provider:'unsafe-affiliate-fallback',provider_code:'124',channel:'BANK',amount_raw:amount,amount_source:business==='recharge'?'original_price':'gold',received_at:'2026-10-08T04:41:00Z',...extra};
 await db.query('insert into private.duoli_order_details select (jsonb_populate_record(null::private.duoli_order_details,$1::jsonb)).*',[JSON.stringify(d)]);
}
before(async()=>{
 db=new PGlite();await db.exec(`set check_function_bodies=off;create schema auth;create schema private;create role anon;create role authenticated;create role service_role;
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
 await db.exec(previousPatch);
 for(const item of current)await db.exec(item.definition);
 await db.exec('grant execute on function private.dashboard_admin_live_query(jsonb) to authenticated');
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

const wrapped=async(extra={})=>(await db.query('select private.dashboard_admin_live_query($1::jsonb) data',[JSON.stringify(req(extra))])).rows[0].data;
const inTx=async cb=>{await db.exec('begin');try{await cb();}finally{await db.exec('rollback');}};
test('updated-time basis is explicit while payment time and latency remain unavailable',async()=>{
 const catalog=(await call({action:'catalog',platformId:undefined,startAt:undefined,endAt:undefined,direction:undefined})).platforms;
 for(const p of catalog){assert.equal(p.capabilities.successTimeBasis,'order_updated_at');assert.equal(p.capabilities.successTimeAvailable,true);assert.equal(p.capabilities.chargeSuccessTimeAvailable,true);assert.equal(p.capabilities.withdrawSuccessTimeAvailable,true);assert.equal(p.capabilities.paymentSuccessTimeAvailable,false);assert.equal(p.capabilities.latencyAvailable,false);assert.equal(p.capabilities.sourceCompletenessVerified,false);}
 assert.deepEqual(await acl(),aclBefore);
 const helper=(await db.query("select prosecdef,proconfig,has_function_privilege('authenticated',oid,'execute') authed,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') service_role from pg_proc where oid='private.dashboard_admin_duoli_success_updated_at(text,text,timestamptz,timestamptz,timestamptz)'::regprocedure")).rows[0];
 assert.equal(helper.prosecdef,false);assert.deepEqual(helper.proconfig,['search_path=""']);assert.equal(helper.authed,false);assert.equal(helper.anon,false);assert.equal(helper.service_role,false);
});
test('cross-day successes join update day without inflating creation totals',async()=>{
 const r=await call(),s=r.summary[0];
 assert.equal(s.all_count,4);assert.equal(Number(s.all_amount),140000);
 assert.equal(s.created_success_count,1);assert.equal(Number(s.created_success_amount),20000);
 assert.equal(s.success_count,2);assert.equal(Number(s.success_amount),110000);
 assert.equal(r.successTimeBasis,'order_updated_at');assert.equal(r.capabilities.successTimeBasis,'order_updated_at');
 for(const key of ['daily','hourly','provider','amount','matrix','amount_range','matrix_range'])assert.equal(r.groups[key].reduce((sum,x)=>sum+x.success_count,0),2,key);
 const provider=(await call({view:'providers'})).summary[0];assert.equal(provider.success_count,2);assert.equal(Number(provider.success_amount),110000);
 const all=await call({action:'details'});assert.equal(all.total,4);assert(!all.rows.some(x=>x.order_number==='OLD'));
 const success=await call({action:'details',status:'success'});assert.equal(success.total,2);assert.deepEqual(success.rows.map(x=>x.order_number).sort(),['OLD','START']);
});
test('withdrawal only statuses 6 and 2 are success, pending and audit clocks never qualify',async()=>{
 const s=(await call({direction:'withdraw'})).summary[0];assert.equal(s.all_count,7);assert.equal(s.success_count,2);assert.equal(Number(s.success_amount),100000);assert.equal(s.pending_count,2);assert.equal(s.rejected_count,2);
 const rows=(await call({action:'details',direction:'withdraw',status:'success'})).rows;assert.deepEqual(rows.map(x=>x.status).sort(),['2','6']);
 assert(rows.every(x=>new Date(x.success_at).toISOString()==='2026-10-06T19:00:00.000Z')); // 02:00 Jakarta, not 01:01 audit
});
test('missing, reversed, non-finite, or future update times do not manufacture success events',async()=>inTx(async()=>{
 for(const [order,update] of [['NULL',null],['REVERSE','2026-10-07T00:59:59+07:00'],['INFINITE','infinity'],['FUTURE','2999-01-01T00:00:00Z']])await add('UANG','recharge',order,'2','1000000',{updated_at:update});
 const s=(await call()).summary[0];assert.equal(s.all_count,8);assert.equal(s.created_success_count,5);assert.equal(Number(s.created_success_amount),24000);assert.equal(s.success_count,2);
 for(const orderNumber of ['NULL','REVERSE','INFINITE','FUTURE']){const r=await call({action:'details',orderNumber});assert.equal(r.total,1);assert.equal(r.rows[0].success_at,null);assert.equal(r.rows[0].latency_ms,null);}
 const value=(await db.query("select private.dashboard_admin_duoli_success_updated_at('recharge','2','2026-10-07T00:00Z','2026-10-07T01:00Z','2026-10-07T00:30Z') value")).rows[0].value;assert.equal(value,null);
}));
test('half-open update boundaries and later success dates remain independent of creation day',async()=>inTx(async()=>{
 await add('UANG','recharge','AT-START','2','3000000',{created_at:'2026-10-06T22:00:00+07',created_day:'2026-10-06',updated_at:'2026-10-07T00:00:00+07'});
 await add('UANG','recharge','AT-END','2','4000000',{updated_at:'2026-10-08T00:00:00+07'});
 const s=(await call()).summary[0];assert.equal(s.all_count,5);assert.equal(s.created_success_count,2);assert.equal(s.success_count,3);assert.equal(Number(s.success_amount),113000);
 const rows=(await call({action:'details',status:'success'})).rows;assert(rows.some(x=>x.order_number==='AT-START'));assert(!rows.some(x=>x.order_number==='AT-END'));
 const next=(await call({startAt:'2026-10-08T00:00:00+07:00',endAt:'2026-10-09T00:00:00+07:00'})).summary[0];assert.equal(next.success_count,1);assert.equal(Number(next.success_amount),4000);
}));
test('hourly and custom success drilldowns match summary and use update hour',async()=>{
 const atCreate=await drill({hour:1});assert.equal(atCreate.summary[0].all_count,4);assert.equal(atCreate.summary[0].success_count,0);
 const atUpdate=await drill({hour:2});assert.equal(atUpdate.summary[0].all_count,0);assert.equal(atUpdate.summary[0].success_count,2);assert.equal(Number(atUpdate.summary[0].success_amount),110000);
 const d=await orders({hour:2,basis:'success'});assert.equal(d.total,2);assert(d.rows.every(x=>x.latency_ms===null));assert.equal(d.capabilities.successTimeBasis,'order_updated_at');
 const created=await orders();assert.equal(created.total,4);assert(created.rows.every(x=>x.latency_ms===null));
 const custom=await orders({kind:'custom',hour:undefined,hourRange:{minHour:2,maxHour:3},basis:'success'});assert.equal(custom.total,2);
});
test('provider aliases, missing amounts, and wrapper recomputation retain both cohorts',async()=>inTx(async()=>{
 await db.exec("create or replace function private.dashboard_admin_live_provider_canonical(text,text,text) returns text language sql as $$select case when $3 in('YerePay','BayarPay') then 'CanonicalYere' else $3 end$$");
 await add('UANG','recharge','ALIAS','2','10000000',{provider_code:'45'});
 const r=await wrapped({providers:['CanonicalYere']});assert.equal(r.summary[0].all_count,4);assert.equal(r.summary[0].success_count,3);assert.equal(Number(r.summary[0].success_amount),120000);assert.equal(Number(r.summary[0].created_success_amount),30000);
 const p=r.groups.provider.find(x=>x.provider==='CanonicalYere');assert.equal(p.success_count,3);assert.equal(Number(p.success_amount),120000);assert.equal(Number(p.created_success_amount),30000);
 await add('UANG','recharge','UNPRICED','2',null);const s=(await call()).summary[0];assert.equal(s.success_count,4);assert.equal(s.success_amount,null);
}));
test('payment latency is blocked server-side and omitted from all allowed responses',async()=>{
 for(const extra of [{},{durationVersion:2},{durationVersion:2,durationRange:{minSeconds:0,maxSeconds:180}}]){
  const r=await call(extra);assert.deepEqual(r.latencySummary,[]);for(const key of ['latency','latency_thresholds','latency_custom'])if(key in r.groups)assert.deepEqual(r.groups[key],[]);
 }
 for(const direction of ['charge','withdraw','all']){
  await assert.rejects(drill({kind:'latency',hour:undefined,bucket:0,direction}),/unsupported_payment_latency_for_duoli/);
  await assert.rejects(orders({kind:'latency',hour:undefined,bucket:0,basis:'success',direction}),/unsupported_payment_latency_for_duoli/);
  const rows=(await call({action:'details',status:'success',direction})).rows;assert(rows.every(x=>x.latency_ms===null));
 }
 await assert.rejects(call({view:'latency'}),/invalid_view/);
});
test('scope, direct-table protection, and exact production baseline guards remain enforced',async()=>{
 await as(viewer);try{await assert.rejects(call({platformId:other,status:'success'}),/platform_denied/);}finally{await as(owner);}
 await as('');try{await assert.rejects(call({status:'success'}),/login_required/);}finally{await as(owner);}
 await db.exec('set role authenticated');try{await assert.rejects(db.query('select * from private.duoli_order_details'),/permission denied/);}finally{await db.exec('reset role');}
 await assert.rejects(db.exec(patch),/production_baseline_drift/);await db.exec('rollback');assert.deepEqual(await acl(),aclBefore);
});

