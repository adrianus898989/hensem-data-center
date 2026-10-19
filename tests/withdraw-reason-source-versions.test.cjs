// Synthetic source validity only. Never reads a production session, order, or database.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
// Local candidate overlays may share the repository's existing code-only fixture.
const fixtures=process.env.REASON_CANDIDATE_ROOT||root;
const {setup}=require(path.join(fixtures,'tests/fixtures/withdraw-reasons-query-harness.cjs'));
const install=fs.readFileSync(path.join(root,'supabase/operations/withdraw-reasons/versions.sql'),'utf8');
const day='2026-10-17';
const ar={source:'ar',name:'91CLUB',source_name:'91CLUB',country:'印度',scope_group:'IN',timezone:'Asia/Kolkata',currency:'INR',aliases:['91CLUB'],rawOnly:true};
const nw={source:'newar',name:'MAAN.WIN',source_name:'MAANWIN',country:'印度',scope_group:'IN',timezone:'Asia/Kolkata',currency:'INR',aliases:['MAAN.WIN','MAANWIN'],rawOnly:false};
const ensure=async(db,native)=>(await db.query('SELECT private.withdraw_reason_versions_ensure($1::jsonb,$2::date) v',[JSON.stringify(native),day])).rows[0].v;
const match=async(db,vector)=>(await db.query('SELECT private.withdraw_reason_versions_match($1::jsonb) v',[JSON.stringify(vector)])).rows[0].v;
const generation=async db=>(await db.query('SELECT private.ar_withdraw_detail_evidence_generation() g')).rows[0].g;
async function fixture(){const db=await setup();try{const before=await generation(db);assert.ok(before);await db.exec(install);assert.equal(await generation(db),before);return db}catch(error){await db.close();throw error}}

test('source versions preserve the real evidence generation and warm reads allocate no XID',async()=>{
 const db=await fixture();try{
  const vector=await ensure(db,ar);assert.ok(vector);assert.equal(await match(db,vector),true);
  await db.exec('BEGIN READ ONLY');assert.equal((await db.query('SELECT pg_current_xact_id_if_assigned() x')).rows[0].x,null);
  assert.deepEqual(await ensure(db,ar),vector);assert.equal(await match(db,vector),true);
  const definition=(await db.query("SELECT pg_get_functiondef('private.withdraw_reason_versions_match(jsonb)'::regprocedure) d")).rows[0].d;assert.equal((await db.query("SELECT to_regprocedure('private.withdraw_reason_versions_match(jsonb,boolean)') old")).rows[0].old,null);assert.doesNotMatch(definition,/\bFOR\s+(?:SHARE|UPDATE|NO\s+KEY\s+UPDATE|KEY\s+SHARE)\b/i);
  assert.equal((await db.query('SELECT pg_current_xact_id_if_assigned() x')).rows[0].x,null);await db.exec('ROLLBACK');
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_trigger WHERE tgrelid='private.ar_withdraw_detail_operator_evidence'::regclass AND NOT tgisinternal")).rows[0].n,2);
 }finally{await db.close()}
});

test('relevant source edits invalidate while same-writer/saved-point results never become current',async()=>{
 const db=await fixture();try{
  const original=await ensure(db,ar);assert.ok(original);
  await db.exec("UPDATE public.ar_collected_orders SET amount=amount+1 WHERE order_no='SYNTHETIC-AR17'");assert.equal(await match(db,original),true);
  await db.exec('BEGIN;SAVEPOINT source_change');
  await db.exec("UPDATE public.ar_collected_orders SET manual_remark='first' WHERE order_no='SYNTHETIC-AR17'");assert.equal(await ensure(db,ar),null);assert.equal(await match(db,original),false);assert.equal(await match(db,original),false);
  await db.exec('ROLLBACK TO source_change');assert.equal(await match(db,original),true);
  await db.exec("UPDATE public.ar_collected_orders SET manual_remark='kept' WHERE order_no='SYNTHETIC-AR17'");assert.equal(await ensure(db,ar),null);
  await db.exec('COMMIT');assert.equal(await match(db,original),false);assert.ok(await ensure(db,ar));
 }finally{await db.close()}
});

test('NEWAR direct projection edits, future visibility and hook disable/re-enable fail closed',async()=>{
 const db=await fixture();try{
  let vector=await ensure(db,nw);assert.ok(vector);assert.equal(vector.keys.length,2);
  await db.exec("UPDATE private.newar_withdraw_reason_facts SET source_label='changed' WHERE platform='MAANWIN'");assert.equal(await match(db,vector),false);vector=await ensure(db,nw);
  await db.exec("UPDATE private.newar_withdraw_facts SET captured_at=statement_timestamp()+interval'1day' WHERE platform='MAANWIN'");assert.equal(await ensure(db,nw),null);
  await db.exec("UPDATE private.newar_withdraw_facts SET captured_at='2026-10-18T00:00:00Z' WHERE platform='MAANWIN'");assert.ok(await ensure(db,nw));
  await db.exec('ALTER TABLE public.newar_detail_records DISABLE TRIGGER reason_versions_update');assert.equal(await ensure(db,nw),null);
  await db.exec('ALTER TABLE public.newar_detail_records ENABLE TRIGGER reason_versions_update');assert.equal(await ensure(db,nw),null);
 }finally{await db.close()}
});

test('one thousand real row-projector calls coalesce each affected day to one shared write',async()=>{
 const db=await fixture();try{
  const before=await ensure(db,nw);assert.ok(before);
  await db.exec(`CREATE TABLE private.reason_version_test_counts(k text PRIMARY KEY,n integer);
   CREATE FUNCTION private.reason_version_test_counter() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
    INSERT INTO private.reason_version_test_counts VALUES(TG_ARGV[0],1)ON CONFLICT(k)DO UPDATE SET n=private.reason_version_test_counts.n+1;RETURN NULL;END$$;
   CREATE TRIGGER reason_version_test_day AFTER INSERT OR UPDATE ON private.withdraw_reason_day_versions FOR EACH ROW EXECUTE FUNCTION private.reason_version_test_counter('day');
   CREATE TRIGGER reason_version_test_fact AFTER INSERT OR UPDATE ON private.newar_withdraw_facts FOR EACH STATEMENT EXECUTE FUNCTION private.reason_version_test_counter('facts');
   CREATE TRIGGER reason_version_test_label AFTER INSERT OR UPDATE ON private.newar_withdraw_reason_facts FOR EACH STATEMENT EXECUTE FUNCTION private.reason_version_test_counter('labels');`);
  await db.exec('BEGIN');
  await db.exec(`INSERT INTO public.newar_detail_records(id,platform,dataset,source_id,amount,status_group,currency,created_at,captured_at,received_at,raw)
   SELECT md5('reason-version-fixture-'||g)::uuid,'MAANWIN','withdraw','reason-version-'||g,0,'success','INR',
    '2026-10-17T01:00:00Z','2026-10-18T00:00:00Z','2026-10-18T00:00:00Z',
    '{"businessSchemaVersion":"2","operatorSourceField":"verifiedField","operatorName":"Synthetic operator","operatorType":"manual","automaticReasonSource":"remark","automaticReasonLabel":"Synthetic label"}'::jsonb
   FROM generate_series(1,1000)g`);
  const counts=Object.fromEntries((await db.query('SELECT k,n FROM private.reason_version_test_counts')).rows.map(x=>[x.k,x.n]));
  // INSERT ... ON CONFLICT also fires its UPDATE statement trigger for empty sets.
  assert.equal(counts.facts,2000);assert.equal(counts.labels,2000);assert.equal(counts.day,1);
  assert.equal(await ensure(db,nw),null);assert.equal(await match(db,before),false);
  await db.exec('COMMIT');assert.ok(await ensure(db,nw));assert.equal(await match(db,before),false);
 }finally{await db.close()}
});
