const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const repo=path.resolve(__dirname,'..'),ts=require(path.join(repo,'node_modules/typescript'));
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(repo,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const plain=value=>JSON.parse(JSON.stringify(value)),flush=()=>new Promise(r=>setImmediate(r));
const session={user:{id:'owner'},access_token:'old-token'},catalog={teams:['M8','香港'],platforms:['A','B','H'],platformTeams:{A:'M8',B:'M8',H:'香港'}};
const account={auth_user_id:'staff-id',username:'staff',display_name:'员工甲',role:'agent',team:'M8',platforms:['A'],active:true,updated_at:'2026-09-26T01:00:00Z'};
function client(options={}){
 const mod={exports:{}},calls=[],timers=new Map(),delays=[];let timerId=0;
 vm.runInNewContext(compile('src/lib/workOrderAccountClient.ts'),{module:mod,exports:mod.exports,URL,AbortController,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://project.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public-key'}},
  setTimeout(fn,ms){const id=++timerId;timers.set(id,fn);delays.push(ms);return id},clearTimeout(id){timers.delete(id)},
  require:()=>({ensureDashboardSession:async()=>options.ensureSession?options.ensureSession():options.session||{...session,access_token:'fresh-token'}}),
  fetch:async(url,init)=>{calls.push({url,init});return options.fetch?options.fetch(url,init):options.response||{ok:true,status:200,json:async()=>({ok:true,accounts:[],catalog})}}});
 return{api:mod.exports,calls,timers,delays,expire(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn())}};
}
const waitForAbort=signal=>new Promise((resolve,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true})});
test('workorder account client uses refreshed host session and its independent endpoint',async()=>{
 const h=client(),controller=new AbortController();await h.api.workOrderAccountRequest(session,{action:'list-accounts'},controller.signal);const call=h.calls[0];assert.equal(call.url,'https://project.invalid/functions/v1/workorder-account-admin');assert.equal(call.init.headers.Authorization,'Bearer fresh-token');assert(call.init.signal instanceof AbortSignal);assert.equal(call.init.signal.aborted,false);assert.equal(call.init.cache,'no-store');assert.equal(call.init.redirect,'error');assert.deepEqual(JSON.parse(call.init.body),{action:'list-accounts'});assert.equal(h.timers.size,0,'successful requests clear their timeout');controller.abort();assert.equal(call.init.signal.aborted,false,'settled requests remove the caller abort listener');
 await assert.rejects(()=>h.api.workOrderAccountRequest(session,{action:'delete-account'}),/不支持/);assert.equal(h.calls.length,1);
});
test('changed account and real API failures never become a successful empty list',async()=>{
 const changed=client({session:{...session,user:{id:'different'}}});await assert.rejects(()=>changed.api.workOrderAccountRequest(session,{action:'list-accounts'}),/账号已改变/);assert.equal(changed.calls.length,0);
 for(const [status,message]of[[403,/总管理员/],[401,/会话/],[409,/已被其他/],[503,/稍后/]]){const h=client({response:{ok:false,status,json:async()=>({ok:false,message:status===409?'已被其他管理员修改':'请稍后重试'})}});await assert.rejects(()=>h.api.workOrderAccountRequest(session,{action:'list-accounts'}),message)}
});
test('list timeout aborts the request and reports a retryable read without retrying automatically',async()=>{
 const h=client({fetch:(_url,init)=>waitForAbort(init.signal)}),pending=h.api.workOrderAccountRequest(session,{action:'list-accounts'});
 await flush();assert.deepEqual(h.delays,[15000]);const rejected=assert.rejects(pending,/读取工单账号超时，请刷新列表重试/);h.expire();await rejected;assert.equal(h.calls.length,1);assert.equal(h.calls[0].init.signal.aborted,true);assert.equal(h.timers.size,0);
});
test('every write timeout reports an unconfirmed result and never repeats the mutation',async()=>{
 for(const action of ['create-account','update-account','reset-password']){
  const h=client({fetch:(_url,init)=>waitForAbort(init.signal)}),pending=h.api.workOrderAccountRequest(session,{action});await flush();
  const rejected=assert.rejects(pending,error=>{assert.match(error.message,/超时，结果尚未确认/);assert.match(error.message,action==='reset-password'?/用新密码登录核对，勿重复提交/:/刷新列表核对后再操作/);return true});h.expire();await rejected;await flush();assert.equal(h.calls.length,1,action+' must not retry');assert.equal(h.timers.size,0);
 }
});
test('the timeout covers a stalled response body after the mutation has reached the service',async()=>{
 const h=client({fetch:async(_url,init)=>({ok:true,status:200,json:()=>waitForAbort(init.signal)})}),pending=h.api.workOrderAccountRequest(session,{action:'update-account'});await flush();const rejected=assert.rejects(pending,/结果尚未确认.*刷新列表核对/);h.expire();await rejected;assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
});
test('caller cancellation stays cancellation, clears the timer and does not dispatch after cancelled session refresh',async()=>{
 const h=client({fetch:(_url,init)=>waitForAbort(init.signal)}),controller=new AbortController(),reason=new Error('caller cancelled');
 const pending=h.api.workOrderAccountRequest(session,{action:'list-accounts'},controller.signal);await flush();const rejected=assert.rejects(pending,error=>error===reason);controller.abort(reason);await rejected;assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
 const cancelled=client();await assert.rejects(cancelled.api.workOrderAccountRequest(session,{action:'list-accounts'},controller.signal),error=>error===reason);assert.equal(cancelled.calls.length,0);assert.equal(cancelled.timers.size,0);
 let resolveSession;const waiting=client({ensureSession:()=>new Promise(resolve=>{resolveSession=resolve})}),second=new AbortController();const duringRefresh=waiting.api.workOrderAccountRequest(session,{action:'list-accounts'},second.signal);second.abort(reason);const rejectedRefresh=assert.rejects(duringRefresh,error=>error===reason);resolveSession(session);await rejectedRefresh;assert.equal(waiting.calls.length,0);
});
function nodes(node){if(Array.isArray(node))return node.flatMap(nodes);return node&&typeof node==='object'?[node,...nodes(node.props?.children)]:[]}
function text(node){if(Array.isArray(node))return node.map(text).join('');if(node&&typeof node==='object')return text(node.props?.children);return node==null||typeof node==='boolean'?'':String(node)}
function ui(handler){const states=[],refs=[],deps=[],effects=[],calls=[];let i=0,r=0,e=0;const mod={exports:{}};
 const react={useState(initial){const k=i++;if(!(k in states))states[k]=typeof initial==='function'?initial():initial;return[states[k],value=>states[k]=typeof value==='function'?value(states[k]):value]},useRef(initial){const k=r++;return refs[k]||(refs[k]={current:initial})},useEffect(fn,values){const k=e++;if(!deps[k]||values.some((v,n)=>v!==deps[k][n])){deps[k]=values;effects.push(fn)}}};
 vm.runInNewContext(compile('src/components/WorkOrderAccountAdmin.tsx'),{module:mod,exports:mod.exports,AbortController,Error,require:name=>{if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name.endsWith('/workOrderAccountClient'))return{workOrderAccountRequest:async(s,q,signal)=>{calls.push(plain(q));return handler?handler(q,signal):{ok:true,accounts:[account],catalog}}};if(name.endsWith('.css'))return{};throw Error(name)}});
 const draw=()=>{i=r=e=0;return mod.exports.default({session})};draw();effects.splice(0).forEach(fn=>fn());
 return{calls,draw,states,runEffects(){effects.splice(0).forEach(fn=>fn())},button(label){const b=nodes(draw()).find(n=>n.type==='button'&&text(n)===label);assert(b,'button '+label);return b},field(label,type='input'){const parent=nodes(draw()).find(n=>n.type==='label'&&text(n).startsWith(label));assert(parent,'label '+label);const input=nodes(parent).find(n=>n.type===type);assert(input);return input},change(label,value,type='input'){this.field(label,type).props.onChange({target:{value}})},form(){return nodes(draw()).find(n=>n.type==='form')}};
}
test('real list renders roles and source catalog, without permanent-delete or mock statistics',async()=>{
 const h=ui();await flush();assert.match(text(h.draw()),/员工甲/);assert.match(text(h.draw()),/共 1 个工单账号/);assert.doesNotMatch(text(h.draw()),/删除账号|未接入|所有者|团队分析员/);assert.deepEqual(h.calls,[{action:'list-accounts'}]);
});
test('create selects explicit team platforms and never carries platforms across a team change',async()=>{
 const h=ui(async q=>q.action==='list-accounts'?{ok:true,accounts:[],catalog}:{ok:true,account:{...account,username:q.username,display_name:q.display_name,team:q.team,platforms:q.platforms,updated_at:'next'}});await flush();h.button('新建工单账号').props.onClick();h.change('账号','staff-two');h.change('初始密码','safe-fixture-password');h.change('显示名称','员工乙');h.change('团队','M8','select');h.button('全选当前团队').props.onClick();assert.match(text(h.draw()),/已选 2 个/);h.change('团队','香港','select');assert.match(text(h.draw()),/已选 0 个/);h.button('全选当前团队').props.onClick();await h.form().props.onSubmit({preventDefault(){}});
 assert.deepEqual(h.calls[1],{action:'create-account',username:'staff-two',password:'safe-fixture-password',display_name:'员工乙',role:'agent',team:'香港',platforms:['H']});assert(!h.form());assert(!JSON.stringify(h.states).includes('safe-fixture-password'),'clears password from form state after success');
});
test('updates preserve optimistic version and disabling is independent from password reset',async()=>{
 const h=ui(async q=>q.action==='list-accounts'?{ok:true,accounts:[account],catalog}:{ok:true,account:{...account,...q.patch,updated_at:'updated'}});await flush();h.button('编辑范围 / 角色').props.onClick();h.change('角色','auditor','select');await h.form().props.onSubmit({preventDefault(){}});assert.equal(h.calls[1].action,'update-account');assert.equal(h.calls[1].expected_updated_at,account.updated_at);assert.equal(h.calls[1].patch.role,'auditor');assert.equal(h.calls[1].patch.active,true);
 await h.button('停用').props.onClick();await flush();assert.deepEqual(h.calls[2],{action:'update-account',auth_user_id:account.auth_user_id,expected_updated_at:'updated',patch:{active:false}});
 h.button('重设密码').props.onClick();h.change('新密码','other-safe-password');await h.form().props.onSubmit({preventDefault(){}});assert.deepEqual(h.calls[3],{action:'reset-password',auth_user_id:account.auth_user_id,password:'other-safe-password'});assert(!JSON.stringify(h.states).includes('other-safe-password'));
});
test('failed initial list shows an error and no invented zero-account result',async()=>{
 const h=ui(async()=>{throw Error('真实服务读取失败')});await flush();assert.match(text(h.draw()),/真实服务读取失败/);assert.doesNotMatch(text(h.draw()),/共 0 个|还没有工单账号/);assert.equal(h.button('新建工单账号').props.disabled,true);
});

test('refresh failures remove prior account data instead of leaving stale authorized rows visible',async()=>{
 let fail=false;const h=ui(async()=>{if(fail)throw Error('仅总管理员可管理工单账号');return{ok:true,accounts:[account],catalog}});await flush();assert.match(text(h.draw()),/员工甲/);fail=true;h.button('刷新列表').props.onClick();h.draw();h.runEffects();await flush();assert.doesNotMatch(text(h.draw()),/员工甲|共 1 个|还没有工单账号/);assert.match(text(h.draw()),/总管理员/);assert.equal(h.button('新建工单账号').props.disabled,true);
});
test('a concurrent edit error preserves the draft without silently overwriting or retrying',async()=>{
 const h=ui(async q=>{if(q.action==='list-accounts')return{ok:true,accounts:[account],catalog};throw Error('该账号已被其他管理员修改，请刷新列表后重试')});await flush();h.button('编辑范围 / 角色').props.onClick();h.change('显示名称','新显示名称');await h.form().props.onSubmit({preventDefault(){}});assert(h.form());assert.equal(h.field('显示名称').props.value,'新显示名称');assert.match(text(h.draw()),/其他管理员修改/);assert.equal(h.calls.length,2);
});
