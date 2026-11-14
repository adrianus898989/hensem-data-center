const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const escape=value=>String(value??'').replace(/[<>&"']/g,k=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[k]));
const next=()=>new Promise(r=>setImmediate(r));
function harness(fetch){
 const root={AbortController,hensemRoleAccess:{canView:true,mode:'owner'},hensemDataScope:{identity:'viewer-A'},hensemRoleAllowed:()=>true};
 const calls=[];let api,html='',drawer='',page='workorders';const render=()=>{html=api.render();};
 const L={catalogReady:true,country:'印度',catalog:[{id:'test-native',name:'Example',country:'印度',team:'M8',timezone:'Asia/Kolkata'}]};
 for(const file of ['live-deposit-tickets.js','live-workorder-operations.js']){
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview',file),'utf8'),{window:root,Date,Promise});
 }
 root.closeDrawer=()=>{drawer='';};
 api=root.HensemLiveWorkorderOperations.create({L,E:escape,C:String,formatTime:(t)=>t,
  box:(t,b,n)=>'<h2>'+t+'</h2>'+b+n,table:(headers,rows)=>'<table>'+headers.map(h=>'<th>'+h+'</th>').join('')+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</table>',
  request:(q,o)=>{calls.push(q);return fetch(q,o);},render,page:()=>page,openDrawer:(title,body)=>{drawer=title+body;}});
 return {root,L,api,calls,render,page:k=>{page=k;},html:()=>html,drawer:()=>drawer};
}
const rows=[
 {source:'AR',platform:'Example',workorderId:'AR-1',issueKind:'deposit',workorderNo:null,orderNo:'shared-order',statusCode:4,statusLabel:'已处理',requestedAmount:'100.50',requestedCurrency:'INR',receiptStatus:'Wait',timezone:'Asia/Kolkata'},
 {source:'NEW_AR',platform:'Example',workorderId:'AR-1',sourcePlatform:'Example',issueKind:'deposit',orderNo:'shared-order',workorderType:'USDT存款未到账自动化',requestedAmount:'9007199254740993.12345678',requestedCurrency:null,paidAmount:null,paidCurrency:null,currency:'INR',statusCode:3,statusLabel:'已驳回',provider:'<example>',reminderCount:0,utrMatched:false,receiptStatus:'Payed',timezone:'Asia/Kolkata'}
];
const result=(q,extra={})=>({view:'depositTickets',sourceStatus:'ready',canDetail:true,rows,hasMore:false,offset:q.offset,limit:q.limit,...extra});
test('default view reads a single bounded ticket list; two tickets for one payment keep their own source, amount, currency and receipt state',async()=>{
 const h=harness(async q=>result(q));h.render();h.render();await next();h.render();
 assert.equal(h.calls.length,1);const [q]=h.calls;
 assert.equal(q.operation,'list');assert.equal(q.view,'depositTickets');assert.equal(q.limit,20);assert.equal(q.offset,0);assert(q.filters.from&&q.filters.to);
 assert.equal((h.html().match(/shared-order/g)||[]).length,2);assert.match(h.html(),/等待（Wait）/);assert.match(h.html(),/已支付（Payed）/);
 h.root.workorderDepositDetail(1);assert.equal(h.calls.length,1);assert.match(h.drawer(),/USDT存款未到账自动化/);
 assert.match(h.drawer(),/申请币种<\/dt><dd>—/);assert.match(h.drawer(),/实付金额<\/dt><dd>—/);assert.match(h.drawer(),/9,007,199,254,740,993\.12345678/);
 assert.match(h.drawer(),/催单次数<\/dt><dd>0/);assert.match(h.drawer(),/UTR 匹配<\/dt><dd>否/);assert.match(h.drawer(),/&lt;example&gt;/);
 assert.match(h.html(),/存款未到账明细/);assert.equal(h.api.canExportDeposit(),true);
});
test('deposit date pair follows four selectors in its own wide grid track',()=>{
 const h=harness(async q=>result(q));h.render();
 const primary=h.html().split('class="wo-filter-grid wo-records-primary wo-deposit-primary">')[1].split('class="wo-filter-grid wo-more"')[0];
 const [selectors,dates]=primary.split('<div class="wo-filter-dates">');
 assert.equal((selectors.match(/<select /g)||[]).length,4);
 assert.equal((dates.split('</div>')[0].match(/type="date"/g)||[]).length,2);
 const css=fs.readFileSync(path.join(__dirname,'../admin-preview/live-configuration.css'),'utf8');
 assert.match(css,/\.wo-deposit-primary\s*\{\s*--wo-select-count:\s*4\b/);
 assert.match(css,/\.wo-records-primary\s*\{\s*grid-template-columns:repeat\(var\(--wo-select-count,5\)/);
});
test('filter edits abort old reads; next page uses the committed query and late rows never repaint under new scope',async()=>{
 let resolve,signal;const h=harness((q,o)=>{if(!q.filters.orderNo){signal=o.signal;return new Promise(r=>{resolve=r;});}return Promise.resolve(result(q,{hasMore:q.offset===0,nextCursor:q.offset===0?{at:'2026-11-08T17:05:00.123456Z',p:'native',t:'6006',k:'AR-1',h:'filter-key'}:null}));});
 h.render();await next();assert.equal(h.calls.length,1);h.root.workorderOperationsSet('orderNo','new filter',false);
 assert.equal(signal.aborted,true);resolve(result(h.calls[0],{rows:[{...rows[0],workorderNo:'LATE-ROW'}]}));await next();h.render();
 assert.doesNotMatch(h.html(),/LATE-ROW/);assert.equal(h.calls.length,1);await h.api.load(true);
 await h.root.workorderDepositPage(1);assert.deepEqual(h.calls.map(q=>q.offset),[0,0,20]);assert.equal(h.calls[2].filters.orderNo,'new filter');assert.equal(h.calls[2].cursor.at,'2026-11-08T17:05:00.123456Z');
 await h.root.workorderDepositPage(-1);assert.equal(h.calls[3].offset,0);assert.equal(h.calls[3].cursor,undefined);
 h.root.workorderDepositDetail(0);h.root.hensemRoleAccess.canView=false;h.render();assert.equal(h.drawer(),'');assert.equal(h.api.canExportDeposit(),false);assert.doesNotMatch(h.html(),/shared-order/);
});
test('unconnected scopes have a separate state and mode switching cancels a pending ticket request',async()=>{
 let signal;const h=harness((q,o)=>{signal=o.signal;return Promise.resolve(result(q,{rows:[],sourceStatus:'not_connected'}));});h.render();await next();
 assert.match(h.html(),/没有接入存款工单明细/);assert.doesNotMatch(h.html(),/当前条件下没有已采集/);
 const pending=harness((q,o)=>{signal=o.signal;return new Promise(()=>{});});pending.render();await next();pending.root.workorderOperationsMode('orders');
 assert.equal(signal.aborted,true);assert.equal(pending.api.isDeposit(),false);
});

test('query-only roles see ticket identifiers but cannot open detail or reuse a previous role’s drawer',async()=>{
 const h=harness(async q=>result(q,{canDetail:false}));h.root.hensemRoleAllowed=(_page,action)=>action!=='detail';h.render();await next();
 assert.match(h.html(),/AR-1/);assert.doesNotMatch(h.html(),/onclick="workorderDepositDetail/);
 h.root.workorderDepositDetail(0);assert.equal(h.drawer(),'');
});

test('settled permission and empty-catalog states explain why the list cannot query',async()=>{
 const h=harness(async()=>{throw Error('unexpected request')});h.root.hensemRoleAllowed=(_page,action)=>action!=='query';
 h.render();await next();assert.match(h.html(),/没有工单查询权限/);assert.equal(h.calls.length,0);
 h.root.hensemRoleAllowed=()=>true;h.L.catalog=[];h.render();await next();assert.match(h.html(),/没有可查询的平台/);assert.equal(h.calls.length,0);
});

test('reset and reopen start a single fresh read even when the account scope is unchanged',async()=>{
 const h=harness(async q=>result(q));h.render();await next();assert.equal(h.calls.length,1);
 h.root.workorderOperationsReset();await next();assert.equal(h.calls.length,2);
 h.api.clear('workorders');h.render();h.render();await next();assert.equal(h.calls.length,3);
});

function currentRows(h){
 const [labels,...items]=h.api.exportDepositRows();
 return items.map(values=>Object.fromEntries(labels.map((label,i)=>[label,values[i]])));
}

test('one clickable ticket number matches the displayed filter; the drawer alone distinguishes a different native ID',async()=>{
 const tickets=[{...rows[0],workorderNo:'ticket-A',workorderId:'ticket-A'},
  {...rows[0],workorderNo:'ticket-B',workorderId:'internal-B'},
  {...rows[1],workorderId:'only-id'}];
 const h=harness(async q=>result(q,{rows:tickets}));h.render();await next();
 assert.doesNotMatch(h.html(),/工单 ID|internal-B/);
 for(const [i,ticket] of tickets.entries()){
  const shown=ticket.workorderNo||ticket.workorderId;
  assert.ok(h.html().includes('onclick="workorderDepositDetail('+i+')">'+shown+'</button>'));
  h.root.workorderDepositDetail(i);
  assert.equal(h.drawer().includes('<dt>来源工单 ID</dt>'),i===1);
  if(i===1)assert.match(h.drawer(),/<dd>internal-B<\/dd>/);
 }
 assert.deepEqual(Array.from(currentRows(h),r=>r['工单号']),['ticket-A','ticket-B','only-id']);
 h.root.workorderOperationsSet('workorderNo','only-id',false);await h.api.load(true);
 assert.equal(h.calls.at(-1).filters.workorderNo,'only-id');assert.equal(h.calls.at(-1).filters.workorderId,undefined);
});

test('ticket fields, matched recharge values, source currency and update-only times remain distinct in the list, drawer and CSV',async()=>{
 const order={match:'matched',status:'已支付',amount:'9007199254740993.25',currency:null,provider:'RechargePay',utr:'source-utr',completedAt:'receipt-time'};
 const tickets=[{...rows[0],receiptStatus:null,ticketEvidence:'snapshot_only',lastUpdatedBy:'source-updater',sourceOperatedAt:'update-only',sourceUpdatedAt:'update-only',operationTimeSource:'lastUpdateTime',rechargeOrder:order},
  {...rows[1],operatedAt:'handled-time',provider:'TicketPay',rechargeOrder:{...order,status:'Cancel',provider:'DifferentPay'}}];
 const h=harness(async q=>result(q,{rows:tickets}));h.render();await next();
 const [a,b]=currentRows(h);
 assert.equal(a['充值状态'],'已支付');assert.equal(a['充值状态来源'],'充值单');assert.equal(a['工单金额'],'—');
 for(const label of ['申请金额','申请币种','关联充值金额','关联充值币种']){
  assert.equal(a[label],undefined);assert.ok(!h.html().includes('<th>'+label+'</th>'));
 }
 assert.equal(a['UTR'],'source-utr');assert.equal(a['UTR来源'],'充值单');assert.equal(a['工单处理 / 更新'],'update-only');assert.equal(a['工单处理 / 更新来源'],'最后更新');
 assert.equal(a['工单采集记录'],'仅状态快照');assert.equal(a['工单操作 / 更新人'],'source-updater');assert.equal(a['工单操作 / 更新人来源'],'最后更新人');
 assert.equal(b['三方'],'TicketPay');assert.equal(b['三方来源'],'工单');assert.equal(b['充值状态'],'已取消（Cancel）');assert.equal(b['充值状态来源'],'充值单');assert.equal(b['工单处理 / 更新来源'],'处理时间');
 assert.match(h.html(),/RechargePay <small[^>]*>充值单/);assert.match(h.html(),/update-only <small[^>]*>最后更新/);
 h.root.workorderDepositDetail(0);assert.match(h.drawer(),/<dt>操作时间<\/dt><dd>—/);assert.match(h.drawer(),/来源最后更新时间<\/dt><dd>update-only/);
 assert.match(h.drawer(),/关联充值单/);assert.match(h.drawer(),/充值完成时间<\/dt><dd>receipt-time/);
 assert.match(h.drawer(),/充值订单金额<\/dt><dd>9,007,199,254,740,993\.25</);assert.match(h.drawer(),/申请币种<\/dt><dd>INR</);
 assert.match(h.drawer(),/来源支付时间<\/dt><dd>—/);assert.match(h.drawer(),/工单内充值状态<\/dt><dd>—/);
 h.root.workorderDepositDetail(1);assert.match(h.drawer(),/TicketPay/);assert.match(h.drawer(),/DifferentPay/);assert.match(h.drawer(),/已取消（Cancel）/);
 assert.equal(h.calls.length,1);
});

test('ticket money displays only significant decimal digits and keeps unknown and exact integer values in both list and CSV',async()=>{
 const inputs=['10000.00000000','2500.10500000','9007199254740993.00000001','0.00000000',null,'-3456.70010000'];
 const expected=['10,000','2,500.105','9,007,199,254,740,993.00000001','0','—','-3,456.7001'];
 const tickets=inputs.map((amount,i)=>({...rows[0],amount,rechargeOrder:{match:'matched',amount:i===4?'501.2300':amount}}));
 const h=harness(async q=>result(q,{rows:tickets}));h.render();await next();
 assert.deepEqual(Array.from(currentRows(h),r=>r['工单金额']),expected);
 for(const value of expected)assert.ok(h.html().includes('<td>'+value+'</td>'));
 h.root.workorderDepositDetail(4);
 assert.match(h.drawer(),/<dt>工单金额<\/dt><dd>—</);assert.match(h.drawer(),/<dt>充值订单金额<\/dt><dd>501\.23</);
});
test('linked callback evidence is shown only for an authorized unique match and stays separate from ticket processing and order payment',async()=>{
 const tickets=[
  {status:'已支付',callbackOutcome:'confirmed',match:'matched'},
  {status:'已回调',callbackOutcome:'confirmed',match:'matched'},
  {status:'已支付',match:'matched'},
  {status:'待支付',callbackOutcome:'confirmed',match:'matched'},
  {status:'已回调',callbackOutcome:'confirmed',match:'ambiguous'},
  {status:null,match:'matched'},
  {status:'已取消',callbackOutcome:'cancelled',match:'matched'},
  {status:'已取消',callbackOutcome:'confirmed',match:'matched'}
 ].map(rechargeOrder=>({...rows[0],receiptStatus:'Wait',rechargeOrder}));
 const h=harness(async q=>result(q,{rows:tickets}));h.render();await next();
 assert.deepEqual(Array.from(currentRows(h),r=>[r['充值状态'],r['充值状态来源']]),[
  ['已支付 · 已回调','充值单'],['已回调','充值单'],['已支付','充值单'],['待支付','充值单'],['等待（Wait）','工单'],['等待（Wait）','工单'],
  ['已取消 · 已回调（取消）','充值单'],['已取消','充值单']
 ]);
 assert.match(h.html(),/已支付 <small[^>]*>已回调 · 充值单</);
 assert.match(h.html(),/已取消 <small[^>]*>已回调（取消） · 充值单</);
 assert.match(h.html(),/已回调 <small[^>]*>充值单</);
 h.root.workorderDepositDetail(0);
 assert.match(h.drawer(),/<dt>工单内充值状态<\/dt><dd>等待（Wait）</);assert.match(h.drawer(),/<dt>充值状态<\/dt><dd>已支付</);assert.match(h.drawer(),/<dt>回调状态<\/dt><dd>已回调</);
 h.root.hensemRoleAllowed=(page,action)=>!['orders','collection'].includes(page)||action!=='detail';h.render();await next();
 assert.ok(currentRows(h).every(r=>r['充值状态']==='等待（Wait）'&&r['充值状态来源']==='工单'));assert.doesNotMatch(h.html(),/已回调/);
});

test('ambiguous and missing recharge matches cannot expose candidate fields or fill an unknown ticket value',async()=>{
 const tickets=['ambiguous','not_found','no_reference'].map(match=>({...rows[0],receiptStatus:null,rechargeOrder:{match,provider:'candidate-only',amount:'88888'}}));
 const h=harness(async q=>result(q,{rows:tickets}));h.render();await next();
 assert.doesNotMatch(h.html(),/candidate-only|88,888/);
 for(const [i,reason] of ['匹配到多张充值单','未找到相同支付订单号','工单缺支付订单号'].entries()){
  h.root.workorderDepositDetail(i);assert.ok(h.drawer().includes(reason));assert.doesNotMatch(h.drawer(),/candidate-only|88,888/);
 }
 for(const row of currentRows(h)){assert.equal(row['关联充值金额'],undefined);assert.equal(row['三方'],'—');assert.equal(row['三方来源'],'');}
});

test('revoked recharge access invalidates the released page and open drawer, while native ticket detail remains accessible',async()=>{
 let permitted=true;const h=harness(async q=>result(q,{rows:[{...rows[0],rechargeOrder:{match:'matched',provider:'restricted-provider'}}]}));
 h.root.hensemRoleAllowed=(page,action)=>!['orders','collection'].includes(page)||permitted||action!=='detail';
 h.render();await next();h.root.workorderDepositDetail(0);assert.match(h.drawer(),/restricted-provider/);
 permitted=false;h.render();assert.equal(h.drawer(),'');assert.equal(h.api.exportDepositRows().length,0);await next();
 assert.doesNotMatch(h.html(),/restricted-provider|关联充值金额/);h.root.workorderDepositDetail(0);
 assert.match(h.drawer(),/工单信息/);assert.doesNotMatch(h.drawer(),/restricted-provider|关联充值单|未找到相同支付订单号/);
 assert.equal(currentRows(h)[0]['关联充值金额'],undefined);
});
