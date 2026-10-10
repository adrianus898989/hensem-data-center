// Actual Auth parser/handler execution with synthetic sessions and local mocks.
// Supabase's documented machine codes, not a proxy HTTP status, prove expiry.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),ts=require('typescript');
const base=path.join(__dirname,'../supabase/functions'),cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {module:mod,exports:mod.exports,Request,Response,Headers,URL,TextEncoder,TextDecoder,Uint8Array,atob,crypto:crypto.webcrypto,require:name=>load(path.resolve(path.dirname(file),name))},{filename:file});
 cache.set(file,mod.exports);return mod.exports;}
const {parseAuthTokenResponse}=load(path.join(base,'application-auth/token-response.ts'));
const {createApplicationAuthHandler}=load(path.join(base,'application-auth/handler.ts'));
const {SecurityError}=load(path.join(base,'_shared/application-security.ts'));
const id='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222';
const proof='synthetic-refresh-proxy-proof',hash=crypto.createHash('sha256').update(proof).digest('hex');
const token='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:id,session_id:sid})).toString('base64url')+'.synthetic-signature';
const success={access_token:token,refresh_token:'synthetic-rotated-token',expires_in:90,user:{id}};
function fixture(response,options={}){
 const calls=[],gateway={
  async refresh(){calls.push('refresh');return parseAuthTokenResponse('refresh_token',response.status,response.body,100);},
  async getUser(){calls.push('auth');return {id};},
  async check(){calls.push('check');return {allowed:options.approved!==false,code:'application_session_denied'};},
  async ipCheck(){calls.push('ip');return options.ipAllowed!==false;},
  async me(surface){calls.push('me');return {ok:true,identity_kind:surface};},
 };
 const handler=createApplicationAuthHandler(gateway,{proxyKeySha256:hash});
 return {calls,read:()=>handler(new Request('https://synthetic.invalid',{method:'POST',headers:{'content-type':'application/json',
  'x-portal-proxy-key':proof,'x-portal-client-ip':'203.0.113.7'},body:JSON.stringify({action:'refresh',surface:'dashboard',refresh_token:'synthetic-refresh'})}))};
}
test('exact session/account terminal codes retain login_required and never proceed to authorization',async()=>{
 for(const code of ['refresh_token_not_found','refresh_token_already_used','session_not_found','session_expired','user_banned','user_not_found'])
  for(const status of [400,401,403])for(const body of [{code},{code:status,error_code:code}]){
   const f=fixture({status,body}),result=await f.read();
   assert.equal(result.status,401);assert.deepEqual(await result.json(),{ok:false,code:'login_required',message:'登录已失效'});
   assert.deepEqual(f.calls,['refresh']);
  }
});
test('unknown, malformed and transient 400/401/403 responses fail closed without declaring the session revoked',async()=>{
 for(const status of [400,401,403])for(const body of [null,'<html>synthetic-private-outage</html>',[],{},
  {code:status},{code:'invalid_credentials'},{error_code:'conflict'},{error_code:'request_timeout'},
  {error_code:'REFRESH_TOKEN_NOT_FOUND'},{error_code:'unknown',code:'refresh_token_not_found'}]){
  const f=fixture({status,body}),result=await f.read();
  assert.equal(result.status,503);assert.deepEqual(await result.json(),{ok:false,code:'auth_unavailable',message:'登录服务暂时不可用'});
  assert.deepEqual(f.calls,['refresh']);
 }
});
test('rate limiting and server outages cannot become token expiry even with a contradictory terminal code',()=>{
 for(const status of [409,422,500,503])assert.throws(()=>parseAuthTokenResponse('refresh_token',status,{error_code:'session_expired'}),
  error=>error instanceof SecurityError&&error.status===503&&error.code==='auth_unavailable');
 assert.throws(()=>parseAuthTokenResponse('refresh_token',429,{error_code:'session_expired'}),
  error=>error instanceof SecurityError&&error.status===429&&error.code==='auth_rate_limited');
});
test('confirmed refresh still checks the application session and current IP before returning rotated tokens',async()=>{
 for(const options of [{approved:false},{ipAllowed:false},{}]){
  const f=fixture({status:200,body:success},options),result=await f.read(),body=await result.json();
  if(options.approved===false){assert.equal(result.status,403);assert.equal(body.code,'application_session_denied');assert.deepEqual(f.calls,['refresh','auth','check']);}
  else if(options.ipAllowed===false){assert.equal(result.status,403);assert.equal(body.code,'ip_denied');assert.deepEqual(f.calls,['refresh','auth','check','ip']);}
  else {assert.equal(result.status,200);assert.equal(body.tokens.expires_at,190);assert.equal(body.tokens.user.id,id);assert.deepEqual(f.calls,['refresh','auth','check','ip','me']);}
 }
});
test('password grant retains exact credential failure and service error classifications',()=>{
 for(const body of [{code:'invalid_credentials'},{code:400,error_code:'invalid_credentials'}]){
  assert.throws(()=>parseAuthTokenResponse('password',400,body),error=>error instanceof SecurityError&&error.code==='invalid_credentials');
  assert.throws(()=>parseAuthTokenResponse('refresh_token',400,body),error=>error instanceof SecurityError&&error.code==='auth_unavailable');
 }
 for(const body of [null,{message:'invalid_credentials'},{code:400}])assert.throws(()=>parseAuthTokenResponse('password',400,body),
  error=>error instanceof SecurityError&&error.code==='auth_unavailable');
});

function indexFixture(error,options={}){
 const calls=[],profile={auth_user_id:id,username:'synthetic',role:'viewer',active:true};
 const admin={auth:{getUser:async verifiedToken=>{assert.equal(verifiedToken,token);calls.push('getUser');
  return error?{data:{user:null},error}:{data:{user:{id}},error:null};}},
  async rpc(name){calls.push(name);return {error:null,data:name==='application_session_check'?{allowed:options.approved!==false,code:'application_session_denied'}:options.ipAllowed!==false};},
  from(table){assert.equal(table,'dashboard_profiles');calls.push('profile');return {select(){return this},eq(){return this},async maybeSingle(){return {data:profile,error:null}}};}};
 const file=path.join(base,'application-auth/index.ts');let handler;
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {module:{exports:{}},exports:{},Request,Response,Headers,URL,AbortSignal,TextEncoder,TextDecoder,Uint8Array,atob,crypto:crypto.webcrypto,
   fetch:async(url,init)=>{calls.push('token');assert.equal(url,'https://synthetic-auth.invalid/auth/v1/token?grant_type=refresh_token');
    assert.equal(JSON.parse(init.body).refresh_token,'synthetic-refresh');return new Response(JSON.stringify(success),{status:200,headers:{'content-type':'application/json'}});},
   Deno:{env:{get:name=>({SUPABASE_URL:'https://synthetic-auth.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',SUPABASE_ANON_KEY:'synthetic-public-key'})[name]},serve:value=>{handler=value}},
   require:name=>{if(name==='jsr:@supabase/supabase-js@2.117.2')return {createClient:()=>admin};
    const value=load(path.resolve(path.dirname(file),name));return name==='../_shared/application-security.ts'?{...value,PROXY_KEY_SHA256:hash}:value;}},
  {filename:file});
 return {calls,read:()=>handler(new Request('https://synthetic.invalid',{method:'POST',headers:{'content-type':'application/json',
  'x-portal-proxy-key':proof,'x-portal-client-ip':'203.0.113.7'},body:JSON.stringify({action:'refresh',surface:'dashboard',refresh_token:'synthetic-refresh'})}))};
}
test('actual index getUser rejects unknown SDK 401/403 without turning the rotated token response into logout',async()=>{
 for(const error of [{status:401},{status:403,code:'unknown',name:'AuthApiError'},
  {status:403,code:'insufficient_aal',name:'AuthApiError'},{status:403,code:'BAD_JWT'},
  {status:400,code:'validation_failed'},{name:'AuthUnknownError'},
  {status:503,code:'session_not_found'},{status:400,name:'AuthSessionMissingError',code:'unknown'}]){
  const f=indexFixture(error),result=await f.read(),body=await result.json();
  assert.equal(result.status,503);assert.equal(body.code,'auth_unavailable');assert.equal(body.tokens,undefined);
  assert.deepEqual(f.calls,['token','getUser']);
 }
});
test('actual index recognizes exact SDK JWT, account and session termination, including the named missing-session conversion',async()=>{
 for(const error of ['bad_jwt','session_expired','session_not_found','user_not_found','user_banned'].map(code=>({status:403,code,name:'AuthApiError'}))
  .concat([{status:400,name:'AuthSessionMissingError',code:undefined}])){
  const f=indexFixture(error),result=await f.read(),body=await result.json();
  assert.equal(result.status,401);assert.equal(body.code,'login_required');assert.equal(body.tokens,undefined);
  assert.deepEqual(f.calls,['token','getUser']);
 }
});
test('actual index retains every registry, IP and profile boundary after successful getUser',async()=>{
 for(const options of [{approved:false},{ipAllowed:false},{}]){
  const f=indexFixture(null,options),result=await f.read(),body=await result.json();
  if(options.approved===false){assert.equal(result.status,403);assert.equal(body.code,'application_session_denied');assert.deepEqual(f.calls,['token','getUser','application_session_check']);}
  else if(options.ipAllowed===false){assert.equal(result.status,403);assert.equal(body.code,'ip_denied');assert.deepEqual(f.calls,['token','getUser','application_session_check','application_auth_ip_check']);}
  else {assert.equal(result.status,200);assert.equal(body.tokens.refresh_token,success.refresh_token);assert.deepEqual(f.calls,['token','getUser','application_session_check','application_auth_ip_check','profile']);}
 }
});
