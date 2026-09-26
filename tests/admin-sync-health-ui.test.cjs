// Offline sync-health lifecycle checks: synthetic data only, no production session.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-sync-health.js'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {resolve,reject,promise}};
const issue=(platform='PLATFORM',status='not_received')=>({platform,country:'印度',team:'M8',dataset:'orders',direction:'charge',sourceKind:'direct',source:'ar',date:'2026-09-25',status,received:false,evidence:'no_created_orders_received'});
const response=(rows=[issue()],checked=rows.length)=>({checkedAt:'2026-09-26T01:00:00Z',days:7,total:rows.length,summary:{checked,received:checked-rows.length,notReceived:rows.filter(x=>x.status==='not_received').length,failed:rows.filter(x=>x.status==='failed').length,pending:rows.filter(x=>x.status==='pending').length,unverified:rows.filter(x=>x.status==='unverified').length},rows});
function setup(request=async()=>response()){
 let now=1000000,ready=false,seq=0,changes=0;const timers=new Map(),nodes=new Map(),listeners={},calls=[];
 class Clock extends Date{static now(){return now}}
 const document={getElementById:id=>nodes.get(id),createElement:()=>({innerHTML:'',setAttribute(){},remove(){nodes.delete(this.id)}}),body:{appendChild:node=>nodes.set(node.id,node)},addEventListener:(name,fn)=>listeners[name]=fn};
 const ctx=vm.createContext({Date:Clock,document,setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id)});vm.runInContext('window=globalThis',ctx);vm.runInContext(source,ctx);
 const api=ctx.HensemLiveSyncHealth;api.configure({request:async q=>{calls.push(JSON.parse(JSON.stringify(q)));return request(q)},ready:()=>ready,onChange:()=>changes++});
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
test('integration permits independent first-load pages and waits for their main loading states',async()=>{
 const live=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8'),ready=live.match(/configure\(\{request:q=>window\.hensemLiveRequest\(q\),ready:\(\)=>(.*?),onChange:/)[1];
 const supervisorDeclarations=live.slice(live.indexOf(' const supervisorPages='),live.indexOf('\n for(const [id,page]of Object.entries(supervisorPages))'));
 assert.match(supervisorDeclarations,/const isSupervisorPage=/,'use the real page classifier in the extracted readiness expression');
 const evaluate=(page,L,modules={},reportState={})=>vm.runInNewContext(supervisorDeclarations+'\n'+ready,{state:{page},L,window:modules,collectedPage:{state:{busy:false}},reportData:{state:reportState}});
 const L={catalogReady:true,initialReadComplete:true,loading:false,overviewQueried:false};
 for(const page of ['auto_withdraw','rates','collected_data','payout_config','workorders','deposit_tracking'])assert.equal(evaluate(page,L),true,page);
 for(const page of ['workorder_reconciliation','workorder_workload','workorder_operation_logs','workorder_permissions']){
  assert.equal(evaluate(page,L),false,page+' has no connected employee source and must not start business health reads');
  const h=setup();h.setReady(evaluate(page,L));h.api.schedule(page);await h.run();assert.equal(h.calls.length,0,page);
 }
 for(const page of ['workorders','deposit_tracking']){
  const h=setup();h.setReady(evaluate(page,L));h.api.schedule(page);await h.run();assert.equal(h.calls.length,1,page+' retains its existing health check');
 }
 assert.equal(evaluate('overview',L),false,'an unqueried overview must not start an independent health read');
 const queried={...L,overviewQueried:true};assert.equal(evaluate('overview',queried),true,'health may run after an explicit overview query completes');
 assert.equal(evaluate('rates',{...L,initialReadComplete:false}),false);assert.equal(evaluate('auto_withdraw',{...L,autoWithdrawLoading:true}),false);assert.equal(evaluate('rates',L,{HensemLiveRatesRestored:{snapshot:()=>({loading:true})}}),false);assert.equal(evaluate('payout_config',L,{HensemLivePayoutConfig:{state:()=>({indexStatus:'loading'})}}),false);
 assert.equal(evaluate('overview',{...queried,loading:true}),false);assert.equal(evaluate('overview',{...queried,overviewSections:{status:'loading'}}),false);assert.equal(evaluate('overview',queried,{}, {loading:true}),false);assert.equal(evaluate('overview',queried,{}, {catalogBusy:true}),false);
 assert.match(live,/finally\{initialLoad=null;L.initialReadComplete=true;window.liveHeader\?\.\(\)\}/);
});

test('an empty authorized source inventory is unverified, never all received',async()=>{const h=setup(async()=>response([],0));h.setReady(true);await h.api.refresh();h.api.open();assert.match(h.html(),/当前授权范围没有可核查来源/);assert.doesNotMatch(h.html(),/均已收到数据/)});
