const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const migration=read('supabase/migrations/20261002055951_application_presence.sql');
const OWNER='11111111-1111-4111-8111-111111111111',ACTOR='22222222-2222-4222-8222-222222222222',BR='33333333-3333-4333-8333-333333333333',IN='44444444-4444-4444-8444-444444444444',STAFF='55555555-5555-4555-8555-555555555555';
const ROLE='66666666-6666-4666-8666-666666666666';
const sessions=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'];
const all={mode:'all',countries:[]},br={mode:'selected',countries:['BR_PANGHU']},india={mode:'selected',countries:['IN']};
let db;
const scalar=async(q,args=[])=>Object.values((await db.query(q,args)).rows[0])[0];
const presence=(actor=OWNER,sid=sessions[0],action='heartbeat',ip='203.0.113.7')=>scalar('select public.application_dashboard_presence($1,$2,$3,$4)',[actor,sid,ip,action]);
async function denied(fn,pattern){await db.exec('savepoint denied');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint denied');}}
const scope=(id,value)=>db.query('update dashboard_profiles set data_scope=$1 where auth_user_id=$2',[JSON.stringify(value),id]);
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create schema auth;create role anon;create role authenticated;create role service_role bypassrls;
 create table auth.users(id uuid primary key,email text);create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
 create table dashboard_profiles(auth_user_id uuid primary key references auth.users on delete cascade,username text unique,role text,active boolean,
 data_scope jsonb,permissions jsonb default '{}',management_permissions jsonb default '{}');
 create table dashboard_admin_preview_grants(auth_user_id uuid primary key,can_view boolean);
 create table private.dashboard_roles(id uuid primary key,name text,permissions text[],active boolean,version bigint);
 create table private.dashboard_role_assignments(auth_user_id uuid primary key,role_id uuid references private.dashboard_roles,version bigint);
 create table workorder_portal_accounts(auth_user_id uuid primary key,username text,role text,active boolean);
 create table dashboard_security_settings(id integer primary key,ip_whitelist_enabled boolean);
 create table dashboard_ip_whitelist(ip text,active boolean);
 create table private.application_security_policies(surface text primary key,ip_enabled boolean);
 create table private.workorder_ip_rules(network cidr,active boolean);
 create table private.application_account_security(user_id uuid,surface text,ip_mode text,locked_at timestamptz);
 create table private.application_account_ip_rules(user_id uuid,surface text,network cidr,active boolean);
 create table private.application_sessions(session_id uuid primary key references auth.sessions on delete cascade,user_id uuid references auth.users,
 surface text,login_ip inet,registered_at timestamptz default now(),revoked_at timestamptz);
 create function private.dashboard_role_catalog() returns jsonb language sql stable set search_path='' as $$select '{"permissions":[{"key":"access.view"},{"key":"overview.view"}]}'::jsonb$$;
 `);
 await db.exec(read('tests/fixtures/security/application-presence-helpers.sql'));
 await db.exec(read('tests/fixtures/security/dashboard-role-creation-helpers.sql'));
 await db.exec(migration);
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('begin');
 await db.query(`insert into auth.users values($1,'owner@hensem.local'),($2,'manager@hensem.local'),($3,'br-viewer@hensem.local'),($4,'in-viewer@hensem.local'),($5,'staff@workorder.hensem.local')`,[OWNER,ACTOR,BR,IN,STAFF]);
 await db.query(`insert into dashboard_profiles(auth_user_id,username,role,active,data_scope) values($1,'owner','owner',true,$5),($2,'manager','viewer',true,$6),($3,'br-viewer','viewer',true,$6),($4,'in-viewer','viewer',true,$7)`,[OWNER,ACTOR,BR,IN,JSON.stringify(all),JSON.stringify(br),JSON.stringify(india)]);
 await db.query('insert into private.dashboard_roles values($1,$2,$3,true,1)',[ROLE,'Scoped directory viewer',['access.view']]);
 await db.query('insert into private.dashboard_role_assignments values($1,$2,1)',[ACTOR,ROLE]);
 await db.query('insert into dashboard_admin_preview_grants values($1,true)',[ACTOR]);
 await db.query("insert into workorder_portal_accounts values($1,'staff','agent',true)",[STAFF]);
 await db.exec("insert into dashboard_security_settings values(1,true);insert into dashboard_ip_whitelist values('203.0.113.0/24',true);insert into private.application_security_policies values('workorder',true);");
 for(const [i,user]of [OWNER,ACTOR,BR,IN,STAFF].entries()){
  await db.query('insert into auth.sessions values($1,$2,null)',[sessions[i],user]);
  await db.query('insert into private.application_sessions(session_id,user_id,surface,login_ip) values($1,$2,$3,$4)',[sessions[i],user,i===4?'workorder':'dashboard','203.0.113.7']);
 }
});
afterEach(async()=>{await db.exec('reset role');await db.exec('rollback');});

test('service-only bounded RPC and private RLS sidecar expose no direct ACLs',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await scalar('select has_function_privilege($1,$2,$3)',[role,'public.application_dashboard_presence(uuid,uuid,text,text)','execute']),role==='service_role');
  assert.equal(await scalar('select has_table_privilege($1,$2,$3)',[role,'private.application_presence_sessions','select,insert,update,delete']),false);
  assert.equal(await scalar('select has_function_privilege($1,$2,$3)',[role,'private.application_presence_scope(uuid)','execute']),false);
 }
 assert.equal(await scalar("select relrowsecurity from pg_class where oid='private.application_presence_sessions'::regclass"),true);
 assert.deepEqual(await scalar("select proconfig from pg_proc where oid='public.application_dashboard_presence(uuid,uuid,text,text)'::regprocedure"),['search_path=""']);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await denied(()=>presence(),/permission denied/);await db.exec('reset role');}
 await db.exec('set role service_role');assert.equal((await presence()).onlineCount,1);await db.exec('reset role');
});
test('only recent authenticated registered dashboard heartbeat counts; status does not manufacture presence',async()=>{
 assert.equal((await presence(OWNER,sessions[0],'status')).onlineCount,0);
 const r=await presence();assert.equal(r.ok,true);assert.equal(r.onlineCount,1);assert.equal(r.windowSeconds,120);assert.equal(r.heartbeatSeconds,30);assert.equal(r.scope,'authorized');
 assert.deepEqual(Object.keys(r.accounts[0]).sort(),['lastSeenAt','username']);assert.equal(r.accounts[0].username,'owner');assert(Number.isFinite(Date.parse(r.observedAt)));
 assert.equal(await scalar('select count(*)::int from auth.users'),5);assert.equal(await scalar('select count(*)::int from private.application_sessions'),5);
});
test('same account across pages and devices is counted once; fast repeats coalesce writes',async()=>{
 await presence();const first=await scalar('select last_seen_at::text from private.application_presence_sessions');await presence();assert.equal(await scalar('select last_seen_at::text from private.application_presence_sessions'),first);
 const second='99999999-9999-4999-8999-999999999999';await db.query('insert into auth.sessions values($1,$2,null)',[second,OWNER]);await db.query("insert into private.application_sessions(session_id,user_id,surface,login_ip) values($1,$2,'dashboard','203.0.113.8')",[second,OWNER]);
 assert.equal((await presence(OWNER,second)).onlineCount,1);assert.equal(await scalar('select count(*)::int from private.application_presence_sessions'),2);
 assert.equal((await presence(OWNER,sessions[0],'leave')).onlineCount,1);assert.equal((await presence(OWNER,second,'leave')).onlineCount,0);
 assert.equal((await presence(OWNER,sessions[0])).onlineCount,1);
});
test('120 second timeout, no future timestamps, pruning and original registration deletion cascade',async()=>{
 await presence();await db.exec("update private.application_presence_sessions set last_seen_at=clock_timestamp()-interval '121 seconds'");assert.equal((await presence(OWNER,sessions[0],'status')).onlineCount,0);
 await db.exec("update private.application_presence_sessions set last_seen_at=clock_timestamp()+interval '1 second'");assert.equal((await presence(OWNER,sessions[0],'status')).onlineCount,0);
 await db.exec("update private.application_presence_sessions set last_seen_at=clock_timestamp()-interval '2 days'");await presence(ACTOR,sessions[1]);assert.equal(await scalar('select count(*)::int from private.application_presence_sessions'),1);
 await db.query('delete from auth.sessions where id=$1',[sessions[1]]);assert.equal(await scalar('select count(*)::int from private.application_presence_sessions'),0);
});
test('precise live canonical scope counts only self and fully contained target scopes',async()=>{
 await presence();await presence(BR,sessions[2]);await presence(IN,sessions[3]);const r=await presence(ACTOR,sessions[1]);assert.equal(r.onlineCount,2);assert.deepEqual(r.accounts.map(a=>a.username),['br-viewer','manager']);
 await scope(BR,all);assert.equal((await presence(ACTOR,sessions[1],'status')).onlineCount,1);
 await scope(BR,br);await scope(ACTOR,india);const changed=await presence(ACTOR,sessions[1],'status');assert.deepEqual(changed.accounts.map(a=>a.username),['in-viewer','manager']);
 await scope(ACTOR,all);assert.equal((await presence(ACTOR,sessions[1],'status')).onlineCount,4);
 await scope(ACTOR,{mode:'selected',countries:[]});await denied(()=>presence(ACTOR,sessions[1]),/presence_account_denied/);
});
test('current role controls roster visibility; base permissions and JWT claims cannot grant names',async()=>{
 await presence(BR,sessions[2]);assert.equal((await presence(BR,sessions[2],'status')).accounts,undefined);
 const r=await presence(ACTOR,sessions[1]);assert.equal(r.accounts.length,r.onlineCount);
 await db.query("update private.dashboard_roles set permissions='{}' where id=$1",[ROLE]);assert.equal((await presence(ACTOR,sessions[1],'status')).accounts,undefined);
 await db.query("update dashboard_profiles set management_permissions='{"+'"manage_viewers":true'+'}'+"' where auth_user_id=$1",[ACTOR]);assert.equal((await presence(ACTOR,sessions[1],'status')).accounts,undefined);
 await db.query('update private.dashboard_roles set active=false where id=$1',[ROLE]);await denied(()=>presence(ACTOR,sessions[1]),/presence_account_denied/);
 assert.equal((await presence(OWNER,sessions[0],'status')).onlineCount,1);
});
test('locked, disabled, removed, expired or revoked sessions immediately disappear without waiting for TTL',async()=>{
 await presence();await presence(BR,sessions[2]);
 const variations=["update dashboard_profiles set active=false where auth_user_id='"+BR+"'","insert into private.application_account_security values('"+BR+"','dashboard','inherit',now())","update auth.sessions set not_after=now()-interval '1 second' where id='"+sessions[2]+"'","update private.application_sessions set revoked_at=now() where session_id='"+sessions[2]+"'","delete from auth.sessions where id='"+sessions[2]+"'"];
 for(const q of variations){await db.exec('savepoint variant');await db.exec(q);assert.equal((await presence(OWNER,sessions[0],'status')).onlineCount,1);await denied(()=>presence(BR,sessions[2]),/application_session_denied/);await db.exec('rollback to savepoint variant');}
});
test('both login IP and most recent current IP stay whitelisted; account IP override takes precedence',async()=>{
 await presence();await presence(BR,sessions[2],'heartbeat','203.0.113.8');
 await db.exec("delete from dashboard_ip_whitelist;insert into dashboard_ip_whitelist values('203.0.113.7',true)");assert.equal((await presence(OWNER,sessions[0],'status')).onlineCount,1);
 await denied(()=>presence(BR,sessions[2],'heartbeat','198.51.100.8'),/ip_denied/);
 await db.query("insert into private.application_account_security values($1,'dashboard','allowlist',null)",[BR]);await db.query("insert into private.application_account_ip_rules values($1,'dashboard','203.0.113.7/32',true)",[BR]);
 assert.equal((await presence(BR,sessions[2])).onlineCount,1);await denied(()=>presence(BR,sessions[2],'heartbeat','203.0.113.8'),/ip_denied/);
});
test('Auth-only identity, different account session, employee namespace, invalid action or subnet cannot create presence',async()=>{
 const fake='77777777-7777-4777-8777-777777777777';await db.query("insert into auth.users values($1,'unconfigured@hensem.local')",[fake]);
 for(const [a,s]of [[fake,sessions[0]],[ACTOR,sessions[0]],[STAFF,sessions[4]]])await denied(()=>presence(a,s),/application_session_denied/);
 for(const action of [null,'register','other'])await denied(()=>presence(OWNER,sessions[0],action),/invalid_presence_request/);
 for(const ip of [null,'not-an-ip','203.0.113.7/24'])await denied(()=>presence(OWNER,sessions[0],'heartbeat',ip),/invalid_presence_request/);
 assert.equal(await scalar('select count(*)::int from private.application_presence_sessions'),0);
});
test('legacy invalid scope and deactivated assigned target role never broaden the aggregate',async()=>{
 await presence();await presence(BR,sessions[2]);await scope(BR,{mode:'selected',countries:['unknown-country']});assert.equal((await presence(OWNER,sessions[0],'status')).onlineCount,1);
 await scope(BR,br);await db.query('insert into private.dashboard_role_assignments values($1,$2,1)',[BR,ROLE]);await db.query('update private.dashboard_roles set active=false where id=$1',[ROLE]);assert.equal((await presence(OWNER,sessions[0],'status')).onlineCount,1);
});
test('exact source baseline guard detects authorization helper drift before any deployment DDL',async()=>{
 await db.exec("create or replace function private.dashboard_actor_has_permission(p_actor uuid,p_permission text) returns boolean language sql stable security definer set search_path='' as $$select true$$;");
 const preflight=migration.slice(migration.indexOf('do $preflight$'),migration.indexOf('end $preflight$;')+'end $preflight$;'.length);await denied(()=>db.exec(preflight),/presence_source_contract_drift/);
});
