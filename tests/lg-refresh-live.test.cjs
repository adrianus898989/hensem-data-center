// Local empty PGlite, synthetic rows only. No network or collector execution.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { fixture, row } = require('./fixtures/lg-business-notes-harness.cjs');
let H;
before(async () => { H = await fixture(); });
after(async () => H?.db.close());
const notes = (id, text = 'Review completed', extra = {}) => row(id, {
  member_id: 'SYNTHETIC-MEMBER',
  raw: { ...row(id).raw, businessSchemaVersion: 1, remark: text, remarkState: 'present', appRemark: '', appRemarkState: 'empty' },
  ...extra,
});
const controls = async () => {
  const result = {};
  for (const table of ['private.lg_window_cursors', 'private.lg_window_runs', 'private.lg_window_stage',
    'private.lg_window_chunks', 'private.lg_window_dirty_days', 'public.lg_pending_runs',
    'public.lg_pending_chunks', 'public.lg_pending_daily', 'public.lg_pending_snapshot_orders']) {
    result[table] = await H.scalar(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) v from ${table} t`);
  }
  return result;
};
const reports = async () => {
  const result = {};
  for (const table of ['public.lg_success_daily', 'public.auto_withdraw_daily', 'public.withdraw_operator_daily', 'public.third_party_volume']) {
    result[table] = await H.scalar(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) v from ${table} t`);
  }
  return result;
};
const orders = () => H.scalar("select coalesce(jsonb_agg(to_jsonb(t) order by order_no),'[]'::jsonb) v from public.lg_orders t");

test('live notes/member refresh updates existing rows and reports without changing held window lease/cursor or midnight state', async () => H.transaction(async () => {
  const manual = { operator_kind: 'manual', operator_name: 'Review Team' };
  const legacy = row('refresh', manual);
  const paid = row('paid', { status_code: 2, status_text: '成功', status_class: 'success',
    finished_at: '2020-01-02T00:05:00Z', paid_at: '2020-01-02T00:05:00Z', raw: { status: 2 } });
  await H.send('full', [legacy, paid]);
  await H.rpc('window', { ...H.scope, action: 'window_start', stream: 'created', owner_id: crypto.randomUUID(), origin_at: '2020-01-02T00:00:00Z' });
  const before = await controls(), oldReports = await reports();
  assert.equal(before['private.lg_window_cursors'].length, 1);
  const refreshed = notes('refresh', 'Review completed', manual);
  const refreshedPaid = { ...paid, raw: { ...notes('paid').raw, status: 2 }, member_id: 'SYNTHETIC-MEMBER' };
  const run = await H.send('live', [refreshed, refreshedPaid], { observedAt: '2020-01-04T01:00:00Z' });
  assert.equal(run.receipt.status, 'live');
  assert.equal(run.receipt.changed_count, 2);
  assert.equal(run.receipt.source_count, 2);
  const stored = (await orders()).find(x => x.order_no === refreshed.order_no);
  assert.equal(stored.member_id, refreshed.member_id);
  assert.deepEqual(stored.raw, refreshed.raw);
  assert.deepEqual(await controls(), before);
  const newReports = await reports();
  assert.notDeepEqual(newReports, oldReports);
  for (const table of ['public.lg_success_daily', 'public.auto_withdraw_daily', 'public.withdraw_operator_daily', 'public.third_party_volume']) {
    assert.equal(newReports[table].length, oldReports[table].length);
    assert(JSON.stringify(newReports[table]).includes(run.envelope.snapshot_id), `${table} must refer to the refreshed snapshot`);
  }
  assert.equal(await H.scalar("select count(*)::int v from public.lg_sync_runs where status='published'"), 1);
  assert.equal(await H.scalar("select count(*)::int v from public.lg_sync_runs where status='live'"), 1);
}));

test('live replay preserves real begin/chunk hashes and returns exact unchanged finish receipt after lost ACK', async () => H.transaction(async () => {
  const values = [notes('replay')];
  const run = await H.send('live', values);
  assert.equal((await run.replayBegin({})).status, 'live');
  assert.equal((await run.chunk(values)).status, 'unchanged');
  const repeat = await run.finish();
  assert.deepEqual(repeat, { ...run.receipt, status: 'unchanged' });
  await assert.rejects(run.replayBegin({ source_total: 2 }), /LG_INCOMPLETE_SOURCE|LG_SNAPSHOT_CONFLICT/);
  await assert.rejects(run.chunk([notes('replay', 'Different text')]), /LG_CHUNK_CONFLICT/);
  assert.equal((await orders()).length, 1);
}));

test('live count conflict rolls back row/report changes, never deletes omitted existing orders, and remains safely retryable', async () => H.transaction(async () => {
  await H.send('full', [row('kept'), row('omitted')]);
  const beforeOrders = await orders(), beforeReports = await reports(), beforeControls = await controls();
  const run = await H.begin('live', { observedAt: '2020-01-04T01:00:00Z' });
  const values = [notes('kept')];
  await run.chunk(values);
  await assert.rejects(run.finish(), /LG_SOURCE_COUNT_CONFLICT/);
  assert.deepEqual(await orders(), beforeOrders);
  assert.deepEqual(await reports(), beforeReports);
  assert.deepEqual(await controls(), beforeControls);
  assert.equal((await run.replayBegin({})).status, 'collecting');
  assert.equal((await run.chunk(values)).status, 'unchanged');
  await assert.rejects(run.finish(), /LG_SOURCE_COUNT_CONFLICT/);
  assert.equal(await H.scalar('select count(*)::int v from public.lg_order_stage where snapshot_id=$1', [run.envelope.snapshot_id]), 1);
}));

test('older refresh cannot overwrite a newer real-time window observation and does not advance any cursor', async () => H.transaction(async () => {
  await H.send('full', [row('freshness')]);
  const newer = notes('freshness', 'Newer real time observation');
  const window = await H.send('window', [newer], { observedAt: '2020-01-04T02:00:00Z' });
  const beforeOrders = await orders(), beforeControls = await controls(), beforeReports = await reports();
  const refresh = await H.send('live', [notes('freshness', 'Older refresh observation')], { observedAt: '2020-01-04T01:00:00Z' });
  assert.equal(refresh.receipt.status, 'live');
  assert.equal(refresh.receipt.changed_count, 0);
  assert.deepEqual(await orders(), beforeOrders);
  assert.deepEqual(await reports(), beforeReports);
  assert.deepEqual(await controls(), beforeControls);
  await window.release();
}));

test('a superseded live snapshot has an explicit non-success status and cannot claim its older notes were applied', async () => H.transaction(async () => {
  const old = await H.begin('live', { observedAt: '2020-01-04T01:00:00Z' });
  await old.chunk([notes('superseded', 'Old refresh')]);
  await H.send('live', [notes('superseded', 'New refresh')], { observedAt: '2020-01-04T02:00:00Z' });
  const before = await orders();
  assert.equal((await old.finish()).status, 'superseded');
  assert.deepEqual(await orders(), before);
}));
