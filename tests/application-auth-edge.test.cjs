const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),ts=require('typescript');
const base=path.join(__dirname,'../supabase/functions');const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,Request,Response,Headers,URL,TextEncoder,TextDecoder,Uint8Array,atob,crypto:crypto.webcrypto,require:name=>load(path.resolve(path.dirname(file),name))},{filename:file});cache.set(file,mod.exports);return mod.exports;}
const{createApplicationAuthHandler}=load(path.join(base,'application-auth/handler.ts'));const{createSecurityAdminHandler}=load(path.join(base,'security-admin/handler.ts'));const{SecurityError}=load(path.join(base,'_shared/application-security.ts'));
const{parseAuthTokenResponse}=load(path.join(base,'application-auth/token-response.ts'));
const authTokenErrors=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/security/auth-token-error-shapes.json'),'utf8'));
const id='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222',key='unit-test-only-independent-proxy',hash=crypto.createHash('sha256').update(key).digest('hex'),token='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:id,session_id:sid})).toString('base64url')+'.signature';
function request(body,headers={}){return new Request('https://unit.test',{method:'POST',headers:{'content-type':'application/json','x-portal-proxy-key':key,'x-portal-client-ip':'203.0.113.7',authorization:'Bearer '+token,...headers},body:JSON.stringify(body)});}
function fixture(overrides={}){const calls=[],state={approved:true,ipAllowed:true,...overrides},tokens={access_token:token,refresh_token:'test-refresh',expires_at:100,expires_in:90,token_type:'bearer',user:{id}};const gateway={
 async begin(...a){calls.push(['begin',...a]);return{allowed:!state.locked,code:'account_locked',user_id:id,email:'worker@workorder.hensem.local'};},
 async password(...a){calls.push(['password',...a]);if(state.invalid)throw new SecurityError(401,'invalid_credentials','bad');if(state.unavailable)throw Error('PRIVATE');return tokens;},
 async finish(...a){calls.push(['finish',...a]);return{allowed:a[1]==='valid'&&!state.finishDenied,code:state.finishDenied?'account_locked':a[1]==='invalid'?(state.threshold?'account_locked':'invalid_credentials'):'ok'};},
 async refresh(...a){calls.push(['refresh',...a]);return tokens;},async getUser(...a){calls.push(['auth',...a]);return state.badUser?null:{id,email:'worker@workorder.hensem.local'};},
 async check(...a){calls.push(['check',...a]);return{allowed:state.approved,code:'application_session_denied'};},async ipCheck(...a){calls.push(['ip',...a]);return state.ipAllowed;},
 async me(surface){calls.push(['me']);return{ok:true,identity_kind:state.wrongIdentity?'dashboard_owner':surface,account:{permissions:{}},catalog:{}};},
 async revoke(...a){calls.push(['revoke',...a]);},async revokeAll(...a){calls.push(['revokeAll',...a]);},async signout(...a){calls.push(['signout',...a]);if(state.logoutUnavailable)throw Error('PRIVATE');}
 };return{handler:createApplicationAuthHandler(gateway,{proxyKeySha256:hash}),calls,state,gateway};}
const login={action:'login',surface:'workorder',username:'worker',password:'test-password'};
function authResponseFixture(response,options={}){
 const f=fixture(options);f.gateway.password=async(...args)=>{f.calls.push(['password',...args]);return parseAuthTokenResponse('password',response.status,response.body,100);};return f;
}
test('actual GoTrue numeric code and error_code shape records one password failure, never unavailable',async()=>{
 for(const surface of ['dashboard','workorder'])for(const response of [authTokenErrors.invalidCredentialsNumericCode,authTokenErrors.invalidCredentialsStringCode]){
  const f=authResponseFixture(response);const result=await f.handler(request({...login,surface}));
  assert.equal(result.status,401);assert.deepEqual(await result.json(),{ok:false,code:'invalid_credentials',message:'账号或密码不正确'});
  assert.equal(f.calls.filter(call=>call[0]==='password').length,1);assert.equal(f.calls.filter(call=>call[0]==='finish').length,1);
  assert.equal(f.calls.find(call=>call[0]==='finish')[2],'invalid');assert(!f.calls.some(call=>call[0]==='auth'||call[0]==='check'||call[0]==='me'));
 }
});
test('confirmed password failure still enforces threshold lockout',async()=>{
 const f=authResponseFixture(authTokenErrors.invalidCredentialsNumericCode,{threshold:true});const result=await f.handler(request(login));
 assert.equal(result.status,403);assert.equal((await result.json()).code,'account_locked');assert.equal(f.calls.find(call=>call[0]==='finish')[2],'invalid');
});
test('Auth rate limiting keeps 429 and finishes unavailable without a password failure',async()=>{
 const f=authResponseFixture(authTokenErrors.rateLimited);const result=await f.handler(request(login));assert.equal(result.status,429);
 assert.deepEqual(await result.json(),{ok:false,code:'auth_rate_limited',message:'登录请求过于频繁，请稍后再试'});
 assert.equal(f.calls.filter(call=>call[0]==='finish').length,1);assert.equal(f.calls.find(call=>call[0]==='finish')[2],'unavailable');assert(!f.calls.some(call=>call[0]==='auth'||call[0]==='me'));
});
test('only exact invalid_credentials with password grant and HTTP 400 or 401 is a password failure',async()=>{
 for(const response of [authTokenErrors.messageOnly,authTokenErrors.policyDenied,
  {status:400,body:{code:400,error_code:400,msg:'Invalid login credentials'}},
  {status:400,body:{code:'other_error',error_code:'INVALID_CREDENTIALS'}},
  {status:403,body:{error_code:'invalid_credentials'}},
  {status:422,body:{code:'invalid_credentials'}},
  {status:500,body:{code:'invalid_credentials'}},
  {status:503,body:{error_code:'invalid_credentials'}},
  {status:400,body:null},
 ]){
  const f=authResponseFixture(response);const result=await f.handler(request(login));assert.equal(result.status,503);
  assert.equal((await result.json()).code,'auth_unavailable');assert.equal(f.calls.find(call=>call[0]==='finish')[2],'unavailable');
 }
 for(const response of [authTokenErrors.invalidCredentialsNumericCode,authTokenErrors.invalidCredentialsStringCode]){
  assert.throws(()=>parseAuthTokenResponse('refresh_token',response.status,response.body),error=>error instanceof SecurityError&&error.code==='auth_unavailable');
 }
});
test('token parsing keeps expiry and identity and successful login still performs every security check',async()=>{
 const body={access_token:token,refresh_token:'synthetic-refresh',expires_in:90,user:{id,email:'synthetic@workorder.hensem.local'}};
 const parsed=parseAuthTokenResponse('password',200,body,100);assert.equal(parsed.expires_at,190);assert.equal(parsed.user.id,id);
 const f=authResponseFixture({status:200,body});const result=await f.handler(request(login));assert.equal(result.status,200);
 assert.equal(f.calls.filter(call=>call[0]==='auth').length,2);assert(f.calls.some(call=>call[0]==='check'));assert(f.calls.some(call=>call[0]==='ip'));assert(f.calls.some(call=>call[0]==='me'));
 assert.equal(f.calls.find(call=>call[0]==='finish')[2],'valid');
 for(const malformed of [null,{}, {...body,user:{}}, {...body,expires_in:'90'}])assert.throws(()=>parseAuthTokenResponse('password',200,malformed,100),/Invalid Auth result/);
});
test('only Worker proof and actual client IP enter auth; forged direct headers never reach credentials',async()=>{for(const headers of [{'x-portal-proxy-key':''},{'x-portal-proxy-key':'wrong'},{'x-portal-client-ip':'203.0.113.7, 1.1.1.1'},{'x-portal-client-ip':'','x-forwarded-for':'203.0.113.7'}]){const f=fixture();assert.equal((await f.handler(request(login,headers))).status,403);assert.equal(f.calls.length,0);}});
test('login registers only Auth verified gateway-issued session; returned tokens user is verified',async()=>{const f=fixture();const r=await(await f.handler(request(login))).json();assert.equal(r.ok,true);assert.equal(r.tokens.user.id,id);assert.equal(r.identity_kind,'workorder');assert.deepEqual(r.account.permissions,{});assert.deepEqual(f.calls.find(x=>x[0]==='finish').slice(2),['valid',sid]);assert(f.calls.find(x=>x[0]==='check'));});
test('invalid credential increments once, service failures are unavailable not failed passwords',async()=>{for(const unavailable of [false,true]){const f=fixture(unavailable?{unavailable:true}:{invalid:true,threshold:true});const r=await f.handler(request(login));assert.equal(r.status,unavailable?503:403);assert.equal(f.calls.filter(x=>x[0]==='finish').length,1);assert.equal(f.calls.find(x=>x[0]==='finish')[2],unavailable?'unavailable':'invalid');assert(!f.calls.some(x=>x[0]==='me'));assert(!await r.text().then(t=>t.includes('PRIVATE')));}});
test('locked account cannot invoke password endpoint; denied registration signs out issued token',async()=>{let f=fixture({locked:true});assert.equal((await f.handler(request(login))).status,403);assert(!f.calls.some(x=>x[0]==='password'));f=fixture({finishDenied:true});assert.equal((await f.handler(request(login))).status,403);assert(f.calls.some(x=>x[0]==='signout'));});
test('direct Auth refresh does not register session, me fresh checks fail locked or wrong identity',async()=>{for(const action of ['refresh','me']){const f=fixture({approved:false});assert.equal((await f.handler(request({action,surface:'workorder',refresh_token:'test'}))).status,403);assert(!f.calls.some(x=>x[0]==='finish'||x[0]==='me'));}assert.equal((await fixture({wrongIdentity:true}).handler(request({action:'me',surface:'workorder'}))).status,403);});
test('current IP restriction is checked separately from registered session',async()=>{const f=fixture({ipAllowed:false});assert.equal((await f.handler(request({action:'me',surface:'workorder'}))).status,403);assert(!f.calls.some(x=>x[0]==='me'));});
test('logout revokes first and tolerates Auth outage; logout-all cannot target different user',async()=>{for(const action of ['logout','logout-all']){const f=fixture({logoutUnavailable:true});const response=await f.handler(request({action,surface:'workorder',user_id:'forged'}));assert.equal(response.status,200);const name=action==='logout'?'revoke':'revokeAll';assert.equal(f.calls.find(c=>c[0]===name)[1],id);assert(f.calls.findIndex(c=>c[0]===name)<f.calls.findIndex(c=>c[0]==='signout'));assert.equal(f.calls.find(c=>c[0]==='signout')[2],action==='logout'?'local':'global');}});
test('security-admin forwards only verified actor/session and trusted IP; body spoofing cannot become authority',async()=>{const calls=[];const handler=createSecurityAdminHandler({getUser:async()=>({id}),admin:async(args)=>{calls.push(args);return{ok:true,policy:{version:1}};}},{proxyKeySha256:hash});let response=await handler(request({action:'policy',surface:'workorder',actor:'forged',session:'forged',ip:'198.51.100.1'}));assert.equal(response.status,200);assert.equal(calls[0].actor,id);assert.equal(calls[0].session,sid);assert.equal(calls[0].ip,'203.0.113.7');response=await handler(request({action:'policy',surface:'dashboard'},{authorization:'Bearer malformed'}));assert.equal(response.status,401);assert.equal(calls.length,1);});

test('current-IP account override checks only verified getUser identity, never a forged body user',async()=>{
  for(const surface of ['dashboard','workorder']){const f=fixture();const r=await f.handler(request({action:'me',surface,user_id:'forged',actor:'forged'}));assert.equal(r.status,200);assert.deepEqual(f.calls.find(c=>c[0]==='ip'),['ip',surface,'203.0.113.7',id]);}
});
test('per-account IP admin actions retain verified owner authority and account version fields',async()=>{
  for(const action of ['account-ip-rules','set-account-ip-mode','upsert-account-ip-rule','set-account-ip-rule-active','delete-account-ip-rule']){
    const calls=[];const h=createSecurityAdminHandler({getUser:async()=>({id}),admin:async args=>{calls.push(args);return{ok:true};}},{proxyKeySha256:hash});
    assert.equal((await h(request({action,surface:'dashboard',user_id:sid,expected_version:4,actor:sid,session:sid,ip:'198.51.100.7'}))).status,200);assert.equal(calls[0].actor,id);assert.equal(calls[0].session,sid);assert.equal(calls[0].body.user_id,sid);assert.equal(calls[0].body.expected_version,4);assert.equal(calls[0].ip,'203.0.113.7');
  }
});
test('trusted-proxy body parser rejects oversized bytes, invalid JSON, invalid UTF8 and nonobjects',async()=>{
  for(const [body,status] of [[' '.repeat(16385),413],['{',400],['null',400],['[]',400],[new Uint8Array([0xff,0xfe]),400]]){
    const f=fixture();const r=await f.handler(new Request('https://unit.test',{method:'POST',headers:{'content-type':'application/json','x-portal-proxy-key':key,'x-portal-client-ip':'203.0.113.7'},body}));assert.equal(r.status,status);assert.equal(f.calls.length,0);
  }
});
const{game66SyncAuthorized}=load(path.join(base,'sync-66game/authorization.ts'));
test('66GAME sync fails closed without dedicated secret, regardless of project JWT',()=>{
  const valid=new Request('https://unit.test',{headers:{authorization:'Bearer any-project-JWT','x-game66-sync-secret':'separate-secret'}});
  assert.equal(game66SyncAuthorized(valid,undefined),false);assert.equal(game66SyncAuthorized(valid,''),false);assert.equal(game66SyncAuthorized(valid,'different-secret'),false);assert.equal(game66SyncAuthorized(valid,'separate-secret'),true);assert.equal(game66SyncAuthorized(new Request('https://unit.test',{headers:{authorization:'Bearer any-project-JWT'}}),'separate-secret'),false);
});
