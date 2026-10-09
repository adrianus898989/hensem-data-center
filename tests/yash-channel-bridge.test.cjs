const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-live-bridge.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {load,session}=new Function('require','__dirname',prefix+';return {load,session};')(require,__dirname);
const rolePrefix=fs.readFileSync(path.join(__dirname,'dashboard-role-access-bridge.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {roleModule,assigned,frame}=new Function('require','__dirname',rolePrefix+';return {roleModule,assigned,frame};')(require,__dirname);
const request={action:'channelStatus',platformIds:['11111111-1111-4111-8111-111111111111'],direction:'all'};
test('channel status owner RPC and assigned gateway keep fresh auth and exact arguments',async()=>{
 const h=load();await h.api.adminLiveRequest(session,request);assert.equal(h.calls[0].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_live_channel_status');assert.deepEqual(JSON.parse(h.calls[0].init.body),{p_request:{platformIds:request.platformIds,direction:'all'}});assert.equal(h.calls[0].init.headers.Authorization,'Bearer offline-fresh-token');assert.equal(h.calls[0].init.cache,'no-store');
 await h.api.adminLiveRequest(session,request,undefined,{assigned:true,page:'channel_status'});assert.equal(h.calls[1].url,'https://offline.invalid/rest/v1/rpc/dashboard_admin_execute');assert.deepEqual(JSON.parse(h.calls[1].init.body),{p_page:'channel_status',p_request:request});
});
test('channel snapshot query validator accepts only typed latest-snapshot filters',()=>{
 const {api}=load();assert.doesNotThrow(()=>api.validateAdminLiveRequest({...request,providers:['OnePay','TwoPay']}));
 for(const patch of [{platformIds:[]},{platformIds:Array(21).fill(request.platformIds[0])},{platformIds:[request.platformIds[0],request.platformIds[0].toUpperCase()]},{platformIds:[{}]},{direction:'deposit'},{direction:null},{direction:1},{providers:null},{providers:[{}]},{providers:[' ']},{providers:[' Pay']},{providers:['Pay\n']},{providers:['One','One']},{providers:Array(201).fill('One')},{date:'2026-10-07'},{country:'IN'},{startAt:'2026-10-07'},{operation:'edit'},{notes:'x'},{status:'enabled'}])assert.throws(()=>api.validateAdminLiveRequest({...request,...patch}));
});
test('host and injected role policy both deny legacy and keep independent channel view/query/detail/export grants',()=>{
 const {api}=roleModule(),keys=['channel_status.view','channel_status.query','channel_status.detail','channel_status.export'];
 for(const action of ['view','query','detail','export']){
  for(const allow of [api.dashboardRoleAllows,(access,page,a)=>frame(access,page).c.hensemRoleAllowed(page,a)]){
   assert.equal(allow({mode:'owner',canView:true,permissions:[]},'channel_status',action),true);
   assert.equal(allow({mode:'legacy',canView:true,permissions:keys},'channel_status',action),false);
   assert.equal(allow(assigned(['providers.view','providers.query','providers.detail','providers.export']),'channel_status',action),false);
   assert.equal(allow(assigned(keys),'channel_status',action),true);
  }
 }
 assert.equal(api.dashboardRoleAllows(assigned(['channel_status.view']),'channel_status','query'),false);assert.equal(api.dashboardRoleAllows(assigned(['channel_status.query']),'channel_status','query'),false);
});
