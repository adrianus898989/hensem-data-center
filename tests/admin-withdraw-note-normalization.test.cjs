/* Synthetic-only text and SQL integration checks. Never reads a live database. */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const repo=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(repo,'admin-preview/live-withdraw-pages.js'),'utf8');
const patch=fs.readFileSync(path.join(repo,'supabase/admin-live-withdraw-note-normalization.sql'),'utf8');
const frontend={module:{exports:{}}};vm.createContext(frontend);vm.runInContext(source,frontend);const text=frontend.module.exports;
let db;const scalar=async(sql,params=[])=>(await db.query(sql,params)).rows[0].value;
const q={country:'印度',platform:'SYNTHETIC',date:'2026-09-01'},call=extra=>scalar('select private.dashboard_admin_live_withdraw_reasons($1::jsonb) value',[JSON.stringify({...q,...extra})]);
const decode=value=>scalar('select private.dashboard_admin_live_decode_note($1) value',[value]);
const clean=value=>scalar('select private.dashboard_admin_live_clean_note($1) value',[value]);
const category=value=>scalar("select private.dashboard_admin_live_rejection_category('IN',$1) value",[value]);
const blocking=value=>scalar('select private.dashboard_admin_live_blocking_category($1) value',[value]);
const lastDeposit=(days,date,limit=30)=>'最后充值日限额超过 当前配置的...\n\n最后充值日限额超过 当前配置的最后充值日限制:'+limit+' 天,最后充值时间：'+date+',当前时间:9/1/2026 12:00:00 AM, 间隔：'+days+' 天';
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
 create function private.dashboard_admin_live_scope() returns jsonb language sql stable as $$select '{"mode":"all"}'::jsonb$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select $2 in ('印度','IN') and $3='SYNTHETIC'$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select upper($1)$$;
 create function private.dashboard_admin_live_platforms() returns table(name text,source_name text,country text,scope_group text,source text) language sql stable as $$select 'SYNTHETIC','SYNTHETIC','印度','IN','ar'$$;
 create table public.ar_collected_orders(source_system text,country_code text,platform text,order_kind text,order_no text,amount numeric,status text,operator text,applied_at timestamp,completed_at timestamp,manual_remark text,remark text,raw_channel text,updated_at timestamptz default now());
 create table public.auto_withdraw_daily(country text,data_date date,platform text,total bigint,updated_at timestamptz);
 create table public.dashboard_platform_team_map(country_name text,country_code text,active boolean);
 create table public.withdraw_reasons_daily(country_code text,platform text,stat_date date,source_system text,snapshot jsonb,updated_at timestamptz);
 create view public.withdraw_reasons_daily_grouped as select * from public.withdraw_reasons_daily;
 insert into public.auto_withdraw_daily values('印度','2026-09-01','SYNTHETIC',24,now());`);
 for(const name of ['admin-live-withdraw-templates.sql','admin-live-withdraw-reasons.sql'])await db.exec(fs.readFileSync(path.join(repo,'supabase',name),'utf8'));
 await db.exec(patch);
 const rows=[['[Resubmit Order] Retry request',2],['Resubmit Order ...\n\n&#40;Resubmit Order&#41; Retry request',3],['IFSC Code Incor...\n\n&#40;IFSC Code Incorrect&#41; Check account',4],['【IFSC Code Incorrect】 Check account',5],['Return Rewards]...\n\nReturn Rewards] Duplicate bonus',1],['Return Rewards ...\n\n&amp;#40;Return Rewards&amp;#41; Duplicate bonus',2],['SYNTHETIC-UNKNOWN-NUMBER',3],['An unrelated unclassified note',1]];
 let i=0;for(const [remark,count]of rows)for(let j=0;j<count;j++){i++;await db.query("insert into ar_collected_orders values('AR','IN','SYNTHETIC','withdraw',$1,100,'未通过',$2,'2026-09-01 12:00','2026-09-01 12:01',$3,$4,'',now())",['TEST-'+i,i%2?'operator-a':'operator-b',lastDeposit(i%2?50:70,i%2?'6/1/2026':'5/1/2026'),remark])}
 for(let j=0;j<3;j++)await db.query("insert into ar_collected_orders values('AR','IN','SYNTHETIC','withdraw',$1,100,'已支付','operator-a','2026-09-01 12:00','2026-09-01 12:01',$2,null,'',now())",['SUCCESS-'+j,'会员在限制的游戏类型中总的投注数：'+(j+1)]);
});
after(async()=>{await db?.close()});

test('decimal, hexadecimal, named and doubly encoded notes decode to safe text consistently',async()=>{
 const pairs=[['&#40;IFSC Code Incorrect&#41;','(IFSC Code Incorrect)'],['&#x5b;Resubmit Order&#x5d;','[Resubmit Order]'],['&amp;#40;Return Rewards&amp;#41;','(Return Rewards)'],['&quot;name&quot; &amp; value&nbsp;x','"name" & value x'],['&#0; &#55296; &#1114112; &unknown;','&#0; &#55296; &#1114112; &unknown;'],['&#128512;','😀']];
 for(const [input,expected]of pairs){assert.equal(await decode(input),expected);assert.equal(text.decodeNote(input),expected)}
});

test('only duplicated truncated previews are removed, preserving all distinct original lines',async()=>{
 const notes=[['IFSC Code Incor...\n\n&#40;IFSC Code Incorrect&#41; Check account','(IFSC Code Incorrect) Check account'],['Return Rewards]...\n\nReturn Rewards] Duplicate bonus','Return Rewards] Duplicate bonus'],['Alpha...\nBeta full text\nAdditional explanation','Alpha...\nBeta full text\nAdditional explanation'],['line 1<br>line 2','line 1\nline 2']];
 for(const [input,expected]of notes){assert.equal(await clean(input),expected);assert.equal(text.cleanNote(input),expected)}
});

test('rejection category recognizes full equivalent bracket headings without guessing unrelated remarks',async()=>{
 for(const input of ['[IFSC Code Incorrect] Check account','【IFSC Code Incorrect】 Check account','(IFSC Code Incorrect) Check account','IFSC Code Incor...\n\n&#40;IFSC Code Incorrect&#41; Check account'])assert.equal(await category(input),'IFSC 错误（IFSC Code Incorrect）');
 assert.equal(await category('Return Rewards] Duplicate bonus'),'回归奖励（Return Rewards）');
 assert.equal(await category('Please review: IFSC Code Incorrect maybe applies'),'其他未归类备注');
 assert.equal(await category('Unknown numeric label'),'其他未归类备注');
 assert.equal(await category('[An Unrecognized Heading] Content'),'其他标签 · an unrecognized heading');
});

test('recharge actual dates and elapsed days group only within the same configured day threshold',async()=>{
 for(const input of [lastDeposit(80,'5/1/2026'),lastDeposit(100,'4/1/2026')])assert.equal(await blocking(input),'最后充值日限额超过（限制30天）');
 assert.equal(await blocking(lastDeposit(100,'4/1/2026',60)),'最后充值日限额超过（限制60天）');
 assert.equal(await blocking('最后充值日限额超过但规则未完整'),'最后充值日限额超过但规则未完整');
 assert.equal(await blocking('会员在限制的游戏类型中总的投注数：15'),'会员在限制的游戏类型中总的投注数');
 assert.equal(await blocking('单日充值次数超过：15'),'单日充值次数超过：15');
});

test('red packet actual amounts share one blocking-rule category while retaining the values',async()=>{
 const history=value=>'用户历史总领取的红包大于或者等于配置值不能自动出款,用户历史红包领取总额(userRedPacketTotalAmount)：'+value+',当前配置的历史红包领取总额限制是(ReceiveRedSumAmount)：1000.00';
 const latest=value=>'用户最后一次充值之后领取的红包大于或者等于配置值不能自动出款,用户最后一次充值之后领取的红包总额(userLastRechgRecvReadSumAmount)：'+value+',当前配置的最后一次充值之后领取的红包总额限制是(LastRechgRecvReadSumAmount)：500.00';
 assert.equal(await blocking(history('1040.00')),'用户历史总领取的红包大于或者等于配置值不能自动出款');
 assert.equal(await blocking(history('2960.00')),'用户历史总领取的红包大于或者等于配置值不能自动出款');
 assert.deepEqual(await scalar('select private.dashboard_admin_live_blocking_details($1) value',[latest('760.00')]),{reason:'用户最后一次充值之后领取的红包大于或者等于配置值不能自动出款',actualValue:'760.00',actualField:'userLastRechgRecvReadSumAmount',threshold:'500'});
});

test('multiple blocking reasons never collapse into only the last-recharge rule',async()=>{
 const complete=lastDeposit(80,'5/1/2026');
 for(const value of [complete+'；会员备注不为空，请检查备注',complete+'\n其他条件：投注异常',complete+'\n'+lastDeposit(120,'4/1/2026'),complete.replace('当前时间:','额外规则：需要人工审核,当前时间:')]){
  assert.equal(await blocking(value),text.cleanNote(value).replace(/\s+/g,' ').trim());
  assert.notEqual(await blocking(value),'最后充值日限额超过');
 }
 for(const suffix of ['',' 。','；  ','!'])assert.equal(await blocking(complete+suffix),'最后充值日限额超过（限制30天）');
});

test('categories, order drilldown and search keep one classification and conserve counts and original fields',async()=>{
 const all=await call({kind:'categories'});assert.equal(all.noteCount,21);assert.equal(all.rows.reduce((n,r)=>n+r.count,0),21);
 const expected=new Map([['重新提交（Resubmit Order）',5],['IFSC 错误（IFSC Code Incorrect）',9],['回归奖励（Return Rewards）',3],['其他未归类备注',4]]);
 for(const row of all.rows){assert.equal(row.count,expected.get(row.category));const orders=await call({kind:'orders',category:row.categoryKey});assert.equal(orders.total,row.count);assert.equal(orders.noteCount,21);assert(orders.rows.every(r=>r.category===row.category));assert.equal(orders.summary.selectedCount,row.count)}
 const orders=await call({kind:'orders'});assert.equal(orders.total,21);assert.equal(orders.rows.length,20);assert.equal((await call({kind:'orders',offset:20})).rows.length,1);
 const encoded=orders.rows.find(r=>r.rawRejectionReason?.includes('&#40;'));assert(encoded);assert.doesNotMatch(encoded.rejectionReason,/&#40;/);assert.match(encoded.rawRejectionReason,/&#40;/);
 assert.equal((await scalar('select count(*)::integer value from ar_collected_orders where remark like $1',['%&#40;%'])),7,'the raw database text is unchanged');
 const searched=await call({kind:'orders',query:'TEST-1'});assert.equal(searched.noteCount,21);assert(searched.rows.every(r=>r.orderNumber.includes('TEST-1')));
});

test('blocking grouping preserves denominator, statuses and source variant evidence',async()=>{
 const result=await call({kind:'blocking'});assert.equal(result.noteCount,24);assert.equal(result.rows.reduce((n,r)=>n+r.count,0),24);
 const recharge=result.rows.find(r=>r.reason==='最后充值日限额超过（限制30天）');assert.equal(recharge.count,21);assert.equal(recharge.sourceVariantCount,2);assert.equal(recharge.rejected,21);assert.match(recharge.sourceReason,/最后充值时间/);
 assert.equal(result.rows.find(r=>r.reason==='会员在限制的游戏类型中总的投注数').count,3);
});

test('helpers are not callable by anonymous/authenticated and existing RPC scope checks still reject foreign platforms',async()=>{
 for(const name of ['decode_note(text)','clean_note(text)','blocking_category(text)','blocking_details(text)','rejection_category(text,text)'])for(const role of ['anon','authenticated'])assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\') value',[role,'private.dashboard_admin_live_'+name]),false);
 await assert.rejects(()=>call({platform:'FOREIGN',kind:'orders'}),/scope_denied/);
});

test('snapshot-only rows use the same category and blocking normalization without fabricated orders',async()=>{
 const snapshot={note_field:'remark',totals:{reject:7},coverage:{unique_count:7},groups:[{reason_label:'&#40;IFSC Code Incorrect&#41; Check account',reject:3,count:3,success:0,other:0,operator_class:'manual'},{reason_label:'(IFSC Code Incorrect) Check account',reject:4,count:4,success:0,other:0,operator_class:'manual'}]};
 await db.query("insert into withdraw_reasons_daily values('IN','SYNTHETIC','2026-09-02','AR',$1,now())",[JSON.stringify(snapshot)]);
 const result=await call({date:'2026-09-02',kind:'categories'});assert.equal(result.rows.length,1);assert.equal(result.rows[0].count,7);assert.equal(result.canViewOrders,false);assert.equal((await call({date:'2026-09-02',kind:'orders'})).available,false);
});

function uiFixture(reasonData){
 let html='',page;const requests=[],E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const root={Intl,Date,document:{querySelector(){return null},getElementById(){return null}},HensemLiveFilters:{multi(){return ''}}};root.window=root;vm.createContext(root);vm.runInContext(source,root);
 const ctx={L:{catalogReady:true,catalog:[{country:'印度',name:'SYNTHETIC'}],country:'印度',from:'2026-09-01T00:00:00',to:'2026-09-01T23:59:59'},E,N:String,C:String,R:(n,d)=>d?String(n/d*100)+'%':'—',page:()=> 'auto_withdraw',box:(_,body)=>body,table:(headers,rows)=>'<table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table>',request:async q=>{requests.push(q);return reasonData},render(){html=page.render()}};
 page=root.HensemLiveWithdrawPages.create(ctx);page.state.data={country:'印度',rows:[{country:'印度',platform:'SYNTHETIC'}],totals:{},notes:[]};
 page.state.reason={...q,kind:'orders'};page.state.reasonData=reasonData;ctx.render();return {root,page,requests,html:()=>html,draw:ctx.render};
}

test('UI shows decoded escaped full remarks and never injects source HTML',()=>{
 const malicious='&#40;IFSC Code Incorrect&#41; '+ '&lt;img src=x onerror=alert(1)&gt;'+' Long content'.repeat(20);
 const h=uiFixture({available:true,source:'Synthetic',noteCount:1,total:1,rows:[{orderNumber:'TEST-1',category:'IFSC 错误（IFSC Code Incorrect）',rejectionReason:malicious}],summary:{totalRejected:1},coverage:{}});
 assert.match(h.html(),/\(IFSC Code Incorrect\)/);assert.match(h.html(),/&lt;img/);assert.doesNotMatch(h.html(),/<img|&amp;#40;/);
 h.root.withdrawReasonOriginal(malicious);assert.match(h.html(),/aria-label="驳回原文"/);assert.match(h.html(),/Long content Long content/);assert.doesNotMatch(h.html(),/<img/);
});

test('category drilldown sends the selected category key and preserves the full-data denominator',async()=>{
 const categoryKey='a'.repeat(32),h=uiFixture({available:true,source:'Synthetic',noteCount:100,total:1,canViewOrders:true,rows:[{categoryKey,category:'IFSC 错误（IFSC Code Incorrect）',sourceReason:'(IFSC Code Incorrect) Check',count:9}],summary:{totalRejected:100},coverage:{}});
 h.page.state.reason.kind='categories';h.draw();h.root.withdrawReasonDrill(0,'category');await new Promise(r=>setImmediate(r));
 assert.equal(h.requests[0].kind,'orders');assert.equal(h.requests[0].category,categoryKey);assert.equal(h.page.state.reason.category,categoryKey);assert.match(h.html(),/100 笔驳回订单/);
});


test('grouped blocking rules open an explicitly labeled full original sample',()=>{
 const original=lastDeposit(123,'5/1/2026');
 const h=uiFixture({available:true,source:'Synthetic',noteCount:8,total:1,rows:[{reason:'最后充值日限额超过',sourceReason:original,sourceVariantCount:2,count:8}],coverage:{collected:8}});
 h.page.state.reason.kind='blocking';h.draw();assert.match(h.html(),/已合并 2 种原文/);assert.match(h.html(),/>最后充值日限额超过<\/button>/);
 h.root.withdrawReasonOriginal(original,'自动出款拦截原文（代表样本）');assert.match(h.html(),/aria-label="自动出款拦截原文（代表样本）"/);assert.match(h.html(),/最后充值时间：5\/1\/2026/);
});


test('only actual values of complete known templates collapse; thresholds, comparators, families and extra rules survive',async()=>{
 const details=value=>scalar('select private.dashboard_admin_live_blocking_details($1) value',[value]);
 for(const amount of ['50000.00','20000','24000','25000','26000']){
  assert.deepEqual(await details('首存金额大于19999.00,首存金额: '+amount),{reason:'首存金额大于19999',threshold:'19999',actualField:'首存金额',actualValue:amount});
 }
 for(const [input,want]of [
  ['首存金额大于19999,首存金额:20000','首存金额大于19999'],
  ['首存金额大于20000,首存金额:25000','首存金额大于20000'],
  ['用户余额大于50000.00,用户余额:179927.54','用户余额大于50000'],
  ['用户余额大于50000,用户余额:200000','用户余额大于50000'],
  ['用户余额大于60000,用户余额:200000','用户余额大于60000'],
  ['首存金额大于50000,首存金额:179927.54','首存金额大于50000'],
  ['当日盈利金额大于50000,当日盈利:179927.54','当日盈利金额大于50000'],
  ['首存金额小于19999,首存金额:20000','首存金额小于19999'],
  ['首存金额大于等于19999,首存金额:20000','首存金额大于等于19999'],
  ['当日盈利金额大于19999.00,当日盈利:20000','当日盈利金额大于19999'],
  ['当日盈利金额大于{金额},当日盈利:20000','当日盈利金额大于{金额}'],
  ['累计提款次数不能小于3次,当前累计提现次数:0次','累计提款次数不能小于3次'],
  ['累计提款次数不能小于5次,当前累计提现次数:0次','累计提款次数不能小于5次']
 ])assert.equal(await blocking(input),want);
 assert.deepEqual(await details('用户余额大于50000.00,用户余额:179927.54'),{reason:'用户余额大于50000',actualValue:'179927.54',actualField:'用户余额',threshold:'50000'});
 const unknown=['用户余额大于50000,首存金额:179927.54','首存金额大于50000,用户余额:179927.54','余额大于19999,首存金额:25000','首存金额大于19999,会员ID:25000','首存金额大于19999,首存金额:25000,错误码501','首存金额大于19999,首存金额:25000；其他规则需人工','首存金额大于19999,首存金额:-20000','首存金额大于19999,首存金额:2.5万','银行失败501','银行失败503','首存金额大于19999但未生效','累计提款次数可以小于3次,当前累计提现次数:0次'];
 for(const value of unknown)assert.deepEqual(await details(value),{reason:value,threshold:null,actualField:null,actualValue:null});
 const foreignLast=lastDeposit(80,'5/1/2026').replace('最后充值时间：5/1/2026','最后充值时间：用户ID12345');assert.equal(await blocking(foreignLast),text.cleanNote(foreignLast).replace(/\s+/g,' ').trim());
});

test('blocking rule orders and all source variants share one canonical key across every status and preserve all 22 source rows',async()=>{
 const amounts=['50000.00','20000','24000','25000','26000','30000','40000'];const counts=[4,4,3,3,3,3,2];
 for(let i=0;i<amounts.length;i++)for(let j=0;j<counts[i];j++)await db.query("insert into ar_collected_orders values('AR','IN','SYNTHETIC','withdraw',$1,100,$2,'operator-a','2026-09-03 12:00','2026-09-03 12:01',$3,'Unrelated rejection field','',now())",['RULE-'+i+'-'+j,['已支付','未通过','待审核'][i%3],'首存金额大于19999.00,首存金额: '+amounts[i]]);
 await db.exec("insert into ar_collected_orders values('AR','IN','SYNTHETIC','withdraw','RULE-OTHER',100,'未通过','operator-a','2026-09-03 12:00','2026-09-03 12:01','首存金额大于29999.00,首存金额: 50000',null,'',now()),('AR','IN','FOREIGN','withdraw','FOREIGN',100,'未通过','other','2026-09-03 12:00','2026-09-03 12:01','首存金额大于19999.00,首存金额: 50000',null,'',now())");
 const aggregate=await call({date:'2026-09-03',kind:'blocking'});assert.equal(aggregate.total,2);assert.equal(aggregate.noteCount,23);assert.equal(aggregate.canViewBlockingOrders,true);
 const rule=aggregate.rows.find(r=>r.reason==='首存金额大于19999');assert.equal(rule.count,22);assert.equal(rule.sourceVariantCount,7);assert.equal(rule.success+rule.rejected+rule.other,22);
 const variants=await call({date:'2026-09-03',kind:'blockingVariants',reasonKey:rule.reasonKey});assert.equal(variants.total,7);assert.equal(variants.rows.reduce((n,r)=>n+r.count,0),22);assert.equal(variants.noteCount,23);
 assert(variants.rows.every(r=>r.reasonKey===rule.reasonKey&&r.canonicalReason===rule.reason&&r.sourceReason===r.reason));assert(variants.rows.some(r=>r.sourceReason.endsWith('50000.00')&&r.count===4));
 const orders=await call({date:'2026-09-03',kind:'blockingOrders',reasonKey:rule.reasonKey});assert.equal(orders.total,22);assert.equal(orders.rows.length,20);assert.equal(orders.summary.selectedCount,22);assert.equal(orders.noteCount,23);
 const second=await call({date:'2026-09-03',kind:'blockingOrders',reasonKey:rule.reasonKey,offset:20});assert.equal(second.rows.length,2);const all=[...orders.rows,...second.rows];assert.equal(new Set(all.map(r=>r.orderNumber)).size,22);assert.equal(new Set(all.map(r=>r.status)).size,3);
 for(const row of all){assert.equal(row.blockingReason,rule.reason);assert.equal(row.blockingThreshold,'19999');assert.equal(row.blockingActualField,'首存金额');assert(amounts.includes(row.blockingActualValue));assert.match(row.rawManualRemark,/首存金额大于19999\.00/);assert.equal(row.rejectionReason,null)}
 assert.equal((await call({date:'2026-09-03',kind:'blockingOrders',reasonKey:rule.reasonKey,query:'RULE-0-'})).total,4);
 assert.equal(await scalar("select count(*)::integer value from ar_collected_orders where platform='SYNTHETIC' and applied_at::date='2026-09-03'"),23);
 for(const request of [{kind:'blockingOrders'},{kind:'blockingVariants'},{kind:'blockingVariants',reasonKey:rule.reasonKey,query:'RULE'},{kind:'blockingOrders',reasonKey:rule.reasonKey,category:'a'.repeat(32)},{kind:'blockingOrders',reasonKey:rule.reasonKey,operatorKey:'a'.repeat(32)}])await assert.rejects(()=>call({...request,date:'2026-09-03'}),/invalid_filter/);
 await assert.rejects(()=>call({kind:'blockingOrders',reasonKey:rule.reasonKey,platform:'FOREIGN'}),/scope_denied/);
});

test('snapshot variants retain every original and count, exclude automatic rows and never claim order IDs exist',async()=>{
 const note=amount=>'首存金额大于19999.00,首存金额: '+amount;
 const snapshot={note_field:'manual_remark',totals:{reject:3},groups:[
  {reason_label:note('20000'),count:4,success:1,reject:2,other:1,operator_class:'manual'},
  {reason_label:note('25000'),count:3,success:1,reject:1,other:1,operator_class:'manual'},
  {reason_label:note('25000'),count:2,success:0,reject:0,other:2,operator_class:'unknown'},
  {reason_label:note('50000'),count:20,success:20,reject:0,other:0,operator_class:'auto'}]};
 await db.query("insert into withdraw_reasons_daily values('IN','SYNTHETIC','2026-09-04','AR',$1,now())",[JSON.stringify(snapshot)]);
 const grouped=await call({date:'2026-09-04',kind:'blocking'});assert.equal(grouped.rows.length,1);assert.equal(grouped.rows[0].count,9);assert.equal(grouped.rows[0].sourceVariantCount,2);assert.equal(grouped.canViewBlockingOrders,false);
 const variants=await call({date:'2026-09-04',kind:'blockingVariants',reasonKey:grouped.rows[0].reasonKey});assert.equal(variants.total,2);assert.deepEqual(variants.rows.map(r=>r.count),[5,4]);assert.equal(variants.rows.reduce((n,r)=>n+r.success+r.rejected+r.other,0),9);assert.equal(variants.rows[0].canonicalReason,'首存金额大于19999');
 const detail=await call({date:'2026-09-04',kind:'blockingOrders',reasonKey:grouped.rows[0].reasonKey});assert.equal(detail.available,false);assert.equal(detail.canViewBlockingOrders,false);assert.deepEqual(detail.rows,[]);assert.match(detail.message,/没有逐笔订单编号/);
 const unchanged=await scalar("select snapshot value from withdraw_reasons_daily where stat_date='2026-09-04'");assert.deepEqual(unchanged,snapshot);
});

test('PANDA raw variants retain the existing grouped-view category instead of reverting source-specific grouping',async()=>{
 const snapshot={note_field:'source_note',groups:[{reason_label:'PANDA synthetic actual 100',count:2,success:1,reject:1,other:0,operator_class:'manual'},{reason_label:'PANDA synthetic actual 200',count:3,success:1,reject:1,other:1,operator_class:'manual'}]};
 await db.query("insert into withdraw_reasons_daily values('IN','SYNTHETIC','2026-09-05','PANDA',$1,now())",[JSON.stringify(snapshot)]);
 await db.exec(`create or replace view withdraw_reasons_daily_grouped as select country_code,platform,stat_date,source_system,case when source_system='PANDA' then jsonb_set(snapshot,'{groups}','[{"reason_label":"PANDA established category","operator_class":"manual","variants":[{"reason_label":"PANDA synthetic actual 100","count":2},{"reason_label":"PANDA synthetic actual 200","count":3}],"count":5,"success":2,"reject":2,"other":1}]') else snapshot end snapshot,updated_at from withdraw_reasons_daily`);
 try{const grouped=await call({date:'2026-09-05',kind:'blocking'});assert.equal(grouped.rows.length,1);assert.equal(grouped.rows[0].reason,'PANDA established category');assert.equal(grouped.rows[0].count,5);const variants=await call({date:'2026-09-05',kind:'blockingVariants',reasonKey:grouped.rows[0].reasonKey});assert.equal(variants.total,2);assert.equal(variants.rows.reduce((n,r)=>n+r.count,0),5);assert(variants.rows.every(r=>r.reason.startsWith('PANDA synthetic actual')))}finally{await db.exec('create or replace view withdraw_reasons_daily_grouped as select * from withdraw_reasons_daily')}
});


test('the additive deployment is atomic, idempotent and matches canonical helpers/RPC without changing source rows',async()=>{
 const additive=fs.readFileSync(path.join(repo,'supabase/admin-live-withdraw-blocking-rules.sql'),'utf8');
 const canonical=fs.readFileSync(path.join(repo,'supabase/admin-live-withdraw-reasons.sql'),'utf8');
 const helper=patch.slice(patch.indexOf('-- Only complete, observed diagnostic templates'),patch.indexOf('create or replace function private.dashboard_admin_live_rejection_category('));
 const rpc=canonical.slice(canonical.indexOf('create or replace function private.dashboard_admin_live_withdraw_reasons('),canonical.lastIndexOf('notify pgrst'));
 assert(additive.includes(helper));assert(additive.includes(rpc));assert.doesNotMatch(additive,/\b(?:update|delete\s+from|insert\s+into|drop\s+(?:table|view))\b/i);
 const before=await call({date:'2026-09-03',kind:'blocking'});const rows=await scalar('select count(*)::integer value from ar_collected_orders');
 await db.exec(additive);await db.exec(additive);assert.deepEqual(await call({date:'2026-09-03',kind:'blocking'}),before);assert.equal(await scalar('select count(*)::integer value from ar_collected_orders'),rows);
 assert.equal(await scalar("select has_function_privilege('anon','public.dashboard_admin_live_withdraw_reasons(jsonb)','execute') value"),false);
 for(const role of ['anon','authenticated'])assert.equal(await scalar('select has_function_privilege($1,\'private.dashboard_admin_live_blocking_details(text)\',\'execute\') value',[role]),false);
});

const financialDifference=(actual='-0.25',limit='500.00',suffix='')=>`充提差负盈利金额小于${limit},当前充提差负盈利金额：${actual},不能自动出款,(用户充值总额：800.00,历史提现总额:700.00,待处理金额：100.00,用户余额:0.25)${suffix}`;
const turnoverAfter=(actual='2.5282115869017632241813602015',limit='3.00')=>`打码倍数小于${limit},不能自动出款,上次提现后的有效投注(sumLotteryAmount)：100.00,上次提现后的成功充值总额：40.00,当前用户打码倍数(userBetTurnoverMultiple)：${actual}`;
const turnoverLast=(actual='2.50',limit='3.00')=>`打码倍数小于${limit},不能自动出款,最后投注统计(sumLotteryAmount)：100.00,最后一笔实际支付金额:40.00,当前用户打码倍数(userBetTurnoverMultiple)：${actual},不能自动出款`;
test('financial difference diagnostics merge actual amounts only, retaining threshold and signed actual value',async()=>{
 const details=value=>scalar('select private.dashboard_admin_live_blocking_details($1) value',[value]);
 for(const actual of ['-0.03','-0.28','0.00','0.21','+0.25','-12.123456789012345678901234567890']){
  assert.deepEqual(await details(financialDifference(actual)),{reason:'充提差负盈利金额小于500，不能自动出款',threshold:'500',actualField:'当前充提差负盈利金额',actualValue:actual});
 }
 assert.equal(await blocking(financialDifference('-0.25','500')),'充提差负盈利金额小于500，不能自动出款');
 assert.equal(await blocking(financialDifference('-0.25','1000')),'充提差负盈利金额小于1000，不能自动出款');
 assert.equal(await blocking(financialDifference().replace('金额小于','金额小于等于')),'充提差负盈利金额小于等于500，不能自动出款');
 assert.equal(await blocking('充提差负盈利金额小于500.00...\n\n'+financialDifference()),'充提差负盈利金额小于500，不能自动出款');
 for(const value of [financialDifference('-0.25','500.00','；会员备注需人工'),financialDifference().replace('待处理金额','提款次数'),financialDifference().replace('负盈利金额：','正盈利金额：'),financialDifference().slice(0,-1),financialDifference().replace('不能自动出款','可以自动出款'),financialDifference().replace('500.00','-500.00'),financialDifference('0.'+'1'.repeat(41)),financialDifference('1'.repeat(25)),financialDifference('1'.repeat(4096))]){
  assert.deepEqual(await details(value),{reason:value,threshold:null,actualField:null,actualValue:null});
 }
});

test('turnover windows, limit comparators and pass outcomes stay distinct while exact diagnostic amounts collapse',async()=>{
 const details=value=>scalar('select private.dashboard_admin_live_blocking_details($1) value',[value]);
 assert.deepEqual(await details(turnoverAfter()),{reason:'上次提现后打码倍数小于3，不能自动出款',threshold:'3',actualField:'当前用户打码倍数',actualValue:'2.5282115869017632241813602015'});
 assert.equal(await blocking(turnoverAfter('0.00')),'上次提现后打码倍数小于3，不能自动出款');
 assert.equal(await blocking(turnoverLast()),'最后一笔充值打码倍数小于3，不能自动出款');
 assert.equal(await blocking(turnoverLast('0.2','5')),'最后一笔充值打码倍数小于5，不能自动出款');
 assert.notEqual(await blocking(turnoverAfter()),await blocking(turnoverLast()));
 assert.equal(await blocking('打码倍数校验通过@2026-09-30 10:05:02.123(倍数4.25≥3.00,有效投注425.00,充值100.00)'),'打码倍数校验通过（倍数≥3）');
 assert.equal(await blocking('打码倍数校验通过@2026-09-30 10:05:02(倍数5.10>3.00,有效投注510.00,充值100.00)'),'打码倍数校验通过（倍数>3）');
 assert.equal(await blocking('打码倍数0.20小于3.00,充提差负盈利金额125.00大于100.00,按充提差负盈利放行'),'打码倍数小于3，充提差负盈利金额大于100，按充提差负盈利放行');
 assert.equal(await blocking('打码倍数1.20小于等于3.00,充提差负盈利金额160.00大于100.00,按充提差负盈利放行'),'打码倍数小于等于3，充提差负盈利金额大于100，按充提差负盈利放行');
 assert.equal(await blocking('打码倍数10.25大于3.00(累计打码量1025.00/需要打码量100.00)'),'打码倍数大于3（累计打码量 / 需要打码量）');
 for(const value of [turnoverAfter()+'；另一条规则',turnoverLast().replace('最后一笔实际支付金额','会员ID'),turnoverAfter().replace('2.5282115869017632241813602015','2.5万'),'打码倍数校验通过@2026-09-30(倍数4≥3,有效投注400,充值100)']){
  assert.equal(await blocking(value),value);
 }
});

test('manual deposit templates preserve day window and bonus distinction and reject mismatched diagnostic fields',async()=>{
 assert.deepEqual(await scalar('select private.dashboard_admin_live_blocking_details($1) value',['3日内人工充值彩金金额大于1000.00,3日内人工充值彩金金额：1250.00']),{reason:'3日内人工充值彩金金额大于1000',threshold:'1000',actualField:'3日内人工充值彩金金额',actualValue:'1250.00'});
 for(const [value,expected]of [
  ['3日内人工充值彩金金额大于1000.00,3日内人工充值彩金金额：1250.00','3日内人工充值彩金金额大于1000'],
  ['7日内人工充值彩金金额大于1000.00,7日内人工充值彩金金额：1750.00','7日内人工充值彩金金额大于1000'],
  ['3日内人工充值金额大于1000.00,3日内人工充值金额：1250.00','3日内人工充值金额大于1000'],
  ['3日内人工充值金额小于等于1000.00,3日内人工充值金额：125.00','3日内人工充值金额小于等于1000']])assert.equal(await blocking(value),expected);
 for(const value of ['3日内人工充值彩金金额大于1000.00,7日内人工充值彩金金额：1250.00','3日内人工充值彩金金额大于1000.00,3日内人工充值金额：1250.00','3日内人工充值金额大于1000.00,3日内人工充值金额：1250.00,错误码501'])assert.equal(await blocking(value),value);
});

test('known source-validation diagnostics group only their verified numeric payload without swallowing other failures',async()=>{
 const heading='存在单号为空、缺少完成时间或实付金额、备份表重复或主备表不一致的成功充值单,无法核对打码倍数,不能自动出款';
 for(const value of ['100001','100001,100002','100001,100002等25笔','123456789012345678901234567890'])assert.equal(await blocking(heading+',单号：'+value),heading);
 for(const value of [heading+',单号：100001；银行不支持',heading+',单号：ABC-10'])assert.equal(await blocking(value),value);
 const coverage='打码统计源无法覆盖上次提现后的完整周期,无法核对打码倍数,不能自动出款';
 assert.equal(await blocking(coverage+',上次提现后的成功充值总额：1250.00'),coverage);
 assert.equal(await blocking(coverage+',上次提现后的成功充值总额：1250.00,错误码501'),coverage+',上次提现后的成功充值总额：1250.00,错误码501');
});

test('diagnostic groups conserve original variants, manual statuses and complete order amounts in drilldown',async()=>{
 const notes=[financialDifference('-0.03'),financialDifference('-0.28'),financialDifference('0.00'),financialDifference('-0.03','1000'),turnoverAfter()];
 for(let i=0;i<notes.length;i++)await db.query("insert into ar_collected_orders values('AR','IN','SYNTHETIC','withdraw',$1,$2,$3,'operator-a','2026-09-06 12:00','2026-09-06 12:01',$4,null,'',now())",['DIAG-'+i,100+i,['已支付','未通过','待审核','已支付','未通过'][i],notes[i]]);
 const result=await call({date:'2026-09-06',kind:'blocking'});assert.equal(result.noteCount,5);assert.equal(result.total,3);assert.equal(result.rows.reduce((n,r)=>n+r.count,0),5);
 const rule=result.rows.find(r=>r.reason==='充提差负盈利金额小于500，不能自动出款');assert.equal(rule.count,3);assert.equal(rule.sourceVariantCount,3);assert.deepEqual([rule.success,rule.rejected,rule.other],[1,1,1]);
 const variants=await call({date:'2026-09-06',kind:'blockingVariants',reasonKey:rule.reasonKey});assert.equal(variants.total,3);assert.deepEqual(new Set(variants.rows.map(r=>r.sourceReason)),new Set(notes.slice(0,3)));
 const orders=await call({date:'2026-09-06',kind:'blockingOrders',reasonKey:rule.reasonKey});assert.equal(orders.total,3);assert.deepEqual(new Set(orders.rows.map(r=>r.rawManualRemark)),new Set(notes.slice(0,3)));assert.deepEqual(new Set(orders.rows.map(r=>r.blockingActualValue)),new Set(['-0.03','-0.28','0.00']));
 assert.deepEqual(orders.rows.map(r=>r.amount).sort((a,b)=>a-b),[100,101,102]);assert(orders.rows.every(r=>r.blockingThreshold==='500'));
});

test('latest diagnostic migration installs exactly the canonical helpers, keeps ACL private and is safe to repeat',async()=>{
 const migration=fs.readFileSync(path.join(repo,'supabase/migrations/20261001080037_withdraw_reason_compact_evaluation.sql'),'utf8');
 const helper=patch.slice(patch.indexOf('-- Only complete, observed diagnostic templates'),patch.indexOf('create or replace function private.dashboard_admin_live_rejection_category('));
 assert(migration.includes(helper));assert.doesNotMatch(migration,/\b(?:update|delete\s+from|insert\s+into|drop\s+(?:table|view))\b/i);
 const before=await call({date:'2026-09-06',kind:'blocking'});await db.exec(helper);await db.exec(helper);assert.deepEqual(await call({date:'2026-09-06',kind:'blocking'}),before);
 for(const name of ['blocking_category(text)','blocking_details(text)','blocking_details_cleaned(text)'])for(const role of ['anon','authenticated'])assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\') value',[role,'private.dashboard_admin_live_'+name]),false);
});


test('raw wrapper and already-clean core normalize exactly once, including non-idempotent nested entities',async()=>{
 const detail=value=>scalar('select private.dashboard_admin_live_blocking_details($1) value',[value]);
 const core=value=>scalar('select private.dashboard_admin_live_blocking_details_cleaned($1) value',[value]);
 for(const value of [financialDifference(), '充提差负盈利金额小于500.00...\n\n'+financialDifference(),'首存金额大于100.00,首存金额&#58;200.00','&amp;amp;amp;amp;#65;']){
  assert.deepEqual(await detail(value),await core(await clean(value)));
 }
 const raw='&amp;amp;amp;amp;#65;';const once=await clean(raw);assert.notEqual(once,await clean(once));
 assert.equal((await core(once)).reason,once);assert.equal((await detail(raw)).reason,once);
});
