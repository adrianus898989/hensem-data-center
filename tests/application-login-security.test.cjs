const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/application-login-security.sql'),'utf8');
const baseline=fs.readFileSync(path.join(__dirname,'fixtures/application-security-baseline.sql'),'utf8').replaceAll('$function$\n\nCREATE','$function$;\n\nCREATE')+';';
const owner='11111111-1111-4111-8111-111111111111',staff='22222222-2222-4222-8222-222222222222',viewer='33333333-3333-4333-8333-333333333333',osid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ss='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';let attempt=0;
async function fixture(){const db=new PGlite();await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;create role service_role bypassrls;create role authenticator;
create function auth.jwt()returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function auth.uid()returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
create table auth.users(id uuid primary key,email text);
create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
create table public.dashboard_profiles(auth_user_id uuid primary key,username text,role text,active boolean,permissions jsonb,data_scope jsonb);
create table public.dashboard_admin_preview_grants(auth_user_id uuid,can_view boolean);
create function private.dashboard_data_scope_valid(jsonb)returns boolean language sql as $$ select true $$;
create table public.workorder_portal_accounts(auth_user_id uuid primary key,username text,role text,active boolean);
create table public.dashboard_security_settings(id smallint primary key,ip_whitelist_enabled boolean,updated_by uuid,updated_at timestamptz);
create table public.dashboard_ip_whitelist(id bigint generated always as identity primary key,ip text unique,note text,active boolean,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
insert into auth.users values('${owner}','owner@hensem.local'),('${staff}','worker@workorder.hensem.local'),('${viewer}','viewer@hensem.local');
insert into dashboard_profiles values('${owner}','owner','owner',true,'{}','{"mode":"all","countries":[]}'),('${viewer}','viewer','viewer',true,'{"third_party":true}','{"mode":"all","countries":[]}');
insert into workorder_portal_accounts values('${staff}','worker','agent',true);
insert into dashboard_security_settings values(1,false,null,now());insert into auth.sessions values('${osid}','${owner}',null),('${ss}','${staff}',null);
`);try { await db.exec(baseline);await db.exec(sql);await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/application-login-security-activate.sql'),'utf8')); } catch(error) { await db.close(); throw error; }const call=async(name,args)=>{const params=args.map((_,i)=>'$'+(i+1)).join(',');return(await db.query('select public.'+name+'('+params+') result',args)).rows[0].result;};
const begin=(surface='workorder',username='worker',ip='203.0.113.7')=>call('application_auth_begin',[surface,username,ip,'00000000-0000-4000-8000-'+String(++attempt).padStart(12,'0')]);
const finish=(result,sid=null)=>call('application_auth_finish',['00000000-0000-4000-8000-'+String(attempt).padStart(12,'0'),result,sid]);
const loginOwner=async()=>{assert.equal((await begin('dashboard','owner')).allowed,true);assert.equal((await finish('valid',osid)).allowed,true);};
const admin=(action,body={},surface='workorder',ip='203.0.113.7')=>call('application_security_admin',[owner,osid,ip,surface,action,body]);
return{db,call,begin,finish,loginOwner,admin};}
test('approved session is required by direct Data API, scopes and permission gate; namespace cannot cross',async()=>{const f=await fixture();try{
 await f.db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',sub:owner,session_id:osid})]);
 assert.equal(await f.call('application_session_guard',[]),false);await assert.rejects(f.call('application_pre_request',[]),/application_session_denied/);
 assert.equal((await f.db.query("select dashboard_has_permission('third_party') v")).rows[0].v,false);
 await assert.rejects(f.db.query('select private.dashboard_admin_live_scope()'),/application_session_denied/);
 await f.loginOwner();assert.equal(await f.call('application_session_guard',[]),true);await f.call('application_pre_request',[]);
 assert.equal((await f.call('application_session_check',[owner,osid,'workorder'])).allowed,false);
 assert.equal((await f.begin('workorder','owner')).allowed,false);assert.equal((await f.begin('dashboard','worker')).allowed,false);
 await f.db.exec('set role authenticated');await assert.rejects(f.call('application_auth_begin',['dashboard','owner','203.0.113.7',ss]),/permission denied/);await assert.rejects(f.db.query('select * from private.application_sessions'),/permission denied/);
 }finally{await f.db.close();}});
test('invalid passwords count atomically, concurrent attempts blocked, threshold locks even owner and invalidates old sessions',async()=>{const f=await fixture();try{
 await f.loginOwner();await f.admin('set-account-policy',{user_id:owner,failure_limit:2,expected_version:2},'dashboard');
 assert.equal((await f.begin('dashboard','owner')).allowed,true);const previous=attempt;assert.equal((await f.begin('dashboard','owner')).code,'login_busy');attempt=previous;
 assert.equal((await f.finish('invalid')).code,'invalid_credentials');await assert.rejects(f.admin('set-account-policy',{user_id:owner,failure_limit:3,expected_version:1},'dashboard'),/version_conflict/);
 await f.begin('dashboard','owner');assert.equal((await f.finish('invalid')).code,'account_locked');
 assert.equal((await f.call('application_session_check',[owner,osid,'dashboard'])).allowed,false);assert.equal((await f.begin('dashboard','owner')).code,'account_locked');
 assert.equal((await f.db.query('select count(*)::int n from private.application_security_audit where action=\'automatic-lock\'')).rows[0].n,1);
 }finally{await f.db.close();}});
test('unavailable attempts do not count; duplicate finish and foreign session cannot approve; successful login resets',async()=>{const f=await fixture();try{
 await f.begin();await f.finish('unavailable');assert.equal((await f.db.query('select failed_count from private.application_account_security')).rows[0].failed_count,0);
 await f.begin();await f.finish('invalid');assert.equal((await f.finish('invalid')).code,'attempt_invalid');
 await f.begin();assert.equal((await f.finish('valid',osid)).allowed,false);assert.equal((await f.call('application_session_check',[staff,ss,'workorder'])).allowed,false);
 await f.begin();assert.equal((await f.finish('valid',ss)).allowed,true);assert.equal((await f.db.query('select failed_count from private.application_account_security')).rows[0].failed_count,0);
 await f.call('application_revoke_user_sessions',[staff,'workorder']);assert.equal((await f.call('application_session_check',[staff,ss,'workorder'])).allowed,false);
 }finally{await f.db.close();}});
test('unlock resets automatic lock without activating manually disabled account or reviving revoked session',async()=>{const f=await fixture();try{
 await f.loginOwner();await f.begin();await f.finish('valid',ss);
 let s=(await f.admin('account-security',{user_id:staff})).security;await f.admin('set-account-policy',{user_id:staff,failure_limit:1,expected_version:s.version});await f.begin();await f.finish('invalid');
 await f.db.query('update workorder_portal_accounts set active=false where auth_user_id=$1',[staff]);s=(await f.admin('account-security',{user_id:staff})).security;assert.equal(s.locked,true);
 const unlocked=(await f.admin('unlock-account',{user_id:staff,expected_version:s.version})).security;assert.equal(unlocked.locked,false);assert.equal(unlocked.failed_count,0);
 assert.equal((await f.begin()).allowed,false);await f.db.query('update workorder_portal_accounts set active=true where auth_user_id=$1',[staff]);assert.equal((await f.call('application_session_check',[staff,ss,'workorder'])).allowed,false);
 const states=(await f.admin('list-account-security')).states;assert.equal(states.length,1);assert.equal(states[0].user_id,staff);
 await assert.rejects(f.admin('account-security',{user_id:owner}),/account_not_found/);
 }finally{await f.db.close();}});
test('CIDR whitelist uses one dashboard source; protects current owner IP and isolates workorder; stale versions fail',async()=>{const f=await fixture();try{
 await f.loginOwner();await assert.rejects(f.admin('policy',{patch:{ip_enabled:true},expected_version:1},'dashboard'),/current_ip_would_be_blocked/);
 let r=await f.admin('upsert-rule',{network:'203.0.113.17/24',note:'office'},'dashboard');assert.equal(r.rules[0].network,'203.0.113.0/24');
 await f.admin('policy',{patch:{ip_enabled:true},expected_version:1},'dashboard');assert.equal((await f.db.query('select ip_whitelist_enabled from dashboard_security_settings')).rows[0].ip_whitelist_enabled,true);
 assert.equal(await f.call('application_auth_ip_check',['dashboard','203.0.113.8']),true);assert.equal(await f.call('application_auth_ip_check',['dashboard','198.51.100.2']),false);
 await assert.rejects(f.admin('delete-rule',{id:r.rules[0].id,expected_version:1},'dashboard'),/current_ip_would_be_blocked/);
 await f.admin('upsert-rule',{network:'2001:db8::1234/64'});await f.admin('policy',{patch:{ip_enabled:true},expected_version:1});
 assert.equal(await f.call('application_auth_ip_check',['workorder','203.0.113.7']),false);assert.equal(await f.call('application_auth_ip_check',['workorder','2001:db8::8']),true);
 await assert.rejects(f.admin('upsert-rule',{network:'0.0.0.0/0'}),/invalid_network/);await assert.rejects(f.admin('policy',{patch:{failure_limit:9},expected_version:1}),/version_conflict/);
 }finally{await f.db.close();}});
test('session signout, auth deletion, expiry, manual inactive and lock changes fail fresh checks',async()=>{const f=await fixture();try{
 await f.loginOwner();await f.begin();await f.finish('valid',ss);await f.call('application_revoke_session',[staff,ss,'workorder']);assert.equal((await f.call('application_session_check',[staff,ss,'workorder'])).allowed,false);
 await f.db.query('update auth.sessions set not_after=now()-interval \'1 second\' where id=$1',[osid]);assert.equal((await f.call('application_session_check',[owner,osid,'dashboard'])).allowed,false);
 await f.db.query('update auth.sessions set not_after=null where id=$1',[osid]);await assert.rejects(f.db.query('update dashboard_profiles set active=false where auth_user_id=$1',[owner]),/last_owner_required/);
 await f.db.query('delete from auth.sessions where id=$1',[osid]);assert.equal((await f.call('application_session_check',[owner,osid,'dashboard'])).allowed,false);
 }finally{await f.db.close();}});

test('revoke invalidates in-flight old-password login and SQL disable blocks later session revival',async()=>{const f=await fixture();try{await f.loginOwner();await f.begin();await f.call('application_revoke_user_sessions',[staff,'workorder']);const oldAttempt=attempt;assert.equal((await f.begin()).allowed,true);const newAttempt=attempt;attempt=oldAttempt;assert.equal((await f.finish('valid',ss)).allowed,false);attempt=newAttempt;await f.finish('unavailable');assert.equal((await f.call('application_session_check',[staff,ss,'workorder'])).allowed,false);await f.begin();await f.finish('valid',ss);await f.db.query('update workorder_portal_accounts set active=false where auth_user_id=$1',[staff]);await f.db.query('update workorder_portal_accounts set active=true where auth_user_id=$1',[staff]);assert.equal((await f.call('application_session_check',[staff,ss,'workorder'])).allowed,false);}finally{await f.db.close();}});
