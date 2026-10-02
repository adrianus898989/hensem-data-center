// Synthetic engine regression only. No production rows, credentials or auth impersonation.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_PATH||'@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20261002124810_withdraw_catalog_identity_walk.sql');
const baseline=read('tests/fixtures/withdraw-catalog-identity-baseline.sql');
const fragment=(file,name)=>{const s=read('supabase/'+file),a=s.indexOf('create or replace function private.'+name+'('),b=s.indexOf('revoke all on function private.'+name+'(',a);assert(a>=0&&b>a);return s.slice(a,b)};
const metadataSQL="select to_jsonb(p)-'prosrc' metadata,md5(prosrc) body_md5 from pg_proc p where oid='private.dashboard_admin_live_withdraw_platforms()'::regprocedure";
async function fixture(){
 const db=new PGlite();
 await db.exec([
 'create role anon;create role authenticated;create role service_role;create schema private;',
 'create table public.auto_withdraw_daily(country text,platform text);',
 'create table public.withdraw_operator_daily(country text,platform text);',
 'alter table public.auto_withdraw_daily enable row level security;',
 'alter table public.withdraw_operator_daily enable row level security;',
 'create table public.newar_business_snapshots(country text,platform text,country_code text,kind text,direction text);',
 'create table public.dashboard_platform_team_map(source_system text,source_country text,source_platform text,platform_name text,team_name text,active boolean default true);',
 'alter table public.dashboard_platform_team_map enable row level security;',
 "create function private.dashboard_admin_live_scope() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('test.scope',true),''),'null')::jsonb$$;",
 "create function private.dashboard_scope_allows(scope jsonb,country text,platform text) returns boolean language sql immutable as $$select scope='null'::jsonb or scope @> jsonb_build_array(jsonb_build_object('country',country,'platform',platform))$$;",
 "create function private.dashboard_admin_wg_sites() returns table(site_code text,country_code text,country text,platform text,timezone text,currency text) language sql immutable set search_path='' as $$values ('synthetic-1','VN','越南','WG-SYNTHETIC','Asia/Ho_Chi_Minh','VND'),('synthetic-2','BR','巴西','WG-SYNTHETIC','America/Sao_Paulo','BRL')$$;"
 ].join('\n')+fragment('admin-live-platform-catalog-map.sql','dashboard_admin_live_is_panghu_platform')
 +fragment('admin-live-platform-catalog-map.sql','dashboard_admin_live_report_country')
 +fragment('admin-live-withdraw-pages.sql','dashboard_admin_live_withdraw_key')
 +fragment('admin-live-deposit-issues.sql','dashboard_admin_live_deposit_platform_key')+baseline);
 assert.equal((await db.query(metadataSQL)).rows[0].body_md5,'347e97b40e6c5469c0b537dd08b7d0a9');
 return db;
}
const rows=async db=>(await db.query('select * from private.dashboard_admin_live_withdraw_platforms() order by id,country,name')).rows;
async function seed(db){
 await db.exec([
 "insert into public.auto_withdraw_daily values ('印度','ALPHA'),(' 印度 ',' ALPHA '),('印度','ALPHA'),('印度','alpha'),('印度',' SAME '),('菲律宾','SAME'),",
 "(null,'NULL_COUNTRY'),('印度',null),('','EMPTY'),('印度',''),(' ','SPACES'),('印度','   '),",
 "('印度',U&'\\00A0'),('印度',U&'\\00E9'),('印度',U&'e\\0301'),('印度','平台甲'),('印度','平台乙'),",
 "('胖虎巴西','5C555'),('巴西','5C555'),('越南','WG-SYNTHETIC'),('LG','SUPERLG');",
 "insert into public.withdraw_operator_daily values ('印度','ALPHA'),('印度','REPORT-ONLY'),('印度',' REPORT-ONLY '),('印度','ZETA'),('印尼','SAME'),('印度','CONFLICT'),('印度','INACTIVE'),(null,'X'),('印度',null),('印度',' ');",
 "insert into public.newar_business_snapshots values ('越南','NEWAR-ONLY','VN','auto_withdraw_bundle','all'),('越南','NEWAR-ONLY','VN','auto_withdraw_bundle','all'),('印度','NOT-BUNDLE','IN','orders','all'),('印度','NOT-ALL','IN','auto_withdraw_bundle','charge');",
 "insert into public.dashboard_platform_team_map values ('AR','IN','ALPHA','ALPHA','M8',true),('AR','IN','SAME','SAME','M8',true),('LG','PH','SAME','SAME','PH-TEAM',true),('REPORT','印度','REPORT-ONLY','REPORT-ONLY','M8',true),('REPORT','印度','CONFLICT','CONFLICT','M8',true),('AR','IN','CONFLICT','CONFLICT','Other',true),('AR','IN','INACTIVE','INACTIVE','Inactive',false),('NEWAR','VN','NEWAR-ONLY','NEWAR-ONLY','VN-TEAM',true),('WG','VN','WG-SYNTHETIC','WG-SYNTHETIC','VN-TEAM',true);"
 ].join('\n'));
}
test('exact equivalence preserves NULL/blank/trim/unicode collisions and all historical source branches',async()=>{
 const db=await fixture();try{
  await seed(db);const before=await rows(db);await db.exec(migration);const after=await rows(db);assert.deepEqual(after,before);
  assert(after.some(x=>x.name==='REPORT-ONLY'&&x.team==='M8'));
  assert(after.some(x=>x.name==='NEWAR-ONLY'&&x.scope_group==='VN'));
  assert(after.some(x=>x.name==='WG-SYNTHETIC'&&x.source==='wg'));
  assert(after.some(x=>x.name==='CONFLICT'&&x.team==='__team_conflict__'));
  assert(after.some(x=>x.country==='LG'&&x.team==='__unassigned__'));
  assert.equal(after.filter(x=>x.country==='印度'&&x.name==='ALPHA').length,1);
  assert(after.some(x=>x.name==='\u00a0'));assert(after.some(x=>x.name==='é'));assert(after.some(x=>x.name==='e\u0301'));
  assert(!after.some(x=>/NOT-BUNDLE|NOT-ALL|NULL_COUNTRY|EMPTY|SPACES/.test(x.name)));
 }finally{await db.close()}
});
test('authorized country/platform results are unchanged and empty scope cannot reveal WG/report seeds',async()=>{
 const db=await fixture();try{
  await seed(db);
  const scopes=[
   [{country:'IN',platform:'ALPHA'},{country:'IN',platform:'REPORT-ONLY'}],
   [{country:'PH',platform:'SAME'}],
   [{country:'VN',platform:'WG-SYNTHETIC'},{country:'VN',platform:'NEWAR-ONLY'}],
   [{country:'BR_PANGHU',platform:'5C555'}],[],[{country:'IN',platform:'NOT-A-PLATFORM'}]
  ],before=[];
  for(const scope of scopes){await db.query("select set_config('test.scope',$1,false)",[JSON.stringify(scope)]);before.push(await rows(db))}
  await db.exec(migration);
  for(let i=0;i<scopes.length;i++){await db.query("select set_config('test.scope',$1,false)",[JSON.stringify(scopes[i])]);assert.deepEqual(await rows(db),before[i])}
  assert.equal(before[0].length,2);assert.equal(before[1].length,1);assert.equal(before[2].length,2);assert.deepEqual(before[4],[]);
 }finally{await db.close()}
});
test('OID/full metadata, owner-only ACL and source RLS survive without business mutations',async()=>{
 const db=await fixture();try{
  const before=(await db.query(metadataSQL)).rows[0];await db.exec(migration);const after=(await db.query(metadataSQL)).rows[0];
  assert.deepEqual(after.metadata,before.metadata);assert.notEqual(after.body_md5,before.body_md5);
  assert.deepEqual((await db.query("select has_function_privilege('anon','private.dashboard_admin_live_withdraw_platforms()','execute') anon,has_function_privilege('authenticated','private.dashboard_admin_live_withdraw_platforms()','execute') authenticated,has_function_privilege('service_role','private.dashboard_admin_live_withdraw_platforms()','execute') service_role")).rows[0],{anon:false,authenticated:false,service_role:false});
  assert((await db.query("select relrowsecurity from pg_class where oid in ('public.auto_withdraw_daily'::regclass,'public.withdraw_operator_daily'::regclass)")).rows.every(r=>r.relrowsecurity));
  assert.equal((migration.match(/\bexecute replace\(/g)||[]).length,1);
  assert.doesNotMatch(migration,/\b(?:insert into|delete from|update public|grant execute|disable row level security)\b/i);
 }finally{await db.close()}
});
test('empty and all-NULL/blank sources terminate without losing independent WG seeds',async()=>{
 const db=await fixture();try{
  await db.exec("insert into public.auto_withdraw_daily values(null,null),(null,'x'),('x',null),('',''),(' ',' ');insert into public.withdraw_operator_daily select * from public.auto_withdraw_daily");
  const before=await rows(db);await db.exec(migration);assert.deepEqual(await rows(db),before);assert.equal(before.length,2);
 }finally{await db.close()}
});
test('duplicate-heavy sources step once per raw tuple using both compound indexes',async()=>{
 const db=await fixture();try{
  await db.exec("insert into public.auto_withdraw_daily select '印度','P'||(i%11)::text from generate_series(1,12000)i;insert into public.withdraw_operator_daily select '越南','O'||(i%13)::text from generate_series(1,26000)i;");
  const before=await rows(db);await db.exec(migration);assert.deepEqual(await rows(db),before);
  await db.exec('analyze public.auto_withdraw_daily;analyze public.withdraw_operator_daily;');
  for(const [table,count]of [['auto_withdraw_daily',11],['withdraw_operator_daily',13]]){
   const walk='with recursive k(country,platform) as ((select country,platform from public.'+table+
    ' where country is not null and platform is not null order by country,platform limit 1) union all select n.country,n.platform from k cross join lateral(select country,platform from public.'+table+
    ' where country is not null and platform is not null and (country,platform)>(k.country,k.platform) order by country,platform limit 1)n) select * from k';
   const plan=(await db.query('explain(analyze,format json) '+walk)).rows[0]['QUERY PLAN'][0].Plan;
   assert.equal(plan['Actual Rows'],count);
   const nodes=[];function visit(n){nodes.push(n);for(const p of n.Plans||[])visit(p)}visit(plan);
   const scans=nodes.filter(n=>(n['Node Type']||'').includes('Index'));
   assert.equal(scans.length,2);assert(scans.every(n=>n['Index Name']===table+'_country_platform_identity_idx'));
   assert(scans.every(n=>n['Actual Rows']<=1));assert(!nodes.some(n=>n['Node Type']==='Seq Scan'));
   assert.equal(nodes.find(n=>n['Node Type']==='Recursive Union')['Actual Rows'],count);
  }
 }finally{await db.close()}
});
test('body and metadata drift including default PUBLIC/null ACL fail before creating indexes',async()=>{
 for(const alteration of [
  "alter function private.dashboard_admin_live_withdraw_platforms() cost 101",
  "alter function private.dashboard_admin_live_withdraw_platforms() security invoker",
  "alter function private.dashboard_admin_live_withdraw_platforms() set search_path=public",
  "alter function private.dashboard_admin_live_withdraw_platforms() volatile",
  "grant execute on function private.dashboard_admin_live_withdraw_platforms() to authenticated",
  "drop function private.dashboard_admin_live_withdraw_platforms();"
 ]){
  const db=await fixture();try{await db.exec(alteration);await assert.rejects(db.exec(migration),/withdraw_catalog_(metadata|baseline)_drift/);await db.exec('rollback');
   assert.equal((await db.query("select count(*)::int n from pg_class where relname like '%_country_platform_identity_idx'")).rows[0].n,0)
  }finally{await db.close()}
 }
 const db=await fixture();try{
  await db.exec('drop function private.dashboard_admin_live_withdraw_platforms();'+baseline.slice(0,baseline.indexOf('revoke all')));
  assert.equal((await db.query("select proacl from pg_proc where oid='private.dashboard_admin_live_withdraw_platforms()'::regprocedure")).rows[0].proacl,null);
  await assert.rejects(db.exec(migration),/withdraw_catalog_metadata_drift/);await db.exec('rollback');
 }finally{await db.close()}
 const drift=await fixture();try{
  await drift.exec(baseline.replace('declare v_scope','-- changed body\n declare v_scope'));
  await assert.rejects(drift.exec(migration),/withdraw_catalog_baseline_drift/);await drift.exec('rollback');
 }finally{await drift.close()}
});
test('source schema/RLS and index name collisions fail closed and roll back both index writes',async()=>{
 for(const alteration of [
  'alter table public.auto_withdraw_daily disable row level security',
  'alter table public.withdraw_operator_daily force row level security',
  'alter table public.withdraw_operator_daily rename column platform to wrong_name',
  'alter table public.auto_withdraw_daily alter column country type varchar(64)',
  'create index withdraw_operator_daily_country_platform_identity_idx on public.withdraw_operator_daily(platform,country)'
 ]){
  const db=await fixture();try{
   await db.exec(alteration);await assert.rejects(db.exec(migration),/withdraw_catalog_(relation|column)_contract|already exists/);await db.exec('rollback');
   assert.equal((await db.query("select to_regclass('public.auto_withdraw_daily_country_platform_identity_idx') idx")).rows[0].idx,null);
   assert.equal((await db.query(metadataSQL)).rows[0].body_md5,'347e97b40e6c5469c0b537dd08b7d0a9');
  }finally{await db.close()}
 }
 assert.match(migration,/set local lock_timeout='2s'/);assert.match(migration,/set local statement_timeout='10s'/);
 assert.match(migration,/collisdeterministic/);assert.match(migration,/k\.collation_oid is distinct from a\.attcollation/);
});
