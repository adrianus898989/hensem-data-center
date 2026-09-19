// Exercise both production readers through their real auth and aggregation paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const { loadTs, root } = require('./load-typescript.cjs');
const hongKong = ['EZ777', 'KA9', '8GAME', 'WR777', 'JW777', 'HU777', 'GG9', 'MM9', 'WW9', '777IN', '365IN', 'INDIA2026', 'FT7', 'GEM7', 'MAX7', 'EK7'];
const redCrab = ['66GAME', 'YYGAME', 'XX7', 'XX6', 'XX5', 'YY9', 'PE7', 'W5W'];
const gems = ['GEM7', 'MAX7', 'EK7'];
const day = '2026-09-17';
const env = { SUPABASE_URL: 'https://gems-fixture.supabase.invalid', SUPABASE_ANON_KEY: 'synthetic-public-key' };
function loadEdge(entry) {
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const requireLocal = specifier => {
      assert.ok(specifier.startsWith('.'), `unexpected Edge dependency ${specifier}`);
      return load(path.resolve(path.dirname(file), specifier));
    };
    new Function('require', 'module', 'exports', source)(requireLocal, module, module.exports);
    return module.exports;
  }
  return load(path.join(root, entry));
}
const readers = [
  ['app', loadTs(path.join(root, 'src/lib/supabaseDashboardServer.ts'))],
  ['edge', loadEdge('supabase/functions/dashboard-api/lib/supabaseDashboardServer.ts')]
];
function row(platform, direction = '代收', country = '香港') {
  return { id: `${platform}-${direction}`, sheet_name: direction === '代收' ? 'game66_charge_orders' : 'game66_withdraw_orders',
    source_row: 0, data_date: day, country, country_code: country === '香港' ? 'HK_TEAM' : 'RED_CRAB', platform,
    channel: 'PayA', raw_channel: 'PayA', channel_type: 'UPI', direction, amount: direction === '代收' ? 123 : 45,
    count: 3, success_count: 3, failed_count: 0, success_rate: 1,
    status: '66GAME 成功到账订单（同步未启用）', raw: { platform_enabled: false }, updated_at: '2026-09-18T01:00:00Z' };
}
async function fixture(options, run) {
  const previousFetch = global.fetch, previousDeno = global.Deno;
  const names = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  const previousEnv = names.map(name => process.env[name]);
  for (const name of names) process.env[name] = env[name.replace('NEXT_PUBLIC_', '')];
  global.Deno = { env: { get: name => env[name] } };
  const calls = [];
  global.fetch = async (input, init = {}) => {
    const url = new URL(input);
    assert.equal(url.origin, env.SUPABASE_URL);
    assert.equal(init.headers.Authorization, 'Bearer synthetic-user');
    assert.equal(init.headers.apikey, env.SUPABASE_ANON_KEY);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'synthetic-user-id' });
    if (url.pathname === '/rest/v1/dashboard_profiles') return Response.json([{
      auth_user_id: 'synthetic-user-id', username: 'synthetic', active: true,
      role: options.scope ? 'viewer' : 'owner', permissions: { third_party: true },
      ...(options.scope ? { data_scope: options.scope } : {})
    }]);
    const body = JSON.parse(init.body); calls.push({ name: url.pathname.split('/').pop(), body });
    assert.equal(url.pathname, '/rest/v1/rpc/dashboard_game66_charge_volume');
    assert.equal(init.method, 'POST');
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
    let rows = gems.includes(body.p_country) ? [row(body.p_country), row(body.p_country, '代付')] : [];
    if (options.foreign && body.p_country === 'EK7') rows.push(row('66GAME', '代收', '红膏蟹'));
    return Response.json({ rows, collectionSuccessSnapshots: [], withdrawPendingSnapshots: [], withdrawActualRows: [], latestWriteAt: '2026-09-18T01:00:00Z' });
  };
  try {
    await run(new Request('https://dashboard.invalid/api/volume', { headers: { Authorization: 'Bearer synthetic-user' } }), calls);
  } finally {
    global.fetch = previousFetch;
    if (previousDeno === undefined) delete global.Deno; else global.Deno = previousDeno;
    names.forEach((name, index) => { if (previousEnv[index] === undefined) delete process.env[name]; else process.env[name] = previousEnv[index]; });
  }
}
for (const [name, reader] of readers) {
  test(`${name}: 香港日汇总实际查询 GEM7/MAX7/EK7，保留原名单并展示 disabled 同步平台的充值提现`, async () => {
    await fixture({}, async (request, calls) => {
      const result = await reader.readSupabaseThirdPartyVolume(request, day, day, '香港');
      assert.deepEqual(calls.map(call => call.body.p_country), hongKong);
      for (const call of calls) assert.deepEqual(call.body, { p_start: day, p_end: day, p_country: call.body.p_country });
      assert.equal(result.rows.length, 6);
      for (const platform of gems) {
        const rows = result.rows.filter(item => item.platform === platform);
        assert.deepEqual(rows.map(item => item.direction).sort(), ['代付', '代收']);
        assert.deepEqual(rows.map(item => item.amount).sort((a, b) => a - b), [45, 123]);
        assert.ok(rows.every(item => item.country === '香港' && item.raw.platform_enabled === false));
      }
      assert.equal(result.meta.platformCount, 3);
    });
  });
  test(`${name}: 香港范围权限不被新平台名单放宽`, async () => {
    await fixture({ scope: { mode: 'selected', countries: ['HK_TEAM'] }, foreign: true }, async (request, calls) => {
      const result = await reader.readSupabaseThirdPartyVolume(request, day, day, '香港');
      assert.equal(result.rows.length, 6);
      assert.ok(result.rows.every(item => gems.includes(item.platform) && item.raw === undefined));
      assert.deepEqual(calls.map(call => call.body.p_country), hongKong);
    });
  });
  test(`${name}: 红膏蟹查询名单与香港隔离不变`, async () => {
    await fixture({ scope: { mode: 'selected', countries: ['RED_CRAB'] } }, async (request, calls) => {
      const result = await reader.readSupabaseThirdPartyVolume(request, day, day, '红膏蟹');
      assert.deepEqual(calls.map(call => call.body.p_country), redCrab);
      assert.equal(result.rows.length, 0);
    });
  });
  test(`${name}: 无香港权限时在任何数据查询前拒绝`, async () => {
    await fixture({ scope: { mode: 'selected', countries: ['IN'] } }, async (request, calls) => {
      await assert.rejects(reader.readSupabaseThirdPartyVolume(request, day, day, '香港'), error => error.status === 403);
      assert.deepEqual(calls, []);
    });
  });
}
