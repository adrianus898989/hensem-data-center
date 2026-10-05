// Synthetic data only: platform partitioning, honest partial results, and bounded reads.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'../admin-preview',name),'utf8');
const moduleSource=read('live-workorder-reconciliation-batch.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const plain=value=>JSON.parse(JSON.stringify(value));
const query=(extra={})=>({action:'workorderRecords',view:'missing',operation:'list',country:'印度',filters:{dateBasis:'submission',issueKind:'deposit',successBasis:'processed',registrationStatus:'missing',platform:'',from:'2026-10-01',to:'2026-10-31'},offset:0,limit:20,...extra});
const directory=platforms=>({ok:true,version:2,operation:'reconciliationPlatforms',view:'missing',country:'印度',countryCode:'IN',currency:'INR',platforms});
function response(platform,q,total,extra={}){
 const summary={candidateCount:total+5,pendingCount:total,excludedSuccessCount:5,missingCount:total,matchedCount:0,reviewCount:0,unknownAmountCount:0,missingAmount:total,missingAmountExact:String(total),matchedAmount:0,matchedAmountExact:'0',reviewAmount:0,reviewAmountExact:'0',latestCollectedAt:'2026-10-05T01:00:00Z',...extra.summary};
 return {ok:true,version:2,countryCode:'IN',sourceStatus:'ready',currency:'INR',successBasis:q.filters.successBasis,total,platforms:[platform],coverage:{expectedPlatforms:1,platformsWithRecords:total?1:0,platforms:[{platform,selectedWorkorders:total+5,registrationPresent:true}]},rows:Array.from({length:Math.min(q.limit,Math.max(0,total-q.offset))},(_,i)=>({id:platform+'-'+(q.offset+i),platform,orderNo:'000000000000000000'+(q.offset+i),amount:'1',currency:'INR',workorderCount:1,processingState:'unprocessed',registrationStatus:q.filters.registrationStatus,submittedAt:'2026-10-05T01:00:00Z'})),...extra,summary};
}
function harness(handler){const root={},calls=[];vm.runInNewContext(moduleSource,{window:root,AbortController});const loader=root.HensemWorkorderReconciliationBatch.create({request:async(q,options)=>{calls.push({q,options});return handler(q,options,calls);},scopeIdentity:()=>root.scope||'scope-a',now:()=> '2026-10-05T01:30:00Z'});return {root,calls,loader};}
test('all-platform first read is serial, with server directory, canonical partition order, and progress',async()=>{
 const platforms=Array.from({length:17},(_,i)=>'P'+String(i).padStart(2,'0'));let active=0,max=0;
 const h=harness(async q=>{if(q.operation==='reconciliationPlatforms')return directory(platforms);active++;max=Math.max(max,active);await tick();active--;return response(q.filters.platform,q,Number(q.filters.platform.slice(1))+1);});const progress=[];
 const result=await h.loader.load(query(),{onProgress:v=>progress.push(v)});
 assert.equal(max,1);assert.equal(h.calls.length,18);assert.deepEqual(plain(h.calls[0].q),{action:'workorderRecords',view:'missing',operation:'reconciliationPlatforms',country:'印度',filters:{dateBasis:'submission',issueKind:'deposit'}});
 assert.equal(result.total,153);assert.equal(result.summary.pendingCount,153);assert.equal(result.summary.excludedSuccessCount,85);assert.equal(result.coverage.expectedPlatforms,17);assert.equal(result.batch.successfulPlatforms,17);
 assert.equal(result.rows.length,20);assert.equal(result.rows[0].platform,'P16');assert.equal(result.rows[16].platform,'P16');assert.equal(result.rows[17].platform,'P15');assert.equal(progress.filter(p=>p.phase==='platforms'&&p.done===17).length,1);
 assert.equal(h.calls.slice(1).every(c=>c.q.offset===0&&c.q.limit===20),true);
});
test('global pages are platform intervals, including boundaries and direct last-page reads',async()=>{
 const totals={A:205,B:122,C:31};const h=harness(q=>q.operation==='reconciliationPlatforms'?directory(['C','B','A']):response(q.filters.platform,q,totals[q.filters.platform]));
 let result=await h.loader.load(query());assert.equal(result.rows[0].id,'A-0');assert.equal(h.calls.length,4);
 result=await h.loader.load(query({offset:200}));assert.deepEqual(plain(result.rows.map(r=>r.id)),[...Array.from({length:5},(_,i)=>'A-'+(200+i)),...Array.from({length:15},(_,i)=>'B-'+i)]);assert.equal(h.calls.length,5);assert.equal(h.calls[4].q.offset,200);assert.equal(h.calls[4].q.limit,20);
 const before=h.calls.length;result=await h.loader.load(query({offset:340}));assert.equal(result.rows.length,18);assert.equal(result.rows[0].id,'C-13');assert.equal(result.rows.at(-1).id,'C-30');assert.equal(h.calls.length,before+1);assert.equal(h.calls.at(-1).q.filters.platform,'C');assert.equal(h.calls.at(-1).q.offset,13);assert.equal(h.calls.at(-1).q.limit,20);
});
test('partial interval requests stay serial, round to supported limits and trim surplus rows without skipping',async()=>{
 const totals={A:149,B:101};let active=0,max=0;const h=harness(async q=>{if(q.operation==='reconciliationPlatforms')return directory(['A','B']);active++;max=Math.max(max,active);await tick();active--;return response(q.filters.platform,q,totals[q.filters.platform]);});await h.loader.load(query());max=0;
 const result=await h.loader.load(query({offset:100,limit:100}));assert.equal(max,1);assert.equal(result.rows.length,100);assert.equal(result.rows[48].id,'A-148');assert.equal(result.rows[49].id,'B-0');assert.equal(result.rows.at(-1).id,'B-50');assert.deepEqual(h.calls.slice(-2).map(c=>[c.q.filters.platform,c.q.offset,c.q.limit]),[['A',100,50],['B',0,100]]);
});
test('cancelling an uncached cross-platform page aborts its only active read and skips the next platform',async()=>{
 const totals={A:149,B:101};let paused=false;const h=harness((q,{signal})=>q.operation==='reconciliationPlatforms'?directory(['A','B']):paused?new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('cancelled'),{name:'AbortError'})),{once:true})):response(q.filters.platform,q,totals[q.filters.platform]));
 await h.loader.load(query());paused=true;const before=h.calls.length,running=h.loader.load(query({offset:100,limit:100}));await tick();assert.equal(h.calls.length,before+1);assert.equal(h.calls.at(-1).q.filters.platform,'A');h.loader.cancel();await assert.rejects(running,/查询已取消/);await tick();assert.equal(h.calls.length,before+1);assert.equal(h.calls.at(-1).options.signal.aborted,true);
});
test('decimal strings retain 8 places beyond Number precision and unknown amounts remain unknown',async()=>{
 const h=harness(q=>q.operation==='reconciliationPlatforms'?directory(['A','B']):response(q.filters.platform,q,1,{summary:q.filters.platform==='A'?{missingAmount:1234567890123456,missingAmountExact:'1234567890123456.12345678',reviewAmountExact:null}:{missingAmount:0.00000002,missingAmountExact:'0.00000002',reviewAmountExact:'0'}}));
 const r=await h.loader.load(query());assert.equal(r.summary.missingAmount,'1234567890123456.1234568');assert.equal(r.summary.matchedAmount,'0');assert.equal(r.summary.reviewAmount,null);
 const signed=harness(q=>q.operation==='reconciliationPlatforms'?directory(['A','B']):response(q.filters.platform,q,1,{summary:{missingAmountExact:q.filters.platform==='A'?'-0.25':'0.1'}}));assert.equal((await signed.loader.load(query())).summary.missingAmount,'-0.15');
});
test('platform failure never becomes zero or a full-scope total; explicit refresh is the only retry',async()=>{
 let broken=true;const h=harness(q=>{if(q.operation==='reconciliationPlatforms')return directory(['A','B']);if(q.filters.platform==='B'&&broken)throw Error('读取超时');return response(q.filters.platform,q,2);});
 let r=await h.loader.load(query());assert.equal(r.sourceStatus,'partial');assert.equal(r.batch.partial,true);assert.equal(r.total,2);assert.equal(r.summary.pendingCount,2);assert.equal(r.coverage.expectedPlatforms,2);assert.equal(r.batch.successfulPlatforms,1);assert.equal(r.batch.failures[0].platform,'B');assert.equal(h.calls.length,3);
 r=await h.loader.load(query());assert.equal(h.calls.length,3);assert.equal(r.batch.partial,true);broken=false;r=await h.loader.load(query(),{refresh:true});assert.equal(h.calls.length,6);assert.equal(r.total,4);assert.equal(r.batch.partial,false);
 const failed=harness(q=>{if(q.operation==='reconciliationPlatforms')return directory(['A']);throw Error('timeout');});const empty=await failed.loader.load(query());assert.equal(empty.summary.pendingCount,null);assert.equal(empty.summary.missingAmount,null);assert.equal(empty.coverage.platformsWithRecords,null);assert.equal(empty.batch.successfulPlatforms,0);
 const none=harness(()=>directory([]));const zero=await none.loader.load(query());assert.equal(zero.summary.pendingCount,0);assert.equal(zero.summary.missingAmount,'0');assert.equal(zero.batch.partial,false);
});
test('cancellation aborts active reads and never starts queued platforms or publishes stale completion',async()=>{
 const h=harness((q,{signal})=>q.operation==='reconciliationPlatforms'?directory(['A','B','C','D']):new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('cancelled'),{name:'AbortError'})),{once:true})));
 const running=h.loader.load(query());await tick();assert.equal(h.calls.length,2);h.loader.cancel();await assert.rejects(running,/查询已取消/);await tick();assert.equal(h.calls.length,2);assert.equal(h.calls.slice(1).every(c=>c.options.signal.aborted),true);
});
test('scope and committed-filter changes discard cached platform summaries',async()=>{
 const h=harness(q=>q.operation==='reconciliationPlatforms'?directory(['A']):response('A',q,q.filters.from==='2026-10-02'?2:1));
 await h.loader.load(query());h.root.scope='scope-b';await h.loader.load(query());assert.equal(h.calls.length,4);
 const changed=query();changed.filters={...changed.filters,from:'2026-10-02'};const r=await h.loader.load(changed);assert.equal(h.calls.length,6);assert.equal(r.total,2);
});
test('changed child-page totals and summaries are reported rather than mixing rows with earlier totals',async()=>{
 let revision=0;const h=harness(q=>q.operation==='reconciliationPlatforms'?directory(['A']):response('A',q,revision?51:50));await h.loader.load(query());revision++;
 const r=await h.loader.load(query({offset:20}));assert.equal(r.rows.length,0);assert.equal(r.batch.pageFailures.length,1);assert.match(r.batch.pageFailures[0].message,/数据已更新/);assert.equal(r.batch.partial,true);
 await h.loader.load(query());assert.equal(h.calls.filter(c=>c.q.operation==='reconciliationPlatforms').length,2);
});
test('malformed directories and out-of-scope or truncated child responses cannot masquerade as successful reads',async()=>{
 const dup=harness(()=>directory(['A','A']));await assert.rejects(dup.loader.load(query()),/授权工单平台目录/);assert.equal(dup.calls.length,1);
 for(const mutate of [v=>{v.ok=false},v=>{v.countryCode='PK'},v=>{v.platforms=['OTHER']},v=>{v.rows[0].platform='NOT_AUTHORIZED'},v=>{v.rows=[]},v=>{delete v.summary.missingAmountExact},v=>{v.summary.pendingCount++},v=>{v.coverage.platforms[0].platform='OTHER'}]){
  const h=harness(q=>{if(q.operation==='reconciliationPlatforms')return directory(['A']);const v=response('A',q,1);mutate(v);return v;});const r=await h.loader.load(query());assert.equal(r.batch.successfulPlatforms,0);assert.equal(r.summary.pendingCount,null);assert.equal(r.rows.length,0);
 }
});
function uiHarness(handler,{document,rendered=()=>{}}={}){let active='workorder_reconciliation',html='',api;const root={HENSEM_PRODUCTION:true,document},calls=[],L={catalogReady:true,country:'印度',catalog:[{name:'DISPLAY_ONLY_NOT_AUTHORITY',country:'印度',timezone:'Asia/Kolkata'}]};vm.runInNewContext(moduleSource,{window:root,AbortController});vm.runInNewContext(read('live-workorder-operations.js'),{window:root});const E=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));api=root.HensemLiveWorkorderOperations.create({L,E,C:String,box:(title,body)=>'<h2>'+title+'</h2>'+body,table:(headers,rows)=>'<table>'+headers.join('|')+rows.map(r=>r.join('|')).join('\n')+'</table>',request:(q,options)=>{calls.push({q,options});return handler(q,options);},render:()=>{html=api.render();rendered(html)},page:()=>active,openDrawer:()=>{},formatTime:v=>v});return {root,api,calls,html:()=>html,setPage:p=>{active=p}};}
test('production UI reads authority directory, shows grouped ordering and partial scope without shrinking typography',async()=>{
 const h=uiHarness(q=>{if(q.operation==='reconciliationPlatforms')return Promise.resolve(directory(['A','B']));if(q.filters.platform==='B')return Promise.reject(Error('<timeout>'));return Promise.resolve(response('A',q,30));});await h.api.load(true);
 assert.equal(h.calls[0].q.operation,'reconciliationPlatforms');assert.equal(h.calls.some(c=>c.q.filters.platform==='DISPLAY_ONLY_NOT_AUTHORITY'),false);assert.match(h.html(),/已读取 1 \/ 2 个平台/);assert.match(h.html(),/下方仅汇总已读取平台/);assert.match(h.html(),/平台按当前分类订单数从多到少/);assert.match(h.html(),/平台内按最新提交时间/);assert.match(h.html(),/B：&lt;timeout&gt;/);assert.match(h.html(),/已读取 <b>30/);
 h.root.workorderOperationsSet('platform','A');assert.equal(h.api.state().result,null);await h.api.load(true);assert.equal(h.calls.at(-1).q.operation,'list');assert.equal(h.calls.at(-1).q.filters.platform,'A');assert.doesNotMatch(h.html(),/按平台展示/);
});
test('production UI filter edits stop remaining platform work and suppress stale responses',async()=>{
 const h=uiHarness((q,options)=>q.operation==='reconciliationPlatforms'?Promise.resolve(directory(['A','B','C'])):new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true})));
 const pending=h.api.load(true);await tick();assert.equal(h.calls.length,2);assert.match(h.html(),/分平台读取 0 \/ 3/);h.root.workorderOperationsSet('orderNo','EXACT-NEW-FILTER',false);await pending;assert.equal(h.api.state().result,null);assert.equal(h.api.state().busy,false);assert.equal(h.calls.length,2);assert.equal(h.calls.slice(1).every(c=>c.options.signal.aborted),true);
});
test('UI all-failed response says unknown rather than no orders, and bundled production includes loader',async()=>{
 const h=uiHarness(q=>q.operation==='reconciliationPlatforms'?Promise.resolve(directory(['A'])):Promise.reject(Error('timeout')));await h.api.load(true);assert.match(h.html(),/订单笔数和金额未知/);assert.doesNotMatch(h.html(),/当前条件下没有未登记|共 <b>0/);assert.equal(h.api.state().result.summary.missingCount,null);
 assert.match(fs.readFileSync(path.join(__dirname,'../admin-preview/build-restoration.py'),'utf8'),/'live-workorder-reconciliation-batch.js',\s*'live-workorder-operations.js'/);
 assert.match(read('live-data.js'),/request:\(q,options\)=>window.hensemLiveRequest\(q,options\)/);
});

test('UI never presents page errors or incomplete zero results as no orders in the entire scope',async()=>{
 const failedPage=uiHarness(q=>q.operation==='reconciliationPlatforms'?Promise.resolve(directory(['A'])):q.offset>0?Promise.reject(Error('page timeout')):Promise.resolve(response('A',q,50)));await failedPage.api.load(true);await failedPage.root.workorderOperationsPage(2);await tick();assert.match(failedPage.html(),/当前页读取失败，不能判断本页订单/);assert.doesNotMatch(failedPage.html(),/当前条件下没有未登记未成功订单/);assert.equal(failedPage.api.state().result.summary.pendingCount,50);
 const partialZero=uiHarness(q=>q.operation==='reconciliationPlatforms'?Promise.resolve(directory(['A','B'])):q.filters.platform==='B'?Promise.reject(Error('timeout')):Promise.resolve(response('A',q,0)));await partialZero.api.load(true);assert.match(partialZero.html(),/已读取平台未发现当前分类订单；其余平台尚未读取/);assert.doesNotMatch(partialZero.html(),/当前条件下没有未登记未成功订单/);
});

test('editing a busy order/date input cancels reads and refreshes only results, preserving focus and enabling Query',async()=>{
 for(const [key,value,type] of [['orderNo','000000123','search'],['from','2026-10-02','date']]){
  let paused=true,fullRenders=0,input={value:'',type},resultUpdates=0;const button={disabled:false},results={_html:'',set innerHTML(v){this._html=v;resultUpdates++},get innerHTML(){return this._html}};
  const document={activeElement:null,querySelector:selector=>selector==='.wo-operations-results'?results:selector.includes('workorderOperationsLoad(true)')?button:null};
  const h=uiHarness((q,options)=>q.operation==='reconciliationPlatforms'?Promise.resolve(directory(['A','B','C'])):paused?new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true})):Promise.resolve(response(q.filters.platform,q,1)),{document,rendered:html=>{fullRenders++;input={value:'',type};document.activeElement=null;button.disabled=/disabled/.test(html.match(/<button[^>]*onclick="workorderOperationsLoad\(true\)"[^>]*>查询<\/button>/)?.[0]||'');results.innerHTML=html.match(/<div class="wo-operations-results">([\s\S]*)<\/div>$/)?.[1]||'';}});
  const running=h.api.load(true);await tick();assert.equal(button.disabled,true);assert.match(results.innerHTML,/分平台读取 0 \/ 3/);const renderCount=fullRenders,updateCount=resultUpdates;input.value=value;input.selectionStart=2;input.selectionEnd=5;document.activeElement=input;const retainedInput=input;
  h.root.workorderOperationsSet(key,value,false);assert.equal(fullRenders,renderCount,'oninput must not rebuild the form');assert.equal(document.activeElement,retainedInput);assert.equal(input.value,value);assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,5);assert.equal(button.disabled,false);assert.equal(resultUpdates,updateCount+1);assert.doesNotMatch(results.innerHTML,/正在读取|分平台读取|读取中/);assert.match(results.innerHTML,/选择条件后查询/);
  await running;assert.equal(fullRenders,renderCount,'old finally cannot redraw the edited form');assert.equal(h.calls.length,2,'remaining queued platforms were cancelled');assert.equal(document.activeElement,retainedInput);
  paused=false;await h.root.workorderOperationsLoad(true);assert.equal(h.calls.filter(c=>c.q.operation==='list').at(-1).q.filters[key],value);assert.equal(h.api.state().result.total,3);assert.equal(h.api.state().busy,false);
 }
});
