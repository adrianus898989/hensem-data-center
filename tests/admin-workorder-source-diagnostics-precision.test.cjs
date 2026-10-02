// Production function definitions; all data and identities below are synthetic.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',n),'utf8');
const migration=read('20261002073527_workorder_source_diagnostics_precision.sql');
const patch=migration.replace(/^begin;$/m,'').replace(/^.*commit;$/m,"notify pgrst,'reload schema';");
const baseline=fs.readFileSync(path.join(__dirname,'fixtures/workorder-diagnostics/production-unique-totals.sql'),'utf8');
const keyBaseline=fs.readFileSync(path.join(__dirname,'fixtures/workorder-diagnostics/production-platform-key.sql'),'utf8');
const harness=fs.readFileSync(path.join(__dirname,'admin-workorder-known-provider-attribution.test.cjs'),'utf8').split(/\ntest\(/)[0]
 .replace('await db.exec(attributionPatch);',`await db.exec(attributionPatch);
 await db.exec("alter table workorder_deposit_daily add column status_counts jsonb default '{}'::jsonb;alter table catalog add column currency text default 'INR'");
 await db.exec(keyBaseline);await db.exec(baseline);await db.exec(migration);`);
const api=new Function('require','__dirname','baseline','keyBaseline','migration',harness+';return {call,provider,ar,rebuildAr,put,rebuild,db:()=>db};')(require,__dirname,baseline,keyBaseline,migration);
const db=()=>api.db();
const call=extra=>api.call({platforms:['Alpha'],...extra});
const p=(r,name)=>api.provider(r,name);
async function reset(){await db().exec('delete from workorder_deposit_daily;delete from ar_workorder_issue_details;delete from newar_detail_records');}
async function statuses(){await db().exec(`update workorder_deposit_daily set status_counts=jsonb_build_object('已驳回',submitted_count)`);}
async function seedKnown(){await reset();await api.ar('A','ORIGINAL-A',{provider:'KnownPay',amount:100});await api.ar('U','ORIGINAL-A',{provider:'未标记三方',amount:100});await api.rebuildAr();await statuses();}
const fields=['submittedCount','submittedAmount','successCount','successAmount','pendingCount','pendingAmount','uniqueOrderCount','uniqueOrderAmount','uniqueSuccessCount','uniqueSuccessAmount','uniqueNotReceivedCount','uniqueNotReceivedAmount','uniqueNotReceivedKycCount','uniqueNotReceivedKycAmount'];
const facts=r=>[r.summary,...r.byProvider,...r.byPlatformProvider].map(x=>Object.fromEntries(fields.map(k=>[k,x[k]])));

test('confirmed SHREE alias repairs date and cohort coverage, remains country-specific',async()=>{
 await reset();await db().exec("update catalog set name='SHREEWIN',source_name='Shree.Win' where source='ar'");
 await api.ar('S','SHREE-ORIGINAL',{platform:'SHREEWIN',provider:'KnownPay'});await api.rebuildAr();await statuses();
 const r=await call({platforms:['Shree.Win']}),row=p(r,'KnownPay');assert.equal(row.uniqueOrderCount,1);assert.equal(row.uniqueCoverage.complete,true);
 assert.equal(row.uniqueCoverage.sourceCoverage.platforms[0].identityResolved,true);assert.deepEqual(row.uniqueCoverage.sourceCoverage.platforms[0].missingDates,[]);
 const keys=(await db().query("select private.dashboard_admin_live_workorder_platform_key('IN','Shree.Win') india,private.dashboard_admin_live_workorder_platform_key('PK','Shree.Win') other")).rows[0];assert.deepEqual(keys,{india:'SHREEWIN',other:'Shree.Win'});
});
test('fully attributed source-only unknown cohort is informational with unchanged null financial values',async()=>{
 await seedKnown();const after=await call(),u=p(after,'未标记三方');assert.equal(u.uniqueCoverage.status,'attributed_elsewhere');assert.equal(u.uniqueCoverage.diagnosisStatus,'attributed_elsewhere');assert.equal(u.uniqueCoverage.needsReview,false);assert.equal(u.uniqueCoverage.complete,true);assert.equal(u.uniqueCoverage.attributedElsewhere,true);assert.equal(u.uniqueCoverage.attributedElsewhereDetailCount,1);
 assert.equal(u.uniqueOrderCount,null);assert.equal(u.uniqueOrderAmount,null);assert.equal(p(after,'KnownPay').uniqueOrderCount,1);assert.equal(after.summary.uniqueOrderCount,1);
 await db().exec(baseline);const before=await call();assert.equal(p(before,'未标记三方').uniqueCoverage.complete,false);assert.deepEqual(facts(after),facts(before));
});
test('unknown-only filter cannot borrow an unselected known provider',async()=>{
 await seedKnown();const r=await call({providers:['未标记三方']}),u=p(r,'未标记三方');assert.equal(u.uniqueCoverage.attributedElsewhere,false);assert.equal(u.uniqueCoverage.complete,false);assert.equal(u.uniqueOrderCount,null);
});
test('mixed unresolved, missing original, conflicting provider or amount cannot hide unknown cohort warnings',async()=>{
 for(const mode of ['unresolved','missing','amount','provider']){
  await seedKnown();
  if(mode==='unresolved')await api.ar('EXTRA','UNRELATED',{provider:'未标记三方'});
  if(mode==='missing')await api.ar('EXTRA',null,{provider:'未标记三方'});
  if(mode==='amount')await db().exec("update ar_workorder_issue_details set amount=999 where work_order_id='U'");
  if(mode==='provider')await api.ar('EXTRA','ORIGINAL-A',{provider:'OtherPay'});
  await api.rebuildAr();await statuses();const r=await call(),u=p(r,'未标记三方');assert.equal(u.uniqueCoverage.attributedElsewhere,false,mode);assert.equal(u.uniqueCoverage.complete,false,mode);
 }
});
test('cross-platform, direction, source and outside-range original identifiers never resolve a source-only unknown cohort',async()=>{
 for(const mode of ['platform','direction','source','date']){
  await seedKnown();await db().exec("delete from ar_workorder_issue_details where work_order_id='A'");
  if(mode==='source'){await api.put('N','ORIGINAL-A',{provider:'KnownPay'});await api.rebuild();}
  else await api.ar('A','ORIGINAL-A',{provider:'KnownPay',platform:mode==='platform'?'OTHER':'Alpha',kind:mode==='direction'?'withdraw':'deposit',date:mode==='date'?'2026-09-28':'2026-09-29'});
  await api.rebuildAr();await statuses();assert.equal(p(await call(),'未标记三方').uniqueCoverage.attributedElsewhere,false,mode);
 }
});
test('exact pending count reconciliation reports raw monetary gap separately from unique original money',async()=>{
 await reset();await api.ar('A','SAME',{provider:'KnownPay',amount:100});await api.ar('B','SAME',{provider:'KnownPay',amount:100});await api.rebuildAr();
 await db().exec(`update workorder_deposit_daily set submitted_count=3,submitted_amount=450,status_counts='{"已驳回":2,"待处理":1}'`);
 const r=await call(),u=p(r,'KnownPay'),d=u.uniqueCoverage.diagnosticDays[0];assert.equal(d.pendingExcludedDetailCount,1);assert.equal(d.unexplainedDetailMismatchCount,0);
 assert.deepEqual(d.rawAmountComparison,{basis:'source_workorder_records',expectedAmount:450,detailAmount:200,differenceAmount:250,currency:'INR',pendingExcludedDifferenceAmount:null,pendingRangeNetDifferenceAmount:250,amountComparisonStatus:'scope_difference_not_reconciled',excludedTypeDifferenceAmount:null,excludedTypeAmount:null,excludedTypeCurrency:null,unexplainedDifferenceAmount:null});
 assert.equal(u.uniqueOrderCount,1);assert.equal(u.uniqueOrderAmount,100);assert.equal(u.uniqueCoverage.complete,false);assert.equal(u.uniqueCoverage.diagnosticVersion,5);assert.equal(u.uniqueCoverage.diagnosisStatus,'explained_range_difference');assert.equal(u.uniqueCoverage.needsReview,false);
});
test('unexplained count or amount differences remain explicit and cannot be labelled omitted pending',async()=>{
 await reset();await api.ar('A','A',{provider:'KnownPay',amount:100});await api.rebuildAr();
 await db().exec(`update workorder_deposit_daily set submitted_count=3,submitted_amount=800,status_counts='{"已驳回":2,"待处理":1}'`);
 let d=p(await call(),'KnownPay').uniqueCoverage.diagnosticDays[0];assert.equal(d.pendingExcludedDetailCount,0);assert.equal(d.unexplainedDetailMismatchCount,2);assert.equal(d.rawAmountComparison.unexplainedDifferenceAmount,700);assert.equal(d.rawAmountComparison.pendingExcludedDifferenceAmount,null);
 await db().exec(`update workorder_deposit_daily set submitted_count=1,submitted_amount=150,status_counts='{"已驳回":1}'`);
 d=p(await call(),'KnownPay').uniqueCoverage.diagnosticDays[0];assert.equal(d.detailMismatchCount,0);assert.equal(d.rawAmountComparison.unexplainedDifferenceAmount,50);assert.equal(p(await call(),'KnownPay').uniqueCoverage.needsReview,true);
});
test('USDT excluded evidence keeps null currency, missing original and separate raw amount instead of inventing INR',async()=>{
 await reset();await api.put('FIAT','NATIVE',{provider:'KnownPay',amount:200});await api.rebuild();
 await api.put('USDT',null,{provider:'UniPayUSDT',amount:987,currency:null,type:'USDT存款未到账自动化',raw:{}});
 await db().exec(`insert into workorder_deposit_daily values('2026-09-29','IN','印度','DhaniWin','UniPayUSDT','QR','AR_WORKORDER',1,987,0,0,0,0,0,0,now(),now(),'{}')`);
 const r=await api.call({platforms:['DhaniWin']}),u=p(r,'UniPayUSDT'),d=u.uniqueCoverage.diagnosticDays[0];assert.equal(d.excludedWorkorderTypeCount,1);assert.equal(d.excludedTypeExplainedMismatchCount,1);assert.equal(d.unexplainedDetailMismatchCount,0);
 assert.equal(d.rawAmountComparison.currency,null);assert.equal(d.rawAmountComparison.excludedTypeCurrency,null);assert.equal(d.rawAmountComparison.excludedTypeAmount,987);assert.equal(d.rawAmountComparison.excludedTypeDifferenceAmount,987);assert.equal(u.uniqueOrderCount,null);assert.equal(u.uniqueCoverage.diagnosisStatus,'explained_range_difference');assert.equal(u.uniqueCoverage.needsReview,false);assert.equal(r.summary.uniqueOrderCount,1);assert.equal(r.summary.uniqueOrderAmount,200);
});
test('missing daily date and missing amount evidence stay incomplete; no null-to-zero amount inference',async()=>{
 await seedKnown();let r=await call({startAt:'2026-09-28T00:00:00+05:30'});assert.equal(p(r,'未标记三方').uniqueCoverage.complete,false);
 await db().exec('update ar_workorder_issue_details set amount=null;update workorder_deposit_daily set submitted_amount=null');r=await call();const u=p(r,'未标记三方');assert.equal(u.uniqueCoverage.attributedElsewhere,false);assert.equal(u.uniqueCoverage.complete,false);
 const d=p(r,'KnownPay').uniqueCoverage.diagnosticDays[0];assert.equal(d.rawAmountComparison.expectedAmount,null);assert.equal(d.rawAmountComparison.detailAmount,null);assert.equal(d.rawAmountComparison.differenceAmount,null);
});
test('permissions, source rows, outer read model and helper metadata remain unchanged',async()=>{
 await seedKnown();const meta=async()=>(await db().query("select oid::text,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid in ('private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure,'private.dashboard_admin_live_workorder_platform_key(text,text)'::regprocedure)")).rows;
 const before=await meta(),raw=await db().query('select row_to_json(d) value from ar_workorder_issue_details d order by work_order_id'),outer=(await db().query("select prosrc from pg_proc where oid='private.dashboard_admin_live_workorders(jsonb)'::regprocedure")).rows;
 await db().exec(patch);assert.deepEqual(await meta(),before);assert.deepEqual((await db().query('select row_to_json(d) value from ar_workorder_issue_details d order by work_order_id')).rows,raw.rows);assert.deepEqual((await db().query("select prosrc from pg_proc where oid='private.dashboard_admin_live_workorders(jsonb)'::regprocedure")).rows,outer);
 await db().exec(`select set_config('test.scope','{"mode":"selected","platforms":["DhaniWin"]}',true)`);assert.equal((await call()).byProvider.length,0);
 await db().exec("select set_config('test.active','false',true)");await assert.rejects(()=>call(),/preview_denied/);
});
test('migration guards reject helper ACL, execution metadata and unrecognized source definition',async()=>{
 for(const change of [
  'grant execute on function private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb) to authenticated',
  "alter function private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb) set search_path='public'",
  "create or replace function private.dashboard_admin_live_workorder_unique_totals(p_request jsonb,p_result jsonb) returns jsonb language plpgsql stable set search_path='' as $$begin return p_result;end$$",
 ]){await db().exec('savepoint guardtest;'+change);await assert.rejects(()=>db().exec(patch),/workorder_diagnostic_(metadata_or_acl|baseline)_drift/);await db().exec('rollback to guardtest');}
});

test('collected excluded-type amount must reconcile too; a matching count does not erase a monetary discrepancy',async()=>{
 await reset();await api.put('USDT',null,{provider:'UniPayUSDT',amount:987,currency:null,type:'USDT存款未到账自动化',raw:{}});
 await db().exec(`insert into workorder_deposit_daily values('2026-09-29','IN','印度','DhaniWin','UniPayUSDT','QR','AR_WORKORDER',1,1000,0,0,0,0,0,0,now(),now(),'{}')`);
 const u=p(await api.call({platforms:['DhaniWin']}),'UniPayUSDT'),d=u.uniqueCoverage.diagnosticDays[0];assert.equal(d.unexplainedDetailMismatchCount,0);assert.equal(d.rawAmountComparison.excludedTypeDifferenceAmount,null);assert.equal(d.rawAmountComparison.unexplainedDifferenceAmount,13);assert.equal(u.uniqueCoverage.needsReview,true);assert.equal(d.rawAmountComparison.currency,null);
});
test('attributed unknown source label cannot hide its own daily amount discrepancy',async()=>{
 await seedKnown();await db().exec("update workorder_deposit_daily set submitted_amount=150 where third_party='未标记三方'");
 const u=p(await call(),'未标记三方');assert.equal(u.uniqueCoverage.attributedElsewhere,false);assert.equal(u.uniqueCoverage.needsReview,true);assert.equal(u.uniqueCoverage.diagnosticDays[0].rawAmountComparison.unexplainedDifferenceAmount,50);
});
test('opposite gaps on different dates never cancel into explained coverage',async()=>{
 await reset();await api.ar('A','A',{provider:'KnownPay',date:'2026-09-28'});await api.ar('B','B',{provider:'KnownPay',date:'2026-09-29'});await api.rebuildAr();await statuses();
 await db().exec(`update workorder_deposit_daily set submitted_count=2,submitted_amount=200,status_counts='{"已驳回":1,"待处理":1}' where stat_date='2026-09-28';update workorder_deposit_daily set submitted_count=0,submitted_amount=0,status_counts='{}' where stat_date='2026-09-29'`);
 const u=p(await call({startAt:'2026-09-28T00:00:00+05:30'}),'KnownPay');assert.equal(u.uniqueCoverage.detailMismatchCount,0);assert.equal(u.uniqueCoverage.unexplainedDetailMismatchCount,1);assert.equal(u.uniqueCoverage.needsReview,true);
});
