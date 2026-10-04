// Execute the shipped PostgreSQL reader against synthetic accepted-current-state
// AR/NEWAR tables and the real Sheet matcher. No production or attachment data.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');let db,metadata;
const read=n=>fs.readFileSync(path.join(__dirname,'../supabase',n),'utf8');
const migration=read('migrations/20261004081041_deposit_collected_workorder_statistics.sql');
const transactional=migration.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
const scalar=async(sql,p=[])=>Object.values((await db.query(sql,p)).rows[0])[0];
const call=async q=>scalar('select public.dashboard_admin_deposit_statistics($1)',[JSON.stringify({section:'kyc',dateMode:'range',startAt:'2026-10-04T00:00:00Z',endAt:'2026-10-04T23:59:59Z',...q})]);
const meta=()=>scalar("select jsonb_object_agg(oid::regprocedure::text,to_jsonb(pg_proc)-'prosrc') from pg_proc where oid in ('public.dashboard_admin_deposit_statistics(jsonb)'::regprocedure,'private.dashboard_admin_deposit_statistics(jsonb)'::regprocedure,'public.dashboard_admin_execute(text,jsonb)'::regprocedure)");
const rejects=async(fn,pattern)=>{await db.exec('savepoint expected_error');await assert.rejects(fn,pattern);await db.exec('rollback to savepoint expected_error;release savepoint expected_error')};
const insert=async(table,row)=>{const cols=Object.keys(row);await db.query(`insert into ${table}(${cols.join(',')}) values(${cols.map((_,i)=>'$'+(i+1)).join(',')})`,cols.map(k=>row[k]));};
const ar=async(id,extra={})=>insert('public.ar_workorder_issue_details',{system_name:'AR',country_code:'IN',platform:'RAJA',work_order_id:id,work_order_no:'WN-'+id,payment_order_no:'RC-'+id,issue_kind:'deposit',amount:'12.34',third_party:'Pay',kyc_connected:true,status_code:3,submitted_date:'2026-10-04',submitted_at:'2026-10-03T19:00:00Z',observed_at:'2026-10-04T02:00:00Z',...extra});
const newar=async(id,extra={})=>insert('public.newar_detail_records',{id:id,platform:'DhaniWin',dataset:'workorder',source_id:id,order_number:'UNSAFE-FALLBACK-'+id,amount:'12.34',currency:'INR',provider:'Pay',status_code:'4',status_group:'success',created_at:'2026-10-03T19:00:00Z',captured_at:'2026-10-04T02:00:00Z',workorder_type:'存款未到账',raw:{depositOrderNo:'RC-'+id,kycConnectState:1},...extra});
const sheet=async(id,pay,extra={})=>insert('public.admin_deposit_issue_rows',{id,source_sheet:'fixture',source_tab:'核对',source_row:Number(id.replace(/\D/g,''))||1,country:'印度',platform:'RAJALOTTERY',order_number:pay,amount:'12.34',provider:'Pay',canonical_provider:'Pay',status:'未入款',confirmation_status:'已确认',match_status:'对得上',kyc_correct:'YES',utr_match:'YES',...extra});
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
 create function private.dashboard_admin_live_scope() returns jsonb language sql as $$select '{"mode":"fixture"}'::jsonb$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql as $$select $2='IN' and $3<>'HIDDEN' and (coalesce(current_setting('test.authorized_platform',true),'')='' or $3=current_setting('test.authorized_platform',true))$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select case upper(btrim($1)) when 'RAJA' then 'RAJALOTTERY' else upper(btrim($1)) end$$;
 create table private.test_catalog(source_name text,name text,scope_group text,country text,currency text,source text);
 insert into private.test_catalog values ('RAJA','RAJALOTTERY','IN','印度','INR','ar'),('OTHER','OTHER','IN','印度','INR','ar'),('HIDDEN','HIDDEN','IN','印度','INR','ar'),('DhaniWin','DHANIWIN','IN','印度','INR','newar'),('MAANWIN','MAAN.WIN','IN','印度','INR','newar');
 create function private.dashboard_admin_live_platforms() returns table(source_name text,name text,scope_group text,country text,currency text,source text) language sql as $$select * from private.test_catalog$$;
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
 metadata=await meta();await db.exec(migration);
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));

test('default router uses current collected AR/NEWAR tickets, not September export candidates',async()=>{
 await ar('A');await newar('N');await sheet('s1','RC-A');await sheet('s2','RC-N',{platform:'DhaniWin'});
 const r=await call({dimension:'orders'});assert.equal(r.source,'collected-workorders');assert.equal(r.summary.rawRecords,2);assert.equal(r.summary.uniqueWorkorders,2);assert.equal(r.summary.duplicateSourceRows,0);assert.equal(r.summary.exportRows,undefined);assert.equal(r.summary.uniquePaymentAmount,24.68);assert.equal(r.currency,'INR');assert.deepEqual(r.kycSummary,{connected:{count:1},disconnected:{count:0},unknown:{count:1}});
 assert(r.rows.every(x=>x.matchStatus==='exact_unique'&&x.receiptState==='unverified'));assert.equal(r.coverage.complete,false);assert.match(r.coverage.label,/已处理不代表实际到账/);assert.equal(new Date(r.updatedAt).toISOString(),'2026-10-04T02:00:00.000Z');
 assert(r.rows.flatMap(x=>x.sources).every(x=>x.workOrderId&&x.submittedAt&&x.observedAt&&x.amount===12.34&&x.currency==='INR'));assert(!JSON.stringify(r).includes('sourceFile'));
});
test('local submission day and AR submitted_date precedence ignore collector query/operation dates',async()=>{
 await ar('BEFORE',{submitted_date:null,submitted_at:'2026-10-03T18:29:59Z',query_date:'2026-10-04',query_basis:'operation'});
 await ar('BOUNDARY',{submitted_date:null,submitted_at:'2026-10-03T18:30:00Z'});
 await ar('AUTHORITATIVE',{submitted_date:'2026-10-03',submitted_at:'2026-10-04T01:00:00Z'});
 await newar('N-BEFORE',{created_at:'2026-10-03T18:29:59Z'});await newar('N-BOUNDARY',{created_at:'2026-10-03T18:30:00Z'});
 const r=await call({dimension:'orders'});assert.equal(r.summary.uniqueWorkorders,2);assert.deepEqual(r.rows.map(x=>x.workOrderId).sort(),['BOUNDARY','N-BOUNDARY']);
 assert.equal((await call({dateMode:'all'})).summary.uniqueWorkorders,5);
});
test('cross-day same-original peers retain amount/provider/state conflicts without inflating selected tickets',async()=>{
 await ar('SELECTED',{payment_order_no:'RC-SHARED'});await ar('PREVIOUS',{payment_order_no:' rc-shared ',submitted_date:'2026-10-03',amount:'12.35',status_code:4});await sheet('s1','RC-SHARED');
 const r=await call({dimension:'orders'}),o=r.rows[0];assert.equal(r.summary.uniqueWorkorders,1);assert.equal(r.summary.uniquePaymentOrders,1);assert.equal(r.summary.uniquePaymentAmount,null);assert.equal(o.workorderCount,1);assert.equal(o.relatedWorkorderCount,2);assert.equal(o.sources.length,2);assert.equal(o.matchStatus,'source_conflict');assert.equal(r.summary.rejected.count,1);assert.equal(r.summary.processed.count,0);assert.equal(o.amount,null);
 const manifest=r.sourceManifest.platforms.find(x=>x.system==='ar'&&x.platform==='RAJALOTTERY');assert.equal(manifest.selectedWorkorders,1);assert.equal(manifest.latestSubmittedDate,'2026-10-04');
});
test('physical platform aliases collapse one canonical workorder but keep conflicting paired source evidence',async()=>{
 await ar('ALIAS');await ar('ALIAS',{platform:'RAJALOTTERY',submitted_date:'2026-10-03',status_code:4,amount:'12.35',kyc_connected:false});await sheet('s1','RC-ALIAS');
 const r=await call({dimension:'orders'}),o=r.rows[0];assert.equal(r.summary.rawRecords,2);assert.equal(r.summary.uniqueWorkorders,1);assert.equal(r.summary.duplicateSourceRows,1);assert.equal(r.summary.unknownProcessing.count,1);assert.equal(r.summary.uniquePaymentAmount,null);assert.equal(o.kycStatus,'unknown');assert.equal(o.matchStatus,'source_conflict');assert.equal(o.sourceCount,2);assert.equal(o.sources.length,2);assert.equal(o.sources[0].workOrderId,'ALIAS');assert.equal(o.sources[1].workOrderId,'ALIAS');assert.deepEqual(o.sources.map(x=>x.amount).sort(),[12.34,12.35]);assert.deepEqual(o.sources.map(x=>x.sourcePlatform).sort(),['RAJA','RAJALOTTERY']);assert.equal(r.sourceManifest.platforms.find(x=>x.platform==='RAJALOTTERY').selectedWorkorders,1);
 await ar('OTHER-SAME-ID',{platform:'OTHER',work_order_id:'ALIAS',payment_order_no:'RC-OTHER'});assert.equal((await call()).summary.uniqueWorkorders,2);
});
test('same workorder id and same canonical original remain two tickets across AR and NEWAR',async()=>{
 await db.exec("insert into private.test_catalog values ('DhaniWin','DHANIWIN','IN','印度','INR','ar')");await ar('SAME',{platform:'DhaniWin'});await newar('SAME');
 const r=await call({dimension:'orders'});assert.equal(r.summary.uniqueWorkorders,2);assert.equal(r.summary.uniquePaymentOrders,1);assert.equal(r.summary.multipleWorkorderPayments,1);assert.equal(r.summary.duplicateSourceRows,0);assert.equal(r.rows.length,1);assert.equal(r.rows[0].workorderCount,2);assert.deepEqual(r.rows[0].sources.map(x=>x.sourceSystem).sort(),['ar','newar']);assert.equal(r.summary.uniquePaymentAmount,12.34);
});
test('separate source identities and missing full originals cannot be collapsed or replaced by order_number',async()=>{
 await ar('COLLISION',{platform:'OTHER',payment_order_no:'RC-AR'});await newar('COLLISION',{raw:{},order_number:'RC-AR'});await newar('MISSING2',{raw:{depositOrderNo:123,rechargeNumber:null},order_number:'RC-OTHER'});
 const r=await call({dimension:'orders'});assert.equal(r.summary.uniqueWorkorders,3);assert.equal(r.summary.uniquePaymentOrders,1);assert.equal(r.rows.filter(x=>!x.paymentOrderId).length,2);assert(!JSON.stringify(r).includes('UNSAFE-FALLBACK'));assert.equal(r.rows.find(x=>x.workOrderId==='COLLISION'&&!x.paymentOrderId).matchStatus,'missing_rc');assert.equal(r.rows.find(x=>x.workOrderId==='MISSING2').matchStatus,'source_conflict');
});
test('new AR explicit reference conflicts and unconfirmed KYC numbers remain unknown',async()=>{
 await newar('DIFFERENT',{raw:{depositOrderNo:'RC-A',rechargeNumber:'RC-B',kycConnectState:1}});await newar('SAME',{raw:{depositOrderNo:' rc-same ',rechargeNumber:'RC-SAME',kycConnectState:0}});await newar('STRING',{raw:{rechargeNumber:'RC202610040000000000000001',kycConnectState:'YES'}});
 const r=await call({dimension:'orders'});assert.equal(r.kycSummary.unknown.count,3);assert.equal(r.summary.uniquePaymentOrders,2);assert.equal(r.rows.find(x=>x.workOrderId==='DIFFERENT').paymentOrderId,null);assert.equal(r.rows.find(x=>x.workOrderId==='DIFFERENT').matchStatus,'source_conflict');assert.equal(r.rows.find(x=>x.workOrderId==='STRING').paymentOrderId,'RC202610040000000000000001');assert(r.rows.every(x=>x.kycStatus==='unknown'));
});
test('cross-day ambiguous new AR references remain conflicting evidence in both query directions',async()=>{
 await newar('SELECTED-A',{raw:{depositOrderNo:'RC-A'}});await newar('AMBIGUOUS-OLD',{created_at:'2026-10-03T01:00:00Z',raw:{depositOrderNo:'RC-A',rechargeNumber:'RC-B'}});await sheet('s1','RC-A',{platform:'DhaniWin'});
 let r=await call({dimension:'orders'}),o=r.rows[0];assert.equal(r.summary.uniqueWorkorders,1);assert.equal(r.summary.uniquePaymentAmount,null);assert.equal(o.paymentOrderId,'RC-A');assert.equal(o.matchStatus,'source_conflict');assert.equal(o.referenceConflictWorkorderCount,1);assert.equal(o.sources.length,2);const conflict=o.sources.find(x=>x.workOrderId==='AMBIGUOUS-OLD');assert.equal(conflict.referenceConflict,true);assert.deepEqual(conflict.paymentOrderReferences,['RC-A','RC-B']);
 // When the ambiguous ticket itself is selected, candidates remain searchable
 // but do not become a definitive original-order identity or money total.
 r=await call({dimension:'orders',query:'RC-B',startAt:'2026-10-03T00:00:00Z',endAt:'2026-10-03T23:59:59Z'});o=r.rows[0];assert.equal(r.summary.uniqueWorkorders,1);assert.equal(r.summary.uniquePaymentOrders,0);assert.equal(o.paymentOrderId,null);assert.equal(o.matchStatus,'source_conflict');assert.equal(o.sources.length,2);assert(o.sources.some(x=>x.workOrderId==='SELECTED-A'));assert.equal((await call({dimension:'orders',query:'RC-A',startAt:'2026-10-03T00:00:00Z',endAt:'2026-10-03T23:59:59Z'})).rows[0].paymentOrderId,null);
});
test('whole-case provider normalization happens before provider/processing/KYC filters',async()=>{
 await ar('KNOWN',{payment_order_no:'RC-P',third_party:'Pay',kyc_connected:true});await ar('UNKNOWN',{payment_order_no:'RC-P',third_party:'未识别三方',submitted_date:'2026-10-03'});
 let r=await call({provider:'Pay',dimension:'orders'});assert.equal(r.summary.uniqueWorkorders,1);assert.equal(r.rows[0].provider,'Pay');
 await ar('CONFLICT',{payment_order_no:'RC-P',third_party:'OtherPay',status_code:4,kyc_connected:false});
 assert.equal((await call({provider:'Pay'})).summary.uniqueWorkorders,0);r=await call({provider:'来源冲突',processing:'rejected',kycStatus:'connected',dimension:'orders'});assert.equal(r.summary.uniqueWorkorders,1);assert.equal(r.rows[0].matchStatus,'source_conflict');assert.equal(r.rows[0].sources.length,3);
});
test('scope and directory source identity precede candidate, option, manifest and Sheet reads',async()=>{
 await ar('VISIBLE');await ar('PRIVATE',{platform:'HIDDEN',payment_order_no:'PRIVATE-PAY',third_party:'PRIVATE-PROVIDER'});await newar('PRIVATE-N',{platform:'HIDDEN'});await ar('UNCATALOGUED',{platform:'UNKNOWN'});await newar('PK',{platform:'PK-FIXTURE'});await sheet('s1','RC-VISIBLE',{platform:'HIDDEN'});
 const r=await call({dimension:'orders'});assert.equal(r.summary.uniqueWorkorders,1);assert(!JSON.stringify(r).includes('PRIVATE'));assert(!JSON.stringify(r).includes('UNKNOWN'));assert.equal(r.rows[0].matchStatus,'platform_not_in_online_snapshot');
 await db.exec("select set_config('test.authorized_platform','RAJA',true)");const scoped=await call({dimension:'orders',platform:'RAJALOTTERY'});assert.equal(scoped.summary.uniqueWorkorders,1);assert.equal(scoped.sourceManifest.platforms.length,1);assert.deepEqual(scoped.options.platforms,['RAJALOTTERY']);
});
test('disabled, future-launch, wrong-country and non-deposit new AR records are excluded',async()=>{
 await newar('FUTURE',{platform:'MAANWIN'});await newar('WITHDRAW',{workorder_type:'提款未到账'});await newar('CHARGE',{dataset:'charge'});await newar('PRELAUNCH',{created_at:'2026-10-02T01:00:00Z'});
 await db.exec("update public.newar_detail_platforms set launch_at='2026-10-03T00:00:00Z' where platform='DhaniWin'");assert.equal((await call({dateMode:'all'})).summary.uniqueWorkorders,0);
 await newar('DISABLED');await db.exec("update public.newar_detail_platforms set enabled=false where platform='DhaniWin'");let r=await call();assert.equal(r.summary.uniqueWorkorders,0);assert(!r.sourceManifest.platforms.some(x=>x.system==='newar'));
 await db.exec("update public.newar_detail_platforms set enabled=true,country_code='PK' where platform='DhaniWin'");assert.equal((await call()).summary.uniqueWorkorders,0);
});
test('currency comes from the source/configuration, unknown or conflicting currencies never silently sum',async()=>{
 await ar('A');await newar('WRONG',{currency:'USDT'});let r=await call();assert.equal(r.summary.uniquePaymentAmount,null);assert.equal(r.currency,null);assert.equal(r.summary.unknownAmountOrders,1);
 await db.exec("delete from public.newar_detail_records;update private.test_catalog set currency=null where source_name='RAJA'");r=await call();assert.equal(r.summary.uniquePaymentAmount,null);assert.equal(r.summary.knownPaymentAmount,null);assert.equal(r.currency,null);
 await db.exec("insert into private.test_catalog select source_name,name,scope_group,country,'USDT',source from private.test_catalog where source_name='RAJA'");r=await call();assert.equal(r.summary.rawRecords,1);assert.equal(r.summary.uniqueWorkorders,1);assert.equal(r.currency,null);
});
test('bounded Sheet matching preserves duplicate/cross-alias/amount/UTR conflicts and follows only sheet records',async()=>{
 for(const id of ['DUP','VARIANT','MISSING','DIFFERENT','UTR'])await ar(id,{utr:'PRIVATE-UTR'});
 await sheet('s1','RC-DUP',{utr:'PRIVATE-UTR'});await sheet('s2',' rc-dup ',{platform:'RAJA',utr:'PRIVATE-UTR'});
 await sheet('s3','RC-VARIANT');await sheet('s4','RC-VARIANT',{confirmation_status:'已入款'});await sheet('s5','RC-MISSING',{amount:null});await sheet('s6','RC-DIFFERENT',{amount:'99'});await sheet('s7','RC-UTR',{utr:'PRIVATE-UTR'});
 await db.exec("insert into public.admin_deposit_followup_rows(id,source_sheet,source_tab,source_row,country,platform,order_number,amount,source_kind,followup_at,followup_date) values ('f1','fixture','RAJA',1,'印度','RAJA','RC-DUP',12.34,'sheet','4/10/2026 12:00','2026-10-04'),('f2','PORTAL','RAJA',2,'印度','RAJA','RC-DUP',12.34,'portal','4/10/2026 13:00','2026-10-04'),('f3','fixture','RAJA',3,'印度','RAJALOTTERY',' rc-dup ',12.3400,'sheet','4/10/2026 14:00','2026-10-04'),('f4','fixture','RAJA',4,'印度','RAJA','RC-DUP',12.35,'sheet','4/10/2026 15:00','2026-10-04')");
 const r=await call({dimension:'orders'}),by=Object.fromEntries(r.rows.map(x=>[x.workOrderId,x]));assert.equal(by.DUP.matchStatus,'exact_duplicate');assert.equal(by.DUP.onlineSources.length,2);assert.equal(by.DUP.followupCount,2);assert.equal(by.VARIANT.matchStatus,'ambiguous_online');assert.equal(by.MISSING.matchStatus,'online_amount_missing');assert.equal(by.DIFFERENT.matchStatus,'amount_conflict');assert.equal(by.UTR.utrState,'match');assert(!JSON.stringify(r).includes('PRIVATE-UTR'));
});
test('empty selected dates are received-detail zero with unconfirmed coverage, not failed import or source zero',async()=>{
 await ar('YESTERDAY',{submitted_date:'2026-10-03'});const r=await call();assert.equal(r.summary.uniqueWorkorders,0);assert.equal(r.summary.rawRecords,0);assert.equal(r.total,0);assert.equal(r.coverage.complete,false);assert.match(r.coverage.label,/暂无已采集工单.*不代表源后台零单/);assert.equal(r.coverage.platformsWithRecords,0);assert(r.coverage.expectedPlatforms>0);assert.equal(r.updatedAt,null);assert(r.sourceManifest.platforms.every(x=>x.selectedWorkorders===0));const prior=r.sourceManifest.platforms.find(x=>x.platform==='RAJALOTTERY');assert.equal(prior.latestSubmittedDate,'2026-10-03');assert.equal(new Date(prior.lastObservedAt).toISOString(),'2026-10-04T02:00:00.000Z');
});
test('grouping/pagination/query use full originals and preserve total summary',async()=>{
 for(let i=1;i<=23;i++)await ar('A'+i,{third_party:i%2?'Pay':'OtherPay',work_order_no:'DISPLAY-'+i});
 const all=await call({dimension:'orders',limit:20}),next=await call({dimension:'orders',offset:20,limit:20});assert.equal(all.rows.length,20);assert.equal(next.rows.length,3);assert.equal(all.total,23);assert.deepEqual(all.summary,next.summary);
 for(const dimension of ['platform','provider','date']){const r=await call({dimension});assert.equal(r.rows.reduce((n,x)=>n+x.uniqueWorkorders,0),23);assert.equal(r.rows.reduce((n,x)=>n+x.rawRecords,0),23)}
 assert.equal((await call({query:'DISPLAY-23',dimension:'orders'})).rows[0].workOrderId,'A23');assert.equal((await call({query:'RC-A23',dimension:'orders'})).rows[0].paymentOrderId,'RC-A23');
});
test('request validation is unchanged and raw/employee/source selection cannot bypass the router',async()=>{
 for(const q of [{dimension:{}},{dimension:'raw'},{kycStatus:'YES'},{processing:null},{matchStatus:'paid'},{country:'US'},{query:[]},{query:'x\n'},{raw:true},{dateMode:'range',startAt:undefined},{dateMode:'range',startAt:'2026-02-30T00:00:00Z',endAt:'2026-03-01T00:00:00Z'},{offset:-1},{limit:'20'},{source:'export'},{sourceKind:'portal'}])await rejects(()=>call(q));
});
test('entry OIDs/privileges remain stable; helpers owner-only; replay and baseline drift guard',async()=>{
 assert.deepEqual(await meta(),metadata);await db.exec(transactional);assert.deepEqual(await meta(),metadata);
 const leaks=await scalar("select count(*) from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where oid in ('private.dashboard_admin_deposit_collected_statistics(jsonb)'::regprocedure,'private.dashboard_admin_deposit_collected_summary(jsonb)'::regprocedure) and a.grantee<>p.proowner");assert.equal(leaks,0);
 await db.exec('set role anon');await rejects(()=>call(),/permission denied/);await db.exec('reset role');await db.exec('set role authenticated');await rejects(()=>scalar('select private.dashboard_admin_deposit_collected_statistics($1)',[JSON.stringify({section:'kyc'})]),/permission denied/);await rejects(()=>scalar('select count(*) from public.ar_workorder_issue_details'),/permission denied/);await db.exec('reset role');
 await db.exec('savepoint drift');await db.exec("alter function private.dashboard_admin_deposit_statistics(jsonb) set search_path='public'");await rejects(()=>db.exec(transactional),/ROUTER_METADATA_CHANGED/);await db.exec('rollback to savepoint drift');
 await db.exec('savepoint helper_drift');await db.exec('grant execute on function private.dashboard_admin_deposit_collected_statistics(jsonb) to authenticated');await rejects(()=>db.exec(transactional),/COLLECTED_STATISTICS_METADATA_CHANGED/);await db.exec('rollback to savepoint helper_drift');
 await db.exec('savepoint dependency_drift');await db.exec("create or replace function private.dashboard_admin_deposit_kyc_summary_v2(p_rows jsonb) returns jsonb language sql stable security invoker set search_path='' as $$ select '{}'::jsonb $$");await rejects(()=>db.exec(transactional),/DEPOSIT_KYC_SUMMARY_CHANGED/);await db.exec('rollback to savepoint dependency_drift');
 await db.exec('savepoint default_acl_drift');await db.exec('create role unexpected_helper_reader;alter default privileges in schema private grant execute on functions to unexpected_helper_reader;drop function private.dashboard_admin_deposit_collected_statistics(jsonb);drop function private.dashboard_admin_deposit_collected_summary(jsonb)');await rejects(()=>db.exec(transactional),/COLLECTED_STATISTICS_PRIVILEGES_CHANGED/);await db.exec('rollback to savepoint default_acl_drift');assert.deepEqual(await meta(),metadata);
});
test('large stored histories retain prior-day metadata while date seeds and Sheet evidence stay bounded',async t=>{
 await db.exec(`insert into public.ar_workorder_issue_details(system_name,country_code,platform,work_order_id,payment_order_no,issue_kind,amount,third_party,kyc_connected,status_code,submitted_date,submitted_at,observed_at)
  select 'AR','IN','RAJA','HIST-AR-'||i,'HIST-RC-'||i,'deposit',12.34,'Pay',true,3,'2026-10-03','2026-10-03T01:00:00Z','2026-10-03T02:00:00Z' from generate_series(1,386500) i;
 insert into public.newar_detail_records(id,platform,dataset,source_id,order_number,amount,currency,provider,status_code,status_group,created_at,captured_at,workorder_type,raw)
  select 'HIST-N-'||i,'DhaniWin','workorder','HIST-N-'||i,'UNSAFE-'||i,12.34,'INR','Pay','4','success','2026-10-03T01:00:00Z','2026-10-03T02:00:00Z','存款未到账',jsonb_build_object('depositOrderNo','HIST-NRC-'||i) from generate_series(1,12000) i;
 insert into public.admin_deposit_issue_rows(id,source_sheet,source_tab,source_row,country,platform,order_number,amount,provider,canonical_provider,status,confirmation_status,match_status,kyc_correct,utr_match)
  select 'historical-sheet-'||i,'historical-fixture','核对',i,'印度','RAJA','UNRELATED-'||i,12.34,'Pay','Pay','未入款','已确认','对得上','YES','YES' from generate_series(1,20725) i;`);
 await ar('LIVE-A');await newar('LIVE-N');await sheet('s1','RC-LIVE-A');await sheet('s2','RC-LIVE-A',{platform:'RAJA'});await sheet('s3','RC-LIVE-N',{platform:'DhaniWin'});await db.exec('analyze');
 const started=performance.now();const r=await call({dimension:'orders'});const readerMs=performance.now()-started;assert.equal(r.summary.uniqueWorkorders,2);assert.equal(r.summary.rawRecords,2);assert.equal(r.summary.uniquePaymentAmount,24.68);assert.equal(r.rows.find(x=>x.sourceSystem==='ar').onlineSourceCount,2);
 const body=migration.match(/AS \$collected\$([\s\S]*?)\$collected\$/)[1];
 const ctes=body.slice(body.indexOf(' with catalog')).split(" select jsonb_build_object('version'")[0];
 const diag=async(from,to)=>{
  let q=ctes+` select (select count(*) from ar_seed_rows) ar_seeds,(select count(*) from newar_seed_rows) newar_seeds,
   (select count(*) from keyed) peer_workorders,(select count(*) from online_scoped) sheet_evidence`;
  const vars={v_scope:"'{\"mode\":\"fixture\"}'::jsonb",v_dimension:"'orders'",v_dates:"'range'",v_start:`DATE '${from}'`,v_end:`DATE '${to}'`,v_processing:"'all'",v_match:"'all'",v_kyc:"'all'",v_offset:'0',v_limit:'20',p_request:'$1::jsonb'};
  for(const [key,value]of Object.entries(vars))q=q.replace(new RegExp('\\b'+key+'\\b','g'),value);
  const params=[JSON.stringify({section:'kyc',dimension:'orders',dateMode:'range'})];
  const values=(await db.query(q,params)).rows[0];const explain=await scalar('explain (analyze,format json) '+q,params);return {values,timeMs:explain[0]['Execution Time']};
 };
 const selected=await diag('2026-10-04','2026-10-04'),empty=await diag('2026-10-05','2026-10-05');
 assert.deepEqual(selected.values,{ar_seeds:1,newar_seeds:1,peer_workorders:2,sheet_evidence:3});assert.deepEqual(empty.values,{ar_seeds:0,newar_seeds:0,peer_workorders:0,sheet_evidence:0});
 const emptyStarted=performance.now();const noToday=await call({startAt:'2026-10-05T00:00:00Z',endAt:'2026-10-05T23:59:59Z'});const emptyReaderMs=performance.now()-emptyStarted;assert.equal(noToday.summary.uniqueWorkorders,0);assert.equal(noToday.sourceManifest.platforms.find(x=>x.platform==='RAJALOTTERY').latestSubmittedDate,'2026-10-04');assert.equal(noToday.coverage.complete,false);
 t.diagnostic(JSON.stringify({synthetic:true,storedAr:386501,storedNewar:12001,storedSheet:20728,readerMs,emptyReaderMs,selected,empty}));
});
test('fifty thousand selected workorders use batched provenance and complete response summary',async t=>{
 await db.exec('alter function private.dashboard_admin_live_platforms() rows 1');
 await db.exec(`insert into public.ar_workorder_issue_details(system_name,country_code,platform,work_order_id,payment_order_no,issue_kind,amount,third_party,kyc_connected,status_code,submitted_date,submitted_at,observed_at)
  select 'AR','IN','RAJA','SELECTED-'||i,'SELECTED-RC-'||i,'deposit',12.34,'Pay',true,3,'2026-10-04','2026-10-04T01:00:00Z','2026-10-04T02:00:00Z' from generate_series(1,50000) i;
 insert into public.admin_deposit_issue_rows(id,source_sheet,source_tab,source_row,country,platform,order_number,amount,provider,canonical_provider,status,confirmation_status,match_status,kyc_correct,utr_match)
  select 'selected-sheet-'||i,'selected-fixture','核对',i,'印度','RAJA','SELECTED-RC-'||i,12.34,'Pay','Pay','未入款','已确认','对得上','YES','YES' from generate_series(1,20000) i;analyze;`);
 const started=performance.now();const r=await call({dimension:'orders',query:'SELECTED'});const readerMs=performance.now()-started;assert.equal(r.summary.uniqueWorkorders,50000);assert.equal(r.summary.uniquePaymentOrders,50000);assert.equal(r.summary.uniquePaymentAmount,617000);assert.equal(r.rows.length,20);assert.equal(r.total,50000);assert(r.rows.every(x=>x.sources.length===1&&x.sources[0].sourcePlatform==='RAJA'));assert.equal(r.sourceManifest.platforms.find(x=>x.platform==='RAJALOTTERY').selectedWorkorders,50000);assert.equal(r.summary.matchCounts.exact_unique,20000);assert.equal(r.summary.matchCounts.unmatched,30000);t.diagnostic(JSON.stringify({synthetic:true,selectedWorkorders:50000,storedSheet:20000,lowDirectoryEstimate:true,readerMs}));
});
