// Synthetic renderer and drilldown protocol checks; no real account or business data.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-withdraw-pages.js'),'utf8');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture(response,kind='categories'){
 let html='',page;const calls=[],root={Intl,Date,document:{querySelector(){return null},getElementById(){return null}},HensemLiveFilters:{multi(){return ''}}};root.window=root;vm.createContext(root);vm.runInContext(source,root);const draw=()=>{html=page.render()};
 page=root.HensemLiveWithdrawPages.create({L:{catalogReady:true,catalog:[{country:'印度',name:'SYNTHETIC'}],country:'印度',from:'2026-09-30T00:00:00',to:'2026-09-30T23:59:59'},E:escape,N:String,C:String,R:(n,d)=>d?(100*n/d).toFixed(2)+'%':'—',page:()=> 'auto_withdraw',box:(_,body)=>body,table:(headers,rows)=>'<table>'+headers.join('|')+rows.map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</table>',request:async q=>{calls.push(q);return typeof response==='function'?response(q):response},render:draw});
 page.state.data={country:'印度',rows:[{country:'印度',platform:'SYNTHETIC'}],totals:{},notes:[]};page.state.reason={country:'印度',platform:'SYNTHETIC',date:'2026-09-30',kind};page.state.reasonData=typeof response==='function'?response({kind}):response;draw();return {root,page,calls,html:()=>html,draw};
}
const settle=async()=>{for(let i=0;i<3;i++)await new Promise(setImmediate)};
const notes=['4996627','i','5843909','24339947','System abnormal: case A','System abnormal: case B','/ [Resubmit order] Recheck your UPI information'];
const groups=notes.map((sourceReason,i)=>({category:sourceReason,sourceReason,categoryKey:String(i+1).repeat(32),count:1,sourceVariantCount:1}));
const data={available:true,source:'Synthetic',rejectionGrouping:'exact_source_text_v1',noteCount:7,total:7,categories:groups,rows:groups,canViewOrders:true,summary:{totalRejected:7,missingReason:0,operators:1},coverage:{}};
test('rejection list displays seven independent original notes instead of semantic category representatives',()=>{
 const h=fixture(data);for(const raw of notes)assert.match(h.html(),new RegExp(escape(raw).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.match(h.html(),/不同原备注/);assert.match(h.html(),/不同文本不合并，空备注单列/);assert.match(h.html(),/14\.29%/);assert.doesNotMatch(h.html(),/其他未归类备注|已合并 7 种原文/);assert.equal((h.html().match(/onclick="withdrawReasonDrill/g)||[]).length,7);assert.match(h.html(),/原备注分布/);
});
test('each category drilldown sends its exact key and retains platform, day and global rejection denominator',async()=>{
 for(let i=0;i<groups.length;i++){
  const h=fixture(q=>q.kind==='orders'?{...data,total:1,rows:[{orderNumber:'SYNTHETIC-'+i,status:'未通过',rejectionReason:notes[i],rawRejectionReason:notes[i],categoryKey:groups[i].categoryKey}]}:data);
  h.root.withdrawReasonDrill(i,'category');await settle();assert.equal(h.calls[0].category,groups[i].categoryKey);assert.equal(h.calls[0].kind,'orders');assert.equal(h.calls[0].platform,'SYNTHETIC');assert.equal(h.calls[0].country,'印度');assert.equal(h.calls[0].date,'2026-09-30');assert.equal(h.page.state.reasonLabel,notes[i]);assert.match(h.html(),/7 笔驳回订单计算/);assert.doesNotMatch(h.html(),/withdraw-reason-category/);
 }
});
test('the original distribution remains available and drills by the same exact category key',async()=>{
 const row=groups[6],h=fixture(q=>q.kind==='rejection'?{...data,total:1,rows:[{reason:row.sourceReason,sourceReason:row.sourceReason,reasonKey:row.categoryKey,count:1}]}:data);
 h.root.withdrawReasonVariants(6);await settle();assert.equal(h.calls[0].kind,'rejection');assert.equal(h.calls[0].category,row.categoryKey);assert.equal(h.page.state.reasonLabel,row.sourceReason);h.root.withdrawReasonDrill(0,'reason');await settle();assert.equal(h.calls.at(-1).kind,'orders');assert.equal(h.calls.at(-1).reasonKey,row.categoryKey);assert.equal(h.calls.at(-1).category,row.categoryKey);
});
test('raw rejection preview and full modal preserve entities, spaces and distinct lines without HTML execution',()=>{
 const raw='  &#40;IFSC Code Incorrect&#41;\nline...\nline full\n<img src=x onerror=alert(1)> '+ 'long text '.repeat(20);
 const h=fixture({...data,total:1,rows:[{sourceReason:raw,category:raw,categoryKey:'a'.repeat(32),count:1}]});
 assert.match(h.html(),/withdrawReasonOriginal\([^\n]+/);assert.match(h.html(),/,true\)/);assert.match(h.html(),/&amp;#40;/);assert.doesNotMatch(h.html(),/<img/);assert.match(h.html(),/…<\/button>/);
 h.root.withdrawReasonOriginal(raw,'驳回原文',true);assert.equal(h.page.state.originalNote,raw);assert.match(h.html(),/<pre>  &amp;#40;IFSC Code Incorrect&amp;#41;\nline\.\.\.\nline full\n&lt;img/);assert.doesNotMatch(h.html(),/<img/);
});
test('raw order field takes precedence over a normalized legacy field without displaying a second guessed category',()=>{
 const raw=' &#40;source&#41;\nraw line ',h=fixture({...data,total:1,rows:[{orderNumber:'SYNTHETIC',status:'未通过',category:'其他未归类备注',rejectionReason:'normalized source',rawRejectionReason:raw}]},'orders');
 assert.match(h.html(),/&amp;#40;source&amp;#41;/);assert.doesNotMatch(h.html(),/其他未归类备注|normalized source/);h.root.withdrawReasonOriginal(raw,'驳回原文',true);assert.equal(h.page.state.originalNote,raw);
});
test('empty source notes remain explicit and summary-only origins cannot open fabricated orders',async()=>{
 const h=fixture({...data,total:1,rows:[{sourceReason:null,category:'（源备注为空）',categoryKey:'f'.repeat(32),count:3}],canViewOrders:false});assert.match(h.html(),/（源备注为空）/);assert.match(h.html(),/只有原因汇总/);const before=h.calls.length;h.root.withdrawReasonDrill(0,'category');await settle();assert.equal(h.calls.length,before);
});
test('manual blocking original modal still uses its existing cleaned template presentation',()=>{
 const h=fixture({...data,rows:[]},'blocking');h.root.withdrawReasonOriginal('Alpha...\n\nAlpha full text','自动出款拦截原文');assert.equal(h.page.state.originalNote,'Alpha full text');assert.match(h.html(),/aria-label="自动出款拦截原文"/);
});
const stateGroups=[
 {rejectionNoteState:'withheld',category:'（源业务备注已隐藏，驳回备注待核对）',sourceReason:null,sourceVariantCount:null,categoryKey:'a'.repeat(32),count:7},
 {rejectionNoteState:'missing',category:'（未采集到明确驳回备注）',sourceReason:null,sourceVariantCount:null,categoryKey:'b'.repeat(32),count:2},
 {rejectionNoteState:'empty',category:'（源备注为空）',sourceReason:null,sourceVariantCount:null,categoryKey:'c'.repeat(32),count:1},
 {rejectionNoteState:'present',category:'source text',sourceReason:'source text',sourceVariantCount:1,categoryKey:'d'.repeat(32),count:1},
];
const stateData={...data,rejectionNoteStateVersion:'wg_source_note_state_v1',noteCount:11,total:4,categories:stateGroups,rows:stateGroups,summary:{totalRejected:11,knownReasonCount:1,withheldReason:7,missingReason:2,emptyReason:1,presentReason:1,operators:1}};
test('WG summary and state groups distinguish hidden/missing/empty without counting unknown original texts',()=>{
 const h=fixture(stateData),html=h.html();assert.match(html,/<span>已知原备注种类<\/span><strong>1<\/strong>/);assert.match(html,/<span>源业务备注已隐藏<\/span><strong>7<\/strong>/);assert.match(html,/<span>未采集明确驳回备注<\/span><strong>2<\/strong>/);assert.match(html,/<span>源备注为空<\/span><strong>1<\/strong>/);
 assert.match(html,/原文种类待核对/);assert.match(html,/来源状态合桶不表示同一驳回原因/);assert.match(html,/63\.64%/);assert.match(html,/隐藏原文需在源平台核对/);assert.doesNotMatch(html,/不同原备注<\/span><strong>4|保留完整原备注/);
});
test('WG hidden state drills by its key and order detail exposes factual source states separately from interception',async()=>{
 const h=fixture(q=>q.kind==='orders'?{...stateData,total:1,rows:[{orderNumber:'SYNTHETIC-HIDDEN',status:'rejected',rejectionReason:null,rawRejectionReason:null,rejectionNoteState:'withheld',sourceNoteStates:{remark:'template',front:'withheld',back:'empty'},hiddenNoteSources:['front'],manualRemark:'Synthetic auto-withdraw review template'}]}:stateData);
 h.root.withdrawReasonDrill(0,'category');await settle();assert.equal(h.calls.at(-1).category,stateGroups[0].categoryKey);assert.match(h.html(),/前台备注已隐藏，驳回备注待核对/);assert.match(h.html(),/主备注：已采集业务模板 · 前台备注：已隐藏 · 后台备注：为空/);assert.match(h.html(),/Synthetic auto-withdraw review template/);assert.doesNotMatch(h.html(),/（源备注为空）/);assert.equal(h.page.state.reasonData.rows[0].rejectionReason,null);
});
test('WG original distribution retains absence state and operators call unknown notes unavailable',()=>{
 const h=fixture({...stateData,rows:stateGroups.map(x=>({...x,reason:x.category,reasonKey:x.categoryKey}))},'rejection');assert.match(h.html(),/源业务备注已隐藏，驳回备注待核对/);assert.match(h.html(),/未采集到明确驳回备注/);assert.match(h.html(),/（源备注为空）/);
 const operators=fixture({...stateData,total:1,rows:[{operator:'synthetic-agent',count:11,categoryCount:1,missingReasonCount:10,operatorKey:'a'.repeat(32)}]},'operators');assert.match(operators.html(),/已知原备注种类\|无可用驳回备注/);assert.doesNotMatch(operators.html(),/不同原备注\|备注为空/);
});

test('verified front evidence displays the confirmed text and provenance without claiming original collector text was recovered',()=>{
 const h=fixture({...stateData,total:1,rows:[{orderNumber:'SYNTHETIC-VERIFIED',status:'rejected',rawRejectionReason:'Synthetic confirmed front business text',rejectionReason:'Synthetic confirmed front business text',rejectionNoteState:'present',sourceNoteStates:{remark:'template',front:'withheld',back:'empty'},hiddenNoteSources:['front'],verifiedRejectionNote:{sourceField:'frontRemark',verificationMethod:'manual_source_ui',verifiedAt:'2026-09-30T05:00:00Z'}}]},'orders');
 assert.match(h.html(),/Synthetic confirmed front business text/);assert.match(h.html(),/前台备注：已在源站核实/);assert.doesNotMatch(h.html(),/前台备注：已隐藏/);assert.equal(h.page.state.reasonData.rows[0].sourceNoteStates.front,'withheld');
});
