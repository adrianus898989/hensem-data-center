// All DDL targets this explicit in-memory database. No network clients.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {build,body}=require('../scripts/build-india-moneypay-rapay-alias-patch.cjs');
const rows=JSON.parse(fs.readFileSync(path.resolve(__dirname,'fixtures/india-moneypay-rapay-alias-baseline.json'),'utf8'));
const result=build(rows),db=new PGlite();
const signatures=rows.map(r=>r.signature);
const state=async()=>(await db.query("select p.oid::regprocedure::text signature,md5(p.prosrc) body_hash,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid=any($1::regprocedure[])order by 1",[signatures])).rows;
const scalar=async(q,a=[])=>Object.values((await db.query(q,a)).rows[0])[0];
async function reset(){
 for(const r of rows){await db.exec(r.definition);await db.exec('revoke all on function '+r.signature+' from public,anon,authenticated,service_role;grant all on function '+r.signature+' to postgres;');}
}
const historical=result.oldManifest.rules.flatMap(r=>r.aliases.map(raw=>({context:r.match,raw})));
const resolveHistorical=async()=>scalar("select jsonb_agg(private.team_provider_canonical_resolution(v->'context',v->>'raw',null)-'version' order by n)from jsonb_array_elements($1::jsonb)with ordinality x(v,n)",[JSON.stringify(historical)]);
let originalState,originalResolution;
before(async()=>{await db.exec('create schema private;create role anon;create role authenticated;create role service_role;');await reset();originalState=await state();originalResolution=await resolveHistorical();});
after(()=>db.close());
test('install exact constant changes and preserve every function OID owner ACL setting and all prior rule results',async()=>{
 assert.deepEqual((await state()).map(r=>r.body_hash).sort(),rows.map(r=>r.body_hash).sort());await db.exec(result.sql);
 const updated=await state();assert.deepEqual(updated.map(r=>r.metadata),originalState.map(r=>r.metadata));
 for(const c of result.changes)assert.equal(updated.find(r=>r.signature===c.signature).body_hash,c.desired_hash);
 assert.deepEqual(await resolveHistorical(),originalResolution);assert.equal(historical.length,441);
 for(const c of [{sourceKind:'native_prepared',source:'prepared',team:'M8'},{sourceKind:'team_sheet',source:'hong_kong_india',team:'香港'},{sourceKind:'team_sheet',source:'red_crab_india',team:'红膏蟹'}]){
  const context={...c,country:'印度',scope:'IN',currency:'INR'};
  for(const [raw,provider]of [['MoneyPay-QR','MoneyPay'],['MoneyPay','MoneyPay'],['RAPay2INR','RAPay'],['RAPay','RAPay']]){
   const resolved=await scalar('select private.team_provider_canonical_resolution($1::jsonb,$2,null)',[JSON.stringify(context),raw]);
   assert.equal(resolved.provider,provider);assert.equal(resolved.confirmed,true);assert.equal(resolved.version,result.manifest.version);
  }
 }
 for(const raw of ['MoneyPay-QR','MoneyPay','RAPay2INR','RAPay']){
  const resolved=await scalar("select private.dashboard_admin_live_provider_alias('印度',$1)",[raw]);assert.equal(resolved,raw.startsWith('Money')?'MoneyPay':'RAPay');
  assert.equal(await scalar("select private.dashboard_admin_live_provider_alias('印度',private.dashboard_admin_live_provider_alias('印度',$1))",[raw]),resolved);
 }
 for(const role of ['anon','authenticated','service_role'])for(const s of signatures)assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\')',[role,s]),false);
});
test('rerunning the installed patch is idempotent',async()=>{const before=await state();await db.exec(result.sql);assert.deepEqual(await state(),before);});
test('late helper body drift refuses the migration and rolls back earlier helper changes',async()=>{
 await reset();const last=rows.find(r=>r.signature.includes('canonical_resolution')),oldBody=body(last.definition);
 await db.exec(last.definition.replace(oldBody,"\nselect '{}'::jsonb\n"));const before=await state();
 await assert.rejects(db.exec(result.sql),/india_provider_alias_baseline_drift/);await db.exec('rollback');assert.deepEqual(await state(),before);await reset();
});
test('late helper permission or search_path drift refuses atomically',async()=>{
 const last=rows.find(r=>r.signature.includes('canonical_resolution'));
 for(const drift of ['grant execute on function '+last.signature+' to anon','alter function '+last.signature+' reset all']){
  await reset();await db.exec(drift);const before=await state();
  await assert.rejects(db.exec(result.sql),/india_provider_alias_metadata_or_acl_drift/);await db.exec('rollback');assert.deepEqual(await state(),before);
 }
 await reset();assert.deepEqual(await state(),originalState);
});
test('new aliases do not change foreign country or verified sheet currency scope or mix protected provider names',async()=>{
 await db.exec(result.sql);
 for(const raw of ['MoneyPay-QR','RAPay2INR'])for(const context of [
  {sourceKind:'team_sheet',source:'hong_kong_india',team:'香港',country:'印度',scope:'IN',currency:'USDT'},
  {sourceKind:'team_sheet',source:'red_crab_india',team:'红膏蟹',country:'印度',scope:'IN',currency:'USDT'},
  {sourceKind:'team_sheet',source:'hong_kong_india',team:'香港',country:'印尼',scope:'ID',currency:'INR'}
 ])assert.equal((await scalar('select private.team_provider_canonical_resolution($1::jsonb,$2,null)',[JSON.stringify(context),raw])).provider,raw);
 assert.notEqual(await scalar("select private.dashboard_admin_live_provider_alias('印度','AiPay')"),await scalar("select private.dashboard_admin_live_provider_alias('印度','AIV3Pay')"));
 assert.notEqual(await scalar("select private.dashboard_admin_live_provider_alias('印度','999PAY')"),'99Pay');
});

