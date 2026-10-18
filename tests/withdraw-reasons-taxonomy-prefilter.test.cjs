// Synthetic-only exact-output tests; no live database or captured financial data.
{
// Synthetic only. No production data, database/network call, or live identity.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test}=require('node:test');
const repo=path.resolve(__dirname,'..'),{setup,ar,newar}=require('./fixtures/withdraw-reasons-query-harness.cjs');
const names={'01-install.review.private.sql':'withdraw-reasons-taxonomy-prefilter-install.sql','02-rollback.review.private.sql':'withdraw-reasons-taxonomy-prefilter-rollback.sql'};
const operation=f=>fs.readFileSync(path.join(repo,'supabase/operations',f),'utf8');
const read=f=>f==='01-install.review.private.sql'?operation('withdraw-reasons-taxonomy-prefilter-install.sql')+'\n'+operation('withdraw-reasons-taxonomy-head-prefix-install.sql')+'\n'+operation('withdraw-reasons-ar-fallback-prefix-install.sql'):f==='02-rollback.review.private.sql'?operation('withdraw-reasons-ar-fallback-prefix-rollback.sql')+'\n'+operation('withdraw-reasons-taxonomy-head-prefix-rollback.sql')+'\n'+operation('withdraw-reasons-taxonomy-prefilter-rollback.sql'):operation(names[f]||f);
test('all three necessary-prefix stages preserve all AR/NEWAR JSON and exact original-to-final-to-original rollback',async()=>{const db=await setup();let n=0;try{
 await db.exec("revoke all on function private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb),private.dashboard_admin_live_clean_note(text),private.dashboard_admin_live_blocking_details_cleaned(text)from public,anon,authenticated,service_role");
 for(let i=0;i<46;i++)await ar.add(db,'AR-ORACLE-'+i,['Named_A','system',null,'---','None'][i%5],{applied_at:'2026-10-17 11:00:00',completed_at:i%4?'2026-10-17 11:01:00':null,status:['已通过','未通过','处理中','失败'][i%4],manual_remark:['棋牌有效投注1000>阈值100','真人视讯有效投注2000>阈值200','体育有效投注3000>阈值300','保持未知123456','Repeat<br>Repeat','Same\nSame',null,'   '][i%8],remark:i%3?'原始驳回123':'',amount:'999999999999999.12345678'});
 const ids=[];for(let i=0;i<22;i++)ids.push(await newar.order(db,'NEWAR-ORACLE-'+i,['棋牌有效投注1000>阈值100','真人视讯有效投注2000>阈值200','体育有效投注3000>阈值300',null,'Unknown 000123'][i%5],{platform:'MAANWIN',method:i%4?'manual':'auto',created:'2026-10-17T01:00:00Z',captured:'2026-10-18T00:00:00Z',handled:'2026-10-17T01:01:00Z',status:i%3?'success':'failed',amount:'999999999999999.12345678'}));
 await newar.order(db,'NEWAR-NULL-TIMES','Unknown null times',{platform:'MAANWIN',created:'2026-10-17T02:00:00Z',captured:'2026-10-18T00:00:00Z',handled:null,raw:{sourceSubmittedAt:null}});
 // Fresh empty label must stay empty even if a raw value is present; each stale
 // freshness component and missing sidecar must retain the old raw fallback.
 await db.query('delete from private.newar_withdraw_reason_facts where record_id=$1',[ids[1]]);
 await db.query("update private.newar_withdraw_reason_facts set received_at=received_at-interval'1second'where record_id=$1",[ids[2]]);
 await db.query("update private.newar_withdraw_reason_facts set created_at=created_at-interval'1second'where record_id=$1",[ids[3]]);
 await db.query("update private.newar_withdraw_reason_facts set platform='WRONG'where record_id=$1",[ids[5]]);
 await db.query("update private.newar_withdraw_reason_facts set source_label=null where record_id=$1",[ids[6]]);
 await db.exec("select set_config('request.jwt.claims','{\"sub\":\"00000000-0000-4000-8000-000000000011\",\"session_id\":\"00000000-0000-4000-8000-000000000022\",\"role\":\"authenticated\"}',false)");
 await db.exec(read('withdraw-reasons-conditional-raw-reader.sql'));await db.exec(read('withdraw-reasons-function-custom-plan.sql'));await db.exec(read('withdraw-reasons-narrow-note-projection.sql'));
 await db.exec('create temp table oracle(q jsonb,d jsonb,t text);create temp table errors(q jsonb,code text)');
 const qs=[];for(const platform of ['91CLUB','MAAN.WIN']){
  const q={country:'印度',platform,date:'2026-10-17',kind:'blocking',offset:0,limit:20};
  const blocked=(await db.query('select public.dashboard_admin_live_withdraw_reasons($1)r',[q])).rows[0].r;
  qs.push(q,{...q,offset:20},{...q,limit:30},{...q,date:'2026-10-16'});
  for(const r of blocked.rows)for(const kind of ['blockingVariants','blockingOrders'])qs.push({...q,kind,reasonKey:r.reasonKey},{...q,kind,reasonKey:r.reasonKey,offset:20},{...q,kind,reasonKey:r.reasonKey,query:kind==='blockingOrders'?'ORACLE':undefined});
  for(const kind of ['categories','rejection','operators','orders'])qs.push({...q,kind},{...q,kind,offset:20});
  for(const kind of ['blockingVariants','blockingOrders'])qs.push({...q,kind,reasonKey:'a'.repeat(32)});
  if(platform==='91CLUB'){
   const categories=(await db.query('select public.dashboard_admin_live_withdraw_reasons($1)r',[{...q,kind:'categories'}])).rows[0].r;
   for(const r of categories.rows)qs.push({...q,kind:'rejection',category:r.categoryKey},{...q,kind:'orders',category:r.categoryKey});
   const operators=(await db.query('select public.dashboard_admin_live_withdraw_reasons($1)r',[{...q,kind:'operators'}])).rows[0].r;
   for(const r of operators.rows)qs.push({...q,kind:'orders',operatorKey:r.operatorKey});
  }
 }
 for(const q of qs){const clean=JSON.parse(JSON.stringify(q));await db.query('insert into oracle select $1,d,d::text from(select public.dashboard_admin_live_withdraw_reasons($1)d)x',[clean]);}
 const bad=[{offset:-1},{offset:'0'},{limit:21},{limit:'20'},{kind:'not-a-kind'},{reasonKey:'x'},{kind:'blockingOrders'},{date:'bad'}, {date:'2026-02-31'}].map(extra=>({country:'印度',platform:'91CLUB',date:'2026-10-17',kind:'blocking',...extra}));
 for(const q of bad){let e;try{await db.query('select public.dashboard_admin_live_withdraw_reasons($1)',[q]);}catch(x){e=x}assert(e,'baseline must reject');await db.query('insert into errors values($1,$2)',[q,e.code]);}
 const sigs=['private.dashboard_admin_live_withdraw_reasons(jsonb)','private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)'];const allBefore=(await db.query("select oid,to_jsonb(p)m from pg_proc p order by oid")).rows;const before=(await db.query('select oid,to_jsonb(p)-\'prosrc\'m from pg_proc p where oid=any($1::regprocedure[])order by oid',[sigs])).rows;
 await db.exec(read('01-install.review.private.sql'));
 const equality=(await db.query('select count(*)n,bool_and(d=public.dashboard_admin_live_withdraw_reasons(q))json_equal,bool_and(t=public.dashboard_admin_live_withdraw_reasons(q)::text)text_equal from oracle')).rows[0];assert(equality.json_equal);assert(equality.text_equal);n=Number(equality.n);
 for(const q of bad){const code=(await db.query('select code from errors where q=$1',[q])).rows[0].code;let e;try{await db.query('select public.dashboard_admin_live_withdraw_reasons($1)',[q]);}catch(x){e=x}assert.equal(e?.code,code);}
 assert.deepEqual((await db.query('select oid,to_jsonb(p)-\'prosrc\'m from pg_proc p where oid=any($1::regprocedure[])order by oid',[sigs])).rows,before);
 await db.exec(read('02-rollback.review.private.sql'));assert.deepEqual((await db.query("select oid,to_jsonb(p)m from pg_proc p order by oid")).rows,allBefore);
 const restored=(await db.query('select bool_and(d=public.dashboard_admin_live_withdraw_reasons(q))j,bool_and(t=public.dashboard_admin_live_withdraw_reasons(q)::text)t from oracle')).rows[0];assert(restored.j&&restored.t);
 const receipt={allPgProcRestored:true,normalRequestCases:n,invalidRequestCases:bad.length,fullJSONBEqual:true,fullTextEqual:true,originalMetadataACLUnchanged:true,guardedInstallerSucceeded:true,guardedRollbackSucceeded:true,rollbackAllOracleEqual:true,syntheticOnly:true};assert(receipt.fullJSONBEqual&&receipt.fullTextEqual);
}finally{await db.close()}});

}
{
// Existing public classifier fixtures plus synthetic guard boundaries. Never accesses a live database.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..');
const actualRequire=require('node:module').createRequire(path.join(repo,'package.json'));
const {PGlite}=actualRequire('@electric-sql/pglite');const collected=new Set(),cases=[];
class CapturingPGlite extends PGlite{async query(sql,args,...rest){if(sql.includes('private.dashboard_admin_live_blocking_details($1)')&&args)collected.add(args[0]);return super.query(sql,args,...rest)}}
function shim(id){if(id==='node:test')return{test:(name,fn)=>cases.push([name,fn])};if(id==='@electric-sql/pglite')return{PGlite:CapturingPGlite};if(id==='node:module')return{...actualRequire(id),createRequire:()=>shim};return actualRequire(id)}
const read=f=>fs.readFileSync(path.join(repo,f),'utf8'),local=f=>f==='01-install.review.private.sql'?read('supabase/operations/withdraw-reasons-taxonomy-prefilter-install.sql')+'\n'+read('supabase/operations/withdraw-reasons-taxonomy-head-prefix-install.sql')+'\n'+read('supabase/operations/withdraw-reasons-ar-fallback-prefix-install.sql'):f==='02-rollback.review.private.sql'?read('supabase/operations/withdraw-reasons-ar-fallback-prefix-rollback.sql')+'\n'+read('supabase/operations/withdraw-reasons-taxonomy-head-prefix-rollback.sql')+'\n'+read('supabase/operations/withdraw-reasons-taxonomy-prefilter-rollback.sql'):read('supabase/operations/'+f);
require('node:test').test('all three necessary guards preserve every shared/game/fallback input and exact source inverse',async()=>{
 for(const f of ['withdraw-blocking-shared-taxonomy.test.cjs','withdraw-game-valid-bet-groups.test.cjs'])new Function('require','__dirname',read('tests/'+f))(shim,path.join(repo,'tests'));
 for(const [name,fn]of cases){await fn();console.log('existing fixture passed:',name)}
 const source=read('tests/withdraw-blocking-shared-taxonomy.test.cjs').split(/\ntest\(/)[0];
 const api=new Function('require','__dirname',source+';return{fixture,migration,details};')(shim,path.join(repo,'tests'));
 const db=await api.fixture();try{
  await db.exec(api.migration);await db.exec(read('supabase/maintenance/withdraw-game-valid-bet-groups.sql'));
  const extra=[null,'','\t \n','\u200b\ufeff','<br>','Unknown exact 123','用户余额大于19999,用户余额:20000','x'.repeat(5000),
   'No\tAvailable\nChannels','nO aVaIlAbLe ChAnNeLs','NO AVAILABLE CHANNELS','No Avaılable Channels','No Avaİlable Channels',
   'The AMOUNT is not within the range of -10.00-200.00.','INSUFFICIENT BALANCE','Insuffıcıent balance','Inſufficient balance','İnsufficient balance','Insufficient balance unknown501',
   '余额不足','代付余额不足','通道余额不足','商户余额不足','未知规则501；余额不足；附加条件999',
   '用户充提差额不满足自动提现要求:'+'1'.repeat(25),'用户充提差额不满足自动提现要求:1.'+'1'.repeat(41),
   '免审条件不过：用户领取助力现金或代理宝箱奖励（多次）','免审未通过,领取助力领现金或者代理宝箱活动奖励(多次)',
   '免审未通过:用户等级不在自动提现等级范围内,1,autoWithdrawalLimitLevel:[1,2]',
   '用户未完成首充会员:123,null','用户不满足第一次提现流水要求:isFirstWithdrawal:true,userFlow:1,historicalValidBetting:2',
   '首存金额大于19999.00,首存金额:20000','打码倍数校验通过@2026-10-17T01:02:03(倍数2≥1,有效投注3,充值4)',
   '打码倍数小于2,不能自动出款,上次提现后的有效投注(sumLotteryAmount):0,上次提现后的成功充值总额:100,当前用户打码倍数(userBetTurnoverMultiple):0'];
  extra.push('充提差额不满足自动提现要求:1','用户充提差额不满足自动提现要求:1',
   '免审未通过:充提差额不满足自动提现要求:1','免审条件不过，用户充提差额不满足自动提现要求:1',
   '  \t用户未完成首充会员:123,null','领取助力现金或代理宝箱奖励(多次)',
   '用户领取助力现金或代理宝箱奖励（多次）','免审条件不过：领取助力领现金或者代理宝箱活动奖励（多次）',
   'sumLotteryAmount:100','userRedPacketTotalAmount:200','Unknown amount field501',
   '失败信息:NO\tAVAILABLE\nCHANNELS','失败信息:THE\tAMOUNT\nIS NOT within the range of 1-2.',
   '代付异常:INSUFFICIENT\tBALANCE','其他规则501；失败信息:No Available Channels；保留条件999');
  const fallbackPositive=[
   '首存金额大于19999.00,首存金额:20000','用户余额小于等于300.0,用户余额:200',
   '用户历史总领取的红包大于或者等于配置值不能自动出款,用户历史红包领取总额(userRedPacketTotalAmount):200,当前配置的历史红包领取总额限制是(ReceiveRedSumAmount):100',
   '用户最后一次充值之后领取的红包大于或者等于配置值不能自动出款,用户最后一次充值之后领取的红包总额(userLastRechgRecvReadSumAmount):200,当前配置的最后一次充值之后领取的红包总额限制是(LastRechgRecvReadSumAmount):100',
   '当日盈利金额大于{金额},当日盈利:200','累计提款次数不能小于3次,当前累计提现次数:1次',
   '最后充值日限额超过当前配置的最后充值日限制:3天,最后充值时间:2026-10-01T01:02:03,当前时间:2026-10-17T01:02:03,间隔:16天',
   '会员在限制的游戏类型中总的投注数:123'];
  const prefixes=['首存金额','用户余额','用户历史总领取的红包大于或者等于配置值不能自动出款','用户最后一次充值之后领取的红包大于或者等于配置值不能自动出款','当日盈利金额','累计提款次数不能小于','最后充值日限额超过当前配置的最后充值日限制:','会员在限制的游戏类型中总的投注数:'];
  for(const n of fallbackPositive)extra.push(n,'X'+n,n+';未知条件501');
  for(const prefix of prefixes)extra.push(prefix.slice(0,-1),prefix.slice(0,-1)+'错'+prefix.slice(-1),prefix+'wrong501');
  for(const n of extra)collected.add(n);
  const notes=[...collected];await db.exec('create temp table oracle(n text,d jsonb,t text,w jsonb,wt text)');
  for(const n of notes)await db.query('insert into oracle select $1,d,d::text,w,w::text from(select private.dashboard_admin_live_blocking_details_cleaned($1)d,private.dashboard_admin_live_blocking_details($1)w)x',[n]);
  const before=(await db.query('select oid,to_jsonb(p)m from pg_proc p order by oid')).rows;
  const originalDef=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_blocking_details_cleaned(text)'::regprocedure)d")).rows[0].d;
  await db.exec(local('01-install.review.private.sql'));
  const equal=(await db.query(`select count(*)n,bool_and(d=private.dashboard_admin_live_blocking_details_cleaned(n))j,
   bool_and(t=private.dashboard_admin_live_blocking_details_cleaned(n)::text)t,
   bool_and(w=private.dashboard_admin_live_blocking_details(n))w,bool_and(wt=private.dashboard_admin_live_blocking_details(n)::text)wt from oracle`)).rows[0];
  assert(equal.j&&equal.t&&equal.w&&equal.wt);
  let inv=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_blocking_details_cleaned(text)'::regprocedure)d")).rows[0].d;const spans=[...local('01-install.review.private.sql').matchAll(/patched:=replace\(patched,\$old\$([\s\S]*?)\$old\$,\$new\$([\s\S]*?)\$new\$\);/g)];assert.equal(spans.length,12);for(const [,oldSpan,newSpan]of spans.reverse()){assert.equal(inv.split(newSpan).length,2);inv=inv.replace(newSpan,()=>oldSpan)}assert.equal(inv,originalDef);
  await db.exec(local('02-rollback.review.private.sql'));
  assert.deepEqual((await db.query('select oid,to_jsonb(p)m from pg_proc p order by oid')).rows,before);
  const receipt={existingPublicFixtureCases:cases.length,distinctSyntheticInputs:notes.length,directWholeJSONBEqual:true,directWholeTextEqual:true,normalizedWholeJSONBEqual:true,normalizedWholeTextEqual:true,sourceInverseExact:true,allPgProcRestored:true,syntheticOnly:true};
  assert(receipt.directWholeJSONBEqual&&receipt.directWholeTextEqual);
 }finally{await db.close()}
});

}
