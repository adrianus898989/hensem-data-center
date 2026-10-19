const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const integration=process.env.WORKORDER_TEST_BASE||path.resolve(__dirname,'..'),tests=path.join(integration,'tests');
let prefix=fs.readFileSync(path.join(tests,'admin-workorder-analysis-ui.test.cjs'),'utf8').split(/\ntest\(/)[0];
prefix=prefix.replace("fs.readFileSync(path.join(__dirname,'../admin-preview/live-workorder-operations.js'),'utf8')","fs.readFileSync("+JSON.stringify(path.join(__dirname,'../admin-preview/live-workorder-operations.js'))+",'utf8')");
const {harness,summary,record,card,plain}=new Function('require','__dirname',prefix+';return {harness,summary,record,card,plain};')(require,tests);
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
function response(q,edit=()=>{}){
 const data={...summary(),ok:true,source:'AR',sourceStatus:'ready',version:1,view:q.view,operation:q.operation,country:'印度',countryCode:'IN',timezone:'Asia/Kolkata',currency:'INR',startDate:q.filters.from,endDate:q.filters.to,dateBasis:q.filters.dateBasis||'submission',allHistory:false,platforms:['SYNTHETIC'],rows:[record],total:137,offset:q.offset||0,limit:q.limit||20};
 data.current.coverage.source='AR';edit(data);return data;
}
function setup(){
 const h=harness();vm.runInNewContext(fs.readFileSync(path.join(integration,'admin-preview/live-comparison.js'),'utf8'),{window:h.root});
 h.root.AbortController=AbortController;h.root.hensemRoleAccess={mode:'owner',canView:true,permissions:[],version:1};h.root.hensemDataScope={mode:'all',identity:'synthetic-owner-one'};h.root.hensemRoleAllowed=()=>h.root.hensemRoleAccess.canView===true;
 h.root.workorderOperationsSet('from','2026-10-11');h.root.workorderOperationsSet('to','2026-10-17');return h;
}
test('default uses returned current then one prior list without running the two-period summary',async()=>{
 const h=setup(),prior=deferred();h.respond(q=>q.filters.from==='2026-10-04'?prior.promise:response(q));const run=h.module.load(true);await settle();
 assert.equal(h.calls.length,2);assert(h.calls.every(q=>q.operation==='list'&&q.view==='orders'));assert.equal(h.calls[1].filters.from,'2026-10-04');assert.equal(h.calls[1].filters.to,'2026-10-10');assert.equal(h.calls[1].offset,0);assert.equal(h.calls[1].limit,20);
 const s=h.module.state();assert.equal(s.analysis,null);assert(s.currentOnly);assert.match(h.html(),/前期读取中/);assert.match(h.html(),/读取三方分析/);
 await h.root.workorderOperationsSummaryRetry();assert.equal(h.calls.length,2);assert.equal(h.calls.filter(q=>q.operation==='summary').length,0);
 prior.resolve(response(h.calls[1],d=>{d.current.ticketCount=7;d.current.uniqueOrderAmount=null;}));await run;
 assert.equal(s.analysis,null);assert.equal(s.previousPeriod.current.ticketCount,7);assert.equal(s.previousPeriod.current.uniqueOrderAmount,null);assert.match(plain(card(h.html(),'ticketCount')),/前期：7 笔/);assert.doesNotMatch(h.html(),/增减.*[+-]\d/);
 const committed=JSON.stringify(h.calls[0].filters);assert.equal(JSON.stringify({...h.calls[1].filters,from:'2026-10-11',to:'2026-10-17'}),committed);
 h.module.state().current=2;h.respond(q=>response(q));await h.module.load();assert.equal(h.calls.length,3);assert.equal(h.calls[2].offset,20);assert.equal(s.previousPeriod.current.ticketCount,7);
});
test('full original summary remains an explicit on-demand request and replaces all provisional sections',async()=>{
 const h=setup();h.respond(q=>response(q));await h.module.load(true);assert.equal(h.calls.filter(q=>q.operation==='summary').length,0);
 await h.root.workorderOperationsSummaryRetry();assert.equal(h.calls.filter(q=>q.operation==='summary').length,1);assert(h.module.state().analysis);assert.equal(h.module.state().currentOnly,null);
});
test('prior failure preserves valid current and explicit prior retry does not request full summary',async()=>{
 const h=setup();h.respond(q=>q.filters.from==='2026-10-04'?Promise.reject(Error('prior timeout')):response(q));await h.module.load(true);assert.match(h.html(),/prior timeout/);assert(h.module.state().currentOnly);assert.equal(h.module.state().previousPeriod.current,null);
 h.respond(q=>response(q));await h.root.workorderOperationsPreviousRetry();assert(h.module.state().previousPeriod.current);assert.equal(h.calls.filter(q=>q.operation==='summary').length,0);
});
for(const [name,change]of[
 ['actor',h=>h.root.hensemDataScope.identity='other-actor'],['permission',h=>h.root.hensemRoleAccess.canView=false],['native',h=>h.L.catalog[0].timezone='UTC'],['filter',h=>h.root.workorderOperationsSet('provider','other')],['mode',h=>h.root.workorderOperationsMode('records')],['pause',h=>h.module.pause()]
])test(name+' changes ignore a late prior and clear its ownership',async()=>{
 const h=setup(),prior=deferred();h.respond(q=>q.filters.from==='2026-10-04'?prior.promise:response(q));const run=h.module.load(true);await settle();const old=h.module.state().previousPeriod;change(h);h.module.render();assert.equal(old.controller?.signal.aborted??true,true);
 prior.resolve(response(h.calls[1]));await run;assert.equal(h.module.state().previousPeriod,null);assert.equal(h.module.state().analysis,null);
});
test('mismatched prior source/version/native identity never becomes a completed comparison',async()=>{
 for(const edit of[d=>d.source='NEWAR',d=>d.version=2,d=>d.platforms=['OTHER'],d=>d.endDate='2026-10-09',d=>d.timezone='UTC',d=>d.current.ticketAmount=0]){
  const h=setup();h.respond(q=>response(q,q.filters.from==='2026-10-04'?edit:()=>{}));await h.module.load(true);assert.equal(h.module.state().previousPeriod.current,null);assert.match(h.html(),/前期响应范围不一致/);
 }
});
test('NULLs and high precision originals are never converted into deltas or missing provider totals',async()=>{
 const h=setup(),exact='12345678901234567890.12345678';h.respond(q=>response(q,d=>{d.current.ticketAmount=exact;d.current.uniqueOrderCount=null;d.current.uniqueOrderAmount=null;d.current.coverage={...d.current.coverage,status:'partial',missingOrderNumberCount:20};}));await h.module.load(true);
 assert.equal(h.module.state().currentOnly.current.ticketAmount,exact);assert.equal(h.module.state().previousPeriod.current.ticketAmount,exact);assert.equal(h.module.state().previousPeriod.current.uniqueOrderAmount,null);assert.equal(h.module.state().analysis,null);assert.doesNotMatch(h.html(),/NaN|Infinity/);
});
test('existing calendar helper shifts Gregorian local dates across DST without UTC instant arithmetic',async()=>{
 const h=setup();h.L.country='巴西';h.L.catalog=[{name:'SYNTHETIC',country:'巴西',timezone:'America/Sao_Paulo'}];h.root.workorderOperationsSet('country','巴西');h.root.workorderOperationsSet('from','2026-03-07');h.root.workorderOperationsSet('to','2026-03-09');
 h.respond(q=>response(q,d=>{d.country='巴西';d.countryCode='BR';d.timezone='America/Sao_Paulo';d.currency='BRL';}));await h.module.load(true);assert.equal(h.calls[1].filters.from,'2026-03-04');assert.equal(h.calls[1].filters.to,'2026-03-06');
});
test('unsupported or ambiguous calendar/metadata retains the original full summary path',async()=>{
 const h=setup();delete h.root.HensemLiveCompare;h.respond(q=>response(q));await h.module.load(true);assert.equal(h.calls[1].operation,'summary');
});
test('a superseded query cannot republish an old prior snapshot',async()=>{
 const h=setup(),old=deferred();h.respond(q=>q.filters.from==='2026-10-04'?old.promise:response(q));const before=h.module.load(true);await settle();
 h.root.workorderOperationsSet('from','2026-10-18');h.root.workorderOperationsSet('to','2026-10-18');h.respond(q=>response(q,d=>d.current.ticketCount=30));await h.module.load(true);
 const retained=h.module.state().currentOnly.current;old.resolve(response(h.calls[1],d=>d.current.ticketCount=999));await before;
 assert.equal(h.module.state().currentOnly.current,retained);assert.equal(retained.ticketCount,30);assert.equal(h.module.state().previousPeriod.current.ticketCount,30);assert.equal(h.module.state().previousPeriod.range.from,'2026-10-17');
});
test('current permission denial clears provisional sections while old late denial cannot clear fresh ones',async()=>{
 const h=setup();h.respond(q=>q.filters.from==='2026-10-04'?Promise.reject(Object.assign(Error('denied'),{code:'ADMIN_LIVE_PERMISSION_DENIED'})):response(q));await h.module.load(true);assert.equal(h.module.state().currentOnly,null);assert.equal(h.module.state().previousPeriod,null);
 const next=setup(),old=deferred();next.respond(q=>q.filters.from==='2026-10-04'?old.promise:response(q));const first=next.module.load(true);await settle();next.root.workorderOperationsSet('from','2026-10-18');next.root.workorderOperationsSet('to','2026-10-18');next.respond(q=>response(q));await next.module.load(true);const current=next.module.state().currentOnly;
 old.reject(Object.assign(Error('old denial'),{code:'ADMIN_LIVE_PERMISSION_DENIED'}));await first;assert.equal(next.module.state().currentOnly,current);assert(next.module.state().previousPeriod.current);
});
test('calendar helper rejects unsupported DST midnight rather than inventing a prior date window',async()=>{
 const h=setup();h.L.country='智利';h.L.catalog=[{name:'SYNTHETIC',country:'智利',timezone:'America/Santiago'}];h.root.workorderOperationsSet('country','智利');h.root.workorderOperationsSet('from','2026-09-06');h.root.workorderOperationsSet('to','2026-09-06');
 h.respond(q=>response(q,d=>{d.country='智利';d.countryCode='CL';d.timezone='America/Santiago';d.currency='CLP';}));await h.module.load(true);assert.equal(h.calls[1].operation,'summary');
});
test('partial prior original counts retain their returned values and identify their own coverage gap',async()=>{
 const h=setup();h.respond(q=>response(q,d=>{if(q.filters.from==='2026-10-04'){d.current.uniqueOrderCount=7;d.current.uniqueOrderAmount=null;d.current.coverage={...d.current.coverage,status:'partial',missingOrderNumberCount:2,missingAmountCount:1};}}));await h.module.load(true);
 assert.equal(h.module.state().currentOnly.current.coverage.status,'complete');assert.equal(h.module.state().previousPeriod.current.uniqueOrderCount,7);assert.equal(h.module.state().previousPeriod.current.uniqueOrderAmount,null);
 assert.match(h.html(),/data-workorder-prior-coverage/);assert.match(plain(card(h.html(),'uniqueOrderCount')),/前期（部分）：7 笔 · — INR/);assert.match(h.html(),/前期覆盖：2 张缺原单号，未去重；1 个原单缺金额/);
});
test('paging aborts an obsolete explicit-summary transport without discarding the completed prior',async()=>{
 const h=setup();h.respond(q=>response(q));await h.module.load(true);const prior=h.module.state().previousPeriod,old=deferred();h.respond(q=>q.operation==='summary'?old.promise:response(q));
 const run=h.root.workorderOperationsSummaryRetry();await settle();const controller=h.module.state().analysisController;assert(controller);h.module.state().current=2;await h.module.load();assert.equal(controller.signal.aborted,true);assert.equal(h.module.state().previousPeriod,prior);
 old.resolve(response(h.calls.find(q=>q.operation==='summary')));await run;assert.equal(h.module.state().analysis,null);assert.equal(h.module.state().previousPeriod,prior);
});
