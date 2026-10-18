// Synthetic text/order fixtures only. Never opens a live database.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'..'),here=__dirname;
const source=fs.readFileSync(path.join(repo,'tests/withdraw-blocking-shared-taxonomy.test.cjs'),'utf8').split(/\ntest\(/)[0];
const candidateRequire=require('node:module').createRequire(path.join(repo,'package.json'));
const api=new Function('require','__dirname',source+';return {fixture,details,call,order,migration};')(candidateRequire,path.join(repo,'tests'));
const install=fs.readFileSync(path.join(repo,'supabase/maintenance/withdraw-game-valid-bet-groups.sql'),'utf8');
const rollback=fs.readFileSync(path.join(repo,'tests/fixtures/withdraw-game-valid-bet-rollback.sql'),'utf8');
const sig='private.dashboard_admin_live_blocking_details_cleaned(text)';
const scalar=async(db,q,args=[])=>(await db.query(q,args)).rows[0].value;
const meta=db=>scalar(db,"select to_jsonb(p)-'prosrc' value from pg_proc p where oid=$1::regprocedure",[sig]);
async function fixture(){const db=await api.fixture();await db.exec(api.migration);return db;}
async function withDb(fn){const db=await fixture();try{await fn(db);}finally{await db.close();}}
const gameNote=(game,amount,threshold='275.00')=>`${game} 有效投注 ${amount} > 阈值 ${threshold}`;

test('only three complete observed game templates collapse measured amounts and thresholds',()=>withDb(async db=>{
 await db.exec(install);
 for(const game of ['棋牌','真人视讯','体育'])for(const amount of ['1.00','214.25','4,321.00','9876.540000000000000001'])for(const threshold of ['0.00','275.00','1,000.00']){
  const d=await api.details(db,gameNote(game,amount,threshold));
  assert.equal(d.reason,game+'有效投注超限');assert.equal(d.actualValue,amount.replaceAll(',',''));
  assert.equal(d.actualField,game+'有效投注');assert.equal(d.threshold,threshold==='1,000.00'?'1000':threshold==='0.00'?'0':'275');
 }
 assert.equal((await api.details(db,'体育有效投注：9,876.54 > 阈值：275.00。')).reason,'体育有效投注超限');
}));
test('malformed numbers, extra conditions, other games and comparators keep their exact original reason',()=>withDb(async db=>{
 const notes=['棋牌 有效投注 43,21.00 > 阈值 0.00','棋牌 有效投注 4,321.00 > 阈值 0.00；另有风险规则501',
  '真人视讯 有效投注 100 >= 阈值 300','体育 有效投注 -100 > 阈值 0','彩票 有效投注 100 > 阈值 0',
  '会员501 棋牌 有效投注 100 > 阈值 0','棋牌 有效投注 100 > 阈值 0；体育 有效投注 200 > 阈值 0',
  gameNote('棋牌','1'.repeat(25)),gameNote('体育','1.'+'1'.repeat(41)),gameNote('体育','NaN'),gameNote('体育','Infinity')];
 const before=await Promise.all(notes.map(n=>api.details(db,n)));await db.exec(install);
 for(let i=0;i<notes.length;i++)assert.deepEqual(await api.details(db,notes[i]),before[i]);
}));
test('manual totals, statuses, denominators, all variants and order detail fields conserve across grouping',()=>withDb(async db=>{
 let n=0;const expected=new Map();for(const [game,count]of [['棋牌',4],['真人视讯',6],['体育',8]]){
  const notes=[];for(let i=0;i<count;i++){const text=gameNote(game,String(100+i),i%2?'275.00':'0.00');notes.push(text);await api.order(db,'GAME-'+(++n),text,{status:['已支付','未通过','待审核'][i%3]});}expected.set(game,notes);
 }
 await api.order(db,'UNKNOWN','Unrelated exact source501');await api.order(db,'SYSTEM',gameNote('体育','1000'),{operator:'system'});
 const rawBefore=(await db.query('select order_no,manual_remark from ar_collected_orders order by order_no')).rows;
 const original=await api.call(db);await db.exec(install);const result=await api.call(db);
 assert.equal(result.noteCount,original.noteCount);assert.equal(result.noteCount,19);assert.equal(result.total,4);
 assert.equal(result.rows.reduce((n,r)=>n+r.count,0),19);
 for(const [game,notes]of expected){const row=result.rows.find(r=>r.reason===game+'有效投注超限');assert.equal(row.count,notes.length);assert.equal(row.success+row.rejected+row.other,notes.length);assert.equal(row.sourceVariantCount,notes.length);
  const variants=await api.call(db,{kind:'blockingVariants',reasonKey:row.reasonKey});assert.equal(variants.noteCount,19);assert.equal(variants.rows.reduce((n,r)=>n+r.count,0),notes.length);assert.deepEqual(new Set(variants.rows.map(r=>r.sourceReason)),new Set(notes));
  const orders=await api.call(db,{kind:'blockingOrders',reasonKey:row.reasonKey});assert.equal(orders.total,notes.length);assert(orders.rows.every(r=>r.blockingReason===row.reason&&r.blockingActualField===game+'有效投注'&&r.blockingActualValue!=null&&r.blockingThreshold!=null&&notes.includes(r.rawManualRemark)));
 }
 assert.deepEqual((await db.query('select order_no,manual_remark from ar_collected_orders order by order_no')).rows,rawBefore);
}));
test('hundreds of raw measurements stay three main categories and keep complete paginated drilldown',()=>withDb(async db=>{
 for(const game of ['棋牌','真人视讯','体育'])for(let i=0;i<81;i++)await api.order(db,game+'-ORDER-'+i,gameNote(game,String(1000+i)));
 await db.exec(install);const result=await api.call(db);assert.equal(result.rows.length,3);assert.equal(result.total,3);assert.equal(result.noteCount,243);
 for(const row of result.rows){const variants=[];for(let offset=0;offset<81;offset+=20){const page=await api.call(db,{kind:'blockingVariants',reasonKey:row.reasonKey,offset,limit:20});assert.equal(page.total,81);variants.push(...page.rows);}
  assert.equal(variants.length,81);assert.equal(new Set(variants.map(v=>v.sourceReason)).size,81);
 }
}));
test('unrelated categories, rejection views and reader authorization keep their original contracts',()=>withDb(async db=>{
 const texts=['首存金额大于19999.00,首存金额:20000','Unknown source rule501','打码倍数小于2,不能自动出款,上次提现后的有效投注(sumLotteryAmount):0,上次提现后的成功充值总额:100,当前用户打码倍数(userBetTurnoverMultiple):0'];
 const previous=await Promise.all(texts.map(n=>api.details(db,n)));await api.order(db,'REJECT',gameNote('体育','1000'),{status:'未通过',rejection:'[Bank exact]501'});
 const kinds=['categories','rejection','operators','orders'],rejections=await Promise.all(kinds.map(kind=>api.call(db,{kind})));
 await db.exec(install);for(let i=0;i<texts.length;i++)assert.deepEqual(await api.details(db,texts[i]),previous[i]);for(let i=0;i<kinds.length;i++)assert.deepEqual(await api.call(db,{kind:kinds[i]}),rejections[i]);
 await assert.rejects(api.call(db,{platform:'FOREIGN'}),/scope_denied/);await db.exec("set test.denied='yes'");await assert.rejects(api.call(db),/scope_denied/);
}));
test('install is exact replayable, keeps every pg_proc metadata field and rollback restores whole definition',()=>withDb(async db=>{
 const before=await scalar(db,'select pg_get_functiondef($1::regprocedure)value',[sig]),beforeMeta=await meta(db);await db.exec(install);assert.deepEqual(await meta(db),beforeMeta);
 const after=await scalar(db,'select pg_get_functiondef($1::regprocedure)value',[sig]);await db.exec(install);assert.equal(await scalar(db,'select pg_get_functiondef($1::regprocedure)value',[sig]),after);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar(db,"select has_function_privilege($1,$2,'execute')value",[role,sig]),false);
 await db.exec(rollback);assert.equal(await scalar(db,'select pg_get_functiondef($1::regprocedure)value',[sig]),before);assert.deepEqual(await meta(db),beforeMeta);
}));
test('body and metadata drift abort atomically instead of replacing another version',async()=>{
 for(const drift of ['body','acl','config','owner'])await withDb(async db=>{
  if(drift==='body')await db.exec((await scalar(db,'select pg_get_functiondef($1::regprocedure)value',[sig])).replace('note text:=p_note;','note text:=p_note; -- changed'));
  if(drift==='acl')await db.exec(`grant execute on function ${sig} to anon`);
  if(drift==='config')await db.exec(`alter function ${sig} set search_path=public`);
  if(drift==='owner')await db.exec(`create role unexpected_owner;alter function ${sig} owner to unexpected_owner`);
  const before=await scalar(db,'select pg_get_functiondef($1::regprocedure)value',[sig]);await assert.rejects(db.exec(install),/withdraw_game_group_(definition|metadata)_drift/);await db.exec('rollback');assert.equal(await scalar(db,'select pg_get_functiondef($1::regprocedure)value',[sig]),before);
 });
});
