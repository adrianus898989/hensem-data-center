/* Actual local PG execution; code-only production metadata, synthetic rows only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const here=__dirname,read=n=>fs.readFileSync(path.join(here,'fixtures/duoli-notes',n),'utf8');
const install=fs.readFileSync(path.join(here,'../supabase/migrations/20261015063100_duoli_source_business_notes.sql'),'utf8'),rollback=read('rollback.sql');
const query=install.match(/SELECT evidence INTO v_actual FROM \(([\s\S]*?)\) m;/)[1];
const expectedBefore=JSON.parse(install.match(/\$v_fresh_json\$([\s\S]*?)\$v_fresh_json\$/)[1]);
const expectedAfter=JSON.parse(install.match(/\$v_active_json\$([\s\S]*?)\$v_active_json\$/)[1]);
const key='synthetic_duoli_install_key_'+'x'.repeat(40),uid=()=>crypto.randomUUID();
const notes=()=>({version:1,fields:{condition:{state:'present',text:'SYNTHETIC business flow',redacted:false,truncated:false},remark:{state:'missing',text:null,redacted:false,truncated:false}}});
const row=(id='synthetic-source',extra={})=>({order_id:id,source_order_id:id,platform:'UANG',business_type:'withdraw',order_no:null,member_id:null,
 created_at:'2026-10-01T00:01:00Z',created_day:'2026-10-01',updated_at:'2026-10-01T17:05:00Z',status_code:'5',status_text:'rejected',currency:'IDR',operator:'SyntheticReviewer',
 provider:null,provider_code:null,channel:null,amount_raw:'5000.00',amount_source:'gold',amount_unit:'source_unverified',amount_fields_raw:{gold:'5000.00'},raw:{status:5},audit_completed_at:null,audit_duration_seconds:null,...extra});
const body=(rows,extra={})=>({schema_version:2,action:'batch',window_id:uid(),batch_id:uid(),platform:'UANG',business:'withdraw',stream:'updated',start_at:'2026-10-01T17:00:00Z',end_exclusive:'2026-10-01T17:10:00Z',observed_at:'2026-10-01T18:00:00Z',rows,...extra});
const meta=d=>d.query(query).then(r=>r.rows[0].evidence);
const call=(d,b)=>d.query('select public.duoli_detail_ingest_v2($1,$2::jsonb) result',[key,JSON.stringify(b)]).then(r=>r.rows[0].result);
const state=async d=>({source:(await d.query('select to_jsonb(d) value from private.duoli_order_details d order by platform,business,source_order_id')).rows,
 receipts:(await d.query('select to_jsonb(b) value from private.duoli_detail_batches_v2 b order by id')).rows,
 progress:(await d.query('select to_jsonb(p) value from private.duoli_detail_progress_v2 p order by platform,business,stream')).rows});
async function db(){const d=new PGlite({extensions:{pgcrypto}});await d.exec(read('fixture.sql'));await d.query('insert into private.duoli_detail_credentials(key_hash,scope)values($1,$2::jsonb)',[
 crypto.createHash('sha256').update(key).digest('hex'),JSON.stringify({system:'DOLI',country:'ID',platforms:['UANG','HOT985','IND666','FB168','FB333']})]);return d;}
async function failure(d,sql,expected){await assert.rejects(d.exec(sql),expected);await d.exec('rollback');}

test('fresh actual metadata equals production; install/replay keeps source receipts and all old contracts',async()=>{
 const d=await db();try{
  assert.deepEqual(await meta(d),expectedBefore);
  await d.exec("set timezone='Europe/Berlin';");
  const b=body([row()]),ack=await call(d,b),before=await state(d);
  await d.exec(install);
  assert.deepEqual(await meta(d),expectedAfter);assert.deepEqual(await state(d),before);
  assert.deepEqual(await call(d,b),{...ack,replayed:true});
  assert.equal((await call(d,{schema_version:2,action:'check'})).source_notes_version,1);
  await d.exec(install);assert.deepEqual(await meta(d),expectedAfter);assert.deepEqual(await state(d),before);
  assert.equal((await d.query('select count(*) n from private.duoli_order_business_notes_v1')).rows[0].n,0);
 }finally{await d.close();}
});

test('rollback/replay preserves captured evidence; re-install after rollback resumes without data changes',async()=>{
 const d=await db();try{
  await d.exec(rollback);assert.deepEqual(await meta(d),expectedBefore);
  await d.exec(install);const b=body([row('synthetic-note',{source_notes:notes()})]);await call(d,b);
  const rows=await state(d),evidence=(await d.query('select to_jsonb(n) value from private.duoli_order_business_notes_v1 n')).rows;
  assert.equal(evidence.length,1);assert.equal(rows.source[0].value.amount_raw,'5000.00');assert.equal(rows.source[0].value.operator,'SyntheticReviewer');
  await d.exec(rollback);await d.exec(rollback);
  assert.equal((await call(d,{schema_version:2,action:'check'})).source_notes_version,undefined);
  assert.deepEqual(await state(d),rows);assert.deepEqual((await d.query('select to_jsonb(n) value from private.duoli_order_business_notes_v1 n')).rows,evidence);
  await d.exec(install);assert.deepEqual(await meta(d),expectedAfter);assert.deepEqual(await state(d),rows);
  assert.deepEqual((await d.query('select to_jsonb(n) value from private.duoli_order_business_notes_v1 n')).rows,evidence);
  for(const role of ['anon','authenticated','service_role']){
   await d.exec('set role '+role);
   await assert.rejects(d.query('select * from private.duoli_order_business_notes_v1'),e=>e.code==='42501');
   await d.exec('reset role');
  }
 }finally{await d.close();}
});

test('full body/meta/layout/partial/overload drifts fail atomically, including after install ACL drift',async()=>{
 const mutations=[
  'alter function public.duoli_detail_ingest_v2(text,jsonb) security invoker',
  'alter function public.duoli_detail_ingest_v2(text,jsonb) stable',
  'alter function public.duoli_detail_ingest_v2(text,jsonb) strict',
  'alter function public.duoli_detail_ingest_v2(text,jsonb) cost 101',
  "alter function public.duoli_detail_ingest_v2(text,jsonb) set work_mem='4MB'",
  'grant execute on function public.duoli_detail_ingest_v2(text,jsonb) to authenticated',
  'alter function private.duoli_detail_timestamp(text) volatile',
  'alter table private.duoli_order_details disable row level security',
  'alter table private.duoli_order_details force row level security',
  'alter table private.duoli_order_details add column unverified_extra text',
  'alter table private.duoli_order_details drop constraint duoli_order_details_country_check',
  'drop index private.duoli_order_details_updated_idx',
  "create function public.duoli_detail_ingest_v2(text,jsonb,boolean)returns jsonb language sql as $$select '{}'::jsonb$$",
  'create table private.duoli_order_business_notes_v1(unverified text)',
  'create function private.duoli_business_notes_valid(jsonb)returns boolean language sql as $$select true$$'
 ];
 for(const sql of mutations){const d=await db();try{
  await d.exec(sql);const before=await meta(d);await failure(d,install,/duoli_notes_metadata_or_partial_drift/);
  assert.deepEqual(await meta(d),before);
 }finally{await d.close();}}
 const d=await db();try{
  await d.exec(install);await d.exec('grant select on private.duoli_order_business_notes_v1 to authenticated');const before=await meta(d);
  await failure(d,install,/duoli_notes_metadata_or_partial_drift/);await failure(d,rollback,/duoli_notes_metadata_or_partial_drift/);
  assert.deepEqual(await meta(d),before);
 }finally{await d.close();}
});

test('postcondition damaged body fully rolls back; non-owner cannot install; hard budget/lock/portable metadata checks',async()=>{
 assert.match(install,/SET LOCAL statement_timeout='3s'/);assert.match(install,/SET LOCAL lock_timeout='1s'/);
 assert.match(install,/ACCESS SHARE MODE NOWAIT/);assert.match(install,/IF v_actual=v_fresh THEN[\s\S]*SHARE ROW EXCLUSIVE MODE NOWAIT/);
 assert.doesNotMatch(rollback,/SHARE ROW EXCLUSIVE MODE NOWAIT/);assert.match(install,/k\.contype<>'n'/);assert.match(install,/a\.attnotnull/);
 assert.ok(install.indexOf('duoli_notes_owner_required')<install.indexOf('LOCK TABLE'));
 const d=await db();try{
  const before=await state(d);const damaged=install.replace("'source_notes_version',1,","'source_notes_version',2,");assert.notEqual(damaged,install);
  await failure(d,damaged,/duoli_notes_postcondition_drift/);assert.deepEqual(await meta(d),expectedBefore);assert.deepEqual(await state(d),before);
  await d.exec('set role service_role');await failure(d,install,e=>e.code==='42501'&&e.message.includes('owner_required'));await d.exec('reset role');
  assert.deepEqual(await meta(d),expectedBefore);assert.deepEqual(await state(d),before);
  await d.exec(install);assert.deepEqual(await meta(d),expectedAfter);
 }finally{await d.close();}
});
