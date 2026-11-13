const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, id, other, snapshot } = require('./fixtures/provider-options-current-harness.cjs');
const { options, ids } = require('./fixtures/wg-provider-options-harness.cjs');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const install = read('supabase/migrations/20261113065319_provider_options_scoped_resolution.sql');
const rollback = read('supabase/provider-options-scoped-resolution.rollback.sql');
const baseline = read('tests/fixtures/provider-options-scoped-before.sql');
const canonical = read('tests/fixtures/provider-canonical-current.sql');
const meta = "select md5(prosrc) hash,to_jsonb(p)-'prosrc' attributes from pg_proc p where oid='private.dashboard_admin_live_provider_options(jsonb)'::regprocedure";
const sites = [id, other];
let db, original, finalBody;

async function results() {
  const results = [];
  for (const platforms of [sites, [other], [id], [id, id], [], Object.values(ids)]) {
    for (const direction of ['all', 'charge', 'withdraw']) {
      results.push(await options(db, platforms, direction));
    }
  }
  return results;
}

before(async () => {
  db = await setup();
  await db.exec(`
    drop function private.dashboard_admin_live_provider_canonical(text,text,text);
    create function private.dashboard_admin_wg_provider_aliases()
    returns table(country_code text,country text,platform text,raw_provider text,canonical_provider text)
    language sql stable as $$ values ('IN','印度','OTHER','TeamAlias','WGOverride') $$;
    create or replace function private.dashboard_admin_live_confirmed_provider(text,text,text)
    returns text language sql stable as $$ select case when $2='OTHER' and $3='Confirmed' then 'CurrentConfirmed' end $$;
    insert into private.dashboard_admin_provider_registry values
      ('印度','ARTEST','Shared',array['A','B'],array['代收']),
      ('印度','OTHER','Shared',array['C'],array['代收']),
      ('印度','ARTEST','Confirmed',array['Legacy'],array['代收']),
      ('印度','OTHER','Confirmed',array['Legacy'],array['代收']),
      ('印度','OTHER','',array['UnrecognizedRegistry'],array['代收']);
    insert into private.dashboard_admin_provider_overrides values ('印度','ARTEST','Shared','ManualOverride');
    insert into private.ar_middle_channels
    select origin,tenant,'deposit',jsonb_build_object('channel_name',name),true,'${snapshot}','2026-10-26 00:00Z'
      from (values ('https://fixture.invalid','AR'),('https://other.invalid','OTHER')) s(origin,tenant)
      cross join (values ('Shared'),('Confirmed'),('TeamAlias'),('未识别通道'),('BothUnregistered')) n(name);
    insert into private.ar_middle_channels values
      ('https://other.invalid','OTHER','deposit','{"channel_name":"WinPay"}',true,'${snapshot}','2026-10-26 00:00Z');
  `);
  await db.exec(canonical);
  await db.exec(baseline);
  original = (await db.query(meta)).rows[0];
});
after(() => db?.close());

test('exact directory including direction, platform-specific conflicts, unknowns, and native aliases', async () => {
  assert.equal((await db.query("select md5(prosrc) hash from pg_proc where oid='private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure")).rows[0].hash, '008e5cee3a4f6ac9e90706c45bee56da');
  const prior = await results();
  for (const expected of ['BothUnregistered','ManualOverride','C','CurrentConfirmed','Legacy','TeamAlias','WGOverride','UnrecognizedRegistry','未识别通道']) {
    assert(prior[0].providers.includes(expected), expected);
  }
  await db.exec(install);
  finalBody = (await db.query(meta)).rows[0];
  assert.notEqual(finalBody.hash, original.hash);
  assert.deepEqual(finalBody.attributes, original.attributes);
  assert.deepEqual(await results(), prior);
  await db.exec(install);
  assert.deepEqual((await db.query(meta)).rows[0], finalBody);
});

test('scoped and denied users keep their original authorization', async () => {
  await db.exec("select set_config('test.platform','ARTEST',false)");
  const scoped = await options(db, sites);
  assert.equal(scoped.platformCount,1);
  assert(scoped.providers.includes('ManualOverride'));
  assert(!scoped.providers.includes('WGOverride'));
  await db.exec(rollback);
  assert.deepEqual(await options(db,sites),scoped);
  await db.exec(install);
  await db.exec("select set_config('test.platform','',false),set_config('test.denied','yes',false)");
  await assert.rejects(options(db,sites), /access_denied/);
  await db.exec("select set_config('test.denied','',false); set role anon");
  try { await assert.rejects(options(db,sites), /permission denied/); }
  finally { await db.exec('reset role'); }
});

test('native YASH exception and future platform-specific resolver changes remain exact', async () => {
  await db.exec(`update private.test_platforms set name='YASH.BET',source_name='YASH.BET' where id='${other}';
    update private.ar_middle_channel_platforms set native_platform='YASH.BET' where dashboard_platform_id='${other}';`);
  assert((await options(db, sites)).providers.includes('NewWinPay'));
  await db.exec(`create or replace function private.dashboard_admin_live_provider_canonical(p_country text,p_platform text,p_raw text)
    returns text language sql stable security definer set search_path='' as $$select p_platform||'/'||p_raw$$`);
  const changed = await options(db,sites);
  assert(changed.providers.includes('ARTEST/BothUnregistered'));
  assert(changed.providers.includes('YASH.BET/BothUnregistered'));
  await db.exec(rollback);
  assert.deepEqual(await options(db,sites),changed);
  assert.deepEqual((await db.query(meta)).rows[0],original);
});

test('unexpected ACL or current implementation aborts before replacement', async () => {
  await db.exec('grant execute on function private.dashboard_admin_live_provider_options(jsonb) to anon');
  await assert.rejects(db.exec(install), /metadata_drift/);
  await db.exec('rollback; revoke execute on function private.dashboard_admin_live_provider_options(jsonb) from anon');
  await db.exec(baseline.replace('-- wg_existing_orders_v1','-- test updated function'));
  await assert.rejects(db.exec(install), /body_drift/);
  await db.exec('rollback');
});
