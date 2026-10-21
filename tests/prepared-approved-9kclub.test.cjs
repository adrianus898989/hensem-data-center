const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const baseline = require('./fixtures/registration-baseline.json');
const install = fs.readFileSync(path.join(__dirname, '../supabase/maintenance/prepared-approved-9kclub.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(__dirname, '../supabase/maintenance/prepared-approved-9kclub.rollback.sql'), 'utf8');
let db;
const val = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.value;
const schedule = () => val('select to_jsonb(s) value from private.prepared_aggregate_schedule s');
const protectedRows = () => val(`select jsonb_build_object('jobs',(select jsonb_agg(to_jsonb(j)order by id)from private.test_preserved_jobs j),'heads',(select jsonb_agg(to_jsonb(h)order by id)from private.test_preserved_heads h),'published',(select jsonb_agg(to_jsonb(p)order by id)from private.test_preserved_published p)) value`);
async function reject(sql, pattern) { await assert.rejects(db.exec(sql), pattern); await db.exec('rollback;reset role;'); }
test.before(async () => {
 db = new PGlite(); await db.waitReady;
 await db.exec(`create schema private; create role authenticated;
 create table private.prepared_aggregate_schedule(singleton boolean primary key,enabled boolean,cursor_id uuid,cursor_tier integer,approved_targets jsonb,current_interval_seconds integer);
 create table private.test_native_catalog(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text);
 create function private.prepared_aggregate_native_catalog()returns setof private.test_native_catalog language sql stable set search_path=''as $$select *from private.test_native_catalog$$;
 create table private.test_preserved_jobs(id integer primary key,status text,attempts integer,revision integer,fence integer,lease_until timestamptz);
 create table private.test_preserved_heads(id integer primary key,payload jsonb,computed_at timestamptz,expires_at timestamptz,source_complete boolean);
 create table private.test_preserved_published(id integer primary key,enabled boolean,target jsonb);
 create function private.reject_unrelated_write()returns trigger language plpgsql as $$begin raise exception'unrelated_write';end;$$;
 create trigger reject_job_write before update or delete on private.test_preserved_jobs for each statement execute function private.reject_unrelated_write();
 create trigger reject_head_write before update or delete on private.test_preserved_heads for each statement execute function private.reject_unrelated_write();
 create trigger reject_published_write before update or delete on private.test_preserved_published for each statement execute function private.reject_unrelated_write();`);
});
test.beforeEach(async () => {
 await db.exec('rollback;reset role;truncate private.prepared_aggregate_schedule,private.test_native_catalog,private.test_preserved_jobs,private.test_preserved_heads,private.test_preserved_published');
 await db.query('insert into private.prepared_aggregate_schedule select *from jsonb_populate_record(null::private.prepared_aggregate_schedule,$1)',[JSON.stringify(baseline.schedule)]);
 for(const t of [...baseline.schedule.approved_targets,baseline.new_target])await db.query('insert into private.test_native_catalog select *from jsonb_populate_record(null::private.test_native_catalog,$1)',[JSON.stringify(t)]);
 await db.exec(`insert into private.test_preserved_jobs values(1,'failed',3,7,9,null),(2,'running',2,8,10,'2026-10-22T00:00Z'),(3,'ready',0,2,4,null);
 insert into private.test_preserved_heads values(1,'{"count":123,"unknown":null}','2026-10-21T10:00Z','2026-10-21T10:10Z',false);
 insert into private.test_preserved_published select n,true,jsonb_build_object('existing',n)from generate_series(1,18)n;`);
});
test.after(async () => { await db?.close(); });
test('adds only exact 9KCLUB to 101-target manifest and preserves cursor/cadence/state/publications',async () => {
 const before=await schedule(),protectedBefore=await protectedRows();await db.exec(install);const after=await schedule();
 assert.deepEqual(after.approved_targets,[...before.approved_targets,baseline.new_target]);
 assert.deepEqual({...after,approved_targets:null},{...before,approved_targets:null});assert.deepEqual(await protectedRows(),protectedBefore);
 assert.equal(await val('select md5(approved_targets::text)value from private.prepared_aggregate_schedule'),baseline.proposed_md5);
});
test('rollback restores only original membership while preserving current schedule cursor and all old heads/budgets',async () => {
 await db.exec(install);await db.exec("update private.prepared_aggregate_schedule set cursor_id='00000000-0000-4000-8000-000000000123',cursor_tier=3,current_interval_seconds=1800");
 const before=await schedule(),protectedBefore=await protectedRows();await db.exec(rollback);const after=await schedule();
 assert.deepEqual(after.approved_targets,baseline.schedule.approved_targets);assert.deepEqual({...after,approved_targets:null},{...before,approved_targets:null});assert.deepEqual(await protectedRows(),protectedBefore);
});
test('native 9K team mismatch rejects with zero schedule writes',async () => {await db.exec("update private.test_native_catalog set team='OTHER'where name='9KCLUB'");const before=await schedule();await reject(install,/prepared_9k_native_drift/);assert.deepEqual(await schedule(),before);});
test('native 9K missing or duplicate is fail closed',async () => {await db.exec("delete from private.test_native_catalog where name='9KCLUB'");const before=await schedule();await reject(install,/query returned no rows/);assert.deepEqual(await schedule(),before);await db.query('insert into private.test_native_catalog select *from jsonb_populate_record(null::private.test_native_catalog,$1)',[JSON.stringify(baseline.new_target)]);await db.exec("insert into private.test_native_catalog select *from private.test_native_catalog where name='9KCLUB'");await reject(install,/query returned more than one row/);assert.deepEqual(await schedule(),before);});
test('unrelated manifest drift rejects rather than overwrites concurrent ownership change',async () => {await db.exec("update private.prepared_aggregate_schedule set approved_targets=jsonb_set(approved_targets,'{0,team}','\"OTHER\"')");const before=await schedule();await reject(install,/prepared_9k_manifest_drift/);assert.deepEqual(await schedule(),before);});
test('another approved native target drifting rejects entire proposal',async () => {await db.exec("update private.test_native_catalog set currency='BAD'where id=(select(approved_targets->0->>'id')::uuid from private.prepared_aggregate_schedule)");const before=await schedule();await reject(install,/prepared_9k_unresolved_native_drift/);assert.deepEqual(await schedule(),before);});
test('repeat install rejects without duplicates or resetting jobs',async () => {await db.exec(install);const before=await schedule(),protectedBefore=await protectedRows();await reject(install,/prepared_9k_manifest_drift/);assert.deepEqual(await schedule(),before);assert.deepEqual(await protectedRows(),protectedBefore);});
test('disabled existing schedule remains disabled after membership update',async () => {await db.exec('update private.prepared_aggregate_schedule set enabled=false');await db.exec(install);assert.equal((await schedule()).enabled,false);});
test('rollback refuses later manifest changes and preserves them',async () => {await db.exec(install);await db.exec("update private.prepared_aggregate_schedule set approved_targets=jsonb_set(approved_targets,'{0,team}','\"NEW\"')");const before=await schedule();await reject(rollback,/prepared_9k_rollback_manifest_drift/);assert.deepEqual(await schedule(),before);});
test('non-owner role cannot install or rollback even with table grants',async () => {await db.exec('grant usage on schema private to authenticated;grant all on all tables in schema private to authenticated;set role authenticated');await reject(install,/prepared_9k_owner_only/);await db.exec(install);await db.exec('set role authenticated');await reject(rollback,/prepared_9k_rollback_owner_only/);assert.equal((await schedule()).approved_targets.length,102);});
