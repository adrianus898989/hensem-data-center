// Execute actual WG migration in an isolated in-memory PostgreSQL engine.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { PGlite } = require(process.env.PGLITE_PATH || '/private/tmp/withdraw-reasons-pgtest.IJmGCl/node_modules/.pnpm/@electric-sql+pglite@0.5.8/node_modules/@electric-sql/pglite');
const { snapshot: sourceSnapshot, contract } = require('./wg-config-receiver.test.cjs');
const db = new PGlite();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const TOKEN = 'a'.repeat(64);
let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const snapshot = (patch = {}) => sourceSnapshot({ snapshot_id: randomUUID(), ...patch });
const ingest = (value, token = TOKEN, hashOverride) => scalar('select public.ingest_wg_config($1::jsonb,$2,$3,$4)',
  [JSON.stringify(value), hash(value.configuration), hashOverride || hash(value), token]);
const reject = async (action, label, pattern) => { await assert.rejects(action, pattern, label); checks++; };
async function main() {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges grant all on tables to service_role;
    create function public.dashboard_has_permission(text) returns boolean language sql stable as $$
      select coalesce(current_setting('offline.wg_permission',true),'false')='true' $$;
    create table public.existing_withdraw_sentinel(value text);insert into public.existing_withdraw_sentinel values('unchanged');`);
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260912064107_wg_auto_withdraw_config.sql'), 'utf8'));
  eq(await scalar('select value from public.existing_withdraw_sentinel'), 'unchanged', 'Old business sentinel unchanged by migration');
  eq(await scalar('select count(*)::int from public.wg_config_targets'), 2, 'Exactly two registered login groups');
  eq(await scalar("select site_code from public.wg_config_targets where country_code='BR'"), '278', 'BR parent binding');
  eq(await scalar("select members->2->>'site_code' from public.wg_config_targets where country_code='BR'"), '12588', 'Independent config POPMIU mapping');
  await db.exec(`insert into public.wg_config_credentials(token_hash,allowed_targets,expires_at) values
    (repeat('a',64),array['BR:26BET','VN:98VV'],now()+interval '1 day'),
    (repeat('b',64),array['VN:98VV'],now()+interval '1 day'),
    (repeat('c',64),array['BR:26BET'],now()-interval '1 day');
    insert into public.wg_config_credentials(token_hash,allowed_targets,expires_at,active) values
    (repeat('d',64),array['BR:26BET'],now()+interval '1 day',false);`);
  const tables = ['wg_config_targets', 'wg_config_credentials', 'wg_config_daily', 'wg_config_receipts'];
  for (const table of tables) {
    eq(await scalar('select relrowsecurity from pg_class where oid=$1::regclass', ['public.' + table]), true, table + ' RLS enabled');
    for (const role of ['anon', 'authenticated']) for (const operation of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
      eq(await scalar('select has_table_privilege($1,$2,$3)', [role, 'public.' + table, operation]), false, role + ' cannot ' + operation + ' ' + table);
    for (const operation of ['UPDATE', 'DELETE', 'TRUNCATE'])
      eq(await scalar('select has_table_privilege($1,$2,$3)', ['service_role', 'public.' + table, operation]), false, 'Service cannot ' + operation + ' ' + table);
  }
  for (const table of ['wg_config_credentials', 'wg_config_receipts']) for (const role of ['anon', 'authenticated'])
    eq(await scalar('select has_table_privilege($1,$2,$3)', [role, 'public.' + table, 'SELECT']), false, 'Browser cannot read private tables');
  for (const table of ['wg_config_targets', 'wg_config_credentials'])
    eq(await scalar('select has_table_privilege($1,$2,$3)', ['service_role', 'public.' + table, 'INSERT']), false, 'Service cannot create its own permission binding');
  eq(await scalar("select reloptions @> array['security_invoker=true'] from pg_class where oid='public.wg_config_latest'::regclass"), true, 'Latest honors RLS');
  eq(await scalar("select prosecdef from pg_proc where oid='public.ingest_wg_config(jsonb,text,text,text)'::regprocedure"), false, 'RPC security invoker');
  for (const role of ['anon', 'authenticated'])
    eq(await scalar('select has_function_privilege($1,$2,$3)', [role, 'public.ingest_wg_config(jsonb,text,text,text)', 'EXECUTE']), false, 'No browser RPC');
  const definition = await scalar("select pg_get_functiondef('public.ingest_wg_config(jsonb,text,text,text)'::regprocedure)");
  eq((definition.match(/pg_advisory_xact_lock/g) || []).length, 2, 'Transaction locks cover UUID and group/day scopes');
  await db.exec('set role service_role');
  const first = snapshot(); contract.validateWGConfigSnapshot(first, new Date('2026-09-12T12:00:00Z'));
  const firstReceipt = await ingest(first);
  eq(firstReceipt.status, 'accepted', 'First full configuration accepted');
  eq(firstReceipt.current_snapshot_id, first.snapshot_id, 'Current ID is stored ID');
  eq((await ingest(first)).status, 'unchanged', 'Exact retry idempotent');
  const later = snapshot({ observed_at: '2026-09-10T11:00:00Z' }); later.configuration.settings['278'].exemptSwitch = 0;
  const laterReceipt = await ingest(later);
  eq(laterReceipt.status, 'daily_exists', 'Second successful local-day capture cannot replace first');
  eq(laterReceipt.current_snapshot_id, first.snapshot_id, 'Same-day receipt points to true first capture');
  const lostAckReplay = await ingest(later);
  eq(lostAckReplay.status, 'daily_exists', 'Lost daily_exists ACK replay retains current-day status');
  eq(lostAckReplay.snapshot_id, later.snapshot_id, 'Lost ACK replay binds submitted UUID');
  eq(lostAckReplay.current_snapshot_id, first.snapshot_id, 'Lost ACK replay identifies actual stored UUID');
  eq(await scalar("select (configuration->'settings'->'278'->>'exemptSwitch')::int from public.wg_config_daily"), 1, 'First day data never overwritten');
  const modified = structuredClone(first); modified.configuration.settings['0'].registerTime = 7;
  await reject(() => ingest(modified), 'Same UUID/different body hash conflicts', /wg_config_snapshot_id_conflict/);
  eq(await scalar('select count(*)::int from public.wg_config_receipts'), 2, 'Identity conflict leaves receipts unchanged');
  const next = snapshot({ observed_at: '2026-09-11T03:00:00Z', observed_local_date: '2026-09-11' });
  eq((await ingest(next)).status, 'accepted', 'Next local day accepted at Brazil midnight');
  const beforeMidnight = snapshot({ observed_at: '2026-09-11T02:59:59Z', observed_local_date: '2026-09-10' });
  eq((await ingest(beforeMidnight)).status, 'daily_exists', 'Before midnight remains previous local day');
  const old = snapshot({ observed_at: '2026-09-09T08:00:00Z', observed_local_date: '2026-09-09' });
  eq((await ingest(old)).status, 'accepted', 'Late upload older day allowed');
  eq(await scalar('select snapshot_id::text from public.wg_config_latest'), next.snapshot_id, 'Latest uses observation time not arrival');
  const before = await scalar('select count(*)::int from public.wg_config_receipts');
  for (const token of [null, 'x'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)])
    await reject(() => ingest(snapshot(), token), 'Unknown/unscoped/expired/revoked credential rejected', /wg_config_unauthorized/);
  for (const patch of [{ timezone: 'UTC' }, { site_code: '99999' }, { observed_local_date: '2026-09-11' },
    { source_system: 'PANDA' }, { schema_version: 2 }, { parser_version: 'wrong' }, { platform: 'OTHER' }])
    await reject(() => ingest(snapshot(patch)), 'Invalid metadata rejected');
  const missingMember = snapshot(); delete missingMember.configuration.settings['8311'];
  await reject(() => ingest(missingMember), 'Missing registered member rejected', /wg_config_members_mismatch/);
  const extraMember = snapshot(); extraMember.configuration.settings['99999'] = {};
  await reject(() => ingest(extraMember), 'Extra unregistered member rejected', /wg_config_members_mismatch/);
  for (const invalidHash of [null, 'x', 'g'.repeat(64)])
    await reject(() => scalar('select public.ingest_wg_config($1::jsonb,$2,$3,$4)', [JSON.stringify(snapshot()), invalidHash, hash(first), TOKEN]), 'Hash format is required');
  eq(await scalar('select count(*)::int from public.wg_config_receipts'), before, 'Rejected metadata/auth/hash operations are atomic');
  // PGlite serializes commands on one connection; this checks queued-call outcomes,
  // not a claim of real multi-session contention coverage.
  const queued = [1, 2, 3].map(() => snapshot({ observed_at: '2026-09-08T08:00:00Z', observed_local_date: '2026-09-08' }));
  const queuedResults = await Promise.all(queued.map(value => ingest(value)));
  eq(queuedResults.filter(row => row.status === 'accepted').length, 1, 'Queued same-day requests store exactly one capture');
  eq(queuedResults.filter(row => row.status === 'daily_exists').length, 2, 'Other queued requests get daily_exists');
  const rolledBack = snapshot({ observed_at: '2026-09-07T08:00:00Z', observed_local_date: '2026-09-07' });
  await db.exec('begin'); eq((await ingest(rolledBack)).status, 'accepted', 'Transaction accepts before rollback'); await db.exec('rollback');
  eq(await scalar('select count(*)::int from public.wg_config_receipts where snapshot_id=$1', [rolledBack.snapshot_id]), 0, 'Rollback removes receipt');
  eq(await scalar("select count(*)::int from public.wg_config_daily where observed_local_date='2026-09-07'"), 0, 'Rollback removes daily row');
  for (const table of ['wg_config_daily', 'wg_config_receipts']) {
    await reject(() => db.query('delete from public.' + table), 'Service delete prohibited');
    await reject(() => db.query('update public.' + table + ' set snapshot_hash=repeat(\'b\',64)'), 'Service overwrite prohibited');
  }
  await db.exec('reset role; set role authenticated; set offline.wg_permission=false');
  eq(await scalar('select count(*)::int from public.wg_config_daily'), 0, 'Unauthorized authenticated user sees no config');
  eq(await scalar('select count(*)::int from public.wg_config_latest'), 0, 'View does not bypass policy');
  eq(await scalar('select count(*)::int from public.wg_config_targets'), 0, 'Targets also permission protected');
  await db.exec('set offline.wg_permission=true');
  eq(await scalar('select count(*)::int from public.wg_config_latest'), 1, 'Authorized viewer sees latest login group');
  eq(await scalar('select count(*)::int from public.wg_config_targets'), 2, 'Authorized viewer sees registered groups');
  await reject(() => db.query('select * from public.wg_config_credentials'), 'Browser cannot read credentials');
  await reject(() => ingest(snapshot()), 'Browser cannot execute RPC');
  await db.exec('reset role;set role anon');
  for (const table of [...tables, 'wg_config_latest']) await reject(() => db.query('select * from public.' + table), 'Anonymous reads denied');
  await db.exec('reset role');
  eq(await scalar('select value from public.existing_withdraw_sentinel'), 'unchanged', 'Old business remains untouched after tests');
  console.log(JSON.stringify({ checks, passed: true, inMemoryPostgres: true, realNetwork: false, liveWrites: false }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.close());
