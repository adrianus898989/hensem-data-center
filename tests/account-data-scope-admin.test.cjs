const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const {loadTs, root} = require('./load-typescript.cjs');
const token='header.'+Buffer.from(JSON.stringify({session_id:'33333333-3333-4333-8333-333333333333'})).toString('base64url')+'.signature';
const ALL = {mode:'all',countries:[]};
const PANGHU = {mode:'selected',countries:['BR_PANGHU']};
const BOTH = {mode:'selected',countries:['BR','BR_PANGHU']};
const VN = {mode:'selected',countries:['VN']};
const full = {home:true,third_party:true,auto_withdraw:true,work_orders:true,customer_service:true};
const management = {manage_viewers:true,refresh_data:true,view_audit:true};
const clone = value => structuredClone(value);
const profile = (username, role, extra={}) => ({auth_user_id:`fixture-${username}`,username,role,active:true,permissions:{...full},management_permissions:{...management},updated_at:'2026-09-01',...extra});
const compiled = ts.transpileModule(fs.readFileSync(path.join(root,'BACKEND_CURRENT/dashboard-user-admin.ts'),'utf8').replace(/^import .*;\n/,''), {
  compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS},
}).outputText;

async function edge(action, patch={}, options={}) {
  const caller=profile('manager', options.role||'admin', options.caller||{});
  const target=profile('target','viewer',options.target||{});
  const users=clone(options.users||[target]);
  const writes=[],authCalls=[],audits=[],reads=[];
  let handler;
  const client={rpc:async name=>({data:name==="application_session_check"?{allowed:options.sessionAllowed!==false}:null,error:options.sessionFailure&&name==="application_session_check"?{message:"PRIVATE_SESSION_FAILURE"}:options.revokeFailure&&name==="application_revoke_user_sessions"?{message:"PRIVATE_REVOKE_FAILURE"}:null}),auth:{
    getUser:async()=>({data:{user:options.invalidToken?null:{id:caller.auth_user_id,user_metadata:{dashboard_role:'owner',data_scope:ALL}}}}),
    admin:{
      createUser:async data=>{authCalls.push({action:'create',data});return {data:{user:{id:'fixture-created'}}};},
      updateUserById:async(id,data)=>{authCalls.push({action:'reset',id,data});return {};},
      deleteUser:async id=>{authCalls.push({action:'delete',id});return {};},
    },
  },from(table){
    const filters=[]; let patchValue,selection='';
    const query={
      select(value){selection=value;return query;},
      eq(key,value){filters.push([key,value]);return query;},
      order(){return query;},limit(){return query;},
      update(value){patchValue=value;return query;},
      async insert(value){
        if(table==='dashboard_audit_log'){audits.push(clone(value));return {};}
        assert.equal(table,'dashboard_profiles');
        if(options.insertError)return {error:{message:'fixture insert failed'}};
        writes.push(clone(value));return {};
      },
      async maybeSingle(){
        reads.push({table,selection,filters:clone(filters)});
        assert.equal(table,'dashboard_profiles','out-of-scope global table must not be read');
        if(patchValue){
          if(options.race||!filters.every(([key,value])=>target[key]===value))return {data:null};
          writes.push(clone(patchValue));Object.assign(target,patchValue);return {data:{role:target.role}};
        }
        if(filters.some(([key,value])=>key==='auth_user_id'&&value===caller.auth_user_id))return {data:options.callerMissing?null:clone(caller)};
        if(filters.some(([key,value])=>key==='username'&&value==='newuser'))return {data:null};
        return {data:clone(target)};
      },
      then(resolve,reject){
        reads.push({table,selection,filters:clone(filters)});
        if(table!=='dashboard_profiles')return Promise.reject(Error(`Global table read forbidden: ${table}`)).then(resolve,reject);
        return Promise.resolve({data:users}).then(resolve,reject);
      },
    };return query;
  }};
  vm.runInNewContext(compiled,{createClient:()=>client,Deno:{env:{get:()=> 'fixture'},serve:fn=>{handler=fn;}},Request,Response,Date,Intl,console,AbortSignal,atob,TextEncoder,TextDecoder,Uint8Array,
    fetch:async(url,init)=>{if(String(url).endsWith('/rest/v1/rpc/dashboard_account_action_allowed')){assert.equal(init.headers.Authorization,'Bearer '+token);assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');if(options.targetRoleFailure)throw Error('TARGET_LOOKUP_FAILED');return Response.json(options.targetAllowed!==false,{status:options.targetStatus||200});}assert(String(url).endsWith('/rest/v1/rpc/dashboard_role_access'),'only fresh role validation may use network');assert.equal(init.headers.Authorization,'Bearer '+token);assert.equal(init.headers.apikey,'fixture');assert.equal(init.method,'POST');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');if(options.roleFailure)throw Error('synthetic network');return Response.json(options.roleAccess||{mode:caller.role==='owner'?'owner':'legacy',canView:true,permissions:[]},{status:options.roleStatus||200})}});
  const body={action,username:action.startsWith('create')?'newuser':'target',password:'fixture-password',...patch};
  const response=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{...(options.noToken?{}:{authorization:'Bearer '+token}),...options.headers},body:JSON.stringify(body)}));
  return {status:response.status,body:await response.json(),writes,authCalls,audits,reads,target};
}

test('legacy owner/admin omitted creation scope stays all; limited admin omission inherits its scope on both entrypoints',async()=>{
  for(const action of ['create-account','create-viewer'])for(const [options,expected] of [[{role:'owner'},ALL],[{},ALL],[{caller:{data_scope:PANGHU}},PANGHU]]){
    const result=await edge(action,{},options);assert.equal(result.status,200);
    assert.deepEqual(result.writes[0].data_scope,expected);assert.deepEqual(result.body.data_scope,expected);
    assert.deepEqual(result.audits[0].details.data_scope,expected);
  }
});
test('owner can explicitly create admin or viewer limited to Panghu without changing module choices',async()=>{
  for(const role of ['viewer','admin']){
    const permissions={...full,work_orders:false};
    const result=await edge('create-account',{role,data_scope:PANGHU,permissions},{role:'owner'});
    assert.equal(result.status,200);assert.deepEqual(result.writes[0].data_scope,PANGHU);assert.deepEqual(result.writes[0].permissions,permissions);
  }
});
test('new invalid scopes reject before auth creation; never silently turn into all',async()=>{
  for(const action of ['create-account','create-viewer'])for(const data_scope of [null,{},[],{mode:'all'}, {mode:'all',countries:['BR']},{mode:'selected',countries:[]},{mode:'selected',countries:['bad']},{mode:'selected',countries:[1]},{...PANGHU,extra:true}]){
    const result=await edge(action,{data_scope});assert.equal(result.status,400);assert.deepEqual(result.authCalls,[]);assert.deepEqual(result.writes,[]);
  }
});
test('limited admin cannot create all/outside viewers, admin peers, or trust forged user metadata',async()=>{
  for(const action of ['create-account','create-viewer'])for(const data_scope of [ALL,VN,BOTH]){
    const result=await edge(action,{data_scope},{caller:{data_scope:PANGHU}});assert.equal(result.status,403);assert.deepEqual(result.authCalls,[]);
  }
  assert.equal((await edge('create-account',{role:'admin',data_scope:PANGHU},{caller:{data_scope:PANGHU}})).status,403);
});
test('scope-only update leaves permissions, active, role and management untouched and uses timestamp CAS',async()=>{
  for(const action of ['update-account','update-viewer']){
    const result=await edge(action,{data_scope:PANGHU},{target:{data_scope:ALL}});assert.equal(result.status,200);
    assert.deepEqual(Object.keys(result.writes[0]).sort(),['data_scope','updated_at']);
    assert.deepEqual(result.target.permissions,full);assert.equal(result.target.role,'viewer');assert.equal(result.target.active,true);
    assert(result.reads.some(read=>read.filters.some(([key,value])=>key==='updated_at'&&value==='2026-09-01')));
    assert.equal((await edge(action,{data_scope:PANGHU},{race:true})).status,409);
  }
});
test('ordinary module/active updates omit scope and retain existing selected scope',async()=>{
  for(const action of ['update-account','update-viewer']){
    const result=await edge(action,{active:false,permissions:{...full,work_orders:false}},{target:{data_scope:PANGHU}});
    assert.equal(result.status,200);assert.equal(result.writes[0].data_scope,undefined);assert.deepEqual(result.target.data_scope,PANGHU);
  }
});
test('limited admin can edit only subset targets, never expands scope or disguises it as legacy viewer action',async()=>{
  for(const action of ['update-account','update-viewer']){
    const okay=await edge(action,{data_scope:PANGHU},{caller:{data_scope:BOTH},target:{data_scope:PANGHU}});assert.equal(okay.status,200);
    for(const targetScope of [ALL,VN,undefined]){
      const denied=await edge(action,{data_scope:PANGHU,active:true},{caller:{data_scope:PANGHU},target:{data_scope:targetScope,active:false}});
      assert.equal(denied.status,403);assert.deepEqual(denied.writes,[]);
    }
    const expansion=await edge(action,{data_scope:ALL},{caller:{data_scope:PANGHU},target:{data_scope:PANGHU}});assert.equal(expansion.status,403);
  }
});
test('reset/delete cannot access broader, cross-country or disabled broader accounts',async()=>{
  for(const action of ['reset-password','delete-account']){
    for(const data_scope of [ALL,VN,undefined])for(const active of [true,false]){
      const result=await edge(action,{}, {caller:{data_scope:PANGHU},target:{data_scope,active}});
      assert.equal(result.status,403);assert.deepEqual(result.authCalls,[]);assert.deepEqual(result.audits,[]);
    }
    const result=await edge(action,{}, {caller:{data_scope:PANGHU},target:{data_scope:PANGHU}});assert.equal(result.status,200);assert.equal(result.authCalls.length,1);
  }
});
test('old null targets remain all even when disabled; owner targets remain fixed',async()=>{
  for(const action of ['update-account','update-viewer','reset-password','delete-account']){
    const old=await edge(action,{data_scope:PANGHU},{caller:{data_scope:PANGHU},target:{data_scope:null,active:false}});
    assert.equal(old.status,403);
    const owner=await edge(action,{data_scope:PANGHU},{role:'owner',target:{role:'owner',data_scope:PANGHU}});
    assert.equal(owner.status,403);
  }
});
test('role changes preserve original data scope even if the body also supplies a broader scope',async()=>{
  const result=await edge('update-account',{role:'admin',expected_role:'viewer',management_permissions:management,data_scope:ALL},{role:'owner',target:{data_scope:PANGHU}});
  assert.equal(result.status,200);assert.equal(result.writes[0].data_scope,undefined);assert.deepEqual(result.target.data_scope,PANGHU);
});
test('limited list-users returns manageable viewer subsets only; all/owner retain prior list',async()=>{
  const users=[profile('old','viewer'),profile('panghu','viewer',{data_scope:PANGHU}),profile('vn','viewer',{data_scope:VN}),profile('peer','admin',{data_scope:PANGHU}),profile('disabled','viewer',{active:false,data_scope:ALL}),profile('owner','owner')];
  const result=await edge('list-users',{}, {users,caller:{data_scope:PANGHU}});assert.equal(result.status,200);assert.deepEqual(result.body.users.map(user=>user.username),['panghu']);
  for(const options of [{},{role:'owner',caller:{data_scope:PANGHU}}])assert.equal((await edge('list-users',{}, {users,...options})).body.users.length,users.length);
  assert.equal((await edge('list-users',{}, {users,caller:{data_scope:PANGHU,management_permissions:{manage_viewers:false}}})).body.users.length,0);
});
test('global audit/sync/history/security operations deny limited admins without reading global tables or fetch',async()=>{
  for(const action of ['list-audit','history-status','auto-withdraw-history-status','trigger-sync','ip-settings','add-ip','set-ip-active','delete-ip','set-ip-mode']){
    const result=await edge(action,{job:'all'}, {caller:{data_scope:PANGHU}});assert.equal(result.status,403,action);assert.deepEqual(result.writes,[]);assert.deepEqual(result.authCalls,[]);
    assert(result.reads.every(read=>read.table==='dashboard_profiles'));
  }
});
test('missing/inactive/unprivileged actor cannot create or modify accounts',async()=>{
  for(const action of ['create-account','create-viewer','update-account','update-viewer','reset-password','delete-account'])for(const options of [{noToken:true},{invalidToken:true},{role:'viewer'},{caller:{active:false}},{caller:{management_permissions:{manage_viewers:false}}}]){
    const result=await edge(action,{data_scope:PANGHU},options);assert([401,403].includes(result.status));assert.deepEqual(result.writes,[]);assert.deepEqual(result.authCalls,[]);
  }
});
test('UI catalog scope guard matches Edge; disabled all target does not become an empty subset',()=>{
  const catalog=loadTs(path.join(root,'src/lib/accountPermissionCatalog.ts'));
  const item=catalog.ALL_ACCOUNT_PERMISSIONS.find(item=>item.id==='auto_withdraw');
  const actor=profile('manager','admin',{data_scope:PANGHU});
  assert.equal(catalog.canEditPermission(actor,profile('target','viewer',{data_scope:PANGHU}),item),true);
  for(const target of [profile('old','viewer'),profile('disabled','viewer',{active:false}),profile('vn','viewer',{data_scope:VN})]){
    assert.equal(catalog.canEditPermission(actor,target,item),false);assert.equal(catalog.buildPermissionPatch(actor,target,{auto_withdraw:false}),null);
  }
  assert.equal(catalog.ALL_ACCOUNT_PERMISSIONS.length,8);
});

function scopeUi(name, props) {
  const filename=path.join(root,'src/components/AdminControlCenter.tsx');
  const source=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const functions=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&['accountStoredScope','DataScopePicker','AccountDataScopeEditor'].includes(node.name?.text));
  const runtime=ts.transpileModule(functions.map(node=>node.getText(source)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  let cursor=0;const states=[];const api=loadTs(path.join(root,'src/lib/dashboardDataScope.ts'));
  const jsx=(type,props)=>({type,props:props||{}});
  const useState=initial=>{const index=cursor++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return [states[index],value=>{states[index]=value;}];};
  const renderFunction=Function('require','exports','useState',...Object.keys(api),runtime+`\nreturn ${name};`)(()=>({jsx,jsxs:jsx}),{},useState,...Object.values(api));
  return ()=>{cursor=0;return renderFunction(props);};
}
const nodes=(node)=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
test('scope editor keeps draft local, sends only scope on explicit save and retains failed selection',async()=>{
  const calls=[];let okay=false;
  const render=scopeUi('AccountDataScopeEditor',{user:profile('target','viewer'),actor:profile('owner','owner'),busy:false,onSave:async patch=>{calls.push(patch);return okay;}});
  let tree=render();const picker=nodes(tree).find(node=>typeof node.type==='function');picker.props.onChange(PANGHU);
  assert.deepEqual(calls,[]);tree=render();let button=nodes(tree).find(node=>node.type==='button'&&node.props.children==='保存数据范围');assert.equal(button.props.disabled,false);
  button.props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[{data_scope:PANGHU}]);
  tree=render();assert(nodes(tree).some(node=>node.props?.role==='alert'));assert.deepEqual(nodes(tree).find(node=>typeof node.type==='function').props.value,PANGHU);
  nodes(tree).find(node=>node.type==='button'&&node.props.children==='取消范围修改').props.onClick();tree=render();assert.deepEqual(nodes(tree).find(node=>typeof node.type==='function').props.value,ALL);
});
test('scope picker uses Panghu first, leaves all read-only for limited actor, and requires nonempty selected',()=>{
  const render=scopeUi('DataScopePicker',{id:'fixture',value:{mode:'selected',countries:[]},actor:profile('owner','owner'),disabled:false,onChange:()=>{}});
  const tree=render(),labels=nodes(tree).filter(node=>node.type==='label');assert.equal(labels[2].props.children[1],'胖虎巴西');
  assert(nodes(tree).some(node=>node.props?.role==='status'));
  const limited=scopeUi('DataScopePicker',{id:'fixture',value:PANGHU,actor:profile('admin','admin',{data_scope:PANGHU}),disabled:false,onChange:()=>{}})();
  const all=nodes(limited).find(node=>node.type==='input'&&node.props.value==='all');assert.equal(all.props.disabled,true);
  assert.equal(nodes(limited).filter(node=>node.type==='input'&&node.props.type==='checkbox').length,1);
});

test('actual client profile select includes scope; create/update send only the supplied independent scope field',async()=>{
  const auth=loadTs(path.join(root,'src/lib/dashboardAuthClient.ts'));
  const oldFetch=global.fetch, oldUrl=process.env.NEXT_PUBLIC_SUPABASE_URL, oldKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const calls=[];const expectedProfile=profile('viewer','viewer',{data_scope:PANGHU});
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture-public';
  global.fetch=async(url,init)=>{calls.push({url:String(url),init});return new Response(JSON.stringify(String(url).includes('/rest/')?[expectedProfile]:{ok:true}),{status:200});};
  const session={access_token:'fixture-access',refresh_token:'fixture-refresh',user:{id:'fixture-viewer'}};
  try{
    assert.deepEqual((await auth.fetchDashboardProfile(session)).data_scope,PANGHU);
    assert(new URL(calls[0].url).searchParams.get('select').split(',').includes('data_scope'));
    await auth.createDashboardAccount(session,'newuser','fixture-password','viewer',full,management,PANGHU);
    const created=JSON.parse(calls[1].init.body);assert.deepEqual(created.data_scope,PANGHU);assert.deepEqual(created.permissions,full);
    await auth.updateDashboardAccount(session,'viewer',{data_scope:PANGHU});
    assert.deepEqual(JSON.parse(calls[2].init.body),{action:'update-account',username:'viewer',data_scope:PANGHU});
    await auth.createViewerAccount(session,'newuser','fixture-password',full);
    assert.equal(Object.hasOwn(JSON.parse(calls[3].init.body),'data_scope'),false,'legacy client omission must reach actor-inheritance server path');
  }finally{
    global.fetch=oldFetch;
    if(oldUrl===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=oldKey;
  }
});

test('actual create handler refuses empty/outside draft and submits Panghu only after form submit',async()=>{
  const source=ts.createSourceFile('admin.tsx',fs.readFileSync(path.join(root,'src/components/AdminControlCenter.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const component=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='AdminControlCenter');
  const handler=component.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='submitCreate');
  const output=ts.transpileModule(handler.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
  const scope=loadTs(path.join(root,'src/lib/dashboardDataScope.ts'));
  for(const [newDataScope,expected] of [[{mode:'selected',countries:[]},0],[VN,0],[PANGHU,1]]){
    const calls=[],messages=[];const actor=profile('manager','admin',{data_scope:PANGHU});
    const context={canUseAccountAction:()=>true,canManageUsers:true,createBusy:false,profile:actor,newDataScope,session:{},newUsername:'newuser',newPassword:'fixture-password',newRole:'viewer',newPermissions:full,newManagement:management,canViewAudit:false,
      setCreateBusy:()=>{},setMessage:text=>messages.push(text),setNewUsername:()=>{},setNewPassword:()=>{},resetCreateRole:()=>{},setCreateOpen:()=>{},setNewDataScope:()=>{},loadUsers:async()=>{},loadAudit:async()=>{},roleLabel:()=> '查看账号',
      ...scope,createDashboardAccount:async(...args)=>{calls.push(args);return {role:'viewer',username:'newuser'};}};
    const submit=Function(...Object.keys(context),output+'\nreturn submitCreate;')(...Object.values(context));
    assert.deepEqual(calls,[]);await submit({preventDefault:()=>{}});assert.equal(calls.length,expected);
    if(expected){assert.deepEqual(calls[0][6],PANGHU);assert.deepEqual(calls[0][4],full);}else assert(messages.length);
  }
});


const assignedRole = (permissions, extra={}) => ({mode:'assigned',roleId:'synthetic-role',roleName:'Synthetic',version:1,assignmentVersion:1,canView:true,permissions,...extra});
test('assigned account permissions gate each action including legacy viewer aliases before target access',async()=>{
  const cases=[['list-users',['access.view']],['create-account',['access.view','access.create']],['create-viewer',['access.view','access.create']],
    ['update-account',['access.view','access.edit']],['update-viewer',['access.view','access.edit']],['reset-password',['access.view','access.reset_password']],['delete-account',['access.view','access.delete']]];
  for(const [action,keys] of cases){
    for(const missing of keys){
      const result=await edge(action,{}, {roleAccess:assignedRole(keys.filter(key=>key!==missing))});
      assert.equal(result.status,403,action+': '+missing);assert.match(result.body.message,/角色没有此项操作权限/);
      assert.deepEqual(result.writes,[]);assert.deepEqual(result.authCalls,[]);assert.deepEqual(result.audits,[]);
      assert.equal(result.reads.length,1,'only the caller profile is read before role denial');
    }
    const result=await edge(action,{}, {roleAccess:assignedRole(keys)});
    assert.equal(result.status,action.startsWith('create')?403:200,action+': matching assigned rights');
    if(action.startsWith('create')){assert.deepEqual(result.authCalls,[]);assert.match(result.body.message,/总管理员建立账号/);}
  }
});
test('status changes require both edit and status, including legacy update-viewer alias',async()=>{
  for(const action of ['update-account','update-viewer']){
    for(const permissions of [['access.view','access.edit'],['access.view','access.status']]){
      const denied=await edge(action,{active:false},{roleAccess:assignedRole(permissions)});
      assert.equal(denied.status,403);assert.deepEqual(denied.writes,[]);
    }
    const okay=await edge(action,{active:false},{roleAccess:assignedRole(['access.view','access.edit','access.status'])});
    assert.equal(okay.status,200);assert.equal(okay.writes[0].active,false);
  }
});
test('assigned audit, sync and IP rights cannot be substituted by account rights or the old coarse grants',async()=>{
  const required={
    'list-audit':['operation_logs.view'],'history-status':['data_health.view'],'auto-withdraw-history-status':['data_health.view'],
    'trigger-sync':['data_health.view','data_health.refresh'],'ip-settings':['ip.view'],
    'add-ip':['ip.view','ip.edit'],'set-ip-active':['ip.view','ip.edit'],'delete-ip':['ip.view','ip.edit'],'set-ip-mode':['ip.view','ip.edit']
  };
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'src/lib/dashboardRoleCatalog.json'),'utf8'));
  const keys=new Set(catalog.pages.flatMap(page=>page.actions.map(action=>page.id+'.'+action.id)));
  for(const [action,permissions] of Object.entries(required))for(const missing of permissions){
    if(!['ip.edit','data_health.refresh'].includes(missing))assert(keys.has(missing),'open permission exists in the shared catalog: '+missing);
    const result=await edge(action,{job:'all'},{roleAccess:assignedRole(['access.view','access.create',...permissions.filter(key=>key!==missing)])});
    assert.equal(result.status,403,action);assert.match(result.body.message,/角色没有此项操作权限/);
    assert.equal(result.reads.length,1);assert.deepEqual(result.authCalls,[]);assert.deepEqual(result.writes,[]);
  }
});
test('assigned role is the authority while target scope and owner-only retired IP guard remain enforced',async()=>{
  for(const options of [{targetAllowed:false},{caller:{data_scope:PANGHU},target:{data_scope:ALL}}]){
    const result=await edge('reset-password',{}, {...options,roleAccess:assignedRole(['access.view','access.reset_password'])});
    assert.equal(result.status,403);assert.deepEqual(result.authCalls,[]);
  }
  for(const options of [{role:'viewer'},{caller:{management_permissions:{manage_viewers:false}}}]){const result=await edge('reset-password',{}, {...options,roleAccess:assignedRole(['access.view','access.reset_password'])});assert.equal(result.status,200);}
  const security=await edge('ip-settings',{}, {roleAccess:assignedRole(['ip.view'])});
  assert.equal(security.status,403);assert.doesNotMatch(security.body.message,/角色没有此项操作权限/);assert.equal(security.reads.length,1);
  const list=await edge('list-users',{}, {caller:{data_scope:PANGHU},users:[profile('yes','viewer',{data_scope:PANGHU}),profile('no','viewer',{data_scope:ALL})],roleAccess:assignedRole(['access.view'])});
  assert.equal(list.status,200);assert.deepEqual(list.body.users.map(user=>user.username),['yes']);
});
test('archived assigned roles and unavailable or malformed role lookup never fall back to legacy management',async()=>{
  for(const roleAccess of [assignedRole(['access.view'],{canView:false}),assignedRole([])]){
    const result=await edge('list-users',{}, {roleAccess});assert.equal(result.status,403);assert.equal(result.reads.length,1);
  }
  for(const options of [{roleFailure:true},{roleStatus:404},{roleStatus:403},{roleAccess:{}},{roleAccess:{mode:'unexpected',canView:true,permissions:[]}},
    {roleAccess:{mode:'owner',canView:true,permissions:[]}},{roleAccess:{mode:'legacy',canView:'true',permissions:[]}},
    {roleAccess:{mode:'legacy',canView:true,permissions:[true]}}]){
    const result=await edge('create-account',{}, options);assert.equal(result.status,503);assert.deepEqual(result.authCalls,[]);assert.deepEqual(result.writes,[]);
  }
});
test('CURRENT and deploy account enforcement entrypoints stay identical',()=>{
  assert.equal(fs.readFileSync(path.join(root,'BACKEND_CURRENT/dashboard-user-admin.ts'),'utf8'),fs.readFileSync(path.join(root,'DEPLOY_SUPABASE/dashboard-user-admin.ts'),'utf8'));
});

test('revoked sessions cannot read profiles or perform any privileged operation',async()=>{
  for(const action of ['list-users','create-account','update-account','reset-password','delete-account','list-audit']){
    const r=await edge(action,{active:false},{role:'owner',sessionAllowed:false});assert.equal(r.status,403);assert.deepEqual(r.reads,[]);assert.deepEqual(r.authCalls,[]);assert.deepEqual(r.writes,[]);
  }
});
test('password reset, disable and delete fail closed when old sessions cannot be revoked',async()=>{
  for(const action of ['reset-password','delete-account','update-account','update-viewer']){
    const r=await edge(action,{active:false},{role:'owner',revokeFailure:true});assert.equal(r.status,503);assert.deepEqual(r.writes,[]);assert.deepEqual(r.authCalls,[]);assert(!JSON.stringify(r.body).includes('PRIVATE_REVOKE_FAILURE'));
  }
});
test('legacy IP settings cannot bypass canonical security policy',async()=>{
  for(const action of ['ip-settings','add-ip','set-ip-active','delete-ip','set-ip-mode']){const r=await edge(action,{}, {role:'owner'});assert.equal(r.status,410);assert.deepEqual(r.writes,[]);}
});

test('collector sync secret cannot bootstrap or reset any dashboard owner or admin',async()=>{
  for(const action of ['bootstrap-admin','reset-admin-password'])for(const options of [{noToken:true},{role:'owner'}]){
    const r=await edge(action,{}, {...options,headers:{'x-sync-secret':'fixture'}});assert.equal(r.status,410);assert.equal(r.body.code,'operation_retired');assert.deepEqual(r.reads,[]);assert.deepEqual(r.authCalls,[]);assert.deepEqual(r.writes,[]);
  }
});
test('untrusted Origin is rejected before account or authorization access',async()=>{
  const r=await edge('create-account',{}, {role:'owner',headers:{origin:'https://evil.example'}});assert.equal(r.status,403);assert.deepEqual(r.reads,[]);assert.deepEqual(r.authCalls,[]);assert.deepEqual(r.writes,[]);
});

test('check-access gives distinct denial codes for an expired session, actual disabled profile and unavailable verification',async()=>{
 for(const [options,status,code] of [[{sessionAllowed:false},403,'application_session_denied'],[{caller:{active:false}},403,'account_disabled'],[{callerMissing:true},403,'profile_denied'],[{caller:{active:null}},503,'profile_response_invalid'],[{caller:{role:'unexpected'}},503,'profile_response_invalid'],[{sessionFailure:true},503,'auth_unavailable']]){
  const result=await edge('check-access',{},options);
  assert.equal(result.status,status);assert.equal(result.body.code,code);assert.deepEqual(result.writes,[]);assert.deepEqual(result.authCalls,[]);
  if(code!=='account_disabled')assert.doesNotMatch(result.body.message,/停用/);
  if(code==='application_session_denied'||code==='auth_unavailable')assert.deepEqual(result.reads,[],'denied session never reads a profile');
  assert(!JSON.stringify(result.body).includes('PRIVATE_SESSION_FAILURE'));
 }
});

test('assigned account operations reject stale target rights, malformed guard and old permission writes before Auth mutation',async()=>{
 for(const action of ['update-account','update-viewer','reset-password','delete-account'])for(const options of [{targetAllowed:false},{targetStatus:503},{targetRoleFailure:true}]){
  const result=await edge(action,{}, {...options,role:'viewer',roleAccess:assignedRole(['access.view','access.edit','access.reset_password','access.delete'])});assert([403,503].includes(result.status));assert.deepEqual(result.writes,[]);assert.deepEqual(result.authCalls,[]);
 }
 for(const action of ['update-account','update-viewer']){const result=await edge(action,{permissions:full},{role:'viewer',roleAccess:assignedRole(['access.view','access.edit'])});assert.equal(result.status,403);assert.deepEqual(result.writes,[]);}
});
