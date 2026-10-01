// Preserve financial/original totals while explaining the AR collector's pending policy.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261001062538_workorder_pending_detail_diagnostics.sql'),'utf8');
const harness=fs.readFileSync(path.join(__dirname,'admin-workorder-known-provider-attribution.test.cjs'),'utf8').split(/\ntest\(/)[0]
 .replace('let db,legacy,','let prePending,db,legacy,')
 .replace('await db.exec(attributionPatch);','await db.exec(attributionPatch);prePending=await call();await db.exec("alter table workorder_deposit_daily add column status_counts jsonb default \'{}\'::jsonb");await db.exec(pendingMigration);');
const api=new Function('require','__dirname','pendingMigration',harness+';return {call,provider,put,ar,resetAr,rebuildAr,arCall,baseline:()=>prePending,db:()=>db};')(require,__dirname,migration);
const coverage=async extra=>api.provider(await api.arCall(extra),'KycPay').uniqueCoverage;
async function seed({expected=3,pending=2,storedPending=0,date='2026-09-29',kind='deposit'}={}){
 await api.resetAr();await api.ar('A','A',{date,kind});
 for(let i=0;i<storedPending;i++)await api.ar('P'+i,'P'+i,{date,kind,status:1});
 await api.rebuildAr();await api.db().query("update workorder_deposit_daily set submitted_count=case when $1='deposit' then $2 else submitted_count end,withdraw_not_received_count=case when $1='withdraw' then $2 else withdraw_not_received_count end,status_counts=$3",[kind,expected,JSON.stringify({'待处理':pending})]);
}
test('pending explains a cohort shortfall without changing whole original coverage or amounts',async()=>{
 await seed();const r=await api.arCall(),p=api.provider(r,'KycPay'),c=p.uniqueCoverage,d=c.diagnosticDays[0];
 assert.equal(p.submittedCount,3);assert.equal(p.uniqueOrderCount,1);assert.equal(p.uniqueOrderAmount,100);
 assert.equal(c.complete,false);assert.equal(c.missingDetailCount,2);assert.equal(c.detailMismatchCount,2);
 assert.equal(c.pendingExcludedDetailCount,2);assert.equal(c.unexplainedDetailMismatchCount,0);
 assert.equal(c.excludedWorkorderTypeCount,0,'ordinary AR detail gaps are never labelled USDT exclusions');
 assert.equal(d.expectedPendingCount,2);assert.equal(d.pendingDetailCount,0);assert.equal(d.pendingExcludedDetailCount,2);assert.equal(d.unexplainedDetailMismatchCount,0);
 assert.equal(r.summary.uniqueCoverage.pendingExcludedDetailCount,2);
});
test('diagnostics leave every pre-existing response field unchanged',async()=>{
 const added=new Set(['expectedPendingCount','pendingDetailCount','pendingExcludedDetailCount','unexplainedDetailMismatchCount','excludedWorkorderTypeCount','excludedTypeExplainedMismatchCount']);
 const strip=value=>Array.isArray(value)?value.map(strip):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!added.has(key)).map(([key,v])=>[key,key==='diagnosticVersion'?1:strip(v)])):value;
 assert.deepEqual(strip(await api.call()),api.baseline());
});
test('collected USDT workorder types explain only their exact cohort without becoming fiat originals',async()=>{
 await api.db().exec('delete from newar_detail_records;delete from workorder_deposit_daily');
 for(let i=0;i<3;i++)await api.put('U'+i,null,{provider:'USDT(TRC20)-4',type:'USDT存款未到账自动化',raw:{depositOrderNo:null,rechargeNumber:null}});
 await api.put('OTHER-DAY',null,{provider:'USDT(TRC20)-4',type:'USDT存款未到账自动化',date:'2026-09-28T12:00:00+05:30'});
 await api.put('OTHER-PLATFORM',null,{provider:'USDT(TRC20)-4',platform:'OtherSite',type:'USDT存款未到账自动化'});
 await api.put('OTHER-TYPE',null,{provider:'USDT(TRC20)-4',type:'其他问题'});
 await api.put('OTHER-PROVIDER',null,{provider:'ElsePay',type:'USDT存款未到账自动化'});
 await api.db().exec("insert into workorder_deposit_daily values('2026-09-29','IN','印度','DhaniWin','USDT(TRC20)-4','QR','AR_WORKORDER',3,300,0,0,0,0,0,0,now(),now(),'{}'::jsonb)");
 const r=await api.call({platforms:['DhaniWin']}),p=api.provider(r,'USDT(TRC20)-4'),c=p.uniqueCoverage;
 assert.equal(c.excludedWorkorderTypeCount,3);assert.equal(c.excludedTypeExplainedMismatchCount,3);assert.equal(c.unexplainedDetailMismatchCount,0);
 assert.equal(c.detailCount,0);assert.equal(c.missingDetailCount,3);assert.equal(c.complete,false);assert.equal(p.uniqueOrderCount,null);assert.equal(p.submittedCount,3);
 await api.db().exec('update workorder_deposit_daily set submitted_count=4');
 const changed=api.provider(await api.call({platforms:['DhaniWin']}),'USDT(TRC20)-4').uniqueCoverage;
 assert.equal(changed.excludedWorkorderTypeCount,3);assert.equal(changed.excludedTypeExplainedMismatchCount,0);assert.equal(changed.unexplainedDetailMismatchCount,4,'a nonmatching difference remains unreconciled');
 const ordinary=api.provider(await api.call({platforms:['Alpha']}),'KycPay');assert.equal(ordinary,undefined);
});
test('already stored pending records are not explained a second time',async()=>{
 await seed({expected:4,pending:3,storedPending:1});const c=await coverage();
 assert.equal(c.detailCount,2);assert.equal(c.pendingExcludedDetailCount,2);assert.equal(c.complete,false);
});
test('unexplained mismatch is retained if pending does not exactly reconcile the cohort',async()=>{
 await seed({expected:5,pending:2});const c=await coverage();assert.equal(c.pendingExcludedDetailCount,0);assert.equal(c.unexplainedDetailMismatchCount,4);assert.equal(c.complete,false);
});
test('a missing pending count cannot explain deficits for NEWAR or legacy withdrawal totals',async()=>{
 await seed({kind:'withdraw'});const c=await coverage({direction:'withdraw'});assert.equal(c.pendingExcludedDetailCount,0);assert.equal(c.unexplainedDetailMismatchCount,2);
});
test('prefixed deposit status evidence is accepted, malformed/absent evidence is not',async()=>{
 await seed();for(const [counts,explained,expectedPending] of [[{'存款/待处理':2},2,2],[{'待处理':0},0,0],[{},0,null],[null,0,null],[{'待处理':'not-a-count'},0,null]]){
  await api.db().query('update workorder_deposit_daily set status_counts=$1',[JSON.stringify(counts)]);const c=await coverage();assert.equal(c.pendingExcludedDetailCount,explained);assert.equal(c.diagnosticDays[0].expectedPendingCount,expectedPending);assert.equal(c.unexplainedDetailMismatchCount,2-explained);assert.equal(c.complete,false);
 }
});
test('daily mismatch diagnostics do not net off opposite-day excesses',async()=>{
 await seed();await api.ar('B','B',{date:'2026-09-28'});await api.ar('C','C',{date:'2026-09-28'});await api.ar('D','D',{date:'2026-09-28'});
 await api.db().exec("insert into workorder_deposit_daily select '2026-09-28',country_code,country,platform,third_party,channel_type,source_system,1,100,0,0,0,0,0,0,now(),now(),'{}'::jsonb from workorder_deposit_daily where platform='Alpha' limit 1");
 const c=await coverage({startAt:'2026-09-28T00:00:00+05:30'});assert.equal(c.detailMismatchCount,0);assert.equal(c.pendingExcludedDetailCount,2);assert.equal(c.unexplainedDetailMismatchCount,2);assert.equal(c.complete,false);
});
test('migration is idempotent and rejects unknown function bodies',async()=>{
 await api.db().exec(migration);await api.db().exec("create or replace function private.dashboard_admin_live_workorder_unique_totals(p_request jsonb,p_result jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$begin return '{}'::jsonb;end$$");
 await assert.rejects(()=>api.db().exec(migration),/baseline changed/);
});
