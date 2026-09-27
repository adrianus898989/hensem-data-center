const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const repo=path.resolve(__dirname,'..'),ts=require(path.join(repo,'node_modules/typescript'));
const gateway='https://hensem-india-workorder.adrianus898989.workers.dev';
const tick=()=>new Promise(resolve=>setImmediate(resolve)),copy=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject}};
const session=(id='owner',seconds=3600,label='initial')=>({user:{id},access_token:'synthetic-access-'+label,refresh_token:'synthetic-refresh-'+label,expires_at:Date.now()/1000+seconds});
function harness(options={}){
 const calls=[],timers=new Map(),waits=[];let nextTimer=0,handler=options.fetch||(()=>({ok:true,status:200,json:async()=>({ok:true}),text:async()=>'{"ok":true}'}));
 const authModule={exports:{}},securityModule={exports:{}};
 const context={URL,URLSearchParams,Headers,AbortController,AbortSignal,Error,Date,atob,console,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://supabase.synthetic.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-public-key'}},setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,ms});waits.push(ms);return id},clearTimeout:id=>timers.delete(id),fetch:async(url,init={})=>{const call={url:String(url),init,body:JSON.parse(init.body||'{}')};calls.push(call);return handler(call)}};
 function load(file,mod,extra={}){const source=ts.transpileModule(fs.readFileSync(path.join(repo,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(source,{...context,module:mod,exports:mod.exports,...extra},{filename:file})}
 load('src/lib/dashboardAuthClient.ts',authModule);
 load('src/lib/accountSecurityClient.ts',securityModule,{require:name=>{assert.equal(name,'./dashboardAuthClient');return options.ensure?{APPLICATION_GATEWAY:gateway,ensureDashboardSession:options.ensure}:authModule.exports}});
 return{auth:authModule.exports,api:securityModule.exports,calls,timers,waits,setFetch(fn){handler=fn},expire(ms){for(const[id,t]of [...timers])if(ms===undefined||t.ms===ms){timers.delete(id);t.fn()}}};
}
const reply=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body,text:async()=>JSON.stringify(body)});
const waitForAbort=signal=>new Promise((resolve,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true})});
test('security credentials go only to the fixed gateway with refreshed same-account authorization and explicit namespace',async()=>{
 const old=session(),fresh=session('owner',3600,'fresh'),h=harness({ensure:async()=>fresh});
 for(const surface of ['workorder','dashboard']){const request={action:'policy',surface,patch:{failure_limit:7},expected_version:1};await h.api.securityRequest(old,request);const c=h.calls.at(-1);assert.equal(c.url,gateway+'/api/security-admin');assert.equal(c.init.method,'POST');assert.equal(c.init.headers.Authorization,'Bearer '+fresh.access_token);assert.equal(c.init.redirect,'error');assert.equal(c.init.credentials,'omit');assert.equal(c.init.cache,'no-store');assert.deepEqual(c.body,request)}
 assert.equal(h.timers.size,0);assert.deepEqual(h.waits,[20000,20000]);assert(h.calls.every(c=>!c.url.includes('supabase.synthetic.invalid')));
 await assert.rejects(()=>h.api.securityRequest(old,{action:'unsupported',surface:'workorder'}),/不支持/);await assert.rejects(()=>h.api.securityRequest(old,{action:'policy',surface:'other'}),/不支持/);assert.equal(h.calls.length,2);
});
test('expired sessions refresh through the gateway before one security mutation; changed accounts never dispatch',async()=>{
 const old=session('owner',1),fresh=session('owner',3600,'new'),h=harness();h.auth.saveDashboardSession(old);h.setFetch(c=>c.body.action==='refresh'?reply({ok:true,tokens:fresh}):reply({ok:true,security:{version:2}}));
 await h.api.securityRequest(old,{action:'unlock-account',surface:'dashboard',user_id:'subject',expected_version:1});assert.equal(h.calls.length,2);assert.deepEqual(h.calls[0].body,{action:'refresh',refresh_token:old.refresh_token});assert.equal(h.calls[0].url,gateway+'/api/dashboard-auth');assert.equal(h.calls[1].url,gateway+'/api/security-admin');assert.equal(h.calls[1].init.headers.Authorization,'Bearer '+fresh.access_token);assert.equal(h.timers.size,0);
 const changed=harness();changed.auth.saveDashboardSession(session('another-owner'));await assert.rejects(()=>changed.api.securityRequest(old,{action:'policy',surface:'workorder'}),/已改变/);assert.equal(changed.calls.length,0);
 const inconsistent=harness({ensure:async()=>session('different')});await assert.rejects(()=>inconsistent.api.securityRequest(old,{action:'policy',surface:'workorder'}),/账号已改变/);assert.equal(inconsistent.calls.length,0);
});
test('server 401, 403, version conflicts, outages and broken networks never replay a security mutation',async()=>{
 for(const status of [401,403,409,503]){const h=harness();h.setFetch(()=>reply({ok:false,message:'明确失败 '+status},status));await assert.rejects(()=>h.api.securityRequest(session(),{action:'set-rule-active',surface:'dashboard',id:3,active:false,expected_version:1}));assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.action,'set-rule-active');assert.equal(h.timers.size,0)}
 const offline=harness({fetch:async()=>{throw Error('synthetic network failure')}});await assert.rejects(()=>offline.api.securityRequest(session(),{action:'upsert-rule',surface:'workorder',network:'192.0.2.1',note:'fixture'}),/synthetic network failure/);assert.equal(offline.calls.length,1);assert.equal(offline.timers.size,0);
});
test('security timeout covers a response body after a write was accepted and never repeats the uncertain write',async()=>{
 const h=harness({fetch:c=>({ok:true,status:200,json:()=>waitForAbort(c.init.signal)})});const pending=h.api.securityRequest(session(),{action:'delete-rule',surface:'workorder',id:4,expected_version:2});await tick();assert.equal(h.calls.length,1);const rejected=assert.rejects(pending,/请求超时.*确认结果/);h.expire(20000);await rejected;assert.equal(h.calls[0].init.signal.aborted,true);assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
});
test('caller abort is preserved during refresh and fetch; settled requests remove abort listeners',async()=>{
 const gate=deferred(),controller=new AbortController(),reason=new Error('caller navigation');const before=harness({ensure:()=>gate.promise});const pending=before.api.securityRequest(session(),{action:'policy',surface:'dashboard'},controller.signal);controller.abort(reason);const rejected=assert.rejects(pending,e=>e===reason);gate.resolve(session());await rejected;assert.equal(before.calls.length,0);assert.equal(before.timers.size,0);
 const active=harness({fetch:c=>waitForAbort(c.init.signal)}),second=new AbortController();const running=active.api.securityRequest(session(),{action:'list-rules',surface:'workorder'},second.signal);await tick();const stopped=assert.rejects(running,e=>e===reason);second.abort(reason);await stopped;assert.equal(active.timers.size,0);assert.equal(active.calls.length,1);
 const completed=harness(),third=new AbortController();let added=0,removed=0;const add=third.signal.addEventListener.bind(third.signal),remove=third.signal.removeEventListener.bind(third.signal);third.signal.addEventListener=(...args)=>{added++;return add(...args)};third.signal.removeEventListener=(...args)=>{removed++;return remove(...args)};await completed.api.securityRequest(session(),{action:'policy',surface:'workorder'},third.signal);assert.equal(added,1);assert.equal(removed,1);third.abort(reason);assert.equal(completed.calls[0].init.signal.aborted,false);assert.equal(completed.timers.size,0);
});
test('dashboard login, refresh and logout use exact gateway payloads and never use direct Supabase password login',async()=>{
 const old=session('owner',3600,'login'),fresh=session('owner',3600,'renewed'),h=harness();h.setFetch(c=>reply(c.body.action==='logout'?{ok:true}:{ok:true,tokens:c.body.action==='refresh'?fresh:old}));
 const logged=await h.auth.signInDashboard('  Owner-01  ','synthetic-password');assert.equal(logged.user.id,'owner');assert.deepEqual(h.calls[0].body,{action:'login',username:'owner-01',password:'synthetic-password'});assert(!('Authorization' in h.calls[0].init.headers));assert(!('apikey' in h.calls[0].init.headers));
 h.auth.saveDashboardSession({...logged,expires_at:Date.now()/1000+1});const renewed=await h.auth.ensureDashboardSession(logged);await h.auth.signOutDashboard(renewed);assert.deepEqual(h.calls.map(c=>c.body.action),['login','refresh','logout']);assert.deepEqual(h.calls[1].body,{action:'refresh',refresh_token:old.refresh_token});assert.deepEqual(h.calls[2].body,{action:'logout'});assert.equal(h.calls[2].init.headers.Authorization,'Bearer '+fresh.access_token);assert(h.calls.every(c=>c.url===gateway+'/api/dashboard-auth'&&c.init.redirect==='error'&&c.init.credentials==='omit'));assert.equal(h.timers.size,0);
 const invalid=harness();await assert.rejects(()=>invalid.auth.signInDashboard('not an account','synthetic-password'),/账号只能/);assert.equal(invalid.calls.length,0);
});
test('gateway login failures, ambiguous timeouts and malformed token results never fallback or automatically retry',async()=>{
 for(const result of [reply({ok:false,message:'denied'},403),reply({ok:false,message:'busy'},503),reply(session()),reply({ok:true,tokens:{access_token:'incomplete'}})]){const h=harness({fetch:()=>result});await assert.rejects(()=>h.auth.signInDashboard('owner','synthetic-password'));assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,gateway+'/api/dashboard-auth');assert.equal(h.timers.size,0)}
 const h=harness({fetch:c=>waitForAbort(c.init.signal)});const pending=h.auth.signInDashboard('owner','synthetic-password');await tick();const rejected=assert.rejects(pending,/登录服务响应超时/);h.expire(60000);await rejected;assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
});
