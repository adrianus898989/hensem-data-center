// Synthetic local Postgres fixtures only; this test performs no network calls.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_PATH||'@electric-sql/pglite');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/admin-platform-team-map-confirmed-m8-reports.sql'),'utf8');
const schema=fs.readFileSync(path.join(__dirname,'../supabase/admin-platform-team-map.sql'),'utf8').split('insert into public.dashboard_platform_team_map')[0];
async function fixture(){const db=new PGlite();await db.exec('create role anon; create role authenticated;'+schema);return db;}

test('confirmed report mapping inserts exactly eight source-preserving rows and reruns without changing identities',async()=>{
 const db=await fixture();try{
  await db.exec("insert into public.dashboard_platform_team_map(team_name,system_name,source_system,country_name,country_code,source_country,platform_name,source_platform) values ('Existing','LG系统','LG','LG','LG','LG','SUPERLG','SUPERLG'),('Other','AR系统','AR','印度','IN','印度','HOT985','HOT985')");
  await db.exec(sql);
  const rows=(await db.query("select id,team_name,system_name,source_system,country_name,country_code,source_country,platform_name,source_platform,active,metadata,created_at,updated_at from public.dashboard_platform_team_map where source_system='REPORT' order by country_code,source_platform")).rows;
  assert.equal(rows.length,8);assert(rows.every(r=>r.team_name==='M8'&&r.system_name==='源日报'&&r.active));
  assert.deepEqual(rows.map(r=>[r.country_code,r.country_name,r.source_country,r.source_platform]),[
   ['BR','巴西','巴西','SSSGAME'],['BR','巴西','巴西','TGJOGO'],['CL','智利','南美','NPG-CHILE'],['CO','哥伦比亚','南美','NPG-COLOMBIA'],['ID','印尼','印尼','HOT985'],['ID','印尼','印尼','IND666'],['ID','印尼','印尼','UANG'],['MX','墨西哥','南美','NPG-MEXICO']
  ]);
  assert(rows.every(r=>r.platform_name===r.source_platform&&r.metadata.assignment_scope==='team_only'));
  await db.exec(sql);assert.deepEqual((await db.query("select id,team_name,system_name,source_system,country_name,country_code,source_country,platform_name,source_platform,active,metadata,created_at,updated_at from public.dashboard_platform_team_map where source_system='REPORT' order by country_code,source_platform")).rows,rows);
  assert.deepEqual((await db.query("select team_name from public.dashboard_platform_team_map where source_system<>'REPORT' order by source_system")).rows,[{team_name:'Other'},{team_name:'Existing'}]);
  const access=(await db.query("select relrowsecurity as rls,has_table_privilege('authenticated','public.dashboard_platform_team_map','SELECT') as authenticated_read,has_table_privilege('anon','public.dashboard_platform_team_map','INSERT') as anonymous_write from pg_class where oid='public.dashboard_platform_team_map'::regclass")).rows[0];
  assert.deepEqual(access,{rls:true,authenticated_read:false,anonymous_write:false});
 }finally{await db.close();}
});

test('a conflicting existing exact source key aborts all eight assignments instead of overwriting another change',async()=>{
 const db=await fixture();try{
  await db.exec("insert into public.dashboard_platform_team_map(team_name,system_name,source_system,country_name,country_code,source_country,platform_name,source_platform) values ('Different','源日报','REPORT','印尼','ID','印尼','HOT985','HOT985')");
  await assert.rejects(db.exec(sql),/confirmed M8 report assignments conflict/);await db.exec('rollback');
  assert.deepEqual((await db.query('select team_name,source_platform from public.dashboard_platform_team_map')).rows,[{team_name:'Different',source_platform:'HOT985'}]);
 }finally{await db.close();}
});
