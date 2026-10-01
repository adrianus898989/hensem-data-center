// Run the zero-deposit daily boundary against PostgreSQL with synthetic tickets.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8');
const pendingMigration=read('20261001062538_workorder_pending_detail_diagnostics.sql');
const sparseMigration=read('20261001100603_workorder_sparse_pending_diagnostics.sql');
const zeroMigration=read('20261001101827_workorder_zero_daily_pending_diagnostics.sql');
const migrationInTransaction=zeroMigration.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
const harness=fs.readFileSync(path.join(__dirname,'admin-workorder-known-provider-attribution.test.cjs'),'utf8').split(/\ntest\(/)[0]
 .replace('let db,legacy,','let beforeZeroDefinition,db,legacy,')
 .replace('await db.exec(attributionPatch);',`await db.exec(attributionPatch);
 await db.exec("alter table workorder_deposit_daily add column status_counts jsonb default '{}'::jsonb");
 await db.exec(pendingMigration);await db.exec(sparseMigration);
 beforeZeroDefinition=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure) definition")).rows[0].definition;
 await db.exec(zeroMigration);`);
const api=new Function('require','__dirname','pendingMigration','sparseMigration','zeroMigration',harness+';return {call,provider,ar,rebuildAr,db:()=>db,oldDefinition:()=>beforeZeroDefinition};')(require,__dirname,pendingMigration,sparseMigration,zeroMigration);
const call=extra=>api.call({platforms:['51GAME'],startAt:'2026-09-30T00:00:00+05:30',endAt:'2026-09-30T23:59:59+05:30',...extra});
const provider=r=>api.provider(r,'ArbPay');
const diagnosis=r=>provider(r).uniqueCoverage.diagnosticDays.find(d=>d.date==='2026-09-30');
async function seed(){
 await api.db().exec("delete from ar_workorder_issue_details;delete from workorder_deposit_daily;delete from newar_detail_records;update catalog set name='51GAME',source_name='51GAME' where source='ar'");
 for(let i=0;i<13;i++)await api.ar('T'+i,'ORDER'+i,{platform:'51GAME',provider:i<2?'ArbPayINR':'UPI-QR',date:'2026-09-30',status:i<5?4:3,kyc:false});
 await api.db().exec("update ar_workorder_issue_details set channel_type='ArbPayINR' where third_party='UPI-QR'");
 await api.rebuildAr();
 await api.db().query("update workorder_deposit_daily set status_counts=$1 where platform='51GAME' and third_party='ArbPayINR'",[JSON.stringify({'已处理':2})]);
 await api.db().query("update workorder_deposit_daily set submitted_count=12,status_counts=$1 where platform='51GAME' and third_party='UPI-QR'",[JSON.stringify({'已处理':3,'已驳回':7,'待处理':1,'系统处理中':1})]);
 // Reproduce all THREE production raw rows: this zero row shares canonical ArbPay.
 await api.db().exec(`insert into workorder_deposit_daily
 select stat_date,country_code,country,platform,'ArbPay','ArbPayINR',source_system,
 0,0,0,0,0,0,0,0,source_updated_at,updated_at,'{}'::jsonb
 from workorder_deposit_daily where third_party='ArbPayINR'`);
}
async function zeroRow(counts,submitted=0){await api.db().query("update workorder_deposit_daily set status_counts=$1,submitted_count=$2 where platform='51GAME' and third_party='ArbPay'",[JSON.stringify(counts),submitted]);}

test('51GAME three-row production shape explains exactly one pending record, including the received empty zero row',async()=>{
 await seed();const raw=(await api.db().query("select third_party,channel_type,submitted_count,status_counts from workorder_deposit_daily order by third_party")).rows;
 assert.equal(raw.length,3);assert.deepEqual(raw.find(r=>r.third_party==='ArbPay'),{third_party:'ArbPay',channel_type:'ArbPayINR',submitted_count:0,status_counts:{}});
 const r=await call(),p=provider(r),d=diagnosis(r);
 assert.equal(d.expectedCount,14);assert.equal(d.detailCount,13);assert.equal(d.expectedPendingCount,1);
 assert.equal(d.pendingExcludedDetailCount,1);assert.equal(d.unexplainedDetailMismatchCount,0);
 assert.equal(p.uniqueCoverage.diagnosticVersion,4);assert.equal(p.uniqueCoverage.complete,false);
 assert.equal(p.uniqueOrderCount,13);assert.equal(p.uniqueOrderAmount,1300);
 assert.equal(r.summary.uniqueCoverage.pendingExcludedDetailCount,1);
});

test('V3 versus V4 changes diagnostics only; every existing financial/count/completeness field and source row stays identical',async()=>{
 await seed();const source=async()=>(await api.db().query('select row_to_json(w) row from workorder_deposit_daily w order by third_party')).rows;
 const rowsBefore=await source(),after=await call();await api.db().exec(api.oldDefinition());const before=await call();await api.db().exec(migrationInTransaction);
 const changed=new Set(['diagnosticVersion','expectedPendingCount','pendingExcludedDetailCount','unexplainedDetailMismatchCount']);
 const strip=v=>Array.isArray(v)?v.map(strip):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!changed.has(k)).map(([k,x])=>[k,strip(x)])):v;
 assert.equal(diagnosis(before).expectedPendingCount,null);assert.equal(diagnosis(before).unexplainedDetailMismatchCount,1);
 assert.deepEqual(strip(after),strip(before));assert.deepEqual(await source(),rowsBefore);
});

test('empty, valid withdrawal-only and consistent zero deposit maps prove zero only for the received zero raw row',async()=>{
 await seed();for(const counts of [
  {},{'提款/待处理':7},{'提款/已处理':100,'提款/已驳回':'3'},
  {'待处理':0},{'已处理':'0','处理中':0},{'存款/待处理':0,'存款/已处理':0},
  {'已处理':0,'提款/待处理':99},{'存款/处理中':0,'提款/系统处理中':2},
 ]){
  await zeroRow(counts);const d=diagnosis(await call());assert.equal(d.expectedPendingCount,1,JSON.stringify(counts));
  assert.equal(d.pendingExcludedDetailCount,1);assert.equal(d.unexplainedDetailMismatchCount,0);
 }
});

test('missing, malformed, contradictory or unknown status evidence remains unknown even for submitted zero',async()=>{
 await seed();for(const counts of [
  null,[],0,'unknown',{'meta':0},{'提款/其他':0},{'待处理':null},{'已处理':false},
  {'已处理':1},{'待处理':1},{'存款/已处理':2},{'待处理':0,'已处理':1},
  {'已处理':'0.0'},{'已处理':' 0'},{'已处理':-1},{'已处理':{}},{'已处理':'9999999999999999'},
  {'提款/已处理':null},{'提款/已处理':-1},{'提款/已处理':'bad'},
  {'已处理':0,'存款/已处理':0},{'存款/待处理':0,'待处理':0},{'待处理':0,'meta':0},
 ]){
  await zeroRow(counts);const d=diagnosis(await call());assert.equal(d.expectedPendingCount,null,JSON.stringify(counts));
  assert.equal(d.pendingExcludedDetailCount,0);assert.equal(d.unexplainedDetailMismatchCount,1);
 }
});

test('missing or positive submitted count with an empty map cannot use another channel zero proof',async()=>{
 await seed();for(const submitted of [null,1,2]){
  await zeroRow({},submitted);const d=diagnosis(await call());assert.equal(d.expectedPendingCount,null,String(submitted));
  assert.equal(d.pendingExcludedDetailCount,0);assert.equal(d.unexplainedDetailMismatchCount,1+(submitted||0));
 }
});

test('an explicit zero status does not turn a missing or invalid submitted count into known zero',async()=>{
 await seed();for(const submitted of [null,-1]){
  await zeroRow({'待处理':0},submitted);const p=provider(await call());
  assert.equal(p.uniqueCoverage.pendingExcludedDetailCount,0);
  if(submitted===null)assert.equal(p.uniqueCoverage.diagnosticDays[0].expectedPendingCount,null);
 }
});

test('zero-row evidence never explains legacy withdrawal or hides absent daily coverage',async()=>{
 await seed();await api.db().exec("update ar_workorder_issue_details set issue_kind='withdraw';update workorder_deposit_daily set withdraw_not_received_count=submitted_count");
 let r=await call({direction:'withdraw'}),d=diagnosis(r);assert.equal(d.expectedPendingCount,null);assert.equal(d.pendingExcludedDetailCount,0);assert.equal(d.unexplainedDetailMismatchCount,1);
 await seed();r=await call({startAt:'2026-09-29T00:00:00+05:30'});assert.equal(provider(r).uniqueCoverage.complete,false);
 assert.deepEqual(r.coverage.platforms[0].days,1);assert.deepEqual(r.coverage.platforms[0].expectedDays,2);
});

test('already stored pending remains counted once and unknowns in another raw row still block attribution',async()=>{
 await seed();await api.ar('PENDING','ORDER-PENDING',{platform:'51GAME',provider:'ArbPayINR',date:'2026-09-30',status:1});
 let r=await call();assert.equal(provider(r).uniqueCoverage.pendingExcludedDetailCount,0);assert.equal(provider(r).uniqueCoverage.detailMismatchCount,0);
 await api.db().exec("delete from ar_workorder_issue_details where work_order_id='PENDING';update workorder_deposit_daily set status_counts='{}'::jsonb where third_party='ArbPayINR'");
 const d=diagnosis(await call());assert.equal(d.expectedPendingCount,null);assert.equal(d.pendingExcludedDetailCount,0);assert.equal(d.unexplainedDetailMismatchCount,1);
});

test('selected platform scope and denied sessions still apply to all zero-row diagnostics',async()=>{
 await seed();await api.db().exec(`select set_config('test.scope','{"mode":"selected","platforms":["DhaniWin"]}',true)`);
 const r=await call();assert.equal(r.byProvider.length,0);assert.equal(r.summary.submittedCount,0);
 await api.db().exec("select set_config('test.active','false',true)");await assert.rejects(()=>call(),/preview_denied/);
});

test('migration replay preserves ACL and metadata and an unrecognized body is rejected',async()=>{
 const q="select prosrc,proacl::text acl,proconfig,prosecdef from pg_proc where oid='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure";
 const before=(await api.db().query(q)).rows[0];await api.db().exec(migrationInTransaction);assert.deepEqual((await api.db().query(q)).rows[0],before);
 await api.db().exec("create or replace function private.dashboard_admin_live_workorder_unique_totals(p_request jsonb,p_result jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$begin return p_result;end$$");
 await assert.rejects(()=>api.db().exec(migrationInTransaction),/baseline changed/);
});

test('unexpected helper grants remain rejected',async()=>{
 await api.db().exec('grant execute on function private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb) to authenticated');
 await assert.rejects(()=>api.db().exec(migrationInTransaction),/ACL changed/);
});
