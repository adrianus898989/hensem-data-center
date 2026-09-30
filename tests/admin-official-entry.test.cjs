// Runs the mounted entry with synthetic auth and hooks. No network or credentials.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const repo=path.resolve(__dirname,'..');
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(repo,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const bridge={exports:{}};vm.runInNewContext(compile('src/lib/adminLiveBridge.ts'),{module:bridge,exports:bridge.exports,require:()=>({})});
const source=compile('src/components/OfficialDashboard.tsx');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(options={}){
 const profile={auth_user_id:'account-a',active:true,role:options.role||'viewer',...options.profile};
 let auth={profile,session:{user:{id:profile.auth_user_id},access_token:'synthetic-current'},logout:()=>{loggedOut++}},loggedOut=0;
 let slots=[],cursor=0,pending=[],dirty=true,tree,disposed=false;const listeners=new Map(),timers=new Map(),requests=[],replacements=[];
 const location={origin:'https://app.invalid',pathname:'/app/',search:'',hash:options.hash||''};
 const shell=function FormalFrame(){};
 const react={
  useRef(value){const i=cursor++;return slots[i]||(slots[i]={current:value})},
  useState(value){const i=cursor++;if(!slots[i])slots[i]={value:typeof value==='function'?value():value};return[slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true}}]},
  useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){slots[i]={deps,cleanup:old?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn()})}},
 };
 const readAccess=async session=>{requests.push(session);return options.access?options.access(session):{canView:options.canView!==false}};
 const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,window:{location,history:{replaceState(_state,_title,url){replacements.push(url);location.hash=url.slice(url.indexOf('#'))}},setInterval(fn,ms){assert.equal(ms,60000);const id=timers.size+1;timers.set(id,fn);return id},clearInterval:id=>timers.delete(id),addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn)},removeEventListener(name,fn){listeners.get(name)?.delete(fn)}},require(name){
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
  if(name==='./DashboardAuthGate')return{useDashboardAuth:()=>auth};
  if(name==='./OwnerAdminPreview')return{default:shell};
  if(name.endsWith('/adminPreviewClient'))return{readAdminPreviewAccess:readAccess};
  if(name.endsWith('/adminLiveBridge'))return bridge.exports;
  if(name.endsWith('/dashboardAuthClient'))return{canOpenAdminCenter:p=>p?.role==='owner'||p?.role==='admin'};
  if(name.endsWith('/ownerPreviewShell'))return{OWNER_PREVIEW_HOST_CSS:'',mountOwnerPreviewHostShell:()=>()=>{}};
  throw Error(name);
 }});
 const render=()=>{if(disposed)return tree;let guard=0;do{dirty=false;cursor=0;tree=module.exports.default();pending.splice(0).forEach(fn=>fn());assert(++guard<20,'render settles')}while(dirty);return tree};
 const send=name=>{for(const fn of [...listeners.get(name)||[]])fn();return render()};render();
 return{render,requests,replacements,location,shell,route:module.exports.officialAdminPageFromHash,send,loggedOut:()=>loggedOut,tick:()=>{for(const fn of timers.values())fn()},setAuth(next){auth={...auth,...next};return render()},dispose(){disposed=true;for(const slot of slots)slot?.cleanup?.()},frame:()=>{render();return tree.type===shell?tree:null},text:()=>JSON.stringify(render()),logoutButton:()=>nodes(render()).find(n=>n.type==='button'&&n.props.children==='退出登录')};
}
function nodes(node){return !node||typeof node!=='object'?[]:[node,...(Array.isArray(node.props?.children)?node.props.children:[node.props?.children]).flatMap(nodes)]}
test('only the formal component is exported; legacy sidebar and reader hooks are never mounted',()=>{
 const dashboard=fs.readFileSync(path.join(repo,'src/components/Dashboard.tsx'),'utf8');
 assert.match(dashboard,/export \{ default \} from "\.\/OfficialDashboard"/);
 assert(!/export default function Dashboard/.test(dashboard));
 assert(!fs.readFileSync(path.join(repo,'src/components/OfficialDashboard.tsx'),'utf8').includes('LegacyDashboard'));
 const entry=fs.readFileSync(path.join(repo,'src/app/page.tsx'),'utf8');assert.match(entry,/import OfficialDashboard from "@\/components\/OfficialDashboard"/);assert.doesNotMatch(entry,/components\/Dashboard"/);
 const h=harness({role:'owner'});assert(h.frame());assert.equal(h.location.hash,'#admin/overview');assert.equal(h.requests.length,0);assert.equal(h.frame().props.canView,true);h.dispose();
});
test('an active granted viewer enters only after access validation and retains a legacy bookmarked page',async()=>{
 const h=harness({hash:'#owner-admin-preview/provider_payout'});assert.equal(h.frame(),null);assert.match(h.text(),/验证后台查看权限/);assert.equal(h.replacements.length,0);
 await flush();assert(h.frame());assert.equal(h.location.hash,'#admin/provider_payout');assert.equal(h.requests.length,1);assert.equal(h.frame().props.profile.role,'viewer');h.dispose();
});
test('denied or failed access never falls back to legacy modules and provides logout and retry',async()=>{
 for(const options of [{canView:false},{access:async()=>{throw Error('synthetic unavailable')}}]){
  const h=harness({...options,hash:'#auto'});await flush();assert.equal(h.frame(),null);assert.equal(h.location.hash,'#auto');assert(h.logoutButton());h.logoutButton().props.onClick();assert.equal(h.loggedOut(),1);assert.match(h.text(),/重新验证/);assert(!h.text().includes('返回现有后台'));h.dispose();
 }
});
test('inactive or mismatched owner sessions cannot mount or request the backend',()=>{
 const h=harness({role:'owner',profile:{active:false}});assert.equal(h.frame(),null);assert.equal(h.requests.length,0);assert(h.logoutButton());h.dispose();
 const other=harness({role:'owner'});other.setAuth({session:{user:{id:'different-account'}}});assert.equal(other.frame(),null);other.dispose();
});
test('account switches and late permission responses cannot reuse a prior grant',async()=>{
 const resolves=[];const h=harness({access:()=>new Promise(resolve=>resolves.push(resolve))});
 h.setAuth({profile:{active:true,role:'viewer',auth_user_id:'account-b'},session:{user:{id:'account-b'}}});
 resolves[0]({canView:true});await flush();assert.equal(h.frame(),null);resolves[1]({canView:false});await flush();assert.equal(h.frame(),null);assert.match(h.text(),/没有后台查看权限/);h.dispose();
});
test('access revocation unmounts the frame; a retry can restore independently authorized access',async()=>{
 let canView=true;const h=harness({access:async()=>({canView})});await flush();assert(h.frame());canView=false;h.tick();await flush();assert.equal(h.frame(),null);
 canView=true;nodes(h.render()).find(n=>n.type==='button'&&n.props.children==='重新验证').props.onClick();h.render();await flush();assert(h.frame());h.dispose();
});
test('session token refresh keeps the page and the permission poll uses the refreshed session',async()=>{
 const h=harness();await flush();const key=h.frame().key;h.setAuth({session:{user:{id:'account-a'},access_token:'synthetic-refreshed'}});assert.equal(h.frame().key,key);h.tick();await flush();assert.equal(h.requests.at(-1).access_token,'synthetic-refreshed');assert.equal(h.frame().key,key);h.dispose();
});
test('authorized account-menu navigation mounts the current access page even on repeated requests',async()=>{
 const h=harness({role:'admin'});await flush();const first=h.frame().key;h.send('hensem:open-admin');assert.equal(h.location.hash,'#admin/access');assert.notEqual(h.frame().key,first);const second=h.frame().key;h.send('hensem:open-admin');assert.notEqual(h.frame().key,second);assert.equal(h.requests.length,1,'navigation starts no business or additional permission query');h.dispose();
 const viewer=harness({role:'viewer'});await flush();const old=viewer.frame().key;viewer.send('hensem:open-admin');assert.equal(viewer.frame().key,old);viewer.dispose();
 const denied=harness({role:'admin',canView:false});await flush();denied.send('hensem:open-admin');assert.equal(denied.frame(),null);denied.dispose();
});
test('old module links and hash changes redirect to safe formal pages without legacy rendering',()=>{
 const h=harness({role:'owner'});
 const cases={'#channelquality':'providers','#admin/channelquality':'providers','#owner-admin-preview/channelquality':'providers','#home':'overview','#auto':'auto_withdraw','#config':'payout_config','#operator':'withdraw_operators','#volume':'providers','#work':'workorders','#orders':'orders','#provider-anomalies':'risk','#admin':'access','#owner-admin-preview/stuck':'stuck','#admin/providers':'providers','#admin/../../foreign':'overview','#https://evil.invalid':'overview'};
 for(const [hash,page] of Object.entries(cases)){const old=h.frame().key;h.location.hash=hash;h.send('hashchange');assert.equal(h.location.hash,'#admin/'+page);assert(h.frame());assert.notEqual(h.frame().key,old)}assert.equal(h.requests.length,0);h.frame().props.onLogout();assert.equal(h.loggedOut(),1);h.dispose();
});
