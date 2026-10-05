const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');let db;
const ddl=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261005135100_newar_workorder_identity_hash_indexes.sql'),'utf8');
before(async()=>{db=new PGlite();await db.exec('create table public.newar_detail_records(platform text,dataset text,workorder_type text,raw jsonb)');await db.exec(ddl)});
after(async()=>{await db.close()});
test('both fixed-width candidate indexes are idempotent and accept full long source references',async()=>{
 await db.exec(ddl);const text='原单'.repeat(5000);await db.query("insert into public.newar_detail_records values('DhaniWin','workorder','存款未到账',$1)",[JSON.stringify({depositOrderNo:text,rechargeNumber:text})]);
 assert.equal((await db.query("select raw->>'depositOrderNo' v from public.newar_detail_records")).rows[0].v,text);
 const indexes=(await db.query("select i.indisvalid,i.indnkeyatts,i.indnatts,pg_relation_size(i.indexrelid) size from pg_index i where i.indrelid='public.newar_detail_records'::regclass")).rows;
 assert.equal(indexes.length,2);assert(indexes.every(i=>i.indisvalid&&i.indnkeyatts===2&&i.indnatts===2));
});
test('explicit string and deposit predicates expose exact hash candidates while preserving a separate full-text check',async()=>{
 await db.exec(`insert into public.newar_detail_records select 'DhaniWin','workorder','存款未到账',jsonb_build_object('depositOrderNo','RC-'||i,'rechargeNumber','RC-'||i) from generate_series(1,1000) i;
 insert into public.newar_detail_records values('DhaniWin','workorder','存款未到账','{"depositOrderNo":123}'),('DhaniWin','workorder','提款未到账','{"depositOrderNo":"RC-10"}'),('OTHER','workorder','存款未到账','{"depositOrderNo":"RC-10"}');analyze public.newar_detail_records;set enable_seqscan=off`);
 for(const [field,suffix] of [['depositOrderNo','deposit'],['rechargeNumber','recharge']]){
  const sql=`select raw->>'${field}' v from public.newar_detail_records where platform='DhaniWin' and dataset='workorder' and workorder_type in ('存款未到账','存款未到账自动化') and jsonb_typeof(raw->'${field}')='string' and md5(upper(nullif(btrim(raw->>'${field}'),'')))=md5('RC-10') and upper(nullif(btrim(raw->>'${field}'),''))='RC-10'`;
  assert.deepEqual((await db.query(sql)).rows,[{v:'RC-10'}]);const plan=(await db.query('explain(analyze,format json) '+sql)).rows[0]['QUERY PLAN'][0];const nodes=[];(function walk(n){nodes.push(n);for(const p of n.Plans||[])walk(p)})(plan.Plan);
  assert(nodes.some(n=>n['Index Name']===`newar_workorder_${suffix}_identity_hash_v1_idx`));
 }
 await db.exec('reset enable_seqscan');
});
test('same-name incompatible index is rejected without silently accepting drift',async()=>{
 await db.exec('begin;drop index public.newar_workorder_recharge_identity_hash_v1_idx;create index newar_workorder_recharge_identity_hash_v1_idx on public.newar_detail_records(platform)');
 await assert.rejects(()=>db.exec(ddl.replace(/^begin;$/m,'').replace(/^commit;$/m,'')),/NEWAR_WORKORDER_RECHARGE_HASH_INDEX_DRIFT/);await db.exec('rollback');
});
