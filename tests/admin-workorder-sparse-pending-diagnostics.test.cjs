// Execute the diagnostic migration against PostgreSQL using synthetic source rows.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8');
const pendingMigration=read('20261001062538_workorder_pending_detail_diagnostics.sql');
const sparseMigration=read('20261001100603_workorder_sparse_pending_diagnostics.sql');
const migrationInTransaction=sparseMigration.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
const harness=fs.readFileSync(path.join(__dirname,'admin-workorder-known-provider-attribution.test.cjs'),'utf8').split(/\ntest\(/)[0]
 .replace('let db,legacy,','let beforeSparseDefinition,db,legacy,')
 .replace('await db.exec(attributionPatch);',`await db.exec(attributionPatch);
 await db.exec("alter table workorder_deposit_daily add column status_counts jsonb default '{}'::jsonb");
 await db.exec(pendingMigration);
 beforeSparseDefinition=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure) definition")).rows[0].definition;
 await db.exec(sparseMigration);`);
const api=new Function('require','__dirname','pendingMigration','sparseMigration',harness+';return {call,provider,ar,rebuildAr,db:()=>db,oldDefinition:()=>beforeSparseDefinition};')(require,__dirname,pendingMigration,sparseMigration);
const call=extra=>api.call({platforms:['51GAME'],startAt:'2026-09-30T00:00:00+05:30',endAt:'2026-09-30T23:59:59+05:30',...extra});
const provider=r=>api.provider(r,'ArbPay');
async function seed(){
 await api.db().exec("delete from ar_workorder_issue_details;delete from workorder_deposit_daily;delete from newar_detail_records;update catalog set name='51GAME',source_name='51GAME' where source='ar'");
 // Two distinct raw channel rows resolve to the same canonical ArbPay provider.
 for(let i=0;i<13;i++)await api.ar('T'+i,'ORDER'+i,{platform:'51GAME',provider:i<2?'ArbPayINR':'UPI-QR',date:'2026-09-30',status:i<5?4:3,kyc:false});
 await api.db().exec("update ar_workorder_issue_details set channel_type='ArbPayINR' where third_party='UPI-QR'");
 await api.rebuildAr();
 await api.db().query("update workorder_deposit_daily set status_counts=$1 where platform='51GAME' and third_party='ArbPayINR'",[JSON.stringify({'已处理':2})]);
 await api.db().query("update workorder_deposit_daily set submitted_count=12,status_counts=$1 where platform='51GAME' and third_party='UPI-QR'",[JSON.stringify({'已处理':3,'已驳回':7,'待处理':1,'系统处理中':1})]);
}
async function firstMap(counts){await api.db().query("update workorder_deposit_daily set status_counts=$1 where platform='51GAME' and third_party='ArbPayINR'",[JSON.stringify(counts)]);}
const diagnosis=r=>provider(r).uniqueCoverage.diagnosticDays.find(d=>d.date==='2026-09-30');

test('51GAME canonical grouping reconciles a sparse zero-pending channel with an explicit pending channel',async()=>{
 await seed();const r=await call(),p=provider(r),d=diagnosis(r);
 assert.equal(p.submittedCount,14);assert.equal(p.uniqueCoverage.detailCount,13);
 assert.equal(d.expectedCount,14);assert.equal(d.detailCount,13);assert.equal(d.expectedPendingCount,1);
 assert.equal(d.pendingExcludedDetailCount,1);assert.equal(d.unexplainedDetailMismatchCount,0);
 assert.equal(p.uniqueCoverage.diagnosticVersion,3);assert.equal(p.uniqueCoverage.pendingExcludedDetailCount,1);
 assert.equal(p.uniqueCoverage.complete,false,'explained omissions still do not prove complete originals');
 assert.equal(p.uniqueOrderCount,13);assert.equal(p.uniqueOrderAmount,1300);
 assert.equal(r.summary.uniqueCoverage.pendingExcludedDetailCount,1);
});

test('all prior metrics and completeness are identical; only pending diagnostics and version change',async()=>{
 await seed();const after=await call();await api.db().exec(api.oldDefinition());const before=await call();await api.db().exec(migrationInTransaction);
 const changed=new Set(['diagnosticVersion','expectedPendingCount','pendingExcludedDetailCount','unexplainedDetailMismatchCount']);
 const strip=v=>Array.isArray(v)?v.map(strip):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!changed.has(k)).map(([k,x])=>[k,strip(x)])):v;
 assert.equal(diagnosis(before).expectedPendingCount,null);assert.equal(diagnosis(before).unexplainedDetailMismatchCount,1);
 assert.deepEqual(strip(after),strip(before));
});

test('valid legacy and prefixed deposit maps can prove zero without mixing withdrawal states',async()=>{
 await seed();for(const counts of [
  {'已处理':2},{'已处理':'2'},{'处理中':1,'已驳回':1},
  {'存款/已处理':2},{'存款/处理中':1,'存款/系统处理中':1},
  {'已处理':2,'提款/待处理':8},{'存款/已处理':2,'提款/已处理':100},
 ]){
  await firstMap(counts);const d=diagnosis(await call());assert.equal(d.expectedPendingCount,1,JSON.stringify(counts));assert.equal(d.pendingExcludedDetailCount,1);
 }
});

test('absent, invalid, incomplete or ambiguous state evidence stays unknown instead of implying zero',async()=>{
 await seed();for(const counts of [
  {},null,[],2,'unavailable',{'已处理':1},{'已处理':3},{'未识别':2},{'已处理':2,'未识别':0},
  {'已处理':null},{'已处理':-2},{'已处理':true},{'已处理':{}},{'已处理':'2.0'},{'已处理':'2e0'},
  {'已处理':' 2'},{'已处理':'9999999999999999'},{'已处理':2,'已驳回':'bad'},
  {'存款/其他':2},{'存款/已处理':1,'已处理':1},{'提款/已处理':2},{'提款/待处理':2},
  {'已处理':2,'待处理':null},{'已处理':2,'待处理':'bad'},{'已处理':2,'存款/待处理':null},
 ]){
  await firstMap(counts);const d=diagnosis(await call());assert.equal(d.expectedPendingCount,null,JSON.stringify(counts));
  assert.equal(d.pendingExcludedDetailCount,0);assert.equal(d.unexplainedDetailMismatchCount,1);
 }
});

test('explicit pending counts retain their established numeric and prefixed priority rules',async()=>{
 await seed();for(const [counts,pending] of [[{'待处理':0},1],[{'待处理':'0'},1],[{'存款/待处理':0,'待处理':7},1],[{'待处理':2},3]]){
  await firstMap(counts);const d=diagnosis(await call());assert.equal(d.expectedPendingCount,pending);
  assert.equal(d.pendingExcludedDetailCount,pending===1?1:0);assert.equal(d.unexplainedDetailMismatchCount,pending===1?0:1);
 }
});

test('zero proof is per raw row and cannot net out opposite channel errors or invalid counts',async()=>{
 await seed();await firstMap({'已处理':1});
 await api.db().query("update workorder_deposit_daily set status_counts=$1 where platform='51GAME' and third_party='UPI-QR'",[JSON.stringify({'已处理':3,'已驳回':8,'待处理':1,'系统处理中':1})]);
 const d=diagnosis(await call());assert.equal(d.expectedPendingCount,null);assert.equal(d.unexplainedDetailMismatchCount,1);
});

test('stored pending rows are subtracted and different-day deficits do not cancel',async()=>{
 await seed();await api.ar('PENDING','ORDER-PENDING',{platform:'51GAME',provider:'ArbPayINR',date:'2026-09-30',status:1});
 let r=await call();assert.equal(provider(r).uniqueCoverage.pendingExcludedDetailCount,0);assert.equal(provider(r).uniqueCoverage.detailMismatchCount,0);
 await api.db().exec("delete from ar_workorder_issue_details where work_order_id='PENDING';insert into workorder_deposit_daily select '2026-09-29',country_code,country,platform,third_party,channel_type,source_system,submitted_count,submitted_amount,success_count,success_amount,withdraw_not_received_count,withdraw_not_received_amount,withdraw_success_count,withdraw_success_amount,source_updated_at,updated_at,'{}'::jsonb from workorder_deposit_daily where third_party='ArbPayINR'");
 r=await call({startAt:'2026-09-29T00:00:00+05:30'});const c=provider(r).uniqueCoverage;
 assert.equal(c.pendingExcludedDetailCount,1);assert.equal(c.unexplainedDetailMismatchCount,2);assert.equal(c.complete,false);
});

test('legacy withdrawal counts never borrow sparse deposit status evidence',async()=>{
 await seed();await api.db().exec("update ar_workorder_issue_details set issue_kind='withdraw';update workorder_deposit_daily set withdraw_not_received_count=submitted_count");
 const d=diagnosis(await call({direction:'withdraw'}));assert.equal(d.expectedPendingCount,null);assert.equal(d.pendingExcludedDetailCount,0);assert.equal(d.unexplainedDetailMismatchCount,1);
});

test('scoped reads and denied sessions remain enforced with sparse status diagnostics',async()=>{
 await seed();await api.db().exec(`select set_config('test.scope','{"mode":"selected","platforms":["DhaniWin"]}',true)`);
 const r=await call();assert.equal(r.byProvider.length,0);assert.equal(r.summary.submittedCount,0);
 await api.db().exec("select set_config('test.active','false',true)");await assert.rejects(()=>call(),/preview_denied/);
});

test('replay preserves body, ACL and metadata and rejects any unknown baseline',async()=>{
 const q="select prosrc,proacl::text acl,proconfig,prosecdef from pg_proc where oid='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure";
 const before=(await api.db().query(q)).rows[0];await api.db().exec(migrationInTransaction);assert.deepEqual((await api.db().query(q)).rows[0],before);
 await api.db().exec("create or replace function private.dashboard_admin_live_workorder_unique_totals(p_request jsonb,p_result jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$begin return p_result;end$$");
 await assert.rejects(()=>api.db().exec(migrationInTransaction),/baseline changed/);
});

test('unexpected execute grants are rejected instead of widening the helper surface',async()=>{
 await api.db().exec('grant execute on function private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb) to authenticated');
 await assert.rejects(()=>api.db().exec(migrationInTransaction),/ACL changed/);
});
