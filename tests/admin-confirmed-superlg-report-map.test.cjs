const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_PATH||'@electric-sql/pglite');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/admin-platform-team-map-confirmed-superlg-history.sql'),'utf8');
const schema=fs.readFileSync(path.join(__dirname,'../supabase/admin-platform-team-map.sql'),'utf8').split('insert into public.dashboard_platform_team_map')[0];
async function fixture(){const db=new PGlite();await db.exec('create role anon; create role authenticated;'+schema+"create table public.withdraw_operator_daily(country text,platform text,data_date date);insert into public.withdraw_operator_daily values('LG','SUPERLG','2026-07-30');");return db}
test('confirmed historical SUPERLG adds one exact mapping and never rewrites source records or other mappings',async()=>{
 const db=await fixture();try{
  await db.exec("insert into public.dashboard_platform_team_map(team_name,system_name,source_system,country_name,country_code,source_country,platform_name,source_platform) values('M8','LG系列','LG','菲律宾','PH','PH','SUPERLG','SUPERLG'),('Other','LG系列','LG','印尼','ID','ID','SUPERLG','SUPERLG')");
  const before=(await db.query('select * from public.dashboard_platform_team_map order by source_country')).rows,source=(await db.query('select * from public.withdraw_operator_daily')).rows;
  await db.exec(sql);const first=(await db.query("select * from public.dashboard_platform_team_map where source_country='LG'")).rows;assert.equal(first.length,1);const row=first[0];assert.equal(row.team_name,'M8');assert.equal(row.country_name,'菲律宾');assert.equal(row.country_code,'PH');assert.equal(row.source_system,'LG');assert.equal(row.source_platform,'SUPERLG');assert.equal(row.source_country,'LG');
  await db.exec(sql);assert.deepEqual((await db.query("select * from public.dashboard_platform_team_map where source_country='LG'")).rows,first);assert.deepEqual((await db.query("select * from public.dashboard_platform_team_map where source_country<>'LG' order by source_country")).rows,before);assert.deepEqual((await db.query('select * from public.withdraw_operator_daily')).rows,source);
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.dashboard_platform_team_map'::regclass")).rows[0].relrowsecurity,true);
 }finally{await db.close()}
});
test('conflicting exact historical source assignment aborts instead of overriding ownership',async()=>{
 const db=await fixture();try{await db.exec("insert into public.dashboard_platform_team_map(team_name,system_name,source_system,country_name,country_code,source_country,platform_name,source_platform) values('Other','LG系列','LG','菲律宾','PH','LG','SUPERLG','SUPERLG')");await assert.rejects(db.exec(sql),/confirmed SUPERLG historical source conflicts/);await db.exec('rollback');assert.equal((await db.query('select team_name from public.dashboard_platform_team_map')).rows[0].team_name,'Other')}finally{await db.close()}
});
