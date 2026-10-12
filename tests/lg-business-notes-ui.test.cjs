const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const prefix=read('tests/admin-withdraw-rejection-exact-ui.test.cjs').split('\nconst notes=')[0];
const {fixture}=new Function('require','__dirname',prefix+'\nreturn{fixture};')(require,__dirname);
const base={available:true,reasonAvailable:true,sourceNoteFormat:'lg_business_notes_v1',reasonTextFormat:'sanitized_label_v1',reasonTextSanitized:true,classificationAvailable:false,rejectionReasonAvailable:false,noteCount:3,total:1,timezone:'Asia/Manila',summary:{sourceNoteStates:{present:1,empty:1,redacted:0,missing:1}},coverage:{complete:false},rows:[{sourceNotes:{remark:'BUSINESS LABEL',appRemark:''},sourceNoteStates:{remark:'present',appRemark:'empty'},categoryKey:'a'.repeat(32),reasonKey:'a'.repeat(32),count:3}],canViewOrders:true};
const settle=async()=>{for(let i=0;i<3;i++)await new Promise(setImmediate)};
test('LG shows exact note field labels and distinct provenance without final cause or automatic/risk claims',()=>{
 const f=fixture(base),html=f.html();for(const text of ['驳回订单业务备注','源备注 remark','应用备注 appRemark','BUSINESS LABEL','源字段为空','未采集','不等同已确认驳回原因','完整性尚未确认','Asia/Manila'])assert(html.includes(text),text);
 const panel=html.slice(html.indexOf('withdraw-reason-tabs'));assert.doesNotMatch(panel,/风控备注|自动出款原因|原因占比|不同原备注/);
});
test('LG exact note group drills with stable key and field states; notes are escaped',async()=>{
 const f=fixture(q=>q.kind==='orders'?{...base,total:1,rows:[{orderNumber:'ORDER',amount:'0.123456789012345678',currency:'PHP',status:'rejected',createdAt:'2026-10-12',updatedAt:'2026-10-13',sourceNotes:{remark:'<img src=x onerror=1>',appRemark:null},sourceNoteStates:{remark:'present',appRemark:'missing'}}]}:base);
 f.root.withdrawReasonDrill(0,'category');await settle();assert.equal(f.calls[0].category,'a'.repeat(32));assert.equal(f.calls[0].kind,'orders');assert.equal(f.calls[0].date,'2026-09-30');
 assert.match(f.html(),/创建 \/ 更新时间/);assert.match(f.html(),/0\.123456789012345678/);assert.match(f.html(),/&lt;img/);assert.doesNotMatch(f.html(),/<img/);
 const hidden=fixture({...base,rows:[{sourceNotes:{remark:'NEVER-DISPLAY',appRemark:'NEVER-DISPLAY'},sourceNoteStates:{remark:'redacted',appRemark:'missing'},count:1}]});assert.match(hidden.html(),/隐私内容已隐藏/);assert(!hidden.html().includes('NEVER-DISPLAY'));
});
test('LG source metadata is recognized before notes response and opens only rejected business notes',()=>{
 const f=fixture({...base,available:false,sourceNoteFormat:undefined});f.page.state.data.rows[0].sourceNotesAvailable=true;f.page.state.data.rows[0].sourceNoteFormat='lg_business_notes_v1';f.draw();
 assert.match(f.html(),/驳回订单业务备注/);assert.doesNotMatch(f.html(),/风控备注|data-withdraw-reason="0-blocking"/);
});
test('LG charge and withdraw drawer show only known business fields and preserve precision/zero; other source charge remains unchanged',()=>{
 const window={};vm.runInNewContext(read('admin-preview/live-order-business.js'),{window});
 const tools={E:v=>String(v??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),N:String,formatTime:v=>v||'—'};
 const row={direction:'charge',lg_remark:'<script>TEXT</script>',lg_remark_state:'present',lg_app_remark:'',lg_app_remark_state:'empty',source_business_fields:{beforeRechargeWithdrawDiff:'-12345678901234567890.123456789012345678',firstFlag:'0',transactionId:'1234567890123456789012345',phone:'PRIVATE-PHONE',raw:{secret:'PRIVATE-RAW'},groupList:[{groupId:'0',groupName:'<group>',colorTag:'#fff',phone:'PRIVATE-GROUP'}]}};
 for(const direction of ['charge','withdraw']){const rows=window.HensemOrderBusiness.rows({...row,direction},{source:'lg'},tools),value=k=>rows.find(r=>r[0]===k||r[0].endsWith('（'+k+'）'))?.[1];
 assert.equal(value('源备注 remark'),'&lt;script&gt;TEXT&lt;/script&gt;');assert.equal(value('应用备注 appRemark'),'源字段为空');assert.equal(value('firstFlag'),'0');assert.equal(value('beforeRechargeWithdrawDiff'),row.source_business_fields.beforeRechargeWithdrawDiff);assert.equal(value('transactionId'),row.source_business_fields.transactionId);assert(!JSON.stringify(rows).includes('PRIVATE-'));assert.match(value('groupList'),/&lt;group&gt;/);}
 assert.equal(window.HensemOrderBusiness.rows(row,{source:'ar'},tools).length,0);assert.equal(window.HensemOrderBusiness.rows({...row,direction:'withdraw'},{source:'panda'},tools).length,0);
});
