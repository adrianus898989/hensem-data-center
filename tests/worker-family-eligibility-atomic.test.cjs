// Real runtime functions and exact maintenance CAS, with synthetic semantic inputs.
// No production dependency catalog, business facts or outside-workspace fixture.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');let db;
const scalar=async(s,a=[])=>Object.values((await db.query(s,a)).rows[0])[0],install=read('supabase/maintenance/shared-worker-eligibility.sql'),rollback=read('supabase/maintenance/shared-worker-eligibility.rollback.sql');
const fn=(name)=>{const text=read('tests/fixtures/withdraw-priority-readers.oct21.sql'),i=text.indexOf('CREATE OR REPLACE FUNCTION private.'+name+'(');assert(i>=0);return text.slice(i,text.indexOf('$function$;',text.indexOf('AS $function$',i)+14)+12);};
before(async()=>{db=new PGlite();await db.exec(`
 create schema private;create schema cron;create role anon;create role authenticated;create role service_role;
 set check_function_bodies=off;
 create table cron.job(command text);
 create table private.fixture_targets(id uuid primary key,scope_group text,name text);
 insert into private.fixture_targets values('00000000-0000-4000-8000-000000000001','IN','SYNTHETIC-A'),('00000000-0000-4000-8000-000000000002','ID','SYNTHETIC-B');
 create function private.prepared_aggregate_native_catalog()returns setof private.fixture_targets language sql stable set search_path=''as $$select *from private.fixture_targets$$;
 create table private.prepared_aggregate_worker_turn(singleton boolean primary key,next_kind text,waiting_since timestamptz,interactive_streak smallint,lane_interactive_streak smallint,lane_waiting_since timestamptz);
 create table private.prepared_aggregate_jobs(id uuid primary key,status text,lease_until timestamptz,payload jsonb);
 create table private.provider_snapshot_jobs(id uuid,status text,lease_until timestamptz);
 create table private.provider_snapshot_targets(platform_id uuid,target jsonb,enabled boolean);
 create table private.withdraw_prepared_jobs(id uuid,status text,lease_until timestamptz);
 create table private.daily_provider_base_jobs(id uuid,status text,lease_until timestamptz);
 create table private.prepared_aggregate_artifacts(id uuid primary key,job_id uuid references private.prepared_aggregate_jobs(id),payload jsonb);
 create table private.prepared_aggregate_heads(job_id uuid primary key references private.prepared_aggregate_jobs(id),artifact_id uuid references private.prepared_aggregate_artifacts(id));
 create table private.created_cohort_manual_transition(artifact_id uuid primary key references private.prepared_aggregate_artifacts(id),payload jsonb);
 insert into private.prepared_aggregate_jobs values('00000000-0000-4000-8000-000000000011','ready',null,'{"synthetic":"job"}');
 insert into private.prepared_aggregate_artifacts values('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000011','{"synthetic":"immutable-fact","amount":"1.25"}');
 insert into private.prepared_aggregate_heads values('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012');
 insert into private.created_cohort_manual_transition values('00000000-0000-4000-8000-000000000012','{"synthetic":"manual-proof"}');
 insert into private.provider_snapshot_targets select id,to_jsonb(n),true from private.fixture_targets n;
 `);
 await db.exec(fn('prepared_aggregate_claim'));
 for(const name of ['prepared_aggregate_prepare_claim','prepared_aggregate_take_turn','provider_snapshot_claim','withdraw_prepared_claim','daily_provider_base_claim'])await db.exec(read('tests/fixtures/worker-eligibility/'+name+'.baseline.sql'));
 await db.exec(read('tests/fixtures/worker-eligibility/wrapper.before.sql'));
 await db.exec(read('tests/fixtures/worker-eligibility/dependency-model.synthetic.sql'));
 for(const m of JSON.parse(read('tests/fixtures/worker-eligibility/expected-metadata.json')).baseline)await db.exec('revoke all on function '+m.identity+'from public,anon,authenticated,service_role');
 await db.exec('set check_function_bodies=on');
});after(()=>db?.close());
const state=()=>scalar("select jsonb_build_object('jobs',(select jsonb_agg(to_jsonb(j)order by id)from private.prepared_aggregate_jobs j),'heads',(select jsonb_agg(to_jsonb(h)order by job_id)from private.prepared_aggregate_heads h),'artifacts',(select jsonb_agg(to_jsonb(a)order by id)from private.prepared_aggregate_artifacts a),'manual',(select jsonb_agg(to_jsonb(m)order by artifact_id)from private.created_cohort_manual_transition m))");
test('dynamic synthetic dependencies stay identical across real atomic installation and rollback without rewriting jobs or facts',async()=>{const data=await state();const probe=install.split('create temporary table worker_eligibility_semantics_before on commit drop as ')[1].split(';\ndo $nonempty$')[0];const nulls=(await db.query(probe)).rows.filter(r=>r.v===null);assert.deepEqual(nulls,[]);await db.exec(install);assert.deepEqual(await state(),data);assert.equal(await scalar("select md5(prosrc)from pg_proc where oid='private.withdraw_prepared_prepare_claim(text)'::regprocedure"),JSON.parse(read('tests/fixtures/worker-eligibility/expected-metadata.json')).installed.find(x=>x.identity==='private.withdraw_prepared_prepare_claim(text)').body_md5);for(const role of['anon','authenticated','service_role'])assert.equal(await scalar("select has_function_privilege($1,'private.withdraw_prepared_family_claim(text,text)','EXECUTE')",[role]),false);await db.exec(rollback);assert.deepEqual(await state(),data);assert.equal(await scalar("select to_regprocedure('private.withdraw_prepared_family_claim(text,text)')::text"),null);});
test('baseline function or ACL drift rejects atomically before changing wrapper',async()=>{await db.exec('alter function private.withdraw_prepared_prepare_claim(text)security definer');try{await assert.rejects(db.exec(install),/baseline_drift/);await db.exec('rollback');assert.equal(await scalar("select to_regprocedure('private.withdraw_prepared_family_claim(text,text)')::text"),null);}finally{await db.exec('alter function private.withdraw_prepared_prepare_claim(text)security invoker');}});
test('late dependency failure rolls back helper and wrapper together',async()=>{const broken=install.replace('create temporary table worker_eligibility_semantics_after',"do $fail$begin raise exception'fixture_late_failure';end;$fail$;\ncreate temporary table worker_eligibility_semantics_after");await assert.rejects(db.exec(broken),/fixture_late_failure/);await db.exec('rollback');assert.equal(await scalar("select to_regprocedure('private.withdraw_prepared_family_claim(text,text)')::text"),null);});
test('rollback rejects helper privilege drift and new callers instead of orphaning them',async()=>{await db.exec(install);await db.exec('grant execute on function private.withdraw_prepared_family_claim(text,text)to authenticated');await assert.rejects(db.exec(rollback),/rollback_drift/);await db.exec('rollback;revoke execute on function private.withdraw_prepared_family_claim(text,text)from authenticated');await db.exec("create function private.fixture_new_caller()returns jsonb language sql as $$select private.withdraw_prepared_family_claim('payment','fixture')$$");await assert.rejects(db.exec(rollback),/unknown_caller/);await db.exec('rollback;drop function private.fixture_new_caller()');await db.exec(rollback);});
test('installation refuses a dangling cron caller for the new helper',async()=>{await db.exec("insert into cron.job values('select private.withdraw_prepared_family_claim()')");await assert.rejects(db.exec(install),/helper_already_exists/);await db.exec('rollback;truncate cron.job');});

// These counterexamples make the synthetic dependency model sensitive to the
// same classes of change checked by the real installer, rather than a constant stub.
test('synthetic semantic tokens isolate scope, native identity and all four families',async()=>{
 const values=(await db.query(`select private.prepared_aggregate_dependency_common('IN')a,
 private.prepared_aggregate_dependency_common('ID')b,
 private.prepared_aggregate_dependency('{"id":"synthetic-a"}','common')c,
 private.prepared_aggregate_dependency('{"id":"synthetic-b"}','common')d,
 private.provider_snapshot_dependency_token('{"id":"synthetic-a"}')e,
 private.provider_snapshot_dependency_token('{"id":"synthetic-b"}')f,
 private.withdraw_prepared_dependency()g,private.daily_provider_base_reuse_semantics()h`)).rows[0];
 assert.equal(new Set(Object.values(values)).size,8);assert(Object.values(values).every(v=>/^[a-f0-9]{32}$/.test(v)));
});
for(const [label,mutation]of [
 ['function body',"create or replace function private.fixture_worker_semantic_kernel(p_value text)returns text language sql immutable set search_path=''as $$select upper(p_value)$$;"],
 ['function ACL','grant execute on function private.fixture_worker_semantic_kernel(text)to authenticated;'],
 ['synthetic semantic data',"update private.fixture_worker_semantics set revision=revision+1 where family='provider';"]
])test('installer rejects '+label+' drift and rolls back the complete attempted install',async()=>{
 const data=await state(),body=await scalar("select md5(prosrc)from pg_proc where oid='private.fixture_worker_semantic_kernel(text)'::regprocedure"),revision=await scalar("select revision from private.fixture_worker_semantics where family='provider'");
 const altered=install.replace('create temporary table worker_eligibility_semantics_after',()=>mutation+'\ncreate temporary table worker_eligibility_semantics_after');
 await assert.rejects(db.exec(altered),/worker_eligibility_dependency_changed/);await db.exec('rollback');
 assert.equal(await scalar("select to_regprocedure('private.withdraw_prepared_family_claim(text,text)')::text"),null);
 assert.equal(await scalar("select md5(prosrc)from pg_proc where oid='private.fixture_worker_semantic_kernel(text)'::regprocedure"),body);
 assert.equal(await scalar("select has_function_privilege('authenticated','private.fixture_worker_semantic_kernel(text)','EXECUTE')"),false);
 assert.equal(await scalar("select revision from private.fixture_worker_semantics where family='provider'"),revision);
 assert.deepEqual(await state(),data);
});
test('missing semantic family is an incomplete proof and rejects before runtime mutation',async()=>{
 await db.exec("delete from private.fixture_worker_semantics where family='base'");try{
 await assert.rejects(db.exec(install),/worker_eligibility_semantics_incomplete/);await db.exec('rollback');
 assert.equal(await scalar("select to_regprocedure('private.withdraw_prepared_family_claim(text,text)')::text"),null);
 }finally{await db.exec("insert into private.fixture_worker_semantics values('base',1)");}
});
test('rollback rejects a semantic change and retains installed helper and wrapper atomically',async()=>{
 await db.exec(install);const body=await scalar("select md5(prosrc)from pg_proc where oid='private.withdraw_prepared_prepare_claim(text)'::regprocedure"),data=await state();
 const altered=rollback.replace('create temporary table worker_eligibility_semantics_after',"update private.fixture_worker_semantics set revision=revision+1 where family='withdraw';\ncreate temporary table worker_eligibility_semantics_after");
 await assert.rejects(db.exec(altered),/worker_eligibility_dependency_changed/);await db.exec('rollback');
 assert(await scalar("select to_regprocedure('private.withdraw_prepared_family_claim(text,text)')::text"));
 assert.equal(await scalar("select md5(prosrc)from pg_proc where oid='private.withdraw_prepared_prepare_claim(text)'::regprocedure"),body);
 assert.equal(await scalar("select revision from private.fixture_worker_semantics where family='withdraw'"),1);
 assert.deepEqual(await state(),data);await db.exec(rollback);
});
