const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {root,loadTs}=require('./load-typescript.cjs');
const auth=loadTs(path.join(root,'src/lib/dashboardAuthClient.ts'));
const session={user:{id:'fixture-owner'},access_token:'fixture-only'};
const ALL={mode:'all',countries:[]},BR={mode:'selected',countries:['BR_PANGHU']},IN={mode:'selected',countries:['IN']};
const owner={auth_user_id:'fixture-owner',username:'owner-fixture',role:'owner',active:true,data_scope:ALL};
const brazil={auth_user_id:'fixture-br',username:'brazil-fixture',role:'viewer',active:true,data_scope:BR};
const india={auth_user_id:'fixture-in',username:'india-fixture',role:'admin',active:false,data_scope:IN};
const plain=x=>JSON.parse(JSON.stringify(x)),flush=()=>new Promise(r=>setImmediate(r));
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
const text=x=>Array.isArray(x)?x.map(text).join(''):x&&typeof x==='object'?text(x.props?.children):x==null||typeof x==='boolean'?'':String(x);
function ui(options={}){
 let cursor=0,ecursor=0;const states=[],deps=[],effects=[],cleanups=[],calls=[],mod={exports:{}};let actor=options.actor||owner,currentSession={...session,user:{id:actor.auth_user_id}},roleAccess=options.roleAccess;
 const react={Fragment:'fragment',useMemo:fn=>fn(),useRef(initial){const i=cursor++;return states[i]||(states[i]={current:initial})},useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v}]},useEffect(fn,values){const i=ecursor++;if(!deps[i]||values.some((v,k)=>v!==deps[i][k])){deps[i]=values;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn()})}}};
 const output=ts.transpileModule(fs.readFileSync(path.join(root,'src/components/AdminControlCenter.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(output,{module:mod,exports:mod.exports,console,Error,window:{confirm:()=>true},require:name=>{
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(name.endsWith('.css'))return{};
  if(name==='./AccountEditorDialog')return{default:function AccountEditorDialog(){}};
  if(name==='./AccountRoleEditor')return{default:function AccountRoleEditor(){}};
  if(name==='./AccountPermissionDialog')return{default:function AccountPermissionDialog(){}};
  if(name.endsWith('/dashboardAuthClient'))return{...auth,listDashboardUsers:async()=>{calls.push({action:'list'});return options.list?options.list():options.users||[owner,brazil,india]},listDashboardAudit:async()=>{calls.push({action:'audit'});return[]},createDashboardAccount:async(...args)=>{calls.push({action:'create',args:plain(args)});return options.create?options.create(...args):{role:args[3],username:args[1]}},updateDashboardAccount:async(...args)=>{calls.push({action:'update',args:plain(args)});if(options.update)return options.update(...args)},resetDashboardUserPassword:async(...args)=>calls.push({action:'password',args:plain(args)})};
  if(name.startsWith('@/lib/'))return loadTs(path.join(root,'src/lib',name.slice(6)+'.ts'));
  throw Error('Unexpected module: '+name);
 }});
 const draw=()=>{cursor=ecursor=0;return mod.exports.default({open:true,session:currentSession,profile:actor,onClose(){},section:'accounts',embedded:true,accountsOnlyLoading:true,manualQuery:options.manualQuery,roleAccess})};
 const all=()=>nodes(draw());
 const button=(label,within)=>{const node=nodes(within||draw()).find(n=>n.type==='button'&&text(n)===label);assert(node,'button '+label);return node};
 const field=(label)=>{const wrap=all().find(n=>n.type==='div'&&n.props.className?.includes('admin-search-field')&&nodes(n).some(c=>c.type==='label'&&text(c)===label));assert(wrap,'filter '+label);return nodes(wrap).find(n=>['select','input'].includes(n.type))};
 const dialog=()=>all().find(n=>n.type?.name==='AccountEditorDialog');
 const rows=()=>all().filter(n=>n.type==='tr'&&nodes(n).some(c=>c.type==='th'&&c.props.scope==='row'));
 draw();effects.splice(0).forEach(fn=>fn());
 return{draw,all,button,field,dialog,rows,calls,states,dispose:()=>cleanups.forEach(fn=>fn?.()),role(next){roleAccess=next;draw();effects.splice(0).forEach(fn=>fn())},actor(next){actor=next;currentSession={...session,user:{id:next.auth_user_id}};draw();effects.splice(0).forEach(fn=>fn())}};
}

test('data scope, role, status and text filters intersect locally; reset restores the authorized directory without IO',async()=>{
 const h=ui();await flush();assert.equal(h.rows().length,3);const reads=h.calls.length;
 for(const [label,name] of [["搜索账号","后台账号搜索"],["角色","后台账号角色筛选"],["数据范围","后台账号数据范围筛选"],["状态","后台账号状态筛选"]])assert.equal(h.field(label).props["aria-label"],name);
 h.field('数据范围').props.onChange({target:{value:'BR_PANGHU'}});assert.deepEqual(h.rows().map(text).map(t=>/brazil-fixture/.test(t)?'BR':'OWNER').sort(),['BR','OWNER']);
 h.field('角色').props.onChange({target:{value:'viewer'}});assert.equal(h.rows().length,1);assert.match(text(h.rows()),/brazil-fixture/);
 h.field('状态').props.onChange({target:{value:'disabled'}});assert.equal(h.rows().length,0);
 h.field('搜索账号').props.onChange({target:{value:'no-match'}});h.button('重置筛选').props.onClick();assert.equal(h.rows().length,3);assert.equal(h.field('搜索账号').props.value,'');assert.equal(h.field('数据范围').props.value,'all');assert.equal(h.calls.length,reads);
 assert(!h.all().some(n=>n.type==='option'&&n.props.value==='locked'),'does not include unreleased login-security UI');
});

test('create opens a modal; cancel clears credentials and scope draft with no writes',async()=>{
 const h=ui();await flush();h.button('+ 新建账号').props.onClick();let d=h.dialog();assert.equal(d.props.title,'新建后台账号');
 h.all().find(n=>n.props.id==='admin-new-username').props.onChange({target:{value:'draft'}});h.all().find(n=>n.props.id==='admin-new-password').props.onChange({target:{value:'fixture-password'}});
 h.all().find(n=>n.type?.name==='DataScopePicker').props.onChange(BR);h.dialog().props.onClose();assert(!h.dialog());assert(!JSON.stringify(h.states).includes('fixture-password'));assert(!h.calls.some(c=>c.action==='create'));
 h.button('+ 新建账号').props.onClick();assert.equal(h.all().find(n=>n.props.id==='admin-new-username').props.value,'');assert.deepEqual(plain(h.all().find(n=>n.type?.name==='DataScopePicker').props.value),ALL);
});

test('create retains the old API argument contract and blocks dismissal or duplicate submit while busy',async()=>{
 let resolve;const h=ui({create:()=>new Promise(r=>{resolve=r})});await flush();h.button('+ 新建账号').props.onClick();
 h.all().find(n=>n.props.id==='admin-new-username').props.onChange({target:{value:'new-fixture'}});h.all().find(n=>n.props.id==='admin-new-password').props.onChange({target:{value:'fixture-password'}});h.all().find(n=>n.type?.name==='DataScopePicker').props.onChange(BR);
 const pending=nodes(h.dialog()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 assert.equal(h.dialog().props.busy,true);assert(h.all().some(n=>n.type==='fieldset'&&n.props.disabled));h.dialog().props.onClose();assert(h.dialog());
 await nodes(h.dialog()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(h.calls.filter(c=>c.action==='create').length,1);
 const args=h.calls.find(c=>c.action==='create').args;assert.equal(args.length,7);assert.deepEqual(args.slice(0,4),[session,'new-fixture','fixture-password','viewer']);assert.deepEqual(args[6],BR);
 resolve({role:'viewer',username:'new-fixture'});await pending;assert(!h.dialog());assert(!JSON.stringify(h.states).includes('fixture-password'));
});

test('creation error is visible inside the dialog and preserves the draft for correction',async()=>{
 const h=ui({create:()=>{throw Error('账号已存在')}});await flush();h.button('+ 新建账号').props.onClick();h.all().find(n=>n.props.id==='admin-new-username').props.onChange({target:{value:'duplicate'}});
 await nodes(h.dialog()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert(h.dialog());assert.match(text(h.dialog()),/账号已存在/);assert.equal(h.all().find(n=>n.props.id==='admin-new-username').props.value,'duplicate');
});

test('existing editable account opens the same modal without an inline table row or implicit mutation',async()=>{
 const h=ui();await flush();const row=h.rows().find(n=>text(n).includes('brazil-fixture'));h.button('账号设置',row).props.onClick();assert.equal(h.dialog().props.title,'后台账号设置 · brazil-fixture');assert.equal(h.all().filter(n=>n.props?.className==='admin-account-editor-row').length,0);assert(!h.calls.some(c=>['create','update','password'].includes(c.action)));
 const editor=h.all().find(n=>n.type?.name==='AccountDataScopeEditor');await editor.props.onSave({data_scope:BR});assert.deepEqual(h.calls.find(c=>c.action==='update').args,[session,'brazil-fixture',{data_scope:BR}]);assert.match(text(h.dialog()),/已更新/);h.dialog().props.onClose();assert(!h.dialog());
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
 h.button('查询账号').props.onClick();resolve([brazil]);await flush();h.field('搜索账号').props.onChange({target:{value:'other'}});assert.match(text(h.draw()),/显示 0 \/ 1 个账号/);assert.match(text(h.draw()),/没有符合当前搜索条件/);
});

test('directory read failures show an error, clear stale rows and never report them as zero',async()=>{
 let fail=false;const h=ui({manualQuery:true,list:async()=>{if(fail)throw Error('fixture read failure');return[brazil]}});
 h.button('查询账号').props.onClick();await flush();assert.equal(h.rows().length,1);
 fail=true;h.button('查询账号').props.onClick();await flush();assert.equal(h.rows().length,0);assert.match(text(h.draw()),/账号读取失败/);assert.match(text(h.draw()),/fixture read failure/);assert.doesNotMatch(text(h.draw()),/显示 0|brazil-fixture|没有符合当前搜索|当前可管理范围内没有/);
 fail=false;h.button('查询账号').props.onClick();await flush();assert.equal(h.rows().length,1);assert.doesNotMatch(text(h.draw()),/fixture read failure/);
});

test('account or scope changes invalidate old directory responses and require another manual query',async()=>{
 const resolves=[];const h=ui({manualQuery:true,list:()=>new Promise(r=>resolves.push(r))});
 h.button('查询账号').props.onClick();h.actor({...owner,role:'admin',auth_user_id:'fixture-second',username:'second'});resolves.shift()([brazil]);await flush();assert.equal(h.rows().length,0);assert.match(text(h.draw()),/尚未查询账号/);assert.equal(h.calls.length,1);
 h.button('查询账号').props.onClick();resolves.shift()([india]);await flush();assert.equal(h.rows().length,1);
 h.actor({...owner,role:'admin',auth_user_id:'fixture-second',username:'second',data_scope:IN});assert.equal(h.rows().length,0);assert.match(text(h.draw()),/尚未查询账号/);assert.equal(h.calls.length,2);
});

test('a late older query cannot replace a newer successful directory',async()=>{
 const resolves=[];const h=ui({manualQuery:true,list:()=>new Promise(r=>resolves.push(r))});const query=h.button('查询账号').props.onClick;query();query();resolves[1]([india]);await flush();resolves[0]([brazil]);await flush();assert.match(text(h.rows()),/india-fixture/);assert.doesNotMatch(text(h.rows()),/brazil-fixture/);
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
