// Read-only execution of the actual auth client in isolated browser-like VMs.
// All sessions are synthetic and fetch is always stubbed; no external writes.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const repo = path.resolve(__dirname, '..');
const sourcePath = process.env.AUTH_CLIENT_PATH || path.join(repo, 'src/lib/dashboardAuthClient.ts');
const ts = require(path.join(repo, 'node_modules/typescript'));
const code = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022},
}).outputText;
const SESSION_KEY = 'hensem:dashboard:auth-session:v2';
const START = Date.parse('2026-09-11T12:00:00.000Z');
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const clone = value => JSON.parse(JSON.stringify(value));
const json = (body, status=200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}});
const deferred = () => {let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const tick = () => new Promise(resolve => setImmediate(resolve));
function session(label='old', seconds=3600, userId=A) {
  return {access_token:'offline-access-'+label,refresh_token:'offline-refresh-'+label,
    expires_at:START/1000+seconds,expires_in:seconds,user:{id:userId}};
}
function storageGroup(withLocks=false) {
  const group={values:new Map(),windows:new Set(),lockNames:[]};
  if(withLocks){const chains=new Map();group.locks={request(name,_options,callback){group.lockNames.push(name);
    const previous=chains.get(name)||Promise.resolve();
    const result=previous.catch(()=>{}).then(callback);chains.set(name,result);return result;
  }};}
  return group;
}
function harness(group=storageGroup()) {
  let clock=START, implementation=async()=>{throw new Error('Unexpected synthetic fetch');};
  const calls=[], events=[];
  class FakeDate extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
  class CustomEventShim extends Event {constructor(type, init={}){super(type);this.detail=init.detail;}}
  const window = new EventTarget();
  window.location={origin:'https://hensem.offline.invalid',href:'https://hensem.offline.invalid/'};
  window.setTimeout=setTimeout;window.clearTimeout=clearTimeout;
  window.setInterval=setInterval;window.clearInterval=clearInterval;
  window.localStorage={
    getItem:key=>group.values.get(String(key))??null,
    setItem(key,value){key=String(key);const oldValue=group.values.get(key)??null;group.values.set(key,String(value));
      for(const other of group.windows)if(other!==window){const event=new Event('storage');Object.assign(event,{key,oldValue,newValue:String(value),storageArea:other.localStorage});other.dispatchEvent(event);}},
    removeItem(key){key=String(key);const oldValue=group.values.get(key)??null;group.values.delete(key);
      for(const other of group.windows)if(other!==window){const event=new Event('storage');Object.assign(event,{key,oldValue,newValue:null,storageArea:other.localStorage});other.dispatchEvent(event);}},
  };
  group.windows.add(window);
  const rawDispatch=window.dispatchEvent.bind(window);
  window.dispatchEvent=event=>{events.push(event);return rawDispatch(event);};
  const box={exports:{}};
  const fetch=async(url,init={})=>{const call={url:String(url),method:String(init.method||'GET').toUpperCase(),headers:new Headers(init.headers),body:init.body,signal:init.signal};calls.push(call);return implementation(call);};
  const context={module:box,exports:box.exports,window,localStorage:window.localStorage,navigator:{locks:group.locks},
    document:{visibilityState:'visible'},fetch,Date:FakeDate,URL,URLSearchParams,Headers,Request,Response,
    AbortController,AbortSignal,DOMException,Event,EventTarget,CustomEvent:CustomEventShim,
    setTimeout,clearTimeout,setInterval,clearInterval,atob,btoa,TextEncoder,TextDecoder,console,
    process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://supabase.offline.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'offline-public-key'}}};
  vm.runInNewContext(code,context,{filename:sourcePath});
  const clientCache=new Map();
  function loadClient(name){
    if(name==='dashboardAuthClient')return box.exports;
    if(clientCache.has(name))return clientCache.get(name);
    assert.match(name,/^[A-Za-z][A-Za-z0-9]+$/);
    const clientPath=path.join(repo,'src/lib',name+'.ts'),clientModule={exports:{}};
    const clientCode=ts.transpileModule(fs.readFileSync(clientPath,'utf8'),{
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
    }).outputText;
    const requireClient=specifier=>{assert.match(specifier,/^\.\/[A-Za-z][A-Za-z0-9]+$/);return loadClient(specifier.slice(2));};
    vm.runInNewContext(clientCode,{...context,module:clientModule,exports:clientModule.exports,require:requireClient},{filename:clientPath});
    clientCache.set(name,clientModule.exports);return clientModule.exports;
  }
  return {api:box.exports,calls,events,window,group,
    loadClient,
    now:()=>clock,advance:ms=>{clock+=ms;},setFetch:fn=>{implementation=fn;},
    saved:()=>{const raw=group.values.get(SESSION_KEY);return raw?JSON.parse(raw):null;},
    refreshCalls:()=>calls.filter(c=>c.url.includes('grant_type=refresh_token')),
    dataCalls:()=>calls.filter(c=>!c.url.includes('/auth/v1/token'))};
}
const tests=[];
function test(name,fn){tests.push([name,fn]);}
const dataURL='https://supabase.offline.invalid/rest/v1/offline_table';

test('near-expiry concurrent requests share one refresh and use the same new token',async()=>{
  const h=harness(),old=session('old',5),next=session('fresh');h.api.saveDashboardSession(old);
  const gate=deferred();h.setFetch(call=>call.url.includes('grant_type=refresh_token')?gate.promise:json([]));
  const pending=Array.from({length:5},()=>h.api.dashboardAuthenticatedFetch(dataURL,{method:'GET'},old));
  await tick();assert.equal(h.refreshCalls().length,1);
  gate.resolve(json(next));await Promise.all(pending);
  assert.equal(h.dataCalls().length,5);
  assert.ok(h.dataCalls().every(c=>c.headers.get('authorization')==='Bearer '+next.access_token));
  assert.equal(h.saved().access_token,next.access_token);
});
test('fresh session avoids unnecessary refresh',async()=>{
  const h=harness(),old=session();h.api.saveDashboardSession(old);h.setFetch(()=>json([]));
  assert.equal((await h.api.ensureDashboardSession(old)).access_token,old.access_token);
  assert.equal(h.calls.length,0);
});
test('403 does not trigger refresh or retry',async()=>{
  const h=harness(),old=session();h.api.saveDashboardSession(old);h.setFetch(()=>json({message:'forbidden'},403));
  const response=await h.api.dashboardAuthenticatedFetch(dataURL,{},old);
  assert.equal(response.status,403);assert.equal(h.dataCalls().length,1);assert.equal(h.refreshCalls().length,0);
  assert.equal(h.saved().access_token,old.access_token);
});
test('GET 401 refreshes once and retries once with updated authorization',async()=>{
  const h=harness(),old=session(),next=session('fresh');h.api.saveDashboardSession(old);
  h.setFetch(call=>call.url.includes('grant_type=refresh_token')?json(next):
    call.headers.get('authorization')==='Bearer '+old.access_token?json({message:'expired'},401):json([]));
  assert.equal((await h.api.dashboardAuthenticatedFetch(dataURL,{},old)).status,200);
  assert.equal(h.refreshCalls().length,1);assert.equal(h.dataCalls().length,2);
});
test('concurrent GET 401 responses share one refresh, including a late old-token response',async()=>{
  const h=harness(),old=session(),next=session('fresh'),gate=deferred(),late=deferred();h.api.saveDashboardSession(old);
  let oldRequests=0;
  h.setFetch(call=>call.url.includes('grant_type=refresh_token')?gate.promise:
    call.headers.get('authorization')==='Bearer '+old.access_token?
      (++oldRequests===3?late.promise:json({message:'expired'},401)):json([]));
  const pending=Array.from({length:3},()=>h.api.dashboardAuthenticatedFetch(dataURL,{},old));
  await tick();assert.equal(h.refreshCalls().length,1);
  gate.resolve(json(next));await tick();late.resolve(json({message:'late expired'},401));
  const results=await Promise.all(pending);
  assert.ok(results.every(response=>response.status===200));
  assert.equal(h.refreshCalls().length,1);assert.equal(h.dataCalls().length,6);
});
test('a second GET 401 stops instead of entering a refresh loop',async()=>{
  const h=harness(),old=session();h.api.saveDashboardSession(old);
  h.setFetch(call=>call.url.includes('grant_type=refresh_token')?json(session('fresh')):json({message:'still unauthorized'},401));
  const result=await h.api.dashboardAuthenticatedFetch(dataURL,{},old).catch(error=>error);
  assert.ok(result instanceof Error||result.status===401);
  assert.equal(h.refreshCalls().length,1);assert.equal(h.dataCalls().length,2);
});
test('POST 401 never automatically replays the mutation',async()=>{
  const h=harness(),old=session();h.api.saveDashboardSession(old);
  h.setFetch(call=>call.url.includes('grant_type=refresh_token')?json(session('fresh')):json({message:'expired'},401));
  await h.api.dashboardAuthenticatedFetch(dataURL,{method:'POST',body:'{"reason":"synthetic"}'},old).catch(()=>null);
  assert.equal(h.dataCalls().length,1);assert.equal(h.dataCalls()[0].method,'POST');
});
test('POST may proactively refresh before sending, but is still sent only once',async()=>{
  const h=harness(),old=session('old',5),next=session('fresh');h.api.saveDashboardSession(old);
  h.setFetch(call=>call.url.includes('grant_type=refresh_token')?json(next):json([]));
  await h.api.dashboardAuthenticatedFetch(dataURL,{method:'POST',body:'{"reason":"synthetic"}'},old);
  assert.equal(h.refreshCalls().length,1);assert.equal(h.dataCalls().length,1);
  assert.equal(h.dataCalls()[0].headers.get('authorization'),'Bearer '+next.access_token);
});
for(const [label,failure]of [['network',()=>Promise.reject(new TypeError('synthetic offline'))],['5xx',()=>json({message:'temporary'},503)]]){
  test(label+' refresh failure preserves the current session',async()=>{
    const h=harness(),old=session('old',5);h.api.saveDashboardSession(old);h.setFetch(failure);
    await assert.rejects(()=>h.api.ensureDashboardSession(old));
    assert.equal(h.saved().refresh_token,old.refresh_token);
  });
  test(label+' business read failure does not clear the session',async()=>{
    const h=harness(),old=session();h.api.saveDashboardSession(old);h.setFetch(failure);
    await h.api.dashboardAuthenticatedFetch(dataURL,{},old).catch(()=>null);
    assert.equal(h.saved().refresh_token,old.refresh_token);assert.equal(h.refreshCalls().length,0);
  });
}
test('definitively invalid refresh token clears that session',async()=>{
  const h=harness(),old=session('old',5);h.api.saveDashboardSession(old);
  h.setFetch(()=>json({code:'refresh_token_not_found',error_code:'refresh_token_not_found',msg:'Invalid Refresh Token: Refresh Token Not Found'},400));
  await assert.rejects(()=>h.api.ensureDashboardSession(old));assert.equal(h.saved(),null);
});
test('malformed successful refresh response is rejected without losing the saved session',async()=>{
  const h=harness(),old=session('old',5);h.api.saveDashboardSession(old);
  h.setFetch(()=>json({access_token:'offline-incomplete-response'}));
  await assert.rejects(()=>h.api.ensureDashboardSession(old));
  assert.equal(h.saved().refresh_token,old.refresh_token);
});
test('refresh response from another user cannot replace the current account',async()=>{
  const h=harness(),old=session('old',5);h.api.saveDashboardSession(old);
  h.setFetch(()=>json(session('wrong-user',3600,B)));
  await assert.rejects(()=>h.api.ensureDashboardSession(old));
  assert.notEqual(h.saved()?.user.id,B);
});
test('logout during refresh cannot resurrect the old account',async()=>{
  const h=harness(),old=session('old',5),gate=deferred();h.api.saveDashboardSession(old);h.setFetch(()=>gate.promise);
  const pending=h.api.ensureDashboardSession(old);await tick();h.api.saveDashboardSession(null);
  gate.resolve(json(session('fresh')));await assert.rejects(()=>pending);
  assert.equal(h.saved(),null);
});
test('account switch during refresh cannot overwrite or silently use the new account',async()=>{
  const h=harness(),old=session('old',5),other=session('other',3600,B),gate=deferred();
  h.api.saveDashboardSession(old);h.setFetch(()=>gate.promise);
  const pending=h.api.ensureDashboardSession(old);await tick();h.api.saveDashboardSession(other);
  gate.resolve(json(session('fresh')));await assert.rejects(()=>pending);
  assert.equal(h.saved().user.id,B);assert.equal(h.saved().access_token,other.access_token);
});
test('a stale caller from a different account is rejected before business fetch',async()=>{
  const h=harness(),old=session('old',5),other=session('other',3600,B);h.api.saveDashboardSession(other);h.setFetch(()=>json([]));
  await assert.rejects(()=>h.api.dashboardAuthenticatedFetch(dataURL,{},old));assert.equal(h.calls.length,0);
});
test('another tab latest token is reused instead of refreshing its stale predecessor',async()=>{
  const group=storageGroup(),a=harness(group),b=harness(group),old=session('old',5),next=session('other-tab');
  a.api.saveDashboardSession(old);b.api.saveDashboardSession(next);
  a.setFetch(()=>json([]));
  const result=await a.api.ensureDashboardSession(old);
  assert.equal(result.access_token,next.access_token);assert.equal(a.refreshCalls().length,0);
  await a.api.dashboardAuthenticatedFetch(dataURL,{},old);
  assert.equal(a.dataCalls()[0].headers.get('authorization'),'Bearer '+next.access_token);
});
test('two tabs with Web Locks rotate once without exposing tokens in lock names',async()=>{
  const group=storageGroup(true),a=harness(group),b=harness(group),old=session('old',5),gate=deferred();
  a.api.saveDashboardSession(old);a.setFetch(()=>gate.promise);b.setFetch(()=>{throw new Error('second tab must reuse the first rotation');});
  const first=a.api.ensureDashboardSession(old),second=b.api.ensureDashboardSession(old);
  await tick();assert.equal(a.refreshCalls().length+b.refreshCalls().length,1);
  gate.resolve(json(session('shared-fresh')));
  const results=await Promise.all([first,second]);
  assert.ok(results.every(value=>value.access_token==='offline-access-shared-fresh'));
  assert.equal(a.refreshCalls().length+b.refreshCalls().length,1);
  assert.ok(group.lockNames.every(name=>!name.includes(old.access_token)&&!name.includes(old.refresh_token)));
});
test('newer same-account tab refresh result cannot be overwritten by an older in-flight result',async()=>{
  const group=storageGroup(),a=harness(group),b=harness(group),old=session('old',5),next=session('newer-tab'),gate=deferred();
  a.api.saveDashboardSession(old);a.setFetch(()=>gate.promise);
  const pending=a.api.ensureDashboardSession(old);await tick();b.api.saveDashboardSession(next);
  gate.resolve(json(session('late-old-request')));await pending.catch(()=>null);
  assert.equal(a.saved().access_token,next.access_token);
});
test('invalid old refresh result cannot clear a newly switched account',async()=>{
  const h=harness(),old=session('old',5),other=session('other',3600,B),gate=deferred();
  h.api.saveDashboardSession(old);h.setFetch(()=>gate.promise);
  const pending=h.api.ensureDashboardSession(old);await tick();h.api.saveDashboardSession(other);
  gate.resolve(json({error_code:'refresh_token_not_found',msg:'Invalid Refresh Token'},400));
  await pending.catch(()=>null);assert.equal(h.saved().user.id,B);
});
test('expires_in is anchored when saved, not rebased on every read',async()=>{
  const h=harness(),old=session();delete old.expires_at;h.api.saveDashboardSession(old);
  h.setFetch(()=>json(session('fresh')));
  h.advance(100000);assert.equal((await h.api.ensureDashboardSession(old)).access_token,old.access_token);
  h.advance(3495000);assert.equal((await h.api.ensureDashboardSession(old)).access_token,'offline-access-fresh');
  assert.equal(h.refreshCalls().length,1);
});
test('JWT exp supplies expiry when explicit expiry fields are absent',async()=>{
  const h=harness(),old=session();delete old.expires_at;delete old.expires_in;
  old.access_token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+
    Buffer.from(JSON.stringify({sub:A,exp:START/1000+3600})).toString('base64url')+'.offline-signature';
  h.api.saveDashboardSession(old);h.setFetch(()=>json(session('fresh')));
  assert.equal((await h.api.ensureDashboardSession(old)).access_token,old.access_token);
  h.advance(3595000);await h.api.ensureDashboardSession(old);assert.equal(h.refreshCalls().length,1);
});
test('opaque legacy token with unknown expiry uses a single GET 401 refresh fallback',async()=>{
  const h=harness(),old=session();delete old.expires_at;delete old.expires_in;h.api.saveDashboardSession(old);
  h.setFetch(call=>call.url.includes('grant_type=refresh_token')?json(session('fresh')):
    call.headers.get('authorization')==='Bearer '+old.access_token?json({message:'expired'},401):json([]));
  const result=await h.api.ensureDashboardSession(old);
  assert.equal(result.access_token,old.access_token);assert.equal(h.refreshCalls().length,0);
  assert.equal((await h.api.dashboardAuthenticatedFetch(dataURL,{},old)).status,200);
  assert.equal(h.refreshCalls().length,1);assert.equal(h.dataCalls().length,2);
});
test('logout still permits a fresh interactive login before it is saved',async()=>{
  const h=harness(),next=session('new-login');h.api.saveDashboardSession(session());h.api.saveDashboardSession(null);
  h.setFetch(call=>call.url.includes('grant_type=password')?json(next):json([]));
  const signedIn=await h.api.signInDashboard('offline-user','offline-password');
  assert.equal((await h.api.ensureDashboardSession(signedIn)).access_token,next.access_token);
  assert.equal((await h.api.dashboardAuthenticatedFetch(dataURL,{},signedIn)).status,200);
  assert.equal(h.refreshCalls().length,0);
});
test('once a fresh login has been saved and logged out its old object cannot revive it',async()=>{
  const h=harness(),next=session('new-login');h.setFetch(()=>json(next));
  const signedIn=await h.api.signInDashboard('offline-user','offline-password');
  h.api.saveDashboardSession(signedIn);h.api.saveDashboardSession(null);
  const before=h.calls.length;
  await assert.rejects(()=>h.api.dashboardAuthenticatedFetch(dataURL,{},signedIn));
  assert.equal(h.calls.length,before);assert.equal(h.saved(),null);
});
test('an unsaved login returned before a later logout cannot bypass that logout',async()=>{
  const h=harness();h.setFetch(()=>json(session('pending-login')));
  const signedIn=await h.api.signInDashboard('offline-user','offline-password');
  h.api.saveDashboardSession(null);const before=h.calls.length;
  await assert.rejects(()=>h.api.dashboardAuthenticatedFetch(dataURL,{},signedIn));
  assert.equal(h.calls.length,before);assert.equal(h.saved(),null);
});
for(const forbidden of ['https://other.offline.invalid/rest/v1/table','http://supabase.offline.invalid/rest/v1/table','https://user@supabase.offline.invalid/rest/v1/table']){
  test('credentials are never sent to unapproved target '+forbidden,async()=>{
    const h=harness(),old=session();h.api.saveDashboardSession(old);h.setFetch(()=>json([]));
    await assert.rejects(()=>h.api.dashboardAuthenticatedFetch(forbidden,{},old));assert.equal(h.calls.length,0);
  });
}
test('session event is emitted for a refreshed session',async()=>{
  const h=harness(),old=session('old',5);h.api.saveDashboardSession(old);
  assert.equal(typeof h.api.DASHBOARD_SESSION_EVENT,'string');
  h.events.length=0;h.setFetch(()=>json(session('fresh')));await h.api.ensureDashboardSession(old);
  assert.ok(h.events.some(event=>event.type===h.api.DASHBOARD_SESSION_EVENT));
});
test('actual notes, reasons, AR config and Panda config clients share the same refresh',async()=>{
  const h=harness(),old=session('old',5),gate=deferred();h.api.saveDashboardSession(old);
  const notes=h.loadClient('autoWithdrawNotesClient'),reasons=h.loadClient('autoWithdrawReasonsClient');
  const ar=h.loadClient('arAutoWithdrawConfigClient'),panda=h.loadClient('pandaAutoWithdrawConfigClient');
  h.setFetch(call=>call.url.includes('grant_type=refresh_token')?gate.promise:json([]));
  const signal=new AbortController().signal;
  const pending=Promise.all([
    notes.listAutoWithdrawNotes(old,'2026-09-09','2026-09-09'),
    reasons.getAutoWithdrawReasons(old,{date:'2026-09-09',country:'IN',platform:'TPPLAY'},signal),
    ar.fetchConfigIndex(old,signal),panda.fetchPandaConfigIndex(old,signal),
  ]);
  await tick();assert.equal(h.refreshCalls().length,1);gate.resolve(json(session('shared-clients')));
  const result=await pending;assert.equal(result[0].length,0);assert.equal(result[1],null);
  assert.equal(result[2].targets.length,0);assert.equal(result[3].targets.length,0);
  assert.equal(h.dataCalls().length,6);
  assert.ok(h.dataCalls().every(call=>call.headers.get('authorization')==='Bearer offline-access-shared-clients'));
});
test('actual note save preserves one POST even after a 401 response',async()=>{
  const h=harness(),old=session();h.api.saveDashboardSession(old);const notes=h.loadClient('autoWithdrawNotesClient');
  h.setFetch(()=>json({message:'synthetic expired'},401));
  await assert.rejects(()=>notes.saveAutoWithdrawNote(old,{date:'2026-09-09',country:'印度',platform:'TPPLAY',reason:'synthetic reason'}));
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].method,'POST');
});

(async()=>{
  let passed=0;const failed=[];
  for(const [name,run]of tests){try{await run();passed++;}catch(error){failed.push({name,error:error.message});}}
  console.log(JSON.stringify({passed,total:tests.length,failed,source:path.relative(repo,sourcePath),realNetwork:false,siteEdits:false}));
  if(failed.length)process.exitCode=1;
})();
