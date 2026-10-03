// Synthetic data in PGlite only. Executes real HMAC role gateway and current readers.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const migration=read('supabase/migrations/20261003105349_payout_config_assigned_role_access.sql');
const baseline=read('tests/fixtures/payout-config-role-access/production-functions.sql');
const localMigration=migration.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
let f,db,metadataBefore,metadataAfter,profilesBefore,profilesAfter;
const affected=['private.dashboard_admin_live_payout_config(jsonb)','public.dashboard_game66_review_rules()'];
const meta=()=>f.scalar("select jsonb_object_agg(oid::regprocedure::text,to_jsonb(p)-'prosrc') from pg_proc p where oid=any($1::regprocedure[])",[affected]);
const direct=r=>f.scalar('select public.dashboard_admin_live_payout_config($1::jsonb)',[JSON.stringify(r)]);
const query=(system='AR',extra={})=>f.execute('payout_config',{action:'payoutConfig',operation:'index',system,...extra});
let roleSequence=0;
const grant=async permissions=>{await f.admin();const version=await f.scalar('select coalesce((select version from private.dashboard_role_assignments where auth_user_id=$1),0)',[f.ADMIN]);await f.as(f.OWNER);const r=(await f.manage({operation:'create',name:'Payout role '+(++roleSequence),permissions})).role;await f.manage({operation:'assign',accountId:f.ADMIN,roleId:r.id,expectedVersion:Number(version)});await f.as(f.ADMIN);return r;};
async function denied(run,pattern=/denied|required|permission/){await db.exec('savepoint expected_denial');try{await assert.rejects(run,pattern);}finally{await db.exec('rollback to savepoint expected_denial');}}
before(async()=>{
 const filename=path.join(__dirname,'dashboard-roles-sql.test.cjs'),req=createRequire(filename);let setup;
 const c={require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,after(){},beforeEach(){},afterEach(){}}:req(n),__dirname,process,console,structuredClone};
 vm.createContext(c);vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.fixture={get db(){return db},as,admin,scalar,manage,granted,execute,OWNER,ADMIN,VIEWER,LEGACY};',c,{filename});
 await setup();f=c.fixture;db=f.db;
 await db.exec(`
 create function private.application_current_session_allowed(text) returns boolean language sql stable set search_path='' as $$select coalesce(nullif(current_setting('fixture.session_allowed',true),''),'true')='true'$$;
 revoke all on function private.application_current_session_allowed(text) from public,anon,authenticated,service_role;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable set search_path='' as $$select coalesce($1->>'mode'='all' or ($1->'platforms' ? ($2||':'||$3)),false)$$;
 create function private.dashboard_data_group(text,text) returns text language sql immutable set search_path='' as $$select $1$$;
 create table ar_config_targets(country_code text,country_name text,platform text,timezone text,currency text,source_system text);
 create table ar_config_daily(country_code text,platform text,timezone text,observed_at timestamptz,observed_local_date date,received_at timestamptz,parser_version text,configuration jsonb);
 insert into ar_config_targets values('IN','India','AR-A','Asia/Kolkata','INR','AR'),('IN','India','AR-B','Asia/Kolkata','INR','AR');
 insert into ar_config_daily values('IN','AR-A','Asia/Kolkata','2026-10-01T01:00Z','2026-10-01','2026-10-01T01:01Z','synthetic','{"fields":[{"key":"autoWithdraw","value":true,"available":true},{"key":"password","value":"SYNTHETIC-HIDDEN"}],"groups":[],"raw_payload":{"token":"SYNTHETIC-HIDDEN"}}');
 create table game66_platforms(id uuid primary key,platform_code text,platform_name text,team_code text,team_name text,updated_at timestamptz);
 create table game66_review_rules(id uuid primary key,platform_id uuid,rule_id text,template_id text,title text,operator text,value numeric,rule_type text,description text,enabled boolean,remark text,effective_type text,effective_channel text,effective_type_text text,raw_payload jsonb,payload_hash text,last_seen_at timestamptz);
 insert into game66_platforms values('10000000-0000-4000-8000-000000000001','HK-A','HK-A','hong_kong','Hong Kong','2026-10-01'),('10000000-0000-4000-8000-000000000002','HK-B','HK-B','hong_kong','Hong Kong','2026-10-01');
 insert into game66_review_rules values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','RULE-1','TEMPLATE-1','Amount','<=',100,'amount','SYNTHETIC-HIDDEN',true,'SYNTHETIC-HIDDEN','all','all','All','{"token":"SYNTHETIC-HIDDEN"}','SYNTHETIC-HASH','2026-10-01');
 `);
 const source=read('supabase/admin-live-payout-config.sql');
 await db.exec(source.slice(0,source.indexOf('create function private.dashboard_admin_live_payout_config(')).replace(/^begin;$/m,''));
 await db.exec(baseline);
 await db.exec(`create function public.dashboard_admin_live_payout_config(p_request jsonb default '{}'::jsonb) returns jsonb language sql stable set search_path='' as $$select private.dashboard_admin_live_payout_config(p_request)$$;
 revoke all on function public.dashboard_admin_live_payout_config(jsonb) from public,anon,service_role;grant execute on function public.dashboard_admin_live_payout_config(jsonb) to authenticated;
 update public.dashboard_profiles set permissions='{"auto_withdraw":false}',data_scope='{"mode":"selected","platforms":["IN:AR-A","印度:HK-A"]}' where username='admin';`);
 metadataBefore=await meta();profilesBefore=await f.scalar('select jsonb_agg(to_jsonb(p) order by username) from public.dashboard_profiles p');
 await db.exec(migration);
 metadataAfter=await meta();profilesAfter=await f.scalar('select jsonb_agg(to_jsonb(p) order by username) from public.dashboard_profiles p');
});
after(async()=>db?.close());
beforeEach(async()=>{await f.admin();await db.exec('begin');});
afterEach(async()=>{await db.exec('rollback');await f.admin();});

test('regression: saved page view/query now reads despite the legacy module being false',async()=>{
 await grant(['payout_config.view','payout_config.query']);
 const result=await query();assert.deepEqual(result.targets.map(t=>t.platform),['AR-A']);assert.equal(result.readOnly,true);
 const snapshot=await query('AR',{operation:'snapshot',country:'IN',platform:'AR-A'});assert.equal(snapshot.snapshot.configuration.fields[0].value,true);assert.doesNotMatch(JSON.stringify(snapshot),/SYNTHETIC-HIDDEN|raw_payload|password|token/);
 await f.admin();assert.equal(await f.scalar("select permissions->>'auto_withdraw' from public.dashboard_profiles where username='admin'"),'false');
 await db.exec('savepoint old_reader');await db.exec(baseline);await f.as(f.ADMIN);
 await denied(()=>query(),/auto_withdraw_permission_denied/);await f.admin();await db.exec('rollback to savepoint old_reader');
});

test('GAME66 delegated snapshot follows the same page grant through its downstream reader',async()=>{
 await grant(['payout_config.view','payout_config.query']);
 const index=await query('GAME66_HK');assert.deepEqual(index.targets.map(t=>t.platform),['HK-A']);
 const snapshot=await query('GAME66_HK',{operation:'snapshot',country:'GAME66_HK',platform:'HK-A'});
 assert.equal(snapshot.snapshot.configuration.rules[0].value,100);assert.doesNotMatch(JSON.stringify(snapshot),/SYNTHETIC-HIDDEN|raw_payload|payload_hash|description|remark/);
 await denied(()=>query('GAME66_HK',{operation:'snapshot',country:'GAME66_HK',platform:'HK-B'}),/config_target_denied/);
 await denied(()=>f.scalar('select public.dashboard_game66_review_rules()'),/DASHBOARD_PERMISSION_DENIED/);
});

test('view-only, query-only, export-only and auto-withdraw-only grants cannot substitute for page view/query',async()=>{
 // The real role writer already rejects query without view; assert that guard
 // rather than inserting a role that could never be saved through the API.
 await f.as(f.OWNER);await denied(()=>f.manage({operation:'create',name:'Invalid query-only',permissions:['payout_config.query']}),/invalid_role/);
 for(const permissions of [['payout_config.view'],['payout_config.view','payout_config.export'],['auto_withdraw.view','auto_withdraw.query']]){
  await grant(permissions);await denied(()=>query());
 }
});

test('even authentic local signatures cannot authorize another page, action, RPC or capability',async()=>{
 await grant(['payout_config.view','payout_config.query','overview.view','overview.query']);await f.admin();
 const base=await f.scalar(`select jsonb_build_object('uid',auth.uid(),'txid',pg_current_xact_id()::text,'pid',pg_backend_pid()::text,
  'roleId',r.id,'roleVersion',r.version,'assignmentVersion',a.version,
  'page','payout_config','action','payoutConfig','rpc','dashboard_admin_live_payout_config','capability','query')
  from private.dashboard_role_assignments a join private.dashboard_roles r on r.id=a.role_id where a.auth_user_id=auth.uid()`);
 // Synthetic PGlite owner only: use the fixture's real HMAC implementation,
 // never production session material, to isolate the new exact-route check.
 for(const change of [{},{page:'overview'},{action:'aggregate'},{rpc:'dashboard_admin_live_query'},{capability:'export'}]){
  await f.scalar(`select set_config('hensem.dashboard_role_context',jsonb_build_object('payload',$1::jsonb,
   'signature',private.dashboard_role_hmac(($1::jsonb)::text,(select secret from private.dashboard_role_context_secret where singleton)))::text,true)`,[JSON.stringify({...base,...change})]);
  assert.equal(await f.scalar('select private.dashboard_role_context_valid()'),true);
  assert.equal(await f.scalar('select private.dashboard_payout_config_access_allowed()'),Object.keys(change).length===0);
 }
});

test('direct, other-page and forged-context calls stay denied even when the old module flag is true',async()=>{
 await grant(['payout_config.view','payout_config.query','overview.view','overview.query']);
 await denied(()=>direct({system:'AR'}),/role_gateway_required/);
 await denied(()=>f.execute('overview',{action:'payoutConfig',system:'AR'}));
 await f.admin();await db.exec("update public.dashboard_profiles set permissions='{"+'"auto_withdraw":true'+"}' where username='admin'");await f.as(f.ADMIN);
 await db.query("select set_config('hensem.dashboard_role_context',$1,true)",[JSON.stringify({payload:{page:'payout_config',rpc:'dashboard_admin_live_payout_config',action:'payoutConfig',capability:'query'},signature:'forged'})]);
 await denied(()=>direct({system:'AR'}),/role_gateway_required/);await denied(()=>f.scalar('select public.dashboard_game66_review_rules()'),/DASHBOARD_PERMISSION_DENIED/);
});

test('fresh role, profile, preview and approved-session revocations deny subsequent requests',async()=>{
 const role=await grant(['payout_config.view','payout_config.query']);assert.equal((await query()).targets.length,1);
 for(const sql of ["update private.dashboard_roles set active=false", "update private.dashboard_roles set permissions=array['payout_config.view']", "update public.dashboard_profiles set active=false where username='admin'", "update public.dashboard_admin_preview_grants set can_view=false", "select set_config('fixture.session_allowed','false',true)"]){
  await f.admin();await db.exec('savepoint revoke');await db.exec(sql);await f.as(f.ADMIN);await denied(()=>query());await f.admin();await db.exec('rollback to savepoint revoke');
 }
 await f.as(f.OWNER);await f.manage({operation:'update',roleId:role.id,expectedVersion:1,permissions:['payout_config.view']});await f.as(f.ADMIN);await denied(()=>query(),/role_permission_denied/);
});

test('updated data scope filters the same real readers without increasing any stored grant',async()=>{
 await grant(['payout_config.view','payout_config.query']);await denied(()=>query('AR',{operation:'snapshot',country:'IN',platform:'AR-B'}),/config_target_denied/);
 await f.admin();await db.exec("update public.dashboard_profiles set data_scope='{"+'"mode":"selected","platforms":[]'+"}' where username='admin'");await f.as(f.ADMIN);
 assert.deepEqual((await query()).targets,[]);assert.deepEqual((await query('GAME66_HK')).targets,[]);
});

test('owners and unassigned accounts retain their prior legacy checks; no global permission bypass is introduced',async()=>{
 await f.as(f.OWNER);assert.equal((await direct({system:'AR'})).targets.length,2);
 await f.as(f.LEGACY);await denied(()=>direct({system:'AR'}),/auto_withdraw_permission_denied/);
 await f.admin();await db.exec("update public.dashboard_profiles set permissions='{"+'"auto_withdraw":true'+"}',data_scope='{"+'"mode":"selected","platforms":["IN:AR-A"]'+"}' where username='legacy'");await f.as(f.LEGACY);
 assert.deepEqual((await direct({system:'AR'})).targets.map(t=>t.platform),['AR-A']);
 await f.admin();await db.exec("select set_config('fixture.session_allowed','false',true)");await f.as(f.OWNER);await denied(()=>direct({system:'AR'}),/application_session_denied/);
});

test('reader OIDs, ACLs and every metadata field remain unchanged, and the new helper is owner-only invoker',async()=>{
 assert.deepEqual(metadataAfter,metadataBefore);assert.deepEqual(profilesAfter,profilesBefore);
 const p=await f.scalar("select jsonb_build_object('definer',prosecdef,'volatility',provolatile,'path',proconfig,'allowed',(select jsonb_agg(pg_get_userbyid(x.grantee))from aclexplode(proacl)x)) from pg_proc where oid='private.dashboard_payout_config_access_allowed()'::regprocedure");
 assert.equal(p.definer,false);assert.equal(p.volatility,'s');assert.deepEqual(p.path,['search_path=""']);assert.deepEqual(p.allowed,['postgres']);
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await denied(()=>f.scalar('select private.dashboard_payout_config_access_allowed()'),/permission denied/);await f.admin();}
});

test('definition or ACL drift is rejected atomically before changing either reader',async()=>{
 for(const drift of ["alter function private.dashboard_admin_live_payout_config(jsonb) set search_path=public", "grant execute on function public.dashboard_game66_review_rules() to anon", "grant execute on function private.dashboard_role_context_valid() to service_role"]){
  await db.exec('savepoint baseline_restore');await db.exec(baseline);await db.exec('drop function private.dashboard_payout_config_access_allowed()');await db.exec(drift);
  await denied(()=>db.exec(localMigration),/payout_config_access_(definition|metadata)_drift/);
  assert.equal(await f.scalar("select to_regprocedure('private.dashboard_payout_config_access_allowed()') is null"),true);
  await db.exec('rollback to savepoint baseline_restore');
 }
});

test('installation-specific default function grants cannot expose the helper',async()=>{
 await db.exec(baseline);await db.exec('drop function private.dashboard_payout_config_access_allowed();create role synthetic_default_reader;alter default privileges grant execute on functions to synthetic_default_reader');
 await db.exec(localMigration);
 assert.equal(await f.scalar("select has_function_privilege('synthetic_default_reader','private.dashboard_payout_config_access_allowed()','execute')"),false);
});
