// Synthetic authorized snapshots and callbacks only; no files, APIs or real IDs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-kyc-reconciliation.js'),'utf8');
const summary=()=>({exportRows:9,uniqueWorkorders:4,uniquePaymentOrders:3,uniquePaymentAmount:null,duplicateExportRows:5,multipleWorkorderPayments:1,processed:{count:2,amount:null},rejected:{count:1,amount:null},unprocessed:{count:1,amount:null},matchCounts:{exact_unique:1,exact_duplicate:0,amount_conflict:1,ambiguous_online:0,online_amount_missing:0,unmatched:1,platform_not_in_online_snapshot:0,missing_rc:0,source_conflict:0}});
const snapshot=(extra={})=>({summary:summary(),kycSummary:{connected:{count:2},disconnected:{count:1},unknown:{count:1}},rows:[{key:'synthetic-key',label:'Synthetic platform',...summary()}],total:45,offset:0,limit:20,currency:null,scopeLabel:'Synthetic authorized range',updatedAt:'2026-10-01T00:00:00Z',coverage:{complete:true,label:'已读合成范围'},options:{platforms:['Synthetic platform'],providers:['Synthetic original provider']},...extra});
function harness(options={}){const root={},listeners={},calls=[],details=[],explanations=[];let html='',renders=0,panel;vm.runInNewContext(source,{window:root,document:{addEventListener:(type,fn)=>listeners[type]=fn},fetch(){throw Error('renderer must not read the network')}});panel=root.HensemLiveKycReconciliation.create({id:'synthetic-kyc',onQuery:async q=>{calls.push(JSON.parse(JSON.stringify(q)));return options.handler?options.handler(q):snapshot({offset:q.offset,limit:q.limit,dimension:q.dimension})},onDetail:info=>details.push(info),onExplain:info=>explanations.push(info),onRender:()=>{renders++;html=panel.render()}});html=panel.render(options.snapshot||snapshot());const event=(type,method,args=[],value)=>{let prevented=0;const control={dataset:{krId:'synthetic-kyc',krAction:method,krArgs:JSON.stringify(args),krEvent:type,...(value!==undefined?{krValue:'true'}:{})},value,disabled:false};const result=listeners[type]({type,target:{closest:()=>control},preventDefault(){prevented++}});return {result,prevented}};return {root,panel,event,calls,details,explanations,html:()=>html,renders:()=>renders}}

test('KYC source categories, manual checks and online receipt declarations stay independent',async()=>{
 const row={id:'synthetic-order',platform:'Synthetic platform',paymentOrderId:'RC0000123',workOrderId:'000TICKET',kycStatus:'unknown',declaredFileKyc:'kyc',hasKycCategoryChange:true,manualKyc:'正确',manualUtr:'YES',utrState:'conflict',sourceWorkorderState:'已处理',onlineState:'已入款',sourceDepositState:'Paid',matchStatus:'exact_unique',receiptState:'unverified',amount:'0.00',currency:null,sourceUtr:'00001234',onlineUtr:'00004321'};
 const h=harness({handler:q=>snapshot({dimension:q.dimension,rows:[row]})});await h.panel.dispatch('dimension','orders');
 const html=h.html();for(const value of ['待核实','文件标签 kyc','同原单 KYC 分类有变化','人工 KYC：正确','人工：YES','匹配：不一致','已处理','已入款','原状态：Paid','精确匹配','到账待核实','币种未提供','原：有 · 在线：有'])assert(html.includes(value),value);
 assert.doesNotMatch(html,/00001234|00004321/,'the table shows presence, not raw UTR values');
 assert.doesNotMatch(html,/已核实入款|已核实未入款/);assert.equal(h.panel.getSnapshot().rows[0].kycStatus,'unknown');
});

test('counts keep export duplicates, workorders, payment orders, rejected and pending in distinct units',()=>{
 const h=harness(),html=h.html();for(const label of ['原始导出行','唯一工单','原支付订单（去重）','重复导出行','同付款多工单','已处理工单','已驳回工单','未处理工单'])assert(html.includes(label),label);
 assert.match(html,/50\.00%/);assert.match(html,/25\.00%/);assert.match(html,/不并入待处理/);assert.match(html,/工单处理状态，不代表本订单入款/);
 assert.doesNotMatch(html,/\bINR\b|\bUSDT\b/);assert.match(html,/币种待核实/);
 const unknown=h.panel.render(snapshot({summary:{uniqueWorkorders:null},kycSummary:{},rows:[{key:'unknown',label:'Unknown counts'}],coverage:{complete:false,label:'缺一部分来源'}}));assert.match(unknown,/<strong>—<\/strong>/);assert.match(unknown,/范围未完整/);assert.doesNotMatch(unknown,/缺一部分来源|Synthetic authorized range/);h.panel.dispatch('explain');assert.match(h.explanations.at(-1).text,/缺一部分来源/);assert.doesNotMatch(unknown,/<strong>0(?:<| )/);
 const zero=h.panel.render(snapshot({currency:'INR',summary:{...summary(),processed:{count:0,amount:'0.00'}}}));assert.match(zero,/>0<\/strong><small>0\.00 INR<\/small>/);
});

test('CSP-safe delegated filters preserve typed strings and make bounded reads only on explicit actions',async()=>{
 const h=harness();assert.equal(h.calls.length,0);assert.doesNotMatch(h.html(),/\bon(?:click|input|change|submit)=/);const renders=h.renders();
 h.event('input','filter',['query'],'000RC-A');h.event('change','filter',['processing'],'rejected');h.event('change','filter',['matchStatus'],'platform_not_in_online_snapshot');h.event('change','filter',['platform'],'Synthetic platform');
 assert.equal(h.calls.length,0);assert.equal(h.renders(),renders,'typing does not replace the focused input');
 const submitted=h.event('submit','query');assert.equal(submitted.prevented,1);await submitted.result;
 assert.equal(h.calls[0].query,'000RC-A');assert.equal(h.calls[0].processing,'rejected');assert.equal(h.calls[0].matchStatus,'platform_not_in_online_snapshot');assert.equal(h.calls[0].offset,0);assert.equal(h.calls[0].limit,20);
 await h.event('click','page',[2]).result;assert.equal(h.calls.at(-1).offset,20);await h.event('change','size',[],'50').result;assert.equal(h.calls.at(-1).limit,50);assert.equal(h.calls.at(-1).offset,0);
 const reads=h.calls.length;h.event('click','detail',[0]);assert.equal(h.calls.length,reads);assert.equal(h.details[0].key,'synthetic-key');h.event('click','explain');assert.equal(h.calls.length,reads);assert.match(h.explanations[0].text,/唯一匹配均不代表实际到账/);
});

test('all current matching outcomes remain selectable; unknown and snapshot-missing outcomes are not false zeroes',async()=>{
 const h=harness();for(const [key,label]of Object.entries({exact_unique:'精确匹配',exact_duplicate:'重复来源一致',amount_conflict:'金额冲突',ambiguous_online:'线上多条冲突',online_amount_missing:'线上缺金额',unmatched:'未找到',platform_not_in_online_snapshot:'当前快照无此平台',missing_rc:'缺原订单号',source_conflict:'源数据冲突'})){assert(h.html().includes(label),label);h.panel.filter('matchStatus',key);assert.equal(h.panel.getState().matchStatus,key)}
 h.panel.filter('matchStatus','platform_missing_online');assert.equal(h.panel.getState().matchStatus,'platform_not_in_online_snapshot');h.panel.filter('matchStatus','wrong');assert.equal(h.panel.getState().matchStatus,'platform_not_in_online_snapshot');
 const html=h.panel.render(snapshot({rows:[{key:'partial',label:'Partial',matchCounts:{exact_unique:0,unmatched:2}}]}));assert.match(html,/0 <small>精确匹配/);assert.match(html,/— 金额冲突/);assert.match(html,/— 快照无平台/);assert.doesNotMatch(html,/0 金额冲突|0 快照无平台/);
});

test('safe details preserve exact decimal and identifier text while escaping labels and keeping authorized scope',async()=>{
 const hostile='<img src=x onerror=alert(1)>',h=harness({snapshot:snapshot({rows:[{key:hostile,label:hostile,...summary()}],scopeLabel:hostile})});assert.match(h.html(),/&lt;img/);assert.doesNotMatch(h.html(),/<img|<script/);h.panel.filter('query','unsent-new-filter');h.panel.dispatch('detail',0);assert.equal(h.details[0].filters.query,'','detail opens the scope that produced the displayed row, not unsubmitted filters');assert.equal(h.details[0].key,hostile);
 const row={id:'synthetic',platform:hostile,paymentOrderId:'000000RC',workOrderId:'00000WORK',amount:'123456789012345678.90',currency:'INR',kycStatus:'connected',receiptState:'unknown'};h.panel.render(snapshot({dimension:'orders',rows:[row]}));const html=h.panel.render();assert.match(html,/123,456,789,012,345,678\.90 INR/);assert.match(html,/000000RC/);assert.doesNotMatch(html,/<img/);
});

test('latest request wins; reset cancels a pending result and invalid dates never call the backend',async()=>{
 let resolveOld;const h=harness({handler:q=>q.kycStatus==='connected'?new Promise(resolve=>resolveOld=resolve):snapshot({dimension:q.dimension,scopeLabel:'Latest synthetic scope'})});const old=h.panel.dispatch('category','connected');await h.panel.dispatch('category','unknown');resolveOld(snapshot({scopeLabel:'Stale scope'}));await old;assert.equal(h.panel.getSnapshot().scopeLabel,'Latest synthetic scope');
 const pending=h.panel.dispatch('category','connected');h.panel.dispatch('reset');resolveOld(snapshot({scopeLabel:'Late after reset'}));await pending;assert.equal(h.panel.getSnapshot(),null);assert.doesNotMatch(h.html(),/Late after reset/);
 h.panel.filter('from','2026-10-02');h.panel.filter('to','2026-10-01');const reads=h.calls.length;await h.panel.query();assert.equal(h.calls.length,reads);assert.match(h.html(),/开始日期不能晚于结束日期/);
});

test('unresolved processing states are visible without long prose and UTR presence never leaks comparison tokens',()=>{
 const h=harness({snapshot:snapshot({dimension:'orders',summary:{...summary(),unknownProcessing:{count:31}},scopeLabel:'Long authorized scope description',coverage:{complete:false,label:'Long incomplete source explanation'},rows:[{id:'synthetic-order',platform:'Synthetic platform',sourceUtrPresent:true,onlineUtrPresent:false,sourceUtr:'opaque-source-group',onlineUtr:'opaque-online-group',utrState:'online_missing',sourceWorkorderState:'状态冲突',receiptState:'unverified'}]})});
 const html=h.html();assert.match(html,/状态待核对 31/);assert.match(html,/范围未完整/);assert.match(html,/原：有 · 在线：无/);assert.match(html,/匹配：在线 UTR 缺失/);assert.match(html,/原单证据待核实/);assert.doesNotMatch(html,/opaque-|Long authorized|Long incomplete|仅比对|查看下方/);
 h.panel.dispatch('explain');assert.match(h.explanations[0].text,/Long authorized scope description/);assert.match(h.explanations[0].text,/Long incomplete source explanation/);assert.match(h.explanations[0].text,/31 个工单存在状态冲突或缺失/);
 h.panel.render(snapshot({dimension:'orders',rows:[{sourceUtrPresent:null,onlineUtr:'查看下方比对状态'}]}));assert.match(h.panel.render(),/原：待核实 · 在线：待核实/);
 const missing=h.panel.render(snapshot({summary:{...summary(),unknownProcessing:{count:null}}}));assert.doesNotMatch(missing,/状态待核对 0|状态待核对 —/);
});
