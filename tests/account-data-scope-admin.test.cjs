const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const {loadTs, root} = require('./load-typescript.cjs');
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
  const client={auth:{
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
        if(filters.some(([key,value])=>key==='auth_user_id'&&value===caller.auth_user_id))return {data:clone(caller)};
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
  vm.runInNewContext(compiled,{createClient:()=>client,Deno:{env:{get:()=> 'fixture'},serve:fn=>{handler=fn;}},Request,Response,Date,Intl,console,
    fetch:()=>{throw Error('No external network allowed');}});
  const body={action,username:action.startsWith('create')?'newuser':'target',password:'fixture-password',...patch};
  const response=await handler(new Request('https://fixture.invalid',{method:'POST',headers:options.noToken?{}:{authorization:'Bearer fixture'},body:JSON.stringify(body)}));
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
    const context={canManageUsers:true,profile:actor,newDataScope,session:{},newUsername:'newuser',newPassword:'fixture-password',newRole:'viewer',newPermissions:full,newManagement:management,canViewAudit:false,
      setCreateBusy:()=>{},setMessage:text=>messages.push(text),setNewUsername:()=>{},setNewPassword:()=>{},resetCreateRole:()=>{},setCreateOpen:()=>{},setNewDataScope:()=>{},loadUsers:async()=>{},loadAudit:async()=>{},roleLabel:()=> '查看账号',
      ...scope,createDashboardAccount:async(...args)=>{calls.push(args);return {role:'viewer',username:'newuser'};}};
    const submit=Function(...Object.keys(context),output+'\nreturn submitCreate;')(...Object.values(context));
    assert.deepEqual(calls,[]);await submit({preventDefault:()=>{}});assert.equal(calls.length,expected);
    if(expected){assert.deepEqual(calls[0][6],PANGHU);assert.deepEqual(calls[0][4],full);}else assert(messages.length);
  }
});
