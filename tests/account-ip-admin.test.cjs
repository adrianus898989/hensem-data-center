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
const data=surface=>({ok:true,currentIp:'203.0.113.8',policy:{failure_limit:5,ip_enabled:false,version:4},rules:[{id:surface==='workorder'?'w':'d',network:surface==='workorder'?'203.0.113.8/32':'2001:db8::/64',note:surface,active:true,version:2}]});
test('front/backend IP rules use independent namespaces and never reuse stale rules while loading',async()=>{
 let resolveDashboard;const h=ui(q=>q.surface==='dashboard'?new Promise(r=>{resolveDashboard=r}):Promise.resolve(data(q.surface)));await flush();assert.match(text(h.draw()),/203.0.113.8\/32/);
 h.button('后台白名单').props.onClick();assert.doesNotMatch(text(h.draw()),/203.0.113.8\/32/);assert.equal(h.button('新增 IP').props.disabled,true);h.effects();assert.doesNotMatch(text(h.draw()),/203.0.113.8\/32/);assert.equal(h.button('新增 IP').props.disabled,true);
 resolveDashboard(data('dashboard'));await flush();assert.match(text(h.draw()),/2001:db8::\/64/);assert.deepEqual(h.calls.map(q=>q.surface),['workorder','dashboard']);
});
test('late request from former namespace cannot replace current data',async()=>{
 let old;const h=ui(q=>q.surface==='workorder'?new Promise(r=>{old=r}):Promise.resolve(data('dashboard')));
 h.button('后台白名单').props.onClick();h.draw();h.effects();await flush();old(data('workorder'));await flush();assert.match(text(h.draw()),/2001:db8::\/64/);assert.doesNotMatch(text(h.draw()),/203.0.113.8\/32/);
});
test('read failure never renders a usable disabled-policy toggle or fictitious empty list',async()=>{
 const h=ui(async()=>{throw Error('服务读取失败')});await flush();assert.match(text(h.draw()),/服务读取失败/);assert.equal(h.button('开启限制').props.disabled,true);assert.equal(h.button('新增 IP').props.disabled,true);assert.doesNotMatch(text(h.draw()),/尚未添加 IP 规则|未开启白名单/);
});
test('editing sends exact namespace/version and a conflict retains the reviewable draft without retry',async()=>{
 const h=ui(async q=>{if(q.action==='list-rules')return data(q.surface);throw Error('版本冲突，请刷新')});await flush();h.button('编辑').props.onClick();h.field('备注').props.onChange({target:{value:'办公室'}});
 const form=nodes(h.draw()).find(n=>n.type==='form');form.props.onSubmit({preventDefault(){}});await flush();
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[1])),{action:'upsert-rule',network:'203.0.113.8/32',note:'办公室',id:'w',expected_version:2,surface:'workorder'});assert.match(text(h.draw()),/版本冲突/);assert.equal(h.field('备注').props.value,'办公室');assert.equal(h.calls.length,2);
});
test('enabling rules requires explicit review and keeps policy version',async()=>{
 const h=ui(async q=>q.action==='list-rules'?data(q.surface):{ok:true});await flush();h.button('开启限制').props.onClick();assert.equal(h.calls.length,1);assert.match(text(h.draw()),/仅允许启用规则内的 IP/);h.button('确认').props.onClick();await flush();assert.deepEqual(JSON.parse(JSON.stringify(h.calls[1])),{action:'policy',patch:{ip_enabled:true},expected_version:4,surface:'workorder'});
});
