const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {loadTs,root} = require("./load-typescript.cjs");

const scope = loadTs(path.join(root,"src/lib/dashboardDataScope.ts"));
const collectionSuccess = loadTs(path.join(root,"src/lib/collectionSuccess.ts"));
const withdrawPending = loadTs(path.join(root,"src/lib/withdrawPending.ts"));
const withdrawActual = loadTs(path.join(root,"src/lib/withdrawActual.ts"));

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

test("66GAME 代收金额和笔数只展示成功到账订单",()=>{
  const migration=fs.readFileSync(path.join(root,"supabase/migrations/20260916195500_game66_successful_charge_volume.sql"),"utf8");
  assert.match(migration,/sum\([\s\S]*\) filter \(where c\.status_code = '1'\)[\s\S]*as amount/);
  assert.match(migration,/count\(\*\) filter \(where c\.status_code = '1'\)::bigint as order_count/);
  assert.match(migration,/having count\(\*\) filter \(where c\.status_code = '1'\) > 0/);
  assert.match(migration,/'submitted_amount', submitted_amount/);
  assert.match(migration,/'submitted_count', submitted_count/);
});

test("66GAME 完整聚合区分代收成功、代付成功、已提交和实际到账",()=>{
  const migration=fs.readFileSync(path.join(root,"supabase/migrations/20260916200500_game66_complete_team_metrics.sql"),"utf8");
  assert.match(migration,/w\.status_code = '3'/);
  assert.match(migration,/w\.status_code = '1'/);
  assert.match(migration,/'collectionSuccessSnapshots', v_collection_snapshots/);
  assert.match(migration,/'withdrawPendingSnapshots', v_withdraw_pending_snapshots/);
  assert.match(migration,/'withdrawActualRows', v_withdraw_actual_rows/);
  assert.match(migration,/real_amount_display/);
  assert.match(migration,/fee_display/);
  assert.match(migration,/game66_withdraw_orders_volume_cover_idx/);
});

test("红膏蟹成功率支持平台总计与各三方，待处理快照也可验证",()=>{
  assert.equal(collectionSuccess.collectionSuccessCountry("RED_CRAB","66GAME"),"红膏蟹");
  assert.equal(withdrawPending.withdrawPendingCountry("RED_CRAB","66GAME"),"红膏蟹");
  assert.equal(withdrawActual.withdrawActualCountry("RED_CRAB","66GAME"),"红膏蟹");
  const snapshot={
    schema_version:1, source_system:"RECHARGE_REVIEW", country_code:"RED_CRAB", platform:"66GAME",
    stat_date:"2026-09-14", timezone:"Asia/Kolkata", snapshot_id:"charge", snapshot_at:"2026-09-15T00:00:00Z",
    coverage:{complete:true,expected_count:100,fetched_count:100,unique_count:100},
    totals:{submitted_count:100,success_count:60},
    groups:[{raw_channel:"LovePay唤醒",channel_type:"其他类型",submitted_count:100,success_count:60}]
  };
  const volumeRows=[{date:"2026-09-14",country:"红膏蟹",platform:"66GAME",channel:"LovePay唤醒",rawChannel:"LovePay唤醒",channelType:"其他类型",direction:"代收"}];
  const view=collectionSuccess.buildCollectionSuccessView({snapshots:[snapshot],volumeRows,start:"2026-09-14",end:"2026-09-14",country:"红膏蟹"});
  assert.equal(view.compare().current.rate,0.6);
  assert.equal(view.compare([view.providers[0].key]).current.rate,0.6);
  assert.equal(withdrawPending.validWithdrawPendingSnapshot({
    schema_version:1,source_system:"WITHDRAW_REVIEW",country_code:"RED_CRAB",platform:"66GAME",
    stat_date:"2026-09-14",timezone:"Asia/Kolkata",snapshot_id:"pending",snapshot_at:"2026-09-15T00:00:00Z",
    coverage:{complete:true,expected_count:0,fetched_count:0,unique_count:0},totals:{pending_count:0,pending_amount:0},groups:[]
  }),true);
});

test("当前日有成功率但昨日无快照时，不再误报当前数据未采集",()=>{
  const complete={submitted:100,success:60,rate:0.6,expected:1,captured:1,state:"complete"};
  const missing={submitted:0,success:0,rate:null,expected:1,captured:0,state:"missing"};
  const zero={submitted:0,success:0,rate:null,expected:1,captured:1,state:"zero"};
  const base={current:complete,previous:missing,deltaPoints:null,comparisonLabel:"较昨日",platforms:[]};
  assert.equal(collectionSuccess.collectionSuccessComparisonNote(base),"本日已采集 · 无昨日对比");
  assert.equal(collectionSuccess.collectionSuccessComparisonNote({...base,previous:zero}),"本日已采集 · 昨日无提交");
  assert.equal(collectionSuccess.collectionSuccessComparisonNote({...base,previous:complete,deltaPoints:5.25}),"较昨日 +5.25 百分点");
});

test("团队页只读 GAME66 且前端查询有明确超时",()=>{
  const server=fs.readFileSync(path.join(root,"src/lib/supabaseDashboardServer.ts"),"utf8");
  const edge=fs.readFileSync(path.join(root,"supabase/functions/dashboard-api/lib/supabaseDashboardServer.ts"),"utf8");
  const volume=fs.readFileSync(path.join(root,"src/components/ThirdPartyVolumeDashboard.tsx"),"utf8");
  for(const source of [server,edge]){
    assert.match(source,/const shouldReadLegacy = !game66TeamCountry/);
    assert.match(source,/const \[results, game66Result\] = await Promise\.all\(\[legacyVolumeRead, game66Read\]\)/);
    assert.match(source,/if \(game66TeamCountry\) throw error/);
    assert.match(source,/collectionSuccessSnapshots: \[\.\.\.collectionSuccess\.snapshots, \.\.\.game66SuccessSnapshots\]/);
    assert.match(source,/withdrawPendingSnapshots: \[\.\.\.withdrawPending\.snapshots, \.\.\.game66PendingSnapshots\]/);
    assert.match(source,/withdrawActualRows: \[\.\.\.withdrawActual\.rows, \.\.\.game66ActualRows\]/);
  }
  assert.match(volume,/dashboardBusinessFetch\(volumeUrl, \{ signal: AbortSignal\.timeout\(15000\) \}\)/);
  assert.match(volume,/loadData\(true, queryStart, queryEnd, "", queryCountry, true\)/);
});
