// Real production reader definitions with synthetic data; no credentials or network.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const previousPatch=read('supabase/migrations/20261008050623_duoli_existing_orders.sql');
const patch=read('supabase/migrations/20261009044023_yash_live_readers.sql');
const baseline=JSON.parse(read('tests/fixtures/yash-reader-production-functions.json'));
const live=JSON.parse(read('tests/fixtures/duoli-reader-production-functions.json'));
function fn(source,name){const p=source.search(new RegExp('create(?: or replace)? function private\\.'+name+'\\(','i'));assert(p>=0,name);const tail=source.slice(p),m=tail.match(/as\s+(\$[a-z_]*\$)/i);assert(m,name);const end=tail.indexOf(m[1]+';',m.index+m[0].length);return tail.slice(0,end+m[1].length+1);}
const owner='10000000-0000-0000-0000-000000000001',viewer='10000000-0000-0000-0000-000000000002';
const fixture=read('tests/uploaded-order-sources.test.cjs').split('\n').filter(l=>/^ create table (game66_platforms|game66_charge_orders|game66_withdraw_orders|ar_config_targets|ar_collected_orders|newar_detail_platforms|newar_detail_records)\(/.test(l)).join('\n');
let db,id,other,aclBefore;
const as=uid=>db.query("select set_config('test.uid',$1,false)",[uid]);
const req=(extra={})=>({action:'aggregate',platformId:id,startAt:'2026-10-07T00:00:00+05:30',endAt:'2026-10-08T00:00:00+05:30',direction:'charge',...extra});
const call=async(extra={})=>(await db.query('select private.dashboard_admin_live_query_raw($1::jsonb) data',[JSON.stringify(req(extra))])).rows[0].data;
const drill=async(extra={})=>(await db.query('select private.dashboard_admin_live_drilldown_raw($1::jsonb) data',[JSON.stringify(req({view:'drilldown',kind:'hourly',hour:1,...extra}))])).rows[0].data;
const orders=async(extra={})=>(await db.query('select private.dashboard_admin_live_analysis_orders_raw($1::jsonb) data',[JSON.stringify(req({action:'analysisOrders',kind:'hourly',hour:1,basis:'created',...extra}))])).rows[0].data;
const acl=async()=>(await db.query("select proname,proacl::text,proowner,prosecdef from pg_proc where oid=any($1::regprocedure[]) order by proname",[baseline.map(x=>x.signature)])).rows;
async function add(order,status,amount,extra={}){
 const d={source_site:'yash',order_type:'deposit',order_no:order,uid:'first',child_order_no:'child-'+order,supplier_order_no:'provider-'+order,status,amount,fee:null,credited_amount:amount,created_at:'2026-10-07T01:00:00+05:30',completed_at:'2026-10-07T02:00:00+05:30',source_timezone:'Asia/Kolkata',supplier:'YerePay',channel:'UPI',currency:'INR',currency_basis:'source_field',raw_fields:{},received_at:'2026-10-08T00:00:00Z',...extra};
 await db.query('insert into private.yash_orders select (jsonb_populate_record(null::private.yash_orders,$1::jsonb)).*',[JSON.stringify(d)]);
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
 insert into dashboard_profiles values('${owner}','owner',true,'{"mode":"all"}','{}'),('${viewer}','viewer',true,'{"countries":["IN","印度"],"platforms":["YASH.BET"]}','{}');
 insert into dashboard_admin_preview_grants values('${viewer}',true);
 insert into dashboard_platform_team_map select case when p in('FB168','FB333') then 'DOLI' else 'REPORT' end,'印尼',p,'ID','印尼',p,'M8',true from unnest(array['UANG','HOT985','IND666','FB168','FB333'])p;
 `);
 await db.exec(fn(read('supabase/admin-live-query.sql'),'dashboard_admin_live_scope'));
 await db.exec(fn(read('supabase/admin-live-dynamic-amount-bands.sql'),'dashboard_admin_validate_amount_bands'));
 await db.exec(fn(read('supabase/migrations/20260930225000_duration_precision_ranges.sql'),'dashboard_admin_validate_duration'));
 for(const item of live) await db.exec(item.definition);
 for(const item of live) await db.exec(`revoke all on function ${item.signature} from public,anon,authenticated;`);
 await db.exec(previousPatch);
 for(const item of baseline)await db.exec(item.definition);
 await db.exec(`
 create table private.yash_orders(source_site text default 'yash',order_type text,order_no text,uid text,child_order_no text,supplier_order_no text,status text,amount numeric,fee numeric,credited_amount numeric,created_at timestamptz,completed_at timestamptz,source_timezone text,supplier text,channel text,payment_method text,source_category text,order_category text,is_first_order boolean,operator text,currency text,currency_basis text,raw_fields jsonb,observed_at timestamptz,received_at timestamptz,primary key(order_type,order_no));
 create table private.yash_sync_windows(order_type text,stream text,start_at timestamptz,end_exclusive timestamptz,source_count bigint,uploaded_count bigint,stored_count bigint,complete boolean,observed_at timestamptz,received_at timestamptz,source_timezone text,primary key(order_type,stream,start_at,end_exclusive));
 alter table private.yash_orders enable row level security;
 alter table private.yash_sync_windows enable row level security;
 insert into dashboard_platform_team_map values('KB','印度','YASH.BET','IN','印度','YASH.BET','M8',true);
 `);
 await db.exec(fn(read('supabase/migrations/20260930222000_order_intake_fast_path.sql'),'dashboard_admin_live_intake_order_feeds'));
 await db.exec('grant execute on function private.dashboard_admin_live_query(jsonb) to authenticated');
 aclBefore=await acl();await db.exec(patch);await as(owner);
 id=(await call({action:'catalog',platformId:undefined,startAt:undefined,endAt:undefined,direction:undefined})).platforms.find(x=>x.source==='kb').id;
 await add('A','充值成功',100);await add('B','用户取消',200);await add('C','待核实',300,{uid:'second'});
 await add('D','人工确认成功',400,{created_at:'2026-10-06T23:00:00+05:30'});
 await add('E','充值成功',500,{created_at:'2026-10-08T00:00:00+05:30',completed_at:'2026-10-08T01:00:00+05:30'});
 await add('W1','已提现',80,{order_type:'withdrawal',fee:4,credited_amount:76});
 await add('W2','人工确认成功',90,{order_type:'withdrawal'});
 await add('W3','已驳回',70,{order_type:'withdrawal'});
 await add('W4','已退币',60,{order_type:'withdrawal'});
 await add('W5','已罚没',50,{order_type:'withdrawal'});
 await add('W6','unrecognized',40,{order_type:'withdrawal'});
});
after(async()=>db?.close());
const wrapped=async(extra={})=>(await db.query('select private.dashboard_admin_live_query($1::jsonb) data',[JSON.stringify(req(extra))])).rows[0].data;
const inTx=async cb=>{await db.exec('begin');try{await cb();}finally{await db.exec('rollback');}};
test('KB catalog preserves stable scoped identity and accurate capabilities, private helpers remain private',async()=>{
 const r=await call(),p=r.platform;
 assert.equal(p.source,'kb');assert.equal(p.name,'YASH.BET');assert.equal(p.country,'印度');assert.equal(p.team,'M8');assert.equal(p.timezone,'Asia/Kolkata');
 assert.equal(id,(await db.query("select md5('kb:IN:YASH.BET')::uuid id")).rows[0].id);
 assert.equal(r.capabilities.successTimeBasis,'source_completed_at');assert.equal(r.capabilities.paymentSuccessTimeAvailable,false);assert.equal(r.capabilities.latencyBasis,'order_processing_duration');assert.equal(r.capabilities.memberDailyAvailable,true);assert.equal(r.capabilities.historicalFees,false);
 assert.deepEqual(await acl(),aclBefore);
 const grants=(await db.query("select proname,has_function_privilege('authenticated',oid,'execute') auth,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') service from pg_proc where proname like 'dashboard_admin_yash_%'")).rows;
 assert(grants.length>=6);for(const g of grants){assert.equal(g.auth,false);assert.equal(g.anon,false);assert.equal(g.service,false);}
 await as(viewer);try{assert.equal((await call()).platform.id,id);await assert.rejects(call({platformId:'00000000-0000-0000-0000-000000000001'}),/platform_denied/);}finally{await as(owner);}
});
test('creation and source-completion cohorts remain separate across midnight and all dimensions',async()=>{
 const r=await call(),s=r.summary[0];assert.equal(s.all_count,3);assert.equal(Number(s.all_amount),600);assert.equal(s.success_count,2);assert.equal(Number(s.success_amount),500);assert.equal(s.created_success_count,1);assert.equal(s.rejected_count,1);assert.equal(s.unknown_count,1);
 for(const key of ['daily','hourly','provider','amount','matrix','amount_range','matrix_range'])assert.equal(r.groups[key].reduce((n,x)=>n+x.success_count,0),2,key);
 const fast=(await call({view:'providers'})).summary[0];assert.equal(fast.all_count,3);assert.equal(fast.success_count,2);
 const d=await call({action:'details'});assert.equal(d.total,3);assert(!d.rows.some(x=>x.order_number==='D'));assert(d.rows.every(x=>!('raw_fields' in x)));
 assert.deepEqual((await call({action:'details',status:'success'})).rows.map(x=>x.order_number).sort(),['A','D']);
 assert.equal((await wrapped()).summary[0].success_count,2);
});
test('confirmed statuses only, missing reversed infinite future completion cannot fabricate success',async()=>inTx(async()=>{
 const w=(await call({direction:'withdraw'})).summary[0];assert.equal(w.all_count,6);assert.equal(w.success_count,2);assert.equal(w.rejected_count,2);assert.equal(w.failed_count,1);assert.equal(w.unknown_count,1);
 for(const [order,completed] of [['NULL',null],['REVERSED','2026-10-07T00:00:00+05:30'],['INF','infinity'],['FUTURE','2999-01-01T00:00:00Z']]){
  await add(order,'充值成功',10,{completed_at:completed});const d=(await call({action:'details',orderNumber:order})).rows[0];assert.equal(d.success_at,null);assert.equal(d.latency_ms,null);
 }
 assert.equal((await call()).summary[0].success_count,2);
 await add('START','充值成功',12,{created_at:'2026-10-06T21:00:00+05:30',completed_at:'2026-10-07T00:00:00+05:30'});
 await add('END','充值成功',13,{completed_at:'2026-10-08T00:00:00+05:30'});
 assert.equal((await call()).summary[0].success_count,3);
}));
test('order, third-party, member, provider, currency and amount filters agree in detail and analytical paths',async()=>{
 const d=(await call({action:'details',thirdPartyOrderNumber:'provider-A'}));assert.equal(d.total,1);assert.equal(d.rows[0].order_number,'A');assert.equal(d.rows[0].third_party_order_number,'provider-A');assert.equal(d.rows[0].system_order_id,null);
 assert.equal((await call({memberId:'second'})).summary[0].all_count,1);
 assert.equal((await call({currency:'USD'})).summary.length,0);
 assert.equal((await call({amountMin:150,amountMax:350})).summary[0].all_count,2);
 const q=await drill({thirdPartyOrderNumber:'provider-A'});assert.equal(q.summary[0].all_count,1);
 const a=await orders({thirdPartyOrderNumber:'provider-A'});assert.equal(a.total,1);assert.equal(a.rows[0].order_number,'A');
 await assert.rejects(call({systemOrderId:'child-A'}),/unsupported_filter/);
});
test('unknown currency and unknown monetary fields remain unavailable instead of zero or INR',async()=>inTx(async()=>{
 await add('U','充值成功',999999,{currency:null,currency_basis:'token_type_unverified',fee:5,supplier:null,channel:'USDT'});
 const r=await call(),unknown=r.summary.find(x=>x.currency===null);assert.equal(unknown.all_count,1);assert.equal(unknown.all_amount,null);assert.equal(unknown.success_amount,null);
 const d=(await call({action:'details',orderNumber:'U'})).rows[0];assert.equal(d.currency,null);assert.equal(d.amount,null);assert.equal(d.actual_amount,null);assert.equal(d.withdraw_fee,null);assert.equal(d.provider,'未识别通道');
}));
test('provider alias options and filters reuse existing mapping, recorded fee remains a distinct source value',async()=>{
 const options=(await db.query('select private.dashboard_admin_live_provider_options($1::jsonb) data',[JSON.stringify({platformIds:[id],direction:'charge'})])).rows[0].data;assert(options.providers.includes('CanonicalYere'));
 const s=(await wrapped({providers:['CanonicalYere']})).summary[0];assert.equal(s.all_count,3);assert.equal(s.success_count,2);
 const d=(await call({action:'details',direction:'withdraw',orderNumber:'W1'})).rows[0];assert.equal(Number(d.withdraw_fee),4);assert.equal(Number(d.actual_amount),76);
});
test('memberDaily deduplicates UID per business date/direction while preserving completion cohort',async()=>{
 const request=req();delete request.action;
 const r=(await db.query('select private.dashboard_admin_live_member_daily($1::jsonb) data',[JSON.stringify(request)])).rows[0].data;
 assert.equal(r.capabilities.memberIdentity,true);assert.equal(r.capabilities.dedupe,'platform_local_date_direction_member');assert.equal(r.capabilities.successBasis,'success_at');
 assert.equal(r.rows[0].created_order_count,3);assert.equal(r.rows[0].created_member_count,2);assert.equal(r.rows[0].created_members_ge2,1);assert.equal(r.rows[0].success_order_count,2);assert.equal(r.rows[0].success_member_count,1);
});
const evidence=async(day,kind='recharge')=>(await db.query('select private.dashboard_admin_yash_day_evidence(\'IN\',\'YASH.BET\',$1,$2::date) data',[kind,day])).rows[0].data;
async function window(start,end,n,{kind='deposit',stream='createTime',complete=true,stored=n}={}){
 await db.query("insert into private.yash_sync_windows(order_type,stream,start_at,end_exclusive,source_count,uploaded_count,stored_count,complete,received_at) values($1,$2,$3,$4,$5,$5,$6,$7,now())",[kind,stream,start,end,n,stored,complete]);
}
test('coverage requires complete contiguous creation windows and reconciled counts, success windows never certify creation',async()=>inTx(async()=>{
 let e=await evidence('2026-10-07');assert.equal(e.complete,false);assert.equal(e.received,true);
 await window('2026-10-07T00:00:00+05:30','2026-10-08T00:00:00+05:30',2,{stream:'completeTime'});
 assert.equal((await evidence('2026-10-07')).complete,false);
 await window('2026-10-07T00:00:00+05:30','2026-10-07T12:00:00+05:30',3);
 assert.equal((await evidence('2026-10-07')).complete,false);
 await window('2026-10-07T12:00:00+05:30','2026-10-08T00:00:00+05:30',0);
 e=await evidence('2026-10-07');assert.equal(e.complete,true);assert.equal(e.count,3);assert.equal(e.zeroConfirmed,false);
 const feed=(await db.query('select private.dashboard_admin_live_intake_order_feeds(now()) feeds')).rows[0].feeds.find(x=>x.system==='kb'&&x.direction==='charge');assert(feed);
 const r=(await db.query('select private.dashboard_admin_live_intake_coverage($1::jsonb) data',[JSON.stringify({operation:'rows',feedIds:[feed.id],startAt:'2026-10-07',endAt:'2026-10-07'})])).rows[0].data;assert.equal(r.rows[0].complete,true);assert.equal(r.rows[0].fetchedCount,3);assert.equal(r.rows[0].createdCoverageAvailable,true);
 await add('LATE','充值成功',1);assert.equal((await evidence('2026-10-07')).complete,false,'later missing row invalidates stale reconciliation');
}));
test('historical zero needs full acknowledgement; partial and current-day windows never claim full-day completeness',async()=>inTx(async()=>{
 assert.equal((await evidence('2020-01-01')).zeroConfirmed,false);
 await window('2020-01-01T00:00:00+05:30','2020-01-02T00:00:00+05:30',0,{complete:false});assert.equal((await evidence('2020-01-01')).complete,false);
 await db.exec("update private.yash_sync_windows set complete=true");assert.equal((await evidence('2020-01-01')).zeroConfirmed,true);
 const x=(await db.query("select (now() at time zone 'Asia/Kolkata')::date::text as day_value,((now() at time zone 'Asia/Kolkata')::date+1)::text as next_value")).rows[0];
 await window(x.day_value+'T00:00:00+05:30',x.next_value+'T00:00:00+05:30',0);assert.equal((await evidence(x.day_value)).complete,false);
}));
test('processing latency is creation to valid source completion, available in all drill paths with explicit basis',async()=>{
 const d=(await call({action:'details',orderNumber:'A'})).rows[0];assert.equal(Number(d.latency_ms),3600000);
 const q=await drill({kind:'latency',hour:undefined,bucket:2});assert.equal(q.capabilities.latencyBasis,'order_processing_duration');assert.equal(q.capabilities.paymentSuccessTimeAvailable,false);
 const r=await orders({kind:'latency',hour:undefined,bucket:2,basis:'success'});assert.equal(r.capabilities.latencyBasis,'order_processing_duration');assert(r.rows.some(x=>x.order_number==='A'));assert(r.rows.every(x=>Number(x.latency_ms)>0));
});
test('stable pagination, canonical provider selection and changed preview authorization preserve the live-reader boundaries',async()=>inTx(async()=>{
 for(let n=0;n<22;n++)await add('PAGE-'+String(n).padStart(2,'0'),'充值成功',1,{uid:'repeated',supplier:n%2?'OtherPay':'YerePay'});
 const a=await call({action:'details',limit:20}),b=await call({action:'details',limit:20,offset:20});assert.equal(a.total,25);assert.equal(b.total,25);assert.equal(new Set([...a.rows,...b.rows].map(x=>x.id)).size,25);
 const raw=(await call({providers:['YerePay']})).summary[0],canonical=(await wrapped({providers:['CanonicalYere']})).summary[0];assert.equal(raw.all_count,canonical.all_count);assert.equal(raw.success_count,canonical.success_count);
 const denied='10000000-0000-0000-0000-000000000003';await db.query('insert into dashboard_profiles values($1,\'viewer\',true,\'{"countries":["IN"],"platforms":["OTHER"]}\',\'{}\')',[denied]);await db.query('insert into dashboard_admin_preview_grants values($1,true)',[denied]);
 await as(denied);await db.exec('savepoint denial');try{await assert.rejects(call(),/platform_denied/);}finally{await db.exec('rollback to denial');await as(owner);}
 await as(viewer);try{await db.query('update dashboard_admin_preview_grants set can_view=false where auth_user_id=$1',[viewer]);await db.exec('savepoint grant_denial');try{await assert.rejects(call(),/permission|denied|preview/);}finally{await db.exec('rollback to grant_denial');}}finally{await as(owner);}
}));
test('all documented source status labels map to the correct current-status groups without changing the original text',async()=>inTx(async()=>{
 const expected={deposit:{已创建:'pending',处理中:'pending',充值成功:'success',充值失败:'failed',用户取消:'rejected',订单过期:'failed',人工确认成功:'success'},withdrawal:{审核中:'pending',提现中:'pending',已提现:'success',已驳回:'rejected',已退币:'rejected',提现失败:'failed',审核通过:'pending',已罚没:'failed',人工确认成功:'success'}};
 for(const [order_type,states] of Object.entries(expected))for(const [status,group] of Object.entries(states)){
  const order='STATUS-'+status;await add(order,status,1,{order_type});const d=(await call({action:'details',direction:order_type==='deposit'?'charge':'withdraw',orderNumber:order})).rows[0];assert.equal(d.status,status);assert.equal(d.status_group,group);if(group!=='success')assert.equal(d.success_at,null);
 }
}));
