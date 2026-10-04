// Real assigned-role HMAC gateway tests. Synthetic roles and identities only.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const filename=path.join(__dirname,'dashboard-roles-sql.test.cjs'),req=createRequire(filename);let f,metadata;
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
before(async()=>{let setup;const c={require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,after(){},beforeEach(){},afterEach(){}}:req(n),__dirname,process,console,structuredClone};vm.createContext(c);vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.fixture={get db(){return db},as,admin,scalar,manage,granted,execute,OWNER,ADMIN,LEGACY};',c,{filename});await setup();f=c.fixture;
 await f.db.exec(read('tests/fixtures/submission-streak-gateway.sql'));await f.db.exec(read('tests/fixtures/submission-streak-role-catalog.sql'));await f.db.exec("create function private.dashboard_admin_live_submission_streak(p_request jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$begin perform private.dashboard_admin_live_scope();return jsonb_build_object('request',p_request);end$$;");
 metadata=await f.scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid='public.dashboard_admin_execute(text,jsonb)'::regprocedure");
 const migration=read('supabase/migrations/20261004125349_submission_consecutive_days.sql');await f.db.exec(migration.slice(migration.indexOf('do $catalog$'),migration.indexOf('end;$catalog$;')+'end;$catalog$;'.length));await f.db.exec(migration.slice(migration.indexOf('do $gateway$'),migration.indexOf('end;$gateway$;')+'end;$gateway$;'.length));
});
after(async()=>f?.db.close());
async function transaction(fn){await f.admin();await f.db.exec('begin');try{return await fn();}finally{await f.db.exec('rollback');await f.admin();}}
async function denied(fn,pattern){await f.db.exec('savepoint denied');try{await assert.rejects(fn,pattern);}finally{await f.db.exec('rollback to savepoint denied');}}
test('query can read anonymous cohort counts but cannot receive member IDs without events.detail',async()=>transaction(async()=>{
 const role=await f.granted(f.ADMIN,['events.view','events.query']);
 const q={action:'submissionStreak',operation:'start',lookbackDays:30},r=await f.execute('events',q);assert.equal(r.request.operation,'start');
 await denied(()=>f.execute('events',{...q,operation:'members',streakDays:3}),/role_permission_denied/);
 await f.as(f.OWNER);await f.manage({operation:'update',roleId:role.id,expectedVersion:1,permissions:['events.view','events.query','events.detail']});await f.as(f.ADMIN);
 assert.equal((await f.execute('events',{...q,operation:'members',streakDays:3})).request.streakDays,3);
 await denied(()=>f.scalar("select private.dashboard_admin_live_submission_analysis('{}')"),/role_gateway_required/);
}));
test('other authorized pages cannot borrow recurrence access; existing provider summary remains allowed',async()=>transaction(async()=>{
 await f.granted(f.ADMIN,['providers.view','providers.query','providers.detail','events.view']);
 assert.equal((await f.execute('providers',{action:'submissionAnalysis',operation:'summary'})).request.operation,'summary');
 for(const operation of ['start','step','summary','members'])await denied(()=>f.execute('providers',{action:'submissionStreak',operation}),/page_action_denied/);
 await denied(()=>f.execute('events',{action:'submissionStreak',operation:'summary'}),/role_permission_denied/);
}));
test('detail without query is denied, native gateway metadata/ACL preserved, and profile revocation applies',async()=>transaction(async()=>{
 const role=await f.granted(f.ADMIN,['events.view','events.detail']);await denied(()=>f.execute('events',{action:'submissionStreak',operation:'members',streakDays:3}),/role_permission_denied/);
 await f.admin();assert.deepEqual(await f.scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid='public.dashboard_admin_execute(text,jsonb)'::regprocedure"),metadata);
 await f.as(f.OWNER);await f.manage({operation:'update',roleId:role.id,expectedVersion:1,permissions:['events.view','events.query','events.detail']});await f.admin();await f.db.query('update dashboard_profiles set active=false where auth_user_id=$1',[f.ADMIN]);await f.as(f.ADMIN);
 await denied(()=>f.execute('events',{action:'submissionStreak',operation:'summary'}),/required|denied/);
}));
