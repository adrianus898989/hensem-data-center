// All data and database state are local/synthetic; never contacts production.
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const registration=read('supabase/migrations/20261011104411_ar_91club_submission_covering_indexes.sql');
const preflight=read('supabase/maintenance/ar_91club_submission_covering_preflight.sql');
const applied=read('supabase/maintenance/ar_91club_submission_applied_covering_index.sql');
const paid=read('supabase/maintenance/ar_91club_submission_paid_covering_index.sql');
const baseline=read('tests/fixtures/ar-submission-native-null-production.sql');
const nullPatch=read('supabase/migrations/20261011065859_ar_submission_native_null_members.sql');
const money=read('tests/fixtures/ar-submission-native-null-amount-helper.sql');
// PGlite is PostgreSQL 18.3. Only the explicit PG17 major prerequisite changes
// in this test copy; production guard stays PG17 and all metadata checks execute.
function local(sql){assert.equal(sql.split('/10000<>17').length,2);return sql.replace('/10000<>17','/10000<>18');}
let db;
const info=async()=>(await db.query(`select md5(prosrc) hash,to_jsonb(p)-'prosrc' metadata from pg_proc p
 where oid='private.dashboard_admin_live_submission_analysis(jsonb)'::regprocedure`)).rows[0];
const table=`create table public.ar_collected_orders(
 source_system text not null,country_code text not null,platform text not null,order_kind text not null,
 order_no text not null,member_id text,status text,raw_channel text,
 applied_at timestamp,completed_at timestamp,member_level integer,recharge_count integer,
 channel_type text,money_format_version smallint,amount_local numeric,currency_local text,money_issue_code text,amount numeric(20,2),
 constraint ar_collected_orders_order_no_check check(length(order_no)>=1 and length(order_no)<=160),
 constraint ar_collected_orders_member_id_check check(length(member_id)>=1 and length(member_id)<=80),
 constraint ar_collected_orders_status_check check(length(status)<=160),
 constraint ar_collected_orders_raw_channel_check check(length(raw_channel)<=240),
 constraint ar_collected_orders_pkey primary key(source_system,country_code,platform,order_kind,order_no));
 alter table public.ar_collected_orders enable row level security;
 revoke all on public.ar_collected_orders from public,anon,authenticated;
 grant all on public.ar_collected_orders to service_role;`;
async function install(){await db.exec(applied.replace('create index concurrently','create index'));await db.exec(paid.replace('create index concurrently','create index'));}
async function rejected(sql,pattern){const before=await info();await assert.rejects(()=>db.exec(local(sql)),pattern);await db.exec('rollback');assert.deepEqual(await info(),before);}
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');});
beforeEach(async()=>{
 await db.exec('rollback;drop schema if exists private cascade;drop table if exists public.ar_collected_orders cascade;create schema private;set check_function_bodies=off;');
 await db.exec(table);await db.exec(money);await db.exec(baseline);
 await db.exec(`revoke all on function private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric) from public,anon,authenticated,service_role;
 revoke all on function private.dashboard_admin_live_submission_analysis(jsonb) from public,anon,service_role;
 grant execute on function private.dashboard_admin_live_submission_analysis(jsonb) to authenticated;`);
 await db.exec(nullPatch);assert.equal((await info()).hash,'325c95878225f211b91aed89c7abae86');
});
after(async()=>db?.close());

test('preflight permits missing indexes, registration rejects them, and no maintenance file wraps CONCURRENTLY',async()=>{
 await db.exec(local(preflight));await rejected(registration,/AR91_COVER_INDEX_MISSING/);
 for(const script of [applied,paid]){const sql=script.replace(/^--.*$/gm,'');assert.equal((sql.match(/create index concurrently/gi)||[]).length,1);assert.doesNotMatch(sql,/\bbegin\b|\bif not exists\b/i);}
});
test('exact online definitions register reentrantly without reader changes with function/table permissions unchanged',async()=>{
 const before=await info(),acl=(await db.query("select relacl::text acl from pg_class where oid='public.ar_collected_orders'::regclass")).rows[0].acl;
 await install();await db.exec(local(registration));await db.exec(local(registration));
 const after=await info();assert.equal(after.hash,'325c95878225f211b91aed89c7abae86');assert.deepEqual(after.metadata,before.metadata);
 assert.deepEqual(await info(),after);
 assert.equal((await db.query("select relacl::text acl from pg_class where oid='public.ar_collected_orders'::regclass")).rows[0].acl,acl);
 await db.exec('set role authenticated');await assert.rejects(()=>db.query('select * from public.ar_collected_orders'),/permission denied/);await db.exec('reset role');
});
test('the production prerequisite refuses the different PostgreSQL major before any registration',async()=>{
 await install();await assert.rejects(()=>db.exec(registration),/AR91_COVER_SERVER_LAYOUT_DRIFT/);await db.exec('rollback');assert.equal((await info()).hash,'325c95878225f211b91aed89c7abae86');
});
test('wrong or unvalidated native length bounds and widened fact types fail closed',async()=>{
 for(const change of [
  'alter table ar_collected_orders drop constraint ar_collected_orders_raw_channel_check;alter table ar_collected_orders add constraint ar_collected_orders_raw_channel_check check(length(raw_channel)<=241)',
  'alter table ar_collected_orders drop constraint ar_collected_orders_order_no_check;alter table ar_collected_orders add constraint ar_collected_orders_order_no_check check(length(order_no)>=1 and length(order_no)<=160) not valid',
  'alter table ar_collected_orders alter member_level type bigint'
 ]){
  await db.exec('begin');await db.exec(change);const before=await info();await assert.rejects(()=>db.exec(local(preflight)),/AR91_COVER_(WIDTH_CONSTRAINT|COLUMN)_DRIFT/);await db.exec('rollback');assert.deepEqual(await info(),before);
 }
});
test('source/table ACL, RLS or native PK drift rejects the prerequisite',async()=>{
 for(const change of [
  'grant select on ar_collected_orders to authenticated',
  'alter table ar_collected_orders disable row level security',
  'alter table ar_collected_orders drop constraint ar_collected_orders_pkey;alter table ar_collected_orders add constraint ar_collected_orders_pkey primary key(source_system,country_code,platform,order_kind,order_no) deferrable initially deferred'
 ]){
  await db.exec('begin');await db.exec(change);await assert.rejects(()=>db.exec(local(preflight)),/AR91_COVER_(TABLE_METADATA|NATIVE_PK)_DRIFT/);await db.exec('rollback');
 }
});
test('same-named wrong columns, partial identity, DESC and invalid indexes never count as ready',async()=>{
 for(const index of [
  applied.replace('member_level,recharge_count','recharge_count,member_level'),
  applied.replace("platform='91CLUB'","platform='OTHER-PLATFORM'"),
  applied.replace('(applied_at)','(applied_at desc)'),
  applied+'update pg_index set indisvalid=false where indexrelid=\'public.ar_91club_recharge_applied_cover_idx\'::regclass;'
 ]){
  await db.exec('begin');await db.exec(index.replace('create index concurrently','create index'));await db.exec(paid.replace('create index concurrently','create index'));
  await assert.rejects(()=>db.exec(local(registration)),/AR91_COVER_INDEX_(METADATA|COLUMNS)_DRIFT/);await db.exec('rollback');
 }
});
test('reader body/ACL/settings and installed true-money helper drift leave the reader unchanged',async()=>{
 await install();for(const change of [
  baseline.replace('perform private.dashboard_admin_live_scope();','perform private.dashboard_admin_live_scope(); -- altered'),
  'grant execute on function private.dashboard_admin_live_submission_analysis(jsonb) to public',
  'alter function private.dashboard_admin_live_submission_analysis(jsonb) set jit=on',
  'grant execute on function private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric) to service_role',
  money.replace('SELECT CASE','SELECT CASE /* altered */')
 ]){
  await db.exec('begin');await db.exec(change);const before=await info();await assert.rejects(()=>db.exec(local(registration)),/AR91_COVER_(READER_BASELINE|MONEY_HELPER)_DRIFT/);await db.exec('rollback');assert.equal((await info()).hash,'325c95878225f211b91aed89c7abae86');
  assert(before.hash);
 }
});
