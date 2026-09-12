// Public synthetic fixtures only. Actual source responses stay outside the repo.
const assert = require('node:assert/strict');
const test = require('node:test');
const { configuration, snapshot, contract, fixture, NOW } = require('./wg-config-receiver.test.cjs');

function grouped() {
  const value = configuration();
  for (const setting of Object.values(value.settings)) {
    setting.betGameLimit.games = [{ categoryId: 1, platformId: 2, gameIds: [] }, { categoryId: 2, platformId: 2, gameIds: [5, 6] }];
    setting.otherConditionV2.mustBeReceivedDiscount.specifiedDiscount = [
      { optType: 6, dealType: 6109, activeIds: [8, 9] }, { optType: 7, dealType: 7101, activeIds: [] },
    ];
  }
  return value;
}
test('Observed grouped game and discount shapes retain parents, order and empty children', () => {
  const value = grouped(), before = structuredClone(value);
  assert.strictEqual(contract.validateWGConfiguration(value), value);
  assert.deepEqual(value, before);
});
test('Original BR code lists, game scalar/null and empty lists still pass', () => {
  for (const games of [null, [], [3, 'GAME:2'], 'GAME:2', 3]) {
    const value = configuration(); value.settings['0'].betGameLimit.games = games;
    value.settings['0'].otherConditionV2.mustBeReceivedDiscount.specifiedDiscount = [3, 'OFFER:2'];
    contract.validateWGConfiguration(value);
  }
});
for (const [label, change] of [
  ['mixed scalar', rows => rows.push(1)],
  ['mixed null', rows => rows.push(null)],
  ['extra key', rows => { rows[0].extra = true; }],
  ['missing parent', rows => { delete rows[0].categoryId; delete rows[0].optType; }],
  ['string parent', rows => { if ('categoryId' in rows[0]) rows[0].categoryId = '1'; else rows[0].optType = '6'; }],
  ['duplicate parent pair', rows => rows.push(structuredClone(rows[0]))],
  ['duplicate child id', rows => { const key = 'gameIds' in rows[0] ? 'gameIds' : 'activeIds'; rows[0][key] = [4, 4]; }],
  ['unsafe child id', rows => { const key = 'gameIds' in rows[0] ? 'gameIds' : 'activeIds'; rows[0][key] = [Number.MAX_SAFE_INTEGER + 1]; }],
  ['negative child id', rows => { const key = 'gameIds' in rows[0] ? 'gameIds' : 'activeIds'; rows[0][key] = [-1]; }],
  ['nested object child', rows => { const key = 'gameIds' in rows[0] ? 'gameIds' : 'activeIds'; rows[0][key] = [{ id: 1 }]; }],
]) test(`Grouped selections reject ${label} without modifying input`, () => {
  for (const field of ['games', 'discounts']) {
    const value = grouped(), setting = value.settings['0'];
    change(field === 'games' ? setting.betGameLimit.games : setting.otherConditionV2.mustBeReceivedDiscount.specifiedDiscount);
    const before = structuredClone(value);
    assert.throws(() => contract.validateWGConfiguration(value)); assert.deepEqual(value, before);
  }
});
test('Structured variants are limited to the two observed fields', () => {
  const value = grouped(); value.settings['0'].PIXCondition = value.settings['0'].betGameLimit.games;
  assert.throws(() => contract.validateWGConfiguration(value));
  const other = grouped(); other.settings['0'].otherConditionV2.mustBeReceivedDiscount.specifiedDiscount = null;
  assert.throws(() => contract.validateWGConfiguration(other));
});
test('Grouped selections bound the combined tree to 5000 nodes', () => {
  const value = grouped(), games = Array.from({ length: 3 }, (_, i) => ({ categoryId: 1, platformId: i, gameIds: Array.from({ length: 1666 }, (_, id) => id) }));
  value.settings['0'].betGameLimit.games = games;
  assert.throws(() => contract.validateWGConfiguration(value));
  games[2].gameIds.pop(); contract.validateWGConfiguration(value);
});
test('Registered VN group including KK98 passes the actual receiver; unregistered members stay blocked', async () => {
  const base = grouped().settings['0'];
  const value = snapshot({ country_code: 'VN', platform: '98VV', site_code: '3257', timezone: 'Asia/Ho_Chi_Minh', configuration: grouped() });
  value.configuration.settings = Object.fromEntries(['0', '3257', '3605', '3913'].map(id => [id, structuredClone(base)]));
  const options = { credential: { allowed_targets: ['VN:98VV'] }, target: { site_code: '3257', timezone: 'Asia/Ho_Chi_Minh', members: ['3257', '3605', '3913'].map(site_code => ({ site_code })) } };
  contract.validateWGConfigSnapshot(value, NOW);
  const live = await fixture(options); assert.equal((await live.request({ action: 'ingest', snapshot: value })).status, 200);
  assert.deepEqual(live.publications[0].p_snapshot, value);
  const old = await fixture({ ...options, target: { ...options.target, members: options.target.members.slice(0, 2) } });
  assert.equal((await old.request({ action: 'ingest', snapshot: value })).status, 403);
  assert.equal(old.publications.length, 0);
});
