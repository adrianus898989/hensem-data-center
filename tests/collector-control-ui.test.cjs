// Execute production iframe UI and host bridge with synthetic transport only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'admin-preview/live-collector-control.js'),'utf8');
const deviceId='11111111-1111-4111-8111-111111111111',now=Date.parse('2026-10-06T12:00:00Z');
const clone=value=>JSON.parse(JSON.stringify(value)),flush=()=>new Promise(resolve=>setImmediate(resolve));
function overview(extra={}){return {ok:true,canEdit:true,devices:[{id:deviceId,name:'测试电脑 A',lastSeenAt:new Date(now).toISOString(),revokedAt:null,agentVersion:'1.0',tasks:[{id:'demo',label:'演示任务',desiredState:'stopped',revision:0,observedState:'stopped',pid:null,updatedAt:new Date(now).toISOString(),detailCode:'ok'}]}],...extra}}
function setup(handler){let clock=now,seq=0,active=true,edit=true,paint=0;const calls=[],timers=new Map();class Clock extends Date{static now(){return clock}}
 const ctx=vm.createContext({Date:Clock,document:{visibilityState:'visible'},setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id)});vm.runInContext('window=globalThis',ctx);vm.runInContext(source,ctx);
 const api=ctx.HensemCollectorControl.create({request:async q=>{calls.push(clone(q));return handler?handler(q):overview()},active:()=>active,canEdit:()=>edit,onChange:()=>paint++});
 return {api,calls,timers,ctx,setClock:value=>clock=value,setActive:value=>active=value,setEdit:value=>edit=value,paint:()=>paint};
}
// Exercise handlers emitted by render(), through the actual host-page globals.
// Native sandbox behaviour is additionally covered by the browser regression.
function pairingWires(h){
 const html=h.api.render(),form=html.match(/<form\b[^>]*class="collector-pair"[^>]*>[\s\S]*?<\/form>/)?.[0];assert(form,'pairing form is rendered');
 const opening=form.match(/^<form\b[^>]*>/)[0],button=form.match(/<button\b[^>]*>生成配对码<\/button>/)?.[0];assert(button,'pairing button is rendered');
 const attr=(tag,name)=>{const value=tag.match(new RegExp('\\b'+name+'="([^"]*)"'))?.[1];assert.notEqual(value,undefined,name+' is wired');return value;};
 const host=fs.readFileSync(path.join(root,'admin-preview/live-data.js'),'utf8');h.ctx.collectorControl=h.api;
 for(const name of ['collectorPair','collectorName']){const binding=host.match(new RegExp('window\\.'+name+'=[^;]+;'))?.[0];assert(binding,'actual '+name+' binding exists');vm.runInContext(binding,h.ctx);}
 return {form,button,click:attr(button,'onclick'),key:attr(opening,'onkeydown'),submit:attr(opening,'onsubmit'),input:attr(form.match(/<input\b[^>]*>/)[0],'oninput')};
}
function invokeWire(h,code,event,element={}){h.ctx.wireEvent=event;h.ctx.wireElement=element;return vm.runInContext('(function(event){'+code+'}).call(wireElement,wireEvent)',h.ctx);}
function pairingEnter(extra={}){let prevented=0;const event={key:'Enter',keyCode:13,target:{tagName:'INPUT',id:'collectorComputerName',disabled:false,isContentEditable:false},preventDefault(){prevented++;},...extra};return {event,prevented:()=>prevented};}
const syntheticPairing=()=>({ok:true,code:'SYNTHETIC_PAIR_WIRED',expiresAt:new Date(now+600000).toISOString()});
test('rendered pairing click and Enter reach the actual global binding once without form submission',async()=>{
 for(const kind of ['click','key']){
  const h=setup(q=>q.operation==='createPairing'?syntheticPairing():overview({devices:[]}));await h.api.refresh();const wire=pairingWires(h);
  assert.match(wire.button,/type="button"/);assert.doesNotMatch(wire.form,/type="submit"/);
  invokeWire(h,wire.input,undefined,{value:'  Jun  '});
  assert.equal(invokeWire(h,wire.submit),false);assert.equal(h.calls.length,1,'onsubmit never calls the pairing endpoint');
  const key=pairingEnter();invokeWire(h,wire[kind],kind==='key'?key.event:undefined);await flush();
  assert.deepEqual(h.calls.filter(q=>q.operation==='createPairing'),[{action:'collectorControl',operation:'createPairing',name:'Jun'}]);
  assert.equal(key.prevented(),kind==='key'?1:0);assert.match(h.api.render(),/SYNTHETIC_PAIR_WIRED/);
  await h.api.refresh();assert.match(h.api.render(),/SYNTHETIC_PAIR_WIRED/,'status polling retains the transient pairing code');
  assert(!JSON.stringify(h.api.snapshot()).includes('SYNTHETIC_PAIR_WIRED'));
 }
});
test('rendered pairing Enter ignores composition, repeats, modifiers and unrelated controls',async()=>{
 const h=setup();await h.api.refresh();h.api.setName('Jun');const wire=pairingWires(h);
 const ignored=[{isComposing:true},{keyCode:229},{repeat:true},{defaultPrevented:true},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{key:'Escape'},{key:' '},{target:null},
  {target:{tagName:'BUTTON',id:'collectorComputerName'}},{target:{tagName:'SELECT',id:'collectorComputerName'}},{target:{tagName:'TEXTAREA',id:'collectorComputerName'}},
  {target:{tagName:'INPUT',id:'other'}},{target:{tagName:'INPUT',id:'collectorComputerName',disabled:true}},{target:{tagName:'INPUT',id:'collectorComputerName',isContentEditable:true}}];
 for(const extra of ignored){const key=pairingEnter(extra);invokeWire(h,wire.key,key.event);await flush();assert.equal(key.prevented(),0,JSON.stringify(extra));}
 assert.equal(h.calls.length,1,'no ignored key reaches createPairing');
});
test('pairing button keyboard activation remains a single native click path',async()=>{
 const h=setup(q=>q.operation==='createPairing'?syntheticPairing():overview());await h.api.refresh();h.api.setName('Jun');const wire=pairingWires(h),key=pairingEnter({target:{tagName:'BUTTON',type:'button'}});
 invokeWire(h,wire.key,key.event);await flush();assert.equal(h.calls.length,1);assert.equal(key.prevented(),0);
 invokeWire(h,wire.click);await flush();assert.equal(h.calls.filter(q=>q.operation==='createPairing').length,1);
});
test('wired pairing keeps blank-name validation, pending deduplication and read-only guards',async()=>{
 for(const kind of ['click','key']){
  let finish;const h=setup(q=>q.operation==='createPairing'?new Promise(resolve=>finish=resolve):overview());await h.api.refresh();const wire=pairingWires(h);
  invokeWire(h,wire.input,undefined,{value:'   '});invokeWire(h,wire[kind],kind==='key'?pairingEnter().event:undefined);await flush();
  assert.equal(h.calls.length,1);assert.match(h.api.render(),/请填写1至80字的电脑名称/);
  invokeWire(h,wire.input,undefined,{value:'Jun'});invokeWire(h,wire[kind],kind==='key'?pairingEnter().event:undefined);await flush();
  assert.equal(h.api.snapshot().mutating,true);assert.match(pairingWires(h).button,/\bdisabled\b/);
  invokeWire(h,wire.click);invokeWire(h,wire.key,pairingEnter().event);await flush();assert.equal(h.calls.filter(q=>q.operation==='createPairing').length,1);
  finish(syntheticPairing());await flush();assert.equal(h.api.snapshot().mutating,false);
  h.setEdit(false);invokeWire(h,wire.click);invokeWire(h,wire.key,pairingEnter().event);await flush();assert.equal(h.calls.filter(q=>q.operation==='createPairing').length,1);
 }
 const denied=setup(()=>overview({canEdit:false}));await denied.api.refresh();denied.api.setName('Jun');const wire=pairingWires(denied);assert.match(wire.button,/\bdisabled\b/);
 invokeWire(denied,wire.click);invokeWire(denied,wire.key,pairingEnter().event);await flush();assert.equal(denied.calls.length,1);
});
test('pairing click fix retains the host sandbox and forbids native form/network destinations',()=>{
 const host=fs.readFileSync(path.join(root,'src/components/OwnerAdminPreview.tsx'),'utf8'),document=fs.readFileSync(path.join(root,'src/lib/ownerPreviewDocument.ts'),'utf8');
 assert.match(host,/sandbox="allow-scripts allow-downloads"/);assert.doesNotMatch(host,/allow-forms|allow-same-origin/);
 assert.match(document,/form-action 'none'/);assert.match(document,/connect-src 'none'/);assert.match(document,/base-uri 'none'/);
});
test('empty inventory gives setup steps and does not invent registered computers or data health',async()=>{
 const h=setup(()=>overview({devices:[]}));h.api.activate();await flush();assert.deepEqual(h.calls,[{action:'collectorControl',operation:'overview'}]);assert.match(h.api.render(),/还没有连接电脑/);assert.match(h.api.render(),/入库时间尚未接入/);assert.doesNotMatch(h.api.render(),/已采集.*笔|测试电脑 A/);h.api.activate();await flush();assert.equal(h.calls.length,1);
});
test('confirmed start changes desired state only; duplicate clicks cannot launch a second request',async()=>{
 let resolveStart;const data=overview();const h=setup(q=>q.operation==='setDesired'?new Promise(resolve=>resolveStart=resolve):clone(data));await h.api.refresh();
 const first=h.api.desired(deviceId,'demo','running');await flush();await h.api.desired(deviceId,'demo','running');assert.equal(h.calls.filter(q=>q.operation==='setDesired').length,1);
 assert.equal(h.api.snapshot().data.devices[0].tasks[0].observedState,'stopped');data.devices[0].tasks[0].desiredState='running';data.devices[0].tasks[0].revision=1;resolveStart({ok:true,revision:1});assert.equal(await first,true);
 assert.equal(h.api.snapshot().data.devices[0].tasks[0].observedState,'stopped');assert.match(h.api.render(),/等待电脑执行/);assert.match(h.api.render(),/已停止/);assert.deepEqual(h.calls.find(q=>q.operation==='setDesired'),{action:'collectorControl',operation:'setDesired',deviceId,taskId:'demo',desiredState:'running',expectedRevision:0});
});
test('offline last-known running status is not shown as current online, and removed tasks cannot be controlled',async()=>{
 const data=overview();data.devices[0].lastSeenAt=new Date(now-91000).toISOString();data.devices[0].tasks[0].observedState='running';data.devices[0].tasks[0].pid=1234;
 const h=setup(()=>data);await h.api.refresh();assert.match(h.api.render(),/离线 \/ 等待连接/);assert.match(h.api.render(),/实际状态仅为最后一次回报/);assert.match(h.api.render(),/进程运行中/);assert.match(h.api.render(),/尚未接入/);
 data.devices[0].tasks[0].observedState='blocked';data.devices[0].tasks[0].detailCode='unavailable';await h.api.refresh();assert.equal(await h.api.desired(deviceId,'demo','running'),false);assert.equal(h.calls.length,2);assert.match(h.api.render(),/本机暂无法确认任务，请检查配置与进程权限/);assert.doesNotMatch(h.api.render(),/本机任务配置已移除/);
});
test('overview accepts 100 current plus 100 retained unavailable tasks while rejecting an oversized inventory',async()=>{
 const data=overview(),task=data.devices[0].tasks[0];data.devices[0].tasks=Array.from({length:200},(_,i)=>({...task,id:'task_'+i,...(i>=100?{observedState:'blocked',detailCode:'unavailable'}:{})}));
 const h=setup(()=>clone(data));await h.api.refresh();assert.equal(h.api.snapshot().data.devices[0].tasks.length,200);assert.equal(h.api.snapshot().error,'');assert.match(h.api.render(),/task_199/);assert.equal(await h.api.desired(deviceId,'task_199','running'),false);
 data.devices[0].tasks.push({...task,id:'task_200'});const oversized=setup(()=>data);await oversized.api.refresh();assert.equal(oversized.api.snapshot().data,null);assert.match(oversized.api.render(),/响应不完整/);
});
test('unconfirmed or conflicting control keeps the previous state and disables new operations until refreshed',async()=>{
 const h=setup(q=>{if(q.operation==='setDesired')throw Error('任务状态已被修改，请刷新后核对再操作');return overview()});await h.api.refresh();assert.equal(await h.api.desired(deviceId,'demo','running'),false);assert.equal(h.api.snapshot().data.devices[0].tasks[0].desiredState,'stopped');assert.match(h.api.render(),/当前状态未确认/);const count=h.calls.length;await h.api.desired(deviceId,'demo','running');assert.equal(h.calls.length,count);await h.api.refresh();assert.equal(h.api.snapshot().error,'');
});
test('single-use pairing is transient, expires visibly, and revoke never claims local processes stopped',async()=>{
 const h=setup(q=>q.operation==='createPairing'?{ok:true,code:'SYNTHETIC_PAIR_123',expiresAt:new Date(now+600000).toISOString()}:q.operation==='revokeDevice'?{ok:true}:overview());await h.api.refresh();h.api.setName('新电脑');await h.api.pair();assert.match(h.api.render(),/SYNTHETIC_PAIR_123/);assert(!JSON.stringify(h.api.snapshot()).includes('SYNTHETIC_PAIR_123'));h.setClock(now+600001);assert.match(h.api.render(),/配对码已过期/);assert.doesNotMatch(h.api.render(),/SYNTHETIC_PAIR_123/);
 await h.api.revoke(deviceId);assert.equal(h.calls.filter(q=>q.operation==='revokeDevice').length,0);await h.api.revoke(deviceId);assert.equal(h.calls.filter(q=>q.operation==='revokeDevice').length,1);assert.match(h.api.render(),/已经运行的进程不会因此自动停止/);
});
test('unavailable endpoint and malformed results remain unknown; text and fixed detail codes cannot inject HTML',async()=>{
 const failed=setup(()=>{throw Error('采集管理服务尚未接通')});await failed.api.refresh();assert.match(failed.api.render(),/首次使用需要部署/);assert.doesNotMatch(failed.api.render(),/还没有连接电脑/);
 const data=overview();data.devices[0].name='<img src=x onerror=alert(1)>';data.devices[0].tasks[0].detailCode='<script>secret</script>';const h=setup(()=>data);await h.api.refresh();assert.match(h.api.render(),/&lt;img/);assert.doesNotMatch(h.api.render(),/<img|secret|<script/);
 for(const broken of [{ok:true},overview({canEdit:'yes'}),overview({devices:[...data.devices,...data.devices]})]){const bad=setup(()=>broken);await bad.api.refresh();assert.match(bad.api.render(),/响应不完整/);assert.equal(bad.api.snapshot().data,null);}
});
test('polling pauses outside this page; read-only users cannot mutate through callable handlers',async()=>{
 const h=setup();await h.api.refresh();h.setActive(false);const [id,timer]=[...h.timers][0];h.timers.delete(id);timer.fn();await flush();assert.equal(h.calls.length,1);h.setActive(true);h.setEdit(false);h.api.setName('not allowed');await h.api.pair();await h.api.desired(deviceId,'demo','running');await h.api.revoke(deviceId);assert.equal(h.calls.length,1);h.api.dispose();assert.equal(h.timers.size,0);
});
test('a polling tick during a slow mutation retains the next status poll',async()=>{
 let resolvePair;const h=setup(q=>q.operation==='createPairing'?new Promise(resolve=>resolvePair=resolve):overview());await h.api.refresh();h.api.setName('电脑 B');const pairing=h.api.pair();await flush();const [id,timer]=[...h.timers][0];h.timers.delete(id);timer.fn();await flush();assert.equal(h.timers.size,1);resolvePair({ok:true,code:'SYNTHETIC_CODE',expiresAt:new Date(now+600000).toISOString()});await pairing;const [nextId,next]=[...h.timers][0];h.timers.delete(nextId);next.fn();await flush();assert.equal(h.calls.filter(q=>q.operation==='overview').length,2);
});

const bridgePrefix=fs.readFileSync(path.join(__dirname,'admin-live-bridge.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {load,session}=new Function('require','__dirname',bridgePrefix+';return {load,session};')(require,__dirname);
const assigned=permissions=>({mode:'assigned',roleId:'33333333-3333-4333-8333-333333333333',roleName:'Synthetic',version:1,permissions,canView:true});
test('host role helper default-denies the new permission for legacy accounts while keeping explicit grants',()=>{
 const prefix=fs.readFileSync(path.join(__dirname,'dashboard-role-access-bridge.test.cjs'),'utf8').split(/\ntest\(/)[0];const {roleModule}=new Function('require','__dirname',prefix+';return {roleModule};')(require,__dirname),{api}=roleModule();
 assert.equal(api.dashboardRoleAllows({mode:'legacy',canView:true,permissions:['collector_control.view','collector_control.edit']},'collector_control'),false);
 assert.equal(api.dashboardRoleAllows({mode:'owner',canView:true,permissions:[]},'collector_control','edit'),true);
 assert.equal(api.dashboardRoleAllows(assigned(['collector_control.view']),'collector_control'),true);
 assert.equal(api.dashboardRoleAllows(assigned(['collector_control.view']),'collector_control','edit'),false);
 assert.equal(api.dashboardRoleAllows(assigned(['collector_control.edit']),'collector_control','edit'),false);
 assert.equal(api.dashboardRoleAllows(assigned(['collector_control.view','collector_control.edit']),'collector_control','edit'),true);
});
test('bridge accepts only bounded control fields, uses fresh human Auth and the fixed session-gated Worker route',async()=>{
 const h=load({fetch:async()=>({ok:true,json:async()=>overview()})});const req={action:'collectorControl',operation:'setDesired',deviceId,taskId:'demo',desiredState:'running',expectedRevision:0};
 for(const bad of [{...req,command:'rm anything'},{...req,path:'/tmp/private'},{...req,taskId:'bad/task'},{...req,expectedRevision:-1},{...req,expectedRevision:'1'},{...req,desiredState:'restart'},{action:'collectorControl',operation:'pair',code:'secret'},{action:'collectorControl',operation:'createPairing',name:'A\nB'}])assert.throws(()=>h.api.validateAdminLiveRequest(bad));
 await h.api.adminLiveRequest(session,req);assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'https://data-center.workdesk-hub.workers.dev/hensem-data-center/api/collector-control');assert.deepEqual(JSON.parse(h.calls[0].init.body),{action:'setDesired',deviceId,taskId:'demo',desiredState:'running',expectedRevision:0});assert.equal(h.calls[0].init.headers.Authorization,'Bearer offline-fresh-token');assert.equal(h.calls[0].init.cache,'no-store');assert.equal(h.calls[0].init.credentials,'omit');
});
test('host rejects legacy/missing control grants even if iframe sends a forged nonce-valid request',async()=>{
 for(const access of [null,{mode:'legacy',permissions:['collector_control.view','collector_control.edit'],canView:true},assigned(['collector_control.view'])]){
  const h=load(),replies=[],child={postMessage:data=>replies.push(data)};const cleanup=h.api.installAdminLiveBridge({source:()=>child,channel:()=> 'nonce',session,target:h.target,roleAccess:()=>access});h.send({source:child,origin:'null',data:{type:h.api.LIVE_REQUEST,id:'control',channel:'nonce',page:'collector_control',request:{action:'collectorControl',operation:'createPairing',name:'Mac'}}});await flush();assert.equal(h.calls.length,0);assert.match(replies[0].error,/没有采集管理/);cleanup();
 }
 for(const access of [{mode:'owner',permissions:[],canView:true},assigned(['collector_control.view'])]){
  const h=load({fetch:async()=>({ok:true,json:async()=>overview()})}),child={postMessage(){}};const cleanup=h.api.installAdminLiveBridge({source:()=>child,channel:()=> 'nonce',session,target:h.target,roleAccess:()=>access});h.send({source:child,origin:'null',data:{type:h.api.LIVE_REQUEST,id:'control',channel:'nonce',page:'collector_control',request:{action:'collectorControl',operation:'overview'}}});await flush();assert.equal(h.calls.length,1);cleanup();
 }
});
test('iframe denies legacy control but allows assigned view without a query grant; no tokens enter the frame',async()=>{
 const h=load();h.target.location={origin:'https://dashboard.invalid',pathname:'/',hash:'#admin/collector_control'};
 for(const [policy,allowed] of [[{mode:'legacy',permissions:['collector_control.view'],canView:true},false],[assigned(['collector_control.view']),true]]){
  const posts=[],html=h.api.makeAdminLiveDocument('<!doctype html><html></html>','nonce',policy),ctx=vm.createContext({parent:{postMessage:data=>posts.push(data)},setTimeout:()=>1,clearTimeout(){},addEventListener(){}});vm.runInContext('window=globalThis',ctx);vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],ctx);
  assert.equal(ctx.hensemRoleAllowed('collector_control'),allowed);const request=ctx.hensemLiveRequest({action:'collectorControl',operation:'overview'});
  if(allowed){assert.equal(posts.length,1);const rejection=assert.rejects(request,/查询已取消/);ctx.hensemLiveCancelRequests();await rejection;}else{await assert.rejects(request,/没有此页面/);assert.equal(posts.length,0)}
  assert.doesNotMatch(html,/offline-old-token|offline-refresh/);
 }
});
test('actual restored navigation opens the control page without loading order catalogs, legacy cannot navigate there',async()=>{
 let prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];prefix=prefix.replace("const layoutSources=[","const layoutSources=['live-collector-control.js',");
 const {harness,settle}=new Function('require','__dirname',prefix+';return {harness,settle};')(require,__dirname);
 const owner=harness({initialPage:'collector_control',roleAccess:{mode:'owner',canView:true,permissions:[]},roleAllowed:()=>true,handler:q=>q.action==='collectorControl'?overview({devices:[]}):{platforms:[]}});await settle();assert.equal(owner.c.state.page,'collector_control');assert.deepEqual(owner.calls.map(q=>q.action),['collectorControl']);assert.match(owner.html(),/还没有连接电脑/);assert(owner.c.navGroupsV3.some(g=>g[3].includes('collector_control')));assert(owner.c.pages.some(p=>p[0]==='daily_comparison'));assert(owner.c.pages.some(p=>p[0]==='success_analysis'));
 const legacy=harness({initialPage:'collector_control',roleAccess:{mode:'legacy',canView:true,permissions:[]},roleAllowed:page=>page!=='collector_control'});await settle();assert(!legacy.c.pages.some(p=>p[0]==='collector_control'));legacy.c.setPage('collector_control');assert.notEqual(legacy.c.state.page,'collector_control');
});
test('collector control uses the current session identity and never replays a mutation after an auth failure',async()=>{
 const request={action:'collectorControl',operation:'createPairing',name:'Mac'};
 const changed=load({ensure:async current=>({...current,user:{id:'another-user'}})});await assert.rejects(changed.api.adminLiveRequest(session,request),/账号已改变/);assert.equal(changed.calls.length,0);
 const expired=load({fetch:async()=>({ok:false,status:401,json:async()=>({error:'application_session_denied'})})});await assert.rejects(expired.api.adminLiveRequest(session,request),/登录已失效/);assert.equal(expired.authCalls.length,1);assert.equal(expired.calls.length,1);
 const controller=new AbortController();controller.abort();const aborted=load();await assert.rejects(aborted.api.adminLiveRequest(session,request,controller.signal));assert.equal(aborted.calls.length,0);
});
test('collector requests cannot borrow another page context even for an owner',async()=>{
 const h=load(),replies=[],child={postMessage:data=>replies.push(data)};
 const cleanup=h.api.installAdminLiveBridge({source:()=>child,channel:()=> 'nonce',session,target:h.target,roleAccess:()=>({mode:'owner',permissions:[],canView:true})});
 h.send({source:child,origin:'null',data:{type:h.api.LIVE_REQUEST,id:'wrong_page',channel:'nonce',page:'overview',request:{action:'collectorControl',operation:'overview'}}});await flush();assert.equal(h.calls.length,0);assert.match(replies[0].error,/没有采集管理/);cleanup();
});
test('revoked application sessions and denied networks keep distinct bounded errors without replaying writes',async()=>{
 for(const [code,message] of [['application_session_denied',/登录已失效/],['ip_denied',/当前网络未获/],['permission_denied',/没有采集管理/]]){
  const h=load({fetch:async()=>({ok:false,status:403,json:async()=>({ok:false,code,message:'raw backend private details'})})});await assert.rejects(h.api.adminLiveRequest(session,{action:'collectorControl',operation:'createPairing',name:'Mac'}),message);assert.equal(h.calls.length,1);
 }
 const h=load();for(const operation of ['constructor','__proto__','toString'])assert.throws(()=>h.api.validateAdminLiveRequest({action:'collectorControl',operation}),/采集管理参数无效/);
});
