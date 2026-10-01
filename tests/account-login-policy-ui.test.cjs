const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const repo=path.resolve(__dirname,'..'),ts=require(path.join(repo,'node_modules/typescript'));
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(repo,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const plain=value=>JSON.parse(JSON.stringify(value)),flush=()=>new Promise(r=>setImmediate(r));
const session={user:{id:'owner-id'},access_token:'synthetic-token'};
const capabilities={manage_policy:true,manage_ip:true,manage_account_policy:true,unlock:true};
const security={failed_count:5,failure_limit:null,locked:true,locked_at:'2026-09-27T01:00:00Z',version:3,ip_mode:'inherit',ip_rules:[]};
const target={id:'staff-id',username:'staff',active:false};
function nodes(node){if(Array.isArray(node))return node.flatMap(nodes);return node&&typeof node==='object'?[node,...nodes(node.props?.children)]:[]}
function text(node){if(Array.isArray(node))return node.map(text).join('');if(node&&typeof node==='object')return text(node.props?.children);return node==null||typeof node==='boolean'?'':String(node)}
function ui(handler,initial={}){
 const states=[],refs=[],deps=[],cleanups=[],effects=[],calls=[],snapshots=[];let i=0,r=0,e=0;
 let props={session,surface:'workorder',onSnapshot:s=>snapshots.push(plain(s)),onClose(){},...initial};
 const mod={exports:{}},react={useState(initial){const key=i++;if(!(key in states))states[key]=typeof initial==='function'?initial():initial;return[states[key],value=>states[key]=typeof value==='function'?value(states[key]):value]},useRef(initial){const key=r++;return refs[key]||(refs[key]={current:initial})},useEffect(fn,values){const key=e++;if(!deps[key]||values.some((v,n)=>v!==deps[key][n])){deps[key]=values;effects.push(()=>{cleanups[key]?.();cleanups[key]=fn()})}}};
 vm.runInNewContext(compile('src/components/AccountLoginPolicy.tsx'),{module:mod,exports:mod.exports,AbortController,Error,window:{confirm:()=>true},require:name=>{
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(name==='./AccountEditorDialog')return{default:function AccountEditorDialog(){}};
  if(name.endsWith('/accountSecurityClient'))return{securityRequest:async(s,q,signal)=>{calls.push({session:s,request:plain(q),signal});if(handler){const result=await handler(q,signal);return {...result,capabilities:Object.hasOwn(result,'capabilities')?result.capabilities:{...capabilities}};}if(q.action==='policy')return{ok:true,capabilities:{...capabilities},policy:{failure_limit:5,ip_enabled:false,version:1}};if(q.action==='list-account-security')return{ok:true,capabilities:{...capabilities},states:[{user_id:target.id,...security}]};return{ok:true,capabilities:{...capabilities},security}}};
  if(name.endsWith('.css'))return{};throw Error(name);
 }});
 const draw=()=>{i=r=e=0;return mod.exports.default(props)};
 const runEffects=()=>effects.splice(0).forEach(fn=>fn());
 draw();runEffects();
 return{calls,snapshots,draw,runEffects,setProps(patch){props={...props,...patch};draw();runEffects()},unmount(){cleanups.forEach(fn=>fn?.())},button(label){const n=nodes(draw()).find(n=>n.type==='button'&&text(n)===label);assert(n,'button '+label);return n},select(label){const n=nodes(draw()).find(n=>n.type==='label'&&text(n).startsWith(label));assert(n,'label '+label);return nodes(n).find(n=>n.type==='select')},input(label){const n=nodes(draw()).find(n=>n.type==='input'&&n.props['aria-label']===label);assert(n,'input '+label);return n},form(){return nodes(draw()).find(n=>n.type==='form')}};
}
test('two batched reads fill one namespace without one request per account or invented initial threshold',async()=>{
 const h=ui();assert.equal(h.select('默认阈值').props.value,'');assert.equal(h.select('默认阈值').props.disabled,true);assert.match(text(h.draw()),/读取中/);assert.equal(h.calls.length,2);assert.deepEqual(h.calls.map(c=>c.request),[{action:'policy',surface:'workorder'},{action:'list-account-security',surface:'workorder'}]);
 await flush();assert.equal(h.select('默认阈值').props.value,'5');assert.deepEqual(h.snapshots.at(-1),{status:'ready',failureLimit:5,states:{[target.id]:security}});assert(!nodes(h.draw()).some(n=>n.type?.name==='AccountEditorDialog'));
 h.setProps({target});await flush();assert.equal(h.calls.length,3);assert.deepEqual(h.calls[2].request,{action:'account-security',surface:'workorder',user_id:target.id});assert.match(text(h.draw()),/手动状态：停用.*解除自动锁定不会启用此账号/);
 const dashboard=ui(null,{surface:'dashboard'});await flush();assert(dashboard.calls.every(c=>c.request.surface==='dashboard'));assert.match(text(dashboard.draw()),/后台登录失败限制/);
});
test('changing the default threshold includes its optimistic version and updates inherited list state only after acknowledgement',async()=>{
 const h=ui(async q=>{if(q.action==='list-account-security')return{ok:true,capabilities:{...capabilities},states:[{user_id:target.id,...security}]};return{ok:true,policy:{failure_limit:q.patch?.failure_limit??5,version:q.patch?2:1}}});await flush();h.select('默认阈值').props.onChange({target:{value:'7'}});await h.form().props.onSubmit({preventDefault(){}});
 assert.deepEqual(h.calls.at(-1).request,{action:'policy',surface:'workorder',patch:{failure_limit:7},expected_version:1});assert.equal(h.snapshots.at(-1).failureLimit,7);assert.equal(h.snapshots.at(-1).states[target.id].failure_limit,null);assert.match(text(h.draw()),/默认失败阈值已保存/);assert.equal(h.calls.length,3);
});
test('per-account overrides and unlock use the returned version and never turn a manually disabled account on',async()=>{
 let current={...security};const h=ui(async q=>{if(q.action==='policy')return{ok:true,policy:{failure_limit:5,version:1}};if(q.action==='list-account-security')return{ok:true,states:[{user_id:target.id,...current}]};if(q.action==='set-account-policy')current={...current,failure_limit:q.failure_limit,version:current.version+1};if(q.action==='unlock-account')current={...current,failed_count:0,locked:false,locked_at:null,version:current.version+1};return{ok:true,security:{...current}}},{target});await flush();
 h.select('该账号失败阈值').props.onChange({target:{value:'8'}});await h.button('保存账号阈值').props.onClick();assert.deepEqual(h.calls.at(-1).request,{action:'set-account-policy',surface:'workorder',user_id:target.id,failure_limit:8,expected_version:3});
 await flush();await h.button('解除自动锁定').props.onClick();await flush();assert.deepEqual(h.calls.at(-1).request,{action:'unlock-account',surface:'workorder',user_id:target.id,expected_version:4});assert(!Object.hasOwn(h.calls.at(-1).request,'active'));assert.match(text(h.draw()),/手动状态：停用/);assert.match(text(h.draw()),/自动锁定与失败次数已清除；手动启停状态不变/);assert.equal(h.snapshots.at(-1).states[target.id].locked,false);assert.equal(h.snapshots.at(-1).states[target.id].failed_count,0);
 h.select('该账号失败阈值').props.onChange({target:{value:'inherit'}});await h.button('保存账号阈值').props.onClick();await flush();assert.equal(h.calls.at(-1).request.failure_limit,null);assert.equal(h.calls.at(-1).request.expected_version,5);assert.equal(h.calls.length,6,'no per-row refresh or write retry');
});
test('read failure or malformed safety state remains unknown, never a zero-failure or unlocked success',async()=>{
 for(const malformed of [null,{...security,failed_count:-1},{...security,version:'3'},{...security,failure_limit:21}]){
  const h=ui(async q=>q.action==='policy'?{ok:true,policy:{failure_limit:5,version:1}}:q.action==='list-account-security'?{ok:true,states:[{user_id:target.id,...malformed}]}:{ok:true,security:malformed},{target});await flush();
  assert.equal(h.snapshots.at(-1).status,'error');assert.deepEqual(h.snapshots.at(-1).states,{});assert.match(text(h.draw()),/返回不完整/);assert.doesNotMatch(text(h.draw()),/连续失败0 次|自动锁定未锁定/);assert(!nodes(h.draw()).some(n=>n.type==='button'&&text(n)==='保存账号阈值'));
 }
 const failed=ui(async()=>{throw Error('无权读取安全状态')});await flush();assert.equal(failed.snapshots.at(-1).status,'error');assert.equal(failed.select('默认阈值').props.value,'');assert.equal(failed.select('默认阈值').props.disabled,true);assert.match(text(failed.draw()),/无权读取安全状态/);assert.equal(failed.calls.length,2);
});
test('switching accounts aborts stale reads and prevents another account state from replacing the visible target',async()=>{
 const pending=new Map();const h=ui(async(q,signal)=>q.action==='account-security'?new Promise(resolve=>pending.set(q.user_id,{resolve,signal})):q.action==='policy'?{ok:true,policy:{failure_limit:5,version:1}}:{ok:true,states:[]},{target});await flush();
 h.setProps({target:{id:'second-id',username:'second',active:true}});assert.equal(pending.get(target.id).signal.aborted,true);pending.get('second-id').resolve({ok:true,security:{...security,failed_count:2,locked:false,version:7}});await flush();pending.get(target.id).resolve({ok:true,security:{...security,failed_count:99}});await flush();
 assert.match(text(h.draw()),/连续失败2 次/);assert.doesNotMatch(text(h.draw()),/99 次/);assert.equal(h.snapshots.at(-1).states['second-id'].version,7);assert(!h.snapshots.at(-1).states[target.id]);h.unmount();assert(h.calls.every(c=>c.signal?.aborted));
});
test('version conflicts preserve both drafts and require explicit retry instead of repeating writes',async()=>{
 const h=ui(async q=>{if(q.patch||q.action==='set-account-policy'||q.action==='unlock-account')throw Error('设置已被其他管理员修改，请重新读取');return q.action==='policy'?{ok:true,policy:{failure_limit:5,version:1}}:q.action==='list-account-security'?{ok:true,states:[{user_id:target.id,...security}]}:{ok:true,security}},{target});await flush();
 h.select('默认阈值').props.onChange({target:{value:'9'}});await h.form().props.onSubmit({preventDefault(){}});assert.equal(h.select('默认阈值').props.value,'9');assert.equal(h.snapshots.at(-1).failureLimit,5);h.select('该账号失败阈值').props.onChange({target:{value:'10'}});await h.button('保存账号阈值').props.onClick();await flush();assert.equal(h.select('该账号失败阈值').props.value,'10');assert.equal(h.snapshots.at(-1).states[target.id].version,3);assert.match(text(h.draw()),/其他管理员修改/);assert.equal(h.calls.length,5);
});

test('account IP mode and rules use the account optimistic version and preserve edits on conflict',async()=>{
 let current={...security,ip_rules:[{id:'rule-one',network:'203.0.113.8/32',note:'Office',active:true}]};let conflict=false;
 const h=ui(async q=>{
  if(q.action==='policy')return{ok:true,policy:{failure_limit:5,version:1}};
  if(q.action==='list-account-security')return{ok:true,states:[{user_id:target.id,...current}]};
  if(q.action==='account-security')return{ok:true,currentIp:'203.0.113.8',security:{...current}};
  if(conflict)throw Error('版本冲突，请重新读取');
  if(q.action==='set-account-ip-mode')current={...current,ip_mode:q.ip_mode,version:current.version+1};
  if(q.action==='upsert-account-ip-rule')current={...current,ip_rules:[{id:'rule-one',network:q.network,note:q.note,active:q.active}],version:current.version+1};
  if(q.action==='set-account-ip-rule-active')current={...current,ip_rules:current.ip_rules.map(r=>({...r,active:q.active})),version:current.version+1};
  if(q.action==='delete-account-ip-rule')current={...current,ip_rules:[],version:current.version+1};
  return{ok:true,security:{...current}};
 },{target});await flush();
 h.select('账号 IP 模式').props.onChange({target:{value:'allowlist'}});h.button('保存 IP 模式').props.onClick();await flush();
 assert.deepEqual(h.calls.at(-1).request,{action:'set-account-ip-mode',surface:'workorder',user_id:target.id,ip_mode:'allowlist',expected_version:3});
 h.button('编辑').props.onClick();h.input('账号 IP 备注').props.onChange({target:{value:' Home '}});
 const submit=()=>nodes(h.draw()).find(n=>n.type==='form'&&n.props.className==='account-ip-editor').props.onSubmit({preventDefault(){}});
 submit();await flush();assert.deepEqual(h.calls.at(-1).request,{action:'upsert-account-ip-rule',surface:'workorder',user_id:target.id,id:'rule-one',network:'203.0.113.8/32',note:'Home',active:true,expected_version:4});
 h.button('停用').props.onClick();await flush();assert.equal(h.calls.at(-1).request.expected_version,5);assert.equal(h.calls.at(-1).request.action,'set-account-ip-rule-active');
 h.button('编辑').props.onClick();h.input('账号 IP / CIDR').props.onChange({target:{value:'203.0.113.0/24'}});conflict=true;submit();await flush();
 assert.equal(h.input('账号 IP / CIDR').props.value,'203.0.113.0/24');assert.equal(h.snapshots.at(-1).states[target.id].version,6);assert.match(text(h.draw()),/版本冲突/);
 conflict=false;h.button('删除').props.onClick();await flush();assert.deepEqual(h.calls.at(-1).request,{action:'delete-account-ip-rule',surface:'workorder',user_id:target.id,id:'rule-one',expected_version:6});
 assert.equal(h.snapshots.at(-1).states[target.id].ip_rules.length,0);
});
test('incomplete per-account IP data never enables mutations or pretends IP protection is disabled',async()=>{
 for(const ipFields of [{ip_mode:undefined,ip_rules:undefined},{ip_mode:'off',ip_rules:[]},{ip_mode:'inherit',ip_rules:[{id:'r',network:'x',note:'',active:'true'}]}]){
 const h=ui(async q=>q.action==='policy'?{ok:true,policy:{failure_limit:5,version:1}}:q.action==='list-account-security'?{ok:true,states:[]}:{ok:true,security:{...security,...ipFields}},{target});await flush();
 assert.match(text(h.draw()),/IP.*返回不完整/);assert(!nodes(h.draw()).some(n=>n.type==='button'&&text(n)==='保存 IP 模式'));
 }
});

test('missing or read-only server capabilities never allow a threshold, unlock or IP write',async()=>{
 for(const returned of [undefined,{manage_policy:false,manage_ip:false,manage_account_policy:false,unlock:false}]){
 const h=ui(async q=>q.action==='policy'?{ok:true,capabilities:returned,policy:{failure_limit:5,version:1}}:q.action==='list-account-security'?{ok:true,capabilities:returned,states:[{user_id:target.id,...security}]}:{ok:true,capabilities:returned,security},{target});await flush();
 for(const label of ['保存阈值','保存账号阈值','解除自动锁定','保存 IP 模式'])assert.equal(h.button(label).props.disabled,true,label);
 h.select('默认阈值').props.onChange({target:{value:'7'}});await h.form().props.onSubmit({preventDefault(){}});h.button('保存账号阈值').props.onClick();h.button('解除自动锁定').props.onClick();h.select('账号 IP 模式').props.onChange({target:{value:'allowlist'}});h.button('保存 IP 模式').props.onClick();await flush();assert.equal(h.calls.length,3);assert.match(text(h.draw()),/安全设置为只读/);
 }
});
test('an IP manager cannot change failure thresholds or unlock an account without those grants',async()=>{
 const permissions={manage_policy:false,manage_ip:true,manage_account_policy:false,unlock:false};
 const h=ui(async q=>q.action==='policy'?{ok:true,capabilities:permissions,policy:{failure_limit:5,version:1}}:q.action==='list-account-security'?{ok:true,capabilities:permissions,states:[{user_id:target.id,...security}]}:{ok:true,capabilities:permissions,security},{target});await flush();assert.equal(h.button('保存账号阈值').props.disabled,true);assert.equal(h.button('解除自动锁定').props.disabled,true);assert.equal(h.input('账号 IP / CIDR').props.disabled,false);
 h.select('账号 IP 模式').props.onChange({target:{value:'allowlist'}});h.button('保存 IP 模式').props.onClick();await flush();assert.equal(h.calls.at(-1).request.action,'set-account-ip-mode');assert.equal(h.calls.length,4);
});

test('a late account write cannot replace the newly selected account state or permissions',async()=>{
 let finishWrite;const second={...security,failed_count:1,locked:false,version:8};
 const h=ui(async q=>q.action==='policy'?{ok:true,policy:{failure_limit:5,version:1}}:q.action==='list-account-security'?{ok:true,states:[]}:q.action==='set-account-policy'?new Promise(resolve=>{finishWrite=resolve}):{ok:true,security:q.user_id==='second-id'?second:security},{target});await flush();
 h.select('该账号失败阈值').props.onChange({target:{value:'7'}});h.button('保存账号阈值').props.onClick();await flush();assert(finishWrite);h.setProps({target:{id:'second-id',username:'second',active:true}});await flush();assert.match(text(h.draw()),/连续失败1 次/);
 finishWrite({ok:true,capabilities:{...capabilities},security:{...security,failed_count:42,failure_limit:7,version:4}});await flush();assert.match(text(h.draw()),/连续失败1 次/);assert.doesNotMatch(text(h.draw()),/42 次/);assert.equal(h.snapshots.at(-1).states['second-id'].version,8);assert.equal(h.snapshots.at(-1).states[target.id],undefined);
});
