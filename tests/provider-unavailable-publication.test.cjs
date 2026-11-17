const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, scalar } = require('./fixtures/snapshot-capacity-cycle/harness.cjs');
const validate = require('../admin-preview/live-provider-snapshot-shadow.js').validate;

const readSql = name => fs.readFileSync(path.join(__dirname, '../supabase', name), 'utf8');
const migration = readSql('migrations/20261117141156_provider_unavailable_publication.sql');

test('an unavailable kernel only changes an authorized v2 read with neither a head nor a scheduled cutoff', async () => {
  const { db, dates, targets, read, cohort } = await setup();
  try {
    await db.exec(readSql('operations/provider-last-complete.sql'));
    const known = await cohort(dates[2], 1440, { lane: 'closed' });
    const pending = await cohort(dates[4], 1440, { lane: 'closed' });
    await db.query('delete from private.provider_snapshot_heads where job_id = any($1::uuid[])', [pending.jobs]);
    await db.query("update private.provider_snapshot_jobs set status='queued' where id = any($1::uuid[])", [pending.jobs]);
    const readV2 = date => read(date, { version: 2 });
    const readyBefore = await readV2(dates[2]);
    const workBefore = await readV2(dates[4]);
    const missing = await readV2(dates[0]);
    assert.equal(readyBefore.status, 'ready');
    assert.equal(workBefore.status, 'building');
    assert.equal(missing.status, 'missing');
    const metadata = () => scalar(db, `select jsonb_agg(jsonb_build_array(oid,proowner,proacl,proconfig,prosecdef,provolatile) order by oid)
      from pg_proc where oid in ('private.dashboard_admin_live_provider_snapshot(jsonb)'::regprocedure,'private.provider_snapshot_retire_intraday(uuid)'::regprocedure)`);
    const metaBefore = await metadata();
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual(await metadata(), metaBefore);
    assert.deepEqual(await readV2(dates[2]), readyBefore);
    assert.deepEqual(await readV2(dates[4]), workBefore);
    assert.deepEqual(await readV2(dates[0]), missing);
    await db.exec("create or replace function private.provider_snapshot_kernel_contract_current() returns boolean language sql stable set search_path='' as 'select false'");
    const empty = await readV2(dates[0]);
    assert.equal(empty.status, 'unsupported');
    assert.equal(empty.complete, false);
    assert.deepEqual(empty.platforms, []);
    validate(empty, {version:2,startAt:dates[0]+'T00:00:00',endAt:dates[0]+'T23:59:59',platformIds:targets.map(t=>t.id)});
    assert.equal((await read(dates[0])).status, 'missing');
    assert.deepEqual(await readV2(dates[4]), workBefore);
    const stale = await readV2(dates[2]);
    assert.equal(stale.status, 'stale');
    assert.equal(stale.publishedCutoff, readyBefore.publishedCutoff);
    assert.equal(await scalar(db, 'select count(*)::int from private.provider_snapshot_heads where job_id=any($1::uuid[])',[known.jobs]), known.jobs.length);
    await assert.rejects(read(dates[0], { version:2, platformIds:['00000000-0000-4000-8000-000000000001'] }), /platform_denied/);
  } finally {
    await db.close();
  }
});
