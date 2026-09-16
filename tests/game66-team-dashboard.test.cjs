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
