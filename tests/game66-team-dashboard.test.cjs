const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {loadTs,root} = require("./load-typescript.cjs");

const scope = loadTs(path.join(root,"src/lib/dashboardDataScope.ts"));

test("香港和红膏蟹是独立权限组，不再落入印度",()=>{
  assert.equal(scope.dashboardDataGroup("香港","EZ777"),"HK_TEAM");
  assert.equal(scope.dashboardDataGroup("香港盘口","KA9"),"HK_TEAM");
  assert.equal(scope.dashboardDataGroup("红膏蟹","66GAME"),"RED_CRAB");
  assert.equal(scope.dashboardDataGroup("RED CRAB","YY9"),"RED_CRAB");
  assert.equal(scope.dashboardDataGroup("印度","66GAME"),"IN");
});

test("团队权限严格隔离",()=>{
  const hk={mode:"selected",countries:["HK_TEAM"]};
  const crab={mode:"selected",countries:["RED_CRAB"]};
  assert.equal(scope.dashboardScopeAllows(hk,"香港","EZ777"),true);
  assert.equal(scope.dashboardScopeAllows(hk,"红膏蟹","66GAME"),false);
  assert.equal(scope.dashboardScopeAllows(crab,"红膏蟹","66GAME"),true);
  assert.equal(scope.dashboardScopeAllows(crab,"香港","EZ777"),false);
});

test("三个入口都提供团队页签，配置入口连接真实状态组件",()=>{
  const volume=fs.readFileSync(path.join(root,"src/components/ThirdPartyVolumeDashboard.tsx"),"utf8");
  const dashboard=fs.readFileSync(path.join(root,"src/components/Dashboard.tsx"),"utf8");
  const config=fs.readFileSync(path.join(root,"src/components/AutoWithdrawConfig.tsx"),"utf8");
  for(const label of ["香港","红膏蟹"]){
    assert.match(volume,new RegExp(`"${label}"`));
    assert.match(dashboard,new RegExp(`"${label}盘口"`));
    assert.match(config,new RegExp(`>${label}<`));
  }
  assert.match(config,/Game66ConfigBrowser team="hong_kong"/);
  assert.match(config,/Game66ConfigBrowser team="red_crab"/);
});

test("66GAME 汇总使用覆盖索引与可索引时间范围",()=>{
  const migration=fs.readFileSync(path.join(root,"supabase/migrations/20260916195000_optimize_game66_volume_query.sql"),"utf8");
  assert.match(migration,/game66_charge_orders_volume_cover_idx/);
  assert.match(migration,/include \([\s\S]*pay_method_name[\s\S]*status_code[\s\S]*last_seen_at[\s\S]*\)/);
  assert.match(migration,/c\.create_time >= v_start_at/);
  assert.match(migration,/c\.create_time < v_end_at/);
  assert.doesNotMatch(migration,/where \(c\.create_time at time zone 'Asia\/Kolkata'\)::date/);
});

test("团队页只读 GAME66 且前端查询有明确超时",()=>{
  const server=fs.readFileSync(path.join(root,"src/lib/supabaseDashboardServer.ts"),"utf8");
  const edge=fs.readFileSync(path.join(root,"supabase/functions/dashboard-api/lib/supabaseDashboardServer.ts"),"utf8");
  const volume=fs.readFileSync(path.join(root,"src/components/ThirdPartyVolumeDashboard.tsx"),"utf8");
  for(const source of [server,edge]){
    assert.match(source,/const shouldReadLegacy = !game66TeamCountry/);
    assert.match(source,/const \[results, game66Result\] = await Promise\.all\(\[legacyVolumeRead, game66Read\]\)/);
    assert.match(source,/if \(game66TeamCountry\) throw error/);
  }
  assert.match(volume,/dashboardBusinessFetch\(volumeUrl, \{ signal: AbortSignal\.timeout\(15000\) \}\)/);
  assert.match(volume,/loadData\(true, queryStart, queryEnd, "", queryCountry, true\)/);
});
