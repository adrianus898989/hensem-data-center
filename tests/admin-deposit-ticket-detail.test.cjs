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
