const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');
const { build } = require('../scripts/build-india-moneypay-rapay-alias-patch.cjs');

const repo = path.resolve(__dirname, '..');
const migrations = path.join(repo, 'supabase/migrations');
const filename = fs.readdirSync(migrations).filter(n => /^\d+_pakistan_provider_channel_aliases\.sql$/.test(n));
assert.equal(filename.length, 1);
const patch = fs.readFileSync(path.join(migrations, filename[0]), 'utf8');
const previous = build(require('./fixtures/india-moneypay-rapay-alias-baseline.json')).changes
  .filter(f => !f.signature.includes('team_provider'));
const signatures = previous.map(f => f.signature);
const generated = fs.readFileSync(path.join(repo, 'supabase/admin-live-provider-aliases.sql'), 'utf8');
const exact = JSON.parse(generated.split('$pakistan$')[1]);
const browser = {};
vm.runInNewContext(fs.readFileSync(path.join(repo, 'admin-preview/live-provider-aliases.js'), 'utf8'), browser);

test('install and replay Pakistan aliases on the existing private functions, preserving other scopes and metadata', async () => {
  const db = new PGlite();
  try {
    await db.exec('create schema private; create role anon; create role authenticated; create role service_role');
    for (const f of previous) {
      await db.exec(f.desired_definition);
      await db.exec('revoke all on function ' + f.signature + ' from public, anon, authenticated, service_role;' +
                    'grant all on function ' + f.signature + ' to postgres;');
    }
    const state = async () => (await db.query(
      "select proname, to_jsonb(p)-'prosrc' meta, prosrc from pg_proc p where oid=any($1::regprocedure[]) order by proname",
      [signatures])).rows;
    const original = await state();
    await db.exec(patch);
    const installed = await state();
    assert.deepEqual(installed.map(s => s.meta), original.map(s => s.meta));
    const oldMap = JSON.parse(original[1].prosrc.split('$aliases$')[1]);
    const newMap = JSON.parse(installed[1].prosrc.split('$aliases$')[1]);
    const expected = JSON.parse(generated.split('$aliases$')[1]).巴基斯坦;
    assert.deepEqual(newMap, { ...oldMap, 巴基斯坦: expected });
    for (const [raw, name] of Object.entries(oldMap.巴基斯坦)) assert.equal(newMap.巴基斯坦[raw], name);

    const samples = (await db.query(
      'select k as raw, scope, private.dashboard_admin_live_provider_alias(scope,k) as display,' +
      'private.dashboard_admin_live_confirmed_usdt_provider(scope,k) as direct ' +
      "from jsonb_object_keys($1::jsonb) k cross join unnest(array['巴基斯坦','PK','Pakistan','PKR']) scope",
      [JSON.stringify(exact)])).rows;
    assert.equal(samples.length, Object.keys(exact).length * 4);
    for (const row of samples) {
      assert.equal(row.direct, exact[row.raw]);
      assert.equal(row.display, exact[row.raw]);
      assert.equal(row.display, browser.HensemProviderNames.canonical(row.raw, row.scope));
    }
    const other = (await db.query(`select private.dashboard_admin_live_provider_alias('印度','USDT(TRC20)-4') as india,
      private.dashboard_admin_live_confirmed_usdt_provider('印尼','66Wallet-BEP20') as indonesia,
      private.dashboard_admin_live_provider_alias('PK','ExamplePay-EP') as unknown,
      private.dashboard_admin_live_confirmed_usdt_provider('PK','USDT-unknown') as no_network`)).rows[0];
    assert.deepEqual(other, {india:'UniPayUSDT', indonesia:null, unknown:'ExamplePay-EP', no_network:null});
    await db.exec(patch);
    assert.deepEqual(await state(), installed);
  } finally {
    await db.close();
  }
});
