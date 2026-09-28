// Monthly narrow-page optimization: full-response equivalence against the already-applied scope-first function.
// Existing contract cases plus full old/new response equivalence, scope-call bound and drift guards.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');let db,baseline,oldDefinition,oldAcl;
const optimization=fs.readFileSync(path.join(__dirname,'../supabase/admin-workorder-records-narrow-page.sql'),'utf8');
const requests=[{},...['records','missing','workload'].flatMap(view=>['','A','RAJALOTTERY','AB','A-B','unavailable'].map(platform=>({view,filters:{from:'2026-09-26',to:'2026-09-26',platform}}))),{filters:{from:'2026-09-26',to:'2026-09-26',dateBasis:'operation'}},{filters:{orderNo:'RC20260926-OLD'}},{filters:{workorderId:'OLD'}},{operation:'detail',filters:{platform:'A',workorderId:'OLD'}},{filters:{from:'2026-09-25',to:'2026-09-27',provider:'Rs',operator:'source'}},{filters:{from:'2026-09-26',to:'2026-09-26',statusCode:'4'}},{country:'BR',filters:{from:'2026-09-26',to:'2026-09-26'}},{country:'BR',filters:{from:'2026-09-27',to:'2026-09-27'}}];
const file=n=>fs.readFileSync(path.join(__dirname,'../supabase/workorder-records',n),'utf8');
const query=async(q={})=>(await db.query('select public.dashboard_admin_live_workorder_records($1) value',[JSON.stringify({country:'IN',view:'records',operation:'list',filters:{from:'2026-09-26',to:'2026-09-26'},...q})])).rows[0].value;
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
 create function private.dashboard_admin_live_platforms() returns table(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) language sql stable security definer as $$
 select null::uuid,n,t,'印度','IN','ar','Asia/Kolkata','INR',r from(values('A','M8','A'),('RAJALOTTERY','M8','RAJA'),('AB','M8','AB')) x(n,t,r) where private.dashboard_scope_allows(private.dashboard_current_data_scope(),'IN',r)$$;
 create table public.admin_deposit_followup_rows(id text primary key,country text,platform text,work_order_number text,order_number text,source_kind text,portal_payload jsonb,stale_at timestamptz);
 alter table public.admin_deposit_followup_rows add column amount numeric;
 alter table public.admin_deposit_followup_rows add column portal_team text;
 revoke all on public.admin_deposit_followup_rows from public,anon,authenticated;
 `);
 const original=fs.readFileSync(path.join(__dirname,'../supabase/admin-live-query.sql'),'utf8');await db.exec(original.slice(original.indexOf('create function private.dashboard_admin_live_scope()'),original.indexOf('create function private.dashboard_admin_live_platforms()')));
 await db.exec(file('001-storage.sql'));await db.exec(file('003-admin-read.sql'));await db.exec(file('003-admin-read.sql'));
 await ingest([record('MATCH'),record('MISS'),record('MULTI'),record('NO-ID',{work_order_no:null,payment_order_no:null}),record('PORTAL'),record('FOREIGN-PLATFORM'),record('UNKNOWN-TIME',{operated_at:null,operation_time_source:null}),record('DONE',{status_code:4}),record('OTHER',{platform:'B'}),record('PH',{country_code:'PH',country:'菲律宾'}),record('OLD',{submitted_date:'2026-01-01',submitted_at:'2026-01-01T00:00:00Z',operated_at:'2026-01-01T00:00:00Z'}),record('ALIAS',{platform:'RAJA'}),record('PUNCT',{platform:'A-B'}),record('AB',{platform:'AB'})]);
 await db.exec(`insert into public.admin_deposit_followup_rows(id,country,platform,work_order_number,order_number,source_kind,portal_payload,stale_at) values
 ('matched','印度','A','WO-MATCH',null,'sheet',null,null),
 ('archived','印度','A','WO-MISS',null,'sheet',null,now()),
 ('dup1','印度','A','WO-MULTI',null,'sheet',null,null),('dup2','印度','A',null,'RC20260926-MULTI','sheet',null,null),
 ('portal','印度','A','WO-X / WO-PORTAL',null,'portal','{"workorders":["WO-X","WO-PORTAL"]}',null),
 ('wrong-platform','印度','B','WO-FOREIGN-PLATFORM',null,'sheet',null,null),
 ('wrong-country','菲律宾','A','WO-FOREIGN-PLATFORM',null,'sheet',null,null);
 update public.admin_deposit_followup_rows set portal_team='M8' where source_kind='portal';`);

 await ingest([record('DATE-FALLBACK',{submitted_date:null,submitted_at:'2026-09-25T18:30:00Z',operator_account:'date-boundary'}),
 record('DATE-END',{submitted_date:null,submitted_at:'2026-09-26T18:30:00Z',operator_account:'date-boundary'}),
 record('DATE-PRECEDENCE',{submitted_date:'2026-09-26',submitted_at:'2026-09-27T01:00:00Z',operator_account:'date-boundary'}),
 record('BR-BEFORE',{country_code:'BR',country:'巴西',submitted_date:null,submitted_at:'2026-09-27T02:59:59Z'}),
 record('BR-MIDNIGHT',{country_code:'BR',country:'巴西',submitted_date:null,submitted_at:'2026-09-27T03:00:00Z'})]);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/admin-workorder-records-scope-first.sql'),'utf8'));
 baseline=[];for(const request of requests)baseline.push(await query(request));
 oldDefinition=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure) definition")).rows[0].definition;
 oldAcl=(await db.query("select prosecdef,proconfig,proacl::text from pg_proc where oid='private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure")).rows;
 await db.exec(optimization);await db.exec(optimization);
});
after(async()=>db?.close());
test('every full response matches original across country, alias, view, date basis, exact history and local-midnight boundaries',async()=>{
 for(let i=0;i<requests.length;i++)assert.deepEqual(await query(requests[i]),baseline[i],JSON.stringify(requests[i]));
 const r=await query({filters:{from:'2026-09-26',to:'2026-09-26',operator:'date-boundary'}});
 assert.deepEqual(r.rows.map(row=>row.workorderId).sort(),['DATE-FALLBACK','DATE-PRECEDENCE']);
 assert.deepEqual((await query({country:'BR',filters:{from:'2026-09-26',to:'2026-09-26'}})).rows.map(row=>row.workorderId),['BR-BEFORE']);
 assert.deepEqual((await query({country:'BR',filters:{from:'2026-09-27',to:'2026-09-27'}})).rows.map(row=>row.workorderId),['BR-MIDNIGHT']);
 // Remove the extra boundary fixtures so the unchanged baseline contract tests retain their original expected counts.
 await db.exec("delete from public.ar_workorder_issue_details where work_order_id in ('DATE-FALLBACK','DATE-END','DATE-PRECEDENCE','BR-BEFORE','BR-MIDNIGHT')");
});

test('collected detail reads true records and retained status4 with fixed nonprivate projection',async()=>{const r=await query();assert.equal(r.sourceStatus,'ready');assert(r.rows.some(x=>x.statusCode===4));assert(r.rows.some(x=>x.platform==='RAJALOTTERY'));assert(r.rows.some(x=>x.platform==='A-B'));assert(r.rows.every(x=>x.readOnly&&x.retained&&x.attachmentAccess==='unavailable'));assert(!JSON.stringify(r).includes('tenant_id'));const d=await query({operation:'detail',filters:{platform:'A',workorderId:'OLD'}});assert.equal(d.total,1);assert.equal(d.rows[0].workorderId,'OLD');});
test('missing compares full identifiers within same platform and country; duplicates and no identifiers require review',async()=>{const r=await query({view:'missing'}),by=Object.fromEntries(r.rows.map(x=>[x.workorderId,x]));assert.equal(by.MATCH.registrationStatus,'matched');assert.deepEqual(by.MATCH.matchedBy,['workorderNo']);assert.equal(by.MISS.registrationStatus,'missing');assert.equal(by.MULTI.registrationStatus,'review');assert.equal(by.MULTI.registrationMatchCount,2);assert.equal(by['NO-ID'].registrationStatus,'review');assert.equal(by.PORTAL.registrationStatus,'matched');assert.equal(by['FOREIGN-PLATFORM'].registrationStatus,'missing');assert(!by.DONE);assert(!by['UNKNOWN-TIME']);assert.equal(r.summary.unknownOperationCount,1);assert.equal((await query({view:'missing',filters:{from:'2026-09-26',to:'2026-09-26',registrationStatus:'review',platform:'A'}})).total,2);});
test('source workload uses operation date, employee and status, without inventing followup workload',async()=>{const r=await query({view:'workload'});assert(r.rows.every(x=>x.operatorAccount==='source-operator'&&x.date==='2026-09-26'));const a=r.rows.find(x=>x.platform==='A');assert.equal(a.handledCount,7);assert.equal(a.statusCounts['3'],6);assert.equal(a.statusCounts['4'],1);assert.equal(a.amount,'71.40000000');assert.equal(r.summary.unknownOperationCount,1);});
test('ingest replays and switching date basis never duplicate records or sums',async()=>{const before=await query({view:'workload'});await ingest([record('MATCH')]);assert.deepEqual((await query({view:'workload'})).rows,before.rows);const submitted=await query(),operated=await query({filters:{from:'2026-09-26',to:'2026-09-26',dateBasis:'operation'}});assert.equal(submitted.total,operated.total+1);});
test('every request rechecks profile, grant and exact platform/country scope',async()=>{await db.exec('set role authenticated');assert((await query()).total>0);await assert.rejects(()=>db.exec('select * from public.ar_workorder_issue_details'));await db.exec('reset role');
 await db.exec(`update public.dashboard_profiles set active=false`);await assert.rejects(()=>query(),/preview_denied/);await db.exec(`update public.dashboard_profiles set active=true,role='viewer'`);await assert.rejects(()=>query(),/preview_denied/);await db.exec(`insert into public.dashboard_admin_preview_grants values('10000000-0000-4000-8000-000000000001',true);update public.dashboard_profiles set data_scope='{"countries":["IN"],"platforms":["AB"]}'`);const r=await query();assert.equal(r.total,1);assert.equal(r.rows[0].sourcePlatform,'AB');assert.deepEqual(r.platforms,['AB']);assert.equal((await query({operation:'detail',filters:{platform:'A-B',workorderId:'PUNCT'}})).total,0);
 await db.exec(`update public.dashboard_profiles set role='owner',data_scope='{"all":true}'`);await db.exec('set role anon');await assert.rejects(()=>query());await db.exec('reset role');});
test('independent column filters, fixed paging and exact historical IDs are validated',async()=>{assert.equal((await query({filters:{workorderId:'OLD'}})).total,1);assert.equal((await query({filters:{workorderId:'OL'}})).total,0);assert.equal((await query({filters:{from:'2026-09-26',to:'2026-09-26',workorderNo:'WO-MATCH',orderNo:'not same'}})).total,0);for(const q of [{country:'all'},{operation:'delete'},{filters:{phone:'private'}},{filters:{from:'2026-02-30',to:'2026-03-01'}},{view:'workload',filters:{statusCode:'4'}},{view:'records',filters:{registrationStatus:'missing'}},{limit:500},{account:{all:true}}])await assert.rejects(()=>query(q));});

test('amount conflict remains review and never changes source record counts',async()=>{
 await db.exec("update public.admin_deposit_followup_rows set amount=999 where id='matched'");const r=await query({view:'missing',filters:{from:'2026-09-26',to:'2026-09-26',workorderId:'MATCH'}});assert.equal(r.total,1);assert.equal(r.rows[0].registrationMatchCount,1);assert.equal(r.rows[0].matchStatus,'review');assert.equal(r.rows[0].reason,'amount_conflict');
 await db.exec("update public.admin_deposit_followup_rows set amount=10.2 where id='matched'");assert.equal((await query({view:'missing',filters:{from:'2026-09-26',to:'2026-09-26',workorderId:'MATCH'}})).rows[0].matchStatus,'matched');
});
test('page limits and local midnight retain deterministic ticket counts',async()=>{
 await ingest(Array.from({length:105},(_,i)=>record('PAGE-'+String(i).padStart(3,'0'),{operator_account:'paging-only'})));
 for(const limit of [20,50,100]){const q={filters:{from:'2026-09-26',to:'2026-09-26',operator:'paging-only'},limit};const first=await query(q);assert.equal(first.total,105);assert.equal(first.rows.length,limit);assert.equal((await query({...q,offset:100})).rows.length,5);}
 await ingest([record('MIDNIGHT',{operated_at:'2026-09-26T18:30:00Z',operator_account:'midnight-only'})]);
 const r=await query({view:'workload',filters:{from:'2026-09-27',to:'2026-09-27',operator:'midnight-only'}});assert.equal(r.total,1);assert.equal(r.rows[0].date,'2026-09-27');
});

test('last-update fallback never pretends to be a confirmed operation date',async()=>{
 await ingest([record('LAST-UPDATE',{operation_time_source:'lastUpdateTime',operator_account:'fallback-only'})]);
 const records=await query({filters:{from:'2026-09-26',to:'2026-09-26',operator:'fallback-only'}});assert.equal(records.total,1);assert.equal(records.rows[0].operationTimeSource,'lastUpdateTime');
 for(const view of ['missing','workload']){const r=await query({view,filters:{from:'2026-09-26',to:'2026-09-26',operator:'fallback-only'}});assert.equal(r.total,0);assert.equal(r.summary.fallbackOperationTimeCount,1);assert.equal(r.summary.unknownOperationCount,2);}
});

test('portal registration requires the confirmed same team even for identical platform and full order number',async()=>{
 await db.exec("insert into public.admin_deposit_followup_rows(id,country,platform,work_order_number,source_kind,portal_payload,portal_team) values ('cross-team','印度','A','WO-MISS','portal','{\"workorders\":[\"WO-MISS\"]}','香港')");
 const q={view:'missing',filters:{from:'2026-09-26',to:'2026-09-26',workorderId:'MISS'}};
 let r=await query(q);assert.equal(r.total,1);assert.equal(r.rows[0].registrationMatchCount,0);assert.equal(r.rows[0].matchStatus,'missing');
 await db.exec("update public.admin_deposit_followup_rows set portal_team='M8' where id='cross-team'");r=await query(q);assert.equal(r.rows[0].registrationMatchCount,1);assert.equal(r.rows[0].matchStatus,'matched');
 await ingest([record('UNASSIGNED',{platform:'UNASSIGNED'})]);
 await db.exec("insert into public.admin_deposit_followup_rows(id,country,platform,work_order_number,source_kind,portal_team) values ('unassigned','印度','UNASSIGNED','WO-UNASSIGNED','portal','M8')");
 r=await query({view:'missing',filters:{from:'2026-09-26',to:'2026-09-26',workorderId:'UNASSIGNED'}});assert.equal(r.rows[0].team,'');assert.equal(r.rows[0].matchStatus,'review');assert.equal(r.rows[0].reason,'team_unconfirmed');assert.equal(r.rows[0].registrationMatchCount,0);
});


test('scope checks scale with physical platforms and preserve whole-history metadata',async()=>{
 await db.exec(`insert into public.ar_workorder_issue_details(system_name,country_code,country,platform,work_order_id,issue_kind,observed_at,query_date,schema_version,query_basis,field_gaps,submitted_date,submitted_at,status_code)
 select 'AR','IN','印度','A','HISTORY-'||n,'deposit','2026-09-27T00:00:00Z','2026-01-01',2,'submission','{}','2026-01-01','2026-01-01T00:00:00Z',3 from generate_series(1,20000)n;
 create sequence private.scope_calls;
 create or replace function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language plpgsql volatile as $$begin
 perform nextval('private.scope_calls');return s->>'all'='true' or (s->'countries' ? c and s->'platforms' ? p);end$$;`);
 const r=await query();const calls=Number((await db.query('select last_value from private.scope_calls')).rows[0].last_value);
 assert(calls<30,'authorization must not run for every historical row: '+calls);
 assert(r.summary.unknownOperationCount>=20000,'whole-history unknown operation count must remain whole-history');
 assert(r.total<1000,'history-only rows must not leak into selected day');
 const definition=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure) definition")).rows[0].definition;
 assert.match(definition,/submitted_date between first_day and last_day/);
 assert.match(definition,/d\.submitted_date is null[\s\S]*d\.submitted_at>=first_day/);
 assert.equal((definition.match(/union all/g)||[]).length,5);
});

test('whole-month rows, counts and all filters remain identical after rehydrating only page keys',async()=>{
 await db.exec(`insert into public.ar_workorder_issue_details(system_name,country_code,country,platform,work_order_id,work_order_no,payment_order_no,issue_kind,amount,observed_at,query_date,schema_version,query_basis,field_gaps,submitted_date,submitted_at,operated_at,operation_time_source,status_code,operator_account,work_order_name,third_party)
 select 'AR','IN','印度',case when n%2=0 then 'A' else 'AB' end,'MONTH-'||lpad(n::text,5,'0'),'WM-'||n,'RM-'||n,
  case when n%3=0 then 'withdraw' else 'deposit' end,case when n%7=0 then null else n::numeric/10 end,'2026-09-28T00:00:00Z','2026-09-25',2,'submission','{}',
  '2026-09-01'::date+(n%25),('2026-09-01'::date+(n%25))::timestamp at time zone 'Asia/Kolkata',('2026-09-01'::date+(n%25))::timestamp at time zone 'Asia/Kolkata',
  'operationTime',1+(n%5),case when n%11=0 then null else 'month-operator' end,repeat('Wide fixture ',15),case when n%3=0 then 'Mixed' else 'Provider' end
 from generate_series(1,5000)n;`);
 const month={from:'2026-09-01',to:'2026-09-30'};
 const samples=[
  ...[0,50,4990,9000].map(offset=>({filters:month,offset})),
  ...['records','missing','workload'].flatMap(view=>[{}, {platform:'A'}, {platform:'AB'}, {dateBasis:'operation'}, {issueKind:'withdraw'}, {operator:'month-operator'}, {provider:'Mixed'}, {minAmount:'20',maxAmount:'100'}].map(extra=>({view,filters:{...month,...extra}}))),
  ...['missing','matched','review'].map(registrationStatus=>({view:'missing',filters:{...month,registrationStatus}})),
  {filters:{...month,workorderNo:'WM-'}},{filters:{...month,orderNo:'RM-'}},{filters:{...month,kyc:'unknown',utrMatch:'unknown'}},
  {filters:{...month,statusCode:'4'}},{operation:'detail',filters:{platform:'AB',workorderId:'MONTH-00001'}}
 ];
 await db.exec(oldDefinition);const expected=[];for(const request of samples)expected.push(await query(request));
 await db.exec(optimization);for(let i=0;i<samples.length;i++)assert.deepEqual(await query(samples[i]),expected[i],JSON.stringify(samples[i]));
 assert.equal(expected[0].rows.length,50);assert(expected[0].total>=5000);assert.equal(expected[3].rows.length,0);
 const row=(await query(samples.at(-1))).rows[0];assert.equal(row.workorderName,'Wide fixture '.repeat(15));assert.equal(row.orderNo,'RM-1');assert.equal(row.amount,'0.10000000');
 // Stable-key page rehydration must not turn a forbidden same-ID row into an authorized row.
 await db.exec(`update public.dashboard_profiles set data_scope='{"countries":["IN"],"platforms":["AB"]}'`);
 const scoped=await query({filters:month});assert(scoped.rows.every(row=>row.sourcePlatform==='AB'));assert.deepEqual(scoped.platforms,['AB']);
 assert.equal((await query({operation:'detail',filters:{platform:'A',workorderId:'MONTH-00002'}})).total,0);
 await db.exec(`update public.dashboard_profiles set data_scope='{"all":true}'`);
});

test('migration preserves privileges and source rows, is idempotent, and rejects an unrecognized baseline',async()=>{
 assert.deepEqual((await db.query("select prosecdef,proconfig,proacl::text from pg_proc where oid='private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure")).rows,oldAcl);
 const before=await query();await db.exec(optimization);assert.deepEqual(await query(),before);
 assert.equal(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260928103518_admin_workorder_records_narrow_page.sql'),'utf8'),optimization);
 assert.doesNotMatch(optimization,/\b(create table|alter table|insert into|delete from|update public\.|grant execute)\b/i);
 await db.exec('begin');try{
  await db.exec("create or replace function private.dashboard_admin_live_workorder_records(p_query jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$begin return '{}'::jsonb;end$$");
  await assert.rejects(db.exec(optimization),/scope-first optimization is required|baseline changed/);
 }finally{await db.exec('rollback');}
 assert.deepEqual(await query(),before);
});
