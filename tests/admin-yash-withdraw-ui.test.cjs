const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-withdraw-pages.js'),'utf8');
const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yash=(extra={})=>({country:'印度',platform:'YASH.BET',dataDate:'2026-10-08',total:100,success:80,rejected:5,autoCount:null,manualCount:null,unclassifiedCount:100,classificationAvailable:false,reasonAvailable:false,avgSeconds:60,durationSampleCount:80,durationTotalSeconds:4800,durationBasis:'created_to_completed',...extra});
function fixture(data,operators=false,respond){
 const tables=[],requests=[],root={Date,Intl,HensemLiveFilters:{multi:()=>''},document:{getElementById:()=>null,querySelector:()=>null}};root.window=root;
 vm.runInNewContext(source,root);
 const L={catalogReady:true,catalog:[{id:'yash',country:'印度',name:'YASH.BET',source:'kb',timezone:'Asia/Kolkata'}],country:'印度',from:'2026-10-08',to:'2026-10-08'};
 const page=root.HensemLiveWithdrawPages.create({L,page:()=>operators?'withdraw_operators':'auto_withdraw',E,C:v=>v===null?'—':Number(v||0).toLocaleString('en-US'),N:String,R:(n,d)=>d?(100*n/d).toFixed(2)+'%':'—',box:(_title,body)=>body,table:(headers,rows,cls,footers)=>{tables.push({headers,rows:Array.from(rows,row=>Array.from(row)),cls,footers:footers&&Array.from(footers,row=>Array.from(row))});return rows.flat().join('')},render:()=>{},request:async q=>{requests.push(q);return respond?respond(q):{available:false,rows:[]}}});
 page.state.data={startDate:'2026-10-08',endDate:'2026-10-08',rows:[yash()],total:1,totals:yash(),...data};
 return {root,page,L,tables,requests,render:()=>page.render(),stats:()=>tables.findLast(t=>t.cls?.includes('withdraw-stat-table'))};
}
test('YASH shows real withdrawal counts while missing classification remains unknown in rows and KPI totals',()=>{
 const f=fixture(),html=f.render(),row=f.stats().rows[0];
 assert.deepEqual(row.slice(1,4),['100','80','5']);assert.match(row[4],/^80.00%/);assert.match(row[5],/^5.00%/);
 assert.deepEqual(row.slice(6,8),['—','—']);assert.match(row[8],/^—/);assert.match(row[9],/^—/);
 assert.match(html,/<label>自动出款<\/label><strong>—<\/strong>/);assert.match(html,/<label>人工处理<\/label><strong>—<\/strong>/);
 assert.match(html,/未分处理方式 100 笔 · 100.00%/);assert.match(html,/未分类单独列出，不推定为人工/);
});
test('mixed classification shows confirmed sums against all received orders and leaves unknown orders separate',()=>{
 const ar=yash({platform:'AR-SYNTHETIC',total:40,success:30,rejected:10,classificationAvailable:true,reasonAvailable:true,autoCount:10,manualCount:30});
 const totals=yash({total:140,success:110,rejected:15,autoCount:10,manualCount:30,unclassifiedCount:100,classificationPartial:true}),f=fixture({rows:[yash(),ar],total:21,totals}),html=f.render(),t=f.stats();
 assert.equal(t.rows[1][6],'10');assert.match(t.rows[1][8],/^<span class="red">25.00%/);
 for(const row of t.footers){assert.deepEqual(row.slice(1,4),['140','110','15']);assert.deepEqual(row.slice(6,8),['10','30']);assert.match(row[8],/7.14%/);assert.match(row[9],/21.43%/);assert.match(row[0],/分类笔数仅已确认/);}
 assert.match(html,/<label>自动出款<\/label><strong>10<\/strong>/);assert.match(html,/<label>人工处理<\/label><strong>30<\/strong>/);assert.match(html,/未分处理方式 100 笔 · 71.43%/);assert.match(html,/data-withdraw-classification="partial"/);assert.match(html,/已确认笔数 · 占已入库总笔数/);assert.match(html,/自动／人工显示已确认笔数，占比按已入库总笔数计算；未分类单独列出/);
});
test('classification capability overrides numeric placeholders, including previous-period comparison',()=>{
 const current=yash({autoCount:0,manualCount:100,previous:yash({autoCount:1,manualCount:99})}),f=fixture({rows:[current],totals:current,previousTotals:current.previous});
 const html=f.render(),row=f.stats().rows[0];assert.deepEqual(row.slice(6,8),['—','—']);assert.match(row[8],/^—.*对比值未提供/);assert.doesNotMatch(row[8],/1.00%|pp/);assert.match(html,/<label>自动出款<\/label><strong>—<\/strong>/);
});
test('missing values stay unknown while page sums preserve a genuinely classified zero and its known subset',()=>{
 const unknown=yash({classificationAvailable:undefined,autoCount:undefined,manualCount:null}),known=yash({platform:'KNOWN',classificationAvailable:true,autoCount:0,manualCount:100}),f=fixture({rows:[unknown,known],total:21});f.render();
 const t=f.stats();assert.deepEqual(t.rows[0].slice(6,8),['—','—']);assert.equal(t.rows[1][6],'0');assert.match(t.rows[1][8],/0.00%/);assert.deepEqual(t.footers[0].slice(6,8),['0','100']);assert.deepEqual(t.footers[1].slice(6,8),['—','—']);
});
test('scope totals use server confirmed counts rather than reconstructing all platforms from a paginated page',()=>{
 const ar=yash({platform:'AR-SYNTHETIC',total:40,classificationAvailable:true,autoCount:10,manualCount:30,unclassifiedCount:0});
 const totals=yash({total:500,autoCount:90,manualCount:210,unclassifiedCount:200,classificationPartial:true}),f=fixture({rows:[ar],total:41,totals}),html=f.render(),t=f.stats();
 assert.deepEqual(t.footers[0].slice(6,8),['10','30']);assert.deepEqual(t.footers[1].slice(6,8),['90','210']);assert.match(html,/<label>自动出款<\/label><strong>90<\/strong>/);assert.match(html,/未分处理方式 200 笔 · 40.00%/);assert.match(t.footers[1][8],/18.00%/);assert.match(t.footers[1][9],/42.00%/);
});
test('an explicit partial capability never manufactures an absent classification value or zero denominator',()=>{
 const totals=yash({autoCount:0,manualCount:null,classificationPartial:true,total:0,unclassifiedCount:0}),f=fixture({totals}),html=f.render();
 assert.match(html,/<label>自动出款<\/label><strong>0<\/strong>/);assert.match(html,/<label>人工处理<\/label><strong>—<\/strong>/);assert.doesNotMatch(html,/NaN|Infinity/);assert.match(f.stats().footers[0][8],/^—/);
});
test('partial classification compares observed shares while preserving unknown counts and suppressing absolute count changes',()=>{
 const current=yash({total:140,autoCount:10,manualCount:30,classificationPartial:true}),previous=yash({total:120,autoCount:8,manualCount:12,classificationPartial:true}),f=fixture({rows:[{...current,previous}],totals:current,previousTotals:previous,comparison:{complete:true}}),html=f.render(),row=f.stats().rows[0];
 assert.match(row[8],/7.14%.*昨日 6.67%.*\+0\.48 pp/);assert.match(row[9],/21.43%.*昨日 10.00%.*\+11\.43 pp/);for(const i of [8,9])assert.match(row[i],/按已入库数据计算；两期完整性尚未核验/);assert.match(html,/未分处理方式 100 笔/);const cards=html.split('withdraw-kpis')[1].split('</section>')[0];assert.match(cards,/<label>自动出款<\/label><strong>10<\/strong>/);assert.doesNotMatch(cards,/\+2 笔|\+18 笔/);
});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
test('same-query refresh is deduplicated, disables query controls and preserves the previous result on failure',async()=>{
 const data={startDate:'2026-10-08',endDate:'2026-10-08',rows:[yash({platform:'RETAINED-SYNTHETIC'})],total:1,totals:yash()},pending=deferred();let refreshing=false;
 const f=fixture({},false,()=>refreshing?pending.promise:data);await f.page.load();assert.equal(f.requests.length,1);
 refreshing=true;const first=f.page.load();assert.equal(f.requests.length,2);await f.page.load();await f.root.withdrawQueryForm();assert.equal(f.requests.length,2,'repeated query actions do not create another server read');
 let html=f.render();assert.match(html,/disabled aria-disabled="true" onclick="withdrawQueryForm\(this.form\)">正在读取/);assert.match(html,/disabled aria-disabled="true" onclick="withdrawLoad\(\)">刷新备注/);assert.match(html,/RETAINED-SYNTHETIC/);assert.match(html,/同一筛选的上次成功结果仍显示，尚未刷新/);
 pending.reject(Error('57014 synthetic statement timeout <script>'));await first;html=f.render();assert.equal(f.page.state.loading,false);assert.match(html,/刷新失败，同一筛选的上次成功结果已保留/);assert.match(html,/RETAINED-SYNTHETIC/);assert.match(html,/57014 synthetic statement timeout &lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/onclick="withdrawLoad\(\)">重试/);assert.doesNotMatch(html,/disabled aria-disabled="true" onclick="withdrawQueryForm/);
 refreshing=false;await f.root.withdrawLoad();assert.equal(f.requests.length,3);assert.equal(f.page.state.error,'');assert.doesNotMatch(f.render(),/刷新失败/);
});
test('editing dates removes old results before a new request and a failure cannot relabel them as the new day',async()=>{
 const data={startDate:'2026-10-08',endDate:'2026-10-08',rows:[yash({platform:'OLD-DAY-SYNTHETIC'})],total:1,totals:yash()},pending=deferred();let changed=false;
 const f=fixture({},false,()=>changed?pending.promise:data);await f.page.load();assert.match(f.render(),/OLD-DAY-SYNTHETIC/);
 f.root.withdrawDate('from','2026-10-09');f.root.withdrawDate('to','2026-10-09');assert.doesNotMatch(f.render(),/OLD-DAY-SYNTHETIC/);
 changed=true;const next=f.page.load();assert.equal(f.page.state.data,null);assert.doesNotMatch(f.render(),/OLD-DAY-SYNTHETIC|上次成功结果/);assert.equal(f.requests.at(-1).startAt,'2026-10-09T00:00:00.000Z');
 pending.reject(Error('synthetic request timeout'));await next;const html=f.render();assert.match(html,/synthetic request timeout/);assert.doesNotMatch(html,/OLD-DAY-SYNTHETIC|上次成功结果/);assert.equal(f.page.state.data,null);
});
test('unavailable YASH reasons are explained beside a working daily entry without issuing a reason request',()=>{
 const f=fixture();f.render();const actions=f.stats().rows[0].at(-1);
 assert.match(actions,/当前采集数据未提供自动／人工标识及原因/);assert.match(actions,/当前采集未提供原因/);assert.match(actions,/withdrawDaily\(0\)/);assert.doesNotMatch(actions,/withdrawReasons/);
 f.root.withdrawReasons(0);f.root.withdrawReasons(0,'rejection');assert.equal(f.requests.length,0);assert.equal(f.page.state.reason,null);
});
test('an unavailable reason response does not inherit AR manual or system classification claims',()=>{
 const f=fixture();f.page.state.reason={country:'印度',platform:'YASH.BET',date:'2026-10-08',kind:'blocking'};f.page.state.reasonData={available:false,reasonAvailable:false,message:'源未提供原因'};
 const html=f.render();assert.match(html,/不能推定为无原因/);assert.doesNotMatch(html,/排除 system|人工操作均计入|当前条件下没有人工拦截订单/);
});
test('YASH coverage reports complete creation days and formats latest collection in India time',()=>{
 const f=fixture({yashCoverage:{days:[{date:'2026-10-08',complete:true,total:100}],currentComplete:true,previousComplete:true,latestCollectedAt:'2026-10-09T00:00:00Z'}}),html=f.render();
 assert.match(html,/data-yash-coverage="complete"/);assert.match(html,/所选创建日已完整采集/);assert.match(html,/5:30:00（印度时间）/);assert.match(html,/按印度当地创建日期统计/);
});
test('partial, missing and duplicate coverage days never claim a complete total',()=>{
 for(const days of [[],[{date:'2026-10-08',complete:false}],[{date:'2026-10-07',complete:true}],[{date:'2026-10-08',complete:true},{date:'2026-10-08',complete:true}]]){
  const f=fixture({yashCoverage:{days,currentComplete:true,previousComplete:false,latestCollectedAt:null}}),html=f.render();assert.match(html,/data-yash-coverage="partial"/);assert.match(html,/不能作为完整总计/);assert.match(html,/前期覆盖不完整/);assert.match(html,/最新采集：尚未取得/);assert.doesNotMatch(html,/所选创建日已完整采集/);
 }
});
test('YASH processing duration uses valid completion samples and does not claim bank arrival',()=>{
 const rows=[yash({durationSampleCount:1,durationTotalSeconds:60}),yash({platform:'YASH-SYNTHETIC',avgSeconds:120,durationSampleCount:3,durationTotalSeconds:360})],f=fixture({rows,total:21});f.render();const t=f.stats();
 assert.match(t.rows[0][10],/创建至源订单完成的处理用时，不代表银行到账时长/);assert.match(t.rows[0][10],/1 笔 \/ 100 笔/);assert.match(t.footers[0][10],/1分45秒/);assert.match(t.footers[0][10],/4 笔 \/ 200 笔/);
});
test('operator rows retain actual supplied outcomes and identify the current operator basis',()=>{
 const r=yash({account:'SYNTHETIC',processed:100,success:80,rejected:5}),f=fixture({rows:[r],totals:r,yashCoverage:{days:[{date:'2026-10-08',complete:true}],currentComplete:true}},true),html=f.render();
 assert.deepEqual(f.stats().rows[0].slice(1,5),['SYNTHETIC','100','80','5']);assert.match(html,/当前操作人汇总，不代表历史操作次数/);assert.doesNotMatch(html,/data-withdraw-classification="unavailable"/);
});

const settleNotes=async()=>{for(let i=0;i<3;i++)await new Promise(setImmediate)};
const sourceNotes=(extra={})=>({available:true,reasonAvailable:true,source:'YASH 已采集提现订单',sourceNoteFormat:'yash_withdraw_notes_v1',reasonTextSanitized:true,reasonTextFormat:'sanitized_label_v1',classificationAvailable:false,noteCount:865,total:1,canViewBlockingOrders:true,canViewOrders:true,canViewOperators:true,coverage:{collected:865,complete:true},summary:{totalOrders:865,totalRejected:19,sourceNoteStates:{present:0,empty:0,missing:865}},rows:[{reason:'未采集风控备注',sourceReason:null,noteState:'missing',reasonKey:'a'.repeat(32),categoryKey:'a'.repeat(32),count:865}],...extra});
test('YASH capability exposes independent notes and old 865 orders stay missing without invented processing classes',async()=>{
 const f=fixture({rows:[yash({reasonAvailable:true,sourceNotesAvailable:true})]},false,()=>sourceNotes());let html=f.render();assert.match(f.stats().rows[0].at(-1),/风控备注.*驳回订单备注/);f.root.withdrawReasons(0);await settleNotes();html=f.render();assert.equal(f.requests.at(-1).kind,'blocking');assert.match(html,/<h2>风控备注<\/h2>/);assert.match(html,/<span>未采集说明<\/span><strong>865<\/strong>/);assert.match(html,/旧订单需备注补采后更新/);assert.match(html,/按全部已入库提现订单展示源风控备注/);assert.match(html,/不据此判断自动或人工/);assert.doesNotMatch(html,/排除 system|人工总数|已采集的转人工说明/);assert.deepEqual(f.stats().rows[0].slice(6,8),['—','—']);
});
test('YASH rejection notes, order drill and search preserve their source and exact decimal text',async()=>{
 const key='b'.repeat(32),f=fixture({rows:[yash({reasonAvailable:true,sourceNotesAvailable:true})]},false,q=>sourceNotes(q.kind==='orders'||q.kind==='blockingOrders'?{total:21,rows:[{orderNumber:'SYNTHETIC-LONG',amount:'9999999999999999.12345678',currency:'INR',status:'已驳回',orderNote:'拒绝 <script>x</script>',orderNoteState:'present',riskNote:'',riskNoteState:'empty',operator:'SYNTHETIC-LAST'}]}:{noteCount:19,summary:{totalOrders:865,totalRejected:19,sourceNoteStates:{present:1,empty:1,missing:17}},rows:[{reason:'拒绝 <script>x</script>',sourceReason:'拒绝 <script>x</script>',noteState:'present',categoryKey:key,reasonKey:key,count:1},{reason:'源订单备注为空',sourceReason:'',noteState:'empty',categoryKey:'c'.repeat(32),reasonKey:'c'.repeat(32),count:1}]}));f.root.withdrawReasons(0,'rejection');await settleNotes();let html=f.render();assert.equal(f.requests.at(-1).kind,'categories');assert.match(html,/<h2>驳回订单备注<\/h2>/);assert.match(html,/不使用风控备注补作驳回原因/);assert.match(html,/源订单备注为空/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);f.root.withdrawReasonDrill(0,'category');await settleNotes();html=f.render();assert.equal(f.requests.at(-1).category,key);assert.match(html,/9999999999999999.12345678 INR/);assert.match(html,/源风控备注为空/);f.root.withdrawReasonQuery('SYNTHETIC');f.root.withdrawReasonSearch();await settleNotes();f.root.withdrawReasonPage(2);await settleNotes();assert.equal(f.requests.at(-1).offset,20);assert.equal(f.requests.at(-1).query,'SYNTHETIC');assert.equal(f.requests.at(-1).category,key);f.root.withdrawReasonClose();assert.equal(f.page.state.reason,null);
});
test('a missing YASH day never appears as a verified zero or an unavailable auto/manual feature',async()=>{
 const f=fixture({rows:[yash({reasonAvailable:true,sourceNotesAvailable:true})]},false,()=>sourceNotes({available:false,noteCount:null,message:'该日期尚未收到可核验的 YASH 提现订单，不能推定源站没有数据。',rows:[]}));f.root.withdrawReasons(0);await settleNotes();const html=f.render();assert.match(html,/不能推定源站没有数据/);assert.doesNotMatch(html,/未提供自动／人工标识及原因|<span>已入库提现订单<\/span><strong>0/);
});

test('YASH verified empty filters differ from an unverified missing order range',()=>{
 for(const complete of [true,false]){
  const f=fixture({rows:[yash({reasonAvailable:true,sourceNotesAvailable:true})]});f.page.state.reason={country:'印度',platform:'YASH.BET',date:'2026-10-08',kind:'blocking'};f.page.state.reasonData=sourceNotes({rows:[],total:0,noteCount:0,coverage:{complete}});const html=f.render();if(complete){assert.match(html,/当前筛选无记录/);assert.doesNotMatch(html,/不能据此推定源站没有数据/);}else assert.match(html,/不能据此推定源站没有数据/);
 }
});
