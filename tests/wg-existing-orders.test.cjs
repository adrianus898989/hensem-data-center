// Current production function CODE + synthetic records; no network or credentials.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),sql=n=>fs.readFileSync(path.join(root,'supabase',n),'utf8');
const patch=sql('migrations/20261001000000_wg_existing_orders.sql');
const live=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/wg-existing-production-functions.json'),'utf8'));
const names=['dashboard_admin_live_platforms','dashboard_admin_live_query_raw','dashboard_admin_live_drilldown_raw','dashboard_admin_live_provider_options','dashboard_admin_live_expand_provider_filter','dashboard_admin_live_order_intake'];
const owner='10000000-0000-0000-0000-000000000001',viewer='10000000-0000-0000-0000-000000000002';
const fixture=fs.readFileSync(path.join(__dirname,'uploaded-order-sources.test.cjs'),'utf8').split('\n').filter(l=>/^ create table (game66_platforms|game66_charge_orders|game66_withdraw_orders|ar_config_targets|ar_collected_orders|newar_detail_platforms|newar_detail_records)\(/.test(l)).join('\n');
function fn(source,name){const p=source.search(new RegExp('create(?: or replace)? function private\\.'+name+'\\(','i'));assert(p>=0,name);const tail=source.slice(p),m=tail.match(/as\s+(\$[a-z_]*\$)/i);assert(m,name);const end=tail.indexOf(m[1]+';',m.index+m[0].length);return tail.slice(0,end+m[1].length+1);}
let db,catalog,br,vn,originalAcl,nonWg;
const req=(o={})=>({action:'aggregate',platformId:br,startAt:'2026-09-29T00:00:00-03:00',endAt:'2026-09-30T00:00:00-03:00',direction:'charge',...o});
const call=async q=>(await db.query('select private.dashboard_admin_live_query($1::jsonb) data',[JSON.stringify(q)])).rows[0].data;
const drill=async q=>(await db.query('select private.dashboard_admin_live_drilldown_raw($1::jsonb) data',[JSON.stringify(req({view:'drilldown',...q}))])).rows[0].data;
const as=uid=>db.query("select set_config('test.uid',$1,false)",[uid]);
const acl=async()=>(await db.query('select proname,proacl::text,proowner,proconfig,prosecdef from pg_proc where pronamespace=\'private\'::regnamespace and proname=any($1::text[]) order by proname',[names])).rows;
async function add(site,biz,id,status,amount,created,success=null,more={}){
 const group=biz==='recharge'?({1:'pending',2:'success'}[status]||'unknown'):({1:'pending',2:'pending',3:'paying',4:'success',5:'failed',6:'cancelled',7:'rejected',8:'forced'}[status]||'unknown');
 const country=['278','8311','12588'].includes(site)?'BR':'VN',currency=country==='BR'?'BRL':'VND';
 const platform={278:'26BET',8311:'POPKKK',12588:'POPMIU',3257:'98VV',3605:'XX98'}[site];
 const data={system:'WG',country,platform,site_code:site,business:biz,order_number:id,third_order_number:'THIRD-'+id,member_id:'M1',provider:'RawPay',channel:'BANK',utr:'UTR-'+id,status_code:status,status_group:group,created_at:created,success_at:success,updated_at:biz==='recharge'?more.changed||created:null,operated_at:biz==='withdraw'?more.changed||created:null,completion_at_unverified:biz==='withdraw'?more.changed||created:null,captured_at:'2026-09-30T04:00:00Z',member_currency:currency,member_unit_scale:1,member_amount_units:amount,member_amount:amount,settlement_currency:currency,settlement_amount:amount,settlement_fee:'0.5',exchange_rate:'1',source_fields:{},version_at:'2026-09-30T04:00:00Z',content_hash:'synthetic',business_fields:{operator_name:'staff_a',operator_class:'manual',remark_sanitized:'业务备注包含未识别或敏感自由文本，原文已隐藏，待核实'},...more};
 delete data.changed;
 await db.query(`insert into public.wg_${biz}_details select (jsonb_populate_record(null::public.wg_${biz}_details,$1::jsonb)).*`,[JSON.stringify({...data,stored_at:'2026-09-30T04:00:00Z'})]);
}
before(async()=>{
 db=new PGlite();await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;grant usage on schema private,auth to authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table dashboard_profiles(auth_user_id uuid primary key,role text,active boolean,data_scope jsonb,permissions jsonb);
 create table dashboard_admin_preview_grants(auth_user_id uuid primary key,can_view boolean);
 create function private.dashboard_current_data_scope() returns jsonb language sql stable security definer as $$select data_scope from public.dashboard_profiles where auth_user_id=auth.uid() and active$$;
 create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable as $$select coalesce(s->>'mode'='all' or (s->'countries'?c and (not(s?'platforms') or s->'platforms'?p)),false)$$;
 ${fixture}
 alter table game66_charge_orders add column status_group text;
 create table dashboard_platform_team_map(source_system text,source_country text,source_platform text,country_code text,country_name text,platform_name text,team_name text,active boolean);
 create table lg_orders(country_code text,platform text,source_system text,order_kind text,order_no text,created_at timestamptz,updated_at timestamptz);
 create table lg_success_daily(country_code text,platform text,scope_type text,order_kind text,third_party text,raw_channel text);
 create function private.dashboard_admin_live_lg_scopes() returns table(country_code text,platform text) language sql as $$select null::text,null::text where false$$;
 create function public.lg_platform_country(text) returns text language sql as $$select 'PH'::text$$;
 create function public.lg_country_timezone(text) returns text language sql as $$select 'Asia/Manila'::text$$;
 create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[],directions text[]);
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text);
 create function private.dashboard_admin_live_confirmed_usdt_provider(text,text) returns text language sql as $$select null::text$$;
 create function private.dashboard_admin_live_provider_alias(text,text) returns text language sql as $$select $2$$;
 create function private.dashboard_admin_live_provider_alias_values(text,text[]) returns text[] language sql as $$select $2$$;
 create function private.dashboard_admin_live_provider_canonical(text,text,text) returns text language sql as $$select case when $3='RawPay' then 'CanonicalPay' else $3 end$$;
 create function private.dashboard_admin_live_withdraw_platforms() returns table(id uuid,scope_group text,source_name text) language sql as $$select null::uuid,null::text,null::text where false$$;
 insert into dashboard_profiles values('${owner}','owner',true,'{"mode":"all"}','{}'),('${viewer}','viewer',true,'{"countries":["BR"],"platforms":["26BET"]}','{}');
 insert into dashboard_admin_preview_grants values('${viewer}',true);
 insert into ar_config_targets values('IN','AR-EXISTING','印度','Asia/Kolkata','INR','AR');
 insert into ar_collected_orders(source_system,country_code,platform,order_kind,order_no,amount,status,applied_at,completed_at,raw_channel,channel_type) values('AR','IN','AR-EXISTING','recharge','AR-1',200,'已支付','2026-09-29 01:00','2026-09-29 01:05','ArPay','BANK');
 `);
 const receiver=fs.readFileSync(path.join(__dirname,'fixtures/wg-existing-collector-ddl.sql'),'utf8');
 await db.exec(receiver.split('-- BEGIN DETAILS\n')[1].split('-- END DETAILS')[0]);
 await db.exec(`alter table wg_recharge_details add column business_fields jsonb;alter table wg_withdraw_details add column business_fields jsonb;
 create table private.wg_detail_progress(site_code text,business text,basis text,cursor bigint,last_success_at timestamptz);`);
 await db.exec(fn(sql('admin-live-query.sql'),'dashboard_admin_live_scope'));
 await db.exec(fn(sql('admin-live-dynamic-amount-bands.sql'),'dashboard_admin_validate_amount_bands'));
 await db.exec(fn(sql('migrations/20260930225000_duration_precision_ranges.sql'),'dashboard_admin_validate_duration'));
 for(const name of names)await db.exec(live.find(x=>x.proname===name).definition);
 for(const name of ['dashboard_admin_live_remap_groups','dashboard_admin_live_remap_rows','dashboard_admin_live_query'])await db.exec(fn(sql('admin-live-configuration-query.sql'),name));
 for(const name of names)await db.exec(`revoke all on function private.${name}(${name.endsWith('platforms')||name.endsWith('intake')?'':'jsonb'}) from public,anon,authenticated;`);
 await db.exec('grant execute on function private.dashboard_admin_live_query(jsonb) to authenticated');
 await as(owner);originalAcl=await acl();const oldCat=(await call({action:'catalog'})).platforms;
 nonWg=await call(req({platformId:oldCat[0].id,startAt:'2026-09-29T00:00:00+05:30',endAt:'2026-09-30T00:00:00+05:30'}));
 await db.exec(patch);catalog=(await call({action:'catalog'})).platforms;br=catalog.find(x=>x.sourceName==='26BET').id;vn=catalog.find(x=>x.sourceName==='98VV').id;
 if(process.env.WG_TEST_HASHES)console.log((await db.query('select proname,md5(prosrc) hash from pg_proc where pronamespace=\'private\'::regnamespace and proname=any($1::text[]) order by proname',[names])).rows);
 for(const site of ['278','8311','12588','3257','3605'])await db.exec(`insert into dashboard_platform_team_map values('WG','${['278','8311','12588'].includes(site)?'BR':'VN'}','${{278:'26BET',8311:'POPKKK',12588:'POPMIU',3257:'98VV',3605:'XX98'}[site]}','${['278','8311','12588'].includes(site)?'BR':'VN'}',null,null,'M8',true)`);
 await add('278','recharge','PRIOR',2,'100','2026-09-28T23:59:00-03:00','2026-09-29T00:01:00-03:00');
 await add('278','recharge','START',2,'200','2026-09-29T00:00:00-03:00','2026-09-29T00:04:00-03:00');
 await add('278','recharge','CROSS-OUT',2,'300','2026-09-29T23:59:00-03:00','2026-09-30T00:01:00-03:00');
 await add('278','recharge','PENDING',1,'400','2026-09-29T02:00:00-03:00');
 await add('278','recharge','END',2,'500','2026-09-30T00:00:00-03:00','2026-09-30T00:01:00-03:00');
 for(const status of [1,2,3,4,5,6,7,8,99])await add('278','withdraw','W'+status,status,String(status),'2026-09-29T01:00:00-03:00',null,{changed:'2026-09-29T02:00:00-03:00'});
 await add('3257','withdraw','VN-USDT',4,'26060000','2026-09-29T00:01:00+07:00',null,{member_unit_scale:1000,member_amount_units:'26060',settlement_currency:'USDT',settlement_amount:'1000',settlement_fee:'1.2',exchange_rate:'26060'});
 await add('8311','recharge','OTHER-SITE',2,'1000','2026-09-29T01:00:00-03:00','2026-09-29T01:01:00-03:00');
});
after(async()=>db?.close());
test('five fixed WG catalogs use stable scoped IDs without touching older sources',async()=>{
 const wg=catalog.filter(x=>x.source==='wg');assert.equal(wg.length,5);assert.equal(new Set(wg.map(x=>x.id)).size,5);
 for(const p of wg){assert.equal(p.capabilities.withdrawSuccessTimeAvailable,false);assert.equal(p.capabilities.utr,true);assert.equal(p.capabilities.sourcePriority,'native_details_only_no_legacy_daily_union');}
 assert.equal(wg.find(x=>x.sourceName==='98VV').currency,'VND');assert.equal(wg.find(x=>x.sourceName==='26BET').timezone,'America/Sao_Paulo');
 const r=await call(req({platformId:nonWg.platform.id,startAt:nonWg.startAt,endAt:nonWg.endAt}));assert.deepEqual(r.summary,nonWg.summary);assert.deepEqual(await acl(),originalAcl);
});
test('recharge created and notify-time cohorts remain separate across midnight',async()=>{
 const r=await call(req());assert.equal(r.summary[0].all_count,3);assert.equal(r.summary[0].all_amount,'900');assert.equal(r.summary[0].created_success_count,2);assert.equal(r.summary[0].success_count,2);assert.equal(r.summary[0].success_amount,'300');
 assert.equal(r.capabilities.successTimeAvailable,true);assert.deepEqual(r.capabilities,r.platform.capabilities);
 const p=await call(req({view:'providers'}));const metrics=rows=>rows.map(x=>Object.fromEntries(Object.entries(x).filter(([k])=>!['date','hour','bucket'].includes(k))));assert.deepEqual(metrics(p.summary),metrics(r.summary));assert.equal(p.groups.provider[0].provider,'CanonicalPay');
 const d=await call(req({action:'details',status:'success'}));assert.equal(d.total,2);assert.deepEqual(d.rows.map(x=>x.order_number).sort(),['PRIOR','START']);
});
test('filters are exact, scoped, escaped and page IDs stable',async()=>{
 for(const extra of [{orderNumber:'START'},{thirdPartyOrderNumber:'THIRD-START'},{utr:'UTR-START'},{amountMin:'200',amountMax:'200'}])assert.equal((await call(req({action:'details',...extra}))).total,1);
 assert.equal((await call(req({action:'details',memberId:'M1',providers:['CanonicalPay'],channelTypes:['BANK'],currency:'BRL'}))).total,3);
 for(const extra of [{memberId:'nope'},{currency:'VND'},{channelTypes:['PIX']},{providers:['Absent']},{utr:"' OR true --"}])assert.equal((await call(req({action:'details',...extra}))).total,0);
 await assert.rejects(call(req({systemOrderId:'x'})),/unsupported_filter/);
 const a=await call(req({action:'details',limit:20,offset:1})),b=await call(req({action:'details',limit:20,offset:1}));assert.equal(a.total,3);assert.equal(a.rows.length,2);assert.deepEqual(a.rows.map(x=>x.id),b.rows.map(x=>x.id));
});
test('withdraw paying/forced/cancelled are not paid; operation is never success time',async()=>{
 const r=await call(req({direction:'withdraw'})),s=r.summary[0];assert.equal(s.all_count,9);assert.equal(s.created_success_count,1);assert.equal(s.pending_count,3);assert.equal(s.failed_count,2);assert.equal(s.rejected_count,1);assert.equal(s.unknown_count,2);assert.equal(s.success_count,null);assert.equal(s.success_amount,null);assert.equal(r.capabilities.successTimeAvailable,false);
 for(const group of ['daily','hourly','amount','provider'])assert(r.groups[group].every(x=>x.success_count===null&&x.success_amount===null));
 assert.equal(r.latencySummary.length,0);const d=await call(req({action:'details',direction:'withdraw',orderNumber:'W4'}));assert.equal(d.rows[0].success_at,null);assert(d.rows[0].operated_at);assert.equal(d.rows[0].source_status_group,'success');
 const forced=await call(req({action:'details',direction:'withdraw',orderNumber:'W8'}));assert.equal(forced.rows[0].status_group,'unknown');assert.equal(forced.rows[0].source_status_group,'forced');
});
test('VND scale and USDT settlement remain distinct in details and aggregates',async()=>{
 const q=req({platformId:vn,direction:'withdraw',startAt:'2026-09-29T00:00:00+07:00',endAt:'2026-09-30T00:00:00+07:00'});
 const r=await call(q);assert.equal(r.summary[0].all_amount,'26060000');assert.equal(r.summary[0].currency,'VND');
 const row=(await call({...q,action:'details'})).rows[0];assert.equal(row.amount,'26060000');assert.equal(row.member_amount_units,'26060');assert.equal(row.member_unit_scale,1000);assert.equal(row.actual_amount,null);assert.equal(row.withdraw_fee,null);assert.equal(row.settlement_currency,'USDT');assert.equal(row.settlement_amount,'1000');assert.equal(row.settlement_fee,'1.2');
 assert(!JSON.stringify(row).includes('source_fields'));assert(!JSON.stringify(row).includes('accountInfo'));
});
test('provider options and canonical filtering do not leak other sites or depend on display name',async()=>{
 const options=async()=>(await db.query('select private.dashboard_admin_live_provider_options($1::jsonb) data',[JSON.stringify({platformIds:[br],direction:'charge'})])).rows[0].data;
 assert.deepEqual((await options()).providers,['CanonicalPay']);
 await db.exec("update dashboard_platform_team_map set platform_name='Friendly name' where source_platform='26BET'");
 try{assert.equal((await call(req({providers:['CanonicalPay']}))).summary[0].all_count,3);assert.equal((await options()).providers[0],'CanonicalPay');}finally{await db.exec("update dashboard_platform_team_map set platform_name=null where source_platform='26BET'");}
});
test('latest amount/duration engines and linked drilldowns remain consistent',async()=>{
 const r=await call(req());for(const [kind,extra,predicate] of [['hourly',{hour:0},x=>x.hour===0],['amount',{bucket:'200'},x=>x.bucket==='200'],['matrix',{hour:0,bucket:'200'},x=>x.hour===0&&x.bucket==='200']]){const d=await drill({kind,...extra}),s=r.groups[kind].find(predicate);assert.equal(d.summary[0].all_count,s.all_count);assert.equal(d.summary[0].success_count,s.success_count);}
 const d=await drill({kind:'latency',durationVersion:2,bucket:1});assert.equal(d.total,1);assert.equal(d.summary[0].candidate_count,2);assert.equal(d.summary[0].success_amount,'100');
 const custom=await call(req({durationVersion:2,durationRange:{minSeconds:0,maxSeconds:180}}));assert.equal(custom.durationVersion,2);
 const bands={charge:[100,200,300,500,750,1000,2000,5000,10000,20000,50000],withdraw:[200,500,1000,2000,3000,5000,10000,15000,20000,30000,50000]},b=await call(req({amountBands:bands}));assert.equal(b.amountBandsVersion,1);
 const w=await drill({direction:'withdraw',kind:'latency',durationVersion:2,bucket:1});assert.equal(w.total,0);assert.equal(w.capabilities.withdrawSuccessTimeAvailable,false);
});
test('scope/authentication and base-table ACLs remain closed',async()=>{
 await as(viewer);try{const c=(await call({action:'catalog'})).platforms.filter(x=>x.source==='wg');assert.equal(c.length,1);assert.equal(c[0].sourceName,'26BET');await assert.rejects(call(req({platformId:vn})),/platform_denied/);}finally{await as(owner);}
 await as('');try{await assert.rejects(call({action:'catalog'}),/login_required/);}finally{await as(owner);}
 await db.exec('set role authenticated');try{await assert.rejects(db.query('select * from public.wg_recharge_details'),/permission denied/);await assert.rejects(db.query("select private.dashboard_admin_wg_order_source(null,false)"),/permission denied/);}finally{await db.exec('reset role');}
});
test('intake distinguishes completed zero collection and never reads old WG summaries',async()=>{
 await db.exec("insert into private.wg_detail_progress values('3605','recharge','created',1790701199,'2026-09-29T17:00:00Z')");
 const rows=(await db.query('select private.dashboard_admin_live_order_intake() data')).rows[0].data;
 const zero=rows.find(x=>x.rawPlatform==='XX98');assert(zero);assert.equal(zero.system,'WG');assert.equal(zero.lastDate,null);assert.deepEqual(zero.directions,['charge']);
 assert(!rows.some(x=>x.rawPlatform==='POPMIU'));
});
test('bounded pagination is repeatable, and native range plans retain site/time indexes',async()=>{
 await db.exec('begin');try{
  await db.exec(`insert into wg_recharge_details select (jsonb_populate_record(null::public.wg_recharge_details,to_jsonb(w)||jsonb_build_object('order_number','PAGE-'||n::text,'created_at','2026-09-29T12:00:00-03:00','success_at',null,'status_code',1,'status_group','pending'))).* from wg_recharge_details w cross join generate_series(1,45)n where w.site_code='278' and w.order_number='PENDING';`);
  const first=await call(req({action:'details',limit:20})),second=await call(req({action:'details',limit:20,offset:20})),third=await call(req({action:'details',limit:20,offset:40}));
  assert.equal(first.total,48);assert.equal(first.rows.length,20);assert.equal(second.rows.length,20);assert.equal(third.rows.length,8);assert.equal(new Set([...first.rows,...second.rows,...third.rows].map(x=>x.id)).size,48);assert.equal(first.hasMore,true);assert.equal(third.hasMore,false);
  await db.exec(`insert into wg_recharge_details select (jsonb_populate_record(null::public.wg_recharge_details,to_jsonb(w)||jsonb_build_object('order_number','OLD-'||n::text,'created_at','2025-09-29T12:00:00-03:00','success_at',null,'status_code',1,'status_group','pending'))).* from wg_recharge_details w cross join generate_series(1,10000)n where w.site_code='278' and w.order_number='PENDING';analyze wg_recharge_details;`);
  const source=(await db.query('select private.dashboard_admin_wg_order_source(null,false) s')).rows[0].s;
  await db.exec(`set local enable_seqscan=off;prepare wg_order_plan(uuid,text,text,text,timestamptz,timestamptz,text,text,text,text,text,text[],text[],text,numeric,numeric,int,int,text,timestamptz,text,text,text) as ${source};`);
  const plan=(await db.query(`explain (format json) execute wg_order_plan('${br}','26BET','BR','America/Sao_Paulo','2026-09-29T03:00Z','2026-09-30T03:00Z','charge','all',null,null,null,null,null,null,null,null,0,20,'details',now(),'BRL','26BET',null)`)).rows;
  const wire=JSON.stringify(plan);assert.match(wire,/wg_recharge_details_created|wg_recharge_details_status/);assert.doesNotMatch(wire,/Seq Scan/);
 }finally{await db.exec('deallocate all;rollback');}
});
test('range and filter validation is inherited rather than loosened for WG',async()=>{
 await assert.rejects(call(req({endAt:'2026-11-02T00:00:00-03:00'})),/invalid_range/);
 await assert.rejects(call(req({amountMin:'NaN'})),/invalid_range/);
 await assert.rejects(call(req({limit:10000})),/invalid_range/);
 await assert.rejects(call(req({status:'forced'})),/invalid_status_or_direction/);
 for(const action of ['query','details','aggregate'])for(const direction of ['all','withdraw'])await assert.rejects(call(req({action,direction,status:'success'})),/unsupported_success_time_filter_for_wg_withdraw/);
 await assert.rejects(call(req({providers:[null]})),/invalid_filter/);
});
test('idempotent install and baseline drift fail closed without ACL changes',async()=>{
 await db.exec(patch);assert.deepEqual(await acl(),originalAcl);
 await db.exec('begin');try{let d=live.find(x=>x.proname==='dashboard_admin_live_order_intake').definition;await db.exec(d.replace('p record;','p record; /* unexpected drift */'));await assert.rejects(db.exec(patch),/production_baseline_drift/);}finally{await db.exec('rollback');}
});
