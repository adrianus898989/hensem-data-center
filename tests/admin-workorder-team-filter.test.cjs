// Team filtering uses only authorized AR directory assignments, before aggregates/paging.
// Synthetic PostgreSQL fixtures; no production data or network access.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');let db,baselineDefinitions;
const read=n=>fs.readFileSync(path.join(__dirname,'../supabase',n),'utf8');
const migration=()=>read('migrations/20260930160000_workorder_team_filter.sql');
const file=n=>fs.readFileSync(path.join(__dirname,'../supabase/workorder-records',n),'utf8');
const query=async(q={})=>(await db.query('select public.dashboard_admin_live_workorder_records($1) value',[JSON.stringify({country:'IN',view:'records',operation:'summary',filters:{from:'2026-09-26',to:'2026-09-26'},...q})])).rows[0].value;
const record=(id,extra={})=>({system_name:'AR',country_code:'IN',country:'印度',platform:'A',work_order_id:id,issue_kind:'deposit',observed_at:'2026-09-27T00:00:00Z',query_date:'2026-09-26',schema_version:2,query_basis:'submission',field_gaps:[],submitted_date:'2026-09-26',submitted_at:'2026-09-26T00:00:00Z',operated_at:'2026-09-26T01:00:00Z',operation_time_source:'operationTime',work_order_no:'WO-'+id,payment_order_no:'RC20260926-'+id,amount:'10.20',status_code:3,operator_account:'source-operator',...extra});
const ingest=async rows=>db.query('select public.ingest_ar_workorder_issue_details_v2($1)',[JSON.stringify(rows)]);
before(async()=>{db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.dashboard_profiles(auth_user_id uuid,role text,active boolean,data_scope jsonb);
 create table public.dashboard_admin_preview_grants(auth_user_id uuid,can_view boolean);
 insert into public.dashboard_profiles values('10000000-0000-4000-8000-000000000001','owner',true,'{"all":true}');
 select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
 create function private.dashboard_current_data_scope() returns jsonb language sql stable security definer as $$select data_scope from public.dashboard_profiles where auth_user_id=auth.uid()$$;
 create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable as $$select s->>'all'='true' or (s->'countries' ? c and s->'platforms' ? p)$$;
 create table private.team_test_directory(name text,team text,scope_group text,source text,source_name text);
 insert into private.team_test_directory values
 ('A','M8','IN','ar','A'),('B','M9','IN','ar','B'),('RAJALOTTERY','M8','IN','ar','RAJA'),
 ('CONFLICT','M8','IN','ar','CONFLICT'),('CONFLICT','M9','IN','ar','CONFLICT'),
 ('BLANK','','IN','ar','BLANK'),('BLANK',null,'IN','ar','BLANK'),
 ('PARTIAL','M8','IN','ar','PARTIAL'),('PARTIAL','','IN','ar','PARTIAL'),
 ('OTHERCOUNTRY','M8','BR','ar','OTHERCOUNTRY'),('OTHERSOURCE','M8','IN','newar','OTHERSOURCE'),
 ('A-B','M9','IN','ar','A-B'),('AB','M8','IN','ar','AB');
 create function private.dashboard_admin_live_platforms() returns table(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) language sql stable security definer as $$
 select null::uuid,name,team,'印度',scope_group,source,'Asia/Kolkata','INR',source_name from private.team_test_directory d
 where private.dashboard_scope_allows(private.dashboard_current_data_scope(),scope_group,source_name)$$;
 create function private.dashboard_admin_live_workorder_provider_batch(p_names jsonb) returns table(country text,platform text,raw_provider text,channel_type text,provider text) language sql stable as $$select country,platform,raw_provider,channel_type,raw_provider from jsonb_to_recordset(p_names) n(country text,platform text,raw_provider text,channel_type text)$$;
 create table public.admin_deposit_followup_rows(id text primary key,country text,platform text,work_order_number text,order_number text,source_kind text,portal_payload jsonb,stale_at timestamptz);
 alter table public.admin_deposit_followup_rows add column amount numeric;
 alter table public.admin_deposit_followup_rows add column portal_team text;
 revoke all on public.admin_deposit_followup_rows from public,anon,authenticated;
 `);
 const original=fs.readFileSync(path.join(__dirname,'../supabase/admin-live-query.sql'),'utf8');await db.exec(original.slice(original.indexOf('create function private.dashboard_admin_live_scope()'),original.indexOf('create function private.dashboard_admin_live_platforms()')));
 await db.exec(file('001-storage.sql'));await db.exec(file('003-admin-read.sql'));
 const key=fs.readFileSync(path.join(__dirname,'../supabase/admin-live-workorder-platform-breakdown.sql'),'utf8');await db.exec(key.slice(key.indexOf('create or replace function private.dashboard_admin_live_workorder_platform_key'),key.indexOf('create or replace function private.dashboard_admin_live_workorders')));
 const sql=read('admin-workorder-original-order-analysis.sql');await db.exec(sql);
 await db.exec(read('migrations/20260928101625_admin_workorder_records_scope_first.sql'));
 await db.exec(read('migrations/20260928103518_admin_workorder_records_narrow_page.sql'));
 await db.exec(read('migrations/20260929150000_workorder_provider_analysis.sql'));
 const hashes=(await db.query("select proname,md5(prosrc) hash from pg_proc where oid in ('private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure,'private.dashboard_admin_live_workorder_analysis(jsonb)'::regprocedure) order by proname")).rows;
 assert.deepEqual(hashes,[{proname:'dashboard_admin_live_workorder_analysis',hash:'e7d9182db042bec4e8575c8ce1787f7f'},{proname:'dashboard_admin_live_workorder_records',hash:'ab848a368b34a76fcd7acebe44905087'}]);
 baselineDefinitions=(await db.query("select pg_get_functiondef(oid) definition from pg_proc where oid in ('private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure,'private.dashboard_admin_live_workorder_analysis(jsonb)'::regprocedure) order by proname")).rows.map(r=>r.definition);
 await db.exec(migration());

 await ingest([
  record('A1',{amount:'100',payment_order_no:'SAME',third_party:'APay'}),
  record('A2',{amount:'100',payment_order_no:'SAME',third_party:'APay',status_code:4}),
  record('AOLD',{amount:'30',submitted_date:'2026-09-25',submitted_at:'2026-09-25T00:00:00Z',third_party:'APay'}),
  record('B1',{platform:'B',amount:'200',payment_order_no:'SAME',third_party:'BPay'}),
  record('BOLD',{platform:'B',amount:'80',submitted_date:'2026-09-25',submitted_at:'2026-09-25T00:00:00Z',third_party:'BPay'}),
  record('RAJA1',{platform:'RAJA',amount:'50',payment_order_no:'ALIAS',third_party:'RPay'}),
  record('RAJA2',{platform:'RAJALOTTERY',amount:'50',payment_order_no:'ALIAS',third_party:'RPay'}),
  ...['CONFLICT','BLANK','PARTIAL','OTHERCOUNTRY','OTHERSOURCE','UNKNOWN','A-B','AB'].map(platform=>record(platform,{platform,amount:'7',third_party:'OtherPay'}))
 ]);
});
after(async()=>db?.close());
const filters=(extra={})=>({from:'2026-09-26',to:'2026-09-26',...extra});
const definitions=async()=>(await db.query("select pg_get_functiondef(oid) definition,proacl::text acl,proconfig,prosecdef,provolatile,md5(prosrc) hash from pg_proc where oid in ('private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure,'private.dashboard_admin_live_workorder_analysis(jsonb)'::regprocedure) order by proname")).rows;
test('exact reviewed migration replays without metadata or ACL changes',async()=>{
 const before=await definitions();await db.exec(migration());assert.deepEqual(await definitions(),before);
 assert.deepEqual(before.map(r=>r.hash),['e0128157a7ec8618c19155a8939833a2','f69e518360dbf021b49c4aa8ba7e6c72']);
 assert(before.every(r=>r.prosecdef&&r.provolatile==='s'&&r.acl==='{postgres=X/postgres,authenticated=X/postgres}'));
});
test('records and original list filter team before paging; options and summaries use same cohort',async()=>{
 const records=await query({operation:'list',filters:filters({team:'M8'})});assert.equal(records.total,5);
 assert.deepEqual(records.platforms,['A','AB','RAJALOTTERY']);assert.deepEqual(records.rows.map(r=>r.sourcePlatform).sort(),['A','A','AB','RAJA','RAJALOTTERY']);
 const orders=await query({view:'orders',operation:'list',filters:filters({team:'M8'})});assert.equal(orders.total,3);assert.deepEqual(orders.platforms,['A','AB','RAJA']);
 const alias=orders.rows.find(r=>r.platform==='RAJA');assert.equal(alias.ticketCount,2);assert.deepEqual(alias.sourcePlatforms,['RAJA','RAJALOTTERY']);
 for(const view of ['records','orders']){
  const r=await query({view,filters:filters({team:'M8'})});assert.equal(r.current.ticketCount,5);assert.equal(r.current.ticketAmount,'307.00000000');assert.equal(r.current.uniqueOrderCount,3);assert.equal(r.current.uniqueOrderAmount,'157.00000000');assert.equal(r.current.uniqueProcessedCount,1);
  assert.equal(r.previous.ticketCount,1);assert.equal(r.previous.ticketAmount,'30.00000000');assert.deepEqual(r.platforms,['A','AB','RAJA']);
  assert(!r.byProvider.some(p=>p.provider==='BPay'));assert.equal(r.byProvider.reduce((n,p)=>n+p.ticketCount,0),5);
 }
 const b=await query({view:'orders',operation:'list',filters:filters({team:'M9'})});assert.equal(b.total,2);assert.deepEqual(b.platforms,['A-B','B']);assert.equal(b.rows.find(r=>r.platform==='B').amount,'200.00000000');
});
test('unknown, blank, ambiguous or wrong-country/source directory assignments never guess a team',async()=>{
 for(const team of ['M8','M9','does-not-exist']){
  const r=await query({operation:'list',filters:filters({team})});
  assert(!r.rows.some(r=>['CONFLICT','BLANK','PARTIAL','OTHERCOUNTRY','OTHERSOURCE','UNKNOWN'].includes(r.sourcePlatform)));
 }
 for(const q of [{operation:'list'},{view:'orders',operation:'list'},{operation:'summary'}]){
  const r=await query({...q,filters:filters({team:'does-not-exist'})});assert.equal(r.total,0);assert.deepEqual(r.rows,[]);assert.deepEqual(r.platforms,[]);
  if(q.operation==='summary'){assert.equal(r.current.ticketCount,0);assert.equal(r.current.uniqueOrderCount,0);assert.deepEqual(r.byProvider,[]);}
 }
 // A second spelling with a conflicting team makes the whole canonical identity unresolved.
 await db.exec("insert into private.team_test_directory values('RAJALOTTERY','M9','IN','ar','RAJALOTTERY')");
 for(const team of ['M8','M9']){const r=await query({view:'orders',operation:'list',filters:filters({team})});assert(!r.rows.some(r=>r.platform==='RAJA'));}
 await db.exec("delete from private.team_test_directory where source_name='RAJALOTTERY'");
});
test('omitted or empty team preserves every existing response including unsupported views without team',async()=>{
 const qs=[{operation:'list'},{view:'orders',operation:'list'},{operation:'summary'},{view:'orders',operation:'summary'},{view:'missing',operation:'list'},{view:'workload',operation:'list'},{view:'records',operation:'detail',filters:filters({platform:'A',workorderId:'A1'})},{view:'orders',operation:'orderDetail',filters:{platform:'A',orderNo:'SAME',issueKind:'deposit'}}];
 const after=[];for(const q of qs)after.push(await query(q));
 for(const definition of baselineDefinitions)await db.exec(definition);
 const before=[];for(const q of qs)before.push(await query(q));
 assert.deepEqual(after,before);await db.exec(migration());
 for(let i=0;i<4;i++)assert.deepEqual(await query({...qs[i],filters:filters({team:''})}),after[i]);
});
test('team cannot widen physical-platform authorization through aliases or hidden directory entries',async()=>{
 await db.exec(`update public.dashboard_profiles set data_scope='{"countries":["IN"],"platforms":["RAJA","B"]}'`);
 try{
  for(const view of ['records','orders']){const r=await query({view,operation:'list',filters:filters({team:'M8',platform:'RAJALOTTERY'})});assert.equal(r.total,1);if(view==='orders')assert.deepEqual(r.rows[0].sourcePlatforms,['RAJA']);else assert.equal(r.rows[0].sourcePlatform,'RAJA');}
  const r=await query({filters:filters({team:'M8'})});assert.equal(r.current.ticketCount,1);assert.equal(r.current.ticketAmount,'50.00000000');assert.deepEqual(r.platforms,['RAJA']);
  const forbidden=await query({filters:filters({team:'M8',platform:'A'})});assert.equal(forbidden.current.ticketCount,0);
 }finally{await db.exec(`update public.dashboard_profiles set data_scope='{"all":true}'`);}
});
test('team values are strictly validated and even empty key is rejected outside supported operations',async()=>{
 for(const team of [null,0,false,{},[],['M8'],' M8','M8 ','M8\n','x'.repeat(201)]){
  for(const q of [{operation:'list'},{view:'orders',operation:'list'},{operation:'summary'}])await assert.rejects(()=>query({...q,filters:filters({team})}),/invalid_filter/);
 }
 for(const team of ['', 'M8']){
  for(const view of ['missing','workload'])await assert.rejects(()=>query({view,operation:'list',filters:filters({team})}),/invalid_filter/);
  await assert.rejects(()=>query({operation:'detail',filters:{team,platform:'A',workorderId:'A1'}}),/invalid_filter/);
  await assert.rejects(()=>query({view:'orders',operation:'orderDetail',filters:{team,platform:'A',orderNo:'SAME',issueKind:'deposit'}}),/invalid_original_order_identity/);
 }
});
test('candidate filter precedes record and original pagination, and every summary uses full selected team',async()=>{
 await ingest(Array.from({length:105},(_,i)=>record('PAGE-'+String(i).padStart(3,'0'),{platform:'B',operator_account:'paging',third_party:'BPay'})).concat(Array.from({length:120},(_,i)=>record('PAGE-A-'+String(i).padStart(3,'0'),{operator_account:'paging',third_party:'APay'}))));
 for(const view of ['records','orders']){
  const r=await query({view,operation:'list',filters:filters({team:'M9',operator:'paging'}),limit:20,offset:100});assert.equal(r.total,105);assert.equal(r.rows.length,5);assert(r.rows.every(r=>r.platform==='B'));
  const summary=await query({view,operation:'summary',filters:filters({team:'M9',operator:'paging'}),limit:20,offset:100});assert.equal(summary.current.ticketCount,105);assert.equal(summary.current.uniqueOrderCount,105);assert(summary.byProvider.every(r=>r.provider==='BPay'));
 }
});
test('scope and canonical mapping remain per-platform rather than per-ticket',async()=>{
 await db.exec(`create sequence private.team_scope_calls;create or replace function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language plpgsql volatile as $$begin perform nextval('private.team_scope_calls');return s->>'all'='true' or (s->'countries' ? c and s->'platforms' ? p);end$$;`);
 for(const operation of ['list','summary']){
  await db.exec("alter sequence private.team_scope_calls restart with 1");await query({operation,filters:filters({team:'M9'})});
  assert(Number((await db.query('select last_value from private.team_scope_calls')).rows[0].last_value)<60);
 }
});
test('baseline guards reject definition, security setting and ACL drift and preserve reviewed definitions',async()=>{
 const original=await definitions();
 for(const mutation of [
  "alter function private.dashboard_admin_live_workorder_records(jsonb) set statement_timeout='21s'",
  "alter function private.dashboard_admin_live_workorder_analysis(jsonb) security invoker",
  "grant execute on function private.dashboard_admin_live_workorder_records(jsonb) to anon",
  "grant execute on function private.dashboard_admin_live_workorder_analysis(jsonb) to authenticated with grant option"
 ]){
  await db.exec(mutation);await assert.rejects(()=>db.exec(migration()),/workorder_team_(definition|acl)_drift/);await db.exec('rollback');
  await db.exec('revoke all on function private.dashboard_admin_live_workorder_records(jsonb) from anon');
  await db.exec('revoke grant option for execute on function private.dashboard_admin_live_workorder_analysis(jsonb) from authenticated');
  for(const r of original)await db.exec(r.definition);
 }
 await db.exec(original[0].definition.replace('begin\n','begin\n -- unexpected definition change\n'));
 await assert.rejects(()=>db.exec(migration()),/workorder_team_definition_drift/);await db.exec('rollback');
 for(const r of original)await db.exec(r.definition);await db.exec(migration());assert.deepEqual(await definitions(),original);
});
