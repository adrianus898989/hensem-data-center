const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),ts=require('typescript');
const{fixture,IDS,SIDS}=require('./fixtures/workorder-identity-fixture.cjs');
const ROOT=path.resolve(__dirname,'..'),origin='https://adrianus898989.github.io';
const key='synthetic-identity-proof',hash=crypto.createHash('sha256').update(key).digest('hex');
function load(source,extra={}){const mod={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,Request,Response,Headers,URL,crypto:crypto.webcrypto,TextEncoder,TextDecoder,Uint8Array,atob,...extra});return mod.exports;}
const newer=load(fs.readFileSync(path.join(ROOT,'supabase/functions/workorder-account-admin/handler.ts'),'utf8'));
const older=load(fs.readFileSync(path.join(__dirname,'fixtures/workorder-account-admin-identity-baseline.ts'),'utf8'));
const token=role=>'synthetic.'+Buffer.from(JSON.stringify({session_id:SIDS[role],user_metadata:{role:'owner'}})).toString('base64url')+'.not-a-production-signature';
function req(role='agent',body={action:'me'},headers={}){return new Request('https://unit.invalid',{method:'POST',headers:{authorization:'Bearer '+token(role),'content-type':'application/json','x-portal-proxy-key':key,'x-portal-client-ip':'203.0.113.7',...headers},body:JSON.stringify(body)});}
async function comparable(response){return{status:response.status,body:await response.json(),headers:[...response.headers]};}
function gateway(h,state,events=[]){
 const caller=()=>state.caller===null?null:{id:IDS[state.role||'agent'],email:state.email||((state.role==='owner'||state.role==='admin')?(state.role+'@hensem.local'):((state.role||'agent')+'@workorder.hensem.local'))};
 const g={
  async getUser(){events.push('auth');return caller();},
  async profile(id){events.push('profile');return(await h.service('select auth_user_id,username,role,active from public.dashboard_profiles where auth_user_id=$1',[id]))[0]||null;},
  async account(id){events.push('account');return(await h.service('select public.workorder_portal_account_context($1) value',[id]))[0].value;},
  async sessionAllowed(t,id,surface){events.push('session');let sid;try{sid=JSON.parse(Buffer.from(t.split('.')[1],'base64url')).session_id;}catch{return false;}return(await h.service('select public.application_session_check($1,$2,$3) value',[id,sid,surface]))[0].value.allowed===true;},
  async ipCheck(surface,ip,id){events.push('ip');return(await h.service('select public.application_auth_ip_check($1,$2,$3) value',[surface,ip,id]))[0].value===true;},
  async catalogRows(){events.push('catalog-map');const a=await h.service("select team_name team,platform_name platform from public.dashboard_platform_team_map where active=true and country_code='IN' limit 1000");events.push('catalog-game66');return a.concat(await h.service("select team_name team,platform_name platform from public.game66_platforms where team_name in('红膏蟹','香港')limit 1000"));},
  async meContext(input){events.push('identity-rpc');let sid;try{sid=JSON.parse(Buffer.from(input.token.split('.')[1],'base64url')).session_id;}catch{}return h.context({actor:input.actor,email:input.email,sid:sid||null,proxy:input.proxyPresent,ip:input.clientIp});}
 };return g;
}
async function pair(h,state={},headers={},body={action:'me'}){const a=[],b=[],g1=gateway(h,state,a),g2=gateway(h,state,b);const opts={allowedOrigins:[origin],proxyKeySha256:hash};const role=state.role||'agent';const before=await h.snapshot();const old=await comparable(await older.createWorkorderAccountHandler(g1,opts)(req(role,body,headers)));const now=await comparable(await newer.createWorkorderAccountHandler(g2,opts)(req(role,body,headers)));assert.deepEqual(now,old);assert.deepEqual(await h.snapshot(),before);return{old,now,a,b};}
test('real original policy/account functions produce identical full me responses; seven calls become Auth plus one RPC',async()=>{
 const h=await fixture();try{
  for(const role of ['agent','supervisor','auditor','other','owner','admin']){const p=await pair(h,{role});if(p.now.status===200){assert.deepEqual(p.b,['auth','identity-rpc']);if(role!=='owner')assert.equal(p.a.length,7);}}
  const p=await pair(h,{role:'agent'},{},{action:'me',role:'owner',platforms:['PLATFORM-B'],permissions:{'provider_upis.add':true}});assert.deepEqual(p.now.body.account.platforms,['PLATFORM-A']);assert.equal(p.now.body.account.role,'agent');assert(!JSON.stringify(p.now.body).includes('session_id'));
 }finally{await h.db.close();}
});
test('fresh lock, disabled account, expired/revoked session and IP policy preserve rejection and priority',async()=>{
 const h=await fixture();try{
  for(const [set,undo]of [
   ["update public.workorder_portal_accounts set active=false where auth_user_id='"+IDS.agent+"'","update public.workorder_portal_accounts set active=true where auth_user_id='"+IDS.agent+"'"],
   ["update private.application_account_security set locked_at=now() where user_id='"+IDS.agent+"'","update private.application_account_security set locked_at=null where user_id='"+IDS.agent+"'"],
   ["update auth.sessions set not_after=now()-interval '1 second' where id='"+SIDS.agent+"'","update auth.sessions set not_after=null where id='"+SIDS.agent+"'"],
   ["update private.application_sessions set revoked_at=now() where session_id='"+SIDS.agent+"'","update private.application_sessions set revoked_at=null where session_id='"+SIDS.agent+"'"]
  ]){await h.db.exec(set);const p=await pair(h,{}, {'x-portal-proxy-key':'wrong'});assert.equal(p.now.body.code,'session_denied');await h.db.exec(undo);}
  for(const headers of [{'x-portal-proxy-key':'wrong'},{'x-portal-client-ip':'203.0.113.7, 198.51.100.1'},{'x-portal-proxy-key':'','x-portal-client-ip':''}])assert.equal((await pair(h,{},headers)).now.body.code,'proxy_denied');
  await h.db.exec("update private.application_account_security set ip_mode='allowlist' where user_id='"+IDS.agent+"';insert into private.application_account_ip_rules values('"+IDS.agent+"','workorder',true,'203.0.113.7/32')");assert.equal((await pair(h,{}, {'x-portal-client-ip':'198.51.100.1'})).now.body.code,'ip_denied');
 }finally{await h.db.close();}
});
test('owner no-proxy Pages path and non-owner dashboard/email gates retain original behavior',async()=>{
 const h=await fixture();try{
  const options={allowedOrigins:[origin],proxyKeySha256:hash};const noProxy=new Request('https://unit.invalid',{method:'POST',headers:{authorization:'Bearer '+token('owner')},body:'{"action":"me"}'});
  const old=await comparable(await older.createWorkorderAccountHandler(gateway(h,{role:'owner'}),options)(noProxy.clone()));const now=await comparable(await newer.createWorkorderAccountHandler(gateway(h,{role:'owner'}),options)(noProxy.clone()));assert.deepEqual(now,old);assert.equal(now.status,200);
  assert.equal((await pair(h,{role:'owner'},{'x-portal-proxy-key':'wrong'})).now.body.code,'proxy_denied');assert.equal((await pair(h,{role:'admin'})).now.body.code,'account_denied');
  for(const email of ['other@workorder.hensem.local','agent@hensem.local'])assert.equal((await pair(h,{email})).now.body.code,'account_denied');
  await h.db.exec("update public.dashboard_profiles set active=false where auth_user_id='"+IDS.admin+"'");assert.equal((await pair(h,{role:'admin'},{'x-portal-proxy-key':'wrong'})).now.body.code,'session_denied');
 }finally{await h.db.close();}
});
test('fresh role permission/scope revocation and catalog cross-team collision are not cached',async()=>{
 const h=await fixture();try{
  const role=(await h.callRole(IDS.owner,{action:'create-role',name:'Synthetic role',base_role:'agent',permissions:{'provider_upis.view':true,'provider_upis.add':true}})).role;await h.assign(role.id);assert.equal((await pair(h)).now.body.account.permissions['provider_upis.add'],true);
  await h.callRole(IDS.owner,{action:'update-role',id:role.id,expected_version:1,patch:{active:false}});assert.equal((await pair(h)).now.body.account.permissions['provider_upis.add'],false);
  await h.db.exec("insert into public.game66_platforms(team_name,platform_name,enabled)values('香港','PLATFORM-A',false)");assert.equal((await pair(h)).now.body.code,'scope_denied');
  await h.db.exec("delete from public.game66_platforms;update public.dashboard_platform_team_map set active=false where platform_name='PLATFORM-A'");assert.equal((await pair(h)).now.body.code,'scope_denied');
  await h.db.exec("update public.dashboard_platform_team_map set active=true where platform_name='PLATFORM-A';insert into public.dashboard_platform_team_map(country_code,team_name,platform_name,active) values('IN',null,'NO-TEAM',true),('IN','M8',null,true),('IN',' ','NO-TEAM-2',true),('IN','M8',' ',true)");assert.deepEqual((await pair(h)).now.body.catalog.platforms,['PLATFORM-A']);
 }finally{await h.db.close();}
});
test('missing/malformed context and wrong identity never grant scope or leak internal data; Auth and input checks stay first',async()=>{
 const good={version:1,ok:true,profile:null,account:{auth_user_id:IDS.agent,username:'agent',display_name:'Agent',role:'agent',team:'M8',platforms:['PLATFORM-A'],active:true},catalogRows:[{team:'M8',platform:'PLATFORM-A'}]};
 for(const value of [undefined,null,[],{}, {...good,version:2},{...good,catalogRows:[null]},{...good,profile:{auth_user_id:'bad'}},{ok:false,version:1,status:403,code:'PRIVATE_ERROR',message:'SECRET'}]){
  let calls=0;const g={getUser:async()=>({id:IDS.agent,email:'agent@workorder.hensem.local'}),meContext:async()=>{calls++;return value;}};const r=await comparable(await newer.createWorkorderAccountHandler(g,{allowedOrigins:[origin],proxyKeySha256:hash})(req()));assert.equal(r.status,503);assert(!JSON.stringify(r.body).includes('SECRET'));assert.equal(calls,1);
 }
 for(const value of [{...good,account:{...good.account,auth_user_id:IDS.other}},{...good,profile:{auth_user_id:IDS.other,username:'owner',role:'owner',active:true}}]){const r=await newer.createWorkorderAccountHandler({getUser:async()=>({id:IDS.agent,email:'agent@workorder.hensem.local'}),meContext:async()=>value},{allowedOrigins:[origin],proxyKeySha256:hash})(req());assert.equal(r.status,403);}
 const missing=await newer.createWorkorderAccountHandler({getUser:async()=>({id:IDS.agent})},{allowedOrigins:[origin]})(req());assert.equal(missing.status,503);
 let calls=0;const g={getUser:async()=>null,meContext:async()=>{calls++;return good;}};assert.equal((await newer.createWorkorderAccountHandler(g,{allowedOrigins:[origin]})(req())).status,401);assert.equal(calls,0);
 const bad=await newer.createWorkorderAccountHandler({getUser:async()=>({id:IDS.agent}),meContext:async()=>{calls++;return good;}},{allowedOrigins:[origin]})(req('agent',{action:'delete-account'}));assert.equal(bad.status,400);assert.equal(calls,0);
});
test('actual deployed index calls only verified Auth plus the new RPC on me, never table/profile APIs',async()=>{
 const h=await fixture();try{
  const calls=[];let served;const admin={auth:{getUser:async t=>{calls.push(['auth']);return{data:{user:{id:IDS.agent,email:'agent@workorder.hensem.local'}},error:null};}},from(){throw Error('Unexpected separate Data API request');},rpc:async(name,args)=>{calls.push([name,Object.keys(args)]);try{return{data:(await h.service('select public.workorder_portal_identity_context($1,$2,$3,$4,$5) value',[args.p_actor,args.p_email,args.p_session_id,args.p_proxy_present,args.p_client_ip]))[0].value,error:null};}catch(error){return{error};}}};
  let source=fs.readFileSync(path.join(ROOT,'supabase/functions/workorder-account-admin/index.ts'),'utf8').replace(/^import .*;$/mg,'').replace("proxyKeySha256: '0ab9c303e8845503a0bb32e9a4bb898228656ba4928c306e5bc4eff35fd7980f'","proxyKeySha256: '"+hash+"'");
  load(source,{...newer,createClient:()=>admin,Deno:{env:{get:()=>''},serve:h=>{served=h;}}});assert(served);const r=await comparable(await served(req()));assert.equal(r.status,200);assert.deepEqual(calls.map(x=>x[0]),['auth','workorder_portal_identity_context']);assert.equal(calls[1][1].length,5);assert(!JSON.stringify(r.body).includes('session_id'));
  for(const invalid of ['verified-but-no-session','synthetic.'+Buffer.from('{"session_id":"not-uuid"}').toString('base64url')+'.synthetic']){calls.length=0;const denied=await comparable(await served(req('agent',{action:'me'},{authorization:'Bearer '+invalid,'x-portal-proxy-key':'invalid'})));assert.equal(denied.body.code,'session_denied');assert.deepEqual(calls.map(x=>x[0]),['auth','workorder_portal_identity_context']);}
 }finally{await h.db.close();}
});
test('all existing account management bodies remain byte-identical after their dispatch point',()=>{
 const old=fs.readFileSync(path.join(__dirname,'fixtures/workorder-account-admin-identity-baseline.ts'),'utf8'),now=fs.readFileSync(path.join(ROOT,'supabase/functions/workorder-account-admin/handler.ts'),'utf8');
 const anchor="      if (action === 'list-accounts')";assert.equal(old.split(anchor).length,2);assert.equal(now.split(anchor).length,2);assert.equal(now.slice(now.indexOf(anchor)),old.slice(old.indexOf(anchor)));
});
