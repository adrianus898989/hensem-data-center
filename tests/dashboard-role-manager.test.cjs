const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const repo=path.resolve(__dirname,'..'),catalog=require('../src/lib/dashboardRoleCatalog.json');
const display=require('./load-role-display.cjs');
const plain=value=>JSON.parse(JSON.stringify(value)),flush=()=>new Promise(resolve=>setImmediate(resolve));
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(repo,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const ownerId='11111111-1111-4111-8111-111111111111',staffId='22222222-2222-4222-8222-222222222222',roleId='33333333-3333-4333-8333-333333333333',otherId='44444444-4444-4444-8444-444444444444';
const session={user:{id:ownerId},access_token:'old-synthetic-token'},profile={auth_user_id:ownerId,username:'owner',role:'owner',active:true};
const role={id:roleId,name:'运营查看',description:'现有角色',permissions:['overview.view','overview.query'],active:true,version:2};
const account={auth_user_id:staffId,username:'existing-staff',role:'viewer',active:true,data_scope:{mode:'selected',countries:['IN']},role_id:null,assignment_version:0};
const owner={...account,auth_user_id:ownerId,username:'owner',role:'owner',data_scope:{mode:'all',countries:[]}};
const listing=()=>({roles:[plain(role)],accounts:[plain(account),plain(owner)]});
function client(options={}){
 const mod={exports:{}},calls=[],timers=new Map();let tick=0,saved=session;
 const auth={ensureDashboardSession:async()=>options.ensure?options.ensure():{...session,access_token:'refreshed-synthetic-token'},readSavedDashboardSession:()=>saved};
 vm.runInNewContext(compile('src/lib/dashboardRoleClient.ts'),{module:mod,exports:mod.exports,URL,AbortController,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://project.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public-test-key'}},setTimeout(fn){const id=++tick;timers.set(id,fn);return id},clearTimeout(id){timers.delete(id)},require(name){if(name.includes('dashboardAuthClient'))return auth;if(name.endsWith('dashboardRoleCatalog.json'))return catalog;throw Error(name)},fetch:async(url,init)=>{calls.push({url,init});return options.fetch?options.fetch(url,init):{ok:true,status:200,json:async()=>options.response||listing()}}});
 return{api:mod.exports,calls,timers,setSaved(value){saved=value},expire(){const tasks=[...timers.values()];timers.clear();tasks.forEach(fn=>fn())}};
}
test('manual role RPC reuses refreshed login, sends exact p_request and has no identity or password mutation',async()=>{
 const h=client();await h.api.dashboardRoleRequest(session,{operation:'list'});const q=h.calls[0];assert.equal(q.url,'https://project.invalid/rest/v1/rpc/dashboard_role_manage');assert.equal(q.init.headers.Authorization,'Bearer refreshed-synthetic-token');assert.equal(q.init.cache,'no-store');assert.equal(q.init.redirect,'error');assert.equal(q.init.credentials,'omit');assert.deepEqual(JSON.parse(q.init.body),{p_request:{operation:'list'}});assert.equal(h.timers.size,0);
});
test('request rejects unknown permissions, operation without page view, missing CAS and extra identity fields before network',async()=>{
 const h=client();for(const request of [{operation:'delete'},{operation:'create',name:'Role',description:'',permissions:['evil.view']},{operation:'create',name:'Role',description:'',permissions:['overview.export']},{operation:'update',roleId,name:'Role',description:'',permissions:[]},{operation:'assign',accountId:staffId,roleId,expectedVersion:0,password:'do-not-send'},{operation:'assign',accountId:staffId,roleId:null,expectedVersion:0}])await assert.rejects(h.api.dashboardRoleRequest(session,request),/参数|权限|版本/);assert.equal(h.calls.length,0);
});
test('valid create, update, archive and assignment preserve response identities and versions',async()=>{
 const h=client(),v=h.api.validateDashboardRoleResponse;
 assert.equal(v({role:{...role,permissions:[],version:1,name:'New',description:''}},{operation:'create',name:'New',description:'',permissions:[]}).role.version,1);
 assert.equal(v({role:{...role,version:3}},{operation:'update',roleId,name:role.name,description:role.description,permissions:role.permissions,expectedVersion:2}).role.version,3);
 assert.equal(v({role:{...role,active:false,version:3}},{operation:'archive',roleId,expectedVersion:2}).role.active,false);
 assert.equal(v({account:{...account,role_id:roleId,assignment_version:1}},{operation:'assign',accountId:staffId,roleId,expectedVersion:0}).account.username,'existing-staff');
});
test('incomplete, duplicate and mismatched success responses cannot overwrite UI data',()=>{
 const h=client(),list={operation:'list'},assign={operation:'assign',accountId:staffId,roleId,expectedVersion:0};
 for(const data of [{roles:[]},{roles:[{...role,permissions:['overview.query']}],accounts:[]},{roles:[role,role],accounts:[]},{roles:[],accounts:[{...account,assignment_version:'0'}]},{roles:[],accounts:[{...owner,role_id:roleId}]}])assert.throws(()=>h.api.validateDashboardRoleResponse(data,list),/不完整/);
 for(const value of [{...account,auth_user_id:otherId,role_id:roleId,assignment_version:1},{...account,role_id:roleId,assignment_version:0},{...owner,role_id:roleId,assignment_version:1}])assert.throws(()=>h.api.validateDashboardRoleResponse({account:value},assign),/不完整/);
 assert.throws(()=>h.api.validateDashboardRoleResponse({role:{...role,version:2}},{operation:'update',roleId,name:role.name,description:role.description,permissions:role.permissions,expectedVersion:2}),/不完整/);
});
test('CAS conflict is actionable and raw server detail or credentials are not reflected',async()=>{
 for(const [status,payload,pattern]of[[409,{message:'private-db-detail'},/其他管理员修改.*草稿已保留/],[400,{code:'P0001',message:'role_version_conflict secret'},/草稿已保留/],[403,{message:'private-db-detail'},/当前角色没有/],[500,{message:'private-db-detail'},/角色服务处理失败/],[400,{code:'42702',message:'column reference r.id is ambiguous private-db-detail'},/角色服务处理失败/]]){
  const h=client({fetch:async()=>({ok:false,status,json:async()=>payload})});await assert.rejects(h.api.dashboardRoleRequest(session,{operation:'list'}),error=>{assert.match(error.message,pattern);assert.doesNotMatch(error.message,/private-db|secret/);return true});assert.equal(h.calls.length,1);
 }
});
test('account change before dispatch or during reply discards stale response',async()=>{
 const h=client({ensure:async()=>({...session,user:{id:otherId}})});await assert.rejects(h.api.dashboardRoleRequest(session,{operation:'list'}),/账号已改变/);assert.equal(h.calls.length,0);
 let resolve;const g=client({fetch:async()=>({ok:true,status:200,json:()=>new Promise(r=>resolve=r)})}),pending=g.api.dashboardRoleRequest(session,{operation:'list'});await flush();g.setSaved({...session,user:{id:otherId}});resolve(listing());await assert.rejects(pending,/账号已改变/);
});
test('unconfirmed mutation timeout never automatically retries a write',async()=>{
 const h=client({fetch:(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason)))}),p=h.api.dashboardRoleRequest(session,{operation:'assign',accountId:staffId,roleId,expectedVersion:0});await flush();const rejected=assert.rejects(p,/操作超时.*结果尚未确认/);h.expire();await rejected;assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
});
function nodes(value){if(Array.isArray(value))return value.flatMap(nodes);return value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[]}
function text(value){if(Array.isArray(value))return value.map(text).join('');if(value&&typeof value==='object')return text(value.props?.children);return value==null||typeof value==='boolean'?'':String(value)}
function ui(handler,initial={}){
 const states=[],refs=[],dependencies=[],effects=[],cleanup=[],calls=[];let s=0,r=0,e=0,props={session,profile,manualQuery:true,...initial};const mod={exports:{}};
 const react={useState(initial){const k=s++;if(!(k in states))states[k]=typeof initial==='function'?initial():initial;return[states[k],value=>states[k]=typeof value==='function'?value(states[k]):value]},useRef(initial){const k=r++;return refs[k]||(refs[k]={current:initial})},useEffect(fn,values){const k=e++;if(!dependencies[k]||values.some((v,n)=>v!==dependencies[k][n])){dependencies[k]=values;effects.push(()=>{cleanup[k]?.();cleanup[k]=fn()})}}};
 const real=client().api;
 vm.runInNewContext(compile('src/components/DashboardRoleManager.tsx'),{module:mod,exports:mod.exports,AbortController,Error,window:{confirm:()=>true},require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name.includes('dashboardRoleAccess'))return{dashboardRoleAllows:(a,p,k='view')=>!!a&&a.canView&&(a.mode!=='assigned'||a.permissions.includes(p+'.view')&&a.permissions.includes(p+'.'+k))};if(name.includes('dashboardRoleDisplay'))return display;if(name.includes('dashboardRoleClient'))return{...real,dashboardRoleRequest:async(s,q,signal)=>{calls.push(plain(q));return handler?handler(q,signal):listing()}};if(name.includes('dashboardDataScope'))return{dashboardScopeLabel:scope=>scope?.mode==='all'?'全部数据':(scope?.countries||[]).join('、')};if(name==='./AccountEditorDialog')return{default:function AccountEditorDialog(){}};if(name.endsWith('.css'))return{};throw Error(name)}});
 const h={calls,api:mod.exports,draw(){s=r=e=0;return mod.exports.default(props)},effects(){effects.splice(0).forEach(fn=>fn())},setProps(next){props={...props,...next}},button(label){const value=nodes(h.draw()).find(node=>node.type==='button'&&text(node)===label);assert(value,'button '+label);return value},findLabel(label){const value=nodes(h.draw()).find(node=>node.props?.['aria-label']===label);assert(value,'aria-label '+label);return value},form(){return nodes(h.draw()).find(node=>node.type==='form')},async load(){const label=nodes(h.draw()).some(node=>node.type==='button'&&text(node)==='刷新列表')?'刷新列表':'查询角色';h.button(label).props.onClick();await flush();return h.draw()},dispose(){cleanup.forEach(fn=>fn?.())}};
 h.draw();h.effects();return h;
}
test('owner role manager stays network-idle and lists only role matrices and account counts',async()=>{
 const h=ui();assert.equal(h.calls.length,0);assert.match(text(h.draw()),/点击「查询角色」/);assert.equal(h.button('新建角色').props.disabled,true);await h.load();assert.deepEqual(h.calls,[{operation:'list'}]);
 assert.match(text(h.draw()),/角色管理|总管理员（Owner）|固定全部权限|账号数/);assert.doesNotMatch(text(h.draw()),/existing-staff|现有账号角色分配|现有后台账号/);
 assert.equal(nodes(h.draw()).filter(node=>node.type==='table').length,1);assert(!nodes(h.draw()).some(node=>node.type==='input'&&node.props.type==='password'));assert.equal(h.button('新建角色').props.disabled,false);
 assert(!nodes(h.draw()).some(node=>node.props?.['aria-label']==='账号列表筛选'));
});
test('non-owner or session/profile mismatch cannot read or mutate roles',async()=>{
 for(const next of [{profile:{...profile,role:'admin'}},{profile:{...profile,active:false}},{session:{...session,user:{id:otherId}}}]){const h=ui(null,{...next,manualQuery:false});await flush();assert.match(text(h.draw()),/仅总管理员/);assert.equal(h.calls.length,0);assert(!nodes(h.draw()).some(node=>node.type==='button'));}
});
test('new role starts empty; page action enables view and removing view clears that page only',async()=>{
 const h=ui();await h.load();h.button('新建角色').props.onClick();assert.match(text(h.draw()),/已启用 0 项权限/);
 const exportAction=catalog.pages.find(page=>page.id==='overview').actions.find(action=>action.id==='export');h.findLabel('总览 · '+exportAction.label).props.onChange({target:{checked:true}});assert.match(text(h.draw()),/已启用 2 项权限/);
 h.findLabel('总览 · 查看目录与页面').props.onChange({target:{checked:false}});assert.match(text(h.draw()),/已启用 0 项权限/);
 assert.deepEqual(plain(h.api.changeRolePermission(['overview.view','overview.export','workorders.view'],'overview.view',false)),['workorders.view']);
});
test('permission search and select visible only affect current module results',async()=>{
 const h=ui();await h.load();h.button('新建角色').props.onClick();h.findLabel('搜索目录或操作权限').props.onChange({target:{value:'总览'}});h.button('全选当前结果').props.onClick();assert.match(text(h.draw()),/已启用 4 项权限/);h.button('取消当前结果').props.onClick();assert.match(text(h.draw()),/已启用 0 项权限/);
});
test('create only sends explicit permissions and never assigns an account automatically',async()=>{
 const h=ui(async q=>q.operation==='list'?listing():{role:{id:otherId,...q,active:true,version:1}});await h.load();h.button('新建角色').props.onClick();h.findLabel('角色名称').props.onChange({target:{value:'新角色'}});await h.form().props.onSubmit({preventDefault(){}});assert.deepEqual(h.calls[1],{operation:'create',name:'新角色',description:'',permissions:[]});assert.equal(h.calls.length,2);assert(!h.form());
});
test('conflict leaves role name and permission draft open without retry or overwriting',async()=>{
 const h=ui(async q=>{if(q.operation==='list')return listing();throw Error('已被其他管理员修改，草稿已保留')});await h.load();h.button('配置权限').props.onClick();h.findLabel('角色名称').props.onChange({target:{value:'我的草稿'}});await h.form().props.onSubmit({preventDefault(){}});assert.equal(h.findLabel('角色名称').props.value,'我的草稿');assert.match(text(h.draw()),/草稿已保留/);assert.equal(h.calls[1].expectedVersion,2);assert.deepEqual(h.calls[1].permissions,[...role.permissions].sort());assert.equal(h.calls.length,2);
});
test('role assignment dialog preserves original account identity and scope and sends only assignment CAS',async()=>{
 const h=ui(async q=>q.operation==='list'?listing():{account:{...account,role_id:q.roleId,assignment_version:1}});await h.load();h.button('分配账号').props.onClick();
 assert.equal(h.findLabel('选择自定义角色').props.value,roleId);assert.deepEqual(nodes(h.findLabel('选择现有账号')).filter(node=>node.type==='option').map(node=>node.props.value),['',staffId]);
 assert.match(text(h.findLabel('选择现有账号')),/existing-staff/);h.findLabel('选择现有账号').props.onChange({target:{value:staffId}});
 assert.match(text(h.draw()),/数据范围：IN/);assert.match(text(h.draw()),/继续使用原来的账号和密码/);assert(!nodes(h.draw()).some(node=>node.type==='input'&&node.props.type==='password'));
 await h.form().props.onSubmit({preventDefault(){}});assert.deepEqual(h.calls[1],{operation:'assign',accountId:staffId,roleId,expectedVersion:0});assert.match(text(h.draw()),/账号和登录密码继续使用原来的/);assert(!h.form());assert.doesNotMatch(text(h.draw()),/existing-staff/);
});
test('Owner is excluded from assignment and roles still assigned to accounts cannot archive',async()=>{
 const h=ui(async()=>({...listing(),accounts:[{...account,role_id:roleId},owner]}));await h.load();assert.equal(h.button('停用角色').props.disabled,true);h.button('分配账号').props.onClick();assert.deepEqual(nodes(h.findLabel('选择现有账号')).filter(node=>node.type==='option').map(node=>node.props.value),['',staffId]);
});
test('switching actor cancels pending reads and does not restore stale accounts',async()=>{
 let resolve;const h=ui(()=>new Promise(r=>resolve=r));h.button('查询角色').props.onClick();await flush();h.setProps({session:{...session,user:{id:otherId}},profile:{...profile,auth_user_id:otherId}});assert.doesNotMatch(text(h.draw()),/existing-staff|运营查看/);h.effects();resolve(listing());await flush();assert.doesNotMatch(text(h.draw()),/existing-staff|运营查看/);assert.match(text(h.draw()),/点击「查询角色」/);assert.equal(h.calls.length,1);
});
test('refresh error clears stale rows and cannot present failed read as zero accounts',async()=>{
 let fail=false;const h=ui(async()=>{if(fail)throw Error('读取失败');return listing()});await h.load();fail=true;await h.load();assert.match(text(h.draw()),/读取失败/);assert.doesNotMatch(text(h.draw()),/existing-staff|运营查看|尚未创建自定义角色/);assert.equal(h.button('新建角色').props.disabled,true);
});

test('list only exposes safe role/account fields and rejects absent or mismatched role references',()=>{
 const h=client(),result=h.api.validateDashboardRoleResponse({roles:[{...role,password:'never-retain'}],accounts:[{...account,password:'never-retain',data_scope:{...account.data_scope,private:'never-retain'}}]},{operation:'list'});assert(!JSON.stringify(result).includes('never-retain'));
 for(const item of [{...account,data_scope:null},{...account,role_id:otherId}])assert.throws(()=>h.api.validateDashboardRoleResponse({roles:[role],accounts:[item]},{operation:'list'}),/不完整/);
});
test('existing roles drop only retired channelquality keys from reads and never resubmit them',async()=>{
 const h=client(),retired=['channelquality.view','channelquality.query','channelquality.detail','channelquality.export'];
 const listed=h.api.validateDashboardRoleResponse({roles:[{...role,permissions:[...role.permissions,...retired]}],accounts:[account]},{operation:'list'});
 assert.deepEqual(plain(listed.roles[0].permissions),role.permissions);
 const empty=h.api.validateDashboardRoleResponse({roles:[{...role,permissions:retired}],accounts:[]},{operation:'list'});assert.deepEqual(plain(empty.roles[0].permissions),[]);
 const archived=h.api.validateDashboardRoleResponse({role:{...role,permissions:retired,active:false,version:3}},{operation:'archive',roleId,expectedVersion:2});assert.deepEqual(plain(archived.role.permissions),[]);
 for(const permissions of [['overview.view','rogue.view'],['overview.query',...retired],['overview.view','overview.view',...retired]])assert.throws(()=>h.api.validateDashboardRoleResponse({roles:[{...role,permissions}],accounts:[]},{operation:'list'}),/不完整/);
 await assert.rejects(h.api.dashboardRoleRequest(session,{operation:'create',name:'Retired',description:'',permissions:retired}),/权限/);assert.equal(h.calls.length,0);
});
test('stale visible event callback cannot start an operation under a newly switched actor',()=>{
 const h=ui(),button=h.button('查询角色');h.setProps({session:{...session,user:{id:otherId}},profile:{...profile,auth_user_id:otherId}});h.draw();button.props.onClick();assert.equal(h.calls.length,0);h.effects();
});
test('modal draft survives changing modules and search without saving or assigning',async()=>{
 const h=ui();await h.load();h.button('新建角色').props.onClick();h.findLabel('角色名称').props.onChange({target:{value:'待配置'}});h.findLabel('总览 · 查看目录与页面').props.onChange({target:{checked:true}});
 const nav=h.findLabel('角色权限模块'),other=nodes(nav).find(node=>node.type==='button'&&text(node).startsWith('运营中心'));other.props.onClick();h.findLabel('搜索目录或操作权限').props.onChange({target:{value:'不存在'}});assert.equal(h.findLabel('角色名称').props.value,'待配置');assert.match(text(h.draw()),/已启用 1 项权限/);assert.match(text(h.draw()),/当前模块没有匹配/);assert.equal(h.calls.length,1);
});


const roleRows=h=>nodes(h.findLabel('角色目录权限矩阵')).filter(node=>node.type==='tr'&&nodes(node).some(cell=>cell.type==='td')).map(text);
const archivedRole={...role,id:otherId,name:'历史运营',description:'暂停使用的角色',active:false};
const filterListing=()=>({roles:[plain(role),plain(archivedRole)],accounts:[plain(account),plain(owner),{...plain(account),auth_user_id:'55555555-5555-4555-8555-555555555555',username:'assigned-agent',role_id:roleId},{...plain(account),auth_user_id:'66666666-6666-4666-8666-666666666666',username:'disabled-agent',role_id:otherId,active:false,data_scope:{mode:'selected',countries:['BR']}}]});
test('role search combines name or description with active, disabled or fixed status without querying or changing permissions',async()=>{
 const h=ui(filterListing);assert(h.findLabel('搜索角色名称或说明'));await h.load();assert.equal(roleRows(h).length,3);assert.match(text(h.findLabel('角色列表筛选')),/显示 3 \/ 3 个角色/);
 h.findLabel('搜索角色名称或说明').props.onChange({target:{value:'  现有角色  '}});assert.equal(roleRows(h).length,1);assert.match(roleRows(h)[0],/运营查看/);
 h.findLabel('角色状态筛选').props.onChange({target:{value:'inactive'}});assert.deepEqual(roleRows(h),['没有符合筛选条件的角色。']);assert.match(text(h.findLabel('角色列表筛选')),/显示 0 \/ 3 个角色/);
 h.button('重置角色筛选').props.onClick();h.findLabel('角色状态筛选').props.onChange({target:{value:'inactive'}});assert.equal(roleRows(h).length,1);assert.match(roleRows(h)[0],/历史运营/);
 h.findLabel('角色状态筛选').props.onChange({target:{value:'active'}});assert.equal(roleRows(h).length,1);assert.match(roleRows(h)[0],/运营查看/);
 h.findLabel('角色状态筛选').props.onChange({target:{value:'fixed'}});assert.equal(roleRows(h).length,1);assert.match(roleRows(h)[0],/总管理员/);
 h.findLabel('搜索角色名称或说明').props.onChange({target:{value:'OWNER'}});assert.equal(roleRows(h).length,1);
 h.button('重置角色筛选').props.onClick();assert.equal(roleRows(h).length,3);assert.equal(h.button('重置角色筛选').props.disabled,true);assert.deepEqual(h.calls,[{operation:'list'}]);
});
test('no duplicate account table or filters remain; role counts and eligible assignment options are retained',async()=>{
 const h=ui(filterListing);await h.load();const all=nodes(h.draw());assert.equal(all.filter(node=>node.type==='table').length,1);
 for(const label of ['现有账号角色分配','账号列表筛选','搜索现有账号','账号角色筛选','账号状态筛选'])assert(!all.some(node=>node.props?.['aria-label']===label));
 const rows=nodes(h.findLabel('角色目录权限矩阵')).filter(node=>node.type==='tr'&&nodes(node).some(cell=>cell.type==='td'));
 assert.deepEqual(rows.map(row=>nodes(row).filter(node=>node.type==='td').at(-3)).map(text),['1','1','1']);
 assert.doesNotMatch(text(h.draw()),/existing-staff|assigned-agent|disabled-agent/);
 h.button('分配账号').props.onClick();assert.deepEqual(nodes(h.findLabel('选择现有账号')).filter(node=>node.type==='option').map(text),['请选择账号','existing-staff','assigned-agent','disabled-agent（已停用）']);
 assert.deepEqual(nodes(h.findLabel('选择自定义角色')).filter(node=>node.type==='option').map(node=>node.props.value),['',roleId]);assert.deepEqual(h.calls,[{operation:'list'}]);
});
test('list refresh preserves role filters while actor changes clear drafts and hide previous results',async()=>{
 const h=ui(filterListing);await h.load();assert(h.button('刷新列表'));assert.equal(nodes(h.draw()).filter(node=>node.type==='button'&&['刷新列表','查询角色'].includes(text(node))).length,1);
 h.findLabel('搜索角色名称或说明').props.onChange({target:{value:'历史'}});h.findLabel('角色状态筛选').props.onChange({target:{value:'inactive'}});
 await h.load();assert.equal(h.findLabel('搜索角色名称或说明').props.value,'历史');assert.equal(h.findLabel('角色状态筛选').props.value,'inactive');assert.equal(roleRows(h).length,1);
 h.setProps({session:{...session,user:{id:otherId}},profile:{...profile,auth_user_id:otherId}});assert.doesNotMatch(text(h.draw()),/历史运营|existing-staff/);h.effects();assert.equal(h.findLabel('搜索角色名称或说明').props.value,'');assert.equal(h.findLabel('角色状态筛选').props.value,'all');await h.load();
 assert.equal(roleRows(h).length,3);assert(h.calls.every(call=>call.operation==='list'));
 h.button('分配账号').props.onClick();h.findLabel('选择现有账号').props.onChange({target:{value:staffId}});const staleSubmit=h.form().props.onSubmit;
 h.setProps({session,profile});assert.doesNotMatch(text(h.draw()),/existing-staff/);assert(!h.form());h.effects();await staleSubmit({preventDefault(){}});assert(!h.calls.some(call=>call.operation==='assign'));
});

test('assigned viewer with explicit account view can read live role roster without old admin flags',async()=>{
 const h=ui(null,{profile:{...profile,role:'viewer'},roleAccess:{mode:'assigned',canView:true,permissions:['access.view']}});await h.load();assert.deepEqual(h.calls,[{operation:'list'}]);assert.match(text(h.draw()),/运营查看/);assert.doesNotMatch(text(h.draw()),/existing-staff/);assert.equal(h.button('新建角色').props.disabled,true);assert.equal(h.button('分配账号').props.disabled,true);assert.equal(h.button('配置权限').props.disabled,true);
});
test('delegated assignment offers only roles contained in actual permissions and never mutates shared roles',async()=>{
 const high={...role,id:otherId,name:'High',permissions:[...role.permissions,'overview.export']};
 const h=ui(async q=>q.operation==='list'?{roles:[role,high],accounts:[account,owner]}:{account:{...account,role_id:q.roleId,assignment_version:1}},{profile:{...profile,role:'viewer'},roleAccess:{mode:'assigned',canView:true,permissions:['access.view','access.edit',...role.permissions]}});
 await h.load();assert.equal(h.button('配置权限').props.disabled,true);assert.equal(h.button('停用角色').props.disabled,true);h.button('分配账号').props.onClick();assert.deepEqual(nodes(h.findLabel('选择自定义角色')).filter(node=>node.type==='option').map(node=>node.props.value),['',roleId]);
 h.findLabel('选择现有账号').props.onChange({target:{value:staffId}});h.findLabel('选择自定义角色').props.onChange({target:{value:roleId}});await h.form().props.onSubmit({preventDefault(){}});assert.equal(h.calls[1].operation,'assign');assert.equal(h.calls[1].expectedVersion,0);assert(!h.calls.some(call=>['create','update','archive'].includes(call.operation)));
});

function assignedDialog(overrides={},handler){
 const mod={exports:{}},states=[],calls=[];let cursor=0;
 const props={session,account:{...account,role_id:roleId,assignment_version:2},roles:[role,{...role,id:otherId,name:'Limited',permissions:['overview.view']}],isOwner:true,editable:true,onSaved:async()=>calls.push({operation:'reload'}),onClose:()=>calls.push({operation:'close'}),...overrides};
 vm.runInNewContext(compile('src/components/AccountAssignedRoleDialog.tsx'),{module:mod,exports:mod.exports,Error,require(name){
  if(name==='react')return{useState(initial){const k=cursor++;if(!(k in states))states[k]=initial;return[states[k],value=>states[k]=value]}};
  if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(name.includes('dashboardRoleAccess'))return{dashboardRoleAllows:(a,p,k='view')=>!!a&&a.canView&&(a.mode!=='assigned'||a.permissions.includes(p+'.view')&&a.permissions.includes(p+'.'+k))};
  if(name.includes('dashboardRoleDisplay'))return display;if(name.includes('dashboardRoleClient'))return{dashboardRolePages:catalog.pages,dashboardRoleRequest:async(s,q)=>{calls.push(plain(q));if(handler)return handler(q);return{account:{...account,role_id:q.roleId,assignment_version:3}}}};
  if(name==='./AccountEditorDialog')return{default:function AccountEditorDialog(){}};throw Error(name);
 }});
 const draw=()=>{cursor=0;return mod.exports.default(props)},h={draw,calls,select:()=>nodes(draw()).find(node=>node.type==='select'),form:()=>nodes(draw()).find(node=>node.type==='form')};draw();return h;
}
test('account assigned-role editor uses explicit assignment CAS and preserves legacy profile and scope',async()=>{
 const h=assignedDialog();assert.match(text(h.draw()),/运营查看/);assert.match(text(h.draw()),/在「角色管理」维护/);h.select().props.onChange({target:{value:otherId}});await h.form().props.onSubmit({preventDefault(){}});
 assert.deepEqual(h.calls,[{operation:'assign',accountId:staffId,roleId:otherId,expectedVersion:2},{operation:'reload'},{operation:'close'}]);
});
test('account assigned-role editor independently rejects missing action, self and fixed-owner changes',()=>{
 const rights={mode:'assigned',canView:true,permissions:['access.view','access.edit','overview.view']};
 const scoped=assignedDialog({session:{...session,user:{id:'delegate'}},isOwner:false,roleAccess:rights});assert.deepEqual(nodes(scoped.select()).filter(node=>node.type==='option').map(node=>node.props.value),['',otherId]);
 for(const change of [{roleAccess:{...rights,permissions:['access.view']}},{session:{...session,user:{id:staffId}}},{account:{...account,role:'owner'}}]){const h=assignedDialog({session:{...session,user:{id:'delegate'}},isOwner:false,roleAccess:rights,...change});assert(!h.form());assert.equal(h.calls.length,0);}
});
test('assigned-role conflict preserves chosen role for review and does not close or retry',async()=>{
 const h=assignedDialog({},()=>{throw Error('角色分配已被其他管理员修改，草稿已保留')});h.select().props.onChange({target:{value:otherId}});await h.form().props.onSubmit({preventDefault(){}});assert.equal(h.calls.length,1);assert.equal(h.select().props.value,otherId);assert.match(text(h.draw()),/草稿已保留/);
});

const legacyMerchantCodes=['merchantproviders.view','merchantproviders.query','merchantproviders.detail','merchantproviders.export'];
test('merchant directory display uses the current sidebar title without changing the canonical page or module permissions',async()=>{
 const before=JSON.stringify(catalog),canonical=catalog.pages.find(page=>page.id==='merchants'),page=display.dashboardRoleDisplayPages.find(page=>page.id==='merchants');
 assert.equal(canonical.label,'平台汇总');assert.deepEqual(plain(page),{...canonical,label:'商户经营',moduleLabel:'运营中心'});assert.equal(JSON.stringify(catalog),before);
 const merchantPages=display.dashboardRoleDisplayPages.filter(page=>page.moduleId==='merchant');assert.equal(merchantPages.length,8);assert.equal(merchantPages.reduce((sum,page)=>sum+page.actions.length,0),32);
 const h=ui();await h.load();h.button('配置权限').props.onClick();nodes(h.findLabel('角色权限模块')).find(node=>node.type==='button'&&text(node).startsWith('运营中心')).props.onClick();
 assert(h.findLabel('商户经营 · 查看目录与页面'));assert(h.findLabel('每日对比 · 查看目录与页面'));assert.doesNotMatch(text(h.draw()),/平台汇总/);assert(h.calls.every(call=>call.operation==='list'));
});
test('display catalog hides only the retired merchant page without altering canonical validation or saved permissions',async()=>{
 const before=JSON.stringify(catalog),permissions=[...role.permissions,...legacyMerchantCodes],snapshot=[...permissions];
 assert.deepEqual(plain(display.dashboardRoleDisplayPages.map(page=>page.id)),catalog.pages.filter(page=>page.id!=='merchantproviders').map(page=>page.id));
 assert.equal(display.dashboardRoleDisplayPermissionCount(permissions),2);assert.equal(display.dashboardRoleDisplayPageCount(permissions),1);
 assert.equal(display.dashboardRoleDisplayPermissionCount(legacyMerchantCodes),0);assert.deepEqual(permissions,snapshot);assert.equal(JSON.stringify(catalog),before);
 const h=client({response:{role:{...role,permissions,version:3}}});
 await h.api.dashboardRoleRequest(session,{operation:'update',roleId,expectedVersion:2,name:role.name,description:role.description,permissions});
 assert.deepEqual(JSON.parse(h.calls[0].init.body).p_request.permissions,permissions);assert(!permissions.some(code=>code.startsWith('merchants.')));
});
test('retired merchant permissions are absent from role editor and all display counts but survive visible selection and save',async()=>{
 const saved={...role,permissions:[...role.permissions,...legacyMerchantCodes]},h=ui(async q=>q.operation==='list'?{roles:[saved],accounts:[account,owner]}:{role:{...saved,name:q.name,permissions:q.permissions,version:3}});await h.load();
 const matrix=h.findLabel('角色目录权限矩阵'),heads=nodes(matrix).filter(node=>node.type==='th').map(text),index=heads.findIndex(label=>label.startsWith('运营中心'));assert(index>=0);
 const merchantTotal=display.dashboardRoleDisplayPages.filter(page=>page.moduleId==='merchant').reduce((n,page)=>n+page.actions.length,0);
 const cells=nodes(matrix).filter(node=>node.type==='tr'&&nodes(node).some(cell=>cell.type==='td')).map(row=>nodes(row).filter(node=>node.type==='td'));
 assert.equal(text(cells[0][index]),merchantTotal+' / '+merchantTotal);assert.equal(text(cells[1][index]),'0 / '+merchantTotal);
 h.button('配置权限').props.onClick();assert.match(text(h.draw()),/已启用 2 项权限 · 1 个目录/);
 const merchantButton=nodes(h.findLabel('角色权限模块')).find(node=>node.type==='button'&&text(node).startsWith('运营中心'));merchantButton.props.onClick();
 assert.doesNotMatch(text(h.draw()),/平台三方分析|平台汇总/);assert.match(text(h.draw()),/商户经营/);
 h.findLabel('搜索目录或操作权限').props.onChange({target:{value:'merchantproviders'}});assert.match(text(h.draw()),/当前模块没有匹配的目录/);assert.equal(h.button('全选当前结果').props.disabled,true);
 h.findLabel('搜索目录或操作权限').props.onChange({target:{value:''}});h.button('全选当前结果').props.onClick();h.button('取消当前结果').props.onClick();
 assert.match(text(h.draw()),/已启用 2 项权限 · 1 个目录/);h.findLabel('角色名称').props.onChange({target:{value:'仅修改名称'}});await h.form().props.onSubmit({preventDefault(){}});
 assert.deepEqual(h.calls[1].permissions,[...saved.permissions].sort());assert(!h.calls[1].permissions.some(code=>code.startsWith('merchants.')));assert.deepEqual(saved.permissions,[...role.permissions,...legacyMerchantCodes]);
});
test('assignment display excludes retired counters but delegation still requires every original permission',async()=>{
 const restrictedRole={...role,permissions:[...role.permissions,...legacyMerchantCodes]},rights={mode:'assigned',canView:true,permissions:['access.view','access.edit',...role.permissions]};
 const h=assignedDialog({roles:[restrictedRole],isOwner:true});
 const chip=nodes(h.draw()).find(node=>node.props?.className==='admin-module-permission-chip'&&text(node).startsWith('运营中心'));
 const total=display.dashboardRoleDisplayPages.filter(page=>page.moduleId==='merchant').reduce((n,page)=>n+page.actions.length,0);assert.equal(text(chip),'运营中心0/'+total);
 const delegated=assignedDialog({roles:[restrictedRole],isOwner:false,session:{...session,user:{id:'delegate'}},roleAccess:rights});assert.deepEqual(nodes(delegated.select()).filter(node=>node.type==='option').map(node=>node.props.value),['']);
 const manager=ui(async()=>({roles:[restrictedRole],accounts:[account,owner]}),{profile:{...profile,role:'viewer'},roleAccess:rights});await manager.load();assert.equal(manager.button('分配账号').props.disabled,true);assert(manager.calls.every(call=>call.operation==='list'));
});

test('team views migrate to operations presentation while preserving every original saved grant',async()=>{
 const before=JSON.stringify(catalog),keys=['teamops','teamcountries','teamplatforms'],saved={...role,permissions:['teamcountries.view','teamcountries.query']};
 for(const id of keys){const original=catalog.pages.find(page=>page.id===id),visible=display.dashboardRoleDisplayPages.find(page=>page.id===id);assert.equal(original.moduleId,'team');assert.equal(visible.moduleId,'merchant');assert.equal(visible.moduleLabel,'运营中心');assert.deepEqual(plain(visible.actions),original.actions);assert.deepEqual(plain(visible.requests),original.requests);}
 assert(!display.dashboardRoleDisplayPages.some(page=>page.moduleId==='team'));assert.equal(JSON.stringify(catalog),before);
 const h=ui(async q=>q.operation==='list'?{roles:[saved],accounts:[account,owner]}:{role:{...saved,permissions:q.permissions,version:3}});await h.load();h.button('配置权限').props.onClick();
 const modules=nodes(h.findLabel('角色权限模块')).filter(node=>node.type==='button');assert.equal(modules.filter(node=>text(node).startsWith('运营中心')).length,1);assert(!modules.some(node=>/团队运营中心|商户运营中心/.test(text(node))));
 modules.find(node=>text(node).startsWith('运营中心')).props.onClick();assert(h.findLabel('团队经营 · 国家表现 · 查看目录与页面'));await h.form().props.onSubmit({preventDefault(){}});assert.deepEqual(h.calls[1].permissions,[...saved.permissions].sort());
});
