const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const filename=path.join(__dirname,'admin-live-bridge.test.cjs'),req=createRequire(filename),ctx={require:req,__dirname,console,process,URL,AbortController,structuredClone};vm.createContext(ctx);vm.runInContext(fs.readFileSync(filename,'utf8').split('\ntest(')[0]+'\nglobalThis.fixture={load,query,session};',ctx,{filename});const {load,query,session}=ctx.fixture;
const base={...query,action:'analysisOrders',direction:'charge',status:'all',kind:'custom',basis:'created',amountMin:200,amountMax:250,amountMaxExclusive:true,hourRange:{minHour:1,maxHour:3},offset:0,limit:20};
test('owner and legacy route exact segment/clock/pagination to raw-order RPC without exposing session in request',async()=>{
 const h=load();await h.api.adminLiveRequest(session,base);assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_analysis_orders');const expected={...base};delete expected.action;assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_request:expected});assert.equal(h.calls[0].init.cache,'no-store');
 await h.api.adminLiveRequest(session,{...base,basis:'success',offset:20});assert.equal(JSON.parse(h.calls[1].init.body).p_request.offset,20);
});
test('assigned role uses only the signed page gateway and retains action, never falls back to legacy endpoint',async()=>{
 const h=load();await h.api.adminLiveRequest(session,base,undefined,{assigned:true,page:'matrix'});assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_execute');assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_page:'matrix',p_request:base});
 const denied=load({fetch:async()=>({ok:false,status:403,json:async()=>({message:'role_permission_denied'})})});await assert.rejects(denied.api.adminLiveRequest(session,base,undefined,{assigned:true,page:'matrix'}),/当前角色/);assert.equal(denied.calls.length,1);
});
test('real iframe demands detail as well as view and query for the new raw-order action before sending',async()=>{
 const h=load();h.target.location={origin:'https://dashboard.invalid',pathname:'/app/',hash:'#admin/matrix'};const role={mode:'assigned',roleId:'33333333-3333-4333-8333-333333333333',version:1,assignmentVersion:1,canView:true,permissions:['matrix.view','matrix.query']};const html=h.api.makeAdminLiveDocument('<!doctype html><html><head></head><body></body></html>','nonce',role),posts=[],timers=new Map();let n=0;
 const f=vm.createContext({parent:{postMessage:data=>posts.push(data)},setTimeout:cb=>{timers.set(++n,cb);return n;},clearTimeout:id=>timers.delete(id),addEventListener(){}});vm.runInContext('window=globalThis',f);vm.runInContext([...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)][0][1],f);f.hensemCurrentAdminPage=()=> 'matrix';await assert.rejects(f.hensemLiveRequest(base),/没有查看明细权限/);assert.equal(posts.length,0);
 f.hensemRoleAccess={...role,permissions:[...role.permissions,'matrix.detail']};const pending=f.hensemLiveRequest(base);assert.equal(posts.length,1);assert.equal(posts[0].page,'matrix');const rejected=assert.rejects(pending,/查询已取消/);f.hensemLiveCancelRequests();await rejected;
});
test('unknown authority, ambiguous clocks and malformed or incompatible segments fail before authentication or network',async()=>{
 const h=load();for(const extra of [{basis:undefined},{basis:'mixed'},{basis:null},{limit:500},{limit:'20'},{offset:-1},{status:'success'},{view:'drilldown'},{kind:'hourly',hour:1},{kind:'custom',durationVersion:2},{kind:'latency',basis:'created',bucket:0},{hourRange:{minHour:1,maxHour:1}},{amountMin:250,amountMax:250},{roleId:'owner'}])await assert.rejects(h.api.adminLiveRequest(session,{...base,...extra}));
 assert.equal(h.authCalls.length,0);assert.equal(h.calls.length,0);for(const action of ['details','aggregate','catalog'])assert.throws(()=>h.api.validateAdminLiveRequest({...query,action,basis:'created'}));
});
test('all standard and duration segments keep their exact bounds and exclusive semantics',()=>{
 const h=load(),q={...query,action:'analysisOrders',status:'all',direction:'charge',basis:'success',limit:20};for(const extra of [{kind:'hourly',hour:8},{kind:'amount',bucket:'200'},{kind:'amount_range',bucket:'100–200'},{kind:'matrix',hour:8,bucket:'200'},{kind:'matrix_range',hour:8,bucket:'100–200'},{kind:'latency',bucket:2,durationVersion:2,cumulative:false},{kind:'latency',durationVersion:2,durationRange:{minSeconds:120,maxSeconds:180}}])assert.doesNotThrow(()=>h.api.validateAdminLiveRequest({...q,...extra}));
});
