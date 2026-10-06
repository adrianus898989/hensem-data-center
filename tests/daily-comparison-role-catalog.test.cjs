const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const migration=read('supabase/migrations/20261004140008_daily_comparison_role_catalog.sql');
const scalar=async(db,q)=>Object.values((await db.query(q)).rows[0])[0];
const metadata=db=>scalar(db,"select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.dashboard_role_catalog()'::regprocedure");
const catalog=db=>scalar(db,'select private.dashboard_role_catalog()');
async function fixture(){
 const db=new PGlite();await db.exec('create schema private;create role authenticated;create role catalog_other_owner;');
 await db.exec(read('tests/fixtures/daily-comparison-role-catalog-baseline.sql'));
 await db.exec("revoke all on function private.dashboard_role_catalog() from public;");
 await db.exec("create table private.dashboard_roles(id int primary key,permissions text[]);"+
  "create table private.dashboard_role_assignments(account_id int primary key,role_id int);"+
  "create table public.dashboard_profiles(id int primary key,role text,permissions jsonb);"+
  "insert into private.dashboard_roles values(1,array['merchants.view','merchants.query']);"+
  "insert into private.dashboard_role_assignments values(10,1);"+
  "insert into public.dashboard_profiles values(10,'admin','{\"third_party\":true}');"+
  "create function private.reject_business_change() returns trigger language plpgsql as $$begin raise exception 'BUSINESS_DATA_MUTATION_FORBIDDEN';end$$;"+
  "create trigger reject_roles before insert or update or delete on private.dashboard_roles for each statement execute function private.reject_business_change();"+
  "create trigger reject_assignments before insert or update or delete on private.dashboard_role_assignments for each statement execute function private.reject_business_change();"+
  "create trigger reject_profiles before insert or update or delete on public.dashboard_profiles for each statement execute function private.reject_business_change();");
 return db;
}
const grants=db=>scalar(db,"select jsonb_build_object('roles',(select jsonb_agg(to_jsonb(r) order by id) from private.dashboard_roles r),"+
 "'assignments',(select jsonb_agg(to_jsonb(r) order by account_id) from private.dashboard_role_assignments r),"+
 "'profiles',(select jsonb_agg(to_jsonb(r) order by id) from public.dashboard_profiles r))");
test('daily comparison registers exactly one operations entry and four permissions without changing native metadata or saved grants',async()=>{
 const db=await fixture();try{
  const before=await catalog(db),meta=await metadata(db),saved=await grants(db);
  assert.equal(await scalar(db,"select md5(prosrc) from pg_proc where oid='private.dashboard_role_catalog()'::regprocedure"),'b1c7a223fd9d4b5ea488ad0114bba9d4');
  assert.equal(await scalar(db,"select md5(pg_get_functiondef('private.dashboard_role_catalog()'::regprocedure))"),'db24d518ed7aa439aae1c9fa87c33dab');
  await db.exec(migration);const after=await catalog(db),pages=require('../src/lib/dashboardRoleCatalog.json').pages.filter(p=>p.id!=='collector_control');
  assert.deepEqual(after.pages,pages);
  const entry=after.pages.find(p=>p.id==='daily_comparison');assert.equal(entry.moduleId,'merchant');assert.equal(entry.moduleLabel,'运营中心');
  assert.deepEqual(entry.actions.map(a=>a.id),['view','query','detail','export']);
  assert.deepEqual(entry.requests,['catalog','providerOptions','aggregate','rates','syncHealth','workorders']);
  assert.equal(after.pages.findIndex(p=>p.id==='daily_comparison'),after.pages.findIndex(p=>p.id==='merchants')+1);
  assert.deepEqual(after.pages.filter(p=>p.id!=='daily_comparison'),before.pages);
  assert.deepEqual(after.permissions.slice(0,before.permissions.length),before.permissions);
  assert.deepEqual(after.permissions.slice(before.permissions.length),['view','query','detail','export'].map(action=>({key:'daily_comparison.'+action})));
  assert.deepEqual({...after,pages:before.pages,permissions:before.permissions},before);
  assert.deepEqual(await metadata(db),meta);assert.deepEqual(await grants(db),saved);
  assert.equal(await scalar(db,"select md5(prosrc) from pg_proc where oid='private.dashboard_role_catalog()'::regprocedure"),'a8d63fb20a46abf508c3bf9e07e0027d');
 }finally{await db.close();}
});
test('daily comparison replay preserves exact catalog, OID, ACL and every metadata field',async()=>{
 const db=await fixture();try{await db.exec(migration);const before=await catalog(db),meta=await metadata(db),saved=await grants(db);await db.exec(migration);assert.deepEqual(await catalog(db),before);assert.deepEqual(await metadata(db),meta);assert.deepEqual(await grants(db),saved);}finally{await db.close();}
});
test('unknown or partially registered catalog bodies abort without accepting or repairing them',async()=>{
 const db=await fixture();try{
  const baseline=await catalog(db);for(const body of [{version:999,pages:[],permissions:[]},{...baseline,pages:[...baseline.pages,{id:'daily_comparison'}]},{...baseline,permissions:[...baseline.permissions,{key:'daily_comparison.view'}]}]){
   const statement=(await db.query("select format('create or replace function private.dashboard_role_catalog() returns jsonb language sql immutable set search_path='''' as %L','select '||quote_literal($1::jsonb::text)||'::jsonb') sql",[JSON.stringify(body)])).rows[0].sql;await db.exec(statement);
   const before=await catalog(db),meta=await metadata(db);await assert.rejects(()=>db.exec(migration),/daily_comparison_catalog_baseline_drift/);await db.exec('rollback');assert.deepEqual(await catalog(db),before);assert.deepEqual(await metadata(db),meta);
  }
 }finally{await db.close();}
});
test('public/authenticated ACL and owner drift abort both baseline and replay',async()=>{
 for(const applied of [false,true])for(const change of ["grant execute on function private.dashboard_role_catalog() to public","grant execute on function private.dashboard_role_catalog() to authenticated","alter function private.dashboard_role_catalog() owner to catalog_other_owner"]){
  const db=await fixture();try{if(applied)await db.exec(migration);await db.exec(change);const before=await catalog(db),meta=await metadata(db);await assert.rejects(()=>db.exec(migration),/daily_comparison_catalog_metadata_drift/);await db.exec('rollback');assert.deepEqual(await catalog(db),before);assert.deepEqual(await metadata(db),meta);}finally{await db.close();}
 }
});
test('security/volatility/search path/cost drift aborts rather than silently resetting function metadata',async()=>{
 for(const applied of [false,true])for(const change of ['security definer','stable',"set search_path='public'",'cost 999']){
  const db=await fixture();try{if(applied)await db.exec(migration);await db.exec('alter function private.dashboard_role_catalog() '+change);const before=await catalog(db),meta=await metadata(db);await assert.rejects(()=>db.exec(migration),/daily_comparison_catalog_(metadata|baseline)_drift/);await db.exec('rollback');assert.deepEqual(await catalog(db),before);assert.deepEqual(await metadata(db),meta);}finally{await db.close();}
 }
});
test('missing catalog aborts without creating a new helper or public-executable function',async()=>{
 const db=new PGlite();try{await db.exec('create schema private');await assert.rejects(()=>db.exec(migration),/daily_comparison_catalog_missing/);await db.exec('rollback');assert.equal(await scalar(db,"select to_regprocedure('private.dashboard_role_catalog()')"),null);}finally{await db.close();}
});
