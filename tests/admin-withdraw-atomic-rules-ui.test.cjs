// Synthetic UI/API behavior only: no production queries or order data.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const req=require('node:module').createRequire(__filename);
function harness(file){const module={exports:{}},filename=path.join(__dirname,file);vm.runInNewContext(fs.readFileSync(filename,'utf8')+'\nmodule.exports={fixture};',{module,require:name=>name==='node:test'?()=>{}:req(name),__dirname,setImmediate,setTimeout,clearTimeout,AbortController,URL},{filename});return module.exports.fixture;}
const groupedFixture=harness('admin-withdraw-blocking-group-ui.test.cjs'),lifecycle=harness('admin-withdraw-reason-lifecycle.test.cjs'),teamFixture=harness('admin-withdraw-team-reuse.test.cjs');
const settle=async()=>{for(let n=0;n<5;n++)await new Promise(setImmediate);};
const clone=x=>JSON.parse(JSON.stringify(x)),key=char=>char.repeat(32);
const atomic=(patch={})=>({available:true,source:'synthetic',reasonGrouping:'atomic_rules_v1',noteCount:3,total:3,updatedAt:'2026-10-23T00:00:00Z',canViewBlockingOrders:true,coverage:{complete:false,collected:5},summary:{operatorCounts:{manual:3,system:2,total:5},ruleMembership:{unit:'distinct_order_per_rule',overlapping:true,hitCount:5}},rows:[{reason:'规则 A',reasonKey:key('a'),count:2,sourceVariantCount:2},{reason:'规则 B',reasonKey:key('b'),count:2},{reason:'规则 C',reasonKey:key('c'),count:1}],...patch});
const legacy=(patch={})=>{const x=atomic(patch);delete x.reasonGrouping;delete x.summary.ruleMembership;return x;};
const lastComplete=data=>({...data,publication:{contract:'withdraw-reasons-last-complete-v1',status:'ready',servedLastComplete:true,freshness:'refresh_due',computedAt:'2026-10-23T00:01:00Z',updatedAt:data.updatedAt,refreshState:'queued'}});
test('overlapping A+B/A+C/B retains three manual orders and server rule pagination',()=>{
 const data=atomic(),before=clone(data),h=groupedFixture(data);
 assert.match(h.html(),/自动出款拦截分类\|命中笔数\|占人工处理记录/);assert.match(h.html(),/人工总数<\/span><strong>3<\/strong>/);
 assert.match(h.html(),/同一订单在同一规则只计一次/);assert.match(h.html(),/一单可命中多条规则/);assert.match(h.html(),/占比合计可超过 100%/);
 assert.match(h.html(),/66\.67%/);assert.match(h.html(),/33\.33%/);assert.match(h.html(),/共 3 条/);assert.deepEqual(data,before);assert.equal(h.page.state.data.totals.total,undefined);
});
test('legacy server remains usable before backend cutover without atomic claims',()=>{const h=groupedFixture(legacy());assert.match(h.html(),/自动出款拦截分类\|笔数\|占人工处理记录/);assert.doesNotMatch(h.html(),/data-withdraw-rule-grouping|同一订单在同一规则|命中笔数/);});
test('source count expansion does not claim per-order de-duplication or source completeness',()=>{
 const data=atomic({canViewBlockingOrders:false,summary:{operatorCounts:{manual:null,total:null},ruleMembership:{unit:'source_group_count_per_rule',overlapping:true,hitCount:5}}}),h=groupedFixture(data);
 assert.match(h.html(),/来源未提供逐笔去重证明/);assert.doesNotMatch(h.html(),/同一订单在同一规则只计一次/);assert.match(h.html(),/无法还原逐笔订单/);assert.equal(h.page.state.reasonData.coverage.complete,false);
});
test('full combinations and selected-rule actual/threshold survive both drilldown views',async()=>{
 const original='1.规则 A 实际12大于阈值10;2.规则 B 实际6小于阈值8',data=atomic(),h=groupedFixture(q=>q.kind==='blockingVariants'?atomic({total:2,rows:[{canonicalReason:'规则 A',sourceReason:original,count:1,success:1,rejected:0,other:0},{canonicalReason:'规则 A',sourceReason:'规则 A；规则 C',count:1,success:0,rejected:1,other:0}]}):q.kind==='blockingOrders'?atomic({total:2,rows:[{orderNumber:'SYNTHETIC-A-B',amount:110,rawManualRemark:original,blockingReason:'规则 A',blockingThreshold:'10',blockingActualField:'A实际',blockingActualValue:'12',status:'已通过'}]}):data);
 h.root.withdrawBlockingDrill(0,'blockingVariants');await settle();assert.equal(h.calls.at(-1).reasonKey,key('a'));assert.match(h.html(),/规则 A；规则 C/);
 h.root.withdrawReasonOriginal(original,'自动出款拦截原文');assert.match(h.html(),/1\.规则 A 实际12大于阈值10;2\.规则 B 实际6小于阈值8/);
 h.root.withdrawBlockingView('blockingOrders');await settle();assert.match(h.html(),/A实际：12/);assert.match(h.html(),/>10<\/td>/);assert.match(h.html(),/SYNTHETIC-A-B/);
 assert(h.calls.every(q=>Object.keys(q).every(k=>['action','country','platform','date','kind','reasonKey','offset','limit'].includes(k))));
});
test('source-only modes and rejection grouping retain their original presentation',()=>{
 for(const patch of [{sourceNoteFormat:'duoli_withdraw_source_notes_v1'},{sourceNoteFormat:'game66_withdraw_notes_v1'},{sourceNoteFormat:'lg_business_notes_v1'},{sourceNoteFormat:'yash_withdraw_notes_v1'}]){const h=groupedFixture(legacy(patch));assert.doesNotMatch(h.html(),/data-withdraw-rule-grouping|同一订单在同一规则/);}
 const h=groupedFixture(atomic());h.page.state.reason.kind='categories';h.draw();assert.match(h.html(),/全部 3 笔驳回订单/);assert.doesNotMatch(h.html(),/data-withdraw-rule-grouping|命中笔数/);
});
test('atomic observation clears combination cache and resets a legacy selected key once',async()=>{
 const h=lifecycle();h.open();h.reply(0,legacy());await settle();h.ctx.withdrawBlockingDrill(0,'blockingVariants');assert.equal(h.calls[1].q.reasonKey,key('a'));
 h.reply(1,atomic({total:0,rows:[]}));await settle();assert.equal(h.calls.length,3);assert.equal(h.calls[2].q.kind,'blocking');assert.equal(h.calls[2].q.reasonKey,undefined);assert.equal(h.api.state.reasonData,null);
 h.reply(2,atomic());await settle();assert.equal(h.api.state.reasonData.total,3);h.ctx.withdrawReasonClose();h.open();assert.equal(h.calls.length,3);assert.equal(h.api.state.reasonData.reasonGrouping,'atomic_rules_v1');
});
test('atomic observation evicts cached variants and orders from the same full scope',async()=>{
 const h=lifecycle();h.open();h.reply(0,legacy());await settle();h.ctx.withdrawBlockingDrill(0,'blockingVariants');h.reply(1,legacy());await settle();h.ctx.withdrawBlockingView('blockingOrders');h.reply(2,legacy());await settle();
 h.ctx.withdrawReasonKind('blocking');assert.equal(h.calls.length,3);const refresh=h.ctx.withdrawReasonRetry();h.reply(3,atomic());await refresh;
 h.ctx.withdrawBlockingDrill(0,'blockingVariants');assert.equal(h.calls.length,5);h.reply(4,atomic());await settle();h.ctx.withdrawBlockingView('blockingOrders');assert.equal(h.calls.length,6);h.reply(5,atomic());await settle();assert.equal(h.api.state.reasonData.reasonGrouping,'atomic_rules_v1');
});
test('known atomic scope refuses legacy last-complete without downgrade or cache admission',async()=>{
 const h=lifecycle();h.open();h.reply(0,atomic());await settle();const refresh=h.ctx.withdrawReasonRetry();h.reply(1,lastComplete(legacy()));await refresh;
 assert.equal(h.api.state.reasonData,null);assert.match(h.api.state.reasonError,/旧组合统计不再展示/);assert.doesNotMatch(h.html(),/withdraw-reason-summary|data-withdraw-reason-publication/);
 const retry=h.ctx.withdrawReasonRetry();assert.equal(h.calls.length,3);h.reply(2,atomic());await retry;assert.equal(h.api.state.reasonData.coverage.complete,false);
});
test('atomic last-complete keeps its true as-of and does not enter the ordinary cache',async()=>{
 const h=lifecycle();h.open();h.reply(0,lastComplete(atomic()));await settle();assert.match(h.html(),/上次完整统计/);assert.match(h.html(),/2026-10-23 00:00:00Z/);assert.match(h.html(),/data-withdraw-rule-grouping/);h.ctx.withdrawReasonClose();h.open();assert.equal(h.calls.length,2);
});
test('restoring an old drawer cannot restore combination rows or its pagination snapshot',async()=>{
 const h=lifecycle();h.open();h.reply(0,legacy());await settle();const saved=h.api.capture();const refresh=h.ctx.withdrawReasonRetry();h.reply(1,atomic());await refresh;
 h.api.restore(saved);h.ctx.withdrawReasonOriginalClose();assert.match(h.html(),/旧组合或无效统计不再展示/);assert.doesNotMatch(h.html(),/withdraw-reason-summary/);
 h.ctx.withdrawReasonSize(50);assert.equal(h.calls.length,3);h.reply(2,atomic());await settle();assert.equal(h.api.state.reasonData.reasonGrouping,'atomic_rules_v1');
});
test('atomic scope does not reinterpret a different date or platform',async()=>{
 const h=lifecycle();h.open();h.reply(0,atomic());await settle();h.ctx.withdrawReasonDate('2026-10-10');h.reply(1,legacy());await settle();assert.equal(h.api.state.reasonError,'');assert.equal(h.api.state.reasonData.reasonGrouping,undefined);
 h.ctx.withdrawReasons(1);h.reply(2,legacy());await settle();assert.equal(h.api.state.reasonError,'');assert.equal(h.calls[2].q.platform,'OTHER');
});
test('late cancelled or authority-stale atomic replies cannot mark or overwrite a new legacy scope',async()=>{
 for(const drift of [h=>h.ctx.withdrawReasonClose(),h=>h.api.pause(),h=>h.L.successTo='2026-10-12T23:59:59',h=>h.ctx.hensemDataScope={identity:'another-user'}]){
  const h=lifecycle();h.open();drift(h);h.reply(0,atomic());await settle();assert.equal(h.api.state.reasonData,null);h.api.state.data={rows:[{country:'巴西',platform:'SYNTHETIC'}],totals:{},notes:[]};h.open();h.reply(1,legacy());await settle();assert.equal(h.api.state.reasonError,'');assert.equal(h.api.state.reasonData.reasonGrouping,undefined);
 }
});
test('malformed atomic metadata stops once without misleading zero or automatic retry',async()=>{
 for(const patch of [{reasonGrouping:'future_rules_v2'},{summary:{}},{summary:{ruleMembership:{unit:'distinct_order_per_rule',overlapping:false,hitCount:5}}},{summary:{ruleMembership:{unit:'distinct_order_per_rule',overlapping:true,hitCount:-1}}}]){const h=lifecycle();h.open();h.reply(0,atomic(patch));await settle();assert.equal(h.calls.length,1);assert.equal(h.api.state.reasonData,null);assert.match(h.api.state.reasonError,/规则统计信息无效/);}
});
test('exact reads deduplicate while changed view cancels and excludes late replies',async()=>{
 const h=lifecycle();h.open();h.open();assert.equal(h.calls.length,1);h.reply(0,atomic());await settle();h.ctx.withdrawBlockingDrill(0,'blockingVariants');h.ctx.withdrawReasonKind('blocking');h.ctx.withdrawBlockingDrill(1,'blockingOrders');
 assert.equal(h.calls[1].options.signal.aborted,true);h.reply(2,atomic({rows:[{orderNumber:'CURRENT'}]}));await settle();h.reply(1,legacy());await settle();assert.equal(h.api.state.reasonData.rows[0].orderNumber,'CURRENT');assert.equal(h.api.state.reasonError,'');
});
test('the existing CSV exporter includes overlapping rule meaning and the unchanged manual denominator',async()=>{
 const h=teamFixture();await h.page.load();const baseline=clone(h.page.exportMeta());h.page.state.reason={country:'印度',platform:'M0',date:'2026-10-17',kind:'blocking'};h.page.state.reasonData=atomic();
 const src=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8'),start=src.indexOf(' function exportCurrentTable()'),end=src.indexOf('\n  let initialLoad=',start);assert(start>=0&&end>start);
 let csv='',clicked=0;const table=values=>({querySelectorAll:()=>values.map(row=>({cells:row.map(innerText=>({innerText}))}))});
 const context={withdrawPages:h.page,state:{page:'auto_withdraw'},L:{},document:{getElementById:()=>({querySelectorAll:()=>[table([['总提现笔数'],['5']]),table([['自动出款拦截分类','命中笔数'],['规则 A','2'],['规则 B','2'],['规则 C','1']])]}),createElement:()=>({click:()=>clicked++})},Blob:class{constructor(parts){csv=parts.join('');}},URL:{createObjectURL:()=> 'blob:synthetic',revokeObjectURL(){}},setTimeout:()=>0,toast(){},isDailyComparison:()=>false,statisticWindowsEnabled:()=>false,isSuccessAnalysis:()=>false,canExportCurrentPage:()=>true,isSupervisorPage:()=>false,isChannelStatus:()=>false,successBasisNote:()=>''};
 vm.runInNewContext(src.slice(start,end)+';exportCurrentTable();',context);assert.equal(clicked,1);assert.match(csv,/原因规则命中口径/);assert.match(csv,/原因占比分母","3"/);assert.match(csv,/命中笔数/);assert.match(csv,/不能相加作为人工总数/);assert.match(csv,/总提现笔数/);
 h.page.state.reasonData=legacy();assert.deepEqual(clone(h.page.exportMeta()),baseline);h.page.state.reason=null;assert.deepEqual(clone(h.page.exportMeta()),baseline);
});
test('empty atomic result is a valid zero; unavailable response keeps its distinct message without retry',async()=>{
 const h=lifecycle();h.open();h.reply(0,atomic());await settle();let refresh=h.ctx.withdrawReasonRetry();h.reply(1,atomic({noteCount:0,total:0,rows:[],summary:{operatorCounts:{manual:0,total:0},ruleMembership:{unit:'distinct_order_per_rule',overlapping:true,hitCount:0}}}));await refresh;
 assert.equal(h.api.state.reasonData.noteCount,0);assert.equal(h.api.state.reasonError,'');assert.match(h.html(),/当前条件下没有人工处理记录/);
 refresh=h.ctx.withdrawReasonRetry();h.reply(2,{available:false,rows:null,total:null,message:'源备注暂未采集'});await refresh;assert.equal(h.api.state.reasonError,'');assert.match(h.html(),/源备注暂未采集/);assert.equal(h.calls.length,3);
});
test('current permission denial clears original caches and atomic selected state without an extra retry',async()=>{
 const h=lifecycle();h.open();h.reply(0,atomic());await settle();const refresh=h.ctx.withdrawReasonRetry();h.calls[1].reject(Object.assign(Error('role_permission_denied'),{code:'42501'}));await refresh;
 assert.equal(h.api.state.reasonData,null);assert.equal(h.api.state.data,null);assert.equal(h.calls.length,2);assert.match(h.api.state.error,/登录或查询权限已变化/);
 h.api.state.data={rows:[{country:'巴西',platform:'SYNTHETIC'}],totals:{},notes:[]};h.open();assert.equal(h.calls.length,3);h.reply(2,legacy());await settle();assert.equal(h.api.state.reasonError,'');
});
test('the original bounded preparation poll can finish as atomic without a new request flag',async()=>{
 const timers=new Map();let next=0;const h=lifecycle({prepare:ctx=>{ctx.setTimeout=(fn,ms)=>{timers.set(++next,{fn,ms});return next;};ctx.clearTimeout=id=>timers.delete(id);}});
 h.open();h.reply(0,{available:false,rows:null,total:null,summary:null,prepared:{contract:'withdraw-reasons-blocking-v1',status:'building',reason:'withdraw_reasons_preparing'}});await settle();assert.equal(h.calls.length,1);
 const poll=[...timers.entries()].find(([,t])=>t.ms===1500);assert(poll);timers.delete(poll[0]);poll[1].fn();await settle();assert.equal(h.calls.length,2);assert.deepEqual(clone(h.calls[0].q),clone(h.calls[1].q));h.reply(1,atomic());await settle();assert.equal(h.api.state.reasonData.reasonGrouping,'atomic_rules_v1');assert.equal(timers.size,0);assert.equal(h.api.state.reasonBusy,false);
});
test('semantic cutover spans main-window contexts without reusing data across those query scopes',async()=>{
 const h=lifecycle();h.open();h.reply(0,legacy());await settle();const saved=h.api.capture();h.ctx.withdrawReasonClose();const old=h.L.successTo;h.L.successTo='2026-10-12T23:59:59';
 h.open();assert.equal(h.calls.length,2,'full request context remains isolated');h.reply(1,atomic());await settle();h.L.successTo=old;h.api.restore(saved);h.ctx.withdrawReasonOriginalClose();
 assert.match(h.html(),/旧组合或无效统计不再展示/);h.ctx.withdrawReasonSize(50);assert.equal(h.calls.length,3);h.reply(2,atomic());await settle();assert.equal(h.api.state.reasonData.reasonGrouping,'atomic_rules_v1');
});
