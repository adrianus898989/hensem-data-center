const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function harness(){
 const calls=[],drawers=[],root={},L={catalogReady:true,catalog:[{country:'印度',name:'SYNTHETIC',source:'ar',timezone:'Asia/Kolkata'}]};
 for(const file of ['live-workorder-operations.js','live-kyc-reconciliation.js','live-deposit-workspace.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview',file),'utf8'),{window:root});
 root.HensemWorkorderUI.today=()=>({from:'2026-10-04',to:'2026-10-04'});
 const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let html='',handler=q=>({source:'collected-workorders',dimension:q.dimension,summary:{rawRecords:2,duplicateSourceRows:0,uniqueWorkorders:2},kycSummary:{connected:{count:1},disconnected:{count:1},unknown:{count:0}},rows:[{key:'SYNTHETIC',platform:'SYNTHETIC',workOrderId:'000TICKET',paymentOrderId:'RC20260901FIXTURE',amount:'0.00',kycStatus:'connected',manualKyc:'NO',receiptState:'unknown',sourceSystem:'AR',rawRecords:1,sourceCount:2,relatedWorkorderCount:2,sources:[{sourceSystem:'AR',sourcePlatform:'SYNTHETIC-RAW',paymentOrderReferences:['RC20260901FIXTURE','RC-CONFLICT<&'],referenceConflict:true,submittedDate:'2026-10-04',workOrderId:'000TICKET',submittedAt:'2026-10-03T18:30:00Z',observedAt:'2026-10-04T06:00:00Z',amount:'0.00',currency:'INR'}],providerReply:'<img src=x onerror=alert(1)>'}],total:1,coverage:{complete:false,label:'仅含已采集工单，来源覆盖未确认'},sourceManifest:{platforms:[{platform:'SYNTHETIC',system:'AR',selectedWorkorders:2,latestSubmittedDate:'2026-10-04',lastObservedAt:'2026-10-04T06:00:00Z'}]}});
 const panel=root.HensemLiveDepositWorkspace.create({L,E,C:v=>String(v??'—'),N:v=>Number(v).toFixed(2),formatTime:v=>v,table:(h,rows)=>rows.map(r=>r.join('|')).join('\n'),render:()=>{html=panel.render()},request:async q=>{calls.push(JSON.parse(JSON.stringify(q)));return handler(q)},openDrawer:(title,body)=>drawers.push({title,body})});
 return {root,panel,calls,drawers,L,html:()=>html,dispatch:(m,...a)=>root.HensemLiveKycReconciliation.dispatch('deposit-source-kyc',m,...a),setHandler:v=>handler=v};
}
test('collected workorder view reaches the authenticated bounded statistics transport with tri-state KYC',async()=>{
 const h=harness();assert.equal(h.calls.length,0);await h.panel.load();assert.deepEqual(h.calls[0],{action:'depositStatistics',section:'kyc',country:'印度',dimension:'platform',kycStatus:'all',processing:'all',matchStatus:'all',offset:0,limit:20,dateMode:'range',startAt:'2026-10-04T00:00:00.000Z',endAt:'2026-10-04T23:59:59.000Z'});
 await h.dispatch('category','disconnected');assert.equal(h.calls.at(-1).kycStatus,'disconnected');assert.match(h.html(),/已采集存款工单/);assert.match(h.html(),/仅含已采集工单，来源覆盖未确认/);assert.match(h.html(),/平台采集情况/);h.root.depositKycCoverage();assert.match(h.drawers[0].body,/SYNTHETIC\|AR\|2\|2026-10-04\|2026-10-04T06:00:00Z/);assert.match(h.drawers[0].body,/不代表源后台总工单数/);assert.doesNotMatch(h.html(),/印度 · INR/);
});
test('group drilldown preserves displayed filters and order evidence never upgrades processing to receipt',async()=>{
 const h=harness();await h.panel.load();await h.dispatch('detail',0);assert.equal(h.calls.at(-1).dimension,'orders');assert.equal(h.calls.at(-1).platform,'SYNTHETIC');await h.dispatch('detail',0);assert.match(h.drawers[0].body,/000TICKET/);assert.match(h.drawers[0].body,/所选范围采集记录\|1/);assert.match(h.drawers[0].body,/关联来源记录\|2/);assert.match(h.drawers[0].body,/关联工单\|2/);assert.match(h.drawers[0].body,/AR \/ SYNTHETIC-RAW/);assert.match(h.drawers[0].body,/RC-CONFLICT&lt;&amp;/);assert.match(h.drawers[0].body,/原单引用冲突，未认定唯一原单/);assert.match(h.drawers[0].body,/2026-10-04 \/ 2026-10-03T18:30:00Z/);assert.match(h.drawers[0].body,/0.00 币种未提供/);assert.match(h.drawers[0].body,/到账核实\|待核实/);assert.match(h.drawers[0].body,/人工 KYC 核验\|NO/);assert.match(h.drawers[0].body,/&lt;img/);assert.doesNotMatch(h.drawers[0].body,/<img/);
});
test('date actions use country calendar; missing date endpoints stop before transport',async()=>{
 const h=harness();await h.panel.load();h.dispatch('filter','from','2026-09-01');h.dispatch('filter','to','');await h.panel.load();assert.equal(h.calls.length,1);assert.match(h.html(),/同时填写/);
 h.dispatch('filter','to','2026-09-02');await h.panel.load();assert.equal(h.calls.at(-1).dateMode,'range');assert.equal(h.calls.at(-1).startAt,'2026-09-01T00:00:00.000Z');assert.equal(h.calls.at(-1).endAt,'2026-09-02T23:59:59.000Z');assert.equal(h.calls.at(-1).from,undefined);await h.root.depositKycDate('all');assert.equal(h.calls.at(-1).dateMode,'all');h.panel.destroy();
});

test('navigation pause rejects late results and closed tabs restore a fresh workspace',async()=>{
 const h=harness();await h.panel.load();const original=h.panel.capture();h.dispatch('filter','query','FIRST');let resolve;
 h.setHandler(()=>new Promise(r=>resolve=r));const pending=h.panel.load();await Promise.resolve();h.panel.pause();resolve({dimension:'orders',rows:[{paymentOrderId:'LATE_RESULT'}],total:1});await pending;
 assert.doesNotMatch(h.panel.render(),/LATE_RESULT/);assert.doesNotMatch(h.panel.render(),/读取中…/);assert.match(h.panel.render(),/读取已暂停/);
 h.panel.restore(original);assert.equal(h.panel.capture().filters.query,'');assert.match(h.panel.render(),/平台采集情况/);
 h.panel.clear();assert.equal(h.panel.capture().snapshot,null);assert.equal(h.panel.capture().filters.dimension,'platform');assert.doesNotMatch(h.panel.render(),/FIRST|平台采集情况/);
});

const platformSelect=html=>html.match(/<select aria-label="平台"[\s\S]*?<\/select>/)?.[0]||'';
test('failed first read retains authorized platform choices and a manual single-platform retry keeps date and section',async()=>{
 const h=harness();h.L.catalog.push({country:'印度',name:'SYNTHETIC-NEWAR',sourceName:'NativeFixture',source:'newar'});
 h.setHandler(()=>{throw Error('正式数据读取超时')});await h.panel.load();
 assert.equal(h.calls.length,1);assert.match(h.panel.render(),/正式数据读取超时/);
 for(const value of ['SYNTHETIC','NativeFixture'])assert.match(platformSelect(h.panel.render()),new RegExp('value="'+value+'"'));
 assert.match(platformSelect(h.panel.render()),/>SYNTHETIC-NEWAR<\/option>/);
 h.dispatch('filter','platform','NativeFixture');
 h.setHandler(q=>({source:'collected-workorders',dimension:q.dimension,rows:[],total:0,options:{platforms:['STALE-FACET']}}));
 await h.panel.load();assert.equal(h.calls.length,2);
 assert.deepEqual(h.calls[1],{...h.calls[0],platform:'NativeFixture'});
 assert.equal(h.calls[1].section,'kyc');assert.equal(h.calls[1].dateMode,'range');
 assert.equal(h.calls[1].startAt,'2026-10-04T00:00:00.000Z');assert.equal(h.calls[1].endAt,'2026-10-04T23:59:59.000Z');
 assert.doesNotMatch(platformSelect(h.panel.render()),/STALE-FACET/);h.panel.destroy();
});
test('current catalog filters country/source and marks revoked drafts without silently widening their request',async()=>{
 const h=harness();h.L.catalog.push({country:'印度',name:'SYNTHETIC',source:'ar'},
  {country:'巴基斯坦',name:'FOREIGN',source:'ar'},{country:'印度',name:'UNSUPPORTED',source:'yash'},
  {country:'印度',name:'NEWLY-ALLOWED',source:'newar'});
 const initial=platformSelect(h.panel.render());assert.equal((initial.match(/value="SYNTHETIC"/g)||[]).length,1);
 assert.doesNotMatch(initial,/FOREIGN|UNSUPPORTED/);assert.match(initial,/NEWLY-ALLOWED/);
 await h.panel.load();h.dispatch('filter','platform','SYNTHETIC');h.L.catalog=[{country:'印度',name:'NEWLY-ALLOWED',source:'newar'}];
 const calls=h.calls.length;h.setHandler(()=>{throw Error('当前账号没有此范围权限')});await h.panel.load();assert.equal(h.calls.length,calls+1);
 assert.equal(h.calls.at(-1).platform,'SYNTHETIC');assert.match(h.panel.render(),/当前账号没有此范围权限/);
 assert.match(platformSelect(h.panel.render()),/已选平台不可用，请重新选择/);
 h.dispatch('filter','platform','NEWLY-ALLOWED');await h.panel.load();assert.equal(h.calls.at(-1).platform,'NEWLY-ALLOWED');
 h.L.catalogReady=false;await h.panel.load();assert.equal(h.calls.length,calls+2);assert.match(h.panel.render(),/平台目录尚未读取/);h.panel.destroy();
});
test('native dropdown identity and authorized canonical group drilldown keep the existing server alias contract',async()=>{
 const h=harness();h.L.catalog=[{country:'印度',name:'MAAN.WIN',sourceName:'MAANWIN',source:'newar'},
  {country:'印度',name:'Shree.Win',sourceName:'SHREEWIN',source:'ar'}];
 const choices=platformSelect(h.panel.render());assert.match(choices,/value="MAANWIN"[^>]*>MAAN.WIN<\/option>/);
 assert.match(choices,/value="SHREEWIN"[^>]*>Shree.Win<\/option>/);
 h.setHandler(q=>({source:'collected-workorders',dimension:q.dimension,rows:[{key:'SHREEWIN',label:'Shree.Win'}],total:1}));
 await h.panel.load();await h.dispatch('detail',0);assert.equal(h.calls.at(-1).dimension,'orders');assert.equal(h.calls.at(-1).platform,'SHREEWIN');
 // A group key remains a server-authorized canonical key even when its spelling differs from the raw source name.
 h.L.catalog=[{country:'印度',name:'DhaniWin',sourceName:'DhaniWin',source:'newar'}];
 h.panel.clear();h.setHandler(q=>({source:'collected-workorders',dimension:q.dimension,rows:[{key:'DHANIWIN',label:'DhaniWin'}],total:1}));
 await h.panel.load();await h.dispatch('detail',0);assert.equal(h.calls.at(-1).platform,'DHANIWIN');assert.equal(h.calls.at(-1).section,'kyc');h.panel.destroy();
});
test('imported KYC callers without the optional directory still receive their snapshot platform choices',()=>{
 const h=harness(),panel=h.root.HensemLiveKycReconciliation.create({id:'imported-compatibility',source:'export'});
 const html=panel.render({source:'export',options:{platforms:['IMPORTED-ONLY']},rows:[],total:0});
 assert.match(platformSelect(html),/value="IMPORTED-ONLY"/);assert.doesNotMatch(platformSelect(html),/SYNTHETIC/);
 panel.dispose();h.panel.destroy();
});
test('same display label preserves distinct authorized physical platform values',async()=>{
 const h=harness();h.L.catalog=[{country:'印度',name:'SHARED-LABEL',sourceName:'SYNTHETIC-AR',source:'ar'},
  {country:'印度',name:'SHARED-LABEL',sourceName:'SYNTHETIC-NEWAR',source:'newar'},
  {country:'印度',name:'SHARED-LABEL',sourceName:'SYNTHETIC-AR',source:'ar'}];
 const choices=platformSelect(h.panel.render());assert.equal((choices.match(/>SHARED-LABEL<\/option>/g)||[]).length,2);
 assert.equal((choices.match(/value="SYNTHETIC-AR"/g)||[]).length,1);assert.equal((choices.match(/value="SYNTHETIC-NEWAR"/g)||[]).length,1);
 h.dispatch('filter','platform','SYNTHETIC-NEWAR');await h.panel.load();assert.equal(h.calls[0].platform,'SYNTHETIC-NEWAR');h.panel.destroy();
});
