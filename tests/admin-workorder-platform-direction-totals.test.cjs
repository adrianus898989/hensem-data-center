// Run the shipped reader and exact helper definitions against synthetic records.
// This suite performs no external requests, production reads or source writes.
const {test,before}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=fs.readFileSync(path.join(__dirname,'admin-newar-workorder-detail-cohorts.test.cjs'),'utf8').split(/\ntest\(/)[0];
let fixtureSetup;
const fixtureRequire=name=>name==='node:test'?{...require(name),before:fn=>{fixtureSetup=fn}}:require(name);
const api=new Function('require','__dirname',fixture+'\nreturn {call,ticket,daily,getDb:()=>db};')(fixtureRequire,__dirname);
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261004112744_workorder_platform_direction_unique_totals.sql'),'utf8');
const install=migration.replace(/^begin;$/m,'').replace(/^notify pgrst.*$/m,'').replace(/^commit;$/m,'');
const AR='11111111-1111-4111-8111-111111111111',NEWAR='22222222-2222-4222-8222-222222222222';
let baselineDefinition,targetDefinition,baselineMetadata,mainMetadata;
const db=()=>api.getDb();
const metadata=async functionName=>(await db().query('select to_jsonb(p)-\'prosrc\' value from pg_proc p where oid=$1::regprocedure',[functionName])).rows[0].value;
const helper='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)',main='private.dashboard_admin_live_workorders(jsonb)';
before(async()=>{
 await fixtureSetup();
 baselineDefinition=(await db().query('select pg_get_functiondef($1::regprocedure) definition',[helper])).rows[0].definition;
 baselineMetadata=await metadata(helper);mainMetadata=await metadata(main);
 assert.equal((await db().query('select md5(pg_get_functiondef($1::regprocedure)) value',[helper])).rows[0].value,'e0713eb8bc59b72e0ccc50de7d097b7a');
 await db().exec(migration);
 targetDefinition=(await db().query('select pg_get_functiondef($1::regprocedure) definition',[helper])).rows[0].definition;
});
const platform=(result,id=AR,direction='charge')=>result.byPlatformDirection.find(r=>r.platformId===id&&r.direction===direction);
const call=extra=>api.call({platforms:['Alpha'],direction:'all',...extra});
async function ar(id,original,{platform='Alpha',provider='SUPER',status=3,amount=100,date='2026-10-03',kind='deposit',countryCode='IN',country='印度',system='AR'}={}){
 await db().query(`insert into ar_workorder_issue_details(system_name,country_code,country,platform,work_order_id,work_order_no,payment_order_no,source_order_no,amount,issue_kind,third_party,channel_type,status_code,submitted_date,kyc_connected)
 values($1,$2,$3,$4,$5,$5,$6,null,$7,$8,$9,'BANK',$10,$11,false)`,[system,countryCode,country,platform,id,original,amount,kind,provider,status,date]);
}
async function rebuildAr(){await db().exec(`delete from workorder_deposit_daily where platform<>'DhaniWin';
 insert into workorder_deposit_daily
 select submitted_date,country_code,country,platform,third_party,channel_type,'AR_WORKORDER',
 count(*) filter(where issue_kind='deposit'),coalesce(sum(amount) filter(where issue_kind='deposit'),0),
 count(*) filter(where issue_kind='deposit' and status_code=4),coalesce(sum(amount) filter(where issue_kind='deposit' and status_code=4),0),
 count(*) filter(where issue_kind='withdraw'),coalesce(sum(amount) filter(where issue_kind='withdraw'),0),
 count(*) filter(where issue_kind='withdraw' and status_code=4),coalesce(sum(amount) filter(where issue_kind='withdraw' and status_code=4),0),
 '2026-10-04T06:00:00Z','2026-10-04T06:01:00Z',
 jsonb_build_object('存款/已处理',count(*) filter(where issue_kind='deposit' and status_code=4),'存款/已驳回',count(*) filter(where issue_kind='deposit' and status_code<>4))
 from ar_workorder_issue_details where system_name='AR' group by 1,2,3,4,5,6;`);}
async function unchanged(extra){
 const after=await call(extra);await db().exec(baselineDefinition);const before=await call(extra);await db().exec(targetDefinition);
 const {byPlatformDirection,...legacy}=after;assert.deepEqual(legacy,before,'all pre-existing reader result fields remain identical');return after;
}
test('repeated full originals across providers count once at platform level without assigning conflict to provider cells',async()=>{
 await ar('A','FULL-ORIGINAL-001');await ar('A2','FULL-ORIGINAL-001',{status:4});
 await ar('B','FULL-ORIGINAL-002',{provider:'SUPER'});await ar('C','FULL-ORIGINAL-002',{provider:'OtherPay',status:4});
 await ar('D','FULL-ORIGINAL-003',{provider:'未识别三方',status:4});await rebuildAr();
 const result=await unchanged(),p=platform(result);
 assert.deepEqual([p.uniqueOrderCount,p.uniqueSuccessCount],[3,3]);assert.equal(p.source,'ar');assert.equal(p.country,'印度');assert.equal(p.countryCode,'IN');
 assert.equal(p.uniqueCoverage.providerConflictCount,1);assert.equal(p.uniqueCoverage.unresolvedProviderOrderCount,1);assert.equal(p.uniqueCoverage.complete,false);
 assert.equal(result.byProvider.find(r=>r.provider==='SUPER').uniqueOrderCount,1);
 assert.equal(result.byProvider.find(r=>r.provider==='OtherPay').uniqueOrderCount,null);
 assert.equal(result.byProvider.find(r=>r.provider==='未识别三方').uniqueOrderCount,null);
});
test('direction and native platform remain separate even when the complete original number is identical',async()=>{
 await db().exec("insert into catalog values('33333333-3333-4333-8333-333333333333','Beta','Beta','印度','IN','ar','INR')");
 await ar('C','SAME',{status:4});await ar('W','SAME',{kind:'withdraw',status:3});await ar('B','SAME',{platform:'Beta',status:4});await rebuildAr();
 const result=await unchanged({platforms:['Alpha','Beta']});assert.equal(result.byPlatformDirection.length,3);
 assert.deepEqual([platform(result).uniqueOrderCount,platform(result).uniqueSuccessCount],[1,1]);
 assert.deepEqual([platform(result,AR,'withdraw').uniqueOrderCount,platform(result,AR,'withdraw').uniqueSuccessCount],[1,0]);
 assert.equal(platform(result,'33333333-3333-4333-8333-333333333333').uniqueOrderCount,1);
 assert.equal(result.summary.uniqueOrderCount,3);
});
test('provider/date filters preserve original attribution closure and pagination never changes platform totals',async()=>{
 await ar('S','REF',{provider:'SUPER',status:3});await ar('OTHER','REF',{provider:'OtherPay',status:4});
 await ar('UNKNOWN','RESOLVED',{provider:'未识别三方',status:4});await ar('KNOWN','RESOLVED',{provider:'SUPER'});
 await ar('PREVIOUS','PREVIOUS',{provider:'SUPER',date:'2026-10-02',status:4});await rebuildAr();
 const result=await unchanged({providers:['SUPER']}),p=platform(result);assert.deepEqual([p.uniqueOrderCount,p.uniqueSuccessCount],[2,1]);
 assert.equal(p.uniqueCoverage.providerConflictCount,1);assert.equal(p.uniqueCoverage.resolvedProviderOrderCount,1);
 const paged=await call({providers:['SUPER'],offset:999});assert.deepEqual(paged.byPlatformDirection,result.byPlatformDirection);assert.deepEqual(paged.rows,[]);
 const longer=await unchanged({providers:['SUPER'],startAt:'2026-10-02T00:00:00Z'});assert.deepEqual([platform(longer).uniqueOrderCount,platform(longer).uniqueSuccessCount],[3,2]);
});
test('native AR aliases unify platform originals and remain country/source scoped',async()=>{
 await db().exec("update catalog set name='82LOTTERY',source_name='82BET' where id='11111111-1111-4111-8111-111111111111'");
 await ar('NATIVE','REF',{platform:'82BET',status:3});await ar('ALIAS','REF',{platform:'82LOTTERY',status:4});
 await ar('FOREIGN','PRIVATE',{platform:'82BET',countryCode:'PK',country:'巴基斯坦',status:4});await ar('SYSTEM','PRIVATE',{platform:'82BET',system:'OTHER',status:4});await rebuildAr();
 const result=await unchanged({platforms:['82BET','82LOTTERY']}),p=platform(result);assert.deepEqual([p.uniqueOrderCount,p.uniqueSuccessCount],[1,1]);assert.equal(p.platform,'82LOTTERY');assert.equal(p.countryCode,'IN');
 await db().query("select set_config('test.scope',$1,true)",[JSON.stringify({platforms:['Beta']})]);
 assert.deepEqual((await call({platforms:['82BET','82LOTTERY']})).byPlatformDirection,[],'unauthorized metadata and counts are absent');
});
test('detail-only NEWAR counts retain missing daily receipt and currency/reference uncertainty',async()=>{
 await api.ticket('A','REF',{status:'3'});await api.ticket('B','REF',{status:'4'});await api.ticket('C','OTHER',{provider:'Super-QR',status:'4',currency:'USDT'});
 await api.ticket('BAD',null,{raw:{depositOrderNo:100},status:'4'});
 const result=await unchanged({platforms:['DHANIWIN','DhaniWin'],direction:'charge'}),p=platform(result,NEWAR);
 assert.deepEqual([p.uniqueOrderCount,p.uniqueSuccessCount],[2,2]);assert.equal(p.source,'newar');assert.equal(p.uniqueCoverage.complete,false);assert.equal(p.uniqueCoverage.status,'partial');
 assert.equal(p.uniqueCoverage.missingOrderNumberCount,1);assert.equal(p.uniqueCoverage.missingAmountCount,1);
 assert.equal(p.uniqueCoverage.sourceCoverage.platforms[0].detailOnlyDays,1);assert.equal(result.coverage.capturedPlatformDays,0);
 assert.equal(result.summary.uniqueOrderAmount,null,'unknown currency never becomes fiat money');
});
test('zero receipts without a direction cohort do not invent platform totals and unavailable originals stay unknown',async()=>{
 await api.daily({submitted:0});let result=await unchanged({platforms:['DHANIWIN','DhaniWin'],direction:'charge'}),p;
 assert.deepEqual(result.byPlatformDirection,[]);assert.equal(result.summary.uniqueOrderCount,0);assert.equal(result.coverage.complete,true);
 await db().exec("delete from workorder_deposit_daily");await api.ticket('NOREF',null,{raw:{}});
 result=await unchanged({platforms:['DHANIWIN','DhaniWin'],direction:'charge'});p=platform(result,NEWAR);assert.equal(p.uniqueOrderCount,null);assert.equal(p.uniqueSuccessCount,null);assert.equal(p.uniqueCoverage.status,'unavailable');
 await db().exec('delete from newar_detail_records');assert.deepEqual((await call({platforms:['DHANIWIN','DhaniWin'],direction:'charge'})).byPlatformDirection,[]);
});
test('ambiguous native catalog identity never guesses a platform total',async()=>{
 await db().exec("insert into catalog select '44444444-4444-4444-8444-444444444444',name,source_name,country,scope_group,source,currency from catalog where source='newar'");await api.ticket('ONE','ONE');
 const result=await unchanged({platforms:['DHANIWIN','DhaniWin'],direction:'charge'});assert.equal(result.byPlatformProvider[0].platformId,null);assert.deepEqual(result.byPlatformDirection,[]);
});
test('many source records retain one platform/business original pass regardless of provider attribution',async t=>{
 await db().exec(`insert into ar_workorder_issue_details
 select 'AR','IN','印度','Alpha','ISSUE-'||i||'-'||copy,'WORK-'||i||'-'||copy,'ORIGINAL-'||i,null,100,'deposit',
 case when i%20=0 then '未识别三方' else 'Provider-'||(i%20) end,'BANK',case when i%2=0 and copy=2 then 4 else 3 end,'2026-10-03',false
 from generate_series(1,2000) i cross join generate_series(1,2) copy;`);await rebuildAr();
 const started=performance.now(),result=await unchanged(),p=platform(result);
 assert.deepEqual([p.uniqueOrderCount,p.uniqueSuccessCount],[2000,1000]);assert.equal(p.uniqueCoverage.detailCount,4000);assert.equal(result.summary.submittedCount,4000);
 assert.equal((migration.match(/\), original_groups as materialized \(/g)||[]).length,1,'new scope reuses the sole original grouping');
 t.diagnostic('Synthetic 4,000-record before/after semantic comparison: '+Math.round(performance.now()-started)+' ms (not a production latency claim).');
});
test('source-specific platform coverage does not borrow completeness from an equal-named AR platform',async()=>{
 await api.ticket('ONE','ONE');
 const input=await call({platforms:['DHANIWIN','DhaniWin'],direction:'charge'});
 await db().exec("insert into catalog values('33333333-3333-4333-8333-333333333333','DHANIWIN','DhaniWin','印度','IN','ar','INR')");
 input.coverage.platforms.push({...input.coverage.platforms[0],platformId:'33333333-3333-4333-8333-333333333333',complete:true});
 const result=(await db().query('select private.dashboard_admin_live_workorder_unique_totals($1::jsonb,$2::jsonb) value',[JSON.stringify({country:'印度',direction:'charge'}),JSON.stringify(input)])).rows[0].value;
 assert.ok(result.byPlatformDirection.every(r=>r.source==='newar'));
 const p=platform(result,NEWAR);assert.ok(p.uniqueCoverage.sourceCoverage.platforms.every(c=>c.source==='newar'));
});
test('metadata, OID, owner-only grants, idempotence and existing reader/source records remain unchanged',async()=>{
 await ar('A','A',{status:4});await rebuildAr();const beforeSources=(await db().query('select * from ar_workorder_issue_details')).rows;
 assert.deepEqual(await metadata(helper),baselineMetadata);assert.deepEqual(await metadata(main),mainMetadata);await db().exec(install);assert.deepEqual(await metadata(helper),baselineMetadata);
 assert.deepEqual((await db().query('select * from ar_workorder_issue_details')).rows,beforeSources);
 await db().exec('savepoint denied;set local role authenticated');await assert.rejects(db().query('select private.dashboard_admin_live_workorder_unique_totals(\'{}\'::jsonb,\'{}\'::jsonb)'),/permission denied/);await db().exec('rollback to denied');
 await db().exec("savepoint inactive;set local test.active='false'");await assert.rejects(call(),/preview_denied/);await db().exec('rollback to inactive');
 for(const change of [`alter function ${helper} security definer`,`grant execute on function ${helper} to authenticated`,`alter function ${helper} volatile`,`alter function ${helper} set search_path=public`]){
  await db().exec('savepoint drift');await db().exec(change);await assert.rejects(db().exec(install),/metadata_or_acl_drift/);await db().exec('rollback to drift');
 }
 await db().exec('savepoint body');await db().exec(targetDefinition.replace('WORKORDER_PENDING_DETAIL_DIAGNOSTICS_V1','UNEXPECTED_BODY'));await assert.rejects(db().exec(install),/baseline_drift/);await db().exec('rollback to body');
 await db().exec('savepoint definition');await db().exec(`alter function ${helper} rename to dashboard_admin_live_workorder_unique_totals_renamed`);
 await db().exec(targetDefinition.replace('p_request jsonb, p_result jsonb','p_request jsonb, p_result jsonb DEFAULT NULL'));
 await db().exec(`revoke all on function ${helper} from public,anon,authenticated`);
 await assert.rejects(db().exec(install),/target_definition_drift/);await db().exec('rollback to definition');
});
