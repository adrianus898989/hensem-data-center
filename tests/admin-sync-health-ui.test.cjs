// Offline sync-health lifecycle checks: synthetic data only, no production session.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-sync-health.js'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {resolve,reject,promise}};
const issue=(platform='PLATFORM',status='not_received')=>({platform,country:'印度',team:'M8',dataset:'orders',direction:'charge',sourceKind:'direct',source:'ar',date:'2026-09-25',status,received:false,evidence:'no_created_orders_received'});
const response=(rows=[issue()],checked=rows.length)=>({checkedAt:'2026-09-26T01:00:00Z',days:7,total:rows.length,summary:{checked,received:checked-rows.length,notReceived:rows.filter(x=>x.status==='not_received').length,failed:rows.filter(x=>x.status==='failed').length,pending:rows.filter(x=>x.status==='pending').length,unverified:rows.filter(x=>x.status==='unverified').length},rows});
function setup(request=async()=>response(),context){
 let now=1000000,ready=false,seq=0,changes=0;const timers=new Map(),nodes=new Map(),listeners={},calls=[];
 class Clock extends Date{static now(){return now}}
 const document={getElementById:id=>nodes.get(id),createElement:()=>({innerHTML:'',setAttribute(){},remove(){nodes.delete(this.id)}}),body:{appendChild:node=>nodes.set(node.id,node)},addEventListener:(name,fn)=>listeners[name]=fn};
 const ctx=vm.createContext({Date:Clock,AbortController,document,setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id)});vm.runInContext('window=globalThis',ctx);vm.runInContext(source,ctx);
 const api=ctx.HensemLiveSyncHealth;api.configure({request:async(q,options)=>{calls.push(JSON.parse(JSON.stringify(q)));return request(q,options)},ready:()=>ready,context,onChange:()=>changes++});
 return {api,calls,timers,listeners,setReady:value=>ready=value,tick:value=>now+=value,html:()=>nodes.get('live-sync-health-panel')?.innerHTML||'',changes:()=>changes,run:async()=>{for(const [id,timer]of [...timers]){timers.delete(id);timer.fn()}await flush()}};
}

test('catalog alone does not trigger health; first page reads finish before the independent request',async()=>{
 const h=setup();h.api.schedule('scope');h.api.open();assert.match(h.html(),/等待主页面读取完成/);assert.equal(h.calls.length,0);assert.equal(h.timers.size,0);
 h.setReady(true);h.api.schedule('scope');assert.equal(h.calls.length,0);assert.equal([...h.timers.values()][0].ms,250);await h.run();assert.deepEqual(h.calls,[{action:'syncHealth',offset:0,limit:5000}]);assert.match(h.html(),/2026-09-25/);assert.match(h.api.badge(),/>1<\/span>/);
});
test('if a main request begins during the idle delay, the probe is postponed until completion',async()=>{
 const h=setup();h.setReady(true);h.api.schedule('scope');h.setReady(false);await h.run();assert.equal(h.calls.length,0);h.setReady(true);h.api.schedule('scope');await h.run();assert.equal(h.calls.length,1);
});
test('all alert pages use one snapshot and five-minute expiry never renews on paging',async()=>{
 const rows=Array.from({length:205},(_,i)=>issue('P'+i)),h=setup(async()=>response(rows));h.setReady(true);h.api.schedule('scope');await h.run();h.api.open();assert.match(h.html(),/>P99</);assert.doesNotMatch(h.html(),/>P100</);
 h.tick(240000);h.api.page(1);assert.match(h.html(),/>P100</);assert.doesNotMatch(h.html(),/>P0</);h.api.page(2);assert.match(h.html(),/>P204</);assert.equal(h.calls.length,1);h.api.page(3);h.api.page(-1);h.api.page(1.5);assert.equal(h.calls.length,1);assert.match(h.html(),/第 3 \/ 3 页/);
 h.api.schedule('scope');assert.equal(h.timers.size,0);h.tick(60001);h.api.schedule('scope');await h.run();assert.equal(h.calls.length,2);assert.match(h.html(),/第 1 \/ 3 页/);
});
test('scope replacement discards old results and late replies cannot repaint them',async()=>{
 const wait=deferred();let first=true;const h=setup(()=>first?(first=false,wait.promise):Promise.resolve(response([issue('NEW')])));h.setReady(true);h.api.schedule('old');await h.run();h.api.open();h.api.schedule('new');await h.run();assert.match(h.html(),/>NEW</);wait.resolve(response([issue('PRIVATE-OLD')]));await flush();assert.doesNotMatch(h.html(),/PRIVATE-OLD/);assert.equal(h.calls.length,2);
});
test('query errors remain unknown and a failed refresh preserves the dated snapshot',async()=>{
 let fail=false;const h=setup(async()=>{if(fail)throw Error('连接失败');return response([issue('KEEP')])});h.setReady(true);h.api.schedule('scope');await h.run();h.api.open();fail=true;await h.api.refresh();assert.match(h.html(),/本次检查未完成/);assert.match(h.html(),/以下保留上次检查结果/);assert.match(h.html(),/>KEEP</);assert.match(h.api.badge(),/>!</);h.api.schedule('scope');await h.run();assert.equal(h.calls.length,2);
 const empty=setup(async()=>{throw Error('超时')});empty.setReady(true);empty.api.schedule('scope');await empty.run();empty.api.open();await flush();assert.match(empty.html(),/尚不能判断哪些平台缺少数据/);assert.doesNotMatch(empty.html(),/均已收到数据|未收到 0 项/);
});
test('malformed and internally inconsistent results cannot masquerade as a healthy check',async()=>{
 for(const data of [{rows:[],total:0},{...response([]),checkedAt:'invalid'},response([issue('X','arbitrary')]),{...response([]),summary:{checked:1,received:0,notReceived:0,failed:0,pending:0,unverified:0}}]){const h=setup(async()=>data);h.setReady(true);h.api.schedule('scope');await h.run();h.api.open();await flush();assert.match(h.html(),/结果格式不完整/);assert.match(h.api.badge(),/>!</)}
});
test('stored failure/pending evidence is distinct from missing data and all external text is escaped',async()=>{
 const rows=[{...issue('<img src=x onerror=alert(1)>','failed'),received:true,evidence:'source_collection_failed'}, {...issue('RUNNING','pending'),evidence:'source_task_not_finished'}, {...issue('CONFIG'),direction:'config',dataset:'panda_config',sourceKind:'google_sheets',evidence:'no_daily_configuration_snapshot'}];const h=setup(async()=>response(rows));h.setReady(true);await h.api.refresh();h.api.open();assert.match(h.html(),/采集任务失败/);assert.match(h.html(),/数据库已有该日记录/);assert.match(h.html(),/当前在线状态未知/);assert.match(h.html(),/不表示原有配置已删除/);assert.match(h.html(),/Google 表格 → Supabase/);assert.match(h.html(),/&lt;img/);assert.doesNotMatch(h.html(),/<img/);h.listeners.keydown({key:'Escape'});assert.equal(h.html(),'');
});
test('zero warnings do not claim full-day collection completeness, and cancel ignores a pending reply',async()=>{
 const h=setup(async()=>response([],20));h.setReady(true);await h.api.refresh();h.api.open();assert.match(h.html(),/20 项平台日期均已收到数据/);assert.match(h.html(),/是否整日采齐仍以来源完成记录为准/);assert.equal(h.api.badge(),'');
 const wait=deferred(),c=setup(()=>wait.promise);c.setReady(true);c.api.open();c.api.cancel();wait.resolve(response());await flush();assert.equal(c.api.badge(),'');assert.equal(c.html(),'');
});

const bridgeSource=fs.readFileSync(path.join(__dirname,'../src/lib/adminLiveBridge.ts'),'utf8');
function bridge(fetchImpl){const compiled=ts.transpileModule(bridgeSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,module={exports:{}},calls=[],auth=[];
 vm.runInNewContext(compiled,{module,exports:module.exports,URL,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://offline.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public-test-key'}},require:name=>name==='./adminConfigurationRequest'?{}:{ensureDashboardSession:async current=>{auth.push(current);return {...current,access_token:'fresh-test-token'}}},fetch:async(url,init)=>{calls.push({url,init});return fetchImpl?fetchImpl():{ok:true,json:async()=>response()}}});return {api:module.exports,calls,auth};}
test('health bridge only accepts bounded read parameters, fresh auth and fixed RPC',async()=>{
 const h=bridge(),req={action:'syncHealth',offset:0,limit:5000};for(const change of [{country:'印度'},{platform:'AR'},{startAt:'2026-01-01'},{limit:5001},{limit:'100'},{offset:-1},{offset:50001},{sql:'select secrets'}])assert.throws(()=>h.api.validateAdminLiveRequest({...req,...change}));
 await h.api.adminLiveRequest({user:{id:'test'},access_token:'old-test-token'},req);assert.equal(h.auth.length,1);assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_sync_health');assert.equal(h.calls[0].init.headers.Authorization,'Bearer fresh-test-token');assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_request:{offset:0,limit:5000}});assert.equal(h.calls[0].init.cache,'no-store');
 const err=bridge(()=>({ok:false,status:504,json:async()=>({message:'statement timeout sensitive-private-data'})}));await assert.rejects(err.api.adminLiveRequest({user:{id:'test'},access_token:'old'},req),error=>/同步检查超时/.test(error.message)&&!/敏感|sensitive|缩短日期|选择单个平台/.test(error.message));
});
test('integration waits for a manual page query and its main loading states',async()=>{
 const live=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8'),ready=live.match(/configure\(\{request:\(q,options\)=>window\.hensemLiveRequest\(q,options\),context:syncHealthContext,ready:\(\)=>(.*?),onChange:/)[1];
 const supervisorDeclarations=live.slice(live.indexOf(' const supervisorPages='),live.indexOf('\n for(const [id,page]of Object.entries(supervisorPages))'));
 assert.match(supervisorDeclarations,/const isSupervisorPage=/,'use the real page classifier in the extracted readiness expression');
 const phaseDeclaration=live.match(/ const phasedReadBusy=\(\)=>[^\n]+;/)?.[0];
 assert(phaseDeclaration,'use the real query-owned phase classifier in the extracted readiness expression');
 assert(live.indexOf(phaseDeclaration)<live.indexOf(' window.HensemLiveSyncHealth?.configure('),'the production declaration exists before readiness is configured');
 const evaluate=(page,L,modules={},reportState={},readPhase=null,submissionAnalysis=null)=>vm.runInNewContext(supervisorDeclarations+'\n'+phaseDeclaration+'\n'+ready,{pages:[],state:{page},roleAllowed:()=>true,L,readPhase,submissionAnalysis,window:modules,collectedPage:{state:{busy:false}},reportData:{state:reportState}});
 const L={serial:7,catalogReady:true,initialReadComplete:true,loading:false,overviewQueried:false,pageQueried:true};
 for(const page of ['auto_withdraw','rates','collected_data','payout_config','workorders','deposit_tracking','deposit_statistics','workorder_reconciliation','workorder_workload','workorder_operation_logs'])assert.equal(evaluate(page,L),true,page);
 for(const page of ['workorder_permissions','channel_status']){
  assert.equal(evaluate(page,L),false,page+' has no automatic health request contract after a completed query');
  const h=setup();h.setReady(evaluate(page,L));h.api.schedule(page);await h.run();assert.equal(h.calls.length,0,page);
 }
 for(const page of ['workorders','deposit_tracking']){
  const h=setup();h.setReady(evaluate(page,L));h.api.schedule(page);await h.run();assert.equal(h.calls.length,1,page+' retains its existing health check');
 }
 for(const page of ['overview','amount','time','risk','rates','workorders','collected_data'])assert.equal(evaluate(page,{...L,pageQueried:false}),false,'an unqueried '+page+' must not start an independent health read');
 for(const page of ['providers','provider_payout','merchants']){
  assert.equal(evaluate(page,L,{}, {},{serial:L.serial,page}),false,page+' waits for every active heavy-read phase even after primary loading ends');
  assert.equal(evaluate(page,L,{}, {},{serial:L.serial-1,page}),true,'a replaced generation cannot block '+page);
  assert.equal(evaluate(page,L,{}, {},{serial:L.serial,page:'another_page'}),true,'a different page does not own '+page);
  assert.equal(evaluate(page,{...L,feeLookupLoading:true}),false,page+' waits for the actual fee batch');
 }
 const phased=setup();phased.setReady(evaluate('providers',L,{}, {},{serial:L.serial,page:'providers'}));phased.api.schedule('phase-scope');await phased.run();assert.equal(phased.calls.length,0,'the real busy predicate defers scheduling');
 phased.setReady(evaluate('providers',L));phased.api.schedule('phase-scope');await phased.run();assert.equal(phased.calls.length,1,'health becomes eligible once its query-owned phase ends');
 for(const page of ['events','providers']){
  assert.equal(evaluate(page,L,{}, {},null,{isLoading:()=>true}),false,page+' waits for the submission analysis read');
  assert.equal(evaluate(page,L,{}, {},null,{isLoading:()=>false}),true,page+' permits health once the submission analysis read ends');
 }
 const submission=setup();submission.setReady(evaluate('providers',L,{}, {},null,{isLoading:()=>true}));submission.api.schedule('submission-scope');await submission.run();assert.equal(submission.calls.length,0,'submission analysis blocks the independent health query');
 submission.setReady(evaluate('providers',L,{}, {},null,{isLoading:()=>false}));submission.api.schedule('submission-scope');await submission.run();assert.equal(submission.calls.length,1,'health resumes after submission analysis ends');
 const queried={...L,overviewQueried:true};assert.equal(evaluate('overview',queried),true,'health may run after an explicit overview query completes');
 for(const page of ['events','providers']){
  assert.equal(evaluate(page,L,{}, {},null,{isLoading:()=>true}),false,page+' waits for its running submission analysis');
  assert.equal(evaluate(page,L,{}, {},null,{isLoading:()=>false}),true,page+' becomes eligible after submission analysis settles');
 }
 assert.equal(evaluate('rates',{...L,initialReadComplete:false}),false);assert.equal(evaluate('auto_withdraw',{...L,autoWithdrawLoading:true}),false);assert.equal(evaluate('rates',L,{HensemLiveRatesRestored:{snapshot:()=>({loading:true})}}),false);assert.equal(evaluate('payout_config',L,{HensemLivePayoutConfig:{state:()=>({indexStatus:'loading'})}}),false);
 assert.equal(evaluate('overview',{...queried,loading:true}),false);assert.equal(evaluate('overview',{...queried,overviewSections:{status:'loading'}}),false);assert.equal(evaluate('overview',queried,{}, {loading:true}),false);assert.equal(evaluate('overview',queried,{}, {catalogBusy:true}),false);
 assert.match(live,/finally\{initialLoad=null;L.catalogLoading=false;L.initialReadComplete=true;window.liveHeader\?\.\(\)\}/);
});

test('an empty authorized source inventory is unverified, never all received',async()=>{const h=setup(async()=>response([],0));h.setReady(true);await h.api.refresh();h.api.open();assert.match(h.html(),/当前授权范围没有可核查来源/);assert.doesNotMatch(h.html(),/均已收到数据/)});


// The existing script includes this file in test:admin-preview; these checks use
// the production health module and transport, with no live accounts or network.
test('business preemption aborts health transport, preserves its open snapshot and keeps cooldown',async()=>{
 let next,signal;const h=setup((_q,o)=>{signal=o.signal;return next?next.promise:Promise.resolve(response([issue('KEPT')]))});
 h.setReady(true);h.api.schedule('scope');await h.run();h.api.open();next=deferred();const read=h.api.refresh();
 assert.equal(signal.aborted,false);assert.match(h.html(),/正在检查/);h.api.cancel({preservePanel:true});assert.equal(signal.aborted,true);
 assert.match(h.html(),/>KEPT</);assert.doesNotMatch(h.html(),/正在检查|本次检查未完成/);
 for(let i=0;i<10;i++)h.api.schedule('scope');assert.equal(h.timers.size,0);assert.equal(h.calls.length,2);
 next.reject(Object.assign(Error('cancelled'),{name:'AbortError',code:'ADMIN_LIVE_CANCELLED'}));await read;
 assert.match(h.html(),/>KEPT</);assert.doesNotMatch(h.api.badge(),/unknown/);
 h.tick(300001);next=null;h.api.schedule('scope');await h.run();assert.equal(h.calls.length,3);
});

test('authority replacement aborts transport and evicts old health data before a header or panel can expose it',async()=>{
 let identity='account-a',next,signal;const h=setup((_q,o)=>{signal=o.signal;return next?next.promise:Promise.resolve(response([issue('PRIVATE-A')]))},()=>identity);
 h.setReady(true);await h.api.refresh();h.api.open();next=deferred();const old=h.api.refresh();identity='account-b';
 assert.equal(h.api.badge(),'');assert.equal(signal.aborted,true);assert.doesNotMatch(h.html(),/PRIVATE-A/);
 next.resolve(response([issue('LATE-A')]));await old;assert.doesNotMatch(h.html(),/PRIVATE-A|LATE-A/);
 next=null;await h.api.refresh();assert.equal(h.calls.length,3);
});

for(const code of ['ADMIN_LIVE_SESSION_DENIED','ADMIN_LIVE_PERMISSION_DENIED','ROLE_DENIED','42501'])test(code+' evicts cached health evidence instead of displaying the previous authorized snapshot',async()=>{
 let fail=false;const h=setup(async()=>{if(fail)throw Object.assign(Error('access denied'),{code});return response([issue('PRIVATE')])});
 h.setReady(true);await h.api.refresh();h.api.open();fail=true;await h.api.refresh();assert.doesNotMatch(h.html(),/PRIVATE|以下保留上次/);assert.match(h.html(),/本次检查未完成/);
});

test('the single business adapter forwards request/options/result identity and does not own a queue',async()=>{
 const live=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8');
 const declaration=live.slice(live.indexOf(' function preemptSyncHealth'),live.indexOf(' const previousRender'));
 const cancellations=[],transport=[],result={kept:true},ctx={window:{HensemLiveSyncHealth:{cancel:o=>cancellations.push(o)},hensemLiveCancelRequests:actions=>cancellations.push(actions),hensemLiveRequest:(q,o)=>{transport.push([q,o]);return result}},L:{catalog:[],withdrawCatalog:[]}};
 vm.runInNewContext(declaration+';globalThis.request=foregroundRequest;globalThis.context=syncHealthContext',ctx);
 const q={action:'aggregatePrepared',requests:[{successStartAt:'manual',successEndAt:'manual',direction:'withdraw'}]},options={signal:new AbortController().signal};
 assert.equal(ctx.request(q,options),result);assert.equal(transport[0][0],q);assert.equal(transport[0][1],options);assert.equal(cancellations[0].preservePanel,true);assert.deepEqual(Array.from(cancellations[1]),['syncHealth']);
 const ast=ts.createSourceFile('live-data.js',live,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),direct=[];function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='window.hensemLiveRequest')direct.push(n.getText(ast));ts.forEachChild(n,visit)}visit(ast);
 assert.deepEqual(direct,['window.hensemLiveRequest(request,options)','window.hensemLiveRequest(q,options)'],'only adapter and health itself directly call the bridge');
 assert(!/setTimeout|Promise|queue|await/.test(declaration.slice(0,declaration.indexOf(' function syncHealthContext'))));
});

test('health context changes on account, role, permission and native identity but not catalogue ordering',()=>{
 const live=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8'),declaration=live.match(/ function syncHealthContext\(\)[^\n]+/)[0];
 const c={window:{hensemDataScope:{mode:'restricted',identity:'account-a'},hensemRoleAccess:{mode:'assigned',roleId:'role-a',version:1,assignmentVersion:1,canView:true,permissions:['b','a']}},L:{catalog:[{id:'p1',country:'印度',scopeGroup:'india',source:'ar',name:'P',timezone:'Asia/Kolkata',currency:'INR'},{id:'p2',source:'newar'}],withdrawCatalog:[]}};
 vm.runInNewContext(declaration+';globalThis.context=syncHealthContext',c);const before=c.context();c.L.catalog.reverse();c.window.hensemRoleAccess.permissions.reverse();assert.equal(c.context(),before);
 for(const [obj,key,value]of [[c.window.hensemDataScope,'identity','account-b'],[c.window.hensemRoleAccess,'roleId','role-b'],[c.window.hensemRoleAccess,'version',2],[c.window.hensemRoleAccess,'assignmentVersion',2],[c.window.hensemRoleAccess,'canView',false],[c.window.hensemRoleAccess,'permissions',['a']],[c.L.catalog[0],'source','wg'],[c.L.catalog[0],'timezone','Asia/Jakarta'],[c.L.catalog[0],'currency','IDR']]){const previous=obj[key];obj[key]=value;assert.notEqual(c.context(),before,key);obj[key]=previous}
});

test('real health-to-iframe-to-host cancellation frees its occupied transport slot after fetch settles',async()=>{
 const bridgeFile=fs.readFileSync(path.join(__dirname,'admin-live-bridge.test.cjs'),'utf8');
 const prefix=bridgeFile.split(/\ntest\(/)[0],iframeDefinition=bridgeFile.slice(bridgeFile.indexOf('function iframeHarness(){'),bridgeFile.indexOf("\ntest('iframe cancellation"));
 const {load,bridge,iframeHarness,query}=new Function('require','__dirname',prefix+'\n'+iframeDefinition+';return {load,bridge,iframeHarness,query};')(require,__dirname);
 const waits=[],host=load({fetch:(_url,init)=>new Promise((resolve,reject)=>{
  waits.push({resolve,init});init.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})));
 })}),b=bridge(host),x=iframeHarness();b.replaceChannel('test-channel');
 let cursor=0,reply=0;const send=()=>{while(cursor<x.messages.length)host.send({source:b.child,origin:'null',data:x.messages[cursor++].data})};
 const nodes=new Map();x.ctx.Date=Date;x.ctx.document={getElementById:id=>nodes.get(id),createElement:()=>({setAttribute(){},remove(){nodes.delete(this.id)}}),body:{appendChild:n=>nodes.set(n.id,n)}};
 vm.runInContext(source,x.ctx);const api=x.ctx.HensemLiveSyncHealth;api.configure({request:(q,o)=>x.ctx.hensemLiveRequest(q,o),ready:()=>true,onChange(){}});
 const health=api.refresh(),reads=[];for(let i=0;i<3;i++)reads.push(x.ctx.hensemLiveRequest(query).catch(e=>e));send();await flush();assert.equal(host.calls.length,4);
 reads.push(x.ctx.hensemLiveRequest(query).catch(e=>e));send();await flush();assert.equal(host.calls.length,4,'foreground initially queued at the original transport limit');
 api.cancel({preservePanel:true});send();await flush();assert.equal(waits[0].init.signal.aborted,true);assert.equal(host.calls.length,5,'original FIFO drains after the cancelled fetch settles');assert(waits.slice(1).every(w=>!w.init.signal.aborted));
 for(const w of waits.slice(1))w.resolve({ok:true,json:async()=>({rows:[],total:0})});await flush();while(reply<b.replies.length){const data=b.replies[reply++].data;x.reply(data,data)}await Promise.all([health,...reads]);assert.equal(api.badge(),'');b.cleanup();assert.equal(host.timers.size,0);
});

test('real shared-page modules use the central adapter; render and local sorting do not preempt health',async()=>{
 const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
 const {harness,settle}=new Function('require','__dirname',prefix+';return {harness,settle};')(require,__dirname),configs=new Map(),cancelled=[];
 const names=['HensemLiveReportData','HensemLiveCollectedData','HensemLiveWithdrawPages','HensemLiveDepositIssues','HensemLiveWorkorderOperations','HensemLiveConfiguration','HensemAnalysisDrilldown','HensemProviderOrders','HensemLiveDailyComparison','HensemLiveChannelStatus','HensemPreparedAggregates'];
 const h=harness({reports:true,roleAccess:{mode:'owner',canView:true},roleAllowed:()=>true,extraModules:['live-statistic-windows.js','live-prepared-aggregates.js','live-daily-comparison.js','live-channel-status.js'],beforeLive(c){
  c.HensemLiveSyncHealth={configure(){},cancel:o=>cancelled.push(o),badge:()=>'',schedule(){}};
  for(const name of names){const object=c[name];assert(object,name);const method=object.configure?'configure':'create',original=object[method];object[method]=function(options){configs.set(name,options);return original.call(this,options)}}
 }});await settle();assert.equal(configs.size,names.length,names.filter(n=>!configs.has(n)).join(','));
 const calls=[],answer={identity:'same'},q={action:'details',startAt:'unchanged',successStartAt:'manual',direction:'withdraw'};
 h.c.hensemLiveRequest=(request,options)=>{calls.push({request,options});return answer};cancelled.length=0;
 for(const [name,config]of configs){assert.equal(config.request(q),answer,name);assert.equal(calls.at(-1).request,q,name);assert.equal(cancelled.at(-1).preservePanel,true,name)}
 const count=cancelled.length;h.c.render();h.c.render();assert.equal(cancelled.length,count,'render does not cancel or request');assert.equal(calls.length,names.length);
 h.c.setPage('amount');assert(cancelled.some(x=>x.preservePanel===false),'navigation closes health through existing cancellation lifecycle');
});
