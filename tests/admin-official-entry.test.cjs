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
 const readAccess=async()=>{requests.push(true);throw Error('duplicate outer access preflight')};
 const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,AbortController,window:{location,history:{replaceState(_state,_title,url){replacements.push(url);location.hash=url.slice(url.indexOf('#'))}},setInterval(fn,ms){assert.equal(ms,60000);const id=timers.size+1;timers.set(id,fn);return id},clearInterval:id=>timers.delete(id),addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn)},removeEventListener(name,fn){listeners.get(name)?.delete(fn)}},require(name){
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
test('an active viewer delegates one initial authorization chain to the preview and retains its bookmarked page',()=>{
 const h=harness({hash:'#owner-admin-preview/provider_payout'});assert(h.frame());assert.equal(h.location.hash,'#admin/provider_payout');assert.equal(h.requests.length,0);assert.equal(h.frame().props.profile.role,'viewer');assert.equal(h.frame().props.canView,true);h.dispose();
});
test('inactive or mismatched sessions cannot mount or request the backend',()=>{
 for(const role of ['owner','admin','viewer']){const h=harness({role,profile:{active:false}});assert.equal(h.frame(),null);assert.equal(h.requests.length,0);assert(h.logoutButton());h.logoutButton().props.onClick();assert.equal(h.loggedOut(),1);h.dispose();}
 const h=harness({role:'owner'});h.setAuth({session:{user:{id:'different-account'}}});assert.equal(h.frame(),null);h.dispose();
});
test('account switches remount the authorization owner with the current account only',()=>{
 const h=harness();const first=h.frame().key;
 h.setAuth({profile:{active:true,role:'viewer',auth_user_id:'account-b'},session:{user:{id:'account-b'},access_token:'synthetic-new-account'}});
 assert(h.frame());assert.notEqual(h.frame().key,first);assert.equal(h.frame().props.profile.auth_user_id,'account-b');assert.equal(h.frame().props.session.user.id,'account-b');assert.equal(h.requests.length,0);h.dispose();
});
test('the preview alone owns periodic validation and receives refreshed tokens without remounting',()=>{
 const h=harness();const key=h.frame().key;h.setAuth({session:{user:{id:'account-a'},access_token:'synthetic-refreshed'}});
 assert.equal(h.frame().key,key);assert.equal(h.frame().props.session.access_token,'synthetic-refreshed');h.tick();h.send('focus');h.send('online');assert.equal(h.requests.length,0);assert.equal(h.frame().key,key);h.dispose();
});
test('account-menu navigation remounts the current page without an extra access preflight',()=>{
 const h=harness({role:'admin'});const first=h.frame().key;h.send('hensem:open-admin');assert.equal(h.location.hash,'#admin/access');assert.notEqual(h.frame().key,first);const second=h.frame().key;h.send('hensem:open-admin');assert.notEqual(h.frame().key,second);assert.equal(h.requests.length,0);h.dispose();
 const viewer=harness();const old=viewer.frame().key;viewer.send('hensem:open-admin');assert.equal(viewer.frame().key,old);viewer.dispose();
});
test('old module links and hash changes redirect to safe formal pages without legacy rendering',()=>{
 const h=harness({role:'owner'});
 const cases={'#channelquality':'providers','#admin/channelquality':'providers','#owner-admin-preview/channelquality':'providers','#home':'overview','#auto':'auto_withdraw','#config':'payout_config','#operator':'withdraw_operators','#volume':'providers','#work':'workorders','#orders':'orders','#provider-anomalies':'risk','#admin':'access','#owner-admin-preview/stuck':'stuck','#admin/providers':'providers','#admin/../../foreign':'overview','#https://evil.invalid':'overview'};
 for(const [hash,page] of Object.entries(cases)){const old=h.frame().key;h.location.hash=hash;h.send('hashchange');assert.equal(h.location.hash,'#admin/'+page);assert(h.frame());assert.notEqual(h.frame().key,old)}assert.equal(h.requests.length,0);h.frame().props.onLogout();assert.equal(h.loggedOut(),1);h.dispose();
});

// Execute the actual authorization owner: the outer component delegates here,
// but no HTML may mount until both role and protected-document checks succeed.
function previewHarness(options={}){
 let slots=[],cursor=0,pending=[],dirty=true,tree,disposed=false,seq=0;const timers=new Map(),intervals=new Map(),warnings=[],calls=[],bridgeStops=[];
 let props={canView:true,session:{user:{id:'account-a'},access_token:'synthetic'},profile:{active:true,role:'viewer',auth_user_id:'account-a'},onLogout(){}};
 const react={useRef(value){const i=cursor++;return slots[i]||(slots[i]={current:value})},useState(value){const i=cursor++;if(!slots[i])slots[i]={value};return[slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true}}]},useCallback(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))slots[i]={deps,fn};return slots[i].fn},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){slots[i]={deps,cleanup:old?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn()})}}};
 const timer=(fn,ms)=>{timers.set(++seq,{fn,ms});return seq};
 const verification={exports:{}};vm.runInNewContext(compile('src/lib/ownerPreviewVerification.ts'),{module:verification,exports:verification.exports,AbortController,Error,setTimeout:timer,clearTimeout:id=>timers.delete(id)});
 const policy={canView:true,mode:'all'},identity=x=>x,stop=()=>()=>bridgeStops.push(true);
 const box={exports:{}};vm.runInNewContext(compile('src/components/OwnerAdminPreview.tsx'),{module:box,exports:box.exports,AbortController,Error,Date,crypto:{randomUUID:()=>String(++seq)},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},process:{env:{}},console:{warn:(...args)=>warnings.push(args)},window:{location:{origin:'https://fixture.invalid'},setInterval(fn,ms){intervals.set(++seq,{fn,ms});return seq},clearInterval:id=>intervals.delete(id),addEventListener(){},removeEventListener(){}},document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},require(name){
  if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
  if(name.endsWith('/dashboardAuthClient'))return{normalizedManagementPermissions:()=>({})};
  if(name.endsWith('/ownerPreviewVerification'))return verification.exports;
  if(name.endsWith('/ownerPreviewDocument'))return{makeOwnerPreviewDocument:identity,OWNER_PREVIEW_DRAFT_KEYS:[],ownerPreviewDraftAllowed:()=>false};
  if(name.endsWith('/adminPreviewRestore'))return{restoreApprovedAdmin:identity};
  if(name.endsWith('/adminPreviewClient'))return{adminPreviewRequest:async(s,q,o)=>{calls.push({stage:'preview-request',signal:o.signal,q});return options.preview?options.preview(s,q,o):{text:async()=>'<html>verified</html>',json:async()=>({ok:true,canView:true,canManage:false})}}};
  if(name.endsWith('/dashboardRoleAccess'))return{dashboardRoleAllows:()=>false,readDashboardRoleAccess:async(s,signal)=>{calls.push({stage:'role',signal});return options.role?options.role(s,signal):policy}};
  if(name.endsWith('/adminLiveBridge'))return{makeAdminLiveDocument:identity,installAdminLiveBridge:stop};
  if(name.endsWith('/dashboardPresenceBridge'))return{makeDashboardPresenceDocument:identity,installDashboardPresenceBridge:stop};
  if(name.endsWith('/ownerPreviewShell'))return{OWNER_PREVIEW_HOST_CSS:'',mountOwnerPreviewHostShell:()=>()=>{},makeOwnerPreviewShellDocument:identity};
  if(name.endsWith('/dashboardDataScope'))return{dashboardScopeIdentity:p=>JSON.stringify([p.auth_user_id,p.scope]),effectiveDashboardDataScope:()=>({mode:'all'})};
  if(name.endsWith('/dashboardIdle'))return{recordDashboardActivity(){}};if(name.endsWith('/dashboardRelease'))return{installDashboardReleaseCheck:()=>()=>{}};
  if(name.startsWith('./'))return{default:function Unused(){}};throw Error(name);
 }});
 const render=()=>{if(disposed)return tree;let guard=0;do{dirty=false;cursor=0;tree=box.exports.default(props);pending.splice(0).forEach(fn=>fn());assert(++guard<20)}while(dirty);return tree};render();
 return{calls,warnings,timers,bridgeStops,render,frame:()=>nodes(render()).find(n=>n.type==='iframe'),text:()=>JSON.stringify(render()),tick:()=>{for(const t of intervals.values())t.fn()},fire(ms){const found=[...timers].find(([,t])=>t.ms===ms);assert(found,'expected timer '+ms);timers.delete(found[0]);found[1].fn()},setProps(next){props={...props,...next};return render()},dispose(){disposed=true;for(const slot of slots)slot?.cleanup?.()}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{resolve,reject,promise}};
function warningDiagnostic(args){
 assert.equal(args.length,1);assert.equal(typeof args[0],'string');assert(args[0].startsWith('后台验证读取失败 '));
 const diagnostic=JSON.parse(args[0].slice('后台验证读取失败 '.length));assert.deepEqual(Object.keys(diagnostic).sort(),['code','elapsedMs','stage']);
 assert(Number.isInteger(diagnostic.elapsedMs)&&diagnostic.elapsedMs>=0);assert.doesNotMatch(args[0],/hidden response|secret response|access_token|synthetic/);return diagnostic;
}
test('real preview mounts no HTML until both role and protected document have passed exactly once',async()=>{
 const role=deferred(),body=deferred(),h=previewHarness({role:()=>role.promise,preview:async()=>({text:()=>body.promise})});
 try{await flush();assert.equal(h.frame(),undefined);assert.equal(h.calls.length,1);role.resolve({canView:true,mode:'all'});await flush();assert.equal(h.frame(),undefined);assert.deepEqual(h.calls.map(c=>c.stage),['role','preview-request']);body.resolve('<html>authorized</html>');await flush();assert.equal(h.frame().props.srcDoc,'<html>authorized</html>');assert.equal(h.calls.length,2);assert.equal(h.warnings.length,0);}finally{h.dispose()}
});
test('real preview rejects role denial, protected-document denial and malformed periodic access responses',async()=>{
 for(const stage of ['role','preview']){const h=previewHarness(stage==='role'?{role:async()=>({canView:false})}:{preview:async()=>{throw Object.assign(Error('secret response not for log'),{status:403,code:'preview_denied'})}});try{await flush();assert.equal(h.frame(),undefined);assert.equal(h.timers.size,0);h.tick();await flush();assert.equal(h.calls.length,stage==='role'?1:2);assert.doesNotMatch(JSON.stringify(h.warnings),/secret/);}finally{h.dispose()}}
 const h=previewHarness({preview:async(_s,q)=>q?{json:async()=>({ok:true,canView:false,canManage:false})}:{text:async()=>'<html>ok</html>'}});try{await flush();assert(h.frame());h.tick();await flush();assert.equal(h.frame(),undefined);assert.equal(h.timers.size,0)}finally{h.dispose()}
});
test('periodic transport failure still hides the frame and stops bridges until full verified recovery',async()=>{
 let failure=false;const h=previewHarness({preview:async(_s,q)=>{if(failure)throw Object.assign(Error('hidden response'),{status:503});return{text:async()=>'<html>same</html>',json:async()=>({ok:true,canView:true,canManage:false})}}});
 try{await flush();const original=h.frame();assert(original);failure=true;h.tick();await flush();assert.equal(h.frame().props['aria-hidden'],true);assert.equal(h.frame().props.style.display,'none');assert(h.bridgeStops.length>=2);const diagnostic=warningDiagnostic(h.warnings[0]);assert.equal(diagnostic.stage,'preview-request');assert.equal(diagnostic.code,'http_503');failure=false;h.fire(500);await flush();assert.equal(h.frame().props['aria-hidden'],undefined);assert.equal(h.frame().key,original.key);assert.equal(h.calls.at(-1).q,'','recovery reads protected HTML, not only quick access');}finally{h.dispose()}
});
test('body deadline diagnoses its phase and cancellation ignores late private HTML',async()=>{
 const body=deferred(),h=previewHarness({preview:async()=>({text:()=>body.promise})});try{await flush();h.fire(15000);await flush();assert.equal(h.frame(),undefined);const diagnostic=warningDiagnostic(h.warnings[0]);assert.equal(diagnostic.stage,'preview-body');assert.equal(diagnostic.code,'owner_preview_timeout');h.dispose();body.resolve('<html>late</html>');await flush();assert.equal(h.frame(),undefined);assert.equal(h.timers.size,0);assert.equal(h.warnings.length,1);}finally{h.dispose()}
});
test('changing accounts while protected HTML is pending never mounts the old document',async()=>{
 const old=deferred();const h=previewHarness({preview:async s=>({text:()=>s.user.id==='account-a'?old.promise:Promise.resolve('<html>account-b</html>')})});
 try{await flush();const oldSignal=h.calls.at(-1).signal;h.setProps({session:{user:{id:'account-b'},access_token:'new'},profile:{active:true,role:'viewer',auth_user_id:'account-b'}});await flush();assert(oldSignal.aborted);assert.equal(h.frame().props.srcDoc,'<html>account-b</html>');old.resolve('<html>old-account</html>');await flush();assert.equal(h.frame().props.srcDoc,'<html>account-b</html>');assert.equal(h.warnings.length,0);}finally{h.dispose()}
});
