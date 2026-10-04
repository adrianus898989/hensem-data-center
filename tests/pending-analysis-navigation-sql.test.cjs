const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const migration=read('supabase/migrations/20261002115600_pending_analysis_navigation.sql');
const scalar=async(db,q)=>Object.values((await db.query(q)).rows[0])[0];
test('role editor relocation preserves permissions, requests, other pages, OID and function metadata',async()=>{
 const db=new PGlite();try{
  await db.exec(read('tests/fixtures/pending-role-catalog-before.sql'));
  const before=await scalar(db,'select private.dashboard_role_catalog()');
  const meta=await scalar(db,"select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.dashboard_role_catalog()'::regprocedure");
  await db.exec(migration);
  const after=await scalar(db,'select private.dashboard_role_catalog()');
  const expected=JSON.parse(JSON.stringify(before)),page=expected.pages.find(p=>p.id==='stuck');page.moduleId='analysis';page.moduleLabel='数据分析中心';
  assert.deepEqual(after,expected);
  assert.deepEqual(after.pages,require('../src/lib/dashboardRoleCatalog.json').pages.filter(page=>!['success_analysis','daily_comparison'].includes(page.id)).map(p=>({...p,requests:p.requests.filter(r=>r!=='submissionStreak')})));
  assert.deepEqual(await scalar(db,"select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.dashboard_role_catalog()'::regprocedure"),meta);
 }finally{await db.close()}
});
test('unknown catalog drift aborts without changing output',async()=>{
 const db=new PGlite();try{
  await db.exec(read('tests/fixtures/pending-role-catalog-before.sql'));
  await db.exec("create or replace function private.dashboard_role_catalog() returns jsonb language sql immutable set search_path='' as $$select '{}'::jsonb$$;");
  await assert.rejects(()=>db.exec(migration),/pending_navigation_catalog_drift/);await db.exec('rollback');
  assert.deepEqual(await scalar(db,'select private.dashboard_role_catalog()'),{});
 }finally{await db.close()}
});
test('default public execute ACL aborts even with the exact catalog body',async()=>{
 const db=new PGlite();try{
  const fixture=read('tests/fixtures/pending-role-catalog-before.sql').replace(/revoke all on function private\.dashboard_role_catalog\(\) from public;/i,'');
  await db.exec(fixture);
  const before=await scalar(db,'select private.dashboard_role_catalog()');
  assert.equal(await scalar(db,"select proacl from pg_proc where oid='private.dashboard_role_catalog()'::regprocedure"),null);
  await assert.rejects(()=>db.exec(migration),/pending_navigation_catalog_metadata_drift/);await db.exec('rollback');
  assert.deepEqual(await scalar(db,'select private.dashboard_role_catalog()'),before);
 }finally{await db.close()}
});
