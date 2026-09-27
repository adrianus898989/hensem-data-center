// Synthetic catalogs only; no production users, JWTs, orders or network.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=n=>fs.readFileSync(path.join(__dirname,'../supabase',n),'utf8');
const before=read('admin-live-withdraw-team-inheritance.sql');
const patch=read('admin-live-compact-withdraw-catalog.sql');
const fn=(file,name)=>{const s=read(file),a=s.indexOf('create or replace function private.'+name+'('),b=s.indexOf('revoke all on function private.'+name+'(',a);assert(a>=0&&b>a);return s.slice(a,b)};
const all=db=>db.query('select * from private.dashboard_admin_live_withdraw_platforms() order by id,name,team,country,scope_group,source,timezone,currency,source_name').then(r=>r.rows);
async function fixture(){
 const db=new PGlite();
 await db.exec(`
 create role anon; create role authenticated; create schema private;
 create table public.auto_withdraw_daily(country text,platform text);
 create table public.withdraw_operator_daily(country text,platform text);
 create table public.newar_business_snapshots(country text,platform text,country_code text,kind text,direction text);
 create table public.dashboard_platform_team_map(source_system text,source_country text,source_platform text,platform_name text,team_name text,active boolean default true);
 alter table public.dashboard_platform_team_map enable row level security;
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$
 begin
  if current_setting('test.denied',true)='yes' then raise exception 'access_denied';end if;
  return coalesce(nullif(current_setting('test.scope',true),''),'null')::jsonb;
 end$$;
 create function private.dashboard_scope_allows(scope jsonb,country text,platform text) returns boolean language sql immutable as $$
 select scope='null'::jsonb or scope @> jsonb_build_array(jsonb_build_object('country',country,'platform',platform))$$;
 `+fn('admin-live-platform-catalog-map.sql','dashboard_admin_live_is_panghu_platform')+fn('admin-live-platform-catalog-map.sql','dashboard_admin_live_report_country')+fn('admin-live-withdraw-pages.sql','dashboard_admin_live_withdraw_key')+fn('admin-live-deposit-issues.sql','dashboard_admin_live_deposit_platform_key'));
 await db.exec(before);
 return db;
}
async function seed(db){
 await db.exec(`
 insert into public.auto_withdraw_daily values
 (' 菲律宾 ','SUPERLG'),('PH','SUPERLG'),('LG','SUPERLG'),('印尼','SUPERLG'),
 ('胖虎巴西','5C555'),('巴西','5C555'),('巴西','SHARED'),('胖虎巴西','SHARED'),
 ('南美','NPG-MEXICO'),('SA','NPG-CHILE'),('南美','NPG-COLOMBIA'),
 ('印度','INDIA82'),('印度','Dhani.Win'),('香港','SAME'),('红膏蟹','SAME'),
 ('PH','CLASH'),('PH','NO_MAP'),('PH','INACTIVE'),('PH','PUNCT.NAME'),('ZZ','FUTURE'),
 ('','EMPTY'),(null,'NULL_COUNTRY'),('PH',' '),('PH',null);
 insert into public.withdraw_operator_daily select country,platform from public.auto_withdraw_daily;
 insert into public.auto_withdraw_daily select country,platform from public.withdraw_operator_daily;
 insert into public.newar_business_snapshots values
 ('菲律宾','SNAP','PH','auto_withdraw_bundle','all'),('未来国','FUTURE','ZZ','auto_withdraw_bundle','all'),
 ('菲律宾','IGNORE','PH','other','all'),('菲律宾','IGNORE','PH','auto_withdraw_bundle','charge');
 insert into public.dashboard_platform_team_map values
 ('LG','PH','SUPERLG','SUPERLG','M8',true),('PANDA','菲律宾','SUPERLG','SUPERLG','M8',true),
 ('LG','LG','SUPERLG','SUPERLG','M8',true),('LG','ID','SUPERLG','SUPERLG','Other',true),
 ('REPORT','南美','NPG-MEXICO','NPG-MEXICO','M8',true),
 ('REPORT','SA','NPG-CHILE','NPG-CHILE','M8',true),
 ('REPORT','南美','NPG-COLOMBIA','NPG-COLOMBIA','M8',true),
 ('AR','IN','82LOTTERY','INDIA82','M8',true),('NEW_AR','IN','DHANIWIN','DHANIWIN','M8',true),
 ('GAME66','香港','SAME','SAME','香港',true),('GAME66','红膏蟹','SAME','SAME','红膏蟹',true),
 ('LG','PH','CLASH','CLASH','M8',true),('PANDA','PH','CLASH','CLASH','Other',true),
 ('LG','PH','INACTIVE','INACTIVE','M8',false),('LG','PH','PUNCT-NAME','PUNCT-NAME','M8',true),
 ('REPORT','巴西','SHARED','SHARED','Brazil team',true),('LG','PH','NO_SOURCE','NO_SOURCE','M8',true);
 `);
}
test('full sorted rows and all nine identity/ownership fields remain identical across duplicates, aliases, conflicts and countries',async()=>{
 const db=await fixture();try{
  await seed(db);const old=await all(db);assert(old.length>15);
  await db.exec(patch);const current=await all(db);assert.deepEqual(current,old);
  assert.equal(current.find(r=>r.name==='CLASH').team,'__team_conflict__');
  assert.equal(current.find(r=>r.name==='INACTIVE').team,'__unassigned__');
  assert.equal(current.find(r=>r.name==='PUNCT.NAME').team,'__unassigned__');
  assert.equal(current.find(r=>r.name==='5C555').scope_group,'BR_PANGHU');
  assert.equal(current.filter(r=>r.name==='SUPERLG').length,3,'PH aliases collapse but ID and historical LG retain raw scopes');
  assert.equal(current.find(r=>r.name==='INDIA82').team,'M8');
  assert.equal(current.find(r=>r.name==='Dhani.Win').team,'M8');
  assert(!current.some(r=>r.name==='NO_SOURCE'||r.name==='IGNORE'));
 }finally{await db.close()}
});
test('restricted and empty scopes stay exact and fresh authorization can revoke access after a successful read',async()=>{
 const db=await fixture();try{
  await seed(db);const scopes=[
   [{country:'PH',platform:'SUPERLG'}],
   [{country:'BR_PANGHU',platform:'SHARED'},{country:'红膏蟹',platform:'SAME'}],
   [{country:'LG',platform:'SUPERLG'}],[],[{country:'ZZ',platform:'FUTURE'}]
  ],expected=[];
  for(const scope of scopes){await db.query("select set_config('test.scope',$1,false)",[JSON.stringify(scope)]);expected.push(await all(db))}
  await db.exec(patch);
  for(let i=0;i<scopes.length;i++){await db.query("select set_config('test.scope',$1,false)",[JSON.stringify(scopes[i])]);assert.deepEqual(await all(db),expected[i])}
  assert.equal(expected[0].length,1);assert.equal(expected[0][0].country,'菲律宾');assert.equal(expected[2][0].scope_group,'LG');assert.deepEqual(expected[3],[]);
  await db.exec("select set_config('test.denied','yes',false)");await assert.rejects(all(db),/access_denied/);
 }finally{await db.close()}
});
test('guarded deployment is repeatable, preserves function ACL/RLS/security settings and rejects an unrelated newer body',async()=>{
 const db=await fixture();try{
  const security=async()=> (await db.query(`select proacl::text,prosecdef,proconfig,prorettype::text,
  has_function_privilege('anon',oid,'execute') anon_execute,
  has_function_privilege('authenticated',oid,'execute') authenticated_execute
  from pg_proc where oid='private.dashboard_admin_live_withdraw_platforms()'::regprocedure`)).rows;
  const old=await security();await db.exec(patch);await db.exec(patch);assert.deepEqual(await security(),old);
  assert.equal(old[0].anon_execute,false);assert.equal(old[0].authenticated_execute,false);
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.dashboard_platform_team_map'::regclass")).rows[0].relrowsecurity,true);
  const definition=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_withdraw_platforms()'::regprocedure) d")).rows[0].d;
  await db.exec(definition.replace('begin\n return query','begin\n -- unrelated newer deployment\n return query'));
  await assert.rejects(db.exec(patch),/baseline changed/);await db.exec('rollback');
  assert.match((await db.query("select prosrc from pg_proc where oid='private.dashboard_admin_live_withdraw_platforms()'::regprocedure")).rows[0].prosrc,/unrelated newer deployment/);
  assert.equal((patch.match(/CREATE OR REPLACE FUNCTION/gi)||[]).length,1);
  assert.doesNotMatch(patch.replace(/--[^\n]*/g,''),/\b(grant|revoke|create\s+(?:table|index)|insert\s+into|update\s+public|delete\s+from)\b/i);
 }finally{await db.close()}
});
test('classification is evaluated once per compact source identity rather than once per mapping candidate',async()=>{
 const db=await fixture();try{
  await db.exec(`
   insert into public.auto_withdraw_daily select 'PH','P'||n from generate_series(1,80)n cross join generate_series(1,8)copies;
   insert into public.withdraw_operator_daily select * from public.auto_withdraw_daily;
   insert into public.dashboard_platform_team_map select 'LG','PH','P'||n,'P'||n,'M8',true from generate_series(1,80)n;
  `);
  await db.exec(patch);
  const definition=(await db.query("select prosrc from pg_proc where oid='private.dashboard_admin_live_withdraw_platforms()'::regprocedure")).rows[0].prosrc;
  const query=definition.slice(definition.indexOf('with\n'),definition.lastIndexOf('\nend;')).replace("private.dashboard_scope_allows(v_scope,c.scope_group,c.platform)","private.dashboard_scope_allows('null'::jsonb,c.scope_group,c.platform)");
  const plan=(await db.query('explain(analyze,format json) '+query)).rows[0]['QUERY PLAN'][0].Plan,nodes=[];
  const visit=n=>{nodes.push(n);for(const p of n.Plans||[])visit(p)};visit(plan);
  for(const name of ['withdraw_display','withdraw_classified']){
   const cte=nodes.find(n=>n['Subplan Name']==='CTE '+name);assert(cte,name);assert.equal(cte['Actual Loops'],1);assert.equal(cte['Actual Rows'],80);
  }
  assert.equal(plan['Actual Rows'],80);
 }finally{await db.close()}
});

