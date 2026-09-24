# 新版详细后台：Supabase 三方归类与团队平台映射

这份说明对应 `owner-admin-preview` 的新版详细后台。它只影响新版入口；旧版运营页面、旧版导航和旧版查询没有改动。

## 数据来源与权限

- 订单、代收、代付、三方维度和工单日汇总均从 Supabase 生产只读 RPC 读取。
- 三方归类读取 `public.third_party_volume` 中已经存在的 `raw_channel → channel` 归类；不再把 Google 核对快照当作新版三方来源。
- Google 核对快照只保留在“存款未到账明细”这一独立模块。
- 账号必须是启用的 `owner/admin/viewer`，并且存在 `dashboard_admin_preview_grants.can_view=true`。有授权即可进入，不要求 OWNER。

## 三方归类规则

1. 先按国家、平台、原始三方名称取 Supabase 已发布归类。
2. 同一原始名称在代收、代付两边共用同一归类，不能一边归类、一边重新猜测。
3. 只有一个统一三方时标记“已归类”，没有归类时标记“未归类”。同一原始名称在同一国家/平台出现多个统一三方时标记“归类冲突”，保留原始名称等待确认。
4. 订单总览、代收、代付、逐日、三方占比、成功率、明细订单和工单都会使用同一归类结果。选择一个统一三方查询时，后台会自动把已经匹配到它的所有原始别名一起查询；工单中同一统一三方的别名会先合并再分页。

新版“系统管理后台 → 三方配置”可以筛选“已归类 / 未归类 / 归类冲突”。当前生产快照核验结果为：2,923 个原始三方组合、2,905 个已归类、18 个归类冲突、0 个空归类。冲突会列出来，不会擅自合并。

当前没有“完全未归类”的三方名称；需要你确认的是这 18 个冲突。它们都在巴基斯坦的 `92COCO`、`92DADU`、`92GLORY`、`92GO`、`92PKR`、`92R`、`92STAR`、`92STRIKE`、`YAYWIN`：原始名是 `MCB-Jazz` / `MCB-JZ`，现有数据同时出现 `MCBPay` 与原名归类。页面筛选“归类冲突”即可查看，确认后再补一条明确映射。

订单源中仍可能出现“未识别通道”。它表示源订单没有提供可匹配的原始三方名称，不会被假装归入某个三方；在订单分析各页面仍会原样显示，后续拿到对应名称后再补映射。

## 团队、平台和包网系统

“团队运营中心 → 团队 / 平台归属”（原来的团队平台页合并到这里）读取 `dashboard_platform_team_map`，同时把 Supabase 实际数据中的平台做对照：

- 已配置且有数据
- 已配置但当前暂无数据
- 实际数据存在但尚未配置（待归类平台）

当前已录入 M8 的 93 条团队、国家、平台、包网系统配置。最近一次 Supabase 对照为：86 条配置平台有数据、7 条配置平台暂无数据、37 条实际数据平台待归类。熊猫后台的巴西源数据已按 Supabase 实际国家值“巴西”对齐，因此这些平台会计入“已配置且有数据”，不再被误列为待归类。AR、NEW_AR、AA 包网、熊猫、WG、LG、NPG、KP 等系统在配置页统一显示。平台系统查询使用配置表的系统名称，但不会改变旧查询使用的国家授权分组。

当前待确认的 37 个实际平台（页面可用“待归类平台”筛选；以下是本次核验快照）：

- 印尼：`HOT985`、`IND666`、`UANG`
- 巴西：`SSSGAME`、`TGJOGO`
- 胖虎巴西：`222O`、`222VIP`、`234T`、`25RR`、`27FF`、`2V222`、`32QQ`、`345F`、`45FF`、`559K`、`56L`、`58EE`、`5C555`、`5V555`、`67VIP`、`76PP`、`776F`、`8566BET`、`8599BET`、`888HH`、`9596BET`、`96F`、`AA45`、`BET5697`、`BET6867`、`F75`、`FF555`、`KK345`、`KKVIP`、`TPTP`、`VIP345`、`胖虎巴西`

这 37 个没有被自动套入已有三方 / 团队配置；你确认对应系统后，只需补 `dashboard_platform_team_map`，订单与代收、代付会沿用同一配置。

## 已应用的数据库迁移

以下迁移已在 Supabase 项目 `gmfyfzsxpxmaqtuuwgxb` 应用，SQL 文件也保留在 `supabase/`，便于审阅或迁移到其他环境：

- `admin-platform-team-map.sql`
- `admin-platform-team-map-aliases.sql`
- `admin-platform-team-map-country-aliases.sql`
- `admin-platform-team-map-source-aliases.sql`
- `admin-live-platform-catalog-map.sql`
- `admin-live-platform-assignments.sql`
- `admin-live-workorders.sql`
- `admin-live-provider-config.sql`
- `admin-live-provider-classification.sql`
- `admin-live-provider-mapping-index.sql`
- `admin-live-provider-query-normalization.sql`
- `admin-live-provider-filter-normalization.sql`
- `admin-live-provider-normalization-index.sql`

应用顺序：先完成基础新版后台 RPC，再应用团队 / 平台映射及三个别名修正，随后应用 `admin-live-provider-classification.sql`、`admin-live-platform-assignments.sql`、`admin-live-platform-catalog-map.sql`，再应用 `admin-live-provider-query-normalization.sql`，最后依次应用 `admin-live-provider-filter-normalization.sql` 和 `admin-live-provider-normalization-index.sql`。重复执行使用 `create or replace`；映射修正只更新映射表，不写入订单事实表。

## 本地验证与上线

本地已运行桥接校验、页面脚本语法校验，并重新生成 `src/lib/adminPreviewRestore.generated.ts`。上线时由你推送分支并合并 PR：

```bash
cd "/Users/jun/Documents/Codex/2026-09-23/gpt-5-6-luna-astra-1-8/work/production-data-release"
git checkout codex/restore-approved-admin
git add admin-preview/live-data.js admin-preview/live-pages-reference.js \
  src/lib/adminLiveBridge.ts src/lib/adminPreviewRestore.generated.ts \
  tests/admin-live-bridge.test.cjs supabase docs
git commit -m "feat: unify Supabase provider classifications in admin preview"
git push -u origin codex/restore-approved-admin
```

合并到 `main` 后等待 GitHub Actions 的 `Deploy Hensem to GitHub Pages` 成功，再从正式后台的新版详细后台入口查看。此分支没有自动推送，也没有改老页面。
