const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const previous=fs.readFileSync(path.join(root,'supabase/migrations/20260920051744_uploaded_order_sources.sql'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260920062124_order_catalog_index_probes.sql'),'utf8');
const oldCatalog=previous.slice(previous.indexOf('create or replace function private.dashboard_uploaded_order_platforms()'),previous.indexOf('-- One normalized'));

test('all existing unified-source, permission, monetary, paging and legacy GAME66 fixtures pass with optimized catalog',()=>{
 const program=`const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
  const migration=${JSON.stringify(migration)};
  const {PGlite}=require('@electric-sql/pglite'),exec=PGlite.prototype.exec;let overlays=0;
  PGlite.prototype.exec=async function(sql,...rest){const result=await exec.call(this,sql,...rest);
   if(sql.includes('create or replace function private.dashboard_uploaded_order_query')&&!this.__catalogOverlay){this.__catalogOverlay=true;await exec.call(this,migration);overlays++;}return result;};
  process.on('beforeExit',()=>{if(!overlays)throw Error('Catalog optimization was not overlaid');});
  require(${JSON.stringify(path.join(__dirname,'uploaded-order-sources.test.cjs'))});`;
 const result=spawnSync(process.execPath,['-e',program],{cwd:root,encoding:'utf8',timeout:60000,env:process.env});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.match(result.stdout,/fail 0/);
});

test('new catalog is structurally identical except explicit first-match planner fences and unchanged grants',()=>{
 const strip=sql=>sql.replace(/--[^\n]*/g,'').replace(/\boffset\s+0\b/gi,'').replace(/notify pgrst,'reload schema';/g,'').replace(/\s+/g,'');
 assert.equal(strip(migration),strip(oldCatalog));
 assert.equal((migration.replace(/--[^\n]*/g,'').match(/\boffset 0\b/gi)||[]).length,6);
 assert.doesNotMatch(migration,/\b(create\s+(?:index|table)|insert\s+into|delete\s+from|update\s+public\.|materialized\s+view|set\s+enable_)\b/i);
});

test('actual PostgreSQL plan uses correlated index probes rather than scanning and grouping all AR orders',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create table ar_config_targets(country_code text,platform text,source_system text,primary key(country_code,platform));
   create table ar_collected_orders(source_system text,country_code text,platform text,order_kind text,order_no text,primary key(source_system,country_code,platform,order_kind,order_no));
   insert into ar_config_targets select 'VN',case when n<=4 then 'P'||n else 'EMPTY'||n end,'AR' from generate_series(1,8)n;
   insert into ar_collected_orders select 'AR','VN','P'||n,'recharge',n::text from generate_series(1,20000)n;
   analyze ar_config_targets;analyze ar_collected_orders;`);
  const shared="select t.country_code,t.platform from ar_config_targets t where exists(select 1 from ar_collected_orders a where a.country_code=t.country_code and a.platform=t.platform and a.source_system='AR' and a.order_kind in ('recharge','withdraw')";
  const oldRows=(await db.query(shared+') order by 1,2')).rows;
  const newRows=(await db.query(shared+' offset 0) order by 1,2')).rows;
  assert.deepEqual(newRows,oldRows);assert.equal(newRows.length,4);
  const plan=(await db.query('explain(analyze,format json) '+shared+' offset 0)')).rows[0]['QUERY PLAN'][0].Plan;
  const nodes=[];function visit(p){nodes.push(p);for(const c of p.Plans||[])visit(c);}visit(plan);
  assert.ok(!nodes.some(n=>n['Node Type']==='Aggregate'),'no all-order distinct/hash aggregate');
  const probe=nodes.find(n=>n['Relation Name']==='ar_collected_orders');
  assert.match(probe['Node Type'],/Index/);assert.match(probe['Index Cond'],/country_code = t.country_code/);assert.match(probe['Index Cond'],/platform = t.platform/);
  assert.ok(probe['Actual Rows']<=1,'EXISTS stops at first match per target');assert.equal(probe['Actual Loops'],8);
 }finally{await db.close();}
});
