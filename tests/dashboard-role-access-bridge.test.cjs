// Real role policy, host bridge and iframe/menu code; only synthetic transport/DOM.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const authErrors=require('./load-typescript.cjs').loadTs(path.join(root,'src/lib/dashboardAuthClient.ts'));
const bridgePrefix=fs.readFileSync(path.join(__dirname,'admin-live-bridge.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {load,session,query,flush,deferred}=new Function('require','__dirname',bridgePrefix+';return {load,session,query,flush,deferred};')(require,__dirname);
const roleId='33333333-3333-4333-8333-333333333333';
const assigned=(permissions,extra={})=>({mode:'assigned',roleId,roleName:'Synthetic',version:1,assignmentVersion:1,canView:true,permissions,...extra});
function roleModule(options={}){
 const calls=[],auth=[],module={exports:{}};
 const text=ts.transpileModule(fs.readFileSync(path.join(root,'src/lib/dashboardRoleAccess.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(text,{module,exports:module.exports,URL,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://role.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-public'}},
  require:name=>name==='./dashboardRoleCatalog.json'?{default:JSON.parse(fs.readFileSync(path.join(root,'src/lib/dashboardRoleCatalog.json'),'utf8'))}:{dashboardResponseError:authErrors.dashboardResponseError,ensureDashboardSession:async current=>{auth.push(current);return options.ensure?options.ensure(current):{...current,access_token:'synthetic-fresh'};}},
  fetch:async(url,init)=>{calls.push({url,init});return Response.json(options.value||assigned(['providers.view']),{status:options.status||200});}
 });return {api:module.exports,calls,auth};
}
function frame(policy,page='providers'){
 const host=load(),posts=[],timers=new Map();let n=0;
 host.target.location={origin:'https://dashboard.invalid',pathname:'/app/',hash:'#admin/'+page};
 const html=host.api.makeAdminLiveDocument('<!doctype html><html><head></head><body></body></html>','nonce',policy);
 const parent={postMessage:(data,origin)=>posts.push({data,origin})};
 const context=vm.createContext({parent,setTimeout:(callback,ms)=>{timers.set(++n,{callback,ms});return n;},clearTimeout:id=>timers.delete(id),addEventListener(){}});
 vm.runInContext('window=globalThis',context);vm.runInContext([...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)][0][1],context);
 return {c:context,posts,timers,html};
}

test('role policy requires assigned page view plus each action; owner/legacy retain existing access',()=>{
 const {api}=roleModule(),a=assigned(['providers.query','providers.export','rates.view']);
 assert.equal(api.dashboardRoleAllows(a,'providers','query'),false);assert.equal(api.dashboardRoleAllows(a,'rates'),true);assert.equal(api.dashboardRoleAllows(a,'rates','query'),false);
 assert.equal(api.dashboardRoleAllows({...a,canView:false},'rates'),false);assert.equal(api.dashboardRoleAllows(null,'rates'),false);
 for(const mode of ['owner','legacy'])assert.equal(api.dashboardRoleAllows({mode,permissions:[],canView:true},'providers','query'),true);
 for(const value of [{},{...a,permissions:['unknown.view']},{...a,version:-1},{...a,canView:'true'},{...a,roleId:'bad'}])assert.throws(()=>api.validateDashboardRoleAccess(value));
});
test('role reads use refreshed same-account token, fixed caller RPC and no cache on every request',async()=>{
 const h=roleModule(),abort=new AbortController();await h.api.readDashboardRoleAccess(session,abort.signal);await h.api.readDashboardRoleAccess(session,abort.signal);
 assert.equal(h.calls.length,2);assert.equal(h.auth.length,2);
 for(const {url,init} of h.calls){assert.equal(url,'https://role.invalid/rest/v1/rpc/dashboard_role_access');assert.equal(init.headers.Authorization,'Bearer synthetic-fresh');assert.equal(init.headers.apikey,'synthetic-public');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.signal,abort.signal);assert.equal(init.body,'{}');}
 const changed=roleModule({ensure:async current=>({...current,user:{id:'different'}})});await assert.rejects(changed.api.readDashboardRoleAccess(session),/账号已改变/);assert.equal(changed.calls.length,0);
 for(const status of [401,403,500])await assert.rejects(roleModule({status}).api.readDashboardRoleAccess(session));
});
test('assigned gateway retains the validated action while legacy/owner keep dedicated RPC envelope',async()=>{
 const h=load(),request={action:'rates'};await h.api.adminLiveRequest(session,request,undefined,{assigned:true,page:'rates'});
 assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_execute');assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_page:'rates',p_request:request});
 for(const context of [undefined,{assigned:false,page:'rates'}])await h.api.adminLiveRequest(session,request,undefined,context);
 for(const {url,init} of h.calls.slice(1)){assert.equal(url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_rates');assert.deepEqual(JSON.parse(init.body),{p_request:{}});}
 assert(h.calls.every(({init})=>init.headers.Authorization==='Bearer offline-fresh-token'&&init.cache==='no-store'));
});
test('assigned gateway does not retry permission rejection through old RPC',async()=>{
 const h=load({fetch:async()=>({ok:false,status:403,json:async()=>({message:'role_permission_denied PRIVATE_SENTINEL'})})});
 await assert.rejects(h.api.adminLiveRequest(session,{action:'rates'},undefined,{assigned:true,page:'rates'}),error=>/当前角色/.test(error.message)&&!error.message.includes('PRIVATE_SENTINEL'));
 assert.equal(h.calls.length,1);assert(h.calls[0].url.endsWith('/dashboard_admin_execute'));
});
test('host bridge reads current role for queued requests and retains the originating page',async()=>{
 const waiting=deferred(),h=load({fetch:()=>waiting.promise}),replies=[],child={postMessage:data=>replies.push(data)};
 let access={mode:'legacy',permissions:[],canView:true};
 const stop=h.api.installAdminLiveBridge({source:()=>child,channel:()=> 'nonce',session,target:h.target,roleAccess:()=>access});
 const send=(id,page)=>h.send({source:child,origin:'null',data:{type:h.api.LIVE_REQUEST,id,channel:'nonce',page,request:{action:'rates'}}});
 for(let i=0;i<5;i++)send('request_'+i,'rates');await flush();assert.equal(h.calls.length,4);
 access=assigned(['rates.view','rates.query']);waiting.resolve({ok:true,json:async()=>({rows:[],total:0})});await flush();await flush();
 assert.equal(h.calls.length,5);assert.equal(h.calls[4].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_execute');assert.equal(JSON.parse(h.calls[4].init.body).p_page,'rates');
 assert.equal(replies.length,5);stop();
});
test('iframe rejects missing page grants, query and detail grants before sending, including after navigation',async()=>{
 const h=frame(assigned(['providers.view','providers.query']));
 h.c.hensemCurrentAdminPage=()=> 'rates';await assert.rejects(h.c.hensemLiveRequest({action:'rates'}),/没有此页面或操作权限/);assert.equal(h.posts.length,0);
 h.c.hensemCurrentAdminPage=()=> '';h.c.hensemAdminInitialPage='';await assert.rejects(h.c.hensemLiveRequest({action:'catalog'}),/没有此页面或操作权限/);assert.equal(h.posts.length,0);
 h.c.hensemCurrentAdminPage=()=> 'providers';await assert.rejects(h.c.hensemLiveRequest({action:'details'}),/没有查看明细权限/);assert.equal(h.posts.length,0);
 h.c.hensemRoleAccess=assigned(['providers.view']);await assert.rejects(h.c.hensemLiveRequest({action:'aggregate'}),/没有此页面或操作权限/);assert.equal(h.posts.length,0);
 const pending=h.c.hensemLiveRequest({action:'catalog'});assert.equal(h.posts.length,1);assert.equal(h.posts[0].data.page,'providers');const rejected=assert.rejects(pending,/查询已取消/);h.c.hensemLiveCancelRequests();await rejected;
 assert(!h.html.includes('offline-old-token'));assert(!h.html.includes('offline-refresh'));
});
test('iframe owner/legacy do not gain assigned restrictions',async()=>{
 for(const mode of ['owner','legacy']){const h=frame({mode,permissions:[],canView:true});const pending=h.c.hensemLiveRequest({action:'details'});assert.equal(h.posts.length,1);const rejected=assert.rejects(pending,/查询已取消/);h.c.hensemLiveCancelRequests();await rejected;}
});
test('configuration batch envelopes retain payout permissions across navigation without granting other pages',async()=>{
 const h=frame(assigned(['payout_config.view','payout_config.query','providers.view']), 'payout_config');
 let current='payout_config';h.c.hensemCurrentAdminPage=()=>current;
 const index=h.c.hensemLiveRequest({action:'payoutConfig',operation:'index',system:'AR'});current='providers';
 const snapshot=h.c.hensemLiveRequest({action:'payoutConfig',operation:'snapshot',system:'AR',country:'IN',platform:'SYNTHETIC'});
 assert.equal(h.posts.length,2);assert(h.posts.every(x=>x.data.page==='payout_config'));
 await assert.rejects(h.c.hensemLiveRequest({action:'aggregate'}),/没有此页面或操作权限/);assert.equal(h.posts.length,2);
 h.c.hensemRoleAccess=assigned(['providers.view','providers.query']);await assert.rejects(h.c.hensemLiveRequest({action:'payoutConfig',operation:'index',system:'WG'}),/没有此页面或操作权限/);assert.equal(h.posts.length,2);
 const rejected=[assert.rejects(index,/查询已取消/),assert.rejects(snapshot,/查询已取消/)];h.c.hensemLiveCancelRequests();await Promise.all(rejected);
 const server=load();await server.api.adminLiveRequest(session,h.posts[1].data.request,undefined,{assigned:true,page:h.posts[1].data.page});assert.equal(server.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_execute');assert.equal(JSON.parse(server.calls[0].init.body).p_page,'payout_config');
});

let navigationPrefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
navigationPrefix=navigationPrefix.replace('context.window=context;vm.createContext(context);','context.window=context;if(options.rolePolicy){context.hensemRoleAccess=options.rolePolicy;context.hensemRoleAllowed=options.roleAllows;}vm.createContext(context);');
const {harness,settle}=new Function('require','__dirname',navigationPrefix+';return {harness,settle};')(require,__dirname);
test('real menu removes unauthorized pages before deep link and tab initialization, and blocks global navigation/export',async()=>{
 const {api}=roleModule(),policy=assigned(['providers.view']),h=harness({page:'rates',initialPage:'access',rolePolicy:policy,roleAllows:(page,action)=>api.dashboardRoleAllows(policy,page,action)});
 await settle();assert.deepEqual(Array.from(h.c.pages,p=>p[0]),['providers']);assert.equal(h.c.state.page,'providers');
 assert(h.c.navGroupsV3.every(group=>group[3].every(key=>key==='providers')));assert.deepEqual(h.calls.map(r=>r.action),['catalog']);assert.equal(h.L.pageQueried,false);
 const before=h.calls.length;h.c.setPage('access');h.c.setPage('rates');h.c.liveExport();await settle();assert.equal(h.c.state.page,'providers');assert.equal(h.calls.length,before);assert.equal(h.blobs.length,0);assert.doesNotMatch(h.nodes.get('.title-actions').innerHTML,/liveExport/);
});
test('real menu handles no assigned directories without issuing reads, preserving owner/legacy navigation',async()=>{
 const {api}=roleModule();let policy=assigned([], {canView:false});let h=harness({rolePolicy:policy,roleAllows:(page,action)=>api.dashboardRoleAllows(policy,page,action)});await settle();assert.equal(h.calls.length,0);assert.match(h.nodes.get('page').textContent,/没有可用目录/);
 for(const mode of ['owner','legacy']){policy={mode,permissions:[],canView:true};h=harness({rolePolicy:policy,roleAllows:(page,action)=>api.dashboardRoleAllows(policy,page,action)});await settle();assert(h.c.pages.some(p=>p[0]==='access'));assert(h.c.pages.some(p=>p[0]==='rates'));h.c.setPage('rates');await settle();assert.equal(h.c.state.page,'rates');assert.equal(h.calls.filter(r=>r.action!=='catalog').length,0);}
});


test('assigned empty or malformed host page is rejected before auth or transport',async()=>{
 for(const page of ['',undefined,'bad/page','Rates']){const h=load();await assert.rejects(h.api.adminLiveRequest(session,{action:'rates'},undefined,{assigned:true,page}),/当前角色/);assert.equal(h.authCalls.length,0);assert.equal(h.calls.length,0);}
});
test('iframe detail prechecks match SQL for raw query, workorders and deposit statistics',async()=>{
 for(const [page,request] of [['orders',{action:'query'}],['workorders',{action:'workorderRecords',operation:'detail'}],['workorders',{action:'workorderRecords',operation:'orderDetail'}],['deposit_statistics',{action:'depositStatistics',section:'details'}],['deposit_statistics',{action:'depositIssues'}]]){
  const h=frame(assigned([page+'.view',page+'.query']),page);await assert.rejects(h.c.hensemLiveRequest(request),/没有查看明细权限/);assert.equal(h.posts.length,0);
 }
});

test('retired stability permissions are discarded without granting providers or rejecting unrelated valid grants',()=>{
 const {api}=roleModule(),input=assigned(['channelquality.view','channelquality.query','providers.view']),a=api.validateDashboardRoleAccess(input);assert.deepEqual(Array.from(a.permissions),['providers.view']);assert.equal(a.canView,true);assert.equal(input.permissions.length,3);assert.equal(api.dashboardRoleAllows(a,'providers'),true);assert.equal(api.dashboardRoleAllows(a,'providers','query'),false);
 const only=api.validateDashboardRoleAccess(assigned(['channelquality.view','channelquality.export']));assert.equal(only.canView,false);assert.equal(only.permissions.length,0);
 for(const mode of ['owner','legacy'])assert.equal(api.dashboardRoleAllows({mode,permissions:[],canView:true},'channelquality'),false);assert.throws(()=>api.validateDashboardRoleAccess(assigned(['channelquality.delete'])),/不完整/);
 assert(!JSON.parse(fs.readFileSync(path.join(root,'src/lib/dashboardRoleCatalog.json'),'utf8')).pages.some(p=>p.id==='channelquality'));
});

test('role policy lookup preserves revoked application-session errors instead of reporting a disabled profile',async()=>{
 const h=roleModule({status:403,value:{code:'42501',message:'application_session_denied'}});
 const error=await h.api.readDashboardRoleAccess(session).catch(error=>error);
 assert.equal(error.code,'application_session_denied');assert.equal(error.status,403);assert.match(error.message,/会话已失效.*重新登录/);assert.doesNotMatch(error.message,/停用/);assert.equal(h.calls.length,1);
 assert(authErrors.isDashboardAuthTerminalError(error));
 const retry=roleModule({status:503,value:{code:'service_unavailable',message:'private detail'}});
 const temporary=await retry.api.readDashboardRoleAccess(session).catch(error=>error);assert.equal(authErrors.isDashboardAuthTerminalError(temporary),false);assert.doesNotMatch(temporary.message,/private detail/);
});
