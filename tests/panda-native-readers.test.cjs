const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const reference=root;
const baseline=JSON.parse(read('tests/fixtures/production-functions.json'));
const schema=JSON.parse(read('tests/fixtures/panda-schema.json'));
const patch=read('supabase/migrations/'+fs.readdirSync(path.join(root,'supabase/migrations')).find(x=>x.endsWith('_panda_native_order_readers.sql')));
const fixture=fs.readFileSync(path.join(reference,'tests/uploaded-order-sources.test.cjs'),'utf8').split('\n').filter(l=>/^ create table (game66_platforms|game66_charge_orders|game66_withdraw_orders|ar_config_targets|ar_collected_orders|newar_detail_platforms|newar_detail_records)\(/.test(l)).join('\n');
const owner='10000000-0000-0000-0000-000000000001',viewer='10000000-0000-0000-0000-000000000002';
let db,id,label='2V222',platform=schema.scopes.find(x=>x.platform_label===label).platform,aclBefore;
const as=uid=>db.query("select set_config('test.uid',$1,false)",[uid]);
const req=x=>({action:'aggregate',platformId:id,startAt:'2026-10-01T00:00:00-03:00',endAt:'2026-10-02T00:00:00-03:00',direction:'charge',...x});
const rpc=async(name,r)=>(await db.query('select private.'+name+'($1::jsonb) data',[JSON.stringify(r)])).rows[0].data;
const call=(x={})=>rpc('dashboard_admin_live_query_raw',req(x));
const drill=(x={})=>rpc('dashboard_admin_live_drilldown_raw',req({view:'drilldown',kind:'hourly',hour:1,...x}));
const orders=(x={})=>rpc('dashboard_admin_live_analysis_orders_raw',req({action:'analysisOrders',basis:'created',kind:'hourly',hour:1,...x}));
const acl=async()=>(await db.query("select proname,proacl::text,proowner,prosecdef,proconfig from pg_proc where oid=any($1::regprocedure[]) order by proname",[Object.keys(JSON.parse(read('tests/fixtures/panda-candidate-functions.json'))).map(x=>'private.'+x+(x==='dashboard_admin_live_platforms'?'()':'(jsonb)'))])).rows;
async function add(order,status,minor,extra={}){
const r={platform,direction:'deposit',order_id:order,provider_id:'10',provider_name:'PayA',channel_id:'1',channel_name:'PIX',amount_minor:minor,pay_amount_minor:minor,credited_amount_minor:null,discount_minor:null,fee_minor:null,currency:'BRL',raw_status:status==='success'?'PAID':status,status,credit_status:null,created_at:'2026-10-01T01:00:00-03:00',source_updated_at:'2026-10-01T02:00:00-03:00',completed_at:status==='success'?'2026-10-01T02:00:00-03:00':null,observed_at:'2026-10-03T00:00:00Z',row_hash:'synthetic',received_at:'2026-10-03T00:00:00Z',...extra};
await db.query('insert into public.panda_order_details select (jsonb_populate_record(null::public.panda_order_details,$1::jsonb)).*',[JSON.stringify(r)]);
}
let receiptClock=0;
async function receipt(start,end,{direction='deposit',axis='created_at',verified=true}={}){
const observed=new Date(Date.UTC(2026,9,3)+1000*++receiptClock).toISOString();
const scan=crypto.randomUUID(),batch=crypto.randomUUID();
const count=(await db.query('select count(*) n from public.panda_order_details where platform=$1 and direction=$2 and created_at>=$3 and created_at<$4',[platform,direction,start,end])).rows[0].n;
await db.query(`insert into panda_private.order_scans(scan_id,platform,direction,window_axis,window_start,window_end,observed_at,finalized_at) values($1,$2,$3,$4,$5,$6,'${observed}','${observed}')`,[scan,platform,direction,axis,start,end]);
await db.query(`insert into public.panda_order_coverage_receipts(scan_id,batch_id,platform,direction,window_axis,window_start,window_end,observed_at,expected_count,member_ids_hash,source_pages_total,row_axis_bounds_verified,coverage_kind,received_at) values($1,$2,$3,$4,$5,$6,$7,'${observed}',$8,'synthetic',1,$9,$10,'${observed}')`,[scan,batch,platform,direction,axis,start,end,count,verified,verified?'row_axis_verified':'source_query_membership']);
await db.query(`insert into panda_private.order_scan_members(scan_id,order_id,batch_id,row_hash,axis_value) select $1,order_id,$2,row_hash,created_at from public.panda_order_details where platform=$3 and direction=$4 and created_at>=$5 and created_at<$6`,[scan,batch,platform,direction,start,end]);return scan;
}
const evidence=async(start='2026-10-01T03:00Z',end='2026-10-02T03:00Z',direction='charge')=>(await db.query('select private.dashboard_admin_panda_range_evidence($1,$2,$3,$4) data',[label,direction,start,end])).rows[0].data;
const tx=async f=>{await db.exec('begin');try{await f();}finally{await db.exec('rollback');}};
before(async()=>{
 db=new PGlite();await db.exec(`set check_function_bodies=off;create schema auth;create schema private;create role anon;create role authenticated;create role service_role;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table dashboard_profiles(auth_user_id uuid primary key,role text,active boolean,data_scope jsonb,permissions jsonb);
 create table dashboard_admin_preview_grants(auth_user_id uuid primary key,can_view boolean);
 create function private.dashboard_current_data_scope() returns jsonb language sql stable security definer as $$select data_scope from public.dashboard_profiles where auth_user_id=auth.uid() and active$$;
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
await db.exec(`create schema panda_private;
create function private.dashboard_admin_wg_provider_aliases() returns table(country_code text,country text,platform text,raw_provider text,canonical_provider text) language sql as $$select null::text,null::text,null::text,null::text,null::text where false$$;
create function private.ar_middle_channel_capabilities(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
create function private.application_current_session_allowed(text) returns boolean language sql stable as $$select coalesce(current_setting('test.session',true),'yes')='yes'$$;
create function private.dashboard_role_require_gateway() returns void language plpgsql as $$begin if current_setting('test.gateway',true)='denied' then raise exception 'gateway_required';end if;end$$;
create function private.dashboard_admin_wg_capabilities(text) returns jsonb language sql as $$select '{}'::jsonb$$;
create table private.yash_orders(source_site text,order_type text,order_no text,uid text,supplier_order_no text,status text,amount numeric,fee numeric,credited_amount numeric,created_at timestamptz,completed_at timestamptz,supplier text,channel text,currency text,observed_at timestamptz,received_at timestamptz);
alter table newar_detail_platforms add column if not exists enabled boolean default true;
alter table newar_detail_platforms add column if not exists launch_at timestamptz;
update dashboard_profiles set data_scope='{"mode":"all","countries":[]}' where role='owner';
update dashboard_profiles set data_scope='{"mode":"selected","countries":["BR_PANGHU"],"platforms":[{"country":"BR_PANGHU","platform":"2V222"}]}' where role='viewer';
`);
const types={text:'text',bigint:'bigint',integer:'integer',uuid:'uuid',boolean:'boolean','timestamp with time zone':'timestamptz'};
for(const name of ['panda_private.order_scopes','panda_private.order_scans','panda_private.order_scan_members','public.panda_order_details','public.panda_order_coverage_receipts']){
const [s,t]=name.split('.');await db.exec('create table '+name+'('+schema.columns.filter(c=>c.schema===s&&c.table===t).map(c=>c.column+' '+types[c.type]).join(',')+')');
}
await db.exec('alter table panda_private.order_scopes add primary key(platform);alter table public.panda_order_details add primary key(platform,direction,order_id);alter table panda_private.order_scan_members add primary key(scan_id,order_id);');
for(const s of schema.scopes)await db.query('insert into panda_private.order_scopes select (jsonb_populate_record(null::panda_private.order_scopes,$1::jsonb)).*',[JSON.stringify(s)]);
for(const m of schema.mapping)await db.query('insert into public.dashboard_platform_team_map select (jsonb_populate_record(null::public.dashboard_platform_team_map,$1::jsonb)).*',[JSON.stringify(m)]);
for(const f of JSON.parse(read('tests/fixtures/dependency-functions.json')))await db.exec(f.definition+';');
for(const f of JSON.parse(read('tests/fixtures/scope-functions.json')))await db.exec(f.definition+';');
for(const f of baseline)await db.exec(f.definition+';');
for(const f of baseline)await db.exec('revoke all on function '+f.signature+' from public,anon,authenticated,service_role');
for(const f of baseline)if(f.proacl?.includes('authenticated=X'))await db.exec('grant execute on function '+f.signature+' to authenticated');
await db.exec('create index panda_orders_provider_names_idx on public.panda_order_details using btree(platform,direction,provider_name);create index panda_orders_created on public.panda_order_details(platform,direction,created_at)');
await as(owner);aclBefore=await acl();await db.exec(patch);
id=(await rpc('dashboard_admin_live_query_raw',{action:'catalog'})).platforms.find(x=>x.source==='panda'&&x.name===label).id;
await add('A','success',1234);await add('B','pending',2000);await add('C','unknown',3000);
await add('OLD','success',4000,{created_at:'2026-09-30T23:00:00-03:00'});
await add('END','success',5000,{created_at:'2026-10-02T00:00:00-03:00',completed_at:'2026-10-02T01:00:00-03:00'});
await add('W','success',6789,{direction:'reviewed_withdrawal',raw_status:'success',completed_at:null,fee_minor:25,pay_amount_minor:6764});
await add('WU','unknown',1100,{direction:'reviewed_withdrawal',raw_status:'refuse',completed_at:null,provider_name:null});
await receipt('2026-10-01T03:00Z','2026-10-02T03:00Z');await receipt('2026-10-01T03:00Z','2026-10-02T03:00Z',{direction:'reviewed_withdrawal'});
});
after(async()=>db?.close());
test('54 native identities preserve BR/Panghu scope and existing auth/gateway/ACL',async()=>{
const list=(await rpc('dashboard_admin_live_query_raw',{action:'catalog'})).platforms.filter(x=>x.source==='panda');assert.equal(list.length,54);assert.equal(new Set(list.map(x=>x.id)).size,54);
assert.equal(id,(await db.query("select md5('panda:BR:'||$1)::uuid id",[platform])).rows[0].id);
assert.equal(list.find(x=>x.id===id).scopeGroup,'BR_PANGHU');assert.equal(list.find(x=>x.id===id).capabilities.memberDailyAvailable,false);
assert.deepEqual(await acl(),aclBefore);
await as(viewer);try{assert.deepEqual((await rpc('dashboard_admin_live_query_raw',{action:'catalog'})).platforms.filter(x=>x.source==='panda').map(x=>x.name),[label]);await assert.rejects(call({platformId:list.find(x=>x.name==='POPTIG').id}),/platform_denied/);}finally{await as(owner);}
await db.exec("select set_config('test.session','no',false)");await assert.rejects(call(),/application_session_denied/);await db.exec("select set_config('test.session','yes',false)");
await db.exec("select set_config('test.gateway','denied',false)");await assert.rejects(call(),/gateway_required/);await db.exec("select set_config('test.gateway','',false)");
const grants=(await db.query("select proname,has_function_privilege('authenticated',oid,'execute') a,has_function_privilege('service_role',oid,'execute') s from pg_proc where proname like 'dashboard_admin_panda_%'")).rows;assert(grants.length>=7);assert(grants.every(x=>!x.a&&!x.s));
});
test('BR creation day and nullable source completion cohorts retain exact minor amounts',async()=>{
const r=await call(),s=r.summary[0];assert.equal(s.all_count,3);assert.equal(Number(s.all_amount),62.34);assert.equal(s.created_success_count,1);assert.equal(Number(s.created_success_amount),12.34);assert.equal(s.success_count,null);assert.equal(s.success_amount,null);
await assert.rejects(call({status:'success'}),/PANDA_SUCCESS_COVERAGE_UNAVAILABLE/);assert.equal(s.pending_count,1);assert.equal(s.unknown_count,1);assert.equal(r.capabilities.chargeSuccessTimeAvailable,false);assert.equal(r.capabilities.chargeSourceCompletedTimeAvailable,true);assert.equal(r.capabilities.paymentSuccessTimeAvailable,false);assert.equal(r.pandaCoverage.complete,true);
assert.equal((await call({view:'providers'})).summary[0].all_count,3);
assert.deepEqual((await call({action:'details'})).rows.map(x=>x.order_number).sort(),['A','B','C']);
assert.equal(Date.parse((await call({action:'details',orderNumber:'A'})).rows[0].success_at),Date.parse('2026-10-01T05:00:00Z'));
});
test('withdrawal remains reviewed-only, unknown remains unknown and unavailable success axis is rejected',async()=>{
const r=await call({direction:'withdraw'}),s=r.summary[0];assert.equal(s.all_count,2);assert.equal(s.created_success_count,1);assert.equal(Number(s.created_success_amount),67.89);assert.equal(s.success_count,null);assert.equal(s.success_amount,null);assert.equal(s.unknown_count,1);assert.equal(s.failed_count,0);assert.equal(s.pending_count,null);assert.equal(s.pending_amount,null);assert.deepEqual(r.groups.latency,[]);
assert.equal(r.capabilities.latencyAvailable,false);assert.equal(r.capabilities.reviewedWithdrawalsOnly,true);
const d=(await call({action:'details',direction:'withdraw',orderNumber:'W'})).rows[0];assert.equal(d.success_at,null);assert.equal(d.latency_ms,null);assert.equal(Number(d.actual_amount),67.64);assert.equal(Number(d.withdraw_fee),.25);assert.equal(d.member_id,null);
await assert.rejects(call({direction:'withdraw',status:'success'}),/PANDA_SUCCESS_COVERAGE_UNAVAILABLE/);await assert.rejects(orders({direction:'withdraw',basis:'success'}),/PANDA_SUCCESS_COVERAGE_UNAVAILABLE/);await assert.rejects(drill({direction:'withdraw',kind:'latency',bucket:0,hour:undefined}),/PANDA_SUCCESS_COVERAGE_UNAVAILABLE/);
await assert.rejects(call({memberId:'someone'}),/unsupported_member_filter/);await assert.rejects(call({thirdPartyOrderNumber:'unavailable'}),/unsupported_filter/);
});
test('query, pagination, drilldown and analysis retain the same filtered creation members',async()=>{
const a=await call({amountMin:19,amountMax:31}),d=await drill({amountMin:19,amountMax:31}),o=await orders({amountMin:19,amountMax:31});assert.equal(a.summary[0].all_count,2);assert.equal(d.summary[0].all_count,2);assert.equal(o.total,2);assert.deepEqual(o.rows.map(x=>x.order_number).sort(),['B','C']);
await tx(async()=>{for(let i=0;i<23;i++)await add('PAGE'+i,'pending',100);const full=await call({action:'details',limit:50}),first=await call({action:'details',limit:20}),next=await call({action:'details',limit:20,offset:20});assert.deepEqual([...first.rows,...next.rows].map(x=>x.id),full.rows.map(x=>x.id));});
assert.equal((await call({currency:'USD'})).summary.length,0);assert.equal((await call({providers:['PayA']})).summary[0].all_count,3);
});
test('strict creation receipts require exact current members; status updates remain allowed, late rows invalidate coverage',async()=>tx(async()=>{
await db.exec('delete from public.panda_order_coverage_receipts;delete from panda_private.order_scans;delete from panda_private.order_scan_members');assert.equal((await evidence()).complete,false);
await receipt('2026-10-01T03:00Z','2026-10-02T03:00Z',{axis:'source_updated_at'});assert.equal((await evidence()).complete,false);
await receipt('2026-10-01T03:00Z','2026-10-01T15:00Z');assert.equal((await evidence()).complete,false);
await receipt('2026-10-01T15:00Z','2026-10-02T03:00Z');assert.equal((await evidence()).complete,true);
await db.exec("update public.panda_order_details set row_hash='newversion',status='success' where order_id='B'");assert.equal((await evidence()).complete,true);
await add('LATE','unknown',100);assert.equal((await evidence()).complete,false);
await receipt('2026-10-01T03:00Z','2026-10-02T03:00Z');assert.equal((await evidence()).complete,true);
}));
test('zero requires a finalized exact row-axis receipt; reviewed completion receipts cannot certify creation',async()=>tx(async()=>{
await db.exec('delete from public.panda_order_coverage_receipts;delete from panda_private.order_scans;delete from panda_private.order_scan_members');const start='2026-10-02T06:00Z',end='2026-10-02T07:00Z';assert.equal((await evidence(start,end)).zeroConfirmed,false);await receipt(start,end);assert.equal((await evidence(start,end)).zeroConfirmed,true);
await receipt('2026-10-01T03:00Z','2026-10-02T03:00Z',{direction:'reviewed_withdrawal',axis:'completed_at',verified:false});assert.equal((await evidence(undefined,undefined,'withdraw')).complete,false);
await receipt('2026-10-01T03:00Z','2026-10-02T03:00Z',{direction:'reviewed_withdrawal'});const w=await evidence(undefined,undefined,'withdraw');assert.equal(w.complete,true);assert.equal(w.coverageScope,'reviewed_withdrawal_list_only');
}));
test('source patch leaves every preexisting source branch byte-for-byte intact',()=>{
const patched=JSON.parse(read('tests/fixtures/panda-candidate-functions.json'));
for(const name of ['dashboard_admin_live_query_raw','dashboard_admin_live_drilldown_raw','dashboard_admin_live_analysis_orders_raw']){
const a=baseline.find(x=>x.proname===name).definition,b=patched[name];
for(const marker of ["if v_platform.source='ar' then", "elsif v_platform.source='newar' then", "elsif v_platform.source='lg' then"]){const start=a.lastIndexOf(marker),end=a.indexOf("elsif v_platform.source=",start+marker.length);if(start>=0&&end>start)assert(b.includes(a.slice(start,end).trim()),name+marker);}
}
});

test('partial receipt gate applies before all statistics; plain details remain honest partial',async()=>tx(async()=>{
 await db.exec('delete from public.panda_order_coverage_receipts');
 for(const f of [()=>call(),()=>call({view:'providers'}),()=>drill(),()=>orders()]){await db.exec('savepoint rejection');await assert.rejects(f(),/PANDA_COVERAGE_INCOMPLETE/);await db.exec('rollback to rejection');}
 const d=await call({action:'details'});assert.equal(d.total,3);assert.equal(d.pandaCoverage.complete,false);
}));
test('provider index walk keeps null/blank names deduped, direction and viewer scope isolated',async()=>tx(async()=>{
 await add('NAME1','unknown',1,{provider_name:'  '});await add('NAME2','unknown',1,{provider_name:'PayA '});
 await add('NAME3','unknown',1,{provider_name:'PayB',direction:'reviewed_withdrawal'});
 const p=await rpc('dashboard_admin_live_provider_options',{platformIds:[id],direction:'charge'});assert.deepEqual(p.providers,['PayA','未识别通道']);
 const w=await rpc('dashboard_admin_live_provider_options',{platformIds:[id],direction:'withdraw'});assert.deepEqual(w.providers,['PayA','PayB','未识别通道']);
 await as(viewer);try{const po=(await rpc('dashboard_admin_live_query_raw',{action:'catalog'})).platforms;assert.equal(po.filter(x=>x.source==='panda').length,1);
 const deniedId=(await db.query("select md5('panda:BR:'||platform)::uuid id from panda_private.order_scopes where platform_label='POPTIG'")).rows[0].id;
 assert.deepEqual((await rpc('dashboard_admin_live_provider_options',{platformIds:[deniedId],direction:'all'})).providers,[]);
 }finally{await as(owner);}
}));
test('canonical provider merge retains exact creation success money and no success-time fee or pending fiction',async()=>tx(async()=>{
 await db.exec("CREATE OR REPLACE FUNCTION private.dashboard_admin_live_provider_canonical(p_country text, p_platform text, p_raw text) returns text language sql as $$select case when $3 in ('PayA','PayAlias') then 'PayCanonical' else $3 end$$");
 await add('ALIAS','success',1050,{provider_name:'PayAlias',direction:'reviewed_withdrawal',completed_at:null});
 await add('ALIASP','pending',700,{provider_name:'PayAlias',direction:'reviewed_withdrawal',completed_at:null});
 await receipt('2026-10-01T03:00Z','2026-10-02T03:00Z',{direction:'reviewed_withdrawal'});
 const expanded=await rpc('dashboard_admin_live_expand_provider_filter',req({providers:['PayCanonical'],direction:'withdraw'}));assert.deepEqual(expanded.providers,['PayA','PayAlias','PayCanonical']);
 const r=await rpc('dashboard_admin_live_query',req({direction:'withdraw',providers:['PayCanonical']}));
 const g=r.groups.provider;assert.equal(g.length,1);assert.equal(g[0].all_count,3);assert.equal(g[0].created_success_count,2);assert.equal(Number(g[0].created_success_amount),78.39);assert.equal(g[0].pending_count,null);assert.equal(g[0].pending_amount,null);assert.equal(g[0].success_count,null);assert.equal(g[0].fee_low_count,null);
}));
test('receipt budget and mismatched memberships fail closed instead of approving a short contained query',async()=>tx(async()=>{
 await db.exec('update public.panda_order_coverage_receipts set expected_count=250001');const e=await evidence('2026-10-01T04:00Z','2026-10-01T04:30Z');assert.equal(e.complete,false);assert.equal(e.verificationBudgetExceeded,true);
 await db.exec('update public.panda_order_coverage_receipts set expected_count=0');assert.equal((await evidence()).complete,false);
}));
test('all-direction output disables success and duration statistics consistently',async()=>{
 const r=await call({direction:'all'});assert(r.summary.every(x=>x.success_count===null&&x.success_amount===null));assert.equal(r.capabilities.latencyAvailable,false);assert.deepEqual(r.groups.latency,[]);assert.deepEqual(r.groups.pending_age,[]);
 const d=await call({action:'details',direction:'all'});assert(d.rows.every(x=>x.latency_ms===null));
 await assert.rejects(orders({basis:'success'}),/PANDA_SUCCESS_COVERAGE_UNAVAILABLE/);await assert.rejects(drill({kind:'latency',bucket:0,hour:undefined}),/PANDA_SUCCESS_COVERAGE_UNAVAILABLE/);
});
const inTransaction=s=>s.replace(/^begin;$/m,'').replace(/^commit;\s*$/m,'');
test('provider seek plan uses the exact narrow index; migration refuses a missing or drifted prerequisite',async()=>tx(async()=>{
 await db.exec('set local enable_seqscan=off');
 for(const clause of ["provider_name is not null","provider_name>'PayA'","provider_name is null"]){
 const plan=(await db.query('explain (format json) select provider_name from public.panda_order_details where platform=$1 and direction=$2 and '+clause+' order by provider_name limit 1',[platform,'deposit'])).rows[0]['QUERY PLAN'];
 assert(JSON.stringify(plan).includes('panda_orders_provider_names_idx'));
 }
 await db.exec('drop index public.panda_orders_provider_names_idx;savepoint missing');
 await assert.rejects(db.exec(patch.slice(patch.indexOf('do $index_guard$'),patch.indexOf('end;$index_guard$;')+'end;$index_guard$;'.length)),/panda_provider_names_index_missing_or_invalid/);await db.exec('rollback to missing');
 await db.exec('create index panda_orders_provider_names_idx on public.panda_order_details(platform,provider_name,direction);savepoint wrong');
 await assert.rejects(db.exec(patch.slice(patch.indexOf('do $index_guard$'),patch.indexOf('end;$index_guard$;')+'end;$index_guard$;'.length)),/panda_provider_names_index_missing_or_invalid/);await db.exec('rollback to wrong');
}));
test('exact rollback restores all eight production definitions/ACLs, removes only nine helpers, and permits clean reapply',async()=>tx(async()=>{
 await db.exec(inTransaction(read('supabase/operations/panda_native_order_readers_rollback.sql')));
 assert.deepEqual(await acl(),aclBefore);
 for(const [name,m]of Object.entries(JSON.parse(read('tests/fixtures/panda-function-manifest.json')).patched)){
 const got=(await db.query('select md5(prosrc) hash from pg_proc where oid=$1::regprocedure',[m.signature])).rows[0].hash;assert.equal(got,m.original_body_md5,name);
 }
 assert.equal((await db.query("select count(*)::int n from pg_proc where proname like 'dashboard_admin_panda_%'")).rows[0].n,0);
 await db.exec(inTransaction(patch));assert.equal((await call()).summary[0].created_success_count,1);assert.deepEqual(await acl(),aclBefore);
}));
test('rollback rejects later function drift atomically; forward migration rejects changed production baselines',async()=>tx(async()=>{
 const m=JSON.parse(read('tests/fixtures/panda-function-manifest.json')).patched;
 await db.exec('alter function private.dashboard_admin_live_query(jsonb) set statement_timeout=\'9s\';savepoint drift');
 await assert.rejects(db.exec(inTransaction(read('supabase/operations/panda_native_order_readers_rollback.sql'))),/panda_rollback_contract_drift/);await db.exec('rollback to drift');
 assert.equal((await db.query("select count(*)::int n from pg_proc where proname like 'dashboard_admin_panda_%'")).rows[0].n,9);
 await db.exec("alter function private.dashboard_admin_live_query(jsonb) reset statement_timeout");
 await db.exec(inTransaction(read('supabase/operations/panda_native_order_readers_rollback.sql')));
 await db.exec('alter function private.dashboard_admin_live_query_raw(jsonb) set statement_timeout=\'9s\';savepoint forwarddrift');
 await assert.rejects(db.exec(inTransaction(patch)),/panda_native_reader_contract_drift/);await db.exec('rollback to forwarddrift');
 assert.equal((await db.query("select count(*)::int n from pg_proc where proname like 'dashboard_admin_panda_%'")).rows[0].n,0);
}));
test('native intake catalog and historical day rows expose strict Panda receipt evidence',async()=>{
 const c=await rpc('dashboard_admin_live_intake_coverage',{operation:'orderCatalog'});
 const feeds=c.feeds.filter(x=>x.system==='panda'&&x.platformId===id);assert.equal(feeds.length,2);
 const r=await rpc('dashboard_admin_live_intake_coverage',{operation:'rows',feedIds:feeds.map(x=>x.id),startAt:'2026-10-01',endAt:'2026-10-01'});
 assert.equal(r.rows.length,2);assert(r.rows.every(x=>x.complete===true&&x.evidence==='panda_created_receipts_complete'));
});
