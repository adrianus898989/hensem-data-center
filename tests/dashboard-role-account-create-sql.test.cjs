const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const migration=read('supabase/migrations/20261001165921_dashboard_role_account_creation.sql');
const helpers=read('tests/fixtures/security/dashboard-role-creation-helpers.sql');
const catalog=require('../src/lib/dashboardRoleCatalog.json').pages;
const OWNER='11111111-1111-4111-8111-111111111111',ACTOR='22222222-2222-4222-8222-222222222222',NEW='33333333-3333-4333-8333-333333333333',EXISTING='44444444-4444-4444-8444-444444444444';
const ROLE='55555555-5555-4555-8555-555555555555',MANAGER='66666666-6666-4666-8666-666666666666',TICKET='77777777-7777-4777-8777-777777777777',SID='88888888-8888-4888-8888-888888888888';
const ALL={mode:'all',countries:[]},BR={mode:'selected',countries:['BR_PANGHU']};
let db;
const scalar=async(q,params=[])=>Object.values((await db.query(q,params)).rows[0])[0];
async function creation(operation,patch={},actor=OWNER){return scalar('select public.dashboard_create_role_account($1,$2,$3::jsonb)',[actor,SID,JSON.stringify({operation,creationId:TICKET,...patch})]);}
async function prepare(actor=OWNER,patch={}){return creation('prepare',{username:'synthetic-new',roleId:ROLE,expectedRoleVersion:7,dataScope:BR,...patch},actor);}
async function fresh(patch={}){await db.query('insert into auth.users(id,email,raw_user_meta_data,created_at) values($1,$2,$3,clock_timestamp())',[patch.id||NEW,patch.email||'synthetic-new@hensem.local',JSON.stringify(patch.metadata||{username:'synthetic-new',dashboard_role:'viewer',dashboard_creation_id:TICKET})]);}
async function denied(action,pattern){await db.exec('savepoint test_denied');try{await assert.rejects(action,pattern);}finally{await db.exec('rollback to savepoint test_denied');}}
const count=table=>scalar('select count(*)::int from '+table);
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create schema auth;create role anon;create role authenticated;create role service_role;
 create table public.dashboard_profiles(auth_user_id uuid primary key,username text unique not null,role text not null,active boolean not null,
 permissions jsonb not null default '{}',management_permissions jsonb not null default '{}',data_scope jsonb not null,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
 create table public.dashboard_admin_preview_grants(auth_user_id uuid primary key,can_view boolean not null default false,granted_by uuid,updated_at timestamptz default now());
 create table private.dashboard_roles(id uuid primary key,name text not null,permissions text[] not null,active boolean not null default true,version bigint not null);
 create table private.dashboard_role_assignments(auth_user_id uuid primary key references public.dashboard_profiles,role_id uuid references private.dashboard_roles,version bigint not null default 1,updated_by uuid,updated_at timestamptz default now());
 create table private.dashboard_role_audit(id bigint generated always as identity,actor_id uuid,operation text,entity_id uuid,before_value jsonb,after_value jsonb,created_at timestamptz default now());
 create table public.dashboard_audit_log(actor_user_id uuid,actor_username text,action text,target_username text,details jsonb);
 create table public.workorder_portal_accounts(auth_user_id uuid primary key);
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,created_at timestamptz default now());
 create table auth.sessions(id uuid,user_id uuid,not_after timestamptz);
 create table private.application_account_security(user_id uuid,surface text,locked_at timestamptz);
 create table private.application_sessions(session_id uuid,user_id uuid,surface text,revoked_at timestamptz,login_ip inet);
 create function private.application_account_exists(p_user uuid,p_surface text,p_active boolean) returns boolean language sql as $$select exists(select 1 from public.dashboard_profiles where auth_user_id=p_user and (not p_active or active is true))$$;
 create function private.application_ip_allowed(p_surface text,p_ip inet,p_user uuid) returns boolean language sql as $$select true$$;`);
 await db.query(`create function private.dashboard_role_catalog() returns jsonb language sql stable set search_path='' as $$select '${JSON.stringify({permissions:catalog.flatMap(p=>p.actions.map(a=>({key:p.id+'.'+a.id})))}).replaceAll("'","''")}'::jsonb$$;`);
 await db.exec(helpers);
 await db.exec(migration);
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('begin');await db.query(`insert into public.dashboard_profiles(auth_user_id,username,role,active,data_scope,management_permissions) values
 ($1,'owner','owner',true,$4::jsonb,'{}'),($2,'manager','viewer',true,$5::jsonb,'{}'),($3,'existing','viewer',true,$5::jsonb,'{}');`,[OWNER,ACTOR,EXISTING,JSON.stringify(ALL),JSON.stringify(BR)]);
 await db.query('insert into private.dashboard_roles values($1,$2,$3::text[],true,7),($4,$5,$6::text[],true,1)',[ROLE,'Empty role',[],MANAGER,'Scoped manager',['access.view','access.create','access.edit','overview.view']]);
 await db.query('insert into private.dashboard_role_assignments(auth_user_id,role_id,updated_by) values($1,$2,$3)',[ACTOR,MANAGER,OWNER]);
 await db.query('insert into public.dashboard_admin_preview_grants(auth_user_id,can_view,granted_by) values($1,true,$2)',[ACTOR,OWNER]);
 for(const id of [OWNER,ACTOR]){await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[SID,id]);await db.query('insert into private.application_sessions(session_id,user_id,surface,login_ip) values($1,$2,$3,$4)',[SID,id,'dashboard','203.0.113.7']);}
});
afterEach(async()=>{await db.exec('rollback');await db.exec('reset role');});

test('only service role executes new RPC; tickets and helper never allow direct authenticated/service access',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await scalar('select has_function_privilege($1,$2,$3)',[role,'public.dashboard_create_role_account(uuid,uuid,jsonb)','execute']),role==='service_role');
  assert.equal(await scalar('select has_function_privilege($1,$2,$3)',[role,'private.dashboard_role_creation_authorize(uuid,uuid,uuid,bigint,jsonb)','execute']),false);
  assert.equal(await scalar('select has_table_privilege($1,$2,$3)',[role,'private.dashboard_account_creation_tickets','select,insert,update,delete']),false);
 }
 assert.equal(await scalar("select relrowsecurity from pg_class where oid='private.dashboard_account_creation_tickets'::regclass"),true);
 assert.deepEqual(await scalar("select proconfig from pg_proc where oid='public.dashboard_create_role_account(uuid,uuid,jsonb)'::regprocedure"),['search_path=""']);
});
test('empty actual role atomically configures active viewer with zero legacy rights and precise scope',async()=>{
 const prepared=await prepare();assert.equal(prepared.status,'prepared');assert.equal(await count('public.dashboard_profiles'),3);
 await fresh();const result=await creation('commit',{accountId:NEW});assert.equal(result.status,'committed');assert.deepEqual(result.account,{auth_user_id:NEW,username:'synthetic-new',role:'viewer',active:true,role_id:ROLE,role_name:'Empty role',role_version:7,assignment_version:1,data_scope:BR});
 const p=await scalar('select to_jsonb(p) from public.dashboard_profiles p where auth_user_id=$1',[NEW]);assert.deepEqual(p.permissions,{home:false,third_party:false,auto_withdraw:false,work_orders:false,customer_service:false});assert.deepEqual(p.management_permissions,{manage_viewers:false,refresh_data:false,view_audit:false});assert.deepEqual(p.data_scope,BR);assert.equal(p.created_by,OWNER);
 assert.equal(await scalar('select role_id from private.dashboard_role_assignments where auth_user_id=$1',[NEW]),ROLE);assert.equal(await scalar('select can_view from public.dashboard_admin_preview_grants where auth_user_id=$1',[NEW]),true);assert.equal(await count('private.dashboard_role_audit'),1);assert.equal(await count('public.dashboard_audit_log'),1);
});
test('delegated actor can grant exactly its live permissions and narrow scope; cannot create legacy implicit roles',async()=>{
 await prepare(ACTOR);await fresh();await creation('commit',{accountId:NEW},ACTOR);assert.equal(await scalar('select role_id from private.dashboard_role_assignments where auth_user_id=$1',[NEW]),ROLE);
 await db.exec('savepoint variant');
 await db.exec('delete from private.dashboard_account_creation_tickets');await db.query('update public.dashboard_profiles set role=$1,management_permissions=$2 where auth_user_id=$3',['admin',JSON.stringify({manage_viewers:true}),ACTOR]);await db.query('delete from private.dashboard_role_assignments where auth_user_id=$1',[ACTOR]);await denied(()=>prepare(ACTOR),/assigned_actor_required/);await db.exec('rollback to savepoint variant');
});
test('Auth-only, disabled, missing registration, locked or revoked sessions cannot prepare a role account',async()=>{
 await denied(()=>prepare(NEW),/application_session_denied/);
 await db.query('update public.dashboard_profiles set active=false where auth_user_id=$1',[ACTOR]);await denied(()=>prepare(ACTOR),/application_session_denied/);await db.query('update public.dashboard_profiles set active=true where auth_user_id=$1',[ACTOR]);
 await db.query('update private.application_sessions set revoked_at=now() where user_id=$1',[ACTOR]);await denied(()=>prepare(ACTOR),/application_session_denied/);await db.query('update private.application_sessions set revoked_at=null where user_id=$1',[ACTOR]);
 await db.query('insert into private.application_account_security values($1,$2,now())',[ACTOR,'dashboard']);await denied(()=>prepare(ACTOR),/application_session_denied/);
});
test('prepare validates exact fields, explicit nonempty scope and active role/version before tickets exist',async()=>{
 for(const patch of [{dataScope:null},{dataScope:{mode:'all'}},{dataScope:{mode:'selected',countries:[]}},{dataScope:{...BR,extra:true}},{dataScope:{mode:'selected',countries:['invalid']}},{expectedRoleVersion:'7'},{expectedRoleVersion:0},{roleId:NEW},{username:'Bad uppercase'},{password:'not-accepted'}])await denied(()=>prepare(OWNER,patch),/invalid|role_unavailable/);
 await denied(()=>prepare(OWNER,{expectedRoleVersion:6}),/role_version_conflict/);await db.query('update private.dashboard_roles set active=false where id=$1',[ROLE]);await denied(()=>prepare(),/role_unavailable/);assert.equal(await count('private.dashboard_account_creation_tickets'),0);
});
test('prepare blocks broader scope, omitted permissions, inactive actor roles and ungrantable target roles',async()=>{
 await denied(()=>prepare(ACTOR,{dataScope:ALL}),/data_scope_exceeds_actor/);await denied(()=>prepare(ACTOR,{dataScope:{mode:'selected',countries:['IN']}}),/data_scope_exceeds_actor/);
 for(const permission of ['access.view','access.create','access.edit']){await db.exec('savepoint rights');await db.query('update private.dashboard_roles set permissions=array_remove(permissions,$1) where id=$2',[permission,MANAGER]);await denied(()=>prepare(ACTOR),/role_creation_denied/);await db.exec('rollback to savepoint rights');}
 await db.query('update private.dashboard_roles set permissions=$1::text[] where id=$2',[['ip.view'],ROLE]);await denied(()=>prepare(ACTOR),/role_grant_exceeds_actor/);
 await db.query('update private.dashboard_roles set active=false where id=$1',[MANAGER]);await denied(()=>prepare(ACTOR),/role_creation_denied/);
});
test('commit rechecks actor/role version/permissions/scope and leaves all configured tables unchanged on denial',async()=>{
 const scenarios=[['update private.dashboard_roles set version=8 where id=$1',ROLE,/role_version_conflict/],['update private.dashboard_roles set permissions=array[\'overview.view\'] where id=$1',ROLE,/role_permissions_changed/],['update public.dashboard_profiles set data_scope=\'{"mode":"selected","countries":["IN"]}\' where auth_user_id=$1',ACTOR,/data_scope_exceeds_actor/],['update private.dashboard_roles set active=false where id=$1',MANAGER,/role_creation_denied/]];
 for(const [sql,id,pattern]of scenarios){await db.exec('savepoint race');await prepare(ACTOR);await fresh();await db.query(sql,[id]);await denied(()=>creation('commit',{accountId:NEW},ACTOR),pattern);assert.equal(await count('public.dashboard_profiles'),3);assert.equal(await count('private.dashboard_role_assignments'),1);assert.equal(await count('private.dashboard_role_audit'),0);assert.equal((await creation('abort',{accountId:NEW},ACTOR)).cleanup_user_id,NEW);await db.exec('rollback to savepoint race');}
});
test('duplicate profiles/Auth usernames, self/old Auth IDs and forged metadata never attach or permit cleanup',async()=>{
 await denied(()=>prepare(OWNER,{username:'existing'}),/account_exists/);
 await fresh({id:EXISTING,email:'existing@hensem.local'});await denied(()=>prepare(OWNER,{username:'existing'}),/account_exists/);
 await prepare();for(const accountId of [OWNER,EXISTING])for(const op of ['commit','abort'])await denied(()=>creation(op,{accountId}),/creation_ticket_denied|fresh_auth_account_required/);
 for(const metadata of [{username:'synthetic-new',dashboard_role:'owner',dashboard_creation_id:TICKET},{username:'synthetic-new',dashboard_role:'viewer',dashboard_creation_id:ROLE}]){await db.exec('savepoint fake');await fresh({metadata});for(const op of ['commit','abort'])await denied(()=>creation(op,{accountId:NEW}),/fresh_auth_account_required/);await db.exec('rollback to savepoint fake');}
});
test('abort-before-commit is final and idempotent; commit-after-abort cannot configure or change target',async()=>{
 await prepare();await fresh();const abort=await creation('abort',{accountId:NEW});assert.equal(abort.cleanup_user_id,NEW);assert.deepEqual(await creation('abort',{accountId:NEW}),abort);await denied(()=>creation('commit',{accountId:NEW}),/creation_ticket_aborted/);await denied(()=>creation('abort',{accountId:EXISTING}),/creation_ticket_denied/);assert.equal(await count('public.dashboard_profiles'),3);
});
test('commit-before-abort/replay returns original ACK after later role edits and never permits cleanup',async()=>{
 await prepare();await fresh();const committed=await creation('commit',{accountId:NEW});await db.query('update private.dashboard_roles set version=8,name=$1 where id=$2',['Updated role',ROLE]);assert.deepEqual(await creation('abort',{accountId:NEW}),committed);assert.deepEqual(await creation('commit',{accountId:NEW}),committed);assert.equal(await count('private.dashboard_role_audit'),1);
});
test('audit failure rolls back profile/assignment/preview together and abort can safely settle remaining Auth',async()=>{
 await prepare();await fresh();await db.exec("create function public.synthetic_audit_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic_audit_failure';end$$;create trigger synthetic_audit_failure before insert on public.dashboard_audit_log for each row execute function public.synthetic_audit_failure();");await denied(()=>creation('commit',{accountId:NEW}),/synthetic_audit_failure/);assert.equal(await count('public.dashboard_profiles'),3);assert.equal(await count('private.dashboard_role_assignments'),1);assert.equal(await count('private.dashboard_role_audit'),0);assert.equal(await scalar('select status from private.dashboard_account_creation_tickets where id=$1',[TICKET]),'prepared');assert.equal((await creation('abort',{accountId:NEW})).cleanup_user_id,NEW);
});
test('expired prepared ticket cannot commit but can abort exact fresh Auth; actor identity cannot steal ticket',async()=>{
 await prepare();await fresh();await db.query("update private.dashboard_account_creation_tickets set created_at=clock_timestamp()-interval '11 minutes' where id=$1",[TICKET]);await denied(()=>creation('commit',{accountId:NEW}),/creation_ticket_expired/);await denied(()=>creation('abort',{accountId:NEW},ACTOR),/creation_ticket_denied/);assert.equal((await creation('abort',{accountId:NEW})).cleanup_user_id,NEW);
});


test('service execution uses SQL authority rather than direct ticket/profile grants, and baseline drift prevents deployment',async()=>{
 await db.exec('set role service_role');await prepare();await db.exec('reset role');await fresh();await db.exec('set role service_role');assert.equal((await creation('commit',{accountId:NEW})).status,'committed');await db.exec('reset role');
 await db.exec("create or replace function private.dashboard_actor_has_permission(p_actor uuid,p_permission text) returns boolean language sql stable security definer set search_path='' as $$select true$$;");
 const preflight=migration.slice(migration.indexOf('do $preflight$'),migration.indexOf('end $preflight$;')+'end $preflight$;'.length);await denied(()=>db.exec(preflight),/role_account_source_contract_drift/);
});
