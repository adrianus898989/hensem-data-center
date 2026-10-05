// Execute the shipped PostgreSQL reader against synthetic accepted-current-state
// AR/NEWAR tables and the real Sheet matcher. No production or attachment data.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');let db,metadata;
const read=n=>fs.readFileSync(path.join(__dirname,'../supabase',n),'utf8');
const migration=read('migrations/20261004081041_deposit_collected_workorder_statistics.sql');
const transactional=migration.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
const scalar=async(sql,p=[])=>Object.values((await db.query(sql,p)).rows[0])[0];
const call=async(filters={},extra={})=>scalar('select public.dashboard_admin_live_workorder_records($1)',[JSON.stringify({view:'missing',operation:'list',country:'IN',filters:{from:'2026-10-04',to:'2026-10-04',dateBasis:'submission',...filters},...extra})]);
const registration=read('migrations/20261005113038_workorder_registration_reconciliation.sql');
const registrationTransaction=registration.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
const meta=()=>scalar("select jsonb_object_agg(oid::regprocedure::text,to_jsonb(pg_proc)-'prosrc') from pg_proc where oid in ('public.dashboard_admin_deposit_statistics(jsonb)'::regprocedure,'private.dashboard_admin_deposit_statistics(jsonb)'::regprocedure,'public.dashboard_admin_execute(text,jsonb)'::regprocedure)");
const rejects=async(fn,pattern)=>{await db.exec('savepoint expected_error');await assert.rejects(fn,pattern);await db.exec('rollback to savepoint expected_error;release savepoint expected_error')};
const insert=async(table,row)=>{const cols=Object.keys(row);await db.query(`insert into ${table}(${cols.join(',')}) values(${cols.map((_,i)=>'$'+(i+1)).join(',')})`,cols.map(k=>row[k]));};
const ar=async(id,extra={})=>insert('public.ar_workorder_issue_details',{system_name:'AR',country_code:'IN',platform:'RAJA',work_order_id:id,work_order_no:'WN-'+id,payment_order_no:'RC-'+id,issue_kind:'deposit',amount:'12.34',third_party:'Pay',kyc_connected:true,status_code:3,submitted_date:'2026-10-04',submitted_at:'2026-10-03T19:00:00Z',observed_at:'2026-10-04T02:00:00Z',...extra});
const newar=async(id,extra={})=>insert('public.newar_detail_records',{id:id,platform:'DhaniWin',dataset:'workorder',source_id:id,order_number:'UNSAFE-FALLBACK-'+id,amount:'12.34',currency:'INR',provider:'Pay',status_code:'4',status_group:'success',created_at:'2026-10-03T19:00:00Z',captured_at:'2026-10-04T02:00:00Z',workorder_type:'存款未到账',raw:{depositOrderNo:'RC-'+id,kycConnectState:1},...extra});
const sheet=async(id,pay,extra={})=>insert('public.admin_deposit_issue_rows',{id,source_sheet:'fixture',source_tab:'核对',source_row:Number(id.replace(/\D/g,''))||1,country:'印度',platform:'RAJALOTTERY',order_number:pay,amount:'12.34',provider:'Pay',canonical_provider:'Pay',status:'未入款',confirmation_status:'已确认',match_status:'对得上',kyc_correct:'YES',utr_match:'YES',...extra});
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql as $$begin if current_setting('test.denied',true)='yes' then raise exception 'preview_denied';end if;return '{"mode":"fixture"}'::jsonb;end$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql as $$select $2='IN' and $3<>'HIDDEN' and (coalesce(current_setting('test.authorized_platform',true),'')='' or $3=current_setting('test.authorized_platform',true))$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select case upper(btrim($1)) when 'RAJA' then 'RAJALOTTERY' else upper(btrim($1)) end$$;
 create table private.test_catalog(source_name text,name text,scope_group text,country text,currency text,source text,team text default 'M8');
 insert into private.test_catalog(source_name,name,scope_group,country,currency,source) values ('RAJA','RAJALOTTERY','IN','印度','INR','ar'),('OTHER','OTHER','IN','印度','INR','ar'),('HIDDEN','HIDDEN','IN','印度','INR','ar'),('DhaniWin','DHANIWIN','IN','印度','INR','newar'),('MAANWIN','MAAN.WIN','IN','印度','INR','newar');
 create function private.dashboard_admin_live_platforms() returns table(source_name text,name text,scope_group text,country text,currency text,source text,team text) language sql as $$select * from private.test_catalog$$;
 create table public.ar_workorder_issue_details(system_name text,country_code text,platform text,work_order_id text,work_order_no text,payment_order_no text,issue_kind text,amount numeric,third_party text,channel_type text,kyc_connected boolean,status_code int,submitted_date date,submitted_at timestamptz,observed_at timestamptz,utr text,query_date date,query_basis text,primary key(system_name,country_code,platform,work_order_id));
 create index ar_date_idx on public.ar_workorder_issue_details(country_code,platform,submitted_date);
 create index ar_instant_idx on public.ar_workorder_issue_details(country_code,platform,submitted_at);
 create table public.newar_detail_platforms(platform text primary key,country_code text,country text,currency text,timezone text,enabled boolean,launch_at timestamptz);
 insert into public.newar_detail_platforms values ('DhaniWin','IN','印度','INR','Asia/Kolkata',true,null),('MAANWIN','IN','印度','INR','Asia/Kolkata',true,'2999-10-06T00:00:00Z'),('HIDDEN','IN','印度','INR','Asia/Kolkata',true,null);
 create table public.newar_detail_records(id text primary key,platform text,dataset text,source_id text,order_number text,amount numeric,currency text,provider text,channel_type text,status_code text,status_group text,created_at timestamptz,captured_at timestamptz,workorder_type text,raw jsonb,unique(platform,dataset,source_id));
 create index newar_created_idx on public.newar_detail_records(platform,dataset,created_at);
 revoke all on public.ar_workorder_issue_details,public.newar_detail_records,public.newar_detail_platforms from public,anon,authenticated;
 create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text);
 create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[]);
 create function private.dashboard_admin_live_provider_alias_values(text,text[]) returns text[] language sql as $$select $2$$;
 create function private.dashboard_admin_live_confirmed_provider(text,text,text) returns text language sql as $$select null::text$$;
 create function private.dashboard_admin_live_provider_alias(text,text) returns text language sql as $$select $2$$;`);
 const batch=read('admin-live-workorder-provider-batch.sql');await db.exec(batch.slice(batch.indexOf('create or replace function'),batch.indexOf('do $patch$')).replace('private.dashboard_admin_live_confirmed_usdt_provider(r.country,registry_raw)','private.dashboard_admin_live_confirmed_provider(r.country,r.platform,registry_raw)'));assert.equal(await scalar("select md5(prosrc) from pg_proc where oid='private.dashboard_admin_live_workorder_provider_batch(jsonb)'::regprocedure"),'12cc504d23658ed10d677deebb7e7049');
 const issues=read('admin-live-deposit-issues.sql');await db.exec(issues.slice(0,issues.indexOf('create or replace function private.dashboard_admin_live_deposit_issues'))+'commit;');await db.exec(read('admin-deposit-statistics.sql'));
 const roles=read('migrations/20260930180000_dashboard_roles.sql');let gateway=roles.slice(roles.indexOf('create or replace function public.dashboard_admin_execute'),roles.indexOf('revoke all on function public.dashboard_admin_execute'));
 gateway=gateway.replace("or action='depositStatistics' and (p_request->>'section'='details' or p_request->>'section'='kyc' and p_request->>'dimension'='orders')","or action='depositStatistics' and p_request->>'section'='details'");await db.exec(gateway);await db.exec('revoke all on function public.dashboard_admin_execute(text,jsonb) from public,anon,service_role;grant execute on function public.dashboard_admin_execute(text,jsonb) to authenticated');
 const hash=await scalar("select md5(prosrc) from pg_proc where oid='public.dashboard_admin_execute(text,jsonb)'::regprocedure");await db.exec(read('admin-deposit-reconciliation-v2.sql').replace('58412f1681b8e151d8e1f603bcbaec85',hash));
 await db.exec(migration);
 await db.exec(read('workorder-records/003-admin-read.sql'));await db.exec(read('admin-workorder-records-scope-first.sql'));await db.exec(read('admin-workorder-records-narrow-page.sql'));await db.exec(read('migrations/20260930160000_workorder_team_filter.sql').replaceAll("array['private.dashboard_admin_live_workorder_records(jsonb)','private.dashboard_admin_live_workorder_analysis(jsonb)']","array['private.dashboard_admin_live_workorder_records(jsonb)']"));
 metadata=await scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure");
 await db.exec(registration);
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));


const entry=async(id,pay,extra={})=>insert('public.admin_deposit_followup_rows',{id,source_sheet:'INPUT-CURRENT',source_tab:'RAJA',source_row:Number(id.replace(/\D/g,''))||1,country:'印度',platform:'RAJA',order_number:pay,amount:'12.34',source_kind:'sheet',followup_status:'Not Yet Received',...extra});
test('all unresolved AR statuses and NEWAR originals appear by submitted day without operation timestamps',async()=>{
 for(const status of [1,2,3,4,5])await ar('STATE'+status,{status_code:status});await newar('NEW',{status_code:'1'});
 const r=await call();assert.equal(r.version,2);assert.equal(r.total,6);assert.equal(r.summary.pendingCount,6);assert.equal(r.dateBasis,'submission');assert.equal(r.successBasis,'receipt');assert(r.rows.some(x=>x.sourceSystems.includes('newar')));assert(r.rows.some(x=>x.processingState==='processed'&&x.receiptState==='unknown'));assert.equal(r.coverage.complete,false);
});
test('same original across dates, tickets, physical aliases and sources counts once',async()=>{
 await ar('A',{payment_order_no:'RC-ONE',status_code:1});await ar('B',{payment_order_no:' rc-one ',submitted_date:'2026-10-03',status_code:3});await ar('A',{platform:'RAJALOTTERY',payment_order_no:'RC-ONE',status_code:1});
 await entry('e1','RC-ONE');await entry('e2',' rc-one ',{source_sheet:'INPUT-HISTORICAL'});await entry('e3','RC-ONE',{source_kind:'portal',source_sheet:'PORTAL',portal_team:'M8',portal_payload:{entry:{outcome:'pending'},workorders:['WN-A']}});await sheet('s1','RC-ONE');
 const r=await call(),o=r.rows[0];assert.equal(r.total,1);assert.equal(o.workorderCount,2);assert.equal(o.amount,12.34);assert.equal(o.registrationStatus,'matched');assert.equal(o.registrationMatchCount,4);assert.deepEqual(o.registrationSources.sort(),['portal','result_sheet','sheet']);assert.equal(r.summary.matchedAmount,12.34);
});
test('receipt evidence excludes plain same-order success, never other-order success or source processed',async()=>{
 for(const id of ['PAID','OTHER','DONE','CONFLICT','RESULT'])await ar(id,{status_code:id==='DONE'?4:3});
 await entry('e1','RC-PAID',{followup_status:'Success'});await entry('e2','RC-OTHER',{followup_status:'Success to other order'});await entry('e3','RC-CONFLICT',{followup_status:'Success'});await sheet('s1','RC-CONFLICT');await sheet('s2','RC-RESULT',{confirmation_status:'已入款',status:'已入款'});
 const r=await call(),by=Object.fromEntries(r.rows.map(x=>[x.orderNo,x]));assert.equal(r.summary.candidateCount,5);assert.equal(r.summary.excludedSuccessCount,2);assert(!by['RC-PAID']);assert(!by['RC-RESULT']);assert(by['RC-DONE']);assert.equal(by['RC-OTHER'].receiptState,'pending_marked');assert.equal(by['RC-CONFLICT'].registrationStatus,'review');assert.equal(by['RC-CONFLICT'].receiptState,'conflict');
 const processed=await call({successBasis:'processed'});assert(!processed.rows.some(x=>x.orderNo==='RC-DONE'));assert(processed.rows.some(x=>x.orderNo==='RC-PAID'));assert.equal(processed.successBasis,'processed');
});
test('confirmed registration sources distinguish missing from unavailable; status tabs share summaries',async()=>{
 await ar('REGISTERED');await ar('MISSING');await newar('UNAVAILABLE',{status_code:'1'});await entry('e1','RC-REGISTERED');
 const r=await call();assert.equal(r.summary.missingCount,1);assert.equal(r.summary.matchedCount,1);assert.equal(r.summary.reviewCount,1);assert.equal(r.rows.find(x=>x.orderNo==='RC-UNAVAILABLE').reason,'source_unavailable');
 const missing=await call({registrationStatus:'missing'});assert.equal(missing.total,1);assert.deepEqual(missing.summary,r.summary);assert.equal(missing.rows[0].orderNo,'RC-MISSING');
});
test('full identifiers, teams, country and authorised platform remain exact',async()=>{
 await ar('TARGET');await ar('HIDDEN',{platform:'HIDDEN'});await newar('HIDDEN-N',{platform:'HIDDEN'});
 await entry('e1','RC-TARGET',{platform:'OTHER'});await entry('e2','RC-TARGET',{country:'PK'});await entry('e3','RC-TARGET',{source_kind:'portal',portal_team:'OTHER',portal_payload:{entry:{outcome:'success'}}});await entry('e4','RC-TARGET-EXTRA');
 let r=await call();assert.equal(r.total,1);assert.equal(r.rows[0].registrationMatchCount,0);assert(!JSON.stringify(r).includes('HIDDEN'));
 await entry('e5',null,{source_kind:'portal',portal_team:'M8',portal_payload:{entry:{outcome:'pending'},workorders:['WN-TARGET']}});r=await call();assert.equal(r.rows[0].registrationStatus,'matched');assert.equal(r.rows[0].registrationMatchCount,1);
 await db.exec("select set_config('test.authorized_platform','OTHER',true)");r=await call();assert.equal(r.total,0);assert(!JSON.stringify(r).includes('RC-TARGET'));
});
test('amount and full-order contradictions require review; no first-row or newest-wins',async()=>{
 await ar('AMOUNT');await ar('ID');await ar('NOID',{payment_order_no:null});await newar('AMBIG',{status_code:'1',raw:{depositOrderNo:'RC-A',rechargeNumber:'RC-B'}});
 await entry('e1','RC-AMOUNT',{amount:999,followup_status:'Success'});await entry('e2','DIFFERENT',{work_order_number:'WN-ID'});
 const by=Object.fromEntries((await call()).rows.map(x=>[x.orderNo||x.workorders[0].workorderId,x]));assert.equal(by['RC-AMOUNT'].reason,'amount_conflict');assert.equal(by['RC-AMOUNT'].receiptState,'conflict');assert.equal(by['RC-ID'].reason,'identifier_conflict');assert.equal(by.NOID.reason,'no_identifiers');assert.equal(by.AMBIG.registrationStatus,'review');
});
test('registration dates do not truncate matching and stale Sheet rows do not match',async()=>{
 await ar('OLD');await ar('STALE');await entry('e1','RC-OLD',{followup_date:'2020-01-01'});await entry('e2','RC-STALE',{stale_at:'2026-10-03T01:00:00Z'});
 const by=Object.fromEntries((await call()).rows.map(x=>[x.orderNo,x]));assert.equal(by['RC-OLD'].registrationStatus,'matched');assert.equal(by['RC-STALE'].registrationStatus,'missing');
});
test('source country/local dates and launch eligibility are preserved',async()=>{
 await ar('BEFORE',{submitted_date:null,submitted_at:'2026-10-03T18:29:59Z'});await ar('EDGE',{submitted_date:null,submitted_at:'2026-10-03T18:30:00Z'});await ar('AUTHDATE',{submitted_date:'2026-10-03'});await newar('BEFORE-N',{created_at:'2026-10-03T18:29:59Z'});await newar('FUTURE',{platform:'MAANWIN'});await newar('WITHDRAW',{workorder_type:'提款未到账'});
 const r=await call();assert.equal(r.total,1);assert.equal(r.rows[0].orderNo,'RC-EDGE');
});
test('summary precedes deterministic pagination and limits evidence without truncating totals',async()=>{
 for(let i=0;i<23;i++)await ar('PAGE'+String(i).padStart(2,'0'));for(let i=0;i<45;i++)await entry('E'+(i+1),'RC-PAGE00');
 const first=await call(),next=await call({}, {offset:20,limit:20});assert.equal(first.total,23);assert.equal(first.rows.length,20);assert.equal(next.rows.length,3);assert.deepEqual(first.summary,next.summary);assert.equal(new Set([...first.rows,...next.rows].map(x=>x.id)).size,23);
 const row=first.rows.find(x=>x.orderNo==='RC-PAGE00');assert.equal(row.registrationMatchCount,45);assert.equal(row.registrationEvidence.length,40);assert(row.evidenceTruncated);
});
test('router metadata and grants are preserved and new helper remains owner-only',async()=>{
 assert.deepEqual(await scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure"),metadata);
 assert.equal(await scalar("select count(*) from pg_proc p cross join lateral aclexplode(coalesce(proacl,acldefault('f',proowner))) a where p.oid='private.dashboard_admin_workorder_registration(jsonb)'::regprocedure and a.grantee<>p.proowner"),0);
 await db.exec(registrationTransaction);assert.deepEqual(await scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure"),metadata);
 await db.exec('set role authenticated');await rejects(()=>db.query('select private.dashboard_admin_workorder_registration($1)',[{}]));await db.exec('reset role');
});
test('validated filters cannot broaden the specialised branch',async()=>{
 for(const [filters,extra] of [[{successBasis:'paid'},{}],[{dateBasis:'operation'},{}],[{operator:'x'},{}],[{from:'2026-01-01',to:'2026-10-04'},{}],[{}, {limit:500}],[{}, {operation:'detail'}],[{raw:'secret'},{}]])await rejects(()=>call(filters,extra));
});

test('processed option excludes a reliably handled peer of the same full original but does not alter receipt mode',async()=>{
 await ar('OLD',{payment_order_no:'RC-SHARED',status_code:3});await ar('RESOLVED',{payment_order_no:'RC-SHARED',status_code:4,submitted_date:'2026-10-03'});
 assert.equal((await call()).total,1);const processed=await call({successBasis:'processed'});assert.equal(processed.total,0);assert.equal(processed.summary.excludedSuccessCount,1);
 await ar('WRONG-AMOUNT',{payment_order_no:'RC-SHARED',amount:99,status_code:4});assert.equal((await call({successBasis:'processed'})).total,1);
});
test('exact status filters do not merge unprocessed states and missing amount stays unknown',async()=>{
 for(const status of [1,2,5])await ar('STATE'+status,{status_code:status});assert.equal((await call({statusCode:'1'})).total,1);assert.equal((await call({statusCode:'2'})).total,1);assert.equal((await call({statusCode:'5'})).total,1);
 await ar('NO-AMOUNT',{amount:null});const r=await call({orderNo:'RC-NO-AMOUNT'});assert.equal(r.summary.reviewAmount,null);assert.equal(r.summary.unknownAmountCount,1);assert.equal(r.rows[0].amount,null);
});
test('permission is rechecked and exact platform options never expose uncatalogued registration tabs',async()=>{
 await ar('VISIBLE');await entry('e1','RC-OTHER',{platform:'9KCLUB'});let r=await call();assert(!JSON.stringify(r).includes('9KCLUB'));
 await db.exec("select set_config('test.denied','yes',true)");await rejects(()=>call(),/preview_denied/);
});
test('migration rejects drift in router source, ACL and helper before changing either definition',async()=>{
 for(const change of ["alter function private.dashboard_admin_live_workorder_records(jsonb) set search_path='public'","grant execute on function private.dashboard_admin_live_workorder_records(jsonb) to anon","alter function private.dashboard_admin_workorder_registration(jsonb) security definer"]){
  await db.exec('savepoint drift');await db.exec(change);await assert.rejects(()=>db.exec(registrationTransaction),/REGISTRATION_(ROUTER|HELPER)/);await db.exec('rollback to savepoint drift;release savepoint drift');
 }
});
test('large scoped batch reads source partitions once, builds evidence after pagination, and keeps whole-population totals',async t=>{
 await db.exec(`insert into public.ar_workorder_issue_details(system_name,country_code,platform,work_order_id,work_order_no,payment_order_no,issue_kind,amount,third_party,status_code,submitted_date,submitted_at,observed_at)
  select 'AR','IN','RAJA','BATCH-'||i,'WN-BATCH-'||i,'RC-BATCH-'||i,'deposit',10.25,'Pay',1,'2026-10-04','2026-10-03T19:00:00Z','2026-10-04T02:00:00Z' from generate_series(1,2000) i`);
 await entry('E1','RC-BATCH-1',{amount:10.25});const r=await call({registrationStatus:'missing'});assert.equal(r.total,1999);assert.equal(r.summary.candidateCount,2000);assert.equal(r.summary.missingAmount,20489.75);assert.equal(r.rows.length,20);
 let sql=registration.slice(registration.indexOf(' with catalog as materialized ('),registration.indexOf(' into v_result;'));
 sql=sql.replace(/\bf->>/g,"('{}'::jsonb)->>");const constants={v_scope:"'{}'::jsonb",v_dates:"'range'",v_start:"date '2026-10-04'",v_end:"date '2026-10-04'",v_basis:"'receipt'",v_offset:'0',v_limit:'20'};
 for(const [name,value]of Object.entries(constants))sql=sql.replace(new RegExp('\\b'+name+'\\b','g'),value);
 const explanation=await scalar('explain(analyze,format json) '+sql);const plan=explanation[0];const nodes=[];function walk(n){nodes.push(n);for(const p of n.Plans||[])walk(p)}walk(plan.Plan);
 const sourceReads=nodes.filter(n=>['ar_workorder_issue_details','newar_detail_records','admin_deposit_followup_rows','admin_deposit_issue_rows'].includes(n['Relation Name']));
 assert(sourceReads.length>0);assert(sourceReads.every(n=>n['Actual Loops']<20),JSON.stringify(sourceReads.map(n=>[n['Relation Name'],n['Actual Loops']])));
 t.diagnostic('2000 originals: '+plan['Execution Time']+' ms; maximum physical source scan loops '+Math.max(...sourceReads.map(n=>n['Actual Loops'])));
});

test('same original marked successful stays excluded once across current and historical unresolved tickets',async()=>{
 await ar('PAID-TODAY',{payment_order_no:'RC-PAID-ONCE',status_code:1});await ar('PAID-YESTERDAY',{payment_order_no:'RC-PAID-ONCE',status_code:5,submitted_date:'2026-10-03'});
 await entry('e1','RC-PAID-ONCE',{followup_status:'Success'});await entry('e2','rc-paid-once',{followup_status:'Success',source_sheet:'INPUT-HISTORICAL'});
 const r=await call();assert.equal(r.summary.candidateCount,1);assert.equal(r.summary.excludedSuccessCount,1);assert.equal(r.summary.pendingCount,0);assert.equal(r.total,0);
});
test('ambiguous or blank directory team never authorises portal evidence or receipt exclusion',async()=>{
 await ar('PORTAL');await entry('e1','RC-PORTAL',{source_kind:'portal',portal_team:'M8',portal_payload:{entry:{outcome:'success'}}});
 await db.exec("update private.test_catalog set team='' where source_name='RAJA'");let r=await call();assert.equal(r.total,1);assert.equal(r.rows[0].registrationMatchCount,0);assert.equal(r.rows[0].receiptState,'unknown');
 await db.exec("update private.test_catalog set team='M8' where source_name='RAJA';insert into private.test_catalog(source_name,name,scope_group,country,currency,source,team)values('RAJALOTTERY','RAJALOTTERY','IN','印度','INR','ar','SECOND')");
 r=await call();assert.equal(r.total,1);assert.equal(r.rows[0].registrationMatchCount,0);assert.deepEqual(r.rows[0].registrationEvidence,[]);assert.equal(r.summary.excludedSuccessCount,0);
});
test('registration coverage respects the selected platform scope',async()=>{
 await ar('CHOSEN');await entry('e1','RC-UNRELATED',{platform:'OTHER'});await entry('e2','RC-CHOSEN',{platform:'RAJA'});
 const r=await call({platform:'RAJA'});assert.deepEqual(r.platforms,['RAJALOTTERY']);assert.equal(r.coverage.expectedPlatforms,1);assert.equal(r.rows[0].registrationMatchCount,1);assert(!JSON.stringify(r).includes('OTHER'));
});

test('actual router keeps old operation requests and explicitly routes new submission requests without changing metadata',async()=>{
 const platformHelper=read('admin-live-workorder-platform-breakdown.sql');await db.exec(platformHelper.slice(platformHelper.indexOf('create or replace function private.dashboard_admin_live_workorder_platform_key'),platformHelper.indexOf('create or replace function private.dashboard_admin_live_workorders')));
 await db.exec(`alter table public.ar_workorder_issue_details add column operated_at timestamptz,add column operation_time_source text,add column source_order_no text,add column operator_account text,add column utr_matched boolean,
  add column work_order_type_name text,add column work_order_name text,add column reminder_count integer,add column last_updated_by text,add column source_updated_at timestamptz,add column field_gaps jsonb,add column attachment_types jsonb`);
 await ar('OLD-OPERATED',{status_code:3,submitted_date:'2026-10-03',submitted_at:'2026-10-02T19:00:00Z',operated_at:'2026-10-04T02:00:00Z',operation_time_source:'operationTime'});
 await ar('NEW-SUBMITTED',{status_code:1});await newar('NEWAR-SUBMITTED',{status_code:'1'});
 const compat=read('migrations/20261005114818_workorder_registration_route_compatibility.sql').replace(/^begin;$/m,'').replace(/^commit;$/m,'');
 const helperBefore=await scalar("select to_jsonb(p) from pg_proc p where oid='private.dashboard_admin_workorder_registration(jsonb)'::regprocedure");
 await db.exec(compat);assert.deepEqual(await scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure"),metadata);
 const legacy=await call({dateBasis:'operation'});assert.equal(legacy.total,1);assert.equal(legacy.rows[0].workorderId,'OLD-OPERATED');assert.equal(legacy.version,undefined);assert.equal(legacy.summary.unknownOperationCount,0);
 const omitted=await scalar('select public.dashboard_admin_live_workorder_records($1)',[JSON.stringify({country:'IN',view:'missing',filters:{from:'2026-10-04',to:'2026-10-04'}})]);assert.deepEqual(omitted.rows,legacy.rows);
 const current=await call();assert.equal(current.version,2);assert.equal(current.total,2);assert(current.rows.some(x=>x.orderNo==='RC-NEW-SUBMITTED'));assert(current.rows.some(x=>x.orderNo==='RC-NEWAR-SUBMITTED'));assert.equal(current.successBasis,'receipt');
 await db.exec(compat);assert.deepEqual(await call(),current);assert.deepEqual(await scalar("select to_jsonb(p) from pg_proc p where oid='private.dashboard_admin_workorder_registration(jsonb)'::regprocedure"),helperBefore);
 for(const change of ["alter function private.dashboard_admin_live_workorder_records(jsonb) set search_path='public'","grant execute on function private.dashboard_admin_live_workorder_records(jsonb) to anon"]){await db.exec('savepoint compat_drift');await db.exec(change);await assert.rejects(()=>db.exec(compat),/REGISTRATION_COMPATIBILITY_/);await db.exec('rollback to savepoint compat_drift;release savepoint compat_drift')}
});

const processedDefault=read('migrations/20261005115805_workorder_processed_success_default.sql').replace(/^begin;$/m,'').replace(/^commit;$/m,'');
const applyProcessedDefault=async()=>{await db.exec(read('migrations/20261005114818_workorder_registration_route_compatibility.sql').replace(/^begin;$/m,'').replace(/^commit;$/m,''));await db.exec(processedDefault)};
test('user-confirmed default excludes handled AR and NEWAR originals while explicit receipt stays unchanged',async()=>{
 await ar('AR-HANDLED',{status_code:4});await newar('NEWAR-HANDLED');await ar('UNHANDLED',{status_code:1});
 const receiptBefore=await call({successBasis:'receipt'});await applyProcessedDefault();
 const r=await call();assert.equal(r.successBasis,'processed');assert.equal(r.total,1);assert.equal(r.rows[0].orderNo,'RC-UNHANDLED');assert.equal(r.summary.excludedSuccessCount,2);
 assert.deepEqual(await call({successBasis:''}),r);assert.deepEqual(await call({successBasis:'processed'}),r);assert.deepEqual(await call({successBasis:'receipt'}),receiptBefore);
});
test('reliable handled original stays excluded despite monetary/provider or registration differences',async()=>{
 await ar('OPEN',{payment_order_no:'RC-HANDLED-ORIGINAL',status_code:3});await ar('DONE',{payment_order_no:'RC-HANDLED-ORIGINAL',status_code:4,submitted_date:'2026-10-03',amount:99,third_party:'OtherPay'});
 await entry('e1','RC-HANDLED-ORIGINAL',{amount:50,followup_status:'Not Yet Received'});
 await applyProcessedDefault();const r=await call();assert.equal(r.total,0);assert.equal(r.summary.candidateCount,1);assert.equal(r.summary.excludedSuccessCount,1);
 const receipt=await call({successBasis:'receipt'});assert.equal(receipt.total,1);assert.equal(receipt.rows[0].registrationStatus,'review');
});
test('ambiguous original identity and conflicting status on one workorder remain separately reviewable',async()=>{
 await ar('CONFLICT',{payment_order_no:'RC-STATUS-CONFLICT',status_code:4});await ar('CONFLICT',{platform:'RAJALOTTERY',payment_order_no:'RC-STATUS-CONFLICT',status_code:1});
 await ar('NO-ORIGINAL',{payment_order_no:null,status_code:4});await newar('AMBIGUOUS',{raw:{depositOrderNo:'RC-ONE',rechargeNumber:'RC-OTHER'}});
 await entry('e1','RC-UNRELATED');await applyProcessedDefault();const r=await call();assert.equal(r.total,3);assert.equal(r.summary.excludedSuccessCount,0);assert.equal(r.summary.reviewCount,3);
 const state=r.rows.find(x=>x.orderNo==='RC-STATUS-CONFLICT');assert.equal(state.reason,'processing_conflict');assert.equal(state.registrationStatus,'review');assert.equal(state.processingState,'unknown');assert(r.rows.filter(x=>!x.orderNo).every(x=>x.reason==='no_identifiers'));
});
test('processed default migration is idempotent, preserves router and helper metadata, and rejects drift',async()=>{
 await db.exec(read('migrations/20261005114818_workorder_registration_route_compatibility.sql').replace(/^begin;$/m,'').replace(/^commit;$/m,''));
 const router=await scalar("select to_jsonb(p) from pg_proc p where oid='private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure"),helper=await scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.dashboard_admin_workorder_registration(jsonb)'::regprocedure");
 await db.exec(processedDefault);await db.exec(processedDefault);assert.deepEqual(await scalar("select to_jsonb(p) from pg_proc p where oid='private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure"),router);assert.deepEqual(await scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.dashboard_admin_workorder_registration(jsonb)'::regprocedure"),helper);
 assert.equal(await scalar("select md5(prosrc) from pg_proc where oid='private.dashboard_admin_workorder_registration(jsonb)'::regprocedure"),'f0cec4e43873303811948d00f12eb7bb');
 for(const change of ["grant execute on function private.dashboard_admin_workorder_registration(jsonb) to authenticated","alter function private.dashboard_admin_workorder_registration(jsonb) security definer","alter function private.dashboard_admin_live_workorder_records(jsonb) set statement_timeout='21s'"]){await db.exec('savepoint processed_drift');await db.exec(change);await assert.rejects(()=>db.exec(processedDefault),/REGISTRATION_PROCESSED_/);await db.exec('rollback to savepoint processed_drift;release savepoint processed_drift')}
});

const setMatching=read('migrations/20261005123905_workorder_registration_set_matching.sql').replace(/^begin;$/m,'').replace(/^commit;$/m,'');
test('set matching preserves full JSON across original identity, status, registration evidence and pagination',async()=>{
 await applyProcessedDefault();
 // The same registration matches both the original and several workorder aliases:
 // it must still count once, with the original amount counted once.
 await ar('LINK-A',{payment_order_no:'RC-LINK',status_code:1});
 await ar('LINK-B',{payment_order_no:'RC-LINK',status_code:3,submitted_date:'2026-09-01',submitted_at:'2026-08-31T20:00:00Z'});
 await ar('LINK-A',{platform:'RAJALOTTERY',payment_order_no:'RC-LINK',status_code:1});
 await entry('same-id','RC-LINK',{source_kind:'portal',portal_team:'M8',work_order_number:'WN-LINK-A',portal_payload:{entry:{outcome:'pending'},workorders:['LINK-A','WN-LINK-A','LINK-B','WN-LINK-B']}});
 await entry('historical','RC-LINK',{source_sheet:'INPUT-HISTORICAL',followup_date:'2020-01-01'});
 await sheet('same-id','RC-LINK');
 await ar('OPEN',{payment_order_no:'RC-SUCCESS',status_code:3});
 await ar('HANDLED',{payment_order_no:'RC-SUCCESS',status_code:4,submitted_date:'2026-09-01',amount:99,third_party:'OtherPay'});
 await entry('success-open2','RC-SUCCESS');
 await ar('PAID');await entry('paid3','RC-PAID',{followup_status:'Success'});
 await ar('AMOUNT');await entry('amount4','RC-AMOUNT',{amount:999});
 await ar('ID');await entry('id5','RC-WRONG',{work_order_number:'WN-ID'});
 await ar('CONFLICT',{payment_order_no:'RC-STATUS-CONFLICT',status_code:4});await ar('CONFLICT',{platform:'RAJALOTTERY',payment_order_no:'RC-STATUS-CONFLICT',status_code:1});
 await ar('MISSING');await ar('OTHER',{platform:'OTHER'});await entry('other6','RC-OTHER',{platform:'OTHER'});
 await ar('HIDDEN',{platform:'HIDDEN'});await entry('hidden7','RC-HIDDEN',{platform:'HIDDEN'});
 await entry('wrong-team8','RC-LINK',{source_kind:'portal',portal_team:'OTHER',portal_payload:{entry:{outcome:'success'}}});
 await entry('wrong-country9','RC-LINK',{country:'PK',followup_status:'Success'});
 await newar('AMBIG',{status_code:'1',raw:{depositOrderNo:'RC-ONE',rechargeNumber:'RC-OTHER'}});
 await newar('NEWAR-OPEN',{status_code:'1'});await newar('NEWAR-DONE',{status_code:'4'});
 for(let i=0;i<24;i++)await ar('PAGE'+String(i).padStart(2,'0'));for(let i=0;i<45;i++)await entry('PAGE-E'+i,'RC-PAGE00',{source_row:100+i});
 await db.exec(`insert into public.ar_workorder_issue_details(system_name,country_code,platform,work_order_id,work_order_no,payment_order_no,issue_kind,amount,third_party,status_code,submitted_date,submitted_at,observed_at)
 select 'AR','IN','RAJA','CAPPED-'||i,'WN-CAPPED-'||i,'RC-CAPPED','deposit',12.34,'Pay',1,'2026-10-04','2026-10-03T19:00:00Z','2026-10-04T02:00:00Z' from generate_series(1,101) i`);
 const queries=[{}, {successBasis:'receipt'}, {registrationStatus:'missing'}, {registrationStatus:'matched'}, {registrationStatus:'review'}, {platform:'RAJA'}, {orderNo:'RC-LINK'}, {workorderNo:'LINK-B'}, {statusCode:'1'}, {minAmount:'13'}, {utr:'not present'}, {kyc:'yes'}];
 const before=[];for(const filters of queries)before.push(await call(filters));
 const nextBefore=await call({}, {offset:20,limit:20});
 await db.exec(setMatching);
 for(let i=0;i<queries.length;i++)assert.deepEqual(await call(queries[i]),before[i],JSON.stringify(queries[i]));
 assert.deepEqual(await call({}, {offset:20,limit:20}),nextBefore);
 const linked=(await call({orderNo:'RC-LINK'})).rows[0];assert.equal(linked.registrationMatchCount,3);assert.equal(linked.workorderCount,2);assert.equal(linked.amount,12.34);assert.equal(linked.registrationStatus,'matched');
 const capped=(await call({orderNo:'RC-CAPPED'})).rows[0];assert.equal(capped.workorderCount,101);assert.equal(capped.workorders.length,100);assert.equal(capped.workordersTruncated,true);
 assert(!JSON.stringify(await call()).includes('RC-HIDDEN'));
 await db.exec("select set_config('test.authorized_platform','OTHER',true)");const restricted=await call();assert.equal(restricted.total,1);assert.equal(restricted.rows[0].platform,'OTHER');assert(!JSON.stringify(restricted).includes('RC-LINK'));
 await db.exec("select set_config('test.denied','yes',true)");await rejects(()=>call(),/preview_denied/);
});
test('dense registration batch avoids quadratic evidence and pagination rejoins even with low cardinality estimates',async t=>{
 await applyProcessedDefault();await db.exec(setMatching);
 const size=5000;
 await db.exec(`insert into public.ar_workorder_issue_details(system_name,country_code,platform,work_order_id,work_order_no,payment_order_no,issue_kind,amount,third_party,status_code,submitted_date,submitted_at,observed_at)
 select 'AR','IN',case when i%2=0 then 'RAJA' else 'OTHER' end,'DENSE-'||i,'WN-DENSE-'||i,'RC-DENSE-'||i,'deposit',10.25,'Pay',case when i%3=0 then 4 else 1 end,'2026-10-04','2026-10-03T19:00:00Z','2026-10-04T02:00:00Z' from generate_series(1,${size}) i`);
 await db.exec(`insert into public.admin_deposit_followup_rows(id,source_sheet,source_tab,source_row,country,platform,order_number,amount,source_kind,followup_status)
 select 'DENSE-E'||i,'INPUT','T',i,'印度',case when i%2=0 then 'RAJA' else 'OTHER' end,'RC-DENSE-'||i,10.25,'sheet','Not Yet Received' from generate_series(1,${size}) i`);
 const filters={from:'2026-10-01',to:'2026-10-31',registrationStatus:'matched'};
 const r=await call(filters);assert.equal(r.summary.candidateCount,size);assert.equal(r.summary.excludedSuccessCount,1666);assert.equal(r.total,3334);assert.equal(r.summary.matchedAmount,34173.5);assert.equal(r.rows.length,20);assert(r.rows.every(x=>x.registrationMatchCount===1));
 const body=await scalar("select prosrc from pg_proc where oid='private.dashboard_admin_workorder_registration(jsonb)'::regprocedure");
 let sql=body.slice(body.indexOf(' with catalog as materialized ('),body.indexOf(' into v_result;')).replace(/\bf->>/g,"('{\"registrationStatus\":\"matched\"}'::jsonb)->>");
 const constants={v_scope:"'{}'::jsonb",v_dates:"'range'",v_start:"date '2026-10-01'",v_end:"date '2026-10-31'",v_basis:"'processed'",v_offset:'0',v_limit:'20'};
 for(const [name,value]of Object.entries(constants))sql=sql.replace(new RegExp('\\b'+name+'\\b','g'),value);
 const explanation=await scalar('explain(analyze,format json) '+sql),plan=explanation[0],nodes=[];
 function walk(n){nodes.push(n);for(const p of n.Plans||[])walk(p)}walk(plan.Plan);
 // Assert executed work rather than a flaky wall-clock limit. The old reader
 // performs >66 million discarded join comparisons for this 5,000-row fixture.
 const rejected=nodes.reduce((sum,n)=>sum+(n['Rows Removed by Join Filter']||0)*(n['Actual Loops']||0),0);
 assert(rejected<size*50,JSON.stringify({rejected,size}));
 const repeated=nodes.filter(n=>n['Node Type']==='CTE Scan'&&n['Actual Rows']*n['Actual Loops']>size*30);
 assert.deepEqual(repeated.map(n=>[n['CTE Name'],n['Actual Rows'],n['Actual Loops']]),[]);
 assert(nodes.filter(n=>['CTE page_workorders','CTE page_evidence'].includes(n['Subplan Name'])).every(n=>n['Actual Loops']===1));
 t.diagnostic(`${size} originals + ${size} registrations: ${plan['Execution Time']} ms; ${rejected} discarded join comparisons`);
});
test('set-matching migration is guarded and idempotent with unchanged OIDs, owners, ACLs, volatility and timeouts',async()=>{
 await applyProcessedDefault();
 const router=await scalar("select to_jsonb(p) from pg_proc p where oid='private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure"),helper=await scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.dashboard_admin_workorder_registration(jsonb)'::regprocedure");
 await db.exec(setMatching);await db.exec(setMatching);
 assert.deepEqual(await scalar("select to_jsonb(p) from pg_proc p where oid='private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure"),router);
 assert.deepEqual(await scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.dashboard_admin_workorder_registration(jsonb)'::regprocedure"),helper);
 assert.equal(await scalar("select md5(prosrc) from pg_proc where oid='private.dashboard_admin_workorder_registration(jsonb)'::regprocedure"),'82332dfe28f2103981addfc26c95f12d');
 for(const change of ["grant execute on function private.dashboard_admin_workorder_registration(jsonb) to authenticated","alter function private.dashboard_admin_workorder_registration(jsonb) security definer","alter function private.dashboard_admin_live_workorder_records(jsonb) set statement_timeout='21s'", "create or replace function private.dashboard_admin_workorder_registration(p_query jsonb) returns jsonb language plpgsql stable set search_path='' as $$begin return '{}'::jsonb;end$$"]){await db.exec('savepoint set_matching_drift');await db.exec(change);await assert.rejects(()=>db.exec(setMatching),/REGISTRATION_SET_MATCHING_/);await db.exec('rollback to savepoint set_matching_drift;release savepoint set_matching_drift')}
});

const historyKeys=read('migrations/20261005133615_workorder_registration_history_keys.sql').replace(/^begin;$/m,'').replace(/^commit;$/m,'');
test('history-key matching preserves full JSON including cross-day success and physical identity conflicts',async()=>{
 await applyProcessedDefault();await db.exec(setMatching);
 // The same registration matches both the original and several workorder aliases:
 // it must still count once, with the original amount counted once.
 await ar('LINK-A',{payment_order_no:'RC-LINK',status_code:1});
 await ar('LINK-B',{payment_order_no:'RC-LINK',status_code:3,submitted_date:'2026-09-01',submitted_at:'2026-08-31T20:00:00Z'});
 await ar('LINK-A',{platform:'RAJALOTTERY',payment_order_no:'RC-LINK',status_code:1});
 await entry('same-id','RC-LINK',{source_kind:'portal',portal_team:'M8',work_order_number:'WN-LINK-A',portal_payload:{entry:{outcome:'pending'},workorders:['LINK-A','WN-LINK-A','LINK-B','WN-LINK-B']}});
 await entry('historical','RC-LINK',{source_sheet:'INPUT-HISTORICAL',followup_date:'2020-01-01'});
 await sheet('same-id','RC-LINK');
 await ar('OPEN',{payment_order_no:'RC-SUCCESS',status_code:3});
 await ar('HANDLED',{payment_order_no:'RC-SUCCESS',status_code:4,submitted_date:'2026-09-01',amount:99,third_party:'OtherPay'});
 await entry('success-open2','RC-SUCCESS');
 await ar('PAID');await entry('paid3','RC-PAID',{followup_status:'Success'});
 await ar('AMOUNT');await entry('amount4','RC-AMOUNT',{amount:999});
 await ar('ID');await entry('id5','RC-WRONG',{work_order_number:'WN-ID'});
 await ar('CONFLICT',{payment_order_no:'RC-STATUS-CONFLICT',status_code:4});await ar('CONFLICT',{platform:'RAJALOTTERY',payment_order_no:'RC-STATUS-CONFLICT',status_code:1});
 await ar('MISSING');await ar('OTHER',{platform:'OTHER'});await entry('other6','RC-OTHER',{platform:'OTHER'});
 await ar('HIDDEN',{platform:'HIDDEN'});await entry('hidden7','RC-HIDDEN',{platform:'HIDDEN'});
 await entry('wrong-team8','RC-LINK',{source_kind:'portal',portal_team:'OTHER',portal_payload:{entry:{outcome:'success'}}});
 await entry('wrong-country9','RC-LINK',{country:'PK',followup_status:'Success'});
 await newar('AMBIG',{status_code:'1',raw:{depositOrderNo:'RC-ONE',rechargeNumber:'RC-OTHER'}});
 await newar('NEWAR-OPEN',{status_code:'1'});await newar('NEWAR-DONE',{status_code:'4'});
 for(let i=0;i<24;i++)await ar('PAGE'+String(i).padStart(2,'0'));for(let i=0;i<45;i++)await entry('PAGE-E'+i,'RC-PAGE00',{source_row:100+i});
 await db.exec(`insert into public.ar_workorder_issue_details(system_name,country_code,platform,work_order_id,work_order_no,payment_order_no,issue_kind,amount,third_party,status_code,submitted_date,submitted_at,observed_at)
 select 'AR','IN','RAJA','CAPPED-'||i,'WN-CAPPED-'||i,'RC-CAPPED','deposit',12.34,'Pay',1,'2026-10-04','2026-10-03T19:00:00Z','2026-10-04T02:00:00Z' from generate_series(1,101) i`);
 await ar('LONG-UTR',{utr:'u'.repeat(5000),status_code:1});
 await ar('LONG-PROVIDER',{third_party:'供'.repeat(700),status_code:1});
 // Exact physical keys must not pull unrelated country/business/native-ID peers.
 await ar('BOUNDARY',{payment_order_no:'RC-BOUNDARY',status_code:1});
 await ar('BOUNDARY',{country_code:'PK',payment_order_no:'RC-BOUNDARY',status_code:4,submitted_date:'2026-09-01'});
 await ar('BOUNDARY',{platform:'RAJALOTTERY',issue_kind:'withdrawal',payment_order_no:'RC-BOUNDARY',status_code:4,submitted_date:'2026-09-01'});
 await ar('EMPTY-ALIAS',{payment_order_no:null,status_code:1});
 await ar('EMPTY-ALIAS',{platform:'RAJALOTTERY',payment_order_no:'RC-AMBIG-ALIAS',status_code:4,submitted_date:'2026-09-01'});
 await db.exec("insert into private.test_catalog(source_name,name,scope_group,country,currency,source,team) values('RAJALOTTERY','RAJALOTTERY','IN','印度','INR','newar','M8');insert into public.newar_detail_platforms values('RAJALOTTERY','IN','印度','INR','Asia/Kolkata',true,null)");
 await ar('CROSS-ID',{payment_order_no:'RC-AR-NATIVE',status_code:1});
 await newar('CROSS-ID',{platform:'RAJALOTTERY',created_at:'2026-09-01T00:00:00Z',raw:{depositOrderNo:'RC-NEW-NATIVE'}});
 await ar('CROSS-ORIGINAL',{payment_order_no:'RC-CROSS-ORIGINAL',status_code:1});
 await newar('NEW-RELATED',{platform:'RAJALOTTERY',created_at:'2026-09-01T00:00:00Z',raw:{depositOrderNo:'RC-CROSS-ORIGINAL'}});
 const queries=[{}, {successBasis:'receipt'}, {registrationStatus:'missing'}, {registrationStatus:'matched'}, {registrationStatus:'review'}, {platform:'RAJA'}, {orderNo:'RC-LINK'}, {workorderNo:'LINK-B'}, {statusCode:'1'}, {minAmount:'13'}, {utr:'not present'}, {kyc:'yes'}];
 const before=[];for(const filters of queries)before.push(await call(filters));
 const nextBefore=await call({}, {offset:20,limit:20});
 await db.exec(read('migrations/20261005134030_workorder_deposit_safe_cover.sql').replace(/^begin;$/m,'').replace(/^commit;$/m,''));await db.exec(historyKeys);
 const legacyShape=r=>{const copy=structuredClone(r);for(const key of ['missingAmountExact','matchedAmountExact','reviewAmountExact'])delete copy.summary[key];return copy};
 for(let i=0;i<queries.length;i++){const actual=await call(queries[i]);for(const kind of ['missing','matched','review']){assert.equal(actual.summary[kind+'AmountExact']===null,actual.summary[kind+'Amount']===null);if(actual.summary[kind+'AmountExact']!==null)assert.equal(Number(actual.summary[kind+'AmountExact']),actual.summary[kind+'Amount'])}assert.deepEqual(legacyShape(actual),before[i],JSON.stringify(queries[i]))}
 assert.deepEqual(legacyShape(await call({}, {offset:20,limit:20})),nextBefore);
 const linked=(await call({orderNo:'RC-LINK'})).rows[0];assert.equal(linked.registrationMatchCount,3);assert.equal(linked.workorderCount,2);assert.equal(linked.amount,12.34);assert.equal(linked.registrationStatus,'matched');
 const capped=(await call({orderNo:'RC-CAPPED'})).rows[0];assert.equal(capped.workorderCount,101);assert.equal(capped.workorders.length,100);assert.equal(capped.workordersTruncated,true);
 assert(!JSON.stringify(await call()).includes('RC-HIDDEN'));
 assert.equal((await call({orderNo:'RC-BOUNDARY'})).total,1);assert.equal((await call({orderNo:'RC-AR-NATIVE'})).total,1);assert.equal((await call({orderNo:'RC-CROSS-ORIGINAL'})).total,0);
 assert.equal((await call({workorderId:'EMPTY-ALIAS'})).rows[0].reason,'no_identifiers');
 await db.exec("select set_config('test.authorized_platform','OTHER',true)");const restricted=await call();assert.equal(restricted.total,1);assert.equal(restricted.rows[0].platform,'OTHER');assert(!JSON.stringify(restricted).includes('RC-LINK'));
 await db.exec("select set_config('test.denied','yes',true)");await rejects(()=>call(),/preview_denied/);
});
test('history-key migration preserves permissions and OIDs and restores only its local memory setting',async()=>{
 await applyProcessedDefault();await db.exec(setMatching);
 const router=await scalar("select to_jsonb(p) from pg_proc p where oid='private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure"),helper=await scalar("select to_jsonb(p)-'prosrc'-'proconfig' from pg_proc p where oid='private.dashboard_admin_workorder_registration(jsonb)'::regprocedure");
 const memory=await scalar("select current_setting('work_mem')");await db.exec(historyKeys);await db.exec(historyKeys);
 assert.deepEqual(await scalar("select to_jsonb(p) from pg_proc p where oid='private.dashboard_admin_live_workorder_records(jsonb)'::regprocedure"),router);
 assert.deepEqual(await scalar("select to_jsonb(p)-'prosrc'-'proconfig' from pg_proc p where oid='private.dashboard_admin_workorder_registration(jsonb)'::regprocedure"),helper);
 assert.deepEqual(await scalar("select proconfig from pg_proc where oid='private.dashboard_admin_workorder_registration(jsonb)'::regprocedure"),['search_path=""','work_mem=32MB']);
 await call();assert.equal(await scalar("select current_setting('work_mem')"),memory);
 await rejects(()=>call({successBasis:'invalid'}),/unsupported_registration_filter/);assert.equal(await scalar("select current_setting('work_mem')"),memory);
 for(const change of ["grant execute on function private.dashboard_admin_workorder_registration(jsonb) to authenticated","alter function private.dashboard_admin_workorder_registration(jsonb) security definer","alter function private.dashboard_admin_live_workorder_records(jsonb) set statement_timeout='21s'","alter function private.dashboard_admin_workorder_registration(jsonb) set work_mem='64MB'"]){await db.exec('savepoint history_drift');await db.exec(change);await assert.rejects(()=>db.exec(historyKeys),/REGISTRATION_HISTORY_/);await db.exec('rollback to savepoint history_drift;release savepoint history_drift')}
});
test('history-key batch retains 80000 physical records and original totals without repeated full CTE scans',async t=>{
 await applyProcessedDefault();await db.exec(setMatching);
 await db.exec(read('migrations/20261005134030_workorder_deposit_safe_cover.sql').replace(/^begin;$/m,'').replace(/^commit;$/m,''));
 await db.exec(historyKeys);
 await db.exec(`insert into public.ar_workorder_issue_details(system_name,country_code,platform,work_order_id,work_order_no,payment_order_no,issue_kind,amount,third_party,status_code,submitted_date,submitted_at,observed_at)
 select 'AR','IN',case when i%2=0 then 'RAJA' else 'OTHER' end,'HISTORY-'||i,'WN-HISTORY-'||i,'RC-HISTORY-'||i,'deposit',10.25,'Pay',case when i%3=0 then 4 else 1 end,'2026-10-04','2026-10-03T19:00:00Z','2026-10-04T02:00:00Z' from generate_series(1,50000) i;
 insert into public.ar_workorder_issue_details(system_name,country_code,platform,work_order_id,work_order_no,payment_order_no,issue_kind,amount,third_party,status_code,submitted_date,submitted_at,observed_at)
 select 'AR','IN',case when i%2=0 then 'RAJA' else 'OTHER' end,'OLDER-'||i,'WN-OLDER-'||i,'RC-HISTORY-'||i,'deposit',10.25,'Pay',case when i%5=0 then 4 else 3 end,'2026-09-01','2026-08-31T19:00:00Z','2026-09-01T02:00:00Z' from generate_series(1,30000) i;
 insert into public.admin_deposit_followup_rows(id,source_sheet,source_tab,source_row,country,platform,order_number,amount,source_kind,followup_status)
 select 'HISTORY-E'||i,'INPUT','T',i,'印度',case when i%2=0 then 'RAJA' else 'OTHER' end,'RC-HISTORY-'||i,10.25,'sheet','Not Yet Received' from generate_series(1,50000) i;
 analyze public.ar_workorder_issue_details;analyze public.admin_deposit_followup_rows;`);
 const filters={from:'2026-10-01',to:'2026-10-31',registrationStatus:'matched'};
 const r=await call(filters);assert.equal(r.summary.candidateCount,50000);assert.equal(r.summary.excludedSuccessCount,20666);assert.equal(r.total,29334);assert.equal(r.summary.matchedAmount,300673.5);assert.equal(r.rows.length,20);
 const body=await scalar("select prosrc from pg_proc where oid='private.dashboard_admin_workorder_registration(jsonb)'::regprocedure");
 let sql=body.slice(body.indexOf('with catalog as materialized ('),body.indexOf(' into v_result;')).replace(/\bf->>/g,"('{\"registrationStatus\":\"matched\"}'::jsonb)->>");
 for(const [name,value] of Object.entries({v_scope:"'{}'::jsonb",v_dates:"'range'",v_start:"date '2026-10-01'",v_end:"date '2026-10-31'",v_basis:"'processed'",v_offset:'0',v_limit:'20'}))sql=sql.replace(new RegExp('\\b'+name+'\\b','g'),value);
 await db.exec("set local work_mem='32MB'");const plan=(await scalar('explain(analyze,timing off,format json) '+sql))[0],nodes=[];
 function walk(n){nodes.push(n);for(const p of n.Plans||[])walk(p)}walk(plan.Plan);
 const related=nodes.find(n=>n['Subplan Name']==='CTE ar_related_safe_rows');assert.equal(related['Actual Rows'],80000);
 const fallbacks=nodes.find(n=>n['Subplan Name']==='CTE ar_fallback_keys');assert.equal(fallbacks['Actual Rows'],0);
 assert.deepEqual(nodes.filter(n=>n['Node Type']==='CTE Scan'&&n['Actual Rows']*n['Actual Loops']>80000*20).map(n=>[n['CTE Name'],n['Actual Loops']]),[]);
 const rejected=nodes.reduce((sum,n)=>sum+(n['Rows Removed by Join Filter']||0)*(n['Actual Loops']||0),0);assert(rejected<80000*100,JSON.stringify({rejected}));
 t.diagnostic(`50000 selected originals / 80000 physical records: ${plan['Execution Time']} ms; ${rejected} discarded join comparisons; long text preservation is covered by full-JSON equivalence`);
});
test('exact summary amount strings retain decimal precision and unknown totals alongside legacy numbers',async()=>{
 await applyProcessedDefault();await db.exec(setMatching);await db.exec(historyKeys);
 await ar('PRECISE-A',{amount:'9007199254740991.12345678',status_code:1});await ar('PRECISE-B',{amount:'0.00000001',status_code:1});
 await entry('SOURCE-COVERAGE','UNRELATED');const precise=await call({orderNo:'PRECISE'});
 assert.equal(precise.summary.missingAmountExact,'9007199254740991.12345679');assert.equal(typeof precise.summary.missingAmount,'number');
 assert.equal(precise.summary.matchedAmountExact,'0');assert.equal(precise.summary.reviewAmountExact,'0');
 await ar('PRECISE-UNKNOWN',{amount:null,status_code:1});const unknown=await call({orderNo:'PRECISE'});
 assert.equal(unknown.summary.missingAmount,null);assert.equal(unknown.summary.missingAmountExact,null);
});
test('NEWAR hash candidates require complete original identity recheck even under forced candidate collisions',async()=>{
 await applyProcessedDefault();await db.exec(setMatching);await db.exec(historyKeys);
 await newar('EXACT-OPEN',{status_code:'1',raw:{depositOrderNo:'RC-EXACT-OPEN'}});
 await newar('UNRELATED-HANDLED',{created_at:'2026-09-01T00:00:00Z',status_code:'4',raw:{depositOrderNo:'RC-DIFFERENT'}});
 const before=await call();assert.equal(before.summary.candidateCount,1);assert.equal(before.summary.excludedSuccessCount,0);
 let definition=await scalar("select pg_get_functiondef('private.dashboard_admin_workorder_registration(jsonb)'::regprocedure)");
 for(const field of ['depositOrderNo','rechargeNumber'])definition=definition.replaceAll("md5(upper(nullif(btrim(d.raw->>'"+field+"'),'')))","'forced-candidate-collision'::text");
 definition=definition.replaceAll('md5(o.payment_id)',"'forced-candidate-collision'::text");
 assert.equal((definition.match(/forced-candidate-collision/g)||[]).length,4);await db.exec(definition);
 assert.deepEqual(await call(),before);
 const body=await scalar("select prosrc from pg_proc where oid='private.dashboard_admin_workorder_registration(jsonb)'::regprocedure");
 let sql=body.slice(body.indexOf('with catalog as materialized ('),body.indexOf('), projected as'))+') select (select count(*) from newar_related_keys) candidates,(select count(*) from newar_related) exact_matches';
 sql=sql.replace(/\bf->>/g,"('{}'::jsonb)->>");for(const [name,value]of Object.entries({v_scope:"'{}'::jsonb",v_dates:"'range'",v_start:"date '2026-10-04'",v_end:"date '2026-10-04'"}))sql=sql.replace(new RegExp('\\b'+name+'\\b','g'),value);
 const counts=(await db.query(sql)).rows[0];assert.equal(counts.candidates,2);assert.equal(counts.exact_matches,1);
});
