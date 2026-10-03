const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function harness(){
 const calls=[],drawers=[],root={},L={catalog:[{country:'印度',name:'SYNTHETIC',timezone:'Asia/Kolkata'}]};
 for(const file of ['live-workorder-operations.js','live-kyc-reconciliation.js','live-deposit-workspace.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview',file),'utf8'),{window:root});
 const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let html='',handler=q=>({dimension:q.dimension,summary:{uniqueWorkorders:2},kycSummary:{connected:{count:1},disconnected:{count:1},unknown:{count:0}},rows:[{key:'SYNTHETIC',platform:'SYNTHETIC',workOrderId:'000TICKET',paymentOrderId:'RC20260901FIXTURE',amount:'0.00',kycStatus:'connected',manualKyc:'NO',receiptState:'unknown',sourceTab:'三方未补',sourceRow:2,providerReply:'<img src=x onerror=alert(1)>'}],total:1,coverage:{complete:true},sourceManifest:{batches:[{label:'KYC三方未补-9月.xlsx',rowCount:1}]}});
 const panel=root.HensemLiveDepositWorkspace.create({L,E,C:v=>String(v??'—'),N:v=>Number(v).toFixed(2),formatTime:v=>v,table:(h,rows)=>rows.map(r=>r.join('|')).join('\n'),render:()=>{html=panel.render()},request:async q=>{calls.push(JSON.parse(JSON.stringify(q)));return handler(q)},openDrawer:(title,body)=>drawers.push({title,body})});
 return {root,panel,calls,drawers,html:()=>html,dispatch:(m,...a)=>root.HensemLiveKycReconciliation.dispatch('deposit-source-kyc',m,...a),setHandler:v=>handler=v};
}
test('source export view reaches the authenticated bounded statistics transport with tri-state KYC',async()=>{
 const h=harness();assert.equal(h.calls.length,0);await h.panel.load();assert.deepEqual(h.calls[0],{action:'depositStatistics',section:'kyc',country:'印度',dimension:'platform',kycStatus:'all',processing:'all',matchStatus:'all',offset:0,limit:20,dateMode:'all'});
 await h.dispatch('category','disconnected');assert.equal(h.calls.at(-1).kycStatus,'disconnected');assert.match(h.html(),/KYC三方未补-9月.xlsx · 1 行/);assert.match(h.html(),/原导出数据/);assert.doesNotMatch(h.html(),/印度 · INR/);
});
test('group drilldown preserves displayed filters and order evidence never upgrades processing to receipt',async()=>{
 const h=harness();await h.panel.load();await h.dispatch('detail',0);assert.equal(h.calls.at(-1).dimension,'orders');assert.equal(h.calls.at(-1).platform,'SYNTHETIC');await h.dispatch('detail',0);assert.match(h.drawers[0].body,/000TICKET/);assert.match(h.drawers[0].body,/0.00 币种未提供/);assert.match(h.drawers[0].body,/到账核实\|待核实/);assert.match(h.drawers[0].body,/人工 KYC 核验\|NO/);assert.match(h.drawers[0].body,/&lt;img/);assert.doesNotMatch(h.drawers[0].body,/<img/);
});
test('date actions use country calendar; missing date endpoints stop before transport',async()=>{
 const h=harness();await h.panel.load();h.dispatch('filter','from','2026-09-01');await h.panel.load();assert.equal(h.calls.length,1);assert.match(h.html(),/同时填写/);
 h.dispatch('filter','to','2026-09-02');await h.panel.load();assert.equal(h.calls.at(-1).dateMode,'range');assert.equal(h.calls.at(-1).startAt,'2026-09-01T00:00:00.000Z');assert.equal(h.calls.at(-1).endAt,'2026-09-02T23:59:59.000Z');assert.equal(h.calls.at(-1).from,undefined);await h.root.depositKycDate('all');assert.equal(h.calls.at(-1).dateMode,'all');h.panel.destroy();
});

test('navigation pause rejects late results and closed tabs restore a fresh workspace',async()=>{
 const h=harness();await h.panel.load();const original=h.panel.capture();h.dispatch('filter','query','FIRST');let resolve;
 h.setHandler(()=>new Promise(r=>resolve=r));const pending=h.panel.load();await Promise.resolve();h.panel.pause();resolve({dimension:'orders',rows:[{paymentOrderId:'LATE_RESULT'}],total:1});await pending;
 assert.doesNotMatch(h.panel.render(),/LATE_RESULT/);assert.doesNotMatch(h.panel.render(),/读取中…/);assert.match(h.panel.render(),/读取已暂停/);
 h.panel.restore(original);assert.equal(h.panel.capture().filters.query,'');assert.match(h.panel.render(),/KYC三方未补-9月/);
 h.panel.clear();assert.equal(h.panel.capture().snapshot,null);assert.equal(h.panel.capture().filters.dimension,'platform');assert.doesNotMatch(h.panel.render(),/FIRST|KYC三方未补-9月/);
});
