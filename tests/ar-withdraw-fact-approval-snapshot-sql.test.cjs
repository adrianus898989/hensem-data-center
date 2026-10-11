const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),test=require('node:test');
const {fixture,row,install}=require('./fixtures/ar-withdraw-fact-projection-harness.cjs');
const read=name=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8');
const controls=read('20261011120036_ar_in_withdraw_fact_partition_readiness.sql'),reader=read('20261011120049_ar_in_withdraw_fact_reader.sql'),migration=read('20261011122535_ar_withdraw_fact_approval_maintenance_snapshot.sql');
const signatures=['private.approve_ar_withdraw_fact_day(text,date)','private.approve_ar_withdraw_fact_future(text)'];
const metadata=async(db,sig)=>(await db.query('select md5(prosrc) hash,to_jsonb(p)-\'prosrc\' metadata from pg_proc p where oid=$1::regprocedure',[sig])).rows[0];
const state=async db=>(await db.query(`select jsonb_build_object('generation',private.ar_withdraw_fact_generation(),
 'ready',(select jsonb_agg(to_jsonb(r) order by platform,data_date) from private.ar_withdraw_fact_ready r),
 'future',(select jsonb_agg(to_jsonb(r) order by platform) from private.ar_withdraw_fact_future_ready r),
 'source',(select jsonb_agg(to_jsonb(a) order by order_no) from ar_collected_orders a),
 'facts',(select jsonb_agg(to_jsonb(f) order by order_no) from private.ar_withdraw_facts f)) s`)).rows[0].s;
async function prepare(){const db=await fixture();await db.exec(install);await db.exec(controls);await row(db,'APPROVED');await db.exec(`begin isolation level repeatable read;select private.approve_ar_withdraw_fact_day('91CLUB','2026-10-10');select private.approve_ar_withdraw_fact_future('91CLUB');commit;`);await db.exec(reader);return db;}
test('maintenance approval uses a fresh locked statement snapshot, preserves generation/data/approvals and all function security metadata',async()=>{
 const db=await prepare();try{
  const before=await state(db),old=[];for(const sig of signatures)old.push(await metadata(db,sig));
  assert.deepEqual(old.map(x=>x.hash),['0dc75b2ca94f1e4104d202b31e53fe6b','31423c8a867aee054ab2e1bbc4e7b2f3']);
  await db.exec(migration);assert.deepEqual(await state(db),before,'migration does not alter readiness generation, approvals or native/projection data');
  const changed=[];for(let i=0;i<signatures.length;i++){const m=await metadata(db,signatures[i]);assert.deepEqual(m.metadata,old[i].metadata);changed.push(m);}
  assert.deepEqual(changed.map(x=>x.hash),['8d2f3cf8d5c61e141c8484c854e3eb97','08df778fb7144aa12c58f3876f73adf3']);
  await db.exec(migration);assert.deepEqual(await state(db),before);for(let i=0;i<signatures.length;i++)assert.deepEqual(await metadata(db,signatures[i]),changed[i]);
  for(const expression of ["private.approve_ar_withdraw_fact_day('91CLUB','2026-10-10')","private.approve_ar_withdraw_fact_future('91CLUB')"]){
   await db.exec('begin isolation level repeatable read');await assert.rejects(()=>db.query('select '+expression),/requires_read_committed/);await db.exec('rollback');
  }
  await db.exec('begin isolation level read committed');const day=(await db.query("select private.approve_ar_withdraw_fact_day('91CLUB','2026-10-10') r")).rows[0].r;await db.exec('commit');assert.equal(day.approved,true);assert.equal(day.sourceCount,1);assert.equal(day.generation,before.generation);
  await db.exec('begin isolation level read committed');const future=(await db.query("select private.approve_ar_withdraw_fact_future('91CLUB') r")).rows[0].r;await db.exec('commit');assert.equal(future.approved,true);assert.equal(future.futureFrom,'2026-10-11');assert.equal(future.generation,before.generation);
  // Wrong private data revokes readiness and cannot be re-approved by the new protocol.
  await db.exec("update private.ar_withdraw_facts set account='Corrupt private maintenance' where order_no='APPROVED'");await db.exec('begin isolation level read committed');await assert.rejects(()=>db.query("select private.approve_ar_withdraw_fact_day('91CLUB','2026-10-10')"),/parity_failed/);await db.exec('rollback');
  const oids=[];for(const sig of signatures)oids.push((await db.query('select $1::regprocedure::oid oid',[sig])).rows[0].oid);
  await db.exec('set role service_role');for(const oid of oids)assert.equal((await db.query('select has_function_privilege(current_user,$1::oid,\'execute\') b',[oid])).rows[0].b,false);await db.exec('reset role');
  for(const sig of signatures){const body=(await db.query('select prosrc from pg_proc where oid=$1::regprocedure',[sig])).rows[0].prosrc;assert.ok(body.includes('lock table private.ar_withdraw_facts in share mode nowait;'));assert.ok(body.includes('lock table public.ar_collected_orders in share update exclusive mode nowait;'));assert.ok(!body.includes('lock table private.ar_withdraw_facts in share update exclusive mode nowait;'));}
  // This test verifies isolation gates and the actual lock statement, not a
  // two-connection lock schedule (PGlite is a single-connection harness).
 }finally{await db.close();}
});
test('approval snapshot patch rejects owner, privilege, setting, volatility and return-schema drift atomically',async()=>{
 const db=await prepare();try{
  await db.exec('create role synthetic_wrong_owner');
  for(const mutation of [
   `alter function ${signatures[0]} owner to synthetic_wrong_owner`,
   `grant execute on function ${signatures[0]} to public`,
   `alter function ${signatures[0]} security definer`,
   `alter function ${signatures[0]} set search_path=public`,
   `alter function ${signatures[1]} stable`
  ]){const before=await state(db);await db.exec('begin');await db.exec(mutation);await assert.rejects(()=>db.exec(migration.slice(migration.indexOf('do $patch_'),migration.lastIndexOf('commit;'))),/metadata_drift/);await db.exec('rollback');assert.deepEqual(await state(db),before);}
  const before=await metadata(db,signatures[0]);const definition=(await db.query('select pg_get_functiondef($1::regprocedure) d',[signatures[0]])).rows[0].d;
  await db.exec('begin');await db.exec('drop function '+signatures[0]);await db.exec(definition.replace('RETURNS jsonb','RETURNS text'));await db.exec('revoke all on function '+signatures[0]+' from public');assert.equal((await metadata(db,signatures[0])).hash,before.hash);await assert.rejects(()=>db.exec(migration.slice(migration.indexOf('do $patch_'),migration.lastIndexOf('commit;'))),/metadata_drift/);await db.exec('rollback');assert.deepEqual(await metadata(db,signatures[0]),before);
 }finally{await db.close();}
});
