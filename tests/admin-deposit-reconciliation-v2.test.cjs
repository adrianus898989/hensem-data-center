// Real PostgreSQL execution; synthetic IDs only. No production/attachment data.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');let db,beforeMeta;
const read=n=>fs.readFileSync(path.join(__dirname,'../supabase',n),'utf8');
const B1='11111111-1111-4111-8111-111111111111',B2='22222222-2222-4222-8222-222222222222';
const call=async q=>(await db.query('select public.dashboard_admin_deposit_statistics($1) value',[JSON.stringify(q||{})])).rows[0].value;
const kyc=async q=>call({section:'kyc',...q});
const scalar=async(sql,p=[])=>Object.values((await db.query(sql,p)).rows[0])[0];
const meta=()=>scalar("select jsonb_object_agg(oid::regprocedure::text,to_jsonb(pg_proc)-'prosrc') from pg_proc where oid in ('public.dashboard_admin_deposit_statistics(jsonb)'::regprocedure,'private.dashboard_admin_deposit_statistics(jsonb)'::regprocedure,'public.dashboard_admin_execute(text,jsonb)'::regprocedure)");
const sheet=async(id,order,amount,extra={})=>{const cols=['id','source_sheet','source_tab','source_row','country','platform','order_number','amount','provider','canonical_provider','status','confirmation_status','match_status','kyc_correct','utr_match','utr'];const row={id,source_sheet:'synthetic',source_tab:'UPI核对',source_row:Number(id.replace(/\D/g,''))||1,country:'印度',platform:'RAJA',order_number:order,amount,provider:'RawPay',canonical_provider:'Pay',status:'未入款',confirmation_status:'已确认',match_status:'对得上',kyc_correct:'YES',utr_match:'YES',utr:'SYNTHETIC-UTR',...extra};await db.query(`insert into public.admin_deposit_issue_rows(${cols.join(',')}) values(${cols.map((_,i)=>'$'+(i+1)).join(',')})`,cols.map(c=>row[c]));};
const obs=async(row,extra={})=>{const r={batch_id:B1,source_sheet:'三方未补',source_row:row,country_code:'IN',country:'印度',platform:'RAJALOTTERY',source_system:'ar_export',workorder_id:'WO-'+row,payment_order_id:'RC20260925PAY'+row,submitted_local:'2026-09-26 12:00:00',submitted_date:'2026-09-26',source_workorder_state:'已驳回',processing:'rejected',kyc_status:'connected',amount:'12.34',currency:null,provider:'Pay',utr_present:false,derived_match_basis:'same_member_amount',derived_check_state:'未查',...extra};const cols=Object.keys(r);await db.query(`insert into private.admin_deposit_kyc_observations(${cols.join(',')}) values(${cols.map((_,i)=>'$'+(i+1)).join(',')})`,cols.map(c=>r[c]));};
const batch=async(id,category,n)=>db.query(`insert into private.admin_deposit_kyc_import_batches(id,file_sha256,source_name,source_category,adapter_version,expected_rows) values($1,$2,$3,$4,'synthetic-v1',$5)`,[id,(id===B1?'a':'b').repeat(64),category+'-synthetic.xlsx',category,n]);
const rejects=async(fn,pattern)=>{await db.exec('savepoint expected_error');await assert.rejects(fn,pattern);await db.exec('rollback to savepoint expected_error;release savepoint expected_error');};
const publish=async id=>scalar('select private.dashboard_admin_deposit_kyc_publish($1)',[id]);
before(async()=>{db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
 create function private.dashboard_admin_live_scope() returns jsonb language sql as $$select '{"mode":"fixture"}'::jsonb$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql as $$select $2='IN' and $3<>'HIDDEN'$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select case upper(btrim($1)) when 'RAJA' then 'RAJALOTTERY' else upper(btrim($1)) end$$;`);
 const issues=read('admin-live-deposit-issues.sql');await db.exec(issues.slice(0,issues.indexOf('create or replace function private.dashboard_admin_live_deposit_issues'))+'commit;');await db.exec(read('admin-deposit-statistics.sql'));
 // Use the real repository gateway's pre-patch body; production CAS stays exact in the deliverable.
 const roleSql=read('migrations/20260930180000_dashboard_roles.sql');let gateway=roleSql.slice(roleSql.indexOf('create or replace function public.dashboard_admin_execute'),roleSql.indexOf('revoke all on function public.dashboard_admin_execute'));
 gateway=gateway.replace("or action='depositStatistics' and (p_request->>'section'='details' or p_request->>'section'='kyc' and p_request->>'dimension'='orders')","or action='depositStatistics' and p_request->>'section'='details'");await db.exec(gateway);await db.exec('revoke all on function public.dashboard_admin_execute(text,jsonb) from public,anon,service_role;grant execute on function public.dashboard_admin_execute(text,jsonb) to authenticated');
 beforeMeta=await meta();const hash=await scalar("select md5(prosrc) from pg_proc where oid='public.dashboard_admin_execute(text,jsonb)'::regprocedure");
 await db.exec(read('admin-deposit-reconciliation-v2.sql').replace('58412f1681b8e151d8e1f603bcbaec85',hash));
 await db.exec(read('migrations/20261005113528_deposit_unresolved_order_filter.sql'));
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));

test('same-order Sheet duplicates counted once; semantic conflicts separate, no first-row financial result',async()=>{
 await sheet('row1','RC20260925PAY',10);await sheet('row2','RC20260925PAY',10);
 await sheet('row3','RC20260925CONFLICT',20);await sheet('row4','RC20260925CONFLICT',21,{confirmation_status:'已入款',status:'已入款'});
 const r=await call({section:'details'});assert.equal(r.summary.count,2);assert.equal(r.summary.rawRowCount,4);assert.equal(r.summary.duplicateRows,1);assert.equal(r.summary.conflictCases,1);assert.equal(r.summary.amount,null);assert.equal(r.summary.knownAmount,10);assert.equal(r.summary.receivedCount,0);
 const c=r.rows.find(x=>x.conflict);assert.equal(c.amount,null);assert.equal(c.statisticsStatus,'conflict');assert.equal(c.status,'来源冲突');assert.equal(c.sourceRowCount,2);
 for(const section of ['providers','daily']){const g=await call({section,limit:100});assert.equal(g.rows.reduce((a,x)=>a+x.count,0),2);assert.equal(g.rows.reduce((a,x)=>a+x.conflictCases,0),1);}
});
test('original order scope includes platform; blank originals never merge; stale/hidden rows absent',async()=>{
 await sheet('row1','RC20260925PAY',10);await sheet('row2','RC20260925PAY',20,{platform:'OTHER'});await sheet('row3',null,3);await sheet('row4',null,4);await sheet('row5','PRIVATE-HIDDEN',999,{platform:'HIDDEN'});
 await db.exec("update public.admin_deposit_issue_rows set stale_at=now() where id='row4'");const r=await call({section:'details'});assert.equal(r.summary.count,3);assert(!JSON.stringify(r).includes('PRIVATE-HIDDEN'));
});
test('AS other-order/provider labels override old paid formula; no member KYC inference',async()=>{
 await sheet('row1','RC20260925PAY',10,{status:'已入款',confirmation_status:'入其他订单'});await sheet('row2','RC20260925PAY2',20,{status:'已入款',confirmation_status:'转其他三方'});await sheet('row3','RC20260925PAY3',30,{status:'已入款',confirmation_status:null});const r=await call();assert.equal(r.summary.receivedCount,0);assert.equal(r.summary.otherOrderCount,1);assert.equal(r.summary.otherProviderCount,1);assert.equal(r.summary.unclassifiedCount,1);
});
test('missing imports give unknown counts; incomplete rows invisible and publication verifies exact count',async()=>{
 assert.equal((await kyc()).summary.uniqueWorkorders,null);assert.equal((await kyc()).total,null);await batch(B1,'kyc',2);await obs(1);await rejects(()=>publish(B1),/import_batch_incomplete/);
 // The expected failure is isolated by a savepoint; publication remains incomplete.
 assert.equal((await kyc()).rows.length,0);await obs(2);assert.equal((await publish(B1)).rows,2);const r=await kyc();assert.equal(r.summary.uniqueWorkorders,2);assert.equal(r.coverage.complete,false);
});
test('connection is source field, not file label/manual YES; counts partition unique workorders',async()=>{
 await batch(B1,'kyc',3);await batch(B2,'non_kyc',2);await obs(1,{kyc_status:'connected'});await obs(2,{kyc_status:'unknown',source_system:'dhani_export'});await obs(3,{kyc_status:'disconnected'});
 await obs(1,{batch_id:B2,workorder_id:'WO-1',payment_order_id:'RC20260925PAY1',kyc_status:'connected'});await obs(2,{batch_id:B2,workorder_id:'WO-5',payment_order_id:'RC20260925PAY5',kyc_status:'disconnected'});await publish(B1);await publish(B2);
 const r=await kyc();assert.equal(r.summary.exportRows,5);assert.equal(r.summary.uniqueWorkorders,4);assert.equal(r.summary.duplicateExportRows,1);assert.deepEqual(r.kycSummary,{connected:{count:1},disconnected:{count:2},unknown:{count:1}});assert.equal(r.currency,null);assert.equal(r.summary.uniquePaymentAmount,null);assert.equal(r.coverage.complete,true);
 const u=await kyc({kycStatus:'unknown',dimension:'orders'});assert.equal(u.rows.length,1);assert.equal(u.rows[0].kycStatus,'unknown');assert.equal(u.rows[0].declaredFileKyc,'kyc');assert.equal(u.kycSummary.connected.count,1);
});
test('exact original/platform/amount match is independent of weak source assignment and never verified receipt',async()=>{
 await batch(B1,'kyc',1);await batch(B2,'non_kyc',0);await obs(1);await publish(B1);await publish(B2);await sheet('row1','RC20260925PAY1','12.34',{status:'已入款',confirmation_status:'已入款',kyc_correct:'YES'});
 const r=await kyc({dimension:'orders'});assert.equal(r.rows[0].matchStatus,'exact_unique');assert.equal(r.rows[0].receiptState,'unverified');assert.equal(r.rows[0].sourceWorkorderState,'已驳回');assert.equal(r.rows[0].derivedMatchBasis,'same_member_amount');assert.equal(r.rows[0].derivedCheckState,'未查');assert.equal(r.rows[0].manualKyc,'YES');assert.equal(r.summary.rejected.count,1);assert.equal(r.rows[0].currency,null);
});
test('online duplicate consistency, online conflicts, missing amount and source conflicts have different states',async()=>{
 await batch(B1,'kyc',5);await batch(B2,'non_kyc',0);for(let i=1;i<=5;i++)await obs(i,i===5?{source_conflict:true}:{});await publish(B1);await publish(B2);
 await sheet('row1','RC20260925PAY1','12.34');await sheet('row2','RC20260925PAY1','12.34');await sheet('row3','RC20260925PAY2','12.34');await sheet('row4','RC20260925PAY2','12.34',{utr:'DIFFERENT'});await sheet('row5','RC20260925PAY3',null);await sheet('row6','RC20260925PAY4','12.35');await sheet('row7','RC20260925PAY5','12.34');
 const r=await kyc({dimension:'orders'});const by=Object.fromEntries(r.rows.map(x=>[x.paymentOrderId,x]));assert.equal(by.RC20260925PAY1.matchStatus,'exact_duplicate');assert.equal(by.RC20260925PAY2.matchStatus,'ambiguous_online');assert.equal(by.RC20260925PAY2.manualKyc,null);assert.equal(by.RC20260925PAY3.matchStatus,'online_amount_missing');assert.equal(by.RC20260925PAY4.matchStatus,'amount_conflict');assert.equal(by.RC20260925PAY5.matchStatus,'source_conflict');assert(r.rows.every(x=>x.receiptState==='unverified'));
});
test('UTR is only compared via digest; raw UTR never enters KYC response',async()=>{
 await batch(B1,'kyc',1);await obs(1,{utr_present:true,utr_digest:crypto.createHash('sha256').update('SYNTHETIC-UTR').digest('hex')});await publish(B1);await sheet('row1','RC20260925PAY1','12.34');const r=await kyc({dimension:'orders'});assert.equal(r.rows[0].utrState,'match');assert.equal(r.rows[0].sourceUtrPresent,true);assert(!JSON.stringify(r).includes('SYNTHETIC-UTR'));assert(!JSON.stringify(r).includes('utr_digest'));
});
test('scope is applied before aggregation/options/matching and full original order is never numeric',async()=>{
 await batch(B1,'kyc',2);await obs(1,{platform:'HIDDEN',workorder_id:'PRIVATE-WO',payment_order_id:'PRIVATE-ID',provider:'PRIVATE-PAY'});await obs(2,{payment_order_id:'RC20260925000000000000000027'});await publish(B1);
 const r=await kyc({dimension:'orders'});assert.equal(r.summary.uniqueWorkorders,1);assert.equal(r.rows[0].paymentOrderId,'RC20260925000000000000000027');assert(!JSON.stringify(r).includes('PRIVATE'));assert.equal(r.sourceManifest.batches[0].rowCount,1);assert.deepEqual(r.options.platforms,['RAJALOTTERY']);
});
test('same payment multiple workorders counted once; currency known/mixed/unknown never silently added',async()=>{
 await batch(B1,'kyc',3);await obs(1,{currency:'INR'});await obs(2,{payment_order_id:'RC20260925PAY1',currency:'INR'});await obs(3,{currency:'INR',amount:'0.10'});await publish(B1);
 let r=await kyc();assert.equal(r.summary.uniqueWorkorders,3);assert.equal(r.summary.uniquePaymentOrders,2);assert.equal(r.summary.multipleWorkorderPayments,1);assert.equal(r.summary.uniquePaymentAmount,12.44);assert.equal(r.currency,'INR');
 await db.exec("update private.admin_deposit_kyc_observations set currency='USDT' where source_row=3");r=await kyc();assert.equal(r.summary.uniquePaymentAmount,null);assert.equal(r.summary.knownPaymentAmount,null);assert.equal(r.currency,null);
});
test('processing variants do not select first snapshot; submitted day is distinct from receipt order day',async()=>{
 await batch(B1,'kyc',2);await obs(1);await obs(2,{workorder_id:'WO-1',payment_order_id:'RC20260925PAY1',processing:'processed',source_workorder_state:'已处理'});await publish(B1);
 const r=await kyc({dateMode:'range',startAt:'2026-09-26T00:00:00Z',endAt:'2026-09-26T23:59:59Z'});assert.equal(r.summary.unknownProcessing.count,1);assert.equal(r.summary.processed.count,0);assert.equal((await kyc({dateMode:'range',startAt:'2026-09-25T00:00:00Z',endAt:'2026-09-25T23:59:59Z'})).summary.uniqueWorkorders,0);
});
test('Sheet followup is independent informational subset; portal does not inflate matches or money',async()=>{
 await batch(B1,'kyc',1);await obs(1);await publish(B1);await db.exec(`insert into public.admin_deposit_followup_rows(id,source_sheet,source_tab,source_row,country,platform,order_number,amount,source_kind,followup_at,followup_date) values
 ('f1','synthetic','RAJA',1,'印度','RAJA','RC20260925PAY1',12.34,'sheet','26/9/2026 12:00','2026-09-26'),
 ('f2','PORTAL','RAJA',2,'印度','RAJA','RC20260925PAY1',12.34,'portal','26/9/2026 13:00','2026-09-26'),
 ('f3','synthetic','RAJA',3,'印度','RAJA','RC20260925PAY1',99,'sheet','26/9/2026 14:00','2026-09-26');`);
 const r=await kyc({dimension:'orders'});assert.equal(r.rows[0].followupCount,1);assert.equal(r.rows[0].lastFollowupAt,'26/9/2026 12:00');assert.equal(r.rows[0].receiptState,'unverified');assert.equal(r.summary.uniquePaymentAmount,null);assert.equal((await call()).summary.count,0);
});
test('strict request shape, enums, range, pagination; no new raw/employee filters through kyc route',async()=>{
 for(const q of [{dimension:{}},{dimension:'raw'},{kycStatus:'YES'},{processing:null},{matchStatus:'paid'},{country:'US'},{query:[]},{query:'x\n'},{raw:true},{from:'2026-09-25'},{dateMode:'range'},{dateMode:'range',startAt:'2026-02-30T00:00:00Z',endAt:'2026-03-01T00:00:00Z'},{offset:-1},{limit:'20'},{limit:500},{sourceKind:'portal'}])await rejects(()=>kyc(q));
});
test('existing entry OIDs/ACLs retained; new source and helpers owner-only, anon cannot read',async()=>{
 assert.deepEqual(await meta(),beforeMeta);const leaks=await scalar(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname='private' and p.proname in ('dashboard_admin_deposit_kyc_publish','dashboard_admin_deposit_sheet_cases_v2','dashboard_admin_deposit_kyc_summary_v2','dashboard_admin_deposit_kyc_statistics','dashboard_admin_deposit_sheet_statistics_v2') and a.grantee<>p.proowner`);assert.equal(leaks,0);
 await db.exec('set role anon');await rejects(()=>call(),/permission denied/);await db.exec('reset role');await db.exec('set role authenticated');await rejects(()=>scalar('select count(*) from private.admin_deposit_kyc_observations'),/permission denied/);await rejects(()=>scalar("select private.dashboard_admin_deposit_kyc_publish($1)",[B1]),/permission denied/);await db.exec('reset role');
});

test('missing original amount cannot match exact; provenance is paired across files and source adapters',async()=>{
 await batch(B1,'kyc',2);await batch(B2,'non_kyc',1);await obs(1,{amount:null,all_source_sheet:'全部',all_source_row:101});await obs(2,{workorder_id:'COLLISION',all_source_row:202});await obs(2,{batch_id:B2,workorder_id:'COLLISION',source_system:'dhani_export',payment_order_id:'RC20260925OTHER',kyc_status:'unknown',all_source_row:303});await publish(B1);await publish(B2);await sheet('row1','RC20260925PAY1','12.34');
 const r=await kyc({dimension:'orders'});assert.equal(r.summary.uniqueWorkorders,3);assert.equal(r.rows.find(x=>x.paymentOrderId==='RC20260925PAY1').matchStatus,'source_conflict');
 const sources=r.rows.flatMap(x=>x.sources);assert.equal(sources.length,3);assert(sources.some(x=>x.sourceFile==='kyc-synthetic.xlsx'&&x.sourceRow===1&&x.allSourceRow===101));assert(sources.some(x=>x.sourceFile==='non_kyc-synthetic.xlsx'&&x.sourceRow===2&&x.allSourceRow===303));assert(sources.every(x=>x.sourceTab==='三方未补'));
});
test('different observed submission days select any evidenced day, and do not arbitrarily label earliest as authoritative',async()=>{
 await batch(B1,'kyc',2);await obs(1);await obs(2,{workorder_id:'WO-1',payment_order_id:'RC20260925PAY1',submitted_date:'2026-09-27'});await publish(B1);
 const r=await kyc({dimension:'date',dateMode:'range',startAt:'2026-09-27T00:00:00Z',endAt:'2026-09-27T23:59:59Z'});assert.equal(r.summary.uniqueWorkorders,1);assert.equal(r.rows[0].key,'未提供');assert.equal(r.rows[0].duplicateExportRows,1);
});
test('NULL class amounts stay unknown; conflict is an unclassified subset and classification counts conserve cases',async()=>{
 await sheet('row1','RC20260925MISSING',null);await sheet('row2','RC20260925CONFLICT',10);await sheet('row3','RC20260925CONFLICT',11);const r=await call();assert.equal(r.summary.unreceivedCount,1);assert.equal(r.summary.unreceivedAmount,null);assert.equal(r.summary.conflictCount,1);assert.equal(r.summary.unclassifiedAmount,null);
 const s=r.summary;assert.equal(s.receivedCount+s.unreceivedCount+s.otherOrderCount+s.otherProviderCount+s.unclassifiedCount,s.count);assert.equal(s.duplicateRows,0);assert.equal(s.collapsedRows,1);
});

test('source evidence is bounded and paired; full counts and duplicate totals survive truncation',async()=>{
 await batch(B1,'kyc',201);await obs(1,{all_source_sheet:'全部',all_source_row:101});await db.exec(`insert into private.admin_deposit_kyc_observations select batch_id,source_sheet,i,country_code,country,platform,source_system,workorder_id,payment_order_id,submitted_local,submitted_date,source_updated_local,source_workorder_state,processing,kyc_status,amount,currency,provider,source_deposit_state,utr_digest,utr_present,source_conflict,all_source_sheet,100+i,derived_match_basis,derived_check_state from private.admin_deposit_kyc_observations cross join generate_series(2,201) i where source_row=1`);await publish(B1);
 await sheet('row1','RC20260925PAY1','12.34');await db.exec(`insert into public.admin_deposit_issue_rows(id,source_sheet,source_tab,source_row,country,platform,order_number,amount,provider,canonical_provider,status,confirmation_status,match_status,kyc_correct,utr_match,utr) select 'dupe-'||i,source_sheet,source_tab,i,country,platform,order_number,amount,provider,canonical_provider,status,confirmation_status,match_status,kyc_correct,utr_match,utr from public.admin_deposit_issue_rows cross join generate_series(2,201) i where id='row1'`);
 const r=await kyc({dimension:'orders'}),o=r.rows[0];assert.equal(r.summary.exportRows,201);assert.equal(r.summary.uniqueWorkorders,1);assert.equal(o.sourceCount,201);assert.equal(o.sources.length,200);assert.equal(o.sourcesTruncated,true);assert.equal(o.sourceRow,null);assert(o.sources.every(x=>x.allSourceRow===100+x.sourceRow));assert.equal(o.onlineSourceCount,201);assert.equal(o.onlineSources.length,200);assert.equal(o.onlineSourcesTruncated,true);assert.equal(o.matchStatus,'exact_duplicate');assert(o.onlineSources.every(x=>x.amount===12.34&&x.manualKyc==='YES'));assert.equal((await call({section:'details'})).rows[0].sourcesTruncated,true);
});
test('definition/configuration drift fails before table mutation and original function metadata is preserved',async()=>{
 const script=read('admin-deposit-reconciliation-v2.sql').replace(/^begin;$/m,'').replace(/^commit;$/m,'');await db.exec('savepoint metadata_drift');await db.exec("alter function private.dashboard_admin_deposit_statistics(jsonb) set search_path='public'");await rejects(()=>db.exec(script),/deposit_statistics_definition_changed/);await db.exec('rollback to savepoint metadata_drift');assert.deepEqual(await meta(),beforeMeta);
});

test('unresolved filter runs before paging and grouping, excludes only current original confirmed received',async()=>{
 for(let i=1;i<=23;i++)await sheet('row'+i,'RC20260925PENDING'+i,i);
 await sheet('row30','RC20260925SUCCESS',100,{confirmation_status:'已入款'});
 await sheet('row31','RC20260925OTHER',200,{status:'已入款',confirmation_status:'入其他订单'});
 await sheet('row32','RC20260925TRANSFER',300,{status:'已入款',confirmation_status:'转其他三方'});
 await sheet('row33','RC20260925UNKNOWN',null,{status:null,confirmation_status:null});
 await sheet('row34','RC20260925CONFLICT',30);await sheet('row35','RC20260925CONFLICT',30,{confirmation_status:'已入款'});
 const first=await call({section:'details',followupState:'unresolved',offset:0,limit:20}),last=await call({section:'details',followupState:'unresolved',offset:20,limit:20});
 assert.equal(first.total,27);assert.equal(first.summary.count,27);assert.equal(first.rows.length,20);assert.equal(last.rows.length,7);assert.equal(first.summary.receivedCount,0);assert.equal(first.summary.unresolvedCount,27);assert.equal(first.summary.unresolvedAmount,null);assert.equal(first.summary.unknownAmountCount,2);
 assert([...first.rows,...last.rows].every(r=>r.statisticsStatus!=='received'));
 assert.equal(new Set([...first.rows,...last.rows].map(r=>r.id)).size,27);
 for(const section of ['providers','daily']){const r=await call({section,followupState:'unresolved',limit:100});assert.equal(r.rows.reduce((n,x)=>n+x.count,0),27);assert.equal(r.summary.count,27);}
 const paid=await call({section:'details',followupState:'received'});assert.equal(paid.total,1);assert.equal(paid.rows[0].orderNumber,'RC20260925SUCCESS');assert.equal(paid.summary.amount,100);
 const all=await call({followupState:'all'});assert.equal(all.summary.count,28);assert.equal(all.summary.receivedCount,1);assert.equal(all.summary.unresolvedCount,27);
});
test('unresolved request enum validated; source links retain exact per-record provenance',async()=>{
 for(const followupState of [null,{},0,'pending','unresolved\n'])await rejects(()=>call({followupState}),/invalid_followup_state/);
 await sheet('row1','RC20260925P',10,{source_sheet:'current-sheet',source_tab:'91CLUB'});
 const r=await call({section:'details',followupState:'unresolved'});assert.equal(r.rows[0].sourceSheet,'current-sheet');assert.equal(r.rows[0].sourceTab,'91CLUB');assert.equal(r.rows[0].sourceRow,1);
 await sheet('row2','RC20260925P',10,{source_sheet:'historic-sheet',source_tab:'Historic'});
 const merged=await call({section:'details',followupState:'unresolved'});assert.equal(merged.rows[0].sourceSheet,null);assert.deepEqual(new Set(merged.rows[0].sources.map(s=>s.sourceSheet)),new Set(['current-sheet','historic-sheet']));
});
test('unresolved migration retains helper identity and metadata, is idempotent, and rejects drift',async()=>{
 const functionMeta=()=>scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.dashboard_admin_deposit_sheet_statistics_v2(jsonb)'::regprocedure");
 const original=await functionMeta();const migration=read('migrations/20261005113528_deposit_unresolved_order_filter.sql').replace(/^begin;$/m,'').replace(/^commit;$/m,'');await db.exec(migration);assert.deepEqual(await functionMeta(),original);
 await db.exec('savepoint helper_drift');await db.exec("alter function private.dashboard_admin_deposit_sheet_statistics_v2(jsonb) set search_path='public'");await rejects(()=>db.exec(migration),/deposit_sheet_statistics_definition_changed/);await db.exec('rollback to savepoint helper_drift');assert.deepEqual(await functionMeta(),original);
});
