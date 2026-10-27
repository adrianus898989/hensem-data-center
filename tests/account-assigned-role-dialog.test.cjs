const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),session={user:{id:'owner'}},account={auth_user_id:'target',username:'target',role:'viewer',active:true,role_id:'old',assignment_version:1,data_scope:{mode:'all',countries:[]}},roles=[{id:'old',name:'Old',active:true,permissions:[]},{id:'new',name:'New',active:true,permissions:[]}];
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
function ui(options={}){
 let cursor=0,ecursor=0;const state=[],deps=[],effects=[],cleanups=[],calls=[],saved=[],denied=[],events=[];let closed=0,unconfirmed=0,props={session,account,roles,isOwner:true,editable:true};
 const mod={exports:{}},react={useState(v){const i=cursor++;if(!(i in state))state[i]=v;return[state[i],v=>state[i]=typeof v==='function'?v(state[i]):v]},useRef(v){const i=cursor++;return state[i]||(state[i]={current:v})},useEffect(fn,keys){const i=ecursor++;if(!deps[i]||keys.some((key,j)=>key!==deps[i][j])){deps[i]=keys;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn()})}}};
 const source=ts.transpileModule(fs.readFileSync(path.join(root,'src/components/AccountAssignedRoleDialog.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(source,{module:mod,exports:mod.exports,AbortController,Error,require:name=>{
  if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(name==='./AccountEditorDialog')return{default:function AccountEditorDialog(){}};
  if(name.endsWith('dashboardRoleAccess'))return{dashboardRoleAllows:()=>true};
  if(name.endsWith('dashboardRoleDisplay'))return{dashboardRoleDisplayPages:[]};
  if(name.endsWith('dashboardRoleClient'))return{dashboardRoleRequest:async(...args)=>{calls.push(args);return options.request?options.request(...args):{account:{...account,role_id:'new',assignment_version:2}}}};
  throw Error(name);
 }});
 const draw=()=>{cursor=ecursor=0;return mod.exports.default({...props,onSaved:a=>{events.push('saved');saved.push(a)},onClose:()=>{events.push('closed');closed++},onDenied:e=>denied.push(e),onUnconfirmed:()=>unconfirmed++,onMutationStart:()=>{events.push('claimed');return options.refuse?null:()=>events.push('released')}})};
 const render=()=>{const x=draw();effects.splice(0).forEach(fn=>fn());return x};
 const choose=()=>nodes(render()).find(n=>n.type==='select').props.onChange({target:{value:'new'}});
 const save=()=>nodes(render()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 render();return{draw,render,choose,save,calls,saved,denied,events,get closed(){return closed},get unconfirmed(){return unconfirmed},dispose:()=>cleanups.forEach(f=>f?.()),replace(next){props={...props,...next};render()}};
}
test('assignment consumes canonical confirmed account, closes immediately and does not read a directory',async()=>{
 const h=ui();h.choose();await h.save();assert.equal(h.calls.length,1);assert.equal(h.calls[0][1].operation,'assign');assert.equal(h.calls[0][1].expectedVersion,1);assert.equal(h.saved[0].assignment_version,2);assert.deepEqual(h.events,['claimed','saved','closed','released']);assert.equal(h.closed,1);h.dispose();
});
test('assignment claims synchronously and rejects a duplicate before React rerenders',async()=>{
 let finish;const h=ui({request:()=>new Promise(r=>finish=r)});h.choose();const submit=nodes(h.render()).find(n=>n.type==='form').props.onSubmit;
 const request=submit({preventDefault(){}});await submit({preventDefault(){}});assert.equal(h.calls.length,1);finish({account:{...account,role_id:'new',assignment_version:2}});await request;assert.equal(h.saved.length,1);h.dispose();
});
for(const boundary of ['dispose','actor'])test('assignment after '+boundary+' does not patch a new view and waits for the original write to settle',async()=>{
 let finish;const h=ui({request:()=>new Promise(r=>finish=r)});h.choose();const request=h.save(),signal=h.calls[0][2];if(boundary==='dispose')h.dispose();else h.replace({session:{user:{id:'different'}}});
 assert(!signal.aborted);assert.equal(h.unconfirmed,0);finish({account:{...account,role_id:'new',assignment_version:2}});await request;assert.equal(h.saved.length,0);assert.equal(h.closed,0);assert.equal(h.unconfirmed,1);assert.equal(h.events.filter(e=>e==='released').length,1);h.dispose();
});
test('assignment denial invokes shared clearing and cannot claim a saved result',async()=>{
 const h=ui({request:()=>{throw Object.assign(Error('revoked'),{status:403})}});h.choose();await h.save();assert.equal(h.denied.length,1);assert.equal(h.saved.length,0);assert.equal(h.closed,0);h.dispose();
});
test('a pending parent write refuses another role mutation without a request',async()=>{
 const h=ui({refuse:true});h.choose();await h.save();assert.equal(h.calls.length,0);h.dispose();
});

test('temporary parent busy state does not discard an already authorized assignment acknowledgement',async()=>{
 let finish;const h=ui({request:()=>new Promise(r=>finish=r)});h.choose();const request=h.save();h.replace({editable:false});
 assert(nodes(h.draw()).some(n=>n.type==='form'));finish({account:{...account,role_id:'new',assignment_version:2}});await request;assert.equal(h.saved.length,1);assert.equal(h.unconfirmed,0);h.dispose();
});
