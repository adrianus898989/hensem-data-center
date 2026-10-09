const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const baseline=read('tests/fixtures/platform-channel-operations-catalog-before.sql');
const migration=read('supabase/migrations/20261009054909_platform_channel_operations_navigation.sql');
const scalar=async(db,q)=>Object.values((await db.query(q)).rows[0])[0];
const catalog=db=>scalar(db,'select private.dashboard_role_catalog()');
const metadata=db=>scalar(db,"select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.dashboard_role_catalog()'::regprocedure");
test('channel navigation moves after daily comparison with exact shared catalog, same IDs/permissions/requests and ACL',async()=>{
 const db=new PGlite();try{
  await db.exec(baseline);const before=await catalog(db),meta=await metadata(db);
  await db.exec(`create table private.dashboard_roles(id integer,permissions text[]);create table private.dashboard_role_assignments(id integer,role_id integer);create table public.dashboard_profiles(id integer,role text,data_scope jsonb);
   insert into private.dashboard_roles values(1,array['channel_status.view','channel_status.query']);insert into private.dashboard_role_assignments values(7,1);insert into dashboard_profiles values(7,'viewer','{"countries":["IN"]}');
   create function private.no_changes() returns trigger language plpgsql as $$begin raise exception 'NO_ROLE_OR_SCOPE_WRITES';end$$;
   create trigger no_changes before insert or update or delete on private.dashboard_roles for each statement execute function private.no_changes();
   create trigger no_changes before insert or update or delete on private.dashboard_role_assignments for each statement execute function private.no_changes();
   create trigger no_changes before insert or update or delete on dashboard_profiles for each statement execute function private.no_changes();`);
  await db.exec(migration);const after=await catalog(db),prior=before.pages.find(p=>p.id==='channel_status'),page=after.pages.find(p=>p.id==='channel_status');
  assert.deepEqual(after.pages,JSON.parse(read('src/lib/dashboardRoleCatalog.json')).pages);assert.deepEqual({...page,moduleId:prior.moduleId,moduleLabel:prior.moduleLabel,label:prior.label},prior);
  assert.equal(page.moduleId,'merchant');assert.equal(page.moduleLabel,'运营中心');assert.equal(page.label,'平台通道调整');assert.deepEqual(page.requests,['catalog','channelStatus']);assert.deepEqual(page.actions.map(x=>x.id),['view','query','detail','export']);
  assert.equal(after.pages.findIndex(p=>p.id==='channel_status'),after.pages.findIndex(p=>p.id==='daily_comparison')+1);
  assert.deepEqual(after.pages.filter(p=>p.id!=='channel_status'),before.pages.filter(p=>p.id!=='channel_status'));assert.deepEqual({...after,pages:[]},{...before,pages:[]});assert.deepEqual(await metadata(db),meta);
  assert.deepEqual(await scalar(db,'select permissions from private.dashboard_roles where id=1'),['channel_status.view','channel_status.query']);
 }finally{await db.close();}
});
test('unexpected catalog content aborts instead of replacing current role metadata',async()=>{
 const db=new PGlite();try{await db.exec(baseline);await db.exec("create or replace function private.dashboard_role_catalog() returns jsonb language sql immutable set search_path='' as $$select '{}'::jsonb$$;");await assert.rejects(()=>db.exec(migration),/platform_channel_navigation_catalog_drift/);await db.exec('rollback');assert.deepEqual(await catalog(db),{});}finally{await db.close();}
});
test('catalog with changed public execution privilege aborts without changing its body',async()=>{
 const db=new PGlite();try{await db.exec(baseline);const before=await catalog(db);await db.exec('grant execute on function private.dashboard_role_catalog() to public');await assert.rejects(()=>db.exec(migration),/platform_channel_navigation_catalog_metadata_drift/);await db.exec('rollback');assert.deepEqual(await catalog(db),before);}finally{await db.close();}
});
