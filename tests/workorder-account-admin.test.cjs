const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const file = path.join(__dirname, '../supabase/functions/workorder-account-admin/handler.ts');
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: mod, exports: mod.exports, Request, Response, Headers, URL, crypto: crypto.webcrypto, TextEncoder, TextDecoder, Uint8Array });
const { createWorkorderAccountHandler, buildCatalog, ApiError } = mod.exports;
const ownerId='11111111-1111-4111-8111-111111111111', staffId='22222222-2222-4222-8222-222222222222';
const version='2026-09-26T00:00:00.000Z';
const owner={auth_user_id:ownerId,username:'owner',role:'owner',active:true};
const staff={auth_user_id:staffId,username:'worker1',display_name:'Worker 1',role:'agent',team:'M8',platforms:['91CLUB'],active:true,updated_at:version};
const catalog=[{team:'M8',platform:'91CLUB'},{team:'M8',platform:'51GAME'},{team:'香港',platform:'777IN'}];
const origin='https://adrianus898989.github.io';
const proxyKey='test-independent-identity-key', proxyHash=crypto.createHash('sha256').update(proxyKey).digest('hex');
function fixture(overrides={}) {
  const calls=[], state={profile:structuredClone(owner),account:structuredClone(staff),catalog:structuredClone(catalog),caller:{id:ownerId,email:'owner@hensem.local'},...overrides};
  const gateway={
    async getUser(token){calls.push(['auth',token]);return state.caller;},
    async profile(id){calls.push(['profile',id]);return id===ownerId?state.profile:state.targetProfile||null;},
    async account(id){calls.push(['account',id]);return state.account?.auth_user_id===id?state.account:null;},
    async accounts(){return [state.account];},async catalogRows(){return state.catalog;},
    async sessionAllowed(token,id,surface){calls.push(['session',token,id,surface]);return state.approved!==false;},
    async ipCheck(surface,ip,user){calls.push(['ip',surface,ip,user]);return state.ipAllowed!==false;},
    async revokeSessions(id){calls.push(['revoke',id]);if(state.revokeFailure)throw Error('PRIVATE_REVOKE_FAILURE');},
    async createUser(email,password){calls.push(['create',email,password]);if(state.duplicate)throw new ApiError(409,'account_exists','这个工单账号已存在');return staffId;},
    async deleteUser(id){calls.push(['rollback',id]);},
    async insert(account,actor){calls.push(['insert',account,actor]);if(state.insertFailure)throw Error('PRIVATE_ERROR_SECRET');return {...account,updated_at:version};},
    async update(id,expected,patch,actor){calls.push(['update',id,expected,patch,actor]);if(state.conflict)return null;state.account={...state.account,...patch,updated_at:'2026-09-26T00:00:01Z'};return state.account;},
    async resetPassword(id,password){calls.push(['reset',id,password]);},async audit(...args){calls.push(['audit',...args]);},
  };
  return {state,calls,handler:createWorkorderAccountHandler(gateway,{allowedOrigins:[origin],proxyKeySha256:proxyHash})};
}
function req(body={action:'me'},headers={}){return new Request('https://unit.test/workorder-account-admin',{method:'POST',headers:{authorization:'Bearer user-token','content-type':'application/json','x-portal-proxy-key':proxyKey,'x-portal-client-ip':'203.0.113.7',...headers},body:JSON.stringify(body)});}
const create={action:'create-account',username:'worker1',password:'safe-test-password',display_name:'Worker 1',role:'agent',team:'M8',platforms:['91CLUB']};
test('requires validated Auth token before reading permissions',async()=>{
  const f=fixture({caller:null});assert.equal((await f.handler(req())).status,401);assert.deepEqual(f.calls,[['auth','user-token']]);
  const g=fixture();assert.equal((await g.handler(req({}, {authorization:'Bearer bad token'}))).status,401);assert.equal(g.calls.length,0);
});
test('owner me uses fresh DB role and real catalog, never Auth metadata',async()=>{
  const f=fixture();const result=await(await f.handler(req())).json();assert.equal(result.account.role,'owner');assert.equal(result.identity_kind,'dashboard_owner');assert.equal(result.account.platforms.length,3);
  f.state.profile.active=false;f.state.caller.user_metadata={role:'owner'};assert.equal((await f.handler(req())).status,403);
});
test('portal staff me returns only their scope and next request sees disable',async()=>{
  const f=fixture({caller:{id:staffId,email:'worker1@workorder.hensem.local'}});const result=await(await f.handler(req())).json();
  assert.equal(result.identity_kind,'workorder');assert.deepEqual(result.catalog.platforms,['91CLUB']);assert.deepEqual(result.catalog.teams,['M8']);
  f.state.account.active=false;assert.equal((await f.handler(req())).status,403);
});
test('staff me removes revoked platforms and denies fully revoked scope',async()=>{
  const f=fixture({caller:{id:staffId,email:'worker1@workorder.hensem.local'}});f.state.account.platforms=['91CLUB','REMOVED'];
  assert.deepEqual((await(await f.handler(req())).json()).account.platforms,['91CLUB']);f.state.catalog=[];assert.equal((await f.handler(req())).status,403);
});
test('no alias/metadata escalation, mixed backend and portal identities are denied',async()=>{
  for(const email of ['worker1@hensem.local','other@workorder.hensem.local'])assert.equal((await fixture({caller:{id:staffId,email}}).handler(req())).status,403);
  assert.equal((await fixture({caller:{id:staffId,email:'worker1@workorder.hensem.local'},targetProfile:{...owner,auth_user_id:staffId,role:'viewer'}}).handler(req())).status,403);
});
test('only active backend owner manages accounts regardless portal role',async()=>{
  for(const role of ['supervisor','agent','auditor','owner']){
    const f=fixture({caller:{id:staffId,email:'worker1@workorder.hensem.local'}});f.state.account.role=role;
    for(const action of ['list-accounts','create-account','update-account','reset-password'])assert.equal((await f.handler(req({...create,action}))).status,403);
    assert(!f.calls.some(c=>['create','insert','update','reset'].includes(c[0])));
  }
});
test('create uses separate alias and explicit concrete team scope',async()=>{
  const f=fixture();const response=await f.handler(req(create));assert.equal(response.status,200);const body=await response.json();assert.equal(body.account.updated_at,version);
  assert.deepEqual(f.calls.find(c=>c[0]==='create'),['create','worker1@workorder.hensem.local','safe-test-password']);
  assert(!JSON.stringify(body).includes('safe-test-password'));assert.equal(f.calls.find(c=>c[0]==='insert')[1].role,'agent');
});
test('empty scope, foreign team, invalid role and username cannot create Auth users',async()=>{
  for(const patch of [{platforms:[]},{platforms:['777IN']},{team:'test-team'},{role:'owner'},{username:'bad@x'}]){
    const f=fixture();assert.equal((await f.handler(req({...create,...patch}))).status,400);assert(!f.calls.some(c=>c[0]==='create'));
  }
});
test('Auth user is compensated on profile insert failure; private errors are not leaked',async()=>{
  const f=fixture({insertFailure:true});const response=await f.handler(req(create));assert.equal(response.status,503);assert(!await response.text().then(t=>t.includes('PRIVATE_ERROR_SECRET')));assert.deepEqual(f.calls.find(c=>c[0]==='rollback'),['rollback',staffId]);
  assert.equal((await fixture({duplicate:true}).handler(req(create))).status,409);
});
test('optimistic account update preserves identity, requires expected version',async()=>{
  const f=fixture();const body={action:'update-account',auth_user_id:staffId,expected_updated_at:version,patch:{active:false}};
  assert.equal((await f.handler(req(body))).status,200);assert.equal(f.state.account.active,false);
  assert.equal((await f.handler(req({...body,patch:{username:'new'}}))).status,400);
  assert.equal((await fixture({conflict:true}).handler(req(body))).status,409);
  assert.equal((await fixture().handler(req({...body,expected_updated_at:''}))).status,400);
});
test('reset targets only workorder rows; cannot delete or reset a backend owner',async()=>{
  const f=fixture();assert.equal((await f.handler(req({action:'reset-password',auth_user_id:ownerId,password:'new-password'}))).status,404);
  assert.equal((await f.handler(req({action:'delete-account',auth_user_id:staffId}))).status,400);
  assert.equal((await f.handler(req({action:'reset-password',auth_user_id:staffId,password:'new-password'}))).status,200);
  assert(f.calls.some(c=>c[0]==='audit'));assert(!f.calls.some(c=>c[0]==='rollback'));
});
test('approved session gate is fresh and namespace cannot be forged by source headers',async()=>{
  const f=fixture();assert.equal((await f.handler(req())).status,200);assert.deepEqual(f.calls.find(c=>c[0]==='session'),['session','user-token',ownerId,'dashboard']);
  f.state.approved=false;assert.equal((await f.handler(req({action:'me'},{'cf-connecting-ip':'203.0.113.7','x-portal-client-ip':'203.0.113.7','x-portal-proxy-key':proxyKey}))).status,403);
  const g=fixture({caller:{id:staffId,email:'worker1@workorder.hensem.local'}});assert.equal((await g.handler(req())).status,200);assert.equal(g.calls.find(c=>c[0]==='session')[3],'workorder');
});
test('reset revokes before and after password change; failed invalidation cannot mutate account',async()=>{
  const f=fixture();assert.equal((await f.handler(req({action:'reset-password',auth_user_id:staffId,password:'new-password'}))).status,200);
  const names=f.calls.map(c=>c[0]);assert(names.indexOf('revoke')<names.indexOf('reset'));assert(names.lastIndexOf('revoke')>names.indexOf('reset'));
  for(const body of [{action:'reset-password',auth_user_id:staffId,password:'new-password'},{action:'update-account',auth_user_id:staffId,expected_updated_at:version,patch:{active:false}}]){
    const denied=fixture({revokeFailure:true});assert.equal((await denied.handler(req(body))).status,503);assert(!denied.calls.some(c=>['reset','update'].includes(c[0])));
  }
});
test('proxy key alone never authenticates and browser preflight cannot carry server proof',async()=>{
  const f=fixture();assert.equal((await f.handler(req({action:'me'},{authorization:'','x-portal-proxy-key':proxyKey,'x-portal-client-ip':'203.0.113.7'}))).status,401);
  const response=await f.handler(new Request('https://unit.test',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'x-portal-proxy-key'}}));assert.equal(response.status,403);
});
test('hostile CORS and unsupported methods never read Auth',async()=>{
  const f=fixture();assert.equal((await f.handler(req({action:'me'},{origin:'https://evil.example'}))).status,403);assert.equal((await f.handler(new Request('https://unit.test'))).status,405);assert.equal(f.calls.length,0);
});
test('catalog merges registrations but rejects ambiguous cross-team names',()=>{
  const c=buildCatalog([...catalog,{team:'M8',platform:'91CLUB'},{team:'香港',platform:'91CLUB'}]);assert.equal(c.platformTeams['91CLUB'],undefined);assert.equal(c.platformTeams['51GAME'],'M8');
});

test('account body is bounded in bytes before catalog or mutations',async()=>{
  const f=fixture();assert.equal((await f.handler(req({...create,display_name:'中'.repeat(6000)}))).status,413);assert(!f.calls.some(c=>['profile','session','create','insert'].includes(c[0])));
  for(const body of ['{','null','[]']){const q=fixture();assert.equal((await q.handler(new Request('https://unit.test',{method:'POST',headers:{authorization:'Bearer user-token'},body}))).status,400);assert(!q.calls.some(c=>c[0]==='create'));}
});

test('portal service queries require trusted current IP and account override after verified session',async()=>{
  for(const headers of [{'x-portal-proxy-key':'forged'},{'x-portal-client-ip':'203.0.113.7, 198.51.100.1'},{'x-portal-proxy-key':'','x-portal-client-ip':''}]){const f=fixture({caller:{id:staffId,email:'worker1@workorder.hensem.local'}});assert.equal((await f.handler(req({action:'me'},headers))).status,403);assert(!f.calls.some(c=>c[0]==='ip'));}
  const f=fixture({caller:{id:staffId,email:'worker1@workorder.hensem.local'},ipAllowed:false});assert.equal((await f.handler(req())).status,403);assert.deepEqual(f.calls.find(c=>c[0]==='ip'),['ip','workorder','203.0.113.7',staffId]);
});
