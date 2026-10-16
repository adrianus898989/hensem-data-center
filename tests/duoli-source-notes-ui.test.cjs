const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-withdraw-pages.js'),'utf8');
const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base={available:true,source:'DUOLI',sourceNoteFormat:'duoli_withdraw_source_notes_v1',sourceNotesAvailable:true,reasonAvailable:false,reasonTextSanitized:true,reasonTextFormat:'sanitized_label_v1',rejectionReasonAvailable:false,autoInterceptionReasonAvailable:false,noteCount:8,total:1,canViewOrders:true,canViewBlockingOrders:true,canViewOperators:true,coverage:{complete:false},summary:{sourceNoteStates:{present:3,empty:1,missing:1,withheld:1,stale:1,invalid:1}},rows:[{reasonKey:'a'.repeat(32),categoryKey:'a'.repeat(32),sourceNotes:{condition:'SYNTHETIC CONDITION',remark:null},sourceNoteStates:{condition:'present',remark:'empty'},sourceNoteFlags:{condition:{redacted:false,truncated:false}},reason:'来源字段组合',count:3}]};
function fixture(response=base,kind='blocking'){
 let html='',page;const calls=[],root={Intl,Date,document:{querySelector(){return null},getElementById(){return null}},HensemLiveFilters:{multi(){return ''}}};root.window=root;vm.createContext(root);vm.runInContext(source,root);const draw=()=>{html=page.render()};
 const L={catalogReady:true,catalog:[{country:'印尼',name:'UANG',sourceName:'UANG',source:'duoli'}],country:'印尼',from:'2026-10-15T00:00:00',to:'2026-10-15T23:59:59'};
 page=root.HensemLiveWithdrawPages.create({L,E,N:String,C:String,R:(n,d)=>d?(100*n/d).toFixed(2)+'%':'—',page:()=> 'auto_withdraw',box:(_,body)=>body,table:(headers,rows)=>'<table>'+headers.join('|')+rows.map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</table>',request:async q=>{calls.push(q);return typeof response==='function'?response(q):response},render:draw});
 page.state.data={country:'印尼',rows:[{country:'印尼',platform:'UANG',source:'DUOLI',reasonAvailable:false}],totals:{},notes:[]};page.state.reason={country:'印尼',platform:'UANG',date:'2026-10-15',kind};page.state.reasonData=base;draw();return{root,page,L,calls,html:()=>html,draw};
}
const settle=async()=>{for(let i=0;i<3;i++)await new Promise(setImmediate)};
test('Duoli source-note entry replaces stale unavailable text and uses factual source tabs/header, not verified reasons',()=>{
 const f=fixture();for(const label of ['>源备注<','提现来源备注','驳回订单来源备注','来源字段 condition','来源字段 remark','SYNTHETIC CONDITION','源字段为空','旧备注待更新','格式异常','尚未核实为自动拦截或驳回原因','订单范围尚未完整核验'])assert(f.html().includes(label),label);
 assert.doesNotMatch(f.html(),/原因字段未入库|原因字段尚未入库|<h2>自动出款原因|<h2>驳回原因分析|风控备注|自动出款拦截原文/);
 const panel=f.html().slice(f.html().indexOf('withdraw-reason-tabs'));assert.doesNotMatch(panel,/原因占比|未提供自动／人工标识及原因/);
});
test('source-notes action opens despite unverified cause; other unavailable sources remain disabled',async()=>{
 const f=fixture();f.page.state.reason=null;f.root.withdrawReasons(0,'blocking');await settle();assert.equal(f.calls.length,1);assert.equal(f.calls[0].platform,'UANG');assert.equal(f.calls[0].country,'印尼');assert.equal(f.calls[0].date,'2026-10-15');
 f.page.state.data.rows[0].source='OTHER';f.page.state.reason=null;f.root.withdrawReasons(0,'blocking');await settle();assert.equal(f.calls.length,1);assert.equal(f.page.state.reason,null);
});
test('exact group drill stays on all withdrawals or rejected cohort and preserves source provenance and precision',async()=>{
 const f=fixture(q=>({...base,rows:[{orderNumber:'SYNTHETIC-ORDER',amount:'123.456789012345678901',status:'REJECTED',sourceNotes:{condition:'<img src=x onerror=1>',remark:'NEVER DISPLAY'},sourceNoteStates:{condition:'present',remark:'withheld'},sourceNoteFlags:{condition:{redacted:true,truncated:true}}}]}));
 f.root.withdrawBlockingDrill(0,'blockingOrders');await settle();assert.equal(f.calls.at(-1).kind,'blockingOrders');assert.equal(f.calls.at(-1).reasonKey,'a'.repeat(32));assert.match(f.html(),/123\.456789012345678901/);assert.match(f.html(),/&lt;img/);assert.doesNotMatch(f.html(),/<img|NEVER DISPLAY/);assert.match(f.html(),/部分内容已隐藏 · 文本已截断/);assert.match(f.html(),/隐私内容已隐藏/);
 f.page.state.reasonData=base;f.page.state.reason.kind='categories';f.root.withdrawReasonDrill(0,'category');await settle();assert.equal(f.calls.at(-1).kind,'orders');assert.equal(f.calls.at(-1).category,'a'.repeat(32));assert.match(f.html(),/按源状态码 4、7/);
});
test('missing/empty/invalid/withheld/stale never display retained text; no field is guessed as a cause',()=>{
 const f=fixture();f.page.state.reasonData={...base,total:5,rows:['missing','empty','invalid','withheld','stale'].map(state=>({sourceNotes:{condition:'NEVER-'+state,remark:'NEVER-'+state},sourceNoteStates:{condition:state,remark:state},count:1}))};f.draw();assert.doesNotMatch(f.html(),/NEVER-/);for(const text of ['未采集','源字段为空','字段格式异常，未展示','隐私内容已隐藏','旧备注待更新'])assert(f.html().includes(text));
});
test('shared reason lifecycle ignores late closed/denied responses, and repeated exact query reuses only its own scope',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>resolve=r));f.root.withdrawReasons(0,'blocking');await settle();f.root.withdrawReasonClose();resolve(base);await settle();assert.equal(f.page.state.reason,null);assert.doesNotMatch(f.html(),/id="withdraw-reasons"/);
 f.root.withdrawReasons(0,'blocking');await settle();f.root.hensemRoleAccess={canView:false};resolve(base);await settle();assert.equal(f.page.state.data,null);assert.equal(f.page.state.reasonData,null);
 const h=fixture();h.root.withdrawReasons(0,'blocking');await settle();h.root.withdrawReasonClose();h.root.withdrawReasons(0,'blocking');await settle();assert.equal(h.calls.length,1);
 h.root.withdrawReasonDate('2026-10-14');await settle();assert.equal(h.calls.length,2);assert.equal(h.calls.at(-1).date,'2026-10-14');
});
test('replaced message branch is gone while non-Duoli source handling remains unchanged',()=>{
 const f=fixture();f.page.state.reason=null;f.page.state.data.rows=[{country:'印尼',platform:'UANG',source:'OTHER',reasonAvailable:false},{country:'印尼',platform:'55FIVE',source:'AR',reasonAvailable:true}];f.draw();assert.match(f.html(),/当前采集未提供原因/);assert.match(f.html(),/>自动出款原因</);assert.match(f.html(),/>驳回原因</);assert.doesNotMatch(f.html(),/>源备注</);
});
