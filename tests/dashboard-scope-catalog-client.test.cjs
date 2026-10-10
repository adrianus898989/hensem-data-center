const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {root,loadTs}=require('./load-typescript.cjs');
const scope=loadTs(path.join(root,'src/lib/dashboardDataScope.ts'));
const session={user:{id:'scope-admin'},access_token:'fixture-token'};
const body={version:1,platforms:[{country:'IN',platform:'91CLUB',label:'91CLUB',name:'91CLUB',source:'AR'}]};
const flush=()=>new Promise(r=>setImmediate(r));
function harness(options={}){
 const mod={exports:{}},calls=[],timers=new Map();let saved=session,seq=0;
 const code=ts.transpileModule(fs.readFileSync(path.join(root,'src/lib/dashboardScopeCatalogClient.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(code,{module:mod,exports:mod.exports,URL,DOMException,AbortController,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-public'}},setTimeout:(fn,delay)=>{const id=++seq;timers.set(id,{fn,delay});return id},clearTimeout:id=>timers.delete(id),fetch:async(url,init)=>{calls.push({url,init});return options.fetch?options.fetch(url,init):new Response(JSON.stringify(body));},require:name=>name.endsWith('dashboardDataScope')?scope:{readSavedDashboardSession:()=>saved,ensureDashboardSession:options.ensure|| (async value=>value)}});
 return {...mod.exports,calls,timers,saved:value=>{saved=value}};
}
test('platform catalog uses authenticated no-store RPC and returns only reviewed identity fields',async()=>{
 const h=harness(),result=await h.readDashboardScopeCatalog(session);assert.deepEqual(JSON.parse(JSON.stringify(result)),body.platforms.map(({name,...row})=>row));assert.equal(h.calls[0].url,'https://fixture.supabase.co/rest/v1/rpc/dashboard_account_data_scope_catalog');assert.equal(h.calls[0].init.body,'{}');assert.equal(h.calls[0].init.cache,'no-store');assert.equal(h.calls[0].init.redirect,'error');assert.equal(h.calls[0].init.credentials,'omit');assert.equal(h.calls[0].init.headers.Authorization,'Bearer fixture-token');assert.equal(h.timers.size,0);
});
test('malformed, ambiguous or unknown platform identity fails closed while same name in another country stays distinct',()=>{
 const h=harness();for(const row of [{country:'unknown',platform:'A',label:'A'},{country:'IN',platform:' a ',label:'A'},{country:'IN',platform:'A\n',label:'A'},{country:'IN',platform:'A'},{country:'IN',platform:'A'.repeat(201),label:'A'}])assert.throws(()=>h.validateDashboardScopeCatalog({version:1,platforms:[row]}),/平台目录/);
 assert.throws(()=>h.validateDashboardScopeCatalog({...body,platforms:[...body.platforms,...body.platforms]}),/重复/);assert.throws(()=>h.validateDashboardScopeCatalog({version:2,platforms:[]}),/返回不完整/);
 assert.equal(h.validateDashboardScopeCatalog({...body,platforms:[...body.platforms,{country:'BR',platform:'91CLUB',label:'91CLUB'}]}).length,2);
});
test('actor change during refresh prevents catalog dispatch',async()=>{
 let resolve;const h=harness({ensure:()=>new Promise(r=>resolve=r)}),pending=h.readDashboardScopeCatalog(session);h.saved({user:{id:'different'}});resolve(session);await assert.rejects(pending,/登录账号已改变/);assert.equal(h.calls.length,0);assert.equal(h.timers.size,0);
});
test('actor change during catalog HTTP discards response',async()=>{
 let resolve;const h=harness({fetch:()=>new Promise(r=>resolve=r)}),pending=h.readDashboardScopeCatalog(session);await flush();h.saved(null);resolve(new Response(JSON.stringify(body)));await assert.rejects(pending,/登录账号已改变/);assert.equal(h.timers.size,0);
});
test('whole request deadline settles a hanging session refresh without later dispatch',async()=>{
 let resolve;const h=harness({ensure:()=>new Promise(r=>resolve=r)}),pending=h.readDashboardScopeCatalog(session);for(const t of [...h.timers.values()]){assert.equal(t.delay,15000);t.fn();}await assert.rejects(pending,/超时/);resolve(session);await flush();assert.equal(h.calls.length,0);assert.equal(h.timers.size,0);
});
test('parent cancellation settles non-abortable catalog/body wait and discards late content',async()=>{
 let resolve;const c=new AbortController(),h=harness({fetch:()=>new Promise(r=>resolve=r)}),pending=h.readDashboardScopeCatalog(session,c.signal);await flush();c.abort();await assert.rejects(pending,e=>e.name==='AbortError');resolve(new Response(JSON.stringify(body)));await flush();assert.equal(h.timers.size,0);assert.equal(h.calls[0].init.signal.aborted,true);
});
test('forbidden and failed reads never return an unverified list',async()=>{
 for(const status of [401,403,500]){const h=harness({fetch:async()=>new Response(JSON.stringify(body),{status})});await assert.rejects(h.readDashboardScopeCatalog(session),/权限|读取失败/);assert.equal(h.timers.size,0);}
});
