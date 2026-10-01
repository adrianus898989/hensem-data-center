const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),session={user:{id:'owner'},access_token:'token'},flush=()=>new Promise(r=>setImmediate(r));
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.props?.children)]:[];
const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):n==null||typeof n==='boolean'?'':String(n);
function ui(handler){
 const state=[],refs=[],deps=[],effects=[],cleanup=[],calls=[];let i=0,r=0,e=0;const mod={exports:{}};
 const react={useState(v){const k=i++;if(!(k in state))state[k]=typeof v==='function'?v():v;return[state[k],v=>state[k]=typeof v==='function'?v(state[k]):v]},useRef(v){const k=r++;return refs[k]||(refs[k]={current:v})},useEffect(fn,d){const k=e++;if(!deps[k]||d.some((v,j)=>v!==deps[k][j])){deps[k]=d;effects.push(()=>{cleanup[k]?.();cleanup[k]=fn()})}}};
 vm.runInNewContext(compile('src/components/AccountIpAdmin.tsx'),{module:mod,exports:mod.exports,AbortController,Error,require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name.endsWith('/accountSecurityClient'))return{securityRequest:async(s,q,signal)=>{calls.push(q);return handler(q,signal)}};if(name==='./AccountEditorDialog')return{default:function AccountEditorDialog(){}};if(name.endsWith('.css'))return{};throw Error(name)}});
 const h={calls,draw(){i=r=e=0;return mod.exports.default({session})},effects(){effects.splice(0).forEach(f=>f())},button(label){const found=nodes(h.draw()).find(n=>n.type==='button'&&text(n)===label);assert(found,label);return found},field(label){const parent=nodes(h.draw()).find(n=>n.type==='label'&&text(n).startsWith(label));assert(parent,label);return nodes(parent).find(n=>['input','select'].includes(n.type))}};h.draw();h.effects();return h;
}
const caps={view:true,manage_global:true,manage_account:true,manage_policy:true};
const data=surface=>({ok:true,currentIp:'203.0.113.8',capabilities:{...caps},accounts:[{id:'staff',username:'frog001',active:true,ip_mode:'inherit',version:7}],policy:{failure_limit:5,ip_enabled:surface==='dashboard',version:4},rules:[{id:surface==='workorder'?'w':'d',network:surface==='workorder'?'203.0.113.8/32':'2001:db8::/64',note:surface,active:true,version:2,scope:'global',user_id:null,username:null,updated_by:'admin',updated_at:'2026-10-01T08:00:00Z'}]});
test('dashboard starts with a mandatory allowlist and switching surfaces discards stale rules',async()=>{
 let resolveWorkorder;const h=ui(q=>q.surface==='workorder'?new Promise(r=>{resolveWorkorder=r}):Promise.resolve(data(q.surface)));await flush();assert.match(text(h.draw()),/2001:db8::\/64/);
 assert(!nodes(h.draw()).some(n=>n.type==='button'&&['关闭限制','开启限制'].includes(text(n))));
 h.button('前端工单白名单').props.onClick();assert.doesNotMatch(text(h.draw()),/2001:db8::\/64/);assert(!nodes(h.draw()).some(n=>n.type==='button'&&text(n)==='新增 IP'));h.effects();resolveWorkorder(data('workorder'));await flush();assert.match(text(h.draw()),/203.0.113.8\/32/);assert.deepEqual(h.calls.map(q=>q.surface),['dashboard','workorder']);
});
test('late response from the former namespace cannot replace current data',async()=>{
 let old;const h=ui(q=>q.surface==='dashboard'?new Promise(r=>{old=r}):Promise.resolve(data('workorder')));
 h.button('前端工单白名单').props.onClick();h.draw();h.effects();await flush();old(data('dashboard'));await flush();assert.match(text(h.draw()),/203.0.113.8\/32/);assert.doesNotMatch(text(h.draw()),/2001:db8::\/64/);
});
test('read failure never renders a usable disabled-policy toggle or fictitious empty list',async()=>{
 const h=ui(async()=>{throw Error('服务读取失败')});await flush();assert.match(text(h.draw()),/服务读取失败/);assert(!nodes(h.draw()).some(n=>n.type==='button'&&text(n)==='关闭限制'));assert(!nodes(h.draw()).some(n=>n.type==='button'&&text(n)==='新增 IP'));assert.doesNotMatch(text(h.draw()),/尚未添加 IP 规则|未开启白名单/);
});
test('editing sends exact namespace/version and a conflict retains the reviewable draft without retry',async()=>{
 const h=ui(async q=>{if(q.action==='list-rules')return data(q.surface);throw Error('版本冲突，请刷新')});await flush();h.button('编辑').props.onClick();h.field('备注').props.onChange({target:{value:'办公室'}});
 const form=nodes(h.draw()).filter(n=>n.type==='form').at(-1);form.props.onSubmit({preventDefault(){}});await flush();
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[1])),{action:'upsert-ip-rule',network:'2001:db8::/64',note:'办公室',active:true,scope:'global',id:'d',expected_version:2,surface:'dashboard'});assert.match(text(h.draw()),/版本冲突/);assert.equal(h.field('备注').props.value,'办公室');assert.equal(h.calls.length,2);
});
test('enabling rules requires explicit review and keeps policy version',async()=>{
 const h=ui(async q=>q.action==='list-rules'?data(q.surface):{ok:true});await flush();h.button('前端工单白名单').props.onClick();h.draw();h.effects();await flush();h.button('开启限制').props.onClick();assert.equal(h.calls.length,2);assert.match(text(h.draw()),/仅允许启用规则内的 IP/);h.button('确认').props.onClick();await flush();assert.deepEqual(JSON.parse(JSON.stringify(h.calls[2])),{action:'policy',patch:{ip_enabled:true},expected_version:4,surface:'workorder'});
});

test('invalid backend mode, malformed rules and policy versions fail closed',async()=>{
 for(const patch of [{policy:{failure_limit:5,ip_enabled:false,version:4}},{policy:{failure_limit:5,ip_enabled:true,version:'4'}},{rules:[{...data('dashboard').rules[0],active:'true'}]}]){
 const h=ui(async()=>({...data('dashboard'),...patch}));await flush();assert.match(text(h.draw()),/返回不完整/);assert(!nodes(h.draw()).some(n=>n.type==='button'&&text(n)==='新增 IP'));assert.doesNotMatch(text(h.draw()),/未开启白名单/);
 }
});

const accountRule=(patch={})=>({id:'account-rule',network:'198.51.100.20/32',note:'会员专属办公室',active:true,version:7,scope:'account',user_id:'staff',username:'frog001',ip_mode:'allowlist',updated_by:'security-admin',updated_at:'2026-10-01T09:30:00Z',...patch});
test('one list shows global and account IPs, preserves attribution and filters by account/status',async()=>{
 const h=ui(async()=>({...data('dashboard'),rules:[...data('dashboard').rules,accountRule(),accountRule({id:'disabled',network:'198.51.100.21/32',active:false})]}));await flush();
 assert.match(text(h.draw()),/不限账号/);assert.match(text(h.draw()),/frog001独立白名单/);assert.match(text(h.draw()),/security-admin/);assert.match(text(h.draw()),/修改时间/);
 h.field('账号').props.onChange({target:{value:'frog001'}});h.field('状态').props.onChange({target:{value:'active'}});nodes(h.draw()).find(n=>n.type==='form'&&n.props.className==='account-ip-toolbar').props.onSubmit({preventDefault(){}});
 assert.match(text(h.draw()),/198.51.100.20/);assert.doesNotMatch(text(h.draw()),/198.51.100.21|2001:db8/);assert.match(text(h.draw()),/共 1 条/);h.button('重置').props.onClick();assert.match(text(h.draw()),/198.51.100.21|2001:db8/);
});
test('new global IP omits the account, while a bound IP uses that account version and explains exclusive login',async()=>{
 for(const bound of [false,true]){
 const h=ui(async q=>q.action==='list-rules'?data(q.surface):{ok:true});await flush();h.button('新增 IP').props.onClick();h.field('IP / CIDR').props.onChange({target:{value:'198.51.100.8'}});if(bound)h.field('绑定账号').props.onChange({target:{value:'staff'}});
 assert.match(text(h.draw()),bound?/全局不限账号规则不替代账号限制/:/登录仍需有效账号及权限/);
 nodes(h.draw()).filter(n=>n.type==='form').at(-1).props.onSubmit({preventDefault(){}});await flush();
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1))),bound?{action:'upsert-ip-rule',surface:'dashboard',scope:'account',user_id:'staff',expected_version:7,network:'198.51.100.8',note:'',active:true}:{action:'upsert-ip-rule',surface:'dashboard',scope:'global',network:'198.51.100.8',note:'',active:true});
 }
});
test('an account-scoped edit and delete retain the exact account/version and do not transfer a rule',async()=>{
 const h=ui(async q=>q.action==='list-rules'?{...data('dashboard'),rules:[accountRule()]}:{ok:true});await flush();h.button('编辑').props.onClick();assert.equal(h.field('绑定账号').props.disabled,true);
 h.field('绑定账号').props.onChange({target:{value:''}});nodes(h.draw()).filter(n=>n.type==='form').at(-1).props.onSubmit({preventDefault(){}});await flush();assert.equal(h.calls.length,1);assert.match(text(h.draw()),/不能更换绑定账号/);
 h.field('绑定账号').props.onChange({target:{value:'staff'}});h.field('备注').props.onChange({target:{value:' 新办公室 '}});nodes(h.draw()).filter(n=>n.type==='form').at(-1).props.onSubmit({preventDefault(){}});await flush();assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1))),{action:'upsert-ip-rule',network:'198.51.100.20/32',note:'新办公室',active:true,scope:'account',user_id:'staff',id:'account-rule',expected_version:7,surface:'dashboard'});
 h.draw();h.effects();await flush();h.button('删除').props.onClick();assert.equal(h.calls.length,3,'delete opens a review first');h.button('确认').props.onClick();await flush();assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1))),{action:'delete-ip-rule',scope:'account',user_id:'staff',id:'account-rule',expected_version:7,surface:'dashboard'});
});
test('read-only and account-only delegates use server capabilities and cannot create a global rule',async()=>{
 const readonly=ui(async()=>({...data('dashboard'),capabilities:{view:true,manage_global:false,manage_account:false,manage_policy:false}}));await flush();assert.match(text(readonly.draw()),/只读/);assert(!nodes(readonly.draw()).some(n=>n.type==='button'&&['新增 IP','编辑','删除'].includes(text(n))));
 const accountOnly=ui(async q=>q.action==='list-rules'?{...data('dashboard'),capabilities:{view:true,manage_global:false,manage_account:true,manage_policy:false}}:{ok:true});await flush();accountOnly.button('新增 IP').props.onClick();assert.equal(accountOnly.field('绑定账号').props.value,'staff');const global=nodes(accountOnly.field('绑定账号')).find(n=>n.type==='option'&&n.props.value==='');assert.equal(global.props.disabled,true);
 accountOnly.field('IP / CIDR').props.onChange({target:{value:'198.51.100.8'}});accountOnly.field('绑定账号').props.onChange({target:{value:''}});nodes(accountOnly.draw()).filter(n=>n.type==='form').at(-1).props.onSubmit({preventDefault(){}});await flush();assert.equal(accountOnly.calls.length,1);assert.match(text(accountOnly.draw()),/无权修改/);
});
test('malformed attribution or missing capabilities cannot expose an editable list',async()=>{
 for(const patch of [{capabilities:undefined},{capabilities:{...caps,manage_account:'true'}},{accounts:[{...data('dashboard').accounts[0],version:'7'}]},{rules:[accountRule({user_id:null})]},{rules:[accountRule({updated_at:undefined})]}]){
 const h=ui(async()=>({...data('dashboard'),...patch}));await flush();assert.match(text(h.draw()),/返回不完整/);assert(!nodes(h.draw()).some(n=>n.type==='button'&&text(n)==='新增 IP'));assert.doesNotMatch(text(h.draw()),/会员专属办公室/);
 }
});

test('pagination preserves narrow searches and page size changes never hide the only matching row',async()=>{
 const records=Array.from({length:26},(_,i)=>({...data('dashboard').rules[0],id:'ip-'+i,network:'203.0.113.'+(i+1)+'/32',note:i===25?'最后一条':''}));const h=ui(async()=>({...data('dashboard'),rules:records}));await flush();assert.match(text(h.draw()),/共 26 条/);assert.doesNotMatch(text(h.draw()),/203.0.113.26\/32/);h.button('下一页').props.onClick();assert.match(text(h.draw()),/203.0.113.26\/32/);
 h.field('IP / 备注').props.onChange({target:{value:'最后一条'}});nodes(h.draw()).find(n=>n.type==='form'&&n.props.className==='account-ip-toolbar').props.onSubmit({preventDefault(){}});assert.match(text(h.draw()),/共 1 条/);assert.match(text(h.draw()),/203.0.113.26\/32/);assert.equal(h.button('下一页').props.disabled,true);h.field('每页').props.onChange({target:{value:'10'}});assert.match(text(h.draw()),/203.0.113.26\/32/);
});
