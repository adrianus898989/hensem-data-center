const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const repo=path.resolve(__dirname,'..'),ts=require(path.join(repo,'node_modules/typescript'));
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(repo,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const plain=v=>JSON.parse(JSON.stringify(v)),flush=()=>new Promise(r=>setImmediate(r)),deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
const moduleOf=(file,require)=>{const m={exports:{}};vm.runInNewContext(compile(file),{module:m,exports:m.exports,require,AbortController,URL,Error,console,Set,Map});return m.exports};
const policy=moduleOf('src/lib/workOrderPermissionCatalog.ts',()=>{}),catalog=plain(policy.workOrderPermissionCatalog).map(item=>({...item,label:item.key,group:item.key.split(".")[0]}));
const roleId='11111111-1111-4111-8111-111111111111',otherRoleId='22222222-2222-4222-8222-222222222222';
const role={id:roleId,name:'UPI 查看员工',base_role:'agent',permissions:{'case.view':true,'provider_upis.view':true,'provider_upis.add':false},active:true,version:4};
const roleResult=(roles=[role])=>({ok:true,roles,permission_catalog:catalog,system_roles:[]});
const owner={user:{id:'synthetic-owner'},access_token:'synthetic-session'},account={auth_user_id:'synthetic-staff',username:'staff',display_name:'员工甲',role:'agent',team:'M8',platforms:['A'],active:true,updated_at:'2026-10-13T00:00:00Z',permissions:{'provider_upis.add':false}};
const platformCatalog={teams:['M8'],platforms:['A','B'],platformTeams:{A:'M8',B:'M8'}};
function nodes(n){return Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.props?.children)]:[]}
function text(n){return Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):n==null||typeof n==='boolean'?'':String(n)}
function ui(file,handler){let session=owner,si=0,ri=0,ei=0;const states=[],refs=[],deps=[],effects=[],cleanups=[],calls=[];
 const react={useState(initial){const k=si++;if(!(k in states))states[k]=typeof initial==='function'?initial():initial;return[states[k],v=>states[k]=typeof v==='function'?v(states[k]):v]},useRef(initial){const k=ri++;return refs[k]||(refs[k]={current:initial})},useEffect(fn,values){const k=ei++;if(!deps[k]||values.some((v,i)=>v!==deps[k][i])){deps[k]=values;effects.push(()=>{cleanups[k]?.();cleanups[k]=fn()})}}};
 function AccountEditorDialog(){}function WorkOrderRoleManager(){}
 const m=moduleOf(file,name=>{if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name.endsWith('/workOrderPermissionCatalog'))return policy;if(name.endsWith('/workOrderAccountClient'))return{workOrderAccountRequest:async(s,q,signal)=>{calls.push({session:plain(s),body:plain(q),signal});return handler(q,signal,s)}};if(name==='./AccountEditorDialog')return{default:AccountEditorDialog};if(name==='./AccountLoginPolicy')return{default:function AccountLoginPolicy(){}};if(name==='./WorkOrderRoleManager')return{default:WorkOrderRoleManager};if(name.endsWith('.css'))return{};throw Error(name)});
 const draw=next=>{if(next)session=next;si=ri=ei=0;return m.default({session})};
 const api={calls,states,draw,effect(){effects.splice(0).forEach(fn=>fn())},unmount(){cleanups.forEach(fn=>fn?.())},button(label){const n=nodes(draw()).find(n=>n.type==='button'&&text(n)===label);assert(n,'button '+label);return n},field(label,type='input'){const tree=draw(),root=nodes(tree).find(n=>n.type==='form')||tree;const n=nodes(root).find(n=>n.props?.['aria-label']===label&&n.type===type)||nodes(root).filter(n=>n.type==='label'&&text(n).startsWith(label)).flatMap(nodes).find(n=>n.type===type);assert(n,'field '+label);return n},change(label,value,type='input'){this.field(label,type).props.onChange({target:{value}})},check(label,checked){this.field(label).props.onChange({target:{checked}})},form(){return nodes(draw()).find(n=>n.type==='form')},dialog(){return nodes(draw()).find(n=>n.type===AccountEditorDialog)}};
 draw();api.effect();return api;
}
async function loaded(handler){const h=ui('src/components/WorkOrderRoleManager.tsx',handler||(()=>roleResult()));h.button('查询工单角色').props.onClick();await flush();return h}
function roleClient(options={}){const m={exports:{}},calls=[],authCalls=[],timers=new Map();let k=0;
 vm.runInNewContext(compile('src/lib/workOrderAccountClient.ts'),{module:m,exports:m.exports,AbortController,URL,Error,Set,Map,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://offline.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-public'}},setTimeout(fn){const id=++k;timers.set(id,fn);return id},clearTimeout(id){timers.delete(id)},require:name=>name.endsWith('/workOrderPermissionCatalog')?policy:{ensureDashboardSession:async s=>{authCalls.push(s);return options.ensure?options.ensure(s):{...s,access_token:'synthetic-fresh'}}},fetch:async(url,init)=>{calls.push({url,init});return options.fetch?options.fetch(url,init):{ok:true,status:200,json:async()=>options.value||roleResult()}}});
 return{api:m.exports,calls,authCalls,timers,expire(){for(const fn of [...timers.values()])fn()}};
}

test('roles are loaded only on explicit query; denied refresh removes stale roles and cannot create an empty-success role',async()=>{
 let deny=false;const h=ui('src/components/WorkOrderRoleManager.tsx',()=>{if(deny)throw Error('仅总管理员可管理工单角色');return roleResult()});assert.equal(h.calls.length,0);assert(h.button('新建工单角色').props.disabled);
 h.button('查询工单角色').props.onClick();await flush();assert.match(text(h.draw()),/UPI 查看员工/);assert.equal(h.calls.length,1);
 deny=true;h.button('刷新角色').props.onClick();await flush();assert.doesNotMatch(text(h.draw()),/UPI 查看员工|显示 0/);assert.match(text(h.draw()),/仅总管理员/);assert(h.button('新建工单角色').props.disabled);assert.equal(h.calls.length,2);
});
test('create configures only UPI keys; add requires view and creation does not assign accounts or alter existing case capabilities',async()=>{
 const h=await loaded(q=>q.action==='list-roles'?roleResult():{ok:true,role:{...role,id:otherRoleId,name:q.name,permissions:q.permissions,version:1}});h.button('新建工单角色').props.onClick();h.change('工单角色名称','UPI 录入员工');
 assert.equal(h.field('新增 UPI').props.checked,false);h.check('新增 UPI',true);assert.equal(h.field('查看 UPI 目录与检查结果').props.checked,true);assert.equal(h.field('新增 UPI').props.checked,true);
 h.check('查看 UPI 目录与检查结果',false);assert.equal(h.field('新增 UPI').props.checked,false);h.check('新增 UPI',true);
 assert(!nodes(h.draw()).some(n=>n.props?.['aria-label']==='新增登记'),'existing case bits are not presented as newly enforced UI permissions');
 await h.form().props.onSubmit({preventDefault(){}});assert.deepEqual(h.calls[1].body,{action:'create-role',name:'UPI 录入员工',base_role:'agent',permissions:{'provider_upis.view':true,'provider_upis.add':true}});assert.equal(h.calls.length,2);assert(!h.form());
});
test('auditor ceilings and immutable existing role base are enforced; editing preserves original non-UPI bits',async()=>{
 const h=await loaded(q=>q.action==='list-roles'?roleResult():{ok:true,role:{...role,...q.patch,version:5}});h.button('新建工单角色').props.onClick();h.check('新增 UPI',true);h.change('工单角色系统身份','auditor','select');assert(h.field('新增 UPI').props.disabled);assert.equal(h.field('新增 UPI').props.checked,false);assert.equal(h.field('查看 UPI 目录与检查结果').props.checked,true);
 h.button('取消').props.onClick();h.button('配置权限').props.onClick();assert(h.field('工单角色系统身份','select').props.disabled);h.check('新增 UPI',true);await h.form().props.onSubmit({preventDefault(){}});
 assert.deepEqual(h.calls[1].body,{action:'update-role',id:roleId,expected_version:4,patch:{name:role.name,permissions:{'case.view':true,'provider_upis.view':true,'provider_upis.add':true}}});assert(!('base_role' in h.calls[1].body.patch));
});
test('pending role write has one owner before rerender; failed or unknown result retains draft without silent retry',async()=>{
 const pending=deferred(),h=await loaded(q=>q.action==='list-roles'?roleResult():pending.promise);h.button('新建工单角色').props.onClick();h.change('工单角色名称','未确认角色');const form=h.form(),first=form.props.onSubmit({preventDefault(){}}),second=form.props.onSubmit({preventDefault(){}});assert.equal(h.calls.length,2);assert(h.dialog().props.busy);h.dialog().props.onClose();assert(h.form());pending.reject(Error('角色操作超时，结果尚未确认；请刷新角色列表核对后再操作'));await Promise.all([first,second]);assert(h.form());assert.equal(h.field('工单角色名称').props.value,'未确认角色');assert.match(text(h.draw()),/结果尚未确认/);assert.equal(h.calls.length,2);
});
test('actor change aborts old read/write and a late old finally cannot release the new request owner',async()=>{
 const old=deferred(),next=deferred();let newActor=false;const h=await loaded((q,signal,s)=>q.action==='list-roles'?(newActor?next.promise:roleResult()):old.promise);h.button('配置权限').props.onClick();const writing=h.form().props.onSubmit({preventDefault(){}});const oldSignal=h.calls[1].signal;
 newActor=true;h.draw({user:{id:'other-owner'},access_token:'synthetic-other'});h.effect();assert(oldSignal.aborted);h.button('查询工单角色').props.onClick();assert(h.button('读取角色中…').props.disabled);
 old.resolve({ok:true,role:{...role,name:'OLD ACTOR LEAK',version:5}});await writing;assert(h.button('读取角色中…').props.disabled);assert.doesNotMatch(text(h.draw()),/OLD ACTOR LEAK|角色已保存/);
 next.resolve(roleResult([{...role,name:'新管理员角色'}]));await flush();assert.match(text(h.draw()),/新管理员角色/);assert.equal(h.calls.length,3);
});
test('employee chooses custom role explicitly with matching base and unchanged exact team/platform and account restriction',async()=>{
 const chosen={...role,id:otherRoleId,name:'UPI主管',base_role:'supervisor',permissions:{'provider_upis.view':true,'provider_upis.add':true}};
 const h=ui('src/components/WorkOrderAccountAdmin.tsx',q=>q.action==='list-accounts'?{ok:true,accounts:[account],catalog:platformCatalog,roles:[chosen]}:{ok:true,account:{...account,...q.patch,updated_at:'next'}});await flush();assert.equal(h.calls.length,1);h.button('编辑范围 / 角色').props.onClick();assert.equal(h.field('工单权限角色','select').props.value,'');h.change('工单权限角色',otherRoleId,'select');assert.equal(h.field('角色','select').props.value,'supervisor');assert(h.field('角色','select').props.disabled);assert.match(text(h.draw()),/账号原有独立权限裁减仍保留/);
 await h.form().props.onSubmit({preventDefault(){}});assert.deepEqual(h.calls[1].body,{action:'update-account',auth_user_id:account.auth_user_id,expected_updated_at:account.updated_at,patch:{display_name:account.display_name,role:'supervisor',team:'M8',platforms:['A'],active:true,custom_role_id:otherRoleId}});assert(!('permissions' in h.calls[1].body.patch));assert.deepEqual(account.permissions,{'provider_upis.add':false});
});
test('unchanged inactive custom assignment is preserved without regranting; clearing it is explicit',async()=>{
 const assigned={...account,custom_role_id:roleId};const h=ui('src/components/WorkOrderAccountAdmin.tsx',q=>q.action==='list-accounts'?{ok:true,accounts:[assigned],catalog:platformCatalog,roles:[{...role,active:false}]}:{ok:true,account:{...assigned,...q.patch,updated_at:'next'}});await flush();h.button('编辑范围 / 角色').props.onClick();const option=nodes(h.field('工单权限角色','select')).find(n=>n.type==='option'&&n.props.value===roleId);assert(option.props.disabled);
 h.change('显示名称','保留角色员工');await h.form().props.onSubmit({preventDefault(){}});assert(!('custom_role_id' in h.calls[1].body.patch));h.button('编辑范围 / 角色').props.onClick();h.change('工单权限角色','','select');assert.equal(h.field('角色','select').props.disabled,false);await h.form().props.onSubmit({preventDefault(){}});assert.equal(h.calls[2].body.patch.custom_role_id,null);
});
test('role client uses fresh owner session and exact independent actions; invalid mutations and malformed metadata fail closed',async()=>{
 const h=roleClient();await h.api.workOrderAccountRequest(owner,{action:'list-roles'});assert.equal(h.calls[0].url,'https://offline.invalid/functions/v1/workorder-account-admin');assert.equal(h.calls[0].init.headers.Authorization,'Bearer synthetic-fresh');assert.deepEqual(JSON.parse(h.calls[0].init.body),{action:'list-roles'});assert.equal(h.timers.size,0);
 for(const q of [{action:'create-role',name:'x',base_role:'owner',permissions:{}},{action:'create-role',name:'x',base_role:'auditor',permissions:{'provider_upis.add':true}},{action:'create-role',name:'x',base_role:'agent',permissions:{fake:true}},{action:'update-role',id:roleId,expected_version:4,patch:{base_role:'supervisor'}},{action:'update-role',id:roleId,expected_version:0,patch:{name:'x'}}]){const bad=roleClient();await assert.rejects(bad.api.workOrderAccountRequest(owner,q));assert.equal(bad.authCalls.length,0);assert.equal(bad.calls.length,0);}
 for(const value of [{...roleResult(),roles:[role,role]},{...roleResult(),permission_catalog:catalog.slice(1)},{...roleResult(),roles:[{...role,base_role:'owner'}]},{...roleResult(),roles:[{...role,permissions:{'provider_upis.view':'true'}}]}]){const bad=roleClient({value});await assert.rejects(bad.api.workOrderAccountRequest(owner,{action:'list-roles'}),/目录返回不完整/);assert.equal(bad.calls.length,1);}
});
test('role client account change/cancel and unconfirmed mutation timeout never become empty success or an automatic retry',async()=>{
 const changed=roleClient({ensure:s=>({...s,user:{id:'other'}})});await assert.rejects(changed.api.workOrderAccountRequest(owner,{action:'list-roles'}),/账号已改变/);assert.equal(changed.calls.length,0);
 const cancelled=roleClient(),abort=new AbortController();abort.abort();await assert.rejects(cancelled.api.workOrderAccountRequest(owner,{action:'list-roles'},abort.signal));assert.equal(cancelled.authCalls.length,0);
 const waiting=roleClient({fetch:(_url,init)=>new Promise((yes,no)=>init.signal.addEventListener('abort',()=>no(init.signal.reason),{once:true}))});const write=waiting.api.workOrderAccountRequest(owner,{action:'create-role',name:'未确认',base_role:'agent',permissions:{'provider_upis.view':true}});await flush();const rejected=assert.rejects(write,/结果尚未确认.*刷新角色列表/);waiting.expire();await rejected;assert.equal(waiting.calls.length,1);assert.equal(waiting.timers.size,0);
});

test('employee assignment double-submit shares the mutation owner and late old actor response cannot alter a new directory',async()=>{
 const pending=deferred();const h=ui('src/components/WorkOrderAccountAdmin.tsx',(q,signal,s)=>q.action==='list-accounts'?{ok:true,accounts:[{...account,username:s.user.id==='synthetic-owner'?'staff':'new-actor-staff'}],catalog:platformCatalog,roles:[role]}:pending.promise);await flush();h.button('编辑范围 / 角色').props.onClick();h.change('工单权限角色',roleId,'select');const form=h.form();const first=form.props.onSubmit({preventDefault(){}}),second=form.props.onSubmit({preventDefault(){}});assert.equal(h.calls.length,2,'only one explicit assignment mutation is dispatched');assert(h.dialog().props.busy);
 h.draw({user:{id:'other-owner'},access_token:'synthetic-other'});h.effect();await flush();assert.equal(h.calls.length,3);assert.match(text(h.draw()),/new-actor-staff/);assert(!h.form());
 pending.resolve({ok:true,account:{...account,username:'OLD ACTOR LEAK',custom_role_id:roleId}});await Promise.all([first,second]);assert.doesNotMatch(text(h.draw()),/OLD ACTOR LEAK|工单账号已保存/);assert.match(text(h.draw()),/new-actor-staff/);assert.equal(h.calls.length,3);
});

test('account-role navigation only reads on return and never saves a draft or assigns a role implicitly',async()=>{
 const h=ui('src/components/WorkOrderAccountAdmin.tsx',()=>({ok:true,accounts:[account],catalog:platformCatalog,roles:[role]}));await flush();h.button('编辑范围 / 角色').props.onClick();h.change('工单权限角色',roleId,'select');h.button('工单权限角色').props.onClick();assert(!h.form());assert.equal(h.calls.length,1);h.button('员工账号').props.onClick();h.draw();h.effect();await flush();assert.equal(h.calls.length,2);assert(h.calls.every(c=>c.body.action==='list-accounts'));h.button('编辑范围 / 角色').props.onClick();assert.equal(h.field('工单权限角色','select').props.value,'');
});


test('valid 81 to 100 character role names load without rejecting the whole directory and the editor matches the server bound',async()=>{
 for(const length of [81,100]){const name='R'.repeat(length),h=roleClient({value:roleResult([{...role,name}])});const result=await h.api.workOrderAccountRequest(owner,{action:'list-roles'});assert.equal(result.roles[0].name,name);assert.equal(h.calls.length,1);}
 const h=await loaded();h.button('新建工单角色').props.onClick();assert.equal(h.field('工单角色名称').props.maxLength,100);
 const invalid=roleClient();await assert.rejects(invalid.api.workOrderAccountRequest(owner,{action:'create-role',name:'R'.repeat(101),base_role:'agent',permissions:{}}));assert.equal(invalid.calls.length,0);assert.equal(invalid.authCalls.length,0);
});
