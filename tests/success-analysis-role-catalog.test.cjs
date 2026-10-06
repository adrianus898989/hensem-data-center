const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const migration=read('supabase/migrations/20261004093506_success_analysis_role_catalog.sql');
const scalar=async(db,q)=>Object.values((await db.query(q)).rows[0])[0];
const metadata=db=>scalar(db,"select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.dashboard_role_catalog()'::regprocedure");
const catalog=db=>scalar(db,'select private.dashboard_role_catalog()');
async function fixture(){
 const db=new PGlite();await db.exec('create schema private;create role authenticated;create role catalog_other_owner;');
 await db.exec(read('tests/fixtures/success-analysis-role-catalog-baseline.sql'));
 await db.exec(`revoke all on function private.dashboard_role_catalog() from public;
  create table private.dashboard_roles(id int primary key,permissions text[]);
  create table private.dashboard_role_assignments(account_id int primary key,role_id int);
  create table public.dashboard_profiles(id int primary key,role text,permissions jsonb);
  insert into private.dashboard_roles values(1,array['providers.view','providers.query']);
  insert into private.dashboard_role_assignments values(10,1);
  insert into public.dashboard_profiles values(10,'admin','{"third_party":true}');
  create function private.reject_business_change() returns trigger language plpgsql as $$begin raise exception 'BUSINESS_DATA_MUTATION_FORBIDDEN';end$$;
  create trigger reject_roles before insert or update or delete on private.dashboard_roles for each statement execute function private.reject_business_change();
  create trigger reject_assignments before insert or update or delete on private.dashboard_role_assignments for each statement execute function private.reject_business_change();
  create trigger reject_profiles before insert or update or delete on public.dashboard_profiles for each statement execute function private.reject_business_change();`);
 return db;
}
const grants=db=>scalar(db,`select jsonb_build_object(
 'roles',(select jsonb_agg(to_jsonb(r) order by id) from private.dashboard_roles r),
 'assignments',(select jsonb_agg(to_jsonb(r) order by account_id) from private.dashboard_role_assignments r),
 'profiles',(select jsonb_agg(to_jsonb(r) order by id) from public.dashboard_profiles r))`);
test('success analysis catalog adds only its exact entry and three permissions while preserving all function fields and saved grants',async()=>{
 const db=await fixture();try{
  const before=await catalog(db),beforeMeta=await metadata(db),beforeGrants=await grants(db);
  assert.equal(await scalar(db,"select md5(prosrc) from pg_proc where oid='private.dashboard_role_catalog()'::regprocedure"),'0245134da03be7f9852c2e9a0cf62ceb');
  assert.equal(await scalar(db,"select md5(pg_get_functiondef('private.dashboard_role_catalog()'::regprocedure))"),'d0636e1c6d1613cff65a8e097a99ef85');
  await db.exec(migration);const after=await catalog(db),currentPages=require('../src/lib/dashboardRoleCatalog.json').pages.filter(p=>!['daily_comparison','collector_control'].includes(p.id)).map(p=>({...p,requests:p.requests.filter(r=>r!=='submissionStreak')})).map(p=>p.id==='success_analysis'?{...p,requests:p.requests.filter(r=>r!=='rates')}:p),entry=currentPages.find(p=>p.id==='success_analysis');
  assert.deepEqual(after.pages.find(p=>p.id==='success_analysis'),entry);
  assert.deepEqual(after.pages,currentPages);
  assert.deepEqual(after.pages.filter(p=>p.id!=='success_analysis'),before.pages);
  assert.deepEqual(after.permissions.slice(0,before.permissions.length),before.permissions);
  assert.deepEqual(after.permissions.slice(before.permissions.length),['view','query','export'].map(action=>({key:'success_analysis.'+action})));
  assert.deepEqual(Object.fromEntries(Object.entries(after).filter(([k])=>!['pages','permissions'].includes(k))),Object.fromEntries(Object.entries(before).filter(([k])=>!['pages','permissions'].includes(k))));
  assert.deepEqual(await metadata(db),beforeMeta);assert.deepEqual(await grants(db),beforeGrants);
  assert.equal(await scalar(db,"select md5(prosrc) from pg_proc where oid='private.dashboard_role_catalog()'::regprocedure"),'4962049325c861dd3537d59954565062');
 }finally{await db.close();}
});
test('success analysis catalog replay leaves exact output, OID, ACL and every metadata field unchanged',async()=>{
 const db=await fixture();try{await db.exec(migration);const before=await catalog(db),meta=await metadata(db),saved=await grants(db);await db.exec(migration);assert.deepEqual(await catalog(db),before);assert.deepEqual(await metadata(db),meta);assert.deepEqual(await grants(db),saved);}finally{await db.close();}
});
test('unknown and partially registered catalog bodies abort without changing their output or metadata',async()=>{
 const db=await fixture();try{
  const baseline=await catalog(db);for(const body of [{version:999,pages:[],permissions:[]},{...baseline,pages:[...baseline.pages,{id:'success_analysis'}]}]){
   await db.query("create or replace function private.dashboard_role_catalog() returns jsonb language sql immutable set search_path='' as $body$select '{}'::jsonb$body$");
   const statement=(await db.query("select format('create or replace function private.dashboard_role_catalog() returns jsonb language sql immutable set search_path='''' as %L','select '||quote_literal($1::jsonb::text)||'::jsonb') sql",[JSON.stringify(body)])).rows[0].sql;await db.exec(statement);
   const before=await catalog(db),meta=await metadata(db);await assert.rejects(()=>db.exec(migration),/success_analysis_catalog_baseline_drift/);await db.exec('rollback');assert.deepEqual(await catalog(db),before);assert.deepEqual(await metadata(db),meta);
  }
 }finally{await db.close();}
});
test('public, authenticated and changed owner ACLs abort on both baseline and replay without repairing privileges',async()=>{
 const cases=["grant execute on function private.dashboard_role_catalog() to public","grant execute on function private.dashboard_role_catalog() to authenticated","alter function private.dashboard_role_catalog() owner to catalog_other_owner"];
 for(const applied of [false,true])for(const change of cases){const db=await fixture();try{if(applied)await db.exec(migration);await db.exec(change);const before=await catalog(db),meta=await metadata(db);await assert.rejects(()=>db.exec(migration),/success_analysis_catalog_metadata_drift/);await db.exec('rollback');assert.deepEqual(await catalog(db),before);assert.deepEqual(await metadata(db),meta);}finally{await db.close();}}
});
test('security, volatility, search path and other definition drift are rejected instead of silently reset',async()=>{
 for(const change of ['security definer','stable',"set search_path='public'",'cost 999']){const db=await fixture();try{await db.exec('alter function private.dashboard_role_catalog() '+change);const before=await catalog(db),meta=await metadata(db);await assert.rejects(()=>db.exec(migration),/success_analysis_catalog_(metadata|baseline)_drift/);await db.exec('rollback');assert.deepEqual(await catalog(db),before);assert.deepEqual(await metadata(db),meta);}finally{await db.close();}}
});
test('a missing role catalog aborts without creating a new public-executable helper',async()=>{
 const db=new PGlite();try{await db.exec('create schema private');await assert.rejects(()=>db.exec(migration),/success_analysis_catalog_missing/);await db.exec('rollback');assert.equal(await scalar(db,"select to_regprocedure('private.dashboard_role_catalog()')"),null);}finally{await db.close();}
});

const typeMigration=read('supabase/migrations/20261004114740_success_analysis_provider_type_reader.sql');
test('provider type reader adds rates only to the existing page, preserves native function metadata and all saved grants',async()=>{
 const db=await fixture();try{
  await db.exec(migration);const before=await catalog(db),meta=await metadata(db),saved=await grants(db);
  await db.exec(typeMigration);const after=await catalog(db);
  assert.deepEqual(after.pages,require('../src/lib/dashboardRoleCatalog.json').pages.filter(p=>!['daily_comparison','collector_control'].includes(p.id)).map(p=>({...p,requests:p.requests.filter(r=>r!=='submissionStreak')})));
  assert.deepEqual(after.pages.filter(p=>p.id!=='success_analysis'),before.pages.filter(p=>p.id!=='success_analysis'));
  const old=before.pages.find(p=>p.id==='success_analysis'),now=after.pages.find(p=>p.id==='success_analysis');
  assert.deepEqual(now,{...old,requests:[...old.requests,'rates']});
  assert.deepEqual({...after,pages:before.pages},before);assert.deepEqual(await metadata(db),meta);assert.deepEqual(await grants(db),saved);
  assert.equal(await scalar(db,"select md5(pg_get_functiondef('private.dashboard_role_catalog()'::regprocedure))"),'aff46e4d81404c6db383001cc8cc2443');
  await db.exec(typeMigration);assert.deepEqual(await catalog(db),after);assert.deepEqual(await metadata(db),meta);assert.deepEqual(await grants(db),saved);
 }finally{await db.close();}
});
test('provider type reader rejects changed function security and body contracts on baseline and replay',async()=>{
 for(const applied of [false,true])for(const change of ["grant execute on function private.dashboard_role_catalog() to authenticated",'alter function private.dashboard_role_catalog() security definer','alter function private.dashboard_role_catalog() cost 999']){
  const db=await fixture();try{await db.exec(migration);if(applied)await db.exec(typeMigration);await db.exec(change);const before=await catalog(db),meta=await metadata(db);await assert.rejects(()=>db.exec(typeMigration),/success_type_catalog_(metadata|baseline)_drift/);await db.exec('rollback');assert.deepEqual(await catalog(db),before);assert.deepEqual(await metadata(db),meta);}finally{await db.close();}
 }
});
