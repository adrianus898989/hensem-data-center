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

test("66GAME 自动出款按真实团队授权并返回操作人统计",()=>{
  const migration=fs.readFileSync(path.join(root,"supabase/migrations/20260916201600_fix_game66_team_withdraw_operators.sql"),"utf8");
  assert.match(migration,/when 'hong_kong' then 'HK_TEAM'/);
  assert.match(migration,/when 'red_crab' then 'RED_CRAB'/);
  assert.doesNotMatch(migration,/'印度'::text as country/);
  assert.match(migration,/w\.create_time >= v_start_at/);
  assert.match(migration,/w\.create_time < v_end_at/);
  assert.match(migration,/greatest\(0::numeric, extract\(epoch from/);
  assert.doesNotMatch(migration,/pg_catalog\.greatest/);
  assert.match(migration,/when w\.auto_commit = '2' then '自动审核'/);
  assert.match(migration,/audit_admin/);
  assert.match(migration,/'operatorRows', v_operator_rows/);
  for(const file of ["src/lib/supabaseDashboardServer.ts","supabase/functions/dashboard-api/lib/supabaseDashboardServer.ts"]){
    const server=fs.readFileSync(path.join(root,file),"utf8");
    assert.match(server,/operatorRows\?: DbOperatorRow\[\]/);
    assert.match(server,/\[\.\.\.operatorFetched, \.\.\.\(game66Result\.operatorRows \|\| \[\]\)\]/);
  }
});

test("66GAME 自动出款按日期限流分片，配置状态失败时仍展示规则",()=>{
  for(const file of ["src/lib/supabaseDashboardServer.ts","supabase/functions/dashboard-api/lib/supabaseDashboardServer.ts"]){
    const server=fs.readFileSync(path.join(root,file),"utf8");
    assert.match(server,/const concurrency = 4/);
    assert.match(server,/days\.slice\(index, index \+ concurrency\)\.map\(\(day\) =>/);
    assert.match(server,/p_start: day, p_end: day/);
    assert.match(server,/AbortSignal\.timeout\(12000\)/);
  }
  const config=fs.readFileSync(path.join(root,"src/components/Game66ConfigBrowser.tsx"),"utf8");
  assert.match(config,/Promise\.allSettled\(\[fetchGame66PlatformStatus/);
  assert.match(config,/teamTargets\.map\(fallbackStatus\)/);
  assert.match(config,/订单库存状态暂时读取较慢/);
});

test("GEM7 MAX7 EK7 仅从 66GAME 自动出款配置页排除",()=>{
  const config=fs.readFileSync(path.join(root,"src/components/Game66ConfigBrowser.tsx"),"utf8");
  const volume=fs.readFileSync(path.join(root,"src/components/ThirdPartyVolumeDashboard.tsx"),"utf8");
  assert.match(config,/GAME66_CONFIG_EXCLUDED_PLATFORMS=new Set\(\["GEM7","MAX7","EK7"\]\)/);
  assert.match(config,/team_code===team&&showsGame66Config\(row\.platform_name\)/);
  assert.equal((config.match(/showsGame66Config\(row\.platform_name\)/g)||[]).length,2,"targets and live status must use the same exclusion");
  assert.doesNotMatch(volume,/GAME66_CONFIG_EXCLUDED_PLATFORMS|showsGame66Config/,"dashboard catalogue must stay unchanged");
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

test("成功量与单一三方完全相等时可安全使用平台总成功率",()=>{
  const snapshot={
    schema_version:1,source_system:"RECHARGE_REVIEW",country_code:"IN",platform:"6CLUB",
    stat_date:"2026-09-16",timezone:"Asia/Kolkata",snapshot_id:"single-provider-fallback",snapshot_at:"2026-09-17T00:00:00Z",
    coverage:{complete:true,expected_count:200,fetched_count:200,unique_count:200},
    totals:{submitted_count:200,success_count:128},
    groups:[{raw_channel:"后台未返回三方",channel_type:"其他类型",submitted_count:200,success_count:128}]
  };
  const oneProvider=[{date:"2026-09-16",country:"印度",platform:"6CLUB",channel:"UPI-QR",rawChannel:"UPI-QR",channelType:"UPI",direction:"代收",count:128}];
  const view=collectionSuccess.buildCollectionSuccessView({snapshots:[snapshot],volumeRows:oneProvider,start:"2026-09-16",end:"2026-09-16",country:"印度"});
  const upiKey=collectionSuccess.collectionSuccessProviderKey("印度","UPI-QR");
  assert.equal(view.compare([upiKey]).current.rate,0.64);

  const ambiguous=collectionSuccess.buildCollectionSuccessView({snapshots:[snapshot],volumeRows:[
    {...oneProvider[0],count:100},
    {...oneProvider[0],channel:"ArbPay",rawChannel:"ArbPay",count:28}
  ],start:"2026-09-16",end:"2026-09-16",country:"印度"});
  assert.equal(ambiguous.compare([upiKey]).current.rate,null);
});

test("VEERGAME 与 SHREEWIN 的 ArUpiPay-26000 成功率归入 UPI-QR",()=>{
  const snapshot={
    schema_version:1,source_system:"RECHARGE_REVIEW",country_code:"IN",platform:"Veer.Game",
    stat_date:"2026-09-16",timezone:"Asia/Kolkata",snapshot_id:"veer-arupipay",snapshot_at:"2026-09-17T00:00:00Z",
    coverage:{complete:true,expected_count:84123,fetched_count:84123,unique_count:84123},
    totals:{submitted_count:84123,success_count:43602},
    groups:[{raw_channel:"ArUpiPay-26000",channel_type:"UPI",submitted_count:84123,success_count:43602}]
  };
  const volumeRows=[{date:"2026-09-16",country:"印度",platform:"VEER.GAME",channel:"UPI-QR",rawChannel:"UPI-QR",channelType:"UPI",direction:"代收",count:59070}];
  const view=collectionSuccess.buildCollectionSuccessView({snapshots:[snapshot],volumeRows,start:"2026-09-16",end:"2026-09-16",country:"印度"});
  const upiKey=collectionSuccess.collectionSuccessProviderKey("印度","UPI-QR");
  assert.equal(collectionSuccess.collectionSuccessProviderKey("印度","ArUpiPay-26000"),upiKey);
  assert.equal(view.compare([upiKey],["UPI"]).current.rate,43602/84123);
  assert.equal(view.compare([upiKey],["UPI"]).current.state,"complete");
});

test("越南 CHUYỂN KHOẢN NHANH 成功率归入 LocalBank，其他近似名称不误合并",()=>{
  const makeSnapshot=(rawChannel,channelType)=>({
    schema_version:1,source_system:"RECHARGE_REVIEW",country_code:"VN",platform:"92LOTTERY",
    stat_date:"2026-09-09",timezone:"Asia/Ho_Chi_Minh",snapshot_id:`vn-${channelType}`,snapshot_at:"2026-09-10T00:00:00Z",
    coverage:{complete:true,expected_count:20,fetched_count:20,unique_count:20},
    totals:{submitted_count:20,success_count:12},
    groups:[{raw_channel:rawChannel,channel_type:channelType,submitted_count:20,success_count:12}]
  });
  const volumeRows=[{date:"2026-09-09",country:"越南",platform:"92LOTTERY",channel:"LocalBank",rawChannel:"LocalBank",channelType:"银行",direction:"代收"}];
  const mapped=collectionSuccess.buildCollectionSuccessView({
    snapshots:[makeSnapshot("未标记三方","CHUYỂN KHOẢN NHANH")],volumeRows,start:"2026-09-09",end:"2026-09-09",country:"越南"
  });
  assert.equal(mapped.providers[0].channel,"LocalBank");
  assert.equal(mapped.compare([mapped.providers[0].key],["银行"]).current.rate,0.6);

  const unconfirmed=collectionSuccess.buildCollectionSuccessView({
    snapshots:[makeSnapshot("未标记三方","CHUYỂN TIỀN NHANH")],volumeRows,start:"2026-09-09",end:"2026-09-09",country:"越南"
  });
  assert.equal(unconfirmed.providers[0].channel,"未标记三方");
});

test("团队页只读 GAME66 且前端查询有明确超时",()=>{
  const server=fs.readFileSync(path.join(root,"src/lib/supabaseDashboardServer.ts"),"utf8");
  const edge=fs.readFileSync(path.join(root,"supabase/functions/dashboard-api/lib/supabaseDashboardServer.ts"),"utf8");
  const volume=fs.readFileSync(path.join(root,"src/components/ThirdPartyVolumeDashboard.tsx"),"utf8");
  for(const source of [server,edge]){
    assert.match(source,/const shouldReadLegacy = !game66TeamCountry/);
    assert.match(source,/const redCrabTeamCountry = \["红膏蟹", "红膏蟹盘口", "redcrab"\]/);
    assert.match(source,/const hongKongTeamCountry = \["香港", "香港盘口", "hkteam", "hongkong"\]/);
    assert.match(source,/p_country: targetCountry/);
    assert.match(source,/const game66CurrentRead = !game66TeamCountry/);
    assert.match(source,/GAME66 only contains the Hong Kong and Red Crab teams/);
    assert.match(source,/readGame66Window\(successPeriod\.previousStart, successPeriod\.previousStart\)/);
    assert.match(source,/\["66GAME", "YYGAME", "XX7", "XX6", "XX5", "YY9", "PE7", "W5W"\]/);
    assert.match(source,/game66TeamPlatforms\.map\(platform => readGame66Window\(start, end, platform\)\)/);
    assert.match(source,/const \[results, game66Result, newarFetched\] = await Promise\.all\(\[legacyVolumeRead, game66Read,/);
    assert.match(source,/const canReadNewar = shouldReadLegacy && includesNewarCountry\(country\)/,"团队页不会读取 NEWAR 业务快照");
    assert.match(source,/if \(game66TeamCountry\) throw error/);
    assert.match(source,/collectionSuccessSnapshots: \[\.\.\.collectionSuccess\.snapshots, \.\.\.game66SuccessSnapshots\]/);
    assert.match(source,/withdrawPendingSnapshots: \[\.\.\.withdrawPending\.snapshots, \.\.\.game66PendingSnapshots\]/);
    assert.match(source,/withdrawActualRows: \[\.\.\.withdrawActual\.rows, \.\.\.game66ActualRows\]/);
  }
  assert.match(volume,/THIRD_PARTY_VOLUME_QUERY_TIMEOUT_MS = 25_000/);
  assert.match(volume,/const signal = \(timeout:number\) => AbortSignal\.any\(\[controller\.signal,AbortSignal\.timeout\(timeout\)\]\)/);
  assert.match(volume,/dashboardBusinessFetch\(volumeUrl, \{ signal: signal\(THIRD_PARTY_VOLUME_QUERY_TIMEOUT_MS\) \}\)/);
  assert.match(volume,/loadData\(true, queryStart, queryEnd, "", queryCountry, true\)/);
  assert.match(volume,/if \(!loaded\) \{[\s\S]*setHasQueried\(Boolean\(payloadRef\.current\)\);[\s\S]*return;/);
  assert.match(volume,/const showDailyResult = hasQueried && appliedViewer===viewerIdentity && appliedCountryPage===activeCountryPage/,
    "保留旧结果不等于在另一账号或国家下显示旧结果");
  assert.match(volume,/if \(!isCurrent\(\)\) return;/,"已取消的国家查询不得提交筛选条件");
  assert.doesNotMatch(volume,/setInterval\(/,"报表不再随挂载自动周期读取");
  assert.doesNotMatch(volume,/if \(appliedCountryPage\) setCountryPage\(appliedCountryPage\)/);
  assert.doesNotMatch(volume,/setPayload\(emptyClientVolumePayload/);
});

test("GAME66 团队大数据按精确盘口走索引预过滤",()=>{
  const scoped=fs.readFileSync(path.join(root,"supabase/migrations/20260916212000_game66_platform_scoped_dashboard.sql"),"utf8");
  const prefilter=fs.readFileSync(path.join(root,"supabase/migrations/20260916213500_game66_platform_prefilter.sql"),"utf8");
  assert.match(scoped,/g\.platform_name, g\.platform_code/);
  assert.match(prefilter,/v_platform_id uuid/);
  assert.match(prefilter,/c\.platform_id = v_platform_id/);
  assert.match(prefilter,/w\.platform_id = v_platform_id/);
});
