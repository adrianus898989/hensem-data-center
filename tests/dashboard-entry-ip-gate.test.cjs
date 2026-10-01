const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),ts=require('typescript');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),key='synthetic-independent-entry-proof',env={PORTAL_PROXY_KEY:key};
const gate='https://gmfyfzsxpxmaqtuuwgxb.supabase.co/functions/v1/application-entry-gate',site='https://data-center.workdesk-hub.workers.dev/hensem-data-center/';
const request=(url=site,init={})=>new Request(url,{...init,headers:{'CF-Connecting-IP':'203.0.113.7',...init.headers}});
const decision=(allowed=true)=>new Response(JSON.stringify({ok:true,allowed}),{headers:{'Content-Type':'application/json'}});
const worker=()=>import(path.join(root,'cloudflare/data-center/worker.mjs'));

test('production entry denies root, documents, assets and unsupported methods before fetching any public content',async()=>{
 const {serve}=await worker();
 for(const url of [site,site+'_next/static/chunks/app/page-abcdef123456.js',site+'index.html',site.replace('/hensem-data-center/','/')]){
  let calls=0;const r=await serve(request(url),env,async target=>{calls++;assert.equal(target,gate);return decision(false)});
  assert.equal(r.status,403);assert.equal(await r.text(),'Access denied');assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(calls,1);
 }
 const post=await serve(request(site,{method:'POST',body:'private'}),env,async target=>{assert.equal(target,gate);return decision(false)});
 assert.equal(post.status,403);assert.equal(await post.text(),'Access denied');
 const head=await serve(request(site,{method:'HEAD'}),env,async()=>decision(false));assert.equal(head.status,403);assert.equal(await head.text(),'');
});
test('only trusted CF ingress IP crosses the gate; credentials, claimed account and spoofed forwarding headers never do',async()=>{
 const {serve}=await worker();const calls=[];
 const r=await serve(request(site+'?ip=198.51.100.7&account=synthetic-owner',{headers:{Authorization:'Bearer private',Cookie:'private=1','x-portal-proxy-key':'forged','x-portal-client-ip':'198.51.100.7','X-Forwarded-For':'198.51.100.7','X-Real-IP':'198.51.100.7'}}),env,async(url,options)=>{
  calls.push(url);if(url===gate){assert.deepEqual(options.headers,{'Content-Type':'application/json',apikey:'sb_publishable_0DFLEmUvGBp1GYQ7jNo4IA_O1PeA9zV','x-portal-proxy-key':key,'x-portal-client-ip':'203.0.113.7'});assert.equal(options.body,'{}');assert.equal(options.redirect,'manual');assert.equal(options.cache,'no-store');assert(options.signal);return decision(true)}
  assert.equal(url,'https://adrianus898989.github.io/hensem-data-center/');assert.deepEqual(Object.keys(options.headers).sort(),['Accept','Cache-Control']);return new Response('public page',{headers:{'Content-Type':'text/html'}});
 });assert.equal(r.status,200);assert.equal(await r.text(),'public page');assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(calls.length,2);
});
test('missing or malformed ingress/proxy configuration never falls back to forwarding headers or makes a network request',async()=>{
 const {serve}=await worker();
 for(const ip of ['', '203.0.113.7, 198.51.100.9','203.0.113.7/24','300.1.1.1','01.1.1.1','garbage']){
  const r=await serve(request(site,{headers:{'CF-Connecting-IP':ip,'X-Forwarded-For':'203.0.113.7'}}),env,()=>assert.fail('network must not run'));assert.equal(r.status,403);
 }
 for(const config of [{},{PORTAL_PROXY_KEY:''},{PORTAL_PROXY_KEY:'tiny'},{PORTAL_PROXY_KEY:'x'.repeat(257)}])assert.equal((await serve(request(),config,()=>assert.fail('network must not run'))).status,403);
});
test('gate timeouts, redirects, invalid/oversized responses and nonboolean decisions all fail closed',async()=>{
 const {serve}=await worker();
 for(const responder of [()=>{throw Error('private upstream detail')},()=>new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/'}}),()=>new Response('{}',{status:503}),()=>new Response('public HTML'),()=>new Response('not JSON',{headers:{'Content-Type':'application/json'}}),()=>new Response(' '.repeat(1025),{headers:{'Content-Type':'application/json'}}),()=>new Response('{"ok":true,"allowed":"true"}',{headers:{'Content-Type':'application/json'}}),()=>new Response('{"allowed":true}',{headers:{'Content-Type':'application/json'}})]){
  let calls=0;const r=await serve(request(),env,url=>{calls++;assert.equal(url,gate);return responder()});assert.equal(r.status,403);assert.equal(await r.text(),'Access denied');assert.equal(calls,1);
 }
});
test('an address removal is effective on the next asset request; protected assets cannot be reused from public browser caches',async()=>{
 const {serve}=await worker();let allowed=true,checks=0,assets=0;
 const fetcher=async url=>{if(url===gate){checks++;return decision(allowed)}assets++;return new Response('synthetic script',{headers:{'Content-Type':'application/javascript'}})};
 const asset=site+'_next/static/chunks/app/page-abcdef123456.js';
 let r=await serve(request(asset),env,fetcher);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');
 allowed=false;r=await serve(request(asset),env,fetcher);assert.equal(r.status,403);assert.equal(checks,2);assert.equal(assets,1);
});
test('valid IPv6 is normalized and authorized root redirects retain no credentials',async()=>{
 const {serve}=await worker();const r=await serve(request(site.replace('/hensem-data-center/','/')+'?token=private',{headers:{'CF-Connecting-IP':'2001:0db8:0:0::7'}}),env,async(url,options)=>{assert.equal(url,gate);assert.equal(options.headers['x-portal-client-ip'],'2001:db8::7');return decision(true)});
 assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/hensem-data-center/');assert.equal(r.headers.get('cache-control'),'private, no-store');
});

test('operator secret trailing newline is normalized without trusting caller proof',async()=>{
 const {serve}=await worker();let checks=0;
 const r=await serve(request(site,{headers:{'x-portal-proxy-key':'forged'}}),{PORTAL_PROXY_KEY:'\n'+key+'\r\n'},async(url,options)=>{
  if(url===gate){checks++;assert.equal(options.headers['x-portal-proxy-key'],key);return decision(true)}
  return new Response('public page');
 });assert.equal(r.status,200);assert.equal(checks,1);
});
test('entry fetch uses workerd-supported manual redirects and never follows a proof-bearing redirect',async()=>{
 const {serve}=await worker();let calls=0;
 const strictRuntime=async(url,options)=>{
  if(!['follow','manual'].includes(options.redirect))throw new TypeError('Invalid redirect value');
  calls++;if(url===gate)return decision(true);return new Response('public page');
 };
 assert.equal((await serve(request(),env,strictRuntime)).status,200);assert.equal(calls,2);
 for(const status of [301,302,303,307,308]){
  calls=0;const r=await serve(request(),env,async(url,options)=>{
   calls++;assert.equal(url,gate);assert.equal(options.redirect,'manual');
   return new Response(null,{status,headers:{Location:'https://untrusted.invalid/'+key}});
  });assert.equal(r.status,403);assert.equal(await r.text(),'Access denied');assert.equal(calls,1);
 }
});
test('entry failure diagnostics are fixed stage codes and public responses expose no private cause',async()=>{
 const {serve}=await worker(),logs=[],old=console.warn;console.warn=value=>logs.push(value);
 try{
  for(const [respond,reason]of [
   [()=>{throw new TypeError('secret='+key+' IP=203.0.113.7')},'gate_fetch_TypeError'],
   [()=>new Response('private backend error',{status:403}),'gate_http_403'],
   [()=>new Response('not json'),'gate_content_type'],
   [()=>new Response('bad JSON',{headers:{'Content-Type':'application/json'}}),'gate_json_SyntaxError'],
   [()=>decision(false),'gate_decision_denied'],
  ]){
   const r=await serve(request(),env,respond);assert.equal(r.status,403);assert.equal(await r.text(),'Access denied');assert.equal(logs.at(-1),'dashboard_entry_denied:'+reason);
  }
  assert(logs.every(value=>!value.includes(key)&&!value.includes('203.0.113.7')&&!value.includes('https://')&&!value.includes('private')));
 }finally{console.warn=old;}
});

const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,Request,Response,Headers,URL,TextEncoder,TextDecoder,Uint8Array,atob,crypto:crypto.webcrypto,require:name=>load(path.resolve(path.dirname(file),name))},{filename:file});cache.set(file,mod.exports);return mod.exports;}
const {createEntryGateHandler}=load(path.join(root,'supabase/functions/application-entry-gate/handler.ts'));
const proxyHash=crypto.createHash('sha256').update(key).digest('hex');
const edgeRequest=(body={},headers={})=>new Request('https://synthetic.invalid',{method:'POST',headers:{'Content-Type':'application/json','x-portal-proxy-key':key,'x-portal-client-ip':'203.0.113.7',...headers},body:JSON.stringify(body)});
test('entry Edge accepts only Worker proof and returns only one boolean, never names, lists or client-selected surfaces',async()=>{
 const calls=[],handler=createEntryGateHandler({allowed:async ip=>{calls.push(ip);return true}},{proxyKeySha256:proxyHash});
 const r=await handler(edgeRequest());assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,allowed:true});assert.deepEqual(calls,['203.0.113.7']);assert.equal(r.headers.get('cache-control'),'private, no-store');
 for(const headers of [{'x-portal-proxy-key':'forged'},{'x-portal-proxy-key':''},{'x-portal-client-ip':'203.0.113.7, 198.51.100.1'},{'x-portal-client-ip':'','X-Forwarded-For':'203.0.113.7'}])assert.equal((await handler(edgeRequest({},headers))).status,403);
 for(const body of [{surface:'workorder'},{ip:'198.51.100.1'},{user_id:'synthetic-account'}])assert.equal((await handler(edgeRequest(body))).status,400);
 assert.equal(calls.length,1);assert.equal((await handler(new Request('https://synthetic.invalid'))).status,405);
});
test('entry Edge service failure does not leak privileged errors or authorize an opening',async()=>{
 const handler=createEntryGateHandler({allowed:async()=>{throw Error('private credentials or table detail')}},{proxyKeySha256:proxyHash});const r=await handler(edgeRequest());assert.equal(r.status,503);const body=await r.text();assert(!body.includes('private credentials'));assert(!body.includes('allowed":true'));
});

const owner='11111111-1111-4111-8111-111111111111',viewer='22222222-2222-4222-8222-222222222222',staff='33333333-3333-4333-8333-333333333333';
async function dbFixture(){
 const db=new PGlite();await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;create role service_role bypassrls;
 create function auth.jwt()returns jsonb language sql stable as $$select '{}'::jsonb$$;create function auth.uid()returns uuid language sql stable as $$select null::uuid$$;
 create table auth.users(id uuid primary key,email text,deleted_at timestamptz,banned_until timestamptz);create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
 create table dashboard_profiles(auth_user_id uuid primary key,username text,role text,active boolean,permissions jsonb,data_scope jsonb);
 create table dashboard_security_settings(id smallint primary key,ip_whitelist_enabled boolean,updated_by uuid,updated_at timestamptz);
 create table dashboard_ip_whitelist(id bigint generated always as identity primary key,ip text unique,note text,active boolean,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
 create table workorder_portal_accounts(auth_user_id uuid primary key,username text,role text,active boolean);
 create table private.dashboard_admin_classification_audit(id integer);create table private.dashboard_admin_classification_grants(id integer);create table private.dashboard_admin_provider_overrides(id integer);
 insert into auth.users(id,email)values('${owner}','owner@hensem.local'),('${viewer}','viewer@hensem.local'),('${staff}','staff@workorder.hensem.local');
 insert into dashboard_profiles values('${owner}','owner','owner',true,'{}','{}'),('${viewer}','viewer','viewer',true,'{}','{}');
 insert into workorder_portal_accounts values('${staff}','staff','agent',true);insert into dashboard_security_settings values(1,true,null,now());`);
 for(const file of ['tests/fixtures/security/application-login-prepare.sql','supabase/migrations/20261001122420_application_account_ip_security.sql','supabase/migrations/20261001142618_dashboard_entry_ip_gate.sql'])await db.exec(fs.readFileSync(path.join(root,file),'utf8'));
 const allowed=async ip=>(await db.query('select application_dashboard_entry_allowed($1) allowed',[ip])).rows[0].allowed;
 return{db,allowed};
}
test('unbound global IP opens the entry; bound IP opens only for an eligible account and does not authorize another login',async()=>{
 const {db,allowed}=await dbFixture();try{
  await db.exec(`insert into dashboard_ip_whitelist(ip,active)values('203.0.113.0/24',true);
   insert into private.application_account_security(user_id,surface,ip_mode)values('${viewer}','dashboard','allowlist'),('${staff}','workorder','allowlist');
   insert into private.application_account_ip_rules(user_id,surface,network)values('${viewer}','dashboard','198.51.100.0/24'),('${staff}','workorder','192.0.2.0/24');`);
  assert.equal(await allowed('203.0.113.7'),true);assert.equal(await allowed('198.51.100.7'),true);assert.equal(await allowed('192.0.2.7'),false);assert.equal(await allowed('198.51.101.7'),false);
  const other=(await db.query('select application_auth_ip_check($1,$2,$3) allowed',['dashboard','198.51.100.7',owner])).rows[0].allowed;assert.equal(other,false);
  assert.equal((await db.query('select application_auth_begin($1,$2,$3,$4) result',['dashboard','owner','198.51.100.7','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])).rows[0].result.code,'ip_denied');
  assert.equal((await db.query('select application_auth_begin($1,$2,$3,$4) result',['dashboard','viewer','198.51.100.7','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'])).rows[0].result.allowed,true);
  await db.exec('update dashboard_ip_whitelist set active=false');assert.equal(await allowed('203.0.113.7'),false);
 }finally{await db.close();}
});
test('inactive, inherited, locked, banned, deleted or namespace-conflicted bound rules never open an unlisted IP',async()=>{
 const {db,allowed}=await dbFixture();try{
  await db.exec(`insert into private.application_account_security(user_id,surface,ip_mode)values('${viewer}','dashboard','allowlist');insert into private.application_account_ip_rules(user_id,surface,network)values('${viewer}','dashboard','2001:db8::/64');`);assert.equal(await allowed('2001:db8::7'),true);
  for(const [mutate,restore] of [
   ['update dashboard_profiles set active=false where role=\'viewer\'','update dashboard_profiles set active=true'],
   ["update private.application_account_security set ip_mode='inherit'","update private.application_account_security set ip_mode='allowlist'"],
   ['update private.application_account_security set locked_at=now()','update private.application_account_security set locked_at=null'],
   ["update auth.users set banned_until=now()+interval '1 hour'",'update auth.users set banned_until=null'],
   ['update auth.users set deleted_at=now()','update auth.users set deleted_at=null'],
   ['update private.application_account_ip_rules set active=false','update private.application_account_ip_rules set active=true'],
   [`insert into workorder_portal_accounts values('${viewer}','viewer','agent',true)`,`delete from workorder_portal_accounts where auth_user_id='${viewer}'`],
  ]){await db.exec(mutate);assert.equal(await allowed('2001:db8::7'),false,mutate);await db.exec(restore);assert.equal(await allowed('2001:db8::7'),true,restore);}
  await db.exec('update dashboard_security_settings set ip_whitelist_enabled=false');assert.equal(await allowed('2001:db8::7'),false);
  await db.exec('delete from dashboard_security_settings');assert.equal(await allowed('2001:db8::7'),false);
 }finally{await db.close();}
});
test('entry RPC rejects malformed and network request addresses and is not callable by public users',async()=>{
 const {db,allowed}=await dbFixture();try{
  await db.exec("insert into dashboard_ip_whitelist(ip,active)values('203.0.113.0/24',true)");
  for(const ip of [null,'','garbage','203.0.113.7/24','203.0.113.7, 192.0.2.1',' 203.0.113.7','x'.repeat(65)])assert.equal(await allowed(ip),false);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(allowed('203.0.113.7'),/permission denied/);await db.exec('reset role');}
  await db.exec('set role service_role');assert.equal(await allowed('203.0.113.7'),true);await db.exec('reset role');
 }finally{await db.close();}
});
