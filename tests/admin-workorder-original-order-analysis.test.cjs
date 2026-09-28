// Scope-first query optimization: isolated PostgreSQL; synthetic identifiers only.
// Existing contract cases plus full old/new response equivalence, scope-call bound and drift guards.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');let db;
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
 create function private.dashboard_admin_live_platforms() returns table(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) language sql stable security definer as $$
 select null::uuid,n,t,'印度','IN','ar','Asia/Kolkata','INR',r from(values('A','M8','A'),('RAJALOTTERY','M8','RAJA'),('AB','M8','AB')) x(n,t,r) where private.dashboard_scope_allows(private.dashboard_current_data_scope(),'IN',r)$$;
 create table public.admin_deposit_followup_rows(id text primary key,country text,platform text,work_order_number text,order_number text,source_kind text,portal_payload jsonb,stale_at timestamptz);
 alter table public.admin_deposit_followup_rows add column amount numeric;
 alter table public.admin_deposit_followup_rows add column portal_team text;
 revoke all on public.admin_deposit_followup_rows from public,anon,authenticated;
 `);
 const original=fs.readFileSync(path.join(__dirname,'../supabase/admin-live-query.sql'),'utf8');await db.exec(original.slice(original.indexOf('create function private.dashboard_admin_live_scope()'),original.indexOf('create function private.dashboard_admin_live_platforms()')));
 await db.exec(file('001-storage.sql'));await db.exec(file('003-admin-read.sql'));
 const key=fs.readFileSync(path.join(__dirname,'../supabase/admin-live-workorder-platform-breakdown.sql'),'utf8');await db.exec(key.slice(key.indexOf('create or replace function private.dashboard_admin_live_workorder_platform_key'),key.indexOf('create or replace function private.dashboard_admin_live_workorders')));
 const sql=fs.readFileSync(path.join(__dirname,'../supabase/admin-workorder-original-order-analysis.sql'),'utf8');await db.exec(sql);await db.exec(sql);
 await ingest([
  record('DUP1',{payment_order_no:'ORIGINAL-1',amount:'100',status_code:3,utr_matched:true,utr:'UTR-ORIGINAL-1'}),
  record('DUP2',{payment_order_no:'ORIGINAL-1',amount:'100',status_code:4,utr_matched:false}),
  record('OLD',{payment_order_no:'ORIGINAL-1',amount:'100',submitted_date:'2026-08-01',submitted_at:'2026-08-01T00:00:00Z'}),
  record('WITHDRAW',{payment_order_no:'ORIGINAL-1',amount:'200',issue_kind:'withdraw'}),
  record('OTHERPLATFORM',{payment_order_no:'ORIGINAL-1',amount:'300',platform:'B'}),
  record('MISSING1',{payment_order_no:null,source_order_no:'NOT-A-PAYMENT',amount:'7'}),
  record('MISSING2',{payment_order_no:null,source_order_no:'NOT-A-PAYMENT',amount:'8'}),
  record('CONFLICT1',{payment_order_no:'CONFLICT',amount:'11'}),
  record('CONFLICT2',{payment_order_no:'CONFLICT',amount:'12'}),
  record('MISSING-AMOUNT',{payment_order_no:'UNKNOWN-AMOUNT',amount:null}),
  record('PRIOR',{payment_order_no:'PRIOR',amount:'50',submitted_date:'2026-09-25',submitted_at:'2026-09-25T00:00:00Z'}),
  record('ALIAS1',{platform:'RAJA',payment_order_no:'ALIAS-ORDER',amount:'20'}),
  record('ALIAS2',{platform:'RAJALOTTERY',payment_order_no:'ALIAS-ORDER',amount:'20'}),
  record('CASE-LOWER',{payment_order_no:'original-1',amount:'1',submitted_date:'2026-08-01',submitted_at:'2026-08-01T00:00:00Z'})
 ]);
});
after(async()=>db?.close());
test('summary uses actual tickets and platform-direction-original identity; missing IDs never fallback',async()=>{
 const r=await query();assert.equal(r.source,'AR');assert.equal(r.current.ticketCount,11);assert.equal(r.current.rejectedTicketCount,10);assert.equal(r.current.kycYesCount,0);assert.equal(r.current.kycNoCount,0);assert.equal(r.current.kycUnknownCount,11);assert.equal(r.current.utrYesCount,1);assert.equal(r.current.utrNoCount,1);assert.equal(r.current.utrUnknownCount,9);assert.equal(r.current.ticketAmount,null);assert.equal(r.current.uniqueOrderCount,6);assert.equal(r.current.uniqueOrderAmount,null);assert.equal(r.current.uniqueProcessedCount,1);assert.equal(r.current.uniqueProcessedAmount,'100.00000000');assert.deepEqual(r.current.coverage,{source:'AR',status:'partial',missingOrderNumberCount:2,amountConflictCount:1,missingAmountCount:1,missingTicketAmountCount:1});
 assert.equal(r.previous.ticketCount,1);assert.equal(r.previous.uniqueOrderAmount,'50.00000000');assert.deepEqual(r.comparison,{label:'昨日',days:1,startDate:'2026-09-25',endDate:'2026-09-25'});assert.equal(r.changes.ticketCount.delta,'10');assert.equal(r.changes.ticketCount.percent,'1000.00');assert.deepEqual(r.rows,[]);
});
test('original list is server-paged and separates settled status and linkage counts',async()=>{
 const r=await query({view:'orders',operation:'list'});assert.equal(r.total,6);assert.equal(r.rows.length,6);const a=r.rows.find(r=>r.platform==='A'&&r.orderNo==='ORIGINAL-1'&&r.issueKind==='deposit');assert.equal(a.ticketCount,2);assert.equal(a.processed,true);assert.equal(a.processedTicketCount,1);assert.equal(a.rejectedTicketCount,1);assert.equal(a.amount,'100.00000000');assert.deepEqual(a.statusCounts,{'1':0,'2':0,'3':1,'4':1,'5':0,unknown:0});assert.deepEqual(a.kycCounts,{yes:0,no:0,unknown:2});assert.deepEqual(a.utrCounts,{yes:1,no:1,unknown:0});assert.deepEqual(a.utrValues,['UTR-ORIGINAL-1']);assert(!('success' in a));const conflict=r.rows.find(r=>r.orderNo==='CONFLICT');assert.equal(conflict.amount,null);assert.equal(conflict.amountStatus,'conflict');const alias=r.rows.find(r=>r.platform==='RAJA');assert.equal(alias.ticketCount,2);assert.deepEqual(alias.sourcePlatforms,['RAJA','RAJALOTTERY']);assert(!r.rows.some(r=>r.orderNo==='NOT-A-PAYMENT'));
});
test('exact original drawer includes all historical associated tickets and source operator fields',async()=>{
 const q={view:'orders',operation:'orderDetail',filters:{platform:'A',issueKind:'deposit',orderNo:'ORIGINAL-1'}};const r=await query(q);assert.equal(r.allHistory,true);assert.equal(r.total,3);assert.deepEqual(r.rows.map(r=>r.workorderId).sort(),['DUP1','DUP2','OLD']);assert.equal(r.rows[0].operatorAccount,'source-operator');assert.match(r.rows[0].operatedAt,/2026-09-26T/);assert.equal(r.rows[0].lastUpdatedBy,null);assert.equal(r.rows[0].sourceUpdatedAt,null);assert.equal(r.rows[0].utr,'UTR-ORIGINAL-1');assert.equal(r.rows[0].kycConnected,null);assert.equal(r.rows[0].utrMatched,true);assert.equal(r.previous,null);assert.equal(r.comparison,null);assert(!JSON.stringify(r).includes('tenant_id'));
 await assert.rejects(()=>query({...q,filters:{...q.filters,from:'2026-09-26',to:'2026-09-26'}}));
});
test('comparison is preceding equal length local calendar period and does not fabricate zero-base growth',async()=>{
 const r=await query({filters:{from:'2026-09-25',to:'2026-09-26',platform:'A'}});assert.deepEqual(r.comparison,{label:'前期',days:2,startDate:'2026-09-23',endDate:'2026-09-24'});assert.equal(r.previous.ticketCount,0);assert.equal(r.changes.ticketCount.percent,null);assert.equal(r.changes.ticketCount.delta,'9');
 const all=await query({filters:{orderNo:'ORIGINAL-1',platform:'A'}});assert.equal(all.allHistory,true);assert.equal(all.previous,null);assert.equal(all.comparison,null);
});
test('missing original coverage is unavailable rather than zero actual orders, empty cohort is known zero',async()=>{
 const r=await query({filters:{from:'2026-09-26',to:'2026-09-26',workorderId:'MISSING',maxAmount:'9'}});assert.equal(r.current.ticketCount,2);assert.equal(r.current.uniqueOrderCount,null);assert.equal(r.current.uniqueProcessedCount,null);assert.equal(r.current.coverage.status,'unavailable');
 const empty=await query({filters:{from:'2026-09-01',to:'2026-09-01'}});assert.equal(empty.current.uniqueOrderCount,0);assert.equal(empty.current.uniqueOrderAmount,'0');assert.equal(empty.current.coverage.status,'complete');
});
test('scope is checked on physical platforms before alias union, authorization and ACL remain fresh',async()=>{
 await db.exec(`update public.dashboard_profiles set data_scope='{"countries":["IN"],"platforms":["RAJA"]}'`);const r=await query({view:'orders',operation:'list',filters:{from:'2026-09-26',to:'2026-09-26',platform:'RAJALOTTERY'}});assert.equal(r.total,1);assert.equal(r.rows[0].ticketCount,1);assert.deepEqual(r.rows[0].sourcePlatforms,['RAJA']);assert.deepEqual(r.platforms,['RAJA']);
 const hidden=await query({view:'orders',operation:'orderDetail',filters:{platform:'A',orderNo:'ORIGINAL-1',issueKind:'deposit'}});assert.equal(hidden.total,0);
 await db.exec('set role authenticated');await assert.rejects(()=>db.exec('select * from public.ar_workorder_issue_details'));await db.exec('reset role');await db.exec(`update public.dashboard_profiles set active=false`);await assert.rejects(()=>query(),/preview_denied/);await db.exec(`update public.dashboard_profiles set active=true,role='viewer'`);await assert.rejects(()=>query(),/preview_denied/);await db.exec(`update public.dashboard_profiles set role='owner',data_scope='{"all":true}'`);await db.exec('set role anon');await assert.rejects(()=>query());await db.exec('reset role');
});
test('strict request validation and legacy records path remain intact',async()=>{
 const legacy=await query({view:'records',operation:'list'});assert.equal(legacy.total,11);assert(legacy.rows.some(r=>r.retained));
 for(const q of [{view:'missing'},{view:'workload'},{view:'records',operation:'orderDetail'},{view:'orders',operation:'delete'},{filters:{phone:'secret'}},{filters:{from:'2026-02-30',to:'2026-03-01'}},{country:'all'},{limit:500},{filters:{registrationStatus:'missing'}},{view:'orders',operation:'orderDetail',filters:{platform:'A',orderNo:'ORIGINAL-1'}}])await assert.rejects(()=>query(q));
});
test('local midnight and submitted date precedence, 31-day default calendar month query, deterministic pagination',async()=>{
 await ingest([record('FALLBACK',{submitted_date:null,submitted_at:'2026-09-25T18:30:00Z',operator_account:'boundary'}),record('NEXTDAY',{submitted_date:null,submitted_at:'2026-09-26T18:30:00Z',operator_account:'boundary'}),record('PRECEDENCE',{submitted_date:'2026-09-26',submitted_at:'2026-09-27T00:00:00Z',operator_account:'boundary'})]);
 const r=await query({filters:{from:'2026-09-26',to:'2026-09-26',operator:'boundary'}});assert.equal(r.current.ticketCount,2);const operation=await query({filters:{from:'2026-09-26',to:'2026-09-26',dateBasis:'operation',operator:'boundary'}});assert.equal(operation.current.ticketCount,3);
 await ingest(Array.from({length:105},(_,i)=>record('PAGE-'+String(i).padStart(3,'0'),{operator_account:'paging'})));const monthly=await query({filters:{from:'2026-09-01',to:'2026-09-30',operator:'paging'}});assert.equal(monthly.current.ticketCount,105);assert.equal(monthly.current.uniqueOrderCount,105);assert.deepEqual(monthly.comparison,{label:'前期',days:30,startDate:'2026-08-02',endDate:'2026-08-31'});
 const page=await query({view:'orders',operation:'list',filters:{from:'2026-09-01',to:'2026-09-30',operator:'paging'},limit:20,offset:100});assert.equal(page.rows.length,5);assert.equal(page.total,105);
});
test('authorization scales with platforms rather than ticket count',async()=>{
 await db.exec(`create sequence private.analysis_scope_calls;create or replace function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language plpgsql volatile as $$begin perform nextval('private.analysis_scope_calls');return s->>'all'='true' or (s->'countries' ? c and s->'platforms' ? p);end$$;`);await query({filters:{from:'2026-09-01',to:'2026-09-30'}});assert(Number((await db.query('select last_value from private.analysis_scope_calls')).rows[0].last_value)<10);
});

test('one known consistent original amount survives a missing duplicate amount while raw ticket sum stays unknown',async()=>{
 await ingest([record('KNOWN-PARTIAL-1',{payment_order_no:'KNOWN-PARTIAL',amount:'100',operator_account:'known-partial'}),record('KNOWN-PARTIAL-2',{payment_order_no:'KNOWN-PARTIAL',amount:null,operator_account:'known-partial'})]);
 const r=await query({filters:{from:'2026-09-26',to:'2026-09-26',operator:'known-partial'}});assert.equal(r.current.uniqueOrderCount,1);assert.equal(r.current.uniqueOrderAmount,'100.00000000');assert.equal(r.current.ticketAmount,null);assert.equal(r.current.coverage.status,'partial');assert.equal(r.current.coverage.missingTicketAmountCount,1);assert.equal(r.current.coverage.missingAmountCount,0);
});
test('one original with 105 historical tickets is fully paged, never silently truncated',async()=>{
 await ingest(Array.from({length:105},(_,i)=>record('HISTORY-PAGE-'+i,{payment_order_no:'ONE-PAGED-ORIGINAL',submitted_date:'2026-01-01',submitted_at:'2026-01-01T00:00:00Z'})));
 const r=await query({view:'orders',operation:'orderDetail',filters:{platform:'A',issueKind:'deposit',orderNo:'ONE-PAGED-ORIGINAL'},limit:20,offset:100});assert.equal(r.total,105);assert.equal(r.rows.length,5);assert(r.rows.every(r=>r.orderNo==='ONE-PAGED-ORIGINAL'));assert.equal(r.allHistory,true);
});
