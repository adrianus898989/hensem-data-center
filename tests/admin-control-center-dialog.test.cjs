const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {root,loadTs}=require('./load-typescript.cjs');
const auth=loadTs(path.join(root,'src/lib/dashboardAuthClient.ts'));
const session={user:{id:'fixture-owner'},access_token:'fixture-only'};
const ALL={mode:'all',countries:[]},BR={mode:'selected',countries:['BR_PANGHU']},IN={mode:'selected',countries:['IN']};
const owner={auth_user_id:'fixture-owner',username:'owner-fixture',role:'owner',active:true,data_scope:ALL};
const brazil={auth_user_id:'fixture-br',username:'brazil-fixture',role:'viewer',active:true,data_scope:BR};
const india={auth_user_id:'fixture-in',username:'india-fixture',role:'admin',active:false,data_scope:IN};
const EMPTY_ROLE={id:'11111111-2222-4333-8444-555555555555',name:'出款组长',description:'',permissions:[],active:true,version:3};
const VIP_ROLE={id:'99999999-2222-4333-8444-555555555555',name:'VIP',description:'',permissions:['overview.view'],active:true,version:7};
const plain=x=>JSON.parse(JSON.stringify(x)),flush=()=>new Promise(r=>setImmediate(r));
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
const text=x=>Array.isArray(x)?x.map(text).join(''):x&&typeof x==='object'?text(x.props?.children):x==null||typeof x==='boolean'?'':String(x);
function ui(options={}){
 let cursor=0,ecursor=0;const states=[],deps=[],effects=[],cleanups=[],calls=[],roleCalls=[],listArgs=[],rawRoleArgs=[],mod={exports:{}};let actor=options.actor||owner,currentSession={...session,user:{id:actor.auth_user_id}},roleAccess=options.roleAccess,opened=true,currentSection=options.section||'accounts',active=true,refreshVersion=0,changes=0,denials=0;
 const react={Fragment:'fragment',useMemo:fn=>fn(),useRef(initial){const i=cursor++;return states[i]||(states[i]={current:initial})},useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v}]},useEffect(fn,values){const i=ecursor++;if(!deps[i]||values.some((v,k)=>v!==deps[i][k])){deps[i]=values;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn()})}}};
 const output=ts.transpileModule(fs.readFileSync(path.join(root,'src/components/AdminControlCenter.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(output,{module:mod,exports:mod.exports,console,Error,AbortController,AbortSignal,DOMException,window:{confirm:()=>true},require:name=>{
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(name.endsWith('.css'))return{};
  if(name==='./AccountLoginPolicy')return{default:function AccountLoginPolicy(){}};if(name==='./AccountIpAdmin')return{default:function AccountIpAdmin(){}};if(name==='./AccountEditorDialog')return{default:function AccountEditorDialog(){}};
  if(name==='./AccountRoleEditor')return{default:function AccountRoleEditor(){}};
  if(name==='./AccountAssignedRoleDialog')return{default:function AccountAssignedRoleDialog(){}};
  if(name.includes('dashboardRoleAccess'))return{dashboardRoleAllows:(a,p,k='view')=>!!a&&a.canView&&(a.mode!=='assigned'||a.permissions.includes(p+'.view')&&a.permissions.includes(p+'.'+k))};
  if(name==='./AccountPermissionDialog')return{default:function AccountPermissionDialog(){}};
  if(name.endsWith('/dashboardAuthClient'))return{...auth,listDashboardUsers:async(...args)=>{calls.push({action:'list'});listArgs.push(args);return options.list?options.list(...args):options.users||[owner,brazil,india]},listDashboardAudit:async(...args)=>{calls.push({action:'audit'});return options.audit?options.audit(...args):[]},createDashboardRoleAccount:async(...args)=>{calls.push({action:'create',args:plain(args)});return options.create?options.create(...args):{account:{auth_user_id:'fixture-new',username:args[1],role:'viewer',active:true,data_scope:args[4],role_id:args[3].id,role_version:args[3].version,assignment_version:1,role_name:EMPTY_ROLE.name}}},updateDashboardAccount:async(...args)=>{calls.push({action:'update',args:plain(args)});if(options.update)return options.update(...args);return {ok:true,account:{...args[3],...args[2],updated_at:'2026-10-27T06:00:00Z'}}},deleteDashboardAccount:async(...args)=>{calls.push({action:'delete',args:plain(args)});return options.remove?options.remove(...args):{ok:true,username:args[1],auth_user_id:args[2]}},resetDashboardUserPassword:async(...args)=>calls.push({action:'password',args:plain(args)})};
  if(name.endsWith('/dashboardRoleDisplay'))return require('./load-role-display.cjs');
  if(name.endsWith('/dashboardRoleClient'))return{dashboardRolePages:require('../src/lib/dashboardRoleCatalog.json').pages,dashboardRoleRequest:async(...args)=>{rawRoleArgs.push(args);roleCalls.push(plain(args.slice(0,2)));return options.roles?options.roles(...args):{roles:[EMPTY_ROLE,VIP_ROLE],accounts:(options.users||[owner,brazil,india]).map(account=>({...account,role_id:null,assignment_version:0}))}}};
  if(name.startsWith('@/lib/'))return loadTs(path.join(root,'src/lib',name.slice(6)+'.ts'));
  throw Error('Unexpected module: '+name);
 }});
 const draw=()=>{cursor=ecursor=0;return mod.exports.default({open:opened,session:currentSession,profile:actor,onClose(){},section:currentSection,embedded:true,accountsOnlyLoading:options.accountsOnlyLoading!==false,manualQuery:options.manualQuery,roleAccess,active,refreshVersion,onDirectoryChanged:()=>changes++,onAccessDenied:()=>denials++})};
 const all=()=>nodes(draw());
 const button=(label,within)=>{const node=nodes(within||draw()).find(n=>n.type==='button'&&text(n)===label);assert(node,'button '+label);return node};
 const field=(label)=>{const wrap=all().find(n=>n.type==='div'&&n.props.className?.includes('admin-search-field')&&nodes(n).some(c=>c.type==='label'&&text(c)===label));assert(wrap,'filter '+label);return nodes(wrap).find(n=>['select','input'].includes(n.type))};
 const dialog=()=>all().find(n=>n.type?.name==='AccountEditorDialog');
 const rows=()=>all().filter(n=>n.type==='tr'&&nodes(n).some(c=>c.type==='th'&&c.props.scope==='row'));
 draw();effects.splice(0).forEach(fn=>fn());
 return{draw,all,button,field,dialog,rows,calls,roleCalls,runEffects(){draw();effects.splice(0).forEach(fn=>fn())},get changes(){return changes},get denials(){return denials},active(next){active=next;draw();effects.splice(0).forEach(fn=>fn())},refresh(next){refreshVersion=next;draw();effects.splice(0).forEach(fn=>fn())},listArgs,rawRoleArgs,states,setOpen(next){opened=next;draw();effects.splice(0).forEach(fn=>fn())},section(next){currentSection=next;draw();effects.splice(0).forEach(fn=>fn())},dispose:()=>cleanups.forEach(fn=>fn?.()),role(next){roleAccess=next;draw();effects.splice(0).forEach(fn=>fn())},actor(next){actor=next;currentSession={...session,user:{id:next.auth_user_id}};draw();effects.splice(0).forEach(fn=>fn())}};
}

test('data scope, role, status and text filters intersect locally; reset restores the authorized directory without IO',async()=>{
 const h=ui();await flush();assert.equal(h.rows().length,3);const reads=h.calls.length;
 for(const [label,name] of [["搜索账号","后台账号搜索"],["系统身份","后台账号系统身份筛选"],["数据范围","后台账号数据范围筛选"],["状态","后台账号状态筛选"]])assert.equal(h.field(label).props["aria-label"],name);
 h.field('数据范围').props.onChange({target:{value:'BR_PANGHU'}});assert.deepEqual(h.rows().map(text).map(t=>/brazil-fixture/.test(t)?'BR':'OWNER').sort(),['BR','OWNER']);
 h.field('系统身份').props.onChange({target:{value:'viewer'}});assert.equal(h.rows().length,1);assert.match(text(h.rows()),/brazil-fixture/);
 h.field('状态').props.onChange({target:{value:'disabled'}});assert.equal(h.rows().length,0);
 h.field('搜索账号').props.onChange({target:{value:'no-match'}});h.button('重置筛选').props.onClick();assert.equal(h.rows().length,3);assert.equal(h.field('搜索账号').props.value,'');assert.equal(h.field('数据范围').props.value,'all');assert.equal(h.calls.length,reads);
 assert(h.all().some(n=>n.type==='option'&&n.props.value==='locked'&&n.props.disabled),'locked filter waits for confirmed security state');
});

test('create opens a modal; cancel clears credentials and scope draft with no writes',async()=>{
 const h=ui();await flush();h.button('+ 新建账号').props.onClick();let d=h.dialog();assert.equal(d.props.title,'新建后台账号');
 h.all().find(n=>n.props.id==='admin-new-username').props.onChange({target:{value:'draft'}});h.all().find(n=>n.props.id==='admin-new-password').props.onChange({target:{value:'fixture-password'}});
 h.all().find(n=>n.type?.name==='DataScopePicker').props.onChange(BR);h.dialog().props.onClose();assert(!h.dialog());assert(!JSON.stringify(h.states).includes('fixture-password'));assert(!h.calls.some(c=>c.action==='create'));
 h.button('+ 新建账号').props.onClick();assert.equal(h.all().find(n=>n.props.id==='admin-new-username').props.value,'');assert.deepEqual(plain(h.all().find(n=>n.type?.name==='DataScopePicker').props.value),{mode:'selected',countries:[],platforms:[]});
});

test('create uses explicit new role/version/scope and blocks dismissal or duplicate submit while busy',async()=>{
 let resolve;const h=ui({create:()=>new Promise(r=>{resolve=r})});await flush();h.button('+ 新建账号').props.onClick();
 h.all().find(n=>n.props.id==='admin-new-username').props.onChange({target:{value:'new-fixture'}});h.all().find(n=>n.props.id==='admin-new-password').props.onChange({target:{value:'fixture-password'}});h.all().find(n=>n.type?.name==='DataScopePicker').props.onChange(BR);
 h.all().find(n=>n.props.id==='admin-new-role').props.onChange({target:{value:EMPTY_ROLE.id}});
 const pending=nodes(h.dialog()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 assert.equal(h.dialog().props.busy,true);assert(h.all().some(n=>n.type==='fieldset'&&n.props.disabled));h.dialog().props.onClose();assert(h.dialog());
 await nodes(h.dialog()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(h.calls.filter(c=>c.action==='create').length,1);
 const args=h.calls.find(c=>c.action==='create').args;assert.equal(args.length,5);assert.deepEqual(args.slice(0,4),[session,'new-fixture','fixture-password',{id:EMPTY_ROLE.id,version:EMPTY_ROLE.version}]);assert.deepEqual(args[4],BR);
 resolve({account:{auth_user_id:'fixture-new',username:'new-fixture',role:'viewer',active:true,data_scope:BR,role_id:EMPTY_ROLE.id,role_version:3,assignment_version:1,role_name:EMPTY_ROLE.name}});await pending;assert(!h.dialog());assert(!JSON.stringify(h.states).includes('fixture-password'));
});

test('creation error is visible inside the dialog and preserves the draft for correction',async()=>{
 const h=ui({create:()=>{throw Error('账号已存在')}});await flush();h.button('+ 新建账号').props.onClick();h.all().find(n=>n.props.id==='admin-new-username').props.onChange({target:{value:'duplicate'}});
 h.all().find(n=>n.props.id==='admin-new-role').props.onChange({target:{value:EMPTY_ROLE.id}});h.all().find(n=>n.type?.name==='DataScopePicker').props.onChange(BR);await nodes(h.dialog()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert(h.dialog());assert.match(text(h.dialog()),/账号已存在/);assert.equal(h.all().find(n=>n.props.id==='admin-new-username').props.value,'duplicate');
});

test('existing editable account opens the same modal without an inline table row or implicit mutation',async()=>{
 const h=ui();await flush();const row=h.rows().find(n=>text(n).includes('brazil-fixture'));h.button('账号设置',row).props.onClick();assert.equal(h.dialog().props.title,'后台账号设置 · brazil-fixture');assert.equal(h.all().filter(n=>n.props?.className==='admin-account-editor-row').length,0);assert(!h.calls.some(c=>['create','update','password'].includes(c.action)));
 const editor=h.all().find(n=>n.type?.name==='AccountDataScopeEditor');await editor.props.onSave({data_scope:BR});assert.deepEqual(h.calls.find(c=>c.action==='update').args,[session,'brazil-fixture',{data_scope:BR},brazil]);assert.match(text(h.dialog()),/已更新/);h.dialog().props.onClose();assert(!h.dialog());
 const ownerRow=h.rows().find(n=>text(n).includes('owner-fixture'));assert(!nodes(ownerRow).some(n=>n.type==='button'&&text(n)==='账号设置'),'owner fixed-account protection remains');
});


test('embedded backend account page waits for a manual query before reading the directory',async()=>{
 const h=ui({manualQuery:true});await flush();assert.equal(h.calls.length,0);assert.equal(h.rows().length,0);assert.match(text(h.draw()),/尚未查询账号/);assert.match(text(h.draw()),/点击「查询账号」/);assert.doesNotMatch(text(h.draw()),/0 全部账号|显示 0|没有符合当前/);
 await h.button('查询账号').props.onClick();await flush();assert.deepEqual(h.calls,[{action:'list'}]);assert.equal(h.rows().length,3);
 h.draw();assert.equal(h.calls.length,1);
});


test('manual directory distinguishes pending reads, confirmed zero, and filtered empty results',async()=>{
 let resolve;const h=ui({manualQuery:true,list:()=>new Promise(r=>resolve=r)});
 h.button('查询账号').props.onClick();assert.match(text(h.draw()),/正在读取账号/);assert.doesNotMatch(text(h.draw()),/显示 0|没有符合当前搜索/);
 resolve([]);await flush();assert.match(text(h.draw()),/显示 0 \/ 0 个账号/);assert.match(text(h.draw()),/当前可管理范围内没有后台账号/);
 h.button('刷新列表').props.onClick();resolve([brazil]);await flush();h.field('搜索账号').props.onChange({target:{value:'other'}});assert.match(text(h.draw()),/显示 0 \/ 1 个账号/);assert.match(text(h.draw()),/没有符合当前搜索条件/);
});

test('temporary refresh failure preserves the last roster and blocks writes until a successful recheck',async()=>{
 let fail=false;const h=ui({manualQuery:true,list:async()=>{if(fail)throw Error('fixture read failure');return[brazil]}});
 h.button('查询账号').props.onClick();await flush();assert.equal(h.rows().length,1);
 fail=true;h.button('刷新列表').props.onClick();await flush();assert.equal(h.rows().length,1);assert.match(text(h.draw()),/fixture read failure/);assert.match(text(h.draw()),/保留上次列表/);assert.equal(h.button('账号设置',h.rows()[0]).props.disabled,true);
 fail=false;h.button('刷新列表').props.onClick();await flush();assert.equal(h.rows().length,1);assert.doesNotMatch(text(h.draw()),/fixture read failure/);assert.equal(h.button('账号设置',h.rows()[0]).props.disabled,false);
});

test('account or scope changes invalidate old directory responses and require another manual query',async()=>{
 const resolves=[];const h=ui({manualQuery:true,list:()=>new Promise(r=>resolves.push(r))});
 h.button('查询账号').props.onClick();h.actor({...owner,role:'admin',auth_user_id:'fixture-second',username:'second'});resolves.shift()([brazil]);await flush();assert.equal(h.rows().length,0);assert.match(text(h.draw()),/尚未查询账号/);assert.equal(h.calls.length,1);
 h.button('查询账号').props.onClick();resolves.shift()([india]);await flush();assert.equal(h.rows().length,1);
 h.actor({...owner,role:'admin',auth_user_id:'fixture-second',username:'second',data_scope:IN});assert.equal(h.rows().length,0);assert.match(text(h.draw()),/尚未查询账号/);assert.equal(h.calls.length,2);
});

test('duplicate pending queries share one request and a warm refresh never unmounts the account rows',async()=>{
 const resolves=[];const h=ui({manualQuery:true,list:()=>new Promise(r=>resolves.push(r))});const query=h.button('查询账号').props.onClick;query();query();assert.equal(resolves.length,1);resolves[0]([brazil]);await flush();
 const refresh=h.button('刷新列表').props.onClick;refresh();refresh();assert.equal(resolves.length,2);assert.equal(h.rows().length,1);assert.match(text(h.rows()),/brazil-fixture/);assert.doesNotMatch(text(h.draw()),/请稍候，账号与授权目录正在读取/);
 assert(h.all().some(n=>n.type?.name==='AccountLoginPolicy'),'security component stays mounted while refreshing');resolves[1]([india]);await flush();assert.match(text(h.rows()),/india-fixture/);assert.doesNotMatch(text(h.rows()),/brazil-fixture/);h.dispose();
});

test('accounts-only save keeps success feedback and never reads unused audit records',async()=>{
 const h=ui({manualQuery:true,audit:()=>Promise.reject(Error('unused audit failure'))});
 await h.button('查询账号').props.onClick();await flush();h.button('账号设置',h.rows().find(row=>text(row).includes(brazil.username))).props.onClick();
 const saved=await h.all().find(n=>n.type?.name==='AccountDataScopeEditor').props.onSave({data_scope:BR});await flush();
 assert.equal(saved,true);assert.equal(h.calls.filter(c=>c.action==='update').length,1);assert.equal(h.calls.filter(c=>c.action==='audit').length,0);
 assert.match(text(h.draw()),/brazil-fixture 已更新/);assert.doesNotMatch(text(h.draw()),/unused audit failure/);h.dispose();
});

test('full account management keeps its authorized post-save audit read and error feedback',async()=>{
 const h=ui({manualQuery:true,accountsOnlyLoading:false,audit:()=>Promise.reject(Error('actual audit failure'))});
 await h.button('查询账号').props.onClick();await flush();h.button('账号设置',h.rows().find(row=>text(row).includes(brazil.username))).props.onClick();
 await h.all().find(n=>n.type?.name==='AccountDataScopeEditor').props.onSave({data_scope:BR});await flush();
 assert.equal(h.calls.filter(c=>c.action==='audit').length,1);assert.match(text(h.draw()),/actual audit failure/);h.dispose();
});

test('full audit surface still reads records explicitly and retains its permission guard',async()=>{
 const log={id:1,created_at:'2026-10-24T01:00:00Z',actor_username:'synthetic-auditor',target_username:'synthetic-target',action:'synthetic-action',details:{}};
 const h=ui({actor:{...owner,role:'admin',management_permissions:{manage_viewers:true}},roleAccess:{mode:'assigned',roleId:'synthetic-role',canView:true,permissions:['access.view','operation_logs.view']},manualQuery:true,accountsOnlyLoading:false,section:'audit',audit:async()=>[log]});
 await h.button('刷新记录').props.onClick();await flush();assert.equal(h.calls.filter(c=>c.action==='audit').length,1);assert.match(text(h.draw()),/synthetic-auditor/);
 h.role({mode:'assigned',roleId:'synthetic-role',canView:true,permissions:['access.view']});
 assert(!h.all().some(n=>n.type==='button'&&text(n)==='刷新记录'));assert.equal(h.calls.filter(c=>c.action==='audit').length,1);
 h.dispose();
});

for(const replacement of ['account','permissions'])test('accounts-only pending save cannot restore old feedback after '+replacement+' replacement',async()=>{
 let complete;const h=ui({manualQuery:true,update:()=>new Promise(resolve=>complete=resolve),audit:()=>Promise.reject(Error('unused audit failure'))});
 await h.button('查询账号').props.onClick();await flush();h.button('账号设置',h.rows().find(row=>text(row).includes(brazil.username))).props.onClick();
 const saving=h.all().find(n=>n.type?.name==='AccountDataScopeEditor').props.onSave({data_scope:BR});
 if(replacement==='account')h.actor({...owner,auth_user_id:'synthetic-new-account',username:'new-account'});
 else h.role({mode:'assigned',roleId:'synthetic-narrow-role',canView:true,permissions:['access.view']});
 complete();assert.equal(await saving,false);await flush();assert.equal(h.calls.filter(c=>c.action==='audit').length,0);
 assert.doesNotMatch(text(h.draw()),/brazil-fixture 已更新|unused audit failure/);assert.match(text(h.draw()),/尚未查询账号/);h.dispose();
});


const assigned = permissions => ({mode:'assigned',roleId:'33333333-3333-4333-8333-333333333333',roleName:'Synthetic',version:1,canView:true,permissions});
const manager = {...owner,auth_user_id:'fixture-manager',username:'manager',role:'admin',management_permissions:{manage_viewers:true}};
test('assigned view-only account page disables all write entrances and waits for manual directory query',async()=>{
 const h=ui({actor:manager,manualQuery:true,roleAccess:assigned(['access.view'])});assert.equal(h.calls.length,0);
 assert.equal(h.button('+ 新建账号').props.disabled,true);h.button('+ 新建账号').props.onClick();assert.equal(h.dialog(),undefined);
 await h.button('查询账号').props.onClick();await flush();
 const target=h.rows().find(row=>text(row).includes(brazil.username));assert(target);
 for(const label of ['账号设置','配置权限']){const b=h.button(label,target);assert.equal(b.props.disabled,true);b.props.onClick();}
 assert.equal(h.dialog(),undefined);assert(!h.all().some(n=>n.type?.name==='AccountPermissionDialog'));assert(h.calls.every(call=>call.action==='list'));
});
test('assigned edit does not imply status, password reset or deletion; submit handlers also refuse denied writes',async()=>{
 const h=ui({actor:manager,manualQuery:true,roleAccess:assigned(['access.view','access.edit'])});await h.button('查询账号').props.onClick();await flush();
 h.button('账号设置',h.rows().find(row=>text(row).includes(brazil.username))).props.onClick();const dialog=h.dialog();assert(dialog);
 assert(nodes(dialog).some(n=>n.type?.name==='AccountDataScopeEditor'));
 for(const label of ['停用','重置密码','删除账号']){const b=h.button(label,dialog);assert.equal(b.props.disabled,true);await b.props.onClick();}
 assert(h.calls.every(call=>call.action==='list'));assert(!h.all().some(n=>n.type==='form'&&n.props.className==='admin-inline-reset'));
 const editor=nodes(dialog).find(n=>n.type?.name==='AccountDataScopeEditor');await editor.props.onSave({data_scope:BR});assert.equal(h.calls.filter(call=>call.action==='update').length,1);
});
test('assigned password-only rights open only password actions while preserving scope and target restrictions',async()=>{
 const h=ui({actor:manager,manualQuery:true,roleAccess:assigned(['access.view','access.reset_password'])});await h.button('查询账号').props.onClick();await flush();
 const target=h.rows().find(row=>text(row).includes(brazil.username));h.button('账号设置',target).props.onClick();let dialog=h.dialog();
 assert(!nodes(dialog).some(n=>n.type?.name==='AccountDataScopeEditor'));assert.equal(h.button('停用',dialog).props.disabled,true);assert.equal(h.button('删除账号',dialog).props.disabled,true);
 assert.equal(h.button('重置密码',dialog).props.disabled,false);h.button('重置密码',dialog).props.onClick();dialog=h.dialog();
 const form=nodes(dialog).find(n=>n.type==='form'&&n.props.className==='admin-inline-reset');assert(form);nodes(form).find(n=>n.type==='input').props.onChange({target:{value:'synthetic-new-password'}});
 await nodes(h.dialog()).find(n=>n.type==='form'&&n.props.className==='admin-inline-reset').props.onSubmit({preventDefault(){}});
 assert.equal(h.calls.filter(call=>call.action==='password').length,1);assert.equal(h.calls.find(call=>call.action==='password').args[1],brazil.username);
 const limited=ui({actor:{...manager,data_scope:BR},manualQuery:true,roleAccess:assigned(['access.view','access.edit','access.reset_password'])});await limited.button('查询账号').props.onClick();await flush();
 assert(!nodes(limited.rows().find(row=>text(row).includes(india.username))).some(n=>n.type==='button'&&text(n)==='账号设置'));
});
test('assigned status requires edit and status together; role changes invalidate loaded account rows',async()=>{
 const h=ui({actor:manager,manualQuery:true,roleAccess:assigned(['access.view','access.edit','access.status'])});await h.button('查询账号').props.onClick();await flush();
 h.button('账号设置',h.rows().find(row=>text(row).includes(brazil.username))).props.onClick();assert.equal(h.button('停用',h.dialog()).props.disabled,false);
 await h.button('停用',h.dialog()).props.onClick();assert.equal(h.calls.filter(call=>call.action==='update').length,1);assert.deepEqual(h.calls.find(call=>call.action==='update').args[2],{active:false});
 h.role(assigned(['access.view']));assert.equal(h.rows().length,0);assert.equal(h.dialog(),undefined);assert.match(text(h.draw()),/尚未查询账号/);
});

test('owner login security is only mounted after an authoritative directory read and lock filters use its snapshot',async()=>{
 const h=ui({manualQuery:true});assert(!h.all().some(n=>n.type?.name==='AccountLoginPolicy'));h.button('查询账号').props.onClick();await flush();
 let security=h.all().find(n=>n.type?.name==='AccountLoginPolicy');assert(security);assert.equal(security.props.surface,'dashboard');
 security.props.onSnapshot({status:'ready',states:{[brazil.auth_user_id]:{failed_count:5,failure_limit:null,locked:true,locked_at:'2026-10-01',version:3}},failureLimit:5});
 h.field('状态').props.onChange({target:{value:'locked'}});assert.equal(h.rows().length,1);assert.match(text(h.rows()),/brazil-fixture.*自动锁定/);
 h.button('登录安全').props.onClick();security=h.all().find(n=>n.type?.name==='AccountLoginPolicy');assert.equal(security.props.target.id,brazil.auth_user_id);assert.equal(security.props.target.active,true);assert.equal(h.calls.length,1);
 const limited=ui({actor:manager,manualQuery:true,roleAccess:assigned(['access.view'])});limited.button('查询账号').props.onClick();await flush();assert(limited.all().some(n=>n.type?.name==='AccountLoginPolicy')); assert(limited.all().some(n=>n.type==='button'&&text(n)==='登录安全'));
});

const vipRole={id:'role-vip',name:'VIP',active:true,permissions:['overview.view','providers.view','providers.query'],version:1};
const vipRoster=()=>({roles:[vipRole],accounts:[{...brazil,role_id:vipRole.id,assignment_version:2}]});
test('backend account list shows confirmed assigned VIP and its permissions without changing the system identity or issuing writes',async()=>{
 const h=ui({manualQuery:true,users:[brazil],roles:vipRoster});assert.equal(h.roleCalls.length,0);
 await h.button('查询账号').props.onClick();await flush();
 assert.equal(h.roleCalls.length,1);assert.deepEqual(h.roleCalls[0],[session,{operation:'list'}]);
 const row=text(h.rows());assert.match(row,/VIP/);assert.match(row,/系统身份：VIEWER · 角色授权/);assert.match(row,/2 个目录 · 3 项权限/);assert.doesNotMatch(row,/账号独立授权|三方量 \/ 费率/);
 h.field('搜索账号').props.onChange({target:{value:'VIP'}});assert.equal(h.rows().length,1);assert.deepEqual(h.calls,[{action:'list'}]);
 h.field('系统身份').props.onChange({target:{value:'admin'}});assert.equal(h.rows().length,0,'custom role never promotes coarse identity');
});
test('unknown role metadata is visibly unverified, never silently called independent authorization',async()=>{
 const h=ui({users:[brazil],roles:()=>Promise.reject(Error('fixture'))});await flush();
 assert.match(text(h.rows()),/角色读取失败，请刷新列表/);assert.doesNotMatch(text(h.rows()),/账号独立授权|VIP/);
 h.button('配置权限').props.onClick();assert.match(text(h.dialog()),/角色读取尚未完成/);assert(!h.all().some(n=>n.type?.name==='AccountPermissionDialog'));
 h.dialog().props.onClose();h.button('账号设置').props.onClick();assert(!h.all().some(n=>n.type?.name==='AccountRoleEditor'),'unverified assigned status never enables legacy identity editing');
 const missing=ui({users:[brazil],roles:()=>({roles:[],accounts:[]})});await flush();assert.match(text(missing.rows()),/角色待核对/);assert.doesNotMatch(text(missing.rows()),/账号独立授权/);
 const admin=ui({actor:manager,users:[brazil]});await flush();assert.equal(admin.roleCalls.length,1,'existing authorized admins also read the server-scoped assigned role roster');assert.match(text(admin.rows()),/未分配角色/);
});
test('assigned account permission configuration uses its actual role and never the legacy profile editor',async()=>{
 const h=ui({users:[brazil],roles:vipRoster});await flush();h.button('配置权限').props.onClick();
 const dialog=h.all().find(n=>n.type?.name==='AccountAssignedRoleDialog');assert(dialog);assert.equal(dialog.props.account.role_id,vipRole.id);assert.equal(dialog.props.roles[0].name,'VIP');
 assert(!h.all().some(n=>n.type?.name==='AccountPermissionDialog'));assert(h.calls.every(call=>call.action==='list'));
});
test('late role roster cannot leak a previous owner identity into the new account directory',async()=>{
 const resolves=[];const h=ui({manualQuery:true,users:[brazil],roles:()=>new Promise(r=>resolves.push(r))});
 h.button('查询账号').props.onClick();await flush();assert.match(text(h.rows()),/角色待核对/);
 h.actor(manager);h.button('查询账号').props.onClick();await flush();resolves[0](vipRoster());await flush();
 assert.doesNotMatch(text(h.rows()),/VIP|账号独立授权/);assert.equal(h.roleCalls.length,2);
 resolves[1](vipRoster());await flush();assert.match(text(h.rows()),/VIP/);
});
test('legacy admin sees the assigned role as read-only instead of changing ineffective profile permissions',async()=>{
 const h=ui({actor:manager,users:[brazil],roles:vipRoster});await flush();assert.match(text(h.rows()),/VIP/);h.button('查看权限').props.onClick();
 const dialog=h.all().find(n=>n.type?.name==='AccountAssignedRoleDialog');assert(dialog);assert.equal(dialog.props.editable,false);assert(!h.all().some(n=>n.type?.name==='AccountPermissionDialog'));
 assert(h.calls.every(call=>call.action==='list'));assert.equal(h.roleCalls.length,1);
});


test('new role choice has no default VIP or legacy module checkboxes; empty role is explicit and remains zero permissions',async()=>{
 const h=ui();await flush();h.button('+ 新建账号').props.onClick();assert.equal(h.all().find(n=>n.props.id==='admin-new-role').props.value,'');
 assert(!nodes(h.dialog()).some(n=>n.type==='input'&&n.props.type==='checkbox'),'creation does not use legacy module permissions');
 await nodes(h.dialog()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert(!h.calls.some(c=>c.action==='create'));assert.match(text(h.dialog()),/明确选择/);
 h.all().find(n=>n.props.id==='admin-new-role').props.onChange({target:{value:EMPTY_ROLE.id}});assert.match(text(h.dialog()),/0 项权限/);assert.equal(h.button('建立后台账号',h.dialog()).props.disabled,true,'a chosen role does not imply a data grant');h.all().find(n=>n.type?.name==='DataScopePicker').props.onChange(BR);assert.equal(h.button('建立后台账号',h.dialog()).props.disabled,false);
 h.dialog().props.onClose();h.button('+ 新建账号').props.onClick();assert.equal(h.all().find(n=>n.props.id==='admin-new-role').props.value,'');
});
test('delegated creation requires create plus edit, filters ungrantable roles and cannot forge hidden role selection',async()=>{
 for(const permissions of [['access.view','access.create'],['access.view','access.edit']]){const h=ui({actor:manager,roleAccess:assigned(permissions)});await flush();assert.equal(h.button('+ 新建账号').props.disabled,true);h.button('+ 新建账号').props.onClick();assert(!h.dialog());}
 const h=ui({actor:manager,roleAccess:assigned(['access.view','access.create','access.edit'])});await flush();h.button('+ 新建账号').props.onClick();const select=h.all().find(n=>n.props.id==='admin-new-role');assert(!nodes(select).some(n=>n.type==='option'&&n.props.value===VIP_ROLE.id));
 select.props.onChange({target:{value:VIP_ROLE.id}});await nodes(h.dialog()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert(!h.calls.some(c=>c.action==='create'));assert.match(text(h.dialog()),/明确选择/);
});
test('role directory failure and pending reads never fall back to legacy creation or auto-select a role',async()=>{
 for(const roles of [()=>{throw Error('synthetic role failure')},()=>new Promise(()=>{})]){const h=ui({roles});await flush();h.button('+ 新建账号').props.onClick();await flush();assert.equal(h.all().find(n=>n.props.id==='admin-new-role').props.disabled,true);assert.equal(h.button('建立后台账号',h.dialog()).props.disabled,true);await nodes(h.dialog()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert(!h.calls.some(c=>c.action==='create'));}
});
test('creation actor change clears role/credentials and a late completed request cannot reopen or overwrite new actor state',async()=>{
 let resolve;const h=ui({create:()=>new Promise(r=>{resolve=r})});await flush();h.button('+ 新建账号').props.onClick();h.all().find(n=>n.props.id==='admin-new-role').props.onChange({target:{value:EMPTY_ROLE.id}});h.all().find(n=>n.props.id==='admin-new-username').props.onChange({target:{value:'synthetic-new'}});h.all().find(n=>n.props.id==='admin-new-password').props.onChange({target:{value:'synthetic-password'}});
 h.all().find(n=>n.type?.name==='DataScopePicker').props.onChange(BR);const pending=nodes(h.dialog()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});h.actor({...manager,data_scope:IN});h.draw();assert(!h.dialog());assert(!JSON.stringify(h.states).includes('synthetic-password'));resolve({account:{username:'synthetic-new',role_name:'Old role'}});await pending;assert(!h.dialog());assert.doesNotMatch(text(h.draw()),/已建立，角色/);
});

test('account summaries and creation hints count only current pages while retaining the complete assigned role',async()=>{
 const permissions=[...VIP_ROLE.permissions,'merchantproviders.view','merchantproviders.query','merchantproviders.detail','merchantproviders.export'];
 const saved={...VIP_ROLE,permissions},h=ui({users:[brazil],roles:()=>({roles:[saved],accounts:[{...brazil,role_id:saved.id,assignment_version:2}]})});await flush();
 assert.match(text(h.rows()),/1 个目录 · 1 项权限/);assert.doesNotMatch(text(h.rows()),/5 项权限/);
 h.button('账号设置').props.onClick();assert.match(text(h.dialog()),/1 个目录 · 1 项权限/);h.dialog().props.onClose();
 h.button('配置权限').props.onClick();const assigned=h.all().find(node=>node.type?.name==='AccountAssignedRoleDialog');assert.deepEqual(plain(assigned.props.roles[0].permissions),permissions);assigned.props.onClose();
 h.button('+ 新建账号').props.onClick();const select=h.all().find(node=>node.props.id==='admin-new-role');assert.match(text(select),/VIP · 1 项权限/);select.props.onChange({target:{value:saved.id}});
 assert.match(text(h.dialog()),/1 个页面、1 项权限/);assert.doesNotMatch(text(h.dialog()),/平台三方分析/);
 h.all().find(node=>node.props.id==='admin-new-username').props.onChange({target:{value:'display-fixture'}});h.all().find(node=>node.props.id==='admin-new-password').props.onChange({target:{value:'fixture-password'}});
 h.all().find(node=>node.type?.name==='DataScopePicker').props.onChange(ALL);await nodes(h.dialog()).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});const create=h.calls.find(call=>call.action==='create');assert.deepEqual(create.args[3],{id:saved.id,version:saved.version});assert.deepEqual(create.args[4],ALL);assert.deepEqual(saved.permissions,permissions);
});
test('display-hidden permissions remain part of delegated account creation grant checks',async()=>{
 const saved={...EMPTY_ROLE,permissions:['merchantproviders.view','merchantproviders.query']};
 const h=ui({actor:manager,roleAccess:assigned(['access.view','access.create','access.edit']),roles:()=>({roles:[saved],accounts:[]})});await flush();h.button('+ 新建账号').props.onClick();
 const select=h.all().find(node=>node.props.id==='admin-new-role');assert(!nodes(select).some(node=>node.type==='option'&&node.props.value===saved.id));select.props.onChange({target:{value:saved.id}});
 await nodes(h.dialog()).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});assert(!h.calls.some(call=>call.action==='create'));
});

test('specified platform creation waits for a verified catalog then submits a platform-only scope',async()=>{
 const h=ui();await flush();h.button('+ 新建账号').props.onClick();
 h.all().find(n=>n.props.id==='admin-new-username').props.onChange({target:{value:'platform-fixture'}});
 h.all().find(n=>n.props.id==='admin-new-role').props.onChange({target:{value:EMPTY_ROLE.id}});
 const scope={mode:'selected',countries:[],platforms:[{country:'IN',platform:'91CLUB'}]};
 const picker=()=>h.all().find(n=>n.type?.name==='DataScopePicker');
 picker().props.onChange(scope);
 assert.equal(h.button('建立后台账号').props.disabled,true);
 await nodes(h.dialog()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 assert(!h.calls.some(c=>c.action==='create'));
 picker().props.onValidityChange(true);assert.equal(h.button('建立后台账号').props.disabled,false);
 picker().props.onValidityChange(false);assert.equal(h.button('建立后台账号').props.disabled,true);
 picker().props.onValidityChange(true);
 await nodes(h.dialog()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 assert.deepEqual(h.calls.find(c=>c.action==='create').args[4],scope);
});


test('new accounts start with no platform grants for owners and restricted managers, never inheriting actor scope',async()=>{
 const scope={mode:'selected',countries:[],platforms:[{country:'IN',platform:'91CLUB'}]};
 for(const options of [{},{actor:{...manager,data_scope:scope},roleAccess:assigned(['access.view','access.create','access.edit'])}]){
  const h=ui(options);await flush();h.button('+ 新建账号').props.onClick();
  const picker=()=>h.all().find(n=>n.type?.name==='DataScopePicker');
  assert.deepEqual(plain(picker().props.value),{mode:'selected',countries:[],platforms:[]});
  h.all().find(n=>n.props.id==='admin-new-role').props.onChange({target:{value:EMPTY_ROLE.id}});
  assert.equal(h.button('建立后台账号').props.disabled,true);
  await nodes(h.dialog()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert(!h.calls.some(c=>c.action==='create'));
  picker().props.onChange(scope);picker().props.onValidityChange(true);h.dialog().props.onClose();h.button('+ 新建账号').props.onClick();
  assert.deepEqual(plain(picker().props.value),{mode:'selected',countries:[],platforms:[]});assert.equal(h.button('建立后台账号').props.disabled,true);h.dispose();
 }
});

test('compact account rows separate identity, role, full scope disclosure, status and bounded actions without writes',async()=>{
 const scope={mode:'selected',countries:[],platforms:[{country:'IN',platform:'91CLUB'},{country:'PK',platform:'92GO'}]};
 const h=ui({users:[{...brazil,data_scope:scope}]});await flush();
 const table=h.all().find(n=>n.type==='table'&&n.props.className.includes('admin-account-management-table'));
 assert.deepEqual(nodes(table).filter(n=>n.type==='th'&&n.props.scope==='col').map(text),['账号','角色 / 页面权限','数据授权范围','状态','操作']);
 const row=h.rows()[0];assert.equal(nodes(row).filter(n=>n.type==='th'||n.type==='td').length,5);
 const disclosure=nodes(row).find(n=>n.type==='details'&&n.props.className==='admin-account-scope-details');assert(disclosure);assert.equal(disclosure.props.open,undefined);
 assert.match(text(disclosure),/2 个指定平台/);assert.match(text(disclosure),/印度.*91CLUB/);assert.match(text(disclosure),/巴基斯坦.*92GO/);
 assert(h.calls.every(c=>c.action==='list'));h.button('账号设置',row).props.onClick();assert.deepEqual(plain(h.all().find(n=>n.type?.name==='AccountDataScopeEditor').props.user.data_scope),scope);
 const css=fs.readFileSync(path.join(root,'src/components/AdminControlCenter.css'),'utf8');assert.match(css,/\.admin-account-management-table \.admin-matrix-actions\s*\{[^}]*flex-direction:row/);assert.match(css,/\.admin-account-scope-details > p\s*\{[^}]*max-height:160px/);h.dispose();
});

test('module permission view retains its permission matrix rather than receiving compact account columns',async()=>{
 const h=ui({section:'permissions'});await flush();const table=h.all().find(n=>n.type==='table'&&n.props.className.includes('admin-permission-matrix'));
 assert.deepEqual(nodes(table).filter(n=>n.type==='th'&&n.props.scope==='col').map(text),['账号 / 角色','模块权限 · 已开 / 权限总数','操作']);
 assert(h.all().some(n=>n.type==='section'&&n.props.className.includes('admin-permission-directory')));assert(h.calls.every(c=>c.action==='list'));h.dispose();
});

test('refreshing the role selector does not reread or remove the account directory',async()=>{
 const h=ui();await flush();h.button('+ 新建账号').props.onClick();const reads=h.calls.filter(c=>c.action==='list').length,roles=h.roleCalls.length;
 await h.button('刷新角色',h.dialog()).props.onClick();await flush();assert.equal(h.calls.filter(c=>c.action==='list').length,reads);assert.equal(h.roleCalls.length,roles+1);assert.equal(h.rows().length,3);h.dispose();
});

test('account rows become visible before a slower independent role directory',async()=>{
 let finish;const h=ui({roles:()=>new Promise(r=>finish=r)});await flush();assert.equal(h.rows().length,3);assert.equal(h.calls.filter(c=>c.action==='list').length,1);
 finish({roles:[],accounts:[owner,brazil,india].map(a=>({...a,role_id:null,assignment_version:0}))});await flush();assert.equal(h.rows().length,3);assert.equal(h.calls.filter(c=>c.action==='list').length,1);h.dispose();
});

for(const denied of [{status:401},{status:403},{code:'unauthorized'},{code:'forbidden'},{code:'actor_changed'}])test('directory denial clears both reads and cannot be undone by a late sibling '+JSON.stringify(denied),async()=>{
 let reject,late,phase=false;const roleDenial=!!denied.code;
 const h=ui({list:()=>!phase?[brazil]:roleDenial?new Promise(r=>late=r):new Promise((_,r)=>reject=r),roles:()=>!phase?{roles:[],accounts:[{...brazil,role_id:null,assignment_version:0}]}:roleDenial?new Promise((_,r)=>reject=r):new Promise(r=>late=r)});await flush();assert.equal(h.rows().length,1);
 phase=true;h.button('刷新列表').props.onClick();reject(Object.assign(Error('permission revoked'),denied));await flush();assert.equal(h.rows().length,0);
 assert(h.listArgs.at(-1)[1].aborted);assert(h.rawRoleArgs.at(-1)[2].aborted);
 late(roleDenial?[brazil]:{roles:[],accounts:[{...brazil,role_id:null,assignment_version:0}]});await flush();assert.equal(h.rows().length,0);assert.match(text(h.draw()),/permission revoked/);h.dispose();
});

test('disposal physically cancels roster and roles and ignores transports that still resolve',async()=>{
 let rows,roles;const h=ui({list:()=>new Promise(r=>rows=r),roles:()=>new Promise(r=>roles=r)});h.dispose();assert(h.listArgs[0][1].aborted);assert(h.rawRoleArgs[0][2].aborted);
 rows([brazil]);roles({roles:[],accounts:[]});await flush();assert.equal(h.rows().length,0);
});

test('write confirmation updates only its row and cancels a pre-write read without starting another directory read',async()=>{
 const requests=[];let phase=false;const h=ui({users:[brazil],list:()=>!phase?[brazil]:new Promise(r=>requests.push(r))});await flush();h.button('账号设置').props.onClick();const save=h.all().find(n=>n.type?.name==='AccountDataScopeEditor').props.onSave;
 phase=true;h.button('刷新列表').props.onClick();const old=h.listArgs.at(-1)[1];const saving=save({active:false});await flush();assert.equal(requests.length,1);assert(old.aborted);assert.equal(await saving,true);await flush();assert.match(text(h.rows()),/停用/);
 requests[0]([brazil]);await flush();assert.match(text(h.rows()),/停用/);assert.doesNotMatch(text(h.rows()),/正常/);h.dispose();
});

test('password reset does not reload the account or role directories',async()=>{
 const h=ui({users:[brazil]});await flush();h.button('账号设置').props.onClick();h.button('重置密码',h.dialog()).props.onClick();const form=h.all().find(n=>n.type==='form'&&n.props.className==='admin-inline-reset');
 nodes(form).find(n=>n.type==='input').props.onChange({target:{value:'synthetic-only-password'}});const lists=h.calls.filter(c=>c.action==='list').length,roles=h.roleCalls.length;
 await h.all().find(n=>n.type==='form'&&n.props.className==='admin-inline-reset').props.onSubmit({preventDefault(){}});await flush();assert.equal(h.calls.filter(c=>c.action==='password').length,1);assert.equal(h.calls.filter(c=>c.action==='list').length,lists);assert.equal(h.roleCalls.length,roles);assert.match(text(h.draw()),/密码已重置/);h.dispose();
});

test('a synchronous mutation claim rejects a second save before React rerenders',async()=>{
 let finish;const h=ui({users:[brazil],update:()=>new Promise(r=>finish=r)});await flush();h.button('账号设置').props.onClick();const save=h.all().find(n=>n.type?.name==='AccountDataScopeEditor').props.onSave;
 const first=save({active:false}),second=save({active:false});assert.equal(await second,false);assert.equal(h.calls.filter(c=>c.action==='update').length,1);finish({ok:true,account:{...brazil,active:false}});assert.equal(await first,true);h.dispose();
});

for(const boundary of ['close','section','denial','dispose'])test('a late completed save cannot reopen or reread after '+boundary,async()=>{
 let finish,fail=false;const h=ui({users:[brazil],list:()=>{if(fail)throw Object.assign(Error('revoked'),{status:403});return[brazil]},update:()=>new Promise(r=>finish=r)});await flush();h.button('账号设置').props.onClick();const save=h.all().find(n=>n.type?.name==='AccountDataScopeEditor').props.onSave,request=save({active:false});
 if(boundary==='close')h.setOpen(false);else if(boundary==='section')h.section('permissions');else if(boundary==='dispose')h.dispose();else{fail=true;h.button('刷新列表').props.onClick();await flush();assert.equal(h.rows().length,0);}
 const count=h.calls.filter(c=>c.action==='list').length;finish();assert.equal(await request,false);await flush();assert.equal(h.calls.filter(c=>c.action==='list').length,count);assert.doesNotMatch(text(h.draw()),/brazil-fixture 已更新/);if(boundary==='denial'){assert.equal(h.rows().length,0);assert.match(text(h.draw()),/revoked/);}h.dispose();
});

for(const boundary of ['close','section'])test('cancelled cold directory becomes retryable after '+boundary,async()=>{
 const finish=[];const h=ui({manualQuery:true,list:()=>new Promise(r=>finish.push(r))});h.button('查询账号').props.onClick();const signal=h.listArgs[0][1];if(boundary==='close'){h.setOpen(false);h.setOpen(true);}else h.section('permissions');assert(signal.aborted);assert.equal(h.button('查询账号').props.disabled,false);
 h.button('查询账号').props.onClick();finish[1]([india]);await flush();finish[0]([brazil]);await flush();assert.match(text(h.rows()),/india-fixture/);assert.doesNotMatch(text(h.rows()),/brazil-fixture/);h.dispose();
});

test('opening create before a manual query also verifies the roster and never leaves an enabled inert submit',async()=>{
 let finish;const h=ui({manualQuery:true,list:()=>new Promise(r=>finish=r)});h.button('+ 新建账号').props.onClick();await flush();assert.equal(h.calls.filter(c=>c.action==='list').length,1);assert.equal(h.button('建立后台账号',h.dialog()).props.disabled,true);finish([brazil]);await flush();assert.equal(h.rows().length,1);assert(h.dialog());h.dispose();
});
test('a denied account mutation clears the preserved directory and cannot report success',async()=>{
 const h=ui({users:[brazil],update:()=>Promise.reject(Object.assign(Error('write revoked'),{status:403}))});await flush();h.button('账号设置').props.onClick();const save=h.all().find(n=>n.type?.name==='AccountDataScopeEditor').props.onSave;
 assert.equal(await save({active:false}),false);await flush();assert.equal(h.rows().length,0);assert.equal(h.dialog(),undefined);assert.match(text(h.draw()),/write revoked/);assert.equal(h.calls.filter(c=>c.action==='list').length,1);h.dispose();
});

test('confirmed account update is local, preserves unrelated rows/filter/editor, and finishes before any directory reread',async()=>{
 const h=ui();await flush();h.field('搜索账号').props.onChange({target:{value:'brazil'}});h.button('账号设置',h.rows()[0]).props.onClick();
 const before=h.calls.filter(c=>c.action==='list').length,roleReads=h.roleCalls.length;
 assert.equal(await h.all().find(n=>n.type?.name==='AccountDataScopeEditor').props.onSave({active:false}),true);
 assert.equal(h.changes,1);assert.equal(h.calls.filter(c=>c.action==='list').length,before);assert.equal(h.roleCalls.length,roleReads);
 assert.equal(h.field('搜索账号').props.value,'brazil');assert.match(text(h.rows()),/停用/);assert.equal(h.dialog().props.busy,false);
 h.field('搜索账号').props.onChange({target:{value:''}});assert.equal(h.rows().length,3);assert.match(text(h.rows()),/india-fixture/);h.dispose();
});

test('confirmed create and delete merge exact identities without a directory reread',async()=>{
 const h=ui();await flush();h.button('+ 新建账号').props.onClick();
 h.all().find(n=>n.props.id==='admin-new-username').props.onChange({target:{value:'new-local'}});
 h.all().find(n=>n.props.id==='admin-new-password').props.onChange({target:{value:'fixture-password'}});
 h.all().find(n=>n.props.id==='admin-new-role').props.onChange({target:{value:EMPTY_ROLE.id}});
 h.all().find(n=>n.type?.name==='DataScopePicker').props.onChange(BR);
 await nodes(h.dialog()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 assert.equal(h.rows().length,4);assert.match(text(h.rows().find(row=>text(row).includes('new-local'))),/出款组长/);
 assert.equal(h.calls.filter(c=>c.action==='list').length,1);assert.equal(h.roleCalls.length,1);assert.equal(h.changes,1);
 h.button('账号设置',h.rows().find(row=>text(row).includes('new-local'))).props.onClick();
 await h.button('删除账号',h.dialog()).props.onClick();await flush();
 assert.equal(h.rows().length,3);assert.doesNotMatch(text(h.rows()),/new-local/);assert.equal(h.calls.filter(c=>c.action==='list').length,1);assert.equal(h.roleCalls.length,1);assert.equal(h.changes,2);h.dispose();
});

test('hidden account tab keeps its list and filters, clears credentials/portals and refuses stale handlers',async()=>{
 const h=ui();await flush();h.field('搜索账号').props.onChange({target:{value:'brazil'}});h.button('账号设置',h.rows()[0]).props.onClick();
 const save=h.all().find(n=>n.type?.name==='AccountDataScopeEditor').props.onSave,query=h.button('刷新列表').props.onClick;
 h.button('重置密码',h.dialog()).props.onClick();h.all().find(n=>n.type==='input'&&n.props.type==='password').props.onChange({target:{value:'must-not-survive-hidden'}});
 const readCount=h.calls.length,roles=h.roleCalls.length;h.active(false);assert.equal(h.draw().props.hidden,true);assert(!JSON.stringify(h.states).includes('must-not-survive-hidden'));
 assert.equal(await save({active:false}),false);query();await flush();assert.equal(h.calls.length,readCount);
 h.active(true);await flush();assert.equal(h.rows().length,1);assert.equal(h.field('搜索账号').props.value,'brazil');assert(!h.dialog());assert.equal(h.calls.length,readCount);assert.equal(h.roleCalls.length,roles);h.dispose();
});

test('hidden refresh cancellation drops late results, and a sibling role change rereads only roles when activated',async()=>{
 let finish,phase=false;const h=ui({list:()=>phase?new Promise(r=>finish=r):[brazil]});await flush();
 phase=true;h.button('刷新列表').props.onClick();const signal=h.listArgs.at(-1)[1];h.active(false);assert(signal.aborted);h.refresh(1);
 const reads=h.calls.filter(c=>c.action==='list').length,roles=h.roleCalls.length;finish([india]);await flush();assert.equal(h.draw()?.props.hidden,true);
 h.active(true);await flush();assert.match(text(h.rows()),/brazil-fixture/);assert.doesNotMatch(text(h.rows()),/india-fixture/);
 assert.equal(h.calls.filter(c=>c.action==='list').length,reads);assert.equal(h.roleCalls.length,roles+1);h.dispose();
});

test('confirmed assignment updates the target role without a roster or role-directory reread',async()=>{
 const h=ui({users:[brazil],roles:()=>({roles:[EMPTY_ROLE,VIP_ROLE],accounts:[{...brazil,role_id:null,assignment_version:0}]})});await flush();
 h.button('配置权限',h.rows()[0]).props.onClick();const dialog=h.all().find(n=>n.type?.name==='AccountAssignedRoleDialog');
 dialog.props.onSaved({...brazil,role_id:VIP_ROLE.id,assignment_version:1});dialog.props.onClose();
 assert.match(text(h.rows()),/VIP/);assert.equal(h.roleCalls.length,1);assert.equal(h.calls.filter(c=>c.action==='list').length,1);assert.equal(h.changes,1);h.dispose();
});

test('hidden update waits for its single acknowledgement before refreshing the original directory',async()=>{
 let finish,latest={...brazil};const h=ui({users:[brazil],list:()=>[latest],update:()=>new Promise(r=>finish=r)});await flush();
 h.button('账号设置').props.onClick();const request=h.all().find(n=>n.type?.name==='AccountDataScopeEditor').props.onSave({active:false});
 h.active(false);h.active(true);await flush();assert.equal(h.calls.filter(c=>c.action==='list').length,1);
 latest={...brazil,active:false};finish({ok:true,account:latest});assert.equal(await request,false);h.runEffects();await flush();
 assert.equal(h.calls.filter(c=>c.action==='list').length,2);assert.match(text(h.rows()),/停用/);assert(!h.dialog());h.dispose();
});
test('hidden role assignment waits for settlement then rechecks only the role directory',async()=>{
 let latest={...brazil,role_id:null,assignment_version:0};const h=ui({users:[brazil],roles:()=>({roles:[EMPTY_ROLE,VIP_ROLE],accounts:[latest]})});await flush();
 h.button('配置权限').props.onClick();const dialog=h.all().find(n=>n.type?.name==='AccountAssignedRoleDialog'),release=dialog.props.onMutationStart();
 assert.equal(typeof release,'function');h.active(false);h.active(true);await flush();assert.equal(h.calls.filter(c=>c.action==='list').length,1);assert.equal(h.roleCalls.length,1);
 latest={...latest,role_id:VIP_ROLE.id,assignment_version:1};release();dialog.props.onUnconfirmed();h.runEffects();await flush();
 assert.equal(h.calls.filter(c=>c.action==='list').length,1);assert.equal(h.roleCalls.length,2);assert.match(text(h.rows()),/VIP/);assert(!h.dialog());h.dispose();
});
test('a sibling role change supersedes an older in-flight directory response',async()=>{
 const pending=[];let phase=false;const h=ui({users:[brazil],roles:()=>!phase?{roles:[VIP_ROLE],accounts:[{...brazil,role_id:VIP_ROLE.id,assignment_version:1}]}:new Promise(r=>pending.push(r))});await flush();
 phase=true;h.refresh(1);const oldSignal=h.rawRoleArgs.at(-1)[2];h.refresh(2);assert(oldSignal.aborted);assert.equal(pending.length,2);
 pending[1]({roles:[{...VIP_ROLE,name:'Current role'}],accounts:[{...brazil,role_id:VIP_ROLE.id,assignment_version:1}]});await flush();
 pending[0]({roles:[{...VIP_ROLE,name:'Obsolete role'}],accounts:[{...brazil,role_id:VIP_ROLE.id,assignment_version:1}]});await flush();
 assert.match(text(h.rows()),/Current role/);assert.doesNotMatch(text(h.rows()),/Obsolete role/);assert.equal(h.calls.filter(c=>c.action==='list').length,1);h.dispose();
});
test('login policy remains mounted while hidden and a security denial clears every cached directory',async()=>{
 const h=ui({users:[brazil]});await flush();const policy=()=>h.all().find(n=>n.type?.name==='AccountLoginPolicy');assert(policy());assert.equal(policy().props.active,true);
 h.active(false);assert(policy());assert.equal(policy().props.active,false);assert.equal(policy().props.target,null);h.active(true);assert.equal(h.calls.filter(c=>c.action==='list').length,1);
 policy().props.onAccessDenied();h.runEffects();await flush();assert.equal(h.rows().length,0);assert(!policy());assert.equal(h.calls.filter(c=>c.action==='list').length,1);h.dispose();
});

test('same-actor write denial still clears the workspace when its tab was hidden',async()=>{
 let reject;const h=ui({users:[brazil],update:()=>new Promise((_,r)=>reject=r)});await flush();h.button('账号设置').props.onClick();
 const request=h.all().find(n=>n.type?.name==='AccountDataScopeEditor').props.onSave({active:false});h.active(false);
 reject(Object.assign(Error('permission revoked'),{status:403}));assert.equal(await request,false);assert.equal(h.denials,1);assert.equal(h.rows().length,0);
 h.active(true);h.runEffects();await flush();assert.equal(h.calls.filter(c=>c.action==='list').length,1);h.dispose();
});
test('an old-actor denied write cannot clear the replacement actor workspace',async()=>{
 let reject;const h=ui({users:[brazil],update:()=>new Promise((_,r)=>reject=r)});await flush();h.button('账号设置').props.onClick();
 const request=h.all().find(n=>n.type?.name==='AccountDataScopeEditor').props.onSave({active:false});h.actor({...owner,auth_user_id:'new-owner'});await flush();
 reject(Object.assign(Error('old permission revoked'),{status:403}));assert.equal(await request,false);assert.equal(h.denials,0);h.dispose();
});

test('a confirmed save cannot swallow a sibling role invalidation that arrived while it was pending',async()=>{
 let finish,phase=false;const pending=[],h=ui({users:[brazil],update:()=>new Promise(r=>finish=r),roles:()=>!phase?{roles:[VIP_ROLE],accounts:[{...brazil,role_id:VIP_ROLE.id,assignment_version:1}]}:new Promise(r=>pending.push(r))});await flush();
 h.button('账号设置').props.onClick();const request=h.all().find(n=>n.type?.name==='AccountDataScopeEditor').props.onSave({active:false});phase=true;h.refresh(1);assert.equal(pending.length,1);
 finish({ok:true,account:{...brazil,active:false}});assert.equal(await request,true);h.runEffects();assert.equal(pending.length,2);
 pending[1]({roles:[{...VIP_ROLE,name:'New role name'}],accounts:[{...brazil,active:false,role_id:VIP_ROLE.id,assignment_version:1}]});await flush();
 pending[0]({roles:[VIP_ROLE],accounts:[{...brazil,role_id:VIP_ROLE.id,assignment_version:1}]});await flush();
 assert.match(text(h.rows()),/New role name/);assert.match(text(h.rows()),/停用/);assert.equal(h.calls.filter(c=>c.action==='list').length,1);h.dispose();
});
