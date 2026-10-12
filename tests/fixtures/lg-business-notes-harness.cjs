// Local, empty PGlite only. SQL fixtures contain definitions, never production rows.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const baseline = require('./lg-business-notes-baseline.json');
const uid = () => crypto.randomUUID();
const token = 'b'.repeat(64); // Deliberately synthetic; no external receiver is contacted.
const scope = { source_system: 'LG', platform: 'SUPERLG', country_code: 'PH', order_kind: 'withdraw' };
const row = (id, extra = {}) => ({
  order_no: `SYNTHETIC-LG-NOTES-${id}`, member_id: null,
  status_code: 6, status_text: '已驳回', status_class: 'rejected',
  order_amount: '100.00', actual_amount: '99.00', metric_amount: '99.00',
  created_at: '2020-01-02T00:01:00Z', finished_at: null, paid_at: null,
  operator_name: 'system', operator_kind: 'auto', handle_seconds: null,
  third_party: 'TEST', raw_channel: 'TEST', mapping_code: '', payment_method: 'TEST', merchant_name: 'TEST',
  raw: { status: 6, callbackTime: '2020-01-02T00:05:00Z' }, ...extra,
});

async function fixture({ applyMigration = true } = {}) {
  const db = new PGlite();
  try {
    for (const sql of baseline.steps) await db.exec(sql);
    for (const fn of baseline.production) {
      if (crypto.createHash('sha256').update(fn.definition).digest('hex') !== fn.sha256) throw Error('fixture definition hash mismatch');
      await db.exec(fn.definition + ';');
      await db.exec(`revoke all on function ${fn.signature} from public,anon,authenticated,service_role;grant execute on function ${fn.signature} to service_role;`);
    }
    // The historical metadata file contains table DDL, not its ACLs. Supply only
    // the local service role's required DML; this does not model client table ACLs.
    await db.exec('grant select,insert,update,delete on public.lg_sync_chunks,public.lg_order_stage,public.lg_orders to service_role;');
    const q = async (sql, args = []) => (await db.query(sql, args)).rows;
    const scalar = async (sql, args = []) => (await q(sql, args))[0].v;
    const signatures = baseline.production.map(x => x.signature);
    const metadata = () => scalar("select jsonb_agg(to_jsonb(p)-'prosrc' order by p.oid) v from pg_proc p where p.oid=any($1::regprocedure[])", [signatures]);
    const definitions = () => scalar('select jsonb_object_agg(s,pg_get_functiondef(s::regprocedure)) v from unnest($1::text[])s', [signatures]);
    const beforeMetadata = await metadata(), beforeDefinitions = await definitions();
    for (const expected of baseline.metadata) {
      const signature = expected.schema_name === 'public' ? 'public.' + expected.signature : expected.signature;
      const observed = await scalar(`select jsonb_build_object('owner',proowner::regrole::text,'prosecdef',prosecdef,'provolatile',provolatile,'proparallel',proparallel,'proconfig',proconfig,'proacl',proacl::text,'procost',procost,'definition_md5',md5(pg_get_functiondef(oid)),'prosrc_md5',md5(prosrc)) v from pg_proc where oid=$1::regprocedure`, [signature]);
      for (const key of Object.keys(observed)) if (JSON.stringify(observed[key]) !== JSON.stringify(expected[key])) throw Error(`fixture production metadata mismatch: ${signature} ${key}`);
    }
    if (applyMigration) await db.exec(fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261012132942_lg_business_notes_receiver.sql'), 'utf8'));
    await db.query("insert into public.lg_sync_credentials(token_hash,allowed_scopes,expires_at) values($1,$2,clock_timestamp()+interval '1 hour')", [token, [{ platform: 'SUPERLG', country_code: 'PH' }]]);
    let inTransaction = false;
    const rpc = async (kind, payload, suppliedToken = token, role = 'service_role') => {
      const fn = { live: 'lg_sync_ingest', full: 'lg_sync_ingest', callback: 'lg_callback_ingest', window: 'lg_window_ingest' }[kind];
      if (!fn || !['service_role', 'authenticated', 'anon'].includes(role)) throw Error('invalid synthetic harness argument');
      if (inTransaction) await db.exec('savepoint synthetic_rpc');
      await db.exec('set role ' + role);
      try { return await scalar(`select public.${fn}($1,$2::jsonb) v`, [suppliedToken, JSON.stringify(payload)]); }
      catch (error) { if (inTransaction) await db.exec('rollback to synthetic_rpc'); throw error; }
      finally { await db.exec('reset role'); if (inTransaction) await db.exec('release synthetic_rpc'); }
    };
    const begin = async (kind, { observedAt = '2020-01-04T00:00:00Z', count = 1, orderKind = 'withdraw', stream = 'created', extra = {} } = {}) => {
      const localScope = { ...scope, order_kind: orderKind };
      let envelope = { ...localScope, snapshot_id: uid(), observed_at: observedAt, expected_count: count, expected_chunks: count ? 1 : 0, fetched_count: count, source_total: count };
      const prefix = kind === 'window' ? 'window_' : kind === 'callback' ? 'callback_' : '';
      if (kind === 'window') {
        const lease = await rpc(kind, { ...localScope, stream, action: 'window_start', owner_id: uid(), origin_at: '2020-01-02T00:00:00Z' });
        envelope = { ...envelope, stream, lease_token: lease.lease_token, expected_cursor: lease.cursor, purpose: 'advance', start_at: lease.cursor, end_at: '2020-01-02T00:10:00Z' };
      } else if (kind === 'callback') envelope.callback_date = '2020-01-02';
      else Object.assign(envelope, { stat_date: '2020-01-02', sync_mode: kind });
      Object.assign(envelope, extra);
      const ack = await rpc(kind, { ...envelope, action: prefix + 'begin' });
      return {
        kind, envelope, ack,
        chunk: orders => rpc(kind, { ...envelope, action: prefix + 'chunk', chunk_index: 0, orders }),
        finish: () => rpc(kind, { ...envelope, action: prefix + 'finish' }),
        replayBegin: patch => rpc(kind, { ...envelope, ...patch, action: prefix + 'begin' }),
        release: () => kind === 'window' ? rpc(kind, { ...localScope, stream, action: 'window_release', lease_token: envelope.lease_token }) : Promise.resolve(),
      };
    };
    const send = async (kind, orders, options) => {
      const run = await begin(kind, { count: orders.length, ...options });
      if (orders.length) await run.chunk(orders);
      return { ...run, receipt: await run.finish() };
    };
    const transaction = async fn => { await db.exec('begin'); inTransaction = true; try { return await fn(); } finally { await db.exec('rollback'); inTransaction = false; } };
    return { db, q, scalar, metadata, definitions, signatures, beforeMetadata, beforeDefinitions, rpc, begin, send, transaction, row, scope, token, baseline };
  } catch (error) { await db.close(); throw error; }
}
module.exports = { fixture, row, scope, baseline };
