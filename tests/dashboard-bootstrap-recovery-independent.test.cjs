// Independent behavior regression: real auth/role/preview modules, synthetic sessions only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const fixture=fs.readFileSync(path.join(__dirname,'dashboard-bootstrap-client.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {setup,client,role,json,site}=new Function('require','__dirname',fixture+'\nreturn {setup,client,role,json,site};')(require,__dirname);
function reader(which,h,s,signal,observe){
 return which==='role'?client('dashboardRoleAccess',h).readDashboardRoleAccess(s,signal,observe):client('adminPreviewClient',h).adminPreviewRequest(s,'',{signal},observe);
}
function ok(which){return which==='role'?json(role):new Response('<html>synthetic verified preview</html>',{headers:{'Content-Type':'text/html'}});}
function reads(h){return h.calls.filter(c=>/\/api\/dashboard-(role-access|preview)$/.test(c.url));}
test('fixed role and preview reads refresh each recognized token 401 once on the identical target',async()=>{
 for(const which of ['role','preview'])for(const code of ['login_required','PGRST301','PGRST303','invalid_jwt','jwt_expired','token_expired']){
  const {h,s,r}=setup(),next=r.session('renewed'),seen=[];let count=0;
  h.setFetch(c=>{assert.equal(r.gatewayAction(c),'refresh');return r.json(next)});
  h.respond=async()=>++count===1?json({code},401):ok(which);
  const result=await reader(which,h,s,undefined,x=>seen.push(x.access_token));
  if(which==='role')assert.equal(result.canView,true);else assert.match(await result.text(),/verified preview/);
  const calls=reads(h);assert.equal(calls.length,2);assert.equal(h.refreshCalls().length,1);
  assert.equal(calls[0].url,calls[1].url);assert(calls.every(c=>c.url.startsWith(site+'/hensem-data-center/api/')));
  assert.equal(calls[0].headers.get('authorization'),'Bearer '+s.access_token);assert.equal(calls[1].headers.get('authorization'),'Bearer '+next.access_token);
  assert.equal(calls[0].body,calls[1].body);assert.equal(seen.at(-1),next.access_token);
 }
});
test('a second token 401 is terminal and never starts a second renewal',async()=>{
 for(const which of ['role','preview']){
  const {h,s,r}=setup();h.setFetch(()=>r.json(r.session('renewed')));h.respond=async()=>json({code:'login_required'},401);
  await assert.rejects(reader(which,h,s),e=>e.status===401);
  assert.equal(reads(h).length,2);assert.equal(h.refreshCalls().length,1);
 }
});
test('permission, account, application session, unknown 401, and temporary failures do not renew or replay',async()=>{
 for(const which of ['role','preview'])for(const [status,code]of [[403,'login_required'],[401,'account_disabled'],[401,'application_session_denied'],[401,'unknown'],[401,'42501'],[503,'login_required']]){
  const {h,s}=setup();h.respond=async()=>json({code,message:code==='42501'?'application_session_denied':'synthetic'},status);
  await assert.rejects(reader(which,h,s),e=>e.status===status);
  assert.equal(reads(h).length,1);assert.equal(h.refreshCalls().length,0);
 }
});
test('preview grants, writes, and unregistered query forms never replay even for a token 401',async()=>{
 for(const [query,init]of [['?action=grants',{}],['?action=grants',{method:'POST',body:'{}'}],['?action=access',{method:'POST',body:'{}'}],['?check=1&extra=1',{}],['',{method:'DELETE'}]]){
  const {h,s}=setup();h.respond=async()=>json({code:'login_required'},401);
  await assert.rejects(client('adminPreviewClient',h).adminPreviewRequest(s,query,init),e=>e.status===401);
  assert.equal(h.calls.length,1);assert.equal(h.refreshCalls().length,0);
  assert(h.calls[0].url.startsWith('https://supabase.offline.invalid/functions/v1/owner-admin-preview'));
 }
});
test('concurrent role and preview token failures share one renewal and use the same new token',async()=>{
 const {h,s,r}=setup(),next=r.session('shared'),gate=r.deferred(),signals=[new AbortController(),new AbortController()];
 h.setFetch(()=>gate.promise);h.respond=async(url,init)=>new Headers(init.headers).get('authorization')==='Bearer '+s.access_token?json({code:'login_required'},401):url.endsWith('role-access')?json(role):ok('preview');
 const pending=[reader('role',h,s,signals[0].signal),reader('preview',h,s,signals[1].signal)];
 await r.tick();assert.equal(h.refreshCalls().length,1);gate.resolve(r.json(next));await Promise.all(pending);
 assert.equal(h.refreshCalls().length,1);assert.equal(reads(h).length,4);
 assert(reads(h).slice(2).every(c=>c.headers.get('authorization')==='Bearer '+next.access_token));
 for(const signal of signals)assert.equal(reads(h).filter(c=>c.signal===signal.signal).length,2);
});
test('a late old-token 401 reuses an already saved new token without another renewal',async()=>{
 for(const which of ['role','preview']){
  const {h,s,r}=setup(),next=r.session('already-rotated'),late=r.deferred();let count=0;
  h.respond=async()=>++count===1?late.promise:ok(which);
  const pending=reader(which,h,s);await r.tick();h.api.saveDashboardSession(next);late.resolve(json({code:'token_expired'},401));
  await pending;assert.equal(h.refreshCalls().length,0);assert.equal(reads(h).length,2);
  assert.equal(reads(h)[1].headers.get('authorization'),'Bearer '+next.access_token);
 }
});
test('cancellation while a shared renewal is in flight forbids the replay without cancelling the other reader',async()=>{
 const {h,s,r}=setup(),next=r.session('shared'),gate=r.deferred(),cancel=new AbortController();
 h.setFetch(()=>gate.promise);h.respond=async(url,init)=>new Headers(init.headers).get('authorization')==='Bearer '+s.access_token?json({code:'invalid_jwt'},401):url.endsWith('role-access')?json(role):ok('preview');
 const cancelled=reader('role',h,s,cancel.signal);const rejected=assert.rejects(cancelled,e=>e.name==='AbortError');
 const surviving=reader('preview',h,s);await r.tick();cancel.abort();gate.resolve(r.json(next));await rejected;await surviving;
 assert.equal(h.refreshCalls().length,1);assert.equal(reads(h).filter(c=>c.url.endsWith('role-access')).length,1);
 assert.equal(reads(h).filter(c=>c.url.endsWith('preview')).length,2);assert.equal(h.saved().access_token,next.access_token);
});
test('account replacement during renewal cannot replay or overwrite the new account',async()=>{
 for(const which of ['role','preview']){
  const {h,s,r}=setup(),gate=r.deferred(),other=r.session('other',3600,r.B);
  h.setFetch(()=>gate.promise);h.respond=async()=>json({code:'login_required'},401);
  const pending=reader(which,h,s);const rejected=assert.rejects(pending,e=>e.code==='session_changed'||e.code==='session_logged_out');
  await r.tick();h.api.saveDashboardSession(other);gate.resolve(r.json(r.session('late-old-account')));await rejected;
  assert.equal(reads(h).length,1);assert.equal(h.saved().user.id,r.B);assert.equal(h.saved().access_token,other.access_token);
 }
});

// Deterministic elapsed-time tests run the real verification module. No wall-clock sleeps.
function budget(){
 const timers=new Map();let now=0,seq=0;const module={exports:{}};
 const schedule=(fn,ms)=>{const id=++seq;timers.set(id,{at:now+ms,fn});return id};
 const clear=id=>timers.delete(id);
 const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/ownerPreviewVerification.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{module,exports:module.exports,AbortController,Error,setTimeout:schedule,clearTimeout:clear});
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 const sleep=(ms,signal)=>new Promise((resolve,reject)=>{
  const abort=()=>{clear(id);signal?.removeEventListener('abort',abort);reject(Object.assign(Error('cancelled'),{name:'AbortError'}));};
  const id=schedule(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 });
 return{api:module.exports,timers,sleep,now:()=>now,async advance(ms){
  const until=now+ms;await flush();
  for(;;){const next=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next)break;
   timers.delete(next[0]);now=next[1].at;next[1].fn();await flush();
  }now=until;await flush();
 }};
}
test('same-origin role 8s plus protected preview/body 8s succeeds within one 45s budget',async()=>{
 const h=budget(),parent=new AbortController(),stages=[];let child,settled=false;
 const pending=h.api.ownerPreviewVerificationAttempt(async signal=>{child=signal;stages.push('role');await h.sleep(8000,signal);stages.push('preview-body');await h.sleep(8000,signal);return 'verified';},parent.signal,true).then(value=>{settled=true;return value});
 await h.advance(8000);assert.deepEqual(stages,['role','preview-body']);assert.equal(settled,false);
 await h.advance(7999);assert.equal(settled,false);assert.equal(child.aborted,false);
 await h.advance(1);assert.equal(await pending,'verified');assert.equal(h.now(),16000);assert(child.aborted);assert.equal(parent.signal.aborted,false);assert.equal(h.timers.size,0);
});
test('the same 8s plus 8s sequence still times out at 15s on the original direct transport',async()=>{
 const h=budget(),parent=new AbortController();let child;
 const pending=h.api.ownerPreviewVerificationAttempt(async signal=>{child=signal;await h.sleep(8000,signal);await h.sleep(8000,signal);return 'late';},parent.signal);
 const rejected=assert.rejects(pending,e=>e.code==='owner_preview_timeout');
 await h.advance(14999);assert.equal(child.aborted,false);await h.advance(1);await rejected;
 assert(child.aborted);assert.equal(h.now(),15000);assert.equal(h.timers.size,0);
});
test('a stalled bootstrap remains bounded at 45s and invalidates late results',async()=>{
 const h=budget(),parent=new AbortController();let child,resolve,displayed=false;
 const pending=h.api.ownerPreviewVerificationAttempt(async signal=>{child=signal;return new Promise(r=>resolve=r)},parent.signal,true).then(()=>{displayed=true});
 const rejected=assert.rejects(pending,e=>e.code==='owner_preview_timeout');
 await h.advance(15000);assert.equal(child.aborted,false);await h.advance(29999);assert.equal(child.aborted,false);
 await h.advance(1);await rejected;assert(child.aborted);assert.equal(parent.signal.aborted,false);resolve('late protected content');await h.advance(0);
 assert.equal(displayed,false);assert.equal(h.timers.size,0);
});
test('role, renewal, replay and body share the original deadline instead of restarting it',async()=>{
 const h=budget(),parent=new AbortController(),stages=[];let child;
 const pending=h.api.ownerPreviewVerificationAttempt(async signal=>{
  child=signal;for(const [name,ms]of [['role',8000],['preview-401',8000],['renew',8000],['replay-body',22000]]){stages.push(name);await h.sleep(ms,signal);}return 'too late';
 },parent.signal,true);
 const rejected=assert.rejects(pending,e=>e.code==='owner_preview_timeout');
 await h.advance(24000);assert.deepEqual(stages,['role','preview-401','renew','replay-body']);assert.equal(child.aborted,false);
 await h.advance(20999);assert.equal(child.aborted,false);await h.advance(1);await rejected;assert.equal(h.now(),45000);assert(child.aborted);assert.equal(h.timers.size,0);
});
test('parent cancellation removes the bootstrap budget and never starts remaining stages',async()=>{
 const h=budget(),parent=new AbortController(),stages=[];
 const pending=h.api.ownerPreviewVerificationAttempt(async signal=>{stages.push('role');await h.sleep(8000,signal);stages.push('preview');return 'unexpected';},parent.signal,true);
 const rejected=assert.rejects(pending,e=>e.name==='AbortError');
 await h.advance(4000);parent.abort();await rejected;await h.advance(45000);assert.deepEqual(stages,['role']);assert.equal(h.timers.size,0);
});
