// Actual PostgreSQL helpers and actual production analysis body; synthetic data only.
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20261004100000_pending_collection_diagnostics.sql');
const uuid=n=>'70000000-0000-4000-8000-'+String(n).padStart(12,'0');
const date='2026-10-03',start='2026-09-27';let db,original;
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const scope={mode:'selected',countries:['IN'],platforms:['SYNTHETIC_A','SYNTHETIC_B','SYNTHETIC_FUTURE']};
const target=(n,name='SYNTHETIC_A',extra={})=>({id:uuid(n),name,source_name:name,source:'ar',country:'印度',scope_group:'IN',platform_key:name,team:'M8',timezone:'Asia/Kolkata',currency:'INR',...extra});
const row=(n,name='SYNTHETIC_A',extra={})=>({id:uuid(n),name,sourceName:name,source:'ar',scopeGroup:'IN',team:'M8',timezone:'Asia/Kolkata',currency:'INR',state:'missing',amount:null,count:null,groups:[],...extra});
const day=rows=>({version:1,basis:'seven_day_pending_snapshot',date,snapshotDate:date,currency:'INR',complete:false,expectedPlatformCount:rows.length,receivedPlatformCount:0,amount:null,count:null,rows,groups:[]});
async function capture(n,platform='SYNTHETIC_A',extra={}){
 const at=extra.at||'2026-10-03T18:31:00Z',groups=extra.groups||[{raw_channel:'SyntheticPay',channel_type:'BANK',pending_count:3,pending_amount:123.45}],count=groups.reduce((n,g)=>n+g.pending_count,0),amount=groups.reduce((n,g)=>n+g.pending_amount,0);
 const snapshot={schema_version:1,source_system:'WITHDRAW_REVIEW',country_code:'IN',platform,stat_date:date,timezone:'Asia/Kolkata',snapshot_id:uuid(n+200),snapshot_at:at,coverage:{complete:true,expected_count:count,fetched_count:count,unique_count:count},totals:{pending_count:count,pending_amount:amount},groups};
 await db.query(`insert into private.withdraw_pending_capture_archive(id,source_system,country_code,platform,stat_date,capture_date,window_start,window_end,window_days,snapshot_id,snapshot_at,snapshot,timezone,capture_basis,within_midnight_window,identity_status,native_source_system,platform_id,team_name,currency,partition_snapshots,pending_count,pending_amount,updated_at)
 values($1,'WITHDRAW_REVIEW',$2,$3,$4,'2026-10-04',$5,$4,7,$6,$7,$8,$9,'actual_capture',$10,$11,$12,$13,$14,$15,'[]',$16,$17,$7)`,[uuid(n+100),extra.country||'IN',platform,date,start,uuid(n+200),at,snapshot,extra.timezone||'Asia/Kolkata',Date.parse(at)<=Date.parse('2026-10-03T18:35:00Z'),extra.identity||'resolved',extra.source||'AR',extra.nativeId||uuid(n),extra.team||'M8',extra.currency??null,count,amount]);
 return uuid(n+100);
}
const diagnostics=(catalog,filters=[],s=scope)=>scalar('select private.dashboard_admin_pending_collection_diagnostics($1,$2,$3,$4,$5)',[catalog,s,'2026-10-02',date,filters]);
const decorate=(value,data)=>scalar('select private.dashboard_admin_pending_collection_day($1,$2)',[value,data]);
const metadata=()=>scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.dashboard_admin_live_pending_analysis(jsonb)'::regprocedure");
before(async()=>{
 db=new PGlite();
 await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;grant usage on schema private to authenticated;
 ${read('tests/fixtures/pending-analysis/capture-schema.sql')}
 create table ar_config_targets(country_code text,platform text,source_system text,currency text,timezone text);
 create table newar_detail_platforms(country_code text,platform text,timezone text,launch_at timestamptz,enabled boolean);
 create table dashboard_platform_team_map(country_code text,source_platform text,source_system text,team_name text,active boolean,platform_name text);
 create table withdraw_pending_backlog_daily(source_system text,country_code text,platform text,stat_date date,capture_date date,window_start date,window_end date,snapshot_id uuid,snapshot_at timestamptz,snapshot jsonb,updated_at timestamptz);
 create table withdraw_pending_daily(source_system text,country_code text,platform text,stat_date date,snapshot_id uuid,snapshot_at timestamptz,snapshot jsonb);
 create table withdraw_pending_orders(source_system text,country_code text,platform text,stat_date date,order_no text,amount numeric,applied_at timestamp,timezone text,raw_channel text,channel_type text,status text,snapshot_id uuid,snapshot_at timestamptz);
 create table test_catalog(value jsonb);create table test_days(value jsonb);
 create function private.dashboard_scope_allows(s jsonb,c text,p text)returns boolean language sql stable set search_path=''as $$select coalesce(s->>'mode'='all'or(s->>'mode'='selected'and s->'countries'?c and s->'platforms'?p),false)$$;
 create function private.dashboard_admin_pending_archive_currency(uuid)returns text language sql stable set search_path=''as $$select currency from private.withdraw_pending_capture_archive where id=$1$$;
 create function private.dashboard_admin_live_provider_canonical(text,text,text)returns text language sql stable set search_path=''as $$select case when $3='SyntheticPayQR'then 'SyntheticPay'else $3 end$$;
 create function private.dashboard_admin_pending_platform_key(text,text)returns text language sql immutable set search_path=''as $$select upper($2)$$;
 create function public.collection_success_safe_descriptor(text,int)returns boolean language sql immutable as $$select $1 is not null and length($1)<=$2$$;
 create function private.dashboard_admin_live_scope()returns jsonb language plpgsql stable security definer set search_path=''as $$begin if current_setting('test.allow',true)<>'yes'then raise exception 'preview_denied';end if;return current_setting('test.scope')::jsonb;end$$;
 create function private.dashboard_admin_pending_resolve(q jsonb,s jsonb)returns jsonb language plpgsql stable set search_path=''as $$declare result jsonb;begin select coalesce(jsonb_agg(x),'[]')into result from public.test_catalog a,jsonb_array_elements(a.value)x where q->'platformIds'?(x->>'id') and private.dashboard_scope_allows(s,x->>'scope_group',x->>'source_name');if jsonb_array_length(result)<>jsonb_array_length(q->'platformIds')then raise exception 'platform_denied';end if;return result;end$$;
 create function private.dashboard_admin_pending_capture_heads(jsonb,jsonb,date,date)returns jsonb language sql stable set search_path=''as $$select '[]'::jsonb$$;
 create function private.dashboard_admin_pending_resolved_day_cached(q jsonb,s jsonb,c jsonb,b jsonb,providers jsonb,zones text[])returns jsonb language sql stable set search_path=''as $$select coalesce((select d.value from public.test_days d where d.value->>'snapshotDate'=q->>'date'),jsonb_build_object('basis','seven_day_pending_snapshot','snapshotDate',q->>'date','date',q->>'date','rows','[]'::jsonb,'complete',false,'expectedPlatformCount',0,'receivedPlatformCount',0))$$;
 create function private.dashboard_admin_pending_observation(jsonb)returns jsonb language sql stable set search_path=''as $$select $1$$;
 create function private.dashboard_admin_pending_capture_day(jsonb,jsonb,jsonb)returns jsonb language sql stable set search_path=''as $$select $1$$;
 revoke all on all tables in schema private from public,anon,authenticated,service_role;`);
 await db.exec(read('tests/fixtures/pending-analysis/production-diagnostics-analysis-baseline.sql'));
 assert.equal(await scalar("select md5(prosrc)from pg_proc where oid='private.dashboard_admin_live_pending_analysis(jsonb)'::regprocedure"),'38f374dd5781210f672329762ef5e2b7');
 assert.equal(await scalar("select md5(pg_get_functiondef(oid))from pg_proc where oid='private.dashboard_admin_live_pending_analysis(jsonb)'::regprocedure"),'407773fa6b61629867bef3c1a0d5787a');
 original=await metadata();await db.exec(migration);
});
beforeEach(async()=>{await db.exec('reset role;truncate private.withdraw_pending_capture_orders,private.withdraw_pending_capture_archive,ar_config_targets,newar_detail_platforms,dashboard_platform_team_map,test_catalog,test_days;');await db.query("select set_config('test.allow','yes',false),set_config('test.scope',$1,false)",[JSON.stringify(scope)]);});
after(async()=>{await db?.close()});
test('on-time unknown-currency archive exposes separate true stock, never promotes midnight values or INR',async()=>{
 await capture(1);const d=await diagnostics([target(1)]),r=await decorate(day([row(1)]),d);
 assert.equal(r.rows[0].diagnosticObservedCount,3);assert.equal(r.rows[0].diagnosticObservedAmount,'123.45');assert.equal(r.rows[0].diagnosticCurrency,null);assert.equal(r.rows[0].diagnosticTimingState,'on_time');assert.deepEqual(r.rows[0].diagnosticReasons,['currency_unverified']);
 assert.equal(r.rows[0].state,'missing');assert.equal(r.rows[0].amount,null);assert.equal(r.rows[0].count,null);assert.deepEqual(r.rows[0].groups,[]);assert.equal(r.amount,null);assert.equal(r.count,null);assert.equal(r.receivedPlatformCount,0);assert.equal(r.complete,false);
});
test('late stock retains actual timestamp, amount and count but never changes valid midnight totals',async()=>{
 await capture(1,'SYNTHETIC_A',{at:'2026-10-03T19:47:10Z'});const valid=row(2,'SYNTHETIC_B',{state:'complete',amount:'100',count:2,groups:[{provider:'Known',amount:'100',count:2}],timingState:'on_time'});
 const r=await decorate(day([row(1),valid]),await diagnostics([target(1),target(2,'SYNTHETIC_B')]));
 assert.deepEqual(r.rows[0].diagnosticReasons,['currency_unverified','outside_midnight_window']);assert.equal(Date.parse(r.rows[0].diagnosticObservedAt),Date.parse('2026-10-03T19:47:10+00:00'));assert.equal(r.amount,'100');assert.equal(r.count,2);assert.deepEqual(r.groups,[{provider:'Known',amount:'100',count:2}]);assert.equal(r.rows[0].amount,null);
});
test('provider diagnostics use the requested canonical channel scope, retain true zero and do not broaden groups',async()=>{
 await capture(1,'SYNTHETIC_A',{groups:[{raw_channel:'SyntheticPayQR',channel_type:'BANK',pending_count:2,pending_amount:100},{raw_channel:'Other',channel_type:'BANK',pending_count:1,pending_amount:999}]});
 const key=JSON.stringify([uuid(1),date]).replace(',',', ');let d=await diagnostics([target(1)],['SyntheticPay']);assert.equal(d.captures[key].count,2);assert.equal(d.captures[key].amount,'100');
 d=await diagnostics([target(1)],['Absent']);assert.equal(d.captures[key].count,0);assert.equal(d.captures[key].amount,'0');
});
test('foreign country/team/native/source/timezone/physical key and forbidden scope never leak diagnostic values',async()=>{
 await capture(1);for(const changes of [{scope_group:'BR'},{team:'OTHER'},{id:uuid(2)},{source:'newar'},{timezone:'UTC'},{source_name:'ForeignAlias'}]){
  const d=await diagnostics([target(1,'SYNTHETIC_A',changes)]);assert.deepEqual(d.captures,{},JSON.stringify(changes));
 }
 assert.deepEqual((await diagnostics([target(1)],[],{mode:'selected',countries:['BR'],platforms:['SYNTHETIC_A']})).captures,{});
 await db.exec("update private.withdraw_pending_capture_archive set identity_status='legacy_unbound'");assert.deepEqual((await diagnostics([target(1)])).captures,{});
});
async function launch(){await db.exec("insert into ar_config_targets values('IN','SYNTHETIC_FUTURE','NEW_AR','INR','Asia/Kolkata');insert into newar_detail_platforms values('IN','SYNTHETIC_FUTURE','Asia/Kolkata','2026-10-05T18:30:00Z',true);insert into dashboard_platform_team_map values('IN','SYNTHETIC_FUTURE','NEW_AR','M8',true,'SYNTHETIC_FUTURE')");}
test('exact authorized future launch is visible separately and excluded from expected coverage until its local business date',async()=>{
 await launch();const catalog=[target(1),target(3,'SYNTHETIC_FUTURE')],d=await diagnostics(catalog),r=await decorate(day([row(1),row(3,'SYNTHETIC_FUTURE')]),d);
 assert.equal(r.selectedPlatformCount,2);assert.equal(r.expectedPlatformCount,1);assert.equal(r.notLaunchedPlatformCount,1);assert.equal(r.rows[1].state,'not_launched');assert.equal(r.rows[1].launchDate,'2026-10-06');assert.equal(r.rows[1].expectedForDate,false);assert.equal(r.missingPlatforms.length,1);
 const onLaunch=await decorate({...day([row(3,'SYNTHETIC_FUTURE')]),snapshotDate:'2026-10-06'},d);assert.equal(onLaunch.rows[0].state,'missing');assert.equal(onLaunch.expectedPlatformCount,1);
 const futureOnly=await decorate(day([row(3,'SYNTHETIC_FUTURE')]),d);assert.equal(futureOnly.expectedPlatformCount,0);assert.equal(futureOnly.complete,false);assert.equal(futureOnly.amount,null);assert.equal(futureOnly.count,null);
 await db.exec("update dashboard_platform_team_map set team_name='OTHER'");assert.deepEqual((await diagnostics(catalog)).launchDates,{});
});
test('actual production analysis uses the new daily diagnostics, keeps authorization and original aggregation boundaries',async()=>{
 await capture(1);await launch();const catalog=[target(1),target(3,'SYNTHETIC_FUTURE')];await db.query('insert into test_catalog values($1)',[catalog]);await db.query('insert into test_days values($1)',[day([row(1),row(3,'SYNTHETIC_FUTURE')])]);
 const request={startDate:date,endDate:date,platformIds:catalog.map(x=>x.id)};
 const r=await scalar('select private.dashboard_admin_live_pending_analysis($1)',[request]);assert.equal(r.daily[0].expectedPlatformCount,1);assert.equal(r.daily[0].rows[0].diagnosticObservedCount,3);assert.equal(r.daily[0].rows[1].state,'not_launched');assert.equal(r.daily[0].amount,null);assert.equal(r.aging.missingPlatforms.length,1);assert.equal(r.aging.available,false);
 await db.query("select set_config('test.allow','no',false)");await assert.rejects(()=>scalar('select private.dashboard_admin_live_pending_analysis($1)',[request]),/preview_denied/);await db.query("select set_config('test.allow','yes',false),set_config('test.scope','{\"mode\":\"selected\",\"countries\":[\"BR\"],\"platforms\":[]}',false)");await assert.rejects(()=>scalar('select private.dashboard_admin_live_pending_analysis($1)',[request]),/platform_denied/);
});
test('migration replay preserves original OID and metadata, private helpers expose no execute or data grants',async()=>{
 assert.deepEqual(await metadata(),original);await db.exec(migration);assert.deepEqual(await metadata(),original);
 for(const signature of ['private.dashboard_admin_pending_collection_diagnostics(jsonb,jsonb,date,date,text[])','private.dashboard_admin_pending_collection_day(jsonb,jsonb)'])for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')',[role,signature]),false);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("select has_table_privilege($1,'private.withdraw_pending_capture_archive','SELECT,INSERT,UPDATE,DELETE')",[role]),false);
});
test('helper ACL drift fails atomically on replay instead of overwriting an unsafe helper',async()=>{
 await db.exec('begin;grant execute on function private.dashboard_admin_pending_collection_day(jsonb,jsonb) to authenticated');await assert.rejects(()=>db.exec(migration),/pending_diagnostics_helper_drift/);await db.exec('rollback');
});
test('same-body helper argument-default drift is rejected by its full definition guard',async()=>{
 const signature='private.dashboard_admin_pending_collection_day(jsonb,jsonb)';
 const definition=await scalar('select pg_get_functiondef($1::regprocedure)',[signature]);
 await db.exec('begin');await db.exec(definition.replace('p_diagnostics jsonb)',"p_diagnostics jsonb DEFAULT '{}'::jsonb)"));
 await assert.rejects(()=>db.exec(migration),/pending_diagnostics_helper_drift/);await db.exec('rollback');
});
test('main body drift is rejected before helper or metadata mutations',async()=>{
 const signature='private.dashboard_admin_live_pending_analysis(jsonb)';const definition=await scalar('select pg_get_functiondef($1::regprocedure)',[signature]);
 await db.exec('begin');await db.exec(definition.replace('v_collection_diagnostics jsonb;','v_collection_diagnostics jsonb; /* synthetic drift */'));
 await assert.rejects(()=>db.exec(migration),/pending_diagnostics_baseline_drift/);await db.exec('rollback');assert.deepEqual(await metadata(),original);
});
