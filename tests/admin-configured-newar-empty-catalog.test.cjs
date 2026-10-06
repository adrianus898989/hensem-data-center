// Synthetic registry and scope data only; no production orders or credentials.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const migration=read('supabase/migrations/20261006065523_configured_newar_empty_catalog.sql');
async function fixture(){
 const db=new PGlite();await db.exec(`
 create role anon;create role authenticated;create schema private;
 create table ar_config_targets(country_code text,country_name text,platform text,source_system text,timezone text,currency text);
 create table ar_collected_orders(country_code text,platform text,source_system text,order_kind text);
 create table newar_detail_platforms(platform text,country_code text,country text,enabled boolean,launch_at timestamptz,timezone text,currency text);
 create table newar_detail_records(platform text,dataset text,created_at timestamptz);
 create table dashboard_platform_team_map(platform_name text,team_name text,source_system text,country_name text,country_code text,source_country text,source_platform text,active boolean);
 create table game66_platforms(id uuid,platform_name text,team_name text,team_code text);
 create table game66_charge_orders(platform_id uuid);create table game66_withdraw_orders(platform_id uuid);
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin
  if current_setting('test.denied',true)='true' then raise exception 'scope_denied';end if;
  return coalesce(nullif(current_setting('test.scope',true),''),'null')::jsonb;end$$;
 create function private.dashboard_scope_allows(scope jsonb,country text,platform text) returns boolean language sql immutable as $$select scope='null'::jsonb or scope @> jsonb_build_array(jsonb_build_object('country',country,'platform',platform))$$;
 create function private.dashboard_admin_live_lg_scopes() returns table(country_code text,platform text) language sql stable as $$select null::text,null::text where false$$;
 create function public.lg_country_timezone(text) returns text language sql immutable as $$select null::text$$;
 create function public.lg_platform_country(text) returns text language sql immutable as $$select null::text$$;
 create function private.dashboard_admin_wg_sites() returns table(site_code text,country_code text,country text,platform text,timezone text,currency text) language sql immutable as $$select null::text,null::text,null::text,null::text,null::text,null::text where false$$;
 `+read('tests/fixtures/configured-backend-catalog-baseline.sql')+read('supabase/migrations/20261003131755_configured_backend_team_mapping.sql'));
 return db;
}
const rows=db=>db.query('select * from private.dashboard_admin_live_platforms() order by id').then(r=>r.rows);
const meta=db=>db.query("select to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='private.dashboard_admin_live_platforms()'::regprocedure").then(r=>r.rows[0].metadata);
async function seedMaan(db){await db.exec(`
 insert into ar_config_targets values('IN','印度','MAANWIN','NEW_AR','Asia/Kolkata','INR');
 insert into newar_detail_platforms values('MAANWIN','IN','印度',true,now()-interval '1 day','Asia/Kolkata','INR');
 insert into dashboard_platform_team_map values('MAAN.WIN','M8','NEW_AR','印度','IN','印度','MAANWIN',true);`);}

test('launched configured NEW_AR has its native identity before first detail and keeps it after collection starts',async()=>{
 const db=await fixture();try{
 await seedMaan(db);const before=await rows(db),metadata=await meta(db);assert.equal(before[0].source,'ar');
 await db.exec(migration);const after=await rows(db);assert.equal(after.length,1);assert.deepEqual(after[0],{...before[0],id:'c05724c9-e689-065f-c79e-867c6db08ac6',source:'newar'});
 assert.equal(after[0].source_name,'MAANWIN');assert.equal(after[0].name,'MAAN.WIN');assert.equal(after[0].team,'M8');assert.deepEqual(await meta(db),metadata);
 assert.equal((await db.query('select count(*) n from newar_detail_records')).rows[0].n,0,'catalog creates no business rows or coverage');
 await db.exec("insert into newar_detail_records values('MAANWIN','workorder',now())");assert.deepEqual(await rows(db),after,'workorder-only data uses the same native source');
 await db.exec("insert into newar_detail_records values('MAANWIN','charge',now())");assert.deepEqual(await rows(db),after,'first payment cannot change platform identity or duplicate its column');
 await db.exec(migration);assert.deepEqual(await meta(db),metadata);assert.deepEqual(await rows(db),after);
 }finally{await db.close()}
});
test('future and disabled NEW_AR targets retain their existing catalog behavior without moving launch boundaries',async()=>{
 const db=await fixture();try{
 await seedMaan(db);await db.exec("update newar_detail_platforms set launch_at=now()+interval '30 days'");
 const before=await rows(db),config=(await db.query('select * from newar_detail_platforms')).rows;await db.exec(migration);
 assert.deepEqual(await rows(db),before);assert.equal(before[0].source,'ar');assert.deepEqual((await db.query('select * from newar_detail_platforms')).rows,config);
 await db.exec('update newar_detail_platforms set enabled=false,launch_at=null');assert.deepEqual(await rows(db),before);
 await db.exec('update newar_detail_platforms set enabled=true');assert.equal((await rows(db))[0].source,'newar','null launch is enabled under the existing policy');
 }finally{await db.close()}
});
test('unconfigured enabled NEW_AR registry is visible with no details but future and disabled registries are not',async()=>{
 const db=await fixture();try{
 await db.exec(`insert into newar_detail_platforms values('READY','IN','印度',true,null,'Asia/Kolkata','INR'),('FUTURE','IN','印度',true,now()+interval '30 days','Asia/Kolkata','INR'),('DISABLED','IN','印度',false,null,'Asia/Kolkata','INR');`);
 assert.deepEqual(await rows(db),[]);await db.exec(migration);const result=await rows(db);assert.equal(result.length,1);assert.equal(result[0].source,'newar');assert.equal(result[0].source_name,'READY');assert.equal(result[0].team,null);
 }finally{await db.close()}
});
test('configured NEW_AR suppresses stale AR map duplicates while unconfigured AR maps and ordinary AR targets stay unchanged',async()=>{
 const db=await fixture();try{
 await seedMaan(db);await db.exec(`insert into dashboard_platform_team_map values('Old MAAN','Wrong old team','AR','印度','IN','印度','MAANWIN',true),('Mapped AR','AR Team','AR','印度','IN','IN','ONLY_MAP',true);
 insert into ar_config_targets values('IN','印度','LEGACY','AR','Asia/Kolkata','INR');`);
 const before=await rows(db);await db.exec(migration);const after=await rows(db);
 assert.equal(after.filter(r=>r.source_name==='MAANWIN').length,1);assert.equal(after.find(r=>r.source_name==='MAANWIN').source,'newar');assert.equal(after.find(r=>r.source_name==='MAANWIN').team,'M8');
 for(const native of ['ONLY_MAP','LEGACY'])assert.deepEqual(after.find(r=>r.source_name===native),before.find(r=>r.source_name===native));
 }finally{await db.close()}
});
test('native country and platform scopes remain exact and neither display aliases nor wrong source mappings grant access',async()=>{
 const db=await fixture();try{
 await seedMaan(db);await db.exec(`insert into newar_detail_platforms values('FOREIGN','VN','越南',true,null,'Asia/Ho_Chi_Minh','VND');
 insert into dashboard_platform_team_map values('Wrong country','Other','NEW_AR','越南','VN','越南','MAANWIN',true),('Wrong source','Other','AR','印度','IN','IN','MAANWIN',true),('Inactive','Other','NEW_AR','印度','IN','IN','MAANWIN',false);`);
 await db.exec(migration);await db.query("select set_config('test.scope',$1,false)",[JSON.stringify([{country:'IN',platform:'MAANWIN'}])]);const only=await rows(db);assert.equal(only.length,1);assert.equal(only[0].source,'newar');assert.equal(only[0].country,'印度');assert.equal(only[0].team,'M8');
 for(const scope of [[],[{country:'IN',platform:'MAAN.WIN'}],[{country:'VN',platform:'MAANWIN'}]]){await db.query("select set_config('test.scope',$1,false)",[JSON.stringify(scope)]);assert.deepEqual(await rows(db),[]);}
 await db.query("select set_config('test.denied','true',false)");await assert.rejects(rows(db),/scope_denied/);
 }finally{await db.close()}
});
test('wrong-country NEW_AR registry cannot replace the configured AR placeholder of another country',async()=>{
 const db=await fixture();try{
 await seedMaan(db);await db.exec("update newar_detail_platforms set country_code='VN',country='越南',timezone='Asia/Ho_Chi_Minh',currency='VND'");
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify([{country:'IN',platform:'MAANWIN'}])]);const before=await rows(db);await db.exec(migration);assert.deepEqual(await rows(db),before);assert.equal(before[0].source,'ar');
 }finally{await db.close()}
});
test('body and ACL drift reject the migration and replay without changing permissions or unrelated readers',async()=>{
 for(const installed of [false,true])for(const alteration of ["grant execute on function private.dashboard_admin_live_platforms() to anon","alter function private.dashboard_admin_live_platforms() security invoker"]){
 const db=await fixture();try{if(installed)await db.exec(migration);await db.exec(alteration);await assert.rejects(db.exec(migration),/metadata_drift/);await db.exec('rollback');}finally{await db.close()}}
 const db=await fixture();try{const definition=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_platforms()'::regprocedure) d")).rows[0].d;await db.exec(definition.replace('begin\n','begin\n -- newer revision\n'));await assert.rejects(db.exec(migration),/baseline_drift/);await db.exec('rollback');}finally{await db.close()}
 assert.doesNotMatch(migration,/\b(?:grant|revoke|insert into|delete from|update public|alter table)\b/i);
 assert.doesNotMatch(migration,/dashboard_admin_live_(?:query|intake_coverage|workorder)/);
});
