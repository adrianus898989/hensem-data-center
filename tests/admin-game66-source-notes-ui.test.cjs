// Render real production UI with synthetic scalar notes only; no network.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-withdraw-rejection-exact-ui.test.cjs'),'utf8').split('\nconst notes=')[0];
const {fixture}=new Function('require','__dirname',prefix+'\nreturn{fixture};')(require,__dirname);
const base={available:true,reasonAvailable:true,sourceNoteFormat:'game66_withdraw_notes_v1',reasonTextFormat:'sanitized_label_v1',reasonTextSanitized:true,classificationAvailable:false,rejectionReasonAvailable:false,noteCount:2,total:1,summary:{sourceNoteStates:{present:1,empty:0,missing:1}},coverage:{complete:false},rows:[{sourceNotes:{audit_remark:'Audit label',reason:'Reason label',withdraw_remark:null},categoryKey:'a'.repeat(32),reasonKey:'a'.repeat(32),count:2}],canViewOrders:true};
const settle=async()=>{for(let i=0;i<3;i++)await new Promise(setImmediate)};
test('GAME66 notes show precise source labels and partial coverage, without YASH risk text or inferred rejection causes',()=>{
 const f=fixture(base),html=f.html();for(const label of ['驳回订单业务备注','审核备注','原因字段备注','提现备注','Audit label','Reason label','未取得备注','不等同已确认驳回原因','完整性尚未确认'])assert(html.includes(label),label);
 assert.doesNotMatch(html,/风控备注|排除 system|全部原文|不同文本不合并/);
});
test('automatic source note is shown for received orders, not labeled as final rejection or manual evidence',()=>{
 const f=fixture({...base,rows:[{sourceNotes:{auto_reason:'AUTOMATIC LABEL'},reasonKey:'b'.repeat(32),count:2}]},'blocking'),html=f.html();assert.match(html,/自动出款备注|AUTOMATIC LABEL/);assert.match(html,/不据此判断订单最终驳回或自动／人工处理/);assert.doesNotMatch(html,/排除 system|转人工说明归类/);
});
test('note drill preserves exact key and displays all separate fields without substituting update timestamp for completion',async()=>{
 const f=fixture(q=>q.kind==='orders'?{...base,total:1,rows:[{orderNumber:'SYNTHETIC',amount:'12.345',currency:'INR',status:'已驳回',createdAt:'2026-10-12T00:00Z',updatedAt:'2026-10-12T01:00Z',sourceNotes:{auto_reason:null,audit_remark:'',reason:'ONE',withdraw_remark:'TWO'}}]}:base);
 f.root.withdrawReasonDrill(0,'category');await settle();assert.equal(f.calls[0].category,'a'.repeat(32));assert.equal(f.calls[0].kind,'orders');const html=f.html();assert.match(html,/创建 \/ 更新时间/);assert.match(html,/源字段为空/);assert.match(html,/ONE/);assert.match(html,/TWO/);assert.doesNotMatch(html,/申请 \/ 完成时间/);
});
test('labels are escaped and empty received page is never claimed to be a complete empty source day',()=>{
 const f=fixture({...base,rows:[{sourceNotes:{audit_remark:'<img src=x onerror=1>',reason:null,withdraw_remark:''},count:2}]});assert.doesNotMatch(f.html(),/<img/);assert.match(f.html(),/&lt;img/);
 const empty=fixture({...base,rows:[]});assert.match(empty.html(),/不能据此推定源站没有数据/);
});
test('GAME66 row metadata selects safe labels before response and never falls through to YASH',()=>{
 const f=fixture({...base,available:false,sourceNoteFormat:undefined});f.page.state.data.rows[0].sourceNotesAvailable=true;f.page.state.data.rows[0].sourceNoteFormat='game66_withdraw_notes_v1';f.draw();assert.match(f.html(),/驳回订单业务备注/);assert.doesNotMatch(f.html(),/风控备注/);
});
test('DUOLI metadata explains current facts, unknown classification and source audit duration',()=>{
 const source=fs.readFileSync(path.join(__dirname,'admin-newar-withdraw-ui.test.cjs'),'utf8').split('\ntest(')[0];
 const harness=new Function('require','__dirname',source+'\nreturn{fixture,row};')(require,__dirname);
 const row={...harness.row,source:'DUOLI',classificationAvailable:false,autoCount:null,manualCount:null,reasonAvailable:false,durationBasis:'source_reported_audit_duration'};
 const f=harness.fixture({rows:[row],totals:row,newarCoverage:null,duoliCoverage:{currentComplete:false,previousComplete:false}}),html=f.render();assert.match(html,/data-duoli-coverage="partial"/);assert.match(html,/data-withdraw-classification="unavailable"/);assert.match(html,/自动／人工未提供时显示「—」/);assert.match(html,/>源备注</);assert.doesNotMatch(html,/原因字段未入库/);assert.match(html,/源订单审核用时/);assert.match(html,/不代表支付到账时长/);assert.doesNotMatch(html,/所选创建日已完整/);
});
