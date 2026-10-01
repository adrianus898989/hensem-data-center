const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
const owner='11111111-1111-4111-8111-111111111111',staff='22222222-2222-4222-8222-222222222222',viewer='33333333-3333-4333-8333-333333333333';
const osid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ss='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let seq=0;
async function fixture(){
 const db=new PGlite();
 await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;create role service_role bypassrls;create role authenticator;
 create function auth.jwt()returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 create function auth.uid()returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
 create table auth.users(id uuid primary key,email text);create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
 create table dashboard_profiles(auth_user_id uuid primary key,username text,role text,active boolean,permissions jsonb,data_scope jsonb);
 create table dashboard_admin_preview_grants(auth_user_id uuid,can_view boolean);
 create function private.dashboard_data_scope_valid(jsonb)returns boolean language sql as $$ select true $$;
 create function private.dashboard_role_legacy_allowed()returns boolean language sql as $$ select true $$;
 create function private.dashboard_role_require_gateway()returns void language plpgsql as $$ begin return;end $$;
 create table workorder_portal_accounts(auth_user_id uuid primary key,username text,role text,active boolean);
 create table dashboard_security_settings(id smallint primary key,ip_whitelist_enabled boolean,updated_by uuid,updated_at timestamptz);
 create table dashboard_ip_whitelist(id bigint generated always as identity primary key,ip text unique,note text,active boolean,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
 create table private.dashboard_admin_classification_audit(id integer);create table private.dashboard_admin_classification_grants(id integer);create table private.dashboard_admin_provider_overrides(id integer);
 insert into auth.users values('${owner}','owner@hensem.local'),('${staff}','worker@workorder.hensem.local'),('${viewer}','viewer@hensem.local');
 insert into dashboard_profiles values('${owner}','owner','owner',true,'{}','{"mode":"all","countries":[]}'),('${viewer}','viewer','viewer',true,'{}','{"mode":"all","countries":[]}');
 insert into workorder_portal_accounts values('${staff}','worker','agent',true);
 insert into dashboard_security_settings values(1,false,null,now());insert into auth.sessions values('${osid}','${owner}',null),('${ss}','${staff}',null);
 `);
 await db.exec(read('fixtures/security/application-login-prepare.sql'));
 await db.exec(read('../supabase/migrations/20261001122420_application_account_ip_security.sql'));
 const call=async(name,args=[])=> (await db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args)).rows[0].result;
 const login=async(surface='dashboard',name='owner',ip='203.0.113.7',sid=osid,result='valid')=>{
  const attempt='00000000-0000-4000-8000-'+String(++seq).padStart(12,'0');const b=await call('application_auth_begin',[surface,name,ip,attempt]);
  return b.allowed?call('application_auth_finish',[attempt,result,sid]):b;
 };
 assert.equal((await login()).allowed,true);
 const admin=(action,body={},surface='workorder',ip='203.0.113.7')=>call('application_security_admin',[owner,osid,ip,surface,action,body]);
 const state=async(user=staff,surface='workorder')=>(await admin('account-security',{user_id:user},surface)).security;
 const mutate=async(action,body={},user=staff,surface='workorder')=>admin(action,{...body,user_id:user,expected_version:(await state(user,surface)).version},surface);
 return{db,call,login,admin,state,mutate};
}
test('per-account allowlist overrides global inheritance, matches IPv4/IPv6 and cannot cross account namespace',async()=>{const f=await fixture();try{
 let s=await f.state();assert.equal(s.ip_mode,'inherit');assert.equal(s.ip_rules.length,0);
 await assert.rejects(f.mutate('set-account-ip-mode',{ip_mode:'allowlist'}),/account_whitelist_required/);
 await f.mutate('upsert-account-ip-rule',{network:'198.51.100.10/32',note:'staff office'});
 await f.mutate('upsert-account-ip-rule',{network:'2001:db8:1::/64'});await f.mutate('set-account-ip-mode',{ip_mode:'allowlist'});
 assert.equal(await f.call('application_auth_ip_check',['workorder','198.51.100.10',staff]),true);
 assert.equal(await f.call('application_auth_ip_check',['workorder','203.0.113.7',staff]),false);
 assert.equal(await f.call('application_auth_ip_check',['workorder','2001:db8:1::7',staff]),true);
 assert.equal(await f.call('application_auth_ip_check',['workorder','198.51.100.10',owner]),false);
 assert.equal((await f.login('workorder','worker','203.0.113.7',ss)).code,'ip_denied');
 assert.equal((await f.login('workorder','worker','198.51.100.10',ss)).allowed,true);
 }finally{await f.db.close();}});
test('global and account whitelist revocations permanently revoke affected sessions; a restored rule cannot revive a token',async()=>{const f=await fixture();try{
 await f.admin('upsert-rule',{network:'203.0.113.7/32'});await f.admin('policy',{patch:{ip_enabled:true},expected_version:1});
 assert.equal((await f.login('workorder','worker','203.0.113.7',ss)).allowed,true);
 let r=(await f.admin('list-rules')).rules[0];await f.admin('set-rule-active',{id:r.id,active:false,expected_version:r.version});
 assert.equal((await f.call('application_session_check',[staff,ss,'workorder'])).allowed,false);
 r=(await f.admin('list-rules')).rules[0];await f.admin('set-rule-active',{id:r.id,active:true,expected_version:r.version});
 assert.equal((await f.call('application_session_check',[staff,ss,'workorder'])).allowed,false);
 // A distinct new session is needed after revocation.
 await f.db.query('insert into auth.sessions values($1,$2,null)',['cccccccc-cccc-4ccc-8ccc-cccccccccccc',staff]);
 await f.mutate('upsert-account-ip-rule',{network:'198.51.100.7/32'});await f.mutate('set-account-ip-mode',{ip_mode:'allowlist'});
 assert.equal((await f.login('workorder','worker','198.51.100.7','cccccccc-cccc-4ccc-8ccc-cccccccccccc')).allowed,true);
 r=(await f.state()).ip_rules[0];await f.mutate('delete-account-ip-rule',{id:r.id});
 assert.equal((await f.call('application_session_check',[staff,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','workorder'])).allowed,false);
 }finally{await f.db.close();}});
test('account edits are scoped by target and surface, stale versions fail and denied self-removal rolls back',async()=>{const f=await fixture();try{
 let s=await f.mutate('upsert-account-ip-rule',{network:'203.0.113.7/32'},owner,'dashboard');const rule=s.security.ip_rules[0];
 await f.mutate('set-account-ip-mode',{ip_mode:'allowlist'},owner,'dashboard');
 await assert.rejects(f.mutate('delete-account-ip-rule',{id:rule.id},owner,'dashboard'),/current_ip_would_be_blocked/);
 assert.equal((await f.state(owner,'dashboard')).ip_rules.length,1);
 await assert.rejects(f.mutate('delete-account-ip-rule',{id:rule.id}),/rule_not_found/);
 await assert.rejects(f.admin('account-security',{user_id:owner}),/account_not_found/);
 await assert.rejects(f.admin('set-account-ip-mode',{user_id:owner,ip_mode:'inherit',expected_version:1},'dashboard'),/version_conflict/);
 await assert.rejects(f.admin('policy',{patch:{ip_enabled:false},expected_version:1},'dashboard'),/backend_whitelist_required/);
 }finally{await f.db.close();}});
test('CIDR/mode validation rejects universal networks, non-host request addresses and malformed account input',async()=>{const f=await fixture();try{
 for(const network of ['0.0.0.0/0','::/0','not an IP',' 203.0.113.7'])await assert.rejects(f.mutate('upsert-account-ip-rule',{network}),/invalid_network/);
 await assert.rejects(f.mutate('set-account-ip-mode',{ip_mode:'bad'}),/invalid_ip_mode/);
 await assert.rejects(f.mutate('upsert-account-ip-rule',{network:'203.0.113.7',active:'true'}),/invalid_network/);
 assert.equal(await f.call('application_auth_ip_check',['workorder','203.0.113.7/24',staff]),false);
 assert.equal((await f.admin('account-security',{user_id:staff})).currentIp,'203.0.113.7');
 }finally{await f.db.close();}});
test('five incorrect passwords lock atomically; unavailable service does not count; unlock does not revive old sessions',async()=>{const f=await fixture();try{
 assert.equal((await f.login('workorder','worker','203.0.113.7',ss)).allowed,true);
 await f.login('workorder','worker','203.0.113.7',null,'unavailable');assert.equal((await f.state()).failed_count,0);
 for(let i=1;i<=5;i++){const r=await f.login('workorder','worker','203.0.113.7',null,'invalid');assert.equal(r.code,i<5?'invalid_credentials':'account_locked');}
 assert.equal((await f.state()).failed_count,5);assert.equal((await f.call('application_session_check',[staff,ss,'workorder'])).allowed,false);
 await f.mutate('unlock-account');assert.equal((await f.state()).locked,false);assert.equal((await f.call('application_session_check',[staff,ss,'workorder'])).allowed,false);
 const events=(await f.db.query("select action from private.application_security_audit where target_id=$1",[staff])).rows.map(r=>r.action);assert(events.includes('automatic-lock'));assert(events.includes('unlock-account'));
 }finally{await f.db.close();}});
test('current account whitelist is rechecked at password completion and generation prevents reset races',async()=>{const f=await fixture();try{
 const attempt='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';assert.equal((await f.call('application_auth_begin',['workorder','worker','203.0.113.7',attempt])).allowed,true);
 await f.mutate('upsert-account-ip-rule',{network:'198.51.100.10'});await f.mutate('set-account-ip-mode',{ip_mode:'allowlist'});
 assert.equal((await f.call('application_auth_finish',[attempt,'valid',ss])).allowed,false);
 const next='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef';await f.call('application_auth_begin',['workorder','worker','198.51.100.10',next]);await f.call('application_revoke_user_sessions',[staff,'workorder']);
 assert.equal((await f.call('application_auth_finish',[next,'valid',ss])).code,'attempt_invalid');
 }finally{await f.db.close();}});
test('service-only mutations and private state are inaccessible to anon and authenticated roles',async()=>{const f=await fixture();try{
 for(const role of ['anon','authenticated']){await f.db.exec('set role '+role);
 await assert.rejects(f.call('application_auth_ip_check',['workorder','203.0.113.7',staff]),/permission denied/);
 await assert.rejects(f.call('application_security_admin',[owner,osid,'203.0.113.7','workorder','policy',{}]),/permission denied/);
 await assert.rejects(f.db.query('select private.application_security_state($1,$2)',[staff,'workorder']),/permission denied/);
 await assert.rejects(f.db.query('select * from private.application_account_ip_rules'),/permission denied/);await f.db.exec('reset role');}
 }finally{await f.db.close();}});
test('cutover preserves current role gate and requires a whitelisted approved owner before activating',async()=>{const f=await fixture();try{
 await f.db.exec(read('fixtures/security/authorization-current.sql'));
 const sql=read('../supabase/migrations/20261001122424_application_session_security_cutover.sql');
 await assert.rejects(f.db.exec(sql),/approved_owner_whitelist_required/);await f.db.exec('rollback');
 await f.admin('upsert-rule',{network:'203.0.113.7/32'},'dashboard');await f.db.exec(sql);
 assert.equal((await f.db.query('select ip_whitelist_enabled v from dashboard_security_settings')).rows[0].v,true);
 await f.db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',sub:owner,session_id:osid})]);await f.call('application_pre_request');
 assert.equal(await f.call('dashboard_has_permission',['third_party']),true);
 const def=(await f.db.query("select pg_get_functiondef('private.dashboard_admin_live_scope()'::regprocedure) v")).rows[0].v;assert(def.includes('dashboard_role_require_gateway'));assert(def.includes('application_current_session_allowed'));
 await f.call('application_revoke_session',[owner,osid,'dashboard']);await assert.rejects(f.call('application_pre_request'),/application_session_denied/);assert.equal(await f.call('dashboard_has_permission',['third_party']),false);
 }finally{await f.db.close();}});
