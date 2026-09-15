// Real in-memory Postgres tests only; never contacts a configured Supabase project.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require(process.env.PGLITE_PATH || '@electric-sql/pglite');
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260914140223_collection_success_daily.sql'), 'utf8');
const scopeMigration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260912150854_dashboard_account_data_scope.sql'), 'utf8');
function makeSnapshot(patch = {}) {
  return { schema_version: 1, source_system: 'RECHARGE_REVIEW', country_code: 'IN', platform: '91CLUB', stat_date: '2026-01-01', timezone: 'Asia/Kolkata',
    snapshot_id: randomUUID(), snapshot_at: new Date(Date.now() - 60000).toISOString(),
    coverage: { complete: true, expected_count: 100, fetched_count: 100, unique_count: 100 }, totals: { submitted_count: 100, success_count: 80 },
    groups: [{ raw_channel: 'WPay', channel_type: 'UPI', submitted_count: 100, success_count: 80 }], ...patch };
}
(async () => {
  const db = new PGlite(); let checks = 0;
  const run = (sql, values = []) => db.query(sql, values);
  const scalar = async (sql, values = []) => Object.values((await run(sql, values)).rows[0])[0];
  const fail = async (sql, values, message) => { await assert.rejects(run(sql, values), error => error.message.includes(message)); checks++; };
  const token = 'a'.repeat(64);
  const publish = value => scalar('select public.publish_collection_success_snapshot($1,$2::jsonb)', [token, JSON.stringify(value)]);
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema private;
      grant usage on schema public,private to authenticated,service_role;
      create function public.dashboard_has_permission(text) returns boolean language sql stable as $$ select coalesce(current_setting('test.module',true),'false')='true' $$;
      create function private.dashboard_current_data_scope() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.scope',true),''),'{"mode":"selected","countries":[]}')::jsonb $$;`);
    const groupFunction = scopeMigration.match(/create or replace function private\.dashboard_data_group[\s\S]*?\$function\$;/)[0];
    const scopeValid = scopeMigration.match(/create or replace function private\.dashboard_data_scope_valid[\s\S]*?\$function\$;/)[0];
    const scopeAllows = scopeMigration.match(/create or replace function private\.dashboard_scope_allows[\s\S]*?\$function\$;/)[0];
    await db.exec(groupFunction + scopeValid + scopeAllows);
    await db.exec(migration);
    await db.exec('set role service_role');
    await run(`insert into public.collection_success_credentials(token_hash,source_system,allowed_scopes,expires_at) values($1,'RECHARGE_REVIEW',$2::jsonb,now()+interval '1 day')`, [token, JSON.stringify([
      { country_code: 'IN', platform: '91CLUB', timezone: 'Asia/Kolkata' }, { country_code: 'BR', platform: '776F', timezone: 'America/Sao_Paulo' }, { country_code: 'BR', platform: 'POP555', timezone: 'America/Sao_Paulo' }
    ])]);
    const first = makeSnapshot(); assert.equal((await publish(first)).status, 'accepted'); assert.equal((await publish(first)).status, 'unchanged'); checks++;
    assert.equal((await publish(Object.fromEntries(Object.entries(first).reverse()))).status, 'unchanged'); checks++;
    const changed = structuredClone(first); changed.groups[0].success_count=79; changed.totals.success_count=79;
    await fail('select public.publish_collection_success_snapshot($1,$2::jsonb)', [token, JSON.stringify(changed)], 'CS_ID_CONFLICT');
    const newer = makeSnapshot({ snapshot_at: new Date(Date.parse(first.snapshot_at) + 1000).toISOString(), groups: [], totals: { submitted_count: 0, success_count: 0 }, coverage: { complete: true, expected_count: 0, fetched_count: 0, unique_count: 0 } });
    assert.equal((await publish(newer)).status, 'accepted'); assert.equal((await publish(first)).status, 'stale'); checks++;
    assert.equal((await publish({ ...first, snapshot_id: randomUUID() })).status, 'stale');
    assert.equal((await publish({ ...newer, snapshot_id: randomUUID() })).status, 'stale');
    assert.deepEqual(await scalar('select snapshot from public.collection_success_daily'), newer); checks++;
    for (const patch of [ { timezone: 'Asia/Colombo' }, { platform: 'OTHER' }, { country_code: 'VN' } ])
      await fail('select public.publish_collection_success_snapshot($1,$2::jsonb)', [token,JSON.stringify(makeSnapshot(patch))], 'CS_SCOPE_DENIED');
    for (const patch of [ { stat_date: '2026-02-30' }, { stat_date: '2999-01-01' }, { snapshot_at: '2026-01-01T00:00:00Z' }, { snapshot_at: '2026-09-13T24:00:00Z' },
      { coverage: { ...first.coverage, fetched_count: 101 } }, { coverage: { ...first.coverage, complete: false } }, { totals: { submitted_count:100,success_count:101 } },
      { groups: [first.groups[0],first.groups[0]] }, { groups: [{ ...first.groups[0], submitted_count: 0 }] }, { groups: [{ ...first.groups[0], raw_channel:'person@example.com' }] },
      { groups: [{ ...first.groups[0], channel_type:'123456789' }] }, { raw_orders: [] }, { groups: [{ ...first.groups[0], customer_name: 'private' }] },
      { groups: [{ ...first.groups[0], submitted_count: '100' }] }, { groups: [{ ...first.groups[0], submitted_count: 1.1 }] }, { groups: null } ])
      await fail('select public.publish_collection_success_snapshot($1,$2::jsonb)', [token,JSON.stringify(makeSnapshot(patch))], 'CS_INVALID');
    assert.deepEqual(await scalar('select snapshot from public.collection_success_daily'), newer, 'invalid data cannot overwrite a good snapshot'); checks++;
    await run('update public.collection_success_credentials set revoked=true where token_hash=$1',[token]);
    await fail('select public.publish_collection_success_snapshot($1,$2::jsonb)', [token,JSON.stringify(first)], 'CS_AUTH_INVALID');
    await run("update public.collection_success_credentials set revoked=false,expires_at=now()-interval '1 second' where token_hash=$1",[token]);
    await fail('select public.publish_collection_success_snapshot($1,$2::jsonb)', [token,JSON.stringify(first)], 'CS_AUTH_INVALID');
    await run("update public.collection_success_credentials set expires_at=now()+interval '1 day' where token_hash=$1",[token]);
    await publish(makeSnapshot({ country_code:'BR', platform:'776F', timezone:'America/Sao_Paulo' }));
    await publish(makeSnapshot({ country_code:'BR', platform:'POP555', timezone:'America/Sao_Paulo' }));
    await db.exec('reset role; set role anon');
    await fail('select * from public.collection_success_daily', [], 'permission denied');
    await fail("select public.dashboard_collection_success('2026-01-01','2026-01-02')", [], 'permission denied');
    await db.exec('reset role; set role authenticated; set test.module=\'true\'; set test.scope=\'{"mode":"selected","countries":["BR_PANGHU"]}\'');
    let read = await scalar("select public.dashboard_collection_success('2026-01-01','2026-01-02')");
    assert.deepEqual(read.snapshots.map(s=>s.platform),['776F'], 'RLS must run before JSON aggregation'); checks++;
    assert.equal((await scalar("select public.dashboard_collection_success('2026-01-01','2026-01-02','印度')")).snapshots.length,0); checks++;
    await db.exec('set test.scope=\'{"mode":"all","countries":[]}\'');
    assert.equal((await scalar("select public.dashboard_collection_success('2026-01-01','2026-01-02')")).snapshots.length,3); checks++;
    assert.deepEqual((await scalar("select public.dashboard_collection_success('2026-01-01','2026-01-02','胖虎巴西')")).snapshots.map(s=>s.platform),['776F']); checks++;
    assert.deepEqual((await scalar("select public.dashboard_collection_success('2026-01-01','2026-01-02','巴西')")).snapshots.map(s=>s.platform),['POP555']); checks++;
    await db.exec('set test.module=\'false\'');
    assert.equal((await scalar("select public.dashboard_collection_success('2026-01-01','2026-01-02')")).snapshots.length,0); checks++;
    await fail('select public.publish_collection_success_snapshot($1,$2::jsonb)',[token,JSON.stringify(first)],'permission denied');
    await fail('select * from public.collection_success_credentials',[],'permission denied');
    await fail('select * from public.collection_success_snapshot_receipts',[],'permission denied');
    await fail("select public.dashboard_collection_success('2023-01-01','2026-01-01')",[],'CS_INVALID_RANGE');
    const functions = await run("select proname,prosecdef from pg_proc where proname in ('dashboard_collection_success','publish_collection_success_snapshot','collection_success_assert_snapshot')");
    assert.equal(functions.rows.length,3); assert.ok(functions.rows.every(f=>f.prosecdef===false)); checks++;
    // More than PostgREST's usual 1000-row cap must remain complete, never truncated.
    await db.exec('reset role; set role service_role');
    const bulk = Array.from({length:1120},(_,i)=>makeSnapshot({ platform:`TEST${i}`, groups:[],totals:{submitted_count:0,success_count:0},coverage:{complete:true,expected_count:0,fetched_count:0,unique_count:0} }));
    await run(`insert into public.collection_success_snapshot_receipts(snapshot_id,payload_hash)
      select (j->>'snapshot_id')::uuid,repeat('b',64) from jsonb_array_elements($1::jsonb) j`,[JSON.stringify(bulk)]);
    await run(`insert into public.collection_success_daily(source_system,country_code,platform,stat_date,snapshot_id,snapshot_at,snapshot)
      select j->>'source_system',j->>'country_code',j->>'platform',(j->>'stat_date')::date,(j->>'snapshot_id')::uuid,(j->>'snapshot_at')::timestamptz,j
      from jsonb_array_elements($1::jsonb) j`,[JSON.stringify(bulk)]);
    await db.exec('reset role; set role authenticated; set test.module=\'true\'; set test.scope=\'{"mode":"selected","countries":["IN"]}\'');
    assert.equal((await scalar("select public.dashboard_collection_success('2026-01-01','2026-01-02')")).snapshots.length,1121); checks++;
    // Bound the aggregate BEFORE building it, and apply that bound only to visible rows.
    await db.exec('reset role; set role service_role');
    await run("update public.collection_success_daily set snapshot=snapshot || jsonb_build_object('test_padding',repeat('x',20000)) where platform like 'TEST%'");
    await db.exec('reset role; set role authenticated; set test.scope=\'{"mode":"selected","countries":["BR_PANGHU"]}\'');
    assert.equal((await scalar("select public.dashboard_collection_success('2026-01-01','2026-01-02')")).snapshots.length,1); checks++;
    await db.exec('set test.scope=\'{"mode":"all","countries":[]}\'');
    await fail("select public.dashboard_collection_success('2026-01-01','2026-01-02')",[],'CS_RANGE_TOO_LARGE');
    console.log(JSON.stringify({ result:'passed',checks,database:'PGlite',productionAccess:false }));
  } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
