const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),ts=require('typescript');
const base=path.join(__dirname,'../supabase/functions'),cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,Request,Response,Headers,URL,TextEncoder,TextDecoder,Uint8Array,atob,Set,Number,Object,Date,crypto:crypto.webcrypto,require:n=>load(path.resolve(path.dirname(file),n))},{filename:file});cache.set(file,module.exports);return module.exports;}
const {createPresenceHandler,validatePresenceSnapshot}=load(path.join(base,'application-presence/handler.ts'));
const {SecurityError}=load(path.join(base,'_shared/application-security.ts'));
const actor='11111111-1111-4111-8111-111111111111',session='22222222-2222-4222-8222-222222222222',key='synthetic-independent-presence-proxy',hash=crypto.createHash('sha256').update(key).digest('hex');
const token=claims=>'header.'+Buffer.from(JSON.stringify({sub:actor,session_id:session,...claims})).toString('base64url')+'.signature';
const observed='2026-10-02T05:30:00.000Z';
const snapshot=()=>({ok:true,onlineCount:1,observedAt:observed,windowSeconds:120,heartbeatSeconds:30,scope:'authorized',accounts:[{username:'synthetic-account',lastSeenAt:observed}]});
function request(body={action:'heartbeat'},headers={},method='POST'){return new Request('https://unit.test/functions/v1/application-presence',{method,headers:{'content-type':'application/json','x-portal-proxy-key':key,'x-portal-client-ip':'203.0.113.7',authorization:'Bearer '+token(),...headers},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});}
function fixture(change={}){const calls=[],state={user:{id:actor},response:snapshot(),...change};return{calls,state,handler:createPresenceHandler({async getUser(t){calls.push(['getUser',t]);if(state.authError)throw Error('PRIVATE_AUTH');return state.user;},async presence(args){calls.push(['presence',args]);if(state.sqlError)throw state.sqlError;return state.response;}},{proxyKeySha256:hash})};}

test('only trusted Worker proof and actual host IP can reach Auth or heartbeat',async()=>{
 for(const h of [{'x-portal-proxy-key':''},{'x-portal-proxy-key':'wrong'},{'x-portal-client-ip':''},{'x-portal-client-ip':'203.0.113.7, 198.51.100.3'},{'x-portal-client-ip':'203.0.113.7/24'},{'x-portal-client-ip':'','cf-connecting-ip':'203.0.113.7'}]){const f=fixture();assert.equal((await f.handler(request(undefined,h))).status,403);assert.equal(f.calls.length,0);}
});
test('verified user and session claim alone become authority for all three actions',async()=>{
 for(const action of ['heartbeat','status','leave']){const f=fixture();const r=await f.handler(request({action},{authorization:'Bearer '+token({sub:'forged-claim',role:'owner',user_metadata:{role:'owner'}})}));assert.equal(r.status,200);assert.equal(f.calls[0][0],'getUser');assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1][1])),{actor,session,ip:'203.0.113.7',action});assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal((await r.json()).onlineCount,1);}
});
test('unverified Auth, missing session, invalid identity or malformed bearer cannot reach SQL',async()=>{
 for(const user of [null,{id:'bad'}]){const f=fixture({user});assert.equal((await f.handler(request())).status,401);assert(!f.calls.some(c=>c[0]==='presence'));}
 for(const auth of ['', 'Basic credentials','Bearer malformed','Bearer '+token({session_id:null}),'Bearer '+token({session_id:'not-uuid'})]){const f=fixture();assert.equal((await f.handler(request(undefined,{authorization:auth}))).status,401);assert(!f.calls.some(c=>c[0]==='presence'));}
});
test('action-only strict body rejects identity, scope, counts and timestamp spoofing before mutation',async()=>{
 for(const extra of ['actor','user_id','session_id','ip','surface','scope','onlineCount','last_seen_at']){const f=fixture();assert.equal((await f.handler(request({action:'heartbeat',[extra]:'forged'}))).status,400);assert(!f.calls.some(c=>c[0]==='presence'));}
 for(const body of [{},[],null,{action:0},{action:['heartbeat']},{action:'register'},{action:'leave',account:'other'}]){const f=fixture();assert.equal((await f.handler(request(body))).status,400);assert(!f.calls.some(c=>c[0]==='presence'));}
});
test('method, JSON format, invalid UTF8 and bounded request body cannot reach presence',async()=>{
 const f=fixture();for(const method of ['GET','OPTIONS','PUT'])assert.equal((await f.handler(request(undefined,{},method))).status,405);
 assert.equal((await f.handler(request('broken'))).status,400);assert.equal((await f.handler(request(undefined,{'content-type':'text/plain'}))).status,415);
 const malformed=request();const malformedUtf8=new Request(malformed.url,{method:'POST',headers:malformed.headers,body:new Uint8Array([0x7b,0xff,0x7d])});assert.equal((await f.handler(malformedUtf8)).status,400);
 assert.equal((await f.handler(request(JSON.stringify({action:'heartbeat',pad:'x'.repeat(17000)})))).status,413);assert(!f.calls.some(c=>c[0]==='presence'));
});
test('Auth outage, revoked session, IP rejection and SQL errors stay unavailable/denied with no private error leak',async()=>{
 for(const change of [{authError:true},{sqlError:new SecurityError(403,'application_session_denied','会话失效')},{sqlError:new SecurityError(403,'ip_denied','IP denied')},{sqlError:Error('PRIVATE_SQL')}]){const f=fixture(change);const r=await f.handler(request());assert([403,503].includes(r.status));const body=await r.text();assert(!body.includes('PRIVATE_'));assert(!body.includes('onlineCount'));}
});
test('only complete aggregate contract and permission-projected names leave Edge; unexpected secrets and malformed roster fail closed',async()=>{
 const good=validatePresenceSnapshot(snapshot());assert.equal(good.onlineCount,1);assert.deepEqual(Object.keys(good.accounts[0]).sort(),['lastSeenAt','username']);
 const hidden=snapshot();delete hidden.accounts;assert.equal(validatePresenceSnapshot(hidden).accounts,undefined);
 for(const patch of [{onlineCount:null},{onlineCount:-1},{onlineCount:501},{onlineCount:'1'},{observedAt:'not-date'},{windowSeconds:999},{heartbeatSeconds:0},{scope:'all'},{user_id:actor},{ip:'203.0.113.7'},{accounts:null},{accounts:[]},{accounts:[{username:'synthetic-account',lastSeenAt:observed,user_id:actor}]},{onlineCount:2,accounts:[snapshot().accounts[0],snapshot().accounts[0]]}]){
  const f=fixture({response:{...snapshot(),...patch}});const r=await f.handler(request());assert.equal(r.status,503);assert(!await r.text().then(t=>t.includes('onlineCount')));
 }
 const zero={...snapshot(),onlineCount:0,accounts:[]};assert.equal(validatePresenceSnapshot(zero).onlineCount,0);
});
test('deployment adapter is pinned and uses verified service RPC with no caller-provided actor or browser IP fallback',()=>{
 const index=fs.readFileSync(path.join(base,'application-presence/index.ts'),'utf8');assert(index.includes("jsr:@supabase/supabase-js@2.117.2"));assert(index.includes("admin.auth.getUser(token)"));assert(index.includes("admin.rpc('application_dashboard_presence'"));assert(index.includes('p_actor: args.actor'));assert(index.includes("redirect: 'error'"));assert(!index.includes('console.log'));assert(!index.includes('user_metadata'));
});
