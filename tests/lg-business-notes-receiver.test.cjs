// No collector import, network, production orders or production credentials.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, row } = require('./fixtures/lg-business-notes-harness.cjs');
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261012132942_lg_business_notes_receiver.sql'), 'utf8');
const paths = ['live', 'callback', 'window'];
const privateRejection = /LG_INVALID_(?:PRIVATE_FIELDS|BUSINESS_[A-Z_]+|ORDER)/;
const businessRaw = (extra = {}) => ({
  ...row('raw').raw, businessSchemaVersion: 1,
  remark: 'Balance review required', remarkState: 'present',
  appRemark: '', appRemarkState: 'missing', ...extra,
});
const noted = (id, rawExtra = {}, extra = {}) => row(id, { raw: businessRaw(rawExtra), ...extra });
let H;
before(async () => { assert(migration.trim(), 'receiver migration must exist'); H = await fixture(); });
after(async () => H?.db.close());
const stored = id => H.scalar('select to_jsonb(o) v from public.lg_orders o where order_no=$1', [row(id).order_no]);
const forPaths = async fn => { for (const kind of paths) await H.transaction(() => fn(kind)); };

test('all three real receivers still accept legacy scalar raw and retain exact replay/hash-conflict behavior', async () => forPaths(async kind => {
  const legacy = row(kind), run = await H.begin(kind);
  assert.equal((await run.chunk([legacy])).status, 'accepted');
  assert.equal((await run.chunk([legacy])).status, 'unchanged');
  await assert.rejects(run.chunk([row('different')]), /LG_CHUNK_CONFLICT/);
  await assert.rejects(run.replayBegin({ source_total: 2, fetched_count: 2, expected_count: 2 }), /LG_SNAPSHOT_CONFLICT/);
  const ack = await run.finish(), replay = await run.finish();
  assert.equal(ack.order_count, 1); assert.equal(ack.changed_count, 1);
  assert.equal(replay.status, kind === 'window' ? 'committed' : 'unchanged');
  assert.deepEqual({ ...replay, status: ack.status }, ack);
  assert.deepEqual((await stored(kind)).raw, legacy.raw);
  assert.equal(await H.scalar('select count(*)::int v from public.lg_orders'), 1);
}));

test('schema 1 preserves both notes and every explicit empty/missing/redacted state through real finish paths', async () => forPaths(async kind => {
  const notes = [
    noted('present', { appRemark: 'Additional review completed', appRemarkState: 'present' }),
    noted('empty', { remark: '', remarkState: 'empty', appRemark: '', appRemarkState: 'empty' }),
    noted('missing', { remark: '', remarkState: 'missing' }),
    noted('redacted', { remark: '[已隐藏]', remarkState: 'redacted', appRemark: '[已隐藏]', appRemarkState: 'redacted' }),
  ];
  const run = await H.send(kind, notes);
  assert.equal(run.receipt.order_count, notes.length);
  assert.doesNotMatch(JSON.stringify(run.receipt), /Balance review|Additional review|remarkState|appRemark|synthetic_member/);
  for (const [index, id] of ['present', 'empty', 'missing', 'redacted'].entries()) assert.deepEqual((await stored(id)).raw, notes[index].raw);
  assert.equal(await H.scalar('select count(*)::int v from public.lg_orders'), 4);
  assert.equal((await run.chunk(notes)).status, 'unchanged');
  await assert.rejects(run.chunk([noted('changed'), ...notes.slice(1)]), /LG_CHUNK_CONFLICT/);
}));

test('window callback uses the same business validation and retains its half-open callback-time proof', async () => H.transaction(async () => {
  const run = await H.begin('window', { stream: 'callback' });
  await assert.rejects(run.chunk([noted('callback-end', { callbackTime: run.envelope.end_at })]), /LG_INVALID_CALLBACK_TIME/);
  await assert.rejects(run.chunk([noted('callback-private', { remark: 'phone: +5511999988888' })]), privateRejection);
  const order = noted('callback-window');
  assert.equal((await run.chunk([order])).status, 'accepted');
  const ack = await run.finish(); assert.equal(ack.order_count, 1); assert.equal(ack.creation_day_complete, false);
  assert.deepEqual((await stored('callback-window')).raw, order.raw);
}));

test('new observations that change only raw notes update one existing order without changing typed business values', async () => forPaths(async kind => {
  const first = await H.send(kind, [row('same')]); await first.release();
  const old = await stored('same');
  const options = { observedAt: '2020-01-04T01:00:00Z', ...(kind === 'window' ? { extra: { purpose: 'recheck', start_at: '2020-01-02T00:00:00Z' } } : {}) };
  const updated = noted('same'), second = await H.send(kind, [updated], options); await second.release();
  const current = await stored('same');
  assert.equal(second.receipt.changed_count, 1); assert.equal(await H.scalar('select count(*)::int v from public.lg_orders'), 1);
  assert.deepEqual(current.raw, updated.raw);
  for (const key of ['raw', 'snapshot_id', 'observed_at', 'updated_at']) { delete old[key]; delete current[key]; }
  assert.deepEqual(current, old);
  const identical = await H.send(kind, [updated], { ...options, observedAt: '2020-01-04T02:00:00Z' });
  assert.equal(identical.receipt.changed_count, 0);
  assert.equal(Date.parse((await stored('same')).observed_at), Date.parse('2020-01-04T02:00:00Z'));
}));

test('schema 1 permits the bounded source business fields, signed amounts, stable member ID and safe groups', async () => forPaths(async kind => {
  const extra = {
    beforeRechargeWithdrawDiff: '-20.25', currentProfitAmount: '0.00', rechargeWithdrawDiff: '99.50',
    firstFlag: 0, successNo: 1, totalOrderNum: 2, lockType: 0,
    appCode: 'TEST', appName: 'Test application', transactionId: 'T-TXN',
    withdrawBankAppName: 'Test bank route', withdrawChannelName: 'TEST', withdrawMethodName: 'TEST',
    withdrawThirdName: 'TEST', withdrawTypeCode: 'TEST', withdrawTypeName: 'TEST',
    rechargeChannelName: 'TEST', rechargeMethodName: 'TEST', rechargeThirdName: 'TEST', rechargeTypeName: 'TEST',
    thirdMethodName: 'TEST', operatorName: 'system', lockOperatorName: 'system',
    groupList: [{ groupId: 1, groupName: 'Review group', colorTag: '#aBc' }, { groupName: '[已隐藏]', colorTag: 'blue' }], groupListTruncated: true,
  };
  const order = noted('extras', extra, { member_id: 'synthetic_member-1' });
  assert.equal((await H.send(kind, [order])).receipt.changed_count, 1);
  const got = await stored('extras'); assert.deepEqual(got.raw, order.raw); assert.equal(got.member_id, order.member_id);
}));

test('the full 12000-character note, midnight business dates and stable transaction IDs survive without receiver mutation', async () => forPaths(async kind => {
  const note = 'Review '.repeat(1714) + 'OK'; assert.equal(note.length, 12000);
  const dates = 'Review at 2026-10-12 00:00:00 and 2026/10/12 00:00; next 2026.10.13 00:00:00Z';
  const order = noted('full-text', { remark: note, appRemark: dates, appRemarkState: 'present', transactionId: '12345678901234567890' });
  await H.send(kind, [order]); const got = await stored('full-text');
  assert.equal(got.raw.remark, note); assert.equal(got.raw.remark.length, 12000);
  assert.equal(got.raw.appRemark, dates); assert.equal(got.raw.transactionId, order.raw.transactionId);
}));

test('real member IDs can fill an old null, legacy null never erases them, and stale observations cannot replace them', async () => forPaths(async kind => {
  const options = hour => ({ observedAt: `2020-01-04T${hour}:00:00Z`, ...(kind === 'window' ? { extra: { purpose: 'recheck', start_at: '2020-01-02T00:00:00Z' } } : {}) });
  const first = await H.send(kind, [noted('member')]); await first.release();
  assert.equal((await stored('member')).member_id, null);
  // This differs only in member_id; raw and every other business field are equal.
  const second = await H.send(kind, [noted('member', {}, { member_id: 'synthetic_member-1' })], options('01')); await second.release();
  assert.equal(second.receipt.changed_count, 1); assert.equal((await stored('member')).member_id, 'synthetic_member-1');
  const legacy = await H.send(kind, [row('member')], options('02')); await legacy.release();
  assert.equal((await stored('member')).member_id, 'synthetic_member-1');
  assert.deepEqual((await stored('member')).raw, row('member').raw, 'legacy raw replaces old notes instead of attributing stale notes to a new observation');
  const current = await stored('member');
  const stale = await H.send(kind, [noted('member', { remark: 'Stale note' }, { member_id: 'synthetic_stale-member' })], options('01')); await stale.release();
  assert.deepEqual(await stored('member'), current);
  if (kind === 'live') assert.equal(stale.receipt.status, 'superseded'); else assert.equal(stale.receipt.stale_count, 1);
}));

test('private keys, unapproved nested values and malformed business states reject atomically on every path', async () => forPaths(async kind => {
  const run = await H.begin(kind);
  const bad = [
    { phone: 'SYNTHETIC-PRIVATE' }, { raw_payload: { private: 'SYNTHETIC-PRIVATE' } }, { status: { nested: true } },
    { businessSchemaVersion: 2 }, { businessSchemaVersion: '1' },
    { remarkState: 'unknown' }, { remarkState: 'present', remark: '' }, { remarkState: 'present', remark: '[已隐藏]' },
    { remarkState: 'empty', remark: 'nonempty' }, { remarkState: 'missing', remark: 'nonempty' },
    { remarkState: 'redacted', remark: 'nonempty' }, { remark: null }, { appRemark: [] },
    { remark: 'a'.repeat(12001) }, { currentProfitAmount: {} }, { firstFlag: true },
    { appName: { nested: true } }, { transactionId: 'a'.repeat(201) }, { operatorName: 'a'.repeat(501) },
    { groupList: { groupId: 1 } }, { groupList: [{ groupId: 1, phone: 'SYNTHETIC-PRIVATE' }] },
    { groupList: [{ groupName: { nested: true } }] }, { groupList: [{ groupId: 1.5 }] },
    { groupList: [{ colorTag: 'url(secret)' }] }, { groupList: Array.from({ length: 101 }, () => ({ groupId: 1 })) },
    { groupListTruncated: false },
  ];
  for (const rawExtra of bad) await assert.rejects(run.chunk([noted('invalid', rawExtra)]), privateRejection, Object.keys(rawExtra).join(','));
  for (const extra of [{ account: 'SYNTHETIC-PRIVATE' }, { member_id: 'not a stable ID' }, { member_id: 'a'.repeat(129) }, { member_id: 123 }]) await assert.rejects(run.chunk([noted('invalid', {}, extra)]), privateRejection, kind + ':' + Object.keys(extra).join(','));
  for (const key of ['remark', 'appRemark', 'remarkState', 'appRemarkState']) { const missing = noted('missing-key'); delete missing.raw[key]; await assert.rejects(run.chunk([missing]), privateRejection); }
  assert.equal(await H.scalar('select count(*)::int v from public.lg_orders'), 0);
  assert.equal(await H.scalar('select count(*)::int v from public.lg_order_stage'), 0);
  assert.equal(await H.scalar('select count(*)::int v from private.lg_window_stage'), 0);
  assert.equal((await run.chunk([noted('valid-after-rejection')])).status, 'accepted');
  assert.equal((await run.finish()).order_count, 1);
}));

test('unsanitized free text is refused in either note, business labels and group names', async () => forPaths(async kind => {
  const run = await H.begin(kind);
  const privateText = ['phone: +5511999988888', 'email: synthetic@example.invalid', 'token: SYNTHETIC-SECRET', 'https://example.invalid/private', '123.456.789-01', '姓名：合成姓名'];
  for (const text of privateText) for (const rawExtra of [
    { remark: text }, { appRemark: text, appRemarkState: 'present' }, { appName: text }, { groupList: [{ groupName: text }] },
  ]) await assert.rejects(run.chunk([noted('private', rawExtra)]), privateRejection);
  assert.equal(await H.scalar('select count(*)::int v from public.lg_orders'), 0);
}));

test('new business raw does not relax existing status, operator, callback clock or scope checks', async () => forPaths(async kind => {
  const run = await H.begin(kind);
  await assert.rejects(run.chunk([noted('status', {}, { status_class: 'success' })]), /LG_INVALID_STATUS/);
  await assert.rejects(run.chunk([noted('operator', {}, { operator_kind: 'manual' })]), /LG_INVALID_OPERATOR/);
  if (kind === 'callback') await assert.rejects(run.chunk([noted('clock', { callbackTime: null })]), /LG_INVALID_CALLBACK_TIME/);
  if (kind === 'window') await assert.rejects(run.chunk([noted('exclusive-end', {}, { created_at: run.envelope.end_at })]), /LG_ORDER_OUTSIDE_WINDOW/);
  await assert.rejects(H.rpc(kind, { ...run.envelope, action: kind === 'window' ? 'window_chunk' : kind === 'callback' ? 'callback_chunk' : 'chunk', chunk_index: 0, orders: [noted('scope')], platform: 'LGPARTY' }), /LG_SCOPE_DENIED/);
  assert.equal(await H.scalar('select count(*)::int v from public.lg_orders'), 0);
}));

test('legacy full mode stays compatible, while schema 1 is validated in full mode too', async () => H.transaction(async () => {
  const legacy = row('legacy-full', { member_id: 'SYNTHETIC-LEGACY', raw: { legacy_only: { synthetic: true } } });
  assert.equal((await H.send('full', [legacy])).receipt.changed_count, 1);
  const run = await H.begin('full', { observedAt: '2020-01-04T01:00:00Z' });
  await assert.rejects(run.chunk([noted('full-private', { account: 'SYNTHETIC-PRIVATE' })]), privateRejection);
  await assert.rejects(run.chunk([noted('full-private-top', {}, { account: 'SYNTHETIC-PRIVATE' })]), privateRejection);
  await run.chunk([noted('full-valid')]); assert.equal((await run.finish()).order_count, 1);
}));

test('receiver identities/OIDs/security metadata remain unchanged and helper execution stays service-only', async () => {
  assert.deepEqual(await H.metadata(), H.beforeMetadata);
  for (const signature of [...H.signatures, 'private.lg_business_note_safe(text)', 'private.lg_validate_business_raw(jsonb)']) {
    for (const role of ['anon', 'authenticated']) assert.equal(await H.scalar("select has_function_privilege($1,$2,'EXECUTE') v", [role, signature]), false);
    assert.equal(await H.scalar("select has_function_privilege('service_role',$1,'EXECUTE') v", [signature]), true);
    assert.equal(await H.scalar('select prosecdef v from pg_proc where oid=$1::regprocedure', [signature]), false);
  }
});

test('the four production bodies change only their explicit raw/member validation blocks and member-preserving merge expressions', async () => {
  const current = await H.definitions();
  const replaceOnce = (value, from, to) => {
    assert.equal(value.split(from).length - 1, 1, 'exactly one intended merge anchor');
    return value.replace(from, to);
  };
  for (const signature of H.signatures) {
    const original = H.beforeDefinitions[signature]; let actual = current[signature];
    if (signature.startsWith('public.lg_window_ingest(')) {
      actual = replaceOnce(actual, 'member_id=coalesce(excluded.member_id,lg_orders.member_id), -- A legacy null must not erase a known source member.', 'member_id=lg_orders.member_id, -- privacy-minimized window must not erase an old member association.');
      actual = replaceOnce(actual, 'and row(lg_orders.member_id,lg_orders.status_code,', 'and row(lg_orders.status_code,');
      actual = replaceOnce(actual, 'is distinct from row(coalesce(excluded.member_id,lg_orders.member_id),excluded.status_code,', 'is distinct from row(excluded.status_code,');
    } else {
      // Scope/auth/count/hash/state/financial/clock/report logic is outside this
      // tightly delimited privacy region and must remain byte-for-byte identical.
      const marker = "then raise exception 'LG_INVALID_ORDER'; end if;\n";
      const tail = "   foreach f in array array['order_no','status_text','operator_name'";
      const oldStart = original.indexOf(marker) + marker.length, newStart = actual.indexOf(marker) + marker.length;
      const oldEnd = original.indexOf(tail, oldStart), newEnd = actual.indexOf(tail, newStart);
      assert(oldStart >= marker.length && newStart >= marker.length && oldEnd > oldStart && newEnd > newStart);
      assert.match(actual.slice(newStart, newEnd), /perform private\.lg_validate_business_raw\(r->'raw'\)/);
      actual = actual.slice(0, newStart) + original.slice(oldStart, oldEnd) + actual.slice(newEnd);
      if (!signature.startsWith('private.lg_window_validate_order(')) {
        actual = replaceOnce(actual, 'member_id=coalesce(excluded.member_id,lg_orders.member_id),', 'member_id=excluded.member_id,');
        actual = replaceOnce(actual, 'is distinct from row(coalesce(excluded.member_id,lg_orders.member_id),', 'is distinct from row(excluded.member_id,');
      }
    }
    assert.equal(actual, original, signature + ' has no unrelated body changes');
  }
});

test('body, ACL or configuration drift in any guarded receiver refuses atomically before helper creation', async () => H.transaction(async () => {
  for (const sql of Object.values(H.beforeDefinitions)) await H.db.exec(sql);
  await H.db.exec('drop function private.lg_validate_business_raw(jsonb);drop function private.lg_business_note_safe(text);');
  const guarded = migration.replace(/^begin;\s*$/m, '').replace(/^commit;\s*$/m, '');
  for (const signature of H.signatures) for (const drift of ['body', 'acl', 'configuration']) {
    await H.db.exec('savepoint drift');
    try {
      if (drift === 'body') {
        const changed = H.beforeDefinitions[signature].replace(/\$function\$\s*;?\s*$/, '\n-- synthetic definition drift\n$function$;');
        assert(changed !== H.beforeDefinitions[signature], 'synthetic body drift must be inserted'); await H.db.exec(changed);
      } else if (drift === 'acl') await H.db.exec(`grant execute on function ${signature} to authenticated`);
      else await H.db.exec(`alter function ${signature} set statement_timeout='29s'`);
      await H.db.exec('savepoint attempted_migration');
      await assert.rejects(H.db.exec(guarded), /LG_BUSINESS_RECEIVER_BASELINE_DRIFT/);
      await H.db.exec('rollback to attempted_migration');
      for (const helper of ['private.lg_validate_business_raw(jsonb)', 'private.lg_business_note_safe(text)']) assert.equal(await H.scalar('select to_regprocedure($1)::text v', [helper]), null);
    } finally { await H.db.exec('rollback to drift;release drift'); }
  }
}));
