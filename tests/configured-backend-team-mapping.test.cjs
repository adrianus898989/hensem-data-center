// Synthetic data only. Verify the existing catalog function and full metadata.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const migration=read('supabase/migrations/20261003131755_configured_backend_team_mapping.sql');
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
 create function private.dashboard_admin_live_scope() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('test.scope',true),''),'null')::jsonb$$;
 create function private.dashboard_scope_allows(scope jsonb,country text,platform text) returns boolean language sql immutable as $$select scope='null'::jsonb or scope @> jsonb_build_array(jsonb_build_object('country',country,'platform',platform))$$;
 create function private.dashboard_admin_live_lg_scopes() returns table(country_code text,platform text) language sql stable as $$select null::text,null::text where false$$;
 create function public.lg_country_timezone(text) returns text language sql immutable as $$select null::text$$;
 create function public.lg_platform_country(text) returns text language sql immutable as $$select null::text$$;
 create function private.dashboard_admin_wg_sites() returns table(site_code text,country_code text,country text,platform text,timezone text,currency text) language sql immutable as $$select null::text,null::text,null::text,null::text,null::text,null::text where false$$;
 `+read('tests/fixtures/configured-backend-catalog-baseline.sql'));
 return db;
}
const rows=db=>db.query('select * from private.dashboard_admin_live_platforms() order by id').then(r=>r.rows);
const meta=db=>db.query("select to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='private.dashboard_admin_live_platforms()'::regprocedure").then(r=>r.rows[0].metadata);
test('configured new AR target inherits its own mapping before launch while AR identity and all access keys remain unchanged',async()=>{
 const db=await fixture();try{
 await db.exec(`insert into ar_config_targets values('IN','印度','FUTURE','NEW_AR','Asia/Kolkata','INR'),('IN','印度','LEGACY','AR','Asia/Kolkata','INR');
 insert into newar_detail_platforms values('FUTURE','IN','印度',true,now()+interval '30 days','Asia/Kolkata','INR');
 insert into dashboard_platform_team_map values('Future Display','New Team','NEW_AR','印度','IN','印度','FUTURE',true),('Wrong Backend','Wrong Team','AR','印度','IN','印度','FUTURE',true),('Legacy','Old Team','AR','印度','IN','印度','LEGACY',true);`);
 const before=await rows(db),security=await meta(db);assert.equal(before.find(r=>r.source_name==='FUTURE').team,'Wrong Team');
 await db.exec(migration);const after=await rows(db);assert.equal(after.length,before.length);assert.deepEqual(await meta(db),security);
 const original=before.find(r=>r.source_name==='FUTURE'),changed=after.find(r=>r.source_name==='FUTURE');assert.deepEqual(changed,{...original,name:'Future Display',team:'New Team'});
 assert.deepEqual(after.find(r=>r.source_name==='LEGACY'),before.find(r=>r.source_name==='LEGACY'));
 assert(!after.some(r=>r.source==='newar'),'future order launch is still respected');
 await db.query("select set_config('test.scope',$1,false)",[JSON.stringify([{country:'IN',platform:'FUTURE'}])]);assert.deepEqual(await rows(db),[changed]);
 await db.query("select set_config('test.scope',$1,false)",['[]']);assert.deepEqual(await rows(db),[]);
 }finally{await db.close()}
});
test('unknown or inactive target mapping stays unassigned; mismatched countries and other backends cannot supply a team',async()=>{
 const db=await fixture();try{
 await db.exec(`insert into ar_config_targets values('IN','印度','MISSING','NEW_AR','Asia/Kolkata','INR');
 insert into dashboard_platform_team_map values('Wrong','Wrong','AR','印度','IN','印度','MISSING',true),('Other country','Other','NEW_AR','越南','VN','越南','MISSING',true),('Inactive','Inactive','NEW_AR','印度','IN','印度','MISSING',false);`);
 await db.exec(migration);const result=await rows(db);assert.equal(result.length,1);assert.equal(result[0].team,null);assert.equal(result[0].name,'MISSING');
 }finally{await db.close()}
});
test('function body or ACL drift aborts without overwriting a newer deployment',async()=>{
 for(const alteration of ["grant execute on function private.dashboard_admin_live_platforms() to anon","alter function private.dashboard_admin_live_platforms() security invoker"]){
 const db=await fixture();try{await db.exec(alteration);await assert.rejects(db.exec(migration),/metadata_drift/);await db.exec('rollback');}finally{await db.close()}}
 const db=await fixture();try{const definition=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_platforms()'::regprocedure) d")).rows[0].d;await db.exec(definition.replace('begin\n','begin\n -- newer body\n'));await assert.rejects(db.exec(migration),/baseline_drift/);await db.exec('rollback');}finally{await db.close()}
 const defaultAcl=await fixture();try{await defaultAcl.exec('drop function private.dashboard_admin_live_platforms();'+read('tests/fixtures/configured-backend-catalog-baseline.sql').split('revoke all')[0]);await assert.rejects(defaultAcl.exec(migration),/metadata_drift/);await defaultAcl.exec('rollback');}finally{await defaultAcl.close()}
 assert.doesNotMatch(migration,/\b(?:grant|revoke|insert into|delete from|update public|alter table)\b/i);
});
