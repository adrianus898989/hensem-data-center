const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.join(__dirname,'application-account-ip-security.test.cjs');
const m={exports:{}};vm.runInNewContext(fs.readFileSync(file,'utf8').split("test('per-account")[0]+'\nmodule.exports=fixture;', {require,module:m,exports:m.exports,__dirname});
const owner='11111111-1111-4111-8111-111111111111',viewer='33333333-3333-4333-8333-333333333333',actor='44444444-4444-4444-8444-444444444444',sid='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
async function fixture(){const f=await m.exports();await f.db.exec(`
 create function private.dashboard_actor_has_permission(a uuid,k text) returns boolean language sql stable as $$ select exists(select 1 from public.dashboard_profiles where auth_user_id=a and active and (role='owner' or permissions->>k='true')) $$;
 create function private.dashboard_actor_data_scope(a uuid) returns jsonb language sql stable as $$ select data_scope from public.dashboard_profiles where auth_user_id=a and active $$;
 create function private.dashboard_actor_can_manage_account(a uuid,t uuid,k text) returns boolean language sql stable as $$ select private.dashboard_actor_has_permission(a,k) and exists(select 1 from public.dashboard_profiles ap join public.dashboard_profiles tp on tp.auth_user_id=t where ap.auth_user_id=a and tp.role='viewer' and (ap.role='owner' or a<>t and (ap.data_scope->>'mode'='all' or tp.data_scope->>'mode'='selected' and (tp.data_scope->'countries') <@ (ap.data_scope->'countries')))) $$;
 insert into auth.users values('${actor}','manager@hensem.local');
 insert into dashboard_profiles values('${actor}','manager','viewer',true,'{"ip.view":true,"ip.edit":true,"access.view":true,"access.edit":true,"access.status":true}','{"mode":"all","countries":[]}');
 insert into auth.sessions values('${sid}','${actor}',null);
 `);await f.db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261001142800_unified_ip_rule_management.sql'),'utf8'));
 assert.equal((await f.login('dashboard','manager','203.0.113.7',sid)).allowed,true);
 f.asActor=(action,body={},surface='dashboard',ip='203.0.113.7')=>f.call('application_security_admin',[actor,sid,ip,surface,action,body]);return f;}
test('unbound IP remains global; a bound rule atomically enables only its target allowlist and returns consolidated inventory',async()=>{const f=await fixture();try{
 const g=await f.admin('upsert-ip-rule',{scope:'global',network:'203.0.113.7',note:'office'},'dashboard');assert(g.rules.some(r=>r.scope==='global'&&r.username===null));
 const r=await f.admin('upsert-ip-rule',{scope:'account',user_id:viewer,expected_version:1,network:'198.51.100.8',note:'viewer office'},'dashboard');
 const row=r.rules.find(x=>x.scope==='account');assert.equal(row.username,'viewer');assert.equal(row.ip_mode,'allowlist');assert.equal(row.version,2);assert.equal(row.updated_by,'owner');assert.equal(row.user_id,viewer);
 assert.equal(await f.call('application_auth_ip_check',['dashboard','198.51.100.8',viewer]),true);
 assert.equal(await f.call('application_auth_ip_check',['dashboard','203.0.113.7',viewer]),false);
 await f.admin('policy',{patch:{ip_enabled:true},expected_version:1},'dashboard');
 assert.equal(await f.call('application_auth_ip_check',['dashboard','198.51.100.8',owner]),false);
 assert.equal(await f.call('application_auth_ip_check',['dashboard','203.0.113.7',owner]),true);
 assert(r.accounts.some(x=>x.id===viewer&&x.ip_mode==='allowlist'&&x.version===2));
 }finally{await f.db.close();}});
test('live scoped role can edit authorized account rules but cannot read or modify global rules or accounts outside scope',async()=>{const f=await fixture();try{
 await f.db.query("update dashboard_profiles set data_scope=$1 where auth_user_id=$2",[{mode:'selected',countries:['IN']},actor]);
 await f.db.query("update dashboard_profiles set data_scope=$1 where auth_user_id=$2",[{mode:'selected',countries:['IN']},viewer]);
 const list=await f.asActor('list-rules');assert.equal(list.capabilities.manage_global,false);assert(!list.accounts.some(x=>x.id===owner));
 await assert.rejects(f.asActor('upsert-ip-rule',{scope:'global',network:'198.51.100.20'}),/security_permission_denied/);
 const r=await f.asActor('upsert-ip-rule',{scope:'account',user_id:viewer,expected_version:1,network:'198.51.100.8'});assert(r.rules.some(x=>x.user_id===viewer));
 await f.db.query("update dashboard_profiles set data_scope=$1 where auth_user_id=$2",[{mode:'selected',countries:['BR']},viewer]);
 assert.equal((await f.asActor('list-rules')).rules.length,0);
 await assert.rejects(f.asActor('account-security',{user_id:viewer}),/security_permission_denied/);
 await assert.rejects(f.asActor('delete-ip-rule',{scope:'account',user_id:viewer,id:r.rules[0].id,expected_version:2}),/security_permission_denied/);
 }finally{await f.db.close();}});
test('IP, lockout policy and unlock permissions are independent and loss of a grant takes effect immediately',async()=>{const f=await fixture();try{
 await f.db.query("update dashboard_profiles set permissions=$1 where auth_user_id=$2",[{'ip.view':true,'access.view':true},actor]);
 const l=await f.asActor('list-rules');assert.equal(l.capabilities.manage_account,false);assert.equal(l.capabilities.manage_policy,false);
 const s=await f.asActor('account-security',{user_id:viewer});assert.equal(s.capabilities.manage_ip,false);assert.equal(s.capabilities.unlock,false);
 for(const [action,body] of [['policy',{patch:{failure_limit:8},expected_version:1}],['unlock-account',{user_id:viewer,expected_version:1}],['upsert-ip-rule',{scope:'account',user_id:viewer,network:'198.51.100.2',expected_version:1}]])await assert.rejects(f.asActor(action,body),/security_permission_denied/);
 await f.db.query("update dashboard_profiles set permissions='{}' where auth_user_id=$1",[actor]);await assert.rejects(f.asActor('list-rules'),/security_permission_denied/);
 }finally{await f.db.close();}});
test('stale versions, account namespace mismatch and removing the last current address all fail without partial writes',async()=>{const f=await fixture();try{
 let result=await f.admin('upsert-ip-rule',{scope:'global',network:'203.0.113.7'},'dashboard');await f.admin('policy',{patch:{ip_enabled:true},expected_version:1},'dashboard');const row=result.rules[0];
 await assert.rejects(f.admin('delete-ip-rule',{scope:'global',id:row.id,expected_version:row.version},'dashboard'),/current_ip_would_be_blocked/);
 assert.equal((await f.admin('list-rules',{},'dashboard')).rules.length,1);
 const a=await f.admin('upsert-ip-rule',{scope:'account',user_id:viewer,network:'198.51.100.2',expected_version:1},'dashboard');const rule=a.rules.find(x=>x.scope==='account');
 await assert.rejects(f.admin('delete-ip-rule',{scope:'account',user_id:viewer,id:rule.id,expected_version:1},'dashboard'),/version_conflict/);
 await assert.rejects(f.admin('upsert-ip-rule',{scope:'global',user_id:viewer,network:'198.51.100.4'},'dashboard'),/invalid_scope/);
 await assert.rejects(f.admin('upsert-ip-rule',{scope:'account',user_id:viewer,network:'198.51.100.4',expected_version:2},'workorder'),/security_permission_denied/);
 assert.equal((await f.state(viewer,'dashboard')).ip_rules.length,1);
 }finally{await f.db.close();}});
